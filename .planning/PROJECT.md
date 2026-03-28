# feishu-docs-cli 质量加固迭代

## What This Is

feishu-docs-cli 是一个零依赖的 Node.js CLI 工具，用于读写飞书/Lark 云文档和知识库。本次迭代专注于解决代码库分析（CONCERNS.md）中识别出的技术债务、测试缺口、性能瓶颈和安全问题，使项目达到生产级质量标准。

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

### Active

**测试覆盖（优先级：最高）:**
- [x] 命令处理器集成测试（read/create/update/delete/cat/tree/wiki/share/ls/mv/cp/mkdir/search） — Validated in Phase 2
- [x] `fetchWithAuth` 和 `createClient` 的完整测试（认证解析、错误映射、超时处理） — Validated in Phase 1
- [x] `resolveAuth` 多模式认证解析测试（auto 模式回退链） — Validated in Phase 1
- [x] 令牌加密/解密、保存/加载/清除测试 — Validated in Phase 1
- [x] `clearDocument` 批量删除和备份/恢复管道测试 — Validated in Phase 1
- [x] `document-resolver` 的回退行为和 `allowFallback` 选项测试 — Validated in Phase 1
- [x] 测试覆盖率达到 80% — Validated in Phase 2 (Lines 80%, Branches 72%, Functions 88%)

**代码质量（优先级：高）:**
- [ ] 拆分 `blocks-to-md.ts`（822 行）为分发表模式
- [ ] 拆分 `read.ts`（592 行），提取丰富化逻辑到 `services/doc-enrichment.ts`
- [ ] 为 API 端点定义类型化响应接口，消除 `as Record<string, unknown>` 断言
- [ ] 将嵌入内容串行获取改为 `Promise.allSettled()` 并行化

**性能与健壮性（优先级：中）:**
- [x] 为 `fetchWithAuth` 添加可配置重试逻辑（429/502/503 + retryable 错误） — Validated in Phase 5
- [x] 图片缓存添加 TTL 淘汰策略（如 30 天） — Validated in Phase 5
- [x] 优化 `clearDocument` 的 QPS 延迟参数 — Validated in Phase 5

**安全加固（优先级：中）:**
- [ ] `whoami` 不再输出令牌前缀
- [ ] OAuth 回调响应添加 Content-Security-Policy 头
- [ ] 文档化 CI/容器环境应使用 `FEISHU_USER_TOKEN` 而非 `feishu-docs login`

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
- **测试现状:** Phase 5 complete — 456 tests, all core paths covered, retry + cache eviction + dead code detection integrated
- **代码规模:** ~6000 行源代码（src/），最大文件 822 行
- **已有分析:** `.planning/codebase/` 包含完整的代码库映射文档（7 个文件）

## Constraints

- **API 兼容性**: CLI 命令接口（参数、输出格式）不能变更 — 已有用户和自动化脚本依赖
- **零依赖**: 不引入新的生产依赖 — 测试工具仅作为开发依赖
- **Node.js 内置**: 继续使用 `node:test` + `assert/strict` 测试框架，与零依赖理念一致
- **向后兼容**: 所有重构必须保证现有测试继续通过

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 测试优先于重构 | 无测试保护的重构风险极高，先补测试再拆分代码 | — Pending |
| 内部模块边界可调整 | 允许提取新的 service/util 模块，但 CLI 命令行为不变 | — Pending |
| 继续使用 node:test | 与零依赖理念一致，避免引入 Jest/Vitest 的复杂配置 | — Pending |
| 类型化 API 响应渐进式 | 不一次性改完 74 处断言，按模块逐步替换 | — Pending |

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
*Last updated: 2026-03-28 after Phase 5 completion*
