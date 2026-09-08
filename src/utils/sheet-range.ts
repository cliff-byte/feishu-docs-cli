import { CliError } from "./errors.js";

/** One-based inclusive coordinates, independent of a worksheet token. */
export interface SheetRange {
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}

export function columnName(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function parseSheetRange(value: string): SheetRange {
  const match = typeof value === "string" && /^([A-Za-z]+)([1-9]\d*):([A-Za-z]+)([1-9]\d*)$/.exec(value);
  const invalid = () => new CliError("INVALID_ARGS", "无效的工作表范围", {
    recovery: "使用网格内的有限矩形范围，如 --range A1:F2000（不含工作表 ID）",
  });
  if (!match) throw invalid();
  const columnIndex = (letters: string) => [...letters.toUpperCase()].reduce(
    (n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0,
  );
  const range = {
    firstRow: Number(match[2]), lastRow: Number(match[4]),
    firstColumn: columnIndex(match[1]), lastColumn: columnIndex(match[3]),
  };
  if (!Object.values(range).every(Number.isSafeInteger) ||
      range.firstRow > range.lastRow || range.firstColumn > range.lastColumn ||
      !Number.isSafeInteger((range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1))) {
    throw invalid();
  }
  return range;
}

export function formatSheetRange(range: SheetRange): string {
  return `${columnName(range.firstColumn)}${range.firstRow}:${columnName(range.lastColumn)}${range.lastRow}`;
}
