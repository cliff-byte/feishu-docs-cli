# Changelog

## [Unreleased]

### Added

- **Table header rows on write.** `create` and `update` now set each Markdown table's first row as a header row (the "设置为标题行" style in the Feishu UI) by default — previously tables were written with no header row, losing the visual distinction. Pass `--no-table-header` to write plain tables instead. Implemented via the table block's `header_row` property at create time (no extra API calls).

## [1.3.0] - 2026-06-23

### Added

- **Automatic skill sync.** The packaged `SKILL.md` is now mirrored to Claude's skill directories automatically, so upgrading the CLI no longer leaves a stale skill behind. It runs at two moments: an npm `postinstall` hook on install/upgrade, and a non-blocking fallback on every CLI invocation that re-syncs when the installed copy drifts from the packaged one. Targets `~/.claude/skills/feishu-docs/` and, when that framework is present, `~/.agents/skills/feishu-docs/`. Sync is local-only (no network), never blocks an install or a command, and can be disabled with `FEISHU_DOCS_NO_SKILL_SYNC=1`.

### Changed

- **`install-skill` now targets Claude's skill directories** (`~/.claude/skills/feishu-docs/` and, when present, `~/.agents/skills/`) instead of the legacy `~/.claude/commands/feishu-docs.md` path, matching where Claude Code actually loads skills. The command name and arguments are unchanged.

### Docs

- **SKILL.md corrections and hardening.** Fixed the stale "image write is not supported" limitation (writing local markdown images has worked since 1.1.0) and documented the upload constraints; added the metadata usage surfaced in 1.2.0 (`tree --names`/`--json`, `read --with-meta`, `info` creator/owner/timestamps); and promoted the CLI install check to a blocking first action so standalone skill installs (e.g. from skills.sh) guide the agent to install the CLI before use.

## [1.2.0] - 2026-05-29

### Added

- **Document metadata in `info`, `tree`, and `read --with-meta`.** The CLI now surfaces creator, creation time, modify time, and owner — data the Feishu APIs already return but the CLI previously discarded. `info` shows them in both human and `--json` output; `tree --json` carries them per node; `read --with-meta` adds them to the front-matter.
- **Standalone (non-wiki) document metadata via the Drive API.** For documents outside a wiki, `info` and `read --with-meta` query `drive/v1/metas/batch_query` for owner and create/modify time (the docx endpoint does not expose them). Best-effort: when the Drive scope is not granted, the command still succeeds and prints an actionable `authorize` hint.
- **Creator/owner name resolution.** Creator and owner open-ids are resolved to display names where the contact directory permits it. Output is additive — the stable open-id is kept and a `*_name` field is added alongside (`info` human output shows `名字 (ou_…)`). `tree --names` opts into name resolution for the whole tree in a single batched lookup; it is off by default to keep `tree` fast.

### Notes

- Wiki documents carry full metadata with no extra permissions. Standalone-doc metadata needs a Drive scope (`drive:drive.metadata:readonly`), and name resolution needs the app's contact permission and visibility range — without them the CLI degrades gracefully to bare ids.

## [1.1.0] - 2026-05-09

### Added

- **Write local markdown images to Feishu docs.** `create` and `update` commands now upload local images referenced in markdown (relative paths and `file://` URIs) to Feishu's media service and embed them in the document. Previously only remote URLs worked.
- **`whoami` auto-refreshes expired tokens.** Agents that probe auth state via `feishu-docs whoami` no longer mistake "已过期" for "needs re-login" when `refresh_token` is still valid. The command silently refreshes when possible and reports `(已自动刷新)`, `(已过期，自动刷新失败)`, or the legacy `(已过期)` based on outcome. JSON mode adds `expires_at`, `refreshed`, and `refresh_error` fields for programmatic consumers.

### Changed

- **Token refresh logic extracted into a shared `tryRefreshIfExpired` helper.** Both `createClient` (for API calls) and `whoami` (for diagnostics) now go through the same code path, so reported state is consistent with what the next call would actually do.

### Fixed

- **Test suite no longer corrupts the developer's real `~/.feishu-docs/auth.json`.** The `logout` test and three pre-existing `whoami` tests previously read or deleted the live auth file because they did not isolate `HOME`. They now use `mkdtemp()` per test.

## [1.0.0] - 2026-03-29

First stable release. Quality hardening milestone complete — 456 tests, all core paths verified against live Feishu API.

### Added

- **Automatic retry on API errors.** Rate-limited (429) and server errors (5xx) are now retried automatically with exponential backoff and jitter — no more manual retries needed.
- **Image cache auto-cleanup.** Downloaded images in `~/.feishu-docs/images/` are automatically evicted when expired, keeping disk usage in check.
- **Typed API responses.** Internal API calls now use typed responses, reducing runtime surprises from unexpected API shapes.
- **Parallel enrichment.** Sheet, bitable, whiteboard, and image content is now fetched in parallel during `read`, making large documents with embedded content noticeably faster.
- **456 unit tests** covering auth, client, commands, services, parser, and utilities — up from ~30 in beta.

### Changed

- **Faster batch operations.** Internal QPS delay reduced from 400ms to 200ms.
- **Cleaner block rendering internals.** Block renderer refactored to dispatch table for maintainability.
- **Security hardening.** Token prefix removed from `whoami` output; CSP headers added to OAuth callback page.
- **CI/container auth guide** added to README for headless environments.

### Removed

- Dead code detected by knip: unused exports, unreachable branches, stale type aliases.

### Fixed

- All fixes from beta.14 through beta.17 are included in this release.

## [0.1.0-beta.17] - 2026-03-24

### Added

- **Local image download.** `read` command now downloads document images to `~/.feishu-docs/images/` for persistent access. Added `docs:document.media:download` to BASE_SCOPES.

## [0.1.0-beta.16] - 2026-03-23

### Fixed

- **Wiki document title update now works.** Previously, updating a wiki document with a Markdown file containing `# Title` failed to set the document title because the code used the docx API (`PATCH /docx/v1/documents`) instead of the wiki node rename API (`POST /wiki/v2/spaces/{spaceId}/nodes/{nodeToken}/update_title`). Now the correct API is chosen based on document type.
- **Mermaid flowchart `\n` converted to `<br>` on write.** AI tools generate mermaid node labels with literal `\n` for line breaks, but standard mermaid requires `<br>`. The CLI now automatically converts these inside mermaid code blocks before sending to the Feishu Convert API.
- **Backup restore now uses Descendant API.** Replaced the old recursive children API with Descendant API, which supports all block types including flowcharts and embedded components. Fixes `invalid param` (1770001) errors when restoring documents with tables or components.
- **Backups kept after successful write for undo.** Previously, overwrite success immediately deleted the backup, making it impossible to undo AI misoperations. Now backups are retained — each document keeps the 10 most recent, oldest auto-cleaned.

## [0.1.0-beta.15] - 2026-03-23

### Fixed

- **Update check now runs on all commands.** Previously `feishu-docs --help` and `feishu-docs` (no args) skipped the version update check because it was placed after the early return. Now `checkForUpdates()` runs before any early exits.

## [0.1.0-beta.14] - 2026-03-21

### Fixed

- **Root cause of frequent "token expired" — `offline_access` scope was missing from login.** Without this scope, the Feishu API never returned a `refresh_token`, so `user_access_token` expired after 2 hours with no way to refresh. Now `offline_access` is included in `BASE_SCOPES`, giving `refresh_token` a 7-day validity with automatic renewal. Users need to re-run `feishu-docs login` once to get the new scope.
- **Token refresh failure no longer silently switches to tenant mode.** Previously in `--auth auto` mode, if `refresh_token` refresh failed, the CLI silently fell back to tenant auth — causing permission errors that looked like token expiration. Now refresh failures throw `TOKEN_EXPIRED` with a clear message.
- **`login --scope` always includes `offline_access`.** Even when users specify a custom `--scope` argument, `offline_access` is automatically injected to ensure `refresh_token` is always available.
- Token-expired-without-refresh-token still falls back to tenant when credentials are available, but now emits a visible warning.

### Removed

- Silent tenant fallback on refresh failure — replaced with explicit error reporting.

## [0.1.0-beta.12] - 2026-03-21

### Fixed

- **Markdown H1 heading now becomes document title, not body content.** When writing a Markdown file to a Feishu document via `update --body`, the first `# heading` is extracted as the document title and removed from the body content. The title is updated via PATCH API after successful content write, ensuring safe rollback if the write fails.
- **`create` command auto-extracts title from Markdown.** When no title argument is given, `feishu-docs create --body file.md` automatically uses the first H1 heading from the Markdown as the document title. When a title argument is provided, the H1 heading stays in the body as content.
- **Title-only Markdown documents handled correctly.** If the Markdown file contains only a heading with no body, the document title is set without writing empty content.

## [0.1.0-beta.11] - 2026-03-21

### Fixed

- **Binary download endpoints now detect scope errors.** `fetchBinaryWithAuth` (used for whiteboard image export) previously returned a vague "下载失败: HTTP 403" when permissions were insufficient. Now it checks `Content-Type`, parses JSON error responses, and throws `SCOPE_MISSING` with exact scope names and an actionable `feishu-docs authorize --scope` recovery command — matching the behavior of all other API calls.
- Non-scope JSON errors on binary endpoints now route through `mapApiError` for consistent error type mapping (e.g., 131006 → PERMISSION_DENIED).

## [0.1.0-beta.10] - 2026-03-20

### Changed

- **Reactive scope authorization** — removed all pre-flight scope checks (`ensureScopes`, `FEATURE_SCOPE_GROUPS`). The Feishu API is now the source of truth for required permissions. When an API call fails due to missing scopes (error codes 99991672/99991679), the CLI automatically extracts the required scope names from the API response and prompts the user to authorize.
- `authorize` command simplified: removed `--feature` flag, only `--scope` remains. Scope names come directly from API error messages.
- `withScopeRecovery` wrapper replaces `ensureScopes` across all commands (ls, delete, search, mv, cp, mkdir, share, read).

### Fixed

- **99991672 error code was incorrectly mapped to RATE_LIMITED** — now correctly identified as "app scope missing" (SCOPE_MISSING). This was a bug that masked real permission errors.
- `read` command image/file URL resolution now uses reactive scope recovery instead of the previous manual catch-prompt-retry pattern.
- Non-interactive mode (--json, CI) correctly throws with `recovery` hint instead of silently failing on scope errors.
- `FEISHU_USER_TOKEN` env-var sessions skip interactive OAuth prompt (OAuth success would be ignored on retry since env token takes precedence).
- Tenant mode skips pointless OAuth prompting (tenant auth ignores user tokens from OAuth).
- JSON error output now includes `missing_scopes` array for programmatic scope recovery by AI agents.

### Removed

- `FEATURE_SCOPE_GROUPS`, `getMissingScopes`, `ALL_KNOWN_SCOPES`, `FEATURE_NAMES`, `FeatureName` from scopes.ts
- `ensureScopes`, `isPermissionError` from scope-prompt.ts
- `--feature` flag from `authorize` command
