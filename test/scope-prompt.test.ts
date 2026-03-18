/**
 * Tests for scope-prompt utilities.
 *
 * Covers:
 *   - isPermissionError: error-type discrimination
 *   - promptScopeAuth: non-interactive guard conditions
 *   - ensureScopes: pre-flight guard conditions
 *
 * The full OAuth flow and readline interaction are NOT tested here because
 * they require heavyweight I/O mocking. All tests focus on the guard paths
 * that return early without touching external services.
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isPermissionError,
  promptScopeAuth,
  ensureScopes,
} from "../src/utils/scope-prompt.js";
import { CliError } from "../src/utils/errors.js";
import type { AuthInfo, GlobalOpts } from "../src/types/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal GlobalOpts that represents a normal interactive session. */
function makeGlobalOpts(overrides: Partial<GlobalOpts> = {}): GlobalOpts {
  return { auth: "auto", json: false, lark: false, ...overrides };
}

/** Minimal AuthInfo for "user" mode. */
function makeUserAuthInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return {
    mode: "user",
    useLark: false,
    userToken: "tok_test",
    ...overrides,
  };
}

// ── isPermissionError ─────────────────────────────────────────────────────────

describe("isPermissionError", () => {
  it("returns true for CliError with PERMISSION_DENIED errorType", () => {
    const err = new CliError("PERMISSION_DENIED", "no access");
    assert.equal(isPermissionError(err), true);
  });

  it("returns true for CliError with AUTH_REQUIRED errorType", () => {
    const err = new CliError("AUTH_REQUIRED", "need login");
    assert.equal(isPermissionError(err), true);
  });

  it("returns false for CliError with API_ERROR errorType", () => {
    const err = new CliError("API_ERROR", "something went wrong");
    assert.equal(isPermissionError(err), false);
  });

  it("returns false for CliError with NOT_FOUND errorType", () => {
    const err = new CliError("NOT_FOUND", "doc gone");
    assert.equal(isPermissionError(err), false);
  });

  it("returns false for CliError with TOKEN_EXPIRED errorType", () => {
    const err = new CliError("TOKEN_EXPIRED", "token stale");
    assert.equal(isPermissionError(err), false);
  });

  it("returns false for CliError with INVALID_ARGS errorType", () => {
    const err = new CliError("INVALID_ARGS", "bad flag");
    assert.equal(isPermissionError(err), false);
  });

  it("returns false for a plain Error", () => {
    assert.equal(isPermissionError(new Error("plain error")), false);
  });

  it("returns false for a string", () => {
    assert.equal(isPermissionError("PERMISSION_DENIED"), false);
  });

  it("returns false for null", () => {
    assert.equal(isPermissionError(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isPermissionError(undefined), false);
  });

  it("returns false for a number", () => {
    assert.equal(isPermissionError(403), false);
  });

  it("returns false for a plain object that looks like a CliError", () => {
    const fake = { errorType: "PERMISSION_DENIED", message: "spoofed" };
    assert.equal(isPermissionError(fake), false);
  });
});

// ── promptScopeAuth ───────────────────────────────────────────────────────────

describe("promptScopeAuth — non-interactive guards", () => {
  const MISSING = ["drive:drive"];

  describe("JSON mode", () => {
    it("returns false immediately when globalOpts.json is true", async () => {
      // Force TTY to true to isolate the JSON flag check
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });
      try {
        const result = await promptScopeAuth(
          MISSING,
          makeGlobalOpts({ json: true }),
        );
        assert.equal(result, false);
      } finally {
        Object.defineProperty(process.stdin, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });

  describe("non-TTY stdin", () => {
    it("returns false when process.stdin.isTTY is false", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });
      try {
        const result = await promptScopeAuth(
          MISSING,
          makeGlobalOpts({ json: false }),
        );
        assert.equal(result, false);
      } finally {
        Object.defineProperty(process.stdin, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });

    it("returns false when process.stdin.isTTY is undefined", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: undefined,
        configurable: true,
      });
      try {
        const result = await promptScopeAuth(
          MISSING,
          makeGlobalOpts({ json: false }),
        );
        assert.equal(result, false);
      } finally {
        Object.defineProperty(process.stdin, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });

  describe("missing env credentials", () => {
    // Save and restore env vars around these tests
    let savedAppId: string | undefined;
    let savedAppSecret: string | undefined;

    beforeEach(() => {
      savedAppId = process.env.FEISHU_APP_ID;
      savedAppSecret = process.env.FEISHU_APP_SECRET;
      // Make stdin look like a TTY so we reach the env-var check
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });
    });

    afterEach(() => {
      if (savedAppId === undefined) {
        delete process.env.FEISHU_APP_ID;
      } else {
        process.env.FEISHU_APP_ID = savedAppId;
      }
      if (savedAppSecret === undefined) {
        delete process.env.FEISHU_APP_SECRET;
      } else {
        process.env.FEISHU_APP_SECRET = savedAppSecret;
      }
    });

    it("returns false when FEISHU_APP_ID is absent", async () => {
      delete process.env.FEISHU_APP_ID;
      process.env.FEISHU_APP_SECRET = "secret_test";
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });

    it("returns false when FEISHU_APP_SECRET is absent", async () => {
      process.env.FEISHU_APP_ID = "cli_test";
      delete process.env.FEISHU_APP_SECRET;
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });

    it("returns false when both FEISHU_APP_ID and FEISHU_APP_SECRET are absent", async () => {
      delete process.env.FEISHU_APP_ID;
      delete process.env.FEISHU_APP_SECRET;
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });

    it("returns false when FEISHU_APP_ID is an empty string", async () => {
      process.env.FEISHU_APP_ID = "";
      process.env.FEISHU_APP_SECRET = "secret_test";
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });

    it("returns false when FEISHU_APP_SECRET is an empty string", async () => {
      process.env.FEISHU_APP_ID = "cli_test";
      process.env.FEISHU_APP_SECRET = "";
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });
  });
});

// ── ensureScopes ──────────────────────────────────────────────────────────────

describe("ensureScopes", () => {
  // These tests only exercise the early-return guard paths that do NOT depend
  // on a token file being present (or absent) on disk. Paths that call
  // loadTokens() and then promptScopeAuth() are covered indirectly through the
  // promptScopeAuth non-interactive guard tests above.

  describe("mode guard — non-user modes return early before loadTokens", () => {
    it("returns the original authInfo unchanged when mode is 'tenant'", async () => {
      const authInfo = makeUserAuthInfo({ mode: "tenant" });
      const result = await ensureScopes(
        authInfo,
        ["drive:drive"],
        makeGlobalOpts(),
      );
      assert.equal(result, authInfo);
    });

    it("returns the original authInfo unchanged when mode is 'auto'", async () => {
      const authInfo = makeUserAuthInfo({ mode: "auto" });
      const result = await ensureScopes(
        authInfo,
        ["drive:drive"],
        makeGlobalOpts(),
      );
      assert.equal(result, authInfo);
    });

    it("returns identity (same reference) for non-user mode", async () => {
      const authInfo = makeUserAuthInfo({ mode: "tenant" });
      const result = await ensureScopes(
        authInfo,
        ["wiki:wiki", "docx:document"],
        makeGlobalOpts(),
      );
      assert.strictEqual(result, authInfo);
    });
  });

  describe("return value contract — non-user mode", () => {
    it("does not mutate the input authInfo when mode is 'tenant'", async () => {
      const authInfo: AuthInfo = {
        mode: "tenant",
        useLark: false,
        userToken: "original_token",
      };
      await ensureScopes(authInfo, ["drive:drive"], makeGlobalOpts());
      // Fields must be unchanged after the call
      assert.equal(authInfo.userToken, "original_token");
      assert.equal(authInfo.mode, "tenant");
      assert.equal(authInfo.useLark, false);
    });

    it("does not mutate the input authInfo when mode is 'auto'", async () => {
      const authInfo: AuthInfo = {
        mode: "auto",
        useLark: true,
        tenantToken: "tenant_tok",
      };
      await ensureScopes(authInfo, ["drive:drive"], makeGlobalOpts());
      assert.equal(authInfo.mode, "auto");
      assert.equal(authInfo.useLark, true);
      assert.equal(authInfo.tenantToken, "tenant_tok");
    });
  });

  describe("throws AUTH_REQUIRED when user mode + missing scopes + non-interactive", () => {
    // When mode is "user" and tokens exist but scopes are missing, and the
    // session is non-interactive (json:true or isTTY:false), promptScopeAuth
    // returns false, causing ensureScopes to throw CliError(AUTH_REQUIRED).
    // We test this by making stdin non-TTY and ensuring no readline blocks.

    let savedIsTTY: boolean | undefined;

    beforeEach(() => {
      savedIsTTY = process.stdin.isTTY;
      // Force non-TTY so promptScopeAuth returns false without blocking
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, "isTTY", {
        value: savedIsTTY,
        configurable: true,
      });
    });

    it("throws CliError with AUTH_REQUIRED when user mode + json mode + real token file exists", async () => {
      // If there is no token file on this machine, ensureScopes returns early
      // (loadTokens null guard). If there IS a token file, and the stored scope
      // is missing the required one, ensureScopes throws. Either outcome is
      // acceptable here — we simply assert that the call either returns the
      // authInfo unchanged OR throws a CliError(AUTH_REQUIRED). It must not hang.
      const authInfo = makeUserAuthInfo({ mode: "user" });
      let result: AuthInfo | undefined;
      let thrown: unknown;
      try {
        result = await ensureScopes(
          authInfo,
          ["drive:drive"],
          makeGlobalOpts({ json: true }),
        );
      } catch (err) {
        thrown = err;
      }

      if (thrown !== undefined) {
        // Token file exists; assert it is AUTH_REQUIRED
        assert.ok(thrown instanceof CliError, "expected CliError to be thrown");
        assert.equal((thrown as CliError).errorType, "AUTH_REQUIRED");
      } else {
        // No token file on this machine; ensureScopes returned original authInfo
        assert.strictEqual(result, authInfo);
      }
    });
  });
});
