import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

const State = globalThis.NMDAWorkspaceState;
const Domain = globalThis.NMDAMonitorDomain;
const Operations = globalThis.NMDAOperations;
const Persistence = globalThis.NMDAWorkspacePersistence;
const MailboxSync = globalThis.NMDAWorkspaceMailboxSync;
const Runtime = globalThis.NMDAWorkspaceRuntime;

const schoolFor = contact => String(contact?.school || '').trim() || '其他联系人';
const dateLabel = value => {
  const ms = Operations.timeMs(value);
  return ms ? new Date(ms).toLocaleDateString('zh-CN', { month:'numeric', day:'numeric' }) : '—';
};
const contactLabel = (contact, index, mode) =>
  String(contact?.name || '').trim() || (mode === 'student' ? `联系人 ${String(index + 1).padStart(2, '0')}` : contact?.email || '未知联系人');

function Empty({ title, detail }) {
  return <div className="nmda-dashboard-empty"><div><strong>{title}</strong><span>{detail}</span></div></div>;
}

function Opportunities({ snapshot, mode, openMail }) {
  const ranked = [...snapshot.signals].filter(item => item.replies.length).sort((a, b) => {
    const score = item => (item.strong ? 140 : item.active ? 100 : 60) + item.replies.length * 7 + item.followUps * 2 + (item.lastAt ? Math.min(15, Math.floor(item.lastAt / 86400000) % 16) : 0);
    return score(b) - score(a) || b.lastAt - a.lastAt;
  });
  return <article className="nmda-dashboard-panel nmda-dashboard-opportunities">
    <header className="nmda-dashboard-panel-head"><div><small>HIGH-SIGNAL CONTACTS</small><strong>正在形成的沟通</strong><span>把少数已经出现真实往来的联系人放在最前面。</span></div><b>{snapshot.active ? `${snapshot.active} 持续往来` : `${snapshot.human} 真人回复`}</b></header>
    <div className="nmda-dashboard-opportunity-list">
      {ranked.length ? ranked.slice(0, 6).map((contact, index) => {
        const latestReply = contact.replies.at(-1) || null;
        const identity = contactLabel(contact, index, mode);
        const school = schoolFor(contact);
        const messageId = String(latestReply?.providerMessageId || contact.group?.lastOutbound?.providerMessageId || '').trim();
        return <article className="nmda-dashboard-opportunity" data-rank={contact.strong ? 'strong' : 'normal'} key={contact.email || index}>
          <span className="nmda-dashboard-opportunity-avatar" aria-hidden="true">{(identity || '@').charAt(0).toUpperCase()}</span>
          <div className="nmda-dashboard-opportunity-main"><div className="nmda-dashboard-opportunity-title"><strong>{identity}</strong><span>{contact.strong ? '多轮往来' : contact.active ? '已转人工沟通' : '真人回复'}</span></div>
            <small data-private="1">{mode === 'student' ? school : [school, contact.email].filter(Boolean).join(' · ')}</small>
            <div className="nmda-dashboard-opportunity-facts"><span><b>{contact.group?.outbounds?.length || 0}</b> 次触达</span><span><b>{contact.replies.length}</b> 次真人回复</span><span>最近 {dateLabel(latestReply?.receivedAt || contact.group?.lastOutbound?.sentAt || '')}</span></div>
          </div>
          {messageId && mode === 'operator' && <button className="nmda-dashboard-open-mail" type="button" onClick={() => openMail(messageId, latestReply ? 1 : 3)} title="在 163 打开最近相关邮件">↗</button>}
        </article>;
      }) : <Empty title="当前尚未出现真人回复" detail="这不会被标记为失败。看板继续保留履约与持续跟进记录，出现真实沟通后会自动置顶。" />}
    </div>
    <div className="nmda-dashboard-signal-ladder" aria-label="沟通信号层级"><span><small>真人回复</small><strong>{snapshot.human}</strong></span><i>→</i><span><small>转人工沟通</small><strong>{snapshot.active}</strong></span><i>→</i><span className="is-strong"><small>多轮往来</small><strong>{snapshot.strong}</strong></span></div>
  </article>;
}

function ContactField({ snapshot, mode }) {
  const groups = new Map();
  for (const contact of snapshot.contacts) {
    const school = schoolFor(contact);
    if (!groups.has(school)) groups.set(school, []);
    groups.get(school).push(contact);
  }
  const signal = list => list.reduce((n, item) => n + (item.strong ? 9 : item.active ? 7 : item.replies?.length ? 5 : item.followUps ? 2 : 0), 0);
  const ordered = [...groups.entries()].sort((a, b) => signal(b[1]) - signal(a[1]) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const levelOrder = { strong:5, active:4, reply:3, followup:2, base:1, planned:0 };
  return <article className="nmda-dashboard-panel nmda-dashboard-field-panel">
    <header className="nmda-dashboard-panel-head"><div><small>OUTREACH FIELD</small><strong>目标联系场</strong><span>{snapshot.plannedMode ? '每个点是一位当前目标联系人；空心点尚未形成已发送事实，信号越明确视觉权重越高。' : '每个点是一位已联系联系人；持续跟进、真人回复与往来深度逐级增强。'}</span></div>
      <div className="nmda-dashboard-field-legend" aria-label="联系人状态图例"><span><i data-level="base"></i>已触达</span><span><i data-level="followup"></i>已跟进</span><span><i data-level="reply"></i>真人回复</span><span><i data-level="active"></i>持续往来</span></div>
    </header>
    <div className="nmda-dashboard-field">
      {ordered.length ? ordered.map(([school, contacts]) => <section className="nmda-dashboard-field-group" key={school}>
        <header><strong title={school}>{school}</strong><span>{contacts.length}</span></header>
        <div className="nmda-dashboard-dots">{[...contacts].sort((a, b) => levelOrder[b.level] - levelOrder[a.level]).map((contact, index) => {
          const label = contactLabel(contact, index, mode);
          const status = contact.level === 'strong' ? '多轮往来' : contact.level === 'active' ? '持续往来' : contact.level === 'reply' ? '真人回复' : contact.level === 'followup' ? `已跟进 ${contact.followUps} 次` : contact.level === 'planned' ? '目标池 · 尚无已发送事实' : '已触达';
          const tip = mode === 'student' ? `${label} · ${status}` : `${label}${contact.email && label !== contact.email ? ` · ${contact.email}` : ''} · ${status}`;
          return <button className="nmda-dashboard-dot" type="button" data-level={contact.level} aria-label={tip} key={contact.email || index}></button>;
        })}</div>
      </section>) : <Empty title="暂无联系人事实" detail="导入目标名单或连接网易邮箱后，这里会形成联系人级联系场。" />}
    </div>
  </article>;
}

function trajectorySeries(snapshot) {
  const firstContacts = snapshot.groups.map(group => ({ at:Operations.timeMs(group?.outbounds?.[0]?.sentAt || group?.lastOutbound?.sentAt || ''), group })).filter(item => item.at).sort((a, b) => a.at - b.at);
  const followEvents = [], replyEvents = [];
  for (const group of snapshot.groups) {
    for (const outbound of group?.outbounds || []) if (Math.max(0, Number(outbound?.effectiveSequence ?? outbound?.sequence ?? 0)) > 0) {
      const at = Operations.timeMs(outbound.sentAt); if (at) followEvents.push(at);
    }
    for (const reply of Domain.dashboardHumanReplies(group)) {
      const at = Operations.timeMs(reply.receivedAt); if (at) replyEvents.push(at);
    }
  }
  const all = [...firstContacts.map(item => item.at), ...followEvents, ...replyEvents].filter(Boolean).sort((a, b) => a - b);
  return { firstContacts, followEvents, replyEvents, min:all[0] || 0, max:all.at(-1) || 0 };
}

function Trajectory({ snapshot }) {
  const gradientId = 'nmdaDashArea';
  const series = trajectorySeries(snapshot);
  let chart = <Empty title="暂无履约轨迹" detail="读取已发送邮件后，这里按首次触达累计呈现执行过程。" />;
  let range = '—';
  if (series.firstContacts.length) {
    const W = 620, H = 112, pad = { l:28, r:12, t:11, b:20 };
    const min = series.min, max = Math.max(series.max, min + 86400000), maxY = Math.max(1, series.firstContacts.length);
    const x = ms => pad.l + (ms - min) / (max - min) * (W - pad.l - pad.r);
    const y = n => H - pad.b - n / maxY * (H - pad.t - pad.b);
    let d = `M ${x(series.firstContacts[0].at).toFixed(1)} ${y(0).toFixed(1)}`;
    let count = 0;
    for (const item of series.firstContacts) { d += ` H ${x(item.at).toFixed(1)}`; d += ` V ${y(++count).toFixed(1)}`; }
    d += ` H ${(W - pad.r).toFixed(1)}`;
    const area = `${d} V ${H - pad.b} H ${pad.l} Z`;
    const compact = (values, limit = 80) => values.length <= limit ? values : values.filter((_, i) => i % Math.ceil(values.length / limit) === 0);
    range = `${dateLabel(min)} → ${dateLabel(max)}`;
    chart = <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="累计联系人触达轨迹">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7890ad" stopOpacity=".16" /><stop offset="1" stopColor="#7890ad" stopOpacity=".015" /></linearGradient></defs>
      {[.25, .5, .75, 1].map(fr => <line className="nmda-dashboard-chart-grid" x1={pad.l} x2={W - pad.r} y1={y(maxY * fr)} y2={y(maxY * fr)} key={fr} />)}
      <path className="nmda-dashboard-chart-area" d={area} /><path className="nmda-dashboard-chart-line" d={d} />
      {compact(series.followEvents).map((ms, i) => <line className="nmda-dashboard-chart-follow" x1={x(ms)} x2={x(ms)} y1={H - pad.b + 1} y2={H - pad.b + 7} key={`f${i}`} />)}
      {compact(series.replyEvents, 28).map((ms, i) => <circle className="nmda-dashboard-chart-reply" cx={x(ms)} cy={y(series.firstContacts.filter(item => item.at <= ms).length)} r="2.6" key={`r${i}`} />)}
      <circle className="nmda-dashboard-chart-dot" cx={W - pad.r} cy={y(maxY)} r="3.2" /><text className="nmda-dashboard-chart-value" x={W - pad.r - 2} y={Math.max(9, y(maxY) - 6)} textAnchor="end">{maxY} 位</text>
      <text className="nmda-dashboard-chart-label" x={pad.l} y={H - 4}>{dateLabel(min)}</text><text className="nmda-dashboard-chart-label" x={W - pad.r} y={H - 4} textAnchor="end">{dateLabel(max)}</text>
    </svg>;
  }
  return <article className="nmda-dashboard-panel nmda-dashboard-trajectory-panel"><header className="nmda-dashboard-panel-head is-compact"><div><small>DELIVERY TRAJECTORY</small><strong>履约轨迹</strong><span>累计触达是主线，持续跟进与真人回复作为过程证据。</span></div><b>{range}</b></header><div className="nmda-dashboard-trajectory">{chart}</div></article>;
}

function Depth({ snapshot }) {
  const rows = [['首次触达', snapshot.reachedCount], ['≥ 1 次跟进', snapshot.signals.filter(item => item.followUps >= 1).length], ['≥ 2 次跟进', snapshot.signals.filter(item => item.followUps >= 2).length]];
  const max = Math.max(1, ...rows.map(row => row[1]));
  const policy = snapshot.policy || {};
  const result = snapshot.activeAfterFollowUp > 0 ? <>其中 <strong>{snapshot.activeAfterFollowUp}</strong> 段持续往来的首次真人回复发生在跟进之后。</>
    : snapshot.followUpEmergence > 0 ? <>已有 <strong>{snapshot.followUpEmergence}</strong> 位联系人的首次真人回复出现在跟进之后。</>
    : snapshot.followedUp ? <>已有 <strong>{snapshot.followedUp}</strong> 位联系人完成至少一次跟进；继续按既定规则观察。</> : '当前尚未进入跟进阶段。';
  return <article className="nmda-dashboard-panel nmda-dashboard-persistence-panel"><header className="nmda-dashboard-panel-head is-compact"><div><small>OUTREACH DEPTH</small><strong>争取深度</strong><span>不以低回复率定义表现，只呈现实际完成的触达层次。</span></div></header>
    <div className="nmda-dashboard-depth">{rows.map(([label, value]) => <div className="nmda-dashboard-depth-row" key={label}><span>{label}</span><div className="nmda-dashboard-depth-track"><i style={{ width:`${Math.max(0, Math.min(100, value / max * 100)).toFixed(1)}%` }}></i></div><b>{value}</b></div>)}</div>
    <div className="nmda-dashboard-evidence" data-tone={snapshot.activeAfterFollowUp || snapshot.followUpEmergence ? 'signal' : ''}>当前策略：首次 / 上次发送后等待 <strong>{Math.max(0, Number(policy.delayDays ?? 7))} 天</strong>，无有效回复时最多继续 <strong>{Math.max(0, Number(policy.maxAttempts ?? 2))} 次</strong>跟进。 {result}</div>
  </article>;
}

export default function Dashboard() {
  const version = useSyncExternalStore(State.subscribe, State.getVersion);
  const [mode, setMode] = useState(Persistence.readDashboardMode);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const snapshot = useMemo(() => State.operations.loaded ? Domain.dashboardSnapshot() : null, [version]);
  useEffect(() => { void State.ensureOperations().catch(reason => setError(reason?.message || String(reason))); }, []);
  const changeMode = next => { setMode(next); Persistence.writeDashboardMode(next); };
  const refresh = async () => {
    setRefreshing(true); setError('');
    try { await State.ensureOperations(); await MailboxSync.request('quick', { force:true, source:'tab:dashboard' }); }
    catch (reason) { setError(reason?.message || String(reason)); }
    finally { setRefreshing(false); }
  };
  const openMail = async (messageId, fid) => {
    try {
      const result = await Runtime.openMessage(messageId, fid);
      if (!result?.ok) setError(`无法打开 163 原信件：${result?.reason || '未知错误'}`);
    } catch (reason) { setError(`无法打开 163 原信件：${reason?.message || String(reason)}`); }
  };
  if (!snapshot) return <div className="nmda-dashboard-shell"><Empty title="正在汇总当前目标池" detail={error || '正在读取工作台状态'} /></div>;
  const delivery = snapshot.mailboxKnown ? (snapshot.plannedMode ? `${snapshot.reachedCount} / ${snapshot.plannedCount}` : snapshot.reachedCount) : (snapshot.plannedMode ? `— / ${snapshot.plannedCount}` : '—');
  const institution = snapshot.schoolCount ? (snapshot.mailboxKnown ? `${snapshot.reachedSchoolCount} / ${snapshot.schoolCount}` : `— / ${snapshot.schoolCount}`) : snapshot.reachedSchoolCount || '—';
  return <div className="nmda-dashboard-shell" data-dashboard-mode={mode}>
    <header className="nmda-dashboard-head"><div className="nmda-dashboard-heading"><span className="nmda-dashboard-eyebrow">OUTREACH PERFORMANCE</span><div><h2>{mode === 'student' ? '阶段外联成果' : '成效看板'}</h2><p>{mode === 'student' ? '阶段成果以实际触达、持续争取和真实往来为主，不以低基率回复制造成败判断。' : '以联系人为主键核对履约、跟进深度与人工往来；自动回复不计入成果。'}</p></div></div>
      <div className="nmda-dashboard-actions"><div className="nmda-dashboard-mode" role="group" aria-label="看板视图"><button type="button" data-dashboard-mode="operator" className={mode === 'operator' ? 'is-active' : ''} onClick={() => changeMode('operator')}>Operator</button><button type="button" data-dashboard-mode="student" className={mode === 'student' ? 'is-active' : ''} onClick={() => changeMode('student')}>学生展示</button></div><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={refresh} disabled={refreshing}>{refreshing ? '正在更新…' : '更新邮箱事实'}</button></div>
    </header>
    {error && <p role="alert">{error}</p>}
    <section className="nmda-dashboard-kpis" aria-label="履约与成效摘要">
      <article className="nmda-dashboard-kpi is-delivery"><div><small>CONTACT DELIVERY</small><span>目标触达</span></div><strong>{delivery}</strong><p>{snapshot.plannedMode ? (snapshot.mailboxKnown ? `当前目标池已完成 ${snapshot.reachedCount} 位实际触达` : '目标池已载入；更新邮箱后核对实际触达') : (snapshot.mailboxKnown ? '按邮箱事实统计唯一联系人' : '更新邮箱后读取实际触达')}</p><div className="nmda-dashboard-progress"><i style={{ width:snapshot.mailboxKnown && snapshot.plannedCount ? `${Math.min(100, snapshot.reachedCount / snapshot.plannedCount * 100).toFixed(1)}%` : '0%' }}></i></div></article>
      <article className="nmda-dashboard-kpi"><div><small>INSTITUTION BREADTH</small><span>院校覆盖</span></div><strong>{institution}</strong><p>{snapshot.schoolCount ? '按当前目标资料识别的院校覆盖' : '当前资料未提供稳定院校字段'}</p></article>
      <article className="nmda-dashboard-kpi"><div><small>PERSISTENCE</small><span>持续争取</span></div><strong>{snapshot.mailboxKnown ? snapshot.followedUp : '—'}</strong><p>{snapshot.mailboxKnown ? `${snapshot.signals.filter(item => item.followUps >= 2).length} 位已完成两次及以上争取` : '更新邮箱后统计跟进深度'}</p></article>
      <article className="nmda-dashboard-kpi is-signal"><div><small>ACTIVE CONVERSATIONS</small><span>持续往来</span></div><strong>{snapshot.mailboxKnown ? snapshot.active : '—'}</strong><p>{snapshot.mailboxKnown ? (snapshot.strong ? `${snapshot.strong} 位已出现多轮真人往来` : `另有 ${snapshot.human} 位出现真人回复`) : '更新邮箱后识别持续往来'}</p></article>
    </section>
    <section className="nmda-dashboard-core"><Opportunities snapshot={snapshot} mode={mode} openMail={openMail} /><ContactField snapshot={snapshot} mode={mode} /></section>
    <section className="nmda-dashboard-lower"><Trajectory snapshot={snapshot} /><Depth snapshot={snapshot} /></section>
  </div>;
}
