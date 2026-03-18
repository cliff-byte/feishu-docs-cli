/**
 * Tests for sanitizeBlocks logic (formerly stripMergeInfo).
 * More comprehensive tests are in markdown-convert.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeBlocks } from "../src/services/markdown-convert.js";
import type { Block } from "../src/types/index.js";

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
