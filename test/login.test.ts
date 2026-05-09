/**
 * Integration tests for login, logout, and whoami commands.
 *
 * Tests cover: login validation (missing env vars), whoami in tenant mode,
 * whoami in user mode, whoami without auth, logout success, and
 * whoami human-readable output.
 *
 * Per research Pitfall 6: do NOT test full login/authorize flow
 * (spawns HTTP server + browser). Test validation paths only.
 *
 * Mock strategy: No fetch mocks needed for these commands.
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { login, logout, whoami } from "../src/commands/login.js";
import { saveTokens } from "../src/auth.js";
import { CliError } from "../src/utils/errors.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv, withNoAuthEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";

describe("login command", { concurrency: 1 }, () => {
  it("login missing env vars throws AUTH_REQUIRED", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: undefined,
        FEISHU_APP_SECRET: undefined,
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => login({}, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      },
    );
  });
});

describe("whoami command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let homeDir: string;

  // Isolate HOME for the whole group — without this, resolveAuth() would
  // load the developer's real ~/.feishu-docs/auth.json and return user mode
  // even when the test wants tenant or no-auth scenarios.
  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "feishu-whoami-cmd-"));
  });

  afterEach(async () => {
    output?.restore();
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("whoami --json with tenant auth", async () => {
    await withCleanEnv(
      {
        HOME: homeDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        output = captureOutput();
        await whoami({}, makeGlobalOpts({ json: true }));

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.mode, "tenant");
        assert.equal(json.app_id, "cli_test");
      },
    );
  });

  it("whoami --json with user token", async () => {
    await withCleanEnv(
      {
        FEISHU_USER_TOKEN: "u-test-token",
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
      },
      async () => {
        output = captureOutput();
        await whoami({}, makeGlobalOpts({ json: true }));

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.mode, "user");
        assert.equal(json.has_user_token, true);
      },
    );
  });

  it("whoami without auth shows error", async () => {
    // withNoAuthEnv only clears FEISHU_* vars; we still need to redirect HOME
    // so resolveAuth doesn't load real saved tokens from ~/.feishu-docs/.
    await withCleanEnv({ HOME: homeDir }, async () => {
      await withNoAuthEnv(async () => {
        output = captureOutput();
        await whoami({}, makeGlobalOpts({ json: true }));

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, false);
        assert.ok(
          typeof json.error === "string",
          `Expected error message string, got: ${typeof json.error}`,
        );
      });
    });
  });

  it("whoami human-readable with user token should not contain token value", async () => {
    const testToken = "u-test-secret-token-12345";
    await withCleanEnv(
      {
        FEISHU_USER_TOKEN: testToken,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
      },
      async () => {
        output = captureOutput();
        await whoami({}, makeGlobalOpts({ json: false }));
        const out = output.stdout();
        assert.ok(
          out.includes("Token Type: user"),
          `Expected "Token Type: user" in: ${out}`,
        );
        assert.ok(
          !out.includes(testToken),
          "Token value must not appear in output",
        );
        assert.ok(
          !out.includes(testToken.slice(0, 10)),
          "Token prefix must not appear in output",
        );
      },
    );
  });

  it("whoami --json should not contain token value", async () => {
    const testToken = "u-test-secret-token-67890";
    await withCleanEnv(
      {
        FEISHU_USER_TOKEN: testToken,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
      },
      async () => {
        output = captureOutput();
        await whoami({}, makeGlobalOpts({ json: true }));
        const raw = output.stdout();
        assert.ok(
          !raw.includes(testToken),
          "Token value must not appear in JSON output",
        );
        const json = JSON.parse(raw) as Record<string, unknown>;
        assert.equal(json.has_user_token, true);
      },
    );
  });

  it("whoami human-readable with tenant auth", async () => {
    await withCleanEnv(
      {
        HOME: homeDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        output = captureOutput();
        await whoami({}, makeGlobalOpts({ json: false }));

        const out = output.stdout();
        assert.ok(out.includes("tenant"), `Expected "tenant" in: ${out}`);
      },
    );
  });
});

describe("whoami auto-refresh", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    output?.restore();
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = undefined;
    }
  });

  it("does not refresh when token is still valid", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-whoami-valid-"));
    try {
      await withCleanEnv(
        {
          HOME: testDir,
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: "secret-from-env",
        },
        async () => {
          const futureExp = Date.now() + 3600_000;
          await saveTokens("app-valid-id", {
            user_access_token: "u-still-valid",
            refresh_token: "rt-still-valid",
            expires_at: futureExp,
          });

          // Fail loudly if refresh is attempted (no responses configured).
          const { calls, restore } = setupMockFetch({ responses: [] });
          restoreFetch = restore;

          output = captureOutput();
          await whoami({}, makeGlobalOpts({ json: true }));

          assert.equal(calls.length, 0, "should not call refresh API");
          const json = output.stdoutJson() as Record<string, unknown>;
          assert.equal(json.success, true);
          assert.equal(json.refreshed, false);
          assert.equal(json.refresh_error, undefined);
          assert.equal(json.expires_at, futureExp);
        },
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("auto-refreshes expired token (human-readable shows 已自动刷新)", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-whoami-refresh-h-"));
    try {
      await withCleanEnv(
        {
          HOME: testDir,
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: "secret-from-env",
        },
        async () => {
          await saveTokens("app-refresh-id", {
            user_access_token: "u-stale",
            refresh_token: "rt-still-good",
            expires_at: Date.now() - 60_000,
          });

          const { calls, restore } = setupMockFetch({
            responses: [
              jsonResponse({
                code: 0,
                access_token: "u-fresh",
                refresh_token: "rt-rotated",
                expires_in: 7200,
                token_type: "Bearer",
              }),
            ],
          });
          restoreFetch = restore;

          output = captureOutput();
          await whoami({}, makeGlobalOpts({ json: false }));

          assert.equal(calls.length, 1, "should call refresh API once");
          assert.ok(
            calls[0].url.includes("/open-apis/authen/v2/oauth/token"),
            `Expected refresh endpoint, got: ${calls[0].url}`,
          );
          const out = output.stdout();
          assert.ok(
            out.includes("(已自动刷新)"),
            `Expected "已自动刷新" suffix in: ${out}`,
          );
          assert.ok(
            !out.includes("已过期"),
            `Should not show 已过期 after successful refresh, got: ${out}`,
          );
        },
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("auto-refreshes expired token (JSON shows refreshed=true with new expires_at)", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-whoami-refresh-j-"));
    try {
      await withCleanEnv(
        {
          HOME: testDir,
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: "secret-from-env",
        },
        async () => {
          await saveTokens("app-refresh-id", {
            user_access_token: "u-stale",
            refresh_token: "rt-still-good",
            expires_at: Date.now() - 60_000,
          });

          const beforeRefresh = Date.now();
          const { restore } = setupMockFetch({
            responses: [
              jsonResponse({
                code: 0,
                access_token: "u-fresh",
                refresh_token: "rt-rotated",
                expires_in: 7200,
                token_type: "Bearer",
              }),
            ],
          });
          restoreFetch = restore;

          output = captureOutput();
          await whoami({}, makeGlobalOpts({ json: true }));

          const json = output.stdoutJson() as Record<string, unknown>;
          assert.equal(json.success, true);
          assert.equal(json.refreshed, true);
          assert.equal(json.refresh_error, undefined);
          assert.ok(
            typeof json.expires_at === "number" &&
              (json.expires_at as number) > beforeRefresh + 7000_000,
            `Expected new expires_at ~7200s in future, got: ${json.expires_at}`,
          );
        },
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("reports refresh failure in human-readable mode", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-whoami-fail-h-"));
    try {
      await withCleanEnv(
        {
          HOME: testDir,
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: "secret-from-env",
        },
        async () => {
          await saveTokens("app-fail-id", {
            user_access_token: "u-stale",
            refresh_token: "rt-rotted",
            expires_at: Date.now() - 60_000,
          });

          const { calls, restore } = setupMockFetch({
            responses: [
              jsonResponse({
                code: 99991663,
                msg: "refresh token expired",
                access_token: "",
                refresh_token: "",
              }),
            ],
          });
          restoreFetch = restore;

          output = captureOutput();
          await whoami({}, makeGlobalOpts({ json: false }));

          assert.equal(calls.length, 1, "should attempt refresh");
          const out = output.stdout();
          assert.ok(
            out.includes("自动刷新失败"),
            `Expected 自动刷新失败 hint, got: ${out}`,
          );
          assert.ok(
            out.includes("feishu-docs login"),
            `Expected re-login hint, got: ${out}`,
          );
        },
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("reports refresh failure in JSON mode (refreshed=false, refresh_error set)", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-whoami-fail-j-"));
    try {
      await withCleanEnv(
        {
          HOME: testDir,
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: "secret-from-env",
        },
        async () => {
          await saveTokens("app-fail-id", {
            user_access_token: "u-stale",
            refresh_token: "rt-rotted",
            expires_at: Date.now() - 60_000,
          });

          const { restore } = setupMockFetch({
            responses: [
              jsonResponse({
                code: 99991663,
                msg: "refresh token expired",
                access_token: "",
                refresh_token: "",
              }),
            ],
          });
          restoreFetch = restore;

          output = captureOutput();
          await whoami({}, makeGlobalOpts({ json: true }));

          const json = output.stdoutJson() as Record<string, unknown>;
          assert.equal(json.success, true);
          assert.equal(json.refreshed, false);
          assert.ok(
            typeof json.refresh_error === "string" &&
              (json.refresh_error as string).length > 0,
            `Expected refresh_error string, got: ${json.refresh_error}`,
          );
        },
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("preserves legacy 已过期 output when no refresh_token is stored", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-whoami-norefresh-"));
    try {
      await withCleanEnv(
        {
          HOME: testDir,
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: undefined,
        },
        async () => {
          await saveTokens("app-norefresh-id", {
            user_access_token: "u-stale",
            refresh_token: "", // no refresh_token available
            expires_at: Date.now() - 60_000,
          });

          // No fetch should happen — fail loudly if it does.
          const { calls, restore } = setupMockFetch({ responses: [] });
          restoreFetch = restore;

          output = captureOutput();
          await whoami({}, makeGlobalOpts({ json: false }));

          assert.equal(calls.length, 0, "should not attempt refresh");
          const out = output.stdout();
          assert.ok(
            out.includes("(已过期)"),
            `Expected legacy 已过期 suffix, got: ${out}`,
          );
          assert.ok(
            !out.includes("已自动刷新"),
            "Should not claim auto-refresh happened",
          );
          assert.ok(
            !out.includes("自动刷新失败"),
            "Should not show refresh-failure hint when no refresh was attempted",
          );
        },
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});

describe("logout command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;

  afterEach(() => {
    output?.restore();
  });

  it("logout completes without error", async () => {
    // Isolate HOME to a temp dir so clearTokens cannot delete the real
    // ~/.feishu-docs/auth.json on the developer's machine.
    const testDir = await mkdtemp(join(tmpdir(), "feishu-logout-"));
    try {
      await withCleanEnv({ HOME: testDir }, async () => {
        output = captureOutput();
        // clearTokens checks existsSync before unlink, so this is safe
        // even when no auth.json exists
        await logout({}, makeGlobalOpts());

        const err = output.stderr();
        assert.ok(
          err.includes("已清除"),
          `Expected "已清除" in stderr: ${err}`,
        );
      });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
