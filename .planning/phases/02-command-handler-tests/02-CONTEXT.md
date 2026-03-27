# Phase 2: 命令处理器集成测试 - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

为全部 18 个命令处理器编写集成测试，验证 command→service→client→fetch 完整调用链，覆盖 --json 和人类可读两种输出模式。整体行覆盖率达到 80%、分支覆盖率 70%、函数覆盖率 80%。本阶段不涉及代码重构（Phase 4）或安全修复（Phase 3）。

</domain>

<decisions>
## Implementation Decisions

### 测试隔离层级
- **D-01:** 统一在 globalThis.fetch 层级 mock，测试 command→service→client→fetch 完整链路。复用 Phase 1 的 `setupMockFetch`、`jsonResponse`、`tenantTokenResponse` 辅助函数。
- **D-02:** 每个测试需要设置完整的 mock 响应链：tenant token 响应 + 实际 API 响应。通过 `setupMockFetch` 的有序响应队列实现。

### 输出验证策略
- **D-03:** --json 模式为主测试目标：解析 JSON 输出并检查关键字段是否存在且类型正确（结构化断言）。不做精确字符串匹配。
- **D-04:** 人类可读模式为辅助验证：仅检查关键字符串包含（contains），不做精确输出匹配，避免格式微调破坏测试。

### 命令分组
- **D-05:** 按领域分组为 4 个执行计划：
  - Plan 1: 文档操作 — read, create, update, delete, cat（核心 CRUD + 流式读取）
  - Plan 2: 知识库与导航 — wiki（6个子命令）, tree, spaces
  - Plan 3: 云盘操作 — ls, mv, cp, mkdir
  - Plan 4: 权限与其他 — share（5个子命令）, search, info, login/authorize/logout + 覆盖率达标验证

### 已有测试处理
- **D-06:** 保留 info.test.ts 和 share.test.ts 中的现有测试，在同一文件中追加新的集成测试 describe 块。不重写、不迁移。

### Carry-forward from Phase 1
- **D-07:** 继续使用 `{ concurrency: 1 }` 控制涉及 globalThis.fetch 和 process.env 的测试块并发。
- **D-08:** 测试文件命名遵循 `{command-name}.test.ts` 模式，存放在 `test/` 目录。
- **D-09:** 所有导入使用 `.js` 扩展名（ESM 要求）。

### Claude's Discretion
- 每个命令具体测试哪些场景和边界条件
- mock 数据的具体结构和内容
- describe 块的组织粒度
- 是否需要为大命令（read 592行、wiki 406行）创建额外的辅助函数

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目文档
- `.planning/PROJECT.md` — 项目目标、约束和关键决策
- `.planning/REQUIREMENTS.md` — v1 需求清单（Phase 2: CMD-01~CMD-10）
- `.planning/phases/01-testing-infra-core-tests/01-CONTEXT.md` — Phase 1 决策（mock 策略、覆盖率管道）

### 代码库分析
- `.planning/codebase/CONCERNS.md` — 测试覆盖缺口、大文件分析
- `.planning/codebase/ARCHITECTURE.md` — 架构分层和命令处理器模式
- `.planning/codebase/CONVENTIONS.md` — 编码规范和命令注册模式

### 测试基础设施（Phase 1 产出）
- `test/helpers/mock-fetch.ts` — setupMockFetch, jsonResponse, tenantTokenResponse
- `test/helpers/env-guard.ts` — withCleanEnv, withNoAuthEnv
- `test/helpers/factory.ts` — makeAuthInfo, makeUserAuthInfo, makeGlobalOpts, makeApiResponse
- `.c8rc.json` — 覆盖率阈值配置

### 关键源文件（测试目标）
- `src/commands/read.ts` (592行) — 最大命令，含丰富化逻辑
- `src/commands/wiki.ts` (406行) — 6个子命令
- `src/commands/share.ts` (393行) — 5个子命令
- `src/commands/update.ts` (330行) — 追加/覆写/恢复模式
- `src/commands/create.ts` (207行) — 云盘/wiki创建
- `src/commands/cat.ts` (207行) — 流式块输出
- `src/cli.ts` — 命令注册和分发逻辑

### 已有测试文件（需扩展）
- `test/info.test.ts` (65行) — URL生成逻辑测试
- `test/share.test.ts` (82行) — 部分覆盖

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/helpers/mock-fetch.ts` — 有序 fetch mock，支持多次调用序列，Phase 1 验证可靠
- `test/helpers/factory.ts` — makeAuthInfo、makeGlobalOpts 工厂，所有命令测试可直接使用
- `test/helpers/env-guard.ts` — withCleanEnv 环境隔离，login/authorize 测试需要
- `test/client.test.ts` — 22个 client 测试，展示了 fetchWithAuth mock 的完整模式

### Established Patterns
- 命令处理器统一导出 `meta: CommandMeta` 和处理器函数
- 所有命令通过 `globalOpts.json` 支持 --json 模式
- stdout 用于数据输出，stderr 用于消息/错误
- 命令处理器接收 `(args, globalOpts)` 参数
- API 错误通过 CliError 抛出，handleError 格式化输出

### Integration Points
- `src/cli.ts` 的 `COMMANDS` record — 所有命令的注册入口
- `src/client.ts` 的 `createClient()` — 所有命令的 API 访问入口
- `process.stdout.write` / `process.stderr.write` — 输出捕获需要 mock 或拦截

</code_context>

<specifics>
## Specific Ideas

- 测试命令处理器时需要 mock `process.stdout.write` 来捕获输出，验证 JSON 结构和关键内容
- read 命令的丰富化逻辑（图片URL、用户名、bitable/sheet/board）是最复杂的测试场景，需要多层 mock 响应
- wiki 和 share 的子命令分发需要验证子命令路由正确性
- login/authorize 涉及 OAuth 流程和浏览器打开，需要 mock child_process.exec 和 http.createServer

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-command-handler-tests*
*Context gathered: 2026-03-27*
