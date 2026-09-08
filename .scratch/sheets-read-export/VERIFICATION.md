# 电子表格读取与导出验收记录

日期：2026-09-08。01—09 按批准顺序完成，保留零运行时依赖。

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| `npm test`（包含 `build:check`） | 593 项通过，0 失败、0 跳过 |
| `npm run build:check` | 通过；开发中也多次按阶段执行 |
| `npm run build` | 通过 |
| `node bin/feishu-docs.js --help` | 通过；展示 sheet/type/range 读取选项和整本 xlsx export |
| `git diff --check` | 通过 |
| `npm run lint:dead-code` | 未通过：两个已有 unused exports，见下文基线核对 |
| `code-review` | 分别审查读取与导出；发现的 6 项问题已修复，导出取消修复经独立复核 |

开发按公开读取、渲染、导出服务和命令输出边界推进失败测试与实现，再执行聚焦回归。最终运行全套测试。没有调用真实飞书表格、创建远端导出任务或修改远端内容。

## 独立任务证据

| 任务 | 主要测试 | 可观察结果 |
| --- | --- | --- |
| 01 | `test/sheets.test.ts`、`test/embedded-sheets.test.ts` | 1,200 行、120 列跨块坐标完整；稀疏、短块和空表不误判；重复引用去重；失败保留占位 |
| 02 | `test/sheets.test.ts` | 90221 行优先/列次之缩块，90222 和单格超限退出；90217 有界恢复/耗尽 |
| 03 | 上述两文件 | revision=0、变化、缺失、非法、冲突；缩块后的版本变化立即停止并提示重读 |
| 04 | `test/embedded-sheets.test.ts`、既有 `test/cat.test.ts` | cat 回退展开完整表格，失败降级；展开后的 UTF-8 输出预算有效 |
| 05 | `test/read-sheets.test.ts`、既有 URL/resolver/read 测试 | Sheets/wiki/裸 token 输入、显式选择优先级、JSON/Markdown、失败 stdout 为空 |
| 06 | `test/read-sheets.test.ts` | 按 index 输出整本，含隐藏/空表；不支持或失败目标使整本失败 |
| 07 | `test/read-sheets.test.ts` | Z200:AA701 跨块与精确 null 坐标、列字母表头、全空矩形、唯一普通表选择及非法范围 |
| 08 | `test/sheet-export.test.ts`、既有 client/binary 测试 | 创建/等待/下载、状态和元数据错误、JSON/大小校验、0600 私有文件、并发目标保护、截止时间 |
| 09 | `test/sheet-export.test.ts`、`test/export-auth-cancel.test.ts` | 查询重试；中断下载清空重来；耗尽/取消清理；授权恢复不重复创建任务且保持身份；本地 OAuth 端口和 readline 释放 |

已有 doc-markdown、doc-enrichment、blocks-to-md、read 测试的 Sheet mock 已迁移到严格元数据和 values 响应契约；Bitable、其他文档类型与旧二进制调用的回归保留。

## 审查修复

1. 缩块递归继承已观测 revision，叶块首次出现变化立即退出，避免后续请求掩盖版本错误。
2. Block 回退输出保留 `CliError.recovery`。
3. 隐式范围目标只按普通工作表判断唯一性，整本读取仍拒绝混合不支持类型。
4. 授权确认、OAuth 回调、token 交换和刷新接收取消信号；释放本地服务/监听器，取消后不继续旧任务。
5. 导出上下文正确区分 REST 1069902/1069906 及 job_status 109/110/111/123 的权限/不存在错误。
6. URL 带 sheet 参数时明确提示仍导出整本。

## 基线检查

`lint:dead-code` 报告 `src/services/block-writer.ts:69` 的 `readBody` 和 `src/services/markdown-convert.ts:656` 的 `convertAndWrite`。已将原始 `HEAD` 用 `git archive` 解压到临时目录，共用现有 node_modules 后运行 knip，得到完全相同的两项报告和退出码 1。两个文件均未在本次修改，不作范围外清理。

## 真实接口与兼容性边界

- 未提供真实样例，未实测稀疏 values 坐标、复杂单元格、revision 缺失/变化等服务端响应。当前证据是官方文档契约和自动化 mock。
- 未从飞书下载真实 xlsx，也未在 Excel/LibreOffice 打开核验。测试字节只验证流式传输、大小与文件保护，不证明文件格式兼容性。
- 未执行真实 OAuth 权限增加、同用户刷新或下载恢复；已验证本地回调服务器和确认提示的取消清理。
- 整本读取按各表版本独立检查，不提供跨表事务快照；缺失 revision 不能证明一致性。读取聚合结果的内存开销随选定网格和输出增长。
- 导出本地截止不取消远端任务；不提供持久任务恢复、CSV、单表/范围导出或覆盖开关。强制终止可能遗留本次私有临时目录。

后续真实验收可使用已有、获准访问的 Sheets/wiki 样例，检查第 100 行以后及 Z 列以后的坐标，再下载整本 xlsx 并由本地工具打开核验。不得把本记录中的 mock 验收替代这些真实证据。
