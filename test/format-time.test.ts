/**
 * Tests for formatEpochSeconds — Feishu timestamp formatting helper.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatEpochSeconds } from "../src/utils/format-time.js";

describe("formatEpochSeconds", () => {
  it("formats a seconds-since-epoch string as ISO-8601", () => {
    assert.equal(formatEpochSeconds("1700000000"), "2023-11-14T22:13:20.000Z");
  });

  it("treats epoch 0 as a valid time, not missing", () => {
    assert.equal(formatEpochSeconds("0"), "1970-01-01T00:00:00.000Z");
  });

  it("returns undefined for undefined input", () => {
    assert.equal(formatEpochSeconds(undefined), undefined);
  });

  it("returns undefined for empty string", () => {
    assert.equal(formatEpochSeconds(""), undefined);
  });

  it("returns undefined for non-numeric input", () => {
    assert.equal(formatEpochSeconds("not-a-number"), undefined);
  });
});
