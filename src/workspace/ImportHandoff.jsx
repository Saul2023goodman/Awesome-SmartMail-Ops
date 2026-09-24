import { useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;

export default function ImportHandoff() {
  const {handoff} = useSyncExternalStore(importUi.subscribe,importUi.getSnapshot);
  return <section className="nmda-next-step-card nmda-import-next-step" id="nmda-import-handoff-card" hidden={!handoff.visible}>
    <div className="nmda-next-step-copy"><span className="nmda-next-step-kicker">导入完成</span><strong>进入审阅邮件</strong><small>{handoff.hint}</small></div>
    <div className="nmda-import-ready-summary">{handoff.metrics.map((metric,index) => <div className="nmda-import-metric" key={`${metric.label}:${index}`}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div>
    <button className="nmda-btn nmda-btn-primary nmda-next-step-action" type="button" onClick={() => window.dispatchEvent(new CustomEvent('nmda:import-handoff-action',{detail:{action:'open-review'}}))}>进入审阅 →</button>
  </section>;
}
