/**
 * Integration tests for ls command.
 *
 * Tests the full command -> service -> client -> fetch chain by mocking
 * at the globalThis.fetch level. Covers JSON output, type filtering,
 * limit validation, pagination, empty folders, and human-readable mode.
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
import { ls } from "../src/commands/ls.js";
import { CliError } from "../src/utils/errors.js";

describe("ls command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("ls --json lists files", async () => {
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
                files: [{ name: "file1.docx", type: "docx", token: "tok1" }],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await ls(
          { positionals: ["fldcnTest"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson();
        assert.equal(json.success, true);
        assert.equal(json.count, 1);
        assert.ok(Array.isArray(json.files));
        assert.equal(
          (json.files as Array<Record<string, string>>)[0].name,
          "file1.docx",
        );
      },
    );
  });

  it("ls --type filters by type", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "test_id",
        FEISHU_APP_SECRET: "test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { calls, restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                files: [{ name: "sheet1", type: "sheet", token: "tok2" }],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await ls(
          { positionals: ["fldcnTest"], type: "sheet" },
          makeGlobalOpts({ json: true }),
        );

        // Verify the fetch URL includes type=sheet
        const apiCall = calls[1];
        assert.ok(
          apiCall.url.includes("type=sheet"),
          `URL should contain type=sheet, got: ${apiCall.url}`,
        );
      },
    );
  });

  it("ls --limit restricts count", async () => {
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
                files: [
                  { name: "f1", type: "docx", token: "t1" },
                  { name: "f2", type: "docx", token: "t2" },
                  { name: "f3", type: "docx", token: "t3" },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await ls(
          { positionals: ["fldcnTest"], limit: "2" },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson();
        assert.equal(json.count, 2);
        assert.equal((json.files as unknown[]).length, 2);
      },
    );
  });

  it("ls invalid --limit throws INVALID_ARGS", async () => {
    await assert.rejects(
      () => ls({ positionals: [], limit: "0" }, makeGlobalOpts({ json: true })),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("ls invalid --type throws INVALID_ARGS", async () => {
    await assert.rejects(
      () =>
        ls(
          { positionals: [], type: "invalid_type" },
          makeGlobalOpts({ json: true }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("ls empty folder shows message", async () => {
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
              data: { files: [], has_more: false },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await ls(
          { positionals: ["fldcnTest"] },
          makeGlobalOpts({ json: false }),
        );

        assert.ok(
          output.stdout().includes("文件夹为空"),
          `Expected stdout to contain "文件夹为空", got: ${output.stdout()}`,
        );
      },
    );
  });

  it("ls human-readable mode shows file name and type label", async () => {
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
                files: [{ name: "MyDoc", type: "docx", token: "tok1" }],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await ls(
          { positionals: ["fldcnTest"] },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(
          out.includes("MyDoc"),
          `Expected stdout to contain file name "MyDoc", got: ${out}`,
        );
        assert.ok(
          out.includes("[新文档]"),
          `Expected stdout to contain type label "[新文档]", got: ${out}`,
        );
      },
    );
  });

  it("ls pagination collects multiple pages", async () => {
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
                files: [{ name: "f1", type: "docx", token: "t1" }],
                has_more: true,
                next_page_token: "pt1",
              },
            }),
            // Second page needs another tenant token (resolveBearer re-fetches each time)
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                files: [{ name: "f2", type: "docx", token: "t2" }],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await ls(
          { positionals: ["fldcnTest"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson();
        assert.equal(json.count, 2);
        assert.equal((json.files as unknown[]).length, 2);
      },
    );
  });
});
