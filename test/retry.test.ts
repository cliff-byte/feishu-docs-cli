/**
 * Tests for retry utility functions: calculateDelay, parseRetryAfter,
 * isRetryable, sleep, and DEFAULT_RETRY constant.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDelay,
  parseRetryAfter,
  isRetryable,
  sleep,
  DEFAULT_RETRY,
} from "../src/utils/retry.js";

describe("calculateDelay", () => {
  it("should return value in range [750, 1250] for attempt 0 with base 1000", () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateDelay(0, 1000, 10_000);
      assert.ok(delay >= 750, `delay ${delay} should be >= 750`);
      assert.ok(delay <= 1250, `delay ${delay} should be <= 1250`);
    }
  });

  it("should return value in range [1500, 2500] for attempt 1 with base 1000", () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateDelay(1, 1000, 10_000);
      assert.ok(delay >= 1500, `delay ${delay} should be >= 1500`);
      assert.ok(delay <= 2500, `delay ${delay} should be <= 2500`);
    }
  });

  it("should return value in range [3000, 5000] for attempt 2 with base 1000", () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateDelay(2, 1000, 10_000);
      assert.ok(delay >= 3000, `delay ${delay} should be >= 3000`);
      assert.ok(delay <= 5000, `delay ${delay} should be <= 5000`);
    }
  });

  it("should cap at maxDelay for high attempt numbers", () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateDelay(10, 1000, 10_000);
      // base is capped at 10000, jitter +/-25% => [7500, 12500]
      assert.ok(delay >= 7500, `delay ${delay} should be >= 7500`);
      assert.ok(delay <= 12500, `delay ${delay} should be <= 12500`);
    }
  });

  it("should always return >= 0", () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateDelay(0, 1, 1);
      assert.ok(delay >= 0, `delay ${delay} should be >= 0`);
    }
  });
});

describe("parseRetryAfter", () => {
  it("should return null for null input", () => {
    assert.equal(parseRetryAfter(null), null);
  });

  it("should return null for empty string", () => {
    assert.equal(parseRetryAfter(""), null);
  });

  it("should parse '2' as 2000ms", () => {
    assert.equal(parseRetryAfter("2"), 2000);
  });

  it("should cap '60' at 30000ms", () => {
    assert.equal(parseRetryAfter("60"), 30_000);
  });

  it("should return null for non-numeric 'abc'", () => {
    assert.equal(parseRetryAfter("abc"), null);
  });

  it("should return null for '0' (non-positive)", () => {
    assert.equal(parseRetryAfter("0"), null);
  });

  it("should return null for '-5' (negative)", () => {
    assert.equal(parseRetryAfter("-5"), null);
  });
});

describe("isRetryable", () => {
  it("should return true for 429", () => {
    assert.equal(isRetryable(429), true);
  });

  it("should return true for 502", () => {
    assert.equal(isRetryable(502), true);
  });

  it("should return true for 503", () => {
    assert.equal(isRetryable(503), true);
  });

  it("should return false for 500", () => {
    assert.equal(isRetryable(500), false);
  });

  it("should return false for 401", () => {
    assert.equal(isRetryable(401), false);
  });

  it("should return false for 404", () => {
    assert.equal(isRetryable(404), false);
  });

  it("should return true for 'AbortError'", () => {
    assert.equal(isRetryable("AbortError"), true);
  });

  it("should return false for 'TypeError'", () => {
    assert.equal(isRetryable("TypeError"), false);
  });
});

describe("DEFAULT_RETRY", () => {
  it("should have maxRetries 2, initialDelay 1000, maxDelay 10000", () => {
    assert.deepEqual(DEFAULT_RETRY, {
      maxRetries: 2,
      initialDelay: 1000,
      maxDelay: 10_000,
    });
  });
});

describe("sleep", () => {
  it("should resolve after specified delay", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const start = Date.now();
    const p = sleep(100);
    t.mock.timers.tick(100);
    await p;
    // Timer was mocked, so this should resolve immediately after tick
  });
});
