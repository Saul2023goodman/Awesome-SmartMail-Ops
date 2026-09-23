import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

const State = globalThis.NMDAWorkspaceState;
const Domain = globalThis.NMDAMonitorDomain;
const Operations = globalThis.NMDAOperations;
const FollowUp = globalThis.NMDAWorkspaceFollowUp;
const Runtime = globalThis.NMDAWorkspaceRuntime;
const Persistence = globalThis.NMDAWorkspacePersistence;
const MailboxSync = globalThis.NMDAWorkspaceMailboxSync;

const FILTERS = [
  ['attention', '需要我处理'], ['waiting', '等待中'], ['complete', '本轮结束'], ['all', '全部']
];
const SUBFILTERS = {
  attention:[['due','需要跟进'],['replied','处理回复'],['ambiguous','确认来信'],['issue','其他待处理']],
  waiting:[['time','等待时间'],['scheduled','已安排发送']]
};

function DecisionPath({ group }) {
  return <div className="nmda-monitor-decision-path" aria-label="本邮件判定路径">
    {Domain.monitorDecisionPath(group, group.viewState).map((node, index) => <FragmentNode node={node} index={index} key={index} />)}
  </div>;
}

function FragmentNode({ node, index }) {
  return <>{index > 0 && <span className="nmda-monitor-path-link" aria-hidden="true"></span>}<div className="nmda-monitor-path-node" data-kind={node.kind} data-tone={node.tone || ''}><small>{node.title}</small><strong>{node.value}</strong></div></>;
}

function ContactHistory({ group }) {
  const records = [...(group?.outbounds || [])].sort((a, b) => Operations.timeMs(b.sentAt) - Operations.timeMs(a.sentAt));
  if (!records.length) return null;
  return <details className="nmda-contact-history"><summary>查看联系记录 <b>{records.length}</b></summary><div>{records.slice(0, 6).map((record, index) => {
    const sequence = Math.max(0, Number(record.effectiveSequence ?? record.sequence ?? 0));
    return <div className="nmda-contact-history-row" key={record.id || index}><span><b>{sequence > 0 ? `跟进 #${sequence}` : '首次联系'}</b><small>{record.subject || '(无主题)'}</small></span><time>{Operations.formatDisplayTime(record.sentAt)}</time></div>;
  })}</div></details>;
}

function ContactCard({ group, selected, toggleSelected, act, openMail }) {
  const last = group.lastOutbound || {};
  const state = group.viewState;
  const active = state.activeTask;
  const identity = Domain.monitorContactIdentity(group);
  const metrics = Domain.monitorContactMetrics(group);
  const subject = state.scheduledDraft?.subject || last.subject || '';
  const messageId = String(last.providerMessageId || '').trim();
  const selectable = Domain.monitorCreatable(group);
  const label = Domain.monitorContactStatusLabel(group);
  const nextSequence = Math.max(1, Number(group.eligibility?.sequence || active?.sequence || metrics.followUps + 1));
  const contactTitle = identity.name || identity.email;
  const contactSub = identity.name ? identity.email : subject;
  const ambiguous = state.observation?.kind === 'ambiguous' ? state.observation : null;
  return <article className={`nmda-contact-card${selectable ? ' is-selectable' : ''}`} data-tone={state.tone || ''}>
    <header className="nmda-contact-card-head">
      <div className="nmda-contact-identity"><span className="nmda-contact-avatar" aria-hidden="true">{(contactTitle || '@').trim().charAt(0).toUpperCase() || '@'}</span><div><div className="nmda-contact-title"><strong>{contactTitle}</strong><span className="nmda-monitor-badge" data-tone={state.tone || ''}>{label}</span></div><small>{contactSub}</small></div></div>
      <div className="nmda-contact-actions">
        {selectable && <label className="nmda-monitor-card-select" title="选择这位联系人"><input type="checkbox" checked={selected} onChange={event => toggleSelected(group.rootTaskId, event.target.checked)} /><span>选择</span></label>}
        <div>
          {state.key === 'replied' && state.observation && <button className="nmda-btn nmda-btn-small nmda-btn-primary" type="button" onClick={() => openMail(state.observation.providerMessageId, 1)}>处理回复</button>}
          {!group.humanManaged && active && <><button className="nmda-btn nmda-btn-small nmda-btn-primary" type="button" onClick={() => act(active.dispatch?.queued ? 'dispatch' : 'review', active.id)}>{active.dispatch?.queued ? '查看排期' : '处理跟进稿'}</button>{!['sent','cancelled'].includes(active.state) && <button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => act('cancel', active.id)}>取消本次跟进</button>}</>}
          {!group.humanManaged && !active && group.eligibility?.eligible && <button className="nmda-btn nmda-btn-primary nmda-btn-small" type="button" onClick={() => act('create', group.rootTaskId)}>准备跟进</button>}
          {!group.humanManaged && !active && !group.eligibility?.eligible && group.eligibility?.reason === 'waiting' && <button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => act('manual', group.rootTaskId)}>提前跟进</button>}
          <button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => openMail(messageId, 3)} disabled={!messageId}>查看最近邮件</button>
        </div>
      </div>
    </header>
    <div className="nmda-contact-card-grid"><div className="nmda-contact-metrics">
      <div><small>联系次数</small><strong>{metrics.touches}</strong><span>封已发送</span></div>
      <div><small>已跟进</small><strong>{metrics.followUps}</strong><span>次跟进</span></div>
      <div><small>有效回复</small><strong>{metrics.replies ? '有' : '—'}</strong><span>{metrics.replies ? `${metrics.replies} 封回复` : '尚未回复'}</span></div>
      <div><small>{state.key === 'due' ? '下一次跟进' : '最近联系'}</small><strong>{state.key === 'due' ? `#${nextSequence}` : '最近'}</strong><span>{state.key === 'due' ? (state.activeTask ? '已准备' : Operations.formatDisplayTime(group.eligibility?.dueAt || last.sentAt)) : Operations.formatDisplayTime(metrics.lastAt)}</span></div>
    </div><div className="nmda-contact-decision"><div className="nmda-contact-decision-head"><span>为什么是这个状态</span><small>{state.detail || ''}</small></div><DecisionPath group={group} /></div></div>
    <div className="nmda-contact-evidence-bar"><span><small>最近主题</small><strong title={subject}>{subject || '(无主题)'}</strong></span><ContactHistory group={group} /></div>
    {ambiguous && <div className="nmda-monitor-reply-evidence"><div className="nmda-monitor-reply-evidence-copy"><small>需要你确认一封来信</small><strong>{Domain.monitorDisplayReplySubject(ambiguous.subject || '', group, ambiguous)}</strong><span>{ambiguous.sender || identity.email}{ambiguous.receivedAt ? ` · ${Operations.formatDisplayTime(ambiguous.receivedAt)}` : ''}</span></div><div className="nmda-monitor-reply-evidence-actions"><button className="is-open" type="button" onClick={() => openMail(ambiguous.providerMessageId, 1)}>{ambiguous.providerMessageId ? '查看这封来信' : '打开收件箱'}</button><i aria-hidden="true"></i><span>确认后：</span>{[['human','计为有效回复'],['automatic','这是自动回复'],['unrelated','不属于这次联系']].map(([disposition, text]) => <button type="button" key={disposition} onClick={() => act('disposition', ambiguous.id, disposition)}>{text}</button>)}</div></div>}
  </article>;
}

function Settings({ policy, open, initialTab, close, notice }) {
  const [tab, setTab] = useState(initialTab);
  const [max, setMax] = useState(policy.maxAttempts ?? 2);
  const [compose, setCompose] = useState(policy.composeMode || 'forward');
  const [body, setBody] = useState(policy.templateBody || '');
  const [sync, setSync] = useState(true);
  const delayRef = useRef(null), bodyRef = useRef(null);
  useEffect(() => { if (!open) return; setTab(initialTab); if (delayRef.current) delayRef.current.value = String(policy.delayDays ?? 7); setMax(policy.maxAttempts ?? 2); setCompose(policy.composeMode || 'forward'); setBody(policy.templateBody || ''); }, [open, initialTab]);
  useEffect(() => { if (open) requestAnimationFrame(() => (tab === 'template' ? bodyRef : delayRef).current?.focus({ preventScroll:true })); }, [open, tab]);
  useEffect(() => { if (!open) return; const escape = event => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [open, close]);
  const template = FollowUp.templateState(body, sync);
  const savePolicy = async () => { try { await FollowUp.savePolicy({ delayDays:Number(delayRef.current?.value || 0), maxAttempts:Number(max || 0), composeMode:compose }); notice('跟进规则已保存，并已重新计算所有联系人状态。', 'ok'); } catch (error) { notice(`保存跟进规则失败：${error?.message || String(error)}`, 'error'); } };
  const saveTemplate = async () => { try { const result = await FollowUp.saveTemplate(body, sync); if (!result.changed) { notice('跟进邮件模板没有变化。'); return; } const parts = [result.value ? '跟进邮件模板已保存' : '跟进邮件模板已清空']; if (result.refreshedCount) parts.push(`同步 ${result.refreshedCount} 封待发跟进邮件`); if (result.protectedCount) parts.push(`${result.protectedCount} 封人工正文保持不变`); notice(`${parts.join(' · ')}。`, 'ok'); window.dispatchEvent(new Event('nmda:followup-updated')); } catch (error) { notice(`保存模板失败：${error?.message || String(error)}`, 'error'); } };
  return <div className="nmda-workflow-modal-overlay nmda-monitor-settings-overlay" hidden={!open} onMouseDown={event => { if (event.target === event.currentTarget) close(); }} data-view={tab}>
    <section className="nmda-workflow-dialog nmda-monitor-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-monitor-settings-title">
      <header className="nmda-workflow-dialog-head nmda-monitor-settings-head"><div><span className="nmda-dialog-eyebrow">跟进设置</span><h3 id="nmda-monitor-settings-title">跟进规则与正文</h3><p>规则决定什么时候进入下一次跟进；模板决定生成的邮件正文。</p></div><button className="nmda-dialog-close" type="button" onClick={close} aria-label="关闭">×</button></header>
      <div className="nmda-monitor-settings-tabs" role="tablist" aria-label="跟进设置类型"><button type="button" className={tab === 'policy' ? 'is-active' : ''} aria-selected={tab === 'policy'} onClick={() => setTab('policy')}>跟进规则</button><button type="button" className={tab === 'template' ? 'is-active' : ''} aria-selected={tab === 'template'} onClick={() => setTab('template')}>正文模板</button></div>
      <div className="nmda-monitor-settings-content"><section className="nmda-monitor-settings-pane" hidden={tab !== 'policy'}><div className="nmda-monitor-settings-intro"><strong>什么时候生成下一封跟进？</strong><span>未收到有效回复、没有已安排的跟进邮件且未达到次数上限时，才会生成下一封。</span></div><div className="nmda-monitor-policy-editor">
        <label className="nmda-monitor-policy-field"><span>首封 / 上次发送后等待</span><div className="nmda-smart-duration"><input ref={delayRef} type="number" min="0" max="365" step="1" defaultValue={policy.delayDays ?? 7} data-smart-temporal="duration-days" data-smart-role="followup-delay" /><b>天</b><button className="nmda-smart-temporal-trigger is-inline" type="button" data-smart-temporal-open aria-label="快速设置等待天数" title="常用间隔">⌄</button></div><small>达到这个间隔后，邮件会进入“待跟进”。</small></label>
        <label className="nmda-monitor-policy-field"><span>最多跟进次数</span><div><input type="number" min="0" max="20" step="1" value={max} onChange={event => setMax(event.target.value)} /><b>次</b></div><small>达到上限后继续监测回复，但不再生成新跟进。</small></label>
        <label className="nmda-monitor-policy-field"><span>跟进写信方式</span><select value={compose} onChange={event => setCompose(event.target.value)}><option value="forward">转发原邮件</option><option value="reply">回复全部（保留附件）</option><option value="new">新建邮件</option></select><small>决定生成到网易时采用的写信方式。</small></label>
      </div><div className="nmda-monitor-settings-save-row"><span>保存后立即重新计算当前邮件的跟进资格。</span><button className="nmda-btn nmda-btn-primary" type="button" onClick={savePolicy}>保存跟进规则</button></div></section>
      <section className="nmda-monitor-settings-pane" hidden={tab !== 'template'}><div className="nmda-monitor-settings-intro"><strong>跟进邮件正文模板</strong><span>称呼和署名沿用对应的初始邮件，这里只填写中间正文；无需重复写 Dear… 或落款。</span></div><div className="nmda-monitor-template-editor"><div className="nmda-monitor-template-body"><label className="nmda-monitor-template-field"><textarea ref={bodyRef} rows="7" placeholder="例如：I wanted to follow up on my previous email regarding ..." value={body} onChange={event => setBody(event.target.value)}></textarea></label><div className="nmda-monitor-template-actions"><label className="nmda-monitor-template-sync"><input type="checkbox" checked={sync} disabled={!template.changed || !template.value || !template.syncable.length} onChange={event => setSync(event.target.checked)} /><span>同时更新尚未发送、且仍由模板管理的跟进邮件</span></label><small>{template.syncable.length ? `${template.syncable.length} 封可同步` : template.protectedCount ? `${template.protectedCount} 封人工正文受保护` : template.lockedCount ? `${template.lockedCount} 封已排期锁定` : '当前无待同步邮件'}</small><button className="nmda-btn nmda-btn-primary" type="button" disabled={!template.changed || !template.validation.valid} onClick={saveTemplate}>保存正文模板</button></div><div className="nmda-monitor-template-result"><strong>{!template.validation.valid ? '模板结构不规范' : template.changed ? (template.value ? '模板待保存' : '将清空模板') : template.saved ? '模板已生效' : '未设置模板'}</strong><span>{!template.validation.valid ? template.validation.reason : template.changed ? (template.value ? `保存后用于后续到期的跟进邮件；可同步 ${template.syncable.length} 封模板邮件。` : '之后不会再用模板生成新的跟进邮件；已经生成或已定时的邮件不受影响。') : template.saved ? '到期后直接在邮件监测中生成；称呼与署名从各自初始邮件继承。' : '设置后，到期联系人可直接在这里生成跟进邮件。'}</span></div></div></div></section></div>
      <footer className="nmda-workflow-dialog-foot"><span className="nmda-monitor-settings-footnote">即使暂不继续跟进，联系人回复状态仍会正常更新。</span><div className="nmda-dialog-foot-spacer"></div><button className="nmda-btn" type="button" onClick={close}>完成</button></footer>
    </section>
  </div>;
}

export default function Monitor() {
  const version = useSyncExternalStore(State.subscribe, State.getVersion);
  const [filter, setFilter] = useState('all'), [subfilter, setSubfilter] = useState('all');
  const [attempts, setAttempts] = useState('all'), [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [historyMonths, setHistoryMonths] = useState(Persistence.readHistoryMonths);
  const [syncing, setSyncing] = useState(false), [notice, setNotice] = useState({ text:'', tone:'' });
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsTab, setSettingsTab] = useState('policy');
  const filterRef = useRef(null), selectAllRef = useRef(null);
  const groups = useMemo(() => State.operations.loaded ? Operations.monitoringRoots(State.operations.store).map(group => ({ ...group, viewState:Domain.monitorGroupState(group) })) : [], [version]);
  const summary = useMemo(() => Domain.monitorSummary(groups), [groups]);
  const policy = State.operations.store.followUpPolicies?.default || Operations.DEFAULT_FOLLOWUP_POLICY;
  const sync = State.operations.store.mailboxSync || {};
  const currentSelected = useMemo(() => { const valid = new Set(groups.filter(Domain.monitorCreatable).map(item => item.rootTaskId)); return new Set([...selected].filter(id => valid.has(id))); }, [groups, selected]);
  const query = search.toLocaleLowerCase('zh-CN').trim();
  const visible = groups.filter(item => {
    if (!Domain.monitorMatchesQueue(item, filter) || !Domain.monitorMatchesSubfilter(item, subfilter) || !Domain.monitorMatchesAttempts(item, attempts)) return false;
    if (!query) return true;
    const identity = Domain.monitorContactIdentity(item);
    const replies = (item.replies || []).map(reply => `${reply?.sender || ''} ${Domain.monitorDisplayReplySubject(reply?.subject || '')}`).join(' ');
    const hay = [identity.name, identity.email, item.lastOutbound?.subject, item.viewState?.label, item.viewState?.detail, replies].join(' ').toLocaleLowerCase('zh-CN');
    return query.split(/\s+/).every(token => hay.includes(token));
  });
  const visibleCreatable = visible.filter(Domain.monitorCreatable);
  const selectedVisible = visibleCreatable.filter(item => currentSelected.has(item.rootTaskId)).length;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = selectedVisible > 0 && selectedVisible < visibleCreatable.length; }, [selectedVisible, visibleCreatable.length]);
  useEffect(() => { const reset = () => { setFilter('all'); setSubfilter('all'); setAttempts('all'); setSearch(''); void State.ensureOperations().catch(error => setNotice({ text:error?.message || String(error), tone:'error' })); }; window.addEventListener('nmda:monitor-open', reset); return () => window.removeEventListener('nmda:monitor-open', reset); }, []);
  useEffect(() => { const reset = () => { setFilter('all'); setSubfilter('all'); setAttempts('all'); setSearch(''); setSelected(new Set()); setNotice({ text:'', tone:'' }); setHistoryMonths(0); setSettingsOpen(false); }; window.addEventListener('nmda:monitor-reset', reset); return () => window.removeEventListener('nmda:monitor-reset', reset); }, []);
  useEffect(() => { const inform = event => setNotice(event.detail || { text:'', tone:'' }); window.addEventListener('nmda:monitor-notice', inform); return () => window.removeEventListener('nmda:monitor-notice', inform); }, []);
  const inform = (text, tone = '') => setNotice({ text, tone });
  const chooseFilter = (next, sub = 'all', clear = false, scroll = false) => { setFilter(next); setSubfilter(sub); setAttempts('all'); if (clear) setSearch(''); if (scroll) requestAnimationFrame(() => filterRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })); };
  const runSync = async (mode, months = historyMonths) => {
    if (syncing) return;
    setSyncing(true);
    const range = months ? `最近 ${months} 个月` : '全部历史';
    inform(mode === 'full' ? `正在重新核对${range}的联系人状态…` : `正在更新${range}的联系人状态…`);
    try { const result = await FollowUp.syncMailbox(mode); inform(`联系人状态已更新：已联系 ${result.total} 位 · 已回复 ${result.replied} 位 · 需要跟进 ${result.due} 位 · 已跟进 ${result.followUps} 次。`, 'ok'); window.dispatchEvent(new Event('nmda:followup-updated')); }
    catch (error) { inform(`联系人状态更新失败：${error?.message || String(error)}`, 'error'); }
    finally { setSyncing(false); }
  };
  const changeHistory = async months => { const value = Persistence.writeHistoryMonths(months); setHistoryMonths(value); MailboxSync.invalidate(); inform(value ? `监测范围已改为最近 ${value} 个月；正在重新汇总联系人状态。` : '监测范围已改为全部历史；正在重新汇总联系人状态。'); await runSync('full', value); };
  const toggleSelected = (id, checked) => setSelected(previous => { const next = new Set(previous); checked ? next.add(id) : next.delete(id); return next; });
  const openMail = async (messageId, fid) => { try { const result = messageId ? await Runtime.openMessage(messageId, fid) : await Runtime.openMail(true); if (!result?.ok) inform(result?.reason || '无法打开网易邮箱中的回复，请先确认邮箱已登录。', 'error'); } catch (error) { inform(error?.message || String(error), 'error'); } };
  const act = async (action, id, value) => {
    if (action === 'dispatch' || action === 'review') { window.dispatchEvent(new CustomEvent('nmda:monitor-navigate', { detail:{ action, id } })); return; }
    if (action === 'cancel' && !confirm(`取消跟进邮件 #${State.operations.store.derivedTasks?.[id]?.sequence}？已创建的网易草稿不会被自动删除。`)) return;
    try {
      if (action === 'cancel') { await FollowUp.cancelFollowUp(id); inform('本次跟进邮件已取消；如仍符合规则，可按当前模板重新生成。', 'ok'); }
      if (action === 'disposition') { await FollowUp.setReplyDisposition(id, value); inform('联系人回复状态已更新，并重新计算后续跟进。', 'ok'); }
      if (action === 'create' || action === 'manual') { const task = await FollowUp.createFollowUp(id, action === 'manual'); const auto = task.reviewDecision === 'auto' && task.dispatch?.queued === true; inform(auto ? `跟进邮件 #${task.sequence} 已按模板生成并完成审阅，已进入“安排发送”。` : `跟进邮件 #${task.sequence} 已按模板生成；检测到需要处理的内容，请到“审阅邮件”查看。`, auto ? 'ok' : 'warn'); }
      window.dispatchEvent(new Event('nmda:followup-updated'));
    } catch (error) { inform(error?.message || String(error), 'error'); }
  };
  const batchCreate = async () => {
    if (!currentSelected.size) { inform('请先选择需要跟进的联系人。', 'warn'); return; }
    try { inform(`正在准备 ${currentSelected.size} 位联系人的跟进内容…`); const result = await FollowUp.createFollowUps([...currentSelected]); setSelected(new Set()); const auto = result.created.filter(task => task.reviewDecision === 'auto' && task.dispatch?.queued === true).length; const review = result.created.length - auto; const reasons = [...new Set(result.skipped.map(item => item.reasonText || item.reason).filter(Boolean))]; inform(`已生成 ${result.created.length} 封跟进邮件 · ${auto} 封已就绪${review ? ` · ${review} 封需处理` : ''}${result.skipped.length ? `；${result.skipped.length} 个未生成${reasons.length ? `（${reasons.slice(0, 4).join('；')}${reasons.length > 4 ? '；…' : ''}）` : ''}` : ''}。`, result.created.length ? 'ok' : 'warn'); window.dispatchEvent(new Event('nmda:followup-updated')); }
    catch (error) { inform(`批量生成失败：${error?.message || String(error)}`, 'error'); }
  };
  const openSettings = tab => { setSettingsTab(tab); setSettingsOpen(true); };
  const templateSaved = String(policy.templateBody || '').trim();
  const templateReady = groups.some(group => group.eligibility?.eligible === true);
  const composeLabel = policy.composeMode === 'reply' ? '回复全部 · 保留附件' : policy.composeMode === 'new' ? '新建邮件' : '转发原邮件';
  const historyCopy = historyMonths ? `最近 ${historyMonths} 个月` : '全部历史';
  const lastSync = sync.lastQuickAt || sync.lastFullAt;
  return <div className="nmda-monitor-page nmda-utility-monitor-page">
    <div className="nmda-monitor-toolbar"><div className="nmda-monitor-toolbar-copy"><div><strong>联系人监测</strong><small>{lastSync ? `上次更新 ${Operations.formatDisplayTime(lastSync)} · ${historyCopy}` : `尚未更新联系人状态 · ${historyCopy}`}</small></div></div><div className="nmda-row nmda-wrap nmda-monitor-toolbar-actions"><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" disabled={syncing} onClick={() => runSync('quick')}>更新状态</button><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" disabled={syncing} onClick={() => { if (confirm(`将按“${historyCopy}”重新核对联系人历史、回复和后续安排，继续吗？`)) runSync('full'); }}>重新核对</button></div></div>
    <section className="nmda-contact-command-center" aria-label="联系人跟进状态"><div className="nmda-contact-status-tree"><header><div><small>联系人进展总览</small><strong>按联系人汇总当前进展</strong></div><span>历史邮件都会保留，这里只汇总每位联系人现在所处的阶段</span></header><div className="nmda-contact-tree-map"><div className="nmda-contact-tree-root"><span>已联系</span><strong>{summary.total}</strong><small>位联系人</small></div><span className="nmda-contact-tree-link" aria-hidden="true"></span><div className="nmda-contact-tree-branches"><button type="button" className="nmda-contact-tree-branch is-replied" onClick={() => chooseFilter('attention', 'replied', true, true)}><span>已有有效回复</span><strong>{summary.replied}</strong><small>转人工沟通</small></button><div className="nmda-contact-tree-unreplied"><div className="nmda-contact-tree-unreplied-head"><span>尚未有效回复</span><strong>{summary.unreplied}</strong></div><div className="nmda-contact-tree-outcomes">{[['attention','due','现在需要跟进',summary.due],['waiting','time','继续等待',summary.waiting],['waiting','scheduled','已安排发送',summary.scheduled],['complete','all','跟进已结束',summary.complete]].map(([next, sub, label, count]) => <button type="button" key={label} onClick={() => chooseFilter(next, sub, true, true)}><small>{label}</small><strong>{count}</strong></button>)}</div></div></div></div></div><div className="nmda-monitor-action-summary nmda-contact-action-summary"><button className="nmda-monitor-ready-card" type="button" disabled={!summary.due} data-state={summary.due ? 'ready' : 'clear'} onClick={() => chooseFilter('attention', 'due', true, true)}><span className="nmda-monitor-ready-mark" aria-hidden="true">↗</span><span className="nmda-monitor-ready-copy"><small>当前行动</small><strong>{summary.due ? `${summary.due} 位联系人现在需要跟进` : summary.replied ? '当前没有到期联系人' : '当前联系人都在等待中'}</strong><span>{summary.due ? `${summary.creatable} 位可直接准备跟进邮件${summary.prepared ? `，${summary.prepared} 位已生成、等待审阅或排期` : ''}。` : summary.scheduled ? `${summary.scheduled} 位已经安排后续发送；其余联系人继续按规则监测。` : '联系人会在达到等待间隔、且没有有效回复时自动进入“需要跟进”。'}</span></span><b>{summary.due ? `查看 ${summary.due} 位` : '无需操作'}</b></button><div className="nmda-monitor-stats">{[['已联系联系人',summary.total,'按收件邮箱归并',''],['已有回复',summary.replied,summary.total ? `约 ${Math.round(summary.replied / summary.total * 100)}%` : '暂无联系人','reply'],['需要跟进',summary.due,`${summary.creatable} 位可直接准备`,'due'],['已完成跟进',summary.followUps,'累计跟进次数','scheduled']].map(([label, count, detail, tone]) => <div className="nmda-monitor-stat" data-tone={tone} key={label}><span>{label}</span><strong>{count}</strong><small>{detail}</small></div>)}</div></div></section>
    <div className="nmda-monitor-controlstrip"><div className="nmda-monitor-setting-launchers" aria-label="跟进设置"><button className="nmda-monitor-setting-launch" type="button" onClick={() => openSettings('policy')}><span><small>跟进规则</small><strong>{`发送后 ${Math.max(0, Number(policy.delayDays ?? 7))} 天 · 最多 ${Math.max(0, Number(policy.maxAttempts ?? 2))} 次 · ${composeLabel}`}</strong></span><b>设置</b></button><button className={`nmda-monitor-setting-launch${templateReady && !templateSaved ? ' is-attention' : ''}`} type="button" onClick={() => openSettings('template')} aria-label={templateReady && !templateSaved ? '正文模板未设置；当前已有可跟进邮件' : '打开跟进邮件正文模板设置'}><span><small>正文模板</small><strong>{templateSaved ? '已设置 · 称呼与署名自动继承' : '未设置 · 到期前建议配置'}</strong></span><b>{templateSaved ? '已设置' : '未设置'}</b></button></div><label className="nmda-monitor-history-window" title="只统计所选时间范围内的联系人历史。"><span>监测范围</span><select value={historyMonths} disabled={syncing} onChange={event => changeHistory(event.target.value)}>{[0,3,6,9,12,18,24].map(value => <option value={value} key={value}>{value ? `最近 ${value} 个月` : '全部邮件'}</option>)}</select></label></div>
    <div className="nmda-monitor-filterbar nmda-monitor-work-views" ref={filterRef}><div className="nmda-monitor-filter-top"><div className="nmda-monitor-filter-label"><small>工作视图</small><strong>{({ all:'全部联系人', attention:'需要我处理', waiting:'等待中的联系人', complete:'本轮跟进已结束' })[filter]}</strong></div><div className="nmda-monitor-filters" role="group" aria-label="按当前工作状态查看联系人">{FILTERS.map(([key, label]) => <button type="button" className={filter === key ? 'is-active' : ''} key={key} onClick={() => chooseFilter(key)}><span>{label}</span><b>{groups.filter(item => Domain.monitorQueueFor(item) === key || key === 'all').length}</b></button>)}</div><div className="nmda-monitor-filter-tools"><label className="nmda-monitor-attempt-filter"><span>已跟进</span><select value={attempts} onChange={event => setAttempts(event.target.value)}><option value="all">不限次数</option><option value="0">0 次</option><option value="1">1 次</option><option value="2plus">2 次及以上</option></select></label><input className="nmda-monitor-search" type="search" placeholder="搜索联系人、邮箱或主题" value={search} onChange={event => setSearch(event.target.value)} /></div></div>{SUBFILTERS[filter] && <div className="nmda-monitor-subfilters" aria-label="细分当前工作视图"><span>{filter === 'attention' ? '待办类型' : '等待类型'}</span><div role="group"><button type="button" className={subfilter === 'all' ? 'is-active' : ''} onClick={() => setSubfilter('all')}>全部</button>{SUBFILTERS[filter].map(([key, label]) => <button type="button" className={subfilter === key ? 'is-active' : ''} key={key} onClick={() => setSubfilter(key)}>{label} <b>{groups.filter(item => Domain.monitorQueueFor(item) === filter && Domain.monitorMatchesSubfilter(item, key)).length}</b></button>)}</div></div>}</div>
    {groups.some(Domain.monitorCreatable) && <div className="nmda-monitor-bulkbar"><div className="nmda-monitor-bulk-copy"><strong>批量准备联系人跟进</strong><span>当前列表待跟进 {visibleCreatable.length} 位 · 已选择 {currentSelected.size} 位</span></div><label className="nmda-monitor-select-all"><input ref={selectAllRef} type="checkbox" checked={visibleCreatable.length > 0 && selectedVisible === visibleCreatable.length} disabled={!visibleCreatable.length} onChange={event => setSelected(previous => { const next = new Set(previous); visibleCreatable.forEach(item => event.target.checked ? next.add(item.rootTaskId) : next.delete(item.rootTaskId)); return next; })} /><span>选择当前列表中的待跟进联系人</span></label><div className="nmda-monitor-bulk-actions"><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => setSelected(new Set())}>清除选择</button><button className="nmda-btn nmda-btn-small nmda-btn-primary" type="button" disabled={!currentSelected.size} onClick={batchCreate}>准备已选跟进</button></div></div>}
    {notice.text && <div className="nmda-monitor-notice" data-tone={notice.tone}>{notice.text}</div>}
    <div className="nmda-monitor-list">{visible.length ? visible.map((group, index) => <ContactCard group={group} selected={currentSelected.has(group.rootTaskId)} toggleSelected={toggleSelected} act={act} openMail={openMail} key={group.rootTaskId || index} />) : <div className="nmda-monitor-empty"><div><strong>{groups.length ? '当前视图没有联系人' : '尚无已联系联系人'}</strong><small>{groups.length ? '切换工作视图、调整已跟进次数，或清空搜索。' : '连接网易邮箱并更新状态后，这里会按联系人邮箱汇总联系与跟进进度。'}</small></div></div>}</div>
    <Settings policy={policy} open={settingsOpen} initialTab={settingsTab} close={() => setSettingsOpen(false)} notice={inform} />
  </div>;
}
