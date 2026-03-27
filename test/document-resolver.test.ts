/**
 * Tests for document-resolver: parseDocUrl branching and resolveDocument function.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDocUrl } from "../src/utils/url-parser.js";
import { resolveDocument } from "../src/utils/document-resolver.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { CliError } from "../src/utils/errors.js";

describe("resolveDocument logic (via parseDocUrl branching)", () => {
  it("wiki URL should trigger wiki resolution path", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/wiki/abc12345678901234567");
    assert.equal(parsed.type, "wiki");
  });

  it("docx URL should skip wiki resolution", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/docx/abc12345678901234567");
    assert.equal(parsed.type, "docx");
  });

  it("unknown token should attempt wiki resolution with fallback", () => {
    const parsed = parseDocUrl("abc12345678901234567");
    assert.equal(parsed.type, "unknown");
  });

  it("sheet URL should skip wiki resolution", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/sheets/abc12345678901234567");
    assert.equal(parsed.type, "sheet");
  });

  it("should return correct shape for non-wiki types", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/docx/abc12345678901234567");
    const result = {
      objToken: parsed.token,
      objType: parsed.type,
      title: undefined,
      nodeToken: undefined,
      spaceId: undefined,
      hasChild: false,
      parsed,
    };
    assert.equal(result.objToken, "abc12345678901234567");
    assert.equal(result.objType, "docx");
    assert.equal(result.spaceId, undefined);
    assert.ok(result.parsed);
  });

  it("allowFallback defaults to true for unknown tokens", () => {
    const parsed = parseDocUrl("abc12345678901234567");
    assert.equal(parsed.type, "unknown");
  });
});

describe("resolveDocument", { concurrency: 1 }, () => {
  it("docx URL passes through without wiki API call", async () => {
    const auth = makeUserAuthInfo();
    // No mock needed -- resolveDocument should NOT call any API for docx type
    const { calls, restore } = setupMockFetch({ responses: [], strictCount: true });

    try {
      const result = await resolveDocument(
        auth,
        "https://test.feishu.cn/docx/abc12345678901234567",
      );

      assert.equal(result.objToken, "abc12345678901234567");
      assert.equal(result.objType, "docx");
      assert.equal(result.title, undefined);
      assert.equal(result.nodeToken, undefined);
      assert.equal(result.spaceId, undefined);
      assert.equal(result.hasChild, false);
      assert.equal(result.parsed.type, "docx");
      // No fetch calls should have been made
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  it("wiki URL resolves via wiki node API with full metadata", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore } = setupMockFetch({
      responses: [
        // resolveWikiToken -> fetchWithAuth (user mode, 1 fetch call)
        jsonResponse({
          code: 0,
          data: {
            node: {
              obj_token: "real-docx-token",
              obj_type: "docx",
              title: "Wiki Page",
              node_token: "wiki-node-token",
              space_id: "space-123",
              has_child: false,
            },
          },
        }),
      ],
    });

    try {
      const result = await resolveDocument(
        auth,
        "https://test.feishu.cn/wiki/abc12345678901234567",
      );

      assert.equal(result.objToken, "real-docx-token");
      assert.equal(result.objType, "docx");
      assert.equal(result.title, "Wiki Page");
      assert.equal(result.nodeToken, "wiki-node-token");
      assert.equal(result.spaceId, "space-123");
      assert.equal(result.hasChild, false);
      assert.equal(result.parsed.type, "wiki");
      // Exactly 1 fetch call for wiki resolution
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.includes("/wiki/v2/spaces/get_node"));
    } finally {
      restore();
    }
  });

  it("unknown token with wiki success resolves to wiki result", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            node: {
              obj_token: "resolved-token",
              obj_type: "docx",
              title: "Resolved Doc",
              node_token: "node-abc",
              space_id: "space-456",
              has_child: true,
            },
          },
        }),
      ],
    });

    try {
      const result = await resolveDocument(auth, "abc12345678901234567");

      assert.equal(result.objToken, "resolved-token");
      assert.equal(result.objType, "docx");
      assert.equal(result.title, "Resolved Doc");
      assert.equal(result.nodeToken, "node-abc");
      assert.equal(result.spaceId, "space-456");
      assert.equal(result.hasChild, true);
      assert.equal(result.parsed.type, "unknown");
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });

  it("unknown token with wiki failure + allowFallback=true falls back to docx", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore } = setupMockFetch({
      responses: [
        // Wiki resolution fails with NOT_FOUND
        jsonResponse({ code: 131001, msg: "not found" }),
      ],
    });

    try {
      const result = await resolveDocument(auth, "abc12345678901234567", {
        allowFallback: true,
      });

      // Should silently fall back to docx type
      assert.equal(result.objToken, "abc12345678901234567");
      assert.equal(result.objType, "docx");
      assert.equal(result.title, undefined);
      assert.equal(result.nodeToken, undefined);
      assert.equal(result.spaceId, undefined);
      assert.equal(result.parsed.type, "unknown");
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });

  it("unknown token with wiki failure + allowFallback=false throws CliError", async () => {
    const auth = makeUserAuthInfo();
    const { restore } = setupMockFetch({
      responses: [
        jsonResponse({ code: 131001, msg: "not found" }),
      ],
    });

    try {
      await assert.rejects(
        resolveDocument(auth, "abc12345678901234567", {
          allowFallback: false,
        }),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "NOT_FOUND");
          return true;
        },
      );
    } finally {
      restore();
    }
  });

  it("wiki URL with wiki failure always throws (no fallback)", async () => {
    const auth = makeUserAuthInfo();
    const { restore } = setupMockFetch({
      responses: [
        jsonResponse({ code: 131001, msg: "not found" }),
      ],
    });

    try {
      // Even with allowFallback=true, wiki URLs should throw on failure
      await assert.rejects(
        resolveDocument(
          auth,
          "https://test.feishu.cn/wiki/abc12345678901234567",
          { allowFallback: true },
        ),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "NOT_FOUND");
          return true;
        },
      );
    } finally {
      restore();
    }
  });
});
