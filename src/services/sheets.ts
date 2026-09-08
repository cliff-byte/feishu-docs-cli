/** Complete worksheet values behind one read interface. */
import { fetchWithAuth } from "../client.js";
import type { AuthInfo, ErrorType } from "../types/index.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import { formatSheetRange, parseSheetRange, type SheetRange } from "../utils/sheet-range.js";
import { calculateDelay, DEFAULT_RETRY, sleep } from "../utils/retry.js";
import { pLimit } from "../utils/concurrency.js";

export interface SheetSelection {
  readonly spreadsheetToken: string;
  readonly sheetId: string;
  readonly range?: string;
}

export interface SheetSummary {
  readonly sheetId: string;
  readonly title: string;
  readonly index: number;
  readonly hidden: boolean;
  readonly resourceType: string;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface SheetReadResult {
  readonly spreadsheetToken: string;
  readonly sheetId: string;
  readonly title: string;
  readonly index: number;
  readonly hidden: boolean;
  readonly requestedRange: string;
  readonly dataRange: string | null;
  readonly revision?: number;
  readonly values: ReadonlyArray<ReadonlyArray<unknown>>;
}

interface Chunk {
  readonly requested: SheetRange;
  readonly returned: SheetRange | null;
  readonly values: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly revision?: number;
}

function invalidResponse(): never {
  throw new CliError("API_ERROR", "电子表格返回无效的数据或范围", {
    recovery: "重试读取；若持续失败，检查电子表格响应格式",
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function checkToken(value: string, label: string): void {
  try {
    validateToken(typeof value === "string" ? value : undefined, label);
  } catch {
    throw new CliError("INVALID_ARGS", `无效的 ${label}`, {
      recovery: "提供合法的电子表格 token 和工作表 ID，或复制完整飞书表格链接",
    });
  }
}

function sheetError(err: unknown, location: string): CliError {
  const original = err instanceof CliError ? err : undefined;
  const code = original?.apiCode;
  const type: ErrorType = [90213, 1310213].includes(code ?? -1) ? "PERMISSION_DENIED"
    : [90214, 90215, 90211, 1310214, 1310249].includes(code ?? -1) ? "NOT_FOUND"
    : (original?.errorType as ErrorType | undefined) ?? "API_ERROR";
  return new CliError(type, `电子表格 ${location}: ${original?.message ?? "读取请求失败"}`, {
    apiCode: code,
    retryable: original?.retryable,
    missingScopes: original?.missingScopes,
    recovery: original?.recovery ?? (type === "PERMISSION_DENIED"
      ? "请求表格拥有者授予当前用户或应用阅读权限"
      : "检查工作表 ID 和访问权限后重新读取"),
  });
}

async function querySheets(authInfo: AuthInfo, spreadsheetToken: string): Promise<readonly SheetSummary[]> {
  checkToken(spreadsheetToken, "spreadsheet_token");
  const res = await fetchWithAuth(authInfo,
    `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`);
  const data = object(res.data);
  if (!Array.isArray(data.sheets)) invalidResponse();
  const sheets = data.sheets.map((value): SheetSummary => {
    const sheet = object(value);
    if (typeof sheet.sheet_id !== "string" || typeof sheet.title !== "string" ||
        typeof sheet.hidden !== "boolean" || !Number.isSafeInteger(sheet.index) ||
        (sheet.index as number) < 0 || typeof sheet.resource_type !== "string") invalidResponse();
    checkToken(sheet.sheet_id, "sheet_id");
    const grid = sheet.resource_type === "sheet" ? object(sheet.grid_properties) : undefined;
    const rows = grid?.row_count ?? 0;
    const columns = grid?.column_count ?? 0;
    if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) ||
        (grid && ((rows as number) < 1 || (columns as number) < 1)) ||
        !Number.isSafeInteger((rows as number) * (columns as number))) invalidResponse();
    return {
      sheetId: sheet.sheet_id, title: sheet.title, index: sheet.index as number,
      hidden: sheet.hidden, resourceType: sheet.resource_type,
      rowCount: rows as number, columnCount: columns as number,
    };
  });
  if (new Set(sheets.map((s) => s.sheetId)).size !== sheets.length) invalidResponse();
  return sheets;
}

function inside(inner: SheetRange, outer: SheetRange): boolean {
  return inner.firstRow >= outer.firstRow && inner.lastRow <= outer.lastRow &&
    inner.firstColumn >= outer.firstColumn && inner.lastColumn <= outer.lastColumn;
}

async function fetchChunk(authInfo: AuthInfo, selection: SheetSelection, requested: SheetRange): Promise<Chunk> {
  const range = `${selection.sheetId}!${formatSheetRange(requested)}`;
  try {
    const res = await fetchWithAuth(authInfo,
      `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(selection.spreadsheetToken)}/values/${encodeURIComponent(range)}`,
      { params: { valueRenderOption: "ToString", dateTimeRenderOption: "FormattedString", user_id_type: "open_id" } });
    const data = object(res.data);
    const valueRange = object(data.valueRange);
    if (valueRange.majorDimension !== "ROWS" || typeof valueRange.range !== "string" ||
        !Array.isArray(valueRange.values) || !valueRange.values.every(Array.isArray)) invalidResponse();
    const values = valueRange.values as unknown[][];
    const prefix = `${selection.sheetId}!`;
    let returned: SheetRange | null = null;
    if (valueRange.range !== "") {
      if (!valueRange.range.startsWith(prefix)) invalidResponse();
      try { returned = parseSheetRange(valueRange.range.slice(prefix.length)); }
      catch { invalidResponse(); }
      if (!inside(returned, requested) || values.length > returned.lastRow - returned.firstRow + 1 ||
          values.some((row) => row.length > returned!.lastColumn - returned!.firstColumn + 1)) invalidResponse();
    } else if (values.length !== 0) invalidResponse();
    const revisions = [data.revision, valueRange.revision].filter((r) => r !== undefined);
    if (revisions.some((r) => !Number.isSafeInteger(r) || (r as number) < 0) || new Set(revisions).size > 1) invalidResponse();
    return { requested, returned, values, ...(revisions.length && { revision: revisions[0] as number }) };
  } catch (err) {
    throw sheetError(err, range);
  }
}

function checkVersions(chunks: readonly Chunk[]): number | undefined {
  const revisions = chunks.flatMap((chunk) => chunk.revision === undefined ? [] : [chunk.revision]);
  if (new Set(revisions).size > 1) throw new CliError("API_ERROR", "读取期间工作表版本发生变化", {
    recovery: "等待工作表编辑完成后重新读取，不能使用不同版本的部分结果",
  });
  // Missing versions cannot substantiate a fully versioned read.
  return revisions.length === chunks.length ? revisions[0] : undefined;
}

async function readRanges(authInfo: AuthInfo, selection: SheetSelection, ranges: readonly SheetRange[], observed: readonly Chunk[] = []): Promise<readonly Chunk[]> {
  return ranges.reduce(async (previous, range) => {
    const collected = await previous;
    const chunks = [...collected, ...await readRange(authInfo, selection, range, [...observed, ...collected])];
    checkVersions(chunks);
    return chunks;
  }, Promise.resolve<readonly Chunk[]>([]));
}

async function readRange(authInfo: AuthInfo, selection: SheetSelection, range: SheetRange, observed: readonly Chunk[], attempt = 0): Promise<readonly Chunk[]> {
  try {
    const chunk = await fetchChunk(authInfo, selection, range);
    checkVersions([...observed, chunk]);
    return [chunk];
  }
  catch (err) {
    if (!(err instanceof CliError)) throw err;
    if (err.apiCode === 90217) {
      if (attempt < DEFAULT_RETRY.maxRetries) {
        await sleep(calculateDelay(attempt, DEFAULT_RETRY.initialDelay, DEFAULT_RETRY.maxDelay));
        return readRange(authInfo, selection, range, observed, attempt + 1);
      }
      throw new CliError("RATE_LIMITED", err.message, { apiCode: err.apiCode, retryable: true, recovery: "请求过频，请稍后重新读取" });
    }
    if (err.apiCode === 90221 && (range.lastRow > range.firstRow || range.lastColumn > range.firstColumn)) {
      const byRow = range.lastRow > range.firstRow;
      const middle = Math.floor(byRow ? (range.firstRow + range.lastRow) / 2 : (range.firstColumn + range.lastColumn) / 2);
      return readRanges(authInfo, selection, byRow
        ? [{ ...range, lastRow: middle }, { ...range, firstRow: middle + 1 }]
        : [{ ...range, lastColumn: middle }, { ...range, firstColumn: middle + 1 }], observed);
    }
    if (err.apiCode === 90221 || err.apiCode === 90222) {
      throw new CliError("API_ERROR", err.message, { apiCode: err.apiCode, recovery: "单元格内容过大；请缩小单元格内容，或尝试官方 xlsx 导出" });
    }
    throw err;
  }
}

function planRanges(range: SheetRange): readonly SheetRange[] {
  return Array.from({ length: Math.ceil((range.lastRow - range.firstRow + 1) / 500) }, (_, row) =>
    Array.from({ length: Math.ceil((range.lastColumn - range.firstColumn + 1) / 50) }, (_, column) => ({
      firstRow: range.firstRow + row * 500,
      lastRow: Math.min(range.lastRow, range.firstRow + row * 500 + 499),
      firstColumn: range.firstColumn + column * 50,
      lastColumn: Math.min(range.lastColumn, range.firstColumn + column * 50 + 49),
    }))).flat();
}

function assemble(range: SheetRange, chunks: readonly Chunk[]): unknown[][] {
  return Array.from({ length: range.lastRow - range.firstRow + 1 }, (_, offset) => {
    const row = range.firstRow + offset;
    return chunks.filter((c) => row >= c.requested.firstRow && row <= c.requested.lastRow).flatMap((chunk) =>
      Array.from({ length: chunk.requested.lastColumn - chunk.requested.firstColumn + 1 }, (_, col) => {
        const column = chunk.requested.firstColumn + col;
        const data = chunk.returned;
        if (!data || row < data.firstRow || row > data.lastRow || column < data.firstColumn || column > data.lastColumn) return null;
        return chunk.values[row - data.firstRow]?.[column - data.firstColumn] ?? null;
      }));
  });
}

export async function readSheet(authInfo: AuthInfo, selection: SheetSelection): Promise<SheetReadResult> {
  checkToken(selection.spreadsheetToken, "spreadsheet_token");
  checkToken(selection.sheetId, "sheet_id");
  if (selection.range !== undefined) parseSheetRange(selection.range);
  try {
    const sheets = await querySheets(authInfo, selection.spreadsheetToken);
    const sheet = sheets.find((s) => s.sheetId === selection.sheetId);
    return await readSelectedSheet(authInfo, selection, sheet);
  } catch (err) { throw sheetError(err, selection.sheetId); }
}

/** Reads selected worksheet(s), keeping metadata lookup inside the module. */
export async function readSpreadsheet(authInfo: AuthInfo, selection: {
  spreadsheetToken: string; sheetId?: string; range?: string;
}): Promise<readonly SheetReadResult[]> {
  checkToken(selection.spreadsheetToken, "spreadsheet_token");
  if (selection.sheetId !== undefined) checkToken(selection.sheetId, "sheet_id");
  if (selection.range !== undefined) parseSheetRange(selection.range);
  try {
    const sheets = await querySheets(authInfo, selection.spreadsheetToken);
    const candidates = selection.range !== undefined && selection.sheetId === undefined
      ? sheets.filter((s) => s.resourceType === "sheet") : sheets;
    if (selection.range !== undefined && selection.sheetId === undefined && candidates.length !== 1) {
      throw new CliError("INVALID_ARGS", "范围读取必须对应唯一工作表", { recovery: "使用 --sheet <sheet_id> 选择一个工作表" });
    }
    const targets = selection.sheetId === undefined ? [...candidates].sort((a, b) => a.index - b.index)
      : sheets.filter((s) => s.sheetId === selection.sheetId);
    if (selection.sheetId !== undefined && !targets.length) {
      throw new CliError("NOT_FOUND", "工作表不存在", { recovery: "检查 --sheet 或 URL 的 sheet 参数" });
    }
    const unsupported = targets.find((s) => s.resourceType !== "sheet");
    if (unsupported) throw new CliError("NOT_SUPPORTED", `工作表 ${unsupported.sheetId} 不是普通电子表格`, { recovery: "用 --sheet 选择普通工作表，或使用多维表格 base 链接读取" });
    const limit = pLimit(5);
    const results = await Promise.allSettled(targets.map((sheet) => limit(() =>
      readSelectedSheet(authInfo, { ...selection, sheetId: sheet.sheetId }, sheet))));
    // Settle all scheduled work before returning an error or exposing output.
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  } catch (err) { throw sheetError(err, selection.sheetId ?? selection.spreadsheetToken); }
}

async function readSelectedSheet(authInfo: AuthInfo, selection: SheetSelection, sheet: SheetSummary | undefined): Promise<SheetReadResult> {
  try {
    if (!sheet) throw new CliError("NOT_FOUND", "工作表不存在", { recovery: "检查工作表 ID，不能用其他工作表替代" });
    if (sheet.resourceType !== "sheet") throw new CliError("NOT_SUPPORTED", "目标不是普通电子表格工作表", { recovery: "选择普通工作表；多维表格请使用对应的 base 链接" });
    const grid = { firstRow: 1, lastRow: sheet.rowCount, firstColumn: 1, lastColumn: sheet.columnCount };
    const range = selection.range === undefined ? grid : parseSheetRange(selection.range);
    if (!inside(range, grid)) throw new CliError("INVALID_ARGS", "读取范围超出工作表网格", { recovery: `范围必须位于 ${formatSheetRange(grid)} 内，不能自动裁剪` });
    const chunks = await readRanges(authInfo, selection, planRanges(range));
    const revision = checkVersions(chunks);
    const rows = assemble(range, chunks);
    const nonempty = (value: unknown) => value !== null && value !== undefined && value !== "";
    const lastRow = rows.reduce((last, row, i) => row.some(nonempty) ? i + 1 : last, 0);
    const width = rows.reduce((max, row) => row.reduce<number>((last, cell, i) => nonempty(cell) ? Math.max(last, i + 1) : last, max), 0);
    const values = selection.range === undefined ? rows.slice(0, lastRow).map((row) => row.slice(0, width)) : rows;
    return {
      spreadsheetToken: selection.spreadsheetToken, sheetId: sheet.sheetId,
      title: sheet.title === sheet.sheetId ? "" : sheet.title, index: sheet.index, hidden: sheet.hidden,
      requestedRange: formatSheetRange(range),
      dataRange: selection.range !== undefined ? formatSheetRange(range)
        : lastRow ? formatSheetRange({ ...range, lastRow, lastColumn: width }) : null,
      ...(revision !== undefined && { revision }),
      values,
    };
  } catch (err) { throw sheetError(err, selection.sheetId); }
}

/** Only embedded Block tokens use the spreadsheetToken_sheetId representation. */
export function parseEmbeddedSheetToken(token: string): SheetSelection {
  const split = typeof token === "string" ? token.lastIndexOf("_") : -1;
  if (split < 1) throw new CliError("INVALID_ARGS", "内嵌电子表格缺少工作表 ID", {
    recovery: "检查内嵌表格引用，需包含表格 token 和工作表 ID",
  });
  const selection = { spreadsheetToken: token.slice(0, split), sheetId: token.slice(split + 1) };
  checkToken(selection.spreadsheetToken, "spreadsheet_token");
  checkToken(selection.sheetId, "sheet_id");
  return selection;
}
