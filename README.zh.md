# feishu-docs-cli

[English](./README.md)

让 AI Agent（Claude Code、Codex、Trae 等）通过 shell 命令读写飞书云文档和知识库。

## 项目状态

> **说明**：飞书官方已发布 [lark-cli](https://github.com/larksuite/cli)（2025），覆盖 IM、日历、任务、通讯录、多维表格等全平台 API。相信官方工具会不断完善，**本项目将放缓新功能开发**，现有功能会继续维护，但不再计划大的功能新增。
>
> 如需完整的飞书 API 能力，请使用 [lark-cli](https://github.com/larksuite/cli)。如果主要场景是**文档和知识库**且需要标准 Markdown 输入输出，feishu-docs-cli 在这个细分领域仍有更好的体验。

## 与 lark-cli 的对比

基于同一知识库的真实操作对比（2026-03-29 实测）：

| 能力 | feishu-docs-cli | lark-cli（官方） |
|------|-----------------|------------------|
| **读取为 Markdown** | 标准 Markdown — 表格、列表、代码块正确渲染 | 返回 JSON + `<lark-table>` 自定义标签，非标准 Markdown |
| **知识库目录树** | `tree` 命令 — 一次调用，递归展示完整树 | 无此功能 — 需逐节点调用 `get_node` |
| **批量读取知识库** | `cat` — 递归读取所有子文档 | 无此功能 |
| **在知识库创建文档** | `--wiki <space> --parent <node>` — 支持指定父节点 | `--wiki-space` 和 `--wiki-node` 互斥，不能指定父节点 |
| **更新文档** | 接受文件路径（`--body file.md`），覆盖前自动备份 | 仅支持内联 `--markdown`，必须显式指定 `--mode` |
| **搜索** | `search "关键词"` — 一步到位 | 需要单独授权不同的 scope |
| **权限管理** | `share list/add/remove/update/set` — 完整封装 | 无封装 — 需手写原始 API 路径 |
| **JSON 输出** | 纯净可管道的 `--json` | stdout 混入进度文本（`[page 1] fetching...`），破坏 JSON 管道 |
| **错误提示** | 中文提示 + 恢复建议 + 缺失 scope 自动检测 | 英文错误提示，需手动查找 scope |
| **API 覆盖面** | 文档、知识库、云空间、搜索、权限 | **全平台** — IM、日历、任务、通讯录、多维表格、邮件、视频会议等 |
| **依赖** | 零运行时依赖（仅 Node.js 内置模块） | Go 二进制 |
| **冷启动** | ~0.5 秒（Node.js） | ~0.1 秒（Go） |

**一句话总结**：feishu-docs-cli 专注于**文档工作流** — 标准 Markdown 输入输出、知识库递归浏览、写入安全保障。lark-cli 是覆盖全平台的综合性 CLI。两者互补而非竞争。

## 功能

- **读取** 文档，输出 Markdown（图片自动下载到本地）、纯文本或原始 Block JSON
- **创建** 文档到知识库或云空间文件夹
- **更新** 文档，支持覆盖写入或追加模式（大文档自动分批）
- **删除** 文档（移至回收站）
- **详情** — 查看文档元信息（标题、类型、URL、版本号）
- **浏览** 知识库结构（空间列表、目录树、批量读取）
- **搜索** 按关键词搜索文档
- **分享** — 管理协作者（列表、添加、设置公开权限）
- **文件列表** — 浏览云空间文件夹
- 使用 TypeScript 编写，严格模式
- 零运行时依赖 — 使用原生 `fetch` 调用所有 API
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

   **基础权限**（免审核 — 执行 `feishu-docs login` 时自动申请）：

   | 权限 | 说明 |
   |------|------|
   | `offline_access` | Token 自动刷新（获取 refresh_token，7 天有效期） |
   | `wiki:wiki` | 知识库读写 |
   | `docx:document` | 文档读写 |
   | `docx:document.block:convert` | Markdown 转 Block（创建/更新需要） |
   | `sheets:spreadsheet:readonly` | 嵌入式电子表格只读（read 命令） |
   | `board:whiteboard:node:read` | 画板导出为图片（read 命令） |
   | `bitable:app:readonly` | 嵌入式多维表格只读（read 命令） |
   | `docs:document.media:download` | 下载云文档中的图片和附件 |

   **额外权限**会按需自动提示 — 当 API 调用需要你未授权的权限时，CLI 会从 API 错误响应中检测并提示你授权。常见权限：

   | 权限 | 说明 |
   |------|------|
   | `drive:drive` | 云空间文件管理（ls、delete、share、mv、cp、mkdir） |
   | `contact:contact.base:readonly` | 通过邮件/手机号查找用户 |
   | `drive:drive.search:readonly` | 搜索云文档 |

4. 进入 **安全设置**，在 **重定向 URL** 白名单中添加 OAuth 回调地址：
   - 默认值：`http://127.0.0.1:3456/callback`
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

如果应用注册的重定向 URL 与默认值（`http://127.0.0.1:3456/callback`）不同，需要传入完全一致的值：

```bash
# 使用与飞书开放平台注册的完全一致的重定向 URI
feishu-docs login --redirect-uri http://127.0.0.1:3456/callback

# 或仅更改端口，保持默认的 localhost 路径
feishu-docs login --port 4567
```

## 使用

### 读取

```bash
# 读取文档，输出 Markdown（图片自动下载到 ~/.feishu-docs/images/）
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

文档中的图片会自动下载到 `~/.feishu-docs/images/`，在 Markdown 输出中引用本地文件路径。缓存有效期 30 天。

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

### 文件操作

```bash
# 移动文件到指定文件夹
feishu-docs mv <url|token> <target_folder_token>

# 复制文件（自动命名为"标题 - 副本"）
feishu-docs cp <url|token> <target_folder_token>

# 指定副本名称
feishu-docs cp <url|token> <target_folder_token> --name "我的副本"

# 创建文件夹
feishu-docs mkdir "新文件夹" --parent <parent_folder_token>
```

### 分享

```bash
# 查看协作者
feishu-docs share list <url>

# 添加协作者
feishu-docs share add <url> user@example.com --role view
feishu-docs share add <url> ou_xxx --role edit

# 移除协作者
feishu-docs share remove <url> user@example.com

# 修改协作者权限
feishu-docs share update <url> ou_xxx --role manage

# 设置公开分享模式
feishu-docs share set <url> --public tenant          # 组织内可读
feishu-docs share set <url> --public tenant:edit      # 组织内可编辑
feishu-docs share set <url> --public open             # 互联网可读
feishu-docs share set <url> --public closed           # 关闭链接分享
```

角色：`view`（查看）、`edit`（编辑）、`manage`（管理）。成员类型自动识别（邮箱、openid、unionid、openchat、userid）。

### 认证

```bash
feishu-docs login          # OAuth 登录（默认回调：http://127.0.0.1:3456/callback）
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
| `-v, --version` | 显示版本号 |

## 认证模式

| 模式 | Token 类型 | 适用场景 |
|------|-----------|----------|
| `user` | user_access_token | 个人文档、协作、搜索 |
| `tenant` | tenant_access_token | 应用管理的文档、CI/CD |
| `auto` | 自动选择最佳 | 默认 — 优先用户 token，回退到租户 token |

## AI Agent 集成

### Claude Code

通过 [skills.sh](https://skills.sh) 安装 Skill（支持 Claude Code、Cursor、Codex 等 40+ Agent）：

```bash
npx skills add cliff-byte/feishu-docs-cli
```

或通过 CLI 直接安装：

```bash
feishu-docs install-skill
```

安装后在 Claude Code 中使用 `/feishu-docs` 即可激活。

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
- [x] 质量加固 — 456 个测试、重试逻辑、错误恢复、死代码清理

> 多维表格和电子表格操作不再计划。如有需要，请使用官方 [lark-cli](https://github.com/larksuite/cli)。

## 限制

- **支持**：docx（新版文档）
- **嵌入内容**：电子表格（渲染为表格）、多维表格（渲染为表格）、画板/白板（导出为图片）
- **仅链接**：思维笔记（mindnote）
- **不支持**：doc（旧版格式）
- Markdown 转换有损（颜色、合并单元格、布局会丢失）。使用 `--blocks` 获取无损 JSON。
- 图片读取时自动下载到本地（`~/.feishu-docs/images/`，30 天缓存）。不支持图片写入。

## 许可证

MIT
