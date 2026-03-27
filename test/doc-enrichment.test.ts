/**
 * Tests for document enrichment service.
 *
 * Tests cover: image URL resolution, bitable data fetching,
 * option-based skip, graceful degradation on failure,
 * empty blocks, and mixed token types.
 *
 * Mock strategy: globalThis.fetch level. Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 }.
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
import { enrichBlocks } from "../src/services/doc-enrichment.js";
import type { AuthInfo, Block } from "../src/types/index.js";

function makeAuthInfo(): AuthInfo {
  return {
    mode: "tenant",
    appId: "cli_test_id",
    appSecret: "cli_test_secret",
    useLark: false,
  };
}

/**
 * Capture stderr writes during a callback.
 */
function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = process.stderr.write;
  let captured = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return fn().then(
    () => {
      process.stderr.write = original;
      return captured;
    },
    (err) => {
      process.stderr.write = original;
      throw err;
    },
  );
}

describe("enrichBlocks", { concurrency: 1 }, () => {
  let mockRestore: (() => void) | undefined;
  let testDir: string | undefined;

  afterEach(async () => {
    if (mockRestore) mockRestore();
    mockRestore = undefined;
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      testDir = undefined;
    }
  });

  it("enriches blocks with image tokens -- resolves image URLs", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-enrich-"));
    const imagesDir = join(testDir, ".feishu-docs", "images");
    await mkdir(imagesDir, { recursive: true });

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test_id",
        FEISHU_APP_SECRET: "cli_test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const pngBuf = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        const { restore: r } = setupMockFetch({
          responses: [
            // withScopeRecovery -> createClient -> resolveAuth -> batchGetTmpUrls
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

        const blocks: Block[] = [
          {
            block_id: "imgBlk",
            block_type: 27, // IMAGE
            image: { token: "img_v3_token_abc" },
          },
        ];

        const result = await enrichBlocks(
          makeAuthInfo(),
          blocks,
          makeGlobalOpts(),
          { bitable: false, sheet: false, board: false, mentions: false },
        );

        assert.ok(
          result.imageUrlMap.size > 0,
          "imageUrlMap should have entries",
        );
        assert.ok(
          result.imageUrlMap.has("img_v3_token_abc"),
          "should contain the image token",
        );
      },
    );
  });

  it("enriches blocks with bitable tokens -- fetches bitable data", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-enrich-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test_id",
        FEISHU_APP_SECRET: "cli_test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore: r } = setupMockFetch({
          responses: [
            // fetchBitableData -> fields + records via Promise.all
            tenantTokenResponse(),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [{ field_name: "Name" }, { field_name: "Age" }],
              },
            }),
            jsonResponse({
              code: 0,
              data: {
                items: [{ fields: { Name: "Alice", Age: 30 } }],
              },
            }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const blocks: Block[] = [
          {
            block_id: "bitBlk",
            block_type: 18, // BITABLE
            bitable: { token: "appTk123_tblABC" },
          },
        ];

        const result = await enrichBlocks(
          makeAuthInfo(),
          blocks,
          makeGlobalOpts(),
          { images: false, sheet: false, board: false, mentions: false },
        );

        assert.ok(
          result.bitableDataMap.has("appTk123_tblABC"),
          "should contain bitable data",
        );
        const data = result.bitableDataMap.get("appTk123_tblABC")!;
        assert.deepEqual(data.fields, ["Name", "Age"]);
        assert.equal(data.records.length, 1);
      },
    );
  });

  it("skips bitable enrichment when options.bitable=false", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-enrich-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test_id",
        FEISHU_APP_SECRET: "cli_test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore: r } = setupMockFetch({
          responses: [],
          strictCount: false,
        });
        mockRestore = r;

        const blocks: Block[] = [
          {
            block_id: "bitBlk",
            block_type: 18,
            bitable: { token: "appTk123_tblABC" },
          },
        ];

        const result = await enrichBlocks(
          makeAuthInfo(),
          blocks,
          makeGlobalOpts(),
          {
            images: false,
            bitable: false,
            sheet: false,
            board: false,
            mentions: false,
          },
        );

        assert.equal(
          result.bitableDataMap.size,
          0,
          "bitable should be skipped",
        );
      },
    );
  });

  it("degrades gracefully on API failure -- maps empty, no throw", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-enrich-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test_id",
        FEISHU_APP_SECRET: "cli_test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Return error responses for bitable fetch
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            tenantTokenResponse(),
            jsonResponse({ code: 131006, msg: "permission denied" }),
            jsonResponse({ code: 131006, msg: "permission denied" }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const blocks: Block[] = [
          {
            block_id: "bitBlk",
            block_type: 18,
            bitable: { token: "appFail_tblFail" },
          },
        ];

        const stderr = await captureStderr(async () => {
          const result = await enrichBlocks(
            makeAuthInfo(),
            blocks,
            makeGlobalOpts(),
            { images: false, sheet: false, board: false, mentions: false },
          );
          assert.equal(
            result.bitableDataMap.size,
            0,
            "bitable map should be empty on failure",
          );
        });

        assert.ok(
          stderr.includes("warning"),
          "stderr should contain warning about failed enrichment",
        );
      },
    );
  });

  it("returns empty maps for empty blocks array", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-enrich-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test_id",
        FEISHU_APP_SECRET: "cli_test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore: r } = setupMockFetch({
          responses: [],
          strictCount: false,
        });
        mockRestore = r;

        const result = await enrichBlocks(makeAuthInfo(), [], makeGlobalOpts());

        assert.equal(result.imageUrlMap.size, 0);
        assert.equal(result.userNameMap.size, 0);
        assert.equal(result.bitableDataMap.size, 0);
        assert.equal(result.boardImageMap.size, 0);
        assert.equal(result.sheetDataMap.size, 0);
      },
    );
  });

  it("enriches blocks with mixed token types -- all enrichment types run", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-enrich-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test_id",
        FEISHU_APP_SECRET: "cli_test_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Use concurrency: 1 to ensure predictable mock ordering for
        // bitable (Promise.all: 2 tenant tokens then 2 API) + sheet (2 sequential)
        const { restore: r } = setupMockFetch({
          responses: [
            // bitable: fetchBitableData -> fields + records via Promise.all
            // Promise.all fires 2 fetchWithAuth, each needs tenantToken + API
            tenantTokenResponse(),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { items: [{ field_name: "Col" }] },
            }),
            jsonResponse({
              code: 0,
              data: { items: [{ fields: { Col: "val" } }] },
            }),
            // sheet: fetchSheetData -> metainfo (tenantToken + API)
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { sheets: [{ sheetId: "s1", title: "Sheet1" }] },
            }),
            // sheet: fetchSheetData -> values (tenantToken + API)
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                valueRange: { values: [["H1"], ["r1"]] },
              },
            }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const blocks: Block[] = [
          {
            block_id: "bitBlk",
            block_type: 18,
            bitable: { token: "appX_tblY" },
          },
          {
            block_id: "shtBlk",
            block_type: 30,
            sheet: { token: "sht123_s1" },
          },
        ];

        const result = await enrichBlocks(
          makeAuthInfo(),
          blocks,
          makeGlobalOpts(),
          { images: false, board: false, mentions: false, concurrency: 1 },
        );

        assert.ok(
          result.bitableDataMap.has("appX_tblY"),
          "should have bitable data",
        );
        assert.ok(
          result.sheetDataMap.has("sht123_s1"),
          "should have sheet data",
        );
      },
    );
  });
});
