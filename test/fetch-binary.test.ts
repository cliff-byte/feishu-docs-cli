/**
 * Tests for fetchBinaryWithAuth scope error handling.
 *
 * Covers all 6 code paths in the !res.ok branch:
 *   T1: scope error (99991672) with permission_violations → SCOPE_MISSING + scopes
 *   T2: scope error (99991679) without permission_violations → SCOPE_MISSING + msg
 *   T3: non-scope JSON error (e.g. 131006) → mapApiError → PERMISSION_DENIED
 *   T4: malformed JSON (Content-Type: application/json but body is garbage) → API_ERROR
 *   T5: non-JSON HTTP error (Content-Type: text/html) → API_ERROR
 *   T6: successful binary response → ArrayBuffer
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { CliError } from "../src/utils/errors.js";

// We need to mock fetch and the auth internals to test fetchBinaryWithAuth
// in isolation. Since fetchBinaryWithAuth calls resolveBearer (private) which
// calls getTenantToken (which calls fetch), we mock at the global fetch level.

/** Build a mock Response with the given properties. */
function mockResponse(opts: {
  ok: boolean;
  status: number;
  statusText: string;
  contentType?: string;
  body?: unknown;
  bodyText?: string;
}): Response {
  const headers = new Headers();
  if (opts.contentType) {
    headers.set("content-type", opts.contentType);
  }
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText,
    headers,
    json: async () => {
      if (opts.bodyText !== undefined) {
        // Simulate malformed JSON
        return JSON.parse(opts.bodyText);
      }
      return opts.body;
    },
    arrayBuffer: async () => {
      if (opts.body instanceof ArrayBuffer) return opts.body;
      return new ArrayBuffer(8);
    },
  } as unknown as Response;
}

describe("fetchBinaryWithAuth — scope error handling", () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount: number;

  beforeEach(() => {
    fetchCallCount = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Helper: mock global fetch so that:
   *   - 1st call (getTenantToken) returns a valid tenant token
   *   - 2nd call (the actual binary endpoint) returns the given response
   */
  function setupFetch(binaryResponse: Response) {
    globalThis.fetch = (async (..._args: unknown[]) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        // getTenantToken call
        return mockResponse({
          ok: true,
          status: 200,
          statusText: "OK",
          contentType: "application/json",
          body: { code: 0, tenant_access_token: "t-test-token" },
        });
      }
      // The actual binary endpoint call
      return binaryResponse;
    }) as typeof fetch;
  }

  /** Minimal AuthInfo for tenant mode (no user token). */
  const authInfo = {
    mode: "tenant" as const,
    appId: "cli_test",
    appSecret: "secret_test",
    useLark: false,
  };

  // We dynamically import to pick up the mocked fetch
  async function callFetchBinary() {
    const { fetchBinaryWithAuth } = await import("../src/client.js");
    return fetchBinaryWithAuth(authInfo, "/open-apis/board/v1/whiteboards/xxx/download_as_image");
  }

  it("T1: scope error 99991672 with permission_violations → SCOPE_MISSING with scopes", async () => {
    setupFetch(
      mockResponse({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        contentType: "application/json",
        body: {
          code: 99991672,
          msg: "scope required",
          error: {
            permission_violations: [
              { subject: "board:whiteboard:node:read" },
              { subject: "drive:drive" },
            ],
          },
        },
      }),
    );

    await assert.rejects(callFetchBinary(), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.errorType, "SCOPE_MISSING");
      assert.equal(err.apiCode, 99991672);
      assert.deepEqual(err.missingScopes, [
        "board:whiteboard:node:read",
        "drive:drive",
      ]);
      assert.ok(err.message.includes("board:whiteboard:node:read"));
      assert.ok(err.message.includes("drive:drive"));
      assert.ok(err.recovery?.includes("authorize --scope"));
      return true;
    });
  });

  it("T2: scope error 99991679 without permission_violations → SCOPE_MISSING with msg fallback", async () => {
    setupFetch(
      mockResponse({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        contentType: "application/json",
        body: {
          code: 99991679,
          msg: "action privilege required",
          // No error.permission_violations
        },
      }),
    );

    await assert.rejects(callFetchBinary(), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.errorType, "SCOPE_MISSING");
      assert.equal(err.apiCode, 99991679);
      assert.deepEqual(err.missingScopes, []);
      assert.ok(err.message.includes("action privilege required"));
      return true;
    });
  });

  it("T3: non-scope JSON error (131006) → mapApiError → PERMISSION_DENIED", async () => {
    setupFetch(
      mockResponse({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        contentType: "application/json",
        body: {
          code: 131006,
          msg: "permission denied",
        },
      }),
    );

    await assert.rejects(callFetchBinary(), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.errorType, "PERMISSION_DENIED");
      assert.equal(err.apiCode, 131006);
      return true;
    });
  });

  it("T4: malformed JSON (Content-Type: application/json but body is garbage) → API_ERROR", async () => {
    setupFetch(
      mockResponse({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        contentType: "application/json",
        bodyText: "not-valid-json{{{",
      }),
    );

    await assert.rejects(callFetchBinary(), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.errorType, "API_ERROR");
      assert.ok(err.message.includes("500"));
      return true;
    });
  });

  it("T5: non-JSON HTTP error (Content-Type: text/html) → API_ERROR", async () => {
    setupFetch(
      mockResponse({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        contentType: "text/html",
        body: "<html>Access Denied</html>",
      }),
    );

    await assert.rejects(callFetchBinary(), (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.errorType, "API_ERROR");
      assert.ok(err.message.includes("403"));
      assert.ok(err.message.includes("下载失败"));
      return true;
    });
  });

  it("T6: successful binary response → ArrayBuffer", async () => {
    const binaryData = new ArrayBuffer(16);
    new Uint8Array(binaryData).set([0x89, 0x50, 0x4e, 0x47]); // PNG header

    setupFetch(
      mockResponse({
        ok: true,
        status: 200,
        statusText: "OK",
        contentType: "image/png",
        body: binaryData,
      }),
    );

    const result = await callFetchBinary();
    assert.ok(result instanceof ArrayBuffer);
  });
});
