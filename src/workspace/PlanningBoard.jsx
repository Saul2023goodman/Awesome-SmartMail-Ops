import { useEffect, useState, useSyncExternalStore } from 'react';

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
