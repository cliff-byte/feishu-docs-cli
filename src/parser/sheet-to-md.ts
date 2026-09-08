import type { SheetReadResult } from "../services/sheets.js";
import { columnName, parseSheetRange } from "../utils/sheet-range.js";

function escapeText(value: unknown): string {
  const text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")
    .replace(/\r\n|[\r\n]/g, " ").replace(/([*`_<>\[\]])/g, "\\$1");
}

/** Pure rendering; explicit ranges keep their first row as data. */
export function renderSheetMarkdown(data: SheetReadResult, options: { header: "first-row" | "column-letters" }): string {
  const title = data.title ? [`**${escapeText(data.title)}**`, ""] : [];
  if (data.values.length === 0) return [...title, "（空工作表）"].join("\n");
  const firstColumn = parseSheetRange(data.requestedRange).firstColumn;
  const headers = options.header === "first-row" ? data.values[0]
    : data.values[0].map((_, i) => columnName(firstColumn + i));
  const records = options.header === "first-row" ? data.values.slice(1) : data.values;
  const row = (values: readonly unknown[]) => `| ${values.map(escapeText).join(" | ")} |`;
  return [...title, row(headers), row(headers.map(() => "---")), ...records.map(row)].join("\n");
}
