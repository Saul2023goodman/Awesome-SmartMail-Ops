import { useState, useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:preflight-source-action', {detail:{action,...detail}}));
const useSourceUi = () => useSyncExternalStore(importUi.subscribe, importUi.getSnapshot).sourceUi;
const chipOptions = [['mail','邮件','✉'],['roster','总名单','名'],['attachment','附件','附'],['review','待确认','!'],['ignored','暂不使用','×']];

export function PreflightChips() {
  const {counts,filter} = useSourceUi();
  return <div className="nmda-classify-head-summary" aria-label="分类概览">{chipOptions.map(([tone,label,icon]) => <button key={tone} type="button" data-tone={tone} className={filter === tone ? 'is-active' : ''} onClick={() => send('filter',{value:tone})}><i>{icon}</i><span>{label}</span><b>{counts[tone] || 0}</b></button>)}</div>;
}

function FolderBranch({folder,active}) {
  return <div className="nmda-classify-folder-branch">
    <button className={`nmda-classify-folder-row${active === folder.path ? ' is-active' : ''}`} type="button" style={{'--depth':folder.depth}} onClick={() => send('folder',{value:folder.path})}><span className="nmda-classify-folder-chevron">›</span><span className="nmda-classify-folder-icon">▰</span><span className="nmda-classify-folder-name" title={folder.name}>{folder.name}</span><b>{folder.count}</b></button>
    {folder.children.map(child => <FolderBranch folder={child} active={active} key={child.path} />)}
  </div>;
}

export function PreflightFolders() {
  const {folders,folder,total} = useSourceUi();
  return <div className="nmda-classify-directory-nav">
    <button className={`nmda-classify-folder-row nmda-classify-folder-all${folder ? '' : ' is-active'}`} type="button" onClick={() => send('folder',{value:''})}><span className="nmda-classify-folder-icon">▦</span><span className="nmda-classify-folder-name">全部文件</span><b>{total}</b></button>
    {folders.map(item => <FolderBranch folder={item} active={folder} key={item.path} />)}
  </div>;
}

function FileRow({row}) {
  const [dragging,setDragging] = useState(false);
  const inspect = () => send('inspect',{source:row.source});
  return <div className={`nmda-classify-file-row${row.selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`} data-tone={row.tone} data-review={row.needsReview ? '1' : '0'} data-source-row={encodeURIComponent(row.source)} role="button" tabIndex={0} aria-label={`查看 ${row.fileName}`} onClick={inspect} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();inspect();}}}>
    <span className="nmda-classify-drag" draggable="true" title="拖动可快速归类" aria-label={`拖动 ${row.fileName} 重新归类`} onClick={event => event.stopPropagation()} onDragStart={event => {event.dataTransfer.setData('text/plain',row.source);event.dataTransfer.effectAllowed='move';setDragging(true);send('drag-start',{source:row.source});}} onDragEnd={() => {setDragging(false);send('drag-end');}}>⠿</span>
    <span className="nmda-classify-file-icon" data-file-kind={row.fileVisual.kind}><b>{row.fileVisual.glyph}</b><small>{row.fileVisual.label}</small></span>
    <div className="nmda-classify-file-main"><strong>{row.fileName}</strong><small>{row.meta}</small></div>
    <span className="nmda-classify-purpose-pill" data-tone={row.tone}><i>{row.icon}</i><span>{row.label}</span></span>
  </div>;
}

export function PreflightFiles() {
  const {rows} = useSourceUi();
  return <div className="nmda-preflight-source-routing-list nmda-classify-file-list">{rows.length ? rows.map(row => <FileRow row={row} key={row.source} />) : <div className="nmda-classify-empty"><span>⌕</span><strong>当前范围没有文件</strong><small>可以切换目录、清除筛选，或返回上传继续添加资料。</small></div>}</div>;
}
