---
phase: 01-testing-infra-core-tests
plan: 02
subsystem: testing
tags: [auth, encryption, aes-256-gcm, resolveAuth, node-test, tdd]

# Dependency graph
requires:
  - phase: 01-testing-infra-core-tests
    plan: 01
    provides: test helpers (env-guard, mock-fetch, factory)
provides:
  - resolveAuth multi-mode authentication resolution tests (CORE-03)
  - Token encrypt/decrypt round-trip tests (CORE-04)
  - Lazy path computation in auth.ts for test isolation
affects: [01-testing-infra-core-tests, auth-related-plans]

# Tech tracking
tech-stack:
  added: []
  patterns: [HOME env var override for os.homedir() test isolation, lazy path computation for testable file I/O]

key-files:
  created:
    - test/auth-resolve.test.ts
    - test/auth-crypto.test.ts
  modified:
    - src/auth.ts

key-decisions:
  - "Used HOME env var override instead of t.mock.method(os, homedir) for test isolation -- ESM named imports are non-configurable properties"
  - "Lazy path functions (getConfigDir/getAuthFile/getLockFile) enable predictable test isolation without mocking module internals"

patterns-established:
  - "HOME env var override: set HOME to temp directory to redirect os.homedir() for file I/O isolation in tests"
  - "Lazy path computation: use functions instead of module-level constants for paths derived from os.homedir()"

requirements-completed: [CORE-03, CORE-04]

# Metrics
duration: 5min
completed: 2026-03-27
---

# Phase 01 Plan 02: Auth Module Tests Summary

**resolveAuth multi-mode priority chain tests (user/tenant/auto) and AES-256-GCM token encrypt/decrypt round-trip tests with lazy path refactor for test isolation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-27T01:26:27Z
- **Completed:** 2026-03-27T01:31:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Refactored auth.ts path constants to lazy functions (getConfigDir, getAuthFile, getLockFile) enabling testable file paths
- Added 10 resolveAuth tests covering all three auth modes, env var resolution, saved token loading from encrypted files, and AUTH_REQUIRED error paths
- Added 5 token crypto tests covering encrypt/decrypt round-trip, missing file handling, corrupted data recovery, clearTokens, and directory auto-creation
- All 221 tests pass (206 existing + 15 new), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor auth.ts path constants to lazy computation** - `9155191` (refactor)
2. **Task 2: Write resolveAuth multi-mode tests and token crypto round-trip tests** - `eb905ef` (test)

## Files Created/Modified
- `src/auth.ts` - Refactored CONFIG_DIR/AUTH_FILE/LOCK_FILE constants to lazy functions getConfigDir()/getAuthFile()/getLockFile()
- `test/auth-resolve.test.ts` - 10 tests for resolveAuth user/tenant/auto mode priority chain and error paths (246 lines)
- `test/auth-crypto.test.ts` - 5 tests for saveTokens/loadTokens/clearTokens encryption round-trip and error handling (138 lines)

## Decisions Made
- Used HOME env var override instead of `t.mock.method(os, "homedir", ...)` because ESM module namespace exports are non-configurable properties and cannot be redefined by node:test mocking. Setting `process.env.HOME` reliably controls `os.homedir()` on Unix systems.
- Extended `withCleanEnv` helper to accept `HOME` as a key for temp dir isolation, keeping the test API consistent with other env-guard patterns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed test isolation strategy from os.homedir mock to HOME env var**
- **Found during:** Task 2 (writing auth-resolve.test.ts)
- **Issue:** `t.mock.method(os, "homedir", ...)` throws "Cannot redefine property: homedir" because ESM named imports (`import { homedir } from "node:os"`) create non-configurable property descriptors on the module namespace object
- **Fix:** Used `withCleanEnv({ HOME: testDir }, ...)` to override the HOME env var, which `os.homedir()` respects on Unix systems. This achieves the same test isolation without requiring mocking.
- **Files modified:** test/auth-resolve.test.ts, test/auth-crypto.test.ts
- **Verification:** All 15 new tests pass, temp directory isolation confirmed
- **Committed in:** eb905ef (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary adaptation for ESM compatibility. The HOME env var approach is simpler and more reliable than the originally planned mock approach.

## Issues Encountered
None beyond the ESM mock limitation documented above.

## Next Phase Readiness
- Auth module now has comprehensive test coverage for resolveAuth and token crypto
- Lazy path computation pattern established for any future auth.ts tests needing file isolation
- Ready for Plan 03 (fetchWithAuth/client tests) and Plan 04 (coverage enforcement)

---
*Phase: 01-testing-infra-core-tests*
*Completed: 2026-03-27*
