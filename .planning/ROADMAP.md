# Roadmap: feishu-docs-cli 质量加固

## Overview

本次迭代将 feishu-docs-cli 从 "能用" 提升到 "生产级"。核心策略是 **测试先行**：先建立测试基础设施和核心路径测试（Phase 1），在此保护下补全命令处理器集成测试（Phase 2），同时进行安全快修与类型化（Phase 3），然后在完整测试保护下执行代码重构（Phase 4），最后增强运行时健壮性（Phase 5）。33 个 v1 需求覆盖率 100%，无遗漏。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: 测试基础设施与核心路径测试** - 搭建覆盖率管道、测试辅助工具，覆盖认证链和核心服务的单元测试
- [x] **Phase 2: 命令处理器集成测试** - 为全部命令处理器补充集成测试，达到 80% 覆盖率门槛
- [x] **Phase 3: 安全加固与类型化 API 响应** - 修复安全问题，建立类型化 API 接口，为重构提供类型支撑
- [ ] **Phase 4: 代码重构** - 在测试保护下拆分大文件，提取服务模块，串行改并行
- [ ] **Phase 5: 健壮性增强** - 添加重试逻辑、缓存淘汰、QPS 优化和死代码检测

## Phase Details

### Phase 1: 测试基础设施与核心路径测试
**Goal**: 开发者拥有可靠的测试管道和核心路径测试保护网，可以安全地修改认证、API 客户端和文档操作相关代码
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06, CORE-07
**Success Criteria** (what must be TRUE):
  1. `npm run test:coverage` 可执行且输出可信的覆盖率报告（c8 + tsx 管道已验证，或已回退到 tsc 编译方案）
  2. test/helpers/ 目录包含 mock-fetch、env-guard、factory 辅助工具，后续测试可直接复用
  3. fetchWithAuth、createClient、resolveAuth 的认证解析和错误处理路径有测试覆盖
  4. token 加密/解密 round-trip、clearDocument 批量删除、备份/恢复管道有测试覆盖
  5. document-resolver 的 allowFallback 选项和回退行为有测试覆盖
**Plans:** 4 plans

Plans:
- [x] 01-01-PLAN.md -- Testing infrastructure: c8, coverage pipeline, test helpers, npm scripts
- [x] 01-02-PLAN.md -- Auth module tests: resolveAuth multi-mode + token crypto round-trip
- [x] 01-03-PLAN.md -- Client module tests: fetchWithAuth + createClient + getTenantToken
- [x] 01-04-PLAN.md -- Block-writer + document-resolver tests: clearDocument, backup/restore, wiki fallback

### Phase 2: 命令处理器集成测试
**Goal**: 所有命令处理器的业务逻辑有测试保护，整体覆盖率达到 80%，任何命令行为变更都会被测试捕获
**Depends on**: Phase 1
**Requirements**: CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-06, CMD-07, CMD-08, CMD-09, CMD-10
**Success Criteria** (what must be TRUE):
  1. read/create/update/delete 四个核心命令在 --json 和人类可读模式下均有集成测试
  2. cat/tree/spaces、wiki 子命令、share 子命令、ls/mv/cp/mkdir 云盘操作、search 命令均有测试覆盖
  3. `npm run test:coverage` 报告的行覆盖率 >= 80%、分支覆盖率 >= 70%、函数覆盖率 >= 80%
**Plans:** 5 plans

Plans:
- [x] 02-01-PLAN.md -- Document operations: captureOutput helper + read, create, update, delete, cat tests
- [x] 02-02-PLAN.md -- Knowledge base and navigation: wiki (6 subcommands), tree, spaces tests
- [x] 02-03-PLAN.md -- Drive operations: ls, mv, cp, mkdir tests
- [x] 02-04-PLAN.md -- Permissions and coverage: share (5 subcommands), search, info, login/whoami/logout, authorize + coverage enforcement
- [x] 02-05-PLAN.md -- Gap closure: deeper tests for update overwrite/restore, read enrichment, errors, install-skill + coverage enforcement

### Phase 3: 安全加固与类型化 API 响应
**Goal**: 消除已知安全隐患，建立类型化 API 响应接口体系，为后续重构提供类型安全基础
**Depends on**: Phase 1
**Requirements**: SEC-01, SEC-02, SEC-03, TYPE-01, TYPE-02, TYPE-03
**Success Criteria** (what must be TRUE):
  1. `feishu-docs whoami` 输出中不再包含任何令牌前缀信息
  2. OAuth 回调 HTML 响应包含 Content-Security-Policy 头
  3. types/api-responses.ts 存在且定义了主要 API 端点的类型接口
  4. fetchWithAuth 支持泛型参数 `<T>`，至少一个模块（doc-blocks）已用类型接口替换 `as Record<string, unknown>` 断言
**Plans:** 2 plans

Plans:
- [x] 03-01-PLAN.md -- Security fixes: whoami token removal, OAuth CSP headers, CI/container documentation
- [x] 03-02-PLAN.md -- Typed API responses: api-responses.ts types, generic fetchWithAuth<T>, doc-blocks + wiki-nodes migration

### Phase 4: 代码重构
**Goal**: 大文件被拆分为职责单一的小模块，嵌入内容获取从串行改为并行，所有既有测试继续通过
**Depends on**: Phase 2, Phase 3
**Requirements**: REF-01, REF-02, REF-03
**Success Criteria** (what must be TRUE):
  1. blocks-to-md.ts 使用 ReadonlyMap 分发表替代 if-chain，文件行数显著减少
  2. read.ts 的丰富化逻辑已提取到 services/doc-enrichment.ts，read.ts 行数降至约 200 行以内
  3. 嵌入内容获取使用 Promise.allSettled() 并行化（含并发限制），可观测到多文档场景下的性能提升
  4. 所有既有测试（Phase 1 + Phase 2）继续通过，覆盖率不低于重构前
**Plans**: TBD

### Phase 5: 健壮性增强
**Goal**: CLI 工具在网络不稳定、缓存膨胀、代码冗余等场景下表现更健壮
**Depends on**: Phase 1
**Requirements**: ROB-01, ROB-02, ROB-03, ROB-04
**Success Criteria** (what must be TRUE):
  1. fetchWithAuth 遇到 429/502/503/timeout 错误时自动重试（指数退避 + 抖动），重试行为有测试覆盖
  2. 图片缓存目录中超过 30 天的文件会被自动清理
  3. clearDocument 的 QPS 延迟参数经过优化，批量删除耗时减少
  4. knip 已集成到开发流程，`npm run lint:dead-code` 可执行且无误报
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5
Note: Phase 2 和 Phase 3 可并行执行（均仅依赖 Phase 1）。Phase 5 可与 Phase 4 部分并行（仅依赖 Phase 1）。

**Dependency Chain:**
```
Phase 1 (测试基础设施)
    |
    +---> Phase 2 (命令集成测试) ---+
    |                               |
    +---> Phase 3 (安全 + 类型化) --+--> Phase 4 (代码重构)
    |
    +---> Phase 5 (健壮性增强)
```

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 测试基础设施与核心路径测试 | 4/4 | Complete | 2026-03-26 |
| 2. 命令处理器集成测试 | 5/5 | Complete | 2026-03-27 |
| 3. 安全加固与类型化 API 响应 | 2/2 | Complete | 2026-03-27 |
| 4. 代码重构 | 0/0 | Not started | - |
| 5. 健壮性增强 | 0/0 | Not started | - |
