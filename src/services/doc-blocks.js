/**
 * Shared document block fetching.
 */

import { apiCall, withAuth } from "../client.js";

/**
 * Fetch all blocks for a document.
 */
export async function fetchAllBlocks(client, authInfo, documentId) {
  const blocks = [];
  let pageToken;

  do {
    const params = {
      document_revision_id: -1,
      page_size: 500,
      ...(pageToken && { page_token: pageToken }),
    };

    const res = await apiCall(() =>
      client.docx.v1.documentBlock.list(
        {
          path: { document_id: documentId },
          params,
        },
        withAuth(authInfo),
      ),
    );

    if (res?.data?.items) {
      blocks.push(...res.data.items);
    }
    pageToken = res?.data?.has_more ? res.data.page_token : undefined;
  } while (pageToken);

  return blocks;
}
