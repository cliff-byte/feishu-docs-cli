# Requirements: feishu-docs-cli 质量加固

**Defined:** 2026-03-26
**Core Value:** 核心路径必须有测试保护 — 认证、API 通信、命令处理器等关键路径需达到 80% 测试覆盖率

## v1 Requirements

### 测试基础设施

- [x] **TEST-01**: 安装 c8 覆盖率工具，配置 .c8rc.json 阈值（行 80% / 分支 70% / 函数 80%）
- [x] **TEST-02**: 验证 c8 + tsx 覆盖率管道可靠性，若不可靠则切换到 tsc 编译后测量
- [x] **TEST-03**: 创建测试辅助工具库（test/helpers/）：mock-fetch、env-guard、factory 函数
- [x] **TEST-04**: 建立 node:test 并发控制约定（涉及全局状态的 describe 使用 `{ concurrency: 1 }`）
- [x] **TEST-05**: 在 package.json 中添加 test:coverage 脚本

### 核心路径测试

- [x] **CORE-01**: fetchWithAuth 完整测试（Bearer 令牌解析、错误映射、超时处理、权限范围错误提取）
- [x] **CORE-02**: createClient 测试（auto/user/tenant 模式解析、令牌自动刷新触发）
- [ ] **CORE-03**: resolveAuth 多模式认证解析测试（env 变量 → 本地令牌 → 应用凭证回退链）
- [ ] **CORE-04**: 令牌加密/解密 round-trip 测试（AES-256-GCM + scrypt 密钥派生）
- [ ] **CORE-05**: clearDocument 批量删除测试（批次拆分、QPS 延迟、冲突重试）
- [ ] **CORE-06**: backupDocument / rotateBackups 备份管道测试
- [ ] **CORE-07**: document-resolver 回退行为测试（allowFallback 选项、wiki 解析失败处理）

### 命令处理器集成测试

- [ ] **CMD-01**: read 命令集成测试（--json 和人类可读模式、嵌入内容、图片下载）
- [ ] **CMD-02**: create 命令集成测试（云盘创建、wiki 创建、--body 参数）
- [ ] **CMD-03**: update 命令集成测试（追加、覆写+备份、恢复模式）
- [ ] **CMD-04**: delete 命令集成测试（回收站删除、确认提示）
- [ ] **CMD-05**: cat/tree/spaces 命令测试（分页、递归、限制）
- [ ] **CMD-06**: wiki 子命令测试（create-space、add-member、rename、move、copy）
- [ ] **CMD-07**: share 子命令测试（list、add、remove、update、set）
- [ ] **CMD-08**: ls/mv/cp/mkdir 云盘操作测试
- [ ] **CMD-09**: search 命令测试（用户令牌验证、搜索参数）
- [ ] **CMD-10**: 测试覆盖率整体达到 80%

### 安全加固

- [ ] **SEC-01**: whoami 不再输出用户令牌前缀（移除 slice(0, 10)）
- [ ] **SEC-02**: OAuth 回调响应 HTML 添加 Content-Security-Policy 头
- [ ] **SEC-03**: 文档化 CI/容器环境应使用 FEISHU_USER_TOKEN 而非 feishu-docs login

### 类型化 API 响应

- [ ] **TYPE-01**: 创建 types/api-responses.ts，定义主要 API 端点的类型接口
- [ ] **TYPE-02**: fetchWithAuth 添加泛型参数 `<T = unknown>`，启用渐进式类型安全
- [ ] **TYPE-03**: 按模块替换 `as Record<string, unknown>` 断言（从 doc-blocks → wiki-nodes → 其他）

### 代码重构

- [ ] **REF-01**: blocks-to-md.ts 从 if-chain 重构为 ReadonlyMap<number, BlockRenderer> 分发表
- [ ] **REF-02**: read.ts 提取丰富化逻辑到 services/doc-enrichment.ts（图片/用户/bitable/sheet/board）
- [ ] **REF-03**: 嵌入内容串行获取改为 Promise.allSettled() 并行化（含并发限制器）

### 健壮性增强

- [ ] **ROB-01**: 为 fetchWithAuth 添加可配置重试逻辑（指数退避+抖动，仅 429/502/503/timeout）
- [ ] **ROB-02**: 图片缓存添加 TTL 淘汰策略（30 天最大存活时间）
- [ ] **ROB-03**: 优化 clearDocument QPS 延迟参数
- [ ] **ROB-04**: 安装 knip 并集成死代码检测到开发流程

## v2 Requirements

### 功能增强

- **FEAT-01**: --dry-run 模式用于破坏性操作（update --overwrite、delete）
- **FEAT-02**: share list 分页支持
- **FEAT-03**: read 命令多格式输出（--format plain/html/json）
- **FEAT-04**: 图片上传支持（create/update 时上传本地图片）
- **FEAT-05**: verbose/debug 日志模式（--verbose 或 FEISHU_DEBUG 环境变量）

### 工程化

- **ENG-01**: E2E 测试框架集成
- **ENG-02**: ESLint / Biome 代码检查集成
- **ENG-03**: TypeScript 6.0 升级
- **ENG-04**: CI/CD 覆盖率门槛强制执行

## Out of Scope

| Feature | Reason |
|---------|--------|
| Jest / Vitest 迁移 | 违反零依赖理念，node:test 已满足需求 |
| 生产依赖新增 | 零依赖是核心架构决策，不可打破 |
| CLI 命令接口变更 | 已有用户和自动化脚本依赖现有接口 |
| 新 CLI 命令 | 本次聚焦质量加固，非功能扩展 |
| mock.module() 使用 | 实验性 API，Node 18 不可用，有已知 bug |
| 多语言支持（i18n） | 工具面向中文飞书用户，当前定位不变 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 1 | Complete |
| TEST-04 | Phase 1 | Complete |
| TEST-05 | Phase 1 | Complete |
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| CORE-06 | Phase 1 | Pending |
| CORE-07 | Phase 1 | Pending |
| CMD-01 | Phase 2 | Pending |
| CMD-02 | Phase 2 | Pending |
| CMD-03 | Phase 2 | Pending |
| CMD-04 | Phase 2 | Pending |
| CMD-05 | Phase 2 | Pending |
| CMD-06 | Phase 2 | Pending |
| CMD-07 | Phase 2 | Pending |
| CMD-08 | Phase 2 | Pending |
| CMD-09 | Phase 2 | Pending |
| CMD-10 | Phase 2 | Pending |
| SEC-01 | Phase 3 | Pending |
| SEC-02 | Phase 3 | Pending |
| SEC-03 | Phase 3 | Pending |
| TYPE-01 | Phase 3 | Pending |
| TYPE-02 | Phase 3 | Pending |
| TYPE-03 | Phase 3 | Pending |
| REF-01 | Phase 4 | Pending |
| REF-02 | Phase 4 | Pending |
| REF-03 | Phase 4 | Pending |
| ROB-01 | Phase 5 | Pending |
| ROB-02 | Phase 5 | Pending |
| ROB-03 | Phase 5 | Pending |
| ROB-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after initial definition*
