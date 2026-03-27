---
phase: 05-robustness
plan: 02
subsystem: performance
tags: [image-cache, ttl, knip, dead-code, qps-optimization]

requires:
  - phase: 05-robustness-01
    provides: fetchWithAuth retry logic (429 safety net for reduced QPS delay)
provides:
  - cleanExpiredImages function for 30-day image cache TTL eviction
  - QPS_DELAY reduced to 200ms for faster clearDocument batch deletes
  - knip dead code detection integrated via lint:dead-code script
affects: [maintenance, ci-pipeline]

tech-stack:
  added: [knip ^6.0.6]
  patterns: [fire-and-forget async cleanup, readdir+stat+unlink TTL eviction]

key-files:
  created: [knip.json]
  modified: [src/services/image-download.ts, test/image-download.test.ts, src/services/block-writer.ts, test/block-writer.test.ts, package.json]

key-decisions:
  - "ignoreExportsUsedInFile: true in knip config to handle dynamic command dispatch pattern"
  - "Fire-and-forget cleanup (void prefix) to avoid blocking downloadImages flow"
  - "QPS_DELAY halved from 400ms to 200ms, safe with retry logic from Plan 01"

patterns-established:
  - "TTL eviction pattern: readdir + stat(mtimeMs) + unlink for time-based cache cleanup"
  - "Fire-and-forget async: void prefix for non-blocking background work"

requirements-completed: [ROB-02, ROB-03, ROB-04]

duration: 4min
completed: 2026-03-27
---

# Phase 05 Plan 02: Cache/Performance/Hygiene Summary

**Image cache TTL eviction (30-day), QPS delay halved to 200ms, knip dead code detection integrated**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T12:14:34Z
- **Completed:** 2026-03-27T12:19:21Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Image cache files older than 30 days are automatically cleaned when downloadImages runs
- clearDocument batch delete delay reduced from 400ms to 200ms (safe with retry logic from Plan 01)
- knip dead code detection installed and configured with lint:dead-code npm script
- Identified 3 genuinely unused exports: LANGUAGE_TO_ENUM, DocumentInfo, WikiSpace

## Task Commits

Each task was committed atomically:

1. **Task 1: Image cache TTL eviction (TDD RED)** - `4566b52` (test)
2. **Task 1: Image cache TTL eviction (TDD GREEN)** - `9d09f6f` (feat)
3. **Task 2: Reduce QPS delay to 200ms** - `ac6bbca` (perf)
4. **Task 3: Install knip and configure dead code detection** - `91944bb` (chore)

_Note: Task 1 used TDD with separate RED and GREEN commits_

## Files Created/Modified
- `src/services/image-download.ts` - Added IMAGE_TTL_MS constant, cleanExpiredImages function, fire-and-forget call in downloadImages
- `test/image-download.test.ts` - Added 7 cleanExpiredImages behavior tests + IMAGE_TTL_MS assertion
- `src/services/block-writer.ts` - Changed QPS_DELAY from 400 to 200
- `test/block-writer.test.ts` - Added QPS_DELAY constant value assertion
- `knip.json` - Dead code detection configuration with entry points and ignoreExportsUsedInFile
- `package.json` - Added knip devDependency and lint:dead-code script

## Decisions Made
- Used `ignoreExportsUsedInFile: true` in knip config to handle the dynamic command dispatch pattern where handler functions are exported and referenced via meta.handler in the same file
- Fire-and-forget pattern (`void cleanExpiredImages(dir)`) chosen to avoid blocking the download flow -- cleanup is best-effort
- QPS_DELAY safely halved because Plan 01 added retry logic with 429 handling as safety net

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 05 plans complete
- Image cache has TTL-based cleanup preventing unbounded disk growth
- Dead code detection available via npm run lint:dead-code for ongoing maintenance
- 3 unused exports identified by knip for future cleanup consideration

## Self-Check: PASSED

All 4 commits verified. All created/modified files confirmed to exist.

---
*Phase: 05-robustness*
*Completed: 2026-03-27*
