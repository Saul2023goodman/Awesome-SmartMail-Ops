import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const Review = globalThis.NMDAWorkspaceReviewBoard;
const View = globalThis.NMDAWorkspaceView;
const FILTERS = [['all','全部'],['auto','已就绪'],['pending','需处理'],['confirmed','已检查']];

function useControls() { return useSyncExternalStore(Review.subscribeControls, Review.getControlsSnapshot); }
function act(action, detail = {}) { window.dispatchEvent(new CustomEvent('nmda:review-action', {detail:{action,...detail}})); }

export function ReviewTop() {
  const model = useControls();
  const trashRef = useRef(null);
  useEffect(() => {
    const closeOutside = event => { if (trashRef.current?.open && !trashRef.current.contains(event.target)) trashRef.current.open = false; };
    const closeEscape = event => { if (event.key === 'Escape' && trashRef.current?.open) { trashRef.current.open = false; event.preventDefault(); } };
    document.addEventListener('click', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('click', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, []);
  return <>
    <div><div className="nmda-card-title">审阅邮件</div><div className="nmda-card-desc">{model.count ? `${model.count} 封 · ${model.pending} 需处理` : '暂无审阅任务'}</div></div>
    <div className="nmda-inline-review-actions">
      <details className="nmda-review-trash" id="nmda-review-trash" data-empty={model.trash.length ? '0' : '1'} ref={trashRef}>
        <summary className="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-trash-trigger" title="查看被排除的邮件"><span className="nmda-review-trash-icon" aria-hidden="true"></span><span>垃圾箱</span><strong data-empty={model.trash.length ? '0' : '1'}>{model.trash.length}</strong></summary>
        <div className="nmda-review-trash-popover"><header><div><strong>垃圾箱</strong><small>排除只影响后续排期与发送，邮件内容仍保留。</small></div><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" disabled={!model.trash.length} onClick={() => { act('restore-all'); trashRef.current.open = false; }}>全部恢复</button></header>
          <div className="nmda-review-trash-list">{model.trash.map(item => {
            const primary = String(item.subject || item.recipients || item.id || '已排除邮件').trim();
            const secondary = [item.recipients && item.recipients !== primary ? item.recipients : '', item.sourceFile].filter(Boolean).join(' · ');
            return <article className="nmda-review-trash-item" data-trash-key={item.editKey} key={item.editKey}><span className="nmda-review-trash-item-mark" aria-hidden="true" dangerouslySetInnerHTML={{__html:View.iconSvg('mail')}} /><div><strong title={primary}>{primary}</strong>{secondary && <small title={secondary}>{secondary}</small>}</div><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => act('restore', {key:item.editKey})}>恢复</button></article>;
          })}</div>
          {!model.trash.length && <div className="nmda-review-trash-empty">垃圾箱为空</div>}
        </div>
      </details>
      {model.count > 0 && <button className={`nmda-btn nmda-btn-small nmda-btn-quiet${model.nextMode === 'dispatch' && !model.nextDisabled ? ' nmda-btn-primary' : ''}`} id="nmda-review-next-pending" data-mode={model.nextMode} type="button" disabled={model.nextDisabled} onClick={() => act('next')}>{model.nextLabel}</button>}
    </div>
  </>;
}

export function ReviewBoardbar() {
  const model = useControls();
  const launch = model.batchLaunch;
  return <>
    <div className="nmda-review-filter nmda-review-status-tabs" role="group" aria-label="邮件状态筛选">
      {FILTERS.map(([key,label]) => <button className={model.filter === key ? 'is-active' : ''} type="button" key={key} onClick={() => act('filter', {filter:key})}><span>{label}</span><strong>{model.counts[key] || 0}</strong></button>)}
    </div>
    <div className="nmda-review-queue-tools">
      <button className={`nmda-review-batch-launch${launch.empty ? ' is-empty' : ''}${launch.subjectCount ? ' needs-subject' : ''}${launch.queuedCount ? ' has-queued-rules' : ''}`} type="button" title={launch.title} aria-label={launch.title} aria-disabled={launch.empty ? 'true' : 'false'} onClick={() => act('batch')}>
        <span className="nmda-review-batch-launch-glyph" aria-hidden="true"><i></i><b></b></span>
        <span className="nmda-review-batch-launch-copy"><strong>批量处理</strong><small>{launch.meta}</small></span>
        {!!launch.subjectCount && <b className="nmda-review-batch-launch-count">{launch.subjectCount}</b>}
        <i className="nmda-review-batch-launch-arrow" aria-hidden="true">→</i>
      </button>
      <label className="nmda-review-search"><span aria-hidden="true">⌕</span><input type="search" value={model.search} onChange={event => act('search',{value:event.target.value})} placeholder="搜索收件人 / 邮箱 / 主题" autoComplete="off" /></label>
      {!model.selectVisibleHidden && <button className="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-bulk-entry" type="button" onClick={() => act('select-visible')}>{model.allVisibleSelected ? '取消批量选择' : `批量确认 ${model.selectVisibleCount} 封…`}</button>}
    </div>
  </>;
}

export function ReviewBatchbar() {
  const model = useControls();
  useLayoutEffect(() => { const host = document.getElementById('nmda-review-batchbar'); if (host) host.hidden = !model.batchbarVisible; }, [model.batchbarVisible]);
  return <><div><strong>{model.selectedCount ? `已选 ${model.selectedCount} 封需确认邮件` : '已选 0 封'}</strong></div><div className="nmda-row"><button className="nmda-btn nmda-btn-primary nmda-btn-small" type="button" onClick={() => act('confirm-selected')}>确认所选</button><button className="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" onClick={() => act('clear-selected')}>取消</button></div></>;
}

export function ReviewEmpty() {
  const model = useControls();
  useLayoutEffect(() => { const host = document.getElementById('nmda-review-page-empty'); if (host) host.hidden = model.count > 0; }, [model.count]);
  return <><div className="nmda-review-empty-visual" aria-hidden="true"><span></span><i></i><b></b></div><div className="nmda-review-empty-copy"><span className="nmda-review-empty-kicker">审阅邮件</span><strong>当前没有需要审阅的邮件</strong><small>{model.emptyHint}</small></div><div className="nmda-review-empty-actions"><button className="nmda-btn nmda-btn-primary" type="button" onClick={() => act('prepare')}>去准备邮件</button><button className="nmda-btn nmda-btn-quiet" type="button" onClick={() => act('monitor')}>查看邮件监测</button></div><div className="nmda-review-empty-foot"><span>初始邮件</span><i>→</i><span>审阅</span><i>→</i><span>安排发送</span><b>·</b><span>跟进邮件也在这里统一审阅</span></div></>;
}

export function ReviewPreviewToolbar() {
  const model = useControls();
  useLayoutEffect(() => { const host = document.getElementById('nmda-review-preview-toolbar'); if (host) host.hidden = model.surface !== 'preview'; }, [model.surface]);
  return <><button className="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-preview-back" type="button" onClick={() => act('back')}>← 返回邮件列表</button><div className="nmda-review-preview-toolbar-copy"><strong>查看邮件</strong><small>{model.previewMeta}</small></div><div className="nmda-review-preview-key" aria-label="关键信息定位标识">
    <span className="nmda-semantic-legend-item" data-semantic="advisor"><i></i><strong>导师</strong></span>
    <span className="nmda-semantic-legend-item" data-semantic="student"><i></i><strong>学生</strong></span>
    <span className="nmda-semantic-legend-item" data-semantic="institution"><i></i><strong>学校 / 机构</strong></span>
    <span className="nmda-semantic-legend-item" data-semantic="anchor"><i></i><strong>称呼 / 身份 / 意图 / 落款</strong></span>
    <span className="nmda-semantic-legend-item" data-semantic="degree"><i></i><strong>学位 / 时间</strong></span>
    <span className="nmda-semantic-legend-item" data-semantic="attention"><i></i><strong>重点表达</strong><small>斜体 / 引号 / 引用</small></span>
    <span className="nmda-semantic-legend-item" data-semantic="format"><i></i><strong>其他格式</strong><small>加粗 / 下划线 / 链接</small></span>
  </div></>;
}
