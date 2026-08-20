import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchDocumentMarkdown } from "../src/services/doc-markdown.js";
import { CliError } from "../src/utils/errors.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";

describe("fetchDocumentMarkdown", { concurrency: 1 }, () => {
  let restore: (() => void) | undefined;

  afterEach(() => restore?.());

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
