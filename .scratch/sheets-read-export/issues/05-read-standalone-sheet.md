# 05: 独立单工作表 Markdown/JSON 读取

**What to build:** 用户提供电子表格或知识库链接，并明确选择工作表后，可以通过 read 得到完整 Markdown 或带坐标的二维 JSON；只有一张表时无需额外选择。裸 token 可通过显式类型读取。

**Blocked by:** 02 — 超限拆分与限频恢复；03 — 检测读取期间版本变化；04 — 补齐 cat 回退读取。此门槛落实用户要求的阶段顺序；读取能力本身复用 01。

**Status:** completed (automated acceptance; live API unverified)

**阶段：** 二，独立读取。

**范围边界：** 交付单工作表整表读取、资源解析和两种输出。多工作表未选择时先明确提示选择，不默认第一张；06 再增加默认整本读取。指定矩形范围由 07 处理，不提前暴露不可用选项。

- [x] sheets 链接与解析后指向电子表格的 wiki 链接进入真实读取，不再输出 sheet 占位；知识库解析保留工作表选择信息。
- [x] --sheet 优先于 URL 的 sheet 参数；两者均缺失且只有一张普通工作表时可直接读取，多张时明确报 INVALID_ARGS 并提示选择，不能悄悄选第一张。
- [x] 裸 token 配合 --type sheet 可读取，不通过尝试多种资源接口猜类型；明确类型 URL 不接受 --type 覆盖。非法 token/ID 在嵌入路径前校验并编码。
- [x] 不存在的目标工作表返回 NOT_FOUND，不支持的目标类型返回 NOT_SUPPORTED；指定一张普通表时，工作簿中的其他不支持类型不阻止本次读取。
- [x] Markdown 输出所选工作表标题与完整表格；保留首行表头规则、全部有效列、空表说明以及共享读取的恢复/版本检测行为。
- [x] JSON 使用 success/type/spreadsheet_token/sheets envelope，包含 sheet_id、title、hidden、requested_range、data_range 和二维 values；空或重复表头不影响数据，null 表示规范化空白。
- [x] --with-meta 提供来源和读取范围，hidden 状态可辨认；电子表格拒绝 docx 专用 raw/blocks 选项，不影响这些选项用于文档时的行为。
- [x] 读取完成前不写成功 stdout；任一请求失败输出现有错误 envelope 和非零退出码，错误含工作表/范围及 recovery，不产生部分成功 JSON 或 Markdown。
- [x] 不改变已有多维表格、记录分享链接和普通文档路由；输入与输出用例覆盖两类 URL、优先级、裸 token、类型错误、空表、隐藏表、失败及兼容性。
- [x] npm test 通过，更新帮助和使用说明，只描述本任务已交付的单工作表能力。

**独立验收演示：** 用带工作表参数的 sheets 与 wiki 链接读取同一张超过 100 行的表，分别核对 Markdown 与 JSON。故意选择不存在的 ID 或令末块失败，确认没有成功数据输出。

## 验收记录

单表来源和输出契约已实现。未选择时的中间版本“多表报错”已由后续 06 演进为整本读取，文档描述最终行为。

统一执行结果、测试位置及证据边界见[验收记录](../VERIFICATION.md)。
