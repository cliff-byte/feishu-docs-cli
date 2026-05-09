/**
 * Auth client factory and API utilities.
 */

import { resolveAuth, tryRefreshIfExpired } from "./auth.js";
import { CliError, mapApiError } from "./utils/errors.js";
import {
  DEFAULT_RETRY,
  calculateDelay,
  parseRetryAfter,
  isRetryable,
  sleep,
} from "./utils/retry.js";
import type {
  AuthInfo,
  AuthMode,
  GlobalOpts,
  FetchOptions,
  ApiResponse,
} from "./types/index.js";

const FEISHU_BASE = "https://open.feishu.cn";
const LARK_BASE = "https://open.larksuite.com";

/**
 * Create auth context for API calls.
 * @param {object} options - { auth: 'user'|'tenant'|'auto', lark: boolean }
 * @returns {{ authInfo: AuthInfo }}
 */
export async function createClient(
  options: Partial<GlobalOpts> = {},
): Promise<{ authInfo: AuthInfo }> {
  const authMode: AuthMode | string = options.auth || "auto";
  const useLark = options.lark || false;
  const resolved = await resolveAuth(authMode);
  const authInfo: AuthInfo = { ...resolved, useLark };

  const { appId, appSecret } = authInfo;

  if (!appId || !appSecret) {
    if (authInfo.mode === "user" && authInfo.userToken) {
      // User token from env, no app credentials needed for some APIs
      return { authInfo };
    }
    throw new CliError(
      "AUTH_REQUIRED",
      "缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET",
    );
  }

  // Auto-refresh user token if expired
  if (
    authInfo.mode === "user" &&
    authInfo.expiresAt &&
    Date.now() >= authInfo.expiresAt
  ) {
    if (authInfo.refreshToken) {
      const result = await tryRefreshIfExpired(authInfo, {
        maxLockRetries: 3,
      });
      if (result.refreshed) {
        return { authInfo: result.authInfo };
      }
      throw new CliError(
        "TOKEN_EXPIRED",
        `自动刷新 token 失败: ${result.refreshError ?? "未知错误"}。请重新运行 feishu-docs login`,
        {
          recovery: "运行 feishu-docs login 重新认证",
        },
      );
    }
    // No refresh_token — fall back to tenant if credentials available,
    // but warn the user so they know they're not in user mode.
    if (authMode === "auto" && appId && appSecret) {
      process.stderr.write(
        "feishu-docs: warning: user token 已过期且无法刷新，回退到 tenant 模式（部分操作可能需要 user 权限）\n",
      );
      const tenantAuthInfo: AuthInfo = {
        ...authInfo,
        mode: "tenant",
        userToken: undefined,
      };
      return { authInfo: tenantAuthInfo };
    }
    throw new CliError(
      "TOKEN_EXPIRED",
      "token 已过期且无 refresh_token，请重新运行 feishu-docs login",
      {
        recovery: "运行 feishu-docs login 重新认证",
      },
    );
  }

  return { authInfo };
}

/**
 * Resolve the API base URL based on whether we're using Lark or Feishu.
 */
export function getApiBase(authInfo: AuthInfo): string {
  return authInfo.useLark ? LARK_BASE : FEISHU_BASE;
}

/**
 * Get tenant_access_token for tenant mode API calls.
 */
export async function getTenantToken(authInfo: AuthInfo): Promise<string> {
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
  const body = (await res.json()) as ApiResponse<never> & {
    tenant_access_token?: string;
  };
  if (body.code !== 0) {
    throw new CliError(
      "AUTH_REQUIRED",
      `获取 tenant_access_token 失败: ${body.msg}`,
      {
        apiCode: body.code,
      },
    );
  }
  if (!body.tenant_access_token) {
    throw new CliError(
      "AUTH_REQUIRED",
      "获取 tenant_access_token 失败: API 返回空值",
    );
  }
  return body.tenant_access_token;
}

/**
 * Build Authorization header value for any auth mode.
 */
async function resolveBearer(authInfo: AuthInfo): Promise<string> {
  if (authInfo.mode === "user" && authInfo.userToken) {
    return `Bearer ${authInfo.userToken}`;
  }
  if (authInfo.tenantToken) {
    return `Bearer ${authInfo.tenantToken}`;
  }
  const tenantToken = await getTenantToken(authInfo);
  return `Bearer ${tenantToken}`;
}

/**
 * Direct fetch wrapper that correctly passes user/tenant token.
 */
export async function fetchWithAuth<T = unknown>(
  authInfo: AuthInfo,
  path: string,
  options: FetchOptions = {},
): Promise<ApiResponse<T>> {
  const base = getApiBase(authInfo);
  const bearer = await resolveBearer(authInfo);
  const url = new URL(path, base);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const fetchOpts: RequestInit & { body?: string } = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      Authorization: bearer,
    },
  };

  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  const retryEnabled = options.retry !== false;
  const retryOpts = retryEnabled
    ? {
        ...DEFAULT_RETRY,
        ...(typeof options.retry === "object" ? options.retry : {}),
      }
    : { maxRetries: 0, initialDelay: 0, maxDelay: 0 };
  const maxAttempts = retryOpts.maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        ...fetchOpts,
        signal: controller.signal,
      });
    } catch (err) {
      const error = err as Error;
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        if (retryEnabled && attempt < retryOpts.maxRetries) {
          process.stderr.write(
            `feishu-docs: info: API 请求失败（超时），第 ${attempt + 1} 次重试...\n`,
          );
          const delay = calculateDelay(
            attempt,
            retryOpts.initialDelay,
            retryOpts.maxDelay,
          );
          await sleep(delay);
          continue;
        }
        throw new CliError("API_ERROR", "API 请求超时（30秒）", {
          retryable: true,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Check for retryable HTTP status (only when retry is enabled)
    if (retryEnabled && isRetryable(res.status)) {
      if (attempt < retryOpts.maxRetries) {
        process.stderr.write(
          `feishu-docs: info: API 请求失败（${res.status}），第 ${attempt + 1} 次重试...\n`,
        );
        const retryAfterDelay =
          res.status === 429
            ? parseRetryAfter(res.headers.get("Retry-After"))
            : null;
        const delay =
          retryAfterDelay ??
          calculateDelay(attempt, retryOpts.initialDelay, retryOpts.maxDelay);
        await sleep(delay);
        continue;
      }
      throw new CliError(
        "API_ERROR",
        `API 请求失败: HTTP ${res.status} ${res.statusText}`,
        { retryable: true },
      );
    }

    const body = (await res.json()) as ApiResponse<T>;

    if (body.code !== undefined && body.code !== 0) {
      // Scope errors: extract missing scopes from permission_violations
      if (body.code === 99991672 || body.code === 99991679) {
        const scopes = extractScopesFromError(body);
        const scopeStr = scopes.length > 0 ? scopes.join(" ") : "";
        const hint =
          scopes.length > 0
            ? `缺少以下权限: ${scopes.join(", ")}。运行: feishu-docs authorize --scope "${scopeStr}"`
            : body.msg || "权限不足";
        throw new CliError("SCOPE_MISSING", hint, {
          apiCode: body.code,
          missingScopes: scopes,
          recovery:
            scopes.length > 0
              ? `feishu-docs authorize --scope "${scopeStr}"`
              : "检查飞书开发者后台的应用权限配置",
        });
      }
      throw mapApiError({ code: body.code, msg: body.msg });
    }

    return body;
  }

  // Unreachable — loop always returns or throws
  throw new CliError("API_ERROR", "API 请求异常：重试逻辑未正常退出");
}

/**
 * Fetch multipart/form-data with auth.
 * Used for media upload endpoints that do not accept JSON bodies.
 */
export async function fetchFormDataWithAuth<T = unknown>(
  authInfo: AuthInfo,
  path: string,
  options: {
    method?: string;
    form: FormData;
    params?: FetchOptions["params"];
    headers?: Record<string, string>;
    retry?: FetchOptions["retry"];
  },
): Promise<ApiResponse<T>> {
  const base = getApiBase(authInfo);
  const bearer = await resolveBearer(authInfo);
  const url = new URL(path, base);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const fetchOpts: RequestInit = {
    method: options.method || "POST",
    headers: {
      ...options.headers,
      Authorization: bearer,
    },
    body: options.form,
  };

  const retryEnabled = options.retry !== false;
  const retryOpts = retryEnabled
    ? {
        ...DEFAULT_RETRY,
        ...(typeof options.retry === "object" ? options.retry : {}),
      }
    : { maxRetries: 0, initialDelay: 0, maxDelay: 0 };
  const maxAttempts = retryOpts.maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        ...fetchOpts,
        signal: controller.signal,
      });
    } catch (err) {
      const error = err as Error;
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        if (retryEnabled && attempt < retryOpts.maxRetries) {
          process.stderr.write(
            `feishu-docs: info: API 请求失败（超时），第 ${attempt + 1} 次重试...\n`,
          );
          const delay = calculateDelay(
            attempt,
            retryOpts.initialDelay,
            retryOpts.maxDelay,
          );
          await sleep(delay);
          continue;
        }
        throw new CliError("API_ERROR", "API 请求超时（60秒）", {
          retryable: true,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (retryEnabled && isRetryable(res.status)) {
      if (attempt < retryOpts.maxRetries) {
        process.stderr.write(
          `feishu-docs: info: API 请求失败（${res.status}），第 ${attempt + 1} 次重试...\n`,
        );
        const retryAfterDelay =
          res.status === 429
            ? parseRetryAfter(res.headers.get("Retry-After"))
            : null;
        const delay =
          retryAfterDelay ??
          calculateDelay(attempt, retryOpts.initialDelay, retryOpts.maxDelay);
        await sleep(delay);
        continue;
      }
      throw new CliError(
        "API_ERROR",
        `API 请求失败: HTTP ${res.status} ${res.statusText}`,
        { retryable: true },
      );
    }

    const body = (await res.json()) as ApiResponse<T>;
    if (body.code !== undefined && body.code !== 0) {
      if (body.code === 99991672 || body.code === 99991679) {
        const scopes = extractScopesFromError(body);
        const scopeStr = scopes.length > 0 ? scopes.join(" ") : "";
        const hint =
          scopes.length > 0
            ? `缺少以下权限: ${scopes.join(", ")}。运行: feishu-docs authorize --scope "${scopeStr}"`
            : body.msg || "权限不足";
        throw new CliError("SCOPE_MISSING", hint, {
          apiCode: body.code,
          missingScopes: scopes,
          recovery:
            scopes.length > 0
              ? `feishu-docs authorize --scope "${scopeStr}"`
              : "检查飞书开发者后台的应用权限配置",
        });
      }
      throw mapApiError({ code: body.code, msg: body.msg });
    }

    return body;
  }

  throw new CliError("API_ERROR", "API 请求异常：重试逻辑未正常退出");
}

/**
 * Extract scope names from Feishu API error response.
 *
 * Newer APIs include `error.permission_violations[].subject` with exact scope names.
 * Older APIs may omit this field entirely — returns empty array in that case.
 */
function extractScopesFromError(body: ApiResponse<unknown>): string[] {
  const error = (body as Record<string, unknown>).error as
    | { permission_violations?: Array<{ subject?: string }> }
    | undefined;
  const violations = error?.permission_violations;
  if (!Array.isArray(violations)) return [];
  return violations
    .map((v) => v.subject)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * Fetch binary data with auth (for APIs that return file streams).
 */
export async function fetchBinaryWithAuth(
  authInfo: AuthInfo,
  path: string,
  options: { retry?: FetchOptions["retry"] } = {},
): Promise<ArrayBuffer> {
  const base = getApiBase(authInfo);
  const bearer = await resolveBearer(authInfo);
  const url = new URL(path, base);

  const retryEnabled = options.retry !== false;
  const retryOpts = retryEnabled
    ? {
        ...DEFAULT_RETRY,
        ...(typeof options.retry === "object" ? options.retry : {}),
      }
    : { maxRetries: 0, initialDelay: 0, maxDelay: 0 };
  const maxAttempts = retryOpts.maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: bearer },
        signal: controller.signal,
      });
    } catch (err) {
      const error = err as Error;
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        if (retryEnabled && attempt < retryOpts.maxRetries) {
          process.stderr.write(
            `feishu-docs: info: API 请求失败（超时），第 ${attempt + 1} 次重试...\n`,
          );
          const delay = calculateDelay(
            attempt,
            retryOpts.initialDelay,
            retryOpts.maxDelay,
          );
          await sleep(delay);
          continue;
        }
        throw new CliError("API_ERROR", "API 请求超时（60秒）", {
          retryable: true,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Check for retryable HTTP status before processing body
    if (isRetryable(res.status)) {
      if (retryEnabled && attempt < retryOpts.maxRetries) {
        process.stderr.write(
          `feishu-docs: info: API 请求失败（${res.status}），第 ${attempt + 1} 次重试...\n`,
        );
        const retryAfterDelay =
          res.status === 429
            ? parseRetryAfter(res.headers.get("Retry-After"))
            : null;
        const delay =
          retryAfterDelay ??
          calculateDelay(attempt, retryOpts.initialDelay, retryOpts.maxDelay);
        await sleep(delay);
        continue;
      }
      throw new CliError(
        "API_ERROR",
        `下载失败: HTTP ${res.status} ${res.statusText}`,
        { retryable: true },
      );
    }

    if (!res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        let body: Record<string, unknown>;
        try {
          body = await res.json();
        } catch {
          throw new CliError(
            "API_ERROR",
            `下载失败: HTTP ${res.status} ${res.statusText}`,
          );
        }
        if (body.code === 99991672 || body.code === 99991679) {
          const scopes = extractScopesFromError(body as ApiResponse);
          const scopeStr = scopes.length > 0 ? scopes.join(" ") : "";
          const hint =
            scopes.length > 0
              ? `缺少以下权限: ${scopes.join(", ")}。运行: feishu-docs authorize --scope "${scopeStr}"`
              : (body.msg as string) || "权限不足";
          throw new CliError("SCOPE_MISSING", hint, {
            apiCode: body.code as number,
            missingScopes: scopes,
            recovery:
              scopes.length > 0
                ? `feishu-docs authorize --scope "${scopeStr}"`
                : "检查飞书开发者后台的应用权限配置",
          });
        }
        throw mapApiError({
          code: body.code as number,
          msg: body.msg as string,
        });
      }
      throw new CliError(
        "API_ERROR",
        `下载失败: HTTP ${res.status} ${res.statusText}`,
      );
    }

    return res.arrayBuffer();
  }

  // Unreachable — loop always returns or throws
  throw new CliError("API_ERROR", "API 请求异常：重试逻辑未正常退出");
}
