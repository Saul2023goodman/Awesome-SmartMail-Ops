import { useSyncExternalStore } from 'react';

const Reset = globalThis.NMDAWorkspaceResetUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:reset-all-action',{detail:{action,...detail}}));

export default function ResetAllDialog() {
  const model = useSyncExternalStore(Reset.subscribe,Reset.getSnapshot);
  return <div id="nmda-reset-all-overlay" className="nmda-workflow-modal-overlay nmda-reset-all-overlay" hidden={!model.open} onClick={event => {if(event.target===event.currentTarget)send('close');}}>
    <section className="nmda-workflow-dialog nmda-reset-all-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-reset-all-title">
      <header className="nmda-workflow-dialog-head">
        <div><span className="nmda-dialog-eyebrow">重新开始</span><h3 id="nmda-reset-all-title">清除当前工作内容？</h3><p>清除后可以重新准备邮件并开始新一批邮件。</p></div>
        <button className="nmda-dialog-close" id="nmda-reset-all-close" type="button" aria-label="关闭" onClick={() => send('close')}>×</button>
      </header>
      <div className="nmda-reset-all-body">
        <div className="nmda-reset-all-warning"><strong>将清除</strong><span>已准备邮件、审阅邮件结果、附件设置、发送安排，以及当前跟进设置。</span></div>
        <div className="nmda-reset-all-safe"><strong>网易邮箱不受影响</strong><span>已发送邮件、收件、草稿和定时邮件都会保留。</span></div>
        <label className="nmda-reset-all-confirm"><input id="nmda-reset-all-confirm" type="checkbox" checked={model.confirmed} onChange={event => send('confirm-change',{confirmed:event.target.checked})} /><span>我确认清除当前工作内容并重新开始</span></label>
        <div className="nmda-reset-all-status" id="nmda-reset-all-status" data-tone={model.status.tone} hidden={!model.status.visible}>{model.status.message}</div>
      </div>
      <footer className="nmda-workflow-dialog-foot"><button className="nmda-btn nmda-btn-quiet" id="nmda-reset-all-cancel" type="button" onClick={() => send('close')}>取消</button><div className="nmda-dialog-foot-spacer"></div><button className="nmda-btn nmda-btn-danger" id="nmda-reset-all-confirm-button" type="button" disabled={model.actionDisabled} onClick={() => send('confirm')}>{model.actionLabel}</button></footer>
    </section>
  </div>;
}
