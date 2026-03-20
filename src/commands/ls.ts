/**
 * ls command: List files in a drive folder.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import { withScopeRecovery } from "../utils/scope-prompt.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

export const meta: CommandMeta = {
  options: {
    type: { type: "string" },
    limit: { type: "string" },
  },
  positionals: true,
  handler: ls,
};

const TYPE_LABELS: Record<string, string> = {
  doc: "文档",
  docx: "新文档",
  sheet: "表格",
  bitable: "多维表格",
  mindnote: "思维导图",
  file: "文件",
  folder: "文件夹",
  slides: "幻灯片",
};

export async function ls(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const folderToken = (args.positionals![0] as string | undefined) || undefined;
  if (folderToken) validateToken(folderToken, "folder_token");
  const limit = args.limit ? Number(args.limit) : 50;

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new CliError("INVALID_ARGS", "--limit 必须是 1-1000 之间的整数");
  }

  if (args.type) {
    const ALLOWED_TYPES = new Set(Object.keys(TYPE_LABELS));
    if (!ALLOWED_TYPES.has(args.type as string)) {
      throw new CliError(
        "INVALID_ARGS",
        `无效的文件类型: ${args.type}。可选值: ${[...ALLOWED_TYPES].join(", ")}`,
      );
    }
  }

  return withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);

    const typeStr = args.type as string | undefined;
    const params: Record<string, string | number | undefined> = {
      page_size: Math.min(limit, 50),
      ...(folderToken && { folder_token: folderToken }),
      ...(typeStr && { type: typeStr }),
    };

    const items: unknown[] = [];
    let pageToken: string | undefined;

    do {
      if (pageToken) params.page_token = pageToken;

      const res = await fetchWithAuth(authInfo, "/open-apis/drive/v1/files", {
        params,
      });

      const data = res?.data as Record<string, unknown> | undefined;
      if (data?.files) {
        items.push(...(data.files as unknown[]));
      }
      pageToken = data?.has_more ? (data.next_page_token as string) : undefined;
    } while (pageToken && items.length < limit);

    const trimmed = items.slice(0, limit) as Array<Record<string, string>>;

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify(
          { success: true, count: trimmed.length, files: trimmed },
          null,
          2,
        ) + "\n",
      );
      return;
    }

    if (trimmed.length === 0) {
      process.stdout.write("文件夹为空\n");
      return;
    }

    for (const f of trimmed) {
      const name = f.name || "(未命名)";
      const type = TYPE_LABELS[f.type] || f.type || "unknown";
      const token = f.token || "";
      process.stdout.write(`  ${name}  [${type}]  ${token}\n`);
    }
  }, globalOpts);
}
