# SmartMail Ops v3.8.49

## 本次重构

### 1. 批次识别改为严格显式
- 不再扫描任意正文/备注中的 `R1`、`R3`、`round:R1/3`。
- 只有识别到明确的 `Batch / Round / 批次 / 轮次` 列，并且单元格本身是完整批次值时才读取。
- 接受示例：`R1`、`Round 2`、`Batch 3`、`第2批`、`第二轮`。
- 拒绝示例：URL、申请说明、`round:R1/3 September...`、包含 R1 的长备注。
- v3.8.49 会清理旧版本留下的非人工/非明确批次状态。

### 2. 合并单元格视觉与语义彻底分离
- XLSX 原始 `rows` 不再因为语义解析而向下复制 merged-cell 值。
- Planner 始终按照 Excel 的真实 merge range 渲染。
- 名单解析需要院校等上下文时，单独从 merge anchor 读取，不修改视觉数据。
- 结果：一个 Excel 合并块仍然显示为一个合并块，不再被拆成多行重复单元格。

### 3. 按“整行主导特征”选择
- 颜色/格式不再以“某个单元格出现过”为依据。
- 每个联系人行只计算一个 dominant feature。
- 合并区域的样式会按实际覆盖范围计入。
- 列宽参与权重，因此窄小的黄色单元格不会覆盖整行大面积的粉色/蓝色背景。
- 如果没有明显主导颜色，再考虑字体色、粗边框、加粗、斜体。
- 这些特征仍然只负责选人，不自动生成批次。

### 4. 表头识别收紧
- URL、长句、说明文本不会再被当作列标题。
- 单字符数据不会因为碰巧包含在 alias 中而被误判成多个字段。

## 验证
- JS syntax checks: `roster.js`, `roster-planner.js`, `app.js`, `import-adapters.js` passed.
- Synthetic regression tests passed:
  - long Monash-style description containing `round:R1/3` does not create a batch;
  - dedicated Batch column with exact `R2` is recognized;
  - merged institution context is available semantically without mutating raw rows;
  - projected merge keeps its rowspan;
  - broad peach row beats one narrow yellow cell as the dominant row feature;
  - legacy ambiguous inferred batches are removed during migration.
