/**
 * Authentication module: OAuth login, token persistence, auto-refresh.
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type { Socket } from "node:net";
import {
  createHash,
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, unlink, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { CliError } from "./utils/errors.js";
import { BASE_SCOPES } from "./scopes.js";
import type { AuthMode, AuthInfo, TokenData } from "./types/index.js";

function getConfigDir(): string {
  return join(homedir(), ".feishu-docs");
}
function getAuthFile(): string {
  return join(getConfigDir(), "auth.json");
}
function getLockFile(): string {
  return join(getConfigDir(), ".refresh.lock");
}

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const DEFAULT_OAUTH_HOST = "127.0.0.1";
const DEFAULT_OAUTH_PORT = 3456;
const DEFAULT_OAUTH_PATH = "/callback";
const LOCAL_CALLBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

interface StoredTokens {
  appId: string;
  tokens: TokenData & { scope?: string };
}

interface OauthLoginOptions {
  appSecret?: string;
  scope?: string;
  port?: number | string;
  redirectUri?: string;
  useLark?: boolean;
}

interface OAuthCallbackConfig {
  redirectUri: string;
  callbackHost: string;
  callbackPath: string;
  callbackPort: number;
}

interface BuildAuthorizationUrlOptions {
  appId: string;
  redirectUri: string;
  state: string;
  scope?: string;
  useLark?: boolean;
  codeChallenge?: string;
}

interface ExchangeCodeOptions {
  useLark?: boolean;
  codeVerifier?: string;
}

interface ExchangeCodeResponse {
  code: number;
  msg?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface StoredPayload {
  version: number;
  app_id: string;
  encrypted_data: string;
}

/**
 * Derive encryption key from machine identity + random salt.
 */
function deriveKey(salt: Buffer): Buffer {
  const identity = `${hostname()}:${userInfo().username}:feishu-docs-cli`;
  return scryptSync(identity, salt, KEY_LENGTH) as Buffer;
}

function encrypt(data: unknown): string {
  const salt = randomBytes(32);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return (
    salt.toString("hex") +
    ":" +
    iv.toString("hex") +
    ":" +
    authTag.toString("hex") +
    ":" +
    encrypted.toString("hex")
  );
}

function decrypt(encryptedData: string): TokenData & { scope?: string } {
  const parts = encryptedData.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted data");
  }
  const [saltHex, ivHex, authTagHex, dataHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const key = deriveKey(salt);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Save auth tokens to encrypted config file.
 */
export async function saveTokens(
  appId: string,
  tokenData: TokenData & { scope?: string },
): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true, mode: 0o700 });
  const payload: StoredPayload = {
    version: 2,
    app_id: appId,
    encrypted_data: encrypt(tokenData),
  };
  await writeFile(getAuthFile(), JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Load auth tokens from encrypted config file.
 * Returns null if not found.
 */
export async function loadTokens(): Promise<StoredTokens | null> {
  if (!existsSync(getAuthFile())) return null;
  try {
    const raw = await readFile(getAuthFile(), "utf8");
    if (!raw.trim()) return null;
    const payload: StoredPayload = JSON.parse(raw);
    if (payload.version !== 2) return null;
    return {
      appId: payload.app_id,
      tokens: decrypt(payload.encrypted_data),
    };
  } catch {
    return null;
  }
}

/**
 * Clear saved auth tokens.
 */
export async function clearTokens(): Promise<void> {
  if (existsSync(getAuthFile())) {
    await unlink(getAuthFile());
  }
}

/**
 * Resolve credentials based on auth mode.
 * Returns { mode, appId, appSecret, userToken }
 */
export async function resolveAuth(
  authMode: AuthMode | string = "auto",
): Promise<AuthInfo> {
  const envUserToken = process.env.FEISHU_USER_TOKEN;
  const envAppId = process.env.FEISHU_APP_ID;
  const envAppSecret = process.env.FEISHU_APP_SECRET;

  if (authMode === "user") {
    if (envUserToken) {
      return {
        mode: "user",
        appId: envAppId,
        appSecret: envAppSecret,
        userToken: envUserToken,
        useLark: false,
      };
    }
    const saved = await loadTokens();
    if (saved?.tokens?.user_access_token) {
      return {
        mode: "user",
        appId: saved.appId,
        appSecret: envAppSecret,
        userToken: saved.tokens.user_access_token,
        refreshToken: saved.tokens.refresh_token,
        expiresAt: saved.tokens.expires_at,
        useLark: false,
      };
    }
    throw new CliError(
      "AUTH_REQUIRED",
      "未找到 user_access_token，请运行 feishu-docs login",
      {
        recovery: "运行 feishu-docs login 获取 user 身份认证",
      },
    );
  }

  if (authMode === "tenant") {
    if (!envAppId || !envAppSecret) {
      throw new CliError(
        "AUTH_REQUIRED",
        "缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET 环境变量",
        {
          recovery: "设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量",
        },
      );
    }
    return {
      mode: "tenant",
      appId: envAppId,
      appSecret: envAppSecret,
      useLark: false,
    };
  }

  // auto mode: try user first, then tenant
  if (envUserToken) {
    return {
      mode: "user",
      appId: envAppId,
      appSecret: envAppSecret,
      userToken: envUserToken,
      useLark: false,
    };
  }

  const saved = await loadTokens();
  if (saved?.tokens?.user_access_token) {
    const isExpired =
      saved.tokens.expires_at && Date.now() >= saved.tokens.expires_at;
    const canRefresh = !!saved.tokens.refresh_token;
    const hasTenantCreds = envAppId && envAppSecret;

    // Only skip stale user token when it's expired, has no refresh_token,
    // AND tenant credentials are available. In this case, fall through to
    // tenant mode (createClient will warn the user).
    // When refresh_token exists, always return user auth — createClient
    // will attempt refresh and throw explicit errors on failure.
    if (isExpired && !canRefresh && hasTenantCreds) {
      // Fall through to tenant mode
    } else {
      return {
        mode: "user",
        appId: saved.appId || envAppId,
        appSecret: envAppSecret,
        userToken: saved.tokens.user_access_token,
        refreshToken: saved.tokens.refresh_token,
        expiresAt: saved.tokens.expires_at,
        useLark: false,
      };
    }
  }

  if (envAppId && envAppSecret) {
    return {
      mode: "tenant",
      appId: envAppId,
      appSecret: envAppSecret,
      useLark: false,
    };
  }

  throw new CliError(
    "AUTH_REQUIRED",
    "未找到任何认证凭证。请设置环境变量或运行 feishu-docs login",
    {
      recovery:
        "设置 FEISHU_APP_ID + FEISHU_APP_SECRET 环境变量，或运行 feishu-docs login",
    },
  );
}

/**
 * Open URL in the default browser.
 */
function openBrowser(url: string): void {
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  execFile(openCmd, [url], (err) => {
    if (err) {
      process.stderr.write(
        `feishu-docs: warning: 无法自动打开浏览器: ${err.message}\n`,
      );
    }
  });
}

function parseCallbackPort(value: string | number): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError("INVALID_ARGS", `无效的 OAuth 回调端口: ${value}`, {
      recovery:
        "使用 1-65535 之间的端口，或通过 --redirect-uri / FEISHU_REDIRECT_URI 传入完整回调地址",
    });
  }
  return port;
}

export function resolveOAuthCallbackConfig(
  options: OauthLoginOptions = {},
): OAuthCallbackConfig {
  const rawPort =
    options.port ?? process.env.FEISHU_OAUTH_PORT ?? DEFAULT_OAUTH_PORT;
  const fallbackRedirectUri = `http://${DEFAULT_OAUTH_HOST}:${parseCallbackPort(rawPort)}${DEFAULT_OAUTH_PATH}`;
  const rawRedirectUri =
    options.redirectUri ||
    process.env.FEISHU_REDIRECT_URI ||
    fallbackRedirectUri;

  let parsed: URL;
  try {
    parsed = new URL(rawRedirectUri);
  } catch {
    throw new CliError(
      "INVALID_ARGS",
      `无效的 redirect_uri: ${rawRedirectUri}`,
      {
        recovery:
          "使用完整 URL，例如 http://localhost:3456/callback，并确保它与飞书开放平台登记值完全一致",
      },
    );
  }

  if (parsed.protocol !== "http:") {
    throw new CliError(
      "INVALID_ARGS",
      "redirect_uri 必须使用本机回调地址（仅支持 http://localhost 或 http://127.0.0.1）",
      {
        recovery:
          "将飞书应用的重定向地址登记为本机 HTTP 回调，再通过 --redirect-uri 或 FEISHU_REDIRECT_URI 传入完全一致的值",
      },
    );
  }

  if (!LOCAL_CALLBACK_HOSTS.has(parsed.hostname)) {
    throw new CliError(
      "INVALID_ARGS",
      "redirect_uri 必须使用本机回调地址（仅支持 localhost、127.0.0.1、::1）",
      {
        recovery:
          "使用本机回调地址，例如 http://localhost:3456/callback，并确保它与飞书开放平台登记值完全一致",
      },
    );
  }

  if (parsed.search || parsed.hash) {
    throw new CliError("INVALID_ARGS", "redirect_uri 不能包含 query 或 hash", {
      recovery: "请传入纯净的回调地址，例如 http://localhost:3456/callback",
    });
  }

  const callbackPort = parseCallbackPort(parsed.port || "80");
  const callbackPath = parsed.pathname || "/";
  const redirectUri = `${parsed.origin}${callbackPath}`;

  return {
    redirectUri,
    callbackHost: parsed.hostname,
    callbackPath,
    callbackPort,
  };
}

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 */
export function generatePkce(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizationUrl({
  appId,
  redirectUri,
  state,
  scope,
  useLark = false,
  codeChallenge,
}: BuildAuthorizationUrlOptions): string {
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    state,
  });
  if (scope) {
    params.set("scope", scope);
  }
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }

  const authBase = useLark
    ? "https://accounts.larksuite.com/open-apis/authen/v1/authorize"
    : "https://open.feishu.cn/open-apis/authen/v1/authorize";

  return `${authBase}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens via v2 OAuth endpoint.
 */
async function exchangeCodeForToken(
  appId: string,
  appSecret: string | undefined,
  code: string,
  redirectUri: string,
  { useLark = false, codeVerifier }: ExchangeCodeOptions = {},
): Promise<ExchangeCodeResponse> {
  const host = useLark
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";
  const requestBody: Record<string, string | undefined> = {
    grant_type: "authorization_code",
    client_id: appId,
    client_secret: appSecret,
    code,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) {
    requestBody.code_verifier = codeVerifier;
  }
  const res = await fetch(`${host}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const body = (await res.json()) as ExchangeCodeResponse;
  if (body.code !== 0) {
    throw new CliError("AUTH_REQUIRED", `Token 交换失败: ${body.msg}`, {
      apiCode: body.code,
    });
  }
  return body;
}

/**
 * Run OAuth login flow (v2 OAuth with PKCE S256).
 */
export async function oauthLogin(
  appId: string,
  options: OauthLoginOptions = {},
): Promise<TokenData> {
  const appSecret = options.appSecret || process.env.FEISHU_APP_SECRET;
  const scope = options.scope || BASE_SCOPES.join(" ");
  const { redirectUri, callbackHost, callbackPath, callbackPort } =
    resolveOAuthCallbackConfig(options);
  const state = randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkce();

  return new Promise<TokenData>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const openSockets = new Set<Socket>();

    const server: Server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "GET") {
          res.writeHead(405, { Allow: "GET" });
          res.end("Method Not Allowed");
          return;
        }

        if (!req.url) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const url = new URL(req.url, redirectUri);
        if (url.pathname !== callbackPath) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        // Validate state to prevent CSRF
        if (!returnedState || returnedState !== state) {
          res.writeHead(400);
          res.end("Invalid state parameter");
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          return;
        }

        try {
          const tokenRes = await exchangeCodeForToken(
            appId,
            appSecret,
            code,
            redirectUri,
            { useLark: options.useLark, codeVerifier },
          );

          const tokenData: TokenData = {
            user_access_token: tokenRes.access_token,
            refresh_token: tokenRes.refresh_token,
            expires_at: Date.now() + (tokenRes.expires_in || 7200) * 1000,
            token_type: tokenRes.token_type,
          };

          await saveTokens(appId, { ...tokenData, scope: tokenRes.scope });

          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            Connection: "close",
          });
          res.end("<h1>登录成功！</h1><p>你可以关闭此页面。</p>");

          clearTimeout(timeout);
          server.close();
          for (const socket of openSockets) socket.destroy();
          resolve(tokenData);
        } catch (err) {
          const error = err as Error;
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          const safeMsg = (error.message || "").replace(
            /[&<>"']/g,
            (c) =>
              (
                ({
                  "&": "&amp;",
                  "<": "&lt;",
                  ">": "&gt;",
                  '"': "&quot;",
                  "'": "&#39;",
                }) as Record<string, string>
              )[c] ?? c,
          );
          res.end(`<h1>登录失败</h1><p>${safeMsg}</p>`);
          clearTimeout(timeout);
          server.close();
          for (const socket of openSockets) socket.destroy();
          reject(err);
        }
      },
    );

    // Track connections so we can force-close them after callback
    server.on("connection", (socket: Socket) => {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });

    server.listen(callbackPort, callbackHost, () => {
      const authUrl = buildAuthorizationUrl({
        appId,
        redirectUri,
        scope,
        state,
        useLark: options.useLark,
        codeChallenge,
      });

      process.stderr.write(
        "\n正在打开浏览器进行授权...\n" +
          `回调地址: ${redirectUri}\n` +
          "请确保该地址已在飞书开放平台应用的安全设置中登记，且与当前值完全一致。\n\n" +
          `如果浏览器未自动打开，请手动访问:\n  ${authUrl}\n\n等待回调中...\n`,
      );
      openBrowser(authUrl);
    });

    timeout = setTimeout(
      () => {
        server.close();
        for (const socket of openSockets) socket.destroy();
        reject(new Error("OAuth 登录超时（5分钟），请重试"));
      },
      5 * 60 * 1000,
    );
  });
}

/**
 * Acquire an exclusive file lock for token refresh.
 * Returns a release function, or null if lock is held by another process.
 */
export async function acquireRefreshLock(): Promise<
  (() => Promise<void>) | null
> {
  await mkdir(getConfigDir(), { recursive: true, mode: 0o700 });
  try {
    const fh = await open(getLockFile(), "wx");
    await fh.write(String(process.pid));
    return async () => {
      await fh.close();
      try {
        await unlink(getLockFile());
      } catch {
        // ignore cleanup errors
      }
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      // Check for stale lock (process no longer alive)
      try {
        const pidStr = await readFile(getLockFile(), "utf8");
        const pid = Number(pidStr.trim());
        if (pid && pid !== process.pid) {
          try {
            process.kill(pid, 0); // check if process is alive
          } catch {
            // Process is dead — stale lock, remove and retry
            await unlink(getLockFile());
            return acquireRefreshLock();
          }
        }
      } catch {
        // Can't read lock file — treat as held
      }
      return null;
    }
    throw err;
  }
}

/**
 * Refresh user_access_token using refresh_token (v2 OAuth).
 */
export async function refreshUserToken(
  appId: string,
  appSecret: string,
  refreshToken: string,
  { useLark = false }: { useLark?: boolean } = {},
): Promise<TokenData> {
  const host = useLark
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";
  const res = await fetch(`${host}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    }),
  });
  const body = (await res.json()) as ExchangeCodeResponse;

  if (body.code !== 0) {
    throw new CliError("TOKEN_EXPIRED", `Token 刷新失败: ${body.msg}`, {
      apiCode: body.code,
    });
  }

  const tokenData: TokenData = {
    user_access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in || 7200) * 1000,
    token_type: body.token_type,
  };

  await saveTokens(appId, { ...tokenData, scope: body.scope });
  return tokenData;
}
