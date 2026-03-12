/**
 * read command: Read a Feishu document and output as Markdown.
 */

import { createClient, fetchWithAuth, getTenantToken } from "../client.js";
import { blocksToMarkdown } from "../parser/blocks-to-md.js";
import { BlockType } from "../parser/block-types.js";
import { CliError } from "../utils/errors.js";
import { fetchAllBlocks } from "../services/doc-blocks.js";
import { getDocumentInfo } from "../services/block-writer.js";
import { resolveDocument } from "../utils/document-resolver.js";
import {
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

/**
 * Batch get temporary download URLs for file tokens (images, files).
 */
async function batchGetTmpUrls(
  authInfo: AuthInfo,
  fileTokens: string[],
): Promise<Map<string, string>> {
  if (fileTokens.length === 0) return new Map();

  const res = await fetchWithAuth(
    authInfo,
    "/open-apis/drive/v1/medias/batch_get_tmp_download_url",
    { params: { file_tokens: fileTokens } },
  );

  const urlMap = new Map<string, string>();
  const data = res?.data as Record<string, unknown> | undefined;
  const items = (data?.tmp_download_urls || []) as Array<
    Record<string, string>
  >;
  for (const item of items) {
    urlMap.set(item.file_token, item.tmp_download_url);
  }
  return urlMap;
}

/**
 * Extract file tokens from blocks (images, files).
 */
function extractFileTokens(blocks: Block[]): string[] {
  const tokens: string[] = [];
  for (const block of blocks) {
    if (block.block_type === BlockType.IMAGE && block.image?.token) {
      tokens.push(block.image.token);
    }
    if (block.block_type === BlockType.FILE && block.file?.token) {
      tokens.push(block.file.token);
    }
  }
  return tokens;
}

/**
 * Extract bitable tokens from blocks.
 */
function extractBitableTokens(blocks: Block[]): string[] {
  const tokens: string[] = [];
  for (const block of blocks) {
    if (block.block_type === BlockType.BITABLE && block.bitable?.token) {
      tokens.push(block.bitable.token);
    }
  }
  return tokens;
}

/**
 * Extract sheet tokens from blocks.
 */
function extractSheetTokens(blocks: Block[]): string[] {
  const tokens: string[] = [];
  for (const block of blocks) {
    if (block.block_type === BlockType.SHEET && block.sheet?.token) {
      tokens.push(block.sheet.token);
    }
  }
  return tokens;
}

/**
 * Extract board tokens from blocks.
 */
function extractBoardTokens(blocks: Block[]): string[] {
  const tokens: string[] = [];
  for (const block of blocks) {
    if (
      block.block_type === BlockType.BOARD &&
      (block.board as Record<string, unknown>)?.token
    ) {
      tokens.push((block.board as Record<string, string>).token);
    }
  }
  return tokens;
}

interface BitableData {
  fields: string[];
  records: string[][];
}

interface SheetData {
  fields: string[];
  records: string[][];
  title: string;
  truncated: boolean;
}

/**
 * Fetch bitable fields and records, return as renderable data.
 */
async function fetchBitableData(
  authInfo: AuthInfo,
  fullToken: string,
): Promise<BitableData | null> {
  const idx = fullToken.lastIndexOf("_tbl");
  if (idx === -1) {
    process.stderr.write(
      `feishu-docs: warning: 多维表格 token 格式无法解析: ${fullToken}\n`,
    );
    return null;
  }
  const appToken = fullToken.slice(0, idx);
  const tableId = fullToken.slice(idx + 1);

  const [fieldsRes, recordsRes] = await Promise.all([
    fetchWithAuth(
      authInfo,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      {},
    ),
    fetchWithAuth(
      authInfo,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      { params: { page_size: 100 } },
    ),
  ]);

  const fieldsData = fieldsRes.data as Record<string, unknown> | undefined;
  const recordsData = recordsRes.data as Record<string, unknown> | undefined;
  const fields = (
    (fieldsData?.items || []) as Array<Record<string, string>>
  ).map((f) => f.field_name);
  const records = (
    (recordsData?.items || []) as Array<Record<string, unknown>>
  ).map((r) => {
    return fields.map((name) => {
      const val = (r.fields as Record<string, unknown>)?.[name];
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  });

  return { fields, records };
}

/**
 * Fetch sheet metadata and cell values, return as renderable data.
 */
async function fetchSheetData(
  authInfo: AuthInfo,
  sheetToken: string,
): Promise<SheetData | null> {
  const metaRes = await fetchWithAuth(
    authInfo,
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(sheetToken)}/metainfo`,
    {},
  );
  const metaData = metaRes.data as Record<string, unknown> | undefined;
  const sheets = (metaData?.sheets || []) as Array<Record<string, string>>;
  if (sheets.length === 0) return null;

  const firstSheet = sheets[0];
  const sheetId = firstSheet.sheet_id;
  const title = firstSheet.title || "";

  const valuesRes = await fetchWithAuth(
    authInfo,
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(sheetToken)}/values/${encodeURIComponent(sheetId)}`,
    { params: { valueRenderOption: "ToString" } },
  );
  const valuesData = valuesRes.data as Record<string, unknown> | undefined;
  const rows = ((valuesData?.valueRange as Record<string, unknown>)?.values ||
    []) as unknown[][];
  if (rows.length === 0) return null;

  const maxRows = 101; // first row = header + 100 data rows
  const limitedRows = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
  const fields = (limitedRows[0] as unknown[]).map((cell) =>
    String(cell ?? ""),
  );
  const records = limitedRows
    .slice(1)
    .map((row) => fields.map((_, i) => String((row as unknown[])[i] ?? "")));

  return { fields, records, title, truncated: rows.length > maxRows };
}

/**
 * Fetch board node data and extract text content.
 */
async function fetchBoardData(
  authInfo: AuthInfo,
  boardToken: string,
): Promise<string[]> {
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/board/v1/whiteboards/${encodeURIComponent(boardToken)}/nodes`,
    {},
  );
  const boardResData = res.data as Record<string, unknown> | undefined;
  const nodes = (boardResData?.nodes || []) as Array<Record<string, unknown>>;

  // Extract text from shape nodes and connectors
  const textItems: string[] = [];
  for (const node of nodes) {
    if (node.type === "shape") {
      const shapeText = (node.shape as Record<string, unknown>)?.text as
        | Record<string, unknown[]>
        | undefined;
      if (shapeText?.data) {
        const texts = shapeText.data
          .map((d) => (d as Record<string, string>).text || "")
          .filter(Boolean);
        if (texts.length > 0) textItems.push(texts.join(""));
      }
    }
    if (node.type === "connector") {
      const connCaptions = (node.connector as Record<string, unknown>)
        ?.captions as Record<string, unknown[]> | undefined;
      if (connCaptions?.data) {
        const texts = connCaptions.data
          .map((d) => (d as Record<string, string>).text || "")
          .filter(Boolean);
        if (texts.length > 0) textItems.push(texts.join(""));
      }
    }
  }

  return textItems;
}

/**
 * Extract unique mention_user user_ids from blocks.
 */
function extractMentionUserIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    const elementSources = [
      block.text?.elements,
      block.heading1?.elements,
      block.heading2?.elements,
      block.heading3?.elements,
      block.heading4?.elements,
      block.heading5?.elements,
      block.heading6?.elements,
      block.heading7?.elements,
      block.heading8?.elements,
      block.heading9?.elements,
      block.bullet?.elements,
      block.ordered?.elements,
      block.todo?.elements,
      block.quote?.elements,
    ];
    for (const elements of elementSources) {
      if (!elements) continue;
      for (const el of elements) {
        if (el.mention_user?.user_id) {
          ids.add(el.mention_user.user_id);
        }
      }
    }
  }
  return [...ids];
}

/**
 * Batch resolve user IDs to display names.
 * Uses tenant_access_token + contact:user.base:readonly to get name fields.
 */
async function resolveUserNames(
  authInfo: AuthInfo,
  userIds: string[],
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();

  // Use tenant token for contact API (contact:user.base:readonly is app-identity permission)
  let tenantToken: string;
  try {
    tenantToken = await getTenantToken(authInfo);
  } catch {
    // Fallback: try authen API with user token for current user
    try {
      const self = await fetchWithAuth(
        authInfo,
        "/open-apis/authen/v1/user_info",
        {},
      );
      const selfData = self?.data as Record<string, unknown> | undefined;
      if (selfData?.open_id && selfData?.name) {
        nameMap.set(selfData.open_id as string, selfData.name as string);
      }
    } catch {
      // no way to resolve
    }
    return nameMap;
  }

  // Batch query users (up to 50 per request)
  const BATCH = 50;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    try {
      const params: Record<string, string | string[]> = {
        user_id_type: "open_id",
        user_ids: batch,
      };
      const tenantAuthInfo: AuthInfo = {
        ...authInfo,
        mode: "tenant" as const,
        tenantToken,
      };
      const res = await fetchWithAuth(
        tenantAuthInfo,
        "/open-apis/contact/v3/users/batch",
        { params },
      );
      const items = ((res?.data as Record<string, unknown>)?.user_list ||
        []) as Array<Record<string, string>>;
      for (const user of items) {
        if (user.open_id && user.name) {
          nameMap.set(user.open_id, user.name);
        }
      }
    } catch {
      // skip batch errors
    }
  }
  return nameMap;
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
  let documentId = doc.objToken;
  let docType = doc.objType;
  let docTitle = doc.title;

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

  // Non-docx types (sheet, bitable, board, etc.) — output placeholder
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
  const blocks = await fetchAllBlocks(authInfo, documentId);

  // --blocks mode: output raw JSON
  if (args.blocks) {
    process.stdout.write(JSON.stringify(blocks, null, 2) + "\n");
    return;
  }

  // Default: convert to Markdown
  // Batch resolve image/file URLs
  const fileTokens = extractFileTokens(blocks);
  let imageUrlMap = new Map<string, string>();
  if (fileTokens.length > 0) {
    try {
      imageUrlMap = await batchGetTmpUrls(authInfo, fileTokens);
    } catch {
      process.stderr.write(
        "feishu-docs: warning: 获取图片/文件链接失败，链接将为空\n",
      );
    }
  }

  // Batch resolve @mention user names
  let userNameMap = new Map<string, string>();
  const mentionUserIds = extractMentionUserIds(blocks);
  if (mentionUserIds.length > 0) {
    try {
      userNameMap = await resolveUserNames(authInfo, mentionUserIds);
    } catch {
      process.stderr.write("feishu-docs: warning: 解析 @用户 名称失败\n");
    }
  }

  // Batch resolve bitable data
  const bitableTokens = extractBitableTokens(blocks);
  const bitableDataMap = new Map<string, BitableData>();
  for (const token of bitableTokens) {
    try {
      const data = await fetchBitableData(authInfo, token);
      if (data) bitableDataMap.set(token, data);
    } catch {
      process.stderr.write(
        `feishu-docs: warning: 获取多维表格数据失败: ${token}\n`,
      );
    }
  }

  // Batch resolve board data
  const boardTokens = extractBoardTokens(blocks);
  const boardDataMap = new Map<string, string[]>();
  for (const token of boardTokens) {
    try {
      const data = await fetchBoardData(authInfo, token);
      if (data) boardDataMap.set(token, data);
    } catch {
      process.stderr.write(
        `feishu-docs: warning: 获取画板数据失败: ${token}\n`,
      );
    }
  }

  // Batch resolve sheet data
  const sheetTokens = extractSheetTokens(blocks);
  const sheetDataMap = new Map<string, SheetData>();
  for (const token of sheetTokens) {
    try {
      const data = await fetchSheetData(authInfo, token);
      if (data) sheetDataMap.set(token, data);
    } catch {
      process.stderr.write(
        `feishu-docs: warning: 获取电子表格数据失败: ${token}\n`,
      );
    }
  }

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
    imageUrlMap,
    userNameMap,
    bitableDataMap,
    boardDataMap,
    sheetDataMap,
  });
  process.stdout.write(output);
}
