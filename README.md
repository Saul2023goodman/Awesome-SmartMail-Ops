# NetEase Mail Draft Assistant v1.4.0

v1.4.0 彻底重构导入工作台：不再以 Excel 的“工作表 → 表头 → 列映射”为默认交互模型，而是改成 **Source-Agnostic Data Ingestion Workbench（源无关数据摄取工作台）**。

## 为什么要重构

v1.3 虽然已经能导入 Word、JSON、目录和 ZIP，但 UI 仍然沿用了 Excel 思维：选择数据源后马上出现“数据集/工作表”“表头”“字段映射”。这会造成三个问题：

1. Word 一文件一封、JSON records、字段式文本等来源被迫伪装成“表格”。
2. 用户看不到“文件如何被解析成记录、记录如何变成邮件任务”的中间证据。
3. 每增加一种 Adapter，UI 都需要解释它如何对应 Excel 的工作表/列，扩展性差。

v1.4 统一为：

```text
Source
  ↓
Content Collection
  ↓
Semantic Mapping
  ↓
Task Preview + Validation
  ↓
Attachment Resolution
  ↓
MailTask[]
```

内部仍保留 `NormalizedRecordSet` 二维标准化表示，以便统一 FieldRecognizer；但这只是引擎内部数据结构，不再暴露为产品概念。

## 新的数据摄取工作台

### 01 数据源

来源是一等概念。入口不再是一个 Excel 风格的 file input，而是四种来源：

- **文件 / 多文件**：可以混合选择 XLSX、ODS、Word、CSV、JSON、文本、HTML/XML 等。
- **整个目录**：批量扫描目录中的可读取数据文件。
- **ZIP 批次包**：数据文件和附件可以打在同一个包中。
- **粘贴数据**：直接粘贴 CSV/TSV、JSON/JSONL 或字段式文本，由 FormatDetector 自动识别。

导入后会显示 **数据源清单**：文件名、识别格式、内容集合数量、文件大小、解析警告、包内附件数量。

### 02 内容结构

Universal Import Engine 的 Adapter 将各种来源抽取成一个或多个 **内容集合（Content Collection）**。

UI 会动态说明当前集合是什么：

- Word 邮件批次
- Word 表格
- Word 字段记录
- Word 文档邮件
- JSON 记录
- 字段式文本
- 文本记录
- HTML 表格
- XML 记录
- 表格记录
- ZIP 包内内容

同时展示：

- 候选记录数
- 来源字段数
- 来源文件
- 原始内容抽样

多个内容集合现在可以 **同时参与一个批次**。系统会为每个集合独立保存结构识别和语义映射；用户可以排除说明页、辅助表格或无关文档，再把其余集合统一汇总为 `MailTask[]`。这修复了旧版“多文件能解析，但最终只生成当前选中数据集”的单 Sheet 遗留逻辑。

系统默认只自动纳入具有足够邮件语义证据的内容集合（至少识别到核心邮件字段），降低“说明页/目录页被当成任务”的风险；所有集合仍会列出，用户可以手工加入或排除。

因此 Word、JSON、文本不会再被描述成“工作表”。

### 03 语义映射

这一层回答的是：

> 来源内容中的哪些字段 / 内容槽，对应邮件任务中的哪些语义？

统一邮件语义仍然是：

- 编号
- 收件人
- 主题
- 正文
- 附件
- 定时时间
- 任务分类

自动识别仍综合 **来源字段名称 + 数据分布 + 置信度**。UI 会逐项显示映射目标、来源字段和置信度；低置信度或缺失核心语义时才自动展开人工校正。

识别模板继续支持，但模板被定义为 **语义映射模板**，而不是 Excel 列模板。

### 04 任务预览与校验

这是 v1.4 新增的重要层。

在任务进入“批量任务”之前，数据摄取页会直接预览标准 MailTask：

- 收件人
- 主题 / 正文摘要
- 附件引用数量
- 定时时间
- 分类
- 校验结果

并显示：可用 / 提示 / 错误数量。

这样用户可以先回答：

> “这个 Word/JSON/目录最终到底会变成哪些邮件？”

而不是进入批量执行页后才发现解析错误。

### 04 附件与文件解析

附件属于数据校验的一部分：

- ZIP 包内附件自动进入本批文件池。
- 可以选择一批任务相关文件或整个附件目录。
- 可配置公共附件。
- 自动按相对路径、文件名和下载副本名匹配。
- 只有缺失/歧义才需要人工指定一次。

### 05 生成标准任务

数据摄取工作台最终只输出 `MailTask[]`，不会操作网易写信页。

用户确认后点击“进入批量任务”，后续仍然遵循：

```text
检索 → 分类 → 勾选 → 创建并确认保存草稿
```

## 产品边界

现在四个一级模块职责是：

1. **单封草稿**：快速创建单封草稿。
2. **数据摄取**：任何来源 → 标准 MailTask。
3. **批量任务**：管理并执行 MailTask。
4. **联系人**：联系人分类、已发送和草稿历史。

核心原则：

- 数据摄取不创建草稿。
- 筛选不等于执行。
- 勾选是批量执行的唯一事实来源。
- 每封邮件必须确认“存草稿”成功后才能处理下一封。
- 执行异常立即停止，优先避免串稿。

## 兼容性

当前 Universal Import Engine 支持：

- XLSX
- ODS / FODS
- DOCX / DOCM / DOTX
- CSV / TSV / PSV / TXT
- JSON / JSONL / NDJSON
- HTML table
- Excel 2003 XML / SpreadsheetML
- 多文件
- 数据目录
- ZIP 批次
- 粘贴数据

旧 `.xls` / `.doc` 能可靠识别，但仍要求先转换为现代格式。

## v1.4 代码层变化

- UI 主数据概念由 `workbook/sheet` 收敛为 `dataset/recordSet/content collection`。
- `detectBestRecordSet()` 作为 `detectBestSheet()` 的源无关别名加入 Import Core。
- Import Profile 新增 `collectionName`，并保留 `sheetName` 以兼容旧模板。
- 新增 Source Inventory、Structure Inspector、Semantic Summary、Task Preview。
- 新增 Paste Source 入口。
- 批量执行、网易 Compose Adapter、联系人和草稿保存状态机未改变。
