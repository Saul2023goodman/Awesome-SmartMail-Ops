/* Workspace view: markup is isolated from parsing and execution. */
(() => {
  function buildUI() {
    const root = document.createElement('div');
    root.id = 'nmda-root';
    root.innerHTML = `
      <button id="nmda-launcher" type="button" title="网易邮箱外联工作台" aria-label="打开网易邮箱外联工作台">
        <span class="nmda-launcher-mark">N</span><span class="nmda-launcher-dot"></span>
      </button>
      <section id="nmda-panel" hidden aria-label="网易邮箱外联工作台">
        <header class="nmda-head">
          <div class="nmda-brand">
            <div class="nmda-brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg></div>
            <div>
              <div class="nmda-title">外联工作台</div>
              <div class="nmda-subtitle">MAIL WORKSPACE <span class="v4-version">4.0</span></div>
            </div>
          </div>
          <div class="nmda-head-actions"><button id="v4-command-open" class="v4-command-open" type="button" aria-label="打开快捷操作">快捷操作 <kbd>Ctrl K</kbd></button>
            <div class="nmda-mail-connection" id="nmda-mail-connection" data-state="checking"><span class="nmda-mail-connection-dot"></span><span class="nmda-mail-connection-copy"><strong id="nmda-mail-connection-title">正在检查网易邮箱</strong><small id="nmda-mail-connection-detail">连接状态</small></span><button class="nmda-btn nmda-btn-small nmda-mail-open-button" id="nmda-open-mail" type="button">连接邮箱</button></div>
            <button class="nmda-icon-btn" id="nmda-expand" type="button" title="全屏 / 还原">⛶</button>
            <button class="nmda-icon-btn nmda-close" id="nmda-close" type="button" title="关闭">×</button>
          </div>
        </header>

        <nav class="nmda-tabs" aria-label="工作台模块">
          <div class="nmda-nav-label">工作空间</div>
          <button class="nmda-tab is-active" data-tab="batch" type="button" title="批量草稿"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg></span><span><strong>批量草稿</strong><small>导入 · 核验 · 排期</small></span></button>
          <button class="nmda-tab" data-tab="single" type="button" title="单封草稿"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19h4l10-10a2.2 2.2 0 0 0-4-4L5 15v4Z"/><path d="m13.5 6.5 4 4"/></svg></span><span><strong>单封草稿</strong><small>快速创建一封</small></span></button>
          <button class="nmda-tab" data-tab="contacts" type="button" title="联系人"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5"/></svg></span><span><strong>联系人</strong><small>状态与跟进记录</small></span></button><div class="v4-rail-bottom"><div class="v4-rail-progress"><span>本批次进度</span><strong id="v4-rail-count">尚未导入</strong><div class="v4-progress-track"><i id="v4-rail-progress"></i></div></div><button type="button" id="v4-help" class="v4-help">键盘快捷键 <span>?</span></button></div>
        </nav>

        <main class="nmda-main">
          <div class="nmda-page-head" data-page-head="single" hidden>
            <div><h2>单封草稿</h2><p>填写内容，设置附件或时间。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="single" hidden>
            <div class="nmda-single-grid">
              <div class="nmda-card nmda-compose-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title">邮件内容</div></div></div>
                <label class="nmda-field"><span class="nmda-label">收件人</span><textarea id="nmda-recipients" placeholder="a@example.com; b@example.com"></textarea><span class="nmda-hint">多人可用分号、逗号或换行分隔</span></label>
                <label class="nmda-field"><span class="nmda-label">主题</span><input id="nmda-subject" type="text" placeholder="邮件主题"></label>
                <label class="nmda-field nmda-grow-field"><span class="nmda-label">正文</span><textarea id="nmda-body-text" placeholder="邮件正文"></textarea></label>
              </div>

              <aside class="nmda-side-stack">
                <div class="nmda-card nmda-single-options-card">
                  <div class="nmda-card-head"><div><div class="nmda-card-title">发送选项</div><div class="nmda-card-desc">附件和定时均为可选。</div></div></div>
                  <div class="nmda-field nmda-file-field"><span class="nmda-label">附件</span><div class="nmda-file-picker"><label class="nmda-btn nmda-btn-small" for="nmda-files">选择附件</label><span id="nmda-single-file-summary" class="nmda-hint">未选择附件</span><input id="nmda-files" type="file" multiple hidden></div><span class="nmda-hint">刷新页面后需重新选择本地附件。</span></div>
                  <div class="nmda-option-divider"></div>
                  <label class="nmda-field"><span class="nmda-label">定时时间</span><input id="nmda-schedule-at" type="datetime-local"><span class="nmda-hint">留空则不设置定时。</span></label>
                </div>
                <div class="nmda-card nmda-action-card">
                  <div class="nmda-actions"><button class="nmda-btn nmda-btn-primary" id="nmda-fill" type="button">创建草稿</button></div>
                  
                  <div id="nmda-status">准备就绪。</div>
                </div>
              </aside>
            </div>
          </section>


          <div class="nmda-page-head" data-page-head="batch">
            <div><span class="v4-eyebrow">OUTREACH / 工作批次</span><h2>把每一封邮件，安排妥当。</h2><p>从导入资料到创建草稿，在一个工作台完成。</p></div><div class="v4-today" id="v4-today"></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page nmda-bulk-workbench" data-pane="batch" data-phase="empty">
            <section class="v4-overview" id="v4-overview" aria-label="批次状态概览"></section>
            <aside class="nmda-process-guide" aria-label="批量流程">
              <div class="nmda-process-guide-title"><small>当前批次</small><strong>步骤 1 / 3</strong></div>
              <button type="button" data-flow-step="1"><span>1</span><strong>导入资料</strong><small>拖入邮件与批次资料</small></button>
              <i></i>
              <button type="button" data-flow-step="2"><span>2</span><strong>核验待办</strong><small>内容 · 去重 · 附件</small></button>
              <i></i>
              <button type="button" data-flow-step="3"><span>3</span><strong>选择与排期</strong><small>确认后转到网易邮箱执行</small></button>
            </aside>

            <div class="nmda-workflow-stage-head" id="nmda-stage-prepare">
              <span class="nmda-stage-number">01</span><div><strong>准备邮件</strong><small>把邮件资料加入本批次。</small></div>
            </div>
            <div class="nmda-ingest-workspace nmda-ingest-workspace-v2">
              <div class="nmda-card nmda-ingest-source-card" id="nmda-import-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title" id="nmda-import-card-title">导入邮件资料</div><div class="nmda-card-desc" id="nmda-import-card-desc">把本批次邮件资料放进来。</div></div><div class="nmda-row nmda-wrap"><span class="nmda-import-busy-badge" id="nmda-import-busy-badge" hidden>正在处理…</span><button class="nmda-btn nmda-btn-small" id="nmda-open-supplement-preflight" type="button" hidden>批次准备</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-reset-import" type="button" hidden>清空本批次</button></div></div>
                <input id="nmda-import-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip,.pdf,.ppt,.pptx,.rtf,.png,.jpg,.jpeg,.gif,.webp,.svg,.rar,.7z">
                <input id="nmda-import-dir" type="file" webkitdirectory multiple hidden>
                <input id="nmda-import-package" type="file" hidden accept=".zip">
                <input id="nmda-roster-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <div class="nmda-import-drop-zone" id="nmda-import-drop-zone" role="button" tabindex="0" aria-label="拖入邮件资料，或点击选择文件">
                  <div class="nmda-import-drop-zone-icon" aria-hidden="true"><svg viewBox="0 0 190 114"><rect x="30" y="14" width="69" height="82" rx="8" fill="#f1ece4" stroke="#d9d2c8" transform="rotate(-12 64 55)"/><rect x="85" y="12" width="70" height="84" rx="8" fill="#fff" stroke="#b6ccc2" transform="rotate(9 120 54)"/><path d="M102 34h30m-30 10h30m-30 10h21" stroke="#b6ccc2" stroke-width="3" stroke-linecap="round"/><rect x="53" y="48" width="82" height="55" rx="10" fill="#23745e"/><path d="m57 54 37 26 37-26" stroke="#c8e9dc" stroke-width="2" fill="none"/><circle cx="142" cy="84" r="18" fill="#e8f2ec" stroke="#bfd8cc"/><path d="M142 92V76m-6 6 6-6 6 6" stroke="#23745e" stroke-width="2" fill="none" stroke-linecap="round"/></svg></div>
                  <div class="nmda-import-drop-zone-copy"><strong>拖入文件，开始一个新批次</strong><small>支持文件、文件夹与 ZIP；也可以点击此区域选择文件</small></div>
                  <div class="nmda-import-drop-zone-types"><span>DOCX</span><span>XLSX</span><span>PDF</span><span>ZIP</span><span>更多</span></div>
                </div>
                <div class="nmda-source-action-grid nmda-source-action-grid-compact">
                  <label class="nmda-source-action" for="nmda-import-file"><span class="nmda-source-action-icon">＋</span><strong>选择文件</strong><small>从电脑选择资料</small></label>
                  <label class="nmda-source-action" for="nmda-import-dir"><span class="nmda-source-action-icon">▤</span><strong>选择文件夹</strong><small>批量加入整个文件夹</small></label>
                  <label class="nmda-source-action nmda-source-action-legacy" for="nmda-import-package" hidden><span class="nmda-source-action-icon">▣</span><strong>打开 ZIP</strong></label>
                  <button class="nmda-source-action nmda-source-action-button" id="nmda-show-paste" type="button"><span class="nmda-source-action-icon">⌘</span><strong>粘贴内容</strong><small>粘贴邮件文本或表格</small></button>
                  <button class="nmda-source-action nmda-source-action-button nmda-source-action-mailbox" id="nmda-import-drafts" type="button"><span class="nmda-source-action-icon">✉</span><strong>读取草稿箱</strong><small>识别正文、主题、定时与附件</small></button>
                </div>
                <div class="nmda-paste-panel" id="nmda-paste-panel" hidden>
                  <textarea id="nmda-paste-source" placeholder="粘贴邮件、名单或表格内容"></textarea>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-paste-import" type="button">加入本批次</button></div>
                </div>
                <div class="nmda-ingest-source-tools"><span id="nmda-import-format-info" class="nmda-hint">先加入邮件资料。</span><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-template" type="button">下载模板</button></div>
                <div class="nmda-batch-prep-strip" id="nmda-batch-prep-strip" hidden>
                  <div class="nmda-batch-prep-label"><span>批次资料</span><small>总名单与附件</small></div>
                  <div class="nmda-batch-prep-item" id="nmda-prep-roster-state" data-state="pending"><span>参考总名单</span><strong>未决定</strong></div>
                  <div class="nmda-batch-prep-item nmda-batch-prep-attachment" id="nmda-prep-attachment-state" data-state="pending"><div><span>附件</span><strong>未准备</strong></div><button class="nmda-text-action" id="nmda-manage-attachments-strip" type="button">查看 / 修改</button></div>
                  <button class="nmda-btn nmda-btn-small" id="nmda-edit-batch-prep" type="button">补充资料</button>
                </div>
                <div class="nmda-context-cue nmda-roster-context-cue" id="nmda-roster-context-cue" data-state="prepare">
                  <div class="nmda-context-cue-icon" aria-hidden="true">◎</div>
                  <div class="nmda-context-cue-main">
                    <span class="nmda-context-eyebrow" id="nmda-roster-context-eyebrow">推荐 · 导入时补充</span>
                    <strong id="nmda-roster-context-title">有参考总名单？建议一起加入</strong>
                    <small id="nmda-roster-context-copy">用于查重、名单核对和院校排期；没有也可以继续。</small>
                    <div class="nmda-context-benefits" id="nmda-roster-context-benefits"><span>减少重复联系</span><span>发现名单遗漏</span><span>辅助院校排期</span></div>
                    <div id="nmda-roster-source-status" class="nmda-context-status">未添加参考总名单。</div>
                  </div>
                  <div class="nmda-context-cue-actions">
                    <label class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-roster-upload-action" for="nmda-roster-file">上传参考总名单</label>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-skip" type="button" hidden>本批次暂不添加</button>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-remove" type="button" hidden>移除</button>
                  </div>
                </div>
                <div id="nmda-import-status" class="nmda-summary nmda-import-status">还没有添加资料。</div>
                <div id="nmda-source-inventory" class="nmda-source-inventory" hidden></div>

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
                    <button type="button" data-preflight-view="support"><span>2</span><strong>批次资料</strong><small>名单与附件</small></button>
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
                        <div class="nmda-source-inspector-legacy-tools" id="nmda-ingest-diagnostics" hidden aria-hidden="true">
                          <div class="nmda-diagnostics-grid">
                            <div class="nmda-ingest-structure-card" id="nmda-structure-card" hidden>
                              <div class="nmda-card-subtitle">读取内容</div>
                              <div class="nmda-field nmda-inspector-collection-list-field"><span class="nmda-label">文件内内容</span><div id="nmda-collection-list" class="nmda-collection-list"></div></div>
                              <label class="nmda-field" id="nmda-collection-field"><span class="nmda-label">当前内容</span><select id="nmda-collection-select"></select></label>
                              <div id="nmda-structure-summary" class="nmda-structure-summary"></div>
                              <div class="nmda-raw-preview-wrap"><div id="nmda-structure-preview" class="nmda-structure-preview"></div></div>
                            </div>
                            <div class="nmda-ingest-mapping-card" id="nmda-mapping-card" hidden>
                              <div class="nmda-card-subtitle">邮件内容对应</div>
                              <div id="nmda-header-info" class="nmda-hint nmda-semantic-detection"></div>
                              <div id="nmda-semantic-summary" class="nmda-semantic-summary"></div>
                              <div class="nmda-row nmda-wrap nmda-mapping-actions"><button class="nmda-btn nmda-btn-small" id="nmda-apply-profile" type="button" hidden>使用已有设置</button><button class="nmda-btn nmda-btn-small" id="nmda-save-profile" type="button" hidden>保存当前设置</button><button class="nmda-btn nmda-btn-small" id="nmda-toggle-mapping" type="button">调整读取内容</button></div>
                              <div id="nmda-profile-info" class="nmda-hint"></div>
                              <div id="nmda-mapping" class="nmda-mapping nmda-semantic-mapping" hidden></div>
                            </div>
                          </div>
                        </div>
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
                    <button class="nmda-btn nmda-btn-primary" id="nmda-complete-supplement-preflight" type="button">确认分类并继续 →</button>
                  </footer>
                </section>
              </div>

              <div class="nmda-attachment-manager-overlay" id="nmda-attachment-manager-overlay" hidden aria-hidden="true">
                <section class="nmda-attachment-manager" role="dialog" aria-modal="true" aria-labelledby="nmda-attachment-manager-title">
                  <div class="nmda-attachment-manager-head">
                    <div><span class="nmda-supplement-kicker">统一附件配置</span><h3 id="nmda-attachment-manager-title">附件工作台</h3><p>拖入附件，再选择自动匹配、全部邮件或指定邮件。</p></div>
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
                      <input id="nmda-shared-files" type="file" multiple hidden aria-hidden="true">
                      <span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span>
                    </div>
                    <section class="nmda-attachment-workspace-section">
                      <header><div><strong>附件文件</strong><small>逐个确认实际发送范围。</small></div><span id="nmda-attachment-manager-file-count">0 个</span></header>
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
                      <header><div><strong>邮件中的附件要求</strong><small>核对每封邮件需要的文件是否齐全。</small></div><span id="nmda-attachment-manager-requirements-count">0 项</span></header>
                      <div class="nmda-attachment-requirement-list" id="nmda-attachment-manager-requirements"></div>
                    </section>
                  </div>
                  <div class="nmda-attachment-manager-foot">
                    <button class="nmda-btn nmda-btn-danger-quiet" id="nmda-manager-clear-attachments" type="button">清空附件</button>
                    <div class="nmda-row nmda-wrap"><span class="nmda-hint" id="nmda-attachment-manager-foot-note">更改范围会立即同步到邮件任务。</span><button class="nmda-btn nmda-btn-primary" id="nmda-attachment-manager-done" type="button">完成</button></div>
                  </div>
                </section>
              </div>

              <div class="nmda-card nmda-ingest-result-card" id="nmda-ingest-result-card" hidden>
                <div class="nmda-card-head nmda-ingest-result-head">
                  <div><div class="nmda-card-title">当前待办</div><div class="nmda-card-desc">处理本批次仍需确认或补充的内容。</div></div>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-restore-excluded" type="button" hidden>恢复已排除</button><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-import-issues" type="button" hidden>继续处理待办</button></div>
                </div>
                <div class="nmda-context-cue nmda-context-cue-compact nmda-attachment-context-cue" id="nmda-attachment-context-cue" hidden>
                  <div class="nmda-context-cue-icon" aria-hidden="true">⇧</div>
                  <div class="nmda-context-cue-main"><span class="nmda-context-eyebrow">待办 · 创建前必须补齐</span><strong id="nmda-attachment-context-title">附件待补</strong><small id="nmda-attachment-context-copy">添加本批次需要的附件。</small></div>
                  <div class="nmda-context-cue-actions"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-attachment-send-action" type="button" data-open-attachment-manager>打开附件工作台</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-attachment-later" type="button">稍后处理</button></div>
                </div>
                <div class="nmda-attachment-library-bar" id="nmda-attachment-library-bar" hidden><div class="nmda-attachment-library-bar-main"><span class="nmda-attachment-library-bar-icon">↗</span><div><strong id="nmda-attachment-library-bar-title">附件资料</strong><small id="nmda-attachment-library-bar-copy">查看或调整已加入的附件。</small></div></div><button class="nmda-btn nmda-btn-small" id="nmda-manage-attachments-workflow" type="button">查看 / 修改</button></div>
                <div id="nmda-import-preview-summary" class="nmda-ingest-health"></div>
                <div id="nmda-review-guidance" class="nmda-review-guidance">解析完成后可查看每封邮件的结果。</div>
                <details class="nmda-optional-source-details nmda-attachment-gateway" id="nmda-attachments-card" hidden>
                  <summary><span><strong>附件工作台</strong><small>查看文件、发送范围与匹配状态</small></span><span>展开</span></summary>
                  <div id="nmda-attachment-summary" class="nmda-summary">尚未添加附件。</div>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small nmda-btn-primary" type="button" data-open-attachment-manager>打开附件工作台</button></div>
                  <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden><div id="nmda-attachment-resolution-list"></div></div>
                </details>
                <div class="nmda-import-handoff-card" id="nmda-import-handoff-card" hidden>
                  <div id="nmda-import-ready-summary" class="nmda-import-ready-summary">尚未生成任务。</div>
                  <div class="nmda-row nmda-import-handoff-actions"><span class="nmda-hint" id="nmda-handoff-hint"></span><button class="nmda-btn nmda-btn-primary" id="nmda-go-batch" type="button">进入选择与安排</button></div>
                </div>
              </div>

              <div class="nmda-card nmda-inline-review" id="nmda-inline-review" hidden>
                <div class="nmda-inline-review-top">
                  <div><div class="nmda-card-title" id="nmda-review-workspace-title">邮件审阅</div><div class="nmda-card-desc" id="nmda-review-workspace-desc">先看状态，再处理少数需要人工介入的邮件。</div></div>
                  <div class="nmda-inline-review-actions"><div id="nmda-review-page-summary" class="nmda-review-page-summary"></div><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-next-pending" type="button">下一个待办</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-import-editor-cancel" type="button">完成并返回</button></div>
                </div>
                <div class="nmda-review-boardbar">
                  <div class="nmda-review-board-copy"><strong id="nmda-review-queue-title">邮件状态</strong><small id="nmda-review-queue-caption">按状态快速找到需要处理的邮件。</small></div>
                  <div class="nmda-review-filter nmda-review-status-tabs" id="nmda-review-filter" role="group" aria-label="邮件状态筛选">
                    <button class="is-active" type="button" data-review-filter="all">全部</button>
                    <button type="button" data-review-filter="auto">自动通过</button>
                    <button type="button" data-review-filter="attention">所有待办</button><button type="button" data-review-filter="pending">需核对</button>
                    <button type="button" data-review-filter="decision">冲突/重复</button>
                    <button type="button" data-review-filter="confirmed">已确认</button>
                  </div>
                  <div class="nmda-review-queue-tools">
                    <label class="nmda-review-search"><span aria-hidden="true">⌕</span><input id="nmda-review-search" type="search" placeholder="搜索收件人 / 邮箱 / 主题" autocomplete="off"></label>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-subject-entry" id="nmda-review-fill-subjects" type="button" hidden>一键补主题</button>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-bulk-entry" id="nmda-review-select-filtered" type="button">批量确认…</button>
                  </div>
                </div>
                <div class="nmda-review-subject-prompt" id="nmda-review-subject-prompt" hidden>
                  <div class="nmda-review-subject-prompt-copy"><span class="nmda-review-subject-prompt-icon" aria-hidden="true">T</span><div><strong id="nmda-review-subject-prompt-title">检测到多封邮件缺少主题</strong><small id="nmda-review-subject-prompt-copy">输入一次，只补齐缺少主题的邮件，不覆盖已有主题。</small></div></div>
                  <label class="nmda-review-subject-prompt-input"><span>统一主题</span><input id="nmda-review-bulk-subject-input" type="text" placeholder="输入要补齐的邮件主题" autocomplete="off"></label>
                  <div class="nmda-review-subject-prompt-actions"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-bulk-subject-apply" type="button">一键补齐</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-bulk-subject-dismiss" type="button">稍后处理</button></div>
                </div>
                <div class="nmda-review-batchbar" id="nmda-review-batchbar" hidden>
                  <div><strong id="nmda-review-selected-count">已选 0 封</strong><small>一次确认所选邮件</small></div>
                  <div class="nmda-row"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-confirm-selected" type="button">确认所选</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-clear-selected" type="button">取消</button></div>
                </div>
                <div class="nmda-review-page-empty" id="nmda-review-page-empty">添加资料后，这里会显示每封邮件的识别状态。</div>
                <div id="nmda-review-queue" class="nmda-review-queue nmda-review-mail-grid"></div>

                <div class="nmda-review-workbench" id="nmda-import-editor-overlay" hidden aria-hidden="true">
                  <section class="nmda-review-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-import-editor-title">
                    <div class="nmda-review-layout">
                      <section class="nmda-review-edit-pane">
                        <div class="nmda-review-pane-title nmda-review-mail-toolbar">
                          <span class="nmda-review-mail-heading"><strong id="nmda-import-editor-title">审阅邮件</strong><small id="nmda-import-editor-evidence">先核对完整邮件，再决定是否需要修正</small></span>
                          <div class="nmda-review-mail-actions">
                            <div class="nmda-review-pager" role="group" aria-label="切换邮件"><button type="button" id="nmda-review-prev" aria-label="上一封">‹</button><span id="nmda-review-position">1 / 1</span><button type="button" id="nmda-review-next" aria-label="下一封">›</button></div>
                            <button class="nmda-review-exclude-direct" id="nmda-review-exclude" type="button" title="排除后可在已排除邮件中恢复">排除此封</button>
                            <button class="nmda-icon-btn nmda-review-detail-close" id="nmda-import-editor-close" type="button" aria-label="关闭邮件审阅">×</button>
                          </div>
                        </div>
                        <div class="nmda-review-problem-strip"><span class="nmda-review-problem-shape" aria-hidden="true">!</span><span id="nmda-review-problem-summary">重点核对开头、结尾与邮件边界</span></div>
                        <div class="nmda-review-edit-scroll">
                          <div id="nmda-review-feedback" class="nmda-review-feedback" hidden></div>
                          <section class="nmda-duplicate-decision" id="nmda-duplicate-decision" hidden>
                            <div class="nmda-duplicate-decision-head">
                              <div><strong id="nmda-duplicate-decision-title">发现重复邮件</strong><small id="nmda-duplicate-decision-copy">同时比较本组邮件，决定实际要保留的版本。</small></div>
                              <span class="nmda-duplicate-kind" id="nmda-duplicate-decision-kind">重复</span>
                            </div>
                            <div class="nmda-duplicate-candidates" id="nmda-duplicate-candidates"></div>
                            <div class="nmda-duplicate-actions">
                              <span class="nmda-hint" id="nmda-duplicate-decision-hint">默认勾选信息更完整的一封；也可以直接勾选多封。</span>
                              <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary" id="nmda-duplicate-keep-selected" type="button">保留所选（1）</button><button class="nmda-btn" id="nmda-duplicate-keep-all" type="button">全部保留</button></div>
                            </div>
                          </section>

                          <section class="nmda-review-audit-view" id="nmda-review-audit-view">
                            <div class="nmda-review-semantic-legend" id="nmda-review-semantic-legend" aria-label="语义高亮图例"></div>
                            <div class="nmda-review-audit-checks" aria-label="邮件核验要点">
                              <div class="nmda-review-audit-check" id="nmda-audit-check-recipient"><span>收件人</span><strong id="nmda-audit-recipient-state">—</strong></div>
                              <div class="nmda-review-audit-check" id="nmda-audit-check-subject"><span>主题</span><strong id="nmda-audit-subject-state">—</strong></div>
                              <div class="nmda-review-audit-check" id="nmda-audit-check-opening"><span>开头</span><strong id="nmda-audit-opening-state">—</strong></div>
                              <div class="nmda-review-audit-check" id="nmda-audit-check-closing"><span>结尾</span><strong id="nmda-audit-closing-state">—</strong></div>
                              <div class="nmda-review-audit-check" id="nmda-audit-check-attachment"><span>附件</span><strong id="nmda-audit-attachment-state">—</strong></div>
                            </div>

                            <details class="v4-edge-details"><summary>查看开头与结尾片段 <span>展开</span></summary><div class="nmda-review-edge-focus">
                              <article class="nmda-review-edge-card" data-edge="opening"><header><span>01</span><div><strong>开头核验</strong><small>称呼、身份与第一段是否属于这封邮件</small></div></header><pre id="nmda-audit-opening">—</pre></article>
                              <article class="nmda-review-edge-card" data-edge="closing"><header><span>02</span><div><strong>结尾核验</strong><small>收尾、署名与邮件终点是否正确</small></div></header><pre id="nmda-audit-closing">—</pre></article>
                            </div></details>

                            <section class="nmda-review-mail-sheet" aria-label="完整邮件">
                              <div class="nmda-review-mail-sheet-head">
                                <div><span>收件人</span><strong id="nmda-audit-recipient">—</strong></div>
                                <div><span>主题</span><strong id="nmda-audit-subject">—</strong></div>
                              </div>
                              <div class="nmda-review-mail-sheet-title"><strong>完整邮件</strong><small>核对收件人、主题和正文，确认后继续。</small></div>
                              <pre class="nmda-review-mail-sheet-body" id="nmda-audit-full-body">—</pre>
                            </section>
                          </section>

                          <section class="nmda-review-correction-panel" id="nmda-review-correction-panel" hidden>
                            <div class="nmda-review-correction-head"><div><strong>修正识别结果</strong><small>只在发现错误时修改；返回审阅后重新核对完整邮件。</small></div></div>
                            <div class="nmda-import-editor-grid nmda-review-core-fields">
                              <label class="nmda-field" id="nmda-review-field-recipients"><span class="nmda-label">收件人</span><input id="nmda-import-edit-recipients" type="text" placeholder="recipient@example.edu"><span id="nmda-recipient-assist" class="nmda-field-assist" hidden></span></label>
                              <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-subject"><span class="nmda-label">主题</span><input id="nmda-import-edit-subject" type="text"></label>
                              <div class="nmda-context-assist" id="nmda-subject-assist" hidden>
                                <div><strong id="nmda-subject-assist-title">还有邮件缺少主题</strong><small id="nmda-subject-assist-copy"></small></div>
                                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-subject-assist-apply" type="button">一键填写</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-subject-assist-dismiss" type="button">不用</button></div>
                              </div>
                              <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-body"><span class="nmda-label">正文</span><textarea id="nmda-import-edit-body"></textarea></label>
                            </div>
                          </section>
                        </div>
                        <input id="nmda-import-edit-schedule" type="hidden">
                        <input id="nmda-import-edit-attachments" type="hidden">
                        <input id="nmda-import-edit-tags" type="hidden">
                        <div class="nmda-review-actions" id="nmda-review-actions">
                          <span class="nmda-review-action-copy">先完整核验，再确认；缺失必填内容时必须先修正。</span>
                          <div class="nmda-row nmda-wrap">
                            <button class="nmda-btn nmda-btn-quiet" id="nmda-review-back-audit" type="button" hidden>← 返回审阅</button>
                            <button class="nmda-btn" id="nmda-review-correct" type="button">发现问题，修正</button>
                            <button class="nmda-btn" id="nmda-import-editor-save" type="button">确认无误</button>
                            <button class="nmda-btn nmda-btn-primary" id="nmda-import-editor-next" type="button">确认无误，下一封</button>
                          </div>
                        </div>
                      </section>
                    </div>
                  </section>
                </div>
              </div>

              <div class="nmda-card nmda-roster-audit-card" id="nmda-roster-audit-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-card-title">联系人核验</div><div class="nmda-card-desc">发现可能重复的联系人时会在这里提示。</div></div></div>
                <input id="nmda-roster-enabled" type="checkbox" checked hidden>
                <input id="nmda-roster-auto-school" type="checkbox" checked hidden>
                <input id="nmda-roster-strict" type="checkbox" hidden>
                <div id="nmda-roster-audit-summary" class="nmda-ingest-health"></div>
                <div id="nmda-roster-audit-note" class="nmda-review-guidance"></div>
                <details class="nmda-roster-details"><summary>查看核验详情</summary><div id="nmda-roster-audit-details" class="nmda-roster-audit-details"></div></details>
              </div>

            </div>

            <div class="nmda-workflow-stage-separator" aria-hidden="true"></div>
            <div class="nmda-workflow-stage-head" id="nmda-stage-execute" hidden>
              <span class="nmda-stage-number">03</span><div><strong>确认与安排</strong><small>确认邮件与发送时间。</small></div>
            </div>
            <div class="nmda-batch-empty" id="nmda-batch-empty" hidden><button id="nmda-go-import" type="button" hidden>回到准备区</button></div>

            <div class="nmda-card nmda-list-card nmda-planning-workspace" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head nmda-planning-head">
                <div><div class="nmda-card-title">安排本次邮件</div><div class="nmda-card-desc">选择本次邮件，逐封调整或统一安排时间。</div></div>
                <div class="nmda-planning-head-actions">
                  <div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-pre-send-file-action" id="nmda-manage-attachments-planning" type="button" data-open-attachment-manager>附件工作台</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-open-review-from-planning" type="button">审阅邮件</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-open-schedule-modal" type="button">排期设置</button>
                </div>
              </div>
              <div class="nmda-planning-statusbar">
                <span id="nmda-planning-rule-chip">尚未应用排期规则</span>
                <span id="nmda-planning-selection-chip">选择邮件后即可安排时间</span>
                <span id="nmda-planning-attachment-chip">附件可随时在工作台调整</span>
              </div>
              <details class="nmda-scope-tools" id="nmda-scope-tools">
                <summary><span><strong>筛选邮件</strong><small>搜索、按状态筛选或调整本次范围</small></span><span class="nmda-scope-toggle">展开</span></summary>
                <div class="nmda-task-toolbar">
                  <label class="nmda-search-field"><input id="nmda-batch-search" type="search" placeholder="搜索收件人或主题"></label>
                  <label class="nmda-compact-select"><span>联系状态</span><select id="nmda-batch-stage-filter"><option value="">全部</option><option value="未联系">未联系</option><option value="已发送">已发送</option><option value="已回复">已回复</option></select></label>
                  <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">纳入筛选结果</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-selection" type="button">排除全部</button>
                </div>
              </details>
              <input id="nmda-batch-tag-include" type="hidden"><button id="nmda-clear-tag-filter" type="button" hidden></button><div id="nmda-batch-tag-chips" hidden></div>
              <input id="nmda-bulk-tag-value" type="hidden"><button id="nmda-bulk-add-tag" type="button" hidden></button><button id="nmda-bulk-remove-tag" type="button" hidden></button><button id="nmda-bulk-disable" type="button" hidden></button>
              <div class="v4-planning-tools"><div class="v4-segment" role="group" aria-label="排期视图"><button type="button" data-v4-view="list" aria-pressed="true">邮件列表</button><button type="button" data-v4-view="timeline" aria-pressed="false">时间轴</button></div><div class="v4-date-filter" id="v4-date-filter" hidden><span id="v4-date-label"></span><button type="button" id="v4-clear-date">清除日期筛选 ×</button></div><span id="v4-visible-count"></span></div><div id="v4-timeline" class="v4-timeline" hidden></div><div class="nmda-table-wrap nmda-batch-table-wrap"><table class="nmda-table nmda-batch-table"><thead><tr><th>选择</th><th>收件人</th><th>主题</th><th>发送时间</th><th>结果</th><th></th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
              <div class="v4-load-more" id="v4-load-more" hidden><button type="button" class="nmda-btn" id="v4-more-mails">加载更多邮件</button></div><div class="nmda-mail-handoff-bar" id="nmda-mail-handoff-bar">
                <div class="nmda-mail-handoff-copy"><span class="nmda-mail-handoff-mark" aria-hidden="true">N</span><div><strong id="nmda-batch-status">准备转到网易邮箱执行</strong><small id="nmda-create-preflight">确认本次范围与排期后，真实创建过程将在网易邮箱页面显示。</small></div></div>
                <button class="nmda-btn nmda-btn-primary nmda-mail-handoff-action" id="nmda-batch-start" type="button">前往网易邮箱并创建所选草稿</button>
                <button id="nmda-batch-stop" type="button" hidden disabled>当前封后停止</button>
              </div>
            </div>

            <div class="nmda-workflow-modal-overlay" id="nmda-schedule-modal" hidden>
              <section class="nmda-workflow-dialog nmda-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-schedule-dialog-title">
                <header class="nmda-workflow-dialog-head">
                  <div><span class="nmda-dialog-eyebrow">本批次</span><h3 id="nmda-schedule-dialog-title">排期设置</h3><p>设置规则后应用到当前已选择邮件。</p></div>
                  <button class="nmda-dialog-close" id="nmda-close-schedule-modal" type="button" aria-label="关闭排期设置">×</button>
                </header>
                <section class="nmda-schedule-dialog-body" id="nmda-scheduler-card" hidden>
                  <div class="nmda-schedule-dialog-summary" id="nmda-schedule-summary"></div>
                  <div class="nmda-scheduler-grid">
                    <label class="nmda-field"><span class="nmda-label">开始时间</span><input id="nmda-rule-start-at" type="datetime-local"></label>
                    <label class="nmda-field"><span class="nmda-label">每所院校每轮最多</span><input id="nmda-rule-max-school" type="number" min="1" max="20" step="1" value="1"></label>
                    <label class="nmda-field"><span class="nmda-label">同校间隔</span><div class="nmda-input-suffix"><input id="nmda-rule-interval-days" type="number" min="1" max="365" step="1" value="7"><span>天</span></div></label>
                    <label class="nmda-check-card"><input id="nmda-rule-preserve-existing" type="checkbox" checked><span><strong>保留草稿 / 导入原排期</strong></span></label>
                    <label class="nmda-check-card nmda-schedule-wide-check"><input id="nmda-rule-skip-holidays" type="checkbox" checked><span><strong>避开节假日和周末</strong></span></label>
                  </div>
                  <div id="v4-schedule-preview" class="v4-schedule-preview" aria-live="polite"></div><div class="nmda-schedule-rule-preview" id="nmda-schedule-rule-preview">同校每 7 天最多 1 位。</div>
                </section>
                <footer class="nmda-workflow-dialog-foot">
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-auto-schedule" type="button">清除自动时间</button>
                  <div class="nmda-dialog-foot-spacer"></div>
                  <button class="nmda-btn nmda-btn-small" id="nmda-cancel-schedule-modal" type="button">取消</button>
                  <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-apply-schedule" type="button">应用排期</button>
                </footer>
              </section>
            </div>



          </section>

          <div class="nmda-page-head" data-page-head="contacts" hidden>
            <div><h2>联系人</h2><p>浏览联系人；点开后再编辑状态和历史。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-contacts-page" data-pane="contacts" hidden>
            <div class="nmda-contact-command-strip">
              <div class="nmda-contact-sync-state"><span class="nmda-contact-sync-dot"></span><div><strong>邮箱记录</strong><span id="nmda-mailbox-read-meta" class="nmda-read-meta">尚未同步邮箱状态。</span></div></div>
              <div id="nmda-contact-status" class="nmda-contact-status-inline">正在加载联系人…</div>
              <div class="nmda-contact-command-actions">
                <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-refresh-history" type="button">同步邮箱</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出 CSV</button>
                <details class="nmda-contact-maintenance-menu"><summary>维护</summary><button class="nmda-btn nmda-btn-small" id="nmda-rebuild-history" type="button">重建联系人记录</button></details>
              </div>
            </div>

            <div class="nmda-card nmda-contact-list-card nmda-contact-browser-card">
              <div class="nmda-card-head nmda-list-head nmda-contact-browser-head"><div><div class="nmda-card-title">联系人列表</div><div class="nmda-card-desc">查看联系进度与最近往来。</div></div><div id="nmda-contact-summary" class="nmda-summary nmda-summary-inline">0 个联系人</div></div>
              <div class="nmda-contact-toolbar nmda-contact-toolbar-unified">
                <label class="nmda-contact-searchbox"><span>⌕</span><input id="nmda-contact-search" type="text" placeholder="搜索邮箱、姓名、主题或状态"></label>
                <input id="nmda-contact-class-filter" type="text" placeholder="筛选状态 / 策略 / 长期标记">
              </div>
              <div id="nmda-contact-class-chips" class="nmda-tag-chips nmda-class-chip-bar"></div>
              <div class="nmda-table-wrap nmda-contact-table-wrap"><table class="nmda-table nmda-contact-table"><thead><tr><th>联系人</th><th>当前状态</th><th>最近活动</th><th>已发送</th><th>草稿</th><th></th></tr></thead><tbody id="nmda-contact-body"></tbody></table></div>
            </div>
          </section>

          <div class="nmda-workflow-modal-overlay" id="nmda-contact-modal" hidden>
            <section class="nmda-workflow-dialog nmda-contact-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-contact-dialog-title">
              <header class="nmda-workflow-dialog-head">
                <div><span class="nmda-dialog-eyebrow">联系人</span><h3 id="nmda-contact-dialog-title">联系人详情</h3><p id="nmda-contact-dialog-email"></p></div>
                <button class="nmda-dialog-close" id="nmda-close-contact-modal" type="button" aria-label="关闭联系人详情">×</button>
              </header>
              <div class="nmda-contact-dialog-body">
                <section class="nmda-contact-profile-panel">
                  <div class="nmda-contact-profile-summary" id="nmda-contact-profile-summary"></div>
                  <div class="nmda-contact-editor-grid">
                    <label class="nmda-field"><span class="nmda-label">互动阶段</span><select id="nmda-contact-modal-stage"></select></label>
                    <label class="nmda-field"><span class="nmda-label">发送策略</span><select id="nmda-contact-modal-policy"></select></label>
                    <label class="nmda-check-card"><input id="nmda-contact-modal-followup" type="checkbox"><span><strong>待跟进</strong></span></label>
                    <label class="nmda-field nmda-contact-modal-tags"><span class="nmda-label">长期标记</span><input id="nmda-contact-modal-tags" type="text" placeholder="重点;第一批"></label>
                  </div>
                </section>
                <section class="nmda-contact-history-panel">
                  <div class="nmda-contact-history-head"><strong>联系记录</strong><span id="nmda-contact-history-summary"></span></div>
                  <div class="nmda-contact-history-columns">
                    <div><h4>已发送</h4><div id="nmda-contact-sent-history" class="nmda-contact-history-list"></div></div>
                    <div><h4>草稿</h4><div id="nmda-contact-draft-history" class="nmda-contact-history-list"></div></div>
                  </div>
                </section>
              </div>
              <footer class="nmda-workflow-dialog-foot">
                <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-contact-modal-close-secondary" type="button">关闭</button>
                <div class="nmda-dialog-foot-spacer"></div>
                <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-save-contact-modal" type="button">保存联系人</button>
              </footer>
            </section>
          </div>
        </main>
      </section>`;
    document.body.appendChild(root);
    return root;
  }

 globalThis.NMDAWorkspaceView={build:buildUI};
})();
