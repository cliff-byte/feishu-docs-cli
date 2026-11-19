# 云文档评论读取、发表与回复技术方案

- 状态：已实现 01—05，自动化测试与线上端到端验证通过（2026-11-19，见第 6 节）；局部评论在 UI 中的高亮范围未经人工目视确认
- 日期：2026-11-17
- 实施顺序：读取评论 → 回复评论 → 发表评论（全文 / 局部）
- 约束：零运行时依赖；CLI 现有命令接口不变；遵循现有认证、输入校验、不可变数据和 CliError 约定
- 首版资源范围：docx（含解析为 docx 的 wiki）；读取额外支持 sheet

## 1. 目标

让 Agent 能用一组命令完成评论闭环：读出文档上的评论卡片（含回复和正文落点），对已有评论回复，对全文或指定块发表新评论，并解决 / 重新打开评论。不做 reaction、删除 / 编辑回复，也不做事件订阅。

## 2. 已核实的接口事实

核实日期为 2026-11-17。前三行及 PATCH 来自飞书官方文档；标注“lark-cli”的来自飞书官方 CLI [larksuite/cli](https://github.com/larksuite/cli)（`shortcuts/drive/*comment*.go`、`skills/lark-drive/references/`），没有找到对应的公开文档页，必须先做线上验证再交付。

| 能力 | 接口 | 要点 |
| --- | --- | --- |
| 列出评论 | `GET /drive/v1/files/:token/comments` [来源](https://open.feishu.cn/document/server-docs/docs/CommentAPI/list.md) | `file_type` 必填（doc/docx/sheet/file/slides）；`is_whole`、`is_solved` 过滤；`page_size` 最大 100；每张卡片内嵌 `reply_list`，回复超出时卡片自身 `has_more` / `page_token` 为真；限频 50/s |
| 列出回复 | `GET .../comments/:comment_id/replies` [来源](https://open.feishu.cn/document/server-docs/docs/CommentAPI/list-2.md) | `page_size` 最大 100；**限频 100 次/分钟**，比列评论严格得多 |
| 全文评论（v1） | `POST /drive/v1/files/:token/comments` [来源](https://open.feishu.cn/document/server-docs/docs/CommentAPI/create.md) | 仅 doc/docx；**只支持全文评论，不支持局部评论** |
| 解决 / 恢复 | `PATCH .../comments/:comment_id` [来源](https://open.feishu.cn/document/server-docs/docs/CommentAPI/patch.md) | 只需传 `is_solved` 一个字段；支持 docx 与 sheet |
| 评论落点（lark-cli） | 列表接口加 `need_relation=true` | 仅 docx 有效。`relation.relation` 是**需要再解析一次的 JSON 字符串**，块 ID 在其中的 `positionInfo.blockID`；`relation.content_deleted=true` 表示原文已被删（孤儿评论）；落在内嵌 sheet/bitable/画板内的评论只返回 `parent_type` + `parent_token` |
| 回复（lark-cli） | `POST .../comments/:comment_id/replies` | body `{content:{elements:[...]}}`，最多 100 个元素。lark-cli 注明：在 docx 上，在 v1 create 的 body 里带 `comment_id` **不会**生成回复，而是静默新建一条评论；全文评论和已解决评论不接受回复 |
| 局部 / 全文评论（lark-cli） | `POST /drive/v1/files/:token/new_comments`（create_v2） | body `{file_type, reply_elements, anchor?}`；省略 `anchor` 为全文评论，`anchor.block_id` 为局部评论。元素格式是简化的 `text`/`mention_user`/`link`，与 v1 的 `text_run`/`person`/`docs_link` 不同 |
| 内容限制（lark-cli 线上实测） | create_v2 | 所有 text 合计最多 10000 个字符（按字符计，不按字节），超出时服务端只返回 `1069302`；`<` `>` 需转义为 `&lt;` `&gt;`；`link` 只接受飞书云文档 URL |

权限（任一即可，均由现有的被动授权流程按需申请，不加入 `BASE_SCOPES`）：读取用 `docs:document.comment:read`，发表 / 回复用 `docs:document.comment:create`；`drive:drive` 覆盖全部。

错误码 `1069301`—`1069399` 是评论接口特有的，目前不在 `mapApiError()` 中。

lark-cli 的反面教训（[PR #1114](https://github.com/larksuite/cli/pull/1114)）：用 `quote` 文本反向匹配正文的定位方案已被放弃，原因是重复文本有歧义、文档修改后会漂移、块级评论的 quote 只是占位符。本方案只用 `relation` 中的块 ID，不做文本匹配。另外，列表默认会包含已解决评论和孤儿评论，实测 45 条中只有 21 条在 UI 中可见。

## 3. 命令设计

新增子命令组 `comment`，形态与 `share` / `wiki` 一致。现有命令不变。

```
comment list  <url|token> [--status open|solved|all] [--scope all|whole|partial] [--type sheet]
comment reply <url|token> <comment_id> (--text <s> | --elements <json>)
comment add   <url|token> (--text <s> | --elements <json>) [--block <block_id>]
comment resolve <url|token> <comment_id>
comment reopen  <url|token> <comment_id>
```

- **list 默认 `--status open`**，并排除孤儿评论，使默认结果等于用户在 UI 中看到的评论；`--status all` 会把孤儿评论也列出，并单独标注。
- **自动翻页且补全回复**：先拉完所有评论页，只对 `has_more=true` 的卡片再调回复接口。考虑到回复接口 100 次/分钟的限频，复用现有的 `retry.ts` 和 `pLimit()` 做有界的串行补全；补全失败时该卡片标注 `replies_truncated`，不让整个命令失败。
- **内容输入**：`--text` 传纯文本，覆盖常见场景；`--elements` 传 `[{type:"text"|"mention_user"|"link", ...}]` 数组，需要 @ 人或插入文档链接时使用。两者互斥。转义、10000 字符上限、回复 100 个元素上限都在本地预检，不把不透明的 `1069302` 透给用户。
- **局部评论的块 ID** 来自现有的 `read --blocks`，与 `patch` 的取块方式一致。如果先做一次块存在性检查，就会额外读取文档，因此本期不做，由服务端报错。

### 输出

人类模式下，每张卡片一段：状态、作者显示名、时间、落点（`block_id` 或 “全文” / “内嵌 sheet” / “原文已删”）、quote，后接回复列表。`--json` 输出规范化后的结构，不透传原始响应：

```json
{ "success": true, "file_token": "...", "file_type": "docx", "count": 1,
  "comments": [{ "comment_id": "...", "is_whole": false, "is_solved": false,
    "quote": "...", "anchor": { "block_id": "...", "status": "exact" },
    "replies": [{ "reply_id": "...", "user_id": "ou_..", "user_name": "...",
      "create_time": 1731800000, "text": "请 @张三 看下", "elements": [...] }] }] }
```

`anchor.status` 取以下值之一：`exact`（拿到了块 ID）、`embedded`（只有 `parent_type`/`parent_token`）、`deleted`、`whole`。不输出“推断”类定位。用户显示名复用 `resolveUserNames()`，解析失败时只输出 ID。

## 4. Module 划分

| Module | Interface 与职责 |
| --- | --- |
| `src/services/comments.ts`（新） | `listComments(authInfo, target, filter)` 返回规范化卡片（隐藏翻页、回复补全、relation 二次解析）；`addReply(...)`、`addComment(...)`。所有请求走 `fetchWithAuth()`，路径参数经过 `validateToken()` 和 `encodeURIComponent()` |
| `src/utils/comment-content.ts`（新） | 纯函数：把 `--text` / `--elements` 解析为简化元素数组、转义、做上限预检；把简化元素转换为 v1 回复格式；把回复元素渲染成单行文本 |
| `src/commands/comment.ts`（新） | 子命令 meta、参数校验、文档解析（`resolveDocument`）、输出格式化、`withScopeRecovery` 包装 |
| `src/utils/errors.ts`（改） | 映射 1069303 → PERMISSION_DENIED，1069304/1069305/1069307 → NOT_FOUND，1069306 → 内容审核未通过，1069302 → 附带长度 / 链接 / 不可回复等恢复提示 |
| `src/cli.ts`、README、skill（改） | 注册命令、补充帮助文本和文档；skill 同步由现有的 `skill-sync` 测试兜底 |

## 5. 交付切片

| 编号 | 切片 | 依赖 | 可观察结果 |
| --- | --- | --- | --- |
| 01 | `comment list`（docx + wiki→docx） | 无 | 默认输出与 UI 一致的可见评论，含完整回复和块落点 |
| 02 | `comment list` 支持 sheet | 01 | sheets URL 或 `--type sheet` 可列出评论，此时不传 `need_relation` |
| 03 | `comment reply` | 01 | 能回复局部评论；对全文 / 已解决评论给出明确错误和恢复提示 |
| 04 | `comment add` | 03（共享内容模块） | 不带 `--block` 时发表全文评论，带 `--block` 时发表局部评论 |
| 05 | `comment resolve` / `reopen` | 01 | 切换评论解决状态 |

每个切片都带 `node:test` 用例，覆盖成功路径、翻页、回复补全、错误映射、输入校验和转义；mock 方式沿用 `test/helpers/mock-fetch.ts`。

## 6. 线上验证门槛与结果

以下事实原先只来自 lark-cli，已于 2026-11-19 在真实租户上验证（脚本 `scripts/comment-live-e2e.mjs --run`，user 与 tenant 身份）：

1. `need_relation` 的返回形态，以及 `positionInfo.blockID` 是否与 `read --blocks` 的 `block_id` 一致（影响 01）。
2. 回复接口在 docx 上能否成功；全文评论是否确实不能回复，以及失败时返回的错误码（影响 03）。
3. `new_comments` 在 user 身份和 tenant 身份下，全文评论与局部评论是否都能成功；局部评论在 UI 中显示的划词范围是整块还是什么（影响 04）。如果 `new_comments` 不可用，全文评论退回到有官方文档的 v1 create，局部评论推迟。
4. `docs:document.comment:*` 是否需要管理员审核，结论决定是否把读取权限加入 `BASE_SCOPES`。

| # | 结论 |
| --- | --- |
| 1 | 通过。`relation.relation` 确为二次编码字符串，`positionInfo.blockID` 与 `read --blocks` 一致；不传 `need_relation` 时 `extra.content_anchor_id` 也给出块 ID，已作回退。删除被评论块后 `content_deleted=true` |
| 2 | 回复接口可用。全文评论拒绝回复（`1069302` "does not allow replies"），已映射为 `NOT_SUPPORTED`；**已解决评论可以回复**，与 lark-cli 说法不符 |
| 3 | `new_comments` 在 user 与 tenant 身份下全文、局部评论均成功；全文评论也可 resolve/reopen。UI 高亮范围需人工目视，未验证 |
| 4 | `comment list` 用基础权限即可（列表接口接受 `sheets:spreadsheet:readonly` 等）；写入需 `docs:document.comment:create` / `:update`，本租户授权即时生效。`GET .../replies` 需要 `docs:document.comment:read`，因此 `BASE_SCOPES` 不变，补全回复缺权限时降级为 `replies_truncated` 并提示授权命令 |

验证中发现并修复的问题：

- 长度上限按**转义后**文本计算（2500 个 `<` 通过、2501 个失败；10000 个普通字符通过、10001 失败），评论与回复接口一致；lark-cli 的“按原始字符计”不成立。
- 不存在或已删除的 `--block`、不存在评论的 resolve/reopen 都只返回含糊的 `1069301`。现在失败后分别查块（`1770002` 即不存在）或查评论列表，给出不可重试的 `INVALID_ARGS` / `NOT_FOUND`。单条评论 GET 对 docx 即使评论存在也返回 `1069307`，不可用。
- API 在每个元素上附带 `null` 的兄弟字段，输出前已剔除。
- `resolveUserNames()` 读取 `user_list`，实际响应字段是 `items`，所有命令的用户名一直未解析（既有缺陷，测试 mock 同样写错），已修复。
- 列表接口在单张卡片 105 条回复时仍全部内联返回、无 `has_more`；回复补全路径保留为防御性回退。授权 `docs:document.comment:read` 后已线上验证 `GET .../replies` 分页（105 条 = 100 + 5，`has_more`/`page_token` 形态与列表一致，规范化结果与内联完全相同），E2E 脚本另以只改列表响应的故障注入验证整条补全路径。
- 列表接口返回的内联回复**顺序不稳定**（5 次中 2 次把后续回复排在根回复之前），而回复接口按时间顺序。现在统一按 `create_time`、再按数值 `reply_id` 排序，保证 `replies[0]` 是评论正文。
- 既有 `delete` 命令偶发一次清理失败：重试时返回 `1061007`（file has been deleted），文档实际已进回收站，推测是首次 `DELETE` 已成功但响应失败后被重试。未改动 `delete` 的退出码契约，E2E 清理把 `1061007` 视为已回收。
- 电子表格评论无位置字段，`quote` 为单元格内容，结果覆盖整本表格（`?sheet=` 不起过滤作用），`anchor.status` 为 `unlocated`。

## 7. 待确认的决策

- 命令名用 `comment`（单数、子命令组），还是拆成多个顶层动词。
- list 默认隐藏已解决评论和孤儿评论：对 Agent 来说更符合直觉，代价是“全部”需要显式传 `--status all`。
- 已决定：本期加入 `comment resolve` / `reopen`。
- 是否给 `read` 加 `--with-comments`，把评论内联到 Markdown 中。建议本期不做，等 list 稳定后再评估。
