/**
 * Auth client factory and API utilities.
 */

import { resolveAuth, refreshUserToken, acquireRefreshLock } from "./auth.js";
import { CliError, mapApiError } from "./utils/errors.js";
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
  _refreshAttempt: number = 0,
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
            const refreshedAuthInfo: AuthInfo = {
              ...authInfo,
              userToken: newTokens.user_access_token,
              expiresAt: newTokens.expires_at,
              refreshToken: newTokens.refresh_token,
            };
            return { authInfo: refreshedAuthInfo };
          } finally {
            await releaseLock();
          }
        } catch (refreshErr) {
          const refreshError = refreshErr as Error;
          // In auto mode, fall back to tenant auth instead of failing
          if (authMode === "auto" && appId && appSecret) {
            process.stderr.write(
              `feishu-docs: info: 自动刷新失败 (${refreshError.message})，回退到 tenant 模式\n`,
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
          const tenantAuthInfo: AuthInfo = {
            ...authInfo,
            mode: "tenant",
            userToken: undefined,
          };
          return { authInfo: tenantAuthInfo };
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
export async function fetchWithAuth(
  authInfo: AuthInfo,
  path: string,
  options: FetchOptions = {},
): Promise<ApiResponse> {
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
    if (error.name === "AbortError") {
      throw new CliError("API_ERROR", "API 请求超时（30秒）", {
        retryable: true,
      });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  const body = (await res.json()) as ApiResponse;

  if (body.code !== undefined && body.code !== 0) {
    throw mapApiError({ code: body.code, msg: body.msg });
  }

  return body;
}
