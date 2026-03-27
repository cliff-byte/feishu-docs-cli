# Phase 4: 代码重构 - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** Auto-mode (recommended defaults selected)

<domain>
## Phase Boundary

在完整测试保护（400 tests, 83.70% line coverage）下，拆分两个大文件并优化性能瓶颈：(1) blocks-to-md.ts (822行) 从 if-chain 重构为 ReadonlyMap 分发表；(2) read.ts (592行) 提取丰富化逻辑到 services/doc-enrichment.ts；(3) 嵌入内容串行获取改为 Promise.allSettled() 并行化。所有既有测试必须继续通过，覆盖率不低于重构前。本阶段不涉及新功能或 CLI 接口变更。

</domain>

<decisions>
## Implementation Decisions

### 分发表设计 (REF-01: blocks-to-md.ts)
- **D-01:** 使用 `ReadonlyMap<number, BlockRenderer>` 分发表替代 renderNode 函数中的 if-chain。渲染函数签名统一为 `(node: TreeNode, ctx: RenderContext) => string`，其中 RenderContext 封装缩进、选项等上下文。
- **D-02:** 所有渲染函数保留在同一文件中（blocks-to-md.ts），作为文件顶级命名函数导出。不拆分为独立文件——块渲染器之间共享 RenderContext 和 elementsToMarkdown 辅助函数，拆分会导致循环依赖。
- **D-03:** renderNode 变为轻量分发器：`const renderer = RENDERERS.get(node.type); return renderer ? renderer(node, ctx) : "";`。未知块类型返回空字符串（保持现有行为）。
- **D-04:** 目标行数：blocks-to-md.ts 从 822 行降至约 600-700 行（消除重复的 if/else if 分支和缩进层级）。

### 丰富化服务接口 (REF-02: read.ts → doc-enrichment.ts)
- **D-05:** 创建 `src/services/doc-enrichment.ts`，提供单一入口函数 `enrichBlocks(authInfo, blocks, opts)`，返回 enriched blocks。内部按类型分为独立函数：`resolveImageUrls()`、`fetchBitableData()`、`fetchSheetData()`、`fetchBoardImage()`、`resolveUserNames()`。
- **D-06:** read.ts 保留命令编排逻辑：解析参数 → 获取块 → 调用 enrichBlocks() → 渲染 → 输出。目标行数从 592 行降至约 200 行。
- **D-07:** enrichBlocks() 接受 options 参数控制哪些丰富化启用（images, bitable, sheet, board, mentions），便于测试和未来扩展。
- **D-08:** 提取的辅助函数（extractFileTokens, extractBitableTokens, extractSheetTokens, extractBoardTokens, extractMentionUserIds）作为 doc-enrichment.ts 的内部函数，不导出。只导出 enrichBlocks() 和各 fetch 函数（后者用于测试）。

### 并行化并发策略 (REF-03: Promise.allSettled)
- **D-09:** 自建零依赖的 pLimit 风格并发限制器 `src/utils/concurrency.ts`，导出 `pLimit(concurrency: number)` 函数。实现基于 Promise 队列，不引入生产依赖。
- **D-10:** 默认并发数为 5（飞书 API QPS 限制通常为 50/s，5 并发留有余量且显著优于串行）。并发数通过参数传入，可配置。
- **D-11:** 使用 `Promise.allSettled()` 处理所有丰富化请求，已有的 try/catch 按 token 优雅降级模式保持不变——失败的丰富化输出 stderr 警告但不中断文档渲染。
- **D-12:** 并发限制器需有测试覆盖：验证并发数限制、全部成功、部分失败、全部失败场景。

### 测试策略
- **D-13:** 重构是纯内部改动，所有 400 个既有测试必须无修改通过。如有测试需要更新（因导入路径变更），说明重构影响了外部接口，需审慎处理。
- **D-14:** 为新模块（doc-enrichment.ts, concurrency.ts）添加单元测试。并发限制器测试验证并发行为；丰富化服务测试验证提取和聚合逻辑。
- **D-15:** 重构后覆盖率不低于 83.70%（重构前水平），`npm run test:coverage` 继续通过。

### Claude's Discretion
- RenderContext 的具体字段定义
- blocks-to-md.ts 内渲染函数的具体拆分粒度
- doc-enrichment.ts 中丰富化请求的具体分组方式
- 并发限制器的内部实现细节

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目文档
- `.planning/PROJECT.md` — 项目目标、约束和关键决策
- `.planning/REQUIREMENTS.md` — v1 需求清单（Phase 4: REF-01, REF-02, REF-03）
- `.planning/codebase/CONCERNS.md` — 技术债务和重构方向详细分析
- `.planning/codebase/ARCHITECTURE.md` — 架构分层和模块职责
- `.planning/codebase/CONVENTIONS.md` — 命名规范和代码风格

### Phase 1-3 上下文
- `.planning/phases/01-testing-infra-core-tests/01-CONTEXT.md` — mock 策略、测试辅助工具
- `.planning/phases/02-command-handler-tests/02-CONTEXT.md` — 命令测试模式、输出验证
- `.planning/phases/03-security-typed-api/03-CONTEXT.md` — 类型化 API 响应模式

### 重构目标文件
- `src/parser/blocks-to-md.ts` (822行) — if-chain → 分发表重构
- `src/commands/read.ts` (592行) — 丰富化逻辑提取
- `src/parser/text-elements.ts` — elementsToMarkdown 辅助函数（blocks-to-md 依赖）
- `src/parser/block-types.ts` — BlockType 常量定义

### 服务层参考
- `src/services/doc-blocks.ts` — fetchAllBlocks（类型化 API 模式参考）
- `src/services/wiki-nodes.ts` — 类型化 fetchWithAuth<T> 模式参考
- `src/services/image-download.ts` — 图片下载服务（丰富化依赖）

### 测试基础设施
- `test/helpers/mock-fetch.ts` — fetch mock 辅助
- `test/helpers/factory.ts` — 测试数据工厂
- `test/blocks-to-md.test.ts` — 现有块渲染测试（重构后必须通过）
- `test/read.test.ts` — 现有 read 命令测试（重构后必须通过）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types/api-responses.ts` — Phase 3 创建的类型化 API 响应接口，doc-enrichment.ts 可直接使用
- `src/services/doc-blocks.ts` — fetchAllBlocks 展示了类型化 fetchWithAuth<T> 的使用模式
- `test/helpers/mock-fetch.ts` — 新模块测试可直接复用

### Established Patterns
- 服务模块导出独立命名函数，无默认导出
- 所有导入使用 `.js` 扩展名（ESM 要求）
- 类型定义集中在 `src/types/` 下
- 块渲染依赖 TreeNode 结构（块树在 blocksToMarkdown 内部构建）
- read.ts 中已有 `Promise.all` 用于 bitable fields+records 并行获取（局部并行）

### Integration Points
- `src/parser/blocks-to-md.ts` → blocksToMarkdown() 被 read 和 cat 命令调用
- `src/commands/read.ts` 中的丰富化函数仅被 read 命令自身调用
- `src/client.ts` fetchWithAuth<T> — 所有 API 调用的统一入口
- `src/utils/` — 新的 concurrency.ts 放置于此

</code_context>

<specifics>
## Specific Ideas

- blocks-to-md.ts 的 renderNode 函数当前包含约 30+ 个 if/else if 分支，每个处理一种 BlockType。提取为 Map 后 renderNode 变为 3-5 行。
- read.ts 的丰富化循环（约 493-566 行）是串行 for+await 模式：先 bitable，再 board，再 sheet。改为收集所有丰富化任务后 Promise.allSettled() 一次性并发执行。
- 并发限制器参考 sindresorhus/p-limit 的 API 设计（零依赖自建），核心约 30 行代码。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-refactoring-performance*
*Context gathered: 2026-03-27 via auto-mode*
