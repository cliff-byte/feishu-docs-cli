/**
 * mv command: Move a file to a different folder in cloud drive.
 *
 * The Feishu move API is asynchronous — it returns a task_id which
 * must be polled via taskCheck until completion.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { FEATURE_SCOPE_GROUPS } from "../scopes.js";
import { ensureScopes } from "../utils/scope-prompt.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { validateToken } from "../utils/validate.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

export const meta: CommandMeta = {
  options: {},
  positionals: true,
  handler: mv,
};

export async function mv(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  const targetFolder = args.positionals![1];
  if (!input || !targetFolder) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs mv <url|token> <target_folder_token>",
    );
  }

  validateToken(targetFolder, "target_folder_token");

  const { authInfo: rawAuthInfo } = await createClient(globalOpts);
  const authInfo = await ensureScopes(
    rawAuthInfo,
    FEATURE_SCOPE_GROUPS.drive.scopes,
    globalOpts,
  );

  const doc = await resolveDocument(authInfo, input);
  const fileToken = doc.objToken;
  const type = doc.objType;

  const moveRes = await fetchWithAuth(
    authInfo,
    `/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/move`,
    {
      method: "POST",
      body: { type, folder_token: targetFolder },
    },
  );

  const taskId = (moveRes?.data as Record<string, unknown>)
    ?.task_id as string;

  if (!taskId) {
    throw new CliError("API_ERROR", "移动操作未返回 task_id");
  }

  // Poll until complete
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const checkRes = await fetchWithAuth(
      authInfo,
      `/open-apis/drive/v1/files/task_check`,
      { params: { task_id: taskId } },
    );

    const status = (checkRes?.data as Record<string, unknown>)
      ?.status as string;
    if (status === "success") {
      if (globalOpts.json) {
        process.stdout.write(
          JSON.stringify({
            success: true,
            file_token: fileToken,
            folder_token: targetFolder,
          }) + "\n",
        );
      } else {
        process.stdout.write(
          `已移动 ${fileToken} 到文件夹 ${targetFolder}\n`,
        );
      }
      return;
    }

    if (status === "fail") {
      throw new CliError("API_ERROR", "移动操作失败");
    }
  }

  throw new CliError(
    "API_ERROR",
    `移动操作超时（${POLL_TIMEOUT_MS / 1000}秒），task_id: ${taskId}`,
    { retryable: true },
  );
}
