# TODOS

## ~~Pre-implementation: Verify 99991672/99991679 API response structure~~ DONE

**Status:** VERIFIED on 2026-03-20

Results:
- 99991672 (`action_scope_required`): `error.permission_violations[].subject` contains scope names
- 99991679 (`action_privilege_required`): same structure on new APIs, but **older APIs (e.g. search) omit `permission_violations`**
- Current code mapping 99991672 to RATE_LIMITED is confirmed BUG — must fix
- Fallback for missing `permission_violations` is necessary

## ~~Post-refactor: fetchBinaryWithAuth scope error handling~~ DONE

**Status:** COMPLETED on 2026-03-21

`fetchBinaryWithAuth` now checks `Content-Type` header on error responses. If
`application/json`, parses JSON and applies the same scope error detection as
`fetchWithAuth` (99991672/99991679 → SCOPE_MISSING with exact scope names).
Non-scope JSON errors route through `mapApiError` for consistent handling.
6 unit tests cover all code paths (T1-T6).
