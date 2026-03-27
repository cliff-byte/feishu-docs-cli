/**
 * Integration tests for cp command.
 *
 * Tests the full command -> service -> client -> fetch chain by mocking
 * at the globalThis.fetch level. Covers copy with --name, title-fetch
 * fallback, argument validation, and human-readable mode.
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
import { cp } from "../src/commands/cp.js";
import { CliError } from "../src/utils/errors.js";

describe("cp command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("cp --json with --name skips title fetch", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "test_id",
        FEISHU_APP_SECRET: "test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // docx URL: resolveDocument does NOT make an API call (type is "docx")
        // With --name, no title fetch needed.
        // Mock chain: tenant token + copy API
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                file: {
                  token: "newtok",
                  name: "My Copy",
                  url: "https://feishu.cn/docx/newtok",
                },
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await cp(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "fldcnTarget",
            ],
            name: "My Copy",
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson();
        assert.equal(json.success, true);
        assert.equal(json.file_token, "newtok");
        assert.equal(json.name, "My Copy");
        assert.equal(json.folder_token, "fldcnTarget");
      },
    );
  });

  it("cp --json without --name fetches title and appends suffix", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "test_id",
        FEISHU_APP_SECRET: "test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // docx URL: resolveDocument returns title=undefined for docx type
        // Without --name, cp fetches title via document API
        // Mock chain: tenant token + title fetch + tenant token + copy API
        const { calls, restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123",
                  title: "Original Doc",
                  revision_id: 1,
                },
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                file: {
                  token: "newtok2",
                  name: "Original Doc - 副本",
                  url: "https://feishu.cn/docx/newtok2",
                },
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await cp(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "fldcnTarget",
            ],
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson();
        assert.equal(json.success, true);
        assert.ok(
          (json.name as string).includes("副本"),
          `Expected name to contain "副本", got: ${json.name}`,
        );

        // Verify the copy API was called with name containing "副本"
        const copyCall = calls[3];
        assert.ok(copyCall.init?.body, "Expected POST body for copy");
        const body = JSON.parse(copyCall.init!.body as string) as Record<string, unknown>;
        assert.ok(
          (body.name as string).includes("副本"),
          `Expected copy body name to contain "副本", got: ${body.name}`,
        );
      },
    );
  });

  it("cp missing args throws INVALID_ARGS", async () => {
    await assert.rejects(
      () =>
        cp(
          { positionals: ["tok1"] },
          makeGlobalOpts({ json: true }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("cp human-readable mode shows copy message", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "test_id",
        FEISHU_APP_SECRET: "test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                file: {
                  token: "newtok",
                  name: "CopiedDoc",
                  url: "https://feishu.cn/docx/newtok",
                },
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await cp(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "fldcnTarget",
            ],
            name: "CopiedDoc",
          },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(
          out.includes("已复制"),
          `Expected stdout to contain "已复制", got: ${out}`,
        );
      },
    );
  });
});
