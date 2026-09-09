# feishu-docs-cli

[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D18.3.0-blue)](https://nodejs.org) [![npm](https://img.shields.io/npm/v/feishu-docs-cli)](https://www.npmjs.com/package/feishu-docs-cli) [![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)

中文文档 | [English](./README.md)

让 AI Agent（Claude Code、Codex、Trae 等）通过 shell 命令读写飞书云文档和知识库。

## 项目状态

> **说明**：飞书官方已发布 [lark-cli](https://github.com/larksuite/cli)（2026），覆盖 IM、日历、任务、通讯录、多维表格等全平台 API。相信官方工具会不断完善，**本项目将放缓新功能开发**，现有功能会继续维护，但不再计划大的功能新增。
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
| **API 覆盖面** | 文档、知识库、云空间、搜索、权限、多维表格读取 | **全平台** — IM、日历、任务、通讯录、多维表格、邮件、视频会议等 |
| **依赖** | 零运行时依赖（仅 Node.js 内置模块） | Go 二进制 |
| **冷启动** | ~0.5 秒（Node.js） | ~0.1 秒（Go） |

**一句话总结**：feishu-docs-cli 专注于**文档工作流** — 标准 Markdown 输入输出、知识库递归浏览、写入安全保障。lark-cli 是覆盖全平台的综合性 CLI。
## 功能

- **读取** 文档，输出 Markdown（图片自动下载到本地）、纯文本或原始 Block JSON
- **读取多维表格** — 表格/视图 URL 和记录分享 URL，输出 Markdown 或结构化 JSON
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
   | `sheets:spreadsheet:readonly` | 内嵌及独立电子表格只读 |
   | `board:whiteboard:node:read` | 画板导出为图片（read 命令） |
   | `bitable:app:readonly` | 多维表格及内嵌表格只读（read 命令） |
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
# 读取文档，输出飞书服务端生成的 Markdown
feishu-docs read https://xxx.feishu.cn/wiki/wikcnXXX

# 通过 token 读取
feishu-docs read wikcnXXX

# 原始 Block JSON（无损）
feishu-docs read <url> --blocks

# 纯文本
feishu-docs read <url> --raw

# 带元信息头
feishu-docs read <url> --with-meta

# 读取独立多维表格/视图，输出 Markdown
feishu-docs read 'https://xxx.feishu.cn/base/bascnXXX?table=tblXXX&view=vewXXX'

# 读取多维表格或记录分享链接，保留原始字段值
feishu-docs read '<bitable-or-record-url>' --json
```

文档读取使用飞书 `docs_ai` 输出的 Markdown。嵌入式电子表格标签会展开为 Markdown 表格，待办标签会通过 Task v2 补全标题、状态和负责人。交互模式下若缺少 `task:task:read`，会自动打开 OAuth 授权页；用户拒绝、授权失败或处于非交互模式时，保留原始标签并继续读取文档。`--blocks` 仍返回原始 Block JSON；`docs_ai` 不可用时回退到原有本地渲染器。

独立多维表格改用 Bitable API：表格/视图 URL 返回完整记录的 Markdown 表格，记录分享 URL 返回单条字段/值表格。使用 `--json` 可保留数组和对象原值。视图会控制记录筛选和排序，但输出仍包含数据表的完整字段结构。

### 电子表格

```bash
# 按工作簿顺序读取所有工作表，包括隐藏表
feishu-docs read 'https://xxx.feishu.cn/sheets/shtcnXXX' --json

# 按 ID 选择工作表，优先于 URL 中的 sheet 参数
feishu-docs read '<sheets或wiki链接>' --sheet <sheet_id>

# 精确读取矩形，保留空白单元格的坐标
feishu-docs read '<sheets或wiki链接>' --sheet <sheet_id> --range B2:AA600 --json

# 裸电子表格 token 必须明确指定类型
feishu-docs read <spreadsheet_token> --type sheet

# 通过飞书官方导出接口下载整本 xlsx
feishu-docs export '<sheets或wiki链接>' --format xlsx --output ./workbook.xlsx
```

`read`、`cat` 的内嵌表格及 Block 回退均按完整网格跨行列分块读取，不再限制为前 100 行。响应过大时继续拆分，请求限频时有界重试。某张表失败或在读取中改变版本时保留占位并给出恢复建议；API 未返回 revision 时，不宣称结果已通过版本一致性验证。

独立读取使用 Sheets API，并在内存中聚合结果；内存占用随所选网格和输出大小增长。未选择工作表时读取整本，包含隐藏表和空表；任何目标失败或类型不支持，整个命令在输出前失败。`--sheet` 优先于 URL 的 `sheet` 参数。`--range` 仅接受网格内正向、有限的矩形，例如 `A1:B20`，且必须明确选择一张表或只有一张可读取的普通工作表。整表 Markdown 用首行作表头并裁掉尾部全空行列；范围 Markdown 用列字母作表头，保留精确的请求尺寸。JSON 包含工作表 ID、顺序、隐藏状态、请求/数据范围和二维值数组。读取的是显示值，不保留公式、样式或合并结构。`--raw`、`--blocks` 用于 docx；`--with-meta` 也支持电子表格。

Sheets API 可能返回 `90235: Data not ready`。当前 CLI 不会自动重试此业务错误，请稍后重新执行读取。读取文档内嵌表格时，应检查警告和保留的占位，确认内容是否完整。

`export` 直接下载官方 xlsx 字节。它始终导出整本，即使 URL 带有 `sheet`；显式 `--sheet`、`--range` 会被拒绝。输出目录必须存在，目标文件必须不存在。下载流式写入私有临时文件，完成后原子发布，并保护并发出现的同名目标。任务默认等待 120 秒；每次下载的完整传输限时 60 秒。查询、下载的暂态失败最多重试两次，下载重试从空内容重新开始；创建结果不确定时不自动重复创建。

导出成功仅表示文件下载完成，不保证公式兼容 Excel。线上实测中，飞书 `IMPORTRANGE` 公式原样保留在导出文件中，在 Excel 中产生 `#NAME?`，并传递到依赖它的汇总和比率公式。CLI 不转换公式，也不将外部引用的数据嵌入文件；仅重新计算无法修复不受支持的函数。此外，导出的公式单元格可能没有缓存结果，使用 `openpyxl` 的 `data_only=True` 等方式读取时，即使公式存在也可能返回空值。受支持的公式需要兼容的计算引擎计算并保存结果。

导出权限 `docs:document:export` 与 `drive:export:readonly` 满足其一即可（[官方接口权限说明](https://open.feishu.cn/document/server-docs/docs/drive-v1/export_task/create)）。应用后台开通权限，不代表已有用户访问令牌已获得该权限。若已开通 `docs:document:export`，运行 `feishu-docs authorize --scope "docs:document:export"` 为用户令牌补充授权后再重试导出，无需同时开通两个权限。

授权只在失败步骤恢复一次，继续原任务前确认仍是同一用户。JSON、非交互、tenant、环境变量固定 token 模式不启动 OAuth。Ctrl-C 停止本地操作并清理临时内容；强制终止可能在目标目录留下隐藏临时目录。本地超时不会取消远端任务。当前没有跨命令恢复、覆盖开关、CSV 或范围导出。

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

# 朴素表格：不设标题行、列宽均分
feishu-docs create "API 文档" --folder <folder_token> --body ./api.md --no-table-header --no-table-column-width

# 为更宽的页宽模式适配表格宽度
feishu-docs create "API 文档" --folder <folder_token> --body ./api.md --table-width 1100
```

写入 Markdown 表格时，默认会做两项可读性增强（`create`/`update` 均生效）：

- **标题行** —— 首行设为标题行（对应飞书界面的「设置为标题行」）。用 `--no-table-header` 关闭。
- **列宽自适应** —— 短列（如编号列）保持窄、长文本列分到更多空间、超长的单列会被封顶以免独占、内容多的表格缩放占满页宽、小表格保持紧凑不被拉伸（对应「列宽自适应」）。用 `--no-table-column-width` 关闭。默认按 docx **默认页宽**（约 815px）适配；「较宽/全宽」页宽请用 `--table-width <px>`（200–2000）。这是写入时的一次性像素估算（非精确，且绝对像素不随窗口缩放变化）。

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

需要修改已有段落并保留人员 @ 提及时，使用 `patch`：先通过 `info <url> --json`
获取 `revision`，再通过 `read <url> --blocks --json` 找到块 ID 和原文。
将补丁保存为 `edits.json`，填入实际版本和块 ID：

```json
{
  "document_revision_id": 42,
  "edits": [
    { "block_id": "actualBlockId", "old_text": "原始文本", "new_text": "替换后的文本" }
  ]
}
```

```bash
feishu-docs patch <url> --body edits.json --dry-run --json
feishu-docs patch <url> --body edits.json --json
# 也可通过 --body - 从 stdin 读取补丁 JSON
```

`patch` 仅替换指定块中的普通文本，保留原块 ID、文本样式、人员提及及其他未修改元素。
`old_text` 必须在该块的单个 `text_run` 内唯一匹配，`new_text` 按字面文本写入（不解析 Markdown）。
跨格式、跨提及、重复或缺失的匹配会报错；表格中的文字应选择单元格内的文本块。
每次接受 1–200 个不同块的替换，先校验全部操作再发送一次写入请求。
版本号必须明确指定，不能使用 `-1`；发生版本冲突需重新读取并生成补丁。
飞书的版本参数不是原子锁：最后一次检查与提交之间的并发修改仍可能被覆盖。
返回版本跳变时，命令报错并提供 `error.details.write_may_have_applied: true`，
此时写入可能已生效，需结合回读和版本历史核验；它不提供并发编辑的原子隔离保证。
`--dry-run` 只读预览；响应列出修改项、基准/结果版本及实际更新块数。
写入失败或超时后先读取核验，避免直接重试；此命令不清空文档，也不执行整篇备份恢复。

真实端到端测试：`npm run build && node scripts/patch-live-e2e.mjs --run`。
使用已有用户登录，创建临时文档，以当前用户的两处提及验证保留效果，并验证提交窗口内的竞态。
结束后尝试移入回收站；缺少删除权限时报告清理失败并输出待清理链接。

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
- [x] 只读多维表格/视图和记录分享链接
- [x] 质量加固 — 535 个测试、重试逻辑、错误恢复、死代码清理

> 多维表格和电子表格写入不在计划内。如有需要，请使用官方 [lark-cli](https://github.com/larksuite/cli)。

## Mermaid 图表

feishu-docs-cli 和 lark-cli 在写入 Mermaid 时的处理方式不同：

| | feishu-docs-cli | lark-cli（官方） |
|---|---|---|
| **写入** | 保存为 `` ```mermaid `` 代码块（block_type 14） | 通过 Lark MCP 转换为画板（block_type 43） |
| **读取自己写入的内容** | 返回原始 Mermaid 代码 — 无损读写往返 | 返回画板节点图（形状、坐标、连接线）— 无法还原 Mermaid 源码 |
| **读取云文档原生 Mermaid** | 两个工具都能正常读取飞书文档中原生的 Mermaid 代码块，没有问题 |
| **人类可读性** | 文档中显示为代码块，不会可视化渲染（飞书支持"文本绘图"块，但 Open API 无法创建） | 立即渲染为可交互的图表 |
| **适合场景** | AI Agent 工作流 — Mermaid 读写往返无损 | 人工阅读 — 可视化图表，但单向（写入后无法读回源码） |

**为什么这样取舍？** 飞书有原生的"文本绘图"块可以渲染 Mermaid，但 Open API 的 Convert 接口不支持创建它 — Mermaid 被当作普通代码块处理。lark-cli 通过 Lark MCP 协议将 Mermaid 转为画板来绕过此限制，视觉效果好但丢失了 Mermaid 源码。我们选择保留代码块，确保 AI Agent 能可靠地读取和修改图表。

## 限制

- **支持**：docx（读写）、独立电子表格（读取和 xlsx 导出）、独立多维表格/视图和记录分享链接（只读）
- **嵌入内容**：电子表格（渲染为表格）、多维表格（渲染为表格）、画板/白板（导出为图片）
- **仅链接**：思维笔记（mindnote）
- **不支持**：doc（旧版格式）
- `docs_ai` 返回飞书风格 Markdown。嵌入式电子表格和待办标签会被补全，其他特殊块仍可能保留为类 XML 标签。使用 `--blocks` 获取无损 JSON。
- 独立多维表格不使用 `docs_ai`；使用 `--json` 保留原始字段值。`--raw`、`--blocks` 仅适用于 docx；`--with-meta` 也支持电子表格。
- `docs_ai` 不可用时，回退渲染器会把图片下载到本地（`~/.feishu-docs/images/`，30 天缓存）。
- 支持写入独立成段的本地 Markdown 图片，例如 `![截图](./images/demo.png)`。当前不支持行内图片、列表/表格中的本地图片，且图片路径必须位于 Markdown 文件所在目录及其子目录内。

## 许可证

MIT
