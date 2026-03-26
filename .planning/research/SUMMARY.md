# 研究摘要

**项目:** feishu-docs-cli 质量加固迭代
**领域:** TypeScript CLI 工具的测试与重构加固
**日期:** 2026-03-26
**总体置信度:** HIGH

## 执行摘要

feishu-docs-cli 是一个零运行时依赖的 TypeScript CLI 工具，已发布至 npm (0.1.0-beta.17)，拥有约 6000 行源代码和 15 个测试文件。当前的核心问题是：关键路径（认证链、API 客户端、18 个命令处理器）几乎没有测试覆盖。四项研究一致表明，**测试必须先于一切重构**，这既是项目的明确决策，也是所有 pitfall 分析的核心结论。违反此顺序将导致不可检测的行为回归。

推荐方案是保持现有技术栈（node:test + assert/strict + tsx），仅新增两个开发依赖（c8 用于覆盖率、knip 用于死代码检测）。测试策略以依赖注入和 globalThis.fetch 替换为基础，明确禁止使用实验性的 `mock.module()` API。重构采用分阶段方式：先添加类型化 API 响应接口（纯增量，零风险），再拆分 `blocks-to-md.ts`（已有 658 行测试保护），最后提取 `doc-enrichment.ts` 并将串行获取改为 `Promise.allSettled()` 并行化。

主要风险有三：(1) tsx + c8 的源码映射 bug 可能导致覆盖率数据不可靠，需在设置阶段验证并准备 tsc 编译后测量的回退方案；(2) ESM 模块缓存可能导致测试互相干扰，需在第一个测试阶段统一 mock 模式和并发控制策略；(3) `resolveAuth` 测试可能污染开发者真实凭证或环境变量，需建立 `withCleanEnv` 辅助函数和临时目录隔离。

## 关键发现

### 技术栈（详见 STACK.md）

保持现有栈，新增极少工具：

- **node:test + assert/strict**：继续使用，零依赖，Stability 2（Node 20+），内置 describe/it/mock
- **tsx ^4.21.0**：继续使用，无需预编译即可运行 .ts 测试文件
- **c8 ^11.0.0**（新增）：V8 原生覆盖率工具，替代实验性内置覆盖率，支持 HTML/lcov 报告和阈值检查
- **knip ^6.0.5**（新增）：死代码检测，替代已弃用的 ts-prune，理解 TS 模块图
- **不引入 ESLint**：本次聚焦测试和重构，TypeScript strict + knip 足够

关键约束：c8 + tsx 存在已知源码映射问题（tsx >= 4.3.0），覆盖率数据需人工抽查验证。若数据不可靠，回退到 `tsc && c8 node --test dist/` 方案。

### 功能范围（详见 FEATURES.md）

**必做（table stakes）：**
- 关键路径单元测试：fetchWithAuth、resolveAuth、createClient、token 加解密
- 命令处理器集成测试：read/create/update/delete 优先，覆盖 --json 和人类可读两种输出
- 80% 覆盖率门槛（行 80% / 分支 70% / 函数 80%）
- 安全快修：移除 whoami 令牌前缀、OAuth 回调 CSP 头、CI 凭证文档
- `blocks-to-md.ts` 拆分为分发表 + `read.ts` 提取丰富化服务

**应做（差异化）：**
- 可配置重试逻辑（retryableFetch，指数退避 + 抖动，仅 429/502/503）
- 图片缓存 TTL 淘汰（30 天）
- verbose/debug 模式（--verbose 或 FEISHU_DEBUG）

**延后：**
- --dry-run 模式、share list 分页、多格式输出、图片上传、E2E 测试框架

### 架构方案（详见 ARCHITECTURE.md）

现有三层架构（Command -> Service -> Client）是正确的，问题在于边界违反：`read.ts`（592 行）混合了编排与数据获取，`blocks-to-md.ts`（822 行）用 458 行 if-chain 处理 30+ 种块类型。

**重构后的组件划分：**
1. **types/api-responses.ts**（新增）-- 所有飞书 API 响应的类型接口，消除 74 处 `as Record<string, unknown>`
2. **parser/blocks-to-md.ts** -- 从 if-chain 重构为 `ReadonlyMap<number, BlockRenderer>` 分发表
3. **services/doc-enrichment.ts**（新增）-- 从 read.ts 提取图片/用户/bitable/sheet/board 丰富化逻辑，使用 Promise.allSettled 并行化
4. **client.ts** -- `fetchWithAuth<T>` 添加泛型默认值 `T = unknown`，渐进式类型安全

### 关键 Pitfall（详见 PITFALLS.md）

1. **先重构后测试** -- 必须严格遵守"测试先行"，在原始文件结构上写 characterization tests，通过后再移动代码
2. **ESM 模块缓存导致测试隔离失败** -- 不依赖动态 import 隔离，统一使用 globalThis.fetch 替换 + 依赖注入
3. **mock.module() 是实验性 API** -- 禁止使用，Node 18 不可用，ESM 缓存重置 bug 未修复
4. **tsx + c8 覆盖率数据不可靠** -- 需验证，准备 tsc 编译后测量回退方案
5. **resolveAuth 测试污染环境** -- 建立 withCleanEnv 辅助函数，使用临时目录，`{ concurrency: 1 }`

## 推荐技术栈变更

| 变更 | 工具 | 类型 | 理由 |
|------|------|------|------|
| 新增 | c8 ^11.0.0 | devDependency | V8 覆盖率收集，替代实验性内置方案 |
| 新增 | knip ^6.0.5 | devDependency | 死代码检测，替代已弃用 ts-prune |
| 保持 | node:test + assert/strict | 内置 | 零依赖，Stability 2 |
| 保持 | tsx ^4.21.0 | devDependency | 测试执行 |
| 保持 | TypeScript 5.9.3 | devDependency | 不升级 6.0 |
| 不添加 | ESLint / Biome | -- | 本次不在范围内 |
| 不添加 | Jest / Vitest | -- | 违反零依赖理念 |

总计新增 devDependencies：2。零生产依赖变更。

## 阶段排序建议

基于四项研究的交叉分析，建议以下阶段排序：

### Phase 1: 测试基础设施与核心路径测试

**理由：** 所有后续阶段（重构、类型化、并行化）都依赖测试保护网。PITFALLS.md 的 5 个 critical pitfall 中有 4 个在此阶段需要解决。
**交付：**
- 测试辅助工具（mock-fetch、env-guard、factory）
- c8 覆盖率管道（含 tsx 源码映射验证）
- fetchWithAuth / createClient / resolveAuth 单元测试
- token 加密/解密 round-trip 测试
- clearDocument 备份/恢复管道测试
- document-resolver 回退行为测试
**覆盖 FEATURES.md：** 所有 table stakes 测试项
**规避 PITFALLS.md：** #2 ESM 缓存、#3 mock.module 禁令、#4 环境污染、#5 覆盖率不可靠、#8 subtest 并发

### Phase 2: 命令处理器集成测试

**理由：** 18 个命令处理器是业务逻辑所在，但需要 Phase 1 的 mock 基础设施。
**交付：**
- read/create/update/delete 命令集成测试（--json 和人类可读模式）
- cat/tree/search/wiki/share 命令测试
- 覆盖率达到 80% 门槛
**覆盖 FEATURES.md：** 命令处理器集成测试、覆盖率门槛
**规避 PITFALLS.md：** #10 stdout 捕获、#14 process.exit

### Phase 3: 安全快修与类型化 API 响应

**理由：** 安全修复独立于其他工作，可随时进行。类型化接口是纯增量（零行为变更），为 Phase 4 重构提供类型支撑。
**交付：**
- whoami 令牌前缀移除
- OAuth 回调 CSP 头
- CI 凭证使用文档
- types/api-responses.ts（所有主要 API 端点的类型接口）
- 按模块渐进式替换 `as Record<string, unknown>`（从 doc-blocks.ts 开始）
**覆盖 FEATURES.md：** 安全 table stakes、类型化 API 响应
**覆盖 ARCHITECTURE.md：** Phase 1（类型定义）

### Phase 4: 代码重构

**理由：** 此时已有完整测试保护和类型定义。`blocks-to-md.ts` 已有 658 行测试覆盖，是最安全的大重构。`read.ts` 提取需要 Phase 3 的类型接口。
**交付：**
- blocks-to-md.ts 从 if-chain 重构为 ReadonlyMap 分发表
- read.ts 从 592 行缩减到约 120 行，提取 doc-enrichment.ts
- 串行获取改为 Promise.allSettled 并行化（含并发限制器）
**覆盖 FEATURES.md：** 所有代码质量 table stakes
**覆盖 ARCHITECTURE.md：** Phase 2-4（分发表、服务提取、并行化）
**规避 PITFALLS.md：** #1 先重构后测试（此时有测试）、#6 ESM 导入路径、#11 strict 模式新错误

### Phase 5: 健壮性增强

**理由：** 重试逻辑独立于重构，但受益于 fetchWithAuth 测试（Phase 1）。图片缓存 TTL 和 QPS 优化属于低优先级增强。
**交付：**
- retryableFetch 包装器（指数退避 + 抖动，仅 429/502/503/timeout）
- 图片缓存 TTL 淘汰（30 天）
- clearDocument QPS 延迟优化
- knip 死代码检测集成
**覆盖 FEATURES.md：** 差异化功能（重试、缓存 TTL）

### 阶段排序依据

```
Phase 1 (测试基础设施)
    |
    v
Phase 2 (命令集成测试)  -->  Phase 3 (安全 + 类型化) [可与 Phase 2 并行]
    |                              |
    v                              v
Phase 4 (代码重构)  [依赖 Phase 2 + Phase 3]
    |
    v
Phase 5 (健壮性增强) [依赖 Phase 1，可与 Phase 4 并行]
```

- Phase 1 -> Phase 2：命令测试依赖 mock 基础设施
- Phase 2 -> Phase 4：重构必须在测试保护下进行
- Phase 3 -> Phase 4：类型接口为重构提供类型安全
- Phase 3 可与 Phase 2 并行：安全修复和类型定义不影响测试编写
- Phase 5 可与 Phase 4 并行：重试逻辑和死代码检测独立于结构重构

### 研究标记

需要更深入研究的阶段：
- **Phase 1：** c8 + tsx 覆盖率管道需要实际验证（已知 bug），可能需要调整为 tsc 编译后测量
- **Phase 4：** Promise.allSettled 并行化的并发限制器需要实际 API 速率限制测试

模式成熟、可跳过研究的阶段：
- **Phase 2：** 命令处理器集成测试模式在 STACK.md 中已详细定义
- **Phase 3：** 安全修复和类型接口定义都是标准实践
- **Phase 5：** 重试逻辑模式已有明确参考实现

## 前 5 项行动建议

1. **立即验证 c8 + tsx 覆盖率管道**。运行 `npx c8 tsx --test test/*.test.ts` 并人工检查未测试文件的覆盖率是否合理。若显示 >90%，切换到 `tsc && c8 node --test dist/` 方案。这决定了整个覆盖率基础设施的实现路径。

2. **建立测试辅助工具库**（test/helpers/）。提取 mock-fetch.ts、env-guard.ts、factory.ts。统一 globalThis.fetch 替换模式，建立 withCleanEnv 辅助函数。这是所有后续测试的基础。

3. **重构命令处理器以支持依赖注入**。为 readHandler 等函数添加 `deps = { createClient, downloadImages }` 参数。这同时解决了测试困难和架构耦合两个问题。

4. **创建 types/api-responses.ts 并设置 fetchWithAuth<T = unknown> 泛型默认值**。纯增量变更，零风险，但为所有后续工作提供类型安全基础。现有代码无需任何修改。

5. **在 package.json 中添加 test:coverage 和 lint:dead-code 脚本**。安装 c8 和 knip，配置 .c8rc.json 阈值（行 80% / 分支 70% / 函数 80%）。让覆盖率成为可见、可执行的指标。

## 风险与缓解

| 风险 | 严重程度 | 概率 | 缓解措施 |
|------|---------|------|---------|
| tsx + c8 覆盖率数据不可靠 | 高 | 中 | 阶段初期验证，准备 tsc 编译后测量回退方案 |
| ESM 缓存导致测试互相干扰 | 高 | 高 | 统一 globalThis.fetch 替换 + DI 模式，`{ concurrency: 1 }` |
| resolveAuth 测试污染真实凭证 | 高 | 中 | withCleanEnv 辅助函数 + 临时目录隔离 |
| 重构引入不可检测的行为回归 | 高 | 低（若遵守顺序） | 严格遵守测试先行，characterization tests |
| Promise.allSettled 并行化触发 API 速率限制 | 中 | 低 | 添加并发限制器（5-10 并发），仅在 Phase 4 实施 |
| knip v6 要求 Node >= 20.19.0 | 低 | 低 | 仅影响开发环境，开发者通常使用 Node 22+ |

## 置信度评估

| 领域 | 置信度 | 说明 |
|------|--------|------|
| 技术栈 | HIGH | 所有推荐均经官方文档验证，c8+tsx 的已知问题有明确回退方案 |
| 功能范围 | HIGH | 基于项目自身 CONCERNS.md 和 PROJECT.md 的直接需求，非推测性分析 |
| 架构 | HIGH | 现有架构已验证，重构方案遵循成熟模式（分发表、服务提取、Promise.allSettled） |
| 陷阱 | HIGH | 5 个 critical pitfall 均有代码库内的直接证据或可复现的 GitHub issue 支撑 |

**唯一待验证项：** c8 + tsx 覆盖率数据的实际可靠性。这必须在 Phase 1 的第一天解决。

## 来源

### 一级来源（HIGH confidence）
- [Node.js Test Runner API (v25.8.2)](https://nodejs.org/api/test.html) -- 测试框架稳定性状态
- [Node.js Mocking Guide](https://nodejs.org/en/learn/test-runner/mocking) -- mock.fn, mock.method 模式
- [c8 GitHub](https://github.com/bcoe/c8) -- V8 覆盖率工具
- [knip.dev](https://knip.dev/) -- 死代码检测工具
- [tsx Issue #433](https://github.com/privatenumber/tsx/issues/433) -- c8 + tsx 源码映射 bug
- [Node.js Issue #59163](https://github.com/nodejs/node/issues/59163) -- mock.module() ESM 重置 bug

### 二级来源（MEDIUM confidence）
- [Node.js Testing Best Practices - Yoni Goldberg](https://github.com/goldbergyoni/nodejs-testing-best-practices) -- 测试模式
- [Dispatch Tables in JavaScript](https://shramko.dev/blog/dispatch-tables) -- 分发表模式
- [Promise.allSettled() - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled) -- 并行化模式
- [Effective TypeScript: Use knip](https://effectivetypescript.com/2023/07/29/knip/) -- knip 推荐
- [Characterization Testing](https://cloudamite.com/characterization-testing/) -- 安全提取模式
- [CLI Authentication Best Practices - WorkOS](https://workos.com/blog/best-practices-for-cli-authentication-a-technical-guide)

### 三级来源（需验证）
- c8 + tsx 在当前 tsx ^4.21.0 版本下的实际覆盖率准确性 -- 需第一天实测

---
*研究完成: 2026-03-26*
*可进入路线图阶段: 是*
