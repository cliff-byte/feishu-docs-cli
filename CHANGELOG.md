# Changelog

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
