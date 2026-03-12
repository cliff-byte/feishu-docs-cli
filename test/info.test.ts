/**
 * Tests for info command URL generation logic.
 * Tests use the same field structure as production code (doc.parsed.token).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("info URL generation", () => {
  // Mirror the exact URL construction logic from info.js
  function buildUrl(
    doc: {
      spaceId?: string;
      objType: string;
      objToken: string;
      parsed: { token: string; type: string };
    },
    useLark: boolean,
  ) {
    const domain = useLark ? "larksuite.com" : "feishu.cn";
    return doc.spaceId
      ? `https://${domain}/wiki/${doc.parsed.token}`
      : `https://${domain}/${doc.objType}/${doc.objToken}`;
  }

  it("should generate wiki URL for wiki documents", () => {
    const doc = {
      spaceId: "sp123",
      objType: "docx",
      objToken: "doc456",
      parsed: { token: "wiki789", type: "wiki" },
    };
    assert.equal(buildUrl(doc, false), "https://feishu.cn/wiki/wiki789");
  });

  it("should generate docx URL for drive documents", () => {
    const doc = {
      spaceId: undefined,
      objType: "docx",
      objToken: "doc456",
      parsed: { token: "doc456", type: "docx" },
    };
    assert.equal(buildUrl(doc, false), "https://feishu.cn/docx/doc456");
  });

  it("should use larksuite.com for lark mode", () => {
    const doc = {
      spaceId: "sp123",
      objType: "docx",
      objToken: "doc456",
      parsed: { token: "wiki789", type: "wiki" },
    };
    assert.equal(buildUrl(doc, true), "https://larksuite.com/wiki/wiki789");
  });

  it("should generate sheet URL for sheet type", () => {
    const doc = {
      spaceId: undefined,
      objType: "sheet",
      objToken: "sheet123",
      parsed: { token: "sheet123", type: "sheet" },
    };
    assert.equal(buildUrl(doc, false), "https://feishu.cn/sheet/sheet123");
  });
});
