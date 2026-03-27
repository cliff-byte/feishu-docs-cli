# Phase 3: 安全加固与类型化 API 响应 - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** Auto-mode (recommended defaults selected)

<domain>
## Phase Boundary

修复已知安全隐患（whoami 令牌暴露、OAuth 回调缺少 CSP），建立类型化 API 响应接口体系（types/api-responses.ts），为 fetchWithAuth 添加泛型支持，并将至少一个模块（doc-blocks）从 `as Record<string, unknown>` 迁移到类型接口。本阶段不涉及代码重构（Phase 4）或新功能添加。

</domain>

<decisions>
## Implementation Decisions

### 安全修复：令牌暴露
- **D-01:** 移除 `src/commands/login.ts:106` 的 `authInfo.userToken.slice(0, 10)` 输出。替换为仅显示令牌类型和过期时间，如 `Token Type: user\nExpires: {formatted_date}\n`。不输出任何令牌前缀。
- **D-02:** 添加测试验证 whoami 输出不包含令牌字符串的任何部分。

### 安全修复：CSP 头
- **D-03:** 为 `src/auth.ts` 中 OAuth 回调响应的 HTML 添加 Content-Security-Policy 头。策略使用 `default-src 'none'; style-src 'unsafe-inline'; script-src 'none'`（严格策略，仅允许内联样式用于回调页面美化）。
- **D-04:** 同时为错误响应（500）和成功响应都添加 CSP 头。

### 类型化 API 响应
- **D-05:** 创建 `src/types/api-responses.ts`，定义主要 API 端点的类型接口。首批覆盖：DocxBlocksResponse, WikiGetNodeResponse, DriveFileListResponse, DocCreateResponse, DocDeleteResponse。
- **D-06:** fetchWithAuth 添加泛型参数 `<T = unknown>`，返回 `ApiResponse<T>`。默认 T = unknown 保持向后兼容，现有调用无需修改。
- **D-07:** 首批迁移 `src/services/doc-blocks.ts` — 将 `as Record<string, unknown>` 替换为类型化的 `DocxBlocksResponse`。同时迁移 `src/services/wiki-nodes.ts`。
- **D-08:** 不在 Phase 3 迁移全部 56 处断言（那是 Phase 4 的范围）。仅迁移 doc-blocks 和 wiki-nodes 作为示范。

### CI/容器环境文档
- **D-09:** 在 README.md 或文档中添加一节说明 CI/容器环境应使用 `FEISHU_USER_TOKEN` 环境变量而非 `feishu-docs login`。

### Claude's Discretion
- API 响应类型的具体字段定义（从飞书 API 文档推断）
- CSP 头的具体指令组合
- 类型迁移时的中间步骤

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目文档
- `.planning/PROJECT.md` — 项目目标、约束和关键决策
- `.planning/REQUIREMENTS.md` — v1 需求清单（Phase 3: SEC-01~03, TYPE-01~03）
- `.planning/codebase/CONCERNS.md` — 安全考量详细分析
- `.planning/codebase/ARCHITECTURE.md` — 架构分层和 API 客户端模式

### 安全修复目标
- `src/commands/login.ts:106` — whoami 令牌前缀暴露位置
- `src/auth.ts:555-566` — OAuth 回调 HTML 响应（需添加 CSP）

### 类型化目标
- `src/types/index.ts` — 现有类型定义（ApiResponse<T>, AuthInfo 等）
- `src/client.ts` — fetchWithAuth 函数（需添加泛型）
- `src/services/doc-blocks.ts` — 首批类型迁移目标
- `src/services/wiki-nodes.ts` — 首批类型迁移目标

### Phase 1 测试基础设施
- `test/helpers/mock-fetch.ts` — fetch mock 辅助
- `test/helpers/factory.ts` — 测试数据工厂
- `test/client.test.ts` — fetchWithAuth 现有测试（泛型修改需兼容）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/helpers/mock-fetch.ts` — 安全修复测试可复用
- `test/login.test.ts` — whoami 现有测试，可扩展验证令牌不泄露
- `src/types/index.ts` — ApiResponse<T> 已有泛型支持，fetchWithAuth 只需传递

### Established Patterns
- 所有 API 响应通过 `fetchWithAuth()` → `ApiResponse<T = unknown>` → `as Record<string, unknown>` 链处理
- 56 处 `as Record<string, unknown>` 分布在 21 个文件
- OAuth 回调 HTML 直接在 `auth.ts` 中内联构建

### Integration Points
- `src/client.ts` fetchWithAuth — 泛型改动影响所有调用者（但 T=unknown 默认值保证兼容）
- `src/types/index.ts` — 新类型文件需要从此处导出或独立文件
- `test/login.test.ts` — whoami 修改需要更新测试

</code_context>

<specifics>
## Specific Ideas

- whoami 替代输出格式：`Token Type: user\nExpires: 2026-03-28 10:00:00\n`（使用 Date 格式化）
- CSP 头值：`default-src 'none'; style-src 'unsafe-inline'`（回调页面仅需内联样式）
- 类型迁移策略：先建类型文件，再改 fetchWithAuth 签名（兼容），最后按文件逐步替换

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-security-typed-api*
*Context gathered: 2026-03-27 via auto-mode*
