---
phase: 05-robustness
plan: 01
subsystem: http-client
tags: [retry, exponential-backoff, jitter, resilience]

requires: []
provides:
  - retry utility (src/utils/retry.ts) with calculateDelay, parseRetryAfter, isRetryable, sleep
  - RetryConfig type extension on FetchOptions
  - fetchWithAuth auto-retry on 429/502/503/AbortError
  - fetchBinaryWithAuth auto-retry with same behavior

affects: [api-communication, network-resilience]

tech-stack:
  added: []
  patterns: [exponential-backoff-with-jitter, retry-after-header-parsing]

key-files:
  created: [src/utils/retry.ts, test/retry.test.ts]
  modified: [src/client.ts, src/types/index.ts, src/services/block-writer.ts, test/client.test.ts]

key-decisions:
  - "Retry loop inlined in fetchWithAuth/fetchBinaryWithAuth (different error handling paths)"
  - "Shared utility functions in retry.ts for delay calculation and retryability checks"
  - "sleep() moved from block-writer.ts to retry.ts (single source of truth)"
  - "Fresh AbortController per retry attempt to avoid instant-abort pitfall"

patterns-established:
  - "Retry utility pattern: calculateDelay + isRetryable + parseRetryAfter as composable functions"
  - "FetchOptions.retry union type (RetryConfig | false) for per-call control"

requirements-completed: [ROB-01]

duration: ~20min
completed: 2026-03-28
---

# Phase 05 Plan 01: Retry Logic Summary

**Configurable retry with exponential backoff and jitter for fetchWithAuth and fetchBinaryWithAuth**

## Performance

- **Duration:** ~20 min (split across agent + manual completion)
- **Started:** 2026-03-27
- **Completed:** 2026-03-28
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created retry utility module (src/utils/retry.ts) with calculateDelay, parseRetryAfter, isRetryable, sleep
- Extended FetchOptions with RetryConfig type for per-call retry control
- Integrated retry loops into both fetchWithAuth and fetchBinaryWithAuth
- 429 responses respect Retry-After header (capped at 30s)
- Each retry logs to stderr with Chinese message
- retry: false disables retry behavior
- 22 retry utility tests + 11 client retry tests all pass

## Task Commits

1. **Task 1: Retry utility + types (TDD RED)** - `4e002f2` (test)
2. **Task 1: Retry utility + types (TDD GREEN)** - `3d611b2` (feat)
3. **Task 2: Client retry integration (TDD RED)** - `e26f994` (test)
4. **Task 2: Client retry integration (TDD GREEN)** - `8d57ac9` (feat)

## Files Created/Modified
- `src/utils/retry.ts` - New retry utility with DEFAULT_RETRY config, calculateDelay, parseRetryAfter, isRetryable, sleep
- `src/types/index.ts` - Added RetryConfig interface and retry field on FetchOptions
- `src/client.ts` - Added retry loops to fetchWithAuth and fetchBinaryWithAuth with per-attempt AbortController
- `src/services/block-writer.ts` - Migrated sleep import to src/utils/retry.ts
- `test/retry.test.ts` - 22 tests covering all retry utility functions
- `test/client.test.ts` - 11 new tests for fetchWithAuth/fetchBinaryWithAuth retry behavior

## Decisions Made
- Retry loop inlined rather than using withRetry<T>() HOF because fetchWithAuth and fetchBinaryWithAuth have different error handling paths (JSON parsing vs binary/res.ok)
- Each retry attempt creates a fresh AbortController to avoid instant-abort from reused timed-out controller
- sleep() consolidated into retry.ts as single source of truth (block-writer.ts now imports from there)

## Deviations from Plan
- Task 2 required manual completion after agent API connection failure

## Issues Encountered
- Agent API connection error interrupted Task 2 mid-execution (failing tests written but integration not implemented)
- Resolved by manual completion of retry integration on main branch

## Self-Check: PASSED

All tests verified: 22 retry tests + 33 client tests (including 11 new retry tests) = 456 total suite.

---
*Phase: 05-robustness*
*Completed: 2026-03-28*
