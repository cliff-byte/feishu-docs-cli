import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeScopes, buildScopeHint, BASE_SCOPES } from "../src/scopes.js";

describe("mergeScopes", () => {
  it("returns a copy of current when extra is empty", () => {
    const current = ["wiki:wiki", "docx:document"];
    const result = mergeScopes(current, []);
    assert.deepEqual(result, current);
    // must not mutate input
    assert.notEqual(result, current);
  });

  it("appends new scopes not already in current", () => {
    const result = mergeScopes(["wiki:wiki"], ["drive:drive"]);
    assert.deepEqual(result, ["wiki:wiki", "drive:drive"]);
  });

  it("deduplicates scopes that already exist in current", () => {
    const result = mergeScopes(
      ["wiki:wiki", "docx:document"],
      ["wiki:wiki", "drive:drive"],
    );
    assert.deepEqual(result, ["wiki:wiki", "docx:document", "drive:drive"]);
  });

  it("deduplicates within extra itself", () => {
    const result = mergeScopes(["wiki:wiki"], ["drive:drive", "drive:drive"]);
    assert.deepEqual(result, ["wiki:wiki", "drive:drive"]);
  });

  it("does not mutate the current array", () => {
    const current = ["wiki:wiki"];
    mergeScopes(current, ["drive:drive"]);
    assert.deepEqual(current, ["wiki:wiki"]);
  });

  it("does not mutate the extra array", () => {
    const extra = ["drive:drive"];
    mergeScopes(["wiki:wiki"], extra);
    assert.deepEqual(extra, ["drive:drive"]);
  });

  it("returns empty array when both inputs are empty", () => {
    assert.deepEqual(mergeScopes([], []), []);
  });
});

describe("buildScopeHint", () => {
  it("includes the missing scope in the output", () => {
    const hint = buildScopeHint(["drive:drive"]);
    assert.ok(hint.includes("drive:drive"));
  });

  it("includes the authorize command in the output", () => {
    const hint = buildScopeHint(["drive:drive"]);
    assert.ok(hint.includes("feishu-docs authorize"));
  });

  it("includes all missing scopes when multiple are given", () => {
    const hint = buildScopeHint([
      "drive:drive",
      "contact:contact.base:readonly",
    ]);
    assert.ok(hint.includes("drive:drive"));
    assert.ok(hint.includes("contact:contact.base:readonly"));
  });
});

describe("BASE_SCOPES", () => {
  it("contains all expected no-review scopes including offline_access", () => {
    assert.deepEqual(BASE_SCOPES, [
      "offline_access",
      "wiki:wiki",
      "docx:document",
      "docx:document.block:convert",
      "sheets:spreadsheet:readonly",
      "board:whiteboard:node:read",
      "bitable:app:readonly",
      "docs:document.media:download",
    ]);
  });
});
