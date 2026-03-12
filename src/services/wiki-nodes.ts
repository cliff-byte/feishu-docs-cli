/**
 * Shared wiki node helpers.
 */

import { fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { AuthInfo, WikiNode } from "../types/index.js";

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

    const res = await fetchWithAuth(
      authInfo,
      `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
      { params },
    );

    const data = res?.data as Record<string, unknown> | undefined;
    if (data?.items) {
      nodes.push(...(data.items as WikiNode[]));
    }
    pageToken = data?.has_more ? (data.page_token as string) : undefined;
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
  const res = await fetchWithAuth(
    authInfo,
    "/open-apis/wiki/v2/spaces/get_node",
    { params: { token: wikiToken, obj_type: "wiki" } },
  );

  const data = res?.data as Record<string, unknown> | undefined;
  const node = data?.node as Record<string, unknown> | undefined;
  if (!node) {
    throw new CliError("NOT_FOUND", `知识库节点不存在: ${wikiToken}`);
  }

  return {
    objToken: (node.obj_token as string) ?? "",
    objType: (node.obj_type as string) ?? "",
    title: (node.title as string) ?? "",
    nodeToken: (node.node_token as string) ?? "",
    spaceId: (node.space_id as string) ?? "",
    hasChild: (node.has_child as boolean) || false,
  };
}
