/**
 * Document enrichment service.
 *
 * Extracts and resolves embedded content from document blocks:
 * images, bitable tables, spreadsheets, whiteboards, and @mentions.
 * All enrichment runs in parallel with a configurable concurrency limit.
 */

import {
  createClient,
  fetchWithAuth,
  fetchBinaryWithAuth,
  getTenantToken,
} from "../client.js";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockType } from "../parser/block-types.js";
import { CliError } from "../utils/errors.js";
import { withScopeRecovery } from "../utils/scope-prompt.js";
import { downloadImages } from "./image-download.js";
import { pLimit } from "../utils/concurrency.js";
import type { AuthInfo, GlobalOpts, Block } from "../types/index.js";

// ── Types ──

export interface EnrichmentOptions {
  images?: boolean;
  bitable?: boolean;
  sheet?: boolean;
  board?: boolean;
  mentions?: boolean;
  concurrency?: number;
}

export interface BitableData {
  fields: string[];
  records: string[][];
}

export interface SheetData {
  fields: string[];
  records: string[][];
  title: string;
  truncated: boolean;
}

export interface EnrichmentResult {
  imageUrlMap: Map<string, string>;
  userNameMap: Map<string, string>;
  bitableDataMap: Map<string, BitableData>;
  boardImageMap: Map<string, string>;
  sheetDataMap: Map<string, SheetData>;
}

// ── Constants ──

const TMP_URL_BATCH_SIZE = 5;

// ── Token extraction helpers (internal) ──

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

function extractBitableTokens(blocks: Block[]): string[] {
  const tokens: string[] = [];
  for (const block of blocks) {
    if (block.block_type === BlockType.BITABLE && block.bitable?.token) {
      tokens.push(block.bitable.token);
    }
  }
  return tokens;
}

function extractSheetTokens(blocks: Block[]): string[] {
  const tokens: string[] = [];
  for (const block of blocks) {
    if (block.block_type === BlockType.SHEET && block.sheet?.token) {
      tokens.push(block.sheet.token);
    }
  }
  return tokens;
}

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

// ── Data fetching functions (exported for testing) ──

/**
 * Batch get temporary download URLs for file tokens (images, files).
 * The API accepts at most 5 file_tokens per request, so larger sets
 * are split into chunks automatically.
 */
async function batchGetTmpUrls(
  authInfo: AuthInfo,
  fileTokens: string[],
): Promise<Map<string, string>> {
  if (fileTokens.length === 0) return new Map();

  const urlMap = new Map<string, string>();
  for (let i = 0; i < fileTokens.length; i += TMP_URL_BATCH_SIZE) {
    const chunk = fileTokens.slice(i, i + TMP_URL_BATCH_SIZE);
    const res = await fetchWithAuth(
      authInfo,
      "/open-apis/drive/v1/medias/batch_get_tmp_download_url",
      { params: { file_tokens: chunk } },
    );
    const data = res?.data as Record<string, unknown> | undefined;
    const items = (data?.tmp_download_urls || []) as Array<
      Record<string, string>
    >;
    for (const item of items) {
      urlMap.set(item.file_token, item.tmp_download_url);
    }
  }
  return urlMap;
}

/**
 * Fetch bitable fields and records, return as renderable data.
 */
export async function fetchBitableData(
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
export async function fetchSheetData(
  authInfo: AuthInfo,
  sheetToken: string,
): Promise<SheetData | null> {
  // Sheet tokens embedded in docs have format: {spreadsheetToken}_{sheetId}
  // The sheets API needs just the spreadsheet token; sheetId selects the tab.
  const underscoreIdx = sheetToken.lastIndexOf("_");
  const spreadsheetToken =
    underscoreIdx > 0 ? sheetToken.slice(0, underscoreIdx) : sheetToken;
  const embeddedSheetId =
    underscoreIdx > 0 ? sheetToken.slice(underscoreIdx + 1) : undefined;

  const metaRes = await fetchWithAuth(
    authInfo,
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/metainfo`,
    {},
  );
  const metaData = metaRes.data as Record<string, unknown> | undefined;
  const sheets = (metaData?.sheets || []) as Array<Record<string, string>>;
  if (sheets.length === 0) return null;

  // Prefer the embedded sheet id; fall back to first sheet
  // Note: metainfo API returns camelCase field names (sheetId, not sheet_id)
  const targetSheet = embeddedSheetId
    ? sheets.find((s) => s.sheetId === embeddedSheetId) || sheets[0]
    : sheets[0];
  const sheetId = targetSheet.sheetId;
  // Suppress title when it equals sheetId (default meaningless title)
  const rawTitle = targetSheet.title || "";
  const title = rawTitle === sheetId ? "" : rawTitle;

  const valuesRes = await fetchWithAuth(
    authInfo,
    `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(sheetId)}`,
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
 * Download board/whiteboard as image and save to temp file.
 * Returns the local file path, or null on failure.
 */
export async function fetchBoardImage(
  authInfo: AuthInfo,
  boardToken: string,
): Promise<string | null> {
  const buf = await fetchBinaryWithAuth(
    authInfo,
    `/open-apis/board/v1/whiteboards/${encodeURIComponent(boardToken)}/download_as_image`,
  );
  if (buf.byteLength === 0) return null;

  const dir = join(tmpdir(), "feishu-docs");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `board-${boardToken}.png`);
  await writeFile(filePath, Buffer.from(buf));
  return filePath;
}

/**
 * Batch resolve user IDs to display names.
 * Uses tenant_access_token + contact:user.base:readonly to get name fields.
 */
export async function resolveUserNames(
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

// ── Resolve image URLs (images + download) ──

async function resolveImageUrls(
  authInfo: AuthInfo,
  blocks: Block[],
  globalOpts: GlobalOpts,
): Promise<Map<string, string>> {
  const fileTokens = extractFileTokens(blocks);
  if (fileTokens.length === 0) return new Map();

  const tmpUrlMap = await withScopeRecovery(
    async () => {
      const { authInfo: freshAuth } = await createClient(globalOpts);
      return batchGetTmpUrls(freshAuth, fileTokens);
    },
    globalOpts,
    ["drive:drive"],
  );
  return downloadImages(tmpUrlMap);
}

// ── Main entry point ──

/**
 * Enrich document blocks with embedded content data.
 *
 * Resolves images, bitable tables, spreadsheets, board images,
 * and @mention user names in parallel with concurrency control.
 *
 * @param authInfo - Authentication context
 * @param blocks - Document blocks to enrich
 * @param globalOpts - Global CLI options
 * @param options - Control which enrichments to run and concurrency
 * @returns Enrichment maps for blocksToMarkdown rendering
 */
export async function enrichBlocks(
  authInfo: AuthInfo,
  blocks: Block[],
  globalOpts: GlobalOpts,
  options: EnrichmentOptions = {},
): Promise<EnrichmentResult> {
  const opts = {
    images: options.images ?? true,
    bitable: options.bitable ?? true,
    sheet: options.sheet ?? true,
    board: options.board ?? true,
    mentions: options.mentions ?? true,
    concurrency: options.concurrency ?? 5,
  };

  const limit = pLimit(opts.concurrency);
  const result: EnrichmentResult = {
    imageUrlMap: new Map(),
    userNameMap: new Map(),
    bitableDataMap: new Map(),
    boardImageMap: new Map(),
    sheetDataMap: new Map(),
  };

  const tasks: Promise<void>[] = [];

  // Image enrichment
  if (opts.images) {
    const fileTokens = extractFileTokens(blocks);
    if (fileTokens.length > 0) {
      tasks.push(limit(async () => {
        try {
          const map = await resolveImageUrls(authInfo, blocks, globalOpts);
          for (const [k, v] of map) result.imageUrlMap.set(k, v);
        } catch {
          process.stderr.write(
            "feishu-docs: warning: 获取图片/文件链接失败，链接将为空\n",
          );
        }
      }));
    }
  }

  // Mention enrichment
  if (opts.mentions) {
    const mentionUserIds = extractMentionUserIds(blocks);
    if (mentionUserIds.length > 0) {
      tasks.push(limit(async () => {
        try {
          const map = await resolveUserNames(authInfo, mentionUserIds);
          for (const [k, v] of map) result.userNameMap.set(k, v);
        } catch {
          process.stderr.write("feishu-docs: warning: 解析 @用户 名称失败\n");
        }
      }));
    }
  }

  // Bitable enrichment
  if (opts.bitable) {
    const bitableTokens = extractBitableTokens(blocks);
    for (const token of bitableTokens) {
      tasks.push(limit(async () => {
        try {
          const data = await fetchBitableData(authInfo, token);
          if (data) result.bitableDataMap.set(token, data);
        } catch (err) {
          if (
            err instanceof CliError &&
            (err.errorType === "PERMISSION_DENIED" ||
              err.errorType === "SCOPE_MISSING")
          ) {
            process.stderr.write(
              `feishu-docs: warning: 获取多维表格数据权限不足: ${token}\n` +
                '  请在飞书开发者后台开通权限后运行 feishu-docs authorize --scope "bitable:app:readonly"\n',
            );
          } else {
            process.stderr.write(
              `feishu-docs: warning: 获取多维表格数据失败: ${token}\n`,
            );
          }
        }
      }));
    }
  }

  // Board enrichment
  if (opts.board) {
    const boardTokens = extractBoardTokens(blocks);
    for (const token of boardTokens) {
      tasks.push(limit(async () => {
        try {
          const filePath = await fetchBoardImage(authInfo, token);
          if (filePath) result.boardImageMap.set(token, filePath);
        } catch (err) {
          if (
            err instanceof CliError &&
            (err.errorType === "PERMISSION_DENIED" ||
              err.errorType === "SCOPE_MISSING")
          ) {
            process.stderr.write(
              `feishu-docs: warning: 获取画板图片权限不足: ${token}\n` +
                '  请在飞书开发者后台开通权限后运行 feishu-docs authorize --scope "board:whiteboard:node:read"\n',
            );
          } else {
            process.stderr.write(
              `feishu-docs: warning: 获取画板图片失败: ${token}\n`,
            );
          }
        }
      }));
    }
  }

  // Sheet enrichment
  if (opts.sheet) {
    const sheetTokens = extractSheetTokens(blocks);
    for (const token of sheetTokens) {
      tasks.push(limit(async () => {
        try {
          const data = await fetchSheetData(authInfo, token);
          if (data) result.sheetDataMap.set(token, data);
        } catch (err) {
          if (
            err instanceof CliError &&
            (err.errorType === "PERMISSION_DENIED" ||
              err.errorType === "SCOPE_MISSING")
          ) {
            process.stderr.write(
              `feishu-docs: warning: 获取电子表格数据权限不足: ${token}\n` +
                '  请在飞书开发者后台开通权限后运行 feishu-docs authorize --scope "sheets:spreadsheet:readonly"\n',
            );
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(
              `feishu-docs: warning: 获取电子表格数据失败: ${token} (${msg})\n`,
            );
          }
        }
      }));
    }
  }

  await Promise.allSettled(tasks);
  return result;
}
