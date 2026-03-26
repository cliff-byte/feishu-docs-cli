# Architecture Patterns

**Domain:** CLI tool quality hardening -- refactoring a TypeScript CLI for Feishu/Lark API
**Researched:** 2026-03-26

## Recommended Architecture

The existing three-layer architecture (Command -> Service -> Client) is sound and should be preserved. The refactoring targets are about enforcing the boundaries that already exist conceptually but are violated in practice.

### Target State After Refactoring

```
CLI Router (cli.ts)
    |
    v
Commands Layer (commands/*.ts)
    - Thin orchestrators: parse input, call services, format output
    - No direct API calls except through services/client
    |
    v
Services Layer (services/*.ts)          Parser Layer (parser/*.ts)
    - doc-enrichment.ts  [NEW]              - blocks-to-md.ts (dispatch table)
    - doc-blocks.ts                         - renderers/*.ts [NEW]
    - block-writer.ts                       - text-elements.ts
    - markdown-convert.ts                   - block-types.ts
    - wiki-nodes.ts
    - image-download.ts
    |
    v
Client Layer (client.ts)               Types Layer (types/*.ts)
    - fetchWithAuth<T>()                    - index.ts (existing)
    - fetchBinaryWithAuth()                 - api-responses.ts [NEW]
    - createClient()
    |
    v
Auth Layer (auth.ts, scopes.ts)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `commands/read.ts` | Orchestrate read flow: resolve doc, enrich, render, output | `services/doc-enrichment`, `parser/blocks-to-md`, `client` |
| `services/doc-enrichment.ts` [NEW] | Parallel fetch of images, users, bitables, sheets, boards | `client`, `services/image-download` |
| `parser/blocks-to-md.ts` | Dispatch to per-type renderers, build tree, join output | `parser/renderers/*`, `parser/text-elements` |
| `parser/renderers/*.ts` [NEW] | Individual block type render functions | `parser/text-elements` |
| `types/api-responses.ts` [NEW] | Typed interfaces for all Feishu API response shapes | None (pure types) |
| `client.ts` | Generic typed `fetchWithAuth<T>`, auth header, timeout | `auth.ts` |

### Data Flow

**Read command (post-refactoring):**

```
read(args, globalOpts)
  |-- createClient(globalOpts) --> AuthInfo
  |-- resolveDocument(authInfo, input) --> ResolvedDocument
  |-- fetchAllBlocks(authInfo, documentId) --> Block[]
  |-- enrichBlocks(authInfo, blocks, globalOpts) --> EnrichmentResult  [NEW]
  |     |-- Promise.allSettled([
  |     |     batchGetTmpUrls(fileTokens) --> downloadImages(),
  |     |     resolveUserNames(userIds),
  |     |     ...bitableTokens.map(fetchBitableData),
  |     |     ...boardTokens.map(fetchBoardImage),
  |     |     ...sheetTokens.map(fetchSheetData),
  |     |   ])
  |     |-- collect results, log warnings for rejected
  |-- blocksToMarkdown(blocks, enrichmentMaps) --> string
  |-- process.stdout.write(output)
```

## Recommended Refactoring Order

The order below is driven by dependency analysis and risk minimization. Each step must leave all existing tests passing.

### Phase 1: Typed API Responses (types/api-responses.ts)

**Why first:** This is purely additive. No existing code changes. New type file, zero risk of breaking anything. Every subsequent refactoring step benefits from these types being available.

**What to do:**
1. Create `src/types/api-responses.ts` with interfaces for the most-used API endpoints
2. Re-export from `src/types/index.ts`
3. No existing code changes yet -- types are consumed in later phases

**Key interfaces to define:**

```typescript
// src/types/api-responses.ts

/** GET /open-apis/docx/v1/documents/{id}/blocks */
export interface DocxBlocksResponse {
  items: Block[];
  has_more: boolean;
  page_token?: string;
}

/** GET /open-apis/drive/v1/medias/batch_get_tmp_download_url */
export interface TmpDownloadUrlsResponse {
  tmp_download_urls: Array<{
    file_token: string;
    tmp_download_url: string;
  }>;
}

/** GET /open-apis/contact/v3/users/batch */
export interface UserBatchResponse {
  user_list: Array<{
    open_id: string;
    name: string;
    [key: string]: unknown;
  }>;
}

/** GET /open-apis/bitable/v1/apps/{token}/tables/{id}/fields */
export interface BitableFieldsResponse {
  items: Array<{
    field_id: string;
    field_name: string;
    type: number;
  }>;
}

/** GET /open-apis/bitable/v1/apps/{token}/tables/{id}/records */
export interface BitableRecordsResponse {
  items: Array<{
    record_id: string;
    fields: Record<string, unknown>;
  }>;
  has_more: boolean;
  page_token?: string;
  total: number;
}

/** GET /open-apis/sheets/v2/spreadsheets/{token}/metainfo */
export interface SheetMetaResponse {
  sheets: Array<{
    sheetId: string;
    title: string;
    index: number;
    rowCount: number;
    columnCount: number;
  }>;
}

/** GET /open-apis/sheets/v2/spreadsheets/{token}/values/{sheetId} */
export interface SheetValuesResponse {
  valueRange: {
    range: string;
    values: unknown[][];
  };
}

/** GET /open-apis/docx/v1/documents/{id} */
export interface DocumentInfoResponse {
  document: {
    document_id: string;
    revision_id: number;
    title: string;
  };
}

/** GET /open-apis/wiki/v2/spaces/get_node */
export interface WikiGetNodeResponse {
  node: {
    space_id: string;
    node_token: string;
    obj_token: string;
    obj_type: string;
    parent_node_token: string;
    title: string;
    has_child: boolean;
  };
}
```

**Gradual adoption strategy:** After creating the file, replace `as Record<string, unknown>` casts one module at a time, starting with `services/doc-blocks.ts` (simplest, 1 occurrence) and working outward. Each module is an independent PR-safe change.

**Priority order for `as Record<string, unknown>` elimination:**

| Priority | Module | Occurrences | Difficulty | Notes |
|----------|--------|-------------|------------|-------|
| 1 | `services/doc-blocks.ts` | 1 | Low | Simplest; just `DocxBlocksResponse` |
| 2 | `services/block-writer.ts` | 5 | Low | `DocumentInfoResponse` + block data |
| 3 | `services/wiki-nodes.ts` | 3 | Low | `WikiGetNodeResponse` |
| 4 | `commands/read.ts` | 11 | Medium | Moves to `doc-enrichment.ts` during extraction |
| 5 | `commands/share.ts` | 3 | Low | Share API response types |
| 6 | `commands/wiki.ts` | 3 | Low | Wiki operation response types |
| 7 | `commands/create.ts` | 2 | Low | Create API response |
| 8 | `parser/blocks-to-md.ts` | 12 | Medium | Block data access patterns -- most are `node as Record<>` |
| 9 | Remaining commands | 10 | Low | One-off casts per command |
| 10 | `client.ts`, `cli.ts` | 3 | Low | Generic infrastructure |

### Phase 2: Extract Dispatch Table from blocks-to-md.ts

**Why second:** The parser has the best test coverage (658-line test file). This is the safest big refactoring because tests already protect behavior. Doing it before `read.ts` extraction avoids merge conflicts.

**What to do:**

**Step 2a -- Extract render functions (no dispatch table yet):**

Extract each block type's rendering logic from the `renderNode` if-chain into named functions with a uniform signature. Keep them in the same file initially.

```typescript
// Uniform signature for all block type renderers
type BlockRenderer = (
  node: TreeNode,
  lines: string[],
  ctx: BlocksRenderCtx,
  depth: number,
  state: RenderState,
) => void;
```

Each extracted function becomes:

```typescript
function renderText(node: TreeNode, lines: string[], ctx: BlocksRenderCtx, depth: number): void {
  const indent = "  ".repeat(depth);
  const text = getElements(node, "text", ctx);
  lines.push(indent + text);
  lines.push("");
}

function renderBullet(node: TreeNode, lines: string[], ctx: BlocksRenderCtx, depth: number): void {
  const indent = "  ".repeat(depth);
  const text = getElements(node, "bullet", ctx);
  lines.push(`${indent}- ${text}`);
  renderChildren(node._children, lines, ctx, depth + 1);
  if (depth === 0) lines.push("");
}
// ... etc for all 30+ types
```

**Step 2b -- Create dispatch table:**

```typescript
const RENDERERS: ReadonlyMap<number, BlockRenderer> = new Map([
  [BlockType.PAGE,    renderPage],
  [BlockType.TEXT,    renderText],
  [BlockType.HEADING1, renderHeading],
  [BlockType.HEADING2, renderHeading],
  // ... all 9 heading types map to same renderHeading
  [BlockType.BULLET,  renderBullet],
  [BlockType.ORDERED, renderOrdered],
  [BlockType.TODO,    renderTodo],
  [BlockType.CODE,    renderCode],
  [BlockType.QUOTE,   renderQuote],
  [BlockType.QUOTE_CONTAINER, renderQuoteContainer],
  [BlockType.EQUATION, renderEquation],
  [BlockType.DIVIDER,  renderDivider],
  [BlockType.IMAGE,    renderImage],
  [BlockType.TABLE,    renderTable],
  [BlockType.CALLOUT,  renderCallout],
  [BlockType.DIAGRAM,  renderDiagram],
  [BlockType.IFRAME,   renderIframe],
  [BlockType.GRID,     renderGrid],
  [BlockType.GRID_COLUMN, renderGridColumn],
  [BlockType.TABLE_CELL, renderTableCell],
  [BlockType.FILE,     renderFile],
  [BlockType.ADDONS,   renderAddons],
  [BlockType.BITABLE,  renderBitable],
  [BlockType.BOARD,    renderBoard],
  [BlockType.SHEET,    renderSheet],
  [BlockType.TASK,     renderTask],
  [BlockType.LINK_PREVIEW, renderLinkPreview],
  [BlockType.JIRA_ISSUE,   renderJiraIssue],
  [BlockType.WIKI_CATALOG, renderWikiCatalog],
  [BlockType.SUB_PAGE_LIST, renderSubPageList],
  [BlockType.AGENDA,       renderPassthrough],
  [BlockType.AGENDA_ITEM,  renderPassthrough],
  [BlockType.AGENDA_ITEM_TITLE, renderAgendaItemTitle],
  [BlockType.AGENDA_ITEM_CONTENT, renderPassthrough],
]);

// Silent skip types (OKR, synced blocks, AI template)
const SILENT_SKIP = new Set([
  BlockType.OKR, BlockType.OKR_OBJECTIVE, BlockType.OKR_KEY_RESULT,
  BlockType.OKR_PROGRESS, BlockType.SOURCE_SYNCED,
  BlockType.REFERENCE_SYNCED, BlockType.AI_TEMPLATE,
]);

function renderNode(
  node: TreeNode, lines: string[], ctx: BlocksRenderCtx,
  depth: number, state: RenderState,
): void {
  const type = node.block_type;

  if (SILENT_SKIP.has(type)) return;

  const renderer = RENDERERS.get(type);
  if (renderer) {
    renderer(node, lines, ctx, depth, state);
    return;
  }

  // Reference type fallback
  if (renderReferenceType(node, type, lines, ctx)) return;

  // Unknown type
  ctx.warnings.push(`不支持的内容类型: ${type}`);
  lines.push(`[不支持的内容类型: ${type}]`);
  lines.push("");
}
```

**Step 2c (optional) -- Move renderers to separate files:**

Only if the single file remains above 600 lines after extraction. Group into:
- `parser/renderers/text-blocks.ts` -- text, headings, bullet, ordered, todo, code, quote
- `parser/renderers/media-blocks.ts` -- image, file, board, diagram, iframe
- `parser/renderers/data-blocks.ts` -- table, bitable, sheet
- `parser/renderers/container-blocks.ts` -- callout, grid, quote_container, agenda
- `parser/renderers/special-blocks.ts` -- task, link_preview, jira, wiki_catalog, addons

Use `ReadonlyMap` to keep the dispatch table immutable (per coding style requirements).

**Safety protocol:** Run `npm test` after each step (2a, 2b, 2c). All 658 lines of existing block-to-md tests must continue to pass unchanged. The test file itself does not change -- only internal structure of the module changes.

### Phase 3: Extract doc-enrichment.ts from read.ts

**Why third:** Depends on Phase 1 (typed responses) for clean interfaces. The `read.ts` enrichment functions have zero test coverage, so extraction must be done carefully with characterization tests first.

**What to do:**

**Step 3a -- Write characterization tests for enrichment functions:**

Before extracting anything, write tests for the functions that will move. These tests pin down the current behavior so extraction cannot introduce regressions.

```typescript
// test/doc-enrichment.test.ts (written BEFORE extraction)
// Test: extractFileTokens, extractBitableTokens, extractSheetTokens, extractBoardTokens
// Test: extractMentionUserIds
// Test: batchGetTmpUrls (mock fetchWithAuth)
// Test: fetchBitableData (mock fetchWithAuth)
// Test: fetchSheetData (mock fetchWithAuth)
// Test: fetchBoardImage (mock fetchBinaryWithAuth)
// Test: resolveUserNames (mock getTenantToken + fetchWithAuth)
```

These are pure function tests (extract* functions) and mock-based service tests (fetch* functions). All use `node:test` + `assert/strict`.

**Step 3b -- Extract to services/doc-enrichment.ts:**

Move these functions from `read.ts`:
- `batchGetTmpUrls()`
- `extractFileTokens()`
- `extractBitableTokens()`
- `extractSheetTokens()`
- `extractBoardTokens()`
- `extractMentionUserIds()`
- `fetchBitableData()`
- `fetchSheetData()`
- `fetchBoardImage()`
- `resolveUserNames()`
- `BitableData` interface
- `SheetData` interface
- `TMP_URL_BATCH_SIZE` constant

Add a new orchestrator function:

```typescript
export interface EnrichmentResult {
  imageUrlMap: Map<string, string>;
  userNameMap: Map<string, string>;
  bitableDataMap: Map<string, BitableData>;
  boardImageMap: Map<string, string>;
  sheetDataMap: Map<string, SheetData>;
  warnings: string[];
}

export async function enrichBlocks(
  authInfo: AuthInfo,
  blocks: Block[],
  globalOpts: GlobalOpts,
): Promise<EnrichmentResult> {
  // Extract all tokens
  const fileTokens = extractFileTokens(blocks);
  const mentionUserIds = extractMentionUserIds(blocks);
  const bitableTokens = extractBitableTokens(blocks);
  const boardTokens = extractBoardTokens(blocks);
  const sheetTokens = extractSheetTokens(blocks);

  const warnings: string[] = [];

  // Parallel enrichment with Promise.allSettled
  const [imageResult, userResult, ...dataResults] = await Promise.allSettled([
    // Images: get tmp URLs then download
    enrichImages(authInfo, fileTokens, globalOpts),
    // User names
    mentionUserIds.length > 0
      ? resolveUserNames(authInfo, mentionUserIds)
      : Promise.resolve(new Map<string, string>()),
    // Bitables, boards, sheets -- each token is an independent promise
    ...bitableTokens.map(token => fetchBitableData(authInfo, token).then(
      data => ({ type: 'bitable' as const, token, data })
    )),
    ...boardTokens.map(token => fetchBoardImage(authInfo, token).then(
      data => ({ type: 'board' as const, token, data })
    )),
    ...sheetTokens.map(token => fetchSheetData(authInfo, token).then(
      data => ({ type: 'sheet' as const, token, data })
    )),
  ]);

  // Collect results, log warnings for failures
  const imageUrlMap = imageResult.status === 'fulfilled'
    ? imageResult.value
    : (warnings.push('获取图片/文件链接失败'), new Map<string, string>());

  const userNameMap = userResult.status === 'fulfilled'
    ? userResult.value
    : (warnings.push('解析 @用户 名称失败'), new Map<string, string>());

  const bitableDataMap = new Map<string, BitableData>();
  const boardImageMap = new Map<string, string>();
  const sheetDataMap = new Map<string, SheetData>();

  for (const result of dataResults) {
    if (result.status === 'rejected') {
      warnings.push(`enrichment failed: ${result.reason}`);
      continue;
    }
    const { type, token, data } = result.value;
    if (!data) continue;
    if (type === 'bitable') bitableDataMap.set(token, data as BitableData);
    if (type === 'board') boardImageMap.set(token, data as string);
    if (type === 'sheet') sheetDataMap.set(token, data as SheetData);
  }

  return { imageUrlMap, userNameMap, bitableDataMap, boardImageMap, sheetDataMap, warnings };
}
```

**Step 3c -- Simplify read.ts:**

After extraction, `read.ts` becomes a thin orchestrator:

```typescript
export async function read(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  // ... input validation, createClient, resolveDocument (unchanged)
  // ... early returns for non-docx, --raw, --blocks (unchanged)

  const blocks = await fetchAllBlocks(authInfo, documentId);

  const enrichment = await enrichBlocks(authInfo, blocks, globalOpts);
  for (const w of enrichment.warnings) {
    process.stderr.write(`feishu-docs: warning: ${w}\n`);
  }

  let output = "";
  if (args.withMeta) { /* ... unchanged ... */ }

  output += blocksToMarkdown(blocks, {
    imageUrlMap: enrichment.imageUrlMap,
    userNameMap: enrichment.userNameMap,
    bitableDataMap: enrichment.bitableDataMap,
    boardImageMap: enrichment.boardImageMap,
    sheetDataMap: enrichment.sheetDataMap,
  });
  process.stdout.write(output);
}
```

This reduces `read.ts` from ~592 lines to ~120 lines.

**Step 3d -- Update cat.ts:**

The `cat` command currently does NOT call enrichment functions (it just calls `fetchAllBlocks` + `blocksToMarkdown` without enrichment). No changes needed unless we want to add enrichment to `cat` later.

### Phase 4: Parallel Enrichment with Promise.allSettled()

**Why fourth:** This is a behavioral change (sequential -> parallel) that requires the clean `enrichBlocks()` function from Phase 3. The existing sequential error handling in `read.ts` already gracefully handles per-token failures, which maps naturally to `Promise.allSettled()`.

This is integrated into Phase 3 Step 3b above. The key design decisions:

**Design: Promise.allSettled() grouping strategy:**

```
Group 1 (always parallel with each other):
  - Image URL fetch + download pipeline
  - User name resolution

Group 2 (each token is independent, all parallel):
  - Each bitable token fetch
  - Each board image download
  - Each sheet data fetch
```

All of Group 1 and Group 2 run in parallel via a single `Promise.allSettled()`. This is safe because:

1. Each enrichment targets a different API endpoint (no shared rate limit)
2. The existing code already handles per-token failures gracefully
3. `Promise.allSettled()` never rejects, so the orchestrator always gets results

**Concurrency consideration:** For documents with many embedded objects (e.g., 20 bitables + 10 sheets + 5 boards = 35 concurrent API calls), consider adding a simple concurrency limiter:

```typescript
async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const executing = new Set<Promise<void>>();

  for (const task of tasks) {
    const p = task()
      .then(value => results.push({ status: 'fulfilled', value }))
      .catch(reason => results.push({ status: 'rejected', reason }))
      .then(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}
```

Use a limit of 5-10 concurrent requests to avoid triggering Feishu API rate limits while still providing significant speedup over sequential execution.

## Patterns to Follow

### Pattern 1: Dispatch Table with Uniform Render Signature

**What:** Replace if-else chain with a `Map<number, RenderFunction>` lookup.
**When:** Any function with > 5 type-based branches that all produce the same kind of output.
**Why:** Adding a new block type becomes "add one map entry + one function" instead of "find the right place in a 458-line if-chain."

```typescript
// Registry pattern -- immutable dispatch table
const RENDERERS: ReadonlyMap<number, BlockRenderer> = new Map([
  [BlockType.TEXT, renderText],
  [BlockType.BULLET, renderBullet],
  // ...
]);

// Dispatch is now O(1) lookup, not O(n) if-chain
function renderNode(node: TreeNode, ...args): void {
  const renderer = RENDERERS.get(node.block_type);
  if (renderer) { renderer(node, ...args); return; }
  // fallback handling
}
```

### Pattern 2: Service Extraction with Characterization Tests

**What:** Before moving functions between files, write tests that pin current behavior.
**When:** Extracting untested code from a large file into a service module.
**Why:** Without characterization tests, you cannot verify the extraction preserved behavior.

```typescript
// Step 1: Write test against CURRENT location
import { extractFileTokens } from "../src/commands/read.js";

// Step 2: Extract function to services/doc-enrichment.ts
// Step 3: Update import in test -- test body stays identical
import { extractFileTokens } from "../src/services/doc-enrichment.js";

// Step 4: Update import in read.ts
import { enrichBlocks } from "../services/doc-enrichment.js";
```

### Pattern 3: Gradual Type Narrowing for API Responses

**What:** Replace `as Record<string, unknown>` with typed response interfaces, one API endpoint at a time.
**When:** Any `fetchWithAuth()` call site that casts the response.
**Why:** Compile-time safety against Feishu API response structure changes.

```typescript
// BEFORE (unsafe):
const res = await fetchWithAuth(authInfo, path);
const data = res?.data as Record<string, unknown>;
const items = data?.items as Block[];

// AFTER (type-safe):
const res = await fetchWithAuth<DocxBlocksResponse>(authInfo, path);
const items = res.data?.items ?? [];
// TypeScript knows items is Block[]
```

The generic parameter on `fetchWithAuth<T>` flows through to `ApiResponse<T>`, giving typed `data` access. The actual runtime behavior does not change -- this is purely a compile-time improvement.

**Important:** Do NOT add runtime validation (like Zod) for API responses. The project has a zero-dependency constraint. TypeScript types provide compile-time checking which is sufficient for this use case. If a field is missing at runtime, existing error handling (null checks, fallbacks) already covers it.

### Pattern 4: Parallel Enrichment with Graceful Degradation

**What:** Use `Promise.allSettled()` for independent API calls, collect partial results.
**When:** Multiple independent data fetches that should not block each other on failure.
**Why:** A document with 5 bitables where one fails should still render the other 4.

```typescript
const results = await Promise.allSettled(
  tokens.map(token => fetchData(authInfo, token))
);

const dataMap = new Map<string, Data>();
const warnings: string[] = [];

for (let i = 0; i < results.length; i++) {
  const result = results[i];
  if (result.status === 'fulfilled' && result.value) {
    dataMap.set(tokens[i], result.value);
  } else if (result.status === 'rejected') {
    warnings.push(`Failed to fetch ${tokens[i]}: ${result.reason}`);
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Big Bang Refactoring

**What:** Changing blocks-to-md.ts AND read.ts AND adding types all in one PR.
**Why bad:** If tests break, you cannot tell which change caused it. Merge conflicts compound. Reviewability drops.
**Instead:** One file per PR. Each PR must leave all tests passing. Phases 1-4 are 4+ separate PRs.

### Anti-Pattern 2: Runtime Type Validation Under Zero-Dependency Constraint

**What:** Importing Zod or io-ts to validate API responses at runtime.
**Why bad:** Violates the project's zero-dependency constraint. Adds bundle size for a CLI tool that already handles missing fields gracefully.
**Instead:** Use TypeScript compile-time types. Add optional assertions (`if (!data?.items)`) where null-safety matters.

### Anti-Pattern 3: Over-Abstracting the Renderer

**What:** Creating a `BlockRenderer` class hierarchy with abstract methods, factory pattern, etc.
**Why bad:** The rendering logic is simple -- each type maps to a function. OOP abstractions add ceremony without benefit for this case.
**Instead:** Plain functions in a `Map`. The dispatch table is the pattern. No classes needed.

### Anti-Pattern 4: Extracting Renderers to 30 Individual Files

**What:** One file per block type renderer (e.g., `renderers/text.ts`, `renderers/bullet.ts`, ...).
**Why bad:** Most renderers are 5-15 lines. 30 files of 10 lines each is worse than 5 files of 60 lines each.
**Instead:** Group renderers by category (text-blocks, media-blocks, data-blocks, container-blocks, special-blocks). Only create separate files if the main file stays above 600 lines after extraction.

### Anti-Pattern 5: Changing fetchWithAuth Signature During Type Migration

**What:** Making `fetchWithAuth<T>` require the generic parameter (breaking all existing call sites at once).
**Why bad:** Forces updating all 19 files simultaneously.
**Instead:** Default the generic to `unknown` (`fetchWithAuth<T = unknown>`). Existing code continues to work. New/updated code specifies the type.

## Build Order Implications

```
types/api-responses.ts  (Phase 1 -- no deps, enables everything)
        |
        v
parser/blocks-to-md.ts  (Phase 2 -- has tests, safe first refactor)
        |                            benefits from types in renderers
        v
services/doc-enrichment.ts  (Phase 3 -- depends on types)
        |                              extraction from read.ts
        v
Parallel enrichment  (Phase 4 -- integrated into Phase 3)
        |
        v
Gradual type migration  (ongoing -- one module per PR)
across remaining 18 files with `as Record<string, unknown>`
```

**Critical ordering constraint:** Phase 3 (read.ts extraction) MUST happen after Phase 2 (blocks-to-md.ts refactor) to avoid merge conflicts in the `parser/` directory. Both phases touch `BlocksRenderCtx` and related types.

**Parallel-safe phases:** Phase 1 (types) can be done in parallel with Phase 2 (dispatch table) because they touch different files. But Phase 3 depends on both.

## Safe Extraction Patterns for TypeScript Modules

### The Move-and-Re-export Pattern

When extracting functions from a large file, use a temporary re-export to avoid breaking downstream consumers:

```typescript
// Step 1: Move functions to new file (services/doc-enrichment.ts)
export function extractFileTokens(blocks: Block[]): string[] { /* ... */ }

// Step 2: Re-export from old location (commands/read.ts) -- TEMPORARY
export { extractFileTokens } from "../services/doc-enrichment.js";

// Step 3: Update all consumers to import from new location
// Step 4: Remove re-export from old location
```

For this project, Step 2 is unnecessary because `extractFileTokens` is not exported from `read.ts` (it is a private function). The only consumer is the `read` function itself. This simplifies extraction -- just move and update the one import site.

### Test File Update Strategy

When the function under test moves:
1. Update the import path in the test file
2. Do NOT change test logic
3. Run tests to confirm they pass
4. This proves the extraction preserved behavior

## Scalability Considerations

| Concern | Current (sequential) | After refactoring (parallel) |
|---------|---------------------|------------------------------|
| 10 embedded bitables | ~10 * RTT latency | ~1 * RTT (parallel) |
| 5 images + 3 sheets + 2 boards | 10 sequential calls | 1 round (all parallel) |
| Rate limiting risk | None (too slow) | Moderate (need concurrency limit) |
| Error isolation | Per-token try/catch | Promise.allSettled (cleaner) |
| Memory | Same | Same (no change in data volume) |

## Sources

- [Dispatch Tables in JavaScript: Clean Code Approach](https://shramko.dev/blog/dispatch-tables)
- [Replacing If-Else Logic with State and Strategy Patterns](https://copyprogramming.com/howto/replacing-if-else-logic-with-state-strategy-pattern)
- [Promise.allSettled() - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
- [Is Promise.all still relevant in 2025? - LogRocket](https://blog.logrocket.com/promise-all-modern-async-patterns/)
- [Characterization Testing - Refactoring Legacy Code with Confidence](https://cloudamite.com/characterization-testing/)
- [Refactoring by Breaking Functions Apart: TypeScript Experiment](https://auth0.com/blog/refactoring-breaking-functions-apart-typescript/)
- [Writing Type Safe API Clients in TypeScript](https://dev.to/nazeelashraf/writing-type-safe-api-clients-in-typescript-1j92)
- [TypeScript Best Practices for Large-Scale Web Applications 2026](https://johal.in/typescript-best-practices-for-large-scale-web-applications-in-2026/)

---

*Architecture research: 2026-03-26*
