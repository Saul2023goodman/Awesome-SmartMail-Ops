(() => {
  'use strict';

  const NMDA_ICONS = {
    app: '<path d="M5.25 6.5h6.5a4.75 4.75 0 0 1 0 9.5H8.5"/><circle cx="5.25" cy="6.5" r="1.75"/><circle cx="15.25" cy="11.25" r="1.75"/><circle cx="8.5" cy="16" r="1.75"/>',
    expand: '<path d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13"/><path d="M8 6 3.5 3.5M12 6l4.5-2.5M8 14l-4.5 2.5M12 14l4.5 2.5"/>',
    close: '<path d="M5 5l10 10M15 5 5 15"/>',
    batch: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.2"/>',
    review: '<path d="M6 2.75h6.5l3 3v11.5H6z"/><path d="M12.5 2.75v3h3M8.5 8.5h4.75M8.5 11.25h4.75M8.5 14h3"/>',
    dispatch: '<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13"/><circle cx="6.5" cy="5.5" r="1.25"/><circle cx="12.5" cy="10" r="1.25"/><circle cx="9" cy="14.5" r="1.25"/>',
    monitor: '<path d="M3.5 5.75h13v8.75h-13z"/><path d="m3.5 6.5 6.5 4.75 6.5-4.75"/><circle cx="14.75" cy="5" r="1.75"/>',
    import: '<path d="M10 3.5v8"/><path d="m6.75 8.25 3.25 3.25 3.25-3.25"/><path d="M4 13.5h12v3H4z"/>',
    file: '<path d="M6 2.75h5.75l3.25 3.25V17.25H6z"/><path d="M11.75 2.75V6h3.25"/><path d="M8 9.25h4M8 12h4"/>',
    folder: '<path d="M2.75 5.5h4l1.5 1.75h9v7.75H2.75z"/>',
    paste: '<rect x="5.25" y="4.25" width="9.5" height="12" rx="1.6"/><path d="M8 4.25V3.5h4v.75M8.25 7.75h3.5M8.25 10.5h4.5M8.25 13.25h4.5"/>',
    mail: '<path d="M3.5 5.75h13v8.75h-13z"/><path d="m3.5 6.5 6.5 4.75 6.5-4.75"/>',
    roster: '<circle cx="7" cy="7" r="2"/><circle cx="13.5" cy="6.5" r="1.75"/><path d="M3.75 14c.7-1.95 2.45-3 4.25-3s3.55 1.05 4.25 3"/><path d="M11 13.75c.45-1.35 1.7-2.15 3.05-2.15 1.3 0 2.55.75 3.2 2.15"/>',
    attachment: '<path d="M7.25 9.75 11 6a2.25 2.25 0 1 1 3.2 3.2l-5 5a3.25 3.25 0 0 1-4.6-4.6l5.25-5.25"/>',
    warning: '<path d="M10 3.5 16.5 15H3.5L10 3.5Z"/><path d="M10 7.5v3.75M10 13.25v.25"/>',
    ignored: '<circle cx="10" cy="10" r="6.5"/><path d="M6.5 6.5l7 7"/>',
    search: '<circle cx="8.5" cy="8.5" r="4.75"/><path d="M12 12 16 16"/>',
    success: '<path d="M4.75 10.25 8 13.5l7.25-7.25"/>',
    archive: '<path d="M4 4.75h12v3H4z"/><path d="M5 7.75h10v7.5H5z"/><path d="M8 10.75h4"/>',
    trash: '<path d="M4.75 6.25h10.5M8 3.75h4l.75 2.5H7.25L8 3.75Z"/><path d="M6.25 6.25 7 16h6l.75-9.75M8.75 9v4.25M11.25 9v4.25"/>',
    doc: '<path d="M6 2.75h5.75l3.25 3.25V17.25H6z"/><path d="M11.75 2.75V6h3.25"/><path d="M8 9.25h4M8 12h4M8 14.75h4"/>',
    code: '<path d="m7.25 6.25-3 3.75 3 3.75M12.75 6.25l3 3.75-3 3.75M10.75 4.75 9.25 15.25"/>',
    table: '<rect x="3.5" y="4" width="13" height="12" rx="1.4"/><path d="M3.5 8h13M8 4v12M12 4v12"/>',
    text: '<path d="M5 6h10M5 9.5h10M5 13h7.5"/>',
    source: '<path d="M10 3.75 15.5 10 10 16.25 4.5 10Z"/>',
    dot: '<circle cx="10" cy="10" r="1.6"/>'
  };

  function iconSvg(name) {
    const body = NMDA_ICONS[name] || NMDA_ICONS.source;
    return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  function setUnifiedIcon(element, name) {
    if (!element || !name) return;
    if (element.dataset.nmdaIconName === name) return;
    element.dataset.nmdaIconName = name;
    element.innerHTML = iconSvg(name);
  }

  function textIconToName(value) {
    const key = String(value || '').trim();
    return ({
      '✉':'mail','名':'roster','人':'roster','附':'attachment','⇧':'attachment','!':'warning','×':'close','✓':'success','⌕':'search','↓':'import','＋':'file','▤':'folder','⌘':'paste','◎':'roster','?':'warning','—':'ignored','W':'doc','{}':'code','¶':'text','≡':'text','<>':'code','XML':'code','▦':'table','◇':'source','ZIP':'archive'
    })[key] || '';
  }

  function decorateUnifiedIcons(scope = document) {
    const root = scope?.querySelector ? scope : document;
    setUnifiedIcon(root.querySelector('.nmda-launcher-mark'), 'app');
    setUnifiedIcon(root.querySelector('.nmda-brand-mark'), 'app');
    setUnifiedIcon(root.querySelector('#nmda-expand'), 'expand');
    setUnifiedIcon(root.querySelector('#nmda-close'), 'close');

    root.querySelectorAll('.nmda-tab').forEach(tab => {
      const iconHost = tab.querySelector('.nmda-tab-icon');
      const tabName = String(tab.dataset.tab || '');
      const name = ({ batch:'batch', review:'review', dispatch:'dispatch', utilities:'batch' })[tabName] || 'source';
      setUnifiedIcon(iconHost, name);
    });

    const directMap = new Map([
      ['#nmda-import-drop-zone .nmda-import-drop-zone-icon span','import'],
      ['label[for="nmda-import-file"] .nmda-source-action-icon','file'],
      ['label[for="nmda-import-dir"] .nmda-source-action-icon','folder'],
      ['.nmda-context-cue-icon','roster'],
      ['.nmda-mail-handoff-mark','app'],
      ['.nmda-attachment-manager-drop-icon','attachment'],
      ['.nmda-classify-search > span','search'],
      ['.nmda-review-search > span','search'],
      ['.nmda-review-problem-shape','warning'],
      ['.nmda-plan-motion-check','success'],
      ['.nmda-supplement-dialog .nmda-dialog-status-icon','success'],
      ['.nmda-attachment-target-toolbar label > span','search'],
      ['.nmda-classify-folder-icon','folder'],
      ['.nmda-review-trash-icon','trash']
    ]);
    directMap.forEach((name, selector) => root.querySelectorAll(selector).forEach(el => setUnifiedIcon(el, name)));

    root.querySelectorAll('.nmda-classify-dropzone .nmda-drop-icon').forEach(el => {
      const purpose = el.closest('.nmda-classify-dropzone')?.dataset.dropPurpose || '';
      const name = ({ mail:'mail', roster:'roster', attachment:'attachment', review:'warning', ignored:'ignored' })[purpose] || textIconToName(el.textContent) || 'source';
      setUnifiedIcon(el, name);
    });

    root.querySelectorAll('.nmda-source-item-icon, .nmda-review-source-badge .nmda-source-item-icon, .nmda-dialog-status-icon, .nmda-support-view-toggle > button > span:first-child, .nmda-inspector-review-note > span:first-child').forEach(el => {
      const name = textIconToName(el.textContent) || (el.closest('.nmda-inspector-review-note') ? 'warning' : 'source');
      setUnifiedIcon(el, name || 'source');
    });
  }

  function buildUI() {
    const root = document.createElement('div');
    root.id = 'nmda-root';
    root.innerHTML = `
      <button id="nmda-launcher" type="button" title="打开 SmartMail Ops" aria-label="打开 SmartMail Ops">
        <span class="nmda-launcher-mark">N</span><span class="nmda-launcher-dot"></span>
      </button>
      <section id="nmda-panel" hidden aria-label="SmartMail Ops">
        <header class="nmda-head">
          <div class="nmda-brand">
            <div class="nmda-brand-mark">N</div>
            <div>
              <div class="nmda-title">SmartMail Ops</div>
              <div class="nmda-subtitle">外联运营</div>
            </div>
          </div>
          <div class="nmda-head-actions">
            <div id="nmda-connection-mount" data-workspace-mount="mailbox-connection"></div>
            <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-reset-all-entry" id="nmda-reset-all-data" type="button" title="清除当前工作内容并重新开始">重新开始</button>
            <button class="nmda-icon-btn" id="nmda-expand" type="button" title="全屏 / 还原">⛶</button>
            <button class="nmda-icon-btn nmda-close" id="nmda-close" type="button" title="关闭">×</button>
          </div>
        </header>

        <div data-workspace-mount="tabs"></div>
        <main class="nmda-main">
          <div data-workspace-mount="page-heads"></div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page nmda-bulk-workbench" data-pane="batch" data-phase="empty">
            <div class="nmda-workflow-stage-head" id="nmda-stage-prepare">
              <span class="nmda-stage-number">01</span><div><strong>准备邮件</strong><small>把邮件资料加入本批次。</small></div>
            </div>
            <div class="nmda-ingest-workspace nmda-ingest-workspace-v2">
              <div class="nmda-card nmda-ingest-source-card" id="nmda-import-card">
                <input id="nmda-import-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip,.pdf,.ppt,.pptx,.rtf,.png,.jpg,.jpeg,.gif,.webp,.svg,.rar,.7z">
                <input id="nmda-import-dir" type="file" webkitdirectory multiple hidden>
                <input id="nmda-roster-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <div data-workspace-mount="import-intake" style="display:contents"></div>
                <div data-workspace-mount="source-inventory" style="display:contents"></div>
                <section class="nmda-import-dedupe-card nmda-roster-audit-card" id="nmda-roster-audit-card" hidden>
                  <div class="nmda-import-dedupe-head"><div><span>导入查重</span><strong>批次重复 + 邮箱历史防重</strong></div><div class="nmda-import-dedupe-head-actions"><small id="nmda-import-dedupe-state">正在核验</small><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-dedupe-refresh-mailbox" type="button">重新核验</button></div></div>
                  <input id="nmda-roster-enabled" type="checkbox" checked hidden>
                  <input id="nmda-roster-auto-school" type="checkbox" checked hidden>
                  <input id="nmda-roster-strict" type="checkbox" hidden>
                  <div id="nmda-roster-audit-summary" class="nmda-ingest-health"></div>
                  <div id="nmda-roster-audit-note" class="nmda-review-guidance"></div>
                  <section class="nmda-draft-history-filter" id="nmda-draft-history-filter" hidden>
                    <div class="nmda-draft-history-filter-head">
                      <div><strong>已有草稿命中 <span id="nmda-draft-history-count">0</span> 封</strong><small>这些邮件在网易草稿箱中已有对应收件人，不做正文版本对比。</small></div>
                      <span>草稿防重</span>
                    </div>
                    <div class="nmda-draft-history-filter-list" id="nmda-draft-history-list"></div>
                    <div class="nmda-draft-history-filter-actions">
                      <small id="nmda-draft-history-hint">默认勾选全部命中项；筛除后可直接到草稿箱继续处理已有 Draft。</small>
                      <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary" id="nmda-draft-history-exclude" type="button">筛除所选</button><button class="nmda-btn" id="nmda-draft-history-keep" type="button">仍保留所选</button></div>
                    </div>
                  </section>
                  <section class="nmda-duplicate-decision nmda-import-duplicate-decision" id="nmda-duplicate-decision" hidden>
                    <div class="nmda-duplicate-decision-head">
                      <div><strong id="nmda-duplicate-decision-title">发现重复邮件</strong><small id="nmda-duplicate-decision-copy">在导入阶段决定实际进入本批次的版本。</small></div>
                      <span class="nmda-duplicate-kind" id="nmda-duplicate-decision-kind">重复</span>
                    </div>
                    <div class="nmda-duplicate-candidates" id="nmda-duplicate-candidates"></div>
                    <div class="nmda-duplicate-actions">
                      <span class="nmda-hint" id="nmda-duplicate-decision-hint">默认勾选信息更完整的一封；也可以明确保留多封。</span>
                      <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary" id="nmda-duplicate-keep-selected" type="button">保留所选（1）</button><button class="nmda-btn" id="nmda-duplicate-keep-all" type="button">全部保留</button></div>
                    </div>
                  </section>
                  <details class="nmda-roster-details"><summary>查看查重依据</summary><div id="nmda-roster-audit-details" class="nmda-roster-audit-details"></div></details>
                </section>

              </div>

              <div class="nmda-supplement-preflight" id="nmda-supplement-preflight" hidden aria-hidden="true">
                <section class="nmda-supplement-dialog nmda-classify-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-supplement-title">
                  <header class="nmda-classify-head">
                    <div class="nmda-classify-head-main">
                      <div class="nmda-supplement-head-icon" data-state="ok">✓</div>
                      <div>
                        <span class="nmda-supplement-kicker">导入完成</span>
                        <h3 id="nmda-supplement-title">确认文件用途</h3>
                        <p>确认有疑问的文件即可。</p>
                      </div>
                    </div>
                    <div class="nmda-classify-head-summary" id="nmda-preflight-routing-chips" aria-label="分类概览"></div>
                  </header>

                  <nav class="nmda-classify-modebar" aria-label="导入核验步骤">
                    <button class="is-active" type="button" data-preflight-view="files"><span>1</span><strong>核验文件</strong><small>确认用途</small></button>
                    <button type="button" data-preflight-view="support"><span>2</span><strong>参考名单</strong><small>可选核对来源</small></button>
                  </nav>

                  <div class="nmda-classify-workspace" data-preflight-view="files">
                    <div class="nmda-classify-files-view" data-preflight-panel="files">
                    <aside class="nmda-classify-sidebar">
                      <div class="nmda-classify-pane-head">
                        <div><span>目录 / 批次</span><strong id="nmda-preflight-directory-title">全部文件</strong></div>
                        <span id="nmda-preflight-directory-count">0</span>
                      </div>
                      <div class="nmda-classify-directory-nav" id="nmda-preflight-directory-nav"></div>


                    </aside>

                    <section class="nmda-preflight-source-routing nmda-classify-main" id="nmda-preflight-source-routing">
                      <div class="nmda-classify-toolbar">
                        <div class="nmda-classify-toolbar-title">
                          <strong id="nmda-preflight-source-routing-summary">文件列表</strong>
                          <small id="nmda-preflight-source-routing-subtitle">点击文件在右侧查看内容；用途不对时再修改。</small>
                        </div>
                        <div class="nmda-classify-toolbar-actions">
                          <label class="nmda-classify-search"><span>⌕</span><input id="nmda-preflight-source-search" type="search" placeholder="搜索文件名或目录"></label>
                        </div>
                      </div>

                      <div class="nmda-classify-dropzones" id="nmda-preflight-dropzones" aria-label="拖拽文件重新分类">
                        <button class="nmda-classify-dropzone" data-drop-purpose="mail" data-tone="mail" type="button"><span class="nmda-drop-icon">✉</span><span><strong>邮件</strong><small>拖到这里</small></span><b data-drop-count="mail">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="roster" data-tone="roster" type="button"><span class="nmda-drop-icon">名</span><span><strong>总名单</strong><small>拖到这里</small></span><b data-drop-count="roster">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="attachment" data-tone="attachment" type="button"><span class="nmda-drop-icon">附</span><span><strong>附件</strong><small>拖到这里</small></span><b data-drop-count="attachment">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="review" data-tone="review" type="button"><span class="nmda-drop-icon">!</span><span><strong>待确认</strong><small>稍后再看</small></span><b data-drop-count="review">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="ignored" data-tone="ignored" type="button"><span class="nmda-drop-icon">×</span><span><strong>暂不使用</strong><small>本批次忽略</small></span><b data-drop-count="ignored">0</b></button>
                      </div>

                      <div class="nmda-preflight-routing-tip" hidden><span>↕</span><small>拖动文件时会出现快速归类区域。</small></div>
                      <div class="nmda-preflight-source-routing-list nmda-classify-file-list" id="nmda-preflight-source-routing-list"></div>
                    </section>

                    <aside class="nmda-classify-inspector-pane" aria-label="当前文件核验">
                      <div class="nmda-source-inspector-empty" id="nmda-source-inspector-empty">
                        <span class="nmda-source-inspector-empty-icon">⌁</span>
                        <strong>选择一个文件查看内容</strong>
                        <small>分类正确无需操作；只有发现用途不对时才修改。</small>
                      </div>
                      <div class="nmda-source-inspector-card" id="nmda-source-inspector-card" hidden>
                        <div class="nmda-source-inspector-card-head">
                          <button class="nmda-source-inspector-close" id="nmda-source-inspector-close" type="button" aria-label="返回文件列表">←</button>
                          <div><span>当前文件</span><strong id="nmda-source-inspector-title">文件核验</strong></div>
                        </div>
                        <div class="nmda-source-inspector-overview" id="nmda-source-inspector-overview"></div>
                        <div class="nmda-source-inspector-actions" id="nmda-source-inspector-actions"></div>
                        <div class="nmda-source-inspector-content" id="nmda-source-inspector-content"></div>
                        <button class="nmda-source-next-review" id="nmda-source-next-review" type="button" hidden>查看下一个待确认 →</button>
                      </div>
                    </aside>
                    </div>

                    <section class="nmda-classify-support-view" data-preflight-panel="support" data-support-view="roster" hidden>
                      <header class="nmda-support-view-head">
                        <div><span>批次资料</span><strong>按需要补充</strong></div>
                        <nav class="nmda-support-modebar" aria-label="批次资料类型">
                          <button class="is-active" type="button" data-support-view="roster"><span>名</span><strong>参考名单</strong></button>
                          <button type="button" data-support-view="attachment"><span>附</span><strong>附件</strong></button>
                        </nav>
                      </header>
                    <section class="nmda-classify-supplements nmda-classify-upload-dock" id="nmda-preflight-supplements" aria-label="批次资料">
                        <div class="nmda-classify-supplement-stack">
                          <article class="nmda-supplement-box nmda-supplement-box-compact" id="nmda-preflight-roster-box" data-support-pane="roster" data-state="pending">
                            <div class="nmda-supplement-box-icon">名</div>
                            <div class="nmda-supplement-box-main">
                              <strong id="nmda-preflight-roster-title">参考总名单</strong>
                              <small id="nmda-preflight-roster-copy">已有总名单时可加入。</small>
                              <div class="nmda-supplement-status" id="nmda-preflight-roster-status">尚未添加</div>
                            </div>
                            <div class="nmda-supplement-actions">
                              <label class="nmda-btn nmda-btn-small nmda-btn-primary" for="nmda-roster-file">上传名单</label>
                            </div>
                          </article>
                          <article class="nmda-supplement-box nmda-supplement-box-compact nmda-supplement-box-attachment" id="nmda-preflight-attachment-box" data-support-pane="attachment" data-state="pending">
                            <div class="nmda-supplement-box-icon">附</div>
                            <div class="nmda-supplement-box-main">
                              <strong id="nmda-preflight-attachment-title">附件工作台</strong>
                              <small id="nmda-preflight-attachment-copy">所有附件统一在一个面板中配置发送范围。</small>
                              <div class="nmda-attachment-requirements" id="nmda-preflight-attachment-requirements"></div>
                              <div class="nmda-supplement-status" id="nmda-preflight-attachment-status">尚未添加</div>
                              <div class="nmda-attachment-assets nmda-attachment-assets-inline" id="nmda-preflight-attachment-assets" hidden>
                                <div class="nmda-attachment-assets-head"><strong>附件状态</strong><span id="nmda-preflight-attachment-assets-count"></span></div>
                                <div class="nmda-attachment-assets-list" id="nmda-preflight-attachment-assets-list"></div>
                              </div>
                            </div>
                            <div class="nmda-supplement-actions">
                              <button class="nmda-btn nmda-btn-small nmda-btn-primary" type="button" data-open-attachment-manager>打开附件工作台</button>
                            </div>
                          </article>
                        </div>
                      </section>
                    </section>
                  </div>

                  <footer class="nmda-supplement-foot nmda-classify-foot">
                    <button class="nmda-btn nmda-btn-quiet" id="nmda-close-supplement-preflight" type="button">返回上传</button>
                    <div class="nmda-classify-foot-summary"><strong id="nmda-preflight-batch-summary">正在核验本批次</strong><small>无误即可继续。</small></div>
                    <button class="nmda-btn nmda-btn-primary" id="nmda-complete-supplement-preflight" type="button">完成分类</button>
                  </footer>
                </section>
              </div>

              <div class="nmda-attachment-manager-overlay" id="nmda-attachment-manager-overlay" hidden aria-hidden="true">
                <section class="nmda-attachment-manager" role="region" aria-labelledby="nmda-attachment-manager-title">
                  <div class="nmda-attachment-manager-head">
                    <div><span class="nmda-supplement-kicker">统一附件配置</span><h3 id="nmda-attachment-manager-title">附件工作台</h3><p>新附件默认适用于全部邮件；如有需要，可改为自动匹配或精确指定邮件。</p></div>
                    <button class="nmda-icon-btn" id="nmda-close-attachment-manager" type="button" aria-label="关闭附件工作台">×</button>
                  </div>
                  <div class="nmda-attachment-manager-body">
                    <div class="nmda-attachment-workspace-stats" id="nmda-attachment-manager-summary">尚未加入附件。</div>
                    <div class="nmda-attachment-manager-drop" id="nmda-attachment-manager-drop" tabindex="0" role="button" aria-label="拖入或选择附件">
                      <span class="nmda-attachment-manager-drop-icon">⇧</span>
                      <div><strong>拖入附件或文件夹</strong><small>也可以点击选择文件；文件夹会保留相对路径并参与自动匹配。</small></div>
                      <span class="nmda-attachment-manager-drop-action">选择文件</span>
                    </div>
                    <div class="nmda-attachment-manager-addbar">
                      <label class="nmda-btn nmda-btn-small nmda-btn-primary" for="nmda-attachment-files">选择文件</label>
                      <label class="nmda-btn nmda-btn-small" for="nmda-attachment-dir">选择文件夹</label>
                      <input id="nmda-attachment-files" type="file" multiple hidden>
                      <input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden>
                      <span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span>
                    </div>
                    <section class="nmda-attachment-workspace-section">
                      <header><div><strong>附件文件</strong></div><span id="nmda-attachment-manager-file-count">0 个</span></header>
                      <div class="nmda-attachment-assets" id="nmda-attachment-manager-assets">
                        <div class="nmda-attachment-assets-list nmda-attachment-workspace-list" id="nmda-attachment-manager-list"></div>
                        <div class="nmda-attachment-assets-empty" id="nmda-attachment-manager-empty">还没有附件。把文件拖到上方即可开始配置。</div>
                      </div>
                    </section>
                    <section class="nmda-attachment-target-editor" id="nmda-attachment-target-editor" hidden>
                      <header><div><span>指定邮件</span><strong id="nmda-attachment-target-title">选择适用邮件</strong></div><button class="nmda-icon-btn" id="nmda-attachment-target-close" type="button" aria-label="关闭指定邮件设置">×</button></header>
                      <div class="nmda-attachment-target-toolbar"><label><span>⌕</span><input id="nmda-attachment-target-search" type="search" placeholder="搜索收件人、主题或学校"></label><button class="nmda-btn nmda-btn-small" id="nmda-attachment-target-all" type="button">全选当前</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-attachment-target-clear" type="button">清空</button></div>
                      <div class="nmda-attachment-target-list" id="nmda-attachment-target-list"></div>
                    </section>
                    <section class="nmda-attachment-workspace-section nmda-attachment-requirement-section" id="nmda-attachment-manager-requirements-section">
                      <header><div><strong>邮件中的附件提示</strong></div><span id="nmda-attachment-manager-requirements-count">0 项</span></header>
                      <div class="nmda-attachment-requirement-list" id="nmda-attachment-manager-requirements"></div>
                    </section>
                  </div>
                  <div class="nmda-attachment-manager-foot">
                    <button class="nmda-btn nmda-btn-danger-quiet" id="nmda-manager-clear-attachments" type="button">清空附件</button>
                    <div class="nmda-row nmda-wrap"><span class="nmda-hint" id="nmda-attachment-manager-foot-note"></span><button class="nmda-btn nmda-btn-primary" id="nmda-attachment-manager-done" type="button">完成</button></div>
                  </div>
                </section>
              </div>

              <div class="nmda-card nmda-inline-review" id="nmda-inline-review" hidden>
                <div class="nmda-inline-review-top" data-workspace-mount="review-top"></div>
                <div class="nmda-review-boardbar nmda-review-boardbar-unified" data-workspace-mount="review-boardbar"></div>
                <section class="nmda-format-governance nmda-batch-standards" id="nmda-format-governance" hidden aria-label="批量处理">
                  <header class="nmda-format-governance-head nmda-batch-standards-head">
                    <div><strong>批量处理</strong><small id="nmda-batch-standards-desc">只显示当前真正需要处理的批量事项：补齐主题、处理检测到的格式偏移。</small></div>
                    <button class="nmda-icon-btn" id="nmda-format-governance-close" type="button" aria-label="关闭批量处理">×</button>
                  </header>
                  <div class="nmda-batch-standards-overview" aria-label="批量处理检查结果">
                    <span data-standard-summary="subject"><i>T</i><b>主题补齐</b><strong id="nmda-batch-standard-subject-count">0</strong><small>缺失</small></span>
                    <span data-standard-summary="format"><i>✦</i><b>格式偏移</b><strong id="nmda-batch-standard-format-count">0</strong><small>推荐</small></span>
                  </div>
                  <section class="nmda-batch-standard-card is-subject" id="nmda-batch-standard-subject">
                    <header><div><strong>主题完整性</strong><small>只补齐缺失的初始邮件主题；已有主题与跟进邮件主题保持不变。</small></div><b id="nmda-batch-standard-subject-badge">0 封</b></header>
                    <label class="nmda-batch-standard-subject-field"><span>补齐为</span><input id="nmda-batch-standard-subject-input" type="text" maxlength="240" placeholder="输入统一主题" autocomplete="off"></label>
                    <button class="nmda-batch-standard-suggestion" id="nmda-batch-standard-subject-suggestion" type="button" hidden></button>
                    <div class="nmda-batch-standard-result" id="nmda-batch-standard-subject-result">正在检查主题完整性…</div>
                  </section>
                  <section class="nmda-batch-standard-card is-format" id="nmda-batch-standard-format">
                    <header><div><strong>格式偏移</strong><small>默认只展示系统从当前邮件中检测到的偏移推荐；选择后一次批量修复。</small></div></header>
                    <div class="nmda-format-governance-suggestions" id="nmda-format-governance-suggestions"></div>
                    <div class="nmda-format-governance-queue" id="nmda-format-governance-queue" hidden></div>
                    <details class="nmda-format-governance-custom" id="nmda-format-governance-custom">
                      <summary><span><strong>自定义格式规则</strong><small>仅在推荐无法覆盖时使用</small></span><i aria-hidden="true">⌄</i></summary>
                      <div class="nmda-format-governance-custom-body">
                        <div class="nmda-format-governance-builder">
                          <label class="nmda-format-governance-phrase"><span>固定文本</span><input id="nmda-format-governance-phrase" type="text" maxlength="240" placeholder="例如：Computational Imaging" autocomplete="off"><small>精确匹配正文中的固定表达。</small></label>
                          <div class="nmda-format-governance-formats" role="group" aria-label="需要统一的格式">
                            <span>统一为</span>
                            <button class="is-active" type="button" data-governance-format="italic" aria-pressed="true" title="斜体"><em>I</em><small>斜体</small></button>
                            <button type="button" data-governance-format="bold" aria-pressed="false" title="加粗"><strong>B</strong><small>加粗</small></button>
                            <button type="button" data-governance-format="underline" aria-pressed="false" title="下划线"><u>U</u><small>下划线</small></button>
                            <button type="button" data-governance-format="strike" aria-pressed="false" title="删除线"><s>S</s><small>删除线</small></button>
                          </div>
                          <label class="nmda-format-governance-case"><input id="nmda-format-governance-case" type="checkbox" checked><span>区分大小写</span></label>
                          <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-format-governance-add" id="nmda-format-governance-add" type="button" disabled>加入本次处理</button>
                        </div>
                        <div class="nmda-format-governance-result" id="nmda-format-governance-result">输入固定文本后检查命中范围。</div>
                        <div class="nmda-format-governance-list" id="nmda-format-governance-list" hidden></div>
                        <div id="nmda-format-governance-history" class="nmda-format-governance-history"></div>
                      </div>
                    </details>
                  </section>
                  <footer class="nmda-format-governance-actions nmda-batch-standards-actions">
                    <div id="nmda-batch-standard-plan-summary" class="nmda-batch-standard-plan-summary">尚未配置可执行批量处理</div>
                    <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-format-governance-apply" type="button" disabled>应用批量处理</button>
                  </footer>
                </section>

                <div class="nmda-review-batchbar" id="nmda-review-batchbar" data-workspace-mount="review-batchbar" hidden></div>
                <div class="nmda-review-page-empty" id="nmda-review-page-empty" data-workspace-mount="review-empty"></div>
                <div class="nmda-review-preview-toolbar" id="nmda-review-preview-toolbar" data-workspace-mount="review-preview-toolbar" hidden></div>
                <aside class="nmda-review-preview-rail" id="nmda-review-preview-rail" hidden aria-label="邮件导航">
                  <div class="nmda-review-preview-rail-head"><div><strong>邮件</strong><small id="nmda-review-preview-rail-count">0</small></div></div>
                  <div class="nmda-review-preview-rail-list" id="nmda-review-preview-rail-list" data-workspace-mount="review-rail"></div>
                </aside>
                <div id="nmda-review-queue" class="nmda-review-queue nmda-review-mail-grid"><div data-workspace-mount="review-board"></div><div id="nmda-review-preview-pages" data-workspace-mount="review-preview" hidden></div></div>
                <div class="nmda-preview-format-dock" id="nmda-preview-format-dock" aria-label="批量处理">
                  <button class="nmda-review-format-entry nmda-preview-format-entry" id="nmda-review-format-governance" type="button" aria-expanded="false" title="处理可批量执行的规范与派生规则">
                    <span class="nmda-preview-format-glyph nmda-preview-standard-glyph" aria-hidden="true"><i></i><b></b></span>
                    <span class="nmda-preview-format-label">批量处理</span>
                    <strong id="nmda-preview-format-drift-count" hidden>0</strong>
                  </button>
                </div>

              </div>


            </div>




          </section>


          <section class="nmda-tabpane nmda-page nmda-dispatch-page" data-pane="dispatch" hidden>
            <div class="nmda-dispatch-intro">
              <div><strong>待发送邮件</strong><small></small></div>
              <div class="nmda-dispatch-source-summary" id="nmda-dispatch-source-summary"></div>
            </div>
            <div class="nmda-batch-empty" id="nmda-batch-empty" hidden></div>
            <div class="nmda-card nmda-list-card nmda-planning-workspace" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head nmda-planning-head">
                <div><div class="nmda-card-title">安排本次邮件</div><div class="nmda-card-desc"></div></div>
                <div class="nmda-planning-head-actions">
                  <div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline" data-workspace-mount="dispatch-summary"></div>
                  <button class="nmda-btn nmda-btn-small nmda-btn-primary nmda-schedule-entry" id="nmda-open-schedule-modal" type="button" title="设置本次发送的地区、日期、工作日与当地时间"><span>设置时间安排</span><small>日期 · 工作日 · 当地时间</small></button>
                </div>
              </div>
              <div class="nmda-planning-overview" id="nmda-planning-overview" data-workspace-mount="planning-overview"></div>
              <details class="nmda-scope-tools" id="nmda-scope-tools">
                <summary><span><strong>筛选邮件</strong></span><span class="nmda-scope-toggle">展开</span></summary>
                <div class="nmda-task-toolbar">
                  <label class="nmda-search-field"><input id="nmda-batch-search" type="search" placeholder="搜索收件人 / 学校 / 邮箱"></label>
                  <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">纳入筛选结果</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-selection" type="button">排除全部</button>
                </div>
              </details>
              <input id="nmda-batch-tag-include" type="hidden"><button id="nmda-clear-tag-filter" type="button" hidden></button><div id="nmda-batch-tag-chips" hidden></div>
              <input id="nmda-bulk-tag-value" type="hidden"><button id="nmda-bulk-add-tag" type="button" hidden></button><button id="nmda-bulk-remove-tag" type="button" hidden></button><button id="nmda-bulk-disable" type="button" hidden></button>
              <div class="nmda-table-wrap nmda-batch-table-wrap"><div class="nmda-planning-board" id="nmda-preview-body" data-workspace-mount="planning-board"></div></div>
              <div class="nmda-mail-handoff-bar" id="nmda-mail-handoff-bar">
                <div class="nmda-mail-handoff-copy"><span class="nmda-mail-handoff-mark" aria-hidden="true">N</span><div><strong id="nmda-batch-status">准备在网易邮箱创建草稿</strong><div class="nmda-create-preflight" id="nmda-create-preflight" data-workspace-mount="execution-preflight"></div></div></div>
                <label class="nmda-execution-mode" title="创建 163 草稿时，确保相邻正文段落之间至少保留一个空行；不会改变这里的正文内容"><input id="nmda-compose-paragraph-spacing" type="checkbox" checked><span>段落间留空行</span></label>
                <label class="nmda-execution-mode nmda-execution-mode-fast" title="优先使用快速创建；遇到不兼容情况会自动切换为标准模式。"><input id="nmda-fast-compose" type="checkbox"><span>快速创建</span></label>
                <label class="nmda-execution-mode" title="每封邮件填写完成后暂停，人工检查后再保存"><input id="nmda-pause-every-time" type="checkbox"><span>每封填写后暂停</span></label>
                <button class="nmda-btn nmda-btn-primary nmda-mail-handoff-action" id="nmda-batch-start" type="button">前往网易邮箱并创建所选草稿</button>
                <button id="nmda-batch-stop" type="button" hidden disabled>当前封后停止</button>
              </div>
            </div>

            <section class="nmda-roster-planner-view" id="nmda-roster-planner-view" hidden aria-labelledby="nmda-roster-planner-title">
              <header class="nmda-roster-planner-view-head">
                <div class="nmda-roster-planner-view-leading">
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-planner-back" type="button">← 返回时间安排</button>
                  <div><span class="nmda-dialog-eyebrow">Within-school priority · Optional</span><h2 id="nmda-roster-planner-title">同校优先级 · 可选</h2><p>仅在需要明确同一学校内的联系先后时设置 R1/R2…；它只是时间安排的可选约束，不设置时按现有名单顺序正常排期。</p></div>
                </div>
                <div class="nmda-roster-planner-view-actions">
                  <button class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-roster-planner-done" type="button">完成并返回时间安排</button>
                </div>
              </header>

              <div class="nmda-roster-planner-workspace">
                <div class="nmda-roster-planner-commandbar">
                  <div class="nmda-roster-source-cluster">
                    <div class="nmda-roster-planner-source">
                      <span>总名单</span>
                      <select id="nmda-roster-planner-source" aria-label="选择名单工作表"></select>
                    </div>
                    <div class="nmda-roster-planner-summary" id="nmda-roster-planner-summary">等待读取总名单…</div>
                  </div>

                  <div class="nmda-roster-color-strip" aria-label="按格式特征快速选择联系人">
                    <span class="nmda-roster-color-strip-label">快速选人</span>
                    <div class="nmda-roster-visual-groups" id="nmda-roster-visual-groups"></div>
                  </div>

                  <div class="nmda-roster-planner-canvas-tools">
                    <span class="nmda-roster-column-focus" id="nmda-roster-column-focus">正在整理名单…</span>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-roster-column-toggle" id="nmda-roster-column-toggle" type="button" hidden>显示全部列</button>
                    <div class="nmda-roster-planner-selection-mini" id="nmda-roster-selection-mini">尚未选择</div>
                  </div>
                </div>

                <div class="nmda-roster-intent-summary" id="nmda-roster-intent-summary"></div>

                <main class="nmda-roster-planner-canvas">
                  <div class="nmda-roster-planner-canvas-head">
                    <div class="nmda-roster-selection-context">
                      <div class="nmda-roster-selection-copy">
                        <strong id="nmda-roster-selection-label">尚未选择</strong>
                        <small id="nmda-roster-selection-detail">可选：新建 R1/R2… 后按颜色 / 特征选择或直接框选联系人加入；也可以跳过。</small>
                      </div>
                      <div class="nmda-roster-active-batch" id="nmda-roster-active-batch" data-state="empty">
                        <span>当前同校优先级</span><strong id="nmda-roster-active-batch-label">未创建</strong>
                      </div>
                      <button class="nmda-btn nmda-btn-small nmda-btn-primary nmda-roster-batch-add" id="nmda-roster-batch-add" type="button" disabled>加入当前优先级</button>
                      <button class="nmda-btn nmda-btn-small nmda-roster-batch-create" id="nmda-roster-batch-create" type="button">＋ 新建优先级</button>
                      <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-roster-batch-clear" id="nmda-roster-batch-clear" type="button" disabled>移出优先级</button>
                    </div>
                  </div>
                  <div class="nmda-roster-sheet-viewport" id="nmda-roster-sheet-viewport" tabindex="0" aria-label="总名单预览，可拖动框选联系人">
                    <table class="nmda-roster-sheet-table" id="nmda-roster-sheet-table"></table>
                  </div>
                </main>
              </div>
            </section>

            <div class="nmda-workflow-modal-overlay" id="nmda-schedule-modal" hidden>
              <section class="nmda-workflow-dialog nmda-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-schedule-dialog-title">
                <header class="nmda-workflow-dialog-head">
                  <div><span class="nmda-dialog-eyebrow">本次发送计划</span><h3 id="nmda-schedule-dialog-title">时间安排</h3><p>不用逐封填写时间。先确定收件人当地的发送窗口，再按需要设置避让规则，最后一次生成本批时间。</p></div>
                  <button class="nmda-dialog-close" id="nmda-close-schedule-modal" type="button" aria-label="关闭时间安排">×</button>
                </header>
                <section class="nmda-schedule-dialog-body" id="nmda-scheduler-card">
                  <div class="nmda-schedule-guide" id="nmda-schedule-guide" aria-label="时间安排步骤">
                    <div class="nmda-schedule-guide-step" data-schedule-guide-step="1"><b>1</b><span><strong>确定发送窗口</strong><small>地区、开始日期、工作日、当地时间</small></span></div>
                    <i aria-hidden="true">→</i>
                    <div class="nmda-schedule-guide-step" data-schedule-guide-step="2"><b>2</b><span><strong>按需设置保护</strong><small>同校间隔 / 限额、已有时间、假期与跳过区间</small></span></div>
                    <i aria-hidden="true">→</i>
                    <div class="nmda-schedule-guide-step" data-schedule-guide-step="3"><b>3</b><span><strong>生成本批时间</strong><small>按规则安排日期，时间保持一致</small></span></div>
                  </div>
                  <div class="nmda-schedule-dialog-summary" id="nmda-schedule-summary"></div>
                  <div class="nmda-schedule-outcome" id="nmda-schedule-outcome" aria-live="polite"></div>
                  <div class="nmda-schedule-priority-card" id="nmda-schedule-priority-card">
                    <div class="nmda-schedule-priority-copy">
                      <span>可选约束</span>
                      <strong>同校优先级</strong>
                      <small id="nmda-schedule-priority-summary">未设置时按现有名单顺序排期。</small>
                    </div>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-schedule-open-priority" type="button">设置优先级</button>
                  </div>
                  <div class="nmda-scheduler-grid nmda-scheduler-calendar-grid">
                    <div class="nmda-schedule-section-title"><span>1</span><div><strong>发送窗口</strong><small>这四项决定“从什么时候开始、在哪些日子、按哪里的几点发送”。</small></div></div>
                    <label class="nmda-field nmda-schedule-region-field"><span class="nmda-label">收件人地区 · Local time <em>关键</em></span><select id="nmda-rule-time-zone">
                      <option value="system">本机 / 网易当前时区</option>
                      <option value="Asia/Shanghai">中国 · 上海</option>
                      <option value="Asia/Hong_Kong">中国香港</option>
                      <option value="Asia/Singapore">新加坡</option>
                      <option value="Asia/Kuala_Lumpur">马来西亚 · 吉隆坡</option>
                      <option value="Australia/Sydney">澳大利亚 · Sydney / Melbourne</option>
                      <option value="Australia/Brisbane">澳大利亚 · Brisbane</option>
                      <option value="Australia/Adelaide">澳大利亚 · Adelaide</option>
                      <option value="Australia/Perth">澳大利亚 · Perth</option>
                      <option value="Pacific/Auckland">新西兰 · Auckland</option>
                      <option value="Europe/London">英国 · London</option>
                      <option value="America/New_York">美国 / 加拿大 · Eastern</option>
                      <option value="America/Chicago">美国 · Central</option>
                      <option value="America/Denver">美国 · Mountain</option>
                      <option value="America/Los_Angeles">美国 / 加拿大 · Pacific</option>
                      <option value="America/Toronto">加拿大 · Toronto</option>
                      <option value="America/Vancouver">加拿大 · Vancouver</option>
                    </select><small class="nmda-field-hint">选择收件人所在地区。你填写的是当地时间，执行时会自动换算到网易当前时区。</small></label>
                    <label class="nmda-field"><span class="nmda-label">开始日期 <em>关键</em></span><span class="nmda-smart-temporal"><input id="nmda-rule-start-date" type="date" data-smart-temporal="date" data-smart-role="schedule-start"><button class="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open aria-label="快速设置开始日期" title="快速设置">⌄</button></span></label>
                    <label class="nmda-field"><span class="nmda-label">当地发送时间 <em>关键</em></span><span class="nmda-smart-temporal"><input id="nmda-rule-local-time" type="time" step="300" value="07:30" data-smart-temporal="time" data-smart-role="schedule-time"><button class="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open aria-label="快速设置发送时间" title="快速设置">⌄</button></span></label>
                    <label class="nmda-field"><span class="nmda-label">每校同一天最多联系</span><input id="nmda-rule-max-school" type="number" min="1" max="20" step="1" value="1"><small class="nmda-field-hint">建议保持 1；用于避免同一学校同一天集中联系多人。</small></label>
                    <label class="nmda-field"><span class="nmda-label">同校联系至少间隔</span><div class="nmda-smart-duration"><input id="nmda-rule-school-interval" type="number" min="0" max="365" step="1" value="7"><b>天</b></div><small class="nmda-field-hint">只约束同一学校；例如 7 天表示同校两次联系至少相隔 7 个自然日。不同学校仍可在同一天、同一时间发送。</small></label>
                    <div class="nmda-field nmda-workday-field"><span class="nmda-label">发送工作日 <em>关键</em></span><div class="nmda-workday-picker" role="group" aria-label="选择发送工作日">
                      <label><input type="checkbox" data-schedule-weekday value="1"><span>周一</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="2"><span>周二</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="3"><span>周三</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="4" checked><span>周四</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="5"><span>周五</span></label>
                    </div><small class="nmda-field-hint">系统只会把新邮件放到这些工作日；例如只选周四，就会按每个可用周四向后排。</small></div>
                    <div class="nmda-schedule-section-title nmda-schedule-section-title-secondary"><span>2</span><div><strong>避让与保护</strong><small>通常保持默认即可；只有遇到假期、已有排期或特殊空档时再调整。</small></div></div>
                    <div class="nmda-field nmda-skip-range-field"><span class="nmda-label">不发送的日期范围 · 可选</span><div class="nmda-skip-range-inputs"><span class="nmda-smart-temporal"><input id="nmda-rule-skip-start" type="date" aria-label="跳过开始日期" data-smart-temporal="date" data-smart-role="skip-start"><button class="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open aria-label="快速设置跳过开始日期" title="快速设置">⌄</button></span><span>至</span><span class="nmda-smart-temporal"><input id="nmda-rule-skip-end" type="date" aria-label="跳过结束日期" data-smart-temporal="date" data-smart-role="skip-end"><button class="nmda-smart-temporal-trigger" type="button" data-smart-temporal-open aria-label="快速设置跳过结束日期" title="快速设置">⌄</button></span></div><small class="nmda-field-hint">例如学校假期、圣诞节或你明确不希望发送的一段时间；留空即不额外跳过。</small></div>
                    <label class="nmda-check-card"><input id="nmda-rule-preserve-existing" type="checkbox" checked><span><strong>保留已经手工设置的时间</strong><small>重排时不覆盖你已经明确指定的单封时间。</small></span></label>
                    <label class="nmda-check-card"><input id="nmda-rule-include-mailbox-scheduled" type="checkbox" checked><span><strong>避开网易里已经定时的邮件</strong><small>读取现有定时草稿，只用于同校日期间隔 / 当日限额校验；不同学校同一分钟可同时排期。</small></span></label>
                    <label class="nmda-check-card nmda-schedule-wide-check"><input id="nmda-rule-skip-holidays" type="checkbox" checked><span><strong>避开可识别的当地节假日</strong><small>按收件人地区尽量跳过可识别的公共假期。</small></span></label>
                  </div>
                  <div class="nmda-schedule-rule-preview" id="nmda-schedule-rule-preview">周四 · 07:30 当地时间 · 同校至少间隔 7 天 · 每校每个发送日最多 1 位。</div>
                </section>
                <footer class="nmda-workflow-dialog-foot">
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-auto-schedule" type="button">清除自动时间</button>
                  <div class="nmda-dialog-foot-spacer"></div>
                  <button class="nmda-btn nmda-btn-small" id="nmda-cancel-schedule-modal" type="button">取消</button>
                  <button class="nmda-btn nmda-btn-primary nmda-btn-small nmda-schedule-apply" id="nmda-apply-schedule" type="button"><span>生成本批时间</span><small id="nmda-apply-schedule-hint">按上方规则自动安排</small></button>
                </footer>
              </section>
            </div>

          </section>


          <section class="nmda-tabpane nmda-page nmda-dashboard-page" data-pane="dashboard" hidden aria-label="成效看板">
            <div data-workspace-mount="dashboard"></div>
          </section>

          <section class="nmda-tabpane nmda-page nmda-utilities-page" data-pane="utilities" hidden data-utility-view="home">
            <section class="nmda-utilities-home" id="nmda-utilities-home" aria-label="工具">
              <div data-workspace-mount="utilities-home"></div>
            </section>

            <section class="nmda-utility-workspace nmda-utility-monitor-workspace" data-utility-workspace="monitor" hidden>
              <header class="nmda-utility-workspace-head">
                <button class="nmda-utility-back" type="button" data-utility-back>← 工具</button>
                <div><small>联系人跟进</small><strong>邮件监测</strong><span>按联系人汇总联系次数、回复、跟进与下一步。</span></div>
              </header>
              <div data-workspace-mount="monitor"></div>
            </section>

            <section class="nmda-utility-workspace nmda-draft-attachment-workspace" data-utility-workspace="draft-attachments" hidden>
              <header class="nmda-utility-workspace-head">
                <button class="nmda-utility-back" type="button" data-utility-back>← 工具</button>
                <div><small>草稿附件更新</small><strong>极速附件</strong><span>批量替换草稿中的旧附件，并保留正文、收件人、主题和原发送时间。</span></div>
                <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-draft-attachment-refresh" type="button">重新读取草稿箱</button>
              </header>

              <div class="nmda-draft-attachment-overview">
                <article><small>草稿箱</small><strong id="nmda-draft-attachment-draft-count">0</strong><span>封已读取</span></article>
                <article><small>含附件</small><strong id="nmda-draft-attachment-mail-count">0</strong><span>封草稿</span></article>
                <article><small>附件版本</small><strong id="nmda-draft-attachment-version-count">0</strong><span>组旧附件</span></article>
                <article><small>当前影响</small><strong id="nmda-draft-attachment-target-count">0</strong><span>封待更新</span></article>
              </div>

              <div class="nmda-draft-attachment-layout">
                <section class="nmda-draft-attachment-browser">
                  <header><div><small>草稿附件</small><strong>选择要替换的旧附件</strong><span>按文件名与大小区分版本。</span></div><input id="nmda-draft-attachment-search" type="search" placeholder="搜索附件名"></header>
                  <div class="nmda-draft-attachment-groups" id="nmda-draft-attachment-groups"></div>
                  <div class="nmda-draft-attachment-empty" id="nmda-draft-attachment-empty">正在读取草稿箱…</div>
                </section>

                <section class="nmda-draft-attachment-replace">
                  <header><div><small>替换范围</small><strong id="nmda-draft-attachment-plan-title">选择一个旧附件版本</strong><span id="nmda-draft-attachment-plan-copy">选择后会显示受影响的全部草稿。</span></div></header>
                  <div class="nmda-draft-attachment-targets" id="nmda-draft-attachment-targets"></div>
                  <input id="nmda-draft-attachment-file" type="file" hidden>
                  <button class="nmda-draft-attachment-drop" id="nmda-draft-attachment-drop" type="button" disabled>
                    <span class="nmda-draft-attachment-drop-mark" aria-hidden="true">⇧</span>
                    <span><strong id="nmda-draft-attachment-new-name">选择新版附件</strong><small id="nmda-draft-attachment-new-meta">只需选择一次；每封邮件都会先核对新草稿，再替换旧草稿。</small></span>
                    <b>选择文件</b>
                  </button>
                  <div class="nmda-draft-attachment-safety"><strong>安全替换</strong><span>先创建新草稿并核对正文、收件人、主题、发送时间和附件；确认一致后才替换旧草稿，失败时保留原稿。</span></div>
                  <section class="nmda-draft-attachment-motion" id="nmda-draft-attachment-motion" data-phase="idle" hidden aria-live="polite">
                    <div class="nmda-draft-motion-head">
                      <span><small>附件更新进度</small><strong id="nmda-draft-motion-title">准备附件更新</strong></span>
                      <b id="nmda-draft-motion-count">0 / 0</b>
                    </div>
                    <div class="nmda-draft-motion-scene" aria-hidden="true">
                      <div class="nmda-draft-motion-mail is-old"><i></i><span>旧草稿</span><em id="nmda-draft-motion-old-file">旧附件</em></div>
                      <div class="nmda-draft-motion-route"><span class="nmda-draft-motion-packet">↗</span><i></i></div>
                      <div class="nmda-draft-motion-mail is-new"><i></i><span>新草稿</span><em id="nmda-draft-motion-new-file">新版附件</em></div>
                      <div class="nmda-draft-motion-verify"><span>✓</span><small>已核对</small></div>
                    </div>
                    <div class="nmda-draft-motion-stages" id="nmda-draft-motion-stages">
                      <span data-draft-motion-stage="read"><i></i><b>读取原稿</b></span>
                      <span data-draft-motion-stage="clone"><i></i><b>创建新稿</b></span>
                      <span data-draft-motion-stage="attachments"><i></i><b>更新附件</b></span>
                      <span data-draft-motion-stage="verify"><i></i><b>核对内容</b></span>
                      <span data-draft-motion-stage="swap"><i></i><b>完成替换</b></span>
                    </div>
                    <div class="nmda-draft-motion-current">
                      <strong id="nmda-draft-motion-subject">等待开始</strong>
                      <span id="nmda-draft-motion-message">开始后会切换到 163 邮箱，并同步显示当前进度。</span>
                    </div>
                  </section>
                  <div class="nmda-draft-attachment-progress" id="nmda-draft-attachment-progress" hidden></div>
                  <div class="nmda-draft-attachment-actions">
                    <button class="nmda-btn nmda-btn-quiet" id="nmda-draft-attachment-cancel" type="button" hidden>停止本次更新</button>
                    <button class="nmda-btn nmda-btn-primary" id="nmda-draft-attachment-run" type="button" disabled>更新选中的草稿</button>
                  </div>
                  <div class="nmda-draft-attachment-result" id="nmda-draft-attachment-result" hidden></div>
                </section>
              </div>
            </section>
          </section>

        </main>
      </section>`;
    document.documentElement.appendChild(root);
    decorateUnifiedIcons(root);
    return root;
  }

  globalThis.NMDAWorkspaceView = Object.freeze({ buildUI, decorateUnifiedIcons, iconSvg });
})();
