/**
 * Unified URL/token → document resolution.
 * Extracts the repeated resolve logic from read.js, write.js, delete.js.
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { parseDocUrl } from "./url-parser.js";
import { resolveWikiToken } from "../services/wiki-nodes.js";
import { AuthInfo, ParsedDoc } from "../types/index.js";

export interface ResolvedDocument {
  objToken: string;
  objType: string;
  title: string | undefined;
  nodeToken: string | undefined;
  spaceId: string | undefined;
  hasChild: boolean;
  parsed: ParsedDoc;
}

/**
 * Resolve a URL or raw token to a fully-qualified document descriptor.
 *
 * @param {object} client - Lark SDK client
 * @param {object} authInfo - Auth credentials
 * @param {string} input - URL or raw token
 * @param {object} options
 * @param {boolean} options.allowFallback - If true, unknown types silently fall back to docx (default: true)
 * @returns {{ objToken, objType, title, nodeToken, spaceId, hasChild, parsed }}
 */
export async function resolveDocument(
  client: lark.Client,
  authInfo: AuthInfo,
  input: string,
  options: { allowFallback?: boolean } = {},
): Promise<ResolvedDocument> {
  const { allowFallback = true } = options;
  const parsed = parseDocUrl(input);
  let objToken = parsed.token;
  let objType: string = parsed.type === "unknown" ? "docx" : parsed.type;
  let title: string | undefined;
  let nodeToken: string | undefined;
  let spaceId: string | undefined;
  let hasChild = false;

  if (parsed.type === "wiki" || parsed.type === "unknown") {
    try {
      const wiki = await resolveWikiToken(client, authInfo, parsed.token);
      objToken = wiki.objToken;
      objType = wiki.objType;
      title = wiki.title;
      nodeToken = wiki.nodeToken;
      spaceId = wiki.spaceId;
      hasChild = wiki.hasChild;
    } catch (err) {
      if (parsed.type === "unknown" && allowFallback) {
        objType = "docx";
      } else {
        throw err;
      }
    }
  }

  return { objToken, objType, title, nodeToken, spaceId, hasChild, parsed };
}
