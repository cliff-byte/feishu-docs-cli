/**
 * Tests for info command URL generation logic and integration tests.
 * Tests use the same field structure as production code (doc.parsed.token).
 *
 * Integration tests cover: docx URL JSON, wiki URL JSON, missing input,
 * NOT_SUPPORTED for doc type, and human-readable output.
 *
 * Mock strategy: globalThis.fetch level (D-01). Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { info } from "../src/commands/info.js";
import { CliError } from "../src/utils/errors.js";

describe("info URL generation", () => {
  // Mirror the exact URL construction logic from info.js
  function buildUrl(
    doc: {
      spaceId?: string;
      objType: string;
      objToken: string;
      parsed: { token: string; type: string };
    },
    useLark: boolean,
  ) {
    const domain = useLark ? "larksuite.com" : "feishu.cn";
    return doc.spaceId
      ? `https://${domain}/wiki/${doc.parsed.token}`
      : `https://${domain}/${doc.objType}/${doc.objToken}`;
  }

  it("should generate wiki URL for wiki documents", () => {
    const doc = {
      spaceId: "sp123",
      objType: "docx",
      objToken: "doc456",
      parsed: { token: "wiki789", type: "wiki" },
    };
    assert.equal(buildUrl(doc, false), "https://feishu.cn/wiki/wiki789");
  });

  it("should generate docx URL for drive documents", () => {
    const doc = {
      spaceId: undefined,
      objType: "docx",
      objToken: "doc456",
      parsed: { token: "doc456", type: "docx" },
    };
    assert.equal(buildUrl(doc, false), "https://feishu.cn/docx/doc456");
  });

  it("should use larksuite.com for lark mode", () => {
    const doc = {
      spaceId: "sp123",
      objType: "docx",
      objToken: "doc456",
      parsed: { token: "wiki789", type: "wiki" },
    };
    assert.equal(buildUrl(doc, true), "https://larksuite.com/wiki/wiki789");
  });

  it("should generate sheet URL for sheet type", () => {
    const doc = {
      spaceId: undefined,
      objType: "sheet",
      objToken: "sheet123",
      parsed: { token: "sheet123", type: "sheet" },
    };
    assert.equal(buildUrl(doc, false), "https://feishu.cn/sheet/sheet123");
  });
});

// ── Integration tests for info command ──

describe("info command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("info --json for docx URL", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // resolveDocument for docx type: no API call (parseDocUrl returns type "docx")
        // getDocumentInfo: fetchWithAuth (2 responses)
        const { restore } = setupMockFetch({
          responses: [
            // getDocumentInfo: getTenantToken + GET document info
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123",
                  revision_id: 5,
                  title: "Test Doc",
                },
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await info(
          { positionals: ["https://example.feishu.cn/docx/abc123"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.type, "docx");
        assert.equal(json.token, "abc123");
        assert.equal(json.title, "Test Doc");
        assert.equal(json.revision, 5);
      },
    );
  });

  it("info --json for wiki URL", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // resolveDocument for wiki type: resolveWikiToken (2 responses)
        // getDocumentInfo: fetchWithAuth (2 responses)
        const { restore } = setupMockFetch({
          responses: [
            // resolveWikiToken: getTenantToken + GET wiki node
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                node: {
                  obj_token: "doc1",
                  obj_type: "docx",
                  title: "Wiki Doc",
                  node_token: "nd1",
                  space_id: "sp1",
                  has_child: false,
                },
              },
            }),
            // getDocumentInfo: getTenantToken + GET document info
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "doc1",
                  revision_id: 3,
                  title: "Wiki Doc",
                },
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await info(
          { positionals: ["https://example.feishu.cn/wiki/wiki789"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.type, "docx");
        assert.equal(json.space_id, "sp1");
        assert.equal(json.node_token, "nd1");
      },
    );
  });

  it("info missing input throws INVALID_ARGS", async () => {
    await assert.rejects(
      () => info({ positionals: [] }, makeGlobalOpts()),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("info doc type throws NOT_SUPPORTED", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // For a /doc/ URL, parseDocUrl returns type "doc", resolveDocument
        // returns objType "doc", and info throws NOT_SUPPORTED before getDocumentInfo.
        // resolveDocument does NOT call wiki API for "doc" type.
        // No fetch calls needed.
        await assert.rejects(
          () =>
            info(
              { positionals: ["https://example.feishu.cn/doc/abc123"] },
              makeGlobalOpts({ json: true }),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "NOT_SUPPORTED");
            return true;
          },
        );
      },
    );
  });

  it("info human-readable mode shows title and type", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123",
                  revision_id: 2,
                  title: "Human Info Doc",
                },
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await info(
          { positionals: ["https://example.feishu.cn/docx/abc123"] },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(
          out.includes("Human Info Doc"),
          `Expected "Human Info Doc" in: ${out}`,
        );
        assert.ok(out.includes("docx"), `Expected "docx" in: ${out}`);
      },
    );
  });
});
