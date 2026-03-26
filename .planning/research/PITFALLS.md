# Domain Pitfalls

**Domain:** CLI tool quality hardening (testing + refactoring existing TypeScript ESM codebase)
**Researched:** 2026-03-26

## Critical Pitfalls

Mistakes that cause rewrites, test suite instability, or regressions in production behavior.

### Pitfall 1: Refactoring Before Adequate Test Coverage

**What goes wrong:** Extracting modules (e.g., splitting `blocks-to-md.ts` or `read.ts`) before the existing behavior is locked down by tests. The refactored code subtly changes behavior (argument ordering, error messages, edge-case handling) and there is no automated way to detect it. CLI users and downstream automation scripts silently break.

**Why it happens:** Refactoring feels productive and the large files (822-line `blocks-to-md.ts`, 592-line `read.ts`) are obvious targets. Developers are tempted to "clean up first, test later" because the cleaned-up code is easier to test. But the refactoring itself is the riskiest change.

**Consequences:** Behavioral regressions in the CLI output that are invisible without integration tests. The `blocks-to-md.ts` rendering pipeline has 30+ block types; any one of them can regress during a dispatch-table extraction. The `read.ts` enrichment pipeline has multiple serial API-call sequences whose ordering matters for correctness.

**Prevention:**
1. Write characterization tests first: for `blocks-to-md.ts`, run the full `blocksToMarkdown()` on representative block trees and snapshot the output. For `read.ts`, mock `globalThis.fetch` and assert the full handler output.
2. Only then extract modules, keeping the same tests passing.
3. Treat each refactoring PR as "tests pass before AND after, no new tests needed for the refactoring itself."

**Detection:** If you find yourself writing tests for code you are simultaneously moving between files, stop. Write the tests against the original file structure first, merge them, then refactor.

**Phase mapping:** Tests MUST land in an earlier phase than any refactoring work. The PROJECT.md already encodes this decision ("test before refactoring") -- enforce it rigorously.

---

### Pitfall 2: ESM Module Cache Preventing Test Isolation with `globalThis.fetch` Mocks

**What goes wrong:** The existing `test/fetch-binary.test.ts` uses `await import("../src/client.js")` to pick up the mocked `globalThis.fetch`. In ESM, dynamic imports are cached after the first evaluation. If another test file imports `client.ts` statically (or a different test in the same file does a dynamic import first), subsequent dynamic imports return the **cached** module that captured the **original** `globalThis.fetch`, not the mock.

**Why it happens:** ESM modules are singletons. Unlike CommonJS where `delete require.cache[path]` works, ESM provides no public API to invalidate the module cache. The existing test works only because `fetch-binary.test.ts` is the sole consumer of `client.ts` in the test suite. Once you add `fetchWithAuth` tests, `createClient` tests, and command handler integration tests that all touch `client.ts`, the cache collision becomes inevitable.

**Consequences:** Tests pass individually but fail when run together. Order-dependent failures that appear randomly depending on which test file the runner picks up first. Classic "works on my machine, fails in CI" symptom.

**Prevention:**
1. **Do not rely on dynamic import for mock isolation.** Instead, design modules to accept dependencies via function parameters (dependency injection). For example, `fetchWithAuth` could accept an optional `fetcher` parameter that defaults to `globalThis.fetch` but can be overridden in tests.
2. Alternatively, **always mock at the `globalThis.fetch` level** (which is a true global, not module-scoped) and ensure every test file saves/restores it in `beforeEach`/`afterEach`. This is already the pattern in `fetch-binary.test.ts` -- standardize it.
3. If dynamic imports are used, add a query-string cache buster: `await import(\`../src/client.js?t=\${Date.now()}\`)`. This forces a fresh module evaluation but has the downside that child imports of the module are still cached.
4. Run tests with `--test-concurrency=1` if using shared global mocks to prevent parallel test files from colliding.

**Detection:** If any test passes with `tsx --test test/specific.test.ts` but fails with `tsx --test test/*.test.ts`, you have a module cache isolation problem.

**Phase mapping:** Establish the mocking pattern (DI or global mock convention) in the first testing phase, before writing many test files.

**Confidence:** HIGH -- this is directly observed in the codebase's existing test pattern and is a well-documented ESM limitation ([Node.js ESM cache issue](https://github.com/nodejs/help/issues/1399), [Node.js ESM bypass cache](https://futurestud.io/tutorials/node-js-esm-bypass-cache-for-dynamic-imports)).

---

### Pitfall 3: `node:test` `mock.module()` Is Experimental and Requires a CLI Flag

**What goes wrong:** Developers discover `mock.module()` in node:test docs and assume it is the standard way to mock ESM imports. They write tests using it, then find it requires `--experimental-test-module-mocks` flag, does not work with all module types, and has [known bugs](https://github.com/nodejs/node/issues/55891) including inability to mock non-installed modules and silent failures.

**Why it happens:** The node:test runner itself is stable (Stability 2), but `mock.module()` remains experimental. The API surface looks clean in docs, leading developers to adopt it without checking stability status. The feature also behaves differently across Node.js versions (18 vs 20 vs 22+).

**Consequences:** Test infrastructure depends on an experimental API that may change between Node.js versions. The project targets `node >= 18.3.0` -- `mock.module()` is not available at all on Node 18. Tests would only work on newer Node versions, breaking the stated compatibility.

**Prevention:**
1. **Do not use `mock.module()`.** Continue the established pattern of mocking `globalThis.fetch` directly and using dependency injection for other module-level dependencies.
2. If module-level mocking is absolutely needed (e.g., mocking `node:fs/promises` for `auth.ts` token persistence tests), use the pattern of writing a thin wrapper function that can be replaced in tests, or test against real temp directories (as `image-download.test.ts` already does).
3. Document in a test README that `mock.module()` is off-limits until it reaches stable status.

**Detection:** Any test file that imports `mock` from `node:test` and calls `mock.module()` is a red flag. Grep for it in CI.

**Phase mapping:** Decide and document this constraint in Phase 1 (testing infrastructure setup).

**Confidence:** HIGH -- [confirmed experimental status in Node.js docs](https://nodejs.org/api/test.html), [known issues](https://github.com/nodejs/node/issues/55891).

---

### Pitfall 4: Testing `resolveAuth()` Without Leaking Environment State Between Tests

**What goes wrong:** `resolveAuth()` reads `process.env.FEISHU_USER_TOKEN`, `process.env.FEISHU_APP_ID`, and `process.env.FEISHU_APP_SECRET`. It also calls `loadTokens()` which reads from disk (`~/.feishu-docs/auth.json`). Tests that set environment variables or write token files can pollute other tests, especially since node:test runs subtests concurrently by default within a `describe` block.

**Why it happens:** The existing `scope-prompt.test.ts` already demonstrates the env save/restore pattern, but it only handles one variable. `resolveAuth()` depends on three env vars plus a file on disk. Forgetting to restore even one variable causes cascade failures. Worse, if tests write to the real `~/.feishu-docs/auth.json`, they corrupt the developer's actual credentials.

**Consequences:** Developer's real OAuth tokens get overwritten or deleted during test runs. Tests become order-dependent. CI environments behave differently from local because env vars differ.

**Prevention:**
1. **Never touch the real config directory in tests.** Override `CONFIG_DIR` for tests -- this requires either:
   - Extracting `CONFIG_DIR` as a parameter (dependency injection), or
   - Using a test-specific `HOME` environment variable (`process.env.HOME = tmpDir`) so that `homedir()` returns a temp path.
2. **Create a `withCleanEnv()` helper** that saves and restores all relevant env vars atomically:
   ```typescript
   function withCleanEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
     const saved: Record<string, string | undefined> = {};
     for (const key of Object.keys(vars)) {
       saved[key] = process.env[key];
       if (vars[key] === undefined) delete process.env[key];
       else process.env[key] = vars[key];
     }
     try { return fn(); }
     finally {
       for (const [key, val] of Object.entries(saved)) {
         if (val === undefined) delete process.env[key];
         else process.env[key] = val;
       }
     }
   }
   ```
3. **Use `{ concurrency: 1 }` on describe blocks** that mutate `process.env` to prevent parallel subtests from racing.

**Detection:** If `npm test` occasionally fails with `AUTH_REQUIRED` or `TOKEN_EXPIRED` errors in unrelated test files, env pollution is the likely cause.

**Phase mapping:** Address in the first testing phase, as part of establishing test helpers/fixtures.

**Confidence:** HIGH -- directly derived from analyzing `resolveAuth()` source and existing env mock patterns.

---

### Pitfall 5: Coverage Measurement Broken with tsx + c8/V8 Coverage

**What goes wrong:** The project uses `tsx` to run TypeScript tests directly. When attempting to measure code coverage with either `c8` or `--experimental-test-coverage`, the results are wildly incorrect. Specifically:
- `tsx >= 4.3.0` with `c8` reports [100% coverage for all imported files](https://github.com/privatenumber/tsx/issues/433) due to source map handling bugs.
- `--experimental-test-coverage` with tsx produces incorrect line numbers or "Could not report code coverage" warnings.

**Why it happens:** tsx transforms TypeScript to JavaScript on-the-fly using esbuild. V8's built-in coverage tracks the executed JavaScript, but the source maps that map back to TypeScript are generated differently by tsx than by tsc. This mapping mismatch causes coverage tools to either lose precision or report incorrect data.

**Consequences:** The project's 80% coverage target becomes unmeasurable or gives false confidence. Developers believe critical paths are covered when they are not.

**Prevention:**
1. **Measure coverage against compiled output, not tsx-transformed code.** Run `tsc` first, then use `c8 node --test dist/**/*.test.js` or Node's built-in `--experimental-test-coverage`. Map results back to TypeScript via the `.map` files that `tsc` generates (project already has `sourceMap: true` in tsconfig).
2. Alternatively, **pin tsx to a known-good version** (4.2.1 was last confirmed working with c8) for coverage runs only.
3. As a pragmatic middle ground, **run coverage checks in CI against the compiled JS output** while keeping `tsx --test` as the fast development feedback loop.
4. The tsconfig already excludes `test/` from compilation. For the coverage build, use a separate `tsconfig.test.json` that includes both `src/` and `test/`.

**Detection:** Run `c8 tsx --test test/*.test.ts` and check if any untested file shows >90% coverage. If it does, the coverage data is unreliable.

**Phase mapping:** Set up the coverage measurement pipeline early (Phase 1). Do not defer this to "after tests are written" or you will not know if you are hitting the 80% target.

**Confidence:** HIGH -- [confirmed tsx issue](https://github.com/privatenumber/tsx/issues/433), [Node.js coverage + tsx instability documented](https://github.com/nodejs/help/issues/4325).

---

## Moderate Pitfalls

### Pitfall 6: Breaking ESM Import Paths During Module Extraction

**What goes wrong:** When splitting `blocks-to-md.ts` into a dispatch table with per-block-type renderers, or extracting `doc-enrichment.ts` from `read.ts`, developers forget that ESM requires explicit `.js` extensions in import paths. Moving a function from `parser/blocks-to-md.ts` to `parser/renderers/text-renderer.ts` requires updating all import paths -- and the new file must be imported with `.js` extension even though the source is `.ts`.

**Why it happens:** TypeScript's `moduleResolution: "NodeNext"` enforces `.js` extensions at compile time, but developers coming from bundler-based workflows (Vite, webpack) are not used to this. Also, re-exports from barrel files can mask broken paths until runtime.

**Prevention:**
1. Run `npm run build:check` (which is `tsc --noEmit`) after every file move. The existing pretest hook already does this -- make sure to not skip it.
2. Keep the project's convention of no barrel files (except `types/index.ts`). Barrel re-exports can hide broken imports behind a working barrel.
3. When extracting functions, do it in two steps: (a) add the new file with the function, update imports in the original file to re-export from the new location, verify tests pass; (b) update callers to import from the new location directly, remove re-export.

**Detection:** `tsc --noEmit` fails with `Cannot find module` errors. This is caught by the pretest hook, so it should never reach CI if developers run `npm test`.

**Phase mapping:** Relevant during the refactoring phase (after test coverage is in place).

---

### Pitfall 7: Testing Encrypted Token Persistence Without Mocking Crypto

**What goes wrong:** `encrypt()`/`decrypt()` in `auth.ts` derive keys from `hostname() + userInfo().username`. Tests that call `saveTokens()`/`loadTokens()` will produce machine-specific encrypted data. A token saved in CI will not decrypt on a developer's machine, and vice versa. Tests that hardcode expected encrypted values will fail on every machine except the one that generated them.

**Why it happens:** The encryption is deterministic per-machine but varies across machines. Developers write tests locally, commit expected values, and CI fails.

**Prevention:**
1. **Test the round-trip, not specific encrypted bytes.** Call `saveTokens()` then `loadTokens()` and assert the decrypted output matches the input. Never assert the encrypted string content.
2. **Use a temp directory** for the auth file (override `HOME` or inject the config path) so tests do not touch real credentials.
3. Test `encrypt()`/`decrypt()` as a pair: `assert.deepEqual(decrypt(encrypt(data)), data)`. This verifies correctness without depending on specific crypto output.
4. For error paths (malformed encrypted data, wrong key), construct invalid encrypted strings manually.

**Detection:** Test passes locally but fails in CI with "Malformed encrypted data" or crypto decryption errors.

**Phase mapping:** Auth testing phase.

---

### Pitfall 8: `node:test` Subtests Run Concurrently by Default

**What goes wrong:** Within a `describe` block, individual `it` tests can run concurrently (node:test's default behavior). Tests that mutate `globalThis.fetch` or `process.env` in `beforeEach`/`afterEach` can race against each other. Test A sets `process.env.FEISHU_APP_ID = "test-a"`, test B sets it to `"test-b"`, and both read an unpredictable value.

**Why it happens:** Unlike Jest (which runs tests sequentially within a file by default), node:test defaults to concurrent execution of subtests. The `{ concurrency: N }` option on `describe`/`it` controls this, but developers unaware of the default write tests assuming sequential execution.

**Prevention:**
1. For any `describe` block that mutates global state (env vars, `globalThis.fetch`, `process.stdin.isTTY`), pass `{ concurrency: 1 }`:
   ```typescript
   describe("resolveAuth", { concurrency: 1 }, () => { ... });
   ```
2. Alternatively, use the `--test-concurrency=1` CLI flag for the entire test run, accepting slower execution for deterministic results.
3. For test files that do NOT touch global state (pure function tests), leave the default concurrency for speed.

**Detection:** Tests that pass 9 out of 10 times. Failures mention unexpected env var values or fetch responses.

**Phase mapping:** Establish as convention in Phase 1 testing setup.

**Confidence:** HIGH -- [documented in Node.js test runner docs](https://nodejs.org/api/test.html).

---

### Pitfall 9: Timer Leaks from `AbortController` + `setTimeout` in `fetchWithAuth`

**What goes wrong:** `fetchWithAuth` and `fetchBinaryWithAuth` both create `setTimeout` for 30s/60s request timeouts. In tests, if the mock `fetch` resolves immediately, the `clearTimeout` in the `finally` block runs correctly. But if a test throws before reaching `clearTimeout` (e.g., assertion failure in the middle of an async test), the timer leaks. node:test detects this as "asynchronous activity outliving the test" and may report warnings or cause tests to hang.

**Why it happens:** The `try/finally` block in the source code handles `clearTimeout`, but test failures can abort the test function before the `finally` block of the **test** completes the full assertion sequence. The underlying `setTimeout` from the production code is still ticking.

**Prevention:**
1. In mock setups, ensure the mock `fetch` resolves synchronously (no actual network delay). This keeps the timeout irrelevant.
2. If testing timeout behavior specifically, use `mock.timers` from node:test to control `setTimeout` without real delays.
3. Add a global `afterEach` that verifies no pending timers (node:test does not provide this natively, but you can track it manually if creating wrappers around `setTimeout`).

**Detection:** `npm test` occasionally prints warnings about async activity after test completion, or tests take unexpectedly long.

**Phase mapping:** Relevant when testing `fetchWithAuth` and `createClient` (client testing phase).

---

### Pitfall 10: Testing Command Handlers That Write to `process.stdout`/`process.stderr`

**What goes wrong:** All command handlers write output via `process.stdout.write()` and `process.stderr.write()`. To test command output, you need to capture these writes. Naively replacing `process.stdout.write` is fragile because node:test itself writes to stdout for test reporting. Capturing stdout during a test interferes with the test runner's output.

**Why it happens:** The CLI convention of `process.stdout.write()` (not `console.log()`) is correct for production but makes testing harder. Unlike `console.log` which can be mocked via `mock.method(console, "log")`, `process.stdout.write` is the underlying stream and the test runner depends on it.

**Prevention:**
1. **Extract an output abstraction.** Create a thin `Writer` interface (`{ write(s: string): void }`) that defaults to `process.stdout` in production but can be replaced with a buffer in tests:
   ```typescript
   interface Output { stdout: (s: string) => void; stderr: (s: string) => void; }
   ```
2. Alternatively, **redirect output at the command handler level.** Have handlers return their output as a string rather than writing it directly, with a thin wrapper at the CLI entry point that writes the string.
3. As a quick workaround, use `mock.method(process.stdout, "write")` from node:test's mock API, then inspect `mock.calls`. This works because node:test's reporter typically uses a different fd or has already written its output by the time afterEach runs.

**Detection:** If test output becomes garbled or test runner reports disappear, stdout interception is conflicting with the runner.

**Phase mapping:** Decide the output capture pattern before writing command handler integration tests.

---

## Minor Pitfalls

### Pitfall 11: TypeScript `strict: true` Catching New Issues During Refactoring

**What goes wrong:** Moving code between files can expose new strict-mode errors that were previously masked. For example, a function in `read.ts` might use `as Record<string, unknown>` assertions that are valid in context but become errors when the function is extracted to a separate file that does not import the same types.

**Prevention:** Run `tsc --noEmit` after every file move (already enforced by pretest hook). Do not suppress new errors with additional `as` casts -- instead, define proper types for the extracted function's inputs and outputs.

**Phase mapping:** Refactoring phase.

---

### Pitfall 12: `assert.deepEqual` vs `assert.deepStrictEqual` Confusion

**What goes wrong:** The codebase uses `node:assert/strict` which makes `assert.deepEqual` behave like `assert.deepStrictEqual`. Developers familiar with the non-strict module may expect loose comparison and write tests that pass when they should fail (e.g., comparing `"0"` with `0`).

**Prevention:** The project already imports from `node:assert/strict` -- maintain this convention. Document in test guidelines that `deepEqual` under strict mode is strict.

**Phase mapping:** Phase 1 test conventions.

---

### Pitfall 13: Shared Test Factories Drift from Production Types

**What goes wrong:** Test factory functions like `makeBlocks()`, `textBlock()`, `headingBlock()` in `blocks-to-md.test.ts` construct block objects by hand. When the `Block` type in `types/index.ts` gains new required fields (e.g., during the "typed API responses" refactoring), the factory functions produce invalid objects that TypeScript does not catch because tests are excluded from `tsconfig.json` compilation.

**Why it happens:** `tsconfig.json` has `"exclude": ["test"]`, so TypeScript does not type-check test files during `tsc --noEmit`. The `tsx` runner does type-erasure (not full type-checking) when running tests, so type mismatches in test code are invisible.

**Prevention:**
1. The existing `pretest` hook runs `tsc --noEmit` which only checks `src/`. Consider adding a `tsconfig.test.json` that extends the base config and includes `test/` for type-checking test files.
2. Alternatively, use `import type { Block }` in factory functions and annotate return types explicitly so that tsx at least catches gross mismatches.
3. When modifying types in `types/index.ts`, always search test files for the affected type name and update factories.

**Detection:** Tests pass but test objects do not match the actual runtime shape. Integration tests fail with puzzling "property is undefined" errors.

**Phase mapping:** Phase 1 test infrastructure.

---

### Pitfall 14: `process.exit()` in Error Handling Short-Circuits Test Runner

**What goes wrong:** If any code path in the CLI calls `process.exit()` during a test, the entire test runner terminates immediately. The CLI's `run()` function in `cli.ts` may call `process.exit(code)` on unhandled errors. If a command handler integration test triggers this path, the test suite dies.

**Prevention:**
1. Check if `cli.ts` calls `process.exit()` directly. If so, refactor to throw a `CliError` instead, with the exit code encoded in the error. The CLI entry point (`bin/feishu-docs.js`) should be the only place that calls `process.exit()`.
2. In tests, mock `process.exit` to throw an error instead of actually exiting:
   ```typescript
   mock.method(process, "exit", (code: number) => { throw new Error(`exit:${code}`); });
   ```

**Detection:** Test suite terminates abruptly with no summary output.

**Phase mapping:** Verify before writing command handler integration tests.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Test infrastructure setup | Coverage measurement broken with tsx (#5) | Set up tsc-based coverage pipeline immediately |
| Test infrastructure setup | Subtest concurrency races (#8) | Establish `{ concurrency: 1 }` convention for state-mutating tests |
| Test infrastructure setup | Test types not checked (#13) | Create `tsconfig.test.json` that includes test files |
| API client tests (`fetchWithAuth`, `createClient`) | ESM module cache collisions (#2) | Standardize globalThis.fetch mock pattern, avoid dynamic imports |
| API client tests | Timer leaks from AbortController (#9) | Mock fetch to resolve immediately, no real timers |
| Auth module tests (`resolveAuth`, token persistence) | Env var pollution (#4) | Create `withCleanEnv()` helper, use `{ concurrency: 1 }` |
| Auth module tests | Machine-specific encryption (#7) | Test round-trips only, use temp directories |
| Command handler integration tests | stdout capture conflicts (#10) | Extract output abstraction or use mock.method |
| Command handler integration tests | process.exit kills runner (#14) | Ensure exit only happens in bin entry point |
| Refactoring (blocks-to-md split) | Refactoring without tests (#1) | Tests must land and pass BEFORE any extraction begins |
| Refactoring (read.ts split) | ESM import path breakage (#6) | Two-step extraction, run tsc --noEmit after each move |
| Refactoring (typed API responses) | Factory functions drift (#13) | Update test factories when types change |
| node:test feature selection | mock.module() is experimental (#3) | Do not use; stick to globalThis mocking and DI |

## Sources

- [Node.js Test Runner Documentation](https://nodejs.org/api/test.html) -- stable runner, experimental mock.module
- [Node.js mock.module issue #55891](https://github.com/nodejs/node/issues/55891) -- experimental module mocking bugs
- [tsx + c8 coverage bug #433](https://github.com/privatenumber/tsx/issues/433) -- 100% false coverage with tsx >= 4.3.0
- [Node.js help: coverage with tsx #4325](https://github.com/nodejs/help/issues/4325) -- coverage + tsx instability
- [ESM cache invalidation #1399](https://github.com/nodejs/help/issues/1399) -- no public API to clear ESM module cache
- [ESM bypass cache](https://futurestud.io/tutorials/node-js-esm-bypass-cache-for-dynamic-imports) -- query-string cache busting
- [Node.js test isolation modes #55939](https://github.com/nodejs/node/issues/55939) -- concurrency vs isolation
- [Auth0: Refactoring by Breaking Functions Apart](https://auth0.com/blog/refactoring-breaking-functions-apart-typescript/) -- safe extraction patterns

---

*Pitfalls analysis: 2026-03-26*
