/**
 * Fetch server-rendered Lark-flavored Markdown for a document.
 */

import { fetchWithAuth } from "../client.js";
import { renderSheetDataMarkdown } from "../parser/blocks-to-md.js";
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

function warnInvalidSheetTag(): void {
  process.stderr.write(
    "feishu-docs: warning: 无法解析嵌入式电子表格标签，保留原标签；请确认标签包含合法的 token 和 sheet-id 属性\n",
  );
}

function parseSheetToken(attributes: string): string | undefined {
  const spreadsheetToken = getAttribute(attributes, "token");
  const sheetId = getAttribute(attributes, "sheet-id");
  if (!spreadsheetToken || !sheetId) {
    warnInvalidSheetTag();
    return undefined;
  }

  try {
    validateToken(spreadsheetToken, "spreadsheet_token");
    validateToken(sheetId, "sheet_id");
  } catch {
    warnInvalidSheetTag();
    return undefined;
  }
  return `${spreadsheetToken}_${sheetId}`;
}

async function fetchSheetMarkdown(
  authInfo: AuthInfo,
  sheetToken: string,
): Promise<string | null> {
  try {
    const data = await fetchSheetData(authInfo, sheetToken);
    if (!data?.fields.length) {
      process.stderr.write(
        `feishu-docs: warning: 电子表格未返回可渲染数据: ${sheetToken}；请确认工作表非空且标签指向正确工作表\n`,
      );
      return null;
    }
    return renderSheetDataMarkdown(data);
  } catch (err) {
    const recovery =
      err instanceof CliError && err.recovery
        ? `；${err.recovery}`
        : "；请确认当前身份可以读取该电子表格";
    process.stderr.write(
      `feishu-docs: warning: 获取电子表格数据失败: ${sheetToken} (${(err as Error).message})${recovery}\n`,
    );
    return null;
  }
}

async function enrichSheetTags(
  authInfo: AuthInfo,
  markdown: string,
): Promise<string> {
  const tags = [...markdown.matchAll(SHEET_TAG_RE)];
  if (tags.length === 0) return markdown;

  const limit = pLimit(5);
  const sheetTokens = tags.map((tag) => parseSheetToken(tag[1]));
  const uniqueSheetTokens = [
    ...new Set(sheetTokens.filter((token): token is string => !!token)),
  ];
  const sheetMarkdown = await Promise.all(
    uniqueSheetTokens.map((sheetToken) =>
      limit(() => fetchSheetMarkdown(authInfo, sheetToken)),
    ),
  );
  const sheetMarkdownByToken = new Map(
    uniqueSheetTokens.map((sheetToken, index) => [
      sheetToken,
      sheetMarkdown[index],
    ]),
  );

  const replacements = sheetTokens.map(
    (sheetToken, index) =>
      (sheetToken && sheetMarkdownByToken.get(sheetToken)) || tags[index][0],
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
