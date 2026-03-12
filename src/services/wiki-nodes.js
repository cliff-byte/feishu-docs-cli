/**
 * Shared wiki node helpers.
 */

import { apiCall, withAuth, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";

/**
 * Fetch child nodes of a parent node (or space root).
 */
export async function fetchChildren(authInfo, spaceId, parentNodeToken) {
  const nodes = [];
  let pageToken;

  do {
    const params = {
      page_size: 50,
      ...(pageToken && { page_token: pageToken }),
      ...(parentNodeToken && { parent_node_token: parentNodeToken }),
    };

    const res = await fetchWithAuth(
      authInfo,
      `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
      { params },
    );

    if (res?.data?.items) {
      nodes.push(...res.data.items);
    }
    pageToken = res?.data?.has_more ? res.data.page_token : undefined;
  } while (pageToken);

  return nodes;
}

/**
 * Resolve wiki token to actual document token + type.
 */
export async function resolveWikiToken(client, authInfo, wikiToken) {
  const res = await apiCall(() =>
    client.wiki.v2.space.getNode(
      {
        params: { token: wikiToken, obj_type: "wiki" },
      },
      withAuth(authInfo),
    ),
  );

  const node = res?.data?.node;
  if (!node) {
    throw new CliError("NOT_FOUND", `知识库节点不存在: ${wikiToken}`);
  }

  return {
    objToken: node.obj_token,
    objType: node.obj_type,
    title: node.title,
    nodeToken: node.node_token,
    spaceId: node.space_id,
    hasChild: node.has_child || false,
  };
}
