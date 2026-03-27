# Phase 5: 健壮性增强 - Research

**Researched:** 2026-03-27
**Domain:** API retry logic, cache eviction, QPS optimization, dead code detection
**Confidence:** HIGH

## Summary

Phase 5 adds runtime robustness to the CLI: (1) automatic retry with exponential backoff for transient API failures in `fetchWithAuth`/`fetchBinaryWithAuth`, (2) TTL-based image cache eviction at 30 days, (3) QPS delay optimization for `clearDocument`, and (4) knip dead code detection integration. All four requirements are well-scoped modifications to existing code with clear integration points and established test patterns from prior phases.

The retry logic is the most complex piece -- it requires a shared `withRetry` utility function, FetchOptions type extension, Retry-After header parsing for 429 responses, and stderr info messages. The cache eviction follows the existing `rotateBackups` pattern closely. QPS optimization is a single constant change. Knip integration is a devDependency installation + configuration + script addition.

**Primary recommendation:** Implement retry as a standalone `src/utils/retry.ts` utility with a `withRetry<T>()` higher-order function, following the same pattern as the existing `src/utils/concurrency.ts` pLimit utility. This keeps the retry logic testable in isolation and the fetchWithAuth/fetchBinaryWithAuth changes minimal.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Retry logic embedded inside `fetchWithAuth` as transparent middleware. Callers unaware of retries. Only triggers on: HTTP 429, 502, 503, AbortError (timeout).
- **D-02:** Max 2 retries (3 total attempts). Exponential backoff: initial 1s, factor 2, max 10s, jitter +/-25%.
- **D-03:** Retry params via `FetchOptions` extension: `retry?: { maxRetries?: number; initialDelay?: number; maxDelay?: number } | false`. Defaults enabled.
- **D-04:** `fetchBinaryWithAuth` also gets retry logic, sharing retry utility to avoid duplication.
- **D-05:** Each retry logs to stderr: `feishu-docs: info: API 请求失败（{reason}），第 {n} 次重试...`
- **D-06:** 429 Retry-After header takes priority (cap 30s), else use exponential backoff.
- **D-07:** Cache cleaning triggered in `downloadImages()`, async fire-and-forget (`void cleanExpiredImages(dir)`).
- **D-08:** TTL based on file `mtime`, 30-day threshold. Constant `IMAGE_TTL_MS`.
- **D-09:** Cleaning failures emit stderr warning, never block main flow. Log count of cleaned files.
- **D-10:** `cleanExpiredImages(dir)` exported for testing.
- **D-11:** `QPS_DELAY` reduced from 400ms to 200ms, leveraging ROB-01 retry for 429 safety.
- **D-12:** `QPS_DELAY` remains exported module-level constant.
- **D-13:** knip installed as devDependency, `knip.json` with entry points `src/cli.ts` and `bin/feishu-docs.js`.
- **D-14:** `lint:dead-code` script in package.json runs `knip`. Fix real dead code, ignore false positives in knip.json.
- **D-15:** knip targets: unused exports, unused files, unused devDependencies.
- **D-16:** Retry tests: 429/502/503 auto-retry + success, all retries fail -> last error, retry=false disables, Retry-After header priority, maxRetries honored.
- **D-17:** Cache eviction tests: expired files deleted, fresh files kept, empty dir no error, permission error graceful.
- **D-18:** QPS delay test: verify clearDocument uses 200ms.
- **D-19:** All 415+ existing tests pass, coverage >= 83.70%.

### Claude's Discretion
- Internal implementation details of retry utility (whether standalone `src/utils/retry.ts`)
- knip.json specific ignore rules (based on actual detection results)
- Cache cleanup traversal implementation
- Test case organization and naming

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROB-01 | fetchWithAuth configurable retry (exponential backoff + jitter, 429/502/503/timeout only) | withRetry utility pattern, FetchOptions type extension, Retry-After header parsing, existing CliError.retryable flag |
| ROB-02 | Image cache TTL eviction (30 days max) | rotateBackups pattern for fs traversal + cleanup, async fire-and-forget, mtime-based age check |
| ROB-03 | Optimize clearDocument QPS delay parameter | Single constant change from 400ms to 200ms, existing test coverage for clearDocument with mock.timers |
| ROB-04 | knip dead code detection integration | knip 6.0.6 as devDependency, knip.json config, lint:dead-code script |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Zero production dependencies** -- knip is devDependency only, retry logic uses zero external libraries
- **Node.js built-in only** -- retry uses `setTimeout` (already used via `sleep()` in block-writer.ts)
- **node:test + assert/strict** -- all new tests use existing test framework
- **API compatibility** -- no CLI interface changes, retry is transparent to callers
- **Backward compatibility** -- all 415 existing tests must continue passing
- **Immutability** -- new objects, never mutate existing ones (per coding-style rules)
- **File organization** -- retry utility as separate small file (~60-80 lines), consistent with concurrency.ts pattern
- **ESM imports** -- `.js` extension, `node:` protocol prefix for built-ins

## Standard Stack

### Core (No New Production Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `setTimeout` | N/A | Retry delay implementation | Zero-dependency constraint; already used in block-writer.ts `sleep()` |
| Node.js `node:fs/promises` | N/A | Cache file stat + unlink for eviction | Already used in image-download.ts and block-writer.ts |

### Supporting (DevDependencies Only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| knip | ^6.0.6 | Dead code detection | `npm run lint:dead-code` during development |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom withRetry | p-retry npm package | Violates zero-dependency constraint |
| knip | ts-prune | ts-prune is in maintenance mode, knip is its successor |
| File mtime TTL | LRU cache with size limit | mtime simpler, no state tracking needed |

**Installation:**
```bash
npm install --save-dev knip@^6.0.6
```

**Version verification:** knip 6.0.6 confirmed as latest via `npm view knip version` (2026-03-27).

## Architecture Patterns

### Recommended File Structure
```
src/
  utils/
    retry.ts           # NEW: withRetry<T>() utility (ROB-01)
    concurrency.ts     # EXISTING: pLimit pattern to follow
    errors.ts          # EXISTING: CliError with retryable flag
  client.ts            # MODIFIED: fetchWithAuth/fetchBinaryWithAuth use withRetry
  types/
    index.ts           # MODIFIED: FetchOptions gains retry option
  services/
    image-download.ts  # MODIFIED: downloadImages triggers cleanExpiredImages
    block-writer.ts    # MODIFIED: QPS_DELAY 400->200
knip.json              # NEW: dead code detection config
```

### Pattern 1: withRetry Higher-Order Function
**What:** A generic retry wrapper that takes an async function and retry options, returns the result or throws the last error after exhausting retries.
**When to use:** Wrapping `fetch()` calls inside `fetchWithAuth` and `fetchBinaryWithAuth`.
**Example:**
```typescript
// src/utils/retry.ts
export interface RetryOptions {
  maxRetries: number;      // default: 2
  initialDelay: number;    // default: 1000 (ms)
  maxDelay: number;        // default: 10000 (ms)
}

export const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 2,
  initialDelay: 1000,
  maxDelay: 10_000,
};

/**
 * Calculate delay with exponential backoff and jitter (+/-25%).
 */
export function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
): number {
  const base = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
  const jitter = base * 0.25 * (2 * Math.random() - 1); // +/-25%
  return Math.max(0, base + jitter);
}

/**
 * Parse Retry-After header value (seconds only, cap at 30s).
 * Returns null if header is absent or unparseable.
 */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30_000); // cap at 30s, convert to ms
  }
  return null;
}

/**
 * Determine if an error/response is retryable.
 */
export function isRetryableStatusOrError(
  statusOrError: number | string,
): boolean {
  if (typeof statusOrError === "number") {
    return statusOrError === 429 || statusOrError === 502 || statusOrError === 503;
  }
  return statusOrError === "AbortError";
}
```

### Pattern 2: Transparent Retry in fetchWithAuth
**What:** fetchWithAuth wraps the actual `fetch()` call with retry logic, checking HTTP status codes before JSON parsing for retryable statuses.
**When to use:** Inside fetchWithAuth and fetchBinaryWithAuth.
**Key insight:** For 429/502/503, the retry must happen BEFORE the existing error mapping logic. The retry wraps the raw fetch call and checks `res.status` before proceeding to `res.json()` and error mapping.
**Example:**
```typescript
// In fetchWithAuth, the retry loop wraps the fetch() call:
// 1. Call fetch()
// 2. If response status is 429/502/503 and retries remain -> wait and retry
// 3. If AbortError caught and retries remain -> wait and retry
// 4. After max retries exhausted, proceed to normal error handling
```

### Pattern 3: Fire-and-Forget Cache Cleanup
**What:** Trigger async cleanup without awaiting, similar to how error logging works.
**When to use:** In `downloadImages()` after mkdir, before the download loop.
**Example:**
```typescript
// In downloadImages():
await mkdir(dir, { recursive: true });
void cleanExpiredImages(dir); // fire-and-forget, errors caught internally
```

### Anti-Patterns to Avoid
- **Mutating FetchOptions:** Never modify the options object passed in; create new objects with spread operator.
- **Retrying non-transient errors:** Only retry 429/502/503/AbortError. Never retry 401/403/404 or business logic errors.
- **Blocking on cache cleanup:** Never `await` the cleanup in the download path; it must be fire-and-forget.
- **Shared mutable state in retry:** Each retry attempt must create a fresh AbortController and timeout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dead code detection | Custom AST analysis | knip (devDependency) | Understands TS module graph, plugins for common tools |
| Jitter calculation | Fixed delay multiplier | Standard exponential backoff + random jitter formula | Well-studied algorithm, prevents thundering herd |

**Key insight:** The retry utility is small enough (~60-80 lines) to implement from scratch with zero dependencies, matching the project's concurrency.ts pattern. knip is the only tool that requires installation.

## Common Pitfalls

### Pitfall 1: Retry-After Header Parsing
**What goes wrong:** The `Retry-After` header can be either seconds (integer string) or an HTTP date string. Parsing as a date when it's actually seconds, or vice versa.
**Why it happens:** HTTP spec allows both formats.
**How to avoid:** Per D-06, only handle the seconds format (integer string). CLI scenarios with Feishu API only use seconds. Cap at 30 seconds to prevent unreasonable waits.
**Warning signs:** `Number(headerValue)` returning NaN means it's likely a date string -- treat as absent and fall back to exponential backoff.

### Pitfall 2: AbortController Reuse Across Retries
**What goes wrong:** Reusing the same AbortController for retry attempts means a timeout from the first attempt aborts subsequent attempts immediately.
**Why it happens:** AbortController is single-use -- once aborted, its signal stays aborted forever.
**How to avoid:** Create a fresh AbortController for each retry attempt inside the retry loop.
**Warning signs:** Retries failing instantly after the first timeout.

### Pitfall 3: Mock Timer Deadlock in Retry Tests
**What goes wrong:** Tests using `mock.timers` with retry logic deadlock because the test awaits the retry function, which awaits setTimeout, but mock timers need to be ticked.
**Why it happens:** `mock.timers.enable({ apis: ["setTimeout"] })` intercepts setTimeout so it never fires without explicit `tick()`.
**How to avoid:** Use the existing `resolveWithTimers()` pattern from block-writer.test.ts -- it uses real setInterval to periodically tick mock timers while the promise resolves.
**Warning signs:** Test hanging indefinitely.

### Pitfall 4: Race Condition in Fire-and-Forget Cleanup
**What goes wrong:** If `downloadImages` returns before `cleanExpiredImages` finishes, test assertions may check directory state before cleanup completes.
**Why it happens:** `void cleanExpiredImages(dir)` is intentionally not awaited in production.
**How to avoid:** Test `cleanExpiredImages` directly (it's exported per D-10), not through `downloadImages`. For integration tests of downloadImages, don't assert cleanup behavior.
**Warning signs:** Flaky tests that sometimes see cleaned files and sometimes don't.

### Pitfall 5: knip False Positives on Test-Only Types
**What goes wrong:** knip reports types in `src/types/index.ts` as unused because they're only imported by test files.
**Why it happens:** Default knip config doesn't include test files as entry points.
**How to avoid:** Add test entry points to knip.json: `"entry": ["src/cli.ts", "bin/feishu-docs.js", "test/**/*.test.ts"]` or use the `ignoreDependencies` / `ignoreExportsUsedInFile` options.
**Warning signs:** knip reporting `TextElement`, `Block`, or factory helper types as unused.

### Pitfall 6: fetchBinaryWithAuth Error Path Differences
**What goes wrong:** `fetchBinaryWithAuth` checks `res.ok` and handles JSON error bodies differently from `fetchWithAuth`. Retry logic must handle both the "response received but status bad" case and the "fetch threw" case.
**Why it happens:** Binary endpoint returns non-JSON for success but JSON for errors.
**How to avoid:** For fetchBinaryWithAuth, retry should check `res.status` (429/502/503) before the `res.ok` check, and also catch AbortError in the fetch call.
**Warning signs:** Binary downloads not retrying on 502/503 because the existing `!res.ok` branch throws before retry logic can intervene.

## Code Examples

### withRetry Utility Integration in fetchWithAuth
```typescript
// src/client.ts - modified fetchWithAuth (conceptual)
export async function fetchWithAuth<T = unknown>(
  authInfo: AuthInfo,
  path: string,
  options: FetchOptions = {},
): Promise<ApiResponse<T>> {
  const base = getApiBase(authInfo);
  const bearer = await resolveBearer(authInfo);
  const url = new URL(path, base);
  // ... existing param handling ...

  const retryOpts = options.retry === false
    ? { maxRetries: 0 }
    : { ...DEFAULT_RETRY, ...options.retry };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retryOpts.maxRetries; attempt++) {
    const controller = new AbortController(); // Fresh per attempt
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url.toString(), {
        ...fetchOpts,
        signal: controller.signal,
      });

      // Check for retryable HTTP status BEFORE parsing body
      if (isRetryableStatusOrError(res.status) && attempt < retryOpts.maxRetries) {
        const retryAfterMs = res.status === 429
          ? parseRetryAfter(res.headers.get("Retry-After"))
          : null;
        const delay = retryAfterMs ?? calculateDelay(attempt, retryOpts.initialDelay, retryOpts.maxDelay);
        process.stderr.write(
          `feishu-docs: info: API 请求失败（HTTP ${res.status}），第 ${attempt + 1} 次重试...\n`
        );
        await sleep(delay);
        continue;
      }

      // Normal path: parse JSON and handle errors
      clearTimeout(timeoutId);
      const body = (await res.json()) as ApiResponse<T>;
      // ... existing error handling ...
      return body;
    } catch (err) {
      clearTimeout(timeoutId);
      const error = err as Error;
      if (error.name === "AbortError" && attempt < retryOpts.maxRetries) {
        process.stderr.write(
          `feishu-docs: info: API 请求失败（超时），第 ${attempt + 1} 次重试...\n`
        );
        const delay = calculateDelay(attempt, retryOpts.initialDelay, retryOpts.maxDelay);
        await sleep(delay);
        lastError = err;
        continue;
      }
      // Not retryable or retries exhausted
      if (error.name === "AbortError") {
        throw new CliError("API_ERROR", "API 请求超时（30秒）", { retryable: true });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  // All retries exhausted -- throw last error
  throw lastError;
}
```

### FetchOptions Type Extension
```typescript
// src/types/index.ts - addition to FetchOptions
export interface RetryConfig {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
}

export interface FetchOptions {
  method?: string;
  params?: Record<string, string | number | string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: RetryConfig | false;  // NEW: retry configuration
}
```

### cleanExpiredImages Implementation
```typescript
// src/services/image-download.ts - new function
import { readdir, stat, unlink } from "node:fs/promises";

export const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function cleanExpiredImages(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      try {
        const filePath = join(dir, file);
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > IMAGE_TTL_MS) {
          await unlink(filePath);
          cleaned++;
        }
      } catch {
        // Individual file cleanup failure -- skip
      }
    }

    if (cleaned > 0) {
      process.stderr.write(
        `feishu-docs: info: 已清理 ${cleaned} 个过期图片缓存\n`,
      );
    }
  } catch {
    process.stderr.write(
      "feishu-docs: warning: 图片缓存清理失败\n",
    );
  }
}
```

### knip.json Configuration
```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": ["src/cli.ts", "bin/feishu-docs.js"],
  "project": ["src/**/*.ts"],
  "ignore": ["dist/**"],
  "ignoreDependencies": ["@types/node"]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-prune for dead code | knip (successor) | 2023 | ts-prune maintenance mode, knip is actively maintained |
| Fixed retry delays | Exponential backoff + jitter | Well-established | Prevents thundering herd, standard for API clients |
| No cache eviction | mtime-based TTL | Common pattern | Prevents unbounded disk growth |

**Deprecated/outdated:**
- ts-prune: Deprecated in favor of knip. Do not use.

## Open Questions

1. **knip False Positive Scope**
   - What we know: knip may flag types only used in tests, or the `bin/feishu-docs.js` entry may not resolve correctly with ESM.
   - What's unclear: Exact set of false positives until first run.
   - Recommendation: Run knip after installation, review results, add ignores iteratively. This is explicitly in Claude's discretion.

2. **fetchBinaryWithAuth Retry Architecture**
   - What we know: fetchBinaryWithAuth has different error handling (checks res.ok, reads JSON error body for non-OK responses).
   - What's unclear: Whether to inline retry logic or extract a shared helper that both functions call.
   - Recommendation: Extract retry delay calculation to `src/utils/retry.ts`, but inline the retry loop in each function since their error handling paths differ significantly. Share `calculateDelay`, `parseRetryAfter`, and `isRetryableStatusOrError`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | Yes | v24.5.0 | -- |
| npm | ROB-04 (knip install) | Yes | 11.5.1 | -- |
| knip | ROB-04 | Not yet installed | 6.0.6 (latest) | Install as devDep |
| tsx | Tests | Yes | ^4.21.0 | -- |
| c8 | Coverage | Yes | ^11.0.0 | -- |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:**
- knip: Not installed yet, will be added as devDependency in ROB-04

## Sources

### Primary (HIGH confidence)
- Project source code: `src/client.ts`, `src/services/image-download.ts`, `src/services/block-writer.ts`, `src/types/index.ts` -- direct inspection
- Project test infrastructure: `test/helpers/mock-fetch.ts`, `test/block-writer.test.ts` -- established patterns
- npm registry: `npm view knip version` returned 6.0.6 (verified 2026-03-27)

### Secondary (MEDIUM confidence)
- [knip official documentation](https://knip.dev/) -- configuration reference and overview
- [knip configuration reference](https://knip.dev/reference/configuration) -- entry, project, ignore patterns
- Project CONTEXT.md decisions (D-01 through D-19) -- locked implementation decisions

### Tertiary (LOW confidence)
- None -- all findings verified through primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new production deps, knip version verified against registry
- Architecture: HIGH -- all integration points inspected in source code, patterns follow existing codebase conventions (concurrency.ts, rotateBackups)
- Pitfalls: HIGH -- identified from direct code inspection (AbortController reuse, mock timer deadlock from existing test patterns, fetchBinaryWithAuth error path differences)

**Current test baseline:**
- Tests: 415 passing, 0 failing
- Coverage: 84.28% lines / 74.19% branches / 86.72% functions
- Threshold: 80% line / 70% branch / 80% function (all passing)

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable domain, no fast-moving dependencies)
