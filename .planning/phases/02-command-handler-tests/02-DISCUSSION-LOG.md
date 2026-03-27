# Phase 2: 命令处理器集成测试 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 02-command-handler-tests
**Areas discussed:** 测试隔离层级, 输出验证策略, 已有测试处理, 命令分组与优先级

---

## 测试隔离层级

| Option | Description | Selected |
|--------|-------------|----------|
| Mock fetch（全链路） | Mock globalThis.fetch，测试 command→service→client→fetch 完整链路。复用 Phase 1 的 setupMockFetch。 | ✓ |
| Mock service层 | 直接 mock service 函数的返回值，仅测试命令处理器的参数解析和输出格式化。 | |
| 混合策略 | 核心命令用全链路，简单命令用 service 层 mock。 | |

**User's choice:** Mock fetch（全链路）
**Notes:** 与 Phase 1 建立的 mock 模式一致，最大化测试覆盖范围。

---

## 输出验证策略

| Option | Description | Selected |
|--------|-------------|----------|
| JSON 结构检查 | --json 主测：解析 JSON 检查关键字段。人类可读辅测：仅检查关键字符串包含。 | ✓ |
| 严格字符串匹配 | 两种模式都做精确字符串比对。 | |
| 仅测 JSON 模式 | 跳过人类可读格式测试。 | |

**User's choice:** JSON 结构检查
**Notes:** 平衡覆盖率和测试稳定性，避免格式微调破坏测试。

---

## 已有测试处理

| Option | Description | Selected |
|--------|-------------|----------|
| 扩展现有文件 | 保留现有测试，在同一文件中追加新的集成测试 describe 块。 | ✓ |
| 重写为全链路测试 | 用新的 mock-fetch 模式重写。 | |
| 并行共存 | 保留现有文件不动，新建独立的集成测试文件。 | |

**User's choice:** 扩展现有文件
**Notes:** 保持向后兼容，不重写已验证的测试。

---

## 命令分组与优先级

| Option | Description | Selected |
|--------|-------------|----------|
| 按领域分组 | 文档操作、知识库、云盘、权限与其他。同领域命令共享 mock 数据。 | ✓ |
| 按复杂度分组 | 简单→中等→复杂。先摘低果再攻坚。 | |
| 按覆盖率影响分组 | 优先测试行数最多的文件。 | |

**User's choice:** 按领域分组
**Notes:** 逻辑清晰，同领域命令共享 mock 数据和测试模式。

---

## Claude's Discretion

- 每个命令的具体测试场景和边界条件
- mock 数据的具体结构
- describe 块的组织粒度

## Deferred Ideas

None — discussion stayed within phase scope
