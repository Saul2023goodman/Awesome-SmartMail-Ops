# NetEase Mail Draft Assistant v1.5.0

v1.5.0 将“困难文档识别”从格式/版式解析问题，重构为 **Mail Primitive Recognition（邮件原语识别）** 问题。

## 核心变化

旧模型把 Word 段落、表格、编号、Markdown 标题、工作表和表头当成邮件边界。这在干净模板中有效，但一旦文档混入说明、批次标题、改写标注、分页断裂、行合并、重复导师或缺失邮箱，就会丢记录或串记录。

新模型只把文件格式当作“有序内容载体”。所有文本型 Adapter 尽量输出有顺序的 text blocks，再交给独立的 `mail-recognizer.js`：

```text
DOCX / TXT / HTML / future PDF-OCR ...
        ↓
ordered text blocks
        ↓
Mail Primitive Recognizer
        ↓
Subject / Salutation / Body / Closing / Recipient-email evidence
        ↓
mail frames + confidence + issues
        ↓
人工校正（仅不确定项）
        ↓
MailTask[]
```

## 最小邮件模型

真正用于执行的最小信息只有：

- 收件人邮箱
- 主题
- 正文

为了在混乱文本中定位这三项，识别器额外使用稳定但不直接执行的边界证据：

- `Subject:` / `主题:` / `邮件主题:` / `邮件标题:`
- `Dear ...` / `Hello ...` / `Hi ...` / 中文称呼
- `Yours sincerely` / `Best regards` / `此致敬礼` 等落款
- 邮箱地址
- 邻近姓名/标题仅作弱上下文，不作为硬边界

编号、Word 样式、Markdown `###` / `**`、`---`、页码、批次标题、`契合点`、`改写点标注` 都只是 presentation noise。

## 证据状态机

优先级：

1. `Subject + 称呼 + 落款 + 长正文 + 邮箱`：强证据邮件帧。
2. `Subject + 称呼 + 长正文 + 邮箱`：即使缺落款也保留，标记人工复核。
3. `称呼 + 落款 + 长正文 + 邮箱`：即使缺 Subject 也保留，要求补主题。
4. 只有部分证据时：达到最低证据阈值则保留为低置信候选，不静默删除。
5. 缺收件人/主题/正文：任务被保留，但作为不可执行项进入人工校正队列。

识别器会阻止一个邮件帧跨越下一个 `Subject` 或新的称呼锚点，避免上一封吞掉下一封。收件人邮箱通过上下文评分关联，而不是假设它必须与姓名处在同一行。

## 人工校正队列

数据摄取工作台现在明确分成：

1. 数据源
2. 邮件候选
3. 邮件基础信息
4. 邮件确认
5. 附件
6. 标准任务

每个识别出的邮件候选都带：

- 证据置信度
- 已命中的证据类型
- 待确认问题
- 来源文件/候选位置

有问题的记录不会被删除。点击“处理待确认”可以逐条修正收件人、主题、正文、附件、定时与分类，并用“保存并处理下一条”完成批处理式人工辅助。

## 困难案例回归

对一个 80 页、混合普通 Word 段落 / Markdown 标题 / 注释 / 分隔符 / 行合并 / 缺失邮箱的困难 DOCX 进行真实浏览器 Adapter 回归：

- ordered text blocks: 1192
- Subject anchors: 63
- salutations: 63
- closings: 63
- email occurrences: 58
- recognized mail frames: 63
- complete recipient+subject+body records: 58
- missing recipient records preserved for review: 5
- average evidence confidence: 99%

说明识别数量不再受 Word 外部版式变化影响；真实缺失的邮箱不会被系统虚构，而是进入人工补全。

## WordAdapter

`WordAdapter` 现在执行：

1. 解包 DOCX。
2. 按 document order 抽取段落和表格行为 text blocks。
3. 优先运行 Mail Primitive Recognizer。
4. 若识别到邮件帧，将其设为 preferred record set。
5. Word 表格/字段记录仍保留为 supplemental fallback，不与主邮件帧重复执行。

旧 `.doc` 仍只做 OLE 识别并提示另存为 `.docx`，不会猜测解析。

## 其他导入格式

原 Universal Import Engine 保持：XLSX、ODS/FODS、CSV/TSV/PSV/TXT、JSON/JSONL/NDJSON、HTML table、SpreadsheetML、DOCX/DOCM/DOTX、ZIP、多文件、目录。

结构化来源仍优先利用可靠字段结构；自由文本来源优先利用邮件原语。两条路径最后都归一为同一个 MailTask 模型。

## 草稿执行安全

执行层没有改变：

- 只创建草稿，不自动发送。
- 每封填写完成必须主动点击网易“存草稿”。
- 普通草稿要求出现新的“成功保存到草稿箱”证据。
- 定时草稿要求出现“定时发信设置成功”证据。
- 当前封没有确认保存成功时立即停止批次，不进入下一封。
