/**
 * Smoke tests for shared test helper modules.
 *
 * Validates that mock-fetch, env-guard, and factory helpers are importable
 * and functional before downstream test plans depend on them.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { withCleanEnv, withNoAuthEnv } from "./helpers/env-guard.js";
import {
  makeAuthInfo,
  makeUserAuthInfo,
  makeGlobalOpts,
  makeApiResponse,
} from "./helpers/factory.js";

describe("test helpers", { concurrency: 1 }, () => {
  // ── mock-fetch ──────────────────────────────────────────────────────────

  describe("setupMockFetch", () => {
    let restoreFn: (() => void) | undefined;

    afterEach(() => {
      if (restoreFn) {
        restoreFn();
        restoreFn = undefined;
      }
    });

    it("returns calls array and restore function, tracks fetch calls", async () => {
      const originalFetch = globalThis.fetch;
      const resp = jsonResponse({ code: 0, msg: "ok" });
      const { calls, restore } = setupMockFetch({ responses: [resp] });
      restoreFn = restore;

      assert.equal(calls.length, 0);

      const result = await globalThis.fetch("https://open.feishu.cn/api/test");
      const body = await result.json();

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://open.feishu.cn/api/test");
      assert.deepEqual(body, { code: 0, msg: "ok" });

      restore();
      restoreFn = undefined;
      assert.equal(globalThis.fetch, originalFetch);
    });

    it("throws on unexpected call in strict mode (default)", async () => {
      const { calls, restore } = setupMockFetch({ responses: [] });
      restoreFn = restore;

      await assert.rejects(
        () => globalThis.fetch("https://open.feishu.cn/unexpected"),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("Unexpected fetch call"));
          assert.ok(err.message.includes("unexpected"));
          return true;
        },
      );

      assert.equal(calls.length, 1);
    });

    it("returns fallback response in non-strict mode", async () => {
      const { calls, restore } = setupMockFetch({
        responses: [],
        strictCount: false,
      });
      restoreFn = restore;

      const result = await globalThis.fetch("https://open.feishu.cn/fallback");
      const body = await result.json();

      assert.equal(calls.length, 1);
      assert.deepEqual(body, { code: 0 });
    });
  });

  describe("tenantTokenResponse", () => {
    it("returns a 200 Response with tenant_access_token in body", async () => {
      const resp = tenantTokenResponse();
      assert.equal(resp.status, 200);

      const body = await resp.json();
      assert.equal(body.code, 0);
      assert.equal(body.tenant_access_token, "t-mock-token");
    });

    it("accepts custom token", async () => {
      const resp = tenantTokenResponse("t-custom-123");
      const body = await resp.json();
      assert.equal(body.tenant_access_token, "t-custom-123");
    });
  });

  // ── env-guard ───────────────────────────────────────────────────────────

  describe("withCleanEnv", () => {
    it("sets env vars during callback and restores after", async () => {
      const originalValue = process.env.FEISHU_APP_ID;

      await withCleanEnv({ FEISHU_APP_ID: "test-id-12345" }, () => {
        assert.equal(process.env.FEISHU_APP_ID, "test-id-12345");
      });

      assert.equal(process.env.FEISHU_APP_ID, originalValue);
    });

    it("restores env vars even when callback throws", async () => {
      const originalValue = process.env.FEISHU_APP_ID;

      await assert.rejects(
        () =>
          withCleanEnv({ FEISHU_APP_ID: "temp-value" }, () => {
            throw new Error("callback error");
          }),
        { message: "callback error" },
      );

      assert.equal(process.env.FEISHU_APP_ID, originalValue);
    });

    it("deletes env vars when value is undefined", async () => {
      process.env.FEISHU_APP_ID = "existing-value";

      await withCleanEnv({ FEISHU_APP_ID: undefined }, () => {
        assert.equal(process.env.FEISHU_APP_ID, undefined);
      });

      assert.equal(process.env.FEISHU_APP_ID, "existing-value");
      delete process.env.FEISHU_APP_ID;
    });
  });

  describe("withNoAuthEnv", () => {
    it("clears all FEISHU auth env vars during callback", async () => {
      process.env.FEISHU_APP_ID = "id-for-test";
      process.env.FEISHU_APP_SECRET = "secret-for-test";

      await withNoAuthEnv(() => {
        assert.equal(process.env.FEISHU_APP_ID, undefined);
        assert.equal(process.env.FEISHU_APP_SECRET, undefined);
        assert.equal(process.env.FEISHU_USER_TOKEN, undefined);
        assert.equal(process.env.FEISHU_REDIRECT_URI, undefined);
        assert.equal(process.env.FEISHU_OAUTH_PORT, undefined);
      });

      assert.equal(process.env.FEISHU_APP_ID, "id-for-test");
      assert.equal(process.env.FEISHU_APP_SECRET, "secret-for-test");

      delete process.env.FEISHU_APP_ID;
      delete process.env.FEISHU_APP_SECRET;
    });
  });

  // ── factory ─────────────────────────────────────────────────────────────

  describe("makeAuthInfo", () => {
    it("returns default tenant-mode AuthInfo", () => {
      const auth = makeAuthInfo();
      assert.equal(auth.mode, "tenant");
      assert.equal(auth.appId, "cli_test_id");
      assert.equal(auth.appSecret, "cli_test_secret");
      assert.equal(auth.useLark, false);
    });

    it("accepts overrides without mutating defaults", () => {
      const auth = makeAuthInfo({ useLark: true, appId: "custom-id" });
      assert.equal(auth.useLark, true);
      assert.equal(auth.appId, "custom-id");
      assert.equal(auth.mode, "tenant");

      // Verify next call gets fresh defaults
      const auth2 = makeAuthInfo();
      assert.equal(auth2.appId, "cli_test_id");
      assert.equal(auth2.useLark, false);
    });
  });

  describe("makeUserAuthInfo", () => {
    it("returns user-mode AuthInfo with token fields", () => {
      const auth = makeUserAuthInfo();
      assert.equal(auth.mode, "user");
      assert.equal(auth.userToken, "u-mock-user-token");
      assert.ok(typeof auth.expiresAt === "number");
      assert.ok(auth.expiresAt! > Date.now());
      assert.equal(auth.refreshToken, "rt-mock-refresh-token");
      assert.equal(auth.appId, "cli_test_id");
    });
  });

  describe("makeGlobalOpts", () => {
    it("returns default GlobalOpts", () => {
      const opts = makeGlobalOpts();
      assert.equal(opts.auth, "auto");
      assert.equal(opts.json, false);
      assert.equal(opts.lark, false);
    });

    it("accepts overrides", () => {
      const opts = makeGlobalOpts({ json: true, lark: true });
      assert.equal(opts.json, true);
      assert.equal(opts.lark, true);
      assert.equal(opts.auth, "auto");
    });
  });

  describe("makeApiResponse", () => {
    it("returns default successful response", () => {
      const resp = makeApiResponse();
      assert.equal(resp.code, 0);
      assert.equal(resp.msg, "success");
      assert.deepEqual(resp.data, {});
    });

    it("accepts overrides", () => {
      const resp = makeApiResponse({ code: 99991400, msg: "token expired" });
      assert.equal(resp.code, 99991400);
      assert.equal(resp.msg, "token expired");
    });
  });
});
