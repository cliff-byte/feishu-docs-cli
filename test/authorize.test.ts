/**
 * Integration tests for the authorize command validation paths.
 *
 * Tests cover: missing env vars (AUTH_REQUIRED), missing --scope (INVALID_ARGS),
 * invalid scope format (INVALID_ARGS).
 *
 * Per research Pitfall 6: do NOT test full authorize flow
 * (calls oauthLogin which spawns HTTP server + browser).
 * Test validation paths that throw BEFORE calling oauthLogin.
 *
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/commands/authorize.js";
import { CliError } from "../src/utils/errors.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";

describe("authorize command", { concurrency: 1 }, () => {
  it("authorize missing env vars throws AUTH_REQUIRED", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: undefined,
        FEISHU_APP_SECRET: undefined,
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => authorize({}, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      },
    );
  });

  it("authorize missing --scope throws INVALID_ARGS", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => authorize({}, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("authorize invalid scope format throws INVALID_ARGS", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () =>
            authorize(
              { scope: "invalid scope!" },
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
});
