import { useEffect, useState, useSyncExternalStore } from 'react';

const Schedule = globalThis.NMDAWorkspaceScheduleUi;
const WEEKDAYS = [[1,'周一'],[2,'周二'],[3,'周三'],[4,'周四'],[5,'周五']];
const send = (name,value) => window.dispatchEvent(new CustomEvent('nmda:schedule-ui-action',{detail:{action:'control-change',name,value}}));

function SmartDate({name,inputId,label,value,role,ariaLabel,locked}) {
  return <span className="nmda-smart-temporal"><input id={`nmda-rule-${inputId}`} type="date" disabled={locked} data-smart-temporal="date" data-smart-role={role} aria-label={ariaLabel} value={value} onChange={event => send(name,event.target.value)} /><button className="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open disabled={locked} aria-label={`快速设置${label}`} title="快速设置">⌄</button></span>;
}

function SmartNumber({name,inputId,value,min,max,step,locked}) {
  const [draft,setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)),[value]);
  const commit = () => {if(String(draft)!==String(value))send(name,draft);};
  return <input id={`nmda-rule-${inputId}`} type="number" min={min} max={max} step={step} value={draft} disabled={locked} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {if(event.key==='Enter')event.currentTarget.blur();}} />;
}

function RuleCheckbox({name,id,checked,children,className='',locked}) {
  return <label className={`nmda-check-card ${className}`.trim()}><input id={`nmda-rule-${id}`} type="checkbox" checked={checked} disabled={locked} onChange={event => send(name,event.target.checked)} /><span>{children}</span></label>;
}

export default function ScheduleControls() {
  const {controls,locked} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  const weekdays = new Set(controls.weekdays.map(Number));
  return <>
    <div className="nmda-schedule-section-title"><span>1</span><div><strong>发送窗口</strong><small>这四项决定“从什么时候开始、在哪些日子、按哪里的几点发送”。</small></div></div>
    <label className="nmda-field nmda-schedule-region-field"><span className="nmda-label">收件人地区 · Local time <em>关键</em></span><select id="nmda-rule-time-zone" value={controls.timeZone} disabled={locked} onChange={event => send('timeZone',event.target.value)}>
      <option value="system">本机 / 网易当前时区</option><option value="Asia/Shanghai">中国 · 上海</option><option value="Asia/Hong_Kong">中国香港</option><option value="Asia/Singapore">新加坡</option><option value="Asia/Kuala_Lumpur">马来西亚 · 吉隆坡</option><option value="Australia/Sydney">澳大利亚 · Sydney / Melbourne</option><option value="Australia/Brisbane">澳大利亚 · Brisbane</option><option value="Australia/Adelaide">澳大利亚 · Adelaide</option><option value="Australia/Perth">澳大利亚 · Perth</option><option value="Pacific/Auckland">新西兰 · Auckland</option><option value="Europe/London">英国 · London</option><option value="America/New_York">美国 / 加拿大 · Eastern</option><option value="America/Chicago">美国 · Central</option><option value="America/Denver">美国 · Mountain</option><option value="America/Los_Angeles">美国 / 加拿大 · Pacific</option><option value="America/Toronto">加拿大 · Toronto</option><option value="America/Vancouver">加拿大 · Vancouver</option>
    </select><small className="nmda-field-hint">选择收件人所在地区。你填写的是当地时间，执行时会自动换算到网易当前时区。</small></label>
    <label className="nmda-field"><span className="nmda-label">开始日期 <em>关键</em></span><SmartDate name="startDate" inputId="start-date" label="开始日期" value={controls.startDate} role="schedule-start" locked={locked} /></label>
    <label className="nmda-field"><span className="nmda-label">当地发送时间 <em>关键</em></span><span className="nmda-smart-temporal"><input id="nmda-rule-local-time" type="time" step="300" value={controls.localTime} disabled={locked} data-smart-temporal="time" data-smart-role="schedule-time" onChange={event => send('localTime',event.target.value)} /><button className="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open disabled={locked} aria-label="快速设置发送时间" title="快速设置">⌄</button></span></label>
    <label className="nmda-field"><span className="nmda-label">每校同一天最多联系</span><SmartNumber name="maxPerGroupPerRound" inputId="max-school" value={controls.maxPerGroupPerRound} min="1" max="20" step="1" locked={locked} /><small className="nmda-field-hint">建议保持 1；用于避免同一学校同一天集中联系多人。</small></label>
    <label className="nmda-field"><span className="nmda-label">同校联系至少间隔</span><div className="nmda-smart-duration"><SmartNumber name="sameGroupIntervalDays" inputId="school-interval" value={controls.sameGroupIntervalDays} min="0" max="365" step="1" locked={locked} /><b>天</b></div><small className="nmda-field-hint">只约束同一学校；例如 7 天表示同校两次联系至少相隔 7 个自然日。不同学校仍可在同一天、同一时间发送。</small></label>
    <div className="nmda-field nmda-workday-field"><span className="nmda-label">发送工作日 <em>关键</em></span><div className="nmda-workday-picker" role="group" aria-label="选择发送工作日">{WEEKDAYS.map(([day,label]) => <label key={day}><input type="checkbox" data-schedule-weekday value={day} checked={weekdays.has(day)} disabled={locked} onChange={event => {const next=new Set(weekdays);if(event.target.checked)next.add(day);else next.delete(day);send('weekdays',[...next].sort((a,b)=>a-b));}} /><span>{label}</span></label>)}</div><small className="nmda-field-hint">系统只会把新邮件放到这些工作日；例如只选周四，就会按每个可用周四向后排。</small></div>
    <div className="nmda-schedule-section-title nmda-schedule-section-title-secondary"><span>2</span><div><strong>避让与保护</strong><small>通常保持默认即可；只有遇到假期、已有排期或特殊空档时再调整。</small></div></div>
    <div className="nmda-field nmda-skip-range-field"><span className="nmda-label">不发送的日期范围 · 可选</span><div className="nmda-skip-range-inputs"><SmartDate name="skipStart" inputId="skip-start" label="跳过开始日期" value={controls.skipStart} role="skip-start" ariaLabel="跳过开始日期" locked={locked} /><span>至</span><SmartDate name="skipEnd" inputId="skip-end" label="跳过结束日期" value={controls.skipEnd} role="skip-end" ariaLabel="跳过结束日期" locked={locked} /></div><small className="nmda-field-hint">例如学校假期、圣诞节或你明确不希望发送的一段时间；留空即不额外跳过。</small></div>
    <RuleCheckbox name="preserveExisting" id="preserve-existing" checked={controls.preserveExisting} locked={locked}><strong>保留已经手工设置的时间</strong><small>重排时不覆盖你已经明确指定的单封时间。</small></RuleCheckbox>
    <RuleCheckbox name="includeMailboxScheduled" id="include-mailbox-scheduled" checked={controls.includeMailboxScheduled} locked={locked}><strong>避开网易里已经定时的邮件</strong><small>读取现有定时草稿，只用于同校日期间隔 / 当日限额校验；不同学校同一分钟可同时排期。</small></RuleCheckbox>
    <RuleCheckbox name="skipHolidays" id="skip-holidays" checked={controls.skipHolidays} className="nmda-schedule-wide-check" locked={locked}><strong>避开可识别的当地节假日</strong><small>按收件人地区尽量跳过可识别的公共假期。</small></RuleCheckbox>
  </>;
}
