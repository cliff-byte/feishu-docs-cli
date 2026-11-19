/**
 * Drive comment service: list comment cards (with full replies and docx block
 * anchors), reply, create whole/local comments, and resolve/reopen.
 */

import { fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import { toReplyElements } from "../utils/comment-content.js";
import type { CommentElement, ReplyElement } from "../utils/comment-content.js";
import type { AuthInfo } from "../types/index.js";

/** Comment-capable resource. Writes are limited to docx. */
export interface CommentTarget {
  fileToken: string;
  fileType: "docx" | "sheet";
}

export type CommentStatus = "open" | "solved" | "all";
export type CommentScope = "all" | "whole" | "partial";

/**
 * Where a comment sits in the document:
 * - whole: document-level comment, no anchor
 * - exact: anchored to `block_id`
 * - embedded: inside an embedded sheet/bitable/whiteboard (parent only)
 * - deleted: anchored content was deleted (not visible in the UI)
 * - unlocated: no position data (e.g. sheet comments)
 */
export interface CommentAnchor {
  status: "whole" | "exact" | "embedded" | "deleted" | "unlocated";
  block_id?: string;
  parent_type?: string;
  parent_token?: string;
}

export interface CommentReply {
  reply_id: string;
  user_id?: string;
  create_time?: number;
  update_time?: number;
  elements: ReplyElement[];
  image_list?: string[];
}

export interface CommentCard {
  comment_id: string;
  user_id?: string;
  create_time?: number;
  update_time?: number;
  is_whole: boolean;
  is_solved: boolean;
  solved_time?: number;
  solver_user_id?: string;
  quote?: string;
  anchor: CommentAnchor;
  replies: CommentReply[];
  replies_truncated?: boolean;
}

const PAGE_SIZE = 100;
/** Hard stop against a server that keeps reporting has_more. */
const MAX_PAGES = 1000;

function commentsPath(target: CommentTarget): string {
  validateToken(target.fileToken, "file_token");
  return `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}/comments`;
}

function commentPath(target: CommentTarget, commentId: string): string {
  validateToken(commentId, "comment_id");
  return `${commentsPath(target)}/${encodeURIComponent(commentId)}`;
}

/** Find positionInfo.blockID inside the double-encoded relation string. */
function extractBlockId(relationJson: unknown): string | undefined {
  if (typeof relationJson !== "string" || !relationJson) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(relationJson);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  for (const entry of Object.values(parsed as Record<string, unknown>)) {
    const blockId = ((entry as Record<string, unknown>)?.positionInfo as
      | Record<string, unknown>
      | undefined)?.blockID;
    if (typeof blockId === "string" && blockId) return blockId;
  }
  return undefined;
}

/** Derive a comment's anchor from list-response fields. */
export function resolveAnchor(item: Record<string, unknown>): CommentAnchor {
  if (item.is_whole === true) return { status: "whole" };
  const relation = item.relation as Record<string, unknown> | null | undefined;
  if (relation?.content_deleted === true) return { status: "deleted" };
  const anchorId = (item.extra as Record<string, unknown> | undefined)?.content_anchor_id;
  const blockId =
    extractBlockId(relation?.relation) ??
    (typeof anchorId === "string" && anchorId ? anchorId : undefined);
  if (blockId) return { status: "exact", block_id: blockId };
  if (typeof item.parent_type === "string" && item.parent_type) {
    return {
      status: "embedded",
      parent_type: item.parent_type,
      ...(typeof item.parent_token === "string" && { parent_token: item.parent_token }),
    };
  }
  return { status: "unlocated" };
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Keep only the sub-object matching each element's type (the API sends the others as null). */
function normalizeElement(raw: Record<string, unknown>): ReplyElement {
  const type = String(raw.type ?? "");
  const value = raw[type];
  return value && typeof value === "object" ? { type, [type]: value } : { type };
}

function normalizeReply(raw: Record<string, unknown>): CommentReply {
  const content = raw.content as Record<string, unknown> | undefined;
  const images = (raw.extra as Record<string, unknown> | undefined)?.image_list;
  return {
    reply_id: String(raw.reply_id ?? ""),
    ...(typeof raw.user_id === "string" && { user_id: raw.user_id }),
    ...(toNumber(raw.create_time) !== undefined && { create_time: toNumber(raw.create_time) }),
    ...(toNumber(raw.update_time) !== undefined && { update_time: toNumber(raw.update_time) }),
    elements: (Array.isArray(content?.elements) ? content.elements : []).map((el) =>
      normalizeElement(el as Record<string, unknown>),
    ),
    ...(Array.isArray(images) && images.length > 0 && { image_list: images as string[] }),
  };
}

/** Numeric-string id comparison (ids are snowflake-style digit strings). */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Chronological order, root reply (the comment body) first. The list endpoint
 * returns inline replies in unstable order (observed live); the replies
 * endpoint is chronological.
 */
function sortReplies(replies: readonly CommentReply[]): CommentReply[] {
  return [...replies].sort(
    (a, b) => (a.create_time ?? 0) - (b.create_time ?? 0) || compareIds(a.reply_id, b.reply_id),
  );
}

function normalizeCard(
  item: Record<string, unknown>,
  replies: CommentReply[],
  repliesTruncated: boolean,
): CommentCard {
  return {
    comment_id: String(item.comment_id ?? ""),
    ...(typeof item.user_id === "string" && { user_id: item.user_id }),
    ...(toNumber(item.create_time) !== undefined && { create_time: toNumber(item.create_time) }),
    ...(toNumber(item.update_time) !== undefined && { update_time: toNumber(item.update_time) }),
    is_whole: item.is_whole === true,
    is_solved: item.is_solved === true,
    ...(item.is_solved === true && toNumber(item.solved_time) !== undefined && {
      solved_time: toNumber(item.solved_time),
    }),
    ...(typeof item.solver_user_id === "string" && item.solver_user_id && {
      solver_user_id: item.solver_user_id,
    }),
    ...(typeof item.quote === "string" && item.quote && { quote: item.quote }),
    anchor: resolveAnchor(item),
    replies: sortReplies(replies),
    ...(repliesTruncated && { replies_truncated: true }),
  };
}

/** Fetch every reply of one comment card, following pagination. */
export async function listReplies(
  authInfo: AuthInfo,
  target: CommentTarget,
  commentId: string,
): Promise<CommentReply[]> {
  const path = `${commentPath(target, commentId)}/replies`;
  const replies: CommentReply[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchWithAuth(authInfo, path, {
      params: {
        file_type: target.fileType,
        page_size: PAGE_SIZE,
        user_id_type: "open_id",
        page_token: pageToken,
      },
    });
    const data = (res.data ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(data.items) ? data.items : []) as Record<string, unknown>[];
    replies.push(...items.map(normalizeReply));
    pageToken = typeof data.page_token === "string" ? data.page_token : undefined;
    if (data.has_more !== true || !pageToken) break;
  }
  return replies;
}

/** Fetch every raw comment card page with the given extra query params. */
async function fetchRawComments(
  authInfo: AuthInfo,
  target: CommentTarget,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const path = commentsPath(target);
  const rawItems: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchWithAuth(authInfo, path, {
      params: {
        file_type: target.fileType,
        page_size: PAGE_SIZE,
        user_id_type: "open_id",
        page_token: pageToken,
        ...params,
      },
    });
    const data = (res.data ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(data.items) ? data.items : []) as Record<string, unknown>[];
    rawItems.push(...items);
    pageToken = typeof data.page_token === "string" ? data.page_token : undefined;
    if (data.has_more !== true || !pageToken) break;
  }
  return rawItems;
}

/**
 * Explain an ambiguous comment write failure. The write endpoints answer a
 * missing comment with generic 1069301/1069302, and the single-comment GET
 * is unusable for docx, so look the card up in the list (all statuses).
 * Returns a clearer error, or the original when the lookup can't tell.
 */
async function explainCommentFailure(
  authInfo: AuthInfo,
  target: CommentTarget,
  commentId: string,
  err: unknown,
  action: "reply" | "resolve",
): Promise<unknown> {
  const code = err instanceof CliError ? err.apiCode : undefined;
  if (code !== 1069301 && code !== 1069302) return err;
  let card: Record<string, unknown> | undefined;
  try {
    const items = await fetchRawComments(authInfo, target, {});
    card = items.find((item) => String(item.comment_id) === commentId);
  } catch {
    return err;
  }
  if (!card) {
    return new CliError("NOT_FOUND", `评论不存在: ${commentId}`, {
      apiCode: code,
      recovery: "运行 feishu-docs comment list <url> --status all 获取有效的 comment_id",
    });
  }
  if (action === "reply" && card.is_whole === true) {
    return new CliError("NOT_SUPPORTED", "全文评论不支持回复", {
      apiCode: code,
      recovery: "使用 feishu-docs comment add <url> --text <text> 发表新的全文评论",
    });
  }
  return err;
}

/**
 * List comment cards on a document. Follows all pages and completes replies
 * for cards whose inline reply list is truncated. Comments whose anchored
 * content was deleted are hidden unless status is "all", so the default
 * result matches what users see in the Feishu UI.
 */
export async function listComments(
  authInfo: AuthInfo,
  target: CommentTarget,
  filter: { status?: CommentStatus; scope?: CommentScope } = {},
): Promise<CommentCard[]> {
  const status = filter.status ?? "open";
  const scope = filter.scope ?? "all";
  const rawItems = await fetchRawComments(authInfo, target, {
    ...(status !== "all" && { is_solved: String(status === "solved") }),
    ...(scope !== "all" && { is_whole: String(scope === "whole") }),
    // Block anchors are only available for docx.
    ...(target.fileType === "docx" && { need_relation: "true" }),
  });

  // Replies endpoint is rate-limited to 100/min — complete cards sequentially.
  const cards: CommentCard[] = [];
  for (const item of rawItems) {
    const inline = (
      ((item.reply_list as Record<string, unknown> | undefined)?.replies ?? []) as Record<string, unknown>[]
    ).map(normalizeReply);
    if (item.has_more !== true) {
      cards.push(normalizeCard(item, inline, false));
      continue;
    }
    try {
      const all = await listReplies(authInfo, target, String(item.comment_id ?? ""));
      cards.push(normalizeCard(item, all, false));
    } catch (err) {
      // The replies endpoint needs docs:document.comment:read while the list
      // endpoint does not; degrade instead of failing the whole listing.
      const recovery = err instanceof CliError && err.recovery ? `（${err.recovery}）` : "";
      process.stderr.write(
        `feishu-docs: warning: 评论 ${String(item.comment_id)} 的回复未能全部获取: ${(err as Error).message}${recovery}\n`,
      );
      cards.push(normalizeCard(item, inline, true));
    }
  }

  return status === "all" ? cards : cards.filter((c) => c.anchor.status !== "deleted");
}

/** Reply to an existing comment. Returns the new reply id when the API reports one. */
export async function addReply(
  authInfo: AuthInfo,
  target: CommentTarget,
  commentId: string,
  elements: readonly CommentElement[],
): Promise<{ replyId?: string }> {
  const path = `${commentPath(target, commentId)}/replies`;
  const res = await fetchWithAuth(authInfo, path, {
    method: "POST",
    params: { file_type: target.fileType, user_id_type: "open_id" },
    body: { content: { elements: toReplyElements(elements) } },
  }).catch(async (err) => {
    throw await explainCommentFailure(authInfo, target, commentId, err, "reply");
  });
  const data = (res.data ?? {}) as Record<string, unknown>;
  const replyId = data.reply_id ?? (data.reply as Record<string, unknown> | undefined)?.reply_id;
  return typeof replyId === "string" && replyId ? { replyId } : {};
}

/**
 * new_comments answers a missing or deleted anchor block with a generic
 * 1069301; confirm via the docx block API (1770002 = block not found).
 */
async function explainBlockFailure(
  authInfo: AuthInfo,
  target: CommentTarget,
  blockId: string,
  err: unknown,
): Promise<unknown> {
  if (!(err instanceof CliError) || err.apiCode !== 1069301) return err;
  const doc = encodeURIComponent(target.fileToken);
  try {
    await fetchWithAuth(authInfo, `/open-apis/docx/v1/documents/${doc}/blocks/${encodeURIComponent(blockId)}`);
    return err;
  } catch (lookupErr) {
    if (lookupErr instanceof CliError && lookupErr.apiCode === 1770002) {
      return new CliError("INVALID_ARGS", `块不存在或已被删除: ${blockId}`, {
        apiCode: err.apiCode,
        recovery: "运行 feishu-docs read <url> --blocks 获取当前有效的 block_id",
      });
    }
    return err;
  }
}

/**
 * Create a comment. Without blockId it is a whole-document comment; with
 * blockId it is anchored to that block (create_v2 `new_comments` endpoint).
 */
export async function addComment(
  authInfo: AuthInfo,
  target: CommentTarget,
  elements: readonly CommentElement[],
  blockId?: string,
): Promise<{ commentId?: string; replyId?: string }> {
  if (blockId !== undefined) validateToken(blockId, "block_id");
  validateToken(target.fileToken, "file_token");
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}/new_comments`,
    {
      method: "POST",
      body: {
        file_type: target.fileType,
        reply_elements: elements,
        ...(blockId !== undefined && { anchor: { block_id: blockId } }),
      },
    },
  ).catch(async (err) => {
    throw blockId !== undefined ? await explainBlockFailure(authInfo, target, blockId, err) : err;
  });
  const data = (res.data ?? {}) as Record<string, unknown>;
  const commentId = data.comment_id;
  const replyId = data.reply_id;
  return {
    ...(typeof commentId === "string" && commentId && { commentId }),
    ...(typeof replyId === "string" && replyId && { replyId }),
  };
}

/** Mark a comment resolved (true) or reopen it (false). */
export async function setCommentSolved(
  authInfo: AuthInfo,
  target: CommentTarget,
  commentId: string,
  solved: boolean,
): Promise<void> {
  await fetchWithAuth(authInfo, commentPath(target, commentId), {
    method: "PATCH",
    params: { file_type: target.fileType },
    body: { is_solved: solved },
  }).catch(async (err) => {
    throw await explainCommentFailure(authInfo, target, commentId, err, "resolve");
  });
}
