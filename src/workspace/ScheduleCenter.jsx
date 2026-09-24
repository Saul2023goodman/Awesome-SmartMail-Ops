import { Fragment, useSyncExternalStore } from 'react';

const Schedule = globalThis.NMDAWorkspaceScheduleUi;
const send = action => window.dispatchEvent(new CustomEvent('nmda:schedule-ui-action',{detail:{action}}));

export function ScheduleGuide() {
  const {guide} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <div className="nmda-schedule-guide" id="nmda-schedule-guide" aria-label="时间安排步骤">
    <div className={`nmda-schedule-guide-step ${guide[0]}`.trim()} data-schedule-guide-step="1"><b>1</b><span><strong>确定发送窗口</strong><small>地区、开始日期、工作日、当地时间</small></span></div><i aria-hidden="true">→</i>
    <div className={`nmda-schedule-guide-step ${guide[1]}`.trim()} data-schedule-guide-step="2"><b>2</b><span><strong>按需设置保护</strong><small>同校间隔 / 限额、已有时间、假期与跳过区间</small></span></div><i aria-hidden="true">→</i>
    <div className={`nmda-schedule-guide-step ${guide[2]}`.trim()} data-schedule-guide-step="3"><b>3</b><span><strong>生成本批时间</strong><small>按规则安排日期，时间保持一致</small></span></div>
  </div>;
}

export function ScheduleSummary() {
  const {summary} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <div className="nmda-schedule-dialog-summary" id="nmda-schedule-summary">
    <strong>{summary.selected} 封</strong>参与本次安排 · <span>{summary.unscheduled} 封待生成时间</span> · <span>{summary.protected} 封已有时间</span>
    {summary.showExternal && <> · <span>网易已有排期 {summary.external} 封</span></>}
    {summary.conflicts.map((item,index) => <Fragment key={`${item.label}-${index}`}> · <span className="nmda-danger">{item.label} {item.count}</span></Fragment>)}
  </div>;
}

export function ScheduleOutcome() {
  const {outcome} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <div className="nmda-schedule-outcome" id="nmda-schedule-outcome" data-tone={outcome.tone} aria-live="polite">
    <div className="nmda-schedule-outcome-mark">{outcome.marker}</div><div><span>{outcome.lead}</span><strong>{outcome.headline}</strong><small>{outcome.detail}</small></div>
  </div>;
}

export function SchedulePriority() {
  const schedule = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <div className="nmda-schedule-priority-card" id="nmda-schedule-priority-card">
    <div className="nmda-schedule-priority-copy"><span>可选约束</span><strong>同校优先级</strong><small id="nmda-schedule-priority-summary">{schedule.prioritySummary}</small></div>
    <button className="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-schedule-open-priority" type="button" disabled={schedule.priorityDisabled} title={schedule.priorityTitle} onClick={() => send('open-priority')}>{schedule.priorityLabel}</button>
  </div>;
}

export function ScheduleRulePreview() {
  const {rulePreview} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <div className="nmda-schedule-rule-preview" id="nmda-schedule-rule-preview">{rulePreview}</div>;
}

export function ScheduleClear() {
  const {clearDisabled,locked} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <button className="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-auto-schedule" type="button" disabled={clearDisabled||locked} onClick={() => send('clear')}>清除自动时间</button>;
}

export function ScheduleApply() {
  const {applyDisabled,applyLabel,applyHint,locked} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  return <button className="nmda-btn nmda-btn-primary nmda-btn-small nmda-schedule-apply" id="nmda-apply-schedule" type="button" disabled={applyDisabled||locked} onClick={() => send('apply')}><span>{applyLabel}</span><small id="nmda-apply-schedule-hint">{applyHint}</small></button>;
}
