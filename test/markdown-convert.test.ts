import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLangNames,
  stripMergeInfo,
} from "../src/services/markdown-convert.js";
import type { Block } from "../src/types/index.js";

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
    const input =
      "```objective-c\ncode1\n```\n\ntext\n\n```obj-c\ncode2\n```";
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

describe("stripMergeInfo", () => {
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

    const result = stripMergeInfo(blocks);
    assert.equal(result.length, 1);
    assert.equal(
      (result[0].table?.property as Record<string, unknown>).merge_info,
      undefined,
    );
    assert.equal(result[0].table?.property?.row_size, 2);
    assert.equal(result[0].table?.property?.column_size, 2);
  });

  it("should not modify blocks without table", () => {
    const blocks: Block[] = [
      { block_id: "b1", block_type: 2 } as Block,
    ];
    const result = stripMergeInfo(blocks);
    assert.deepEqual(result, blocks);
  });

  it("should not modify table blocks without merge_info", () => {
    const blocks: Block[] = [
      {
        block_id: "b1",
        block_type: 27,
        table: { property: { row_size: 1, column_size: 1 } },
      } as unknown as Block,
    ];
    const result = stripMergeInfo(blocks);
    assert.deepEqual(result, blocks);
  });

  it("should not mutate original blocks", () => {
    const original: Block[] = [
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

    const originalJson = JSON.stringify(original);
    stripMergeInfo(original);
    assert.equal(JSON.stringify(original), originalJson);
  });
});
