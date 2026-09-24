import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const PlanningUi = globalThis.NMDAWorkspacePlanningUi;

function SourceBadge({ task }) {
  return task?.dispatchKind === 'follow_up'
    ? <span className="nmda-plan-minibadge nmda-plan-source-followup">跟进 #{Math.max(1, Number(task.sequence || 1))}</span>
    : <span className="nmda-plan-minibadge nmda-plan-source-initial">初始邮件</span>;
}

function OriginalMail({ origin }) {
  return <button className={`nmda-open-original-mail is-compact${origin.messageId ? '' : ' is-unavailable'}`} type="button" disabled={!origin.messageId} data-open-original-mail={origin.messageId || undefined} data-open-original-fid={origin.fid || 3} title={origin.messageId ? '在 163 邮箱打开此任务对应的原信件' : '该任务尚未在 163 中形成或匹配到原信件'}>163 原信件 ↗</button>;
}

function ScheduleField({ task, view, disabled }) {
  const locked = task.scheduleSource === 'mailbox' && !!task.mailboxDraftId;
  return <span className="nmda-smart-temporal is-task">
    <input key={`${task.editKey}:${task.scheduleAt || ''}`} type="datetime-local" step="300" data-smart-temporal="datetime" data-smart-role="task-schedule" data-task-schedule={task.editKey} defaultValue={view.scheduleDisplay} disabled={disabled || locked} title={locked ? `网易已有排期为只读 · ${view.zoneText} 当地时间` : `${view.zoneText} 当地时间`} />
    <button className="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open aria-label="快速调整发送时间" title="快速设置" disabled={disabled || locked}>⌄</button>
  </span>;
}

function TaskCard({ task, view, running }) {
  const toggleDisabled = running || task.policyBlocked || task.status === 'running' || task.status === 'done';
  return <article className="nmda-plan-matrix-task" data-plan-task-key={task.editKey} data-state-tone={view.state.tone} data-dispatch-kind={task.dispatchKind || 'initial'}>
    <label className="nmda-plan-matrix-toggle"><input key={`${task.editKey}:${!!task.enabled}`} type="checkbox" data-task-enabled={task.editKey} defaultChecked={!!task.enabled} disabled={toggleDisabled} /></label>
    <div className="nmda-plan-matrix-taskbody">
      <div className="nmda-plan-matrix-taskline"><strong>{task.recipients || '—'}</strong><span className={`nmda-inline-flag nmda-inline-flag-${view.state.tone}`}>{view.state.label}</span></div>
      <div className="nmda-plan-matrix-taskmeta"><SourceBadge task={task} />{task.scheduleSource === 'mailbox' && task.mailboxDraftId && <span className="nmda-plan-minibadge">已有排期 · 锁定</span>}{!!task.files?.length && <span className="nmda-plan-minibadge">附件 {task.files.length}</span>}<OriginalMail origin={view.origin} /></div>
      <div className="nmda-plan-matrix-taskedit"><ScheduleField task={task} view={view} disabled={running} /></div>
    </div>
  </article>;
}

function LooseTask({ task, view }) {
  return <article className="nmda-plan-loose-task" data-plan-task-key={task.editKey} data-dispatch-kind={task.dispatchKind || 'initial'}>
    <label><input key={`${task.editKey}:${!!task.enabled}`} type="checkbox" data-task-enabled={task.editKey} defaultChecked={!!task.enabled} /></label>
    <div><strong>{task.recipients || '—'}</strong><small><SourceBadge task={task} /> {view.school}</small><OriginalMail origin={view.origin} /></div>
    <span className={`nmda-inline-flag nmda-inline-flag-${view.state.tone}`}>{view.state.label}</span>
    <ScheduleField task={task} view={view} disabled={false} />
  </article>;
}

function RoundHeader({ round }) {
  return <div className="nmda-plan-matrix-colhead"><div className="nmda-plan-matrix-coltop"><em>发送日 {round.roundIndex}</em><strong>{round.dateLabel}</strong></div><small>{round.selectedCount}/{round.tasks.length} 封 · {round.schoolCount} 校</small><span className={`nmda-plan-matrix-colmeta${round.duplicateSchools.length ? ' is-warn' : ''}`}>{round.duplicateSchools.length ? `同校超额 ${round.duplicateSchools.length}` : '正常'}</span></div>;
}

function SchoolRow({ school, rounds, taskViews, running, maxPerGroupPerRound }) {
  return <>
    <div className="nmda-plan-matrix-rowhead"><strong>{school.label}</strong><div className="nmda-plan-schoolbadges"><span className="nmda-plan-schoolbadge">{school.totalCount} 封</span>{!!school.roundRefs.length && <span className="nmda-plan-schoolbadge">发送日 {school.roundRefs.join('/')}</span>}{!!school.overflowRounds.length && <span className="nmda-plan-schoolbadge is-warn">发送日超额 {school.overflowRounds.join('/')}</span>}</div></div>
    {rounds.map(round => {
      const tasks = school.cells.get(round.dayKey) || [];
      return <div className={`nmda-plan-matrix-cell${tasks.length > maxPerGroupPerRound ? ' is-overflow' : ''}`} key={round.dayKey}>{tasks.length ? <div className="nmda-plan-matrix-stack">{tasks.map(task => <TaskCard task={task} view={taskViews.get(task.editKey)} running={running} key={task.editKey} />)}</div> : <div className="nmda-plan-matrix-emptycell" aria-hidden="true"></div>}</div>;
    })}
  </>;
}

export default function PlanningBoard() {
  const { planning, taskViews, running, maxPerGroupPerRound } = useSyncExternalStore(PlanningUi.subscribe, PlanningUi.getSnapshot);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  useEffect(() => {
    const toggle = () => setShowUnscheduled(open => !open);
    window.addEventListener('nmda:planning-show-unscheduled', toggle);
    return () => window.removeEventListener('nmda:planning-show-unscheduled', toggle);
  }, []);
  if (!planning.schoolRows.length) return <div className="nmda-plan-empty">没有匹配的邮件。调整搜索条件后再试。</div>;
  return <>
    {!!planning.unscheduled.length && <section className="nmda-plan-unscheduled" id="nmda-unscheduled-exceptions" hidden={!showUnscheduled}><header><div><strong>尚未排期</strong><small>{planning.unscheduled.length} 封邮件缺少发送日期</small></div></header><div className="nmda-plan-unscheduled-list">{planning.unscheduled.map(task => <LooseTask task={task} view={taskViews.get(task.editKey)} key={task.editKey} />)}</div></section>}
    <div className="nmda-plan-matrix-wrap"><div className="nmda-plan-matrix" style={{gridTemplateColumns:`250px repeat(${Math.max(1, planning.rounds.length)}, minmax(210px, 1fr))`}}>
      <div className="nmda-plan-matrix-corner"><strong>学校</strong><small>每行一所学校；横向查看各轮分布</small></div>
      {planning.rounds.map(round => <RoundHeader round={round} key={round.dayKey} />)}
      {planning.schoolRows.map(school => <SchoolRow school={school} rounds={planning.rounds} taskViews={taskViews} running={running} maxPerGroupPerRound={maxPerGroupPerRound} key={school.key} />)}
    </div></div>
  </>;
}

export function PlanningOverview() {
  const {overview} = useSyncExternalStore(PlanningUi.subscribe, PlanningUi.getSnapshot);
  return <>
    <section className="nmda-plan-commandbar">
      <div className="nmda-plan-command-main"><strong>排期矩阵</strong><span>{overview.ruleSummary}</span></div>
      <div className="nmda-plan-command-stats">
        <span>学校 <strong>{overview.schools}</strong></span>
        <span>发送日 <strong>{overview.rounds}</strong></span>
        <span>本次 <strong>{overview.selected}</strong></span>
        {overview.showMailbox && <span>已有排期 <strong>{overview.lockedCount == null ? '—' : overview.lockedCount}</strong></span>}
        <span>可创建 <strong>{overview.ready}</strong></span>
        <span data-tone={overview.warnings.length ? 'warn' : 'ok'}>{overview.warnings.length ? overview.warnings.join(' · ') : '规则正常'}</span>
      </div>
    </section>
    {overview.unscheduled > 0 && <section className="nmda-time-plan-prompt"><span className="nmda-time-plan-prompt-step">下一步</span><div><strong>先设置时间安排，再进入网易执行</strong><span>{overview.unscheduled} 封还没有发送时间。只需设置一次地区、开始日期、工作日和当地时间，系统会自动安排到符合规则的发送日，所有自动任务保持你设定的同一当地时间。</span></div><button type="button" onClick={() => window.dispatchEvent(new Event('nmda:planning-open-schedule-guide'))}>设置时间安排</button><button type="button" className="is-secondary" onClick={() => window.dispatchEvent(new Event('nmda:planning-show-unscheduled'))}>查看未排期</button></section>}
  </>;
}

export function DispatchSummary() {
  const {summary} = useSyncExternalStore(PlanningUi.subscribe, PlanningUi.getSnapshot);
  const parts = [<span key="total">共 <strong>{summary.total}</strong> 封</span>, <span key="initial">初始 <strong>{summary.initial}</strong></span>, <span key="followup">跟进 <strong>{summary.followUp}</strong></span>, <span key="selected">本次 <strong>{summary.selectedTotal}</strong></span>, <span key="ready">可创建 <strong>{summary.ready}</strong></span>];
  if (summary.scheduled) parts.push(<span key="scheduled">定时 {summary.scheduled}</span>);
  if (summary.errors) parts.push(<span className="nmda-danger" key="errors">异常 {summary.errors}</span>);
  if (summary.done) parts.push(<span key="done">已完成 {summary.done}</span>);
  return <>{parts.map((part, index) => <span key={part.key}>{index > 0 && ' · '}{part}</span>)}</>;
}

export function ExecutionPreflight() {
  const {preflight} = useSyncExternalStore(PlanningUi.subscribe, PlanningUi.getSnapshot);
  const lastRisk = useRef('');
  const riskSignature = `${preflight.unscheduled}:${preflight.attachmentless}:${preflight.ready}`;
  const hasAlerts = !!(preflight.unscheduled || preflight.attachmentless);
  useEffect(() => {
    const handoff = document.getElementById('nmda-mail-handoff-bar');
    if (handoff) handoff.dataset.attention = hasAlerts ? 'true' : 'false';
    if (hasAlerts && lastRisk.current !== riskSignature && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('#nmda-create-preflight .nmda-execution-alert').forEach((element, index) => element.animate([
        {opacity:0,transform:'translateY(7px) scale(.985)',backgroundPosition:'100% 0'},
        {opacity:1,transform:'translateY(-1px) scale(1.002)',backgroundPosition:'38% 0',offset:.72},
        {opacity:1,transform:'translateY(0) scale(1)',backgroundPosition:'0% 0'}
      ], {duration:420,delay:index*65,easing:'cubic-bezier(.2,.78,.2,1)'}));
    }
    lastRisk.current = riskSignature;
  }, [hasAlerts, riskSignature]);
  return <><div className="nmda-preflight-facts"><span>{preflight.facts.map(fact => <em key={fact}>{fact}</em>)}</span><strong>执行时自动切到网易邮箱</strong>{!hasAlerts && <span className="nmda-execution-safe"><i></i>执行检查通过</span>}</div>
    {hasAlerts && <div className="nmda-execution-alerts">
      {!!preflight.unscheduled && <div className="nmda-execution-alert" data-risk="schedule"><span className="nmda-execution-alert-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.25"/><path d="M10 6.4v4l2.9 1.8"/></svg></span><div><strong>{preflight.unscheduled} 封未定时</strong><small>将保存为普通草稿，不会按计划自动发送</small></div><b>{preflight.unscheduled === preflight.ready ? '全部' : '检查'}</b></div>}
      {!!preflight.attachmentless && <div className="nmda-execution-alert" data-risk="attachment"><span className="nmda-execution-alert-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7.2 9.8 11 6a2.25 2.25 0 1 1 3.2 3.2l-5 5a3.25 3.25 0 0 1-4.6-4.6l5.25-5.25"/></svg></span><div><strong>{preflight.attachmentless} 封无附件</strong><small>{preflight.attachmentless === preflight.ready ? '当前所选邮件均不带附件，请确认这是预期' : '这些邮件未携带附件，执行前请确认'}</small></div><b>{preflight.attachmentless === preflight.ready ? '全部' : '检查'}</b></div>}
    </div>}</>;
}
