import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const Board = globalThis.NMDAWorkspaceReviewBoard;

function SourceBadge({ followUp, sequence }) {
  return followUp
    ? <em className="nmda-review-source-badge is-followup">跟进 #{Math.max(1, Number(sequence || 1))}</em>
    : <em className="nmda-review-source-badge">初始邮件</em>;
}

function MailCard({ item, index, activeKey }) {
  const { task, visual, confirmable, issueLabels, origin, title } = item;
  const key = String(task.editKey);
  const checked = !!item.checked;
  const recipient = String(task.recipients || '').trim() || '未识别收件人';
  const subject = String(task.subject || '').trim() || '未识别主题';
  const label = String(task.id || task.collectionName || recipient || `邮件 ${index + 1}`);
  const pending = visual.issues.length > 0;
  const more = Math.max(0, issueLabels.length - 2);
  return <article className={`nmda-mail-review-card${checked ? ' is-selected' : ''}${key === activeKey ? ' is-active' : ''}`} data-review-row={key} data-state={visual.key} data-review-kind={item.followUp ? 'follow_up' : 'initial'}>
    <div className="nmda-mail-card-status">
      <span className="nmda-mail-state-shape" aria-hidden="true">{visual.icon}</span>
      <span><strong>{visual.label}</strong>{visual.detail && <small>{visual.detail}</small>}</span>
      <div className="nmda-mail-card-tools">
        <button className={`nmda-open-original-mail is-compact${origin.messageId ? '' : ' is-unavailable'}`} type="button" disabled={!origin.messageId} data-open-original-mail={origin.messageId || undefined} data-open-original-fid={origin.fid || 3} title={origin.messageId ? '在 163 邮箱打开此任务对应的原信件' : '该任务尚未在 163 中形成或匹配到原信件'}>163 ↗</button>
        {confirmable && <label className="nmda-mail-card-select" title="加入批量确认"><input type="checkbox" checked={checked} aria-label={`选择 ${label}`} onChange={event => {
          window.dispatchEvent(new CustomEvent('nmda:review-board-select', { detail:{ key, checked:event.target.checked } }));
        }} /><span></span></label>}
      </div>
    </div>
    <button className="nmda-mail-card-main" type="button" data-review-preview-key={key} aria-label={`预览 ${label}`}>
      <span className="nmda-mail-card-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="nmda-mail-card-copy"><SourceBadge followUp={item.followUp} sequence={task.sequence} /><strong>{title}</strong><small>{recipient}</small><b>{subject}</b>{pending && <span className="nmda-mail-card-issues">{issueLabels.slice(0, 2).map(issue => <span key={issue}>{issue}</span>)}{more > 0 && <span>+{more}</span>}</span>}</span>
      <span className="nmda-mail-card-open">查看 <i>→</i></span>
    </button>
  </article>;
}

export default function ReviewBoard() {
  const model = useSyncExternalStore(Board.subscribe, Board.getSnapshot);
  const previous = useRef(null);
  useLayoutEffect(() => {
    if (model.preserveScroll) return;
    const queue = document.getElementById('nmda-review-queue');
    if (!queue || queue.classList.contains('nmda-review-continuous-preview')) return;
    if (model.activeKey) queue.querySelector(`[data-review-row="${CSS.escape(model.activeKey)}"]`)?.scrollIntoView?.({block:'nearest'});
    else if (previous.current !== model) queue.scrollTop = 0;
    previous.current = model;
  }, [model]);
  return <>
    {model.items.length ? model.items.map((item, index) => <MailCard item={item} index={index} activeKey={model.activeKey} key={item.task.editKey} />) : <div className="nmda-review-empty">{model.filter === 'pending' ? '无待处理邮件' : '暂无邮件'}</div>}
    {model.total > model.items.length && <button type="button" className="nmda-review-load-more" data-review-load-more><span>已显示 {model.items.length} / {model.total}</span><small>继续滚动自动加载</small></button>}
  </>;
}

function Rich({ html, ...props }) {
  return <span {...props} dangerouslySetInnerHTML={{__html:html || ''}} />;
}

function OriginalMailButton({ origin }) {
  return <button className={`nmda-open-original-mail is-compact${origin.messageId ? '' : ' is-unavailable'}`} type="button" disabled={!origin.messageId} data-open-original-mail={origin.messageId || undefined} data-open-original-fid={origin.fid || 3} title={origin.messageId ? '在 163 邮箱打开此任务对应的原信件' : '该任务尚未在 163 中形成或匹配到原信件'}>163 原信件 ↗</button>;
}

function PreviewPage({ item, index, activeKey }) {
  const { task, visual, editing, issueLabels, confirmable, origin, suggestions, richBody, highlightedRecipient, highlightedSubject, decoratedBody, followUp } = item;
  const key = String(task.editKey);
  const recipient = String(task.recipients || '').trim() || '未识别收件人';
  const subject = String(task.subject || '').trim() || '未识别主题';
  const label = String(task.id || task.collectionName || recipient || `邮件 ${index + 1}`);
  const pending = visual.issues.length > 0;
  return <article className={`nmda-review-preview-page${key === activeKey ? ' is-active' : ''}${editing ? ' is-editing' : ''}`} data-review-row={key} data-state={visual.key} data-review-kind={followUp ? 'follow_up' : 'initial'} style={{'--page-delay':`${Math.min(index, 10) * 16}ms`}}>
    <header className="nmda-review-preview-head">
      <div className="nmda-review-preview-index"><span>{String(index + 1).padStart(2, '0')}</span><SourceBadge followUp={followUp} sequence={task.sequence} /></div>
      <div className="nmda-review-preview-meta"><strong><Rich html={highlightedRecipient} /></strong><small className="nmda-preview-subject-value" data-preview-subject><Rich html={highlightedSubject} /></small></div>
      <div className="nmda-review-preview-state"><span className="nmda-mail-state-shape" aria-hidden="true">{editing ? '✎' : visual.icon}</span><span><strong>{editing ? '编辑中' : visual.label}</strong>{!editing && visual.detail && <small>{visual.detail}</small>}</span></div>
      {editing ? <div className="nmda-review-preview-actions is-editing"><OriginalMailButton origin={origin} /><span className="nmda-preview-editing-cue"><i></i>编辑权限已开启</span><button className="nmda-preview-inline-cancel" type="button" data-preview-edit-cancel={key}>取消</button><button className="nmda-preview-inline-save" type="button" data-preview-edit-save={key}>保存修改</button></div>
        : <div className="nmda-review-preview-actions"><OriginalMailButton origin={origin} />{confirmable && <button className="nmda-preview-inline-confirm" type="button" data-preview-confirm-key={key}>确认无误</button>}<button className="nmda-review-preview-edit" type="button" data-preview-edit-key={key}>{visual.direct?.length ? '补齐' : '编辑'}</button><details className="nmda-preview-more"><summary aria-label="更多操作">•••</summary><button type="button" data-preview-exclude-key={key}>{followUp ? '取消跟进' : '排除此封'}</button></details></div>}
    </header>
    {editing ? <section className="nmda-review-preview-sheet nmda-review-preview-sheet-edit" aria-label={`${label} 编辑`}>
      <div className="nmda-preview-inline-fields">
        <label><span>To</span><input data-preview-edit-recipients type="text" defaultValue={String(task.recipients || '')} placeholder="recipient@example.edu" /></label>
        {!!suggestions.length && <div className="nmda-preview-recipient-suggestions"><span>候选收件人</span>{suggestions.map(suggestion => <button type="button" data-preview-recipient-suggestion={suggestion.email} title={suggestion.reason || ''} key={suggestion.email}>{suggestion.email}</button>)}</div>}
        <label><span>Subject</span><input data-preview-edit-subject type="text" defaultValue={String(task.subject || '')} placeholder="邮件主题" /></label>
      </div>
      <div className="nmda-preview-inline-formatbar" aria-label="正文格式"><button type="button" data-preview-rich-command="bold" title="加粗（Ctrl+B）"><strong>B</strong></button><button type="button" data-preview-rich-command="italic" title="斜体（Ctrl+I）"><em>I</em></button><button type="button" data-preview-rich-command="underline" title="下划线（Ctrl+U）"><u>U</u></button><span>保持原邮件格式 · 保存后继续在这里核对</span></div>
      <div className="nmda-review-preview-body nmda-preview-inline-body" data-preview-edit-body contentEditable role="textbox" aria-multiline="true" spellCheck="true" suppressContentEditableWarning dangerouslySetInnerHTML={{__html:richBody || ''}} />
      <div className="nmda-preview-inline-feedback" data-preview-edit-feedback hidden></div>
    </section> : <section className="nmda-review-preview-sheet" aria-label={`${label} 完整邮件预览`}>
      <div className="nmda-review-preview-mailhead"><span>To</span><strong><Rich html={highlightedRecipient} /></strong><span>Subject</span><strong className="nmda-preview-subject-value" data-preview-subject><Rich html={highlightedSubject} /></strong></div>
      <div className="nmda-review-preview-body nmda-review-rich-body" dangerouslySetInnerHTML={{__html:decoratedBody || ''}} />
    </section>}
    {editing ? <footer className="nmda-review-preview-foot is-editing"><div className="nmda-preview-edit-note">修改后需要重新核对；保存后仍停留在当前邮件。</div></footer>
      : pending && <footer className="nmda-review-preview-foot"><div className="nmda-preview-issues">{issueLabels.map(issue => <span key={issue}>{issue}</span>)}</div>{confirmable && <button className="nmda-preview-confirm-next" type="button" data-preview-confirm-key={key}>确认并继续 →</button>}</footer>}
  </article>;
}

export function ReviewPreview() {
  const model = useSyncExternalStore(Board.subscribePreview, Board.getPreviewSnapshot);
  useLayoutEffect(() => {
    const queue = document.getElementById('nmda-review-queue');
    const rail = document.getElementById('nmda-review-preview-rail-list');
    if (!queue || !model.items.length || !queue.classList.contains('nmda-review-continuous-preview')) return;
    if (model.preserveScroll) {
      queue.scrollTop = Math.min(model.scrollTop || 0, Math.max(0, queue.scrollHeight - queue.clientHeight));
      if (rail) rail.scrollTop = Math.min(model.railScrollTop || 0, Math.max(0, rail.scrollHeight - rail.clientHeight));
    } else if (model.activeKey) {
      queue.querySelector(`#nmda-review-preview-pages [data-review-row="${CSS.escape(model.activeKey)}"]`)?.scrollIntoView?.({block:'center'});
    }
  }, [model]);
  return <>
    {model.items.length ? model.items.map((item, index) => <PreviewPage item={item} index={index} activeKey={model.activeKey} key={`${item.task.editKey}:${item.editing}`} />) : <div className="nmda-review-empty">{model.filter === 'pending' ? '无待处理邮件' : '暂无邮件'}</div>}
    {model.total > model.items.length && <button type="button" className="nmda-review-load-more" data-review-load-more><span>已显示 {model.items.length} / {model.total}</span><small>继续向下滚动自动加载</small></button>}
  </>;
}

export function ReviewRail() {
  const model = useSyncExternalStore(Board.subscribePreview, Board.getPreviewSnapshot);
  return <>
    {model.items.length ? model.items.map((item, index) => {
      const {task, visual, editing, followUp, title} = item;
      const active = task.editKey === model.activeKey;
      const subject = String(task.subject || '').trim() || '未识别主题';
      const kind = followUp ? `跟进 ${Math.max(1, Number(task.sequence || 1))}` : '初始邮件';
      return <button type="button" className={`nmda-review-preview-rail-card${active ? ' is-active' : ''}${editing ? ' is-editing' : ''}`} data-review-rail-key={task.editKey} data-state={visual.key} aria-current={active ? 'true' : 'false'} title={subject} style={{'--rail-delay':`${Math.min(index, 10) * 18}ms`}} key={task.editKey}>
        <span className="nmda-review-preview-rail-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="nmda-review-preview-rail-copy"><span><em>{kind}</em><i>{editing ? '编辑中' : visual.label}</i></span><strong>{title}</strong><small>{subject}</small></span>
      </button>;
    }) : <div className="nmda-review-preview-rail-empty">当前没有邮件</div>}
    {model.total > model.items.length && <div className="nmda-review-preview-rail-more">{model.items.length} / {model.total}<small>继续下滚加载</small></div>}
  </>;
}
