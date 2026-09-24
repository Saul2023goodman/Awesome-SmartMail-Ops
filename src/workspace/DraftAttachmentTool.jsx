import {useRef, useState, useSyncExternalStore} from 'react';

const UtilityUi = globalThis.NMDAWorkspaceUtilityUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:draft-attachment-action', {detail:{action,...detail}}));

export function UtilitiesHome() {
  const {activeView,draftAttachmentSummary} = useSyncExternalStore(UtilityUi.subscribe, UtilityUi.getSnapshot);
  const State = globalThis.NMDAWorkspaceState;
  const Operations = globalThis.NMDAOperations;
  const Domain = globalThis.NMDAMonitorDomain;
  useSyncExternalStore(State.subscribe, State.getVersion);
  const groups = State.operations.loaded ? Operations.monitoringRoots(State.operations.store).map(group => ({ ...group, viewState:Domain.monitorGroupState(group) })) : [];
  const summary = Domain.monitorSummary(groups);
  const monitorMeta = summary.due ? `${summary.due} 位需跟进 · ${summary.replied} 位已回复` : summary.replied ? `${summary.replied} 位已回复 · ${summary.total} 位联系人` : `${summary.total} 位联系人`;
  const open = view => window.dispatchEvent(new CustomEvent('nmda:open-utility', { detail:view }));
  return <section className="nmda-utilities-home" id="nmda-utilities-home" aria-label="工具" hidden={activeView !== 'home'}>
    <div className="nmda-utilities-intro"><div><span className="nmda-utilities-eyebrow">工具</span><h3>处理日常邮箱作业</h3><p>选择要处理的事项，完成后可随时返回邮件流程。</p></div><span className="nmda-utilities-count">2 项</span></div>
    <div className="nmda-utility-grid">
      <button className="nmda-utility-card is-live" type="button" onClick={() => open('monitor')}><span className="nmda-utility-card-icon" aria-hidden="true">M</span><span className="nmda-utility-card-main"><small>联系人跟进</small><strong>邮件监测</strong><span>按联系人查看回复、已安排邮件与跟进时间，并处理下一步。</span></span><span className="nmda-utility-card-foot"><b>{monitorMeta}</b><i>进入 →</i></span></button>
      <button className="nmda-utility-card is-live is-attachment-update" type="button" onClick={() => open('draft-attachments')}><span className="nmda-utility-card-icon" aria-hidden="true">A</span><span className="nmda-utility-card-main"><small>草稿附件更新</small><strong>极速附件</strong><span>一次替换多封草稿中的旧附件，同时保留邮件内容和原发送时间。</span></span><span className="nmda-utility-card-foot"><b>{draftAttachmentSummary}</b><i>进入 →</i></span></button>
    </div>
  </section>;
}

function MotionStages({stages}) {
  return <div className="nmda-draft-motion-stages" id="nmda-draft-motion-stages">{stages.map(stage => <span className={`${stage.active ? 'is-active' : ''}${stage.complete ? ' is-complete' : ''}${stage.error ? ' is-error' : ''}`.trim()} data-draft-motion-stage={stage.key} key={stage.key}><i></i><b>{stage.label}</b></span>)}</div>;
}

function AttachmentMotion({motion}) {
  return <section className="nmda-draft-attachment-motion" id="nmda-draft-attachment-motion" data-phase={motion.phase} hidden={!motion.visible} aria-live="polite">
    <div className="nmda-draft-motion-head"><span><small>附件更新进度</small><strong id="nmda-draft-motion-title">{motion.title}</strong></span><b id="nmda-draft-motion-count">{motion.count}</b></div>
    <div className="nmda-draft-motion-scene" aria-hidden="true">
      <div className="nmda-draft-motion-mail is-old"><i></i><span>旧草稿</span><em id="nmda-draft-motion-old-file">{motion.oldName}</em></div>
      <div className="nmda-draft-motion-route"><span className="nmda-draft-motion-packet">↗</span><i></i></div>
      <div className="nmda-draft-motion-mail is-new"><i></i><span>新草稿</span><em id="nmda-draft-motion-new-file">{motion.newName}</em></div>
      <div className="nmda-draft-motion-verify"><span>✓</span><small>已核对</small></div>
    </div>
    <MotionStages stages={motion.stages} />
    <div className="nmda-draft-motion-current"><strong id="nmda-draft-motion-subject">{motion.subject}</strong><span id="nmda-draft-motion-message">{motion.message}</span></div>
  </section>;
}

function AttachmentGroup({group,active}) {
  return <button type="button" className={`nmda-draft-attachment-group${active ? ' is-active' : ''}`} data-draft-attachment-group={group.key} onClick={() => send('select-group',{key:group.key})}>
    <span><strong>{group.name}</strong><small>{group.sizeLabel}</small></span>
    <span><b>{group.draftCount}</b><small>封草稿{group.scheduled ? ` · ${group.scheduled} 封已定时` : ''}</small></span>
  </button>;
}

function AttachmentTarget({target}) {
  return <label className="nmda-draft-attachment-target"><input type="checkbox" data-draft-attachment-target={target.id} checked={target.selected} onChange={event => send('target-check',{id:target.id,checked:event.target.checked})} /><span><strong>{target.subject}</strong><small>{target.recipient}{target.scheduleAt ? ` · 已定时 ${target.scheduleAt}` : ''}</small></span><b>{target.attachmentCount > 1 ? `${target.attachmentCount} 个同版本附件` : '1 个附件'}</b></label>;
}

export default function DraftAttachmentTool() {
  const {activeView,draftAttachment:view} = useSyncExternalStore(UtilityUi.subscribe, UtilityUi.getSnapshot);
  const [search,setSearch] = useState('');
  const fileInput = useRef(null);
  const query = search.trim().toLocaleLowerCase('zh-CN');
  const groups = view.groups.filter(group => !query || group.name.toLocaleLowerCase('zh-CN').includes(query));
  const selectedAll = !!(view.targets.length && view.targets.every(target => target.selected));

  return <section className="nmda-utility-workspace nmda-draft-attachment-workspace" data-utility-workspace="draft-attachments" hidden={activeView !== 'draft-attachments'}>
    <header className="nmda-utility-workspace-head">
      <button className="nmda-utility-back" type="button" onClick={() => window.dispatchEvent(new CustomEvent('nmda:open-utility',{detail:'home'}))}>← 工具</button>
      <div><small>草稿附件更新</small><strong>极速附件</strong><span>批量替换草稿中的旧附件，并保留正文、收件人、主题和原发送时间。</span></div>
      <button className="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-draft-attachment-refresh" type="button" disabled={view.loading || view.running} onClick={() => send('refresh')}>重新读取草稿箱</button>
    </header>

    <div className="nmda-draft-attachment-overview">
      <article><small>草稿箱</small><strong id="nmda-draft-attachment-draft-count">{view.draftsCount}</strong><span>封已读取</span></article>
      <article><small>含附件</small><strong id="nmda-draft-attachment-mail-count">{view.withAttachments}</strong><span>封草稿</span></article>
      <article><small>附件版本</small><strong id="nmda-draft-attachment-version-count">{view.versionCount}</strong><span>组旧附件</span></article>
      <article><small>当前影响</small><strong id="nmda-draft-attachment-target-count">{view.selectedCount}</strong><span>封待更新</span></article>
    </div>

    <div className="nmda-draft-attachment-layout">
      <section className="nmda-draft-attachment-browser">
        <header><div><small>草稿附件</small><strong>选择要替换的旧附件</strong><span>按文件名与大小区分版本。</span></div><input id="nmda-draft-attachment-search" type="search" placeholder="搜索附件名" value={search} onChange={event => setSearch(event.target.value)} /></header>
        <div className="nmda-draft-attachment-groups" id="nmda-draft-attachment-groups">{groups.map(group => <AttachmentGroup group={group} active={group.key === view.selectedKey} key={group.key} />)}</div>
        <div className="nmda-draft-attachment-empty" id="nmda-draft-attachment-empty" hidden={!!groups.length || view.loading}>{view.loading ? '正在读取草稿箱…' : view.groups.length ? '没有符合搜索条件的附件。' : '草稿箱中没有可替换的普通附件。'}</div>
      </section>

      <section className="nmda-draft-attachment-replace">
        <header><div><small>替换范围</small><strong id="nmda-draft-attachment-plan-title">{view.selectedName ? `替换：${view.selectedName}` : '选择一个旧附件版本'}</strong><span id="nmda-draft-attachment-plan-copy">{view.selectedCopy}</span></div></header>
        <div className="nmda-draft-attachment-targets" id="nmda-draft-attachment-targets">
          {view.selectedKey ? <><label className="nmda-draft-attachment-select-all"><input id="nmda-draft-attachment-select-all" type="checkbox" checked={selectedAll} onChange={event => send('select-all',{checked:event.target.checked})} /><span>更新全部 {view.targets.length} 封匹配草稿</span></label>{view.targets.map(target => <AttachmentTarget target={target} key={target.id} />)}</> : <div className="nmda-draft-attachment-target-empty">选择左侧旧附件后，这里会显示受影响的草稿。</div>}
        </div>
        <input id="nmda-draft-attachment-file" type="file" hidden ref={fileInput} onChange={event => {const file=event.target.files?.[0] || null;event.target.value='';send('select-file',{file});}} />
        <button className="nmda-draft-attachment-drop" id="nmda-draft-attachment-drop" type="button" disabled={!view.selectedKey || view.running} onClick={() => fileInput.current?.click()}>
          <span className="nmda-draft-attachment-drop-mark" aria-hidden="true">⇧</span>
          <span><strong id="nmda-draft-attachment-new-name">{view.replacementName}</strong><small id="nmda-draft-attachment-new-meta">{view.replacementMeta}</small></span><b>选择文件</b>
        </button>
        <div className="nmda-draft-attachment-safety"><strong>安全替换</strong><span>先创建新草稿并核对正文、收件人、主题、发送时间和附件；确认一致后才替换旧稿，失败时保留原稿。</span></div>
        <AttachmentMotion motion={view.motion} />
        <div className="nmda-draft-attachment-progress" id="nmda-draft-attachment-progress" data-tone={view.progress.tone} hidden={!view.progress.message}>{view.progress.message}</div>
        <div className="nmda-draft-attachment-actions">
          <button className="nmda-btn nmda-btn-quiet" id="nmda-draft-attachment-cancel" type="button" hidden={!view.running} disabled={!view.running || view.cancelRequested} onClick={() => send('cancel')}>{view.cancelRequested ? '正在停止…' : '停止本次更新'}</button>
          <button className="nmda-btn nmda-btn-primary" id="nmda-draft-attachment-run" type="button" disabled={!view.selectedKey || !view.replacementSelected || !view.selectedCount || view.running} onClick={() => send('run')}>{view.runLabel}</button>
        </div>
        <div className="nmda-draft-attachment-result" id="nmda-draft-attachment-result" data-tone={view.result.tone} hidden={!view.result.message}>{view.result.message}</div>
      </section>
    </div>
  </section>;
}
