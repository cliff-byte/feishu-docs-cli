# Phase 1: 测试基础设施与核心路径测试 - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

搭建可靠的测试覆盖率管道和测试辅助工具库，为认证链（resolveAuth、token 加解密、OAuth 刷新锁）、API 客户端（fetchWithAuth、createClient、fetchBinaryWithAuth）和文档操作服务（clearDocument、备份/恢复、document-resolver）编写单元测试。本阶段不涉及命令处理器的集成测试（Phase 2）或代码重构（Phase 4）。

</domain>

<decisions>
## Implementation Decisions

### 覆盖率管道
- **D-01:** 使用 c8 ^11.0.0 作为覆盖率工具（devDependency），优先尝试 `c8 tsx --test` 管道。若 tsx 源码映射导致数据不可靠，回退到 `tsc && c8 node --test dist/` 方案。
- **D-02:** 覆盖率阈值通过 `.c8rc.json` 配置（行 80% / 分支 70% / 函数 80%），在 package.json 中添加 `test:coverage` 脚本。阈值在 Phase 1 结束时不强制（允许低于 80%），待 Phase 2 完成后激活。
- **D-03:** 覆盖率报告输出 HTML 和 lcov 格式到 `coverage/` 目录，将 `coverage/` 添加到 `.gitignore`。

### Mock 策略
- **D-04:** API 调用测试统一使用 `globalThis.fetch` 替换模式（参考现有 `test/fetch-binary.test.ts`）。对于复杂模块（如 createClient），结合依赖注入模式使核心逻辑可测试。
- **D-05:** 严格禁止使用 `mock.module()`（实验性 API，Node 18 不可用，有已知 ESM 缓存重置 bug）。
- **D-06:** 使用 `t.mock.method()` 和 `t.mock.fn()`（Stability 2）替代手动保存/恢复，确保测试间自动清理。

### 测试辅助工具组织
- **D-07:** 创建 `test/helpers/` 目录，包含三个共享模块：
  - `mock-fetch.ts` — 统一的 fetch mock 设置/清理，支持多次调用序列
  - `env-guard.ts` — `withCleanEnv()` 辅助函数，隔离环境变量修改
  - `factory.ts` — 通用测试数据工厂（AuthInfo、GlobalOpts 等）
- **D-08:** 现有测试文件中的内联工厂函数（如 `blocks-to-md.test.ts` 中的 `makeBlocks()`）保持不动，不做迁移。

### 认证测试隔离
- **D-09:** 所有涉及环境变量或文件系统的测试 describe 块使用 `{ concurrency: 1 }` 防止并行污染。
- **D-10:** 认证测试使用临时目录替代 `~/.feishu-docs/`，通过依赖注入控制配置目录路径。
- **D-11:** token 加密/解密测试采用 round-trip 方式验证：生成密钥 → 加密 → 解密 → 断言与原始值相等。

### Claude's Discretion
- 具体测试用例的组织和命名风格
- mock-fetch 辅助函数的 API 设计细节
- 各测试文件内的 describe 块粒度

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目文档
- `.planning/PROJECT.md` — 项目目标、约束和关键决策
- `.planning/REQUIREMENTS.md` — v1 需求清单和追踪矩阵（Phase 1: TEST-01~05, CORE-01~07）
- `.planning/research/SUMMARY.md` — 研究摘要，包含技术栈推荐和 pitfall 列表
- `.planning/research/STACK.md` — c8、knip 工具推荐和 mock 策略详解
- `.planning/research/PITFALLS.md` — 14 个领域特定陷阱及预防策略

### 代码库分析
- `.planning/codebase/TESTING.md` — 当前测试模式、框架、覆盖率现状
- `.planning/codebase/CONVENTIONS.md` — 编码规范和导入约定
- `.planning/codebase/ARCHITECTURE.md` — 架构分层和数据流
- `.planning/codebase/CONCERNS.md` — 测试覆盖缺口详细分析

### 关键源文件
- `src/client.ts` — fetchWithAuth、fetchBinaryWithAuth、createClient（核心测试目标）
- `src/auth.ts` — resolveAuth、oauthLogin、token 加解密、refreshUserToken（核心测试目标）
- `src/services/block-writer.ts` — clearDocument、backupDocument、rotateBackups（核心测试目标）
- `src/utils/document-resolver.ts` — resolveDocument、allowFallback（核心测试目标）
- `test/fetch-binary.test.ts` — 现有 globalThis.fetch mock 模式参考

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/fetch-binary.test.ts` 中的 `mockResponse()` 工厂函数 — 可作为 mock-fetch 辅助模块的基础
- `test/scope-prompt.test.ts` 中的 `makeGlobalOpts()` — 可提取到共享 factory
- `test/scope-prompt.test.ts` 中的环境变量保存/恢复模式 — `withCleanEnv()` 的实现参考
- `test/image-download.test.ts` 中的临时目录模式 — 认证测试隔离的参考

### Established Patterns
- 测试文件扁平存放在 `test/` 目录，命名 `{module-name}.test.ts`
- 从 `../src/...` 导入，带 `.js` 扩展名（ESM 要求）
- `describe`/`it` 块嵌套组织，描述使用 "should" 前缀
- `beforeEach`/`afterEach` 用于全局状态保存/恢复

### Integration Points
- `package.json` scripts — 添加 `test:coverage` 脚本
- `.c8rc.json` — 新增覆盖率配置文件
- `.gitignore` — 添加 `coverage/` 目录

</code_context>

<specifics>
## Specific Ideas

- 研究明确建议第一天验证 c8 + tsx 管道可靠性（PITFALLS #5），如发现 tsx >= 4.3.0 的源码映射 bug 导致数据不准，立即切换到 tsc 编译方案
- `withCleanEnv()` 应支持批量设置和恢复多个环境变量，参考 `test/scope-prompt.test.ts` 中逐个保存的模式
- `mock-fetch` 辅助工具应支持按调用次序返回不同响应（第 1 次返回 tenant token，第 2 次返回实际 API 响应），参考 `test/fetch-binary.test.ts` 的 fetchCallCount 模式

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-testing-infra-core-tests*
*Context gathered: 2026-03-26*
