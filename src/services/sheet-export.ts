import { link, lstat, mkdtemp, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fetchBinaryToFileWithAuth, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import { calculateDelay, DEFAULT_RETRY } from "../utils/retry.js";
import type { AuthInfo } from "../types/index.js";

interface ExportInput {
  spreadsheetToken: string;
  outputPath: string;
  waitTimeoutMs?: number;
  signal?: AbortSignal;
}

const recovery = "确认表格权限、网络和本地目录后重新运行 export；命令不会覆盖已有文件";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("API_ERROR", "导出接口返回的数据格式无效", { recovery });
  }
  return value as Record<string, unknown>;
}

function responseToken(value: unknown, label: string): string {
  try { validateToken(typeof value === "string" ? value : undefined, label); }
  catch { throw new CliError("API_ERROR", `导出接口返回无效 ${label}`, { recovery }); }
  return value as string;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePause, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("已取消", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolvePause(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

interface RecoveryOptions {
  recoverAuth?: (auth: AuthInfo, error: CliError, signal: AbortSignal) => Promise<AuthInfo>;
}

async function userIdentity(auth: AuthInfo, signal: AbortSignal): Promise<string> {
  const response = await fetchWithAuth(auth, "/open-apis/authen/v1/user_info", { signal, retry: false });
  const data = object(response.data);
  if (typeof data.open_id !== "string" || !data.open_id || typeof data.tenant_key !== "string" || !data.tenant_key) {
    throw new CliError("AUTH_REQUIRED", "无法确认导出任务的用户身份", { recovery: "重新登录原用户后再运行导出" });
  }
  return JSON.stringify([data.open_id, data.tenant_key]);
}

export async function exportSheet(authInfo: AuthInfo, input: ExportInput, options: RecoveryOptions = {}): Promise<{ path: string; format: "xlsx"; size: number }> {
  validateToken(input.spreadsheetToken, "spreadsheet_token");
  if (!input.outputPath || (input.waitTimeoutMs !== undefined && (!Number.isSafeInteger(input.waitTimeoutMs) || input.waitTimeoutMs <= 0))) {
    throw new CliError("INVALID_ARGS", "需要输出路径和正整数等待时间", { recovery: "使用 --output <path.xlsx>" });
  }
  const path = resolve(input.outputPath);
  // lstat also refuses dangling symlinks. link below closes the check/publish race.
  try {
    await lstat(path);
    throw new CliError("INVALID_ARGS", "输出文件已存在", { recovery: "选择尚不存在的输出路径" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof CliError) throw error;
      throw new CliError("INVALID_ARGS", "无法检查输出路径", { recovery });
    }
  }
  let tempDir: string | undefined;
  let ticket: string | undefined;
  let currentAuth = authInfo;
  let identity: string | undefined;
  let authRecovered = false;
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  if (input.signal?.aborted) lifetime.abort();
  // Includes creation, polling, transfer retries and recovery. Polling has its own tighter limit.
  const lifetimeTimer = setTimeout(cancel, (input.waitTimeoutMs ?? 120_000) + 240_000);
  async function step<T>(operation: (auth: AuthInfo) => Promise<T>, signal: AbortSignal, canRetry: boolean): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try { return await operation(currentAuth); }
      catch (error) {
        signal.throwIfAborted();
        if (error instanceof CliError && ["SCOPE_MISSING", "TOKEN_EXPIRED"].includes(error.errorType) && options.recoverAuth && !authRecovered) {
          // POST can only be retried after an explicit scope rejection.
          if (!canRetry && error.errorType !== "SCOPE_MISSING") throw error;
          authRecovered = true;
          const next = await options.recoverAuth(currentAuth, error, signal);
          signal.throwIfAborted();
          if (next.mode !== authInfo.mode || next.appId !== authInfo.appId || next.useLark !== authInfo.useLark ||
              (next.mode === "user" && (!identity || await userIdentity(next, signal) !== identity))) {
            throw new CliError("AUTH_REQUIRED", "授权恢复后的身份与导出任务创建者不同", { recovery: "重新登录创建任务的原用户；不能用其他主体继续此任务" });
          }
          currentAuth = next;
          return step(operation, signal, canRetry);
        }
        const transient = error instanceof CliError ? error.retryable : error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
        if (!canRetry || !transient || attempt >= DEFAULT_RETRY.maxRetries) throw error;
        const delay = error instanceof CliError ? error.retryAfterMs : undefined;
        await pause(delay ?? calculateDelay(attempt, DEFAULT_RETRY.initialDelay, DEFAULT_RETRY.maxDelay), signal);
      }
    }
  }
  try {
    if (!(await stat(dirname(path))).isDirectory()) throw new CliError("INVALID_ARGS", "输出父路径不是目录", { recovery });
    tempDir = await mkdtemp(resolve(dirname(path), `.${basename(path)}.feishu-`));
    lifetime.signal.throwIfAborted();
    const createController = new AbortController();
    const cancelCreate = () => createController.abort();
    lifetime.signal.addEventListener("abort", cancelCreate, { once: true });
    const createTimer = setTimeout(cancelCreate, 30_000);
    let create;
    try {
      if (options.recoverAuth && authInfo.mode === "user") identity = await userIdentity(authInfo, createController.signal);
      create = await step(auth => fetchWithAuth(auth, "/open-apis/drive/v1/export_tasks", {
      method: "POST", retry: false, signal: createController.signal,
      body: { token: input.spreadsheetToken, type: "sheet", file_extension: "xlsx" },
      }), createController.signal, false);
    } finally {
      clearTimeout(createTimer);
      lifetime.signal.removeEventListener("abort", cancelCreate);
    }
    const taskTicket = responseToken(object(create.data).ticket, "ticket");
    ticket = taskTicket;
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.signal.addEventListener("abort", abort, { once: true });
    if (lifetime.signal.aborted) controller.abort();
    const timer = setTimeout(abort, input.waitTimeoutMs ?? 120_000);
    let result: Record<string, unknown>;
    try {
      while (true) {
        const response = await step(auth => fetchWithAuth(auth, `/open-apis/drive/v1/export_tasks/${encodeURIComponent(taskTicket)}`, {
          params: { token: input.spreadsheetToken }, retry: false, signal: controller.signal,
        }), controller.signal, true);
        result = object(object(response.data).result);
        const status = result.job_status;
        if (status === 0) break;
        if (status !== 1 && status !== 2) {
          throw new CliError((status === 109 || status === 110) ? "PERMISSION_DENIED" : (status === 111 || status === 123) ? "NOT_FOUND" : "API_ERROR",
            `导出任务 ${ticket} 失败，job_status=${String(status)}`, { recovery });
        }
        await pause(2000, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) throw new CliError("API_ERROR", `导出任务 ${ticket} 等待超时或已取消`, { recovery: "任务可能仍在服务器执行；检查表格后再决定是否创建新导出" });
      throw error;
    } finally {
      clearTimeout(timer);
      lifetime.signal.removeEventListener("abort", abort);
    }
    const fileToken = responseToken(result.file_token, "file_token");
    if (result.type !== "sheet" || result.file_extension !== "xlsx" || !Number.isSafeInteger(result.file_size) || (result.file_size as number) <= 0) {
      throw new CliError("API_ERROR", `导出任务 ${ticket} 返回无效文件信息`, { recovery });
    }
    const tempFile = resolve(tempDir, "download.xlsx");
    const size = await step(auth => fetchBinaryToFileWithAuth(auth,
      `/open-apis/drive/v1/export_tasks/file/${encodeURIComponent(fileToken)}/download`, tempFile,
      { expectedSize: result.file_size as number, signal: lifetime.signal }), lifetime.signal, true);
    lifetime.signal.throwIfAborted();
    await link(tempFile, path);
    return { path, format: "xlsx", size };
  } catch (error) {
    if (error instanceof CliError) throw new CliError(error.apiCode === 1069902 ? "PERMISSION_DENIED" : error.apiCode === 1069906 ? "NOT_FOUND" : error.errorType, error.message, {
      apiCode: error.apiCode, retryable: error.retryable, missingScopes: error.missingScopes, recovery: error.recovery ?? recovery,
    });
    throw new CliError("API_ERROR", ticket ? `导出任务 ${ticket} 下载或落盘失败` : "创建导出任务失败，结果可能不确定；未自动重试", { recovery });
  } finally {
    clearTimeout(lifetimeTimer);
    input.signal?.removeEventListener("abort", cancel);
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}
