/**
 * Integration tests for the read command.
 *
 * Tests cover: --raw, --blocks, default markdown, non-docx placeholder,
 * --with-meta, missing input validation, human-readable mode, and
 * enrichment paths (images, bitable, sheet, board, mentions).
 *
 * Mock strategy: globalThis.fetch level (D-01). Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
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

  // --- Enrichment path tests ---

  it("read with image blocks resolves file URLs and downloads", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    // Create images cache dir so downloadImages can write
    const imagesDir = join(testDir, ".feishu-docs", "images");
    await mkdir(imagesDir, { recursive: true });

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Chain:
        // 1. fetchAllBlocks: tenantToken + API (PAGE + TEXT + IMAGE blocks)
        // 2. withScopeRecovery -> createClient -> batchGetTmpUrls: tenantToken + API
        // 3. downloadImages: fetch(tmpUrl) for the image
        // Using strictCount: false to handle any additional interleaved calls
        const pngBuf = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
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
                    children: ["blk1", "imgBlk"],
                  },
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [
                        { text_run: { content: "Text before image" } },
                      ],
                    },
                  },
                  {
                    block_id: "imgBlk",
                    block_type: 27, // IMAGE
                    parent_id: "abc123def456789012",
                    children: [],
                    image: { token: "img_v3_token_abc" },
                  },
                ],
                has_more: false,
              },
            }),
            // batchGetTmpUrls: tenantToken + API
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                tmp_download_urls: [
                  {
                    file_token: "img_v3_token_abc",
                    tmp_download_url: "https://download.feishu.cn/tmp/img123",
                  },
                ],
              },
            }),
            // downloadImages: fetch the image binary
            new Response(pngBuf, {
              status: 200,
              headers: { "content-type": "image/png" },
            }),
          ],
          strictCount: false,
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

        const output = cap.stdout();
        // Image should render with a local file path
        assert.ok(output.includes("Text before image"));
        assert.ok(output.includes("img_v3_token_abc"));
      },
    );
  });

  it("read with bitable block fetches and renders table data", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Chain:
        // 1. fetchAllBlocks: tenantToken + API (PAGE + BITABLE block)
        // 2. fetchBitableData uses Promise.all for fields + records
        //    Interleaved: tenantToken(fields), tenantToken(records), fields API, records API
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
                    children: ["bitBlk"],
                  },
                  {
                    block_id: "bitBlk",
                    block_type: 18, // BITABLE
                    parent_id: "abc123def456789012",
                    children: [],
                    bitable: { token: "appTk123_tblABC" },
                  },
                ],
                has_more: false,
              },
            }),
            // fetchBitableData -> fields + records via Promise.all
            // tenantToken for fields
            tenantTokenResponse(),
            // tenantToken for records
            tenantTokenResponse(),
            // fields API response
            jsonResponse({
              code: 0,
              data: {
                items: [{ field_name: "Name" }, { field_name: "Score" }],
              },
            }),
            // records API response
            jsonResponse({
              code: 0,
              data: {
                items: [
                  { fields: { Name: "Alice", Score: 95 } },
                  { fields: { Name: "Bob", Score: 88 } },
                ],
              },
            }),
          ],
          strictCount: false,
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

        const output = cap.stdout();
        assert.ok(output.includes("Name"), "output should contain field name");
        assert.ok(
          output.includes("Alice"),
          "output should contain record data",
        );
      },
    );
  });

  it("read with sheet block fetches and renders spreadsheet data", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Chain:
        // 1. fetchAllBlocks: tenantToken + API (PAGE + SHEET block)
        // 2. fetchSheetData: metainfo (tenantToken + API) + values (tenantToken + API)
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
                    children: ["shtBlk"],
                  },
                  {
                    block_id: "shtBlk",
                    block_type: 30, // SHEET
                    parent_id: "abc123def456789012",
                    children: [],
                    sheet: { token: "shtTk123_sheetId1" },
                  },
                ],
                has_more: false,
              },
            }),
            // fetchSheetData -> metainfo
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                sheets: [{ sheetId: "sheetId1", title: "Data" }],
              },
            }),
            // fetchSheetData -> values
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                valueRange: {
                  values: [
                    ["Col1", "Col2"],
                    ["a", "b"],
                    ["c", "d"],
                  ],
                },
              },
            }),
          ],
          strictCount: false,
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

        const output = cap.stdout();
        assert.ok(
          output.includes("Col1"),
          "output should contain column header",
        );
        assert.ok(output.includes("a"), "output should contain cell data");
        assert.ok(output.includes("Data"), "output should contain sheet title");
      },
    );
  });

  it("read with mention_user resolves user names", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Chain:
        // 1. fetchAllBlocks: tenantToken + API (PAGE + TEXT block with mention_user)
        // 2. resolveUserNames: getTenantToken + fetchWithAuth (batch contact API)
        //    getTenantToken is a direct fetch (1 call), then fetchWithAuth with tenantAuthInfo
        //    (tenantToken already set) just calls fetch directly (no extra getTenantToken).
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
                    children: ["mentionBlk"],
                  },
                  {
                    block_id: "mentionBlk",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [
                        { mention_user: { user_id: "ou_user123" } },
                        { text_run: { content: " said hello" } },
                      ],
                    },
                  },
                ],
                has_more: false,
              },
            }),
            // resolveUserNames -> getTenantToken (direct fetch)
            tenantTokenResponse(),
            // resolveUserNames -> fetchWithAuth with tenantAuthInfo (tenantToken set)
            // fetchWithAuth calls resolveBearer which sees tenantToken, uses it directly.
            // So just the API call response:
            jsonResponse({
              code: 0,
              data: {
                user_list: [{ open_id: "ou_user123", name: "Zhang San" }],
              },
            }),
          ],
          strictCount: false,
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

        const output = cap.stdout();
        assert.ok(
          output.includes("Zhang San"),
          "output should contain resolved user name",
        );
      },
    );
  });

  it("read with board block attempts image download", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Chain:
        // 1. fetchAllBlocks: tenantToken + API (PAGE + BOARD block)
        // 2. fetchBoardImage: tenantToken (for resolveBearer) + binary fetch
        //    fetchBinaryWithAuth calls resolveBearer -> getTenantToken (1 fetch) + fetch(url) (1 fetch)
        const pngBuf = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
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
                    children: ["boardBlk"],
                  },
                  {
                    block_id: "boardBlk",
                    block_type: 43, // BOARD
                    parent_id: "abc123def456789012",
                    children: [],
                    board: { token: "board_abc123" },
                  },
                ],
                has_more: false,
              },
            }),
            // fetchBoardImage -> fetchBinaryWithAuth -> getTenantToken
            tenantTokenResponse(),
            // fetchBoardImage -> fetchBinaryWithAuth -> actual binary fetch
            new Response(pngBuf, {
              status: 200,
              headers: { "content-type": "image/png" },
            }),
          ],
          strictCount: false,
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

        const output = cap.stdout();
        // Board should render either with image path or fallback
        assert.ok(output.length > 0, "should produce some output");
        assert.ok(
          output.includes("board_abc123") || output.includes("画板"),
          "output should reference the board",
        );
      },
    );
  });

  it("read enrichment failure degrades gracefully with warnings", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Blocks include TEXT + IMAGE + BITABLE.
        // After fetchAllBlocks succeeds, enrichment calls fail gracefully.
        // Using strictCount: false so excess calls return {code: 0} defaults.
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
                    children: ["txtBlk", "imgBlk2", "bitBlk2"],
                  },
                  {
                    block_id: "txtBlk",
                    block_type: 2,
                    parent_id: "abc123def456789012",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "Still visible" } }],
                    },
                  },
                  {
                    block_id: "imgBlk2",
                    block_type: 27,
                    parent_id: "abc123def456789012",
                    children: [],
                    image: { token: "img_v3_fail_token" },
                  },
                  {
                    block_id: "bitBlk2",
                    block_type: 18,
                    parent_id: "abc123def456789012",
                    children: [],
                    bitable: { token: "appFail_tblFail" },
                  },
                ],
                has_more: false,
              },
            }),
            // batchGetTmpUrls for image: tenantToken + API error
            tenantTokenResponse(),
            jsonResponse({ code: 131006, msg: "permission denied" }),
          ],
          strictCount: false,
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

        const output = cap.stdout();
        const errors = cap.stderr();
        // Text block content should still be rendered
        assert.ok(
          output.includes("Still visible"),
          "text content should render despite enrichment failures",
        );
        // Warnings should appear on stderr for failed enrichments
        assert.ok(
          errors.includes("warning"),
          "stderr should contain warnings about failed enrichments",
        );
      },
    );
  });
});
