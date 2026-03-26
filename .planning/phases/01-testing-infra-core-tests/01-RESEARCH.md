# Phase 1: 测试基础设施与核心路径测试 - Research

**Researched:** 2026-03-26
**Domain:** node:test + c8 coverage pipeline, mocking patterns for zero-dependency ESM CLI
**Confidence:** HIGH

## Summary

This phase builds the testing infrastructure (coverage pipeline, helpers) and writes unit tests for the four core modules: `src/client.ts` (fetchWithAuth, createClient), `src/auth.ts` (resolveAuth, encrypt/decrypt, saveTokens/loadTokens), `src/services/block-writer.ts` (clearDocument, backupDocument, rotateBackups), and `src/utils/document-resolver.ts` (resolveDocument with wiki fallback).

The primary challenge is mocking without `mock.module()` in an ESM codebase. The existing pattern of replacing `globalThis.fetch` works for API-calling code, but `auth.ts` and `block-writer.ts` also depend heavily on `node:fs/promises` and `node:os`. For these, the research recommends a combination of: (1) temporary directories for file-system-touching tests, (2) `t.mock.method()` for targeted method replacement on `fs` and `os` modules, and (3) round-trip testing for crypto operations. All tests touching global state (`process.env`, `globalThis.fetch`) must use `{ concurrency: 1 }` on their describe blocks.

**Primary recommendation:** Build three shared helpers (mock-fetch, env-guard, factory) first, then write tests module-by-module starting with auth (highest isolation complexity), then client, then block-writer, then document-resolver.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 使用 c8 ^11.0.0 作为覆盖率工具（devDependency），优先尝试 `c8 tsx --test` 管道。若 tsx 源码映射导致数据不可靠，回退到 `tsc && c8 node --test dist/` 方案。
- **D-02:** 覆盖率阈值通过 `.c8rc.json` 配置（行 80% / 分支 70% / 函数 80%），在 package.json 中添加 `test:coverage` 脚本。阈值在 Phase 1 结束时不强制（允许低于 80%），待 Phase 2 完成后激活。
- **D-03:** 覆盖率报告输出 HTML 和 lcov 格式到 `coverage/` 目录，将 `coverage/` 添加到 `.gitignore`。
- **D-04:** API 调用测试统一使用 `globalThis.fetch` 替换模式（参考现有 `test/fetch-binary.test.ts`）。对于复杂模块（如 createClient），结合依赖注入模式使核心逻辑可测试。
- **D-05:** 严格禁止使用 `mock.module()`（实验性 API，Node 18 不可用，有已知 ESM 缓存重置 bug）。
- **D-06:** 使用 `t.mock.method()` 和 `t.mock.fn()`（Stability 2）替代手动保存/恢复，确保测试间自动清理。
- **D-07:** 创建 `test/helpers/` 目录，包含三个共享模块：mock-fetch.ts、env-guard.ts、factory.ts
- **D-08:** 现有测试文件中的内联工厂函数保持不动，不做迁移。
- **D-09:** 所有涉及环境变量或文件系统的测试 describe 块使用 `{ concurrency: 1 }` 防止并行污染。
- **D-10:** 认证测试使用临时目录替代 `~/.feishu-docs/`，通过依赖注入控制配置目录路径。
- **D-11:** token 加密/解密测试采用 round-trip 方式验证。

### Claude's Discretion
- 具体测试用例的组织和命名风格
- mock-fetch 辅助函数的 API 设计细节
- 各测试文件内的 describe 块粒度

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | 安装 c8 覆盖率工具，配置 .c8rc.json 阈值 | c8 v11.0.0 verified; .c8rc.json config documented below with exact options |
| TEST-02 | 验证 c8 + tsx 覆盖率管道可靠性 | Known tsx source-map issues documented; verification steps and fallback provided |
| TEST-03 | 创建测试辅助工具库 (test/helpers/) | Three modules designed with full API signatures and code examples |
| TEST-04 | 建立 node:test 并发控制约定 | `{ concurrency: 1 }` pattern documented with rationale |
| TEST-05 | 在 package.json 中添加 test:coverage 脚本 | Script definitions provided |
| CORE-01 | fetchWithAuth 完整测试 | 8 test cases identified covering all branches in client.ts |
| CORE-02 | createClient 测试 | 7 test cases covering auto/user/tenant mode + refresh + fallback |
| CORE-03 | resolveAuth 多模式认证解析测试 | 9 test cases covering full priority chain with env isolation |
| CORE-04 | 令牌加密/解密 round-trip 测试 | Round-trip pattern + error cases documented |
| CORE-05 | clearDocument 批量删除测试 | Mock strategy for multi-call sequences documented |
| CORE-06 | backupDocument / rotateBackups 测试 | Temp directory approach with real fs operations |
| CORE-07 | document-resolver 回退行为测试 | Mock strategy for resolveWikiToken dependency |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- All code changes must follow AGENTS.md guidelines
- Immutable patterns required (create new objects, never mutate)
- Files should be 200-400 lines typical, 800 max
- Functions < 50 lines
- Error handling at every level
- No hardcoded values
- Commit messages: `<type>: <description>` format (feat, fix, test, chore)

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | built-in (Node 24.5.0) | Test runner | Already in use; Stability 2; zero-dependency |
| `node:assert/strict` | built-in | Assertions | Already in use; strict deep equality |
| `tsx` | ^4.21.0 | TS execution | Already installed; runs .ts tests directly |
| `c8` | ^11.0.0 | V8 coverage | Best-in-class; verified current on npm |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `typescript` | ^5.9.3 | Type checking (pretest) | Already installed |
| `@types/node` | ^25.5.0 | Type definitions | Already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| c8 | --experimental-test-coverage | Built-in is Stability 1; poor source-map support; no HTML reports |
| globalThis.fetch mock | mock.module() | Experimental; requires flag; ESM cache bugs |
| t.mock.method | sinon | External dep; node:test built-in is sufficient |

**Installation:**
```bash
npm install -D c8
```

**Version verification:** c8 v11.0.0 verified on npm registry (2026-03-26).

## Architecture Patterns

### Test Directory Structure
```
test/
  helpers/
    mock-fetch.ts       # Fetch mock builder with call sequencing
    env-guard.ts        # process.env save/restore + temp dir helper
    factory.ts          # AuthInfo, GlobalOpts, ApiResponse factories
  auth.test.ts          # EXISTING: resolveOAuthCallbackConfig, buildAuthorizationUrl
  auth-resolve.test.ts  # NEW: resolveAuth multi-mode chain
  auth-crypto.test.ts   # NEW: encrypt/decrypt round-trip, saveTokens/loadTokens
  client.test.ts        # NEW: fetchWithAuth, createClient, getTenantToken
  block-writer.test.ts  # EXISTING: sanitizeBlocks; EXPAND: clearDocument, backup/restore
  document-resolver.test.ts  # EXISTING: parseDocUrl branching; EXPAND: resolveDocument with mocked wiki
  # ... existing test files unchanged
```

### Pattern 1: globalThis.fetch Mock with Call Sequencing

**What:** Replace `globalThis.fetch` with a function that returns different responses based on call order.
**When to use:** Testing any code path that calls `fetch` (client.ts, auth.ts refresh).
**Why:** The project calls `fetch` transitively through multiple layers. A single global mock captures all calls without needing module mocking.

```typescript
// test/helpers/mock-fetch.ts
import type { TestContext } from "node:test";

interface MockCall {
  url: string;
  init?: RequestInit;
}

interface MockFetchOptions {
  /** Ordered responses. Each fetch call consumes the next response. */
  responses: Array<Response | (() => Response)>;
  /** If true, throw after all responses consumed. Default: true. */
  strictCount?: boolean;
}

interface MockFetchResult {
  calls: readonly MockCall[];
  restore: () => void;
}

export function setupMockFetch(opts: MockFetchOptions): MockFetchResult {
  const originalFetch = globalThis.fetch;
  const calls: MockCall[] = [];
  let callIndex = 0;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (callIndex >= opts.responses.length) {
      if (opts.strictCount !== false) {
        throw new Error(
          `Unexpected fetch call #${callIndex + 1}: ${url}. Only ${opts.responses.length} responses configured.`,
        );
      }
      return new Response(JSON.stringify({ code: 0 }), {
        headers: { "content-type": "application/json" },
      });
    }
    const resp = opts.responses[callIndex++];
    return typeof resp === "function" ? resp() : resp;
  }) as typeof fetch;

  return {
    calls,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

/** Build a JSON Response for API mocking. */
export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/** Convenience: tenant token response that most fetchWithAuth tests need first. */
export function tenantTokenResponse(token = "t-mock-token"): Response {
  return jsonResponse({ code: 0, tenant_access_token: token });
}
```

### Pattern 2: Environment Variable Isolation

**What:** Save all relevant env vars before a test, optionally set new values, restore after.
**When to use:** Any test touching `process.env.FEISHU_*` variables.

```typescript
// test/helpers/env-guard.ts

const AUTH_ENV_KEYS = [
  "FEISHU_USER_TOKEN",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_REDIRECT_URI",
  "FEISHU_OAUTH_PORT",
] as const;

type EnvKey = (typeof AUTH_ENV_KEYS)[number];

/**
 * Run a function with specific env vars set, restoring originals after.
 * Pass `undefined` to delete a var for the duration.
 */
export async function withCleanEnv(
  vars: Partial<Record<EnvKey | string, string | undefined>>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    const val = vars[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}

/**
 * Clear all FEISHU_* env vars for the duration of a function.
 */
export async function withNoAuthEnv(
  fn: () => Promise<void> | void,
): Promise<void> {
  const vars: Record<string, undefined> = {};
  for (const key of AUTH_ENV_KEYS) {
    vars[key] = undefined;
  }
  return withCleanEnv(vars, fn);
}
```

### Pattern 3: Test Data Factory

**What:** Create valid default instances of AuthInfo, GlobalOpts, and API responses.
**When to use:** Everywhere -- avoids repeating boilerplate across test files.

```typescript
// test/helpers/factory.ts
import type { AuthInfo, GlobalOpts, ApiResponse } from "../../src/types/index.js";

export function makeAuthInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return {
    mode: "tenant",
    appId: "cli_test_id",
    appSecret: "cli_test_secret",
    useLark: false,
    ...overrides,
  };
}

export function makeUserAuthInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return makeAuthInfo({
    mode: "user",
    userToken: "u-mock-user-token",
    expiresAt: Date.now() + 3600_000,
    refreshToken: "rt-mock-refresh-token",
    ...overrides,
  });
}

export function makeGlobalOpts(overrides: Partial<GlobalOpts> = {}): GlobalOpts {
  return { auth: "auto", json: false, lark: false, ...overrides };
}

export function makeApiResponse(
  overrides: Partial<ApiResponse> = {},
): ApiResponse {
  return { code: 0, msg: "success", data: {}, ...overrides };
}
```

### Pattern 4: Temporary Directory for File-system Tests (D-10)

**What:** Use `node:os` `tmpdir()` + unique suffix for tests that read/write auth files or backups.
**When to use:** auth crypto tests (saveTokens/loadTokens), block-writer backup tests.
**Critical:** Must override the CONFIG_DIR / BACKUPS_DIR paths to point at temp dir.

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// In describe block:
let testDir: string;

before(async () => {
  testDir = await mkdtemp(join(tmpdir(), "feishu-test-"));
});

after(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

**Challenge with auth.ts:** The module-level constants `CONFIG_DIR`, `AUTH_FILE`, `LOCK_FILE` are not exported and not injectable. The `saveTokens()` and `loadTokens()` functions hardcode paths based on `homedir()`.

**Solution:** Use `t.mock.method()` on the `os` module to override `homedir()` return value, which shifts `CONFIG_DIR` to point inside the temp directory:

```typescript
import * as os from "node:os";

it("should save and load tokens via round-trip", async (t) => {
  const testDir = await mkdtemp(join(tmpdir(), "feishu-auth-test-"));
  t.mock.method(os, "homedir", () => testDir);
  // Now CONFIG_DIR = join(testDir, ".feishu-docs")
  // saveTokens/loadTokens will use the temp directory
  // ... test logic ...
  await rm(testDir, { recursive: true, force: true });
});
```

**IMPORTANT:** This works because `auth.ts` computes `CONFIG_DIR` at module load time using `homedir()`. Since ESM modules are cached, we need to be aware that `CONFIG_DIR` is already resolved. Let me examine this more carefully.

Looking at `auth.ts` line 24: `const CONFIG_DIR = join(homedir(), ".feishu-docs");` -- this is a module-level constant computed once at import time. Mocking `os.homedir` after import has **no effect** on `CONFIG_DIR`.

**Revised solution options:**

1. **Refactor auth.ts to compute paths lazily** (preferred for D-10): Extract a `getConfigDir()` function that calls `homedir()` at call time, not module load time. This is a minimal, non-breaking change:

```typescript
// In auth.ts -- refactor from:
const CONFIG_DIR = join(homedir(), ".feishu-docs");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");

// To:
function getConfigDir(): string {
  return join(homedir(), ".feishu-docs");
}
function getAuthFile(): string {
  return join(getConfigDir(), "auth.json");
}
```

Then in tests, `t.mock.method(os, "homedir", () => testDir)` works correctly.

2. **Mock at the fs level** (alternative): Instead of redirecting the directory, mock `readFile`, `writeFile`, `existsSync` etc. via `t.mock.method(fs, "readFile", ...)`. This avoids modifying production code but makes tests more complex and fragile.

**Recommendation:** Option 1 (lazy path computation). The refactor is minimal (changes 3 lines in auth.ts), is a pure improvement (lazy > eager for path resolution), and makes all auth tests trivially isolatable.

### Anti-Patterns to Avoid
- **Dynamic import for mock isolation:** `await import("../src/client.js")` creates ESM cache issues when multiple test files import the same module. Use `globalThis.fetch` replacement instead.
- **Asserting encrypted byte values:** Encryption output is machine-specific (hostname + username in key derivation). Always test round-trips.
- **mock.module():** Experimental, requires `--experimental-test-module-mocks`, has ESM cache reset bugs. Forbidden per D-05.
- **Parallel tests with global state:** Any describe block that touches `process.env` or `globalThis.fetch` without `{ concurrency: 1 }` will cause intermittent failures.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fetch mocking | Per-test inline fetch replacement | `test/helpers/mock-fetch.ts` with call sequencing | Consistent cleanup, call tracking, strict mode |
| Env var isolation | Manual save/restore per variable | `test/helpers/env-guard.ts` withCleanEnv | Easy to forget one var; withCleanEnv is atomic |
| Test data creation | Inline object literals | `test/helpers/factory.ts` | DRY, type-safe, defaults handled |
| Coverage reporting | Manual line counting | c8 with .c8rc.json | V8-native, accurate, generates HTML |

**Key insight:** The main testing complexity in this codebase is NOT the test logic itself -- it is the mocking infrastructure. Invest heavily in the three helpers; individual tests become trivial once helpers exist.

## Common Pitfalls

### Pitfall 1: c8 + tsx Source Map Unreliability
**What goes wrong:** tsx >= 4.3.0 with c8 can report inflated coverage (100% for all files) due to source-map bugs.
**Why it happens:** tsx uses esbuild for transpilation; V8 coverage tracks executed JS but source maps back to TS can be incorrect.
**How to avoid:** Run `c8 tsx --test test/*.test.ts` early and manually spot-check a known-untested file. If it shows high coverage, switch to fallback: `tsc && c8 node --test dist/**/*.test.js`.
**Warning signs:** Any untested module showing >90% coverage.

### Pitfall 2: auth.ts Module-Level Constants
**What goes wrong:** `CONFIG_DIR`, `AUTH_FILE`, `LOCK_FILE` are computed at module load time from `homedir()`. Mocking `os.homedir` after import has no effect.
**Why it happens:** ESM module evaluation is one-shot; top-level const bindings are frozen after first import.
**How to avoid:** Refactor to lazy `getConfigDir()` function before writing auth file-system tests. This is a prerequisite task.
**Warning signs:** Tests writing to `~/.feishu-docs/auth.json` on the developer's real machine.

### Pitfall 3: ESM Module Cache Collision
**What goes wrong:** Multiple test files importing `client.ts` share a single module instance. The `globalThis.fetch` mock in one file affects another if they run concurrently.
**Why it happens:** ESM modules are singletons. The existing `fetch-binary.test.ts` uses dynamic import (`await import("../src/client.js")`), but this returns the cached module after first evaluation.
**How to avoid:** Always mock at the `globalThis.fetch` level (a true global). Use `afterEach` to restore. Do NOT rely on dynamic import for isolation. Use `{ concurrency: 1 }` for describe blocks with fetch mocks to prevent inter-test races.
**Warning signs:** Tests pass individually but fail when run together (`tsx --test test/*.test.ts`).

### Pitfall 4: node:test Subtests Run Concurrently by Default
**What goes wrong:** `it` tests within a `describe` block can run concurrently. Tests mutating `process.env` or `globalThis.fetch` race against each other.
**Why it happens:** Unlike Jest, node:test defaults to concurrent subtests.
**How to avoid:** Add `{ concurrency: 1 }` to every `describe` block that mutates global state.
**Warning signs:** Tests pass 9/10 times; failures show unexpected env var values.

### Pitfall 5: Timer Leaks from AbortController
**What goes wrong:** `fetchWithAuth` creates `setTimeout(30s)` for timeouts. If mock fetch resolves instantly, the timer is cleared. But if a test assertion fails mid-test, the timer leaks.
**Why it happens:** Test failure aborts the test function before the production code's `finally` block runs `clearTimeout`.
**How to avoid:** Ensure mock fetch resolves synchronously (no real delay). For timeout tests specifically, use `t.mock.timers.enable()` to control `setTimeout`.
**Warning signs:** Test runner warnings about async activity outliving the test.

### Pitfall 6: block-writer.ts Module-Level Constants
**What goes wrong:** `BACKUPS_DIR` is computed at module level: `join(homedir(), ".feishu-docs", "backups")`. Same issue as auth.ts.
**Why it happens:** Module-level constant computed eagerly from `homedir()`.
**How to avoid:** `BACKUPS_DIR` is exported, but still computed at load time. For backup tests, mock `os.homedir` before the module is first imported, OR refactor to lazy computation. Since block-writer is imported by many test files, the lazy refactor is safer.
**Warning signs:** Backup test files appearing in `~/.feishu-docs/backups/`.

## Code Examples

### Testing fetchWithAuth -- All Branches

```typescript
// test/client.test.ts
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse, tenantTokenResponse } from "./helpers/mock-fetch.js";
import { makeAuthInfo, makeUserAuthInfo } from "./helpers/factory.js";
import { CliError } from "../src/utils/errors.js";
import { fetchWithAuth, getTenantToken, getApiBase } from "../src/client.js";

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

    const result = await fetchWithAuth(auth, "/open-apis/docx/v1/documents/abc123/blocks");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/open-apis/docx/v1/documents/abc123/blocks"));
    assert.equal(calls[0].init?.headers?.Authorization, `Bearer ${auth.userToken}`);
    assert.equal(result.code, 0);
  });

  it("should resolve tenant token when no user token", async () => {
    const auth = makeAuthInfo(); // tenant mode, no userToken
    const { calls, restore: r } = setupMockFetch({
      responses: [
        tenantTokenResponse("t-resolved"),  // getTenantToken call
        jsonResponse({ code: 0, data: {} }), // actual API call
      ],
    });
    restore = r;

    await fetchWithAuth(auth, "/open-apis/some/path");
    assert.equal(calls.length, 2);
    // Second call should have the resolved tenant token
    assert.ok(calls[1].init?.headers?.Authorization?.includes("t-resolved"));
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

  it("should throw SCOPE_MISSING on code 99991672 with scopes", async () => {
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [jsonResponse({
        code: 99991672,
        msg: "scope required",
        error: {
          permission_violations: [
            { subject: "docx:document:readonly" },
          ],
        },
      })],
    });
    restore = r;

    await assert.rejects(
      () => fetchWithAuth(auth, "/open-apis/test"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "SCOPE_MISSING");
        assert.deepEqual(err.missingScopes, ["docx:document:readonly"]);
        return true;
      },
    );
  });

  it("should throw mapped error for non-scope API error", async () => {
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
        return true;
      },
    );
  });

  it("should throw API_ERROR on AbortController timeout", async () => {
    const auth = makeUserAuthInfo();
    const { restore: r } = setupMockFetch({
      responses: [
        // Simulate a fetch that throws AbortError
        (() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as unknown as Response,
      ],
    });
    restore = r;

    // Note: the mock-fetch helper will need to handle throwing responses
    // Alternative: directly replace globalThis.fetch for this specific case
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
});
```

### Testing resolveAuth -- Multi-Mode Priority Chain

```typescript
// test/auth-resolve.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withCleanEnv, withNoAuthEnv } from "./helpers/env-guard.js";
import { resolveAuth } from "../src/auth.js";
import { CliError } from "../src/utils/errors.js";

describe("resolveAuth", { concurrency: 1 }, () => {
  describe("user mode", { concurrency: 1 }, () => {
    it("should return user mode from FEISHU_USER_TOKEN env var", async () => {
      await withCleanEnv({
        FEISHU_USER_TOKEN: "u-env-token",
        FEISHU_APP_ID: "app123",
        FEISHU_APP_SECRET: "secret456",
      }, async () => {
        const auth = await resolveAuth("user");
        assert.equal(auth.mode, "user");
        assert.equal(auth.userToken, "u-env-token");
        assert.equal(auth.appId, "app123");
      });
    });

    it("should throw AUTH_REQUIRED when no user token available", async () => {
      await withNoAuthEnv(async () => {
        await assert.rejects(
          () => resolveAuth("user"),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      });
    });

    // Also test: loadTokens fallback path (needs fs mocking)
  });

  describe("tenant mode", { concurrency: 1 }, () => {
    it("should return tenant mode from env vars", async () => {
      await withCleanEnv({
        FEISHU_USER_TOKEN: undefined,
        FEISHU_APP_ID: "app123",
        FEISHU_APP_SECRET: "secret456",
      }, async () => {
        const auth = await resolveAuth("tenant");
        assert.equal(auth.mode, "tenant");
        assert.equal(auth.appId, "app123");
        assert.equal(auth.appSecret, "secret456");
        assert.equal(auth.userToken, undefined);
      });
    });

    it("should throw AUTH_REQUIRED when app credentials missing", async () => {
      await withNoAuthEnv(async () => {
        await assert.rejects(
          () => resolveAuth("tenant"),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      });
    });
  });

  describe("auto mode", { concurrency: 1 }, () => {
    it("should prefer FEISHU_USER_TOKEN when available", async () => {
      await withCleanEnv({
        FEISHU_USER_TOKEN: "u-env-token",
        FEISHU_APP_ID: "app123",
        FEISHU_APP_SECRET: "secret456",
      }, async () => {
        const auth = await resolveAuth("auto");
        assert.equal(auth.mode, "user");
        assert.equal(auth.userToken, "u-env-token");
      });
    });

    it("should fall back to tenant when no user token", async () => {
      await withCleanEnv({
        FEISHU_USER_TOKEN: undefined,
        FEISHU_APP_ID: "app123",
        FEISHU_APP_SECRET: "secret456",
      }, async () => {
        // Also need to ensure no saved tokens exist
        // This requires the homedir mock to point at an empty temp dir
        const auth = await resolveAuth("auto");
        assert.equal(auth.mode, "tenant");
      });
    });

    it("should throw AUTH_REQUIRED when no credentials at all", async () => {
      await withNoAuthEnv(async () => {
        await assert.rejects(
          () => resolveAuth("auto"),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      });
    });
  });
});
```

### Testing encrypt/decrypt Round-Trip

```typescript
// test/auth-crypto.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as os from "node:os";

describe("token encryption/decryption", { concurrency: 1 }, () => {
  let testDir: string;

  before(async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-crypto-test-"));
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should round-trip save and load tokens", async (t) => {
    // Mock homedir to redirect config dir to temp
    t.mock.method(os, "homedir", () => testDir);

    // Dynamically import to get fresh module with mocked homedir
    // NOTE: This works only if auth.ts uses homedir() lazily (after refactor)
    const { saveTokens, loadTokens } = await import("../src/auth.js");

    const tokenData = {
      user_access_token: "u-test-access-token-123",
      refresh_token: "rt-test-refresh-456",
      expires_at: Date.now() + 7200_000,
      token_type: "Bearer",
    };

    await saveTokens("app-test-id", tokenData);
    const loaded = await loadTokens();

    assert.ok(loaded !== null);
    assert.equal(loaded.appId, "app-test-id");
    assert.equal(loaded.tokens.user_access_token, "u-test-access-token-123");
    assert.equal(loaded.tokens.refresh_token, "rt-test-refresh-456");
    assert.equal(loaded.tokens.expires_at, tokenData.expires_at);
  });

  it("should return null for non-existent auth file", async (t) => {
    const emptyDir = await mkdtemp(join(tmpdir(), "feishu-empty-"));
    t.mock.method(os, "homedir", () => emptyDir);

    const { loadTokens } = await import("../src/auth.js");
    const result = await loadTokens();
    assert.equal(result, null);

    await rm(emptyDir, { recursive: true, force: true });
  });

  it("should return null for corrupted auth file", async (t) => {
    // Write garbage to auth file location
    t.mock.method(os, "homedir", () => testDir);
    const { mkdir, writeFile } = await import("node:fs/promises");
    const configDir = join(testDir, ".feishu-docs");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "auth.json"), "not-json-content");

    const { loadTokens } = await import("../src/auth.js");
    const result = await loadTokens();
    assert.equal(result, null);
  });
});
```

### Testing clearDocument -- Batch Delete with Conflict Retry

```typescript
// test/block-writer-clear.test.ts  (or expand existing block-writer.test.ts)
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse, tenantTokenResponse } from "./helpers/mock-fetch.js";
import { makeAuthInfo } from "./helpers/factory.js";
import { CliError } from "../src/utils/errors.js";

describe("clearDocument", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("should batch-delete children from end to start", async () => {
    const auth = makeAuthInfo();
    // clearDocument calls:
    // 1. getTenantToken (for auth)
    // 2. getRootChildrenCount (fetch block to count children)
    // 3. batch_delete (first batch)
    // 4. sleep(QPS_DELAY)
    // 5. batch_delete (second batch if needed)

    // For a document with 75 children (BATCH_SIZE=50):
    // Batch 1: delete indices 25-75
    // Batch 2: delete indices 0-25
    const { calls, restore: r } = setupMockFetch({
      responses: [
        tenantTokenResponse(),
        // getRootChildrenCount response
        jsonResponse({
          code: 0,
          data: {
            block: {
              children: Array(75).fill("child-id"),
            },
          },
        }),
        // First batch_delete
        jsonResponse({ code: 0, data: { document_revision_id: 2 } }),
        // Second batch_delete
        jsonResponse({ code: 0, data: { document_revision_id: 3 } }),
      ],
    });
    restore = r;

    // Need to also mock the sleep to avoid 400ms delays in tests
    // clearDocument imports sleep from same module -- use t.mock.method
    const blockWriter = await import("../src/services/block-writer.js");
    // ... test continues
  });

  it("should retry on conflict error (1770064)", async () => {
    // First delete attempt returns conflict
    // clearDocument should re-fetch doc info and children count, then retry
    // ... mock sequence
  });

  it("should throw after MAX_CONFLICT_RETRIES exceeded", async () => {
    // Return conflict error 6 times (> MAX_CONFLICT_RETRIES = 5)
    // ... mock sequence
  });

  it("should return immediately when document has no children", async () => {
    const auth = makeAuthInfo();
    const { calls, restore: r } = setupMockFetch({
      responses: [
        tenantTokenResponse(),
        jsonResponse({
          code: 0,
          data: { block: { children: [] } },
        }),
      ],
    });
    restore = r;

    // clearDocument should return revisionId without any delete calls
  });
});
```

### Testing resolveDocument -- Wiki Fallback

```typescript
// test/document-resolver.test.ts (expand existing)
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse, tenantTokenResponse } from "./helpers/mock-fetch.js";
import { makeAuthInfo } from "./helpers/factory.js";
import { resolveDocument } from "../src/utils/document-resolver.js";
import { CliError } from "../src/utils/errors.js";

describe("resolveDocument", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("should pass through docx URL without wiki resolution", async () => {
    const auth = makeAuthInfo({ mode: "user", userToken: "u-tok" });
    // No fetch calls needed -- docx type skips wiki resolution
    const result = await resolveDocument(
      auth,
      "https://test.feishu.cn/docx/abc12345678901234567",
    );
    assert.equal(result.objToken, "abc12345678901234567");
    assert.equal(result.objType, "docx");
    assert.equal(result.nodeToken, undefined);
  });

  it("should resolve wiki URL via API", async () => {
    const auth = makeAuthInfo({ mode: "user", userToken: "u-tok" });
    const { restore: r } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            node: {
              obj_token: "real-docx-token",
              obj_type: "docx",
              title: "Wiki Page",
              node_token: "wiki-node-token",
              space_id: "space-123",
              has_child: false,
            },
          },
        }),
      ],
    });
    restore = r;

    const result = await resolveDocument(
      auth,
      "https://test.feishu.cn/wiki/abc12345678901234567",
    );
    assert.equal(result.objToken, "real-docx-token");
    assert.equal(result.objType, "docx");
    assert.equal(result.title, "Wiki Page");
    assert.equal(result.nodeToken, "wiki-node-token");
    assert.equal(result.spaceId, "space-123");
  });

  it("should fallback to docx for unknown token when wiki fails (allowFallback=true)", async () => {
    const auth = makeAuthInfo({ mode: "user", userToken: "u-tok" });
    const { restore: r } = setupMockFetch({
      responses: [
        jsonResponse({ code: 131001, msg: "not found" }),
      ],
    });
    restore = r;

    const result = await resolveDocument(auth, "abc12345678901234567");
    assert.equal(result.objType, "docx");
    assert.equal(result.objToken, "abc12345678901234567");
  });

  it("should throw for unknown token when wiki fails and allowFallback=false", async () => {
    const auth = makeAuthInfo({ mode: "user", userToken: "u-tok" });
    const { restore: r } = setupMockFetch({
      responses: [
        jsonResponse({ code: 131001, msg: "not found" }),
      ],
    });
    restore = r;

    await assert.rejects(
      () => resolveDocument(auth, "abc12345678901234567", { allowFallback: false }),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        return true;
      },
    );
  });

  it("should throw for wiki type when resolution fails (even with allowFallback=true)", async () => {
    const auth = makeAuthInfo({ mode: "user", userToken: "u-tok" });
    const { restore: r } = setupMockFetch({
      responses: [
        jsonResponse({ code: 131001, msg: "not found" }),
      ],
    });
    restore = r;

    // wiki type never falls back -- only "unknown" type does
    await assert.rejects(
      () => resolveDocument(auth, "https://test.feishu.cn/wiki/abc12345678901234567"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        return true;
      },
    );
  });
});
```

### Testing createClient -- Token Refresh Logic

```typescript
// test/client-create.test.ts (or within client.test.ts)
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withCleanEnv } from "./helpers/env-guard.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import { createClient } from "../src/client.js";
import { CliError } from "../src/utils/errors.js";

describe("createClient", { concurrency: 1 }, () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("should resolve auth in auto mode", async () => {
    await withCleanEnv({
      FEISHU_USER_TOKEN: "u-env-token",
      FEISHU_APP_ID: "app123",
      FEISHU_APP_SECRET: "secret456",
    }, async () => {
      const { authInfo } = await createClient({ auth: "auto" });
      assert.equal(authInfo.mode, "user");
      assert.equal(authInfo.userToken, "u-env-token");
    });
  });

  it("should throw AUTH_REQUIRED when no credentials", async () => {
    await withCleanEnv({
      FEISHU_USER_TOKEN: undefined,
      FEISHU_APP_ID: undefined,
      FEISHU_APP_SECRET: undefined,
    }, async () => {
      await assert.rejects(
        () => createClient({ auth: "auto" }),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "AUTH_REQUIRED");
          return true;
        },
      );
    });
  });

  it("should fall back to tenant when user token expired and no refresh token", async () => {
    await withCleanEnv({
      FEISHU_USER_TOKEN: undefined,
      FEISHU_APP_ID: "app123",
      FEISHU_APP_SECRET: "secret456",
    }, async () => {
      // This test needs saved tokens with expired user_access_token
      // and no refresh_token -- requires fs mock or temp dir setup
      // See auth-crypto.test.ts pattern for homedir mock
    });
  });

  it("should attempt refresh when user token expired and refresh token available", async () => {
    // Mock resolveAuth to return expired user with refresh token
    // Mock globalThis.fetch to handle refreshUserToken API call
    // Mock acquireRefreshLock to return a release function
    // Verify returned authInfo has new token values
  });

  it("should set useLark based on options.lark", async () => {
    await withCleanEnv({
      FEISHU_USER_TOKEN: "u-token",
      FEISHU_APP_ID: "app123",
      FEISHU_APP_SECRET: "secret456",
    }, async () => {
      const { authInfo } = await createClient({ auth: "auto", lark: true });
      assert.equal(authInfo.useLark, true);
    });
  });
});
```

## c8 Configuration

### .c8rc.json (exact file content)

```json
{
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.d.ts", "test/**"],
  "reporter": ["text", "lcov", "html"],
  "report-dir": "coverage",
  "all": true,
  "src": ["src"],
  "clean": true,
  "lines": 80,
  "branches": 70,
  "functions": 80,
  "check-coverage": false
}
```

Note: `"check-coverage": false` for Phase 1 per D-02. Will be set to `true` after Phase 2.

### package.json script additions

```json
{
  "scripts": {
    "test:coverage": "c8 tsx --test test/*.test.ts",
    "test:coverage:check": "c8 check-coverage",
    "test:coverage:html": "c8 report --reporter=html"
  }
}
```

### .gitignore addition

```
coverage/
```

### Verification Steps for TEST-02

1. Run `npm run test:coverage`
2. Open `coverage/index.html`
3. Find a module with NO test coverage (e.g., `src/commands/create.ts`)
4. Verify it shows 0% or near-0% coverage
5. If it shows >50% coverage for untested modules, source maps are broken
6. If broken, switch to fallback:
   ```json
   "test:coverage": "tsc && c8 node --enable-source-maps --test dist/**/*.test.js"
   ```

## Critical Prerequisite: auth.ts and block-writer.ts Path Refactoring

Before writing file-system-touching tests for auth and block-writer, the module-level constants must be refactored to lazy computation. This is a small, safe refactor (3 lines per file) that unblocks all D-10 testing.

### auth.ts Changes Required

```typescript
// FROM (lines 24-26):
const CONFIG_DIR = join(homedir(), ".feishu-docs");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const LOCK_FILE = join(CONFIG_DIR, ".refresh.lock");

// TO:
function getConfigDir(): string {
  return join(homedir(), ".feishu-docs");
}
function getAuthFile(): string {
  return join(getConfigDir(), "auth.json");
}
function getLockFile(): string {
  return join(getConfigDir(), ".refresh.lock");
}
```

Then update all references: `CONFIG_DIR` -> `getConfigDir()`, `AUTH_FILE` -> `getAuthFile()`, `LOCK_FILE` -> `getLockFile()`.

### block-writer.ts Changes Required

```typescript
// FROM (line 19):
export const BACKUPS_DIR: string = join(homedir(), ".feishu-docs", "backups");

// TO:
export function getBackupsDir(): string {
  return join(homedir(), ".feishu-docs", "backups");
}
```

Update all references in the file. **Note:** `BACKUPS_DIR` is exported and used in `block-writer.ts` itself. Callers in commands import it too. Check all imports.

### Why This Must Come First

Without this refactor, any test that imports `auth.ts` or `block-writer.ts` locks the config paths to the real `~/.feishu-docs/` directory. No amount of mocking after import can change module-level constants. This is a hard prerequisite for D-10.

## Concurrency Control Strategy

### Global State Categories and Their Guards

| State | Mutated By | Guard |
|-------|-----------|-------|
| `globalThis.fetch` | All API tests | `afterEach` restore + `{ concurrency: 1 }` on describe |
| `process.env.FEISHU_*` | Auth tests | `withCleanEnv()` + `{ concurrency: 1 }` on describe |
| `process.stdin.isTTY` | Prompt tests | `try/finally` + `{ concurrency: 1 }` on describe |
| File system (temp dirs) | Crypto/backup tests | Unique temp dirs per test + `{ concurrency: 1 }` |
| `os.homedir()` mock | Auth file tests | `t.mock.method()` auto-restore + `{ concurrency: 1 }` |

### Test File Organization by Global State

```
# No global state (can run concurrently):
test/url-parser.test.ts
test/blocks-to-md.test.ts
test/text-elements.test.ts
test/extract-title.test.ts
test/markdown-convert.test.ts
test/scopes.test.ts
test/share.test.ts
test/info.test.ts

# Mutates globalThis.fetch (must use { concurrency: 1 }):
test/fetch-binary.test.ts
test/client.test.ts           # NEW
test/document-resolver.test.ts # EXPANDED
test/block-writer.test.ts      # EXPANDED

# Mutates process.env (must use { concurrency: 1 }):
test/auth-resolve.test.ts     # NEW
test/scope-prompt.test.ts

# Mutates file system (must use { concurrency: 1 }):
test/auth-crypto.test.ts      # NEW
test/image-download.test.ts
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mock.module()` | globalThis.fetch + DI | Node 20+ | mock.module still experimental; project uses manual approach |
| `--experimental-test-coverage` | c8 wrapper | Ongoing | Built-in coverage still Stability 1; c8 is stable |
| nyc (Istanbul) | c8 | 2020+ | c8 uses V8 native profiling; no instrumentation overhead |

## Open Questions

1. **auth.ts lazy path refactor scope**
   - What we know: Module-level constants prevent test isolation for file-system operations
   - What's unclear: Whether any external consumer depends on the exported `CONFIG_DIR` constant (unlikely -- it is not exported)
   - Recommendation: Refactor to lazy `getConfigDir()` / `getAuthFile()` / `getLockFile()` as first task in phase

2. **block-writer.ts BACKUPS_DIR export**
   - What we know: `BACKUPS_DIR` is exported and may be imported by command modules
   - What's unclear: How many callers import `BACKUPS_DIR` directly
   - Recommendation: Grep for `BACKUPS_DIR` imports, replace with `getBackupsDir()` call; since it was a constant, callers likely just use it as a path string

3. **clearDocument sleep mocking**
   - What we know: `clearDocument` calls `sleep(QPS_DELAY)` between batches, adding 400ms per batch to test time
   - What's unclear: Whether `t.mock.timers.enable()` works with the `sleep()` implementation (which uses `setTimeout` in a Promise)
   - Recommendation: Mock the exported `sleep` function directly: `t.mock.method(blockWriter, "sleep", async () => {})` since `sleep` is an exported function

## Sources

### Primary (HIGH confidence)
- [Node.js Test Runner API v25.8.2](https://nodejs.org/api/test.html) -- mock.method, mock.fn stability status
- [Node.js Mocking Guide](https://nodejs.org/en/learn/test-runner/mocking) -- Official mocking patterns
- [c8 GitHub](https://github.com/bcoe/c8) -- v11.0.0, configuration options
- [c8 npm](https://www.npmjs.com/package/c8) -- Current version verified 11.0.0

### Secondary (MEDIUM confidence)
- [tsx Issue #433](https://github.com/privatenumber/tsx/issues/433) -- c8 + tsx source-map bug
- [Node.js Issue #59163](https://github.com/nodejs/node/issues/59163) -- mock.module() ESM reset bug
- [Mocking the native Node.js Test Runner](https://event-driven.io/en/mocking_nodejs_native_test_runner/) -- Community patterns

### Tertiary (LOW confidence)
- None -- all findings verified against official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- c8 and node:test verified; versions confirmed on npm
- Architecture: HIGH -- patterns derived from reading actual source code and existing tests
- Pitfalls: HIGH -- 6 pitfalls identified from source analysis and documented issues
- Mock strategy: HIGH -- based on codebase analysis + official node:test docs
- Lazy path refactor: MEDIUM -- solution is sound but needs validation that no external consumers break

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable ecosystem; node:test and c8 unlikely to have breaking changes)
