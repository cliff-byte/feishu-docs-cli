---
phase: 02-command-handler-tests
plan: 01
subsystem: testing
tags: [node-test, integration-tests, command-handlers, fetch-mock, stdout-capture]

# Dependency graph
requires:
  - phase: 01-testing-infra-core-tests
    provides: "setupMockFetch, jsonResponse, tenantTokenResponse, makeGlobalOpts, withCleanEnv helpers"
provides:
  - "captureOutput helper for stdout/stderr interception in command tests"
  - "Integration tests for read, create, update, delete, cat commands (27 tests)"
affects: [02-command-handler-tests]

# Tech tracking
tech-stack:
  added: []
  patterns: ["captureOutput stdout/stderr capture pattern for CLI command testing", "PAGE root block required in blocksToMarkdown mock data"]

key-files:
  created:
    - test/helpers/capture-output.ts
    - test/read.test.ts
    - test/create.test.ts
    - test/update.test.ts
    - test/delete.test.ts
    - test/cat.test.ts
  modified: []

key-decisions:
  - "captureOutput uses process.stdout.write/process.stderr.write interception (not mocking) for zero-dependency capture"
  - "Convert API mock responses use snake_case field names (first_level_block_ids, block_id_to_image_urls) matching actual API"
  - "blocksToMarkdown requires PAGE root block (block_type 1) with children for proper tree rendering"
  - "Each fetchWithAuth on tenant mode consumes 2 mock responses (getTenantToken + actual API call)"

patterns-established:
  - "captureOutput pattern: create, use in test, restore in afterEach -- supports stdout/stderr/stdoutJson"
  - "Command test setup: mkdtemp for HOME isolation + withCleanEnv + setupMockFetch + captureOutput"
  - "Mock response chain: tenantTokenResponse() paired with each fetchWithAuth call on tenant mode"

requirements-completed: [CMD-01, CMD-02, CMD-03, CMD-04, CMD-05]

# Metrics
duration: 10min
completed: 2026-03-27
---

# Phase 02 Plan 01: Document Operation Command Tests Summary

**captureOutput helper and 27 integration tests covering read/create/update/delete/cat command handlers with tenant-mode fetch mocking and stdout/stderr capture**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-27T02:23:35Z
- **Completed:** 2026-03-27T02:33:36Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Created `captureOutput` helper that intercepts process.stdout.write and process.stderr.write for command output testing
- 7 read command tests covering --raw, --blocks, default markdown, non-docx placeholder, --with-meta, validation, human-readable mode
- 5 create command tests covering drive create, wiki create, --body content, validation, human-readable mode
- 5 update command tests covering --append, non-docx rejection, missing --body, validation, human-readable mode
- 5 delete command tests covering --confirm, wiki rejection, drive delete, validation, human-readable mode
- 5 cat command tests covering streaming output, maxDocs limit, depth limit, non-docx placeholder, validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create captureOutput helper and read command tests** - `b5c4ec4` (test)
2. **Task 2: Create/update/delete/cat command tests** - `e2db552` (test)

## Files Created/Modified
- `test/helpers/capture-output.ts` - stdout/stderr capture helper with stdoutJson for JSON output parsing
- `test/read.test.ts` - 7 integration tests for read command (--raw, --blocks, default, non-docx, --with-meta, validation, human-readable)
- `test/create.test.ts` - 5 integration tests for create command (drive, wiki, --body, validation, human-readable)
- `test/update.test.ts` - 5 integration tests for update command (--append, non-docx, --body, validation, human-readable)
- `test/delete.test.ts` - 5 integration tests for delete command (--confirm, wiki, drive, validation, human-readable)
- `test/cat.test.ts` - 5 integration tests for cat command (streaming, maxDocs, depth, non-docx, validation)

## Decisions Made
- Used process.stdout.write interception (not node:test mock) for captureOutput -- zero dependency, works with all write patterns in the CLI
- Convert API mock responses must use snake_case field names (`first_level_block_ids`, `block_id_to_image_urls`) to match actual Feishu API response format
- blocksToMarkdown requires a PAGE root block (block_type 1) with children array -- single text blocks without root produce empty output
- Each fetchWithAuth call on tenant mode auth consumes 2 responses from the mock queue (getTenantToken + actual API call)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed blocksToMarkdown mock data structure**
- **Found during:** Task 1 (read default mode test)
- **Issue:** Mock data had only a text block without PAGE root block. blocksToMarkdown's buildTree function needs a PAGE block (block_type 1) as root with children IDs for tree construction.
- **Fix:** Added PAGE root block (block_type 1) with children array pointing to text blocks in all tests using default/human-readable markdown output
- **Files modified:** test/read.test.ts
- **Verification:** Tests pass with correct markdown output including text content
- **Committed in:** b5c4ec4

**2. [Rule 1 - Bug] Fixed Convert API mock response field names**
- **Found during:** Task 2 (create --body and update --append tests)
- **Issue:** Mock used camelCase `firstLevelBlockIds`/`blockIdToImageUrls` but actual API returns snake_case `first_level_block_ids`/`block_id_to_image_urls`. The `convertMarkdown` function checks for snake_case keys.
- **Fix:** Changed mock response fields to use snake_case matching actual API format
- **Files modified:** test/create.test.ts, test/update.test.ts
- **Verification:** All convertAndWrite dependent tests pass
- **Committed in:** e2db552

---

**Total deviations:** 2 auto-fixed (2 bugs in test mock data)
**Impact on plan:** Both fixes necessary for correct test setup. No scope creep.

## Issues Encountered
None beyond the auto-fixed mock data issues described above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- captureOutput helper is available for Plans 02-04 (wiki, drive, share, search commands)
- Established patterns for command test setup: HOME isolation, fetch mocking, output capture
- All 283 existing tests continue to pass (zero regressions)

## Self-Check: PASSED

- All 6 created files exist on disk
- Both task commits (b5c4ec4, e2db552) found in git log
- All 283 tests pass (27 new + 256 existing)

---
*Phase: 02-command-handler-tests*
*Completed: 2026-03-27*
