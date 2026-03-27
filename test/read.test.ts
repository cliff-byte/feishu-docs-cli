/**
 * Integration tests for the read command.
 *
 * Tests cover: --raw, --blocks, default markdown, non-docx placeholder,
 * --with-meta, missing input validation, and human-readable mode.
 *
 * Mock strategy: globalThis.fetch level (D-01). Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
import { read } from "../src/commands/read.js";

describe("read command", { concurrency: 1 }, () => {
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

  it("read missing input throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => read({ positionals: [] }, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("read --raw outputs raw text content", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // docx URL: parseDocUrl returns type "docx", no wiki resolve needed.
        // fetchRawContent calls fetchWithAuth once (tenant mode = 2 responses).
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { content: "Hello raw" },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            raw: true,
          },
          makeGlobalOpts(),
        );

        assert.ok(cap.stdout().includes("Hello raw"));
      },
    );
  });

  it("read --blocks outputs JSON blocks", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // fetchAllBlocks calls fetchWithAuth once (tenant mode = 2 responses).
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "Hello" } }],
                    },
                  },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            blocks: true,
          },
          makeGlobalOpts(),
        );

        const output = cap.stdout();
        const parsed = JSON.parse(output);
        assert.ok(Array.isArray(parsed));
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].block_id, "blk1");
      },
    );
  });

  it("read default mode outputs markdown", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // blocksToMarkdown needs a PAGE root block with child text blocks.
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
                    children: ["blk1"],
                  },
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "Hello Markdown" } }],
                    },
                  },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
          },
          makeGlobalOpts(),
        );

        assert.ok(cap.stdout().includes("Hello Markdown"));
      },
    );
  });

  it("read non-docx wiki type outputs placeholder", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // wiki URL: resolveDocument calls resolveWikiToken via fetchWithAuth (2 responses).
        // resolveWikiToken returns sheet type, so read outputs a placeholder.
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                node: {
                  obj_token: "sht123",
                  obj_type: "sheet",
                  title: "My Sheet",
                  node_token: "wikiTk1234567890123",
                  space_id: "sp1",
                  has_child: false,
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/wiki/wikiTk1234567890123"],
          },
          makeGlobalOpts(),
        );

        const output = cap.stdout();
        assert.ok(output.includes("[sheet:"));
        assert.ok(output.includes("My Sheet"));
      },
    );
  });

  it("read --with-meta includes frontmatter", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // fetchAllBlocks (2 responses) + getDocumentInfo (2 responses) = 4 responses.
        const { restore: r } = setupMockFetch({
          responses: [
            // fetchAllBlocks
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    block_id: "abc123def456789012",
                    block_type: 1,
                    children: ["blk1"],
                  },
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "Content" } }],
                    },
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
                  title: "Test Doc",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            withMeta: true,
          },
          makeGlobalOpts(),
        );

        const output = cap.stdout();
        assert.ok(output.startsWith("---"));
        assert.ok(output.includes("title:"));
        assert.ok(output.includes("token:"));
      },
    );
  });

  it("read human-readable mode outputs text content", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // blocksToMarkdown needs a PAGE root block with child text blocks.
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
                    children: ["blk1"],
                  },
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "Human text" } }],
                    },
                  },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
          },
          makeGlobalOpts({ json: false }),
        );

        assert.ok(cap.stdout().includes("Human text"));
      },
    );
  });
});
