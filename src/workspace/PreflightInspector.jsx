import { useEffect, useState, useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:preflight-source-action', {detail:{action,...detail}}));
const options = [['mail','邮件'],['roster','总名单'],['attachment','附件'],['review','待确认'],['ignored','暂不使用']];

function ContentPreview({preview}) {
  if (preview.type === 'empty') return <div className="nmda-inspector-empty-preview">{preview.message}</div>;
  return <div className="nmda-inspector-preview-block">
    <div className="nmda-inspector-preview-head"><strong>{preview.title}</strong><span>{preview.subtitle}</span></div>
    {preview.type === 'mail' && <div className="nmda-inspector-mail-fields"><div><span>收件人</span><strong>{preview.recipients}</strong></div><div><span>主题</span><strong>{preview.subject}</strong></div><div className="is-body"><span>正文</span><p>{preview.body}</p></div></div>}
    {preview.type === 'text' && <div className="nmda-inspector-text-preview">{preview.text}</div>}
    {preview.type === 'table' && <div className="nmda-inspector-mini-table">{preview.rows.map((row,index) => <div className={`nmda-inspector-mini-row${preview.header && index === 0 ? ' is-head' : ''}`} style={{'--preview-cols':preview.cols}} key={index}>{row.map((value,i) => <span title={value} key={i}>{value || '—'}</span>)}</div>)}</div>}
  </div>;
}

export default function PreflightInspector() {
  const { inspector } = useSyncExternalStore(importUi.subscribe, importUi.getSnapshot);
  const [editing,setEditing] = useState(false);
  useEffect(() => setEditing(false), [inspector?.source,inspector?.needsReview]);
  if (!inspector) return <div className="nmda-source-inspector-empty"><span className="nmda-source-inspector-empty-icon">⌁</span><strong>选择一个文件查看内容</strong><small>分类正确无需操作；只有发现用途不对时才修改。</small></div>;
  const changePurpose = event => send('purpose',{source:inspector.source,value:event.target.value});
  return <div className="nmda-source-inspector-card">
    <div className="nmda-source-inspector-card-head"><button className="nmda-source-inspector-close" type="button" aria-label="返回文件列表" onClick={() => send('close-inspector')}>←</button><div><span>当前文件</span><strong>文件核验</strong></div></div>
    <div className="nmda-source-inspector-overview"><div className="nmda-inspector-file-title"><span className="nmda-classify-file-icon" data-file-kind={inspector.fileVisual.kind}><b>{inspector.fileVisual.glyph}</b><small>{inspector.fileVisual.label}</small></span><div><strong>{inspector.fileName}</strong><small>{inspector.path} · {inspector.size}</small></div></div>{inspector.needsReview && <div className="nmda-inspector-review-note"><span>!</span><div><strong>这个文件需要你决定用途</strong><small>{inspector.reason}</small></div></div>}</div>
    <div className="nmda-source-inspector-actions">
      {(inspector.needsReview || editing) ? <label className="nmda-inspector-purpose-field" data-review={inspector.needsReview ? '1' : '0'}><span><strong>{inspector.needsReview ? '请选择文件用途' : '调整文件用途'}</strong><small>{inspector.needsReview ? '看过下方内容后选择即可' : '仅当自动分类确实不对时修改'}</small></span><select value={inspector.needsReview ? 'review' : inspector.purpose} onChange={changePurpose} aria-label="修改当前文件用途">{options.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        : <div className="nmda-inspector-auto-purpose" data-tone={inspector.tone}><span className="nmda-inspector-auto-purpose-icon">{inspector.icon}</span><span><strong>已识别为{inspector.label}</strong><small>无需选择格式；系统会按此用途继续。</small></span><button type="button" onClick={() => setEditing(true)}>分类有误</button></div>}
    </div>
    <div className="nmda-source-inspector-content"><ContentPreview preview={inspector.preview} /></div>
    {!!inspector.nextSource && <button className="nmda-source-next-review" type="button" onClick={() => send('inspect',{source:inspector.nextSource})}>下一个待确认 · 还剩 {inspector.remaining} 个 →</button>}
  </div>;
}
