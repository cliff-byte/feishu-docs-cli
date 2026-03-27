/**
 * Integration tests for the delete command.
 *
 * Tests cover: missing input, without --confirm, wiki doc rejection,
 * drive doc delete --json, and human-readable mode.
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
import { del } from "../src/commands/delete.js";

describe("delete command", { concurrency: 1 }, () => {
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

  it("delete missing input throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-delete-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => del({ positionals: [] }, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("delete without --confirm throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-delete-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // For docx URL, resolveDocument does not call resolveWikiToken -- no extra fetch.
        // createClient inside withScopeRecovery runs resolveAuth (no fetch).
        // resolveDocument for docx URL: type "docx" from parseDocUrl, no wiki resolve.
        // BUT: resolveDocument checks parsed.type. For docx, it's "docx" not "wiki"/"unknown",
        // so no fetch needed. However, the delete command runs inside withScopeRecovery
        // which calls createClient → resolveAuth (no fetch needed in tenant mode).
        const { restore: r } = setupMockFetch({
          responses: [],
          strictCount: false,
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await assert.rejects(
          () =>
            del(
              {
                positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
                confirm: false,
              },
              makeGlobalOpts(),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("delete wiki doc throws NOT_SUPPORTED", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-delete-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // Wiki URL: resolveDocument calls resolveWikiToken (2 responses).
        // Returns spaceId, so delete throws NOT_SUPPORTED.
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                node: {
                  obj_token: "docx123",
                  obj_type: "docx",
                  title: "Wiki Doc",
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
            del(
              {
                positionals: ["https://example.feishu.cn/wiki/wikiTk1234567890123"],
                confirm: true,
              },
              makeGlobalOpts(),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "NOT_SUPPORTED");
            return true;
          },
        );
      },
    );
  });

  it("delete drive doc --json mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-delete-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // For docx URL: resolveDocument returns docx type with no spaceId.
        // Delete API call: fetchWithAuth DELETE (2 responses).
        const { restore: r } = setupMockFetch({
          responses: [
            // DELETE API
            tenantTokenResponse(),
            jsonResponse({ code: 0 }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await del(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            confirm: true,
          },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.deleted, "abc123def456789012");
      },
    );
  });

  it("delete human-readable mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-delete-"));
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
            jsonResponse({ code: 0 }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await del(
          {
            positionals: ["https://example.feishu.cn/docx/abc123def456789012"],
            confirm: true,
          },
          makeGlobalOpts({ json: false }),
        );

        const output = cap.stdout();
        assert.ok(output.includes("移入回收站"));
      },
    );
  });
});
