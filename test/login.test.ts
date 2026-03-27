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

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { login, logout, whoami } from "../src/commands/login.js";
import { CliError } from "../src/utils/errors.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv, withNoAuthEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";

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

  afterEach(() => {
    output?.restore();
  });

  it("whoami --json with tenant auth", async () => {
    await withCleanEnv(
      {
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

describe("logout command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;

  afterEach(() => {
    output?.restore();
  });

  it("logout completes without error", async () => {
    output = captureOutput();
    // clearTokens checks existsSync before unlink, so this is safe
    // even when no auth.json exists
    await logout({}, makeGlobalOpts());

    const err = output.stderr();
    assert.ok(err.includes("已清除"), `Expected "已清除" in stderr: ${err}`);
  });
});
