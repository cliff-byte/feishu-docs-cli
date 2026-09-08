import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { read } from "../src/commands/read.js";
import { meta as catMeta } from "../src/commands/cat.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { captureOutput } from "./helpers/capture-output.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";
import { sheetMetadata, sheetSummary, sheetValues } from "./helpers/sheets.js";

const documentId = "document12345678901234";
const tag = '<sheet token="spreadsheet1" sheet-id="s1"/>';
const documentBlocks = [
  { block_id: documentId, block_type: 1, children: ["text", "sheet1", "sheet2"] },
  { block_id: "text", block_type: 2, parent_id: documentId, text: { elements: [{ text_run: { content: "正文" } }] } },
  ...["sheet1", "sheet2"].map((block_id) => ({ block_id, parent_id: documentId, block_type: 30, sheet: { token: "spreadsheet1_s1" } })),
];

describe("embedded Sheet read paths", { concurrency: 1 }, () => {
  let restore: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;
  afterEach(() => { restore?.(); restoreOutput?.(); });

  for (const path of ["read-docs-ai", "read-blocks", "cat-blocks"] as const) {
    for (const outcome of ["complete", "failed", "changed"] as const) {
      it(`${path}: ${outcome} Sheet is complete or explicitly replaced by its placeholder`, async () => {
        await withCleanEnv({ FEISHU_USER_TOKEN: "test-user", FEISHU_APP_ID: undefined, FEISHU_APP_SECRET: undefined }, async () => {
          const mock = setupMockFetch({ responses: [
            ...(path === "cat-blocks" ? [jsonResponse({ code: 0, data: { items: [{ node_token: "node1", obj_token: documentId, obj_type: "docx", title: "Doc", has_child: false }], has_more: false } })] : []),
            ...(path === "read-docs-ai"
              ? [jsonResponse({ code: 0, data: { document: { content: `正文\n${tag}\n${tag}` } } })]
              : [jsonResponse({ code: 12345, msg: "docs_ai unavailable" }), jsonResponse({ code: 0, data: { items: documentBlocks, has_more: false } })]),
            sheetMetadata(sheetSummary("s1", 501, 1)),
            sheetValues("s1!A1:A500", Array.from({ length: 500 }, (_, r) => [r === 0 ? "列名" : `行${r + 1}`]), 0),
            outcome === "failed" ? jsonResponse({ code: 90213, msg: "permission denied" })
              : sheetValues("s1!A501:A501", [["最后一行501"]], outcome === "changed" ? 1 : 0),
          ] });
          restore = mock.restore;
          const output = captureOutput(); restoreOutput = output.restore;
          const opts = makeGlobalOpts({ auth: "user" });
          if (path === "cat-blocks") await catMeta.handler({ positionals: ["space1"] }, opts);
          else await read({ positionals: [`https://example.feishu.cn/docx/${documentId}`] }, opts);
          assert.ok(output.stdout().includes("正文"));
          if (outcome === "complete") {
            assert.equal(output.stdout().split("最后一行501").length - 1, 2);
            assert.ok(output.stdout().includes("行101"));
          } else {
            assert.ok(!output.stdout().includes("行101"));
            assert.match(output.stdout(), path === "read-docs-ai" ? /<sheet/ : /电子表格/);
            assert.match(output.stderr(), /warning/);
            if (outcome === "changed") assert.match(output.stderr(), /重新读取/);
          }
          assert.equal(mock.calls.filter((call) => call.url.includes("/sheets/query")).length, 1);
        });
      });
    }
  }

  it("cat checks UTF-8 size after expansion and does not output a partial document", async () => {
    await withCleanEnv({ FEISHU_USER_TOKEN: "test-user", FEISHU_APP_ID: undefined, FEISHU_APP_SECRET: undefined }, async () => {
      ({ restore } = setupMockFetch({ responses: [
        jsonResponse({ code: 0, data: { items: [{ node_token: "node1", obj_token: documentId, obj_type: "docx", title: "Doc", has_child: false }], has_more: false } }),
        jsonResponse({ code: 12345 }), jsonResponse({ code: 0, data: { items: documentBlocks, has_more: false } }),
        sheetMetadata(sheetSummary("s1", 2, 1)), sheetValues("s1!A1:A2", [["列"], ["中文内容".repeat(100)]]),
      ] }));
      const output = captureOutput(); restoreOutput = output.restore;
      await catMeta.handler({ positionals: ["space1"], maxBytes: "1k" }, makeGlobalOpts({ auth: "user" }));
      assert.equal(output.stdout(), "");
      assert.match(output.stderr(), /max-bytes/);
    });
  });
});
