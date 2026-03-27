# Phase 5: 健壮性增强 - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** Auto-mode (recommended defaults selected)

<domain>
## Phase Boundary

为 CLI 工具添加运行时健壮性增强：(1) fetchWithAuth/fetchBinaryWithAuth 添加可配置重试逻辑（指数退避+抖动，仅 429/502/503/timeout）；(2) 图片缓存添加 30 天 TTL 淘汰策略；(3) clearDocument 的 QPS 延迟参数从 400ms 优化至 200ms；(4) 集成 knip 死代码检测工具到开发流程。本阶段不涉及新 CLI 命令、接口变更或功能扩展。

</domain>

<decisions>
## Implementation Decisions

### 重试策略 (ROB-01: fetchWithAuth 重试)
- **D-01:** 重试逻辑内嵌在 `fetchWithAuth` 函数内部，作为透明中间层。调用者无需感知重试行为。重试仅对以下条件触发：HTTP 429（速率限制）、502/503（服务端临时故障）、AbortError（超时）。
- **D-02:** 默认最多 2 次重试（共 3 次尝试）。使用指数退避：初始延迟 1 秒，倍增因子 2，最大延迟 10 秒，附加随机抖动（±25%）防止雷群效应。
- **D-03:** 重试参数通过 `FetchOptions` 接口扩展传入，支持覆盖：`retry?: { maxRetries?: number; initialDelay?: number; maxDelay?: number }` 或 `retry?: false` 禁用重试。默认启用。
- **D-04:** `fetchBinaryWithAuth` 同样添加重试逻辑，参数与 `fetchWithAuth` 一致。共享重试工具函数避免重复代码。
- **D-05:** 每次重试时在 stderr 输出提示：`feishu-docs: info: API 请求失败（{reason}），第 {n} 次重试...`。
- **D-06:** 429 响应如果包含 `Retry-After` 头，优先使用该值作为等待时间（上限 30 秒），否则使用指数退避。

### 缓存淘汰 (ROB-02: 图片缓存 TTL)
- **D-07:** 在 `downloadImages()` 调用时触发缓存清理。清理操作异步执行（`void cleanExpiredImages(dir)`），不阻塞图片下载主流程。
- **D-08:** TTL 判断基于文件 `mtime`（最近修改时间）。超过 30 天的文件视为过期并删除。30 天常量定义为模块级常量 `IMAGE_TTL_MS`。
- **D-09:** 清理操作用 try/catch 包裹，清理失败仅输出 stderr 警告，不影响主操作。如果有文件被清理，输出 `feishu-docs: info: 已清理 {n} 个过期图片缓存`。
- **D-10:** 清理函数 `cleanExpiredImages(dir)` 作为独立导出函数，便于测试。

### QPS 延迟优化 (ROB-03: clearDocument)
- **D-11:** 将 `QPS_DELAY` 从 400ms 减至 200ms。配合 ROB-01 的重试逻辑，如果 API 返回 429 速率限制，重试机制会自动退避，无需保守的固定延迟。
- **D-12:** `QPS_DELAY` 保持为模块级导出常量，测试可直接引用验证。

### 死代码检测 (ROB-04: knip 集成)
- **D-13:** 安装 `knip` 作为 devDependency。在项目根目录创建 `knip.json` 配置文件，指定入口点（`src/cli.ts`、`bin/feishu-docs.js`）和项目模式（TypeScript + Node.js）。
- **D-14:** 在 `package.json` 添加 `lint:dead-code` 脚本，执行 `knip`。首次运行后审查结果：修复真正的死代码（删除未使用的导出/文件），对误报添加 knip.json 忽略规则。
- **D-15:** knip 检测目标包括：未使用的导出（exported but not imported）、未使用的文件（no imports from）、未使用的依赖（devDependencies 中已安装但未使用的包）。

### 测试策略
- **D-16:** 重试逻辑测试：验证 429/502/503 时自动重试且最终成功、全部重试失败时抛出最后一个错误、retry=false 禁用重试、Retry-After 头优先使用、重试次数不超过 maxRetries。
- **D-17:** 缓存淘汰测试：验证超过 30 天的文件被删除、未过期文件保留、空目录不报错、权限错误优雅处理。
- **D-18:** QPS 延迟测试：验证 clearDocument 使用新的 200ms 延迟值。
- **D-19:** 所有既有测试（400+）继续通过，覆盖率不低于 83.70%。

### Claude's Discretion
- 重试工具函数的内部实现细节（是否独立为 `src/utils/retry.ts`）
- knip.json 的具体忽略规则（依实际检测结果调整）
- 清理函数的遍历实现方式
- 测试用例的具体组织和命名

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目文档
- `.planning/PROJECT.md` -- 项目目标、约束和关键决策
- `.planning/REQUIREMENTS.md` -- v1 需求清单（Phase 5: ROB-01, ROB-02, ROB-03, ROB-04）
- `.planning/codebase/CONCERNS.md` -- 性能瓶颈和健壮性分析（API 无重试、缓存无限增长、QPS 延迟）

### Phase 1/4 上下文
- `.planning/phases/01-testing-infra-core-tests/01-CONTEXT.md` -- mock 策略、测试辅助工具、覆盖率管道
- `.planning/phases/04-refactoring-performance/04-CONTEXT.md` -- pLimit 并发限制器、测试保护网

### 重试目标文件
- `src/client.ts` -- fetchWithAuth（第 182-260 行）和 fetchBinaryWithAuth（第 282-348 行），当前已有 AbortController 超时和 retryable 标志但不实际重试
- `src/types/index.ts` -- FetchOptions 接口定义（需扩展 retry 选项）

### 缓存淘汰目标文件
- `src/services/image-download.ts` -- downloadImages()、IMAGES_DIR、findCachedImage()，当前无任何清理逻辑

### QPS 优化目标文件
- `src/services/block-writer.ts` -- QPS_DELAY 常量（第 24 行）、clearDocument()（第 88-143 行）

### 测试基础设施
- `test/helpers/mock-fetch.ts` -- fetch mock 辅助（重试测试需要模拟多次失败后成功）
- `test/helpers/factory.ts` -- 测试数据工厂
- `src/utils/concurrency.ts` -- Phase 4 创建的 pLimit 工具（重试逻辑可能参考其 Promise 队列模式）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/concurrency.ts` -- Phase 4 创建的零依赖 pLimit 并发限制器，Promise 队列模式可参考
- `src/services/block-writer.ts:sleep()` -- 已有 sleep 工具函数，重试退避可直接使用
- `test/helpers/mock-fetch.ts` -- 有序 fetch mock，支持多次调用序列（适合模拟重试场景：先失败 N 次再成功）
- `test/helpers/factory.ts` -- makeAuthInfo、makeGlobalOpts 工厂函数

### Established Patterns
- fetchWithAuth 已使用 AbortController + 30s 超时，并在超时时设置 `retryable: true`
- fetchBinaryWithAuth 使用 60s 超时
- CliError 已有 `retryable` 字段，但当前仅为信息标记
- image-download.ts 的 `findCachedImage()` 和 `fileExists()` 展示了文件系统操作模式
- block-writer.ts 的 `sleep()` 和常量导出模式

### Integration Points
- `src/client.ts` fetchWithAuth -- 重试逻辑的主要注入点
- `src/types/index.ts` FetchOptions -- 需要扩展 retry 选项类型
- `src/services/image-download.ts` downloadImages -- 缓存清理的触发点
- `src/services/block-writer.ts` QPS_DELAY -- 延迟值修改点
- `package.json` scripts -- 添加 lint:dead-code 脚本

</code_context>

<specifics>
## Specific Ideas

- 重试工具函数建议独立为 `src/utils/retry.ts`，导出 `withRetry<T>(fn, opts)` 高阶函数，与 concurrency.ts 风格一致
- fetchWithAuth 内部调用 `withRetry(() => fetch(...), retryOpts)`，保持函数签名不变
- 429 Retry-After 头解析需注意：值可能是秒数（整数字符串）或 HTTP 日期格式，CLI 场景只需处理秒数
- 缓存清理使用 `readdir` + `stat` 遍历，过期文件用 `unlink` 删除，参考 block-writer.ts 的 `rotateBackups` 模式
- knip 可能检测到 `src/types/index.ts` 中部分类型仅在测试中使用——这些不是死代码，需在 knip.json 中配置 test 入口

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 05-robustness*
*Context gathered: 2026-03-27 via auto-mode*
