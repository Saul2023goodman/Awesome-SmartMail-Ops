import { useEffect, useState, useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:import-audit-action', {detail:{action,...detail}}));

function DraftHistory({model}) {
  const [selected,setSelected] = useState(() => model.hits.map(hit => hit.key));
  const [hint,setHint] = useState('默认勾选全部命中项；这里仅按“邮箱中已存在 Draft”筛选，不比较正文版本。');
  const signature = model.hits.map(hit => hit.key).join('|');
  useEffect(() => { setSelected(model.hits.map(hit => hit.key));setHint('默认勾选全部命中项；这里仅按“邮箱中已存在 Draft”筛选，不比较正文版本。'); }, [signature]);
  const update = key => setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current,key]);
  const act = action => {
    if (!selected.length) { setHint(action === 'exclude' ? '至少选择一封需要筛除的邮件。' : '至少选择一封需要保留的邮件。');return; }
    send(action === 'exclude' ? 'exclude-draft-history' : 'keep-draft-history',{keys:selected});
  };
  return <section className="nmda-draft-history-filter" id="nmda-draft-history-filter" hidden={!model.visible}>
    <div className="nmda-draft-history-filter-head"><div><strong>已有草稿命中 <span>{model.hits.length}</span> 封</strong><small>这些邮件在网易草稿箱中已有对应收件人，不做正文版本对比。</small></div><span>草稿防重</span></div>
    <div className="nmda-draft-history-filter-list">{model.hits.map(hit => <label className="nmda-draft-history-filter-row" key={hit.key}><input type="checkbox" checked={selected.includes(hit.key)} onChange={() => update(hit.key)} /><span><strong>{hit.recipient}</strong><small>{hit.description}</small></span><em>建议筛除</em></label>)}</div>
    <div className="nmda-draft-history-filter-actions"><small>{hint}</small><div className="nmda-row nmda-wrap"><button className="nmda-btn nmda-btn-primary" type="button" onClick={() => act('exclude')}>筛除所选（{selected.length}）</button><button className="nmda-btn" type="button" onClick={() => act('keep')}>仍保留所选（{selected.length}）</button></div></div>
  </section>;
}

function Candidate({candidate}) {
  return <article className={`nmda-duplicate-candidate${candidate.selected ? ' is-selected' : ''}${candidate.history ? ' nmda-history-evidence' : ''}`} data-duplicate-row={candidate.key}>
    {candidate.selectable && <label className="nmda-duplicate-pick-line"><input type="checkbox" checked={candidate.selected} onChange={event => send('selection',{key:candidate.key,checked:event.target.checked})} /><span><strong>保留此封</strong><small>{candidate.meta}</small></span></label>}
    <div className="nmda-duplicate-preview-head"><div className="nmda-duplicate-candidate-title"><strong>{candidate.title}</strong>{candidate.badge && <em>{candidate.badge}</em>}</div>{!!candidate.recipient && <span className="nmda-duplicate-preview-recipient">{candidate.recipient}</span>}</div>
    <div className="nmda-duplicate-preview-body"><pre>{candidate.body}</pre></div>
  </article>;
}

export default function ImportAudit() {
  const {audit} = useSyncExternalStore(importUi.subscribe, importUi.getSnapshot);
  const draft = audit.draftHistory;
  const duplicate = audit.duplicate;
  return <>
    <DraftHistory model={draft} />
    <section className="nmda-duplicate-decision nmda-import-duplicate-decision" id="nmda-duplicate-decision" hidden={!duplicate.visible} data-group-id={duplicate.groupId || undefined} data-scope={duplicate.scope || undefined}>
      <div className="nmda-duplicate-decision-head"><div><strong>{duplicate.title}</strong><small>{duplicate.copy}</small></div><span className="nmda-duplicate-kind" data-tone={duplicate.tone}>{duplicate.kind}</span></div>
      <div className="nmda-duplicate-candidates" data-count={duplicate.candidates?.length || 0}>{(duplicate.candidates || []).map(candidate => <Candidate candidate={candidate} key={candidate.key} />)}</div>
      <div className="nmda-duplicate-actions"><span className="nmda-hint">{duplicate.hint}</span><div className="nmda-row nmda-wrap">
        {duplicate.showSelected && <button className="nmda-btn nmda-btn-primary" type="button" disabled={duplicate.scope === 'batch' && !duplicate.selectedKeys?.length} onClick={() => send('keep-selected',{keys:duplicate.selectedKeys || []})}>{duplicate.keepSelectedLabel}</button>}
        {duplicate.showAll && <button className="nmda-btn" type="button" onClick={() => send('keep-all')}>{duplicate.keepAllLabel}</button>}
      </div></div>
    </section>
  </>;
}

export function ImportAuditStatus() {
  const {audit} = useSyncExternalStore(importUi.subscribe, importUi.getSnapshot);
  return <small id="nmda-import-dedupe-state">{audit.dedupeStatus || '正在核验'}</small>;
}
