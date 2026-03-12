/**
 * ls command: List files in a drive folder.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";

export const meta = {
  options: {
    type: { type: "string" },
    limit: { type: "string" },
  },
  positionals: true,
  handler: ls,
};

const TYPE_LABELS = {
  doc: "文档",
  docx: "新文档",
  sheet: "表格",
  bitable: "多维表格",
  mindnote: "思维导图",
  file: "文件",
  folder: "文件夹",
  slides: "幻灯片",
};

export async function ls(args, globalOpts) {
  const { authInfo } = await createClient(globalOpts);

  const folderToken = args.positionals[0] || undefined;
  const limit = args.limit ? Number(args.limit) : 50;

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new CliError("INVALID_ARGS", "--limit 必须是 1-1000 之间的整数");
  }

  if (args.type) {
    const ALLOWED_TYPES = new Set(Object.keys(TYPE_LABELS));
    if (!ALLOWED_TYPES.has(args.type)) {
      throw new CliError(
        "INVALID_ARGS",
        `无效的文件类型: ${args.type}。可选值: ${[...ALLOWED_TYPES].join(", ")}`,
      );
    }
  }

  const params = {
    page_size: Math.min(limit, 50),
    ...(folderToken && { folder_token: folderToken }),
    ...(args.type && { type: args.type }),
  };

  const items = [];
  let pageToken;

  do {
    if (pageToken) params.page_token = pageToken;

    const res = await fetchWithAuth(authInfo, "/open-apis/drive/v1/files", {
      params,
    });

    if (res?.data?.files) {
      items.push(...res.data.files);
    }
    pageToken = res?.data?.has_more ? res.data.next_page_token : undefined;
  } while (pageToken && items.length < limit);

  const trimmed = items.slice(0, limit);

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
}
