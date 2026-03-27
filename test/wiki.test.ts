/**
 * Integration tests for wiki command: 6 subcommands.
 *
 * Tests create-space, add-member, remove-member, rename, move, copy.
 * Accesses handlers via meta.subcommands["name"].handler pattern.
 * All describe blocks use { concurrency: 1 } to prevent fetch mock pollution.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { meta } from "../src/commands/wiki.js";
import { CliError } from "../src/utils/errors.js";

/** Standard env vars for tenant-mode auth resolution. */
function testEnv(homeDir: string): Record<string, string> {
  return {
    FEISHU_APP_ID: "cli_test_id",
    FEISHU_APP_SECRET: "cli_test_secret",
    FEISHU_USER_TOKEN: undefined as unknown as string,
    HOME: homeDir,
  };
}

describe("wiki create-space", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("create-space --json returns space info", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-cs-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              space: { space_id: "sp_new", name: "Test Wiki" },
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["create-space"].handler(
        { positionals: ["Test Wiki"], desc: "A test wiki" },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.space_id, "sp_new");
      assert.equal(json.name, "Test Wiki");
    });
  });

  it("create-space missing name throws INVALID_ARGS", async () => {
    await assert.rejects(
      meta.subcommands["create-space"].handler(
        { positionals: [] },
        makeGlobalOpts({ json: true }),
      ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("create-space human-readable outputs space name", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-cs-hr-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              space: { space_id: "sp_hr", name: "My Wiki" },
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["create-space"].handler(
        { positionals: ["My Wiki"] },
        makeGlobalOpts({ json: false }),
      );

      const stdout = output.stdout();
      assert.ok(stdout.includes("已创建知识库"), "should contain creation message");
      assert.ok(stdout.includes("My Wiki"), "should contain space name");
    });
  });
});

describe("wiki add-member", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("add-member --json returns success", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-am-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({ code: 0 }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["add-member"].handler(
        { positionals: ["sp_test", "user@test.com"], role: "admin" },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.space_id, "sp_test");
      assert.equal(json.member_id, "user@test.com");
      assert.equal(json.member_type, "email");
      assert.equal(json.member_role, "admin");
    });
  });

  it("add-member missing args throws INVALID_ARGS", async () => {
    await assert.rejects(
      meta.subcommands["add-member"].handler(
        { positionals: ["sp_test"] },
        makeGlobalOpts({ json: true }),
      ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });
});

describe("wiki remove-member", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("remove-member --json returns success", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-rm-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({ code: 0 }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["remove-member"].handler(
        { positionals: ["sp_test", "user@test.com"], role: "admin" },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.space_id, "sp_test");
      assert.equal(json.removed, "user@test.com");
    });
  });
});

describe("wiki rename", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("rename --json returns success with node info", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-rn-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // createClient -> resolveAuth (env) -> tenant mode
      // resolveWikiNode -> resolveDocument -> resolveWikiToken -> fetchWithAuth (tenant_token + wiki resolve) = 2 fetches
      // rename -> fetchWithAuth (tenant_token + rename API) = 2 fetches
      // Total: 4 fetches
      const { restore: rFetch } = setupMockFetch({
        responses: [
          // fetchWithAuth for resolveWikiToken: getTenantToken
          tenantTokenResponse(),
          // fetchWithAuth for resolveWikiToken: wiki resolve API
          jsonResponse({
            code: 0,
            data: {
              node: {
                obj_token: "doc1",
                obj_type: "docx",
                title: "Old Title",
                node_token: "nd1",
                space_id: "sp1",
                has_child: false,
              },
            },
          }),
          // fetchWithAuth for rename: getTenantToken
          tenantTokenResponse(),
          // fetchWithAuth for rename: rename API
          jsonResponse({ code: 0 }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["rename"].handler(
        {
          positionals: [
            "https://test.feishu.cn/wiki/abc12345678901234567",
          ],
          title: "New Title",
        },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.space_id, "sp1");
      assert.equal(json.node_token, "nd1");
      assert.equal(json.title, "New Title");
    });
  });

  it("rename missing title throws INVALID_ARGS", async () => {
    await assert.rejects(
      meta.subcommands["rename"].handler(
        { positionals: ["https://test.feishu.cn/wiki/abc12345678901234567"] },
        makeGlobalOpts({ json: true }),
      ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("rename human-readable outputs new title", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-rn-hr-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              node: {
                obj_token: "doc1",
                obj_type: "docx",
                title: "Old",
                node_token: "nd1",
                space_id: "sp1",
                has_child: false,
              },
            },
          }),
          tenantTokenResponse(),
          jsonResponse({ code: 0 }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["rename"].handler(
        {
          positionals: [
            "https://test.feishu.cn/wiki/abc12345678901234567",
          ],
          title: "New Name",
        },
        makeGlobalOpts({ json: false }),
      );

      const stdout = output.stdout();
      assert.ok(stdout.includes("已重命名"), "should contain rename message");
      assert.ok(stdout.includes("New Name"), "should contain new title");
    });
  });
});

describe("wiki move", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("move --json returns success", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-mv-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // resolveWikiNode: tenant_token + wiki resolve = 2
      // move API: tenant_token + move = 2
      // Total: 4
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              node: {
                obj_token: "doc1",
                obj_type: "docx",
                title: "Movable",
                node_token: "nd1",
                space_id: "sp1",
                has_child: false,
              },
            },
          }),
          tenantTokenResponse(),
          jsonResponse({ code: 0 }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["move"].handler(
        {
          positionals: [
            "https://test.feishu.cn/wiki/abc12345678901234567",
          ],
          to: "sp_target",
        },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.node_token, "nd1");
      assert.equal(json.from_space, "sp1");
      assert.equal(json.to_space, "sp_target");
    });
  });

  it("move missing destination throws INVALID_ARGS", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-mv-err-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // resolveWikiNode still needs fetch mocks
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              node: {
                obj_token: "doc1",
                obj_type: "docx",
                title: "Node",
                node_token: "nd1",
                space_id: "sp1",
                has_child: false,
              },
            },
          }),
        ],
        strictCount: false,
      });
      restoreFetch = rFetch;

      await assert.rejects(
        meta.subcommands["move"].handler(
          {
            positionals: [
              "https://test.feishu.cn/wiki/abc12345678901234567",
            ],
          },
          makeGlobalOpts({ json: true }),
        ),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "INVALID_ARGS");
          return true;
        },
      );
    });
  });
});

describe("wiki copy", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("copy --json returns success with new node", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-cp-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // resolveWikiNode: tenant_token + wiki resolve = 2
      // copy API: tenant_token + copy = 2
      // Total: 4
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              node: {
                obj_token: "doc1",
                obj_type: "docx",
                title: "Copiable",
                node_token: "nd1",
                space_id: "sp1",
                has_child: false,
              },
            },
          }),
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              node: { node_token: "nd_copy", space_id: "sp_target" },
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.subcommands["copy"].handler(
        {
          positionals: [
            "https://test.feishu.cn/wiki/abc12345678901234567",
          ],
          to: "sp_target",
        },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.source_node, "nd1");
      assert.equal(json.new_node_token, "nd_copy");
    });
  });

  it("copy missing destination throws INVALID_ARGS", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "wiki-cp-err-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              node: {
                obj_token: "doc1",
                obj_type: "docx",
                title: "Node",
                node_token: "nd1",
                space_id: "sp1",
                has_child: false,
              },
            },
          }),
        ],
        strictCount: false,
      });
      restoreFetch = rFetch;

      await assert.rejects(
        meta.subcommands["copy"].handler(
          {
            positionals: [
              "https://test.feishu.cn/wiki/abc12345678901234567",
            ],
          },
          makeGlobalOpts({ json: true }),
        ),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "INVALID_ARGS");
          return true;
        },
      );
    });
  });
});
