/**
 * read command: Read a Feishu document and output as Markdown.
 */

import {
  createClient,
  withAuth,
  apiCall,
  fetchWithAuth,
  getTenantToken,
} from "../client.js";
import { blocksToMarkdown } from "../parser/blocks-to-md.js";
import { BlockType } from "../parser/block-types.js";
import { CliError } from "../utils/errors.js";
import { fetchAllBlocks } from "../services/doc-blocks.js";
import { getDocumentInfo } from "../services/block-writer.js";
import { resolveDocument } from "../utils/document-resolver.js";

/**
 * Fetch raw text content of a document.
 */
async function fetchRawContent(client, authInfo, documentId) {
  const res = await apiCall(() =>
    client.docx.v1.document.rawContent(
      {
        path: { document_id: documentId },
      },
      withAuth(authInfo),
    ),
  );
  return res?.data?.content || "";
}

/**
 * Batch get temporary download URLs for file tokens (images, files).
 */
async function batchGetTmpUrls(client, authInfo, fileTokens) {
  if (fileTokens.length === 0) return new Map();

  const res = await apiCall(() =>
    client.drive.v1.media.batchGetTmpDownloadUrl(
      {
        params: { file_tokens: fileTokens.join(",") },
      },
      withAuth(authInfo),
    ),
  );

  const urlMap = new Map();
  const items = res?.data?.tmp_download_urls || [];
  for (const item of items) {
    urlMap.set(item.file_token, item.tmp_download_url);
  }
  return urlMap;
}

/**
 * Extract file tokens from blocks (images, files).
 */
function extractFileTokens(blocks) {
  const tokens = [];
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
function extractBitableTokens(blocks) {
  const tokens = [];
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
function extractSheetTokens(blocks) {
  const tokens = [];
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
function extractBoardTokens(blocks) {
  const tokens = [];
  for (const block of blocks) {
    if (block.block_type === BlockType.BOARD && block.board?.token) {
      tokens.push(block.board.token);
    }
  }
  return tokens;
}

/**
 * Fetch bitable fields and records, return as renderable data.
 */
async function fetchBitableData(authInfo, fullToken) {
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

  const fields = (fieldsRes.data?.items || []).map((f) => f.field_name);
  const records = (recordsRes.data?.items || []).map((r) => {
    return fields.map((name) => {
      const val = r.fields?.[name];
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
async function fetchSheetData(authInfo, sheetToken) {
  const metaRes = await fetchWithAuth(
    authInfo,
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(sheetToken)}/metainfo`,
    {},
  );
  const sheets = metaRes.data?.sheets || [];
  if (sheets.length === 0) return null;

  const firstSheet = sheets[0];
  const sheetId = firstSheet.sheet_id;
  const title = firstSheet.title || "";

  const valuesRes = await fetchWithAuth(
    authInfo,
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(sheetToken)}/values/${encodeURIComponent(sheetId)}`,
    { params: { valueRenderOption: "ToString" } },
  );
  const rows = valuesRes.data?.valueRange?.values || [];
  if (rows.length === 0) return null;

  const maxRows = 101; // first row = header + 100 data rows
  const limitedRows = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
  const fields = limitedRows[0].map((cell) => String(cell ?? ""));
  const records = limitedRows
    .slice(1)
    .map((row) => fields.map((_, i) => String(row[i] ?? "")));

  return { fields, records, title, truncated: rows.length > maxRows };
}

/**
 * Fetch board node data and extract text content.
 */
async function fetchBoardData(authInfo, boardToken) {
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/board/v1/whiteboards/${encodeURIComponent(boardToken)}/nodes`,
    {},
  );
  const nodes = res.data?.nodes || [];

  // Extract text from shape nodes and connectors
  const textItems = [];
  for (const node of nodes) {
    if (node.type === "shape" && node.shape?.text?.data) {
      const texts = node.shape.text.data
        .map((d) => d.text || "")
        .filter(Boolean);
      if (texts.length > 0) textItems.push(texts.join(""));
    }
    if (node.type === "connector" && node.connector?.captions?.data) {
      const texts = node.connector.captions.data
        .map((d) => d.text || "")
        .filter(Boolean);
      if (texts.length > 0) textItems.push(texts.join(""));
    }
  }

  return textItems;
}

/**
 * Extract unique mention_user user_ids from blocks.
 */
function extractMentionUserIds(blocks) {
  const ids = new Set();
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
async function resolveUserNames(authInfo, userIds) {
  const nameMap = new Map();

  // Use tenant token for contact API (contact:user.base:readonly is app-identity permission)
  let tenantToken;
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
      if (self?.data?.open_id && self?.data?.name) {
        nameMap.set(self.data.open_id, self.data.name);
      }
    } catch {
      // no way to resolve
    }
    return nameMap;
  }

  const base = authInfo.useLark
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";

  // Batch query users (up to 50 per request)
  const BATCH = 50;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    try {
      const params = new URLSearchParams({ user_id_type: "open_id" });
      for (const id of batch) {
        params.append("user_ids", id);
      }
      const res = await fetch(
        `${base}/open-apis/contact/v3/users/batch?${params.toString()}`,
        { headers: { Authorization: `Bearer ${tenantToken}` } },
      );
      const body = await res.json();
      const items = body?.data?.user_list || [];
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

export const meta = {
  options: {
    raw: { type: "boolean", default: false },
    blocks: { type: "boolean", default: false },
    "with-meta": { type: "boolean", default: false },
  },
  positionals: true,
  handler: read,
};

export async function read(args, globalOpts) {
  const input = args.positionals[0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs read <url|token>",
    );
  }

  const { client, authInfo } = await createClient(globalOpts);
  const doc = await resolveDocument(client, authInfo, input);
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
    const content = await fetchRawContent(client, authInfo, documentId);
    process.stdout.write(content + "\n");
    return;
  }

  // Fetch all blocks
  const blocks = await fetchAllBlocks(client, authInfo, documentId);

  // --blocks mode: output raw JSON
  if (args.blocks) {
    process.stdout.write(JSON.stringify(blocks, null, 2) + "\n");
    return;
  }

  // Default: convert to Markdown
  // Batch resolve image/file URLs
  const fileTokens = extractFileTokens(blocks);
  let imageUrlMap = new Map();
  if (fileTokens.length > 0) {
    try {
      imageUrlMap = await batchGetTmpUrls(client, authInfo, fileTokens);
    } catch {
      process.stderr.write(
        "feishu-docs: warning: 获取图片/文件链接失败，链接将为空\n",
      );
    }
  }

  // Batch resolve @mention user names
  let userNameMap = new Map();
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
  const bitableDataMap = new Map();
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
  const boardDataMap = new Map();
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
  const sheetDataMap = new Map();
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
    let meta = {};
    try {
      meta = await getDocumentInfo(client, authInfo, documentId);
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
