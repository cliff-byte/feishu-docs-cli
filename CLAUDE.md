When contributing to this repository, you must strictly follow all guidelines outlined in the AGENTS.md file.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**feishu-docs-cli 质量加固迭代**

feishu-docs-cli 是一个零依赖的 Node.js CLI 工具，用于读写飞书/Lark 云文档和知识库。本次迭代专注于解决代码库分析（CONCERNS.md）中识别出的技术债务、测试缺口、性能瓶颈和安全问题，使项目达到生产级质量标准。

**Core Value:** **核心路径必须有测试保护** — 认证、API 通信、命令处理器等关键路径需达到 80% 测试覆盖率，确保任何重构或新功能不会静默破坏现有行为。

### Constraints

- **API 兼容性**: CLI 命令接口（参数、输出格式）不能变更 — 已有用户和自动化脚本依赖
- **零依赖**: 不引入新的生产依赖 — 测试工具仅作为开发依赖
- **Node.js 内置**: 继续使用 `node:test` + `assert/strict` 测试框架，与零依赖理念一致
- **向后兼容**: 所有重构必须保证现有测试继续通过
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## 编程语言
- TypeScript 5.9.3 — 所有源代码 (`src/**/*.ts`)、测试 (`test/**/*.test.ts`)
- JavaScript (ESM) — CLI 入口脚本 (`bin/feishu-docs.js`)、编译输出 (`dist/`)
## 运行时环境
- Node.js >= 18.3.0（在 `package.json` 的 `engines` 字段中声明）
- ESM 模块系统（`package.json` 中 `"type": "module"`）
- 使用原生 `fetch` API（Node 18.3.0 起可用）
- 使用 `node:util` 的 `parseArgs`（Node 18.3.0 起可用）
- npm（lockfileVersion 3）
- 锁文件：`package-lock.json` 已提交到仓库
## 框架
- 零运行时依赖 — 纯 Node.js CLI 工具，自定义命令路由
- 自定义 CLI 框架（`src/cli.ts`），使用 `node:util` 的 `parseArgs`
- 命令注册模式，使用声明式 `CommandMeta` 定义
- Node.js 内置测试运行器 (`node:test`)，通过 `tsx --test` 执行
- Node.js 内置 `assert` 模块用于断言
- 不使用外部测试框架（无 Jest、Vitest 或 Mocha）
- TypeScript 编译器 (`tsc`) 5.9.3 — 编译输出到 `dist/`
- tsx 4.21.0 — TypeScript 执行引擎，用于无需预编译直接运行测试
## 关键依赖
- 无。零生产依赖。所有功能均使用 Node.js 内置模块。
| 包名 | 版本 | 用途 |
|------|------|------|
| `typescript` | ^5.9.3 | TypeScript 编译器 |
| `tsx` | ^4.21.0 | TypeScript 执行引擎，用于运行测试 |
| `@types/node` | ^25.5.0 | Node.js 类型定义 |
## 使用的 Node.js 内置模块
| 模块 | 用途 | 关键文件 |
|------|------|---------|
| `node:http` | OAuth 回调服务器 | `src/auth.ts` |
| `node:crypto` | AES-256-GCM 加密、PKCE S256、UUID 生成 | `src/auth.ts`, `src/services/block-writer.ts` |
| `node:fs/promises` + `node:fs` | 配置、备份、图片缓存读写 | 多个文件 |
| `node:os` | 主目录、主机名、用户标识 | `src/auth.ts`, `src/services/image-download.ts` |
| `node:path` | 路径解析、规范化 | 多个文件 |
| `node:util` | `parseArgs` 用于 CLI 参数解析 | `src/cli.ts` |
| `node:readline` | 交互式权限范围授权提示 | `src/utils/scope-prompt.ts` |
| `node:child_process` | 打开浏览器进行 OAuth 认证 | `src/auth.ts` |
| `node:module` | `createRequire` 读取 package.json 版本号 | `src/utils/version.ts` |
| `node:url` | `fileURLToPath` 获取 __dirname | `src/commands/install-skill.ts` |
| 全局 `fetch` | 所有 HTTP/API 通信 | `src/client.ts`, `src/auth.ts`, `src/services/image-download.ts`, `src/utils/version.ts` |
## TypeScript 配置
- 目标：ES2022
- 模块：NodeNext（ESM，使用 `.js` 扩展名导入）
- 模块解析：NodeNext
- 严格模式：已启用
- Source map：已启用
- 声明文件：生成（`.d.ts`）
- 根目录：`./src`
- 输出目录：`./dist`
- 隔离模块：已启用
## 构建配置
- 编译后 JS：`dist/`（ESM `.js` 文件）
- 类型声明：`dist/`（`.d.ts` 文件）
- Source map：`dist/`（`.js.map` 文件）
## 包发布信息
## 本地存储
| 路径 | 用途 | 安全措施 |
|------|------|---------|
| `auth.json` | 加密的 OAuth 令牌 | AES-256-GCM 加密，文件权限 0o600，密钥基于机器身份派生 |
| `backups/{docId}-{ts}.json` | 文档备份文件 | 文件权限 0o600，自动轮换（每文档最多 10 个） |
| `images/{fileToken}.{ext}` | 下载的图片缓存 | 持久缓存，以 file_token 为键 |
| `.refresh.lock` | 基于文件的互斥锁，防止并发令牌刷新 | 基于 PID 的过期检测 |
| `.update-check.json` | npm 更新检查状态 | 24 小时检查间隔 |
## 平台要求
- Node.js >= 18.3.0
- npm（支持 lockfileVersion 3 的任意版本）
- Node.js >= 18.3.0（通过 `npm install -g feishu-docs-cli` 全局安装）
- 飞书/Lark 开发者应用凭证（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`）
- 能够访问 `open.feishu.cn` 或 `open.larksuite.com`
## 关键技术决策
- **零依赖:** 避免供应链风险，保持包轻量。所有 HTTP 通过原生 `fetch`，所有加密通过 `node:crypto`，CLI 解析通过 `node:util.parseArgs`。
- **仅 ESM:** 使用 `"type": "module"` 和 `.js` 扩展名导入。不支持 CommonJS。
- **Node.js 内置测试运行器:** 使用 `node:test` 替代外部框架，与零依赖理念一致。
- **AES-256-GCM 令牌加密:** 认证令牌使用基于机器身份派生的密钥进行静态加密（hostname + username + scrypt salt）。
- **OAuth v2 + PKCE S256:** 完整的 PKCE 流程，确保用户认证安全。
- **双域名支持:** 每个 API 调用可解析到 `open.feishu.cn`（中国大陆）或 `open.larksuite.com`（国际版），通过 `--lark` 参数切换。
- **响应式权限范围管理:** 不对每个命令硬编码权限范围列表，由 API 错误驱动权限范围授权提示。
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## 命名模式
- 所有源文件使用 kebab-case：`block-writer.ts`、`blocks-to-md.ts`、`url-parser.ts`、`image-download.ts`
- 测试文件使用相同名称加 `.test.ts` 后缀：`url-parser.test.ts`、`blocks-to-md.test.ts`
- 命令文件以 CLI 动词命名：`read.ts`、`create.ts`、`share.ts`、`delete.ts`
- 所有函数使用 camelCase：`parseDocUrl()`、`fetchAllBlocks()`、`resolveDocument()`
- 以描述动作的动词作为前缀：`get*`、`fetch*`、`resolve*`、`extract*`、`build*`、`map*`、`validate*`
- 私有/内部辅助函数为普通函数（无下划线前缀），通过模块级 `export` 控制可见性
- 命令处理器函数以命令名命名：`read()`、`create()`、`list()`、`add()`
- 所有变量使用 camelCase：`authInfo`、`documentId`、`imageUrlMap`
- 模块级常量使用 UPPER_SNAKE_CASE：`FEISHU_BASE`、`LARK_BASE`、`MAX_BLOCKS_PER_CALL`、`BATCH_SIZE`
- API 字段名使用 snake_case（与飞书 API 保持一致）：`user_access_token`、`refresh_token`、`block_type`
- 接口和类型别名使用 PascalCase：`AuthInfo`、`CommandMeta`、`GlobalOpts`、`ParsedDoc`
- 联合类型别名使用 PascalCase：`ErrorType`、`DocType`、`AuthMode`
- 所有类型集中在 `src/types/index.ts`
- 枚举定义为普通对象，键名使用 UPPER_SNAKE_CASE：`BlockType.PAGE`、`BlockType.TEXT`
- 正则表达式赋值给 UPPER_SNAKE_CASE 常量：`TOKEN_RE`、`RAW_TOKEN_RE`、`MEMBER_ID_RE`
- 映射常量使用 UPPER_SNAKE_CASE：`EMOJI_MAP`、`CODE_LANGUAGES`、`CONTENT_TYPE_EXT`
## 代码风格
- 未配置专用格式化工具（无 `.prettierrc`、`.editorconfig` 或 `biome.json`）
- 事实标准：2 空格缩进，双引号字符串
- 语句末尾一致使用分号
- 多行结构使用尾逗号
- 未配置 ESLint 或 Biome
- TypeScript `strict: true`（`tsconfig.json`）提供类型级检查
- 通过 `strict`、`forceConsistentCasingInFileNames`、`isolatedModules` 强制类型安全
- 无强制行长度限制
- 通常保持在 120 字符以内，URL 字符串或复杂表达式偶有超长行
## 导入组织
- 所有导入使用显式 `.js` 扩展名（ESM `"type": "module"` 要求）：
- `tsconfig.json` 中未配置路径别名 — 所有导入使用相对路径
- Node 内置模块使用 `node:` 协议前缀：`import { readFile } from "node:fs/promises";`
- 仅类型导入使用 `import type { ... }` 以支持 `isolatedModules`：
- 值导入和类型导入通常在单独的语句中：
## 错误处理
- 所有面向用户的错误使用 `src/utils/errors.ts` 中的 `CliError`
- 构造函数参数：`(type: ErrorType, message: string, options?: CliErrorOptions)`
- 错误类型：`INVALID_ARGS`、`FILE_NOT_FOUND`、`AUTH_REQUIRED`、`TOKEN_EXPIRED`、`PERMISSION_DENIED`、`SCOPE_MISSING`、`NOT_FOUND`、`NOT_SUPPORTED`、`RATE_LIMITED`、`API_ERROR`
- 退出码：1（参数/文件）、2（认证）、3（API）
- 在 `src/utils/errors.ts` 中将飞书 API 错误码映射为类型化的 `CliError` 实例
- 特定错误码如 `131006`（权限拒绝）、`131001`/`131002`（未找到）、`99991400`/`99991663`（令牌过期）有自定义消息
- 非关键失败（图片下载、用户名解析）捕获错误并写入 stderr 警告：
- 包装可能因 `SCOPE_MISSING` 失败的操作
- 交互式提示用户授权缺失的权限范围，然后重试一次
- 在非交互模式下回退到 `AUTH_REQUIRED` 错误
- 未知 `catch` 错误使用 `as Error` 或 `as { message?: string }` 转换：
## TypeScript 模式
- `tsconfig.json` 中启用 `"strict": true`
- 目标：`ES2022`，模块：`NodeNext`，模块解析：`NodeNext`
- API 响应数据一致使用 `as Record<string, unknown>` 转换：
- 此模式出现在每个 API 调用点 — 处理飞书 API 的松散类型响应
- `ApiResponse<T = unknown>` 是 API 响应的泛型类型
- `withScopeRecovery<T>()` 对包装函数的返回类型使用泛型
- 所有接口使用 `export interface`（对象类型不使用 `type`）
- 可选字段使用 `?` 后缀：`userToken?: string`、`expiresAt?: number`
- 可扩展对象使用索引签名：`[key: string]: unknown`（在 `CommandArgs` 和 `Block` 上）
- `sanitizeBlocks()` 返回新数组不修改输入（有明确测试）
- `mergeScopes()` 返回新数组不修改输入
- `resolveAuth()` 创建新的 `AuthInfo` 对象而非修改已有的
- 使用展开运算符进行不可变更新：`{ ...authInfo, mode: "tenant" }`
- 用于选项定义：`GLOBAL_OPTIONS` 上的 `as const`
## 输出约定
- 所有命令通过 `globalOpts.json` 支持 `--json` 参数
- JSON 模式：`process.stdout.write(JSON.stringify({ success: true, ... }) + "\n")`
- 人类模式：`process.stdout.write("文档已创建\n")`
- 警告：`process.stderr.write("feishu-docs: warning: ...")`
- 信息：`process.stderr.write("feishu-docs: info: ...")`
- 错误：`process.stderr.write("feishu-docs: error: ...")`
- 前缀模式：`feishu-docs: {level}: {message}\n`
- 所有输出通过 `process.stdout.write()` 或 `process.stderr.write()`
- 这是 CLI 工具的正确实践（stdout = 数据，stderr = 消息）
## 模块设计
- 命令导出一个 `meta` 对象（类型 `CommandMeta` 或 `SubcommandMeta`）和处理器函数
- 工具模块导出独立的命名函数
- 代码库中无默认导出
- 除 `src/types/index.ts` 外无 barrel 文件
- 每个命令模块导出 `meta: CommandMeta`，包含 `{ options, positionals, handler }`：
- `src/cli.ts`：入口、参数解析、命令分发
- `src/client.ts`：HTTP 客户端、认证头注入、API 错误处理
- `src/auth.ts`：OAuth 流程、令牌持久化、刷新逻辑
- `src/commands/*.ts`：命令实现（每个 CLI 命令一个）
- `src/services/*.ts`：可复用的 API 交互逻辑
- `src/parser/*.ts`：块到 Markdown 的转换
- `src/utils/*.ts`：纯工具（验证、URL 解析、错误格式化）
- `src/types/index.ts`：所有共享类型定义
## 注释
- 每个导出函数有 `/** */` JSDoc 注释描述其用途
- 模块级 `/** */` 注释描述文件职责
- 内部函数可能有简短注释或无注释
- JSDoc 注释使用英文
- 面向用户的错误消息使用中文（CLI 面向中文用户）
- 行内注释中英文混用
## 验证
- `validateToken()`（`src/utils/validate.ts`）：基于正则的路径遍历防护
- `validateMemberId()`（`src/utils/member.ts`）：成员 ID 正则验证
- `parseDocUrl()`（`src/utils/url-parser.ts`）：URL 解析含域名白名单
- 命令处理器立即验证必需的位置参数：
- 所有 API 路径参数使用 `encodeURIComponent()`：
## 安全模式
- 存储的令牌使用 AES-256-GCM 加密，密钥基于机器身份派生（`src/auth.ts`）
- 密钥从 hostname + username 通过 `scryptSync` 派生
- 认证文件权限：`0o600`，配置目录权限：`0o700`
- `acquireRefreshLock()` 使用排他文件创建（`"wx"` 标志）获取锁
- 通过检查 PID 是否仍存活来检测过期锁
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## 模式概览
- 单入口 CLI 路由器通过声明式注册表将请求分发到命令处理器
- 三层设计：命令层（界面/编排）-> 服务层（业务逻辑/API 调用）-> 工具层（纯辅助函数）
- 无 ORM、无数据库、无服务器 — 纯 CLI 工具，封装飞书开放 API
- 双认证模式：用户 OAuth 令牌（支持 PKCE + 自动刷新）和应用令牌
- 所有状态持久化到 `~/.feishu-docs/`（加密认证、备份、图片缓存）
- 零运行时依赖 — 仅使用 Node.js 内置模块（`node:http`、`node:crypto`、`node:fs/promises`、`node:util`）
## 分层结构
- 职责：解析 CLI 参数、路由到命令处理器、管理全局选项
- 位置：`src/cli.ts`
- 包含：命令注册表（`COMMANDS` map）、通过 `node:util.parseArgs` 进行参数解析、子命令分发
- 依赖：所有命令的 meta 导出
- 被使用：`bin/feishu-docs.js`（npm bin 入口）
- 职责：实现每个 CLI 命令的编排逻辑（验证输入、调用服务、格式化输出）
- 位置：`src/commands/*.ts`
- 包含：18 个命令处理器，按独立文件组织
- 依赖：客户端 (`src/client.ts`)、服务 (`src/services/`)、工具 (`src/utils/`)、解析器 (`src/parser/`)
- 被使用：CLI 路由器通过 `CommandMeta.handler` 调用
- 职责：封装多个命令共享的可复用业务逻辑
- 位置：`src/services/*.ts`
- 包含：文档块获取、Wiki 节点操作、Markdown 转换、块写入、图片下载
- 依赖：客户端 (`src/client.ts`)、工具 (`src/utils/errors.ts`)
- 被使用：命令层
- 职责：飞书开放 API 的认证 HTTP 客户端
- 位置：`src/client.ts`
- 包含：`createClient()`、`fetchWithAuth()`、`fetchBinaryWithAuth()`、`getTenantToken()` — 所有 API 通信均通过这些函数
- 依赖：认证模块 (`src/auth.ts`)、工具 (`src/utils/errors.ts`)
- 被使用：命令层和服务层
- 职责：OAuth 2.0 流程（PKCE S256）、令牌持久化（AES-256-GCM 加密）、自动刷新（基于文件锁）
- 位置：`src/auth.ts`、`src/scopes.ts`
- 包含：`oauthLogin()`、`resolveAuth()`、`saveTokens()`、`loadTokens()`、`refreshUserToken()`、`acquireRefreshLock()`
- 依赖：工具 (`src/utils/errors.ts`)
- 被使用：客户端层、login/authorize 命令
- 职责：将飞书块树转换为 Markdown（读取方向）
- 位置：`src/parser/*.ts`
- 包含：`blocksToMarkdown()`（树构建 + 按块类型渲染）、`elementsToMarkdown()`（行内格式化）、`BlockType` 常量
- 依赖：类型 (`src/types/index.ts`)
- 被使用：`read` 命令、`cat` 命令
- 职责：共享的 TypeScript 类型定义
- 位置：`src/types/index.ts`
- 包含：错误类型、认证类型、CLI 类型、文档/块类型、API 响应类型
- 依赖：无
- 被使用：所有其他层
- 职责：无副作用的纯工具函数
- 位置：`src/utils/*.ts`
- 包含：错误处理、URL 解析、输入验证、文档解析、成员 ID 检测、版本检查、权限范围提示
- 依赖：类型层、认证层（仅 scope-prompt）
- 被使用：命令层和服务层
## 数据流
- 认证令牌：加密文件 `~/.feishu-docs/auth.json`（AES-256-GCM，机器绑定密钥派生）
- 文档备份：JSON 文件 `~/.feishu-docs/backups/{docId}-{timestamp}.json`（每文档 10 个，自动轮换）
- 图片缓存：下载文件 `~/.feishu-docs/images/{fileToken}.{ext}`（持久缓存，不自动清理）
- 更新检查：`~/.feishu-docs/.update-check.json`（24 小时 TTL）
- 刷新锁：`~/.feishu-docs/.refresh.lock`（基于 PID 的排他文件锁，过期检测）
## 关键抽象
- 职责：命令的声明式定义（选项模式 + 处理器函数）
- 示例：`src/commands/*.ts` 中每个文件导出一个 `meta` 对象
- 模式：注册模式 — `src/cli.ts` 将所有 meta 导入 `COMMANDS` record，按名称分发
- 职责：表示已解析的认证上下文，传递给所有 API 调用
- 示例：`src/types/index.ts`（`AuthInfo` 接口）
- 模式：每次命令调用由 `createClient()` 创建一次，贯穿所有 API 调用
- 职责：带类型、退出码、恢复提示和可选 API 错误码的结构化错误
- 示例：`src/utils/errors.ts`（`CliError` 类）
- 模式：所有错误都是 CliError 实例；`handleError()` 格式化并以正确的退出码退出
- 职责：服务端转换的块树（从 Markdown），可直接用于 Descendant API 写入
- 示例：`src/types/index.ts`，在 `src/services/markdown-convert.ts` 中使用
- 模式：由 Convert API 返回，清理只读字段后，分批写入
- 职责：将 URL/token 输入规范化为完全解析的文档描述符
- 示例：`src/utils/url-parser.ts`（`parseDocUrl`）、`src/utils/document-resolver.ts`（`resolveDocument`）
- 模式：两阶段解析：URL 解析（同步）-> Wiki token 解析（异步 API 调用）
## 入口点
- 位置：`bin/feishu-docs.js`
- 触发：`npx feishu-docs <command>` 或全局 `feishu-docs <command>`
- 职责：导入 `dist/cli.js` 的 `run()`，传入 `process.argv.slice(2)`，处理致命错误
- 位置：`src/cli.ts`（导出）
- 触发：由 `bin/feishu-docs.js` 调用
- 职责：版本检查（后台）、帮助文本、命令路由、错误处理、参数解析
- 位置：`src/commands/*.ts`
- 触发：由 `run()` 根据第一个 CLI 参数分发
- 顶层命令：`login`、`logout`、`whoami`、`authorize`、`read`、`create`、`update`、`delete`、`info`、`spaces`、`tree`、`cat`、`search`、`ls`、`mv`、`cp`、`mkdir`、`install-skill`
- 子命令组：`share`（list/add/remove/update/set）、`wiki`（create-space/add-member/remove-member/rename/move/copy）
## 错误处理
- 所有 API/验证错误通过 `src/utils/errors.ts` 抛出 `CliError(type, message, options)`
- 退出码：0=成功，1=参数无效/文件未找到，2=认证失败，3=API 错误
- 每个 `CliError` 可携带：`apiCode`（飞书错误码）、`retryable` 标志、`recovery` 恢复提示字符串、`missingScopes` 数组
- `handleError()` 在 `src/utils/errors.ts` 中格式化错误（纯文本或 JSON）并调用 `process.exit()`
- `mapApiError()` 将飞书 API 错误码转换为对应的 `CliError` 类型（131006->PERMISSION_DENIED、131001->NOT_FOUND 等）
- `withScopeRecovery()` 在 `src/utils/scope-prompt.ts` 中为操作添加交互式权限范围错误恢复
- 非关键失败（图片下载、元数据获取）被捕获并作为警告写入 stderr，不会中断主操作
- 人类可读输出写入 stdout
- 错误、警告、进度消息写入 stderr
- `--json` 参数切换所有输出为机器可解析的 JSON 格式：`{ success: true, ... }` 或 `{ success: false, error: { type, message, ... } }`
## 横切关注点
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
