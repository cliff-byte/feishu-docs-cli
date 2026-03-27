/**
 * Shared document block fetching.
 */

import { fetchWithAuth } from "../client.js";
import type { AuthInfo, Block } from "../types/index.js";
import type { DocxBlocksResponse } from "../types/api-responses.js";

/**
 * Fetch all blocks for a document.
 */
export async function fetchAllBlocks(
  authInfo: AuthInfo,
  documentId: string,
): Promise<Block[]> {
  const blocks: Block[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string | number | undefined> = {
      document_revision_id: -1,
      page_size: 500,
      ...(pageToken && { page_token: pageToken }),
    };

    const res = await fetchWithAuth<DocxBlocksResponse>(
      authInfo,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
      { params },
    );

    const data = res.data;
    if (data?.items) {
      blocks.push(...data.items);
    }
    pageToken = data?.has_more ? data.page_token : undefined;
  } while (pageToken);

  return blocks;
}
