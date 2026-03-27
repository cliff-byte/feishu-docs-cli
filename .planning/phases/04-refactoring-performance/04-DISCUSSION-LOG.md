# Phase 4: 代码重构 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 04-refactoring-performance
**Areas discussed:** 分发表设计, 丰富化服务接口, 并行化并发策略
**Mode:** Auto (recommended defaults selected)

---

## 分发表设计

| Option | Description | Selected |
|--------|-------------|----------|
| 同文件 ReadonlyMap + 顶级函数 | 渲染函数保留在 blocks-to-md.ts，避免循环依赖 | ✓ |
| 独立文件拆分 | 每种块类型独立文件，通过 barrel 导出 | |
| 策略模式 class | OOP 风格，每种块类型一个 class | |

**User's choice:** [auto] 同文件 ReadonlyMap + 顶级函数 (recommended default)
**Notes:** 块渲染器之间共享 RenderContext 和 elementsToMarkdown，拆分为独立文件会导致循环依赖或过度传参。同文件内提取为顶级函数已能显著减少缩进层级和认知负担。

---

## 丰富化服务接口

| Option | Description | Selected |
|--------|-------------|----------|
| 单一 enrichBlocks() 入口 | 一个函数处理所有丰富化，内部按类型分派 | ✓ |
| 多独立函数 | 各丰富化函数独立导出，read.ts 逐个调用 | |
| Pipeline 模式 | 链式处理，每步传递上下文 | |

**User's choice:** [auto] 单一 enrichBlocks() 入口 (recommended default)
**Notes:** read.ts 调用一个函数即可完成所有丰富化，大幅简化命令层。内部函数仍可独立测试（通过导出 fetch 函数）。

---

## 并行化并发策略

| Option | Description | Selected |
|--------|-------------|----------|
| 自建 pLimit 风格限制器 | 零依赖，约 30 行，并发数 5 | ✓ |
| 引入 p-limit 包 | 成熟方案，但违反零依赖约束 | |
| 无限制 Promise.allSettled | 简单但可能触发 QPS 限制 | |

**User's choice:** [auto] 自建 pLimit 风格限制器，并发数 5 (recommended default)
**Notes:** 零依赖是核心架构决策，不可引入 p-limit。并发数 5 在飞书 API 50/s QPS 限制下留有余量。

---

## Claude's Discretion

- RenderContext 具体字段定义
- 渲染函数拆分粒度
- 丰富化请求分组方式
- 并发限制器内部实现细节

## Deferred Ideas

None
