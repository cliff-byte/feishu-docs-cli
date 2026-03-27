/**
 * Integration tests for mv command.
 *
 * Tests the full command -> service -> client -> fetch chain by mocking
 * at the globalThis.fetch level. Covers sync completion, async task
 * polling, argument validation, and human-readable mode.
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
import { mv } from "../src/commands/mv.js";
import { CliError } from "../src/utils/errors.js";

describe("mv command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("mv --json sync completion", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "test_id",
        FEISHU_APP_SECRET: "test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // docx URL: resolveDocument does NOT make an API call (type is "docx")
        // Mock chain: tenant token + move API (sync, no task_id)
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await mv(
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
        assert.equal(json.file_token, "abc123");
        assert.equal(json.folder_token, "fldcnTarget");
      },
    );
  });

  it("mv --json async completion with task polling", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "test_id",
        FEISHU_APP_SECRET: "test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // docx URL: resolveDocument does NOT make an API call
        // Mock chain: tenant token + move API (async with task_id) +
        //             tenant token + task_check (success)
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { task_id: "tsk1" } }),
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { status: "success" } }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        // This test will wait ~1s due to POLL_INTERVAL_MS setTimeout
        await mv(
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
        assert.equal(json.file_token, "abc123");
        assert.equal(json.folder_token, "fldcnTarget");
      },
    );
  });

  it("mv missing args throws INVALID_ARGS", async () => {
    await assert.rejects(
      () =>
        mv(
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

  it("mv human-readable mode shows success message", async () => {
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
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await mv(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "fldcnTarget",
            ],
          },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(
          out.includes("已移动"),
          `Expected stdout to contain "已移动", got: ${out}`,
        );
      },
    );
  });
});
