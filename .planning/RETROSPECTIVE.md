# Retrospective: feishu-docs-cli

## Milestone: v1.0 — 质量加固

**Shipped:** 2026-03-28
**Phases:** 5 | **Plans:** 15 | **Tasks:** ~30
**Timeline:** 3 days (2026-03-26 → 2026-03-28)
**Commits:** ~100 | **Files changed:** 116 | **LOC:** +25,766 / -1,247

### What Was Built
- c8 + tsx 覆盖率管道 + 3 个测试辅助模块，验证通过 16 个冒烟测试
- 456 个测试覆盖全部 18 个 CLI 命令、认证链、API 客户端、块写入器
- whoami 令牌泄露修复 + OAuth CSP 头 + CI 认证文档
- fetchWithAuth<T> 泛型 + 类型化 API 响应接口
- blocks-to-md.ts ReadonlyMap 分发表替代 31 分支 if-chain
- doc-enrichment.ts 服务提取 + pLimit(5) 并行化，read.ts 从 592 行降至 148 行
- fetchWithAuth/fetchBinaryWithAuth 可配置重试（指数退避+抖动）
- 图片缓存 30 天 TTL 淘汰 + QPS 延迟减半 + knip 死代码检测

### What Worked
- **测试先行策略**：Phase 1 建立的测试保护网让 Phase 4 重构完全无痛，零回归
- **TDD 流程**：先写失败测试再实现，确保每个功能都有精确的测试覆盖
- **并行执行**：Phase 2/3 并行、Phase 4/5 并行，缩短了整体时间线
- **mock-fetch 辅助工具**：有序响应模式非常适合测试重试逻辑和分页
- **零依赖约束**：pLimit、retry utility 等自实现模块保持了零依赖理念

### What Was Inefficient
- **Agent API 连接故障**：Phase 5 两个并行 agent 均遇到 API 连接中断，需要手动完成剩余工作
- **REQUIREMENTS.md 更新滞后**：TYPE-01/02/03 和 ROB-01 实际已完成但文档未同步更新，milestone 完成时需要补修
- **knip 配置迭代**：初次 knip 运行产生误报，需要调整 entry/project 配置

### Patterns Established
- `test/helpers/mock-fetch.ts` — 有序 fetch mock 模式（多次调用返回不同响应）
- `test/helpers/factory.ts` — makeUserAuthInfo/makeTenantAuthInfo/makeGlobalOpts 工厂
- `test/helpers/capture-output.ts` — stdout/stderr 捕获辅助
- `src/utils/concurrency.ts` — 零依赖 pLimit 并发限制器
- `src/utils/retry.ts` — 指数退避 + 抖动 + Retry-After 解析
- `src/services/doc-enrichment.ts` — 从命令层提取的可复用服务模式

### Key Lessons
- 零依赖项目中自实现工具（pLimit, retry）代码量小但需要完整测试
- resolveWithTimers 辅助解决了 mock timer + async sleep 死锁问题
- 每个 phase 的 CONTEXT.md 决策文档对 agent 自主执行至关重要
- Wave 并行执行需要注意共享文件冲突（block-writer.ts 被两个 plan 同时修改）

### Cost Observations
- Model mix: ~80% opus, ~20% sonnet (subagents)
- Sessions: 4
- Notable: Phase 1-4 高效完成（单次 session），Phase 5 因 API 中断需要额外 session

---

## Cross-Milestone Trends

| Metric | v1.0 |
|--------|------|
| Phases | 5 |
| Plans | 15 |
| Tests | 456 |
| Coverage | 80%+ |
| Timeline | 3 days |
| Commits | ~100 |
