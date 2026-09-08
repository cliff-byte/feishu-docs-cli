import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSheet } from "../src/services/sheets.js";
import { renderSheetMarkdown } from "../src/parser/sheet-to-md.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";
import { sheetMetadata, sheetSummary, sheetValues } from "./helpers/sheets.js";
import { setImmediate } from "node:timers/promises";
import { enableTimerMock } from "./helpers/timer-mock.js";

const selection = { spreadsheetToken: "spreadsheet1", sheetId: "s1" };

describe("complete Sheet reads", { concurrency: 1 }, () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("reads 1200 by 120 cells across both axes without losing cells", async () => {
    const bands = [
      { start: 1, end: 500 }, { start: 501, end: 1000 }, { start: 1001, end: 1200 },
    ];
    const columns = [
      { start: "A", end: "AX", offset: 0, width: 50 },
      { start: "AY", end: "CV", offset: 50, width: 50 },
      { start: "CW", end: "DP", offset: 100, width: 20 },
    ];
    const mock = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 1200, 120)),
      ...bands.flatMap((band) => columns.map((col) => sheetValues(
        `s1!${col.start}${band.start}:${col.end}${band.end}`,
        Array.from({ length: band.end - band.start + 1 }, (_, r) =>
          Array.from({ length: col.width }, (_, c) => `${band.start + r}/${col.offset + c + 1}`)),
      ))),
    ] });
    restore = mock.restore;
    const data = await readSheet(makeUserAuthInfo(), selection);
    assert.equal(data.requestedRange, "A1:DP1200");
    assert.equal(data.dataRange, "A1:DP1200");
    assert.equal(data.values.length, 1200);
    assert.ok(data.values.every((row) => row.length === 120));
    assert.equal(data.values[500][50], "501/51");
    assert.equal(data.values[1199][119], "1200/120");
    assert.equal(mock.calls.length, 10);
    assert.match(mock.calls[0].url, /sheets\/v3\/.*\/sheets\/query/);
    for (const call of mock.calls.slice(1)) {
      const url = new URL(call.url);
      assert.equal(url.searchParams.get("dateTimeRenderOption"), "FormattedString");
      assert.equal(url.searchParams.get("valueRenderOption"), "ToString");
      assert.equal(url.searchParams.get("user_id_type"), "open_id");
    }
  });

  it("keeps sparse offsets and later columns despite a short header and empty block", async () => {
    ({ restore } = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 1001, 3)),
      sheetValues("s1!A1:C500", [["Header"], [null, null, "right"]]),
      sheetValues("", []),
      sheetValues("s1!C1001:C1001", [["last"]]),
    ] }));
    const data = await readSheet(makeUserAuthInfo(), selection);
    assert.equal(data.values.length, 1001);
    assert.deepEqual(data.values[0], ["Header", null, null]);
    assert.deepEqual(data.values[500], [null, null, null]);
    assert.deepEqual(data.values[1000], [null, null, "last"]);
    const md = renderSheetMarkdown(data, { header: "first-row" });
    assert.match(md, /\| Header \|  \|  \|/);
    assert.match(md, /\|  \|  \| right \|/);
    assert.match(md, /last/);
  });

  it("trims only trailing empty cells and distinguishes empty Sheets", async () => {
    ({ restore } = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 4, 4)),
      sheetValues("s1!B2:C3", [[0, false], ["", null]]),
    ] }));
    const data = await readSheet(makeUserAuthInfo(), selection);
    assert.equal(data.dataRange, "A1:C2");
    assert.deepEqual(data.values, [[null, null, null], [null, 0, false]]);
    restore();
    ({ restore } = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary()), sheetValues("", []),
    ] }));
    const empty = await readSheet(makeUserAuthInfo(), selection);
    assert.deepEqual(empty.values, []);
    assert.equal(empty.dataRange, null);
    assert.match(renderSheetMarkdown(empty, { header: "first-row" }), /空工作表/);
  });

  it("rejects a missing or unsupported target rather than selecting the first sheet", async () => {
    for (const summary of [sheetSummary("other"), sheetSummary("s1", 1, 1, { resource_type: "bitable" })]) {
      const mock = setupMockFetch({ responses: [sheetMetadata(summary)] });
      restore = mock.restore;
      await assert.rejects(() => readSheet(makeUserAuthInfo(), selection), (e: any) =>
        ["NOT_FOUND", "NOT_SUPPORTED"].includes(e.errorType) && !!e.recovery);
      assert.equal(mock.calls.length, 1);
      restore();
    }
  });

  it("validates input before any network calls", async () => {
    const mock = setupMockFetch({ responses: [] });
    restore = mock.restore;
    for (const input of [{ ...selection, sheetId: "../s1" }, { ...selection, spreadsheetToken: "../secret" }]) {
      await assert.rejects(() => readSheet(makeUserAuthInfo(), input), { errorType: "INVALID_ARGS" });
    }
    assert.equal(mock.calls.length, 0);
  });

  it("rejects malformed values and does not return a partial table", async () => {
    for (const valueRange of [
      { range: "s1!A1:B3", values: [["x"]] },
      { majorDimension: "ROWS", range: "", values: [["x"]] },
      { majorDimension: "ROWS", range: "s1!A1:Z99", values: [["x"]] },
      { majorDimension: "ROWS", range: "s1!A1:B3", values: ["not a row"] },
    ]) {
      ({ restore } = setupMockFetch({ responses: [
        sheetMetadata(sheetSummary()), jsonResponse({ code: 0, data: { valueRange } }),
      ] }));
      await assert.rejects(() => readSheet(makeUserAuthInfo(), selection), (e: any) =>
        e.errorType === "API_ERROR" && e.message.includes("s1") && !!e.recovery);
      restore();
    }
  });

  it("renders escaped text and structured values without changing input", async () => {
    ({ restore } = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 2, 3, { title: "A*title\nnext" })),
      sheetValues("s1!A1:C2", [["H|1", "H\n2", "H\\3"], [0, false, { text: "a|b" }]]),
    ] }));
    const data = await readSheet(makeUserAuthInfo(), selection);
    const before = JSON.stringify(data);
    const md = renderSheetMarkdown(data, { header: "first-row" });
    assert.ok(md.includes("H\\|1"));
    assert.ok(md.includes("H 2"));
    assert.ok(md.includes("H\\\\3"));
    assert.ok(md.includes('0 | false | {"text":"a\\|b"}'));
    assert.ok(!md.includes("[object Object]"));
    assert.equal(JSON.stringify(data), before);
  });

  it("shrinks a response by rows then columns without repeating successful ranges", async () => {
    const mock = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 2, 2)),
      jsonResponse({ code: 90221, msg: "too large" }),
      jsonResponse({ code: 90221, msg: "too large" }),
      sheetValues("s1!A1:A1", [["a"]]),
      sheetValues("s1!B1:B1", [["b"]]),
      sheetValues("s1!A2:B2", [["c", "d"]]),
    ] });
    restore = mock.restore;
    const data = await readSheet(makeUserAuthInfo(), selection);
    assert.deepEqual(data.values, [["a", "b"], ["c", "d"]]);
    assert.deepEqual(mock.calls.slice(1).map((call) => decodeURIComponent(new URL(call.url).pathname.split("/").at(-1)!)),
      ["s1!A1:B2", "s1!A1:B1", "s1!A1:A1", "s1!B1:B1", "s1!A2:B2"]);
  });

  it("stops at an oversized single cell and retains its error code and coordinates", async () => {
    for (const code of [90221, 90222]) {
      const mock = setupMockFetch({ responses: [
        sheetMetadata(sheetSummary("s1", 1, 1)), jsonResponse({ code, msg: "too large" }),
      ] });
      restore = mock.restore;
      await assert.rejects(() => readSheet(makeUserAuthInfo(), selection), (e: any) =>
        e.apiCode === code && e.message.includes("s1!A1:A1") && /单元格/.test(e.recovery));
      assert.equal(mock.calls.length, 2);
      restore();
    }
  });

  it("recovers business rate limits but stops after a bounded number of attempts", async (t) => {
    enableTimerMock(t);
    t.mock.method(Math, "random", () => 0.5);
    for (const succeeds of [true, false]) {
      const mock = setupMockFetch({ responses: [
        sheetMetadata(sheetSummary("s1", 1, 1)),
        jsonResponse({ code: 90217, msg: "rate limited" }),
        jsonResponse({ code: 90217, msg: "rate limited" }),
        succeeds ? sheetValues("s1!A1:A1", [["ok"]]) : jsonResponse({ code: 90217, msg: "rate limited" }),
      ] });
      restore = mock.restore;
      const pending = readSheet(makeUserAuthInfo(), selection);
      const assertion = succeeds ? pending.then((data) => assert.deepEqual(data.values, [["ok"]]))
        : assert.rejects(pending, { errorType: "RATE_LIMITED", apiCode: 90217 });
      await setImmediate();
      t.mock.timers.tick(1000);
      await setImmediate();
      t.mock.timers.tick(2000);
      await assertion;
      assert.equal(mock.calls.length, 4);
      restore();
    }
  });

  it("keeps revision zero, rejects mixed revisions and stops before later chunks", async () => {
    const mock = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 1001, 1)),
      sheetValues("s1!A1:A500", [["old"]], 0),
      sheetValues("s1!A501:A1000", [["new"]], 1),
    ] });
    restore = mock.restore;
    await assert.rejects(() => readSheet(makeUserAuthInfo(), selection), (e: any) =>
      e.errorType === "API_ERROR" && /版本/.test(e.message) && /重新读取/.test(e.recovery));
    assert.equal(mock.calls.length, 3);
    restore();
    ({ restore } = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 501, 1)),
      sheetValues("s1!A1:A500", [["first"]], 0),
      sheetValues("s1!A501:A501", [["last"]], 0),
    ] }));
    const data = await readSheet(makeUserAuthInfo(), selection);
    assert.equal(data.revision, 0);
    assert.equal(data.values[500][0], "last");
  });

  it("does not fabricate revision data and rejects conflicting or malformed revisions", async () => {
    for (const revisions of [{ revision: "0" }, { revision: 0, rangeRevision: 1 }, { revision: -1 }]) {
      ({ restore } = setupMockFetch({ responses: [
        sheetMetadata(sheetSummary("s1", 1, 1)),
        jsonResponse({ code: 0, data: {
          revision: revisions.revision,
          valueRange: { revision: revisions.rangeRevision, majorDimension: "ROWS", range: "s1!A1:A1", values: [["x"]] },
        } }),
      ] }));
      await assert.rejects(() => readSheet(makeUserAuthInfo(), selection), { errorType: "API_ERROR" });
      restore();
    }
    ({ restore } = setupMockFetch({ responses: [
      sheetMetadata(sheetSummary("s1", 1, 1)), sheetValues("s1!A1:A1", [["no revision"]]),
    ] }));
    assert.equal((await readSheet(makeUserAuthInfo(), selection)).revision, undefined);
  });
  it("stops at the first changed revision inside a recursively split chunk", async () => {
    const mock = setupMockFetch({ responses: [sheetMetadata(sheetSummary("s1", 1000, 1)),
      sheetValues("s1!A1:A500", [["old"]], 0), jsonResponse({ code: 90221 }),
      sheetValues("s1!A501:A750", [["new"]], 1)] }); restore = mock.restore;
    await assert.rejects(() => readSheet(makeUserAuthInfo(), selection), /版本发生变化/);
    assert.equal(mock.calls.length, 4);
  });

});
