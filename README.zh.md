# feishu-docs-cli

[English](./README.md)

让 AI Agent（Claude Code、Codex、Trae 等）通过 shell 命令读写飞书云文档和知识库。

## 功能

- **读取** 文档，输出 Markdown、纯文本或原始 Block JSON
- **创建** 文档到知识库或云空间文件夹
- **更新** 文档，支持覆盖写入或追加模式
- **删除** 文档（移至回收站）
- **详情** — 查看文档元信息（标题、类型、URL、版本号）
- **浏览** 知识库结构（空间列表、目录树、批量读取）
- **搜索** 按关键词搜索文档
- **分享** — 管理协作者（列表、添加、设置公开权限）
- **文件列表** — 浏览云空间文件夹
- 使用 TypeScript 编写，严格模式
- 零额外运行时依赖 — 仅依赖 `@larksuiteoapi/node-sdk`
- Agent 友好输出 — 纯文本或 JSON，无交互式 UI

## 安装

```bash
npm install -g feishu-docs-cli
```

或通过 npx 直接运行：

```bash
npx feishu-docs-cli read <url>
```

也可以从 GitHub 安装：

```bash
npm install -g github:cliff-byte/feishu-docs-cli
```

需要 Node.js >= 18.3。

## 配置

### 1. 创建飞书应用

1. 前往[飞书开放平台](https://open.feishu.cn/app)，点击 **创建企业自建应用**，填写应用名称和描述
2. 创建完成后，进入应用的 **凭证与基础信息** 页面，复制 **App ID**（`cli_xxx`）和 **App Secret** — 后续配置环境变量需要用到
3. 进入 **权限管理**，搜索并添加以下权限：

   | 权限 | 说明 | 是否必需 |
   |------|------|----------|
   | `wiki:wiki` | 知识库访问 | 是 |
   | `docx:document` | 文档读写 | 是 |
   | `docx:document.block:convert` | Markdown 转 Block | 是（创建/更新需要） |
   | `drive:drive` | 文件管理和权限管理 | 是 |
   | `contact:contact.base:readonly` | 用户名解析（@提及） | 推荐 |
   | `board:whiteboard:node:read` | 白板内容读取 | 可选 |
   | `bitable:app:readonly` | 多维表格只读 | 可选 |

4. 进入 **安全设置**，在 **重定向 URL** 白名单中添加 OAuth 回调地址：
   - 默认值：`http://localhost:3456/callback`
   - 该地址必须与 `feishu-docs login` 使用的值完全一致

5. **发布应用版本**：进入 **应用发布** → **创建版本** → 提交审核 → 审核通过（企业自建应用通常自动通过）

> **提示**：使用 tenant（应用）身份访问文档时（如 CI/CD 场景），需要将应用添加为文档或知识库的协作者，或通过管理后台授权文档范围。

### 2. 设置环境变量

```bash
export FEISHU_APP_ID="cli_xxx"        # 上面第 2 步获取的 App ID
export FEISHU_APP_SECRET="xxx"         # 上面第 2 步获取的 App Secret
```

### 3. 登录（获取用户级别访问权限）

用户级别访问支持个人文档、搜索和协作等功能。

```bash
feishu-docs login
```

执行后会打开浏览器进行 OAuth 授权，token 加密保存到 `~/.feishu-docs/auth.json`。

如果应用注册的重定向 URL 与默认值（`http://localhost:3456/callback`）不同，需要传入完全一致的值：

```bash
# 使用与飞书开放平台注册的完全一致的重定向 URI
feishu-docs login --redirect-uri http://127.0.0.1:3456/callback

# 或仅更改端口，保持默认的 localhost 路径
feishu-docs login --port 4567
```

## 使用

### 读取

```bash
# 读取文档，输出 Markdown
feishu-docs read https://xxx.feishu.cn/wiki/wikcnXXX

# 通过 token 读取
feishu-docs read wikcnXXX

# 原始 Block JSON（无损）
feishu-docs read <url> --blocks

# 纯文本
feishu-docs read <url> --raw

# 带元信息头
feishu-docs read <url> --with-meta
```

### 知识库

```bash
# 列出所有知识库
feishu-docs spaces

# 查看目录树
feishu-docs tree <space_id>
feishu-docs tree <space_id> --depth 2

# 递归读取所有文档
feishu-docs cat <space_id> --max-docs 20
feishu-docs cat <space_id> --node <token> --title-only
```

### 搜索

```bash
feishu-docs search "API 设计" --type docx --limit 10
```

需要用户级别 token，请先执行 `feishu-docs login`。

### 创建

```bash
# 在知识库中创建
feishu-docs create "API 文档" --wiki <space_id> --body ./api.md

# 在云空间文件夹中创建
feishu-docs create "API 文档" --folder <folder_token> --body ./api.md

# 创建空文档
feishu-docs create "API 文档"

# 从标准输入读取
cat design.md | feishu-docs create "设计文档" --wiki <space_id> --body -
```

### 更新

```bash
# 覆盖写入（自动备份）
feishu-docs update <url> --body ./updated.md

# 追加内容
feishu-docs update <url> --body ./extra.md --append

# 从标准输入读取
echo "## 新章节" | feishu-docs update <url> --body - --append

# 从备份恢复
feishu-docs update <url> --restore ~/.feishu-docs/backups/xxx.json
```

### 删除

```bash
feishu-docs delete <url> --confirm
```

将文档移至回收站（30 天内可恢复）。

### 详情

```bash
feishu-docs info <url|token>
feishu-docs info <url> --json
```

### 文件列表

```bash
# 列出根目录
feishu-docs ls

# 列出指定文件夹
feishu-docs ls <folder_token>

# 按类型筛选
feishu-docs ls --type docx --limit 20
```

### 分享

```bash
# 查看协作者
feishu-docs share list <url>

# 添加协作者
feishu-docs share add <url> user@example.com --role view
feishu-docs share add <url> ou_xxx --role edit

# 设置公开分享模式
feishu-docs share set <url> --public tenant          # 组织内可读
feishu-docs share set <url> --public tenant:edit      # 组织内可编辑
feishu-docs share set <url> --public open             # 互联网可读
feishu-docs share set <url> --public closed           # 关闭链接分享
```

角色：`view`（查看）、`edit`（编辑）、`manage`（管理）。成员类型自动识别（邮箱、openid、unionid、openchat、userid）。

### 认证

```bash
feishu-docs login          # OAuth 登录（默认回调：http://localhost:3456/callback）
feishu-docs logout         # 清除保存的凭证
feishu-docs whoami         # 查看当前认证状态
```

## 全局选项

| 选项 | 说明 |
|------|------|
| `--auth <user\|tenant\|auto>` | 认证模式（默认：auto） |
| `--json` | JSON 格式输出 |
| `--lark` | 使用 Lark（国际版）域名 |
| `--help` | 显示帮助 |

## 认证模式

| 模式 | Token 类型 | 适用场景 |
|------|-----------|----------|
| `user` | user_access_token | 个人文档、协作、搜索 |
| `tenant` | tenant_access_token | 应用管理的文档、CI/CD |
| `auto` | 自动选择最佳 | 默认 — 优先用户 token，回退到租户 token |

## AI Agent 集成

### Claude Code

安装内置 Skill，让 Claude 学会使用 feishu-docs：

```bash
feishu-docs install-skill
```

Skill 文件会安装到 `~/.claude/commands/feishu-docs.md`。安装后在 Claude Code 中使用 `/feishu-docs` 即可激活。

### 其他 Agent

将以下指令添加到 Agent 的系统提示词或配置中：

```
读取文档:     feishu-docs read <url>
搜索文档:     feishu-docs search <关键词>
浏览知识库:   feishu-docs tree <space_id>
批量读取:     feishu-docs cat <space_id> --max-docs 10
创建文档:     feishu-docs create <标题> --wiki <space_id> --body <文件>
更新文档:     feishu-docs update <url> --body <文件>
使用 --json 获取结构化输出。运行 feishu-docs --help 查看所有命令。
```

### 程序化调用

所有命令输出到 stdout（结果）和 stderr（错误/警告）。退出码：

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 认证失败 |
| 3 | API 错误 |

使用 `--json` 获取结构化输出，便于 Agent 解析。

## 写入安全

覆盖写入（`update` 不带 `--append`）自动执行：

1. **备份** 当前文档到 `~/.feishu-docs/backups/`
2. **清空** 后 **重写** 文档
3. 写入失败时 **自动恢复** 备份
4. **轮转** 备份文件（保留最近 10 份）

飞书本身也维护版本历史 — 你随时可以在飞书客户端中回滚。

## 开发

```bash
git clone https://github.com/cliff-byte/feishu-docs-cli.git
cd feishu-docs-cli
npm install

# 类型检查
npm run build:check

# 构建（输出到 dist/）
npm run build

# 运行测试
npm test

# 从源码运行
npm run build && node bin/feishu-docs.js --help
```

### 项目结构

```
src/
  types/          # 共享 TypeScript 类型定义
  commands/       # CLI 命令处理器
  services/       # API 服务层
  parser/         # Block 转 Markdown 解析器
  utils/          # 校验、错误处理、URL 解析
test/             # 单元测试（node:test）
bin/              # CLI 入口（JS shim → dist/）
dist/             # 编译输出（不提交到 git）
```

## 路线图

- [x] 飞书云文档操作（读取、创建、更新、删除、详情）
- [x] 知识库操作（空间列表、目录树、批量读取、Wiki 管理、分享、搜索）
- [ ] 飞书多维表格操作
- [ ] 飞书电子表格操作

## 限制

- **支持**：docx（新版文档）
- **仅链接**：sheet、bitable、mindnote、board
- **不支持**：doc（旧版格式）
- Markdown 转换有损（颜色、合并单元格、布局会丢失）。使用 `--blocks` 获取无损 JSON。
- 不支持图片写入（读取返回约 24 小时有效的临时 URL）

## 许可证

MIT
