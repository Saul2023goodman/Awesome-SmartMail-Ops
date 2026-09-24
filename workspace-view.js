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
                <input id="nmda-attachment-files" type="file" multiple hidden>
                <input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden>
                <div data-workspace-mount="import-intake" style="display:contents"></div>
                <div data-workspace-mount="source-inventory" style="display:contents"></div>
                <div data-workspace-mount="import-audit" style="display:contents"></div>
                <input id="nmda-roster-enabled" type="checkbox" checked hidden>
                <input id="nmda-roster-auto-school" type="checkbox" checked hidden>
                <input id="nmda-roster-strict" type="checkbox" hidden>

              </div>

              <div class="nmda-supplement-preflight" id="nmda-supplement-preflight" hidden aria-hidden="true">
                <section class="nmda-supplement-dialog nmda-classify-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-supplement-title">
                  <header class="nmda-classify-head">
                    <div data-workspace-mount="preflight-head" style="display:contents"></div>
                    <div data-workspace-mount="preflight-chips" style="display:contents"></div>
                  </header>

                  <div data-workspace-mount="preflight-nav" style="display:contents"></div>

                  <div class="nmda-classify-workspace" data-preflight-view="files">
                    <div class="nmda-classify-files-view" data-preflight-panel="files">
                    <aside class="nmda-classify-sidebar">
                      <div data-workspace-mount="preflight-directory-head" style="display:contents"></div>
                      <div data-workspace-mount="preflight-folders" style="display:contents"></div>


                    </aside>

                    <section class="nmda-preflight-source-routing nmda-classify-main" id="nmda-preflight-source-routing">
                      <div data-workspace-mount="preflight-source-tools" style="display:contents"></div>

                      <div class="nmda-preflight-routing-tip" hidden><span>↕</span><small>拖动文件时会出现快速归类区域。</small></div>
                      <div data-workspace-mount="preflight-files" style="display:contents"></div>
                    </section>

                    <aside class="nmda-classify-inspector-pane" aria-label="当前文件核验">
                      <div data-workspace-mount="preflight-inspector" style="display:contents"></div>
                    </aside>
                    </div>

                    <section class="nmda-classify-support-view" data-preflight-panel="support" data-support-view="roster" hidden>
                      <div data-workspace-mount="preflight-support" style="display:contents"></div>
                    </section>
                  </div>

                  <div data-workspace-mount="preflight-foot" style="display:contents"></div>
                </section>
              </div>

              <div data-workspace-mount="attachment-manager" style="display:contents"></div>

              <div class="nmda-card nmda-inline-review" id="nmda-inline-review" hidden>
                <div class="nmda-inline-review-top" data-workspace-mount="review-top"></div>
                <div class="nmda-review-boardbar nmda-review-boardbar-unified" data-workspace-mount="review-boardbar"></div>
                <div data-workspace-mount="batch-governance-panel" style="display:contents"></div>

                <div class="nmda-review-batchbar" id="nmda-review-batchbar" data-workspace-mount="review-batchbar" hidden></div>
                <div class="nmda-review-page-empty" id="nmda-review-page-empty" data-workspace-mount="review-empty"></div>
                <div class="nmda-review-preview-toolbar" id="nmda-review-preview-toolbar" data-workspace-mount="review-preview-toolbar" hidden></div>
                <aside class="nmda-review-preview-rail" id="nmda-review-preview-rail" hidden aria-label="邮件导航">
                  <div class="nmda-review-preview-rail-head"><div><strong>邮件</strong><small id="nmda-review-preview-rail-count">0</small></div></div>
                  <div class="nmda-review-preview-rail-list" id="nmda-review-preview-rail-list" data-workspace-mount="review-rail"></div>
                </aside>
                <div id="nmda-review-queue" class="nmda-review-queue nmda-review-mail-grid"><div data-workspace-mount="review-board"></div><div id="nmda-review-preview-pages" data-workspace-mount="review-preview" hidden></div></div>
                <div class="nmda-preview-format-dock" id="nmda-preview-format-dock" aria-label="批量处理">
                  <div data-workspace-mount="batch-governance-entry" style="display:contents"></div>
                </div>

              </div>


            </div>

            <div data-workspace-mount="import-handoff" style="display:contents"></div>



          </section>


          <section class="nmda-tabpane nmda-page nmda-dispatch-page" data-pane="dispatch" hidden>
            <div class="nmda-dispatch-intro">
              <div><strong>待发送邮件</strong><small></small></div>
              <div class="nmda-dispatch-source-summary" data-workspace-mount="dispatch-source-summary"></div>
            </div>
            <div data-workspace-mount="dispatch-empty" style="display:contents"></div>
            <div class="nmda-card nmda-list-card nmda-planning-workspace" id="nmda-preview-card" hidden>
              <div data-workspace-mount="schedule-applied-toast" style="display:contents"></div>
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
                <div class="nmda-task-toolbar" data-workspace-mount="batch-task-toolbar"></div>
              </details>
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

            <div data-workspace-mount="roster-planner" style="display:contents"></div>

            <div class="nmda-workflow-modal-overlay" id="nmda-schedule-modal" hidden>
              <section class="nmda-workflow-dialog nmda-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-schedule-dialog-title">
                <header class="nmda-workflow-dialog-head">
                  <div><span class="nmda-dialog-eyebrow">本次发送计划</span><h3 id="nmda-schedule-dialog-title">时间安排</h3><p>不用逐封填写时间。先确定收件人当地的发送窗口，再按需要设置避让规则，最后一次生成本批时间。</p></div>
                  <button class="nmda-dialog-close" id="nmda-close-schedule-modal" type="button" aria-label="关闭时间安排">×</button>
                </header>
                <section class="nmda-schedule-dialog-body" id="nmda-scheduler-card">
                  <div data-workspace-mount="schedule-guide" style="display:contents"></div>
                  <div data-workspace-mount="schedule-summary" style="display:contents"></div>
                  <div data-workspace-mount="schedule-outcome" style="display:contents"></div>
                  <div data-workspace-mount="schedule-priority" style="display:contents"></div>
                  <div class="nmda-scheduler-grid nmda-scheduler-calendar-grid"><div data-workspace-mount="schedule-controls" style="display:contents"></div></div>
                  <div data-workspace-mount="schedule-rule-preview" style="display:contents"></div>
                </section>
                <footer class="nmda-workflow-dialog-foot">
                  <div data-workspace-mount="schedule-clear" style="display:contents"></div>
                  <div class="nmda-dialog-foot-spacer"></div>
                  <button class="nmda-btn nmda-btn-small" id="nmda-cancel-schedule-modal" type="button">取消</button>
                  <div data-workspace-mount="schedule-apply" style="display:contents"></div>
                </footer>
              </section>
            </div>

          </section>


          <section class="nmda-tabpane nmda-page nmda-dashboard-page" data-pane="dashboard" hidden aria-label="成效看板">
            <div data-workspace-mount="dashboard"></div>
          </section>

          <section class="nmda-tabpane nmda-page nmda-utilities-page" data-pane="utilities" hidden data-utility-view="home">
            <div data-workspace-mount="utilities-home" style="display:contents"></div>

            <section class="nmda-utility-workspace nmda-utility-monitor-workspace" data-utility-workspace="monitor" hidden>
              <header class="nmda-utility-workspace-head">
                <button class="nmda-utility-back" type="button" data-utility-back>← 工具</button>
                <div><small>联系人跟进</small><strong>邮件监测</strong><span>按联系人汇总联系次数、回复、跟进与下一步。</span></div>
              </header>
              <div data-workspace-mount="monitor"></div>
            </section>

            <div data-workspace-mount="draft-attachment-tool" style="display:contents"></div>
          </section>

        </main>
        <div data-workspace-mount="reset-all-dialog" style="display:contents"></div>
        <div data-workspace-mount="smart-temporal-popover" style="display:contents"></div>
      </section>`;
    document.documentElement.appendChild(root);
    decorateUnifiedIcons(root);
    return root;
  }

  globalThis.NMDAWorkspaceView = Object.freeze({ buildUI, decorateUnifiedIcons, iconSvg });
})();
