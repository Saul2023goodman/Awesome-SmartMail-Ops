import { useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:preflight-action', {detail:{action,...detail}}));

export default function PreflightSupport() {
  const {support} = useSyncExternalStore(importUi.subscribe, importUi.getSnapshot);
  const {view,roster,attachment} = support;
  const rosterAdded = roster.state === 'added';
  const attachmentStatus = attachment.count ? `${attachment.count} 个文件${attachment.issues ? ` · ${attachment.issues} 项未匹配 · 不阻断` : ' · 当前提示已匹配'}` : attachment.state === 'skipped' ? '本批次暂未添加' : attachment.issues ? `${attachment.issues} 项提示` : '尚未添加';
  return <>
    <header className="nmda-support-view-head"><div><span>批次资料</span><strong>按需要补充</strong></div><nav className="nmda-support-modebar" aria-label="批次资料类型">
      <button className={view === 'roster' ? 'is-active' : ''} type="button" aria-current={view === 'roster' ? 'page' : undefined} onClick={() => send('support-view',{view:'roster'})}><span>名</span><strong>参考名单</strong></button>
      <button className={view === 'attachment' ? 'is-active' : ''} type="button" aria-current={view === 'attachment' ? 'page' : undefined} onClick={() => send('support-view',{view:'attachment'})}><span>附</span><strong>附件</strong></button>
    </nav></header>
    <section className="nmda-classify-supplements nmda-classify-upload-dock" aria-label="批次资料"><div className="nmda-classify-supplement-stack">
      <article id="nmda-preflight-roster-box" className="nmda-supplement-box nmda-supplement-box-compact" data-support-pane="roster" data-state={roster.state} hidden={view !== 'roster'}><div className="nmda-supplement-box-icon">名</div><div className="nmda-supplement-box-main"><strong>{rosterAdded ? `参考总名单 · ${roster.count} 条` : '参考总名单'}</strong><small>{rosterAdded ? '名单已加入。' : '已有总名单时可加入。'}</small><div className="nmda-supplement-status">{rosterAdded ? `已加入 ${roster.count} 条` : roster.state === 'skipped' ? '本批次未使用' : '尚未添加'}</div></div><div className="nmda-supplement-actions"><label className="nmda-btn nmda-btn-small nmda-btn-primary" htmlFor="nmda-roster-file">上传名单</label></div></article>
      <article id="nmda-preflight-attachment-box" className="nmda-supplement-box nmda-supplement-box-compact nmda-supplement-box-attachment" data-support-pane="attachment" data-state={attachment.state} hidden={view !== 'attachment'}><div className="nmda-supplement-box-icon">附</div><div className="nmda-supplement-box-main"><strong>{attachment.total ? `附件工作台 · ${attachment.total} 项附件提示` : '附件工作台'}</strong><small>{attachment.total ? '统一查看文件、匹配状态和发送范围。' : '需要附件时直接在工作台拖入并配置。'}</small>{!!attachment.requirements.length && <div className="nmda-attachment-requirements">{attachment.requirements.slice(0,3).map((ref,index) => <span key={index}>{ref}</span>)}{attachment.requirements.length > 3 && <span>+{attachment.requirements.length-3}</span>}</div>}<div className="nmda-supplement-status">{attachmentStatus}</div>{!!attachment.count && <div className="nmda-attachment-assets nmda-attachment-assets-inline"><div className="nmda-attachment-assets-head"><strong>附件状态</strong><span>{attachment.count} 个</span></div><div className="nmda-attachment-assets-list"><button className="nmda-attachment-assets-more" type="button" onClick={() => send('attachments')}>{attachment.count} 个附件 · 打开工作台查看配置</button></div></div>}</div><div className="nmda-supplement-actions"><button className="nmda-btn nmda-btn-small nmda-btn-primary" type="button" onClick={() => send('attachments')}>打开附件工作台</button></div></article>
    </div></section>
  </>;
}
