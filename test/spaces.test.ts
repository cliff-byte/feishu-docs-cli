/**
 * Integration tests for spaces command.
 *
 * Tests JSON output, pagination, empty results, and human-readable mode.
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
import { spaces } from "../src/commands/spaces.js";

/** Standard env vars for tenant-mode auth resolution. */
function testEnv(homeDir: string): Record<string, string> {
  return {
    FEISHU_APP_ID: "cli_test_id",
    FEISHU_APP_SECRET: "cli_test_secret",
    FEISHU_USER_TOKEN: undefined as unknown as string,
    HOME: homeDir,
  };
}

describe("spaces command", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;

  afterEach(() => {
    restoreOutput?.();
    restoreFetch?.();
    restoreOutput = undefined;
    restoreFetch = undefined;
  });

  it("spaces --json lists all spaces", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "spaces-json-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // createClient -> resolveAuth -> tenant
      // fetchWithAuth: getTenantToken + spaces API = 2
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [
                { space_id: "sp1", name: "Wiki1" },
              ],
              has_more: false,
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await spaces({}, makeGlobalOpts({ json: true }));

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      const spaceList = json.spaces as Array<Record<string, unknown>>;
      assert.equal(spaceList.length, 1);
      assert.equal(spaceList[0].space_id, "sp1");
      assert.equal(spaceList[0].name, "Wiki1");
    });
  });

  it("spaces pagination collects all pages", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "spaces-page-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      // Page 1: getTenantToken + API (has_more=true)
      // Page 2: getTenantToken + API (has_more=false)
      // Total: 4
      const { restore: rFetch } = setupMockFetch({
        responses: [
          // Page 1
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [{ space_id: "sp1", name: "W1" }],
              has_more: true,
              page_token: "pt1",
            },
          }),
          // Page 2
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [{ space_id: "sp2", name: "W2" }],
              has_more: false,
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await spaces({}, makeGlobalOpts({ json: true }));

      const json = output.stdoutJson() as Record<string, unknown>;
      assert.equal(json.success, true);
      const spaceList = json.spaces as Array<Record<string, unknown>>;
      assert.equal(spaceList.length, 2);
      assert.equal(spaceList[0].space_id, "sp1");
      assert.equal(spaceList[1].space_id, "sp2");
    });
  });

  it("spaces empty result shows message", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "spaces-empty-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [],
              has_more: false,
            },
          }),
        ],
      });
      restoreFetch = rFetch;

      const output = captureOutput();
      restoreOutput = output.restore;

      await spaces({}, makeGlobalOpts({ json: false }));

      const stdout = output.stdout();
      assert.ok(
        stdout.includes("没有找到知识库"),
        "should show empty message",
      );
    });
  });

  it("spaces human-readable mode lists space details", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "spaces-hr-"));
    await withCleanEnv(testEnv(homeDir), async () => {
      const { restore: rFetch } = setupMockFetch({
        responses: [
          tenantTokenResponse(),
          jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  space_id: "sp_display",
                  name: "Engineering Wiki",
                  description: "Team docs",
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

      await spaces({}, makeGlobalOpts({ json: false }));

      const stdout = output.stdout();
      assert.ok(
        stdout.includes("sp_display"),
        "should contain space_id",
      );
      assert.ok(
        stdout.includes("Engineering Wiki"),
        "should contain space name",
      );
      assert.ok(
        stdout.includes("Team docs"),
        "should contain description",
      );
    });
  });
});
