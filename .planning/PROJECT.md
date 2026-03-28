# feishu-docs-cli

## What This Is

feishu-docs-cli 是一个零依赖的 Node.js CLI 工具，用于读写飞书/Lark 云文档和知识库。v1.0 质量加固迭代完成后，项目具备生产级测试覆盖（456 tests, 80%+ coverage）、类型安全的 API 层、自动重试机制和代码质量工具链。

## Core Value

**核心路径必须有测试保护** — 认证、API 通信、命令处理器等关键路径需达到 80% 测试覆盖率，确保任何重构或新功能不会静默破坏现有行为。

## Requirements

### Validated

- ✓ OAuth 2.0 PKCE 用户认证与令牌加密存储 — existing
- ✓ 文档读取（块树 -> Markdown 转换，30+ 种块类型） — existing
- ✓ 文档创建/更新（Markdown -> 块树，支持覆写和备份恢复） — existing
- ✓ 知识库管理（空间、节点树、成员管理） — existing
- ✓ 云盘操作（ls/mv/cp/mkdir/delete） — existing
- ✓ 权限管理（协作者增删改、链接分享设置） — existing
- ✓ 文档搜索（用户令牌模式） — existing
- ✓ 响应式权限范围管理（API 错误驱动授权提示） — existing
- ✓ 双域名支持（feishu.cn/larksuite.com） — existing
- ✓ 图片下载与本地缓存 — existing
- ✓ Claude Code 技能集成 — existing
- ✓ 命令处理器集成测试（18 个 CLI 命令全覆盖） — v1.0
- ✓ fetchWithAuth/createClient/resolveAuth 完整测试 — v1.0
- ✓ 令牌加密/解密、clearDocument、document-resolver 测试 — v1.0
- ✓ 测试覆盖率 80%+（Lines 80%, Branches 72%, Functions 88%） — v1.0
- ✓ blocks-to-md.ts ReadonlyMap 分发表重构 — v1.0
- ✓ doc-enrichment.ts 服务提取 + Promise.allSettled 并行化 — v1.0
- ✓ fetchWithAuth 泛型 `<T>` + 类型化 API 响应接口 — v1.0
- ✓ fetchWithAuth 可配置重试（指数退避+抖动） — v1.0
- ✓ 图片缓存 30 天 TTL 淘汰 — v1.0
- ✓ clearDocument QPS 延迟优化（400ms → 200ms） — v1.0
- ✓ whoami 令牌前缀移除 + OAuth CSP 头 + CI 文档 — v1.0
- ✓ knip 死代码检测集成 — v1.0

### Active

(Empty — next milestone requirements to be defined via `/gsd:new-milestone`)

### Out of Scope

- `--dry-run` 模式 — 需要设计预览 API 交互模式，复杂度高，延后
- `share list` 分页 — 影响面小，大多数文档协作者不会超过首页
- `read` 多格式输出 — 当前 Markdown 输出已满足需求
- 图片上传支持 — 需要飞书 Upload API 集成，工作量大，单独迭代
- E2E 测试框架 — 本次聚焦单元/集成测试，E2E 留给后续
- TypeScript 6.0 升级 — 非关键，另开迭代

## Context

- **项目版本:** 0.1.0-beta.17，已发布到 npm 为 `feishu-docs-cli`
- **技术栈:** TypeScript 5.9.3，零运行时依赖，ESM-only，Node.js >= 18.3.0
- **测试现状:** 456 tests across 29 files, 80%+ line coverage, c8 + tsx 管道
- **代码规模:** ~7,800 行源代码（src/），~11,500 行测试代码（test/）
- **质量工具:** knip 死代码检测（`npm run lint:dead-code`），c8 覆盖率门槛
- **已有分析:** `.planning/codebase/` 包含完整的代码库映射文档（7 个文件）
- **v1.0 shipped:** 2026-03-28, 5 phases, 15 plans, 116 files changed

## Constraints

- **API 兼容性**: CLI 命令接口（参数、输出格式）不能变更 — 已有用户和自动化脚本依赖
- **零依赖**: 不引入新的生产依赖 — 测试工具仅作为开发依赖
- **Node.js 内置**: 继续使用 `node:test` + `assert/strict` 测试框架，与零依赖理念一致
- **向后兼容**: 所有重构必须保证现有测试继续通过

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 测试优先于重构 | 无测试保护的重构风险极高，先补测试再拆分代码 | ✓ Good — 456 tests 保护下安全完成重构 |
| 内部模块边界可调整 | 允许提取新的 service/util 模块，但 CLI 命令行为不变 | ✓ Good — doc-enrichment.ts, retry.ts, concurrency.ts 等模块提取成功 |
| 继续使用 node:test | 与零依赖理念一致，避免引入 Jest/Vitest 的复杂配置 | ✓ Good — 456 tests 全部通过，无外部测试框架依赖 |
| 类型化 API 响应渐进式 | 不一次性改完所有断言，按模块逐步替换 | ✓ Good — doc-blocks + wiki-nodes 已完成，其余可后续迭代 |
| 重试逻辑内嵌 fetchWithAuth | 单一控制点，调用者无需感知重试行为 | ✓ Good — 透明重试，fetchBinaryWithAuth 同步支持 |
| pLimit 零依赖并发限制器 | 避免引入 p-limit 包，保持零依赖 | ✓ Good — 简洁实现，并行化效果显著 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after v1.0 milestone*
