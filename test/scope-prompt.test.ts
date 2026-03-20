/**
 * Tests for scope-prompt utilities.
 *
 * Covers:
 *   - promptScopeAuth: non-interactive guard conditions
 *   - withScopeRecovery: catches SCOPE_MISSING errors, prompt guards, retry logic
 *
 * The full OAuth flow and readline interaction are NOT tested here because
 * they require heavyweight I/O mocking. All tests focus on the guard paths
 * that return early without touching external services.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  promptScopeAuth,
  withScopeRecovery,
} from "../src/utils/scope-prompt.js";
import { CliError } from "../src/utils/errors.js";
import type { GlobalOpts } from "../src/types/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal GlobalOpts that represents a normal interactive session. */
function makeGlobalOpts(overrides: Partial<GlobalOpts> = {}): GlobalOpts {
  return { auth: "auto", json: false, lark: false, ...overrides };
}

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
    let savedAppId: string | undefined;
    let savedAppSecret: string | undefined;

    beforeEach(() => {
      savedAppId = process.env.FEISHU_APP_ID;
      savedAppSecret = process.env.FEISHU_APP_SECRET;
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

    it("returns false when both are absent", async () => {
      delete process.env.FEISHU_APP_ID;
      delete process.env.FEISHU_APP_SECRET;
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });

    it("returns false when FEISHU_APP_ID is empty string", async () => {
      process.env.FEISHU_APP_ID = "";
      process.env.FEISHU_APP_SECRET = "secret_test";
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });

    it("returns false when FEISHU_APP_SECRET is empty string", async () => {
      process.env.FEISHU_APP_ID = "cli_test";
      process.env.FEISHU_APP_SECRET = "";
      const result = await promptScopeAuth(MISSING, makeGlobalOpts());
      assert.equal(result, false);
    });
  });
});

// ── withScopeRecovery ────────────────────────────────────────────────────────

describe("withScopeRecovery", () => {
  it("returns the result when fn succeeds", async () => {
    const result = await withScopeRecovery(
      async () => "success",
      makeGlobalOpts(),
    );
    assert.equal(result, "success");
  });

  it("re-throws non-scope errors unchanged", async () => {
    const originalError = new CliError("NOT_FOUND", "doc not found");
    await assert.rejects(
      () =>
        withScopeRecovery(async () => {
          throw originalError;
        }, makeGlobalOpts()),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "NOT_FOUND");
        assert.equal(err.message, "doc not found");
        return true;
      },
    );
  });

  it("re-throws plain errors unchanged", async () => {
    await assert.rejects(
      () =>
        withScopeRecovery(async () => {
          throw new Error("plain error");
        }, makeGlobalOpts()),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "plain error");
        return true;
      },
    );
  });

  it("re-throws SCOPE_MISSING with empty scopes (no permission_violations)", async () => {
    const scopeError = new CliError("SCOPE_MISSING", "权限不足", {
      apiCode: 99991679,
      missingScopes: [],
    });
    await assert.rejects(
      () =>
        withScopeRecovery(async () => {
          throw scopeError;
        }, makeGlobalOpts()),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "SCOPE_MISSING");
        return true;
      },
    );
  });

  it("throws AUTH_REQUIRED when SCOPE_MISSING in non-interactive mode (json)", async () => {
    // In JSON mode, promptScopeAuth returns false → withScopeRecovery throws AUTH_REQUIRED
    const scopeError = new CliError("SCOPE_MISSING", "缺少权限", {
      apiCode: 99991672,
      missingScopes: ["drive:drive"],
    });
    await assert.rejects(
      () =>
        withScopeRecovery(async () => {
          throw scopeError;
        }, makeGlobalOpts({ json: true })),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "AUTH_REQUIRED");
        assert.ok(err.message.includes("drive:drive"));
        return true;
      },
    );
  });

  it("throws AUTH_REQUIRED when SCOPE_MISSING in non-TTY mode", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      const scopeError = new CliError("SCOPE_MISSING", "缺少权限", {
        apiCode: 99991679,
        missingScopes: ["im:message:send", "im:message"],
      });
      await assert.rejects(
        () =>
          withScopeRecovery(async () => {
            throw scopeError;
          }, makeGlobalOpts()),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "AUTH_REQUIRED");
          assert.ok(err.message.includes("im:message:send"));
          return true;
        },
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("does not call fn more than twice (retry guard)", async () => {
    let callCount = 0;
    const scopeError = new CliError("SCOPE_MISSING", "缺少权限", {
      apiCode: 99991672,
      missingScopes: ["drive:drive"],
    });

    // In non-interactive mode, promptScopeAuth returns false,
    // so withScopeRecovery throws instead of retrying.
    await assert.rejects(
      () =>
        withScopeRecovery(async () => {
          callCount++;
          throw scopeError;
        }, makeGlobalOpts({ json: true })),
    );

    // fn should only be called once (no retry in non-interactive mode)
    assert.equal(callCount, 1);
  });
});
