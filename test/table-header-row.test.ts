import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyTableHeaderRow,
  applyTableColumnWidth,
  DEFAULT_TABLE_WIDTH,
} from "../src/services/markdown-convert.js";
import { parseTableWidth } from "../src/utils/validate.js";
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

/** Build a flat [table, ...cell, ...text] block array from a text matrix. */
function tableBlocks(rows: string[][], columnWidth: number[]): Block[] {
  const cols = columnWidth.length;
  const extra: Block[] = [];
  const cellIds: string[] = [];
  let n = 0;
  for (const row of rows) {
    for (let c = 0; c < cols; c++) {
      const textId = `t${n}`;
      const cellId = `c${n}`;
      n++;
      extra.push({
        block_id: textId,
        block_type: BlockType.TEXT,
        text: { elements: [{ text_run: { content: row[c] } }] },
      } as Block);
      extra.push({
        block_id: cellId,
        block_type: BlockType.TABLE_CELL,
        children: [textId],
      } as unknown as Block);
      cellIds.push(cellId);
    }
  }
  const table = {
    block_id: "tb",
    block_type: BlockType.TABLE,
    table: {
      cells: cellIds,
      property: { row_size: rows.length, column_size: cols, column_width: columnWidth },
    },
  } as Block;
  return [table, ...extra];
}

const widthsOf = (blocks: Block[]): number[] =>
  blocks.find((b) => (b as { block_type?: number }).block_type === BlockType.TABLE)
    ?.table?.property?.column_width as number[];

describe("applyTableColumnWidth", () => {
  it("stays compact when content fits — does not stretch to fill (default target)", () => {
    // All columns short → natural widths sum well under the default target.
    const blocks = tableBlocks([["a", "bb"], ["c", "dd"]], [120, 120]);
    const out = widthsOf(applyTableColumnWidth(blocks));
    assert.ok(
      out.reduce((a, b) => a + b, 0) < DEFAULT_TABLE_WIDTH,
      "not stretched to fill",
    );
    assert.ok(out.every((w) => w >= 50), "every column at least the 50px min");
  });

  it("scales to exactly fill the target when content overflows", () => {
    const blocks = tableBlocks(
      [["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]],
      [240, 240, 240],
    );
    const out = widthsOf(applyTableColumnWidth(blocks, 200));
    assert.equal(out.reduce((a, b) => a + b, 0), 200, "fills the target exactly");
  });

  it("makes the content-heavy column widest and shrinks short ones", () => {
    const blocks = tableBlocks(
      [
        ["编号", "一个很长很长很长很长很长的场景描述内容", "x"],
        ["AC1", "y", "z"],
      ],
      [240, 240, 240],
    );
    const out = widthsOf(applyTableColumnWidth(blocks, 720));
    assert.ok(out[1] > out[0] && out[1] > out[2], "text-heavy column is widest");
    assert.equal(out[2], 50, "single-char column at the 50px min");
  });

  it("caps a single very-long column so it cannot dominate", () => {
    const long = "这是一段非常非常非常非常非常非常非常长的说明文字内容啊啊啊啊啊";
    const out = widthsOf(
      applyTableColumnWidth(tableBlocks([["x", long]], [120, 120]), 800),
    );
    assert.ok(out[1] <= Math.round(800 * 0.6), "long column capped at 60%");
    assert.equal(out[0], 50, "the other column keeps its small natural width");
  });

  it("counts CJK characters as double width", () => {
    const out = widthsOf(
      applyTableColumnWidth(tableBlocks([["中文字", "ab"]], [120, 120]), 815),
    );
    assert.ok(out[0] > out[1], "CJK column wider than the ASCII one");
  });

  it("does not mutate the input table block", () => {
    const blocks = tableBlocks([["编号", "长长长长的描述"]], [120, 120]);
    const before = [...(blocks[0].table!.property!.column_width as number[])];
    applyTableColumnWidth(blocks);
    assert.deepEqual(blocks[0].table!.property!.column_width, before);
  });

  it("skips a table with no column_width baseline", () => {
    const t = {
      block_id: "tb",
      block_type: BlockType.TABLE,
      table: { cells: ["c0"], property: { row_size: 1, column_size: 1 } },
    } as Block;
    const out = applyTableColumnWidth([t]);
    assert.equal(out[0], t);
  });

  it("leaves non-table blocks untouched", () => {
    const text = { block_type: BlockType.TEXT, text: { elements: [] } } as Block;
    assert.equal(applyTableColumnWidth([text])[0], text);
  });
});

describe("parseTableWidth", () => {
  it("returns undefined for missing values", () => {
    assert.equal(parseTableWidth(undefined), undefined);
    assert.equal(parseTableWidth(""), undefined);
  });

  it("parses a valid integer pixel value", () => {
    assert.equal(parseTableWidth("815"), 815);
  });

  it("throws on non-numeric or out-of-range values", () => {
    assert.throws(() => parseTableWidth("abc"));
    assert.throws(() => parseTableWidth("100")); // below min 200
    assert.throws(() => parseTableWidth("9000")); // above max 2000
    assert.throws(() => parseTableWidth("815.5")); // non-integer
  });
});
