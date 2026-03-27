# Phase 4: 代码重构 - Research

**Researched:** 2026-03-27
**Domain:** TypeScript code refactoring (dispatch table pattern, service extraction, async parallelization)
**Confidence:** HIGH

## Summary

Phase 4 performs three refactoring operations under the safety net of 400 passing tests at 83.70% line coverage: (1) converting `blocks-to-md.ts`'s 31-branch if-chain to a `ReadonlyMap<number, BlockRenderer>` dispatch table, (2) extracting ~370 lines of enrichment logic from `read.ts` into `services/doc-enrichment.ts`, and (3) replacing serial `for...await` enrichment loops with `Promise.allSettled()` backed by a zero-dependency concurrency limiter.

All three are pure internal refactors -- the public API (`blocksToMarkdown()` signature, `read` command CLI interface, `cat` command) remains unchanged. The existing test suites for `blocks-to-md.test.ts` (658 lines, 32 tests) and `read.test.ts` (901 lines, 10 tests) serve as the regression safety net. New unit tests are needed only for the two new modules (`concurrency.ts` and `doc-enrichment.ts`).

**Primary recommendation:** Execute REF-01, REF-02, and REF-03 in sequence. REF-01 is independent; REF-02 and REF-03 are tightly coupled (both modify `read.ts` and the enrichment pipeline), so they should be done in the same plan or in a REF-02-first then REF-03 order.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use `ReadonlyMap<number, BlockRenderer>` dispatch table to replace renderNode's if-chain. Renderer signature: `(node: TreeNode, ctx: RenderContext) => string`. RenderContext encapsulates indent, options, and other context.
- **D-02:** All renderer functions stay in the same file (blocks-to-md.ts) as top-level named functions. No split into separate files -- block renderers share RenderContext and elementsToMarkdown, splitting would cause circular deps.
- **D-03:** renderNode becomes a lightweight dispatcher: `const renderer = RENDERERS.get(node.type); return renderer ? renderer(node, ctx) : "";`. Unknown block types return empty string (preserving existing behavior).
- **D-04:** Target: blocks-to-md.ts from 822 lines to ~600-700 lines.
- **D-05:** Create `src/services/doc-enrichment.ts` with single entry `enrichBlocks(authInfo, blocks, opts)`. Internal functions: `resolveImageUrls()`, `fetchBitableData()`, `fetchSheetData()`, `fetchBoardImage()`, `resolveUserNames()`.
- **D-06:** read.ts retains command orchestration: parse args -> fetch blocks -> call enrichBlocks() -> render -> output. Target: from 592 lines to ~200 lines.
- **D-07:** enrichBlocks() accepts options parameter controlling which enrichments are enabled (images, bitable, sheet, board, mentions).
- **D-08:** Helper functions (extractFileTokens, extractBitableTokens, extractSheetTokens, extractBoardTokens, extractMentionUserIds) are internal to doc-enrichment.ts, not exported. Export only enrichBlocks() and each fetch function (for testing).
- **D-09:** Build zero-dependency pLimit-style concurrency limiter at `src/utils/concurrency.ts`, exporting `pLimit(concurrency: number)`.
- **D-10:** Default concurrency = 5 (Feishu API QPS usually 50/s, 5 concurrent leaves margin). Concurrency passed as parameter, configurable.
- **D-11:** Use `Promise.allSettled()` for all enrichment requests. Existing try/catch per-token graceful degradation preserved -- failed enrichments emit stderr warning, don't interrupt document rendering.
- **D-12:** Concurrency limiter must have test coverage: verify concurrency limit, all-success, partial-failure, all-failure scenarios.
- **D-13:** All 400 existing tests must pass without modification. If tests need updating due to import path changes, it signals external interface leakage -- handle carefully.
- **D-14:** Add unit tests for new modules (doc-enrichment.ts, concurrency.ts).
- **D-15:** Coverage must not drop below 83.70% after refactoring.

### Claude's Discretion
- RenderContext field definitions
- Renderer function granularity within blocks-to-md.ts
- Enrichment request grouping strategy in doc-enrichment.ts
- Concurrency limiter internal implementation details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REF-01 | blocks-to-md.ts from if-chain to ReadonlyMap<number, BlockRenderer> dispatch table | Dispatch table pattern documented below; 31 branches mapped to BlockType constants; TreeNode + RenderContext types defined |
| REF-02 | read.ts extract enrichment logic to services/doc-enrichment.ts | Enrichment functions identified (lines 33-369 of read.ts); service module pattern from doc-blocks.ts/wiki-nodes.ts documented |
| REF-03 | Serial enrichment to Promise.allSettled() with concurrency limiter | p-limit API pattern researched; ~30-line zero-dep implementation; Promise.allSettled graceful degradation compatible with existing error handling |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Source compilation | Project standard, strict mode |
| tsx | 4.21.0 | Test execution engine | Project standard for running tests |
| node:test | built-in | Test framework | Project zero-dependency constraint |
| assert/strict | built-in | Assertions | Project standard |

### Supporting
No new dependencies. Zero-dependency constraint (from CLAUDE.md) prohibits adding production packages. The concurrency limiter is self-built.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Self-built pLimit | npm p-limit | Violates zero-dependency constraint; p-limit itself depends on yocto-queue |
| ReadonlyMap dispatch | switch statement | Map is more flexible for runtime registration, aligns with D-01 decision |
| Promise.allSettled | Promise.all with try/catch wrappers | allSettled is cleaner -- each result is always settled, no need for wrapper functions |

## Architecture Patterns

### Recommended Project Structure (after Phase 4)
```
src/
  parser/
    blocks-to-md.ts     # ~600-700 lines (from 822), dispatch table + renderers
    block-types.ts       # Unchanged (BlockType constants)
    text-elements.ts     # Unchanged (inline element rendering)
  commands/
    read.ts              # ~200 lines (from 592), orchestration only
  services/
    doc-enrichment.ts    # NEW: ~350 lines, enrichment functions extracted from read.ts
    doc-blocks.ts        # Unchanged
    wiki-nodes.ts        # Unchanged
    image-download.ts    # Unchanged
  utils/
    concurrency.ts       # NEW: ~40 lines, pLimit-style concurrency limiter
```

### Pattern 1: Dispatch Table (REF-01)

**What:** Replace 31-branch if/else-if chain with a `ReadonlyMap<number, BlockRenderer>` lookup.

**When to use:** When a function dispatches on a single discriminant (block_type number) with many branches.

**Current renderNode signature:**
```typescript
function renderNode(
  node: TreeNode, lines: string[], ctx: BlocksRenderCtx,
  depth: number, state: RenderState
): void
```

**New architecture:**
```typescript
// RenderContext consolidates all parameters into one object
interface RenderContext {
  lines: string[];
  ctx: BlocksRenderCtx;
  depth: number;
  state: RenderState;
}

// Unified renderer signature per D-01
type BlockRenderer = (node: TreeNode, rctx: RenderContext) => string;

// Dispatch table
const RENDERERS: ReadonlyMap<number, BlockRenderer> = new Map([
  [BlockType.PAGE, renderPage],
  [BlockType.TEXT, renderText],
  [BlockType.BULLET, renderBullet],
  [BlockType.ORDERED, renderOrdered],
  // ... all 31+ block types
]);

// renderNode becomes 3-5 lines per D-03
function renderNode(node: TreeNode, rctx: RenderContext): void {
  const renderer = RENDERERS.get(node.block_type);
  if (renderer) {
    const result = renderer(node, rctx);
    if (result) rctx.lines.push(result);
  } else {
    // Unknown type fallback
    rctx.ctx.warnings.push(`不支持的内容类型: ${node.block_type}`);
    rctx.lines.push(`[不支持的内容类型: ${node.block_type}]`);
    rctx.lines.push("");
  }
}
```

**Key design consideration:** The renderers return `string` per D-01, but the current code pushes multiple lines to an array and sometimes calls `renderChildren` recursively. Two approaches:

Option A: Renderers push directly to `rctx.lines` and return `""` (void-like). This preserves the current push-based pattern minimally.

Option B: Renderers return the full string (with `\n` joins) and the caller pushes. This requires collecting child output into strings.

**Recommendation:** Use Option A (push to lines, return empty string for most renderers) because the current code interleaves `lines.push()` and `renderChildren()` calls. Changing to pure return-value would require rewriting how child rendering works. The dispatch table benefit is removing the if-chain, not changing the rendering model. The `BlockRenderer` type can be `(node: TreeNode, rctx: RenderContext) => void` instead of returning string, which is more honest about the push-based pattern. Claude has discretion here per CONTEXT.md.

### Pattern 2: Service Extraction (REF-02)

**What:** Move enrichment functions from a command file to a dedicated service module.

**Pattern from existing services:**
```typescript
// doc-blocks.ts pattern: export named functions, no default export
export async function fetchAllBlocks(
  authInfo: AuthInfo,
  documentId: string,
): Promise<Block[]> { ... }
```

**New doc-enrichment.ts follows same pattern:**
```typescript
/** Enrichment options controlling which features to run */
export interface EnrichmentOptions {
  images?: boolean;     // default: true
  bitable?: boolean;    // default: true
  sheet?: boolean;      // default: true
  board?: boolean;      // default: true
  mentions?: boolean;   // default: true
  concurrency?: number; // default: 5
}

/** Enrichment result maps, passed to blocksToMarkdown */
export interface EnrichmentResult {
  imageUrlMap: Map<string, string>;
  userNameMap: Map<string, string>;
  bitableDataMap: Map<string, { fields: string[]; records: unknown[][] }>;
  boardImageMap: Map<string, string>;
  sheetDataMap: Map<string, { fields: string[]; records: unknown[][]; title?: string }>;
}

/** Single entry point per D-05 */
export async function enrichBlocks(
  authInfo: AuthInfo,
  blocks: Block[],
  globalOpts: GlobalOpts,
  options?: EnrichmentOptions,
): Promise<EnrichmentResult> { ... }
```

### Pattern 3: Concurrency Limiter (REF-03)

**What:** Zero-dependency pLimit implementation using Promise queue.

**API design (mirroring sindresorhus/p-limit):**
```typescript
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
```

**Core implementation (~30 lines):**
```typescript
export function pLimit(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Expected concurrency to be a positive integer");
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}
```

### Pattern 4: Promise.allSettled Enrichment (REF-03)

**Current serial pattern (read.ts lines 492-566):**
```typescript
for (const token of bitableTokens) {
  try {
    const data = await fetchBitableData(authInfo, token);
    if (data) bitableDataMap.set(token, data);
  } catch (err) { /* stderr warning */ }
}
```

**New parallel pattern:**
```typescript
const limit = pLimit(options.concurrency ?? 5);

// Collect all enrichment tasks
const tasks: Array<Promise<PromiseSettledResult<void>>> = [];

for (const token of bitableTokens) {
  tasks.push(limit(() => fetchBitableData(authInfo, token)
    .then(data => { if (data) bitableDataMap.set(token, data); })
  ));
}
// ... similar for board, sheet

const results = await Promise.allSettled(tasks);

// Log failures as warnings (preserving existing graceful degradation)
for (const result of results) {
  if (result.status === "rejected") {
    // stderr warning based on error type
  }
}
```

### Anti-Patterns to Avoid
- **Breaking the public API of blocksToMarkdown():** The function signature `blocksToMarkdown(blocks, options)` and its `BlocksToMarkdownOptions` interface must remain identical. `cat` command also consumes this function.
- **Exporting extract* helper functions:** Per D-08, these are internal to doc-enrichment.ts. Only `enrichBlocks()` and the individual fetch functions are exported.
- **Mutating blocks array in enrichment:** Enrichment returns maps that are passed as options to blocksToMarkdown; it does not modify the Block objects.
- **Using Promise.all instead of Promise.allSettled:** Promise.all short-circuits on first rejection. The enrichment pipeline must handle partial failures gracefully.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test framework | Custom test runner | `node:test` + `assert/strict` | Project constraint, already proven in 400 tests |
| HTTP mocking | Custom interceptor | `test/helpers/mock-fetch.ts` | Established pattern from Phase 1, reuse directly |
| Output capture | Manual stdout hook | `test/helpers/capture-output.ts` | Established pattern from Phase 2 |

**Key insight:** This phase creates no new infrastructure. Both new modules (concurrency.ts, doc-enrichment.ts) are straightforward extractions. The concurrency limiter is the only "new" code, and it's ~30 lines.

## Common Pitfalls

### Pitfall 1: Breaking blocksToMarkdown Signature
**What goes wrong:** Changing how `blocksToMarkdown` is called from `cat.ts` or `read.ts` would break those callers.
**Why it happens:** Over-eager refactoring of the render context to include "enrichment-aware" data.
**How to avoid:** `blocksToMarkdown(blocks, options)` signature and `BlocksToMarkdownOptions` interface stay identical. The `BlocksRenderCtx` internal type and `RenderContext` are internal to the module.
**Warning signs:** `cat.ts` import or call site needs changes.

### Pitfall 2: Test Import Path Changes
**What goes wrong:** If `read.test.ts` imports internal functions from `read.ts` that were moved to `doc-enrichment.ts`, tests break.
**Why it happens:** read.test.ts tests the `read` command handler function directly, not the extracted helper functions. Since read.test.ts only imports `{ read }`, and `read` remains exported from `read.ts`, this should be safe.
**How to avoid:** Verify read.test.ts only imports `read` from `../src/commands/read.js` (confirmed: line 27). The enrichment functions were never exported from read.ts.
**Warning signs:** Any test file needing import path changes violates D-13.

### Pitfall 3: Concurrency Limiter Deadlock
**What goes wrong:** If the concurrency limiter's queue doesn't drain properly, tasks hang indefinitely.
**Why it happens:** Missing `finally` clause in the promise chain, or not calling `next()` after task completion.
**How to avoid:** The implementation above uses `.finally(() => { active--; next(); })` which guarantees cleanup. Test with the all-failure scenario (D-12).
**Warning signs:** Tests hang with timeout; active count never decreases.

### Pitfall 4: Promise.allSettled Error Handling Mismatch
**What goes wrong:** The current code has specific error handling per enrichment type (bitable permission errors get specific warning messages; sheet errors include error message). Moving to allSettled may lose this specificity.
**Why it happens:** allSettled collapses all rejections into `PromiseSettledResult.reason`, losing context about which token and which type failed.
**How to avoid:** Wrap each enrichment call in a try/catch INSIDE the limit function, preserving the per-token error handling. Don't rely on allSettled's rejection reason for error messages -- handle errors inline, just like the current code does, but now inside concurrent tasks.
**Warning signs:** Generic error messages instead of the specific Chinese warning strings.

### Pitfall 5: RenderContext Design Breaking Existing Tests
**What goes wrong:** blocks-to-md.test.ts calls `blocksToMarkdown(blocks, options)` directly. If the internal refactoring changes how the function processes options, tests fail.
**Why it happens:** The RenderContext is internal to the module. As long as `blocksToMarkdown` constructs it correctly from the passed `BlocksToMarkdownOptions`, tests pass.
**How to avoid:** `blocksToMarkdown` function body still creates `BlocksRenderCtx` from options, then wraps it in `RenderContext` for the dispatch table. The public interface is unchanged.
**Warning signs:** blocks-to-md.test.ts assertions failing on output format.

### Pitfall 6: Ordered List State Management in Dispatch Table
**What goes wrong:** Ordered list rendering depends on `state.orderedIndex` which is tracked across sibling calls. The dispatch table makes each renderer independent, but ordered list numbering requires cross-renderer state.
**Why it happens:** The current `renderNode` takes `state: RenderState` which carries `orderedIndex` between calls. This state is managed by `renderChildren` and the root loop in `blocksToMarkdown`.
**How to avoid:** Include `state: RenderState` in `RenderContext`. The ordered list renderer reads/writes `rctx.state.orderedIndex`. The `renderChildren` helper manages state resetting (same as current code).
**Warning signs:** Ordered lists all starting at 1 instead of incrementing.

## Code Examples

### Current renderNode if-chain (representative excerpt)
```typescript
// Source: src/parser/blocks-to-md.ts lines 238-296
function renderNode(node: TreeNode, lines: string[], ctx: BlocksRenderCtx,
  depth: number, state: RenderState): void {
  const type = node.block_type;
  const indent = "  ".repeat(depth);

  if (type === BlockType.PAGE) {
    renderChildren(node._children, lines, ctx, depth);
    return;
  }
  if (type === BlockType.TEXT) {
    const text = getElements(node, "text", ctx);
    lines.push(indent + text);
    lines.push("");
    return;
  }
  // ... 29 more branches
}
```

### Existing service module pattern (doc-blocks.ts)
```typescript
// Source: src/services/doc-blocks.ts
import { fetchWithAuth } from "../client.js";
import type { AuthInfo, Block } from "../types/index.js";
import type { DocxBlocksResponse } from "../types/api-responses.js";

export async function fetchAllBlocks(
  authInfo: AuthInfo, documentId: string,
): Promise<Block[]> {
  const blocks: Block[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetchWithAuth<DocxBlocksResponse>(authInfo, url, { params });
    if (data?.items) blocks.push(...data.items);
    pageToken = data?.has_more ? data.page_token : undefined;
  } while (pageToken);
  return blocks;
}
```

### read.ts enrichment section to extract (lines 461-566)
```typescript
// Source: src/commands/read.ts lines 461-566
// This entire section (images, mentions, bitable, board, sheet) moves to doc-enrichment.ts
const fileTokens = extractFileTokens(blocks);
let imageUrlMap = new Map<string, string>();
if (fileTokens.length > 0) { /* ... withScopeRecovery ... */ }

let userNameMap = new Map<string, string>();
const mentionUserIds = extractMentionUserIds(blocks);
if (mentionUserIds.length > 0) { /* ... resolveUserNames ... */ }

const bitableTokens = extractBitableTokens(blocks);
for (const token of bitableTokens) { /* serial await */ }

const boardTokens = extractBoardTokens(blocks);
for (const token of boardTokens) { /* serial await */ }

const sheetTokens = extractSheetTokens(blocks);
for (const token of sheetTokens) { /* serial await */ }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| if/else-if chains for type dispatch | Map/Record dispatch tables | Standard practice | Eliminates deeply nested conditionals, enables O(1) dispatch |
| Serial for+await | Promise.allSettled + concurrency limiter | ES2020+ | Parallel execution with graceful partial failure handling |
| Monolithic command files | Service layer extraction | Architecture pattern | Enables independent testing and reuse |

**Relevant to this codebase:**
- `Promise.allSettled` has been stable since Node 12.9.0 (well within Node >= 18.3.0 requirement)
- `ReadonlyMap` is available since TypeScript 2.0 (well within TS 5.9.3)
- The existing `fetchBitableData` already uses `Promise.all` internally for fields+records (read.ts line 163), proving the pattern works with the mock infrastructure

## Open Questions

1. **RenderContext vs void return**
   - What we know: D-01 specifies `(node: TreeNode, ctx: RenderContext) => string`, but many renderers push multiple lines and call renderChildren recursively
   - What's unclear: Whether returning string is practical or if void (push-based) is better
   - Recommendation: Claude has discretion here. Use void/push-based approach internally, which minimizes changes to rendering logic. The dispatch table benefit comes from eliminating the if-chain, not from changing push-to-return semantics.

2. **withScopeRecovery in enrichment**
   - What we know: Image URL resolution uses `withScopeRecovery` which calls `createClient(globalOpts)` internally for token refresh. This means `doc-enrichment.ts` needs access to `globalOpts`.
   - What's unclear: Whether to pass globalOpts through or restructure the scope recovery call
   - Recommendation: Pass `globalOpts` as parameter to `enrichBlocks()`. The `withScopeRecovery` wrapper stays in the image resolution path inside doc-enrichment.ts.

3. **Bitable/Sheet/Board permission error specificity**
   - What we know: Current code has distinct Chinese warning messages per enrichment type and per error type (permission vs generic failure)
   - What's unclear: How to preserve these specific messages in the parallelized version
   - Recommendation: Keep the try/catch inside each enrichment task function, emitting specific warnings synchronously. The pLimit wrapper just controls concurrency, not error handling.

## Project Constraints (from CLAUDE.md)

These directives from CLAUDE.md apply to all Phase 4 work:

- **Zero-dependency:** No new production dependencies. Concurrency limiter must be self-built.
- **Node.js built-in testing:** Use `node:test` + `assert/strict`, run via `tsx --test`.
- **API compatibility:** CLI command interface (arguments, output format) must not change.
- **Backward compatibility:** All existing tests must pass after refactoring.
- **ESM only:** All imports use `.js` extension. `"type": "module"` in package.json.
- **Strict TypeScript:** `strict: true` in tsconfig.json.
- **No default exports:** All modules export named functions.
- **kebab-case files:** New files follow `doc-enrichment.ts`, `concurrency.ts` naming.
- **Immutability:** Return new objects, don't mutate inputs. This is critical for the enrichment extraction -- enrichBlocks returns new maps, doesn't modify blocks.
- **Error handling:** Use CliError for user-facing errors. Graceful degradation for non-critical failures (stderr warnings).
- **Output conventions:** stdout for data, stderr for messages. `process.stdout.write()` / `process.stderr.write()`, never console.log.
- **JSDoc in English:** All exported functions get `/** */` JSDoc comments in English.
- **Coverage threshold:** `npm run test:coverage` must pass at 80% line / 70% branch / 80% function.

## Sources

### Primary (HIGH confidence)
- Source code analysis of `src/parser/blocks-to-md.ts` (822 lines, 31 if-branches counted)
- Source code analysis of `src/commands/read.ts` (592 lines, enrichment in lines 461-566)
- Source code analysis of existing service modules (`doc-blocks.ts`, `wiki-nodes.ts`) for extraction patterns
- Test suite: 400 tests passing, 83.70% line coverage verified via `npm run test:coverage`
- `test/blocks-to-md.test.ts` (658 lines) and `test/read.test.ts` (901 lines) verified as regression safety net

### Secondary (MEDIUM confidence)
- [sindresorhus/p-limit](https://github.com/sindresorhus/p-limit) -- API design reference for concurrency limiter
- [ZacharyL2/p-limiter](https://github.com/islizeqiang/p-limiter) -- Zero-dependency concurrency limiter pattern reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, using established project tools
- Architecture: HIGH - All patterns derived from existing codebase analysis
- Pitfalls: HIGH - Based on direct analysis of current code structure and test dependencies

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable codebase, no external dependency changes)
