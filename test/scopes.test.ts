import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMissingScopes,
  mergeScopes,
  buildScopeHint,
  BASE_SCOPES,
  FEATURE_SCOPE_GROUPS,
  ALL_KNOWN_SCOPES,
} from "../src/scopes.js";

describe("getMissingScopes", () => {
  it("returns empty array when storedScope is undefined", () => {
    assert.deepEqual(getMissingScopes(undefined, ["wiki:wiki"]), []);
  });

  it("returns empty array when storedScope is empty string", () => {
    assert.deepEqual(getMissingScopes("", ["wiki:wiki"]), []);
  });

  it("returns missing scopes when they are absent from storedScope", () => {
    const stored = "wiki:wiki docx:document";
    assert.deepEqual(getMissingScopes(stored, ["drive:drive"]), ["drive:drive"]);
  });

  it("returns empty array when all required scopes are present", () => {
    const stored = "wiki:wiki docx:document drive:drive";
    assert.deepEqual(getMissingScopes(stored, ["wiki:wiki", "drive:drive"]), []);
  });

  it("returns only the missing scopes when some are present", () => {
    const stored = "wiki:wiki docx:document";
    const missing = getMissingScopes(stored, [
      "wiki:wiki",
      "drive:drive",
      "contact:contact.base:readonly",
    ]);
    assert.deepEqual(missing, ["drive:drive", "contact:contact.base:readonly"]);
  });

  it("handles extra whitespace in storedScope", () => {
    const stored = "  wiki:wiki   docx:document  ";
    assert.deepEqual(getMissingScopes(stored, ["wiki:wiki"]), []);
  });
});

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
    const result = mergeScopes(["wiki:wiki", "docx:document"], ["wiki:wiki", "drive:drive"]);
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
    const hint = buildScopeHint(["drive:drive", "contact:contact.base:readonly"]);
    assert.ok(hint.includes("drive:drive"));
    assert.ok(hint.includes("contact:contact.base:readonly"));
  });
});

describe("BASE_SCOPES", () => {
  it("contains the three expected no-review scopes", () => {
    assert.deepEqual(BASE_SCOPES, [
      "wiki:wiki",
      "docx:document",
      "docx:document.block:convert",
    ]);
  });
});

describe("FEATURE_SCOPE_GROUPS", () => {
  it("drive group contains drive:drive", () => {
    assert.ok(FEATURE_SCOPE_GROUPS.drive.scopes.includes("drive:drive"));
  });

  it("contact group contains contact:contact.base:readonly", () => {
    assert.ok(
      FEATURE_SCOPE_GROUPS.contact.scopes.includes(
        "contact:contact.base:readonly",
      ),
    );
  });

  it("every group has non-empty scopes, description, and commands", () => {
    for (const [name, group] of Object.entries(FEATURE_SCOPE_GROUPS)) {
      assert.ok(group.scopes.length > 0, `${name}: scopes must be non-empty`);
      assert.ok(group.description.length > 0, `${name}: description must be non-empty`);
      assert.ok(group.commands.length > 0, `${name}: commands must be non-empty`);
    }
  });
});

describe("ALL_KNOWN_SCOPES", () => {
  it("contains all BASE_SCOPES", () => {
    for (const s of BASE_SCOPES) {
      assert.ok(ALL_KNOWN_SCOPES.has(s), `expected ${s} in ALL_KNOWN_SCOPES`);
    }
  });

  it("contains all feature group scopes", () => {
    for (const group of Object.values(FEATURE_SCOPE_GROUPS)) {
      for (const s of group.scopes) {
        assert.ok(ALL_KNOWN_SCOPES.has(s), `expected ${s} in ALL_KNOWN_SCOPES`);
      }
    }
  });

  it("does not contain unknown scopes", () => {
    assert.ok(!ALL_KNOWN_SCOPES.has("bogus:scope"));
  });
});
