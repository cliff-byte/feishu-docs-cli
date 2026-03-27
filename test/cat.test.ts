/**
 * Integration tests for the cat command.
 *
 * Tests cover: missing space_id, streaming output, --depth limit,
 * --max-docs limit, and human-readable mode.
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
import { meta } from "../src/commands/cat.js";

const catHandler = meta.handler;

describe("cat command", { concurrency: 1 }, () => {
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

  it("cat missing space_id throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-cat-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => catHandler({ positionals: [] }, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("cat outputs documents with headers", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-cat-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // fetchChildren (2 responses) + fetchAllBlocks for docx node (2 responses) = 4 responses
        const { restore: r } = setupMockFetch({
          responses: [
            // fetchChildren
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    space_id: "sp_test",
                    node_token: "nd1",
                    obj_token: "docxTk12345678901234",
                    obj_type: "docx",
                    title: "Doc One",
                    has_child: false,
                  },
                ],
                has_more: false,
              },
            }),
            // fetchAllBlocks for docx node
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    block_id: "docxTk12345678901234",
                    block_type: 1,
                    children: ["blk1"],
                  },
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "docxTk12345678901234",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "Cat content" } }],
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

        await catHandler(
          { positionals: ["sp_test"] },
          makeGlobalOpts(),
        );

        const output = cap.stdout();
        assert.ok(output.includes("path: Doc One"));
        assert.ok(output.includes("Cat content"));
      },
    );
  });

  it("cat with maxDocs stops after N docs", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-cat-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // fetchChildren returns 2 nodes, but maxDocs=1 so only first is processed.
        // fetchChildren (2) + fetchAllBlocks for first doc (2) = 4 responses.
        // The second doc triggers the limit warning before fetching.
        const { restore: r } = setupMockFetch({
          responses: [
            // fetchChildren
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    space_id: "sp_test",
                    node_token: "nd1",
                    obj_token: "docxTk12345678901234",
                    obj_type: "docx",
                    title: "First Doc",
                    has_child: false,
                  },
                  {
                    space_id: "sp_test",
                    node_token: "nd2",
                    obj_token: "docxTk56789012345678",
                    obj_type: "docx",
                    title: "Second Doc",
                    has_child: false,
                  },
                ],
                has_more: false,
              },
            }),
            // fetchAllBlocks for first doc
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    block_id: "docxTk12345678901234",
                    block_type: 1,
                    children: ["blk1"],
                  },
                  {
                    block_id: "blk1",
                    block_type: 2,
                    parent_id: "docxTk12345678901234",
                    children: [],
                    text: {
                      elements: [{ text_run: { content: "First" } }],
                    },
                  },
                ],
                has_more: false,
              },
            }),
          ],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await catHandler(
          { positionals: ["sp_test"], maxDocs: 1 },
          makeGlobalOpts(),
        );

        const output = cap.stdout();
        // Only first doc should appear.
        assert.ok(output.includes("First Doc"));
        assert.ok(!output.includes("Second Doc"));
        // Warning about limit should be on stderr.
        assert.ok(cap.stderr().includes("--max-docs"));
      },
    );
  });

  it("cat with depth=0 limits recursion", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-cat-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // depth=0 means walkNodes returns immediately without fetching children.
        // No fetch calls should happen for children since maxDepth = 0 and currentDepth starts at 0.
        const { restore: r } = setupMockFetch({
          responses: [],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await catHandler(
          { positionals: ["sp_test"], depth: "0" },
          makeGlobalOpts(),
        );

        // With depth=0, no docs are read.
        const output = cap.stdout();
        assert.equal(output, "");
        // Info message about no documents found.
        assert.ok(cap.stderr().includes("未找到"));
      },
    );
  });

  it("cat outputs non-docx type as placeholder", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-cat-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // fetchChildren returns a sheet node (non-docx).
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                items: [
                  {
                    space_id: "sp_test",
                    node_token: "nd1",
                    obj_token: "shtTk12345678901234",
                    obj_type: "sheet",
                    title: "My Sheet",
                    has_child: false,
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

        await catHandler(
          { positionals: ["sp_test"] },
          makeGlobalOpts(),
        );

        const output = cap.stdout();
        assert.ok(output.includes("[sheet:"));
        assert.ok(output.includes("shtTk12345678901234"));
      },
    );
  });
});
