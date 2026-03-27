/**
 * Integration tests for the create command.
 *
 * Tests cover: missing title validation, drive create --json, wiki create --json,
 * create with --body content, and human-readable mode.
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
import { create } from "../src/commands/create.js";

describe("create command", { concurrency: 1 }, () => {
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

  it("create missing title throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => create({ positionals: [] }, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("create doc in drive --json mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // createDoc: fetchWithAuth POST (2 responses)
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc1",
                  title: "Test Doc",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Test Doc"] },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "newdoc1");
      },
    );
  });

  it("create doc in wiki --json mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // createInWiki: fetchWithAuth POST (2 responses)
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                node: {
                  obj_token: "wikiobj1",
                  node_token: "nd1",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Wiki Doc"], wiki: "sp_test" },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "wikiobj1");
      },
    );
  });

  it("create doc with --body content", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    const bodyFile = join(testDir, "content.md");
    await writeFile(bodyFile, "Some paragraph content\n");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // createDoc (2) + getDocumentInfo (2) + convertAndWrite: convert (2) + writeDescendant (2) = 8 responses
        const { restore: r } = setupMockFetch({
          responses: [
            // createDoc
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc2",
                  title: "Body Doc",
                },
              },
            }),
            // getDocumentInfo
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc2",
                  revision_id: 1,
                  title: "Body Doc",
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
              data: {
                document_revision_id: 2,
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Body Doc"], body: bodyFile },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "newdoc2");
      },
    );
  });

  it("create human-readable mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
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
                  document_id: "newdoc3",
                  title: "Human Doc",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Human Doc"] },
          makeGlobalOpts({ json: false }),
        );

        assert.ok(cap.stdout().includes("文档已创建"));
      },
    );
  });
});
