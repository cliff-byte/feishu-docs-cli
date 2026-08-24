/**
 * Unified URL/token → document resolution.
 * Extracts the repeated resolve logic from read.js, write.js, delete.js.
 */

import { parseDocUrl } from "./url-parser.js";
import { resolveWikiToken } from "../services/wiki-nodes.js";
import { CliError } from "./errors.js";
import { AuthInfo, ParsedDoc } from "../types/index.js";

export interface ResolvedDocument {
  objToken: string;
  objType: string;
  title: string | undefined;
  nodeToken: string | undefined;
  spaceId: string | undefined;
  hasChild: boolean;
  parsed: ParsedDoc;
  /** Wiki-only metadata (present when resolved via a wiki node). */
  objCreateTime?: string;
  objEditTime?: string;
  nodeCreateTime?: string;
  creator?: string;
  owner?: string;
  nodeCreator?: string;
}

/**
 * Resolve a URL or raw token to a fully-qualified document descriptor.
 *
 * @param {object} authInfo - Auth credentials
 * @param {string} input - URL or raw token
 * @param {object} options
 * @param {boolean} options.allowFallback - If true, unknown types silently fall back to docx (default: true)
 * @returns {{ objToken, objType, title, nodeToken, spaceId, hasChild, parsed }}
 */
export async function resolveDocument(
  authInfo: AuthInfo,
  input: string,
  options: { allowFallback?: boolean } = {},
): Promise<ResolvedDocument> {
  const { allowFallback = true } = options;
  const parsed = parseDocUrl(input);
  if (parsed.type === "bitable_record") {
    throw new CliError(
      "NOT_SUPPORTED",
      "记录分享链接不是云文档，仅支持通过 read 命令读取",
      { recovery: `运行 feishu-docs read '${input}' --json` },
    );
  }
  let objToken = parsed.token;
  let objType: string = parsed.type === "unknown" ? "docx" : parsed.type;
  let title: string | undefined;
  let nodeToken: string | undefined;
  let spaceId: string | undefined;
  let hasChild = false;
  let meta: Pick<
    ResolvedDocument,
    | "objCreateTime"
    | "objEditTime"
    | "nodeCreateTime"
    | "creator"
    | "owner"
    | "nodeCreator"
  > = {};

  if (parsed.type === "wiki" || parsed.type === "unknown") {
    try {
      const wiki = await resolveWikiToken(authInfo, parsed.token);
      objToken = wiki.objToken;
      objType = wiki.objType;
      title = wiki.title;
      nodeToken = wiki.nodeToken;
      spaceId = wiki.spaceId;
      hasChild = wiki.hasChild;
      meta = {
        objCreateTime: wiki.objCreateTime,
        objEditTime: wiki.objEditTime,
        nodeCreateTime: wiki.nodeCreateTime,
        creator: wiki.creator,
        owner: wiki.owner,
        nodeCreator: wiki.nodeCreator,
      };
    } catch (err) {
      if (parsed.type === "unknown" && allowFallback) {
        objType = "docx";
      } else {
        throw err;
      }
    }
  }

  return {
    objToken,
    objType,
    title,
    nodeToken,
    spaceId,
    hasChild,
    parsed,
    ...meta,
  };
}
