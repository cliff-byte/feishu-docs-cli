import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePatchInput, patchDocument, replaceBlockText } from "../src/services/doc-patch.js";
import { CliError, formatError } from "../src/utils/errors.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import type { AuthInfo, Block } from "../src/types/index.js";

const auth: AuthInfo = { mode: "user", userToken: "test-token", useLark: false };
const edit = { block_id: "block1", old_text: "待定", new_text: "已更新" };
const input = { document_revision_id: 7, edits: [edit] };
const block: Block = {
  block_id: "block1", block_type: 2, parent_id: "doc1",
  text: { style: { align: 2 }, elements: [
    { text_run: { content: "状态待定。", text_element_style: { bold: true, link: { url: "https%3A%2F%2Fexample.com" } } } },
    { mention_user: { user_id: "ou_test1" } },
    { text_run: { content: "请确认。" } },
    { mention_user: { user_id: "ou_test2" } },
  ] },
};
const ok = (data: unknown) => jsonResponse({ code: 0, data });
const info = (revision = 7) => ok({ document: { revision_id: revision } });
const page = (items: Block[] = [block]) => ok({ items, has_more: false });
const preflight = () => [info(), page(), info()];
function isError(type: string) {
  return (err: unknown) => {
    assert.ok(err instanceof CliError);
    assert.equal(err.errorType, type);
    assert.ok(err.recovery);
    return true;
  };
}

describe("patch input and element preservation", () => {
  it("accepts revision zero and empty replacement", () => {
    assert.deepEqual(parsePatchInput(JSON.stringify({ document_revision_id: 0, edits: [{ ...edit, new_text: "" }] })),
      { document_revision_id: 0, edits: [{ ...edit, new_text: "" }] });
  });
  for (const value of [null, [], {}, { ...input, document_revision_id: -1 },
    { ...input, document_revision_id: "7" }, { ...input, document_revision_id: 1.5 },
    { ...input, document_revision_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, unexpected: true }, { ...input, edits: [] },
    { ...input, edits: Array.from({ length: 201 }, (_, i) => ({ ...edit, block_id: `b${i}` })) },
    { ...input, edits: [edit, edit] }, { ...input, edits: [null] },
    ...[{ block_id: "../bad" }, { block_id: 1 }, { old_text: "" }, { new_text: null },
      { new_text: "待定" }, { oldText: "typo" }].map((overrides) => ({ ...input, edits: [{ ...edit, ...overrides }] })),
  ]) {
    it(`rejects invalid input ${JSON.stringify(value).slice(0, 110)}`, () => {
      assert.throws(() => parsePatchInput(JSON.stringify(value)), isError("INVALID_ARGS"));
    });
  }
  it("rejects malformed JSON without echoing input", () => {
    assert.throws(() => parsePatchInput("secret-not-json"), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.ok(!err.message.includes("secret-not-json"));
      return true;
    });
  });
  it("preserves both mentions, styles, comments and original objects", () => {
    const source = { ...block, text: { ...block.text!, elements: [
      { text_run: { content: "状态待定。", text_element_style: { bold: true, comment_ids: ["comment1"] } } },
      ...block.text!.elements.slice(1),
    ] } };
    const before = structuredClone(source);
    const result = replaceBlockText(source, edit);
    assert.deepEqual(source, before);
    assert.deepEqual(result, [
      { text_run: { content: "状态已更新。", text_element_style: { bold: true, comment_ids: ["comment1"] } } },
      ...before.text.elements.slice(1),
    ]);
  });
  it("treats replacement characters and emoji literally", () => {
    const result = replaceBlockText(block, { ...edit, new_text: "$&$`😀" });
    assert.equal(result[0].text_run?.content, "状态$&$`😀。");
  });
  it("supports deleting part of a run", () => {
    assert.equal(replaceBlockText(block, { ...edit, new_text: "" })[0].text_run?.content, "状态。");
  });
  it("rejects absent, duplicate, overlapping, and cross-element matches", () => {
    for (const contents of [["无匹配"], ["待定待定"], ["待定", "待定"], ["待", "定"]]) {
      assert.throws(() => replaceBlockText({ ...block, text: { elements: contents.map((content) => ({ text_run: { content } })) } }, edit), isError("INVALID_ARGS"));
    }
    assert.throws(() => replaceBlockText({ ...block, text: { elements: [{ text_run: { content: "aaa" } }] } },
      { ...edit, old_text: "aa" }), isError("INVALID_ARGS"));
    assert.throws(() => replaceBlockText(block, { ...edit, old_text: "。请" }), isError("INVALID_ARGS"));
  });
  it("supports headings and text blocks inside table cells", () => {
    assert.equal(replaceBlockText({ ...block, block_type: 3, heading1: block.text }, edit)[0].text_run?.content, "状态已更新。");
    assert.equal(replaceBlockText({ ...block, parent_id: "cell1" }, edit)[0].text_run?.content, "状态已更新。");
  });
  it("rejects structural blocks and unknown inline elements", () => {
    assert.throws(() => replaceBlockText({ ...block, block_type: 31 }, edit), isError("NOT_SUPPORTED"));
    assert.throws(() => replaceBlockText({ ...block, text: { elements: [...block.text!.elements, { undefined: {} }] } }, edit), isError("NOT_SUPPORTED"));
  });
});

describe("patch API workflow", { concurrency: 1 }, () => {
  for (const prefix of [[], [info()], [info(), page()]]) {
    it("normalizes preflight network errors without exposing underlying data", async () => {
      const mock = setupMockFetch({ responses: [...prefix, () => { throw new TypeError("network-private-data"); }] });
      try {
        await assert.rejects(() => patchDocument(auth, "doc1", input, false), (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "API_ERROR");
          assert.ok(err.recovery);
          assert.deepEqual(err.details, { write_may_have_applied: false });
          assert.ok(!err.message.includes("network-private-data"));
          return true;
        });
        assert.ok(mock.calls.every((call) => call.init?.method === "GET"));
      } finally { mock.restore(); }
    });
  }
  it("reports a revision jump as an uncertain write, never a prevented write", async () => {
    const mock = setupMockFetch({ responses: [...preflight(), ok({ document_revision_id: 9 })] });
    try {
      await assert.rejects(() => patchDocument(auth, "doc1", input, false), (err: unknown) => {
        assert.ok(err instanceof CliError);
        const output = JSON.parse(formatError(err, true));
        assert.equal(output.success, false);
        assert.equal(output.error.type, "API_ERROR");
        assert.deepEqual(output.error.details, { write_may_have_applied: true, base_revision_id: 7, document_revision_id: 9 });
        assert.ok(err.message.includes("可能已生效"));
        assert.ok(err.recovery?.includes("不要直接重试"));
        return true;
      });
      assert.equal(mock.calls.filter((call) => call.init?.method === "PATCH").length, 1);
    } finally { mock.restore(); }
  });
  it("reports transport failures during write as possibly applied", async () => {
    const mock = setupMockFetch({ responses: [...preflight(), () => { throw new TypeError("socket failure"); }] });
    try {
      await assert.rejects(() => patchDocument(auth, "doc1", input, false), (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.deepEqual(err.details, { write_may_have_applied: true });
        return true;
      });
    } finally { mock.restore(); }
  });
  it("dry-run only reads and reports the concrete changes", async () => {
    const mock = setupMockFetch({ responses: preflight() });
    try {
      const result = await patchDocument(auth, "doc1", input, true);
      assert.equal(result.updated_blocks, 0);
      assert.deepEqual(result.changes, [edit]);
      assert.ok(mock.calls.every((call) => call.init?.method === "GET"));
    } finally { mock.restore(); }
  });
  it("reads every page at the expected revision and sends only edited blocks", async () => {
    const other: Block = { block_id: "other", block_type: 2, text: { elements: [{ text_run: { content: "不变" } }] } };
    const mock = setupMockFetch({ responses: [info(), ok({ items: [other], has_more: true, page_token: "page2" }),
      page(), info(), ok({ document_revision_id: 8 })] });
    try {
      const result = await patchDocument(auth, "doc1", input, false);
      assert.equal(result.document_revision_id, 8);
      assert.equal(result.updated_blocks, 1);
      assert.equal(new URL(mock.calls[1].url).searchParams.get("document_revision_id"), "7");
      assert.equal(new URL(mock.calls[2].url).searchParams.get("page_token"), "page2");
      assert.equal(new URL(mock.calls[2].url).searchParams.get("document_revision_id"), "7");
      const request = mock.calls.at(-1)!;
      assert.equal(request.init?.method, "PATCH");
      assert.equal(new URL(request.url).searchParams.get("document_revision_id"), "7");
      assert.equal(new URL(request.url).searchParams.get("user_id_type"), "open_id");
      assert.ok(new URL(request.url).searchParams.get("client_token"));
      assert.deepEqual(JSON.parse(request.init!.body as string), { requests: [
        { block_id: "block1", update_text_elements: { elements: replaceBlockText(block, edit) } },
      ] });
    } finally { mock.restore(); }
  });
  it("does not fall back from revision zero to latest", async () => {
    const mock = setupMockFetch({ responses: [info(0), page(), info(0), ok({ document_revision_id: 1 })] });
    try {
      await patchDocument(auth, "doc1", { ...input, document_revision_id: 0 }, false);
      assert.equal(new URL(mock.calls.at(-1)!.url).searchParams.get("document_revision_id"), "0");
    } finally { mock.restore(); }
  });
  for (const responses of [[info(8)], [info(), page(), info(8)]]) {
    it("stops on a revision conflict before any write", async () => {
      const mock = setupMockFetch({ responses });
      try {
        await assert.rejects(() => patchDocument(auth, "doc1", input, false), isError("API_ERROR"));
        assert.ok(mock.calls.every((call) => call.init?.method === "GET"));
      } finally { mock.restore(); }
    });
  }
  it("validates all edits before writing any of them", async () => {
    const mock = setupMockFetch({ responses: [info(), page()] });
    try {
      await assert.rejects(() => patchDocument(auth, "doc1", { ...input, edits: [edit, { ...edit, block_id: "missing" }] }, false), isError("NOT_FOUND"));
      assert.ok(mock.calls.every((call) => call.init?.method === "GET"));
    } finally { mock.restore(); }
  });
  it("validates path input before making requests", async () => {
    const mock = setupMockFetch({ responses: [] });
    try {
      await assert.rejects(() => patchDocument(auth, "../bad", input, false), isError("INVALID_ARGS"));
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  });
  for (const failure of [jsonResponse({ code: 1770064, msg: "revision conflict" }),
    jsonResponse({}, 503), ok({}), ok({ document_revision_id: 7 })]) {
    it("reports unconfirmed or conflicting writes without retrying", async () => {
      const mock = setupMockFetch({ responses: [...preflight(), failure] });
      try {
        await assert.rejects(() => patchDocument(auth, "doc1", input, false), isError("API_ERROR"));
        assert.equal(mock.calls.filter((call) => call.init?.method === "PATCH").length, 1);
      } finally { mock.restore(); }
    });
  }
  it("preserves actionable scope errors", async () => {
    const mock = setupMockFetch({ responses: [...preflight(), jsonResponse({ code: 99991672, msg: "permission denied" })] });
    try {
      await assert.rejects(() => patchDocument(auth, "doc1", input, false), isError("SCOPE_MISSING"));
    } finally { mock.restore(); }
  });
});
