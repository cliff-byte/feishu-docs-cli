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

## PHASE 2 — shipped (standalone docx via Drive meta)
Implemented after Phase 1 was verified live and the user opted in.

- New `src/services/drive-meta.ts` → `getDriveMeta()` POSTs `/open-apis/drive/v1/metas/batch_query`
  (`request_docs:[{doc_token, doc_type}]`) → `owner_id`/`create_time`/`latest_modify_time`/`latest_modify_user`.
- `info` and `read --with-meta` call it for non-wiki docs (`!doc.spaceId`), wrapped in
  `withScopeRecovery` (fallback scope `drive:drive.metadata:readonly`). **Best-effort** —
  a missing Drive scope emits an actionable `authorize` hint and the command still succeeds.
- Note: Drive meta has no separate "creator" field, so standalone docx surfaces
  `owner`/`obj_create_time`/`obj_edit_time` (not `creator`).
- Commit **ee5dff3**. Tests: `test/drive-meta.test.ts` + standalone-docx cases in info/read.

### Live verification
- Phase 1 (wiki): `tree --json` / `info` / `read --with-meta` all surface metadata against the
  real account (e.g. `info` → `创建时间: 2026-01-15T06:59:37.000Z`, creator/owner present).
- Phase 2 (standalone docx): the Drive scope is not yet granted on the account, so the lookup
  degrades gracefully — `info` warns with the exact `authorize --scope` command and still returns
  base fields. Happy path will populate owner/times once the scope is authorized.

## Still open (not in this task)
- Resolve `creator`/`owner` open-ids (`ou_…`) to display names (contact API + scope).
- `cp`/`ls`/`mkdir`/`share` test HOME-isolation (logged in STATE.md).
