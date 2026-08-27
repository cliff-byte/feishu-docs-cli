import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchDocumentMarkdown } from "../src/services/doc-markdown.js";
import { CliError } from "../src/utils/errors.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";
import { captureOutput } from "./helpers/capture-output.js";

describe("fetchDocumentMarkdown", { concurrency: 1 }, () => {
  let restore: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restoreOutput?.();
  });

  it("fetches docs_ai Markdown", async () => {
    const mock = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: { document: { content: "# Server Markdown" } },
        }),
      ],
    });
    restore = mock.restore;

    const markdown = await fetchDocumentMarkdown(
      makeUserAuthInfo(),
      "docxTk123",
    );

    assert.equal(markdown, "# Server Markdown");
    assert.equal(
      mock.calls[0].url,
      "https://open.feishu.cn/open-apis/docs_ai/v1/documents/docxTk123/fetch",
    );
    assert.equal(mock.calls[0].init?.method, "POST");
    assert.equal(mock.calls[0].init?.body, '{"format":"markdown"}');
  });

  it("expands an embedded sheet as a Markdown table", async () => {
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            document: {
              content:
                'Before\n\n<sheet sheet-id="sheetId1" token="shtTk123"></sheet>\n\nAfter',
            },
          },
        }),
        jsonResponse({
          code: 0,
          data: { sheets: [{ sheetId: "sheetId1", title: "Data" }] },
        }),
        jsonResponse({
          code: 0,
          data: {
            valueRange: {
              values: [
                ["Col1", "Col2"],
                ["a", "b"],
              ],
            },
          },
        }),
      ],
    }));

    const markdown = await fetchDocumentMarkdown(
      makeUserAuthInfo(),
      "docxTk123",
    );

    assert.equal(
      markdown,
      "Before\n\n**Data**\n\n| Col1 | Col2 |\n| --- | --- |\n| a | b |\n\nAfter",
    );
  });

  it("reuses one Sheet read for repeated embedded tags", async () => {
    const mock = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            document: {
              content:
                "<sheet token='shtTk123' sheet-id='sheetId1'/>\n<sheet sheet-id=\"sheetId1\" token=\"shtTk123\"></sheet>",
            },
          },
        }),
        jsonResponse({
          code: 0,
          data: { sheets: [{ sheetId: "sheetId1", title: "" }] },
        }),
        jsonResponse({
          code: 0,
          data: { valueRange: { values: [["Name"], ["Alice"]] } },
        }),
      ],
    });
    restore = mock.restore;

    const markdown = await fetchDocumentMarkdown(
      makeUserAuthInfo(),
      "docxTk123",
    );

    assert.equal(
      markdown,
      "| Name |\n| --- |\n| Alice |\n| Name |\n| --- |\n| Alice |",
    );
    assert.equal(
      mock.calls.filter((call) => call.url.includes("/metainfo")).length,
      1,
    );
    assert.equal(
      mock.calls.filter((call) => call.url.includes("/values/")).length,
      1,
    );
  });

  it("keeps the Sheet tag when its data cannot be read", async () => {
    const tag = '<sheet sheet-id="sheetId1" token="shtTk123"></sheet>';
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: { document: { content: tag } },
        }),
        jsonResponse({ code: 131006, msg: "permission denied" }),
      ],
    }));
    const output = captureOutput();
    restoreOutput = output.restore;

    const markdown = await fetchDocumentMarkdown(
      makeUserAuthInfo(),
      "docxTk123",
    );

    assert.equal(markdown, tag);
    assert.match(output.stderr(), /warning: 获取电子表格数据失败/);
    assert.match(output.stderr(), /请求文档拥有者授予访问权限/);
  });

  it("keeps an invalid Sheet tag without requesting it", async () => {
    const tag = '<sheet sheet-id="sheetId1" token="../secret"></sheet>';
    const mock = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: { document: { content: tag } },
        }),
      ],
    });
    restore = mock.restore;
    const output = captureOutput();
    restoreOutput = output.restore;

    const markdown = await fetchDocumentMarkdown(
      makeUserAuthInfo(),
      "docxTk123",
    );

    assert.equal(markdown, tag);
    assert.equal(mock.calls.length, 1);
    assert.match(output.stderr(), /warning: 无法解析嵌入式电子表格标签/);
  });

  it("rejects a response without Markdown content", async () => {
    ({ restore } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: { document: {} } })],
    }));

    await assert.rejects(
      () => fetchDocumentMarkdown(makeUserAuthInfo(), "docxTk123"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "API_ERROR");
        return true;
      },
    );
  });

  it("validates the document token before building the URL", async () => {
    await assert.rejects(
      () => fetchDocumentMarkdown(makeUserAuthInfo(), "../secret"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });
});
