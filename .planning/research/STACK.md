# Technology Stack: Quality Hardening

**Project:** feishu-docs-cli quality hardening milestone
**Researched:** 2026-03-26
**Overall confidence:** HIGH (primary recommendations verified against official docs)

## Recommended Stack

### Testing Framework (Keep Current)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `node:test` | built-in (Node 18.3+) | Test runner | Already in use; stable since Node 20; zero-dependency alignment; describe/it/before/after/mock all built-in |
| `node:assert/strict` | built-in | Assertions | Already in use; strict deep equality semantics; no external assertion library needed |
| `tsx` | ^4.21.0 (current) | TS execution for tests | Already in use; runs .ts test files without pre-compilation; faster DX than `tsc && node --test dist/` |

**Rationale:** The existing test framework is the right choice. Switching to Jest/Vitest would violate the zero-dependency philosophy and add ~50MB+ of devDependencies for marginal benefit. `node:test` is stable (Stability: 2) as of Node 20.0.0 and provides everything this project needs.

**Confidence:** HIGH -- verified against [Node.js v25.8.2 official docs](https://nodejs.org/api/test.html).

### Coverage Measurement

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `c8` | ^11.0.0 | V8 coverage collection | Best-in-class V8 native coverage tool; 2.8M weekly downloads; works with node:test + tsx; generates lcov/text/html reports |

**Primary approach: `c8` wrapping `tsx --test`**

```bash
npx c8 tsx --test test/*.test.ts
```

**Why c8 over alternatives:**

1. **Over `--experimental-test-coverage`:** The built-in flag is still experimental (Stability: 1), has known source-map issues with tsx transpilation ([nodejs/help#4325](https://github.com/nodejs/help/issues/4325)), and lacks rich reporting (no HTML reports, limited lcov support without extra config). c8 is the stable, battle-tested wrapper around the same V8 coverage engine.

2. **Over `node-monocart-coverage`:** Monocart is powerful but more complex (custom reporter integration, separate config file). c8 is simpler: wrap the test command, get reports. Monocart is better suited for projects needing coverage merging across multiple test suites or Playwright integration -- overkill here.

3. **Over Istanbul/nyc:** Legacy. c8 supersedes nyc for V8-based coverage. nyc instruments code; c8 uses V8's native profiler. No instrumentation overhead.

**Known issue:** tsx v4.3.0+ has a [source-map bug](https://github.com/privatenumber/tsx/issues/433) that can cause c8 to report inflated coverage. **Mitigation:** Pin tsx to ^4.21.0 (current), verify coverage numbers against manual inspection of uncovered-line reports. If coverage numbers look suspect, add `--enable-source-maps` flag or fall back to compiling with tsc first and running c8 against compiled JS with source maps.

**Confidence:** MEDIUM -- c8 + tsx is the most common pairing in the ecosystem, but the source-map issue means coverage numbers should be spot-checked during initial setup.

**Configuration (.c8rc.json):**

```json
{
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.d.ts", "test/**"],
  "reporter": ["text", "lcov", "html"],
  "all": true,
  "src": ["src"],
  "clean": true,
  "lines": 80,
  "branches": 70,
  "functions": 80,
  "check-coverage": true
}
```

Key options explained:
- `"all": true` -- report coverage for ALL source files, even those not imported by tests (critical for finding untested modules)
- `"check-coverage": true` + thresholds -- fail CI when coverage drops below targets
- `"reporter": ["text", "lcov", "html"]` -- text for terminal, lcov for CI integration, html for local browsing
- `"branches": 70` -- set lower than lines/functions because complex auth/error branches are hard to reach initially

**Fallback approach (if c8+tsx coverage is unreliable):**

```bash
# Compile first, then run coverage against JS with source maps
tsc && c8 node --enable-source-maps --test dist/**/*.test.js
```

This requires a separate tsconfig for tests (include test/ in compilation). More setup, but eliminates tsx source-map variables entirely. Use only if c8+tsx produces incorrect numbers.

### Mocking Strategy (Evolve Current Patterns)

| Technique | Scope | Use When | Confidence |
|-----------|-------|----------|------------|
| `globalThis.fetch` replacement | API calls | Testing any code that calls fetch (commands, client, auth) | HIGH -- already proven in codebase |
| `t.mock.method(obj, 'name')` | Object methods | Spying on or replacing methods on objects (fs operations, crypto) | HIGH -- stable API, auto-cleanup per test |
| `t.mock.fn()` | Standalone functions | Creating tracked callable mocks for callbacks/handlers | HIGH -- stable API |
| `process.env` save/restore | Environment | Testing auth mode resolution, credential loading | HIGH -- already proven in codebase |
| Dependency injection | Module-level | Testing commands that depend on client/auth/fs | HIGH -- architectural pattern, not a library |

**DO NOT use `mock.module()`** for ESM module mocking. It requires `--experimental-test-module-mocks` flag and has [known bugs with ESM import caching](https://github.com/nodejs/node/issues/59163) -- mocks are not properly reset between tests in the same file. The project's existing pattern (globalThis.fetch replacement + dependency injection) is more reliable.

**Confidence:** HIGH -- `mock.method()` and `mock.fn()` are stable (Stability: 2). The manual globalThis replacement pattern is battle-tested in this codebase. Dependency injection is a well-understood architectural pattern.

**Recommended mock patterns for new tests:**

```typescript
// Pattern 1: globalThis.fetch mock (EXISTING -- keep and standardize)
// Used in: test/fetch-binary.test.ts, test/image-download.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";

describe("command handler", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("should call API correctly", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ code: 0, data: {} }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    // ... test command handler
  });
});

// Pattern 2: t.mock.method for object methods (NEW -- use for fs, crypto)
import { describe, it } from "node:test";
import fs from "node:fs/promises";

describe("token storage", () => {
  it("should write encrypted tokens", async (t) => {
    const writeMock = t.mock.method(fs, "writeFile", async () => {});
    await saveTokens(tokenData);
    assert.equal(writeMock.mock.callCount(), 1);
    assert.deepEqual(writeMock.mock.calls[0].arguments[0], expectedPath);
    // writeMock auto-restores after this test -- no cleanup needed
  });
});

// Pattern 3: Dependency injection (NEW -- use for command handlers)
// Refactor command handlers to accept injectable dependencies:
//
// BEFORE (tightly coupled, hard to test):
//   export async function readHandler(args: string[], globalOpts: GlobalOpts) {
//     const client = createClient(globalOpts);
//     const data = await client.fetchWithAuth(...);
//   }
//
// AFTER (testable via injection):
//   export async function readHandler(
//     args: string[],
//     globalOpts: GlobalOpts,
//     deps = { createClient, downloadImages }
//   ) {
//     const client = deps.createClient(globalOpts);
//   }
//
// TEST:
//   it("should read document", async () => {
//     const mockClient = { fetchWithAuth: mock.fn(async () => ({ code: 0, data: {} })) };
//     await readHandler(["doctoken"], globalOpts, {
//       createClient: () => mockClient,
//       downloadImages: async () => [],
//     });
//   });

// Pattern 4: t.mock.fn for tracked callbacks (NEW -- use for event handlers)
import { describe, it, mock } from "node:test";

describe("event processing", () => {
  it("should call handler for each event", () => {
    const handler = mock.fn();
    processEvents(events, handler);
    assert.equal(handler.mock.callCount(), events.length);
    assert.deepEqual(handler.mock.calls[0].arguments, [events[0]]);
  });
});
```

**Shared test utilities (NEW -- extract to `test/helpers/`):**

The codebase currently has no shared test utilities -- each test file defines its own helpers. For the quality hardening milestone, extract common patterns:

```
test/
  helpers/
    mock-fetch.ts     -- standardized fetch mock builder with call tracking
    mock-response.ts  -- Response factory (already in fetch-binary.test.ts, extract it)
    env-guard.ts      -- process.env save/restore helper
    factory.ts        -- common GlobalOpts, AuthInfo, Block factory functions
  *.test.ts
```

### Refactoring Tools

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `knip` | ^6.0.5 | Dead code detection | Finds unused files, exports, dependencies; understands TS + ESM; auto-fix with --fix; replaces deprecated ts-prune |
| `typescript` | ^5.9.3 (current) | Type-safe refactoring | tsc --noEmit as safety net; strict mode catches type errors during extraction |
| `tsc --noEmit` | (built-in) | Pre/post refactor validation | Already used as pretest; run before AND after every refactoring step |

**Why knip:**

1. **Over `ts-prune`:** ts-prune is [deprecated and in maintenance mode](https://github.com/nadeesha/ts-prune). Its author recommends knip as the successor.
2. **Over manual grep:** knip understands TypeScript's module graph, ESM exports/imports, and can detect unused types -- not just unused values.
3. **Plugin architecture:** knip has built-in support for `node:test` test patterns, so it won't flag test utilities as "unused."
4. **Auto-fix:** `knip --fix` can automatically remove unused exports, reducing manual cleanup.

**Note:** knip v6 requires Node.js >= 20.19.0. The project targets Node >= 18.3.0 for runtime, but dev tooling can require a newer Node. This is acceptable -- developers typically run current Node LTS (22.x or 24.x).

**Confidence:** HIGH -- knip is the clear ecosystem leader for dead code detection in TypeScript. Verified via [knip.dev](https://knip.dev/) and [Effective TypeScript recommendation](https://effectivetypescript.com/2023/07/29/knip/).

**Configuration (knip.json):**

```json
{
  "entry": ["src/cli.ts", "bin/feishu-docs.js"],
  "project": ["src/**/*.ts"],
  "ignore": ["dist/**"],
  "ignoreDependencies": []
}
```

### Static Analysis (Keep Current -- No Additions)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tsc --strict` | 5.9.3 | Type checking | Already enabled; catches type errors at compile time; the project's primary safety net |

**No ESLint recommended for this milestone.** The project has zero runtime dependencies and no ESLint config. For a quality hardening milestone focused on tests and refactoring, adding ESLint would be scope creep. TypeScript strict mode + knip covers the critical code quality checks. ESLint can be considered in a future iteration.

**Confidence:** HIGH -- the project already uses strict TypeScript effectively.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Test runner | `node:test` (keep) | Jest | Heavy dependency tree (~50MB); TS requires transform config; violates zero-dep philosophy |
| Test runner | `node:test` (keep) | Vitest | Adds dependency; overkill; project already has 15 test files using node:test |
| Coverage | `c8` | `--experimental-test-coverage` | Built-in is experimental (Stability: 1); poor source-map support with tsx; no HTML reports; no threshold config file |
| Coverage | `c8` | `node-monocart-coverage` | Overkill; custom reporter pattern adds complexity; c8's wrap-and-run model is simpler |
| Coverage | `c8` | `vitest --coverage` | Would require migrating all tests to Vitest; violates zero-dep philosophy |
| Dead code | `knip` | `ts-prune` | Deprecated; author recommends knip |
| Dead code | `knip` | Manual grep | Cannot understand TS module graph; misses re-exports, type-only exports |
| Module mocking | Manual patterns | `mock.module()` | Experimental; ESM caching bugs; unreliable reset between tests |
| Module mocking | Manual patterns | `esmock` | External dependency; adds complexity; manual patterns work well for this codebase |
| Module mocking | Manual patterns | `sinon` / `testdouble` | External dependencies; `node:test` built-in mock API is sufficient |
| TS execution | `tsx` (keep) | Node native strip-types | Type stripping stable in Node 22.18+, but project targets Node 18.3+; tsx works across all target versions |

## Installation

```bash
# Coverage (dev dependency only)
npm install -D c8

# Dead code detection (dev dependency only)
npm install -D knip
```

**Total new devDependencies: 2** (c8, knip). Both are dev-only. Zero impact on production bundle or runtime dependency count.

## Updated Scripts (package.json)

```json
{
  "scripts": {
    "build": "tsc",
    "build:check": "tsc --noEmit",
    "pretest": "npm run build:check",
    "test": "tsx --test test/*.test.ts",
    "test:coverage": "c8 tsx --test test/*.test.ts",
    "test:coverage:html": "c8 report --reporter=html",
    "lint:dead-code": "knip",
    "prepublishOnly": "npm run build"
  }
}
```

Script details:
- `test:coverage` -- run all tests with V8 coverage; outputs text summary to terminal; enforces thresholds
- `test:coverage:html` -- regenerate HTML report from last coverage run (open `coverage/index.html`)
- `lint:dead-code` -- find unused files, exports, and dependencies

## Node.js Version Considerations

| Feature | Minimum Node.js | Project Target | Status |
|---------|----------------|----------------|--------|
| `node:test` (stable) | 20.0.0 | >= 18.3.0 | Works on 18.3+ (was experimental, stable since 20) |
| `mock.method()` (stable) | 20.0.0 | >= 18.3.0 | Works on 18.3+ |
| `mock.fn()` (stable) | 20.0.0 | >= 18.3.0 | Works on 18.3+ |
| `mock.module()` | Experimental | N/A | DO NOT USE -- buggy with ESM, requires --experimental-test-module-mocks |
| c8 V8 coverage | Any | >= 18.3.0 | V8 coverage profiling available since Node 10 |
| knip v6 | 20.19.0 | Dev-only | Developers use Node 22+ typically; acceptable |
| Snapshot testing | 23.4.0 | N/A | Not recommended for this project (targets 18.3+) |

**Key constraint:** The project targets Node >= 18.3.0 for end users, but dev tooling (knip) requires Node >= 20.19.0. This is standard practice -- CI and development environments run current LTS.

## Key Stack Decisions for This Milestone

### 1. Dependency injection over module mocking

The biggest testing gap is command handlers. Rather than using fragile ESM module mocking, refactor handlers to accept a `deps` parameter with sensible defaults:

```typescript
export async function readHandler(
  args: string[],
  globalOpts: GlobalOpts,
  deps = { createClient, downloadImages, resolveDocument }
) { ... }
```

This makes tests trivial without any mocking framework, and improves code architecture simultaneously.

### 2. TypeScript generic patterns over runtime validation

Use `fetchWithAuth<T>()` with typed response interfaces instead of runtime schema validation. This gives compile-time safety without violating the zero-dependency rule:

```typescript
interface DocxBlocksResponse {
  items: Array<{ block_id: string; block_type: number; /* ... */ }>;
  has_more: boolean;
  page_token?: string;
}
const { data } = await fetchWithAuth<DocxBlocksResponse>(url, opts);
// data.items is now typed -- no more `as Record<string, unknown>`
```

### 3. Coverage gating in CI

Add `npm run test:coverage` to CI pipeline. The `.c8rc.json` thresholds will fail the build if coverage drops below 80% lines / 70% branches / 80% functions. Start with current coverage baseline, then ratchet up as tests are added.

## Future Considerations (Not for This Milestone)

1. **Node.js native TypeScript (strip-types):** When the project drops Node 18 support, tsx can be replaced with native `node --test test/*.test.ts` for TypeScript files. Node 22.18+ strips types natively without flags. This would eliminate the tsx devDependency.

2. **Built-in coverage stabilization:** When `--experimental-test-coverage` reaches Stability: 2, c8 can be dropped in favor of `node --test --experimental-test-coverage --test-coverage-lines=80`. Monitor Node.js release notes.

3. **ESLint + typescript-eslint:** Consider adding for a future code quality milestone. Not needed for test coverage + refactoring focus.

4. **Snapshot testing:** Available since Node 23.4.0 (stable). Could be useful for testing Markdown output of `blocks-to-md.ts`. Defer until Node 18 support is dropped.

## Sources

- [Node.js Test Runner API (v25.8.2)](https://nodejs.org/api/test.html) -- Stability status for all test runner features
- [Node.js Mocking Guide](https://nodejs.org/en/learn/test-runner/mocking) -- Official mock.fn, mock.method, mock.module patterns
- [Node.js Coverage Guide](https://nodejs.org/en/learn/test-runner/collecting-code-coverage) -- Built-in coverage configuration
- [c8 GitHub](https://github.com/bcoe/c8) -- V8 coverage tool, v11.0.0
- [tsx Issue #433](https://github.com/privatenumber/tsx/issues/433) -- c8 + tsx source-map bug (tsx >= 4.3.0)
- [Node.js Issue #59163](https://github.com/nodejs/node/issues/59163) -- mock.module() ESM reset bug
- [Node.js Issue #4325](https://github.com/nodejs/help/issues/4325) -- Coverage with TypeScript source maps
- [knip.dev](https://knip.dev/) -- Dead code detection tool, v6.0.5
- [Effective TypeScript: Use knip](https://effectivetypescript.com/2023/07/29/knip/) -- knip recommendation over ts-prune
- [node-monocart-coverage](https://github.com/cenfun/node-monocart-coverage) -- Alternative coverage reporter (evaluated, not recommended)
- [Node.js TypeScript Support](https://nodejs.org/api/typescript.html) -- Native type stripping (future consideration)
- [Node.js stabilizes TypeScript execution](https://progosling.com/en/dev-digest/nodejs-native-typescript-stable-2025) -- Type stripping stable in Node 22.18+

---

*Stack research: 2026-03-26*
