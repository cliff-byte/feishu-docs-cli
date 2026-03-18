import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLangNames,
  sanitizeBlocks,
  splitIntoBatches,
} from "../src/services/markdown-convert.js";
import type { Block, ConvertedBlocks } from "../src/types/index.js";

describe("normalizeLangNames", () => {
  it("should replace objective-c with objc", () => {
    const input = "```objective-c\nint x = 0;\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```objc\nint x = 0;\n```");
  });

  it("should replace obj-c with objc", () => {
    const input = "```obj-c\nint x = 0;\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```objc\nint x = 0;\n```");
  });

  it("should be case-insensitive", () => {
    const input = "```Objective-C\nint x = 0;\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```objc\nint x = 0;\n```");
  });

  it("should not modify recognized languages", () => {
    const input = "```javascript\nconst x = 1;\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```javascript\nconst x = 1;\n```");
  });

  it("should handle multiple code blocks", () => {
    const input = "```objective-c\ncode1\n```\n\ntext\n\n```obj-c\ncode2\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```objc\ncode1\n```\n\ntext\n\n```objc\ncode2\n```");
  });

  it("should not modify code blocks without language", () => {
    const input = "```\nplain code\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```\nplain code\n```");
  });

  it("should handle c++ and c# (keep as-is)", () => {
    const input = "```c++\ncode\n```\n```c#\ncode\n```";
    const result = normalizeLangNames(input);
    assert.equal(result, "```c++\ncode\n```\n```c#\ncode\n```");
  });
});

describe("sanitizeBlocks", () => {
  it("should remove merge_info from table blocks", () => {
    const blocks: Block[] = [
      {
        block_id: "b1",
        block_type: 27,
        table: {
          property: {
            row_size: 2,
            column_size: 2,
            merge_info: [{ row_span: 2, col_span: 1 }],
          },
        },
      } as unknown as Block,
    ];

    const result = sanitizeBlocks(blocks);
    assert.equal(result.length, 1);
    assert.equal(
      (result[0].table?.property as Record<string, unknown>).merge_info,
      undefined,
    );
    assert.equal(result[0].table?.property?.row_size, 2);
    assert.equal(result[0].table?.property?.column_size, 2);
  });

  it("should remove parent_id from blocks", () => {
    const blocks: Block[] = [
      { block_id: "b1", block_type: 2, parent_id: "root" } as Block,
    ];
    const result = sanitizeBlocks(blocks);
    assert.equal(result[0].parent_id, undefined);
    assert.equal(result[0].block_id, "b1");
  });

  it("should remove comment_ids from blocks", () => {
    const blocks = [
      { block_id: "b1", block_type: 2, comment_ids: ["c1", "c2"] },
    ] as unknown as Block[];
    const result = sanitizeBlocks(blocks);
    assert.equal((result[0] as Record<string, unknown>).comment_ids, undefined);
  });

  it("should strip multiple read-only fields at once", () => {
    const blocks = [
      {
        block_id: "b1",
        block_type: 31,
        parent_id: "root",
        comment_ids: ["c1"],
        table: {
          property: {
            row_size: 1,
            column_size: 1,
            merge_info: [{ row_span: 1, col_span: 1 }],
          },
        },
      },
    ] as unknown as Block[];

    const result = sanitizeBlocks(blocks);
    assert.equal(result[0].parent_id, undefined);
    assert.equal((result[0] as Record<string, unknown>).comment_ids, undefined);
    assert.equal(
      (result[0].table?.property as Record<string, unknown>).merge_info,
      undefined,
    );
    assert.equal(result[0].table?.property?.row_size, 1);
  });

  it("should not modify blocks without read-only fields", () => {
    const blocks: Block[] = [{ block_id: "b1", block_type: 2 } as Block];
    const result = sanitizeBlocks(blocks);
    assert.deepEqual(result, blocks);
  });

  it("should not mutate original blocks", () => {
    const original = [
      {
        block_id: "b1",
        block_type: 27,
        parent_id: "root",
        table: {
          property: {
            row_size: 2,
            column_size: 2,
            merge_info: [{ row_span: 2, col_span: 1 }],
          },
        },
      },
    ] as unknown as Block[];

    const originalJson = JSON.stringify(original);
    sanitizeBlocks(original);
    assert.equal(JSON.stringify(original), originalJson);
  });
});

describe("splitIntoBatches", () => {
  function makeBlock(id: string, children?: string[]): Block {
    return {
      block_id: id,
      block_type: 2,
      ...(children ? { children } : {}),
    } as Block;
  }

  it("should return single batch when under 1000 blocks", () => {
    const converted: ConvertedBlocks = {
      firstLevelBlockIds: ["a", "b"],
      blocks: [makeBlock("a"), makeBlock("b")],
      blockIdToImageUrls: {},
    };
    const batches = splitIntoBatches(converted);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].firstLevelBlockIds, ["a", "b"]);
  });

  it("should split at top-level boundaries when exceeding 1000", () => {
    // Create 600 top-level blocks, each with 1 child = 1200 total blocks
    const blocks: Block[] = [];
    const topIds: string[] = [];
    for (let i = 0; i < 600; i++) {
      const topId = `top_${i}`;
      const childId = `child_${i}`;
      topIds.push(topId);
      blocks.push(makeBlock(topId, [childId]));
      blocks.push(makeBlock(childId));
    }

    const converted: ConvertedBlocks = {
      firstLevelBlockIds: topIds,
      blocks,
      blockIdToImageUrls: {},
    };

    const batches = splitIntoBatches(converted);
    assert.equal(batches.length, 2);

    // Each batch should have its top-level IDs and their descendants
    const totalTopIds = batches.reduce(
      (sum, b) => sum + b.firstLevelBlockIds.length,
      0,
    );
    assert.equal(totalTopIds, 600);

    // No batch should exceed 1000 blocks
    for (const batch of batches) {
      assert.ok(batch.blocks.length <= 1000);
    }
  });

  it("should keep parent-child together in same batch", () => {
    // One top-level block with 3 children
    const converted: ConvertedBlocks = {
      firstLevelBlockIds: ["top1"],
      blocks: [
        makeBlock("top1", ["c1", "c2", "c3"]),
        makeBlock("c1"),
        makeBlock("c2"),
        makeBlock("c3"),
      ],
      blockIdToImageUrls: {},
    };

    const batches = splitIntoBatches(converted);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].blocks.length, 4);
  });

  it("should strip read-only fields in batched output", () => {
    const converted: ConvertedBlocks = {
      firstLevelBlockIds: ["a"],
      blocks: [{ block_id: "a", block_type: 2, parent_id: "root" } as Block],
      blockIdToImageUrls: {},
    };

    const batches = splitIntoBatches(converted);
    assert.equal(batches[0].blocks[0].parent_id, undefined);
  });

  it("should throw when a single top-level subtree exceeds 1000 blocks", () => {
    // Build 1 top-level block with 1001 descendants (chain)
    const blocks: Block[] = [];
    const childIds: string[] = [];
    for (let i = 0; i < 1001; i++) {
      childIds.push(`d_${i}`);
      blocks.push(makeBlock(`d_${i}`));
    }
    blocks.push(makeBlock("root", childIds));

    const converted: ConvertedBlocks = {
      firstLevelBlockIds: ["root"],
      blocks,
      blockIdToImageUrls: {},
    };

    assert.throws(
      () => splitIntoBatches(converted),
      /超过 Descendant API 限制/,
    );
  });

  it("should distribute blockIdToImageUrls across batches", () => {
    // Create 600 top-level blocks each with 1 child = 1200 total → 2 batches
    const blocks: Block[] = [];
    const topIds: string[] = [];
    for (let i = 0; i < 600; i++) {
      topIds.push(`top_${i}`);
      blocks.push(makeBlock(`top_${i}`, [`child_${i}`]));
      blocks.push(makeBlock(`child_${i}`));
    }

    const converted: ConvertedBlocks = {
      firstLevelBlockIds: topIds,
      blocks,
      blockIdToImageUrls: {
        top_0: "https://img/0",
        top_599: "https://img/599",
      },
    };

    const batches = splitIntoBatches(converted);
    assert.equal(batches.length, 2);

    // top_0 should be in first batch, top_599 in second
    assert.equal(batches[0].blockIdToImageUrls["top_0"], "https://img/0");
    assert.equal(batches[0].blockIdToImageUrls["top_599"], undefined);
    assert.equal(batches[1].blockIdToImageUrls["top_599"], "https://img/599");
    assert.equal(batches[1].blockIdToImageUrls["top_0"], undefined);
  });
});
