# AGENTS.md

## Project Overview

`feishu-docs-cli` is a Node.js CLI tool for AI Agents to read/write Feishu (Lark) cloud documents and knowledge bases via shell commands. It outputs pure text or structured JSON — no interactive UI.

> [!IMPORTANT]
> **Zero runtime dependencies**: All API calls use `fetchWithAuth()` in `src/client.ts` with native `fetch`. No external SDK is used.

> [!IMPORTANT]
> **Convert + Descendant API for writing**: Document content is written using the two-step Convert API (`POST /docx/v1/documents/blocks/convert`) + Descendant API (`POST /docx/v1/documents/{id}/blocks/{id}/descendant`). Do NOT use the children API (`POST /docx/v1/documents/{id}/blocks/{id}/children`) which has a 9-row table limit. Do NOT implement a local Markdown parser — the server-side conversion handles all formatting.

## Build & Test

```bash
npm install            # Install dependencies
npm test               # Run all tests (node:test)
node bin/feishu-docs.js --help   # Run CLI
```

> [!IMPORTANT]
> **Test Coverage**: All new features must include unit tests. Run `npm test` and verify 0 failures before committing. Tests use Node.js built-in `node:test` and `node:assert/strict` — no test frameworks.

## Architecture

### Source Layout

| File | Purpose |
|------|---------|
| `src/cli.ts` | Entry point, declarative command routing with subcommand support |
| `src/auth.ts` | OAuth v2 login flow, encrypted token persistence, file-lock refresh |
| `src/client.ts` | Auth client factory, `fetchWithAuth()` REST wrapper, `fetchBinaryWithAuth()` for binary responses, token resolution |
| `src/commands/*.ts` | Command modules — each exports `meta` for routing |
| `src/services/block-writer.ts` | Document backup, clear, restore helpers |
| `src/services/wiki-nodes.ts` | Wiki node tree traversal and token resolution |
| `src/services/doc-blocks.ts` | Document block fetching with pagination |
| `src/services/markdown-convert.ts` | Convert API + Descendant API pipeline |
| `src/parser/blocks-to-md.ts` | Feishu block JSON → Markdown renderer |
| `src/parser/block-types.ts` | Block type constants |
| `src/parser/text-elements.ts` | Inline text element rendering |
| `src/scopes.ts` | OAuth scope catalog: BASE_SCOPES (免审), mergeScopes, buildScopeHint |
| `src/utils/errors.ts` | `CliError` class, `mapApiError()`, exit codes |
| `src/utils/url-parser.ts` | URL/token parsing and validation |
| `src/utils/document-resolver.ts` | Unified URL/token → document descriptor resolution |
| `src/utils/member.ts` | Shared member ID validation and type detection |
| `src/utils/drive-types.ts` | Document type → Drive API type mapping |
| `src/utils/validate.ts` | Token/ID format validation for path safety |
| `src/utils/version.ts` | Local version read, npm update check (24h cache, non-blocking) |

### Command Registration Pattern

Each command module exports a `meta` object:

```javascript
// Top-level command
export const meta = {
  options: { raw: { type: "boolean" }, blocks: { type: "boolean" } },
  positionals: true,
  handler: read,
};

// Command with subcommands
export const meta = {
  subcommands: {
    list: { options: {}, positionals: true, handler: list },
    add:  { options: { role: { type: "string" } }, positionals: true, handler: add },
  },
};
```

Register in `src/cli.js` by importing the meta and adding to the `COMMANDS` object.

### Auth Modes

| Mode | Token Type | When to Use |
|------|-----------|-------------|
| `user` | user_access_token | Personal docs, collaboration, search, wiki member management |
| `tenant` | tenant_access_token | App-managed docs, CI/CD |
| `auto` | Best available | Default — tries user first, falls back to tenant |

## Input Validation & Path Safety

> [!IMPORTANT]
> This CLI is designed to be invoked by AI agents. Always assume inputs can be adversarial — validate all user-supplied values before embedding them in API URL paths.

### Token/ID Validation (`src/utils/validate.js`)

All tokens, space IDs, and node tokens interpolated into URL paths MUST be validated:

```javascript
import { validateToken } from "../utils/validate.js";

validateToken(spaceId, "space_id");  // Throws CliError if invalid
```

### URL Path Encoding

All dynamic segments in URL paths MUST use `encodeURIComponent`:

```javascript
// CORRECT
`/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/members`

// WRONG — raw user input in URL path
`/open-apis/wiki/v2/spaces/${spaceId}/members`
```

### Member ID Validation (`src/utils/member.js`)

User-supplied member IDs MUST be validated before use:

```javascript
import { validateMemberId, detectMemberType } from "../utils/member.js";

validateMemberId(memberId);  // Regex validation
const memberType = detectMemberType(memberId);  // Auto-detect: email, openid, unionid, etc.
```

### Checklist for New Features

1. **URL path segments** → Use `encodeURIComponent()` and `validateToken()`
2. **Member IDs** → Use `validateMemberId()` from `src/utils/member.js`
3. **Drive type mapping** → Use `mapToDriveType()` from `src/utils/drive-types.js`
4. **Error handling** → Throw `CliError` with appropriate type, never plain `Error`
5. **Write tests** for both happy path and error cases

## Feishu API Pitfalls

> [!IMPORTANT]
> These are hard-won lessons from production debugging. Violating any of these will cause subtle, hard-to-diagnose failures.

| Pitfall | Details |
|---------|---------|
| **blocks is an array, not a map** | Descendant API's `descendants` field accepts an array. Passing a `{ block_id: block }` map causes error 99992402 |
| **`??` not `\|\|` for revision** | `document_revision_id` can be 0. Use `??` for fallback, not `\|\|` |
| **fetchWithAuth for all API calls** | All Feishu API calls go through `fetchWithAuth()` with proper auth token handling |
| **member_type is `"openchat"` not `"chat"`** | The `type` field uses `"chat"` but `member_type` requires `"openchat"` |
| **Error 131008 is context-dependent** | Means "permission denied" for node operations, "already exist" for member operations. Check `apiCode` at call site |
| **Error 1201003 → fallback to update** | Permission member create returns this when member already exists. Fallback to PUT |
| **sanitizeBlocks before write** | Blocks must have read-only fields (parent_id, comment_ids, merge_info) removed before writing via Descendant API |
| **Descendant API 1000-block limit** | Max 1000 blocks per call; `splitIntoBatches` auto-splits at top-level block boundaries |
| **Wiki member API requires admin** | The calling identity must already be a wiki space administrator |
| **No wiki space delete API** | Feishu does not provide an API to delete wiki spaces (returns 404) |
| **Convert API returns blocks array** | The `blocks` field from Convert API can be passed directly to Descendant API |

## Immutability Rules

> [!IMPORTANT]
> This project follows strict immutability conventions. NEVER mutate objects after creation.

```javascript
// CORRECT — immutable object construction
const body = {
  name,
  ...(args.desc && { description: args.desc }),
};

// WRONG — mutation after creation
const body = { name };
if (args.desc) body.description = args.desc;
```

## Error Handling

All errors must use `CliError` from `src/utils/errors.js`:

```javascript
throw new CliError("INVALID_ARGS", "message", {
  apiCode: 131008,
  recovery: "helpful recovery suggestion for agent",
});
```

Error types and exit codes:

| Type | Exit Code | When |
|------|-----------|------|
| `INVALID_ARGS` | 1 | Bad user input |
| `FILE_NOT_FOUND` | 1 | Missing file |
| `AUTH_REQUIRED` | 2 | Missing credentials |
| `TOKEN_EXPIRED` | 2 | Token needs refresh |
| `PERMISSION_DENIED` | 2 | Insufficient permissions |
| `NOT_FOUND` | 3 | Document/resource not found |
| `NOT_SUPPORTED` | 3 | Unsupported operation |
| `RATE_LIMITED` | 3 | API rate limit |
| `API_ERROR` | 3 | Generic API error |

The `recovery` field is critical for AI agent consumers — always provide actionable guidance.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FEISHU_APP_ID` | Feishu app ID (required for tenant auth) |
| `FEISHU_APP_SECRET` | Feishu app secret (required for tenant auth) |
| `FEISHU_USER_TOKEN` | Pre-obtained user access token (bypasses OAuth) |
| `FEISHU_REDIRECT_URI` | OAuth callback URL override |
| `FEISHU_OAUTH_PORT` | OAuth callback port override (default: 3456) |

## Required OAuth Scopes

**Base scopes** (no admin review — requested automatically during `feishu-docs login`):

```
wiki:wiki
docx:document
docx:document.block:convert
sheets:spreadsheet:readonly
board:whiteboard:node:read
bitable:app:readonly
```

**Additional scopes** are requested reactively. When an API call fails due to missing
scopes, `fetchWithAuth` detects the error (codes 99991672/99991679), extracts the
required scope names from the API response, and the CLI prompts the user to authorize.
No local scope-to-command mapping is maintained — the Feishu API is the source of truth.

Common additional scopes (require admin review):
- `drive:drive` — cloud drive file management (ls, delete, share, mv, cp, mkdir)
- `contact:contact.base:readonly` — contact lookup by email/phone
- `drive:drive.search:readonly` — document search

## Output Format

All commands output to stdout (results) and stderr (errors/warnings).

- **Default**: Human-readable text format
- **`--json`**: Structured JSON with `{ success: true, ... }` envelope
- **Errors in JSON mode**: `{ success: false, error: { type, message, api_code, recovery } }`

AI agents should always use `--json` for reliable parsing.

## Supported Document Types

| Type | Read | Create | Update | Delete | Info |
|------|------|--------|--------|--------|------|
| `docx` (new documents) | Full Markdown | Yes | Yes | Yes | Yes |
| `sheet` | Rendered as table | No | No | Yes | Yes |
| `bitable` | Rendered as table | No | No | Yes | Yes |
| `board`/`whiteboard` | Exported as image | No | No | No | No |
| `doc` (legacy) | Not supported | No | No | No | No |

Markdown conversion is lossy (colors, merged cells, layouts are dropped). Use `--blocks` for lossless block JSON.
