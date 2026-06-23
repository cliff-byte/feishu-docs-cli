/**
 * Convert Markdown to Feishu blocks via server-side Convert API,
 * then write to document via Descendant API.
 *
 * This replaces the local md-to-blocks parser + multi-step block-writer
 * table assembly with just 2 API calls:
 *   1. Convert API: Markdown string -> block tree (server-side parsing)
 *   2. Descendant API: Write entire block tree in one call (no 9-row table limit)
 *
 * Notes:
 *   - Descendant API accepts at most 1000 blocks per call; large content is
 *     automatically split into batches at top-level block boundaries.
 *   - Read-only fields returned by Convert API (parent_id, comment_ids,
 *     merge_info) are stripped before writing to avoid validation errors.
 */

import { fetchWithAuth } from "../client.js";
import { BlockType } from "../parser/block-types.js";
import {
  replaceDocumentImages,
  uploadDocumentImage,
} from "./doc-media-upload.js";
import {
  LocalMarkdownImage,
  prepareMarkdownLocalImages,
} from "./markdown-local-images.js";
import { CliError } from "../utils/errors.js";
import { sleep } from "../utils/retry.js";
import {
  AuthInfo,
  ConvertedBlocks,
  Block,
  BlockIdRelation,
} from "../types/index.js";

/** Maximum blocks the Descendant API accepts per call. */
const MAX_BLOCKS_PER_CALL = 1000;
const MEDIA_UPLOAD_DELAY_MS = 250;

/**
 * Language aliases that Feishu Convert API does not recognize.
 * Maps unrecognized names → recognized names so code blocks render correctly.
 */
const LANG_ALIASES: Record<string, string> = {
  "objective-c": "objc",
  "obj-c": "objc",
};

/**
 * Normalize code-fence language names in markdown before sending to Convert API.
 * Replaces unrecognized aliases with their recognized equivalents.
 */
export function normalizeLangNames(markdown: string): string {
  return markdown.replace(/^(```)([\w+#.-]+)/gm, (match, fence, lang) => {
    const alias = LANG_ALIASES[lang.toLowerCase()];
    return alias ? fence + alias : match;
  });
}

/**
 * Extract the first top-level heading (# title) from markdown.
 *
 * Returns the title text and the remaining body with the heading line removed.
 * Only matches `# heading` (H1), not `## heading` (H2+).
 * Ignores leading blank lines before the heading.
 * If no H1 heading is found, returns null title and the original markdown.
 */
export function extractMarkdownTitle(markdown: string): {
  title: string | null;
  body: string;
} {
  const lines = markdown.split("\n");
  let headingIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    // Match exactly one # followed by space (H1 only, not ##)
    const match = trimmed.match(/^#\s+(.+)$/);
    if (match) {
      headingIndex = i;
    }
    break; // Only check the first non-empty line
  }

  if (headingIndex === -1) {
    return { title: null, body: markdown };
  }

  const title = lines[headingIndex].trim().replace(/^#\s+/, "");
  const remaining = [
    ...lines.slice(0, headingIndex),
    ...lines.slice(headingIndex + 1),
  ];

  // Remove leading blank lines left after title extraction
  let startIdx = 0;
  while (startIdx < remaining.length && remaining[startIdx].trim() === "") {
    startIdx++;
  }
  const body = remaining.slice(startIdx).join("\n");

  return { title, body };
}

/**
 * Replace literal `\n` with `<br>` inside mermaid code blocks.
 *
 * Claude and other AI tools generate mermaid node labels with `\n` for
 * line breaks (e.g. `A[Line 1\nLine 2]`), but standard mermaid syntax
 * requires `<br>` (e.g. `A[Line 1<br>Line 2]`).
 */
export function normalizeMermaidLineBreaks(markdown: string): string {
  return markdown.replace(
    /^```mermaid\s*\n([\s\S]*?)^```/gm,
    (_match, block: string) => {
      const fixed = block.replace(/\\n/g, "<br>");
      return "```mermaid\n" + fixed + "```";
    },
  );
}

/**
 * Convert markdown string to Feishu block array via Convert API.
 * Requires scope: docx:document.block:convert
 *
 * @returns {{ blocks: Array, firstLevelBlockIds: string[], blockIdToImageUrls: Object }}
 */
export async function convertMarkdown(
  authInfo: AuthInfo,
  markdown: string,
): Promise<ConvertedBlocks> {
  const res = await fetchWithAuth(
    authInfo,
    "/open-apis/docx/v1/documents/blocks/convert",
    {
      method: "POST",
      body: {
        content: normalizeMermaidLineBreaks(normalizeLangNames(markdown)),
        content_type: "markdown",
      },
    },
  );

  const data = res?.data as Record<string, unknown> | undefined;
  if (!data?.blocks || !data?.first_level_block_ids) {
    throw new CliError("API_ERROR", "Convert API 返回数据格式不正确");
  }

  return {
    blocks: data.blocks as Block[],
    firstLevelBlockIds: data.first_level_block_ids as string[],
    blockIdToImageUrls:
      (data.block_id_to_image_urls as Record<string, string>) || {},
  };
}

/**
 * Read-only / server-generated fields that the Descendant API rejects.
 * These are returned by the Convert API but must not be sent back.
 */
const READ_ONLY_BLOCK_FIELDS = ["parent_id", "comment_ids"] as const;

/**
 * Sanitize blocks for the Descendant API by removing read-only fields.
 *
 * Strips:
 *  - top-level read-only fields: parent_id, comment_ids
 *  - table.property.merge_info (read-only attribute)
 *
 * Returns a new array (immutable).
 */
export function sanitizeBlocks(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    let cleaned: Block = block;

    // Strip top-level read-only fields
    for (const field of READ_ONLY_BLOCK_FIELDS) {
      if (field in cleaned) {
        const { [field]: _, ...rest } = cleaned;
        cleaned = rest as Block;
      }
    }

    // Strip table.property.merge_info
    if (cleaned.table?.property?.merge_info) {
      const { merge_info, ...restProperty } = cleaned.table.property;
      cleaned = {
        ...cleaned,
        table: { ...cleaned.table, property: restProperty },
      };
    }

    return cleaned;
  });
}

/**
 * Set every table block's first row as a header row (`header_row = true`),
 * mirroring the "设置为标题行" action in the Feishu UI. The Convert API leaves
 * `header_row` undefined for tables parsed from Markdown, so the first row
 * renders as a plain data row; this opts every table into a header row.
 *
 * Returns a new array; inputs are not mutated. Non-table blocks, and tables
 * with no `property` or already-headered tables, pass through unchanged.
 */
export function applyTableHeaderRow(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    if ((block as { block_type?: number }).block_type !== BlockType.TABLE) {
      return block;
    }
    const table = block.table;
    if (!table?.property || table.property.header_row === true) {
      return block;
    }
    return {
      ...block,
      table: {
        ...table,
        property: { ...table.property, header_row: true },
      },
    };
  });
}

/** Minimum column width the Feishu API accepts (pixels). */
const MIN_COLUMN_WIDTH = 50;

/**
 * Default target total table width (pixels). The Convert API emits a 732px
 * total regardless of content, which is narrower than the docx default page
 * width's content area (~815px measured); 815 fills it. Column widths are
 * absolute pixels, so this targets a typical default-page-width window and does
 * not track window resizes or the "较宽/全宽" page-width modes — override per
 * call via the tableWidth option (`--table-width`) for those.
 */
export const DEFAULT_TABLE_WIDTH = 815;

/**
 * Pixel estimate per half-width display unit (a CJK char is 2 units) and the
 * horizontal padding inside a cell. Rough constants used only to size columns
 * to their content; they don't need to match Feishu's font metrics exactly.
 */
const PX_PER_UNIT = 8;
const CELL_PADDING = 20;

/** A single column may take at most this fraction of the target width. */
const MAX_COLUMN_RATIO = 0.6;

/** Display width of a string: CJK/fullwidth chars count as 2, others as 1. */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    width += isWideChar(cp) ? 2 : 1;
  }
  return width;
}

function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana..CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  );
}

/** Plain text of a table cell: concatenate text of its child text blocks. */
function cellText(cellId: string, byId: Map<string, Block>): string {
  const cell = byId.get(cellId);
  const children = (cell as { children?: string[] } | undefined)?.children ?? [];
  let text = "";
  for (const childId of children) {
    const elements = byId.get(childId)?.text?.elements;
    if (!elements) continue;
    for (const element of elements) {
      text += element.text_run?.content ?? "";
    }
  }
  return text;
}

/**
 * Compute column widths from per-column content `units` (half-width char = 1,
 * CJK char = 2).
 *
 * Each column first gets a "natural" width from its content, clamped to
 * [MIN_COLUMN_WIDTH, MAX_COLUMN_RATIO × target] so a short column never gets
 * stretched and one long/outlier column can't dominate. Then:
 *  - if the natural widths fit within `target`, they're used as-is — a small
 *    table stays compact instead of being stretched to fill the page width;
 *  - otherwise they're scaled down proportionally to exactly fill `target`,
 *    with the rounding remainder absorbed by the widest column.
 */
function computeColumnWidths(units: number[], target: number): number[] {
  const maxCol = Math.round(target * MAX_COLUMN_RATIO);
  const natural = units.map((u) =>
    Math.min(maxCol, Math.max(MIN_COLUMN_WIDTH, u * PX_PER_UNIT + CELL_PADDING)),
  );
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= target) return natural;

  const scaled = natural.map((n) =>
    Math.max(MIN_COLUMN_WIDTH, Math.round((n * target) / sum)),
  );
  const diff = target - scaled.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const widest = natural.indexOf(Math.max(...natural));
    if (scaled[widest] + diff >= MIN_COLUMN_WIDTH) scaled[widest] += diff;
  }
  return scaled;
}

/**
 * Re-fit each table's column widths to its content, mimicking the "列宽自适应"
 * action in the Feishu UI. The Convert API splits a fixed 732px total evenly
 * across columns regardless of content. This sizes each column to its content
 * instead (see computeColumnWidths): short columns stay narrow, a long/outlier
 * column is capped, content-heavy tables are scaled to fill `targetWidth`, and
 * small tables stay compact rather than being stretched across the page.
 *
 * Returns a new array; inputs are not mutated. Tables without a `column_width`
 * baseline or with no cell text pass through unchanged. Like the UI action,
 * this is a one-time fit at write time — it does not track later edits, and
 * because column widths are absolute pixels it cannot track window resizes.
 */
export function applyTableColumnWidth(
  blocks: Block[],
  targetWidth: number = DEFAULT_TABLE_WIDTH,
): Block[] {
  const byId = new Map<string, Block>();
  for (const block of blocks) {
    const id = (block as { block_id?: string }).block_id;
    if (id) byId.set(id, block);
  }

  return blocks.map((block) => {
    if ((block as { block_type?: number }).block_type !== BlockType.TABLE) {
      return block;
    }
    const table = block.table;
    const widths = table?.property?.column_width;
    if (!table?.property || !widths?.length || !table.cells?.length) {
      return block;
    }

    const colCount = widths.length;
    const perColumn = new Array(colCount).fill(0);
    table.cells.forEach((cellId, i) => {
      const col = i % colCount;
      const w = displayWidth(cellText(cellId, byId));
      if (w > perColumn[col]) perColumn[col] = w;
    });
    if (perColumn.every((w) => w === 0)) return block;

    const next = computeColumnWidths(perColumn, targetWidth);
    if (next.every((v, i) => v === widths[i])) return block;

    return {
      ...block,
      table: {
        ...table,
        property: { ...table.property, column_width: next },
      },
    };
  });
}

function readBlockPlainText(block: Block): string | null {
  const elements = block.text?.elements;
  if (!elements || elements.length === 0) return null;

  let text = "";
  for (const element of elements) {
    if (!element.text_run?.content) return null;
    text += element.text_run.content;
  }
  return text;
}

interface LocalImageBlock {
  blockId: string;
  alt: string;
  originalPath: string;
  resolvedPath: string;
  lineNumber: number;
}

function replacePlaceholderBlocksWithImageShells(
  converted: ConvertedBlocks,
  images: LocalMarkdownImage[],
): {
  converted: ConvertedBlocks;
  imageBlocks: LocalImageBlock[];
} {
  if (images.length === 0) {
    return { converted, imageBlocks: [] };
  }

  const placeholders = new Map(images.map((image) => [image.placeholder, image]));
  let replacedCount = 0;
  const matchedPlaceholders = new Set<string>();
  const imageBlocks: LocalImageBlock[] = [];

  const blocks = converted.blocks.map((block) => {
    const placeholder = readBlockPlainText(block);
    const image = placeholder ? placeholders.get(placeholder) : undefined;
    if (!image) return block;

    replacedCount++;
    matchedPlaceholders.add(image.placeholder);
    imageBlocks.push({
      blockId: block.block_id,
      alt: image.alt,
      originalPath: image.originalPath,
      resolvedPath: image.resolvedPath,
      lineNumber: image.lineNumber,
    });
    return {
      block_id: block.block_id,
      block_type: BlockType.IMAGE,
      ...(block.parent_id && { parent_id: block.parent_id }),
      children: [],
      image: {},
    };
  });

  if (replacedCount !== images.length) {
    const missing = images
      .filter((image) => !matchedPlaceholders.has(image.placeholder))
      .map((image) => `${image.originalPath} (line ${image.lineNumber})`);
    throw new CliError(
      "API_ERROR",
      `本地图片占位替换失败: ${missing.join(", ")}`,
      {
        recovery: "请确保本地图片单独占一行，格式为 ![alt](./path/image.png)",
      },
    );
  }

  return {
    converted: {
      ...converted,
      blocks,
    },
    imageBlocks,
  };
}

/**
 * Collect all descendant block IDs reachable from a set of top-level IDs.
 * Traverses the children tree in the block array.
 */
function collectDescendantIds(
  topLevelIds: string[],
  blockMap: Map<string, Block>,
): Set<string> {
  const ids = new Set<string>();
  const queue = [...topLevelIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    const block = blockMap.get(id);
    if (block?.children) {
      queue.push(...block.children);
    }
  }
  return ids;
}

/**
 * Build a ConvertedBlocks batch from a subset of blocks.
 * Filters blockIdToImageUrls to only include entries for blocks in this batch.
 */
function buildBatch(
  topIds: string[],
  blockIds: Set<string>,
  allBlocks: Block[],
  source: ConvertedBlocks,
): ConvertedBlocks {
  const imageUrls = Object.fromEntries(
    Object.entries(source.blockIdToImageUrls).filter(([id]) =>
      blockIds.has(id),
    ),
  );
  return {
    firstLevelBlockIds: topIds,
    blocks: allBlocks.filter((b) => blockIds.has(b.block_id)),
    blockIdToImageUrls: imageUrls,
  };
}

/**
 * Split converted blocks into batches that each stay within
 * MAX_BLOCKS_PER_CALL. Splits at top-level block boundaries so
 * parent–child relationships are preserved within each batch.
 */
export function splitIntoBatches(
  converted: ConvertedBlocks,
): ConvertedBlocks[] {
  const allBlocks = sanitizeBlocks(converted.blocks);

  if (allBlocks.length <= MAX_BLOCKS_PER_CALL) {
    return [{ ...converted, blocks: allBlocks }];
  }

  const blockMap = new Map(allBlocks.map((b) => [b.block_id, b]));
  const batches: ConvertedBlocks[] = [];

  let batchTopIds: string[] = [];
  let batchBlockCount = 0;

  for (const topId of converted.firstLevelBlockIds) {
    const descendantIds = collectDescendantIds([topId], blockMap);
    const subtreeSize = descendantIds.size;

    // A single top-level subtree that exceeds the limit cannot be split further
    if (subtreeSize > MAX_BLOCKS_PER_CALL) {
      throw new CliError(
        "API_ERROR",
        `单个顶层块的后代数量 (${subtreeSize}) 超过 Descendant API 限制 (${MAX_BLOCKS_PER_CALL})，无法拆分`,
      );
    }

    // If adding this top-level block would exceed the limit, flush current batch
    if (
      batchBlockCount > 0 &&
      batchBlockCount + subtreeSize > MAX_BLOCKS_PER_CALL
    ) {
      const batchIds = collectDescendantIds(batchTopIds, blockMap);
      batches.push(buildBatch(batchTopIds, batchIds, allBlocks, converted));
      batchTopIds = [];
      batchBlockCount = 0;
    }

    batchTopIds.push(topId);
    batchBlockCount += subtreeSize;
  }

  // Flush remaining
  if (batchTopIds.length > 0) {
    const batchIds = collectDescendantIds(batchTopIds, blockMap);
    batches.push(buildBatch(batchTopIds, batchIds, allBlocks, converted));
  }

  return batches;
}

/**
 * Write blocks to document via Descendant API.
 * Automatically batches when block count exceeds 1000.
 *
 * @param {object} authInfo - Auth credentials
 * @param {string} documentId - Target document ID
 * @param {string} parentBlockId - Parent block (usually same as documentId for top-level)
 * @param {object} converted - Output from convertMarkdown()
 * @param {number} revisionId - Document revision ID
 * @param {number} index - Insert position (0 = beginning, -1 = append to end)
 * @returns {number} Updated revision ID
 */
async function writeDescendantDetailed(
  authInfo: AuthInfo,
  documentId: string,
  parentBlockId: string,
  converted: ConvertedBlocks,
  revisionId: number,
  index: number = 0,
): Promise<{
  revisionId: number;
  blockIdRelations: BlockIdRelation[];
}> {
  const batches = splitIntoBatches(converted);

  if (batches.length > 1) {
    process.stderr.write(
      `feishu-docs: info: 内容较大 (${converted.blocks.length} blocks)，分 ${batches.length} 批写入\n`,
    );
  }

  let rev = revisionId;
  const allRelations: BlockIdRelation[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    // First batch uses caller-specified index; subsequent batches append
    const batchIndex = i === 0 ? index : -1;

    const res = await fetchWithAuth(
      authInfo,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/descendant`,
      {
        method: "POST",
        body: {
          children_id: batch.firstLevelBlockIds,
          descendants: batch.blocks,
          index: batchIndex,
        },
        params: {
          document_revision_id: rev,
        },
      },
    );

    const data = (res?.data as Record<string, unknown>) || {};
    rev = (data.document_revision_id as number) ?? rev;
    const relations = data.block_id_relations as BlockIdRelation[] | undefined;
    if (Array.isArray(relations)) {
      allRelations.push(...relations);
    }
  }

  return {
    revisionId: rev,
    blockIdRelations: allRelations,
  };
}

export async function writeDescendant(
  authInfo: AuthInfo,
  documentId: string,
  parentBlockId: string,
  converted: ConvertedBlocks,
  revisionId: number,
  index: number = 0,
): Promise<number> {
  const result = await writeDescendantDetailed(
    authInfo,
    documentId,
    parentBlockId,
    converted,
    revisionId,
    index,
  );
  return result.revisionId;
}

/**
 * High-level: Convert markdown and write to document in 2 API calls.
 *
 * @param {object} authInfo - Auth credentials
 * @param {string} documentId - Target document ID
 * @param {string} markdown - Raw Markdown content
 * @param {number} revisionId - Current document revision ID
 * @param {number} index - Insert position (0 = beginning, -1 = append)
 * @returns {number} Updated revision ID
 */
export async function convertAndWrite(
  authInfo: AuthInfo,
  documentId: string,
  markdown: string,
  revisionId: number,
  index: number = 0,
): Promise<number> {
  const converted = await convertMarkdown(authInfo, markdown);
  return writeDescendant(
    authInfo,
    documentId,
    documentId,
    converted,
    revisionId,
    index,
  );
}

export async function convertAndWriteWithLocalImages(
  authInfo: AuthInfo,
  documentId: string,
  markdown: string,
  revisionId: number,
  options: {
    sourceDir?: string;
    sourcePath?: string;
    /** Set each table's first row as a header row. Defaults to true. */
    tableHeaderRow?: boolean;
    /** Re-fit each table's column widths to its content. Defaults to true. */
    tableColumnWidth?: boolean;
    /** Target total table width in pixels (defaults to DEFAULT_TABLE_WIDTH). */
    tableWidth?: number;
  } = {},
  index: number = 0,
): Promise<number> {
  const prepared = await prepareMarkdownLocalImages(markdown, options);
  const converted = await convertMarkdown(authInfo, prepared.markdown);
  let blocks = converted.blocks;
  if (options.tableHeaderRow !== false) blocks = applyTableHeaderRow(blocks);
  if (options.tableColumnWidth !== false) {
    blocks = applyTableColumnWidth(blocks, options.tableWidth);
  }
  const headered =
    blocks === converted.blocks ? converted : { ...converted, blocks };
  const withImages = replacePlaceholderBlocksWithImageShells(
    headered,
    prepared.images,
  );
  const writeResult = await writeDescendantDetailed(
    authInfo,
    documentId,
    documentId,
    withImages.converted,
    revisionId,
    index,
  );

  if (withImages.imageBlocks.length === 0) {
    return writeResult.revisionId;
  }

  const relationMap = new Map(
    writeResult.blockIdRelations.map((relation) => [
      relation.temporary_block_id,
      relation.block_id,
    ]),
  );
  const uploads: Array<{ blockId: string; fileToken: string }> = [];
  for (const image of withImages.imageBlocks) {
    const actualBlockId = relationMap.get(image.blockId);
    if (!actualBlockId) {
      throw new CliError(
        "API_ERROR",
        `未找到图片块 ID 映射: ${image.originalPath}`,
      );
    }
    const fileToken = await uploadDocumentImage(
      authInfo,
      actualBlockId,
      image.resolvedPath,
    );
    uploads.push({
      blockId: actualBlockId,
      fileToken,
    });
    if (uploads.length < withImages.imageBlocks.length) {
      await sleep(MEDIA_UPLOAD_DELAY_MS);
    }
  }

  return replaceDocumentImages(
    authInfo,
    documentId,
    uploads,
    writeResult.revisionId,
  );
}
