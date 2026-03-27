/**
 * Integration tests for tree command.
 *
 * Tests tree output in JSON and human-readable modes, depth limiting,
 * nested children, and missing argument validation.
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
import { meta } from "../src/commands/tree.js";
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

describe("tree command", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("tree --json outputs tree structure", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "tree-json-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // createClient -> resolveAuth -> tenant
      // fetchWithAuth for space info: tenant_token + space API = 2
      // buildNodeTree -> fetchChildren: tenant_token + nodes API = 2
      // Total: 4 fetches
      const { restore: rFetch } = setupMockFetch({
        responses: [
          // Space info: getTenantToken
          tenantTokenResponse(),
          // Space info: GET /open-apis/wiki/v2/spaces/{id}
          jsonResponse({
            code: 0,
            data: {
              space: { name: "Test Space", space_id: "sp1" },
            },
          }),
          // fetchChildren: getTenantToken
          tenantTokenResponse(),
          // fetchChildren: GET /open-apis/wiki/v2/spaces/{id}/nodes
          jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  title: "Doc1",
                  node_token: "nd1",
                  obj_type: "docx",
                  has_child: false,
                  obj_token: "doc1",
                },
              ],
              has_more: false,
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.handler(
        { positionals: ["sp1"] },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      assert.equal(json.space_id, "sp1");
      const nodes = json.nodes as Array<Record<string, unknown>>;
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].title, "Doc1");
      assert.equal(nodes[0].nodeToken, "nd1");
    });
  });

  it("tree missing space_id throws INVALID_ARGS", async () => {
    await assert.rejects(
      meta.handler(
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

  it("tree --depth limits recursion", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "tree-depth-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // With depth=1, buildNodeTree should NOT recurse into children
      // even though has_child is true
      const { calls, restore: rFetch } = setupMockFetch({
        responses: [
          // Space info: getTenantToken
          tenantTokenResponse(),
          // Space info
          jsonResponse({
            code: 0,
            data: {
              space: { name: "Deep Space", space_id: "sp_deep" },
            },
          }),
          // fetchChildren (root level): getTenantToken
          tenantTokenResponse(),
          // fetchChildren (root level): nodes API
          jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  title: "Parent",
                  node_token: "nd_parent",
                  obj_type: "docx",
                  has_child: true,
                  obj_token: "doc_parent",
                },
              ],
              has_more: false,
            },
          }),
          // No more fetches expected since depth=1 prevents recursion
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.handler(
        { positionals: ["sp_deep"], depth: "1" },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      const nodes = json.nodes as Array<Record<string, unknown>>;
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].title, "Parent");
      // Children should be empty because depth=1 stops recursion
      assert.deepStrictEqual(
        (nodes[0] as Record<string, unknown>).children,
        [],
      );
      // Only 4 fetches (space info + root children), no child-level fetch
      assert.equal(calls.length, 4);
    });
  });

  it("tree human-readable mode shows tree drawing", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "tree-hr-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              space: { name: "HR Space", space_id: "sp_hr" },
            },
          }),
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  title: "Document Alpha",
                  node_token: "nd_alpha",
                  obj_type: "docx",
                  has_child: false,
                  obj_token: "doc_alpha",
                },
              ],
              has_more: false,
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.handler(
        { positionals: ["sp_hr"] },
        makeGlobalOpts({ json: false }),
      );

      const stdout = output.stdout();
      assert.ok(
        stdout.includes("HR Space"),
        "should contain space name",
      );
      assert.ok(
        stdout.includes("Document Alpha"),
        "should contain node title",
      );
      // Tree drawing characters
      assert.ok(
        stdout.includes("└──") || stdout.includes("├──"),
        "should contain tree connectors",
      );
    });
  });

  it("tree with nested children", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "tree-nested-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // Space info: 2 fetches
      // Root fetchChildren: 2 fetches (returns parent with has_child=true)
      // Child fetchChildren: 2 fetches (returns leaf node)
      // Total: 6
      const { restore: rFetch } = setupMockFetch({
        responses: [
          // Space info
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              space: { name: "Nested Space", space_id: "sp_nest" },
            },
          }),
          // Root children
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  title: "Parent Node",
                  node_token: "nd_parent",
                  obj_type: "docx",
                  has_child: true,
                  obj_token: "doc_parent",
                },
              ],
              has_more: false,
            },
          }),
          // Child-level children
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  title: "Child Node",
                  node_token: "nd_child",
                  obj_type: "sheet",
                  has_child: false,
                  obj_token: "sheet_child",
                },
              ],
              has_more: false,
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await meta.handler(
        { positionals: ["sp_nest"] },
        makeGlobalOpts({ json: true }),
      );

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      const nodes = json.nodes as Array<Record<string, unknown>>;
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].title, "Parent Node");

      const children = nodes[0].children as Array<Record<string, unknown>>;
      assert.equal(children.length, 1);
      assert.equal(children[0].title, "Child Node");
      assert.equal(children[0].objType, "sheet");
    });
  });
});
