# Milestones

## v1.0 质量加固 (Shipped: 2026-03-28)

**Phases completed:** 5 phases, 15 plans, 30 tasks

**Key accomplishments:**

- c8 coverage pipeline with tsx integration, plus three shared test helper modules (mock-fetch, env-guard, factory) validated by 16 smoke tests
- resolveAuth multi-mode priority chain tests (user/tenant/auto) and AES-256-GCM token encrypt/decrypt round-trip tests with lazy path refactor for test isolation
- 22 tests covering fetchWithAuth (all branches), getTenantToken, getApiBase, and createClient with full error mapping, scope extraction, and timeout handling
- clearDocument batch-delete/conflict-retry, backup/rotate pipeline, and resolveDocument wiki fallback tests with lazy BACKUPS_DIR refactor
- captureOutput helper and 27 integration tests covering read/create/update/delete/cat command handlers with tenant-mode fetch mocking and stdout/stderr capture
- 22 integration tests covering wiki (6 subcommands), tree (depth/nested/JSON/human), and spaces (pagination/empty) with captureOutput helper
- Integration tests for ls/mv/cp/mkdir commands covering JSON output, pagination, async task polling, title-fetch fallback, and validation
- Integration tests for share (5 subcommands), search (user auth), info, login/whoami/logout, and authorize with c8 coverage pipeline configuration
- Close 80% line coverage gap with enrichment path tests, error utility tests, and check-coverage enforcement
- Removed token prefix leakage from whoami, added CSP headers to OAuth callback HTML, documented CI/container auth in README
- Generic fetchWithAuth<T> with typed response interfaces, eliminating all unsafe `as Record<string, unknown>` casts from doc-blocks and wiki-nodes service modules
- Refactored blocks-to-md.ts from 31-branch if/else-if chain to ReadonlyMap dispatch table with named render functions
- Extracted enrichment logic from read.ts to doc-enrichment.ts service, parallelized with pLimit(5) + Promise.allSettled, reducing read.ts from 592 to 148 lines
- Configurable retry with exponential backoff and jitter for fetchWithAuth and fetchBinaryWithAuth
- Image cache TTL eviction (30-day), QPS delay halved to 200ms, knip dead code detection integrated

---
