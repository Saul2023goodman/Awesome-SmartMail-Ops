import { useState, useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:attachment-workspace-action', {detail:{action,...detail}}));

function AttachmentAsset({entry}) {
  return <div className="nmda-attachment-asset-row nmda-attachment-workspace-row" data-attachment-identity={entry.identity}>
    <span className="nmda-attachment-file-icon" aria-hidden="true">↗</span>
    <div className="nmda-attachment-file-main"><strong title={entry.name}>{entry.name}</strong><small>{entry.size} · {entry.source}</small></div>
    <div className="nmda-attachment-scope"><label><span>适用范围</span><select aria-label={`设置 ${entry.name} 的适用范围`} value={entry.mode} onChange={event => send('policy',{identity:entry.identity,mode:event.target.value})}>
      <option value="all">全部邮件（默认）</option><option value="smart">按邮件提示匹配</option><option value="selected">指定邮件…</option>
    </select></label><span className="nmda-attachment-scope-state" data-tone={entry.tone}>{entry.scope}</span></div>
    <div className="nmda-attachment-asset-actions">{entry.mode === 'selected' && <button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => send('target-open',{identity:entry.identity})}>选择邮件</button>}
      <button className="nmda-text-action nmda-attachment-remove" type="button" onClick={() => send('remove',{identity:entry.identity})} aria-label={`移除 ${entry.name}`}>移除</button></div>
  </div>;
}

function AttachmentRequirements({items}) {
  if (!items.length) return <div className="nmda-attachment-assets-empty">当前邮件没有点名附件提示。新加入的附件仍默认适用于全部邮件，也可改为指定邮件。</div>;
  return items.map(item => <div className="nmda-attachment-requirement-row" key={item.key}>
    <div><strong>{item.ref}</strong><small>{item.files.length ? `已使用：${item.files.join('、')}` : '来源中提到此附件；未匹配也可继续'}</small></div>
    <span data-tone={item.tone}>{item.status}</span>
    {!!item.choices.length && <select aria-label={`为 ${item.ref} 选择附件`} value="" onChange={event => send('requirement-match',{key:item.key,identity:event.target.value})}>
      <option value="">使用现有附件…</option>{item.choices.map(file => <option value={file.identity} key={file.identity}>{file.label}</option>)}
    </select>}
  </div>);
}

function TargetEditor({target}) {
  const [search,setSearch] = useState('');
  if (!target) return null;
  const normalize = value => String(value||'').toLocaleLowerCase('zh-CN').replace(/\s+/g,' ').trim();
  const query = normalize(search);
  const visibleTasks = target.tasks.filter(task => {
    const haystack=normalize([task.recipient,task.subject,task.school].join(' '));
    return !query || haystack.includes(query);
  });
  return <section className="nmda-attachment-target-editor">
    <header><div><span>指定邮件</span><strong>{target.title}</strong></div><button className="nmda-icon-btn" type="button" aria-label="关闭指定邮件设置" onClick={() => send('target-close')}>×</button></header>
    <div className="nmda-attachment-target-toolbar"><label><span>⌕</span><input type="search" placeholder="搜索收件人、主题或学校" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button className="nmda-btn nmda-btn-small" type="button" onClick={() => send('target-all',{identity:target.identity,taskKeys:visibleTasks.map(task => task.key)})}>全选当前</button>
      <button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => send('target-clear',{identity:target.identity})}>清空</button></div>
    <div className="nmda-attachment-target-list">{visibleTasks.length ? visibleTasks.map(task => <label className="nmda-attachment-target-row" key={task.key}>
      <input type="checkbox" checked={task.selected} onChange={event => send('target-check',{identity:target.identity,taskKey:task.key,checked:event.target.checked})} />
      <span><strong>{task.recipient || '未填写收件人'}</strong><small>{task.subject || '无主题'}{task.school ? ` · ${task.school}` : ''}</small></span>
    </label>) : <div className="nmda-attachment-assets-empty">没有匹配当前搜索的邮件。</div>}</div>
  </section>;
}

export default function AttachmentManager() {
  const {attachments,locked} = useSyncExternalStore(importUi.subscribe,importUi.getSnapshot);
  const [dragging,setDragging] = useState(false);
  const {summary} = attachments;
  const drop = event => {
    event.preventDefault();setDragging(false);
    if (event.dataTransfer) send('drop',{dataTransfer:event.dataTransfer});
  };
  const choose = action => { if (!locked) send(action); };
  return <div className="nmda-attachment-manager-overlay" id="nmda-attachment-manager-overlay" hidden={!attachments.visible} aria-hidden={!attachments.visible} onClick={event => {if(event.target === event.currentTarget)send('close');}}>
    <section className="nmda-attachment-manager" role="region" aria-labelledby="nmda-attachment-manager-title">
      <div className="nmda-attachment-manager-head"><div><span className="nmda-supplement-kicker">统一附件配置</span><h3 id="nmda-attachment-manager-title">附件工作台</h3><p>新附件默认适用于全部邮件；如有需要，可改为自动匹配或精确指定邮件。</p></div>
        <button className="nmda-icon-btn" type="button" aria-label="关闭附件工作台" onClick={() => send('close')}>×</button></div>
      <div className="nmda-attachment-manager-body">
        <div className="nmda-attachment-workspace-stats"><span><strong>{summary.count}</strong><small>附件文件</small></span><span><strong>{summary.matched}/{summary.total}</strong><small>附件提示已匹配</small></span><span data-tone={summary.issues ? 'warn' : 'ok'}><strong>{summary.issues}</strong><small>未匹配 · 不阻断</small></span><span><strong>{summary.smart}/{summary.all}/{summary.selected}</strong><small>自动 / 全部 / 指定</small></span></div>
        <div className={`nmda-attachment-manager-drop${dragging ? ' is-dragging' : ''}`} tabIndex={0} role="button" aria-label="拖入或选择附件" onClick={() => choose('choose-files')} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();choose('choose-files');}}} onDragEnter={event => {event.preventDefault();setDragging(true);}} onDragOver={event => {event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';setDragging(true);}} onDragLeave={event => {if(!event.currentTarget.contains(event.relatedTarget))setDragging(false);}} onDrop={drop}>
          <span className="nmda-attachment-manager-drop-icon">⇧</span><div><strong>拖入附件或文件夹</strong><small>也可以点击选择文件；文件夹会保留相对路径并参与自动匹配。</small></div><span className="nmda-attachment-manager-drop-action">选择文件</span>
        </div>
        <div className="nmda-attachment-manager-addbar"><button className="nmda-btn nmda-btn-small nmda-btn-primary" type="button" onClick={() => choose('choose-files')}>选择文件</button><button className="nmda-btn nmda-btn-small" type="button" onClick={() => choose('choose-directory')}>选择文件夹</button><span className="nmda-hint">{attachments.fileIndexInfo}</span></div>
        <section className="nmda-attachment-workspace-section"><header><div><strong>附件文件</strong></div><span>{summary.count} 个</span></header>
          <div className="nmda-attachment-assets">{attachments.entries.length ? <div className="nmda-attachment-assets-list nmda-attachment-workspace-list">{attachments.entries.map(entry => <AttachmentAsset entry={entry} key={entry.identity} />)}</div> : <div className="nmda-attachment-assets-empty">还没有附件。把文件拖到上方即可开始配置。</div>}</div>
        </section>
        <TargetEditor key={attachments.target?.identity || 'no-target'} target={attachments.target} />
        <section className="nmda-attachment-workspace-section nmda-attachment-requirement-section"><header><div><strong>邮件中的附件提示</strong></div><span>{summary.total} 项</span></header><div className="nmda-attachment-requirement-list"><AttachmentRequirements items={attachments.requirements} /></div></section>
      </div>
      <div className="nmda-attachment-manager-foot"><button className="nmda-btn nmda-btn-danger-quiet" type="button" onClick={() => send('clear')}>清空附件</button><div className="nmda-row nmda-wrap"><span className="nmda-hint"></span><button className="nmda-btn nmda-btn-primary" type="button" onClick={() => send('close')}>完成</button></div></div>
    </section>
  </div>;
}
