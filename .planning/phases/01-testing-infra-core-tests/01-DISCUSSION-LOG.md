# Phase 1: 测试基础设施与核心路径测试 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 01-测试基础设施与核心路径测试
**Areas discussed:** 覆盖率管道, Mock 策略, 测试辅助工具组织, 认证测试隔离
**Mode:** --auto (all decisions auto-selected)

---

## 覆盖率管道

| Option | Description | Selected |
|--------|-------------|----------|
| c8 + tsx 优先，tsc 编译回退 | 先尝试 c8 直接测量 tsx 运行的测试，若源码映射不准则回退 | ✓ |
| 仅 tsc 编译后测量 | 每次都先编译再测量，更可靠但更慢 | |
| 内置 --experimental-test-coverage | 使用 Node.js 实验性功能，无需额外依赖 | |

**User's choice:** [auto] c8 + tsx 优先，tsc 编译回退 (recommended default)
**Notes:** 研究明确 c8 + tsx 有已知源码映射问题，需第一天验证

| Option | Description | Selected |
|--------|-------------|----------|
| .c8rc.json + package.json 脚本 | 配置文件管理阈值，脚本化执行 | ✓ |
| package.json 内联参数 | 所有配置在 test:coverage 脚本参数中 | |

**User's choice:** [auto] .c8rc.json + package.json 脚本 (recommended default)

---

## Mock 策略

| Option | Description | Selected |
|--------|-------------|----------|
| globalThis.fetch 替换 + 依赖注入 | 结合两种模式，简单场景用 fetch 替换，复杂场景用 DI | ✓ |
| 纯 globalThis.fetch 替换 | 仅使用全局替换，与现有模式一致 | |
| 纯依赖注入 | 重构所有模块支持 DI，更彻底但工作量大 | |

**User's choice:** [auto] globalThis.fetch 替换 + 依赖注入结合 (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| 禁止 mock.module() | 统一用 globalThis 替换和 DI | ✓ |
| 允许 mock.module() | 使用实验性 API，需 --experimental-test-module-mocks | |

**User's choice:** [auto] 禁止 mock.module() (recommended default)
**Notes:** Node.js Issue #59163 确认 ESM 缓存重置 bug 未修复

---

## 测试辅助工具组织

| Option | Description | Selected |
|--------|-------------|----------|
| test/helpers/ 集中管理 | 创建共享 mock-fetch、env-guard、factory 模块 | ✓ |
| 各测试内联 | 继续现有模式，每个测试文件自包含 | |

**User's choice:** [auto] test/helpers/ 集中管理 (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| 保持现有，新增不迁移 | 已有内联工厂函数保持不动 | ✓ |
| 全部迁移到共享模块 | 将现有工厂函数也移到 helpers/ | |

**User's choice:** [auto] 保持现有，新增不迁移 (recommended default)

---

## 认证测试隔离

| Option | Description | Selected |
|--------|-------------|----------|
| withCleanEnv + 临时目录 + concurrency:1 | 多层隔离策略 | ✓ |
| 仅环境变量保存/恢复 | 最简方案，但有并发风险 | |

**User's choice:** [auto] withCleanEnv + 临时目录 + concurrency:1 (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| round-trip 测试 | 加密→解密→比较原始值 | ✓ |
| 分别测试加密和解密 | 独立验证每个函数 | |

**User's choice:** [auto] round-trip 测试 (recommended default)

---

## Claude's Discretion

- 具体测试用例的组织和命名风格
- mock-fetch 辅助函数的 API 设计细节
- 各测试文件内的 describe 块粒度

## Deferred Ideas

None — discussion stayed within phase scope
