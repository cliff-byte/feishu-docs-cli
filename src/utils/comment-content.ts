/**
 * Comment content helpers: parse --text / --elements input into comment
 * elements, enforce server-side limits locally, and render reply elements.
 */

import { CliError } from "./errors.js";
import { parseDocUrl } from "./url-parser.js";

/**
 * Combined character cap across all text elements, measured after escaping
 * (verified live: 10000 "a" passes, 10001 fails; 2500 "<" passes, 2501 fails).
 * The server returns an opaque 1069302 above it.
 */
export const MAX_COMMENT_TEXT_CHARS = 10_000;

/** Element-count cap declared by the reply-create endpoint. */
export const MAX_REPLY_ELEMENTS = 100;

const OPEN_ID_RE = /^ou_[A-Za-z0-9_-]{1,100}$/;

const ELEMENTS_EXAMPLE =
  `[{"type":"text","text":"请 "},{"type":"mention_user","mention_user":"ou_xxx"},{"type":"link","link":"https://xxx.feishu.cn/docx/xxx"}]`;

/** Simplified comment element (create_v2 wire form). */
export type CommentElement =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "mention_user"; mention_user: string }>
  | Readonly<{ type: "link"; link: string }>;

/** Reply element in Drive v1 wire form (text_run / person / docs_link). */
export interface ReplyElement {
  type: string;
  text_run?: { text?: string };
  person?: { user_id?: string };
  docs_link?: { url?: string };
}

function invalid(message: string): CliError {
  return new CliError("INVALID_ARGS", message, {
    recovery: `--text 传纯文本；需要 @ 人或文档链接时用 --elements '${ELEMENTS_EXAMPLE}'`,
  });
}

/** Escape angle brackets so Feishu renders them as literal characters. */
export function escapeCommentText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseElement(raw: unknown, index: number): CommentElement {
  const el = (raw ?? {}) as Record<string, unknown>;
  const pick = (key: string): string => {
    const v = el[key] ?? el.text;
    return typeof v === "string" ? v.trim() : "";
  };
  switch (el.type) {
    case "text": {
      const text = typeof el.text === "string" ? el.text : "";
      if (!text.trim()) throw invalid(`--elements 第 ${index} 个元素 type=text 的 text 不能为空`);
      return { type: "text", text };
    }
    case "mention_user": {
      const id = pick("mention_user");
      if (!OPEN_ID_RE.test(id)) {
        throw invalid(`--elements 第 ${index} 个元素 mention_user 需为 open_id（ou_ 开头）: ${id}`);
      }
      return { type: "mention_user", mention_user: id };
    }
    case "link": {
      const link = pick("link");
      if (!/^https:\/\//.test(link)) {
        throw invalid(`--elements 第 ${index} 个元素 link 需为完整 https 链接: ${link}`);
      }
      try {
        parseDocUrl(link);
      } catch {
        throw invalid(`--elements 第 ${index} 个元素 link 只接受飞书云文档 URL: ${link}`);
      }
      return { type: "link", link };
    }
    default:
      throw invalid(
        `--elements 第 ${index} 个元素类型无效: ${String(el.type)}。可选值: text, mention_user, link`,
      );
  }
}

/**
 * Parse --text / --elements into validated comment elements. Text is escaped,
 * and the combined length is checked on the escaped form, which is what the
 * server counts.
 */
export function parseCommentContent(
  input: { text?: unknown; elements?: unknown },
  options: { maxElements?: number } = {},
): CommentElement[] {
  const hasText = typeof input.text === "string";
  const hasElements = typeof input.elements === "string";
  if (hasText === hasElements) {
    throw invalid("需要且只能提供 --text 或 --elements 其中之一");
  }

  const parsed: CommentElement[] = (() => {
    if (hasText) {
      const text = input.text as string;
      if (!text.trim()) throw invalid("--text 不能为空");
      return [{ type: "text", text }];
    }
    let raw: unknown;
    try {
      raw = JSON.parse(input.elements as string);
    } catch (err) {
      throw invalid(`--elements 不是合法 JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      throw invalid("--elements 需为非空 JSON 数组");
    }
    return raw.map((el, i) => parseElement(el, i + 1));
  })();

  if (options.maxElements !== undefined && parsed.length > options.maxElements) {
    throw invalid(`--elements 最多 ${options.maxElements} 个元素，当前 ${parsed.length} 个`);
  }

  const escaped = parsed.map((el) =>
    el.type === "text" ? { type: "text" as const, text: escapeCommentText(el.text) } : el,
  );
  const totalChars = escaped.reduce(
    (sum, el) => sum + (el.type === "text" ? [...el.text].length : 0),
    0,
  );
  if (totalChars > MAX_COMMENT_TEXT_CHARS) {
    throw invalid(
      `评论文本合计 ${totalChars} 字，超过上限 ${MAX_COMMENT_TEXT_CHARS} 字（< 和 > 转义后各计 4 字；拆成多个 text 元素不能绕过）`,
    );
  }
  return escaped;
}

/** Convert simplified elements to the Drive v1 reply wire form. */
export function toReplyElements(elements: readonly CommentElement[]): ReplyElement[] {
  return elements.map((el) => {
    if (el.type === "text") return { type: "text_run", text_run: { text: el.text } };
    if (el.type === "mention_user") return { type: "person", person: { user_id: el.mention_user } };
    return { type: "docs_link", docs_link: { url: el.link } };
  });
}

/**
 * Render reply elements as a single line of text. Mentions use the display
 * name when known, otherwise the raw user id.
 */
export function renderReplyText(
  elements: readonly ReplyElement[],
  names: ReadonlyMap<string, string> = new Map(),
): string {
  return elements
    .map((el) => {
      if (el.type === "text_run") return el.text_run?.text ?? "";
      if (el.type === "person") {
        const id = el.person?.user_id ?? "";
        return `@${names.get(id) ?? id}`;
      }
      if (el.type === "docs_link") return el.docs_link?.url ?? "";
      return "";
    })
    .join("");
}
