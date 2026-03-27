/**
 * Tests for zero-dependency concurrency limiter (pLimit).
 *
 * Covers: concurrency enforcement, all-success, partial-failure,
 * all-failure, serial execution, input validation, empty task list.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pLimit } from "../src/utils/concurrency.js";

/**
 * Create a delayed async function that tracks active/peak concurrency.
 */
function makeTracker() {
  let active = 0;
  let peak = 0;
  return {
    get peak() { return peak; },
    get active() { return active; },
    task<T>(value: T, ms: number): () => Promise<T> {
      return () => new Promise<T>((resolve) => {
        active++;
        if (active > peak) peak = active;
        setTimeout(() => {
          active--;
          resolve(value);
        }, ms);
      });
    },
    failTask(ms: number): () => Promise<never> {
      return () => new Promise<never>((_, reject) => {
        active++;
        if (active > peak) peak = active;
        setTimeout(() => {
          active--;
          reject(new Error("task failed"));
        }, ms);
      });
    },
  };
}

describe("pLimit", { concurrency: 1 }, () => {
  it("pLimit(3) allows exactly 3 concurrent tasks, queues the rest", async () => {
    const limit = pLimit(3);
    const tracker = makeTracker();

    const promises = [
      limit(tracker.task("a", 50)),
      limit(tracker.task("b", 50)),
      limit(tracker.task("c", 50)),
      limit(tracker.task("d", 50)),
      limit(tracker.task("e", 50)),
    ];

    const results = await Promise.all(promises);
    assert.deepEqual(results, ["a", "b", "c", "d", "e"]);
    assert.equal(tracker.peak, 3, "peak concurrency should be exactly 3");
  });

  it("all tasks succeed with correct values", async () => {
    const limit = pLimit(2);

    const results = await Promise.all([
      limit(() => Promise.resolve(1)),
      limit(() => Promise.resolve(2)),
      limit(() => Promise.resolve(3)),
    ]);

    assert.deepEqual(results, [1, 2, 3]);
  });

  it("partial failure -- some tasks reject, others still complete", async () => {
    const limit = pLimit(2);
    const tracker = makeTracker();

    const results = await Promise.allSettled([
      limit(tracker.task("ok1", 10)),
      limit(tracker.failTask(10)),
      limit(tracker.task("ok2", 10)),
    ]);

    assert.equal(results[0].status, "fulfilled");
    assert.equal((results[0] as PromiseFulfilledResult<string>).value, "ok1");
    assert.equal(results[1].status, "rejected");
    assert.equal(results[2].status, "fulfilled");
    assert.equal((results[2] as PromiseFulfilledResult<string>).value, "ok2");
  });

  it("all tasks fail -- all promises reject independently", async () => {
    const limit = pLimit(2);
    const tracker = makeTracker();

    const results = await Promise.allSettled([
      limit(tracker.failTask(10)),
      limit(tracker.failTask(10)),
      limit(tracker.failTask(10)),
    ]);

    for (const r of results) {
      assert.equal(r.status, "rejected");
    }
  });

  it("pLimit(1) enforces strict serial execution", async () => {
    const limit = pLimit(1);
    const tracker = makeTracker();

    const promises = [
      limit(tracker.task("a", 20)),
      limit(tracker.task("b", 20)),
      limit(tracker.task("c", 20)),
    ];

    const results = await Promise.all(promises);
    assert.deepEqual(results, ["a", "b", "c"]);
    assert.equal(tracker.peak, 1, "peak concurrency should be exactly 1");
  });

  it("pLimit(0) throws TypeError", () => {
    assert.throws(() => pLimit(0), {
      name: "TypeError",
      message: /positive integer/,
    });
  });

  it("pLimit(-1) throws TypeError", () => {
    assert.throws(() => pLimit(-1), {
      name: "TypeError",
      message: /positive integer/,
    });
  });

  it("pLimit(1.5) throws TypeError (must be integer)", () => {
    assert.throws(() => pLimit(1.5), {
      name: "TypeError",
      message: /positive integer/,
    });
  });

  it("empty task list with pLimit -- no errors", async () => {
    const limit = pLimit(3);
    const results = await Promise.all([] as Promise<unknown>[]);
    assert.deepEqual(results, []);
    // Just verifying pLimit(3) was created without issues
    assert.ok(typeof limit === "function");
  });
});
