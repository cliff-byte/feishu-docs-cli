/**
 * Tests for resolveAuth multi-mode authentication resolution.
 *
 * Covers CORE-03: the priority chain for user, tenant, and auto modes,
 * including env var resolution, saved token loading, and error paths.
 * All tests use { concurrency: 1 } to prevent env var pollution.
 * Temp directory isolation via HOME env var (os.homedir() respects HOME).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withCleanEnv, withNoAuthEnv } from "./helpers/env-guard.js";
import { resolveAuth, saveTokens } from "../src/auth.js";
import { CliError } from "../src/utils/errors.js";

describe("resolveAuth", { concurrency: 1 }, () => {
  describe("user mode", { concurrency: 1 }, () => {
    it("returns user mode from FEISHU_USER_TOKEN env var", async () => {
      await withCleanEnv(
        {
          FEISHU_USER_TOKEN: "u-env-token-abc",
          FEISHU_APP_ID: "app-test-id",
          FEISHU_APP_SECRET: "app-test-secret",
        },
        async () => {
          const auth = await resolveAuth("user");
          assert.equal(auth.mode, "user");
          assert.equal(auth.userToken, "u-env-token-abc");
          assert.equal(auth.appId, "app-test-id");
          assert.equal(auth.useLark, false);
        },
      );
    });

    it("loads saved tokens when no env token available", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "feishu-resolve-user-"));
      try {
        // Set HOME to redirect os.homedir() to temp dir for token save/load
        await withCleanEnv(
          {
            HOME: testDir,
            FEISHU_USER_TOKEN: undefined,
            FEISHU_APP_ID: undefined,
            FEISHU_APP_SECRET: "secret-from-env",
          },
          async () => {
            const tokenData = {
              user_access_token: "u-saved-token-xyz",
              refresh_token: "rt-saved-refresh",
              expires_at: Date.now() + 7200_000,
            };
            await saveTokens("app-saved-id", tokenData);

            const auth = await resolveAuth("user");
            assert.equal(auth.mode, "user");
            assert.equal(auth.userToken, "u-saved-token-xyz");
            assert.equal(auth.appId, "app-saved-id");
            assert.equal(auth.refreshToken, "rt-saved-refresh");
          },
        );
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("throws AUTH_REQUIRED when no user token available", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "feishu-resolve-empty-"));
      try {
        await withCleanEnv(
          {
            HOME: emptyDir,
            FEISHU_USER_TOKEN: undefined,
            FEISHU_APP_ID: undefined,
            FEISHU_APP_SECRET: undefined,
            FEISHU_REDIRECT_URI: undefined,
            FEISHU_OAUTH_PORT: undefined,
          },
          async () => {
            await assert.rejects(
              () => resolveAuth("user"),
              (err: unknown) => {
                assert.ok(err instanceof CliError);
                assert.equal(err.errorType, "AUTH_REQUIRED");
                return true;
              },
            );
          },
        );
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("tenant mode", { concurrency: 1 }, () => {
    it("returns tenant mode from env vars", async () => {
      await withCleanEnv(
        {
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: "app-tenant-id",
          FEISHU_APP_SECRET: "app-tenant-secret",
        },
        async () => {
          const auth = await resolveAuth("tenant");
          assert.equal(auth.mode, "tenant");
          assert.equal(auth.appId, "app-tenant-id");
          assert.equal(auth.appSecret, "app-tenant-secret");
          assert.equal(auth.userToken, undefined);
          assert.equal(auth.useLark, false);
        },
      );
    });

    it("throws AUTH_REQUIRED when app credentials missing", async () => {
      await withCleanEnv(
        {
          FEISHU_USER_TOKEN: undefined,
          FEISHU_APP_ID: undefined,
          FEISHU_APP_SECRET: undefined,
        },
        async () => {
          await assert.rejects(
            () => resolveAuth("tenant"),
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

  describe("auto mode", { concurrency: 1 }, () => {
    it("prefers FEISHU_USER_TOKEN when available", async () => {
      await withCleanEnv(
        {
          FEISHU_USER_TOKEN: "u-auto-token",
          FEISHU_APP_ID: "app-auto-id",
          FEISHU_APP_SECRET: "app-auto-secret",
        },
        async () => {
          const auth = await resolveAuth("auto");
          assert.equal(auth.mode, "user");
          assert.equal(auth.userToken, "u-auto-token");
        },
      );
    });

    it("falls back to tenant when no user token and no saved tokens", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "feishu-resolve-auto-"));
      try {
        await withCleanEnv(
          {
            HOME: emptyDir,
            FEISHU_USER_TOKEN: undefined,
            FEISHU_APP_ID: "app-fallback-id",
            FEISHU_APP_SECRET: "app-fallback-secret",
          },
          async () => {
            const auth = await resolveAuth("auto");
            assert.equal(auth.mode, "tenant");
            assert.equal(auth.appId, "app-fallback-id");
          },
        );
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("throws AUTH_REQUIRED when no credentials at all", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "feishu-resolve-none-"));
      try {
        await withCleanEnv(
          {
            HOME: emptyDir,
            FEISHU_USER_TOKEN: undefined,
            FEISHU_APP_ID: undefined,
            FEISHU_APP_SECRET: undefined,
            FEISHU_REDIRECT_URI: undefined,
            FEISHU_OAUTH_PORT: undefined,
          },
          async () => {
            await assert.rejects(
              () => resolveAuth("auto"),
              (err: unknown) => {
                assert.ok(err instanceof CliError);
                assert.equal(err.errorType, "AUTH_REQUIRED");
                return true;
              },
            );
          },
        );
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("loads saved tokens from file when no env token", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "feishu-resolve-file-"));
      try {
        await withCleanEnv(
          {
            HOME: testDir,
            FEISHU_USER_TOKEN: undefined,
            FEISHU_APP_ID: "app-env-id",
            FEISHU_APP_SECRET: "app-env-secret",
          },
          async () => {
            const tokenData = {
              user_access_token: "u-file-token-auto",
              refresh_token: "rt-file-refresh-auto",
              expires_at: Date.now() + 7200_000,
            };
            await saveTokens("app-file-id", tokenData);

            const auth = await resolveAuth("auto");
            assert.equal(auth.mode, "user");
            assert.equal(auth.userToken, "u-file-token-auto");
            assert.equal(auth.refreshToken, "rt-file-refresh-auto");
          },
        );
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("returns useLark false in resolved AuthInfo", async () => {
      await withCleanEnv(
        {
          FEISHU_USER_TOKEN: "u-lark-test",
          FEISHU_APP_ID: "app-lark",
          FEISHU_APP_SECRET: "secret-lark",
        },
        async () => {
          const auth = await resolveAuth("auto");
          assert.equal(auth.useLark, false);
        },
      );
    });
  });
});
