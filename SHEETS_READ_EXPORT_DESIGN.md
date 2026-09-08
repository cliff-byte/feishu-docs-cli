# 电子表格完整读取与导出技术方案

- 状态：已按 01—09 实现并完成自动化验收；真实接口验证未执行
- 日期：2026-09-08
- 实施顺序：内嵌电子表格完整读取 → 独立电子表格读取 → xlsx 导出
- 约束：零运行时依赖；遵循现有认证、输入校验、不可变数据和 CliError 约定
- 设计方法：codebase-design，以小 Interface 隐藏分块、坐标合并和失败处理的 Implementation

## 1. 目标与演进关系

第一阶段让现有文档读取不再因本地 100 行限制、首行列宽或错误工作表回退而漏读、误读；第二阶段复用读取 Module 支持独立电子表格；第三阶段直接下载官方生成的 xlsx。

本方案接续 [内嵌 Sheet 标签展开方案](EMBEDDED_SHEET_READ_TICKET.md)。原方案中的“保留 100 行上限”和“不支持独立电子表格”是当时的范围约束，本方案分阶段替代这些约束；不修改原方案的历史记录。

本文保留获批设计及实施前问题背景；实际交付与验证边界见[验收记录](.scratch/sheets-read-export/VERIFICATION.md)。三阶段均已实现。

## 2. 实施前的实现与问题

| 代码证据 | 当前行为 | 后果 |
| --- | --- | --- |
| [doc-enrichment.ts](src/services/doc-enrichment.ts) 的 `fetchSheetData()` | metainfo 后一次请求整张表，随后 `slice(0, 101)` | 最多输出表头加 100 行，且大响应仍会失败 |
| 同一函数 | 按首行列数映射后续行 | 首行右侧为空、后续行有值的列被丢弃 |
| 同一函数 | 指定 sheetId 找不到时选择第一张表 | 输出错误工作表而不告警 |
| [blocks-to-md.ts](src/parser/blocks-to-md.ts) | 不展示 `truncated` | 用户无法从输出识别截断 |
| [doc-markdown.ts](src/services/doc-markdown.ts) | 识别、去重并展开 `<sheet>` | 已具备成功路径，但依赖旧读取函数 |
| [read.ts](src/commands/read.ts) | 独立 sheet 输出占位 | 未接通单元格读取 |
| [url-parser.ts](src/utils/url-parser.ts) | sheets URL 不保留 sheet 参数 | 无法表达链接指向的工作表 |
| [cat.ts](src/commands/cat.ts) | docs_ai 路径展开表格，Block 回退未补全表格 | 两条路径能力不一致 |
| [client.ts](src/client.ts) 的 `fetchBinaryWithAuth()` | 整体缓冲 ArrayBuffer，响应头返回后已清除超时计时器 | 不适合直接承担大文件下载及完整响应体超时控制 |

## 3. 已核实的官方约束

以下事实来自本次设计会话中读取的官方文档，核实日期为 2026-09-08。产品行为与内部块大小等设计选择不属于官方限制。

| 事项 | 官方约束及设计影响 |
| --- | --- |
| 单个范围读取 | 响应最大 10 MB；使用完整起止坐标，避免部分开放范围写法的 100 列限制。[来源](https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/reading-a-single-range.md) |
| 公式与日期 | 不支持获取跨表引用、数组公式的计算结果；可指定 `ToString` 和 `FormattedString`。[来源](https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/reading-a-single-range.md) |
| 工作表属性 | v3 query 返回 ID、标题、索引、隐藏状态、类型及网格行列数量。网格数量用于扫描，不能当作非空数据数量。[来源](https://open.feishu.cn/document/server-docs/docs/sheets-v3/spreadsheet-sheet/query.md) |
| 响应过大 | `90221` 为 TooLargeResponse；`90222` 为 TooLargeCell；`90217` 为请求过频。[来源](https://open.feishu.cn/document/ukTMukTMukTM/ugjM14COyUjL4ITN.md) |
| 导出格式 | sheet 可导出为 xlsx、csv；CSV 需要工作表 `sub_id`，xlsx 首版按整本导出。[来源](https://open.feishu.cn/document/server-docs/docs/drive-v1/export_task/create.md) |
| 导出权限 | 导出三步要求 `docs:document:export` 或 `drive:export:readonly`；文档列出的应用类型为 Custom App。[来源](https://open.feishu.cn/document/server-docs/docs/drive-v1/export_task/create.md) |
| 导出身份和状态 | 查询与创建使用同一用户或应用；0 成功，1/2 等待，其余已列举状态为失败。[来源](https://open.feishu.cn/document/server-docs/docs/drive-v1/export_task/get.md) |
| 产物有效期 | 任务结束 10 分钟后删除导出产物，成功后应立即下载。[来源](https://open.feishu.cn/document/server-docs/docs/drive-v1/export_task/download.md) |

“完整读取”指覆盖选定范围内接口支持的单元格值，不承诺颜色、布局、合并样式、图片或所有公式行为无损。

## 4. Module、Interface 与 Seam

### 4.1 职责分配

| Module | Interface 与职责 | 引入阶段 |
| --- | --- | --- |
| `src/services/sheets.ts` | 接受明确的工作表坐标，返回完整二维值；隐藏元数据解析、分块、缩块、合并、revision 校验和表格错误映射 | 一 |
| `src/parser/sheet-to-md.ts` | 接受读取结果和表头策略，返回 Markdown；无网络、文件或 stdout 副作用 | 一 |
| `src/services/doc-markdown.ts` | 保持 `fetchDocumentMarkdown(authInfo, documentId): Promise<string>`；隐藏标签解析、引用去重、原位替换和文档级降级 | 改造于一 |
| `src/services/doc-enrichment.ts` | 把 SHEET Block 引用转换为明确坐标，调用读取 Module；不再实现表格请求和裁剪 | 改造于一 |
| `src/commands/read.ts` | 选择资源和输出模式，决定独立读取整体失败语义 | 改造于二 |
| `src/services/sheet-export.ts` | 接受表格 token 和本地目标，完成导出、等待、下载和安全落盘，返回本地文件结果 | 三 |
| `src/client.ts` | 提供经认证的请求和流式文件下载，隐藏凭证解析、传输错误及重试 | 扩展于三 |

共享 Seam 位于 `sheets.ts` 的读取 Interface。两个内嵌入口和独立读取入口通过它获取数据，不依赖飞书分块协议。导出走单独的 Seam，不先读取全部单元格，也不从 Markdown 重新生成 xlsx。

### 4.2 读取 Interface 草案

```ts
type SheetSelection = Readonly<{
  spreadsheetToken: string;
  sheetId: string;
  range?: string; // 可选、有限矩形 A1 范围，不含 sheetId
}>;

type SheetReadResult = Readonly<{
  spreadsheetToken: string;
  sheetId: string;
  title: string;
  index: number;
  hidden: boolean;
  requestedRange: string; // 规范化的 A1 范围，不含 sheetId
  dataRange: string | null; // values 对应范围；空表为 null
  revision?: number;
  values: ReadonlyArray<ReadonlyArray<unknown>>;
}>;

readSheet(authInfo: AuthInfo, selection: SheetSelection): Promise<SheetReadResult>;
```

该 Interface 的契约包括：

- 成功返回意味着选定范围的所有分块都读取成功；不存在部分成功的返回值。
- 空表是成功结果，`values: []`、`dataRange: null`；缺字段、畸形响应不能伪装成空表。
- 结果不把首行解释成业务字段，不按表头生成对象；重复或空表头不会覆盖值。
- `values` 保留接口在当前读取选项下返回的值；缺失的空白位置规范化为 `null`，Markdown 中渲染为空字符串。
- `requestedRange` 与 `dataRange` 区分请求覆盖范围和返回数据范围。整表可裁掉尾部全空行列，但保持左上原点；显式矩形范围保留请求尺寸及其中所有空白位置。
- 失败抛出带恢复建议的 `CliError`。参数错误在请求前发现；错误工作表不替换为第一张表。
- 接受现有 `AuthInfo`，不自行登录、切换身份，不直接输出命令结果。
- 每次读取持有表格结果及分块数据，内存与结果大小相关，不是固定内存的流式读取承诺。

第二阶段按工作簿选择的需要增加 `listSheets(authInfo, spreadsheetToken)`，返回用于选择和排序的工作表摘要；不把底层分块方法公开给命令。第一阶段不预先增加这个入口。

元数据可在一次命令内部复用，但首版不增加跨命令缓存、TTL 配置、通用缓存工厂或对外缓存参数。

### 4.3 渲染与导出 Interface 草案

```ts
renderSheetMarkdown(
  data: SheetReadResult,
  options: { header: "first-row" | "column-letters" },
): string;

exportSheet(
  authInfo: AuthInfo,
  input: {
    spreadsheetToken: string;
    outputPath: string;
    waitTimeoutMs?: number;
  },
): Promise<{
  path: string;
  format: "xlsx";
  size: number;
}>;
```

导出 Interface 的文件写入是明确的必要副作用，stdout 和进度文案仍由命令负责。导出状态机、临时文件和远端产物 token 不成为正常调用者必须管理的协议。

### 4.4 Depth 与备选方案

- 删除 `sheets.ts` 后，范围划分、错误分类和坐标合并会重新散落到多个调用方，说明该 Module 提供实际 Leverage；这些知识集中一处获得 Locality。
- 只移除 `slice` 无法解决 10 MB 限制、列丢失和错误表回退，不足以完成第一阶段。
- 在独立命令复制 `fetchSheetData` 会形成两套修复路径，不采用。
- 下载 xlsx 再解析成 Markdown 会增加导出权限、异步等待和解析依赖，不作为在线读取 Implementation。
- 不增加通用表格后端、插件 registry 或 SDK Adapter；当前没有第二种实际后端来证明这些 Seam 的必要性。

## 5. 第一阶段：内嵌电子表格完整读取

### 5.1 目标识别

docs_ai 标签的 `token`、`sheet-id` 分别解析与验证；SHEET Block 的组合 token 只在入口拆解。下层只接受 `spreadsheetToken` 和 `sheetId`，不继续传播下划线拼接约定。缺少或无效 ID 保留占位并告警，不猜测目标表。

元数据使用：

```text
GET /open-apis/sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query
```

确认工作表存在、`resource_type=sheet`，验证行列数量后再生成读取计划。非普通工作表不调用值读取接口。

### 5.2 分块与坐标合并

值读取使用：

```text
GET /open-apis/sheets/v2/spreadsheets/{spreadsheetToken}/values/{range}
```

初始块大小为 500 行 × 50 列，是内部调度参数，不是用户数据上限或官方上限。例：1,200 行 × 120 列，拆为 3 个行区间 × 3 个列区间，基准为 9 次值请求。

1. 使用有限的完整范围，例如 `sheetId!A1:AX500`，不使用省略结束行的写法。
2. 扫描元数据给定的全部目标区域；空块、短块不能作为后面无数据的证据。
3. 根据请求和响应坐标放置单元格，不直接拼接跨列块的数组；补齐省略的空白位置。
4. 校验响应范围必须属于请求范围，维度为 ROWS，值结构与范围兼容；范围为空但有值等矛盾响应直接失败。
5. `90221` 时将当前范围按行二分；单行时按列二分，直到能读取或只剩单格。每次缩块必须减少范围，避免无限递归。
6. `90222` 或单格仍然过大时报告具体位置；不吞掉单元格继续返回成功。
7. 只在所有块成功后合成最终结果；按块和行构建新值，避免修改已有输入对象，也避免对不断增长的完整矩阵反复复制。

读取选项为 `valueRenderOption=ToString`、`dateTimeRenderOption=FormattedString`，涉及用户元素时显式使用 `user_id_type=open_id`。不增加本地公式引擎。

稀疏数据的返回范围和空值省略行为需要真实接口样本验证；不能仅凭 mock 假定任何压缩行列都可以直接拼接。

### 5.3 调度与一致性

- 同一文档中的相同引用去重，一次读取结果用于原位替换多次引用。
- 维持最多 5 个工作表任务并发，每张表分块顺序请求；不再嵌套额外分块并发。
- HTTP 层复用现有有界重试；表格业务码 `90217` 使用有限次数退避。确保同一失败只归属于一层重试，不能把业务错误、权限错误和畸形响应都当作网络重试。
- 对同一工作表比较响应 revision，使用 `??` 保留 0。出现两个不同版本立即放弃该表结果并要求重新读取；缺失 revision 不得补成 0 或声称已验证快照。
- 分块读取没有版本锁定；即使已观测 revision 一致，也不承诺事务快照，尤其无法覆盖最后一次响应后的修改。

### 5.4 Markdown 与失败语义

整表继续用第一行作表头，但列数来自完整有效数据范围；表头缺少的单元格补为空。渲染统一处理标题、反斜线、管道符、换行、空值与复合单元格，禁止出现意外的 `[object Object]`；未知复合值以可读 JSON 保留信息，不额外增加人员解析请求。

| 情况 | 内嵌文档行为 |
| --- | --- |
| 完整读取成功 | 原位替换为 Markdown，不改变引用顺序 |
| 工作表真实为空 | 输出标题及“空工作表”，不是权限告警 |
| 标签格式错误、目标不存在、不支持的类型 | 保留原标签或 Block 占位，stderr 给出恢复建议 |
| 任一分块失败、权限不足、版本变化 | 放弃该表部分结果，保留占位并告警；其他正文继续读取 |

`fetchDocumentMarkdown` 的调用 Interface 保持不变。Block 渲染入口同步改用共享读取与渲染 Module。`cat` 的 Block 回退只补齐电子表格内容，不顺带启用其他富化；保留现有 `--max-bytes`，不把整篇跳过误描述成表格完整输出。

移除旧表格 `truncated` 字段与 101 行裁剪，不能换成新的隐式行数上限。`--raw`、`--blocks` 的现有文档行为不变。

## 6. 第二阶段：独立电子表格读取

### 6.1 拟议命令

```bash
feishu-docs read "<电子表格URL>"
feishu-docs read "<电子表格URL>" --sheet <sheet_id>
feishu-docs read "<电子表格URL>" --sheet <sheet_id> --range A1:F2000
feishu-docs read "<电子表格URL>" --json
feishu-docs read "<spreadsheet_token>" --type sheet
```

拟定默认行为：`--sheet` 优先于 URL 的 `sheet` 参数；都没有时读取全部工作表，按 index 排序，包括隐藏的普通工作表并标记 hidden。明确选择某张表时，其他不支持类型不影响读取；全部读取时遇到不支持类型则整体报错，不静默漏掉目标。

- `/sheets/` 和 `/wiki/` URL 保留 `sheet` 参数；知识库解析后按实际 `objType` 路由。
- `--range` 首版只支持不含工作表前缀的有限矩形，如 `A1:F2000`。范围必须为正向、合法、网格内的坐标，禁止静默裁剪越界值。
- `--range` 必须对应唯一工作表；没有选择且工作簿只有一张可读取表时可确定目标，否则报 `INVALID_ARGS`。
- `--type sheet` 仅解决裸 token 的类型歧义，不逐个试探各种资源接口；带明确类型 URL 时不接受该覆盖选项。
- 电子表格拒绝 `--raw`、`--blocks`；`--with-meta` 输出表格来源和读取范围。
- 新的 sheet 分支放在现有非 docx 占位分支之前，不改变多维表格等其他资源行为。

### 6.2 输出契约

Markdown 按工作表分段并注明名称。整表用第一行作表头；用户显式指定范围时用列字母作表头，选中范围中的所有行均为数据。

JSON 返回二维值和坐标，不以表头为对象键。示例的请求与数据范围保持可核对：

```json
{
  "success": true,
  "type": "sheet",
  "spreadsheet_token": "exampleToken",
  "sheets": [
    {
      "sheet_id": "sheet1",
      "title": "销售明细",
      "hidden": false,
      "requested_range": "A1:B200",
      "data_range": "A1:B2",
      "values": [["日期", "销售额"], ["2026-09-01", 100]]
    }
  ]
}
```

独立读取采用整体成功或整体失败。完成所有目标读取后才写 stdout；任何一张表或分块失败，使用现有错误 envelope 和非零退出码，不输出部分成功数据。错误中包含工作表 ID、失败范围及 recovery，不能泄露凭证。

前两阶段沿用聚合后输出，内存随结果增长；分块仅限制单次请求大小，不解决全部结果的内存上限。大而稀疏的网格仍有扫描成本；后续可用第二阶段的范围读取及第三阶段导出处理大表，不提前引入 NDJSON、磁盘数据库或读取缓存。

## 7. 第三阶段：官方 xlsx 导出

### 7.1 拟议命令与范围

```bash
feishu-docs export "<电子表格或知识库URL>" --format xlsx --output ./销售明细.xlsx
feishu-docs export "<spreadsheet_token>" --type sheet --format xlsx --output ./销售明细.xlsx
```

首版仅支持电子表格整本 xlsx。`--format` 默认 xlsx，其他值明确拒绝；`--output` 必填。URL 的 sheet 参数不裁剪工作簿，命令输出明确导出整本。首版不接受 `--sheet`、`--range`，不提供覆盖文件开关。

CSV、其他文档格式、单工作表 xlsx 和本地工作簿加工不在本阶段范围内。

### 7.2 任务流程

```text
解析输入并固定身份
  → 检查目标路径
  → POST /open-apis/drive/v1/export_tasks
      body: { token, type: "sheet", file_extension: "xlsx" }
  → GET /open-apis/drive/v1/export_tasks/{ticket}?token={spreadsheetToken}
      job_status 1/2: 等待；0: 继续；其他状态: 报错
  → GET /open-apis/drive/v1/export_tasks/file/{file_token}/download
  → 流式写临时文件、校验、发布目标文件
  → 输出成功结果
```

请求与 JSON envelope 成功不代表导出任务成功，必须检查 `job_status`。成功结果缺少有效文件 token 或必要元数据时，按畸形响应报错。

建议每 2 秒查询一次，默认任务等待预算 120 秒；这是客户端策略，不是官方任务时限。采用截止时间，等待和在途查询都受剩余预算约束，不能仅限制循环次数。查询的取消/超时能力在 client 层做必要扩展，不在导出 Module 绕过认证层直连。

超时仅停止本地等待，不声称取消了远端任务；错误保留 ticket 和恢复建议，不自动再创建一个任务。首版不新增持久任务队列或恢复子命令。

### 7.3 认证、错误与重试

- 复用现有动态缺失 scope 提示，不增加 BASE_SCOPES，也不建立命令到 scope 的本地映射。
- 创建、查询和下载使用同一身份。允许同一主体的凭证刷新，不允许 user/tenant 自动切换。
- 创建 POST 禁用通用自动重试；响应超时后结果未知，不重复创建。收到明确的缺 scope 拒绝时，可按现有授权流程修复后重试该步骤。
- 获得 ticket 后，不使用包裹整个导出流程的授权重试，避免后续失败触发重复创建。身份无法保持时终止。
- 查询和下载有界重试；未识别的 job_status 明确失败，不无限等待。
- 将权限、不存在等确定错误映射为相应 CliError；保留原始错误码或 job_status 信息，并提供 recovery。其他导出失败使用 API_ERROR，不为每种状态新增全局错误类型。

### 7.4 文件与下载行为

在 `client.ts` 提供经认证的流式落盘能力，与现有二进制请求复用凭证解析、错误解析和重试；不重构无关 JSON 请求链路，也不引入外部下载库。

- 目标目录须存在；只使用调用者给出的输出路径，不把远端文件名当作本地路径。
- 开始前检查路径；临时文件位于目标目录，独占创建，权限仅授予当前用户。
- 超时和取消覆盖响应体整个下载过程；正确等待写入背压和文件关闭。
- 识别 JSON 错误响应，不将错误文案保存成 xlsx。检查实际字节数与有效的预期文件大小一致，不解析、重写 xlsx 内容。
- 下载重试重新开始并清空本次临时内容，不把多次响应追加到同一文件。
- 发布采用同文件系统上不覆盖目标的原子创建方式；例如已关闭的临时文件通过独占硬链接发布后移除临时名，目标存在即失败。不能只先 exists 检查再用会覆盖的 rename。
- 不支持该发布方式的文件系统明确报错，不降级为可能覆盖用户文件的流程。
- 失败清理本次临时文件，不删除用户原有文件。普通中断也尝试清理；进程被强制杀死后可能遗留临时文件，不承诺无法实现的清理保证。

命令在文件成功发布后返回 `{ success: true, type: "sheet", format: "xlsx", path, size }`；进度与告警写 stderr。API 导出不承诺所有飞书特性无损，兼容性由真实产物验收。

## 8. 测试与阶段验收

测试围绕 Module 的公开 Interface，使用现有 `node:test`、`assert/strict` 和 fetch mock；不为私有分块函数新增仅测试使用的 export，不建立通用测试 Adapter 框架。网络 mock 测试保持现有的串行隔离方式；轮询使用可控计时器，避免真实等待。

| 阶段 | 主要测试面 | 验收内容 |
| --- | --- | --- |
| 一 | `readSheet` | 超过 100 行；跨行列块；空块后有值；首行短于后续行；网格与有效数据范围差异；稀疏补位；90221 递归拆分；单格失败；限频重试耗尽；revision=0、缺失与变化；恶意 ID/范围；畸形响应 |
| 一 | `renderSheetMarkdown` | 空表；空表头；重复表头；换行和管道符；0/false/null；未知复合值；尾部裁剪与前部/中间空白保留 |
| 一 | 文档入口集成 | docs_ai 原位替换、重复引用去重、失败保留标签；read 的 Block 回退；cat 的 Block 回退及现有字节限制 |
| 二 | URL 与命令 Interface | sheets/wiki、sheet 参数优先级、裸 token 类型、范围唯一目标与越界、所有工作表排序及 hidden、未知/不支持工作表、非法选项、JSON 二维值、失败时无成功 stdout |
| 三 | `exportSheet` 与鉴权下载 | 创建到完成、任务失败和畸形结果、截止时间、身份固定、scope 错误、POST 不重复重试、二进制传输中断与背压、大小不符、已有目标及并发创建、临时文件清理 |

每阶段运行 `npm test`（包含 build:check），并同步该阶段实际落地的 README、帮助与 CHANGELOG；不提前把未来命令写成已支持能力。若修改安装技能文档，遵循该文件适用的写作和同步检查要求。

真实接口验收需使用有访问权限的样例，验证：

1. 101 行以上、跨多个块且超过 100 列的表，包含空白区域后再次出现数据的情况。
2. 响应对空白行列和 range 的实际表达，复合单元格及日期表现。
3. 读取期间修改的 revision 行为，尤其是元数据与第一块之间的变化。
4. 多工作表、隐藏工作表及知识库链接选择。
5. xlsx 文件能被现有本地工具打开，并人工核对多工作表与代表性公式、样式。

以上真实 API 检查尚未执行。若实际响应与文档描述不同，先记录证据并修正对应 Interface 契约，不通过静默省略数据掩盖差异。

## 9. 实施切分与交付检查

| 阶段 | 预计代码修改 | 完成信号 |
| --- | --- | --- |
| 一 | 新增 sheets 与 sheet-to-md；调整 doc-markdown、doc-enrichment、blocks-to-md、cat 及相关测试 | 两条内嵌读取路径无本地 100 行和首行列宽截断，失败语义一致 |
| 二 | 调整 read、url-parser、ParsedDoc 类型、必要的 resolver 选项及 CLI 帮助；增加命令测试 | 独立 sheets/wiki 链接按既定选择规则输出完整 Markdown/JSON |
| 三 | 新增 export 命令、sheet-export；扩展 client 流式下载及必要超时能力；增加任务和文件测试 | xlsx 成功下载且不覆盖已有文件，任务和传输失败可明确恢复 |

实施前检查当时的工作区与最近适用指令，保留无关改动。每阶段完成后审查实际 diff 和相应验证结果，不自动创建分支、提交或发布。
