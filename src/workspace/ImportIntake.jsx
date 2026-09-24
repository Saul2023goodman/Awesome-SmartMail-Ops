import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const iconSvg = globalThis.NMDAWorkspaceView.iconSvg;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:import-action', { detail:{ action, ...detail } }));
const Icon = ({ name }) => <span className="nmda-source-action-icon" aria-hidden="true" dangerouslySetInnerHTML={{__html:iconSvg(name)}} />;

function BatchPrepStrip({ prep }) {
  if (!prep.visible) return null;
  return <div className="nmda-batch-prep-strip" id="nmda-batch-prep-strip">
    <div className="nmda-batch-prep-label"><span>导入准备</span><small>名单与附件均在此阶段完成</small></div>
    <div className="nmda-batch-prep-item" data-state={prep.rosterState}><span>参考总名单</span><strong>{prep.rosterText}</strong></div>
    <div className="nmda-batch-prep-item nmda-batch-prep-attachment" data-state={prep.attachmentState}><div><span>附件</span><strong>{prep.attachmentText}</strong></div><button className="nmda-text-action" type="button" onClick={() => send('attachments')}>{prep.manageText}</button></div>
    <button className="nmda-btn nmda-btn-small" type="button" onClick={() => send('batch-prep')}>{prep.buttonText}</button>
  </div>;
}

export default function ImportIntake() {
  const { loaded, active, busy, locked, draftBusy, formatInfo, clearVersion, prep, status } = useSyncExternalStore(importUi.subscribe, importUi.getSnapshot);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragging, setDragging] = useState(false);
  const pasteRef = useRef(null);
  const unavailable = busy || locked;

  useEffect(() => { setPasteOpen(false); setPasteText(''); setDragging(false); }, [clearVersion]);
  useEffect(() => { if (pasteOpen) pasteRef.current?.focus(); }, [pasteOpen]);

  const openFiles = () => { if (!unavailable) document.getElementById('nmda-import-file')?.click(); };
  const drop = event => {
    event.preventDefault();
    setDragging(false);
    if (!unavailable) send('drop', { dataTransfer:event.dataTransfer });
  };

  return <>
    <div className="nmda-card-head">
      <div><div className="nmda-card-title">{loaded ? '邮件资料已导入' : '导入邮件资料'}</div><div className="nmda-card-desc">{loaded ? '邮件资料已加入，可继续添加或进入批次资料。' : '把本批次邮件资料放进来。'}</div></div>
      <div className="nmda-row nmda-wrap">
        {busy && <span className="nmda-import-busy-badge">正在处理…</span>}
        {loaded && <span className="nmda-workspace-saved-badge">已保存 · 可继续添加</span>}
        {loaded && <button id="nmda-open-supplement-preflight" className="nmda-btn nmda-btn-small" type="button" disabled={locked} onClick={() => send('supplement')}>补充资料</button>}
        {active && <button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" disabled={locked} onClick={() => send('reset')}>清空本批次</button>}
      </div>
    </div>
    <div id="nmda-import-drop-zone" className={`nmda-import-drop-zone${dragging ? ' is-dragging' : ''}`} role="button" tabIndex={unavailable ? -1 : 0} aria-label="拖入邮件资料，或点击选择文件" aria-disabled={unavailable} onClick={openFiles} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFiles(); } }} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={drop}>
      <div className="nmda-import-drop-zone-icon" aria-hidden="true"><span dangerouslySetInnerHTML={{__html:iconSvg('import')}} /></div>
      <div className="nmda-import-drop-zone-copy"><strong>把邮件、名单与附件拖到这里</strong><small>统一导入并识别用途；支持文件、文件夹与 ZIP</small></div>
      <div className="nmda-import-drop-zone-types"><span>DOCX</span><span>XLSX</span><span>PDF</span><span>ZIP</span><span>更多</span></div>
    </div>
    <div className="nmda-source-action-grid nmda-source-action-grid-compact">
      <label className="nmda-source-action" htmlFor={unavailable ? undefined : 'nmda-import-file'} aria-disabled={unavailable}><Icon name="file" /><strong>{loaded ? '添加文件' : '选择文件'}</strong><small>从电脑选择资料</small></label>
      <label className="nmda-source-action" htmlFor={unavailable ? undefined : 'nmda-import-dir'} aria-disabled={unavailable}><Icon name="folder" /><strong>{loaded ? '添加文件夹' : '选择文件夹'}</strong><small>批量加入整个文件夹</small></label>
      <button className="nmda-source-action nmda-source-action-button" type="button" disabled={unavailable} onClick={() => setPasteOpen(open => !open)}><Icon name="paste" /><strong>{loaded ? '粘贴补充' : '粘贴内容'}</strong><small>粘贴邮件文本或表格</small></button>
      <button className="nmda-source-action nmda-source-action-button nmda-source-action-mailbox" type="button" disabled={unavailable || draftBusy} onClick={() => send('drafts')}><Icon name="mail" /><strong>读取草稿箱</strong><small>识别正文、主题、定时与附件</small></button>
    </div>
    {pasteOpen && <div className="nmda-paste-panel"><textarea id="nmda-paste-source" ref={pasteRef} value={pasteText} onChange={event => setPasteText(event.target.value)} placeholder="粘贴邮件、名单或表格内容" /><div className="nmda-row nmda-wrap"><button className="nmda-btn nmda-btn-primary nmda-btn-small" type="button" disabled={unavailable} onClick={() => send('paste', { text:pasteText })}>加入本批次</button></div></div>}
    <div className="nmda-ingest-source-tools"><span id="nmda-import-format-info" className="nmda-hint">{formatInfo}</span><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => send('template')}>下载模板</button></div>
    <BatchPrepStrip prep={prep} />
    <div id="nmda-import-status" className="nmda-summary nmda-import-status" data-kind={status.kind || undefined}>{status.message}</div>
  </>;
}
