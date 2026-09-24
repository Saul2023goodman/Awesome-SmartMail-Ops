import { useEffect, useRef, useSyncExternalStore } from 'react';

const Ui = globalThis.NMDAWorkspaceBatchGovernanceUi;
const FORMATS = [
  {key:'italic',label:'斜体',title:'斜体',mark:<em>I</em>},
  {key:'bold',label:'加粗',title:'加粗',mark:<strong>B</strong>},
  {key:'underline',label:'下划线',title:'下划线',mark:<u>U</u>},
  {key:'strike',label:'删除线',title:'删除线',mark:<s>S</s>}
];
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:batch-governance-action', {detail:{action,...detail}}));

export function BatchGovernanceEntry() {
  const view = useSyncExternalStore(Ui.subscribe, Ui.getSnapshot);
  return <button className={`nmda-review-format-entry nmda-preview-format-entry${view.entryCount ? ' has-drift' : ''}${view.open ? ' is-open' : ''}`} id="nmda-review-format-governance" type="button" aria-expanded={view.open ? 'true' : 'false'} title={view.entryTitle} onClick={() => window.dispatchEvent(new CustomEvent('nmda:review-action', {detail:{action:'batch'}}))}>
    <span className="nmda-preview-format-glyph nmda-preview-standard-glyph" aria-hidden="true"><i></i><b></b></span>
    <span className="nmda-preview-format-label">批量处理</span>
    <strong id="nmda-preview-format-drift-count" hidden={!view.entryCount}>{view.entryCount}</strong>
  </button>;
}

function SubjectCard({view,subjectRef}) {
  const subject = view.subject;
  return <section className="nmda-batch-standard-card is-subject" id="nmda-batch-standard-subject">
    <header><div><strong>主题完整性</strong><small>只补齐缺失的初始邮件主题；已有主题与跟进邮件主题保持不变。</small></div><b id="nmda-batch-standard-subject-badge">{subject.badge}</b></header>
    <label className="nmda-batch-standard-subject-field"><span>补齐为</span><input id="nmda-batch-standard-subject-input" type="text" maxLength="240" placeholder="输入统一主题" autoComplete="off" value={view.subjectValue} disabled={subject.disabled} ref={subjectRef} onChange={event => send('subject-input',{value:event.target.value})} /></label>
    <button className="nmda-batch-standard-suggestion" id="nmda-batch-standard-subject-suggestion" type="button" hidden={!subject.suggestionVisible} title={subject.suggestionTitle} onClick={() => send('use-subject-suggestion')}>{subject.suggestionLabel}</button>
    <div className="nmda-batch-standard-result" id="nmda-batch-standard-subject-result"><strong>{subject.resultTitle}</strong><span>{subject.resultCopy}</span></div>
  </section>;
}

function FormatSuggestions({view,suggestionRef}) {
  if (!view.suggestions.length) return <div className="nmda-format-governance-recommendation-empty"><strong>未发现明确格式偏移</strong><span>当前邮件之间没有形成可可靠推荐的格式差异。</span></div>;
  const selectedCount = view.suggestions.filter(item => item.selected).length;
  return <>
    <div className="nmda-format-governance-suggestion-head"><span><strong>推荐修复 {view.suggestions.length} 组格式偏移</strong><small>{selectedCount ? `已加入 ${selectedCount} 组；可继续多选，最后一次执行。` : '点击需要处理的推荐，或一次加入全部。'}</small></span><span className="nmda-format-governance-suggestion-actions"><button type="button" data-governance-add-all disabled={selectedCount === view.suggestions.length} onClick={() => send('add-all-suggestions')}>全部加入</button>{!!selectedCount && <button type="button" data-governance-clear-suggestions onClick={() => send('clear-suggestions')}>取消已选</button>}</span></div>
    <div className="nmda-format-governance-suggestion-list">{view.suggestions.map((item,index) => <button type="button" className={item.selected ? 'is-selected' : ''} data-governance-suggestion={index} aria-pressed={item.selected ? 'true' : 'false'} ref={index===0?suggestionRef:null} key={`${item.format}\0${item.phrase}`} onClick={() => send('toggle-suggestion',{index})}><i aria-hidden="true">{item.selected ? '✓' : '+'}</i><b>{item.label}</b><span>{item.phrase}</span><small>{item.missing} / {item.total} 封偏移</small></button>)}</div>
  </>;
}

function RuleQueue({queue}) {
  return <div className="nmda-format-governance-queue" id="nmda-format-governance-queue" hidden={!queue.visible}>
    {queue.visible && <><div className="nmda-format-governance-queue-head"><span><strong>本次格式处理 {queue.count} 条</strong><small>一次执行，不逐条等待；当前共影响 {queue.affected} 封邮件。</small></span><button type="button" data-governance-queue-clear onClick={() => send('clear-queue')}>清空</button></div><div className="nmda-format-governance-queue-list">{queue.rules.map((item,index) => <span className="nmda-format-governance-queued-rule" data-state={item.pending ? 'pending' : 'idle'} data-governance-queue-rule={index} title="点击查看这条规则" key={`${item.key}-${index}`} onClick={() => send('edit-queued-rule',{index})}><b>{item.labels}</b><i>{item.phrase}</i><small>{item.state}</small><button type="button" data-governance-queue-remove={index} aria-label="移除此格式规则" onClick={event => {event.stopPropagation();send('remove-queued-rule',{index});}}>×</button></span>)}</div></>}
  </div>;
}

function CustomRuleEditor({view}) {
  const selected = new Set(view.formats);
  return <details className="nmda-format-governance-custom" id="nmda-format-governance-custom" open={view.customOpen}>
    <summary onClick={event => {event.preventDefault();send('toggle-custom');}}><span><strong>自定义格式规则</strong><small>仅在推荐无法覆盖时使用</small></span><i aria-hidden="true">⌄</i></summary>
    <div className="nmda-format-governance-custom-body">
      <div className="nmda-format-governance-builder">
        <label className="nmda-format-governance-phrase"><span>固定文本</span><input id="nmda-format-governance-phrase" type="text" maxLength="240" placeholder="例如：Computational Imaging" autoComplete="off" value={view.phrase} onChange={event => send('phrase-input',{value:event.target.value})} /><small>精确匹配正文中的固定表达。</small></label>
        <div className="nmda-format-governance-formats" role="group" aria-label="需要统一的格式"><span>统一为</span>{FORMATS.map(format => <button className={selected.has(format.key) ? 'is-active' : ''} type="button" data-governance-format={format.key} aria-pressed={selected.has(format.key) ? 'true' : 'false'} title={format.title} key={format.key} onClick={() => send('toggle-format',{format:format.key})}>{format.mark}<small>{format.label}</small></button>)}</div>
        <label className="nmda-format-governance-case"><input id="nmda-format-governance-case" type="checkbox" checked={view.caseSensitive} onChange={event => send('case-sensitive',{checked:event.target.checked})} /><span>区分大小写</span></label>
        <button className="nmda-btn nmda-btn-small nmda-btn-quiet nmda-format-governance-add" id="nmda-format-governance-add" type="button" disabled={view.analysis.addDisabled} onClick={() => send('add-custom-rule')}>{view.analysis.addLabel}</button>
      </div>
      <div className="nmda-format-governance-result" id="nmda-format-governance-result"><strong>{view.analysis.headline}</strong><span>{view.analysis.copy}</span></div>
      <div className="nmda-format-governance-list" id="nmda-format-governance-list" hidden={!view.analysis.rows.length}>
        {view.analysis.rows.map(row => <div className="nmda-format-governance-row" data-state={row.state} data-governance-row-key={row.key} key={row.key}><span><strong>{row.subject}</strong><small>{row.recipients}</small></span><p>{row.context}</p><b>{row.status}</b></div>)}
        {!!view.analysis.moreCount && <div className="nmda-format-governance-more">另有 {view.analysis.moreCount} 封命中邮件未展开</div>}
      </div>
      <div id="nmda-format-governance-history" className="nmda-format-governance-history">{!!view.history.length && <><span>最近规则</span>{view.history.map(rule => <button type="button" data-governance-history={rule.id} title="重新检查这条规则" key={rule.id} onClick={() => send('load-history-rule',{id:rule.id})}><b>{rule.labels}</b><i>{rule.phrase}</i><small>{rule.changedTasks} 封</small></button>)}</>}</div>
    </div>
  </details>;
}

export function BatchGovernancePanel() {
  const view = useSyncExternalStore(Ui.subscribe, Ui.getSnapshot);
  const subjectRef = useRef(null);
  const suggestionRef = useRef(null);
  const lastSubjectFocusToken = useRef(0);
  useEffect(() => {
    if (!view.open) return undefined;
    const focusSubject = view.subject.count || view.subjectFocusToken !== lastSubjectFocusToken.current;
    lastSubjectFocusToken.current = view.subjectFocusToken;
    const frame = requestAnimationFrame(() => {
      if (focusSubject) subjectRef.current?.focus?.({preventScroll:true});
      else suggestionRef.current?.focus?.({preventScroll:true});
    });
    return () => cancelAnimationFrame(frame);
  }, [view.open,view.subjectFocusToken]);

  return <section className="nmda-format-governance nmda-batch-standards" id="nmda-format-governance" hidden={!view.open} aria-label="批量处理">
    <header className="nmda-format-governance-head nmda-batch-standards-head"><div><strong>批量处理</strong><small id="nmda-batch-standards-desc">只显示当前真正需要处理的批量事项：补齐主题、处理检测到的格式偏移。</small></div><button className="nmda-icon-btn" id="nmda-format-governance-close" type="button" aria-label="关闭批量处理" onClick={() => send('close')}>×</button></header>
    <div className="nmda-batch-standards-overview" aria-label="批量处理检查结果"><span data-standard-summary="subject"><i>T</i><b>主题补齐</b><strong id="nmda-batch-standard-subject-count">{view.subject.count}</strong><small>缺失</small></span><span data-standard-summary="format"><i>✦</i><b>格式偏移</b><strong id="nmda-batch-standard-format-count">{view.formatCount}</strong><small>推荐</small></span></div>
    <SubjectCard view={view} subjectRef={subjectRef} />
    <section className="nmda-batch-standard-card is-format" id="nmda-batch-standard-format">
      <header><div><strong>格式偏移</strong><small>默认只展示系统从当前邮件中检测到的偏移推荐；选择后一次批量修复。</small></div></header>
      <div className="nmda-format-governance-suggestions" id="nmda-format-governance-suggestions"><FormatSuggestions view={view} suggestionRef={suggestionRef} /></div>
      <RuleQueue queue={view.queue} />
      <CustomRuleEditor view={view} />
    </section>
    <footer className="nmda-format-governance-actions nmda-batch-standards-actions"><div id="nmda-batch-standard-plan-summary" className="nmda-batch-standard-plan-summary">{view.planSummary}</div><button className="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-format-governance-apply" type="button" disabled={view.apply.disabled} aria-busy={view.apply.busy ? 'true' : undefined} onClick={() => send('apply')}>{view.apply.label}</button></footer>
  </section>;
}
