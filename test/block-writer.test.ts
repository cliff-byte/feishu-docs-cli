/**
 * Tests for block-writer: sanitizeBlocks, clearDocument, backupDocument, rotateBackups.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sanitizeBlocks } from "../src/services/markdown-convert.js";
import {
  clearDocument,
  backupDocument,
  rotateBackups,
  getBackupsDir,
} from "../src/services/block-writer.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { CliError } from "../src/utils/errors.js";
import type { Block } from "../src/types/index.js";

/**
 * Helper to advance mock timers periodically until a promise resolves.
 * This avoids the deadlock where clearDocument awaits sleep() but the
 * mock timer hasn't been ticked yet.
 */
function resolveWithTimers(
  promise: Promise<unknown>,
  t: { mock: { timers: { tick: (ms: number) => void } } },
  tickMs = 500,
  intervalMs = 10,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    promise
      .then((val) => {
        done = true;
        resolve(val);
      })
      .catch((err) => {
        done = true;
        reject(err);
      });

    // Use real setInterval (not mocked) to tick the mock timer
    const realSetInterval = globalThis.setInterval;
    const handle = realSetInterval(() => {
      if (done) {
        clearInterval(handle);
        return;
      }
      try {
        t.mock.timers.tick(tickMs);
      } catch {
        // Timer already reset or no pending timers -- ignore
      }
    }, intervalMs);
  });
}

describe("sanitizeBlocks (from block-writer perspective)", () => {
  it("should remove merge_info from table blocks in array", () => {
    const blocks: Block[] = [
      {
        block_id: "blk-1",
        block_type: 31,
        table: {
          property: {
            row_size: 3,
            column_size: 2,
            merge_info: [{ row_span: 1, col_span: 1 }],
          },
        },
      } as unknown as Block,
      {
        block_id: "blk-2",
        block_type: 2,
        text: { elements: [{ text_run: { content: "hello" } }] },
      } as unknown as Block,
    ];

    const result = sanitizeBlocks(blocks);

    // Table block should have merge_info removed
    assert.equal(result[0].table?.property?.row_size, 3);
    assert.equal(result[0].table?.property?.column_size, 2);
    assert.equal(
      (result[0].table?.property as Record<string, unknown>).merge_info,
      undefined,
    );

    // Non-table block should be unchanged
    assert.equal(result[1].block_id, "blk-2");

    // Original array should be unmodified (immutability)
    assert.ok(
      (blocks[0].table?.property as Record<string, unknown>).merge_info,
    );
  });
});

describe("clearDocument", { concurrency: 1 }, () => {
  it("returns current revision immediately when document has no children", async (t) => {
    const auth = makeUserAuthInfo();

    t.mock.timers.enable({ apis: ["setTimeout"] });

    const { calls, restore } = setupMockFetch({
      responses: [
        // getRootChildrenCount: block with no children
        jsonResponse({
          code: 0,
          data: {
            block: { block_id: "doc-123", children: [] },
          },
        }),
      ],
    });

    try {
      // No sleep needed here since no children -> loop doesn't execute
      const rev = await clearDocument(auth, "doc-123", 5);

      assert.equal(rev, 5);
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.includes("/blocks/doc-123"));
    } finally {
      restore();
    }
  });

  it("batches 75 children into 2 delete calls (end-to-start)", async (t) => {
    const auth = makeUserAuthInfo();
    const children = Array.from({ length: 75 }, (_, i) => `blk-${i}`);

    t.mock.timers.enable({ apis: ["setTimeout"] });

    const { calls, restore } = setupMockFetch({
      responses: [
        // 1. getRootChildrenCount
        jsonResponse({
          code: 0,
          data: { block: { block_id: "doc-123", children } },
        }),
        // 2. batch_delete (indices 25-75)
        jsonResponse({
          code: 0,
          data: { document_revision_id: 6 },
        }),
        // 3. batch_delete (indices 0-25)
        jsonResponse({
          code: 0,
          data: { document_revision_id: 7 },
        }),
      ],
    });

    try {
      const rev = await resolveWithTimers(
        clearDocument(auth, "doc-123", 5),
        t,
      ) as number;

      assert.equal(rev, 7);
      assert.equal(calls.length, 3);

      // First batch_delete: start_index=25, end_index=75
      const firstDeleteBody = JSON.parse(calls[1].init?.body as string);
      assert.equal(firstDeleteBody.start_index, 25);
      assert.equal(firstDeleteBody.end_index, 75);

      // Second batch_delete: start_index=0, end_index=25
      const secondDeleteBody = JSON.parse(calls[2].init?.body as string);
      assert.equal(secondDeleteBody.start_index, 0);
      assert.equal(secondDeleteBody.end_index, 25);
    } finally {
      restore();
    }
  });

  it("retries on conflict error (code 1770064)", async (t) => {
    const auth = makeUserAuthInfo();
    const children = Array.from({ length: 10 }, (_, i) => `blk-${i}`);

    t.mock.timers.enable({ apis: ["setTimeout"] });

    const { calls, restore } = setupMockFetch({
      responses: [
        // 1. getRootChildrenCount (initial)
        jsonResponse({
          code: 0,
          data: { block: { block_id: "doc-123", children } },
        }),
        // 2. batch_delete -> conflict error (code 1770064)
        jsonResponse({ code: 1770064, msg: "conflict" }),
        // 3. getDocumentInfo (re-fetch after conflict)
        jsonResponse({
          code: 0,
          data: {
            document: { title: "Test", revision_id: 10 },
          },
        }),
        // 4. getRootChildrenCount (re-fetch after conflict)
        jsonResponse({
          code: 0,
          data: {
            block: { block_id: "doc-123", children: children.slice(0, 5) },
          },
        }),
        // 5. batch_delete (retry succeeds)
        jsonResponse({
          code: 0,
          data: { document_revision_id: 11 },
        }),
      ],
    });

    try {
      const rev = await resolveWithTimers(
        clearDocument(auth, "doc-123", 5),
        t,
      ) as number;

      assert.equal(rev, 11);
      assert.equal(calls.length, 5);
    } finally {
      restore();
    }
  });

  it("throws after MAX_CONFLICT_RETRIES (5) exceeded", async (t) => {
    const auth = makeUserAuthInfo();
    const children = Array.from({ length: 10 }, (_, i) => `blk-${i}`);

    t.mock.timers.enable({ apis: ["setTimeout"] });

    // Build response sequence: initial getRootChildrenCount + 6 conflict cycles
    const responses: Response[] = [
      jsonResponse({
        code: 0,
        data: { block: { block_id: "doc-123", children } },
      }),
    ];

    // 6 conflict retries (threshold is > 5, so 6th throws)
    for (let i = 0; i < 6; i++) {
      responses.push(jsonResponse({ code: 1770064, msg: "conflict" }));
      if (i < 5) {
        // getDocumentInfo + getRootChildrenCount for retry
        responses.push(
          jsonResponse({
            code: 0,
            data: { document: { title: "Test", revision_id: 10 + i } },
          }),
        );
        responses.push(
          jsonResponse({
            code: 0,
            data: { block: { block_id: "doc-123", children } },
          }),
        );
      }
    }

    const { restore } = setupMockFetch({ responses });

    try {
      await assert.rejects(
        resolveWithTimers(clearDocument(auth, "doc-123", 5), t),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "API_ERROR");
          assert.ok(err.message.includes("并发编辑"));
          return true;
        },
      );
    } finally {
      restore();
    }
  });
});

describe("backupDocument", { concurrency: 1 }, () => {
  it("creates backup file with correct naming pattern and valid JSON", async () => {
    const auth = makeUserAuthInfo();
    const testDir = await mkdtemp(join(tmpdir(), "feishu-test-backup-"));
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = testDir;

      const mockBlocks = [
        { block_id: "root", block_type: 1, children: ["blk-1"] },
        { block_id: "blk-1", block_type: 2, text: { elements: [] } },
      ];

      const { restore } = setupMockFetch({
        responses: [
          // fetchAllBlocks (single page, no pagination)
          jsonResponse({
            code: 0,
            data: {
              items: mockBlocks,
              has_more: false,
            },
          }),
        ],
      });

      try {
        const result = await backupDocument(auth, "testdoc123");

        // Check file was created with correct naming
        assert.ok(result.filepath.includes("testdoc123-"));
        assert.ok(result.filepath.endsWith(".json"));

        // Check it's in the redirected backups dir
        const expectedDir = join(testDir, ".feishu-docs", "backups");
        assert.ok(result.filepath.startsWith(expectedDir));

        // Check blocks returned match
        assert.equal(result.blocks.length, 2);
        assert.equal(result.blocks[0].block_id, "root");

        // Verify the file contains valid JSON with correct data
        const content = await readFile(result.filepath, "utf8");
        const parsed = JSON.parse(content);
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0].block_id, "root");
      } finally {
        restore();
      }
    } finally {
      process.env.HOME = originalHome;
      await rm(testDir, { recursive: true, force: true });
    }
  });
});

describe("rotateBackups", { concurrency: 1 }, () => {
  it("keeps only the most recent 10 backups per document, deletes oldest", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-test-rotate-"));
    const backupsDir = join(testDir, ".feishu-docs", "backups");
    await mkdir(backupsDir, { recursive: true });
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = testDir;

      const docId = "testdoc456";
      const baseTime = 1700000000000;
      for (let i = 0; i < 12; i++) {
        const filename = `${docId}-${baseTime + i * 1000}.json`;
        await writeFile(join(backupsDir, filename), "[]", "utf8");
      }

      let files = await readdir(backupsDir);
      assert.equal(files.length, 12);

      await rotateBackups();

      files = await readdir(backupsDir);
      assert.equal(files.length, 10);

      const remaining = files.sort();
      // Oldest remaining should be timestamp index 2 (baseTime + 2000)
      assert.ok(remaining[0].includes(String(baseTime + 2000)));
      // Newest should be timestamp index 11
      assert.ok(remaining[9].includes(String(baseTime + 11000)));
    } finally {
      process.env.HOME = originalHome;
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("does not delete files when count is at or below 10", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-test-rotate2-"));
    const backupsDir = join(testDir, ".feishu-docs", "backups");
    await mkdir(backupsDir, { recursive: true });
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = testDir;

      const docId = "testdoc789";
      const baseTime = 1700000000000;
      for (let i = 0; i < 10; i++) {
        const filename = `${docId}-${baseTime + i * 1000}.json`;
        await writeFile(join(backupsDir, filename), "[]", "utf8");
      }

      await rotateBackups();

      const files = await readdir(backupsDir);
      assert.equal(files.length, 10);
    } finally {
      process.env.HOME = originalHome;
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
