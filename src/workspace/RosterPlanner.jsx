import {useEffect, useRef, useSyncExternalStore} from 'react';

const PlanningUi = globalThis.NMDAWorkspacePlanningUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:roster-planner-action', {detail:{action,...detail}}));

function styleFromCss(css = '') {
  const style = {};
  for (const declaration of String(css).split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) continue;
    style[property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return style;
}

function FeatureChip({feature, active}) {
  const activeClass = active ? ' is-active' : '';
  let icon;
  let title;
  let label;
  if (feature.kind === 'fill') {
    const hint = feature.variants > 1 ? `相近色已合并 ${feature.variants} 种原始颜色 · ` : '';
    icon = <i style={{background:feature.value || '#fff'}} />;
    title = `${hint}选择这一颜色族的 ${feature.count} 位联系人`;
    label = feature.variants > 1 ? '近似色' : '颜色';
  } else if (feature.kind === 'font-color') {
    icon = <i className="is-font-color" style={{color:feature.value || '#334155'}}>A</i>;
    title = `选择这一字体颜色的 ${feature.count} 位联系人`;
    label = '字体色';
  } else if (feature.kind === 'bold') {
    icon = <i className="is-format-mark"><strong>B</strong></i>;
    title = `选择加粗的 ${feature.count} 位联系人`;
    label = '加粗';
  } else if (feature.kind === 'italic') {
    icon = <i className="is-format-mark"><em>I</em></i>;
    title = `选择斜体的 ${feature.count} 位联系人`;
    label = '斜体';
  } else {
    icon = <i className="is-border-mark" />;
    title = `选择具有相同格式特征的 ${feature.count} 位联系人`;
    label = '边框';
  }
  return <button className={`nmda-roster-visual-chip${activeClass}`} type="button" data-roster-feature-key={feature.key} title={title} onClick={() => send('feature',{key:feature.key})}>
    {icon}<span>{label}</span><b>{feature.count}</b>
  </button>;
}

function RosterTable({table, selection}) {
  const selectedRows = new Set(selection?.rows || []);
  const range = selection?.range;
  const rangeBounds = range ? {
    r1:Math.min(range.r1, range.r2),
    r2:Math.max(range.r1, range.r2),
    c1:Math.min(range.c1, range.c2),
    c2:Math.max(range.c1, range.c2)
  } : null;
  return <table className="nmda-roster-sheet-table" id="nmda-roster-sheet-table" aria-label="总名单联系人优先级预览">
    {table.empty ? <tbody><tr><td className="nmda-roster-empty-sheet">{table.emptyText}</td></tr></tbody> : <>
      <colgroup><col style={{width:52}} />{table.columns.map(column => <col style={{width:column.width}} key={column.index} />)}</colgroup>
      <thead><tr><th className="nmda-roster-corner" scope="col" />{table.columns.map(column => <th className="nmda-roster-colhead" data-col={column.index} scope="col" key={column.index}>{column.label}</th>)}</tr></thead>
      <tbody>{table.rows.map(row => {
        const rowSelected = selectedRows.size ? selectedRows.has(row.index) : !!rangeBounds && row.index >= rangeBounds.r1 && row.index <= rangeBounds.r2;
        return <tr style={row.height ? {height:row.height} : undefined} data-roster-row-batch={row.batch || undefined} key={row.index}>
          <th className={`nmda-roster-rowhead${rowSelected ? ' is-selected' : ''}`} data-row={row.index} scope="row"><span>{row.index + 1}</span>{row.batch && <b>{row.batch}</b>}</th>
          {row.cells.map(cell => {
            const selected = selectedRows.size ? selectedRows.has(cell.row) : !!rangeBounds && cell.row >= rangeBounds.r1 && cell.row <= rangeBounds.r2 && cell.col >= rangeBounds.c1 && cell.col <= rangeBounds.c2;
            const merge = cell.merge;
            return <td className={selected ? 'is-selected' : undefined} data-roster-cell data-row={cell.row} data-col={cell.col} data-merge-r1={merge?.[0]} data-merge-c1={merge?.[1]} data-merge-r2={merge?.[2]} data-merge-c2={merge?.[3]} rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined} colSpan={cell.colSpan > 1 ? cell.colSpan : undefined} style={styleFromCss(cell.style)} key={cell.key}><span>{cell.value}</span></td>;
          })}
        </tr>;
      })}</tbody>
    </>}
  </table>;
}

function BatchSegment({batch}) {
  return <button type="button" className={`nmda-roster-batch-segment${batch.active ? ' is-active' : ''}`} data-roster-batch-focus={batch.label} style={{'--weight':batch.weight}} title={batch.title} onClick={() => send('batch-focus',{value:batch.label})}><span>{batch.label}</span><b>{batch.count}</b></button>;
}

function PlannerSummary({summary}) {
  if (summary.empty) return summary.text;
  return <><strong>{summary.people}</strong><span>联系人</span><i></i><b>{summary.assigned}</b><span>已设优先级</span>{summary.fixed > 0 && <><i></i><b>{summary.fixed}</b><span>固定时间</span></>}<i></i><b>{summary.unassigned}</b><span>未设置 · 可选</span></>;
}

export default function RosterPlanner() {
  const {rosterPlanner:view} = useSyncExternalStore(PlanningUi.subscribe, PlanningUi.getSnapshot);
  const tableRef = useRef(null);
  const pointerRef = useRef({dragging:false,anchor:null});
  const selection = view.selection || null;

  useEffect(() => {
    const finish = () => {
      if (!pointerRef.current.dragging) return;
      pointerRef.current.dragging = false;
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  const pointFrom = element => ({row:Number(element.dataset.row),col:Number(element.dataset.col)});
  const startSelection = event => {
    const cell = event.target.closest?.('[data-roster-cell]');
    if (!cell || event.button !== 0) return;
    event.preventDefault();
    const point = pointFrom(cell);
    const anchor = event.shiftKey && selection?.anchor ? selection.anchor : point;
    pointerRef.current = {dragging:true,anchor};
    send('select-start',{point,anchor});
  };
  const moveSelection = event => {
    if (!pointerRef.current.dragging || !pointerRef.current.anchor) return;
    const hit = document.elementFromPoint(event.clientX,event.clientY)?.closest?.('[data-roster-cell]');
    if (!hit || !tableRef.current?.contains(hit)) return;
    send('select-move',{point:pointFrom(hit)});
  };

  return <section className="nmda-roster-planner-view" id="nmda-roster-planner-view" hidden={!view.visible} aria-hidden={!view.visible} aria-labelledby="nmda-roster-planner-title">
    <header className="nmda-roster-planner-view-head">
      <div className="nmda-roster-planner-view-leading">
        <button className="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-planner-back" type="button" onClick={() => send('close')}>← 返回时间安排</button>
        <div><span className="nmda-dialog-eyebrow">Within-school priority · Optional</span><h2 id="nmda-roster-planner-title">同校优先级 · 可选</h2><p>仅在需要明确同一学校内的联系先后时设置 R1/R2…；它只是时间安排的可选约束，不设置时按现有名单顺序正常排期。</p></div>
      </div>
      <div className="nmda-roster-planner-view-actions"><button className="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-roster-planner-done" type="button" onClick={() => send('close')}>完成并返回时间安排</button></div>
    </header>

    <div className="nmda-roster-planner-workspace">
      <div className="nmda-roster-planner-commandbar">
        <div className="nmda-roster-source-cluster">
          <div className="nmda-roster-planner-source"><span>总名单</span><select id="nmda-roster-planner-source" aria-label="选择名单工作表" value={view.selectedSourceKey} disabled={!view.sources.length} onChange={event => send('source',{key:event.target.value})}>{view.sources.map(source => <option value={source.key} key={source.key}>{source.label}</option>)}</select></div>
          <div className="nmda-roster-planner-summary" id="nmda-roster-planner-summary"><PlannerSummary summary={view.summary} /></div>
        </div>

        <div className="nmda-roster-color-strip" aria-label="按格式特征快速选择联系人"><span className="nmda-roster-color-strip-label">快速选人</span><div className="nmda-roster-visual-groups" id="nmda-roster-visual-groups">{view.features.length ? view.features.map(feature => <FeatureChip feature={feature} active={selection?.featureKey === feature.key} key={feature.key} />) : <span className="nmda-roster-visual-label">{view.featureEmptyText}</span>}</div></div>

        <div className="nmda-roster-planner-canvas-tools"><span className="nmda-roster-column-focus" id="nmda-roster-column-focus" title={view.columnToggle.title}>{view.columnToggle.focus}</span><button className="nmda-btn nmda-btn-small nmda-btn-quiet nmda-roster-column-toggle" id="nmda-roster-column-toggle" type="button" hidden={!view.columnToggle.visible} aria-pressed={view.columnToggle.pressed} onClick={() => send('toggle-columns')}>{view.columnToggle.label}</button><div className="nmda-roster-planner-selection-mini" id="nmda-roster-selection-mini">{view.selectionView.label}</div></div>
      </div>

      <div className="nmda-roster-intent-summary" id="nmda-roster-intent-summary">
        {view.batchSummary.empty ? <div className="nmda-roster-batch-overview-empty">{view.batchSummary.text}</div> : <>
          <div className="nmda-roster-batch-overview-title"><strong>同校优先级 · 可选</strong><span>{view.batchSummary.assigned} 已设 · {view.batchSummary.unassigned} 未设置</span></div>
          <div className="nmda-roster-batch-track">{view.batches.map(batch => <BatchSegment batch={batch} key={batch.label} />)}{view.batchSummary.fixed > 0 && <button type="button" className={`nmda-roster-batch-segment is-fixed${selection?.kind === 'fixed' ? ' is-active' : ''}`} data-roster-batch-focus="__fixed__" style={{'--weight':Math.max(1,view.batchSummary.fixed)}} title="Excel 中已有明确发送时间；该时间直接进入排期，不再由同校优先级决定日期" onClick={() => send('batch-focus',{value:'__fixed__'})}><span>固定时间</span><b>{view.batchSummary.fixed}</b></button>}{view.batchSummary.unassigned > 0 && <button type="button" className={`nmda-roster-batch-segment is-unassigned${selection?.kind === 'unassigned' ? ' is-active' : ''}`} data-roster-batch-focus="__unassigned__" style={{'--weight':Math.max(1,view.batchSummary.unassigned)}} title="未设置同校优先级（可选）；不影响排期" onClick={() => send('batch-focus',{value:'__unassigned__'})}><span>未设置 · 可选</span><b>{view.batchSummary.unassigned}</b></button>}{view.batchSummary.showEmpty && <div className="nmda-roster-batch-empty-state"><strong>{view.batchSummary.emptyTitle}</strong><span>{view.batchSummary.emptyText}</span></div>}</div>
          <small>{view.batchSummary.note}</small>
        </>}
      </div>

      <main className="nmda-roster-planner-canvas">
        <div className="nmda-roster-planner-canvas-head"><div className="nmda-roster-selection-context">
          <div className="nmda-roster-selection-copy"><strong id="nmda-roster-selection-label">{view.selectionView.label}</strong><small id="nmda-roster-selection-detail">{view.selectionView.detail}</small></div>
          <div className="nmda-roster-active-batch" id="nmda-roster-active-batch" data-state={view.selectionView.activeState}><span>当前同校优先级</span><strong id="nmda-roster-active-batch-label">{view.selectionView.activeBatch || '未创建'}</strong></div>
          <button className="nmda-btn nmda-btn-small nmda-btn-primary nmda-roster-batch-add" id="nmda-roster-batch-add" type="button" disabled={!view.selectionView.canAdd} onClick={() => send('add-batch')}>{view.selectionView.activeBatch ? `加入 ${view.selectionView.activeBatch}` : '先新建轮次'}</button>
          <button className="nmda-btn nmda-btn-small nmda-roster-batch-create" id="nmda-roster-batch-create" type="button" onClick={() => send('create-batch')}>＋ 新建优先级</button>
          <button className="nmda-btn nmda-btn-small nmda-btn-quiet nmda-roster-batch-clear" id="nmda-roster-batch-clear" type="button" disabled={!view.selectionView.canClear} onClick={() => send('clear-batch')}>移出优先级</button>
        </div></div>
        <div className="nmda-roster-sheet-viewport" id="nmda-roster-sheet-viewport" tabIndex="0" aria-label="总名单预览，可拖动框选联系人" onPointerDown={startSelection} onPointerMove={moveSelection}>
          <div ref={tableRef}><RosterTable table={view.table} selection={selection} /></div>
        </div>
      </main>
    </div>
  </section>;
}
