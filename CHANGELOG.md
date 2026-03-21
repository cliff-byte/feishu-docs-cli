# Changelog

## [0.1.0-beta.13] - 2026-03-21

### Fixed

- **Token refresh failure no longer silently switches to tenant mode.** Previously in `--auth auto` mode, if `refresh_token` failed, the CLI silently fell back to tenant auth — causing unexpected permission errors that looked like token expiration. Now refresh failures throw `TOKEN_EXPIRED` with a clear message to re-run `feishu-docs login`.
- Token-expired-without-refresh-token still falls back to tenant when credentials are available, but now emits a visible warning so users know they're not in user mode.

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
