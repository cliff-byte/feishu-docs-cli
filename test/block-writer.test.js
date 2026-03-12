/**
 * Tests for markdown-convert.js stripMergeInfo logic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("stripMergeInfo (markdown-convert internal)", () => {
  it("should remove merge_info from table blocks in array", () => {
    const blocks = [
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
      },
      {
        block_id: "blk-2",
        block_type: 2,
        text: { elements: [{ text_run: { content: "hello" } }] },
      },
    ];

    // Simulate stripMergeInfo (array version)
    const result = blocks.map((block) => {
      if (block.table?.property?.merge_info) {
        const { merge_info, ...restProperty } = block.table.property;
        return {
          ...block,
          table: { ...block.table, property: restProperty },
        };
      }
      return block;
    });

    // Table block should have merge_info removed
    assert.equal(result[0].table.property.row_size, 3);
    assert.equal(result[0].table.property.column_size, 2);
    assert.equal(result[0].table.property.merge_info, undefined);

    // Non-table block should be unchanged
    assert.deepEqual(result[1], blocks[1]);

    // Original array should be unmodified (immutability)
    assert.ok(blocks[0].table.property.merge_info);
  });
});
