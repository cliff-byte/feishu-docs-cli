/**
 * Shared document block fetching.
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { apiCall, withAuth } from "../client.js";
import { AuthInfo, Block } from "../types/index.js";

/**
 * Fetch all blocks for a document.
 */
export async function fetchAllBlocks(
  client: lark.Client,
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
      blocks.push(...(res.data.items as Block[]));
    }
    pageToken = res?.data?.has_more
      ? (res.data.page_token as string)
      : undefined;
  } while (pageToken);

  return blocks;
}
