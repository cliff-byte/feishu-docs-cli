---
gsd_summary_version: 1.0
quick_id: 260527-mw5
slug: surface-doc-metadata
status: complete
date: 2026-05-27
---

# Quick Task 260527-mw5 — Summary

## What shipped (PHASE 1 — wiki path, no new scopes)

The Feishu wiki APIs return per-node metadata the CLI was silently discarding.
Surfaced it through the resolver layer and out to three commands. All additions
are **additive optional fields** — no CLI arg or existing output field/label changed.

### Fields surfaced
`obj_create_time`, `obj_edit_time`, `node_create_time`, `creator`, `owner`, `node_creator`
— from `GET /wiki/v2/spaces/{id}/nodes` and `GET /wiki/v2/spaces/get_node`.
Timestamps are seconds-since-epoch strings; JSON keeps the raw value, human output renders ISO-8601.

### Commits
- **796f034** `feat: thread wiki node metadata through resolver layer`
  - `WikiNode` (types) + `WikiGetNodeResponse.node` (api-responses): six optional fields.
  - `ResolvedWikiNode` + `resolveWikiToken`: map fields (immutable literal).
  - `ResolvedDocument` + `resolveDocument`: carry fields from the wiki node.
  - New `src/utils/format-time.ts` → `formatEpochSeconds()` (zero-dep).
- **7f069c5** `feat: surface wiki metadata in info, tree, read --with-meta`
  - `info`: JSON keys `creator`/`owner`/`obj_create_time`/`obj_edit_time` (snake_case,
    conditional) + human lines 创建者/创建时间/修改时间/所有者.
  - `tree`: six camelCase fields on `TreeNode` + `--json` (conditional). Human tree line unchanged.
  - `read --with-meta`: `creator`/`owner`/`created`/`modified` front-matter for wiki docs.
  - Sandboxed `HOME` in `info.test.ts` (see below).

## Tests
- New: `test/format-time.test.ts`, `test/wiki-nodes.test.ts`.
- Extended: `test/document-resolver.test.ts`, `test/info.test.ts`, `test/tree.test.ts`, `test/read.test.ts`.
- Full suite under CI-equivalent clean HOME: **484/484 pass**, `tsc --noEmit` clean.

## Notes / findings
- **Pre-existing test-isolation bug (out of scope, not fixed beyond info):** `info`, `cp`,
  `ls`, `mkdir`, `share` integration tests don't sandbox `HOME`. On a machine with a real
  `~/.feishu-docs/auth.json`, auth resolves to *user mode* (1 fetch/call) instead of
  *tenant mode* (2 fetches/call), desyncing the ordered fetch mocks → local failures.
  They pass in CI (no auth.json). Fixed `info.test.ts` here because the new tests live in it;
  `cp/ls/mkdir/share` left as a follow-up (logged in STATE.md Blockers/Concerns).
- `creator`/`owner` are surfaced as raw user-id strings. Resolving them to display names
  would need extra contact-API calls + scope — deferred.

## Deferred — PHASE 2 (needs confirmation)
Standalone (non-wiki) docx creator/create-time/modify-time/owner. The docx GET endpoint
(`/docx/v1/documents/{id}`) returns only `document_id`/`revision_id`/`title`/`display_setting`/`cover`
— no creator or time. Requires `POST /open-apis/drive/v1/metas/batch_query` wrapped in
`withScopeRecovery` + a new Drive scope (`drive:drive` or `drive:file`).
