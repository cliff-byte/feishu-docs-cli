/**
 * Convert Markdown to Feishu blocks via server-side Convert API,
 * then write to document via Descendant API.
 *
 * This replaces the local md-to-blocks parser + multi-step block-writer
 * table assembly with just 2 API calls:
 *   1. Convert API: Markdown string -> block tree (server-side parsing)
 *   2. Descendant API: Write entire block tree in one call (no 9-row table limit)
 */

import { fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { AuthInfo, ConvertedBlocks, Block } from "../types/index.js";

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
      body: { content: normalizeLangNames(markdown), content_type: "markdown" },
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
 * Strip merge_info from table blocks to prevent Descendant API errors.
 * Returns a new array (immutable).
 */
export function stripMergeInfo(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    if (block.table?.property?.merge_info) {
      const { merge_info, ...restProperty } = block.table.property;
      return {
        ...block,
        table: { ...block.table, property: restProperty },
      };
    }
    return block;
  });
}

/**
 * Write blocks to document via Descendant API.
 * Supports up to 1000 blocks per call, no table row limit.
 *
 * @param {object} authInfo - Auth credentials
 * @param {string} documentId - Target document ID
 * @param {string} parentBlockId - Parent block (usually same as documentId for top-level)
 * @param {object} converted - Output from convertMarkdown()
 * @param {number} revisionId - Document revision ID
 * @param {number} index - Insert position (0 = beginning, -1 = append to end)
 * @returns {number} Updated revision ID
 */
export async function writeDescendant(
  authInfo: AuthInfo,
  documentId: string,
  parentBlockId: string,
  converted: ConvertedBlocks,
  revisionId: number,
  index: number = 0,
): Promise<number> {
  const cleanBlocks = stripMergeInfo(converted.blocks);

  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/descendant`,
    {
      method: "POST",
      body: {
        children_id: converted.firstLevelBlockIds,
        descendants: cleanBlocks,
        index,
      },
      params: {
        document_revision_id: revisionId,
      },
    },
  );

  return (
    ((res?.data as Record<string, unknown>)?.document_revision_id as number) ??
    revisionId
  );
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
