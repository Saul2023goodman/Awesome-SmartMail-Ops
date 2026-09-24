import { useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const send = action => window.dispatchEvent(new CustomEvent('nmda:preflight-action', {detail:action}));
const usePreflight = () => useSyncExternalStore(importUi.subscribe, importUi.getSnapshot).preflight;

export function PreflightHead() {
  const { reviewCount, taskCount } = usePreflight();
  const attention = !taskCount || reviewCount > 0;
  return <div className="nmda-classify-head-main">
    <div className="nmda-supplement-head-icon" data-state={attention ? 'review' : 'ok'}>{attention ? '!' : '✓'}</div>
    <div><span className="nmda-supplement-kicker">{reviewCount ? `${reviewCount} 个文件待确认` : '文件用途已整理'}</span><h3 id="nmda-supplement-title">检查导入结果</h3><p>确认有疑问的文件即可。</p></div>
  </div>;
}

export function PreflightNav() {
  const { view } = usePreflight();
  return <nav className="nmda-classify-modebar" aria-label="导入核验步骤">
    <button className={view === 'files' ? 'is-active' : ''} type="button" aria-current={view === 'files' ? 'step' : undefined} onClick={() => send('files')}><span>1</span><strong>核验文件</strong><small>确认用途</small></button>
    <button className={view === 'support' ? 'is-active' : ''} type="button" aria-current={view === 'support' ? 'step' : undefined} onClick={() => send('support')}><span>2</span><strong>参考名单</strong><small>可选核对来源</small></button>
  </nav>;
}

export function PreflightFoot() {
  const { reviewCount, taskCount } = usePreflight();
  const summary = reviewCount ? `${reviewCount} 个文件待确认` : taskCount ? '分类已确认，可以继续' : '还没有识别到邮件，请调整文件用途';
  return <footer className="nmda-supplement-foot nmda-classify-foot">
    <button className="nmda-btn nmda-btn-quiet" type="button" onClick={() => send('back')}>返回上传</button>
    <div className="nmda-classify-foot-summary"><strong>{summary}</strong><small>无误即可继续。</small></div>
    <button id="nmda-complete-supplement-preflight" className="nmda-btn nmda-btn-primary" type="button" onClick={() => send('complete')}>{reviewCount ? `处理 ${reviewCount} 个待确认` : '完成分类'}</button>
  </footer>;
}
