import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTableHeaderRow } from "../src/services/markdown-convert.js";
import { BlockType } from "../src/parser/block-types.js";
import type { Block } from "../src/types/index.js";

function tableBlock(headerRow?: boolean): Block {
  return {
    block_type: BlockType.TABLE,
    table: {
      cells: ["c1", "c2"],
      property: {
        row_size: 2,
        column_size: 2,
        ...(headerRow !== undefined ? { header_row: headerRow } : {}),
      },
    },
  } as Block;
}

describe("applyTableHeaderRow", () => {
  it("sets header_row=true on a table that has none", () => {
    const input = [tableBlock()];
    const out = applyTableHeaderRow(input);
    assert.equal(out[0].table?.property?.header_row, true);
  });

  it("does not mutate the input blocks (immutable)", () => {
    const input = [tableBlock()];
    const out = applyTableHeaderRow(input);
    assert.equal(input[0].table?.property?.header_row, undefined);
    assert.notEqual(out[0], input[0]);
  });

  it("leaves non-table blocks untouched (same reference)", () => {
    const text = { block_type: BlockType.TEXT, text: { elements: [] } } as Block;
    const out = applyTableHeaderRow([text]);
    assert.equal(out[0], text);
  });

  it("handles multiple tables and preserves other property fields", () => {
    const input = [tableBlock(), tableBlock()];
    const out = applyTableHeaderRow(input);
    assert.equal(out[0].table?.property?.header_row, true);
    assert.equal(out[1].table?.property?.header_row, true);
    assert.equal(out[0].table?.property?.row_size, 2);
    assert.equal(out[0].table?.property?.column_size, 2);
  });

  it("returns the same block reference when already header_row=true (no-op)", () => {
    const input = [tableBlock(true)];
    const out = applyTableHeaderRow(input);
    assert.equal(out[0], input[0]);
  });

  it("skips a table block that has no property", () => {
    const noProp = { block_type: BlockType.TABLE, table: { cells: [] } } as Block;
    const out = applyTableHeaderRow([noProp]);
    assert.equal(out[0], noProp);
  });
});
