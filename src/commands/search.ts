/**
 * search command: Search knowledge base documents.
 * Uses /open-apis/suite/docs-api/search/object which requires user_access_token.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { loadTokens } from "../auth.js";
import { CliError } from "../utils/errors.js";
import {
  FEATURE_SCOPE_GROUPS,
  getMissingScopes,
  buildScopeHint,
} from "../scopes.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

const DOC_TYPE_MAP: Record<string, string> = {
  doc: "文档",
  docx: "新文档",
  sheet: "表格",
  bitable: "多维表格",
  mindnote: "思维导图",
  file: "文件",
  slides: "幻灯片",
  wiki: "知识库页面",
};

export const meta: CommandMeta = {
  options: {
    type: { type: "string" },
    limit: { type: "string" },
  },
  positionals: true,
  handler: search,
};

export async function search(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const query = args.positionals![0];
  if (!query) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少搜索关键词。用法: feishu-docs search <query> [--type <type>] [--limit <n>]",
    );
  }

  const { authInfo } = await createClient(globalOpts);

  // Pre-flight scope check for search (needs admin-reviewed scope)
  if (authInfo.mode === "user") {
    const stored = await loadTokens();
    if (stored) {
      const required = [...FEATURE_SCOPE_GROUPS.search.scopes];
      const missing = getMissingScopes(stored.tokens.scope, required);
      if (missing.length > 0) {
        throw new CliError("AUTH_REQUIRED", buildScopeHint(missing));
      }
    }
  }

  if (authInfo.mode === "tenant") {
    throw new CliError(
      "AUTH_REQUIRED",
      "search 命令需要 user 身份。tenant 模式下无搜索能力",
      {
        recovery:
          "运行 feishu-docs login 切换到 user 身份，或设置 FEISHU_USER_TOKEN 环境变量",
      },
    );
  }

  const limit = args.limit ? Number(args.limit) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("INVALID_ARGS", "--limit 必须是 1-200 之间的整数");
  }
  const docType = (args.type as string | undefined) || undefined;

  const results: unknown[] = [];
  let offset = 0;
  const pageSize = Math.min(limit, 50);

  while (results.length < limit) {
    const body: Record<string, unknown> = {
      search_key: query,
      count: pageSize,
      offset,
    };
    if (docType) body.docs_types = [docType];

    const res = await fetchWithAuth(
      authInfo,
      "/open-apis/suite/docs-api/search/object",
      { method: "POST", body },
    );

    const resData = res?.data as Record<string, unknown> | undefined;
    const items = (resData?.docs_entities || []) as unknown[];
    results.push(...items);

    if (!resData?.has_more || items.length === 0) break;
    offset += items.length;
  }

  const trimmed = results.slice(0, limit) as Array<Record<string, string>>;

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          success: true,
          query,
          count: trimmed.length,
          items: trimmed.map((item) => ({
            title: item.title,
            token: item.docs_token,
            obj_type: item.docs_type,
            owner_id: item.owner_id,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (trimmed.length === 0) {
    process.stdout.write(`没有找到与 "${query}" 相关的文档\n`);
    return;
  }

  process.stdout.write(`搜索 "${query}" — 找到 ${trimmed.length} 条结果\n\n`);

  for (const item of trimmed) {
    const title = item.title || "(无标题)";
    const type = DOC_TYPE_MAP[item.docs_type] || item.docs_type || "unknown";
    const token = item.docs_token || "";
    process.stdout.write(`  ${title}  [${type}]  ${token}\n`);
  }
}
