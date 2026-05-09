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
  } = {},
  index: number = 0,
): Promise<number> {
  const prepared = await prepareMarkdownLocalImages(markdown, options);
  const converted = await convertMarkdown(authInfo, prepared.markdown);
  const withImages = replacePlaceholderBlocksWithImageShells(
    converted,
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
