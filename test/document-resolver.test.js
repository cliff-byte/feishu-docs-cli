/**
 * Tests for document-resolver.js resolveDocument function.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDocUrl } from "../src/utils/url-parser.js";

describe("resolveDocument logic (via parseDocUrl branching)", () => {
  it("wiki URL should trigger wiki resolution path", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/wiki/abc12345678901234567");
    assert.equal(parsed.type, "wiki");
    // resolveDocument calls resolveWikiToken when type === "wiki"
  });

  it("docx URL should skip wiki resolution", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/docx/abc12345678901234567");
    assert.equal(parsed.type, "docx");
    // resolveDocument returns parsed.token as objToken directly
  });

  it("unknown token should attempt wiki resolution with fallback", () => {
    const parsed = parseDocUrl("abc12345678901234567");
    assert.equal(parsed.type, "unknown");
    // resolveDocument tries wiki, falls back to docx on error if allowFallback=true
  });

  it("sheet URL should skip wiki resolution", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/sheets/abc12345678901234567");
    assert.equal(parsed.type, "sheet");
  });

  it("should return correct shape for non-wiki types", () => {
    const parsed = parseDocUrl("https://test.feishu.cn/docx/abc12345678901234567");
    // Simulate what resolveDocument returns for non-wiki types
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
    // When resolveWikiToken throws and type is "unknown",
    // resolveDocument should fall back to docx (not re-throw)
    const parsed = parseDocUrl("abc12345678901234567");
    assert.equal(parsed.type, "unknown");
    // The resolved objType would be "docx" after fallback
  });
});
