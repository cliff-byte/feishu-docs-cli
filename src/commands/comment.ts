/**
 * comment command: Read, post, reply to, resolve and reopen document comments
 * (list/add/reply/resolve/reopen).
 */

import { createClient } from "../client.js";
import { CliError } from "../utils/errors.js";
import { withScopeRecovery } from "../utils/scope-prompt.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { formatEpochSeconds } from "../utils/format-time.js";
import { validateToken } from "../utils/validate.js";
import {
  MAX_REPLY_ELEMENTS,
  parseCommentContent,
  renderReplyText,
} from "../utils/comment-content.js";
import {
  addComment,
  addReply,
  listComments,
  setCommentSolved,
} from "../services/comments.js";
import type {
  CommentAnchor,
  CommentCard,
  CommentScope,
  CommentStatus,
  CommentTarget,
} from "../services/comments.js";
import { resolveUserNames } from "../services/doc-enrichment.js";
import type {
  SubcommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
} from "../types/index.js";

const CONTENT_OPTIONS = {
  text: { type: "string" },
  elements: { type: "string" },
} as const;

export const meta: SubcommandMeta = {
  subcommands: {
    list: {
      options: {
        status: { type: "string", default: "open" },
        scope: { type: "string", default: "all" },
        type: { type: "string" },
      },
      positionals: true,
      handler: list,
    },
    add: {
      options: { ...CONTENT_OPTIONS, block: { type: "string" } },
      positionals: true,
      handler: add,
    },
    reply: {
      options: CONTENT_OPTIONS,
      positionals: true,
      handler: reply,
    },
    resolve: {
      options: {},
      positionals: true,
      handler: resolve,
    },
    reopen: {
      options: {},
      positionals: true,
      handler: reopen,
    },
  },
};

const STATUSES: readonly CommentStatus[] = ["open", "solved", "all"];
const SCOPES: readonly CommentScope[] = ["all", "whole", "partial"];

/**
 * Resolve a URL/token to a comment target. Only docx supports writes;
 * listing additionally accepts spreadsheets.
 */
async function resolveTarget(
  authInfo: AuthInfo,
  input: string,
  options: { allowSheet?: boolean; type?: unknown } = {},
): Promise<CommentTarget> {
  const doc = await resolveDocument(authInfo, input, { type: options.type });
  if (doc.objType === "docx") return { fileToken: doc.objToken, fileType: "docx" };
  if (doc.objType === "sheet" && options.allowSheet) {
    return { fileToken: doc.objToken, fileType: "sheet" };
  }
  throw new CliError(
    "NOT_SUPPORTED",
    `${doc.objType} 类型暂不支持此评论操作`,
    {
      recovery: options.allowSheet
        ? "comment list 支持 docx 与电子表格；旧版 doc 请先在飞书客户端升级为 docx"
        : "评论写入目前仅支持 docx 文档",
    },
  );
}

function requirePositionals(args: CommandArgs, count: number, usage: string): string[] {
  const positionals = args.positionals ?? [];
  if (positionals.length < count || positionals.slice(0, count).some((p) => !p)) {
    throw new CliError("INVALID_ARGS", `用法: feishu-docs ${usage}`);
  }
  return positionals.slice(0, count);
}

function anchorLabel(anchor: CommentAnchor): string {
  switch (anchor.status) {
    case "whole":
      return "全文评论";
    case "exact":
      return `块 ${anchor.block_id}`;
    case "embedded":
      return `内嵌 ${anchor.parent_type}${anchor.parent_token ? ` ${anchor.parent_token}` : ""}`;
    case "deleted":
      return "原文已删除";
    default:
      return "位置未知";
  }
}

function collectUserIds(cards: readonly CommentCard[]): string[] {
  const ids = cards.flatMap((card) => [
    card.user_id,
    card.solver_user_id,
    ...card.replies.flatMap((r) => [
      r.user_id,
      ...r.elements.map((el) => (el.type === "person" ? el.person?.user_id : undefined)),
    ]),
  ]);
  return [...new Set(ids.filter((id): id is string => !!id))];
}

function withNames(card: CommentCard, names: ReadonlyMap<string, string>) {
  const nameOf = (id?: string) => (id ? names.get(id) : undefined);
  return {
    ...card,
    ...(nameOf(card.user_id) && { user_name: nameOf(card.user_id) }),
    ...(nameOf(card.solver_user_id) && { solver_name: nameOf(card.solver_user_id) }),
    replies: card.replies.map((r) => ({
      ...r,
      ...(nameOf(r.user_id) && { user_name: nameOf(r.user_id) }),
      text: renderReplyText(r.elements, names),
    })),
  };
}

async function list(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const [input] = requirePositionals(
    args,
    1,
    "comment list <url|token> [--status open|solved|all] [--scope all|whole|partial] [--type sheet]",
  );
  const status = (args.status as string | undefined) ?? "open";
  const scope = (args.scope as string | undefined) ?? "all";
  if (!STATUSES.includes(status as CommentStatus)) {
    throw new CliError("INVALID_ARGS", `无效的 --status: ${status}。可选值: ${STATUSES.join(", ")}`);
  }
  if (!SCOPES.includes(scope as CommentScope)) {
    throw new CliError("INVALID_ARGS", `无效的 --scope: ${scope}。可选值: ${SCOPES.join(", ")}`);
  }

  return withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);
    const target = await resolveTarget(authInfo, input, { allowSheet: true, type: args.type });
    const cards = await listComments(authInfo, target, {
      status: status as CommentStatus,
      scope: scope as CommentScope,
    });
    const userIds = collectUserIds(cards);
    const names = userIds.length > 0 ? await resolveUserNames(authInfo, userIds) : new Map<string, string>();
    const comments = cards.map((card) => withNames(card, names));

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify(
          {
            success: true,
            file_token: target.fileToken,
            file_type: target.fileType,
            count: comments.length,
            comments,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }

    if (comments.length === 0) {
      process.stdout.write("没有评论\n");
      return;
    }
    process.stdout.write(`共 ${comments.length} 条评论\n`);
    for (const c of comments) {
      const state = c.is_solved ? "已解决" : "未解决";
      process.stdout.write(`\n${c.comment_id}  [${state}]  ${anchorLabel(c.anchor)}\n`);
      if (c.quote) process.stdout.write(`  引用: ${c.quote}\n`);
      c.replies.forEach((r, i) => {
        const who = r.user_name ?? r.user_id ?? "(未知)";
        const when = formatEpochSeconds(r.create_time !== undefined ? String(r.create_time) : undefined);
        const prefix = i === 0 ? "  " : "  └ ";
        process.stdout.write(`${prefix}${who}${when ? ` (${when})` : ""}: ${r.text}\n`);
      });
      if (c.replies_truncated) process.stdout.write("  …（回复未能全部获取）\n");
    }
  }, globalOpts);
}

async function add(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const [input] = requirePositionals(
    args,
    1,
    "comment add <url|token> (--text <text> | --elements <json>) [--block <block_id>]",
  );
  const elements = parseCommentContent({ text: args.text, elements: args.elements });
  const blockId = args.block as string | undefined;
  if (blockId !== undefined && !blockId) {
    throw new CliError("INVALID_ARGS", "--block 不能为空", {
      recovery: "运行 feishu-docs read <url> --blocks 获取 block_id；省略 --block 则发表全文评论",
    });
  }

  return withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);
    const target = await resolveTarget(authInfo, input);
    const { commentId, replyId } = await addComment(authInfo, target, elements, blockId);

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({
          success: true,
          file_token: target.fileToken,
          ...(commentId && { comment_id: commentId }),
          ...(replyId && { reply_id: replyId }),
          anchor: blockId ? { status: "exact", block_id: blockId } : { status: "whole" },
        }) + "\n",
      );
    } else {
      const where = blockId ? `块 ${blockId}` : "全文";
      process.stdout.write(`已发表评论（${where}）${commentId ? `: ${commentId}` : ""}\n`);
    }
  }, globalOpts);
}

async function reply(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const [input, commentId] = requirePositionals(
    args,
    2,
    "comment reply <url|token> <comment_id> (--text <text> | --elements <json>)",
  );
  const elements = parseCommentContent(
    { text: args.text, elements: args.elements },
    { maxElements: MAX_REPLY_ELEMENTS },
  );
  validateToken(commentId, "comment_id");

  return withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);
    const target = await resolveTarget(authInfo, input);
    const { replyId } = await addReply(authInfo, target, commentId, elements);

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({
          success: true,
          comment_id: commentId,
          ...(replyId && { reply_id: replyId }),
        }) + "\n",
      );
    } else {
      process.stdout.write(`已回复评论 ${commentId}${replyId ? `: ${replyId}` : ""}\n`);
    }
  }, globalOpts);
}

async function setSolved(
  args: CommandArgs,
  globalOpts: GlobalOpts,
  solved: boolean,
): Promise<void> {
  const name = solved ? "resolve" : "reopen";
  const [input, commentId] = requirePositionals(args, 2, `comment ${name} <url|token> <comment_id>`);
  validateToken(commentId, "comment_id");

  return withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);
    const target = await resolveTarget(authInfo, input, { allowSheet: true });
    await setCommentSolved(authInfo, target, commentId, solved);

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({ success: true, comment_id: commentId, is_solved: solved }) + "\n",
      );
    } else {
      process.stdout.write(`${solved ? "已解决" : "已重新打开"}评论 ${commentId}\n`);
    }
  }, globalOpts);
}

async function resolve(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  return setSolved(args, globalOpts, true);
}

async function reopen(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  return setSolved(args, globalOpts, false);
}
