---
phase: 01-testing-infra-core-tests
plan: 04
subsystem: testing
tags: [block-writer, document-resolver, clearDocument, backup, rotateBackups, wiki-fallback, mock-fetch]

requires:
  - phase: 01-testing-infra-core-tests/01
    provides: "shared test helpers (mock-fetch, factory)"
provides:
  - "clearDocument batch-delete and conflict-retry test coverage (CORE-05)"
  - "backupDocument and rotateBackups test coverage (CORE-06)"
  - "resolveDocument wiki fallback test coverage (CORE-07)"
  - "getBackupsDir() lazy computation for testable backup paths"
affects: [02-security-command-tests, 04-code-quality-refactoring]

tech-stack:
  added: []
  patterns:
    - "HOME env var override for testing fs-dependent functions"
    - "mock.timers.enable for async sleep control in clearDocument tests"
    - "resolveWithTimers helper for async timer interleaving"

key-files:
  created: []
  modified:
    - "src/services/block-writer.ts"
    - "src/commands/update.ts"
    - "test/block-writer.test.ts"
    - "test/document-resolver.test.ts"

key-decisions:
  - "Used HOME env var override instead of os.homedir mock (ESM module exports are frozen)"
  - "Used mock.timers.enable with resolveWithTimers helper for sleep control in clearDocument tests"
  - "Exported rotateBackups for direct testing"

patterns-established:
  - "HOME env var: set process.env.HOME to temp dir for testing fs functions that use os.homedir()"
  - "Timer interleaving: resolveWithTimers() helper ticks mock timers periodically to resolve pending setTimeout calls"

requirements-completed: [CORE-05, CORE-06, CORE-07]

duration: 7min
completed: 2026-03-27
---

# Phase 01 Plan 04: Block-Writer and Document-Resolver Tests Summary

**clearDocument batch-delete/conflict-retry, backup/rotate pipeline, and resolveDocument wiki fallback tests with lazy BACKUPS_DIR refactor**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-27T01:26:30Z
- **Completed:** 2026-03-27T01:33:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Refactored BACKUPS_DIR constant to getBackupsDir() lazy function for testability
- Added 7 new test cases for clearDocument, backupDocument, and rotateBackups (CORE-05, CORE-06)
- Added 6 new test cases for resolveDocument wiki fallback behavior (CORE-07)
- Achieved 88.05% coverage on block-writer.ts and 100% coverage on document-resolver.ts
- All 219 tests in full suite pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor BACKUPS_DIR and write clearDocument + backup tests** - `14105fa` (test)
2. **Task 2: Write resolveDocument wiki fallback and allowFallback tests** - `1cd7304` (test)

## Files Created/Modified
- `src/services/block-writer.ts` - Refactored BACKUPS_DIR to getBackupsDir() function, exported rotateBackups
- `src/commands/update.ts` - Updated import from BACKUPS_DIR to getBackupsDir()
- `test/block-writer.test.ts` - Added clearDocument (4 tests), backupDocument (1 test), rotateBackups (2 tests)
- `test/document-resolver.test.ts` - Added resolveDocument (6 tests) with wiki resolution and fallback paths

## Decisions Made
- Used HOME env var override instead of mock.method(os, "homedir") because ESM module namespace objects are frozen and can't have properties redefined
- Created resolveWithTimers() helper to interleave mock timer ticks with async promise resolution, avoiding deadlock when clearDocument awaits sleep()
- Exported rotateBackups function for direct testing (was previously private)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESM frozen module namespace prevents mock.method on exports**
- **Found during:** Task 1 (clearDocument tests)
- **Issue:** `mock.method(blockWriter, "sleep")` and `mock.method(os, "homedir")` fail with "Cannot redefine property" because ESM module namespaces are frozen
- **Fix:** Used `mock.timers.enable({ apis: ["setTimeout"] })` for sleep control and `process.env.HOME` override for homedir
- **Files modified:** test/block-writer.test.ts
- **Verification:** All 8 block-writer tests pass
- **Committed in:** 14105fa

**2. [Rule 3 - Blocking] Mock timer tick deadlock with async clearDocument loop**
- **Found during:** Task 1 (clearDocument batching test)
- **Issue:** `t.mock.timers.tick()` called after starting clearDocument promise caused hang because the function was blocked at `await sleep()` before tick could execute
- **Fix:** Created resolveWithTimers() helper using real setInterval to periodically tick mock timers while the async promise runs
- **Files modified:** test/block-writer.test.ts
- **Verification:** All clearDocument tests complete in ~16ms total
- **Committed in:** 14105fa

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both fixes necessary due to ESM module constraints. Same test coverage achieved with different mocking strategy. No scope creep.

## Issues Encountered
- clearDocument takes 3 parameters (authInfo, documentId, revisionId) not 2 as shown in plan interface -- used actual signature from source code
- rotateBackups was not exported and took no parameters (different from plan description) -- exported it and tested it directly

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All CORE-05, CORE-06, CORE-07 test coverage requirements met
- block-writer.ts at 88.05% coverage, document-resolver.ts at 100%
- getBackupsDir() refactor enables future backup path customization

## Self-Check: PASSED

All files found, all commits verified, no stubs detected.

---
*Phase: 01-testing-infra-core-tests*
*Completed: 2026-03-27*
