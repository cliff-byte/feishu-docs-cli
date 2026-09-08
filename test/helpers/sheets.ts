import { jsonResponse } from "./mock-fetch.js";

export function sheetSummary(
  sheetId = "s1",
  rows = 3,
  columns = 2,
  extra: Record<string, unknown> = {},
) {
  return {
    sheet_id: sheetId,
    title: "Data",
    index: 0,
    hidden: false,
    resource_type: "sheet",
    grid_properties: { row_count: rows, column_count: columns },
    ...extra,
  };
}

export function sheetMetadata(...sheets: ReturnType<typeof sheetSummary>[]) {
  return jsonResponse({ code: 0, data: { sheets } });
}

export function sheetValues(range: string, values: unknown[][], revision?: number) {
  return jsonResponse({
    code: 0,
    data: {
      ...(revision !== undefined && { revision }),
      valueRange: { majorDimension: "ROWS", range, values },
    },
  });
}
