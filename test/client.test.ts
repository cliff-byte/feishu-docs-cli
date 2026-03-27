/**
 * Comprehensive tests for the HTTP client layer.
 *
 * Covers all branches of fetchWithAuth, getTenantToken, getApiBase, and
 * createClient. Uses shared test helpers from test/helpers/ for fetch
 * mocking, environment isolation, and test data factories.
 *
 * All describe blocks touching globalThis.fetch use { concurrency: 1 }
 * to prevent parallel pollution (per D-09).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { makeAuthInfo, makeUserAuthInfo } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { CliError } from "../src/utils/errors.js";
import {
  fetchWithAuth,
  fetchBinaryWithAuth,
  getTenantToken,
  getApiBase,
  createClient,
} from "../src/client.js";

/**
 * Helper to advance mock timers periodically until a promise resolves.
 * Prevents deadlock where code awaits sleep() but the mock timer hasn't ticked.
 */
function resolveWithTimers(
  promise: Promise<unknown>,
  t: { mock: { timers: { tick: (ms: number) => void } } },
  tickMs = 2000,
  intervalMs = 10,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    promise
      .then((val) => {
        done = true;
        resolve(val);
      })
      .catch((err) => {
        done = true;
        reject(err);
      });

    const realSetInterval = globalThis.setInterval;
    const handle = realSetInterval(() => {
      if (done) {
        clearInterval(handle);
        return;
      }
      try {
        t.mock.timers.tick(tickMs);
      } catch {
        // Timer already reset or no pending timers
      }
    }, intervalMs);
  });
}

// ── fetchWithAuth ──

describe("fetchWithAuth", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("should send GET request with user Bearer token", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: { items: [] } })],
    });
    restore = r;

    const result = await fetchWithAuth(
      auth,
      "/open-apis/docx/v1/documents/abc123/blocks",
    );
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.includes("/open-apis/docx/v1/documents/abc123/blocks"),
    );
    assert.equal(
      (calls[0].init?.headers as Record<string, string>)?.Authorization,
      `Bearer ${auth.userToken}`,
    );
    assert.equal(result.code, 0);
  });

  it("should resolve tenant token when no user token", async () => {
    const auth = makeAuthInfo(); // tenant mode, no userToken
    const { calls, restore: r } = setupMockFetch({
      responses: [
        tenantTokenResponse("t-resolved"), // getTenantToken call
        jsonResponse({ code: 0, data: {} }), // actual API call
      ],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/some/path");
    assert.equal(calls.length, 2);
    // First call is to tenant token endpoint
    assert.ok(calls[0].url.includes("tenant_access_token"));
    // Second call should have the resolved tenant token
    assert.equal(
      (calls[1].init?.headers as Record<string, string>)?.Authorization,
      "Bearer t-resolved",
    );
  });

  it("should append query params from options.params", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/test", {
      params: { page_size: 50, page_token: "pt-abc" },
    });
    assert.ok(calls[0].url.includes("page_size=50"));
    assert.ok(calls[0].url.includes("page_token=pt-abc"));
  });

  it("should POST with JSON body when options.body provided", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/test", {
      method: "POST",
      body: { title: "test doc" },
    });
    assert.equal(calls[0].init?.method, "POST");
    const bodyStr = calls[0].init?.body as string;
    assert.deepEqual(JSON.parse(bodyStr), { title: "test doc" });
  });

  it("should use Lark base URL when authInfo.useLark is true", async () => {
    const auth = makeUserAuthInfo({ useLark: true });
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/test");
    assert.ok(calls[0].url.startsWith("https://open.larksuite.com"));
  });

  it("should throw SCOPE_MISSING on code 99991672 with extracted scopes", async () => {
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 99991672,
          msg: "scope required",
          error: {
            permission_violations: [
              { subject: "docx:document:readonly" },
              { subject: "drive:drive" },
            ],
          },
        }),
      ],
    });
    restore = r;

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "SCOPE_MISSING");
        assert.equal(err.apiCode, 99991672);
        assert.deepEqual(err.missingScopes, [
          "docx:document:readonly",
          "drive:drive",
        ]);
        assert.ok(err.message.includes("docx:document:readonly"));
        assert.ok(err.recovery?.includes("authorize --scope"));
        return true;
      },
    );
  });

  it("should throw SCOPE_MISSING on code 99991679 with empty scopes when no violations", async () => {
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 99991679,
          msg: "action privilege required",
        }),
      ],
    });
    restore = r;

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "SCOPE_MISSING");
        assert.deepEqual(err.missingScopes, []);
        return true;
      },
    );
  });

  it("should throw NOT_FOUND on API error code 131001", async () => {
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 131001, msg: "not found" })],
    });
    restore = r;

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "NOT_FOUND");
        assert.equal(err.apiCode, 131001);
        return true;
      },
    );
  });

  it("should throw PERMISSION_DENIED on API error code 131006", async () => {
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 131006, msg: "permission denied" })],
    });
    restore = r;

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "PERMISSION_DENIED");
        assert.equal(err.apiCode, 131006);
        return true;
      },
    );
  });

  it("should throw API_ERROR with retryable on AbortController timeout", async () => {
    const auth = makeUserAuthInfo();
    // Directly replace fetch to simulate AbortError (cannot use setupMockFetch
    // since it returns Response objects, not throws)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = originalFetch;
    };

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test", { retry: false }),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "API_ERROR");
        assert.equal(err.retryable, true);
        assert.ok(err.message.includes("超时"));
        return true;
      },
    );
  });

  it("should use feishu base URL by default", async () => {
    const auth = makeUserAuthInfo({ useLark: false });
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/test");
    assert.ok(calls[0].url.startsWith("https://open.feishu.cn"));
  });

  it("should use cached tenantToken from authInfo without fetching new one", async () => {
    const auth = makeAuthInfo({ tenantToken: "t-cached-token" });
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/test");
    // Only one fetch call (no tenant token fetch)
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0].init?.headers as Record<string, string>)?.Authorization,
      "Bearer t-cached-token",
    );
  });
});

// ── getTenantToken ──

describe("getTenantToken", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("should POST app credentials and return tenant_access_token", async () => {
    const auth = makeAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, tenant_access_token: "t-fetched-token" }),
      ],
    });
    restore = r;

    const token = await getTenantToken(auth);
    assert.equal(token, "t-fetched-token");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("tenant_access_token/internal"));
    assert.equal(calls[0].init?.method, "POST");
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.app_id, "cli_test_id");
    assert.equal(body.app_secret, "cli_test_secret");
  });

  it("should throw AUTH_REQUIRED on non-zero error code", async () => {
    const auth = makeAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 10003, msg: "invalid app_id" })],
    });
    restore = r;

    await assert.rejects(
      () => getTenantToken(auth),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "AUTH_REQUIRED");
        assert.ok(err.message.includes("invalid app_id"));
        return true;
      },
    );
  });

  it("should throw AUTH_REQUIRED when API returns empty token", async () => {
    const auth = makeAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, tenant_access_token: "" })],
    });
    restore = r;

    await assert.rejects(
      () => getTenantToken(auth),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "AUTH_REQUIRED");
        assert.ok(err.message.includes("空值"));
        return true;
      },
    );
  });
});

// ── getApiBase ──

describe("getApiBase", () => {
  it("should return feishu base URL when useLark is false", () => {
    const auth = makeAuthInfo({ useLark: false });
    assert.equal(getApiBase(auth), "https://open.feishu.cn");
  });

  it("should return lark base URL when useLark is true", () => {
    const auth = makeAuthInfo({ useLark: true });
    assert.equal(getApiBase(auth), "https://open.larksuite.com");
  });
});

// ── createClient ──

describe("createClient", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("should resolve tenant auth with env credentials and return client object", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_env_id",
        FEISHU_APP_SECRET: "cli_env_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const result = await createClient({ auth: "tenant", lark: false });
        assert.ok(result.authInfo);
        assert.equal(result.authInfo.appId, "cli_env_id");
        assert.equal(result.authInfo.appSecret, "cli_env_secret");
        assert.equal(result.authInfo.mode, "tenant");
      },
    );
  });

  it("should resolve user mode from FEISHU_USER_TOKEN env var", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_env_id",
        FEISHU_APP_SECRET: "cli_env_secret",
        FEISHU_USER_TOKEN: "u-env-user-token",
      },
      async () => {
        const result = await createClient({ auth: "user", lark: false });
        assert.ok(result.authInfo);
        assert.equal(result.authInfo.mode, "user");
        assert.equal(result.authInfo.userToken, "u-env-user-token");
      },
    );
  });

  it("should throw AUTH_REQUIRED when no app credentials available", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: undefined,
        FEISHU_APP_SECRET: undefined,
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => createClient({ auth: "tenant", lark: false }),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      },
    );
  });

  it("should allow user token without app credentials", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: undefined,
        FEISHU_APP_SECRET: undefined,
        FEISHU_USER_TOKEN: "u-standalone-token",
      },
      async () => {
        const result = await createClient({ auth: "user", lark: false });
        assert.ok(result.authInfo);
        assert.equal(result.authInfo.mode, "user");
        assert.equal(result.authInfo.userToken, "u-standalone-token");
      },
    );
  });

  it("should set useLark on authInfo when lark option is true", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_env_id",
        FEISHU_APP_SECRET: "cli_env_secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const result = await createClient({ auth: "tenant", lark: true });
        assert.equal(result.authInfo.useLark, true);
      },
    );
  });
});

// ── fetchWithAuth retry ──

describe("fetchWithAuth retry", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("retries on 429 and succeeds on second attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, msg: "" }, 429),
        jsonResponse({ code: 0, data: { ok: true } }),
      ],
    });
    restore = r;

    const result = await resolveWithTimers(
      fetchWithAuth(auth, "/open-apis/test"),
      t,
    );
    assert.equal((result as { code: number }).code, 0);
    assert.equal(calls.length, 2);
  });

  it("retries on 502 and succeeds on second attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({}, 502), jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    const result = await resolveWithTimers(
      fetchWithAuth(auth, "/open-apis/test"),
      t,
    );
    assert.equal((result as { code: number }).code, 0);
    assert.equal(calls.length, 2);
  });

  it("retries on 503 and succeeds on second attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({}, 503), jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    const result = await resolveWithTimers(
      fetchWithAuth(auth, "/open-apis/test"),
      t,
    );
    assert.equal((result as { code: number }).code, 0);
    assert.equal(calls.length, 2);
  });

  it("retries on AbortError and succeeds on second attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      return new Response(JSON.stringify({ code: 0, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = originalFetch;
    };

    const result = await resolveWithTimers(
      fetchWithAuth(auth, "/open-apis/test"),
      t,
    );
    assert.equal((result as { code: number }).code, 0);
    assert.equal(callCount, 2);
  });

  it("throws after maxRetries exhausted (3 failures with maxRetries=2)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0 }, 429),
        jsonResponse({ code: 0 }, 429),
        jsonResponse({ code: 0 }, 429),
      ],
    });
    restore = r;

    await assert.rejects(
      () =>
        resolveWithTimers(
          fetchWithAuth(auth, "/open-apis/test", {
            retry: { maxRetries: 2 },
          }),
          t,
        ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        return true;
      },
    );
    assert.equal(calls.length, 3);
  });

  it("retry: false disables retry on 429", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 0, msg: "rate limited" }, 429)],
    });
    restore = r;

    // With retry: false, 429 should fall through to normal error handling
    // Since the JSON body has code 0, the response is treated as success
    // but the HTTP status 429 is not retried
    const result = await fetchWithAuth(auth, "/open-apis/test", {
      retry: false,
    });
    assert.equal(calls.length, 1);
    assert.equal(result.code, 0);
  });

  it("uses Retry-After header value for 429 delay", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [
        new Response(JSON.stringify({ code: 0, msg: "" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": "2",
          },
        }),
        jsonResponse({ code: 0, data: {} }),
      ],
    });
    restore = r;

    const result = await resolveWithTimers(
      fetchWithAuth(auth, "/open-apis/test"),
      t,
    );
    assert.equal((result as { code: number }).code, 0);
    assert.equal(calls.length, 2);
  });

  it("does not retry on 404 (non-retryable API error)", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [jsonResponse({ code: 131001, msg: "not found" })],
    });
    restore = r;

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "NOT_FOUND");
        return true;
      },
    );
    // Only one fetch call, no retry
    assert.equal(calls.length, 1);
  });

  it("logs retry info to stderr on each retry attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [jsonResponse({}, 502), jsonResponse({ code: 0, data: {} })],
    });
    restore = r;

    const stderrMessages: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrMessages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await resolveWithTimers(fetchWithAuth(auth, "/open-apis/test"), t);
    } finally {
      process.stderr.write = originalWrite;
    }

    const retryMsg = stderrMessages.find((m) => m.includes("API 请求失败"));
    assert.ok(retryMsg, "should log retry info to stderr");
    assert.ok(retryMsg!.includes("502"), "should include status code");
  });
});

// ── fetchBinaryWithAuth retry ──

describe("fetchBinaryWithAuth retry", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("retries on 502 and succeeds on second attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [
        new Response("", { status: 502, statusText: "Bad Gateway" }),
        new Response(new ArrayBuffer(8), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ],
    });
    restore = r;

    const result = await resolveWithTimers(
      fetchBinaryWithAuth(auth, "/open-apis/drive/v1/medias/file123/download"),
      t,
    );
    assert.ok(result instanceof ArrayBuffer);
    assert.equal(calls.length, 2);
  });

  it("retries on AbortError and succeeds on second attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const auth = makeUserAuthInfo();
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      return new Response(new ArrayBuffer(8), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = originalFetch;
    };

    const result = await resolveWithTimers(
      fetchBinaryWithAuth(auth, "/open-apis/drive/v1/medias/file123/download"),
      t,
    );
    assert.ok(result instanceof ArrayBuffer);
    assert.equal(callCount, 2);
  });
});
