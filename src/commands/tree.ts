/**
 * tree command: Display knowledge base node tree.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { fetchChildren } from "../services/wiki-nodes.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import {
  CommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
} from "../types/index.js";

interface TreeNode {
  title: string;
  nodeToken: string;
  objType: string;
  hasChild: boolean;
  children: TreeNode[];
}

/**
 * Recursively build the tree structure.
 */
async function buildNodeTree(
  authInfo: AuthInfo,
  spaceId: string,
  parentNodeToken: string | undefined,
  currentDepth: number,
  maxDepth: number | undefined,
): Promise<TreeNode[]> {
  if (maxDepth !== undefined && currentDepth >= maxDepth) return [];

  const children = await fetchChildren(authInfo, spaceId, parentNodeToken);

  const result: TreeNode[] = [];
  for (const node of children) {
    const entry: TreeNode = {
      title: node.title || "(无标题)",
      nodeToken: node.node_token,
      objType: node.obj_type || "unknown",
      hasChild: node.has_child,
      children: [],
    };

    if (node.has_child) {
      entry.children = await buildNodeTree(
        authInfo,
        spaceId,
        node.node_token,
        currentDepth + 1,
        maxDepth,
      );
    }

    result.push(entry);
  }

  return result;
}

/**
 * Render tree to text output.
 */
function renderTree(nodes: TreeNode[], prefix: string = ""): string[] {
  const lines: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const last = i === nodes.length - 1;
    const connector = last ? "└── " : "├── ";
    const childPrefix = last ? "    " : "│   ";

    lines.push(
      `${prefix}${connector}${node.title} (${node.objType}, ${node.nodeToken})`,
    );

    if (node.children.length > 0) {
      const childLines = renderTree(node.children, prefix + childPrefix);
      lines.push(...childLines);
    }
  }
  return lines;
}

export const meta: CommandMeta = {
  options: {
    node: { type: "string" },
    depth: { type: "string" },
  },
  positionals: true,
  handler: tree,
};

export async function tree(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const spaceId = args.positionals![0];
  if (!spaceId) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少知识库 ID。用法: feishu-docs tree <space_id> [--node <token>]",
    );
  }

  validateToken(spaceId, "space_id");
  const { authInfo } = await createClient(globalOpts);
  const parentNode = (args.node as string | undefined) || undefined;
  if (parentNode) validateToken(parentNode, "node_token");
  const maxDepth = args.depth !== undefined ? Number(args.depth) : undefined;

  // Get space info for root label
  let spaceName = spaceId;
  if (!parentNode) {
    try {
      const res = await fetchWithAuth(
        authInfo,
        `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}`,
      );
      const data = res?.data as Record<string, unknown> | undefined;
      spaceName =
        ((data?.space as Record<string, unknown>)?.name as string) || spaceId;
    } catch {
      // ignore, use spaceId as name
    }
  }

  const nodes = await buildNodeTree(authInfo, spaceId, parentNode, 0, maxDepth);

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, space_id: spaceId, nodes }, null, 2) +
        "\n",
    );
    return;
  }

  if (parentNode) {
    process.stdout.write(`节点 ${parentNode} (space: ${spaceId})\n`);
  } else {
    process.stdout.write(`${spaceName} (space: ${spaceId})\n`);
  }

  const lines = renderTree(nodes);
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }

  if (nodes.length === 0) {
    process.stdout.write("(空)\n");
  }
}
