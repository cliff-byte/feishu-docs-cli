# Phase 5: 健壮性增强 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 05-robustness
**Areas discussed:** 重试策略设计, 缓存淘汰机制, QPS延迟优化, 死代码检测集成
**Mode:** Auto (recommended defaults selected)

---

## 重试策略设计

| Option | Description | Selected |
|--------|-------------|----------|
| fetchWithAuth 内部封装 | 重试逻辑作为透明中间层，调用者无感知 | ✓ |
| 外部装饰器/中间件 | 独立 retry wrapper 包裹 fetchWithAuth | |
| 调用者自行重试 | 每个命令处理器自己实现重试 | |

**User's choice:** [auto] fetchWithAuth 内部封装 (recommended default)
**Notes:** 单一控制点，避免每个调用者重复实现。默认 2 次重试，指数退避 1s-10s + 抖动。FetchOptions 扩展 retry 参数支持禁用或覆盖。fetchBinaryWithAuth 同样适用。

---

## 缓存淘汰机制

| Option | Description | Selected |
|--------|-------------|----------|
| downloadImages 时异步触发 | 自然触发点，不阻塞主流程 | ✓ |
| 独立 CLI 子命令 | 用户手动运行清理命令 | |
| 启动时全局检查 | CLI 启动时检查所有缓存 | |

**User's choice:** [auto] downloadImages 时异步触发 (recommended default)
**Notes:** 基于文件 mtime 判断，30 天 TTL。清理失败不影响主操作，仅 stderr 输出信息。

---

## QPS延迟优化

| Option | Description | Selected |
|--------|-------------|----------|
| 减半至 200ms + 重试覆盖 | 配合 ROB-01 重试，429 时自动退避 | ✓ |
| 自适应延迟 | 根据 429 响应动态调整延迟 | |
| 保持 400ms | 维持当前保守值 | |

**User's choice:** [auto] 减半至 200ms + 重试覆盖 (recommended default)
**Notes:** ROB-01 的重试逻辑天然覆盖 429 场景，固定延迟可以更激进。

---

## 死代码检测集成

| Option | Description | Selected |
|--------|-------------|----------|
| knip + lint:dead-code 脚本 | 标准方案，按需求规格执行 | ✓ |
| ts-prune | 仅检测 TypeScript 未使用导出 | |
| 手动审查 | 不引入工具，人工检查 | |

**User's choice:** [auto] knip + lint:dead-code 脚本 (recommended default)
**Notes:** knip.json 配置入口点（src/cli.ts, bin/feishu-docs.js），修复真正死代码，误报添加忽略规则。

---

## Claude's Discretion

- 重试工具函数内部实现（是否独立文件）
- knip.json 忽略规则（依实际检测结果）
- 清理函数遍历方式
- 测试用例组织和命名

## Deferred Ideas

None -- discussion stayed within phase scope
