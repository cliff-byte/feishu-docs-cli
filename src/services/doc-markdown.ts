/**
 * Fetch server-rendered Lark-flavored Markdown for a document.
 */

import { fetchWithAuth } from "../client.js";
import { sheetDataToMarkdown } from "../parser/blocks-to-md.js";
import type { AuthInfo } from "../types/index.js";
import { CliError } from "../utils/errors.js";
import { pLimit } from "../utils/concurrency.js";
import { validateToken } from "../utils/validate.js";
import { fetchSheetData } from "./doc-enrichment.js";

interface DocsAiMarkdownResponse {
  document?: { content?: string };
}

const SHEET_TAG_RE = /<sheet\b([^>]*?)(?:\/>|>\s*<\/sheet>)/g;

function getAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([^"']+)\\1`),
  )?.[2];
}

async function enrichSheetTags(
  authInfo: AuthInfo,
  markdown: string,
): Promise<string> {
  const tags = [...markdown.matchAll(SHEET_TAG_RE)];
  if (tags.length === 0) return markdown;

  const limit = pLimit(5);
  const sheets = new Map<string, Promise<string | null>>();
  const keys = tags.map((tag) => {
    const spreadsheetToken = getAttribute(tag[1], "token");
    const sheetId = getAttribute(tag[1], "sheet-id");
    if (!spreadsheetToken || !sheetId) {
      process.stderr.write(
        "feishu-docs: warning: 无法解析嵌入式电子表格标签，保留原标签\n",
      );
      return undefined;
    }

    try {
      validateToken(spreadsheetToken, "spreadsheet_token");
      validateToken(sheetId, "sheet_id");
    } catch {
      process.stderr.write(
        "feishu-docs: warning: 无法解析嵌入式电子表格标签，保留原标签\n",
      );
      return undefined;
    }

    const key = `${spreadsheetToken}_${sheetId}`;
    if (!sheets.has(key)) {
      sheets.set(
        key,
        limit(async () => {
          try {
            const data = await fetchSheetData(authInfo, key);
            return data?.fields.length ? sheetDataToMarkdown(data) : null;
          } catch (err) {
            const recovery =
              err instanceof CliError && err.recovery
                ? `；${err.recovery}`
                : "；请确认当前身份可以读取该电子表格";
            process.stderr.write(
              `feishu-docs: warning: 获取电子表格数据失败: ${key} (${(err as Error).message})${recovery}\n`,
            );
            return null;
          }
        }),
      );
    }
    return key;
  });

  const replacements = await Promise.all(
    keys.map(async (key, index) =>
      key ? (await sheets.get(key)!) || tags[index][0] : tags[index][0],
    ),
  );
  let index = 0;
  return markdown.replace(SHEET_TAG_RE, () => replacements[index++]);
}

export async function fetchDocumentMarkdown(
  authInfo: AuthInfo,
  documentId: string,
): Promise<string> {
  validateToken(documentId, "document_id");
  const res = await fetchWithAuth<DocsAiMarkdownResponse>(
    authInfo,
    `/open-apis/docs_ai/v1/documents/${encodeURIComponent(documentId)}/fetch`,
    { method: "POST", body: { format: "markdown" } },
  );
  const content = res.data?.document?.content;
  if (typeof content !== "string") {
    throw new CliError("API_ERROR", "docs_ai 未返回 Markdown 内容", {
      recovery: "重试读取，或使用 --blocks 获取原始文档块",
    });
  }
  return enrichSheetTags(authInfo, content);
}
