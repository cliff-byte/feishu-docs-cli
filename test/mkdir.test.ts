/**
 * Integration tests for mkdir command.
 *
 * Tests the full command -> service -> client -> fetch chain by mocking
 * at the globalThis.fetch level. Covers JSON output, --parent option,
 * missing name validation, and human-readable mode.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse, tenantTokenResponse } from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { mkdir } from "../src/commands/mkdir.js";
import { CliError } from "../src/utils/errors.js";

describe("mkdir command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("mkdir --json creates folder", async () => {
    await withCleanEnv(
      { FEISHU_APP_ID: "test_id", FEISHU_APP_SECRET: "test_secret", FEISHU_USER_TOKEN: undefined },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                token: "fldcn123",
                url: "https://feishu.cn/drive/folder/fldcn123",
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await mkdir(
          { positionals: ["NewFolder"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson();
        assert.equal(json.success, true);
        assert.equal(json.token, "fldcn123");
        assert.equal(json.name, "NewFolder");
      },
    );
  });

  it("mkdir missing name throws INVALID_ARGS", async () => {
    await assert.rejects(
      () => mkdir({ positionals: [] }, makeGlobalOpts({ json: true })),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("mkdir with --parent sends correct folder_token", async () => {
    await withCleanEnv(
      { FEISHU_APP_ID: "test_id", FEISHU_APP_SECRET: "test_secret", FEISHU_USER_TOKEN: undefined },
      async () => {
        const { calls, restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                token: "fldcnSub",
                url: "https://feishu.cn/drive/folder/fldcnSub",
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await mkdir(
          { positionals: ["SubFolder"], parent: "fldcnParent" },
          makeGlobalOpts({ json: true }),
        );

        // Verify the POST body contains the parent folder token
        const apiCall = calls[1];
        assert.ok(apiCall.init?.body, "Expected POST body");
        const body = JSON.parse(apiCall.init!.body as string) as Record<string, unknown>;
        assert.equal(body.folder_token, "fldcnParent");
      },
    );
  });

  it("mkdir human-readable mode shows creation message", async () => {
    await withCleanEnv(
      { FEISHU_APP_ID: "test_id", FEISHU_APP_SECRET: "test_secret", FEISHU_USER_TOKEN: undefined },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                token: "fldcn456",
                url: "https://feishu.cn/drive/folder/fldcn456",
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await mkdir(
          { positionals: ["TestDir"] },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(
          out.includes("已创建文件夹"),
          `Expected stdout to contain "已创建文件夹", got: ${out}`,
        );
        assert.ok(
          out.includes("TestDir"),
          `Expected stdout to contain folder name "TestDir", got: ${out}`,
        );
      },
    );
  });
});
