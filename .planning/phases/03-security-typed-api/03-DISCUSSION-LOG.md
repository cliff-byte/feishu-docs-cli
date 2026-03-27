# Phase 3: 安全加固与类型化 API 响应 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 03-security-typed-api
**Areas discussed:** Token exposure, CSP header, Type interface scope, fetchWithAuth generic
**Mode:** Auto (recommended defaults selected)

---

## Token Exposure Fix

| Option | Description | Selected |
|--------|-------------|----------|
| Show token type + expiration | Replace slice(0,10) with type and expiry info | ✓ (auto) |
| Remove entirely | No token info at all in whoami | |
| Mask with asterisks | Show u-****...  | |

**Auto-selected:** Show token type + expiration (recommended — maintains useful diagnostic info without leaking secrets)

---

## CSP Header

| Option | Description | Selected |
|--------|-------------|----------|
| Strict default-src 'none' | Minimal policy, only inline styles allowed | ✓ (auto) |
| Moderate policy | Allow same-origin resources | |
| Report-only | Log violations without blocking | |

**Auto-selected:** Strict policy (recommended — OAuth callback is a transient page with no external resources)

---

## Type Interface Scope

| Option | Description | Selected |
|--------|-------------|----------|
| doc-blocks + wiki-nodes first | Most used modules, demonstrate the pattern | ✓ (auto) |
| All 56 assertions at once | Complete migration in one phase | |
| Only doc-blocks | Minimal viable demonstration | |

**Auto-selected:** doc-blocks + wiki-nodes (recommended — demonstrates pattern without scope creep)

---

## fetchWithAuth Generic

| Option | Description | Selected |
|--------|-------------|----------|
| Default T = unknown | Backward compatible, opt-in typing | ✓ (auto) |
| Required T parameter | Forces all callers to specify type | |

**Auto-selected:** Default T = unknown (recommended — zero breaking changes)

## Claude's Discretion

- API response type field definitions
- CSP directive combinations
- Intermediate migration steps

## Deferred Ideas

None
