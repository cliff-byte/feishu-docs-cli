import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { read } from "../src/commands/read.js";
import { parseDocUrl } from "../src/utils/url-parser.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { captureOutput } from "./helpers/capture-output.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";
import { sheetMetadata, sheetSummary, sheetValues } from "./helpers/sheets.js";

const token = "spreadsheet123456789012";
const url = `https://example.feishu.cn/sheets/${token}`;
const env = { FEISHU_USER_TOKEN: "test-user", FEISHU_APP_ID: undefined, FEISHU_APP_SECRET: undefined };

describe("standalone Sheet reads", { concurrency: 1 }, () => {
  let restore: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;
  afterEach(() => { restore?.(); restoreOutput?.(); });

  it("preserves sheet selection from sheets and wiki URLs and rejects invalid IDs", () => {
    assert.equal(parseDocUrl(`${url}?sheet=s1`).sheetId, "s1");
    assert.equal(parseDocUrl("https://example.feishu.cn/wiki/wiki1?sheet=s2").sheetId, "s2");
    for (const suffix of ["../secret", "", "a%2Fb"]) {
      assert.throws(() => parseDocUrl(`${url}?sheet=${suffix}`), { errorType: "INVALID_ARGS" });
    }
  });

  for (const source of ["url", "wiki", "raw"] as const) {
    it(`reads a selected Sheet from ${source} as structured JSON without docs_ai`, async () => {
      await withCleanEnv(env, async () => {
        const mock = setupMockFetch({ responses: [
          ...(source === "wiki" ? [jsonResponse({ code: 0, data: { node: {
            obj_token: token, obj_type: "sheet", title: "Workbook", node_token: "wiki1", space_id: "space1", has_child: false,
          } } })] : []),
          sheetMetadata(sheetSummary("s1"), sheetSummary("s2", 3, 2, { index: 1, hidden: true })),
          sheetValues("s2!A1:B3", [["Name", "Name"], [0, false], [null, "last"]]),
        ] });
        restore = mock.restore;
        const out = captureOutput(); restoreOutput = out.restore;
        const input = source === "wiki" ? "https://example.feishu.cn/wiki/wiki1?sheet=s1" : source === "raw" ? token : `${url}?sheet=s1`;
        await read({ positionals: [input], sheet: "s2", ...(source === "raw" && { type: "sheet" }) }, makeGlobalOpts({ auth: "user", json: true }));
        const result = JSON.parse(out.stdout());
        assert.equal(result.success, true);
        assert.equal(result.type, "sheet");
        assert.equal(result.spreadsheet_token, token);
        assert.equal(result.sheets[0].sheet_id, "s2");
        assert.equal(result.sheets[0].hidden, true);
        assert.deepEqual(result.sheets[0].values, [["Name", "Name"], [0, false], [null, "last"]]);
        assert.equal(result.sheets[0].requested_range, "A1:B3");
        assert.ok(!mock.calls.some((call) => /docs_ai|docx/.test(call.url)));
        assert.equal(mock.calls.filter((call) => call.url.includes("/sheets/query")).length, 1);
      });
    });
  }

  it("reads a single-sheet workbook as Markdown with source metadata", async () => {
    await withCleanEnv(env, async () => {
      ({ restore } = setupMockFetch({ responses: [sheetMetadata(sheetSummary()), sheetValues("s1!A1:B3", [["Name"], ["Alice"]])] }));
      const out = captureOutput(); restoreOutput = out.restore;
      await read({ positionals: [url], withMeta: true }, makeGlobalOpts({ auth: "user" }));
      assert.match(out.stdout(), /\*\*Data\*\*/);
      assert.match(out.stdout(), /\| Name \|/);
      assert.match(out.stdout(), /\| Alice \|/);
      assert.ok(out.stdout().includes(token));
      assert.ok(out.stdout().includes("A1:B3"));
    });
  });

  it("rejects unsupported flags or invalid type overrides without fetching values", async () => {
    await withCleanEnv(env, async () => {
      for (const args of [{ raw: true }, { blocks: true }, { type: "sheet" }, { type: "docx" }, { sheet: "../bad" }]) {
        const mock = setupMockFetch({ responses: [] }); restore = mock.restore;
        await assert.rejects(() => read({ positionals: [url], ...args }, makeGlobalOpts({ auth: "user" })), (e: any) =>
          ["INVALID_ARGS", "NOT_SUPPORTED"].includes(e.errorType) && !!e.recovery);
        assert.equal(mock.calls.length, 0);
        restore();
      }
    });
  });

  it("outputs no success data when a selected Sheet fails after its first chunk", async () => {
    await withCleanEnv(env, async () => {
      ({ restore } = setupMockFetch({ responses: [
        sheetMetadata(sheetSummary("s1", 501, 1)), sheetValues("s1!A1:A500", [["partial"]]), jsonResponse({ code: 90213 }),
      ] }));
      const out = captureOutput(); restoreOutput = out.restore;
      await assert.rejects(() => read({ positionals: [`${url}?sheet=s1`] }, makeGlobalOpts({ auth: "user", json: true })), { errorType: "PERMISSION_DENIED" });
      assert.equal(out.stdout(), "");
    });
  });

  it("reads every worksheet in index order, including hidden and empty Sheets", async () => {
    await withCleanEnv(env, async () => {
      for (const json of [true, false]) {
        const mock = setupMockFetch({ responses: [
          sheetMetadata(sheetSummary("s3", 1, 1, { index: 2, title: "Empty" }),
            sheetSummary("s1", 1, 1, { title: "First" }), sheetSummary("s2", 1, 1, { index: 1, title: "Hidden", hidden: true })),
          sheetValues("s1!A1:A1", [["first"]]), sheetValues("s2!A1:A1", [["second"]]), sheetValues("", []),
        ] });
        restore = mock.restore;
        const out = captureOutput(); restoreOutput = out.restore;
        await read({ positionals: [url] }, makeGlobalOpts({ auth: "user", json }));
        if (json) {
          const data = JSON.parse(out.stdout());
          assert.deepEqual(data.sheets.map((s: any) => s.sheet_id), ["s1", "s2", "s3"]);
          assert.equal(data.sheets[1].hidden, true);
          assert.deepEqual(data.sheets[2].values, []);
          assert.equal(data.sheets[2].data_range, null);
        } else {
          assert.ok(out.stdout().indexOf("First") < out.stdout().indexOf("Hidden"));
          assert.ok(out.stdout().indexOf("Hidden") < out.stdout().indexOf("Empty"));
          assert.match(out.stdout(), /空工作表/);
          assert.match(out.stdout(), /hidden: true/);
        }
        assert.equal(mock.calls.filter((call) => call.url.includes("/sheets/query")).length, 1);
        restore(); restoreOutput();
      }
    });
  });

  it("handles an empty workbook and fails atomically for unsupported or failed worksheets", async () => {
    await withCleanEnv(env, async () => {
      for (const situation of ["empty", "unsupported", "failed"]) {
        ({ restore } = setupMockFetch({ responses: situation === "empty" ? [sheetMetadata()] : situation === "unsupported"
          ? [sheetMetadata(sheetSummary(), sheetSummary("s2", 0, 0, { resource_type: "bitable", index: 1 }))]
          : [sheetMetadata(sheetSummary(), sheetSummary("s2", 1, 1, { index: 1 })), sheetValues("s1!A1:B3", [["partial"]]), jsonResponse({ code: 90213 })],
        }));
        const out = captureOutput(); restoreOutput = out.restore;
        const operation = read({ positionals: [url] }, makeGlobalOpts({ auth: "user", json: true }));
        if (situation === "empty") { await operation; assert.deepEqual(JSON.parse(out.stdout()).sheets, []); }
        else { await assert.rejects(operation, { errorType: situation === "unsupported" ? "NOT_SUPPORTED" : "PERMISSION_DENIED" }); assert.equal(out.stdout(), ""); }
        restore(); restoreOutput();
      }
    });
  });

  it("reads only a selected rectangle and uses original column letters as headers", async () => {
    await withCleanEnv(env, async () => {
      for (const json of [false, true]) {
        const mock = setupMockFetch({ responses: [
          sheetMetadata(sheetSummary("s1", 2000, 100)),
          sheetValues("s1!Z200:AA699", [["first", null]]),
          sheetValues("s1!Z700:AA700", [["last-data"]]),
        ] });
        restore = mock.restore;
        const out = captureOutput(); restoreOutput = out.restore;
        await read({ positionals: [`${url}?sheet=s1`], range: "z200:aa701", withMeta: true }, makeGlobalOpts({ auth: "user", json }));
        if (json) {
          const data = JSON.parse(out.stdout()).sheets[0];
          assert.equal(data.requested_range, "Z200:AA701");
          assert.equal(data.data_range, "Z200:AA701");
          assert.equal(data.values.length, 502);
          assert.deepEqual(data.values[0], ["first", null]);
          assert.deepEqual(data.values[500], ["last-data", null]);
          assert.deepEqual(data.values[501], [null, null]);
        } else {
          assert.match(out.stdout(), /\| Z \| AA \|/);
          assert.match(out.stdout(), /\| first \|  \|/);
          assert.ok(out.stdout().includes("Z200:AA701"));
        }
        assert.deepEqual(mock.calls.slice(1).map((c) => decodeURIComponent(new URL(c.url).pathname.split("/").at(-1)!)), ["s1!Z200:AA699", "s1!Z700:AA701"]);
        restore(); restoreOutput();
      }
    });
  });

  it("keeps a fully empty explicit rectangle and rejects invalid, outside or ambiguous ranges", async () => {
    await withCleanEnv(env, async () => {
      ({ restore } = setupMockFetch({ responses: [sheetMetadata(sheetSummary()), sheetValues("", [])] }));
      const out = captureOutput(); restoreOutput = out.restore;
      await read({ positionals: [url], range: "B2:B3" }, makeGlobalOpts({ auth: "user", json: true }));
      assert.deepEqual(JSON.parse(out.stdout()).sheets[0].values, [[null], [null]]);
      restore(); restoreOutput();
      for (const range of ["A1", "A0:B1", "B2:A1", "A1:B", "s1!A1:B2", "A1:B4", "A1:ZZZZZZZZZZZZZZZZ2"]) {
        const mock = setupMockFetch({ responses: [sheetMetadata(sheetSummary())] }); restore = mock.restore;
        await assert.rejects(() => read({ positionals: [url], range }, makeGlobalOpts({ auth: "user" })), { errorType: "INVALID_ARGS" });
        assert.ok(!mock.calls.some((call) => call.url.includes("/values/")));
        restore();
      }
      const mock = setupMockFetch({ responses: [sheetMetadata(sheetSummary(), sheetSummary("s2"))] }); restore = mock.restore;
      await assert.rejects(() => read({ positionals: [url], range: "A1:B2" }, makeGlobalOpts({ auth: "user" })), { errorType: "INVALID_ARGS" });
      assert.equal(mock.calls.length, 1);
    });
  });
  it("infers the only ordinary worksheet for a rectangle in a mixed workbook", async () => {
    await withCleanEnv(env, async () => {
      const mock = setupMockFetch({ responses: [sheetMetadata(sheetSummary(),
        sheetSummary("b1", 0, 0, { resource_type: "bitable", index: 1 })), sheetValues("s1!A1:A1", [["selected"]])] }); restore = mock.restore;
      const out = captureOutput(); restoreOutput = out.restore;
      await read({ positionals: [url], range: "A1:A1" }, makeGlobalOpts({ auth: "user", json: true }));
      assert.deepEqual(JSON.parse(out.stdout()).sheets.map((s: any) => s.sheet_id), ["s1"]);
      assert.equal(mock.calls.length, 2);
    });
  });

});
