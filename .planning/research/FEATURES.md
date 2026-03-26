# Feature Landscape: Quality Hardening

**Domain:** Production CLI tool quality hardening (feishu-docs-cli)
**Researched:** 2026-03-26

## Table Stakes

Features users and maintainers expect from a production-quality CLI tool. Missing any of these means the tool is not safe to refactor, extend, or operate in CI/CD pipelines.

### Testing

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Critical path unit tests (auth, client, commands) | Without tests on the auth chain and API client, any refactoring silently breaks the tool. 15 test files exist but skip the most important paths: `fetchWithAuth`, `resolveAuth`, `createClient`, and all 18 command handlers. | High | Largest effort item. Must precede all refactoring. node:test + assert/strict is already established. |
| Integration tests for command handlers | Commands contain the application's business logic. CONCERNS.md explicitly flags all 18 handlers as untested. A command handler test mocks `fetchWithAuth` and verifies the full pipeline: input validation -> API call shape -> output format. | High | Use `node:test` mock module (`t.mock.method`) to stub the client layer. Test both `--json` and human-readable output modes. |
| `resolveAuth` multi-mode test suite | The auto-mode fallback chain (env var -> saved tokens -> app credentials) is the most security-critical path with zero test coverage. | Medium | Test each fallback step in isolation. Mock `process.env`, filesystem reads. |
| Token encrypt/decrypt round-trip tests | AES-256-GCM encryption is used for credential storage. Untested crypto code is a liability. | Low | Pure function, easy to test. Verify round-trip and tamper detection (wrong key / corrupted ciphertext). |
| `clearDocument` backup/restore pipeline tests | Destructive write operations (overwrite mode) rely on backup-then-clear-then-write-or-restore. No test verifies this sequence. | Medium | Mock the API layer. Verify backup creation, batch delete, and restore-on-failure. |
| `document-resolver` fallback behavior tests | Silent fallback from unknown tokens to docx type can cause operations on wrong documents. Only 58 lines of test coverage. | Low | Test `allowFallback: true` vs `false`, Wiki token resolution failure paths. |
| Code coverage gate at 80% | Industry standard for production codebases. node:test supports `--experimental-test-coverage` with `--test-coverage-lines`, `--test-coverage-branches`, `--test-coverage-functions` thresholds. | Low | Add `"test:coverage"` script to package.json. Use `--test-coverage-lines=80`. |

### Error Handling

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Consistent CliError usage across all error paths | Already well-established pattern with `CliError(type, message, options)`. All command handlers should throw CliError, never raw Error. | Low | Audit existing code. Most paths already comply. |
| Structured JSON error output for machine consumers | `--json` mode already outputs `{ success: false, error: { type, message, ... } }`. Table stakes because AI agents and scripts consume this tool. | Already done | Verify in integration tests that all error paths produce valid JSON when `--json` is set. |
| Recovery hints on all actionable errors | `CliError` supports `recovery` field. Production CLI tools tell users what to do next. | Low | Audit existing errors. Add `recovery` strings where missing (especially auth and permission errors). |
| Non-critical failure graceful degradation | Already implemented: image download, user name resolution failures write warnings to stderr and continue. | Already done | Verify pattern is consistent across all enrichment steps. |

### Security

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Remove token prefix from `whoami` output | CONCERNS.md flags `userToken.slice(0, 10)` exposure. Even partial tokens leak information. Show token type + expiry only. | Low | Single-line change in `src/commands/login.ts`. |
| Content-Security-Policy on OAuth callback HTML | The local OAuth callback server returns HTML. CSP header prevents injection even if an attacker crafts a malicious callback URL. | Low | Add `Content-Security-Policy: default-src 'none'` to the HTTP response headers. |
| Document CI/container credential guidance | Machine-based key derivation breaks in containers (hostname changes). Users need clear docs that CI should use `FEISHU_USER_TOKEN` env var. | Low | Documentation change. Add to README and `--help` for `login` command. |

### Code Quality / Refactoring

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Split `blocks-to-md.ts` (822 lines) into dispatch table | Largest file. Adding new block types means modifying a 458-line if-chain. Extract `Record<BlockType, RenderFn>` dispatch map. Each renderer becomes a standalone function. | Medium | Must be done AFTER test coverage is in place. The existing 658-line test file provides good coverage for regression detection. |
| Extract enrichment logic from `read.ts` (592 lines) | Command file mixes orchestration with data fetching. Extract `fetchBitableData`, `fetchSheetData`, `fetchBoardImage`, `resolveUserNames`, `batchGetTmpUrls` to `src/services/doc-enrichment.ts`. | Medium | Must be done AFTER integration tests for `read` command exist. |
| Typed API response interfaces (gradual) | 74 occurrences of `as Record<string, unknown>` across 21 files. API structure changes silently produce `undefined`. Define `WikiGetNodeResponse`, `DocxBlocksResponse`, etc. | Medium | Do incrementally per-module, not all at once. Start with the most-called endpoints (document blocks, wiki nodes). |
| Parallelize enrichment fetches | Serial `for` loops for bitable/sheet/board data cause linear latency growth. Switch to `Promise.allSettled()`. | Low | Existing per-token error handling already supports partial failure. Drop-in replacement. |

## Differentiators

Features that elevate the tool above "works" to "works well." Not expected by all users, but valued by power users and CI/CD operators.

### Resilience

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Configurable retry with exponential backoff + jitter | `fetchWithAuth` already marks timeout errors as `retryable: true` but never retries. For rate-limited (429) and server-error (502/503) responses, 1-3 retries with exponential backoff + jitter prevents failures during transient issues. Especially important for `cat` which makes many serial API calls. | Medium | Implement as a `retryableFetch` wrapper around `fetchWithAuth`. Default: 2 retries, base delay 1s, max delay 10s, jitter. Only retry on 429/502/503/timeout. Never retry 400/401/403/404. Zero-dependency implementation (no external library). Config via `FEISHU_MAX_RETRIES` env var for CI tuning. |
| Image cache TTL eviction | `~/.feishu-docs/images/` grows unbounded. Add 30-day max-age eviction. Clean up stale images during `read` command execution. | Low | Check `mtime` of cached files. Delete those older than TTL. Run lazily (not on every invocation). |
| Optimized QPS delay for `clearDocument` | Current 400ms delay per batch is conservative. Profile actual Feishu API QPS limits and reduce if possible. | Low | Measure with real API. Reduce delay or make configurable via constant. |

### Developer Experience

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Linting/formatting setup (Biome) | No linter or formatter configured. Biome is fast, zero-config-ish, handles both formatting and linting in one tool. Prevents style drift as contributors increase. | Low | Single dev dependency. Add `biome.json` with the project's existing conventions (2-space indent, double quotes, semicolons). |
| Pre-commit hook for type checking | `npm run build:check` (tsc --noEmit) catches type errors. Adding it as a pre-commit hook prevents broken code from being committed. | Low | Use `package.json` `"prepare"` script or a lightweight hook manager. |
| CI pipeline (GitHub Actions) | Automate `build:check` + `test` + coverage on every PR. Prevents regressions from merging. | Low | Simple workflow file. The project already has a GitHub repo. |

### Observability

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Verbose/debug mode (`--verbose` or `FEISHU_DEBUG`) | When troubleshooting API issues, users need to see request URLs, response codes, and timing. Currently no way to see what API calls the tool makes. | Medium | Add conditional stderr logging in `fetchWithAuth`. Gate behind `--verbose` flag or `FEISHU_DEBUG=1` env var. Output: method, URL path, status code, duration. |

## Anti-Features

Features to explicitly NOT build during this quality hardening milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| `--dry-run` mode | PROJECT.md explicitly lists as out of scope. Requires designing a preview API interaction mode -- high complexity, orthogonal to quality hardening. | Ensure backup/restore pipeline is rock-solid (tested). This is the safety net for destructive operations. |
| E2E test framework | Real API calls in tests require credentials, are slow, flaky, and create real documents. Integration tests with mocked API layer provide sufficient confidence. | Focus on command handler integration tests with mocked `fetchWithAuth`. |
| Jest/Vitest migration | Zero-dependency philosophy extends to test tooling. `node:test` is already established, supports mocking, coverage, and assertions. Switching frameworks adds no value and breaks the convention. | Continue with `node:test` + `assert/strict`. Use `tsx --test` for TypeScript execution. |
| Full typed API responses (all 74 at once) | Bulk type replacement is risky without test coverage. Touching 21 files simultaneously invites regressions. | Type incrementally per-module, starting with the most-called endpoints. |
| External retry library (e.g., `exponential-backoff` npm) | Zero runtime dependencies is a key project constraint and security advantage. The retry logic needed is simple enough to implement in ~50 lines. | Implement a custom `retryableFetch` utility in `src/utils/retry.ts`. |
| `share list` pagination | PROJECT.md explicitly lists as out of scope. Low impact -- most documents have few collaborators. | Leave as-is. |
| Multi-format `read` output | PROJECT.md explicitly lists as out of scope. Markdown output satisfies current needs. | Leave as-is. |
| Image upload support | PROJECT.md explicitly lists as out of scope. Requires Feishu Upload API integration, separate effort. | Leave as-is. |
| TypeScript 6.0 upgrade | Non-critical dev dependency upgrade. Risk of breaking changes in build process. Separate iteration. | Stay on TypeScript 5.9.3. |
| Global backup size limit | CONCERNS.md mentions it but impact is low. Each document already caps at 10 backups. Total growth is proportional to number of unique documents updated. | Defer to future iteration if users report disk usage issues. |
| Shared rate limiter / concurrency pool | Needed for parallel API calls at scale, but premature for this iteration. Current serial execution is safe. | Address when parallelizing `cat` or adding concurrent document processing. |

## Feature Dependencies

```
Code Coverage Gate (80%)
    |
    v
Critical Path Unit Tests -----> Integration Tests for Commands
    |                               |
    v                               v
resolveAuth Tests               read Command Tests
Token Encrypt Tests             create/update Command Tests
fetchWithAuth Tests             delete/share/wiki Command Tests
clearDocument Tests             cat/tree/search Command Tests
document-resolver Tests
    |                               |
    v                               v
[TEST WALL -- all refactoring below requires tests above]
    |
    +---> Split blocks-to-md.ts (dispatch table)
    +---> Extract doc-enrichment.ts from read.ts
    +---> Typed API response interfaces (gradual)
    +---> Parallelize enrichment fetches
    |
    v
Retry Logic (retryableFetch)  [independent, can start after fetchWithAuth tests]
    |
    v
Image Cache TTL               [independent, low priority]
QPS Delay Optimization        [independent, low priority]

Security fixes (whoami, CSP, docs) --> [independent, can be done anytime]
Linting/CI setup              --> [independent, can be done anytime]
```

**Key dependency:** All refactoring MUST happen after tests are in place. The project explicitly chose "test first, refactor second" (PROJECT.md Key Decisions). This is the correct order -- refactoring without tests is gambling.

## MVP Recommendation

Prioritize for this quality hardening milestone:

1. **Critical path tests** (table stakes, highest impact)
   - `fetchWithAuth` / `createClient` tests -- every command depends on this
   - `resolveAuth` multi-mode tests -- security-critical path
   - Token encrypt/decrypt round-trip -- crypto correctness
   - Command handler integration tests (start with `read`, `create`, `update`, `delete`)

2. **Coverage gate at 80%** (table stakes, enforces discipline)
   - Add `test:coverage` script
   - Fail CI if coverage drops below threshold

3. **Security quick wins** (table stakes, low effort, high signal)
   - Remove token prefix from `whoami`
   - CSP header on OAuth callback
   - CI credential documentation

4. **Retry logic** (differentiator, medium effort, high value for `cat` command reliability)
   - `retryableFetch` wrapper with exponential backoff + jitter
   - Retry on 429/502/503/timeout only

5. **Refactoring** (table stakes, gated on tests)
   - Split `blocks-to-md.ts` after tests confirm regression safety
   - Extract `doc-enrichment.ts` after `read` command tests exist

**Defer:**
- Image cache TTL: Low urgency, disk growth is slow
- QPS delay optimization: Requires empirical measurement, minor impact
- Verbose/debug mode: Nice-to-have, not blocking quality
- Linting/CI: Important but independent of the quality hardening goal

## Sources

- [Node.js Test Runner Documentation (v25.8.2)](https://nodejs.org/api/test.html)
- [Node.js Testing Best Practices - Yoni Goldberg (2025)](https://github.com/goldbergyoni/nodejs-testing-best-practices)
- [JavaScript Testing Best Practices (August 2025)](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Retry Patterns: Exponential Backoff, Jitter, and Dead Letter Queues (2026)](https://dev.to/young_gao/retry-patterns-that-actually-work-exponential-backoff-jitter-and-dead-letter-queues-75)
- [Node.js Advanced Patterns: Robust Retry Logic](https://v-checha.medium.com/advanced-node-js-patterns-implementing-robust-retry-logic-656cf70f8ee9)
- [CLI Authentication Best Practices - WorkOS](https://workos.com/blog/best-practices-for-cli-authentication-a-technical-guide)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Hardening Node.js Apps in Production - SitePoint](https://www.sitepoint.com/hardening-node-js-apps-in-production/)
- [Node.js Collecting Code Coverage](https://nodejs.org/en/learn/test-runner/collecting-code-coverage)
- [Shell Scripting Best Practices for Production Systems (2026)](https://oneuptime.com/blog/post/2026-02-13-shell-scripting-best-practices/view)
- [Refactoring Switch Statements - Refactoring Guru](https://refactoring.guru/smells/switch-statements)
