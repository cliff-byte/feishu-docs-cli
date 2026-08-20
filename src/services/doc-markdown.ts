/**
 * Fetch server-rendered Lark-flavored Markdown for a document.
 */

import { fetchWithAuth } from "../client.js";
import type { AuthInfo } from "../types/index.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";

interface DocsAiMarkdownResponse {
  document?: { content?: string };
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
  return content;
}
