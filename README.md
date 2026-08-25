# NetEase Mail Draft Assistant v1.1.0

v1.1.0 将导入系统重构为 **Universal Import Engine**。邮件执行、附件、联系人、分类、定时与“存草稿”状态机继续沿用 v1.0.4；本版本重点替换“文件 → 批量任务”的入口层。

## 新导入架构

```text
File / Files / Directory / ZIP
        ↓
FormatDetector
        ↓
AdapterRegistry
        ↓
NormalizedDataset / NormalizedRecordSet
        ↓
FieldRecognizer（表头语义 + 数据分布 + 置信度）
        ↓
人工字段校正 / ImportProfile
        ↓
现有 MailTask 批量流程
```

### 文件拆分

- `import-core.js`：统一数据模型、字段定义、数据画像、字段识别、置信度。
- `import-adapters.js`：格式探测器、Adapter Registry、XLSX/ODS/文本/JSON/HTML/XML/ZIP 解析器。
- `importer.js`：UniversalImportEngine façade、Import Profile、附件索引与匹配兼容 API。

`content.js` 不再关心具体文件格式，只消费统一的 `dataset.sheets`。

## 当前原生支持格式

- XLSX
- ODS
- FODS
- CSV
- TSV
- PSV（`|` 分隔）
- TXT（自动分隔符或纵向 key-value 记录）
- JSON
- JSONL / NDJSON
- HTML table
- Excel 2003 XML / SpreadsheetML
- ZIP 批次包
- 多文件同时导入
- 数据目录批量扫描

### `.xls`

旧 `.xls` 会通过 OLE magic bytes 被准确识别，不再误当文本或 XLSX；当前原生 Adapter 不解析 BIFF 二进制，因此会明确提示转换为 XLSX / ODS / CSV。后续可以通过 Adapter Registry 接入 SheetJS 作为 XLS/XLSB/ET/Numbers 等格式的成熟解析器，而无需改动业务层。

## 字段识别升级

旧版主要依赖表头同义词。v1.1.0 同时使用：

1. 表头精确/模糊语义；
2. 邮箱值比例；
3. 日期值比例；
4. 附件文件名/路径比例；
5. 正文长度与多行文本特征；
6. ID 唯一性与短文本特征。

每个自动映射都有置信度。低置信度字段会自动展开“字段校正”，而不是静默接受。

## Import Profile

人工校正字段后可以保存“识别模板”。以后出现相似表头时插件会提示复用。

模板保存：
- 来源格式
- 表头结构
- 字段映射
- 字段对应表头
- 识别置信度

应用模板时会优先按规范化表头重新定位列，而不是死记旧列号，因此允许一定程度的列顺序变化。

## 多文件 / 数据目录

导入控件支持多选文件。多个数据文件会被解析为多个 RecordSet，并在工作表选择器中显示来源文件名。

“导入数据目录”会扫描目录中的支持格式文件，并以 `ignoreUnsupported` 模式批量解析：单个坏文件只形成警告，不会让整个目录完全失败；如果没有任何可读数据才整体失败。

## ZIP 批次

推荐 ZIP 结构：

```text
batch.zip
├─ manifest.json
├─ tasks.xlsx / tasks.csv
└─ attachments/
   ├─ CV.pdf
   └─ proposal.pdf
```

`manifest.json` 示例：

```json
{
  "version": 1,
  "taskFile": "tasks.csv",
  "attachmentRoot": "attachments"
}
```

ZIP 中的附件会直接转成浏览器 `File` 对象并进入本批附件池，因此不需要再次选择附件目录。

如果没有 manifest，Importer 会尝试把 ZIP 中所有支持的数据文件作为候选 RecordSet；正式批次建议使用 manifest，避免 TXT/HTML 附件被误认为任务数据。

## 纵向文本

以下 TXT 也能批量识别：

```text
收件人: a@example.com
主题: A
正文: hello

收件人: b@example.com
主题: B
正文: world
```

系统会转成统一二维 RecordSet，再走同一套字段识别与批处理流程。

## 浏览器级回归

已在实际 Chromium JS 环境中验证：

- 项目真实 XLSX：2 个 Sheet 正常读取；核心字段全部识别。
- ODS：正常读取并识别收件人/主题/正文。
- CSV：正常读取。
- JSONL / NDJSON：正常读取。
- HTML table：正常读取。
- Excel 2003 XML：正常读取。
- ZIP package：读取 tasks.csv，同时自动载入附件。
- 多文件：多个 CSV 合并为多个数据集。
- 纵向 key-value TXT：转为标准记录。
- 假 `.xls` OLE 文件：被明确识别为旧 BIFF，并返回可操作提示。

## 成熟第三方资源的接入位置

架构已经为后续成熟库预留 Adapter Registry：

- SheetJS：XLS/XLSB/ET/Numbers 及更广电子表格；
- Papa Parse：超大 CSV、streaming、worker、复杂 CSV；
- Mammoth.js：DOCX；
- PDF.js：文本 PDF；
- Tesseract.js：扫描件 OCR fallback；
- postal-mime：EML；
- DuckDB-Wasm：大型 CSV/JSON/Parquet。

这些能力以后只增加 Adapter，不再修改批量邮件业务逻辑。

## 安装

1. 解压 ZIP。
2. 打开 `chrome://extensions/`。
3. 开启开发者模式。
4. 加载已解压扩展程序。
5. 选择 `netease-mail-draft-assistant-v1.1.0`。
6. 刷新网易邮箱。

插件只创建并保存草稿，不自动发送邮件。
