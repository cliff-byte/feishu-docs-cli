/**
 * cat command: Recursively read all documents under a knowledge base node.
 */

import { createClient } from "../client.js";
import { blocksToMarkdown } from "../parser/blocks-to-md.js";
import { fetchChildren } from "../services/wiki-nodes.js";
import { fetchAllBlocks } from "../services/doc-blocks.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import {
  CommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
} from "../types/index.js";
import type * as lark from "@larksuiteoapi/node-sdk";

interface WalkCtx {
  maxDocs: number;
  maxBytes: number;
  maxDepth: number | undefined;
  typeFilter: string | undefined;
  titleOnly: boolean;
  docsRead: number;
  bytesWritten: number;
  skipped: number;
  stopped: boolean;
  currentDepth: number;
}

/**
 * Parse size string like "500k", "1m" to bytes.
 */
function parseSize(sizeStr: string | number): number {
  if (typeof sizeStr === "number") return sizeStr;
  const match = String(sizeStr).match(/^(\d+(?:\.\d+)?)\s*([km]?)$/i);
  if (!match) return Number(sizeStr) || Infinity;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "k") return num * 1024;
  if (unit === "m") return num * 1024 * 1024;
  return num;
}

/**
 * Recursively collect and output documents.
 */
async function walkNodes(
  client: lark.Client,
  authInfo: AuthInfo,
  spaceId: string,
  parentNodeToken: string | undefined,
  path: string,
  ctx: WalkCtx,
): Promise<void> {
  if (ctx.stopped) return;
  if (ctx.maxDepth !== undefined && ctx.currentDepth >= ctx.maxDepth) return;

  const children = await fetchChildren(authInfo, spaceId, parentNodeToken);

  for (const node of children) {
    if (ctx.stopped) return;

    const nodePath = path
      ? `${path}/${node.title || "(无标题)"}`
      : node.title || "(无标题)";
    const objType = node.obj_type || "unknown";

    // Filter by type
    if (ctx.typeFilter && objType !== ctx.typeFilter) {
      // Still recurse into non-matching nodes that have children
      if (node.has_child) {
        ctx.currentDepth++;
        await walkNodes(
          client,
          authInfo,
          spaceId,
          node.node_token,
          nodePath,
          ctx,
        );
        ctx.currentDepth--;
      }
      continue;
    }

    // Check limits
    if (ctx.docsRead >= ctx.maxDocs) {
      ctx.skipped++;
      ctx.stopped = true;
      process.stderr.write(
        `feishu-docs: warning: 已达到 --max-docs 上限 (${ctx.maxDocs})，共跳过 ${ctx.skipped} 篇文档\n`,
      );
      return;
    }

    if (ctx.bytesWritten >= ctx.maxBytes) {
      ctx.skipped++;
      ctx.stopped = true;
      process.stderr.write(
        `feishu-docs: warning: 已达到 --max-bytes 上限，共跳过 ${ctx.skipped} 篇文档\n`,
      );
      return;
    }

    // Output document
    const header = `---\npath: ${nodePath}\ntoken: ${node.node_token}\ntype: ${objType}\n---\n\n`;

    if (ctx.titleOnly) {
      process.stdout.write(header);
      ctx.bytesWritten += Buffer.byteLength(header);
      ctx.docsRead++;
    } else if (objType === "docx") {
      try {
        const blocks = await fetchAllBlocks(client, authInfo, node.obj_token);
        const md = blocksToMarkdown(blocks);
        const output = header + md + "\n";

        // Check byte limit before writing
        const outputBytes = Buffer.byteLength(output);
        if (ctx.bytesWritten + outputBytes > ctx.maxBytes) {
          ctx.skipped++;
          ctx.stopped = true;
          process.stderr.write(
            `feishu-docs: warning: 已达到 --max-bytes 上限，共跳过 ${ctx.skipped} 篇文档\n`,
          );
          return;
        }

        process.stdout.write(output);
        ctx.bytesWritten += outputBytes;
        ctx.docsRead++;
      } catch (err) {
        process.stderr.write(
          `feishu-docs: warning: 读取 ${nodePath} 失败: ${(err as Error).message}\n`,
        );
        ctx.docsRead++;
      }
    } else {
      // Non-docx types: output header only with type info
      const output = header + `[${objType}: ${node.obj_token}]\n\n`;
      process.stdout.write(output);
      ctx.bytesWritten += Buffer.byteLength(output);
      ctx.docsRead++;
    }

    // Recurse into children
    if (node.has_child) {
      ctx.currentDepth++;
      await walkNodes(
        client,
        authInfo,
        spaceId,
        node.node_token,
        nodePath,
        ctx,
      );
      ctx.currentDepth--;
    }
  }
}

export const meta: CommandMeta = {
  options: {
    node: { type: "string" },
    depth: { type: "string" },
    "max-docs": { type: "string" },
    "max-bytes": { type: "string" },
    "title-only": { type: "boolean", default: false },
    type: { type: "string" },
  },
  positionals: true,
  handler: cat,
};

export async function cat(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const spaceId = args.positionals![0];
  if (!spaceId) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少知识库 ID。用法: feishu-docs cat <space_id> [--node <token>]",
    );
  }

  validateToken(spaceId, "space_id");

  const { client, authInfo } = await createClient(globalOpts);

  const parentNode = (args.node as string | undefined) || undefined;
  if (parentNode) validateToken(parentNode, "node_token");

  const ctx: WalkCtx = {
    maxDocs: args.maxDocs !== undefined ? Number(args.maxDocs) : 50,
    maxBytes:
      args.maxBytes !== undefined
        ? parseSize(args.maxBytes as string | number)
        : parseSize("1m"),
    maxDepth: args.depth !== undefined ? Number(args.depth) : undefined,
    typeFilter: (args.type as string | undefined) || undefined,
    titleOnly: (args.titleOnly as boolean) || false,
    docsRead: 0,
    bytesWritten: 0,
    skipped: 0,
    stopped: false,
    currentDepth: 0,
  };

  await walkNodes(client, authInfo, spaceId, parentNode, "", ctx);

  if (ctx.docsRead === 0) {
    process.stderr.write("feishu-docs: info: 未找到任何文档\n");
  }
}
