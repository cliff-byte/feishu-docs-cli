/**
 * read command: Read a Feishu document and output as Markdown.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { blocksToMarkdown } from "../parser/blocks-to-md.js";
import { CliError } from "../utils/errors.js";
import { fetchAllBlocks } from "../services/doc-blocks.js";
import { getDocumentInfo } from "../services/block-writer.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { enrichBlocks } from "../services/doc-enrichment.js";
import type {
  CommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
  Block,
} from "../types/index.js";

/**
 * Fetch raw text content of a document.
 */
async function fetchRawContent(
  authInfo: AuthInfo,
  documentId: string,
): Promise<string> {
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
  );
  return ((res?.data as Record<string, unknown>)?.content as string) || "";
}

export const meta: CommandMeta = {
  options: {
    raw: { type: "boolean", default: false },
    blocks: { type: "boolean", default: false },
    "with-meta": { type: "boolean", default: false },
  },
  positionals: true,
  handler: read,
};

export async function read(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs read <url|token>",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  const doc = await resolveDocument(authInfo, input);
  const documentId = doc.objToken;
  const docType = doc.objType;
  const docTitle = doc.title;

  if (
    (doc.parsed.type === "wiki" || doc.parsed.type === "unknown") &&
    docType !== "docx" &&
    doc.title !== undefined
  ) {
    const msg = docTitle
      ? `[${docType}: ${docTitle} (${documentId})]`
      : `[${docType}: ${documentId}]`;
    process.stdout.write(msg + "\n");
    return;
  }

  if (docType === "doc") {
    throw new CliError(
      "INVALID_ARGS",
      "不支持旧版 doc 格式，请在飞书中升级为 docx",
    );
  }

  // Non-docx types (sheet, bitable, board, etc.) -- output placeholder
  if (docType !== "docx") {
    process.stdout.write(`[${docType}: ${documentId}]\n`);
    return;
  }

  // --raw mode: fetch raw text only
  if (args.raw) {
    const content = await fetchRawContent(authInfo, documentId);
    process.stdout.write(content + "\n");
    return;
  }

  // Fetch all blocks
  let blocks: Block[];
  try {
    blocks = await fetchAllBlocks(authInfo, documentId);
  } catch (err) {
    if (
      err instanceof CliError &&
      (err.errorType === "PERMISSION_DENIED" ||
        err.errorType === "SCOPE_MISSING")
    ) {
      throw new CliError(
        "PERMISSION_DENIED",
        "读取文档内容权限不足。可能原因:\n" +
          "  1. 应用未在飞书开发者后台开通 docx:document 权限 → 请前往 https://open.feishu.cn/app 开通\n" +
          "  2. 文档未对当前用户/应用开放访问 → 请联系文档拥有者授权\n" +
          '开通权限后，运行 feishu-docs authorize --scope "docx:document" 重新授权',
      );
    }
    throw err;
  }

  // --blocks mode: output raw JSON
  if (args.blocks) {
    process.stdout.write(JSON.stringify(blocks, null, 2) + "\n");
    return;
  }

  // Default: convert to Markdown with enrichment
  const enrichment = await enrichBlocks(authInfo, blocks, globalOpts);

  // Add metadata header if requested
  let output = "";
  if (args.withMeta) {
    let meta: Record<string, unknown> = {};
    try {
      meta = await getDocumentInfo(authInfo, documentId);
    } catch {
      // ignore metadata fetch errors
    }
    output += "---\n";
    if (docTitle || meta.title) output += `title: ${docTitle || meta.title}\n`;
    if (meta.revisionId) output += `revision: ${meta.revisionId}\n`;
    output += `token: ${documentId}\n`;
    output += "---\n\n";
  }

  output += blocksToMarkdown(blocks, {
    imageUrlMap: enrichment.imageUrlMap,
    userNameMap: enrichment.userNameMap,
    bitableDataMap: enrichment.bitableDataMap,
    boardImageMap: enrichment.boardImageMap,
    sheetDataMap: enrichment.sheetDataMap,
  });
  process.stdout.write(output);
}
