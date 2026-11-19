/**
 * Tests for document comments: content parsing, anchor resolution, the
 * comment service (pagination, reply completion, writes) and the comment
 * command handlers (list/add/reply/resolve/reopen).
 *
 * Mock strategy: a URL-routing globalThis.fetch mock (order-independent), so
 * tenant-token and contact lookups don't need to be sequenced by hand.
 */

import { describe, it, afterEach, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  parseCommentContent,
  toReplyElements,
  renderReplyText,
  escapeCommentText,
  MAX_COMMENT_TEXT_CHARS,
} from "../src/utils/comment-content.js";
import {
  resolveAnchor,
  listComments,
  addComment,
  addReply,
  setCommentSolved,
} from "../src/services/comments.js";
import { meta } from "../src/commands/comment.js";
import { CliError, mapApiError } from "../src/utils/errors.js";
import { makeAuthInfo, makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import type { CommandArgs, GlobalOpts } from "../src/types/index.js";

// ── Routing fetch mock ──

interface Call {
  method: string;
  url: URL;
  body: unknown;
}

type Route = (call: Call) => unknown | undefined;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Install a fetch mock; the first route returning a value answers the call. */
function mockFetch(routes: Route[]): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method: init?.method ?? "GET", url, body };
    if (url.pathname.endsWith("/tenant_access_token/internal")) {
      return json({ code: 0, tenant_access_token: "t-mock", expire: 7200 });
    }
    calls.push(call);
    for (const route of routes) {
      const res = route(call);
      if (res !== undefined) return json(res);
    }
    throw new Error(`Unrouted fetch: ${call.method} ${url.pathname}${url.search}`);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const ok = (data: unknown = {}) => ({ code: 0, data });

function route(method: string, pathSuffix: string, handler: (call: Call) => unknown): Route {
  return (call) =>
    call.method === method && call.url.pathname.endsWith(pathSuffix) ? handler(call) : undefined;
}

const COMMENTS = "/open-apis/drive/v1/files/doxTOKEN/comments";

function card(id: string, extra: Record<string, unknown> = {}) {
  return {
    comment_id: id,
    user_id: "ou_author",
    create_time: 1731800000,
    is_whole: false,
    is_solved: false,
    quote: `quote-${id}`,
    has_more: false,
    relation: {
      content_deleted: false,
      relation: JSON.stringify({ "22-doxTOKEN": { positionInfo: { blockID: `blk_${id}` } } }),
    },
    reply_list: {
      replies: [
        {
          reply_id: `r_${id}`,
          user_id: "ou_author",
          create_time: 1731800000,
          content: { elements: [{ type: "text_run", text_run: { text: `body-${id}` } }] },
        },
      ],
    },
    ...extra,
  };
}

const auth = makeAuthInfo();
const docx = { fileToken: "doxTOKEN", fileType: "docx" as const };

// ── Content parsing ──

describe("parseCommentContent", () => {
  it("wraps --text as one escaped text element", () => {
    assert.deepEqual(parseCommentContent({ text: "a <b> c" }), [
      { type: "text", text: "a &lt;b&gt; c" },
    ]);
  });

  it("requires exactly one of --text / --elements", () => {
    assert.throws(() => parseCommentContent({}), CliError);
    assert.throws(() => parseCommentContent({ text: "a", elements: "[]" }), CliError);
  });

  it("rejects empty text", () => {
    assert.throws(() => parseCommentContent({ text: "   " }), /不能为空/);
  });

  it("parses mixed elements, accepting value in text field", () => {
    const els = parseCommentContent({
      elements: JSON.stringify([
        { type: "text", text: "请 " },
        { type: "mention_user", text: "ou_abc" },
        { type: "link", link: "https://x.feishu.cn/docx/doxABC" },
      ]),
    });
    assert.deepEqual(els, [
      { type: "text", text: "请 " },
      { type: "mention_user", mention_user: "ou_abc" },
      { type: "link", link: "https://x.feishu.cn/docx/doxABC" },
    ]);
  });

  it("rejects invalid JSON, empty arrays and unknown types", () => {
    assert.throws(() => parseCommentContent({ elements: "{" }), /合法 JSON/);
    assert.throws(() => parseCommentContent({ elements: "[]" }), /非空/);
    assert.throws(
      () => parseCommentContent({ elements: '[{"type":"image"}]' }),
      /类型无效/,
    );
  });

  it("rejects non open_id mentions and non-Feishu links", () => {
    assert.throws(
      () => parseCommentContent({ elements: '[{"type":"mention_user","mention_user":"../x"}]' }),
      /open_id/,
    );
    assert.throws(
      () => parseCommentContent({ elements: '[{"type":"link","link":"https://evil.com/a"}]' }),
      /飞书云文档/,
    );
    assert.throws(
      () => parseCommentContent({ elements: '[{"type":"link","link":"doxABC"}]' }),
      /https/,
    );
  });

  it("caps combined text by raw character count across elements", () => {
    const half = "中".repeat(MAX_COMMENT_TEXT_CHARS / 2);
    assert.doesNotThrow(() =>
      parseCommentContent({ elements: JSON.stringify([{ type: "text", text: half }, { type: "text", text: half }]) }),
    );
    assert.throws(
      () =>
        parseCommentContent({
          elements: JSON.stringify([{ type: "text", text: half }, { type: "text", text: `${half}x` }]),
        }),
      /超过上限/,
    );
    // The server counts the escaped form: each '<' becomes 4 chars (live: 2500 ok, 2501 rejected).
    assert.doesNotThrow(() => parseCommentContent({ text: "<".repeat(MAX_COMMENT_TEXT_CHARS / 4) }));
    assert.throws(
      () => parseCommentContent({ text: "<".repeat(MAX_COMMENT_TEXT_CHARS / 4 + 1) }),
      /超过上限/,
    );
  });

  it("enforces maxElements when given", () => {
    const many = JSON.stringify(Array.from({ length: 3 }, () => ({ type: "text", text: "a" })));
    assert.throws(() => parseCommentContent({ elements: many }, { maxElements: 2 }), /最多 2/);
  });
});

describe("toReplyElements / renderReplyText", () => {
  it("converts to v1 wire form and renders back", () => {
    const v1 = toReplyElements([
      { type: "text", text: "hi " },
      { type: "mention_user", mention_user: "ou_a" },
      { type: "link", link: "https://x.feishu.cn/docx/d" },
    ]);
    assert.deepEqual(v1, [
      { type: "text_run", text_run: { text: "hi " } },
      { type: "person", person: { user_id: "ou_a" } },
      { type: "docs_link", docs_link: { url: "https://x.feishu.cn/docx/d" } },
    ]);
    assert.equal(renderReplyText(v1), "hi @ou_ahttps://x.feishu.cn/docx/d");
    assert.equal(renderReplyText(v1, new Map([["ou_a", "张三"]])), "hi @张三https://x.feishu.cn/docx/d");
  });

  it("escapeCommentText escapes only angle brackets", () => {
    assert.equal(escapeCommentText("a&<b>"), "a&&lt;b&gt;");
  });
});

// ── Anchor resolution ──

describe("resolveAnchor", () => {
  it("whole comments", () => {
    assert.deepEqual(resolveAnchor({ is_whole: true }), { status: "whole" });
  });

  it("parses double-encoded relation for block id", () => {
    assert.deepEqual(resolveAnchor(card("1")), { status: "exact", block_id: "blk_1" });
  });

  it("deleted content wins over block id", () => {
    const item = card("1", { relation: { content_deleted: true, relation: card("1").relation.relation } });
    assert.deepEqual(resolveAnchor(item), { status: "deleted" });
  });

  it("embedded resources fall back to parent", () => {
    assert.deepEqual(
      resolveAnchor({ relation: null, parent_type: "BITABLE_BLOCK", parent_token: "bas_tbl1" }),
      { status: "embedded", parent_type: "BITABLE_BLOCK", parent_token: "bas_tbl1" },
    );
  });

  it("malformed relation is unlocated", () => {
    assert.deepEqual(resolveAnchor({ relation: { relation: "{not json" } }), { status: "unlocated" });
    assert.deepEqual(resolveAnchor({}), { status: "unlocated" });
  });

  it("falls back to extra.content_anchor_id when relation is absent", () => {
    assert.deepEqual(resolveAnchor({ extra: { content_anchor_id: "blk_x" } }), {
      status: "exact",
      block_id: "blk_x",
    });
  });
});

// ── Service ──

describe("comments service", { concurrency: 1 }, () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("listComments follows pages and sends default filters", async () => {
    const m = mockFetch([
      route("GET", COMMENTS, (c) =>
        c.url.searchParams.get("page_token") === "p2"
          ? ok({ items: [card("2")], has_more: false })
          : ok({ items: [card("1")], has_more: true, page_token: "p2" }),
      ),
    ]);
    restore = m.restore;
    const cards = await listComments(auth, docx);
    assert.deepEqual(cards.map((c) => c.comment_id), ["1", "2"]);
    const q = m.calls[0].url.searchParams;
    assert.equal(q.get("file_type"), "docx");
    assert.equal(q.get("is_solved"), "false");
    assert.equal(q.get("need_relation"), "true");
    assert.equal(q.get("page_size"), "100");
    assert.equal(q.has("is_whole"), false);
    assert.equal(cards[0].anchor.block_id, "blk_1");
    assert.equal(cards[0].replies[0].reply_id, "r_1");
  });

  it("strips the null sibling fields the API sends on each element", async () => {
    const live = card("1", {
      reply_list: {
        replies: [{
          reply_id: "r1",
          content: {
            elements: [
              { type: "text_run", text_run: { text: "hi" }, person: null, docs_link: null },
              { type: "person", person: { user_id: "ou_a" }, text_run: null, docs_link: null },
            ],
          },
        }],
      },
    });
    const m = mockFetch([route("GET", COMMENTS, () => ok({ items: [live], has_more: false }))]);
    restore = m.restore;
    const [c] = await listComments(auth, docx);
    assert.deepEqual(c.replies[0].elements, [
      { type: "text_run", text_run: { text: "hi" } },
      { type: "person", person: { user_id: "ou_a" } },
    ]);
  });

  it("status/scope map to is_solved/is_whole; sheet omits need_relation", async () => {
    const m = mockFetch([
      route("GET", "/files/shtTOKEN/comments", () => ok({ items: [], has_more: false })),
    ]);
    restore = m.restore;
    await listComments(auth, { fileToken: "shtTOKEN", fileType: "sheet" }, { status: "all", scope: "whole" });
    const q = m.calls[0].url.searchParams;
    assert.equal(q.has("is_solved"), false);
    assert.equal(q.get("is_whole"), "true");
    assert.equal(q.has("need_relation"), false);
    assert.equal(q.get("file_type"), "sheet");
  });

  it("completes truncated reply lists via the replies endpoint", async () => {
    const m = mockFetch([
      route("GET", `${COMMENTS}/1/replies`, (c) =>
        c.url.searchParams.get("page_token") === "rp2"
          ? ok({ items: [{ reply_id: "r3", create_time: 3, content: { elements: [] } }], has_more: false })
          : ok({
              items: [{ reply_id: "r_1", create_time: 1 }, { reply_id: "r2", create_time: 2 }],
              has_more: true,
              page_token: "rp2",
            }),
      ),
      route("GET", COMMENTS, () => ok({ items: [card("1", { has_more: true })], has_more: false })),
    ]);
    restore = m.restore;
    const [c] = await listComments(auth, docx);
    assert.deepEqual(c.replies.map((r) => r.reply_id), ["r_1", "r2", "r3"]);
    assert.equal(c.replies_truncated, undefined);
  });

  it("marks replies_truncated when reply completion fails", async () => {
    const m = mockFetch([
      route("GET", `${COMMENTS}/1/replies`, () => ({ code: 1069399, msg: "internal" })),
      route("GET", COMMENTS, () => ok({ items: [card("1", { has_more: true })], has_more: false })),
    ]);
    restore = m.restore;
    const out = captureOutput();
    try {
      const [c] = await listComments(auth, docx);
      assert.equal(c.replies_truncated, true);
      assert.equal(c.replies.length, 1);
      assert.match(out.stderr(), /warning: 评论 1 的回复未能全部获取/);
    } finally {
      out.restore();
    }
  });

  it("orders replies chronologically with the root first (inline order is unstable live)", async () => {
    const reply = (id: string, t: number) => ({ reply_id: id, create_time: t, content: { elements: [] } });
    const shuffled = card("1", {
      reply_list: {
        replies: [reply("7000000000000000047", 47), reply("7000000000000000041", 41),
          reply("7000000000000000002", 37), reply("7000000000000000001", 37)],
      },
    });
    const m = mockFetch([route("GET", COMMENTS, () => ok({ items: [shuffled], has_more: false }))]);
    restore = m.restore;
    const [c] = await listComments(auth, docx);
    assert.deepEqual(c.replies.map((r) => r.reply_id), [
      "7000000000000000001", "7000000000000000002", "7000000000000000041", "7000000000000000047",
    ]);
  });

  it("degrades with an authorize hint when the replies scope is missing", async () => {
    const m = mockFetch([
      route("GET", `${COMMENTS}/1/replies`, () => ({
        code: 99991679,
        msg: "scope",
        error: { permission_violations: [{ subject: "docs:document.comment:read" }] },
      })),
      route("GET", COMMENTS, () => ok({ items: [card("1", { has_more: true })], has_more: false })),
    ]);
    restore = m.restore;
    const out = captureOutput();
    try {
      const [c] = await listComments(auth, docx);
      assert.equal(c.replies_truncated, true);
      assert.match(out.stderr(), /authorize --scope "docs:document.comment:read"/);
    } finally {
      out.restore();
    }
  });

  it("hides deleted-anchor comments unless status is all", async () => {
    const items = [card("1"), card("2", { relation: { content_deleted: true } })];
    const m = mockFetch([route("GET", COMMENTS, () => ok({ items, has_more: false }))]);
    restore = m.restore;
    assert.deepEqual((await listComments(auth, docx)).map((c) => c.comment_id), ["1"]);
    const all = await listComments(auth, docx, { status: "all" });
    assert.deepEqual(all.map((c) => [c.comment_id, c.anchor.status]), [["1", "exact"], ["2", "deleted"]]);
  });

  it("addComment omits anchor for whole comments and sets it for blocks", async () => {
    const m = mockFetch([
      route("POST", "/files/doxTOKEN/new_comments", () => ok({ comment_id: "c9", reply_id: "r9" })),
    ]);
    restore = m.restore;
    const els = [{ type: "text", text: "hi" }] as const;
    assert.deepEqual(await addComment(auth, docx, els), { commentId: "c9", replyId: "r9" });
    await addComment(auth, docx, els, "blk_1");
    assert.deepEqual(m.calls[0].body, { file_type: "docx", reply_elements: els });
    assert.deepEqual(m.calls[1].body, {
      file_type: "docx",
      reply_elements: els,
      anchor: { block_id: "blk_1" },
    });
  });

  it("addComment rejects unsafe block ids before any request", async () => {
    const m = mockFetch([]);
    restore = m.restore;
    await assert.rejects(addComment(auth, docx, [{ type: "text", text: "x" }], "../x"), CliError);
    assert.equal(m.calls.length, 0);
  });

  it("addReply posts v1 elements and returns reply id", async () => {
    const m = mockFetch([
      route("POST", `${COMMENTS}/123/replies`, () => ok({ reply_id: "r5" })),
    ]);
    restore = m.restore;
    const res = await addReply(auth, docx, "123", [{ type: "mention_user", mention_user: "ou_a" }]);
    assert.deepEqual(res, { replyId: "r5" });
    assert.equal(m.calls[0].url.searchParams.get("file_type"), "docx");
    assert.deepEqual(m.calls[0].body, {
      content: { elements: [{ type: "person", person: { user_id: "ou_a" } }] },
    });
  });

  it("setCommentSolved PATCHes is_solved", async () => {
    const m = mockFetch([route("PATCH", `${COMMENTS}/123`, () => ok())]);
    restore = m.restore;
    await setCommentSolved(auth, docx, "123", true);
    await setCommentSolved(auth, docx, "123", false);
    assert.deepEqual(m.calls.map((c) => c.body), [{ is_solved: true }, { is_solved: false }]);
  });
});

// ── Error mapping ──

describe("mapApiError comment codes", () => {
  it("maps comment API codes to typed errors", () => {
    assert.equal(mapApiError({ code: 1069303 }).errorType, "PERMISSION_DENIED");
    for (const code of [1069304, 1069305, 1069307]) {
      assert.equal(mapApiError({ code }).errorType, "NOT_FOUND");
    }
    const param = mapApiError({ code: 1069302, msg: "param error" });
    assert.equal(param.errorType, "API_ERROR");
    assert.match(param.recovery ?? "", /10000/);
    assert.equal(mapApiError({ code: 1069399 }).retryable, true);
  });
});

// ── Command handlers ──

describe("comment command", { concurrency: 1 }, () => {
  let homeDir: string;
  let restore: (() => void) | undefined;
  let output: ReturnType<typeof captureOutput> | undefined;

  before(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "comment-cmd-"));
  });
  after(async () => {
    await rm(homeDir, { recursive: true, force: true }).catch(() => {});
  });
  afterEach(() => {
    output?.restore();
    output = undefined;
    restore?.();
    restore = undefined;
  });

  const env = () => ({
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_USER_TOKEN: undefined as unknown as string,
    HOME: homeDir,
  });

  async function run(sub: string, args: CommandArgs, opts: Partial<GlobalOpts> = {}) {
    return withCleanEnv(env(), () =>
      meta.subcommands[sub].handler(args, makeGlobalOpts(opts)),
    );
  }

  const DOC_URL = "https://x.feishu.cn/docx/doxTOKEN";
  const users = route("GET", "/contact/v3/users/batch", () =>
    ok({ items: [{ open_id: "ou_author", name: "张三" }] }),
  );

  it("list --json outputs normalized comments with names", async () => {
    const m = mockFetch([users, route("GET", COMMENTS, () => ok({ items: [card("1")], has_more: false }))]);
    restore = m.restore;
    output = captureOutput();
    await run("list", { positionals: [DOC_URL] }, { json: true });
    const out = output.stdoutJson() as Record<string, any>;
    assert.equal(out.success, true);
    assert.equal(out.file_type, "docx");
    assert.equal(out.count, 1);
    assert.equal(out.comments[0].user_name, "张三");
    assert.deepEqual(out.comments[0].anchor, { status: "exact", block_id: "blk_1" });
    assert.equal(out.comments[0].replies[0].text, "body-1");
  });

  it("list human output shows state, anchor, quote and replies", async () => {
    const m = mockFetch([
      users,
      route("GET", COMMENTS, () =>
        ok({ items: [card("1", { is_whole: true, quote: "" })], has_more: false }),
      ),
    ]);
    restore = m.restore;
    output = captureOutput();
    await run("list", { positionals: [DOC_URL] });
    const text = output.stdout();
    assert.match(text, /共 1 条评论/);
    assert.match(text, /1 {2}\[未解决\] {2}全文评论/);
    assert.match(text, /张三 \(2024-11-16T23:33:20\.000Z\): body-1/);
  });

  it("list rejects invalid --status and legacy doc", async () => {
    await assert.rejects(run("list", { positionals: [DOC_URL], status: "done" }), /--status/);
    const m = mockFetch([]);
    restore = m.restore;
    await assert.rejects(
      run("list", { positionals: ["https://x.feishu.cn/doc/doccnOLD"] }),
      (err: CliError) => err.errorType === "NOT_SUPPORTED",
    );
  });

  it("list accepts spreadsheets", async () => {
    const m = mockFetch([route("GET", "/files/shtTOKEN/comments", () => ok({ items: [], has_more: false }))]);
    restore = m.restore;
    output = captureOutput();
    await run("list", { positionals: ["https://x.feishu.cn/sheets/shtTOKEN"] });
    assert.match(output.stdout(), /没有评论/);
  });

  it("add posts a block comment", async () => {
    const m = mockFetch([route("POST", "/files/doxTOKEN/new_comments", () => ok({ comment_id: "c1" }))]);
    restore = m.restore;
    output = captureOutput();
    await run("add", { positionals: [DOC_URL], text: "看下", block: "blk_1" }, { json: true });
    assert.deepEqual(output.stdoutJson(), {
      success: true,
      file_token: "doxTOKEN",
      comment_id: "c1",
      anchor: { status: "exact", block_id: "blk_1" },
    });
    assert.deepEqual((m.calls[0].body as Record<string, unknown>).anchor, { block_id: "blk_1" });
  });

  it("add validates content before any request", async () => {
    const m = mockFetch([]);
    restore = m.restore;
    await assert.rejects(run("add", { positionals: [DOC_URL] }), /--text 或 --elements/);
    await assert.rejects(run("add", { positionals: [DOC_URL], text: "x", block: "" }), /--block/);
    assert.equal(m.calls.length, 0);
  });

  it("add rejects spreadsheets", async () => {
    const m = mockFetch([]);
    restore = m.restore;
    await assert.rejects(
      run("add", { positionals: ["https://x.feishu.cn/sheets/shtTOKEN"], text: "x" }),
      (err: CliError) => err.errorType === "NOT_SUPPORTED" && /仅支持 docx/.test(err.recovery ?? ""),
    );
  });

  it("reply posts and prints reply id", async () => {
    const m = mockFetch([route("POST", `${COMMENTS}/123/replies`, () => ok({ reply_id: "r1" }))]);
    restore = m.restore;
    output = captureOutput();
    await run("reply", { positionals: [DOC_URL, "123"], text: "好的" });
    assert.match(output.stdout(), /已回复评论 123: r1/);
  });

  it("reply requires a valid comment id", async () => {
    await assert.rejects(run("reply", { positionals: [DOC_URL], text: "x" }), /用法/);
    await assert.rejects(run("reply", { positionals: [DOC_URL, "../1"], text: "x" }), /comment_id/);
  });

  it("reply keeps 1069302 guidance when the comment exists and is local", async () => {
    const m = mockFetch([
      route("POST", `${COMMENTS}/123/replies`, () => ({ code: 1069302, msg: "param error" })),
      route("GET", COMMENTS, () => ok({ items: [card("123")], has_more: false })),
    ]);
    restore = m.restore;
    await assert.rejects(
      run("reply", { positionals: [DOC_URL, "123"], text: "x" }),
      (err: CliError) => err.apiCode === 1069302 && /comment add/.test(err.recovery ?? ""),
    );
    // Lookup lists all statuses (no is_solved filter).
    assert.equal(m.calls[1].url.searchParams.has("is_solved"), false);
  });

  it("reply to a whole-document comment reports NOT_SUPPORTED", async () => {
    const m = mockFetch([
      route("POST", `${COMMENTS}/123/replies`, () => ({ code: 1069302, msg: "does not allow replies" })),
      route("GET", COMMENTS, () => ok({ items: [card("123", { is_whole: true })], has_more: false })),
    ]);
    restore = m.restore;
    await assert.rejects(
      run("reply", { positionals: [DOC_URL, "123"], text: "x" }),
      (err: CliError) => err.errorType === "NOT_SUPPORTED" && /comment add/.test(err.recovery ?? ""),
    );
  });

  it("resolve of a missing comment reports NOT_FOUND instead of retryable 1069301", async () => {
    const m = mockFetch([
      route("PATCH", `${COMMENTS}/999`, () => ({ code: 1069301, msg: "fail" })),
      route("GET", COMMENTS, () => ok({ items: [card("123")], has_more: false })),
    ]);
    restore = m.restore;
    await assert.rejects(
      run("resolve", { positionals: [DOC_URL, "999"] }),
      (err: CliError) => err.errorType === "NOT_FOUND" && !err.retryable,
    );
  });

  it("resolve passes the original error through when the lookup fails", async () => {
    const m = mockFetch([
      route("PATCH", `${COMMENTS}/123`, () => ({ code: 1069301, msg: "fail" })),
      route("GET", COMMENTS, () => ({ code: 1069399, msg: "internal" })),
    ]);
    restore = m.restore;
    await assert.rejects(
      run("resolve", { positionals: [DOC_URL, "123"] }),
      (err: CliError) => err.apiCode === 1069301 && err.retryable,
    );
  });

  it("add on a missing block reports INVALID_ARGS", async () => {
    const m = mockFetch([
      route("POST", "/files/doxTOKEN/new_comments", () => ({ code: 1069301, msg: "General operation failure" })),
      route("GET", "/docx/v1/documents/doxTOKEN/blocks/blk_gone", () => ({ code: 1770002, msg: "not found" })),
    ]);
    restore = m.restore;
    await assert.rejects(
      run("add", { positionals: [DOC_URL], text: "x", block: "blk_gone" }),
      (err: CliError) => err.errorType === "INVALID_ARGS" && /read <url> --blocks/.test(err.recovery ?? ""),
    );
  });

  it("add keeps 1069301 when the block exists", async () => {
    const m = mockFetch([
      route("POST", "/files/doxTOKEN/new_comments", () => ({ code: 1069301, msg: "General operation failure" })),
      route("GET", "/docx/v1/documents/doxTOKEN/blocks/blk_1", () => ok({ block: { block_id: "blk_1" } })),
    ]);
    restore = m.restore;
    await assert.rejects(
      run("add", { positionals: [DOC_URL], text: "x", block: "blk_1" }),
      (err: CliError) => err.apiCode === 1069301,
    );
  });

  it("resolve and reopen toggle is_solved", async () => {
    const m = mockFetch([route("PATCH", `${COMMENTS}/123`, () => ok())]);
    restore = m.restore;
    output = captureOutput();
    await run("resolve", { positionals: [DOC_URL, "123"] }, { json: true });
    await run("reopen", { positionals: [DOC_URL, "123"] });
    assert.deepEqual(m.calls.map((c) => c.body), [{ is_solved: true }, { is_solved: false }]);
    assert.match(output.stdout(), /"is_solved":true/);
    assert.match(output.stdout(), /已重新打开评论 123/);
  });
});
