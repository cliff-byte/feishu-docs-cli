# TODOS

## ~~Pre-implementation: Verify 99991672/99991679 API response structure~~ DONE

**Status:** VERIFIED on 2026-03-20

Results:
- 99991672 (`action_scope_required`): `error.permission_violations[].subject` contains scope names
- 99991679 (`action_privilege_required`): same structure on new APIs, but **older APIs (e.g. search) omit `permission_violations`**
- Current code mapping 99991672 to RATE_LIMITED is confirmed BUG — must fix
- Fallback for missing `permission_violations` is necessary

## Post-refactor: fetchBinaryWithAuth scope error handling

**Priority:** LOW — follow-up optimization after core refactor
**Added:** 2026-03-20 (plan-eng-review)

`fetchBinaryWithAuth` (client.ts:259) returns raw binary data and does not parse JSON
responses. If a scope error occurs during binary download (e.g., image/file URLs), the
user gets a vague HTTP error instead of a clear scope prompt.

**Fix:** Check `Content-Type` header before reading body. If response is `application/json`
(which Feishu returns for error responses even on binary endpoints), parse as JSON and
apply the same scope error detection as `fetchWithAuth`.

**Depends on:** Core reactive scope refactor completion.
