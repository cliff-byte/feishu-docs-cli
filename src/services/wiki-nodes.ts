/**
 * Shared wiki node helpers.
 */

import { fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import type { AuthInfo, WikiNode } from "../types/index.js";
import type {
  WikiChildrenResponse,
  WikiGetNodeResponse,
} from "../types/api-responses.js";

export interface ResolvedWikiNode {
  objToken: string;
  objType: string;
  title: string;
  nodeToken: string;
  spaceId: string;
  hasChild: boolean;
}

/**
 * Fetch child nodes of a parent node (or space root).
 */
export async function fetchChildren(
  authInfo: AuthInfo,
  spaceId: string,
  parentNodeToken?: string,
): Promise<WikiNode[]> {
  const nodes: WikiNode[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string | number | undefined> = {
      page_size: 50,
      ...(pageToken && { page_token: pageToken }),
      ...(parentNodeToken && { parent_node_token: parentNodeToken }),
    };

    const res = await fetchWithAuth<WikiChildrenResponse>(
      authInfo,
      `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
      { params },
    );

    const data = res.data;
    if (data?.items) {
      nodes.push(...data.items);
    }
    pageToken = data?.has_more ? data.page_token : undefined;
  } while (pageToken);

  return nodes;
}

/**
 * Resolve wiki token to actual document token + type.
 */
export async function resolveWikiToken(
  authInfo: AuthInfo,
  wikiToken: string,
): Promise<ResolvedWikiNode> {
  const res = await fetchWithAuth<WikiGetNodeResponse>(
    authInfo,
    "/open-apis/wiki/v2/spaces/get_node",
    { params: { token: wikiToken, obj_type: "wiki" } },
  );

  const node = res.data?.node;
  if (!node) {
    throw new CliError("NOT_FOUND", `知识库节点不存在: ${wikiToken}`);
  }

  return {
    objToken: node.obj_token ?? "",
    objType: node.obj_type ?? "",
    title: node.title ?? "",
    nodeToken: node.node_token ?? "",
    spaceId: node.space_id ?? "",
    hasChild: node.has_child || false,
  };
}
