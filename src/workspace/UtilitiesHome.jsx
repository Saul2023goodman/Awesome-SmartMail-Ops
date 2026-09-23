import { useEffect, useState, useSyncExternalStore } from 'react';

const State = globalThis.NMDAWorkspaceState;
const Operations = globalThis.NMDAOperations;
const Domain = globalThis.NMDAMonitorDomain;

export default function UtilitiesHome() {
  useSyncExternalStore(State.subscribe, State.getVersion);
  const [draftSummary, setDraftSummary] = useState('读取草稿箱');
  useEffect(() => {
    const update = event => setDraftSummary(event.detail || '读取草稿箱');
    window.addEventListener('nmda:draft-attachment-summary', update);
    return () => window.removeEventListener('nmda:draft-attachment-summary', update);
  }, []);
  const groups = State.operations.loaded ? Operations.monitoringRoots(State.operations.store).map(group => ({ ...group, viewState:Domain.monitorGroupState(group) })) : [];
  const summary = Domain.monitorSummary(groups);
  const monitorMeta = summary.due ? `${summary.due} 位需跟进 · ${summary.replied} 位已回复` : summary.replied ? `${summary.replied} 位已回复 · ${summary.total} 位联系人` : `${summary.total} 位联系人`;
  const open = view => window.dispatchEvent(new CustomEvent('nmda:open-utility', { detail:view }));
  return <>
    <div className="nmda-utilities-intro"><div><span className="nmda-utilities-eyebrow">工具</span><h3>处理日常邮箱作业</h3><p>选择要处理的事项，完成后可随时返回邮件流程。</p></div><span className="nmda-utilities-count">2 项</span></div>
    <div className="nmda-utility-grid">
      <button className="nmda-utility-card is-live" type="button" onClick={() => open('monitor')}><span className="nmda-utility-card-icon" aria-hidden="true">M</span><span className="nmda-utility-card-main"><small>联系人跟进</small><strong>邮件监测</strong><span>按联系人查看回复、已安排邮件与跟进时间，并处理下一步。</span></span><span className="nmda-utility-card-foot"><b>{monitorMeta}</b><i>进入 →</i></span></button>
      <button className="nmda-utility-card is-live is-attachment-update" type="button" onClick={() => open('draft-attachments')}><span className="nmda-utility-card-icon" aria-hidden="true">A</span><span className="nmda-utility-card-main"><small>草稿附件更新</small><strong>极速附件</strong><span>一次替换多封草稿中的旧附件，同时保留邮件内容和原发送时间。</span></span><span className="nmda-utility-card-foot"><b>{draftSummary}</b><i>进入 →</i></span></button>
    </div>
  </>;
}
