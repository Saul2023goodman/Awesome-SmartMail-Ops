(() => {
  'use strict';

  const Planner = globalThis.NMDARosterPlanner;
  const Roster = globalThis.NMDARoster;

  function effectiveBatch(state, entry) {
    const intent = Planner.intentForEntry(state, entry);
    if (intent?.priorityRoundSuppressed || intent?.batchSuppressed) return '';
    return String(intent?.priorityRoundLabel || intent?.batch || Planner.explicitPriorityRound(entry) || '').trim();
  }

  function selectedEntries(entries, set, selection) {
    const rows = new Set(selection?.rows || []);
    if (rows.size) return entries.filter(entry => rows.has(Number(entry?.sourceRow || 0) - 1)).sort((a, b) => Number(a.sourceRow || 0) - Number(b.sourceRow || 0));
    if (!selection?.range) return [];
    return Planner.entriesForRange(entries, set, selection.range);
  }

  function buildSelectionView(entries, set, state, selection, activeBatch) {
    const matches = selectedEntries(entries, set, selection);
    const rows = selection?.rows || [];
    const range = Planner.normalizeRange(selection?.range);
    let label = '尚未选择';
    if (rows.length) {
      if (selection.kind === 'batch') label = `${selection.meta || '同校优先级'} · ${matches.length} 位`;
      else if (selection.kind === 'unassigned') label = `待分 · ${matches.length} 位`;
      else if (selection.kind === 'fixed') label = `固定时间 · ${matches.length} 位`;
      else if (selection.kind === 'feature') label = `${selection.meta || '特征'} · ${matches.length} 位`;
      else label = `已选择 · ${matches.length} 位`;
    } else if (range) label = `框选 ${Planner.rangeLabel(range)} · ${matches.length} 位`;
    const detail = matches.length
      ? (activeBatch ? `已选联系人；加入 ${activeBatch} 后会直接在名单中标记。` : '已选联系人；先新建一个同校优先级，再加入。')
      : (rows.length || range ? '当前选择没有命中可识别联系人。' : '新建同校优先级后，可按每行主导颜色 / 格式快速选人，也可直接框选。');
    return {
      label,
      detail,
      activeBatch: activeBatch || '',
      activeState: activeBatch ? 'ready' : 'empty',
      canAdd: !!(matches.length && activeBatch),
      canClear: !!(matches.length && matches.some(entry => !!effectiveBatch(state, entry)))
    };
  }

  function buildTable(set, entries, state) {
    const rows = set?.rows || [];
    const visual = set?.meta?.excelVisual || {};
    const maxRows = Math.min(rows.length, 320);
    const plan = Planner.columnPlan(set);
    const showAll = !!state.showIrrelevantColumns;
    const hiddenCols = new Set(plan.originalHidden || []);
    if (!showAll) {
      for (const col of plan.autoHidden || []) hiddenCols.add(col);
      for (const col of plan.emptyHidden || []) hiddenCols.add(col);
    }
    const maxCols = Math.min(40, Math.max(Number(plan.maxCols || 0), Number(visual.usedRange?.cols || 0), ...rows.slice(0, maxRows).map(row => row?.length || 0), 1));
    const hiddenRows = new Set(visual.hiddenRows || []);
    const widths = Array.from({length:maxCols}, (_, col) => Math.min(280, Math.max(88, Math.max(...rows.slice(0, 60).map(row => String(row?.[col] ?? '').length), 6) * 7 + 24)));
    for (const spec of visual.colWidths || []) {
      const [start, end, width] = spec || [];
      for (let col = Math.max(0, start || 0); col <= Math.min(maxCols - 1, end || 0); col++) widths[col] = Math.min(360, Math.max(54, Number(width || 10) * 7 + 8));
    }
    const columns = [];
    for (let col = 0; col < maxCols; col++) if (!hiddenCols.has(col)) columns.push({index:col,label:Planner.columnLabel(col),width:Math.round(widths[col])});
    const merges = Planner.projectedMerges(set, {hiddenCols,hiddenRows});
    const styleCache = Planner.styleLookup(set);
    const rowBatches = new Map();
    for (const entry of entries) {
      const row = Math.max(0, Number(entry?.sourceRow || 0) - 1);
      const label = effectiveBatch(state, entry);
      if (label) rowBatches.set(row, label);
    }
    const tableRows = [];
    for (let row = 0; row < maxRows; row++) {
      if (hiddenRows.has(row)) continue;
      const rowHeight = Number(visual.rowHeights?.[row] || 0);
      const cells = [];
      for (const column of columns) {
        const col = column.index;
        if (merges.covered.has(`${row}:${col}`)) continue;
        const span = merges.top.get(`${row}:${col}`) || {};
        const anchor = span.anchor || [row, col];
        const sourceRow = Number(anchor[0]);
        const sourceCol = Number(anchor[1]);
        cells.push({
          key:`${row}:${col}`,
          row,
          col,
          rowSpan:span.rowSpan || 1,
          colSpan:span.colSpan || 1,
          merge:span.source || null,
          style:Planner.cssForStyle(Planner.styleAt(set, sourceRow, sourceCol, styleCache)),
          value:String(rows[sourceRow]?.[sourceCol] ?? rows[row]?.[col] ?? '')
        });
      }
      tableRows.push({
        index:row,
        height:rowHeight ? Math.max(22, Math.min(110, rowHeight * 1.333)) : undefined,
        batch:rowBatches.get(row) || '',
        cells
      });
    }
    const autoHiddenCount = (plan.autoHidden?.size || 0) + (plan.emptyHidden?.size || 0);
    return {
      columns,
      rows:tableRows,
      empty:false,
      showAll,
      columnFocus:showAll ? '全部列' : '主要列',
      columnTitle:showAll ? '当前显示全部可见列' : '当前只显示姓名、邮箱、院校和排期相关主要列',
      columnToggleVisible:!!autoHiddenCount,
      columnToggleLabel:showAll ? '只看主要列' : '查看全部列'
    };
  }

  function build({sources=[], state={}, selection=null, visible=false, returnToSchedule=false}={}) {
    const sourceOptions = sources.map(item => ({
      key:item.key,
      label:`${item.set.source || 'Excel'} · ${item.set.name || 'Sheet'}`
    }));
    const current = sources.find(item => item.key === state.sourceKey) || sources[0] || null;
    const activeBatch = String(state.activePriorityRound || state.activeBatch || '').trim();
    if (!current) {
      return {
        visible,
        returnToSchedule,
        sources:sourceOptions,
        selectedSourceKey:'',
        summary:{empty:true,text:'未找到可用于设置同校优先级的 XLSX 总名单'},
        features:[],
        featureEmptyText:'没有名单特征可选择',
        batches:[],
        batchSummary:{empty:true,assigned:0,unassigned:0,text:'没有总名单时仍可直接使用时间安排。'},
        table:{columns:[],rows:[],empty:true,emptyText:'未找到总名单'},
        columnToggle:{visible:false,pressed:false,label:'显示全部列',focus:'正在整理名单…',title:''},
        selection,
        selectionView:buildSelectionView([], null, state, selection, activeBatch)
      };
    }

    const set = current.set;
    let entries = [];
    try { entries = Roster.parseDataset({recordSets:[set],sheets:[set]}).entries || []; } catch (_) { /* Keep the preview available when a workbook cannot be parsed. */ }
    const entryRows = new Set(entries.map(entry => Math.max(0, Number(entry?.sourceRow || 0) - 1)));
    const firstRow = entryRows.size ? Math.min(...entryRows) : 1;
    const featureGroups = Planner.featureGroups(set, {rows:entryRows,startRow:firstRow})
      .map(group => {
        const rowSet = new Set(group.rows || []);
        const count = entries.filter(entry => rowSet.has(Number(entry?.sourceRow || 0) - 1)).length;
        return {...group,count,key:group.key || `fill:${group.fill || group.value || ''}`,kind:group.kind || 'fill',value:group.value || group.fill || ''};
      })
      .filter(group => group.count)
      .slice(0, 24);
    const features = featureGroups.map(group => ({
      key:group.key,
      kind:group.kind,
      label:group.label || '特征',
      value:group.value || '',
      count:group.count,
      variants:Array.isArray(group.variants) ? group.variants.length : 1,
      rows:group.rows || []
    }));
    const counts = new Map(Planner.knownBatches(state, entries).map(label => [label, 0]));
    let unassigned = 0;
    let fixed = 0;
    for (const entry of entries) {
      const label = effectiveBatch(state, entry);
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
      else if (String(entry?.scheduleAt || '').trim()) fixed++;
      else unassigned++;
    }
    const ordered = [...counts.entries()].sort((a, b) => {
      const first = Planner.parseRound(a[0]);
      const second = Planner.parseRound(b[0]);
      return (first ?? 999) - (second ?? 999) || a[0].localeCompare(b[0]);
    });
    const assigned = ordered.reduce((sum, item) => sum + item[1], 0);
    const batches = ordered.map(([label, count]) => ({
      label,
      count,
      active:activeBatch === label,
      explicit:entries.some(entry => Planner.explicitPriorityRound(entry) === label),
      weight:Math.max(1, count),
      title:entries.some(entry => Planner.explicitPriorityRound(entry) === label)
        ? 'Excel 中有明确同校优先级；点击查看成员'
        : '你新建的同校优先级；点击查看成员'
    }));
    const table = buildTable(set, entries, state);
    return {
      visible,
      returnToSchedule,
      sources:sourceOptions,
      selectedSourceKey:current.key,
      summary:{
        empty:false,
        people:entries.length,
        assigned,
        fixed,
        unassigned
      },
      features,
      featureEmptyText:features.length ? '' : '没有可复用的格式特征，直接框选即可',
      batches,
      batchSummary:{
        assigned,
        unassigned,
        fixed,
        showEmpty:!batches.length,
        emptyTitle:'未设置同校优先级',
        emptyText:'这是可选项；需要控制同校先后时再新建 R1/R2…。',
        note:'不设置也可直接排期；设置后仅约束同校先后。相近颜色只用于辅助选人，R1/R2 不代表发送日期。'
      },
      table,
      columnToggle:{
        visible:table.columnToggleVisible,
        pressed:table.showAll,
        label:table.columnToggleLabel,
        focus:table.columnFocus,
        title:table.columnTitle
      },
      selection,
      selectionView:buildSelectionView(entries, set, state, selection, activeBatch)
    };
  }

  globalThis.NMDAWorkspaceRosterPlannerModel = {build,buildSelectionView,selectedEntries,effectiveBatch};
})();
