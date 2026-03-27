/**
 * Unit tests for error handling utilities.
 *
 * Tests cover: formatError (CliError + unknown, plain + JSON), handleError
 * (exit codes), mapApiError (various Feishu API error codes).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CliError,
  formatError,
  handleError,
  mapApiError,
} from "../src/utils/errors.js";

describe("errors utility", { concurrency: 1 }, () => {
  describe("formatError", () => {
    it("CliError plain text includes error message", () => {
      const err = new CliError("API_ERROR", "test msg", { apiCode: 12345 });
      const output = formatError(err, false);
      assert.ok(output.includes("feishu-docs: error: test msg"));
      assert.ok(output.includes("(code: 12345)"));
    });

    it("CliError JSON includes all fields", () => {
      const err = new CliError("SCOPE_MISSING", "scope error", {
        apiCode: 99,
        missingScopes: ["drive:drive"],
      });
      const output = formatError(err, true);
      const parsed = JSON.parse(output);
      assert.equal(parsed.success, false);
      assert.equal(parsed.error.type, "SCOPE_MISSING");
      assert.equal(parsed.error.message, "scope error");
      assert.equal(parsed.error.api_code, 99);
      assert.deepEqual(parsed.error.missing_scopes, ["drive:drive"]);
    });

    it("unknown error plain text", () => {
      const output = formatError({ message: "boom" }, false);
      assert.ok(output.includes("feishu-docs: error: boom"));
    });

    it("unknown error JSON", () => {
      const output = formatError({ message: "boom" }, true);
      const parsed = JSON.parse(output);
      assert.equal(parsed.success, false);
      assert.equal(parsed.error.type, "UNKNOWN");
      assert.equal(parsed.error.message, "boom");
    });

    it("CliError without apiCode omits code suffix", () => {
      const err = new CliError("INVALID_ARGS", "no code");
      const output = formatError(err, false);
      assert.ok(!output.includes("(code:"));
    });

    it("CliError with retryable and recovery fields in JSON", () => {
      const err = new CliError("TOKEN_EXPIRED", "expired", {
        apiCode: 99991400,
        retryable: true,
        recovery: "run login",
      });
      const output = formatError(err, true);
      const parsed = JSON.parse(output);
      assert.equal(parsed.error.retryable, true);
      assert.equal(parsed.error.recovery, "run login");
    });
  });

  describe("handleError", () => {
    it("exits with correct code for AUTH_REQUIRED", () => {
      const origExit = process.exit;
      const origWrite = process.stderr.write;
      let exitCode: number | undefined;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error("EXIT");
      }) as never;
      process.stderr.write = (() => true) as typeof process.stderr.write;

      try {
        handleError(new CliError("AUTH_REQUIRED", "reauth"), false);
      } catch {
        /* expected EXIT sentinel */
      }

      process.exit = origExit;
      process.stderr.write = origWrite;
      assert.equal(exitCode, 2);
    });

    it("exits with 1 for non-CliError", () => {
      const origExit = process.exit;
      const origWrite = process.stderr.write;
      let exitCode: number | undefined;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error("EXIT");
      }) as never;
      process.stderr.write = (() => true) as typeof process.stderr.write;

      try {
        handleError(new Error("generic"), false);
      } catch {
        /* expected EXIT sentinel */
      }

      process.exit = origExit;
      process.stderr.write = origWrite;
      assert.equal(exitCode, 1);
    });

    it("exits with 3 for API_ERROR", () => {
      const origExit = process.exit;
      const origWrite = process.stderr.write;
      let exitCode: number | undefined;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error("EXIT");
      }) as never;
      process.stderr.write = (() => true) as typeof process.stderr.write;

      try {
        handleError(new CliError("API_ERROR", "api fail"), false);
      } catch {
        /* expected EXIT sentinel */
      }

      process.exit = origExit;
      process.stderr.write = origWrite;
      assert.equal(exitCode, 3);
    });
  });

  describe("mapApiError", () => {
    it("131006 returns PERMISSION_DENIED", () => {
      const err = mapApiError({ code: 131006 });
      assert.equal(err.errorType, "PERMISSION_DENIED");
      assert.equal(err.apiCode, 131006);
    });

    it("131008 returns PERMISSION_DENIED", () => {
      const err = mapApiError({ code: 131008 });
      assert.equal(err.errorType, "PERMISSION_DENIED");
      assert.equal(err.apiCode, 131008);
    });

    it("131001 returns NOT_FOUND", () => {
      const err = mapApiError({ code: 131001 });
      assert.equal(err.errorType, "NOT_FOUND");
    });

    it("131002 returns NOT_FOUND", () => {
      const err = mapApiError({ code: 131002 });
      assert.equal(err.errorType, "NOT_FOUND");
    });

    it("99991400 returns TOKEN_EXPIRED", () => {
      const err = mapApiError({ code: 99991400 });
      assert.equal(err.errorType, "TOKEN_EXPIRED");
      assert.equal(err.apiCode, 99991400);
    });

    it("99991663 returns TOKEN_EXPIRED", () => {
      const err = mapApiError({ code: 99991663 });
      assert.equal(err.errorType, "TOKEN_EXPIRED");
    });

    it("unknown code returns API_ERROR", () => {
      const err = mapApiError({ code: 999 });
      assert.equal(err.errorType, "API_ERROR");
      assert.equal(err.apiCode, 999);
    });

    it("nested response.data.code", () => {
      const err = mapApiError({
        response: { data: { code: 131001, msg: "not found" } },
      });
      assert.equal(err.errorType, "NOT_FOUND");
    });

    it("preserves msg from error object", () => {
      const err = mapApiError({ code: 999, msg: "custom msg" });
      assert.ok(err.message.includes("custom msg"));
    });

    it("falls back to message field when msg is absent", () => {
      const err = mapApiError({ code: 888, message: "fallback msg" });
      assert.ok(err.message.includes("fallback msg"));
    });

    it("uses default message for unknown error with no msg", () => {
      const err = mapApiError({ code: 777 });
      assert.ok(err.message.includes("未知 API 错误"));
    });
  });
});
