/**
 * Integration tests for the update command.
 *
 * Tests cover: missing input, missing --body, --append mode, non-docx rejection,
 * and human-readable mode.
 *
 * Mock strategy: globalThis.fetch level (D-01). Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { CliError } from "../src/utils/errors.js";
import { update } from "../src/commands/update.js";

describe("update command", { concurrency: 1 }, () => {
  let mockRestore: (() => void) | undefined;
  let outputRestore: (() => void) | undefined;
  let testDir: string | undefined;

  afterEach(async () => {
    if (outputRestore) outputRestore();
    if (mockRestore) mockRestore();
    mockRestore = undefined;
    outputRestore = undefined;
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      testDir = undefined;
    }
  });

  it("update missing input throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => update({ positionals: [] }, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("update non-docx type throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Wiki URL resolves to sheet type via resolveDocument.
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                node: {
                  obj_token: "sht123",
                  obj_type: "sheet",
                  title: "Sheet",
                  node_token: "wikiTk1234567890123",
                  space_id: "sp1",
                  has_child: false,
                },
              },
            }),
          ],
        });
        mockRestore = r;

        await assert.rejects(
          () =>
            update(
              {
                positionals: [
                  "https://example.feishu.cn/wiki/wikiTk1234567890123",
                ],
                body: "test.md",
              },
              makeGlobalOpts(),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            assert.ok(err.message.includes("不支持更新"));
            return true;
          },
        );
      },
    );
  });

  it("update missing --body throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // resolveDocument for docx URL: type "docx", no wiki resolve, no fetch needed.
        // But createClient does resolveAuth which is sync-ish. After resolving, the command
        // checks doc.objType (docx) then checks args.restore (undefined) then checks args.body (undefined) -> throws.
        // Actually for docx URL, resolveDocument returns immediately without fetch,
        // but createClient needs to run first.
        // Wait: resolveDocument for a docx URL does NOT call resolveWikiToken, so no fetch. Good.
        // But createClient is called first and does resolveAuth, which is sync in this env setup.
        const { restore: r } = setupMockFetch({
          responses: [],
          strictCount: false,
        });
        mockRestore = r;

        await assert.rejects(
          () =>
            update(
              {
                positionals: [
                  "https://example.feishu.cn/docx/abc123def456789012",
                ],
              },
              makeGlobalOpts(),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            assert.ok(err.message.includes("--body"));
            return true;
          },
        );
      },
    );
  });

  it("update --append mode --json", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const bodyFile = join(testDir, "append.md");
    await writeFile(bodyFile, "Appended content\n");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // For docx URL: no wiki resolve fetch needed.
        // appendToDocument: getDocumentInfo (2) + convertAndWrite: convert (2) + writeDescendant (2) = 6 responses
        const { restore: r } = setupMockFetch({
          responses: [
            // getDocumentInfo
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123def456789012",
                  revision_id: 3,
                  title: "Existing",
                },
              },
            }),
            // convert API
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                blocks: [
                  {
                    block_id: "cvt1",
                    block_type: 2,
                    children: [],
                    text: { elements: [] },
                  },
                ],
                first_level_block_ids: ["cvt1"],
                block_id_to_image_urls: {},
              },
            }),
            // writeDescendant API
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { document_revision_id: 4 },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await update(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            body: bodyFile,
            append: true,
          },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.mode, "append");
        assert.equal(result.document_id, "abc123def456789012");
      },
    );
  });

  it("update human-readable mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const bodyFile = join(testDir, "append2.md");
    await writeFile(bodyFile, "More content\n");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123def456789012",
                  revision_id: 3,
                  title: "Existing",
                },
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                blocks: [
                  {
                    block_id: "cvt1",
                    block_type: 2,
                    children: [],
                    text: { elements: [] },
                  },
                ],
                first_level_block_ids: ["cvt1"],
                block_id_to_image_urls: {},
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { document_revision_id: 4 },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await update(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            body: bodyFile,
            append: true,
          },
          makeGlobalOpts({ json: false }),
        );

        assert.ok(cap.stdout().includes("已追加内容"));
      },
    );
  });
});
