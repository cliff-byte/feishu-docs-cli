/**
 * Unified error handling for feishu-docs CLI.
 *
 * Exit codes:
 *   0 - success
 *   1 - invalid args / file not found
 *   2 - auth failure
 *   3 - API error
 */

import { ErrorType, CliErrorOptions } from "../types/index.js";

const ERROR_MAP: Record<string, { exit: number; type: string }> = {
  INVALID_ARGS: { exit: 1, type: "INVALID_ARGS" },
  FILE_NOT_FOUND: { exit: 1, type: "FILE_NOT_FOUND" },
  AUTH_REQUIRED: { exit: 2, type: "AUTH_REQUIRED" },
  TOKEN_EXPIRED: { exit: 2, type: "TOKEN_EXPIRED" },
  PERMISSION_DENIED: { exit: 2, type: "PERMISSION_DENIED" },
  SCOPE_MISSING: { exit: 2, type: "SCOPE_MISSING" },
  NOT_FOUND: { exit: 3, type: "NOT_FOUND" },
  NOT_SUPPORTED: { exit: 3, type: "NOT_SUPPORTED" },
  RATE_LIMITED: { exit: 3, type: "RATE_LIMITED" },
  API_ERROR: { exit: 3, type: "API_ERROR" },
};

export class CliError extends Error {
  exitCode: number;
  errorType: string;
  apiCode?: number;
  retryable: boolean;
  recovery?: string;
  /** Scope names from API permission_violations (only for SCOPE_MISSING). */
  missingScopes?: string[];

  constructor(
    type: ErrorType,
    message: string,
    {
      apiCode,
      retryable = false,
      recovery,
      missingScopes,
    }: CliErrorOptions = {},
  ) {
    super(message);
    this.name = "CliError";
    const info = ERROR_MAP[type] || ERROR_MAP.API_ERROR;
    this.exitCode = info.exit;
    this.errorType = info.type;
    this.apiCode = apiCode;
    this.retryable = retryable;
    this.recovery = recovery;
    this.missingScopes = missingScopes;
  }
}

export function formatError(err: unknown, json: boolean = false): string {
  if (err instanceof CliError) {
    if (json) {
      return JSON.stringify({
        success: false,
        error: {
          type: err.errorType,
          message: err.message,
          api_code: err.apiCode,
          retryable: err.retryable,
          recovery: err.recovery,
          ...(err.missingScopes &&
            err.missingScopes.length > 0 && {
              missing_scopes: err.missingScopes,
            }),
        },
      });
    }
    const code = err.apiCode ? ` (code: ${err.apiCode})` : "";
    return `feishu-docs: error: ${err.message}${code}`;
  }

  const safeMessage = (err as { message?: string }).message || "未知错误";
  if (json) {
    return JSON.stringify({
      success: false,
      error: {
        type: "UNKNOWN",
        message: safeMessage,
        retryable: false,
      },
    });
  }
  return `feishu-docs: error: ${safeMessage}`;
}

export function handleError(err: unknown, json: boolean = false): never {
  process.stderr.write(formatError(err, json) + "\n");
  const exitCode = err instanceof CliError ? err.exitCode : 1;
  process.exit(exitCode);
}

interface ApiErrorShape {
  code?: number;
  msg?: string;
  message?: string;
  response?: {
    data?: {
      code?: number;
      msg?: string;
    };
    code?: number;
    msg?: string;
  };
}

export function mapApiError(err: unknown): CliError {
  const e = err as ApiErrorShape;
  const code = e?.code ?? e?.response?.data?.code ?? e?.response?.code;
  const msg =
    e?.msg ?? e?.response?.data?.msg ?? e?.response?.msg ?? e?.message;

  if (code === 131006) {
    return new CliError(
      "PERMISSION_DENIED",
      `权限不足，请确认文档已对当前用户开放访问权限`,
      {
        apiCode: code,
        recovery: "请求文档拥有者授予访问权限，或使用 --auth user 切换身份",
      },
    );
  }
  if (code === 131008) {
    // 131008 is context-dependent: "permission denied" for node ops, "already exist" for member ops.
    // Preserve apiCode so callers can distinguish at the call site.
    return new CliError("PERMISSION_DENIED", msg || "权限不足或资源已存在", {
      apiCode: code,
      recovery: "请求文档拥有者授予访问权限，或使用 --auth user 切换身份",
    });
  }
  if (code === 131001 || code === 131002) {
    return new CliError("NOT_FOUND", `文档不存在或已被删除`, {
      apiCode: code,
    });
  }
  if (code === 99991400 || code === 99991663) {
    return new CliError(
      "TOKEN_EXPIRED",
      `认证已过期，请重新运行 feishu-docs login`,
      {
        apiCode: code,
        recovery: "运行 feishu-docs login 重新认证",
      },
    );
  }
  // 99991672 / 99991679 are scope errors — handled directly in fetchWithAuth
  // before mapApiError is called. If they reach here, treat as generic API error.
  return new CliError("API_ERROR", msg || "未知 API 错误", { apiCode: code });
}
