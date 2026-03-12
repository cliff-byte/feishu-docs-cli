/**
 * Lark SDK client factory with auth mode support.
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { resolveAuth, refreshUserToken, acquireRefreshLock } from "./auth.js";
import { CliError, mapApiError } from "./utils/errors.js";

const silentLogger = {
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
};

/**
 * Create a configured Lark SDK client.
 * @param {object} options - { auth: 'user'|'tenant'|'auto', lark: boolean }
 * @returns {{ client: lark.Client, authInfo: object }}
 */
export async function createClient(options = {}, _refreshAttempt = 0) {
  const authMode = options.auth || "auto";
  const useLark = options.lark || false;
  const resolved = await resolveAuth(authMode);
  const authInfo = { ...resolved, useLark };

  const { appId, appSecret } = authInfo;

  if (!appId || !appSecret) {
    if (authInfo.mode === "user" && authInfo.userToken) {
      // User token from env, no app credentials needed for some APIs
      // Create a minimal client
      const client = new lark.Client({
        appId: "placeholder",
        appSecret: "placeholder",
        domain: useLark ? lark.Domain.Lark : lark.Domain.Feishu,
        logger: silentLogger,
      });
      return { client, authInfo };
    }
    throw new CliError(
      "AUTH_REQUIRED",
      "缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET",
    );
  }

  const client = new lark.Client({
    appId,
    appSecret,
    domain: useLark ? lark.Domain.Lark : lark.Domain.Feishu,
    logger: silentLogger,
  });

  // Auto-refresh user token if expired
  if (authInfo.mode === "user" && authInfo.expiresAt) {
    if (Date.now() >= authInfo.expiresAt) {
      if (authInfo.refreshToken) {
        try {
          process.stderr.write(
            "feishu-docs: info: token 已过期，正在自动刷新...\n",
          );
          const releaseLock = await acquireRefreshLock();
          if (!releaseLock) {
            if (_refreshAttempt >= 3) {
              throw new CliError(
                "TOKEN_EXPIRED",
                "等待 token 刷新超时。如果问题持续，请手动删除 ~/.feishu-docs/.refresh.lock 后重试",
              );
            }
            process.stderr.write(
              "feishu-docs: info: 另一个进程正在刷新 token，等待中...\n",
            );
            await new Promise((r) => setTimeout(r, 2000));
            return createClient(options, _refreshAttempt + 1);
          }
          try {
            const newTokens = await refreshUserToken(
              appId,
              appSecret,
              authInfo.refreshToken,
              { useLark },
            );
            const refreshedAuthInfo = {
              ...authInfo,
              userToken: newTokens.user_access_token,
              expiresAt: newTokens.expires_at,
              refreshToken: newTokens.refresh_token,
            };
            return { client, authInfo: refreshedAuthInfo };
          } finally {
            await releaseLock();
          }
        } catch (refreshErr) {
          // In auto mode, fall back to tenant auth instead of failing
          if (authMode === "auto" && appId && appSecret) {
            process.stderr.write(
              `feishu-docs: info: 自动刷新失败 (${refreshErr.message})，回退到 tenant 模式\n`,
            );
            const tenantAuthInfo = {
              ...authInfo,
              mode: "tenant",
              userToken: undefined,
            };
            return { client, authInfo: tenantAuthInfo };
          }
          throw new CliError(
            "TOKEN_EXPIRED",
            "自动刷新 token 失败，请重新运行 feishu-docs login",
            {
              recovery: "运行 feishu-docs login 重新认证",
            },
          );
        }
      } else {
        // In auto mode, fall back to tenant auth instead of failing
        if (authMode === "auto" && appId && appSecret) {
          process.stderr.write(
            "feishu-docs: info: user token 已过期，回退到 tenant 模式\n",
          );
          const tenantAuthInfo = {
            ...authInfo,
            mode: "tenant",
            userToken: undefined,
          };
          return { client, authInfo: tenantAuthInfo };
        }
        throw new CliError(
          "TOKEN_EXPIRED",
          "token 已过期，请重新运行 feishu-docs login",
          {
            recovery: "运行 feishu-docs login 重新认证",
          },
        );
      }
    }
  }

  return { client, authInfo };
}

/**
 * Build request options with appropriate auth header.
 */
export function withAuth(authInfo) {
  if (authInfo.mode === "user" && authInfo.userToken) {
    return {
      headers: { Authorization: `Bearer ${authInfo.userToken}` },
    };
  }
  // tenant mode uses SDK's built-in tenant_access_token
  return {};
}

/**
 * Resolve the API base URL based on whether we're using Lark or Feishu.
 */
export function getApiBase(authInfo) {
  return authInfo.useLark
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";
}

/**
 * Get tenant_access_token for tenant mode API calls.
 */
export async function getTenantToken(authInfo) {
  const res = await fetch(
    `${getApiBase(authInfo)}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: authInfo.appId,
        app_secret: authInfo.appSecret,
      }),
    },
  );
  const body = await res.json();
  if (body.code !== 0) {
    throw new CliError(
      "AUTH_REQUIRED",
      `获取 tenant_access_token 失败: ${body.msg}`,
      {
        apiCode: body.code,
      },
    );
  }
  return body.tenant_access_token;
}

/**
 * Build Authorization header value for any auth mode.
 */
async function resolveBearer(authInfo) {
  if (authInfo.mode === "user" && authInfo.userToken) {
    return `Bearer ${authInfo.userToken}`;
  }
  const tenantToken = await getTenantToken(authInfo);
  return `Bearer ${tenantToken}`;
}

/**
 * Direct fetch wrapper that correctly passes user/tenant token.
 * Use this instead of SDK methods for APIs where the SDK overrides the token.
 */
export async function fetchWithAuth(authInfo, path, options = {}) {
  const base = getApiBase(authInfo);
  const bearer = await resolveBearer(authInfo);
  const url = new URL(path, base);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const fetchOpts = {
    method: options.method || "GET",
    headers: {
      Authorization: bearer,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await fetch(url.toString(), {
      ...fetchOpts,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new CliError("API_ERROR", "API 请求超时（30秒）", {
        retryable: true,
      });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  const body = await res.json();

  if (body.code !== undefined && body.code !== 0) {
    throw mapApiError({ code: body.code, msg: body.msg });
  }

  return body;
}

/**
 * Extract Feishu API error code from various error shapes.
 */
function extractErrorCode(err) {
  return err?.code || err?.response?.data?.code || err?.response?.code;
}

/**
 * Execute an API call with retry for idempotent operations.
 */
export async function apiCall(fn, { retries = 3, idempotent = true } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= (idempotent ? retries : 0); attempt++) {
    try {
      const res = await fn();
      // Check SDK response code
      if (res?.code && res.code !== 0) {
        throw mapApiError({ code: res.code, msg: res.msg });
      }
      return res;
    } catch (err) {
      lastError = err;
      const code = extractErrorCode(err);

      // Don't retry client errors (permission, not found, auth errors)
      const NON_RETRYABLE = new Set([
        131001, 131002, 131006, 131008, 99991400, 99991663,
      ]);
      if (code && NON_RETRYABLE.has(code)) {
        throw mapApiError(err);
      }

      // Retry on network/server errors
      if (attempt < retries && idempotent) {
        const delay = 1000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw mapApiError(lastError);
}
