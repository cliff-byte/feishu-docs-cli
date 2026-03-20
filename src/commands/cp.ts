/**
 * cp command: Copy a file to a different folder in cloud drive.
 *
 * The copy API requires a name. If --name is not provided,
 * the original document title is fetched and " - 副本" is appended.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { FEATURE_SCOPE_GROUPS } from "../scopes.js";
import { ensureScopes } from "../utils/scope-prompt.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { validateToken } from "../utils/validate.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

export const meta: CommandMeta = {
  options: {
    name: { type: "string" },
  },
  positionals: true,
  handler: cp,
};

export async function cp(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  const targetFolder = args.positionals![1];
  if (!input || !targetFolder) {
    throw new CliError(
      "INVALID_ARGS",
      '用法: feishu-docs cp <url|token> <target_folder_token> [--name "副本名称"]',
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

  // Determine copy name: use --name if provided, otherwise fetch original title
  let copyName = args.name as string | undefined;
  if (!copyName) {
    let title = doc.title;
    if (!title) {
      // Fetch title via document API for non-wiki documents
      try {
        const docRes = await fetchWithAuth(
          authInfo,
          `/open-apis/docx/v1/documents/${encodeURIComponent(fileToken)}`,
        );
        title = (docRes?.data as Record<string, unknown>)?.document
          ? ((docRes.data as Record<string, Record<string, string>>).document
              .title as string)
          : undefined;
      } catch {
        // Non-critical: fall back to token-based name
      }
    }
    copyName = title ? `${title} - 副本` : `${fileToken} - 副本`;
  }

  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/copy`,
    {
      method: "POST",
      body: { type, name: copyName, folder_token: targetFolder },
    },
  );

  const resData = res?.data as Record<string, unknown> | undefined;
  const newFile = resData?.file as Record<string, string> | undefined;
  const newToken = newFile?.token || "";

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        file_token: newToken,
        name: copyName,
        folder_token: targetFolder,
      }) + "\n",
    );
  } else {
    process.stdout.write(
      `已复制为 "${copyName}" (${newToken}) 到文件夹 ${targetFolder}\n`,
    );
  }
}
