# Phase 2: 命令处理器集成测试 - Research

**Researched:** 2026-03-27
**Domain:** Node.js CLI command handler integration testing (node:test + globalThis.fetch mocking)
**Confidence:** HIGH

## Summary

Phase 2 requires writing integration tests for all 18+ command handlers to bring overall line coverage from 50.33% to >= 80%. The commands directory is currently at 21.51% line coverage, which is the primary gap. The existing test infrastructure from Phase 1 (mock-fetch, factory, env-guard helpers) provides a solid foundation, but command handler testing introduces a new challenge: intercepting `process.stdout.write` and `process.stderr.write` to capture and assert on command output.

Each command follows a consistent pattern: `handler(args: CommandArgs, globalOpts: GlobalOpts) => Promise<void>`. All commands call `createClient(globalOpts)` which resolves auth and creates an `AuthInfo` object. Most commands then call `resolveDocument()` or directly call `fetchWithAuth()`. Output goes through `process.stdout.write()` (data) and `process.stderr.write()` (messages/warnings). Since `mock.module()` is forbidden (D-05 from Phase 1), we must mock at the `globalThis.fetch` level and intercept stdout/stderr via `t.mock.method()`.

**Primary recommendation:** Create a `test/helpers/capture-output.ts` helper that uses `t.mock.method(process.stdout, "write")` and `t.mock.method(process.stderr, "write")` to capture output, then test all commands by calling their exported handler functions directly with `makeGlobalOpts({ json: true })` for structured output validation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 统一在 globalThis.fetch 层级 mock，测试 command->service->client->fetch 完整链路。复用 Phase 1 的 `setupMockFetch`、`jsonResponse`、`tenantTokenResponse` 辅助函数。
- **D-02:** 每个测试需要设置完整的 mock 响应链：tenant token 响应 + 实际 API 响应。通过 `setupMockFetch` 的有序响应队列实现。
- **D-03:** --json 模式为主测试目标：解析 JSON 输出并检查关键字段是否存在且类型正确（结构化断言）。不做精确字符串匹配。
- **D-04:** 人类可读模式为辅助验证：仅检查关键字符串包含（contains），不做精确输出匹配，避免格式微调破坏测试。
- **D-05:** 按领域分组为 4 个执行计划：
  - Plan 1: 文档操作 -- read, create, update, delete, cat（核心 CRUD + 流式读取）
  - Plan 2: 知识库与导航 -- wiki（6个子命令）, tree, spaces
  - Plan 3: 云盘操作 -- ls, mv, cp, mkdir
  - Plan 4: 权限与其他 -- share（5个子命令）, search, info, login/authorize/logout + 覆盖率达标验证
- **D-06:** 保留 info.test.ts 和 share.test.ts 中的现有测试，在同一文件中追加新的集成测试 describe 块。不重写、不迁移。
- **D-07:** 继续使用 `{ concurrency: 1 }` 控制涉及 globalThis.fetch 和 process.env 的测试块并发。
- **D-08:** 测试文件命名遵循 `{command-name}.test.ts` 模式，存放在 `test/` 目录。
- **D-09:** 所有导入使用 `.js` 扩展名（ESM 要求）。

### Claude's Discretion
- 每个命令具体测试哪些场景和边界条件
- mock 数据的具体结构和内容
- describe 块的组织粒度
- 是否需要为大命令（read 592行、wiki 406行）创建额外的辅助函数

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMD-01 | read 命令集成测试（--json 和人类可读模式、嵌入内容、图片下载） | Command handler pattern analysis, stdout capture helper, multi-response mock chain for enrichment logic |
| CMD-02 | create 命令集成测试（云盘创建、wiki 创建、--body 参数） | Two creation paths identified (createDoc vs createInWiki), mock chain for body content writing |
| CMD-03 | update 命令集成测试（追加、覆写+备份、恢复模式） | Three distinct modes identified (append/overwrite/restore), filesystem mock needed for restore path validation |
| CMD-04 | delete 命令集成测试（回收站删除、确认提示） | withScopeRecovery wrapping, wiki-rejection path, confirmation flow |
| CMD-05 | cat/tree/spaces 命令测试（分页、递归、限制） | Recursive tree walking needs multi-level mock responses, pagination mock for spaces |
| CMD-06 | wiki 子命令测试（create-space、add-member、rename、move、copy） | SubcommandMeta pattern, 6 independent handlers each with simple API call + output |
| CMD-07 | share 子命令测试（list、add、remove、update、set） | SubcommandMeta pattern, 5 handlers, add has fallback-to-update on 1201003 error code |
| CMD-08 | ls/mv/cp/mkdir 云盘操作测试 | Drive API mocking, mv has async task polling path, cp has title-fetch fallback |
| CMD-09 | search 命令测试（用户令牌验证、搜索参数） | Requires user auth mode (tenant mode rejection), pagination logic |
| CMD-10 | 测试覆盖率整体达到 80% | Current: 50.33% lines. Commands at 21.51%. Need ~58.49% increase in commands coverage. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | Node.js built-in | Test runner (describe/it/beforeEach/afterEach) | Zero-dependency mandate, already established |
| `node:assert/strict` | Node.js built-in | Assertions | Zero-dependency mandate, already established |
| `tsx` | ^4.21.0 | TypeScript execution engine | Already installed, runs tests without pre-compilation |
| `c8` | ^11.0.0 | Coverage measurement | Already installed, configured in `.c8rc.json` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `test/helpers/mock-fetch.ts` | project-local | `setupMockFetch`, `jsonResponse`, `tenantTokenResponse` | Every command test that triggers API calls |
| `test/helpers/factory.ts` | project-local | `makeAuthInfo`, `makeGlobalOpts`, `makeApiResponse` | Every command test for constructing args |
| `test/helpers/env-guard.ts` | project-local | `withCleanEnv`, `withNoAuthEnv` | login/authorize tests that depend on env vars |

### New Helper Needed
| Helper | Purpose | Why |
|--------|---------|-----|
| `test/helpers/capture-output.ts` | Capture stdout/stderr writes for output assertions | All commands output via `process.stdout.write()`; need to intercept and assert |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Test Structure
```
test/
  helpers/
    mock-fetch.ts          # Existing - fetch mock with ordered responses
    env-guard.ts           # Existing - environment variable isolation
    factory.ts             # Existing - test data factories
    capture-output.ts      # NEW - stdout/stderr capture helper
  read.test.ts             # NEW - CMD-01
  create.test.ts           # NEW - CMD-02
  update.test.ts           # NEW - CMD-03
  delete.test.ts           # NEW - CMD-04
  cat.test.ts              # NEW - CMD-05 (part 1)
  tree.test.ts             # NEW - CMD-05 (part 2)
  spaces.test.ts           # NEW - CMD-05 (part 3)
  wiki.test.ts             # NEW - CMD-06
  share.test.ts            # EXTEND - CMD-07 (append to existing)
  ls.test.ts               # NEW - CMD-08 (part 1)
  mv.test.ts               # NEW - CMD-08 (part 2)
  cp.test.ts               # NEW - CMD-08 (part 3)
  mkdir.test.ts            # NEW - CMD-08 (part 4)
  search.test.ts           # NEW - CMD-09
  info.test.ts             # EXTEND - CMD-10 (append to existing)
  login.test.ts            # NEW - CMD-10 (login/logout/whoami)
  authorize.test.ts        # NEW - CMD-10
```

### Pattern 1: Output Capture Helper
**What:** A reusable helper that intercepts `process.stdout.write` and `process.stderr.write`, collects all written strings, and provides getters.
**When to use:** Every command handler test that needs to verify output.
**Example:**
```typescript
// test/helpers/capture-output.ts
import type { TestContext } from "node:test";

interface CapturedOutput {
  stdout(): string;
  stderr(): string;
  stdoutJson(): unknown;
  restore(): void;
}

export function captureOutput(t: TestContext): CapturedOutput {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  // Use t.mock.fn to create mock functions
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;

  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    stdoutJson: () => JSON.parse(stdoutChunks.join("")),
    restore: () => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    },
  };
}
```

### Pattern 2: Command Handler Direct Invocation
**What:** Call the exported handler function directly, bypassing CLI routing.
**When to use:** All command integration tests.
**Example:**
```typescript
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse, tenantTokenResponse } from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { spaces } from "../src/commands/spaces.js";

describe("spaces command", { concurrency: 1 }, () => {
  let restoreFetch: () => void;
  let restoreOutput: () => void;

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    if (restoreOutput) restoreOutput();
  });

  it("should list spaces in --json mode", async (t) => {
    await withCleanEnv(
      { FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "secret" },
      async () => {
        const { restore: rFetch } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { items: [{ space_id: "sp1", name: "Wiki1" }] },
            }),
          ],
        });
        restoreFetch = rFetch;

        const output = captureOutput(t);
        restoreOutput = output.restore;

        await spaces({}, makeGlobalOpts({ json: true }));
        const result = output.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.ok(Array.isArray(result.spaces));
      },
    );
  });
});
```

### Pattern 3: Mock Response Chain for resolveDocument
**What:** Many commands call `createClient()` then `resolveDocument()`, which internally calls `resolveWikiToken()`. This requires a 3-response mock chain: tenant token + wiki resolve + actual API call.
**When to use:** Commands that accept URL/token input: read, create (wiki), update, delete, info, share, mv, cp.
**Example:**
```typescript
// For a docx URL input (parseDocUrl returns type=docx, skips wiki resolution):
// Chain: tenant token + actual API call = 2 responses

// For a wiki URL input (parseDocUrl returns type=wiki, triggers wiki resolution):
// Chain: tenant token (for resolveWikiToken) + wiki node response + tenant token (for actual call) + actual API call = 4 responses
// BUT: tenant token is cached after first call, so often just 3 responses

// For a raw token input (parseDocUrl returns type=unknown, tries wiki first with fallback):
// Chain: tenant token + wiki resolve attempt (may fail) + actual API call = 2-3 responses
```

### Pattern 4: withScopeRecovery Wrapping
**What:** Several commands (delete, share/*, ls, mv, cp, mkdir, search) wrap their logic in `withScopeRecovery()`. In tests, since `globalOpts.json = true` and `process.stdin.isTTY` is typically falsy in tests, the recovery path returns false and rethrows. This means the wrapped function executes normally on success.
**When to use:** Commands wrapped with `withScopeRecovery`.
**Implication:** No special handling needed for happy path. For error testing, the CliError propagates normally.

### Pattern 5: Subcommand Handler Testing
**What:** `wiki` and `share` use `SubcommandMeta` with a `subcommands` record. Each subcommand has its own handler. Test by calling the subcommand handler directly.
**When to use:** wiki and share subcommands.
**Example:**
```typescript
import { meta } from "../src/commands/wiki.js";

// Access subcommand handler directly:
const createSpaceHandler = meta.subcommands["create-space"].handler;
await createSpaceHandler({ positionals: ["MySpace"], desc: "A wiki" }, globalOpts);
```

### Anti-Patterns to Avoid
- **Testing via CLI routing (src/cli.ts run()):** Too broad, introduces CLI parsing layer that's already tested. Call handler functions directly.
- **Exact string matching on human-readable output:** Fragile. Use `includes()` or regex for human-readable mode per D-04.
- **Sharing mock state across describe blocks:** Each describe block should have independent mock setup/teardown via afterEach.
- **Not restoring stdout/stderr:** Forgetting to call `restore()` on the output capture will corrupt output for subsequent tests. Use afterEach.
- **Testing with concurrency > 1:** All tests touching `globalThis.fetch` or `process.stdout/stderr` must use `{ concurrency: 1 }`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fetch mocking | Custom fetch interceptor | `setupMockFetch` from `test/helpers/mock-fetch.ts` | Already handles ordered responses, call tracking, auto-cleanup |
| Auth info construction | Manual object literals | `makeAuthInfo()`, `makeGlobalOpts()` from `test/helpers/factory.ts` | Ensures correct shape, reduces boilerplate |
| Env var isolation | Manual save/restore in beforeEach/afterEach | `withCleanEnv()` from `test/helpers/env-guard.ts` | Handles cleanup in finally block, prevents test pollution |
| Response building | Inline `new Response(...)` | `jsonResponse()`, `tenantTokenResponse()` from `test/helpers/mock-fetch.ts` | Correct headers, consistent format |

**Key insight:** All infrastructure for fetch-level mocking is ready from Phase 1. The only new infrastructure needed is stdout/stderr capture.

## Common Pitfalls

### Pitfall 1: Forgetting Tenant Token in Mock Chain
**What goes wrong:** Test crashes with "Unexpected fetch call #2" because `createClient()` -> `resolveAuth()` -> `getTenantToken()` consumes the first fetch call, but only one response was configured.
**Why it happens:** Every command calls `createClient(globalOpts)` which resolves auth. In tenant mode (when env vars FEISHU_APP_ID + FEISHU_APP_SECRET are set), the first API call triggers `getTenantToken()`, consuming one fetch response.
**How to avoid:** Always start the mock response chain with `tenantTokenResponse()` when testing with `makeGlobalOpts()` default (which has `auth: "auto"`).
**Warning signs:** "Unexpected fetch call" errors; tests failing on the first assertion.

### Pitfall 2: resolveDocument Adding Extra Fetch Calls
**What goes wrong:** Mock response count is wrong because `resolveDocument()` calls `resolveWikiToken()` (another fetch call) for wiki and unknown type inputs.
**Why it happens:** When input is a wiki URL or raw token, `parseDocUrl` returns `type: "wiki"` or `type: "unknown"`, triggering a wiki node resolution API call.
**How to avoid:** Use docx URLs for simpler tests (skip wiki resolution). When testing wiki path, add the wiki node response to the chain. Count expected fetch calls carefully.
**Warning signs:** Response mismatch errors; wrong API being called with wrong data.

### Pitfall 3: Not Cleaning Up stdout/stderr Mock
**What goes wrong:** Subsequent test output is swallowed or captured into the wrong test's assertions. Test runner output becomes garbled.
**Why it happens:** `process.stdout.write` is replaced but not restored if the test fails before cleanup.
**How to avoid:** Always restore in `afterEach`, not just in the test body. The capture helper's `restore()` must be called unconditionally.
**Warning signs:** Missing test output in console; tests appearing to pass but with no visible assertions.

### Pitfall 4: Async Mocks Not Awaited
**What goes wrong:** Test appears to pass but assertions run before the command handler completes, missing actual failures.
**Why it happens:** All command handlers are async. If `await` is missing, the test resolves immediately.
**How to avoid:** Always `await` the handler call. Use `assert.rejects()` for error testing.
**Warning signs:** Tests passing that should fail; coverage not increasing for awaited code paths.

### Pitfall 5: update Command's File System Dependencies
**What goes wrong:** `update --restore` reads a backup file from disk. Tests fail because the file doesn't exist.
**Why it happens:** `restoreFromBackup()` uses `existsSync()` and `readFile()` to read a backup JSON file, and validates the path is under the backups directory.
**How to avoid:** For restore testing, create actual temp files in a temp directory. Use HOME env var override to redirect `getBackupsDir()` to a test-controlled location.
**Warning signs:** `FILE_NOT_FOUND` or `INVALID_ARGS` errors about backup file paths.

### Pitfall 6: login/authorize Commands Spawn OAuth Server
**What goes wrong:** Tests hang because `oauthLogin()` starts an HTTP server and opens a browser.
**Why it happens:** `login()` and `authorize()` call `oauthLogin()` which creates an `http.createServer()` and `child_process.exec()` to open a browser.
**How to avoid:** Do NOT test the full login/authorize flow. Instead: test only validation logic (missing env vars, invalid scopes), test `whoami` and `logout` which don't trigger OAuth. For `login`/`authorize`, test the early validation paths (missing FEISHU_APP_ID, missing --scope) and document that full OAuth flow testing is deferred to E2E.
**Warning signs:** Tests hanging; ports being opened; browser windows opening.

### Pitfall 7: read Command's Complex Enrichment Chain
**What goes wrong:** Tests require an enormous mock response chain (tenant token + wiki resolve + fetchAllBlocks + batchGetTmpUrls + downloadImages + resolveUserNames + fetchBitableData + fetchSheetData + fetchBoardImage).
**Why it happens:** `read()` has extensive enrichment logic that calls many different APIs.
**How to avoid:** Test `read` with minimal blocks first (no images, no mentions, no bitable). Add separate tests for enrichment by providing blocks with specific types. For enrichment, the non-critical failures are caught and produce warnings -- these can be verified via stderr capture.
**Warning signs:** 10+ mock responses needed; tests becoming brittle to response ordering.

### Pitfall 8: mv Command's Async Task Polling
**What goes wrong:** `mv` command has a polling loop with `setTimeout` that waits for async task completion.
**Why it happens:** The move API may return a `task_id` for async completion, requiring polling.
**How to avoid:** Test both paths: (1) sync completion (no task_id in response), (2) async completion with immediate success on first poll. Use `mock.timers` if needed to avoid real delays, or ensure the poll response returns "success" immediately.
**Warning signs:** Tests timing out; 1-second delays in test execution.

## Code Examples

### Verified: captureOutput Helper Implementation
```typescript
// test/helpers/capture-output.ts
// Source: Derived from project patterns (process.stdout.write usage in all commands)

interface CapturedOutput {
  stdout(): string;
  stderr(): string;
  stdoutJson(): unknown;
  restore(): void;
}

export function captureOutput(): CapturedOutput {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;

  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    stdoutJson: () => JSON.parse(stdoutChunks.join("")),
    restore: () => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    },
  };
}
```

### Verified: Standard Command Test Pattern
```typescript
// Source: Derived from existing client.test.ts pattern + command handler analysis

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse, tenantTokenResponse } from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { mkdir } from "../src/commands/mkdir.js";
import { CliError } from "../src/utils/errors.js";

describe("mkdir command", { concurrency: 1 }, () => {
  let restoreFetch: () => void;
  let restoreOutput: () => void;

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    if (restoreOutput) restoreOutput();
  });

  it("should create folder in --json mode", async () => {
    await withCleanEnv(
      { FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "secret" },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { token: "fldcn123", url: "https://feishu.cn/drive/folder/fldcn123" },
            }),
          ],
        });
        restoreFetch = restore;

        const output = captureOutput();
        restoreOutput = output.restore;

        await mkdir(
          { positionals: ["NewFolder"] },
          makeGlobalOpts({ json: true }),
        );

        const result = output.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.name, "NewFolder");
        assert.ok(result.token);
      },
    );
  });

  it("should throw for missing name", async () => {
    await assert.rejects(
      () => mkdir({ positionals: [] }, makeGlobalOpts()),
      (err: unknown) => err instanceof CliError && err.errorType === "INVALID_ARGS",
    );
  });
});
```

### Verified: resolveDocument Mock Chain for docx Input
```typescript
// For commands that use resolveDocument with a docx URL:
// parseDocUrl("https://example.feishu.cn/docx/abc123") => { type: "docx", token: "abc123" }
// Since type is "docx" (not "wiki" or "unknown"), resolveDocument skips wiki resolution.
// Mock chain: tenant token + actual API responses only.

const { restore } = setupMockFetch({
  responses: [
    tenantTokenResponse(),                    // createClient -> getTenantToken
    jsonResponse({ code: 0, data: { ... } }), // actual command API call
  ],
});
```

### Verified: resolveDocument Mock Chain for wiki Input
```typescript
// For commands that use resolveDocument with a wiki URL:
// parseDocUrl("https://example.feishu.cn/wiki/wikiToken123") => { type: "wiki", token: "wikiToken123" }
// resolveDocument calls resolveWikiToken which makes an API call.
// Mock chain: tenant token + wiki resolve + actual API responses.

const { restore } = setupMockFetch({
  responses: [
    tenantTokenResponse(),                    // createClient -> getTenantToken
    jsonResponse({                             // resolveWikiToken
      code: 0,
      data: {
        node: {
          obj_token: "docx_real_token",
          obj_type: "docx",
          title: "Test Doc",
          node_token: "wikiToken123",
          space_id: "sp_test",
          has_child: false,
        },
      },
    }),
    jsonResponse({ code: 0, data: { ... } }), // actual command API call
  ],
});
```

## Command Handler Analysis

### Size and Complexity Ranking

| Command | Lines | API Calls | Paths | Test Priority |
|---------|-------|-----------|-------|---------------|
| read.ts | 592 | 8+ (blocks + enrichment) | --raw, --blocks, --with-meta, default markdown | HIGH - most complex |
| wiki.ts | 406 | 1-2 per sub | 6 subcommands x (json + human) | HIGH - many paths |
| share.ts | 393 | 1-2 per sub | 5 subcommands x (json + human) + add fallback | HIGH - many paths |
| update.ts | 330 | 3-5 | append, overwrite, restore | HIGH - destructive ops |
| cat.ts | 207 | 2+ recursive | depth limit, byte limit, doc limit, type filter | MEDIUM |
| create.ts | 207 | 2-3 | wiki create, doc create, body content | MEDIUM |
| tree.ts | 155 | 2+ recursive | depth limit, json/human | MEDIUM |
| delete.ts | 144 | 2-3 | wiki reject, drive delete, confirm | MEDIUM |
| search.ts | 136 | 1-2 | user-only, pagination, type filter | MEDIUM |
| login.ts | 129 | 0 (OAuth) | login, logout, whoami | LOW (OAuth untestable) |
| mv.ts | 113 | 2-3 | sync, async polling | MEDIUM |
| ls.ts | 105 | 1+ paginated | folder, type filter, limit | MEDIUM |
| authorize.ts | 103 | 0 (OAuth) | scope validation | LOW (OAuth untestable) |
| cp.ts | 95 | 2-3 | with/without --name | MEDIUM |
| info.ts | 85 | 2-3 | wiki vs drive, docx revision | MEDIUM |
| mkdir.ts | 68 | 1 | with/without --parent | LOW - simplest |
| spaces.ts | 57 | 1+ paginated | json/human, empty | LOW - simple |

### Coverage Gap Analysis

Current command coverage: 21.51% lines overall. Per-file breakdown:

| File | Current Lines % | Uncovered (approx) | Tests Needed |
|------|----------------|---------------------|--------------|
| read.ts | 17.06% | 490+ lines | 10+ tests (modes, enrichment, errors) |
| update.ts | 14.24% | 280+ lines | 8+ tests (append, overwrite, restore) |
| create.ts | 15.45% | 175+ lines | 6+ tests (doc, wiki, body) |
| wiki.ts | 22.90% | 310+ lines | 12+ tests (6 subcommands) |
| share.ts | 25.19% | 290+ lines | 10+ tests (5 subcommands) |
| cat.ts | 24.63% | 155+ lines | 5+ tests (limits, recursion) |
| tree.ts | 25.97% | 115+ lines | 4+ tests (depth, json/human) |
| delete.ts | 20.13% | 115+ lines | 4+ tests (confirm, wiki reject, drive) |
| search.ts | 22.05% | 105+ lines | 4+ tests (user-only, pagination) |
| ls.ts | 28.57% | 75+ lines | 3+ tests (pagination, type filter) |
| mv.ts | 21.23% | 90+ lines | 3+ tests (sync, async, timeout) |
| cp.ts | 23.15% | 75+ lines | 3+ tests (with/without name) |
| mkdir.ts | 26.47% | 50+ lines | 2+ tests (basic, with parent) |
| spaces.ts | 22.80% | 44+ lines | 2+ tests (json, human, empty) |
| info.ts | 18.82% | 69+ lines | 3+ tests (wiki, drive, revision) |
| login.ts | 25.58% | 96+ lines | 3+ tests (whoami, logout, login-validation) |
| authorize.ts | 27.18% | 75+ lines | 2+ tests (validation paths) |
| install-skill.ts | 45.94% | 20+ lines | 1 test (low priority) |

**Estimated total tests needed:** ~80-100 test cases to reach 80% coverage.

### Fetch Call Count Per Command (Happy Path)

Understanding the expected fetch call count is critical for setting up mock response chains.

| Command | Input Type | Fetch Calls | Breakdown |
|---------|-----------|-------------|-----------|
| spaces | - | 2 | tenant token + list spaces |
| mkdir | - | 2 | tenant token + create folder |
| ls | folder_token | 2 | tenant token + list files |
| search | query | 2 | tenant token + search API |
| info | docx URL | 3 | tenant token + resolve doc + get doc info |
| info | wiki URL | 4 | tenant token + wiki resolve + resolve doc + get doc info |
| create (doc) | title | 2 | tenant token + create doc |
| create (wiki) | title + --wiki | 2 | tenant token + create wiki node |
| create (doc+body) | title + --body | 4 | tenant token + create doc + get doc info + convert+write |
| delete | docx URL + --confirm | 3 | tenant token + resolve doc + delete |
| update (append) | docx URL + --body | 4 | tenant token + resolve doc + get doc info + convert+write |
| update (overwrite) | docx URL + --body | 5+ | tenant token + resolve + backup + get info + clear + write + title |
| read (basic) | docx URL | 3 | tenant token + resolve doc + fetch blocks |
| read (enrichment) | docx URL | 6+ | + tmp URLs + download images + resolve users |
| mv (sync) | token + folder | 3 | tenant token + resolve doc + move |
| mv (async) | token + folder | 4+ | tenant token + resolve doc + move + poll |
| cp | token + folder | 3-4 | tenant token + resolve doc + (title fetch) + copy |
| tree | space_id | 3+ | tenant token + space info + fetch children (recursive) |
| cat | space_id | 3+ | tenant token + fetch children + fetch blocks per doc |
| wiki create-space | name | 2 | tenant token + create space |
| wiki add-member | space + member | 2 | tenant token + add member |
| share list | URL | 3 | tenant token + resolve doc + list members |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mock.module()` for ESM mocking | `globalThis.fetch` replacement + dependency injection | Phase 1 decision | Avoids experimental API instability, works on Node 18 |
| Per-test manual save/restore | `setupMockFetch` with `restore()` + `withCleanEnv()` | Phase 1 | Consistent cleanup, less boilerplate |
| No output capture | `captureOutput()` helper (new in Phase 2) | Phase 2 | Enables command handler output testing |

**Deprecated/outdated:**
- `mock.module()`: Still experimental in Node 22+, explicitly forbidden (D-05 from Phase 1). Not available on Node 18.
- `jest.spyOn(process.stdout, 'write')`: Jest is not used in this project.

## Open Questions

1. **How to handle update --restore file system dependency**
   - What we know: `restoreFromBackup()` validates path is under backups dir, reads file, parses JSON
   - What's unclear: Whether HOME env var override properly redirects `getBackupsDir()` in all cases
   - Recommendation: Create actual temp files in a temp directory. Override HOME env var to point backups dir to temp. Verify `getBackupsDir()` uses `os.homedir()` which respects HOME env var (confirmed: Phase 1 established this pattern for auth.ts).

2. **Coverage math: Can we reach 80% by testing commands alone?**
   - What we know: Current overall = 50.33%. Commands at 21.51% (2466 total lines est., ~530 covered). Other modules (auth, client, services, parser, utils) are at ~75% average.
   - What's unclear: Exact line count breakdown. Whether some uncovered lines in services/utils are only reachable via command integration paths.
   - Recommendation: Focus on command handler tests. The integration nature of these tests (command -> service -> client -> fetch) will also increase coverage in services and utils as a side effect. Run `npm run test:coverage` after each plan to verify progress. Estimate: bringing commands to ~70% + side-effect increases should get us to 80% overall.

3. **login/authorize: How much to test?**
   - What we know: Both call `oauthLogin()` which spawns HTTP server + browser. Untestable without E2E infrastructure.
   - What's unclear: How much of login.ts is reachable via the validation-only paths.
   - Recommendation: Test validation paths only (missing env vars, invalid scope format). Test `whoami` and `logout` fully (they don't trigger OAuth). Accept that ~50% of login.ts and ~40% of authorize.ts will remain uncovered. These ~40 uncovered lines across both files will not materially impact the 80% target.

## Project Constraints (from CLAUDE.md)

- **Zero-dependency:** No new production dependencies. Test helpers are project-local, not packages.
- **Node.js built-in test runner:** `node:test` + `assert/strict` only. No Jest, Vitest, Mocha.
- **ESM:** All imports with `.js` extension. `"type": "module"` in package.json.
- **API compatibility:** Test the existing command interface; do not change command behavior.
- **Backward compatible:** All existing tests must continue to pass.
- **TypeScript strict mode:** All test files must pass `tsc --noEmit`.
- **Immutability:** Test helpers should return new objects, not mutate.
- **File size:** Keep test files under 800 lines. Split large command tests if needed (e.g., read.test.ts may approach this limit).
- **Concurrency control:** `{ concurrency: 1 }` on all describe blocks touching globalThis.fetch or process.stdout/stderr.

## Sources

### Primary (HIGH confidence)
- Source code analysis: All 18 command files in `src/commands/` read and analyzed
- Source code analysis: `test/helpers/mock-fetch.ts`, `test/helpers/factory.ts`, `test/helpers/env-guard.ts` read
- Source code analysis: `test/client.test.ts` patterns (22 tests showing established mock patterns)
- Source code analysis: `src/types/index.ts` for CommandArgs, GlobalOpts, CommandMeta types
- Source code analysis: `src/utils/document-resolver.ts` for resolveDocument flow
- Source code analysis: `src/services/wiki-nodes.ts` for resolveWikiToken flow
- Coverage data: `npm run test:coverage` output (50.33% lines, 78.86% branches, 58.06% functions)
- Phase 1 context: `.planning/phases/01-testing-infra-core-tests/01-CONTEXT.md`

### Secondary (MEDIUM confidence)
- node:test documentation for `t.mock.method()` and `TestContext` API
- c8 coverage tool behavior with tsx (verified working in Phase 1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all tools already in place from Phase 1, no new dependencies
- Architecture: HIGH - command handler patterns are uniform and well-understood from source analysis
- Pitfalls: HIGH - derived from concrete code analysis of all 18 commands and their dependency chains
- Coverage target feasibility: MEDIUM - mathematical estimate suggests achievable, but depends on exact line coverage behavior

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable codebase, no external dependency changes expected)
