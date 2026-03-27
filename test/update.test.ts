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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

  it("update --overwrite mode --json succeeds with backup+clear+write", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const bodyFile = join(testDir, "overwrite.md");
    await writeFile(bodyFile, "# Title\n\nSome content\n");

    // Create the backups directory so backupDocument can write
    const backupsDir = join(testDir, ".feishu-docs", "backups");
    await mkdir(backupsDir, { recursive: true });

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Full overwrite chain:
        // 1. backupDocument -> fetchAllBlocks (2) + fs write
        // 2. getDocumentInfo (2)
        // 3. clearDocument -> getRootChildrenCount (2) + batch_delete (2) + (getRootChildrenCount returns 0 after)
        // 4. convertAndWrite -> convertMarkdown (2) + writeDescendant (2)
        // 5. title update PATCH (2)
        const { restore: r } = setupMockFetch({
          responses: [
            // backupDocument -> fetchAllBlocks
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    block_id: "abc123def456789012",
                    block_type: 1,
                    children: ["child1"],
                  },
                  {
                    block_id: "child1",
                    block_type: 2,
                    children: [],
                    text: { elements: [] },
                  },
                ],
                has_more: false,
              },
            }),
            // getDocumentInfo
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123def456789012",
                  revision_id: 5,
                  title: "Old",
                },
              },
            }),
            // clearDocument -> getRootChildrenCount
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                block: {
                  block_id: "abc123def456789012",
                  block_type: 1,
                  children: ["child1"],
                },
              },
            }),
            // clearDocument -> batch_delete
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { document_revision_id: 6 } }),
            // convertAndWrite -> convertMarkdown
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
            // convertAndWrite -> writeDescendant
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { document_revision_id: 7 } }),
            // title update PATCH
            tenantTokenResponse(),
            jsonResponse({ code: 0 }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await update(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            body: bodyFile,
          },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.mode, "overwrite");
        assert.equal(result.document_id, "abc123def456789012");
      },
    );
  });

  it("update --overwrite human-readable mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const bodyFile = join(testDir, "overwrite2.md");
    await writeFile(bodyFile, "# Title\n\nSome content\n");
    const backupsDir = join(testDir, ".feishu-docs", "backups");
    await mkdir(backupsDir, { recursive: true });

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
                items: [
                  {
                    block_id: "abc123def456789012",
                    block_type: 1,
                    children: ["child1"],
                  },
                  {
                    block_id: "child1",
                    block_type: 2,
                    children: [],
                    text: { elements: [] },
                  },
                ],
                has_more: false,
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123def456789012",
                  revision_id: 5,
                  title: "Old",
                },
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                block: {
                  block_id: "abc123def456789012",
                  block_type: 1,
                  children: ["child1"],
                },
              },
            }),
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { document_revision_id: 6 } }),
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
            jsonResponse({ code: 0, data: { document_revision_id: 7 } }),
            tenantTokenResponse(),
            jsonResponse({ code: 0 }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await update(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            body: bodyFile,
          },
          makeGlobalOpts({ json: false }),
        );

        assert.ok(cap.stdout().includes("已覆盖更新文档"));
      },
    );
  });

  it("update --overwrite backup failure aborts", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const bodyFile = join(testDir, "overwrite3.md");
    await writeFile(bodyFile, "# Title\n\nContent\n");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // backupDocument -> fetchAllBlocks fails with API error
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 131006,
              msg: "permission denied",
            }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await assert.rejects(
          () =>
            update(
              {
                positionals: [
                  "https://example.feishu.cn/docx/abc123def456789012",
                ],
                body: bodyFile,
              },
              makeGlobalOpts({ json: true }),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.ok(err.message.includes("备份失败"));
            return true;
          },
        );
      },
    );
  });

  it("update --restore mode --json succeeds", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const backupsDir = join(testDir, ".feishu-docs", "backups");
    await mkdir(backupsDir, { recursive: true });

    // Write a valid backup JSON file
    const backupData = [
      { block_id: "abc123def456789012", block_type: 1, children: ["b1"] },
      {
        block_id: "b1",
        block_type: 2,
        children: [],
        text: { elements: [{ text_run: { content: "restored" } }] },
      },
    ];
    const backupFile = join(
      backupsDir,
      "abc123def456789012-1700000000000.json",
    );
    await writeFile(backupFile, JSON.stringify(backupData));

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // restoreFromBackup: getDocumentInfo (2) + clearDocument (getRootChildrenCount 2 + batch_delete 2) + writeDescendant (2)
        const { restore: r } = setupMockFetch({
          responses: [
            // getDocumentInfo
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "abc123def456789012",
                  revision_id: 5,
                  title: "Old",
                },
              },
            }),
            // clearDocument -> getRootChildrenCount
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                block: {
                  block_id: "abc123def456789012",
                  block_type: 1,
                  children: ["c1"],
                },
              },
            }),
            // clearDocument -> batch_delete
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { document_revision_id: 6 } }),
            // writeDescendant
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: { document_revision_id: 7 } }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await update(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            restore: backupFile,
          },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.mode, "restore");
        assert.equal(result.document_id, "abc123def456789012");
      },
    );
  });

  it("update --restore rejects path outside backups dir", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const outsideFile = join(testDir, "outside.json");
    await writeFile(outsideFile, "[]");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
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
                restore: outsideFile,
              },
              makeGlobalOpts(),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.ok(err.message.includes("备份文件必须位于"));
            return true;
          },
        );
      },
    );
  });

  it("update --restore rejects non-json file", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-update-"));
    const backupsDir = join(testDir, ".feishu-docs", "backups");
    await mkdir(backupsDir, { recursive: true });
    const txtFile = join(backupsDir, "backup.txt");
    await writeFile(txtFile, "not json");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
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
                restore: txtFile,
              },
              makeGlobalOpts(),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.ok(err.message.includes(".json"));
            return true;
          },
        );
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
