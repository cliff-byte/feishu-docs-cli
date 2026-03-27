---
phase: 02-command-handler-tests
plan: 03
subsystem: testing
tags: [node-test, integration-test, drive-api, ls, mv, cp, mkdir]

# Dependency graph
requires:
  - phase: 01-testing-infra-core-tests
    provides: test helpers (mock-fetch, factory, env-guard), test patterns
provides:
  - Integration tests for ls command (8 tests: json, type filter, limit, pagination, empty, validation, human-readable)
  - Integration tests for mv command (4 tests: sync, async polling, validation, human-readable)
  - Integration tests for cp command (4 tests: with --name, title-fetch fallback, validation, human-readable)
  - Integration tests for mkdir command (4 tests: json, --parent, validation, human-readable)
  - captureOutput helper for stdout/stderr interception in command tests
affects: [02-04-PLAN, coverage-enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns: [captureOutput with binary TAP passthrough for Node 24 test runner compatibility]

key-files:
  created:
    - test/ls.test.ts
    - test/mv.test.ts
    - test/cp.test.ts
    - test/mkdir.test.ts
    - test/helpers/capture-output.ts
  modified: []

key-decisions:
  - "captureOutput filters binary Uint8Array writes (test runner TAP protocol) and only captures string writes (application output)"
  - "Each fetchWithAuth call requires its own tenant token mock since resolveBearer re-fetches every time (no caching)"
  - "For docx URLs, resolveDocument skips wiki resolution API call, simplifying mock chains to tenant token + API response"

patterns-established:
  - "captureOutput pattern: intercept process.stdout.write, filter binary TAP, restore in afterEach"
  - "Command test mock chain: withCleanEnv (set app credentials) + setupMockFetch (tenant token + API responses)"

requirements-completed: [CMD-08]

# Metrics
duration: 7min
completed: 2026-03-27
---

# Phase 02 Plan 03: Cloud Drive Operations Test Summary

**Integration tests for ls/mv/cp/mkdir commands covering JSON output, pagination, async task polling, title-fetch fallback, and validation**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-27T02:24:16Z
- **Completed:** 2026-03-27T02:31:15Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- 20 integration tests across 4 cloud drive commands (ls, mv, cp, mkdir)
- Created reusable captureOutput helper that handles Node 24 test runner binary TAP protocol
- Full coverage of sync and async mv completion paths (including 1-second poll cycle)
- Verified cp title-fetch fallback behavior (fetches original title and appends " - 副本" suffix)

## Task Commits

Each task was committed atomically:

1. **Task 1: ls and mkdir command tests** - `a360bba` (test)
2. **Task 2: mv and cp command tests** - `9eafa2a` (test)

## Files Created/Modified
- `test/ls.test.ts` - 8 tests covering JSON, type filter, limit, pagination, empty folder, validation, human-readable
- `test/mkdir.test.ts` - 4 tests covering JSON output, missing name validation, --parent option, human-readable
- `test/mv.test.ts` - 4 tests covering sync completion, async task polling, missing args, human-readable
- `test/cp.test.ts` - 4 tests covering --name, title-fetch fallback, missing args, human-readable
- `test/helpers/capture-output.ts` - stdout/stderr capture helper with binary TAP passthrough
- `test/helpers/mock-fetch.ts` - Copied from main repo for worktree isolation
- `test/helpers/factory.ts` - Copied from main repo for worktree isolation
- `test/helpers/env-guard.ts` - Copied from main repo for worktree isolation

## Decisions Made
- captureOutput must filter binary Uint8Array writes from Node 24 test runner (TAP protocol) to avoid corrupting captured application output
- Each fetchWithAuth invocation needs its own tenant token mock response since resolveBearer does not cache tenant tokens on AuthInfo
- docx URLs skip resolveDocument wiki API call, making mock chains simpler (2 responses for basic operations, 4 for pagination or title-fetch)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] captureOutput binary TAP filtering**
- **Found during:** Task 1 (ls pagination test)
- **Issue:** Node 24 test runner writes binary Uint8Array TAP protocol data through process.stdout.write, which was being captured alongside application JSON output, causing JSON.parse failures
- **Fix:** Modified captureOutput to only capture string writes and pass binary writes through to the original function
- **Files modified:** test/helpers/capture-output.ts
- **Verification:** All 20 tests pass with clean JSON parsing
- **Committed in:** a360bba (Task 1 commit)

**2. [Rule 3 - Blocking] Pagination mock chain missing tenant token**
- **Found during:** Task 1 (ls pagination test)
- **Issue:** Second page fetch via fetchWithAuth needed its own tenant token mock since resolveBearer re-fetches every call
- **Fix:** Added extra tenantTokenResponse() to pagination mock chain (4 responses total instead of 3)
- **Files modified:** test/ls.test.ts
- **Verification:** Pagination test passes, correctly collects 2 files across 2 pages
- **Committed in:** a360bba (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for test correctness. No scope creep.

## Issues Encountered
- Node 24.5.0 test runner uses binary Uint8Array for internal TAP protocol output through process.stdout.write, which is a change from earlier Node versions that used string-based output. Required the captureOutput helper to discriminate between string (application) and binary (test runner) writes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 20 cloud drive command tests ready (ls, mv, cp, mkdir)
- captureOutput pattern established and reusable for Plan 04 (share, search, info, login/authorize/logout)
- All 210 tests pass (existing + new)

---
*Phase: 02-command-handler-tests*
*Completed: 2026-03-27*
