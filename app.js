(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const STORAGE_KEY = 'nmda.form.v2';
  const Importer = globalThis.NMDAImporter;
  const MailRecognizer = globalThis.NMDAMailRecognizer;
  const Contacts = globalThis.NMDAContacts;
  const Scheduler = globalThis.NMDAScheduler;
  const Roster = globalThis.NMDARoster;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const executionProgressHandlers = new Map();

  function uniqueFiles(files) {
    const map = new Map();
    for (const file of files || []) {
      if (!file) continue;
      const key = Importer?.fileIdentity?.(file) || `${file.name}|${file.size}|${file.lastModified}`;
      if (!map.has(key)) map.set(key, file);
    }
    return [...map.values()];
  }

  async function prepareVaultRefs(files) {
    const refs = [];
    for (const file of files || []) {
      if (!file) continue;
      const meta = await globalThis.NMDAVault.putFile(file);
      refs.push({ id: meta.id, name: meta.name, size: meta.size, type: meta.type, lastModified: meta.lastModified });
    }
    return refs;
  }

  async function releaseVaultRefs(refs) {
    const ids = (refs || []).map(ref => ref?.id).filter(Boolean);
    if (!ids.length) return;
    try { await globalThis.NMDAVault.removeMany(ids); } catch (_) {}
  }

  async function executeDraftRemotely(task, { fresh = true, onProgress = () => {} } = {}) {
    const executionId = crypto.randomUUID();
    const refs = await prepareVaultRefs(task.files || []);
    executionProgressHandlers.set(executionId, onProgress);
    try {
      const connection = await chrome.runtime.sendMessage({ type: 'NMDA_CONNECTION_STATUS' });
      if (!connection?.connected) throw new Error('没有检测到已打开的网易邮箱。请先点击右上角“打开网易邮箱”并完成登录。');
      if (!connection?.authenticated) throw new Error('网易邮箱页面已打开，但尚未检测到登录账号。请先完成登录。');
      const result = await chrome.runtime.sendMessage({
        type: 'NMDA_EXECUTE_DRAFT', executionId, fresh,
        task: {
          recipients: task.recipients || '', subject: task.subject || '', body: task.body || '',
          scheduleAt: task.scheduleAt || '', attachments: refs
        }
      });
      if (!result?.ok) throw new Error(result?.reason || '网易邮箱执行器没有完成草稿创建。');
      return result.outcome || {};
    } finally {
      executionProgressHandlers.delete(executionId);
      await releaseVaultRefs(refs);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }

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
            <div class="nmda-brand-mark">N</div>
            <div>
              <div class="nmda-title">网易邮箱外联工作台</div>
              <div class="nmda-subtitle">批量外联草稿工作台</div>
            </div>
          </div>
          <div class="nmda-head-actions">
            <div class="nmda-mail-connection" id="nmda-mail-connection" data-state="checking"><span class="nmda-mail-connection-dot"></span><span class="nmda-mail-connection-copy"><strong id="nmda-mail-connection-title">正在检查网易邮箱</strong><small id="nmda-mail-connection-detail">连接状态</small></span><button class="nmda-btn nmda-btn-small nmda-mail-open-button" id="nmda-open-mail" type="button">连接邮箱</button></div>
            <button class="nmda-icon-btn" id="nmda-expand" type="button" title="全屏 / 还原">⛶</button>
            <button class="nmda-icon-btn nmda-close" id="nmda-close" type="button" title="关闭">×</button>
          </div>
        </header>

        <nav class="nmda-tabs" aria-label="工作台模块">
          <div class="nmda-nav-label">工作区</div>
          <button class="nmda-tab is-active" data-tab="batch" type="button" title="批量草稿"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg></span><span><strong>批量草稿</strong><small>导入 · 核验 · 排期</small></span></button>
          <button class="nmda-tab" data-tab="single" type="button" title="单封草稿"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19h4l10-10a2.2 2.2 0 0 0-4-4L5 15v4Z"/><path d="m13.5 6.5 4 4"/></svg></span><span><strong>单封草稿</strong><small>快速创建一封</small></span></button>
          <button class="nmda-tab" data-tab="contacts" type="button" title="联系人"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5"/></svg></span><span><strong>联系人</strong><small>状态与跟进记录</small></span></button>

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
                  <div class="nmda-card-head"><div><div class="nmda-card-title">发送选项</div><div class="nmda-card-desc">都可留空，不影响普通草稿。</div></div></div>
                  <div class="nmda-field nmda-file-field"><span class="nmda-label">附件</span><div class="nmda-file-picker"><label class="nmda-btn nmda-btn-small" for="nmda-files">选择附件</label><span id="nmda-single-file-summary" class="nmda-hint">未选择附件</span><input id="nmda-files" type="file" multiple hidden></div><span class="nmda-hint">刷新页面后需重新选择本地附件。</span></div>
                  <div class="nmda-option-divider"></div>
                  <label class="nmda-field"><span class="nmda-label">定时时间</span><input id="nmda-schedule-at" type="datetime-local"><span class="nmda-hint">留空则只保存普通草稿。</span></label>
                </div>
                <div class="nmda-card nmda-action-card">
                  <div class="nmda-actions"><button class="nmda-btn nmda-btn-primary" id="nmda-fill" type="button">创建草稿</button></div>
                  
                  <div id="nmda-status">准备就绪。</div>
                </div>
              </aside>
            </div>
          </section>


          <div class="nmda-page-head" data-page-head="batch">
            <div><h2>批量草稿</h2><p>导入 → 核验 → 排期 → 创建</p></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page nmda-bulk-workbench" data-pane="batch" data-phase="empty">
            <aside class="nmda-process-guide" aria-label="批量流程">
              <div class="nmda-process-guide-title"><small>当前批次</small><strong>步骤 1 / 4</strong></div>
              <button type="button" data-flow-step="1"><span>1</span><strong>导入资料</strong><small>加入邮件与批次资料</small></button>
              <i></i>
              <button type="button" data-flow-step="2"><span>2</span><strong>核验待办</strong><small>内容 · 去重 · 附件</small></button>
              <i></i>
              <button type="button" data-flow-step="3"><span>3</span><strong>选择与排期</strong><small>确认范围与时间</small></button>
              <i></i>
              <button type="button" data-flow-step="4"><span>4</span><strong>创建草稿</strong><small>执行并查看结果</small></button>
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
                <div class="nmda-source-action-grid">
                  <label class="nmda-source-action" for="nmda-import-file"><span class="nmda-source-action-icon">＋</span><strong>选择文件</strong><small>Word / Excel / PDF 等邮件资料</small></label>
                  <label class="nmda-source-action" for="nmda-import-dir"><span class="nmda-source-action-icon">▤</span><strong>选择文件夹</strong><small>批量读取邮件资料</small></label>
                  <label class="nmda-source-action nmda-source-action-legacy" for="nmda-import-package" hidden><span class="nmda-source-action-icon">▣</span><strong>打开 ZIP</strong></label>
                  <button class="nmda-source-action nmda-source-action-button" id="nmda-show-paste" type="button"><span class="nmda-source-action-icon">⌘</span><strong>粘贴内容</strong><small>粘贴邮件文本或表格</small></button>
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
                              <strong id="nmda-preflight-attachment-title">附件</strong>
                              <small id="nmda-preflight-attachment-copy">添加本批次需要的附件。</small>
                              <div class="nmda-attachment-requirements" id="nmda-preflight-attachment-requirements"></div>
                              <div class="nmda-supplement-status" id="nmda-preflight-attachment-status">尚未添加</div>
                              <div class="nmda-attachment-assets nmda-attachment-assets-inline" id="nmda-preflight-attachment-assets" hidden>
                                <div class="nmda-attachment-assets-head"><strong>已加入附件</strong><span id="nmda-preflight-attachment-assets-count"></span></div>
                                <div class="nmda-attachment-assets-list" id="nmda-preflight-attachment-assets-list"></div>
                              </div>
                            </div>
                            <div class="nmda-supplement-actions nmda-supplement-actions-split">
                              <label class="nmda-btn nmda-btn-small nmda-btn-primary" for="nmda-attachment-files">添加文件</label>
                              <label class="nmda-btn nmda-btn-small" for="nmda-attachment-dir">附件目录</label>
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
                    <div><span class="nmda-supplement-kicker">本批次附件</span><h3 id="nmda-attachment-manager-title">附件资料</h3><p>管理本批次需要的附件。</p></div>
                    <button class="nmda-icon-btn" id="nmda-close-attachment-manager" type="button" aria-label="关闭附件管理">×</button>
                  </div>
                  <div class="nmda-attachment-manager-body">
                    <div class="nmda-attachment-manager-summary" id="nmda-attachment-manager-summary">尚未加入附件。</div>
                    <div class="nmda-attachment-assets" id="nmda-attachment-manager-assets">
                      <div class="nmda-attachment-assets-list" id="nmda-attachment-manager-list"></div>
                      <div class="nmda-attachment-assets-empty" id="nmda-attachment-manager-empty">还没有附件。可以加入附件文件夹，或直接选择一个或多个文件。</div>
                    </div>
                  </div>
                  <div class="nmda-attachment-manager-foot">
                    <div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-primary" for="nmda-attachment-files">添加并发送文件</label><label class="nmda-btn" for="nmda-attachment-dir">添加匹配文件夹</label><button class="nmda-btn nmda-btn-danger-quiet" id="nmda-manager-clear-attachments" type="button">清空附件</button></div>
                    <button class="nmda-btn" id="nmda-attachment-manager-done" type="button">完成</button>
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
                  <div class="nmda-context-cue-actions"><label class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-attachment-send-action" for="nmda-attachment-files">添加并发送文件</label><label class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-attachment-dir-action" for="nmda-attachment-dir">选择匹配文件夹</label><button class="nmda-btn nmda-btn-small" id="nmda-manage-attachments-todo" type="button">管理附件</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-attachment-later" type="button">稍后处理</button></div>
                </div>
                <div class="nmda-attachment-library-bar" id="nmda-attachment-library-bar" hidden><div class="nmda-attachment-library-bar-main"><span class="nmda-attachment-library-bar-icon">↗</span><div><strong id="nmda-attachment-library-bar-title">附件资料</strong><small id="nmda-attachment-library-bar-copy">查看或调整已加入的附件。</small></div></div><button class="nmda-btn nmda-btn-small" id="nmda-manage-attachments-workflow" type="button">查看 / 修改</button></div>
                <div id="nmda-import-preview-summary" class="nmda-ingest-health"></div>
                <div id="nmda-review-guidance" class="nmda-review-guidance">解析完成后可查看每封邮件的结果。</div>
                <details class="nmda-optional-source-details" id="nmda-attachments-card" hidden>
                  <summary><span><strong>添加附件</strong><small>选择要随邮件使用的附件</small></span><span>展开</span></summary>
                  <div id="nmda-attachment-summary" class="nmda-summary">尚未添加附件。</div>
                  <div class="nmda-attachment-grid nmda-attachment-grid-simple">
                    <div class="nmda-file-source"><span class="nmda-label">附件</span><div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-small nmda-file-button">添加并发送文件<input id="nmda-attachment-files" type="file" multiple hidden></label><label class="nmda-btn nmda-btn-small nmda-file-button">选择匹配目录<input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden></label></div></div>
                    <div class="nmda-file-source nmda-file-source-shared"><span class="nmda-label">额外公共附件</span><label class="nmda-btn nmda-btn-small nmda-file-button">添加并发送<input id="nmda-shared-files" type="file" multiple hidden></label></div>
                  </div>
                  <div id="nmda-attachment-drop" class="nmda-attachment-drop">也可以把要发送的附件拖到这里 · 拖入即视为明确发送</div>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-clear-attachments" type="button">清空附件</button><span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span></div>
                  <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden><div class="nmda-card-subtitle">需要补充的附件</div><div id="nmda-attachment-resolution-list"></div></div>
                </details>
                <div class="nmda-import-handoff-card" id="nmda-import-handoff-card" hidden>
                  <div id="nmda-import-ready-summary" class="nmda-import-ready-summary">尚未生成任务。</div>
                  <div class="nmda-row nmda-import-handoff-actions"><span class="nmda-hint" id="nmda-handoff-hint"></span><button class="nmda-btn nmda-btn-primary" id="nmda-go-batch" type="button">进入选择与安排</button></div>
                </div>
              </div>

              <div class="nmda-card nmda-inline-review" id="nmda-inline-review" hidden>
                <div class="nmda-inline-review-top">
                  <div><div class="nmda-card-title" id="nmda-review-workspace-title">处理待办</div><div class="nmda-card-desc" id="nmda-review-workspace-desc">先解决影响创建的事项；需要比较时并排查看，需要修改时直接编辑。</div></div>
                  <div class="nmda-inline-review-actions"><div id="nmda-review-page-summary" class="nmda-review-page-summary"></div><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-next-pending" type="button">下一个待办</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-import-editor-cancel" type="button">退出检查</button></div>
                </div>
                <div class="nmda-review-page-empty" id="nmda-review-page-empty">添加资料后，这里会显示解析结果。</div>
                <div class="nmda-review-workbench" id="nmda-import-editor-overlay" hidden>
                  <div class="nmda-review-layout">
                    <aside class="nmda-review-queue-pane">
                      <div class="nmda-review-pane-title nmda-review-queue-titlebar"><strong id="nmda-review-queue-title">待办列表</strong><small id="nmda-review-queue-caption">按影响程度排序</small></div>
                      <div class="nmda-review-queue-tools">
                        <label class="nmda-review-search"><span aria-hidden="true">⌕</span><input id="nmda-review-search" type="search" placeholder="搜索姓名 / 邮箱 / 主题" autocomplete="off"></label>
                        <div class="nmda-review-filter" id="nmda-review-filter" role="group" aria-label="邮件范围"><button class="is-active" type="button" data-review-filter="pending">只看待办</button><button type="button" data-review-filter="all">全部邮件</button></div>
                        <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-bulk-entry" id="nmda-review-select-filtered" type="button">批量确认…</button>
                      </div>
                      <div class="nmda-review-batchbar" id="nmda-review-batchbar" hidden>
                        <div><strong id="nmda-review-selected-count">已选 0 封</strong><small>一次确认所选邮件</small></div>
                        <div class="nmda-row"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-confirm-selected" type="button">确认所选</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-clear-selected" type="button">取消</button></div>
                      </div>
                      <div id="nmda-review-queue" class="nmda-review-queue"></div>
                    </aside>
                    <section class="nmda-review-edit-pane">
                      <div class="nmda-review-pane-title nmda-review-mail-toolbar">
                        <span class="nmda-review-mail-heading"><strong id="nmda-review-mail-title">邮件内容</strong><small id="nmda-review-problem-summary">需要时直接修改</small></span>
                        <div class="nmda-review-mail-actions">
                          <div class="nmda-review-pager" role="group" aria-label="切换邮件"><button type="button" id="nmda-review-prev" aria-label="上一封">‹</button><span id="nmda-review-position">1 / 1</span><button type="button" id="nmda-review-next" aria-label="下一封">›</button></div>
                          <button class="nmda-review-exclude-direct" id="nmda-review-exclude" type="button" title="不会创建这封草稿；之后可从已排除邮件中恢复">排除此封</button>
                        </div>
                      </div>
                      <div class="nmda-review-edit-scroll">
                        <div id="nmda-review-feedback" class="nmda-review-feedback" hidden></div>
                        <section class="nmda-duplicate-decision" id="nmda-duplicate-decision" hidden>
                          <div class="nmda-duplicate-decision-head">
                            <div><strong id="nmda-duplicate-decision-title">发现重复邮件</strong><small id="nmda-duplicate-decision-copy">同时预览本组邮件，勾选实际要保留的版本。</small></div>
                            <span class="nmda-duplicate-kind" id="nmda-duplicate-decision-kind">重复</span>
                          </div>
                          <div class="nmda-duplicate-candidates" id="nmda-duplicate-candidates"></div>
                          <div class="nmda-duplicate-actions">
                            <span class="nmda-hint" id="nmda-duplicate-decision-hint">默认勾选信息更完整的一封；也可以直接勾选多封。</span>
                            <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary" id="nmda-duplicate-keep-selected" type="button">保留所选（1）</button><button class="nmda-btn" id="nmda-duplicate-keep-all" type="button">全部保留</button></div>
                          </div>
                        </section>
                        <div class="nmda-import-editor-grid nmda-review-core-fields">
                          <label class="nmda-field" id="nmda-review-field-recipients"><span class="nmda-label">收件人</span><input id="nmda-import-edit-recipients" type="text" placeholder="recipient@example.edu"><span id="nmda-recipient-assist" class="nmda-field-assist" hidden></span></label>
                          <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-subject"><span class="nmda-label">主题</span><input id="nmda-import-edit-subject" type="text"></label>
                          <div class="nmda-context-assist" id="nmda-subject-assist" hidden>
                            <div><strong id="nmda-subject-assist-title">还有邮件缺少主题</strong><small id="nmda-subject-assist-copy"></small></div>
                            <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-subject-assist-apply" type="button">一键填写</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-subject-assist-dismiss" type="button">不用</button></div>
                          </div>
                          <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-body"><span class="nmda-label">正文</span><textarea id="nmda-import-edit-body"></textarea></label>
                        </div>

                      </div>
                      <input id="nmda-import-edit-schedule" type="hidden">
                      <input id="nmda-import-edit-attachments" type="hidden">
                      <input id="nmda-import-edit-tags" type="hidden">
                      <div class="nmda-review-actions" id="nmda-review-actions" hidden>
                        <span class="nmda-review-action-copy">这封邮件需要你的明确确认。</span>
                        <div class="nmda-row nmda-wrap"><button class="nmda-btn" id="nmda-import-editor-save" type="button">确认本封</button><button class="nmda-btn nmda-btn-primary" id="nmda-import-editor-next" type="button">确认并下一封</button></div>
                      </div>
                    </section>
                  </div>
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

            <div class="nmda-card nmda-list-card" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head"><div><div><div class="nmda-card-title">安排本次邮件</div></div></div><div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div></div>
              <div class="nmda-planning-modebar" id="nmda-planning-modebar" aria-label="排期视图">
                <button class="is-active" type="button" data-planning-view="rules"><span>◷</span><strong>排期规则</strong></button>
                <button type="button" data-planning-view="mails"><span>≡</span><strong>邮件时间</strong></button>
              </div>
              <details class="nmda-scope-tools" id="nmda-scope-tools">
                <summary><span><strong>筛选与排除</strong><small>需要时再筛选或排除</small></span><span class="nmda-scope-toggle">展开</span></summary>
                <div class="nmda-task-toolbar">
                <label class="nmda-search-field"><input id="nmda-batch-search" type="search" placeholder="搜索收件人或主题"></label>
                <label class="nmda-compact-select"><span>联系状态</span><select id="nmda-batch-stage-filter"><option value="">全部</option><option value="未联系">未联系</option><option value="已发送">已发送</option><option value="已回复">已回复</option></select></label>
                  <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">纳入筛选结果</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-selection" type="button">排除全部</button>
                </div>
              </details>
              <input id="nmda-batch-tag-include" type="hidden"><button id="nmda-clear-tag-filter" type="button" hidden></button><div id="nmda-batch-tag-chips" hidden></div>
              <input id="nmda-bulk-tag-value" type="hidden"><button id="nmda-bulk-add-tag" type="button" hidden></button><button id="nmda-bulk-remove-tag" type="button" hidden></button><button id="nmda-bulk-disable" type="button" hidden></button>

              <details class="nmda-inline-scheduler" id="nmda-scheduler-card" hidden open>
                <summary><span><strong>排期设置</strong><small id="nmda-schedule-summary"></small></span><span id="nmda-scheduler-toggle-label">收起</span></summary>
                <div class="nmda-stage-preflight" id="nmda-schedule-context-cue"><span class="nmda-stage-preflight-icon">◷</span><div><strong>排期规则</strong><small id="nmda-schedule-context-copy">设置开始时间与同校间隔。</small></div></div>
                <div class="nmda-scheduler-grid">
                  <label class="nmda-field"><span class="nmda-label">开始时间</span><input id="nmda-rule-start-at" type="datetime-local"></label>
                  <label class="nmda-field"><span class="nmda-label">每所院校每轮最多</span><input id="nmda-rule-max-school" type="number" min="1" max="20" step="1" value="1"></label>
                  <label class="nmda-field"><span class="nmda-label">同校间隔</span><div class="nmda-input-suffix"><input id="nmda-rule-interval-days" type="number" min="1" max="365" step="1" value="7"><span>天</span></div></label>
                  <label class="nmda-check-card"><input id="nmda-rule-preserve-existing" type="checkbox" checked><span><strong>保留已有时间</strong></span></label>
                </div>
                <div class="nmda-scheduler-purpose-note nmda-scheduler-policy-row"><label class="nmda-scheduler-holiday-toggle"><input id="nmda-rule-skip-holidays" type="checkbox" checked><span><strong>避开节假日和周末</strong></span></label></div>
                <div class="nmda-scheduler-actions">
                  <div id="nmda-schedule-rule-preview" class="nmda-schedule-rule-preview">同校每 7 天最多 1 位。</div>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-auto-schedule" type="button">清除自动时间</button>
                  <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-apply-schedule" type="button">应用</button>
                </div>
              </details>

              <div class="nmda-table-wrap nmda-batch-table-wrap"><table class="nmda-table nmda-batch-table"><thead><tr><th>选择</th><th>收件人</th><th>主题</th><th>发送时间</th><th>结果</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
            </div>

            <div class="nmda-card nmda-run-card nmda-create-stage" id="nmda-run-card" hidden>
              <div class="nmda-run-left"><div><div class="nmda-card-title">创建草稿</div><div id="nmda-batch-status" class="nmda-run-status">先选择要创建的邮件。</div><div id="nmda-create-preflight" class="nmda-create-preflight">创建前会汇总本次选择、定时和附件状态。</div></div></div>
              <div class="nmda-run-controls nmda-run-controls-simple">
                <button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">创建所选草稿</button>
                <button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封后停止</button>
              </div>
            </div>

          </section>

          <div class="nmda-page-head" data-page-head="contacts" hidden>
            <div><h2>联系人</h2><p>查看联系状态与最近进展。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="contacts" hidden>
            <div class="nmda-crm-top-grid">
              <div class="nmda-card nmda-mail-history-card nmda-contact-command-card">
                <div class="nmda-card-head">
                  <div><div class="nmda-card-title">邮箱状态</div><div class="nmda-card-desc">同步最近的已发送与草稿，联系人状态会随之更新。</div></div>
                  <div class="nmda-row nmda-wrap nmda-contact-command-actions"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-refresh-history" type="button">同步邮箱</button><button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出 CSV</button></div>
                </div>
                <div class="nmda-contact-sync-line"><div id="nmda-mailbox-read-meta" class="nmda-read-meta">尚未同步邮箱状态。</div><div id="nmda-contact-status" class="nmda-summary">正在加载联系人…</div></div>
                <details class="nmda-maintenance-details">
                  <summary>记录异常时再维护</summary>
                  <div class="nmda-maintenance-row"><div><strong>重建联系人记录</strong><small>仅在记录明显不一致时使用；会重新读取已发送和草稿。</small></div><button class="nmda-btn nmda-btn-small" id="nmda-rebuild-history" type="button">重建记录</button></div>
                </details>
              </div>
            </div>

            <div class="nmda-card nmda-contact-list-card">
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-card-title">联系人列表</div><div class="nmda-card-desc">搜索、筛选并直接查看当前跟进状态。</div></div><div id="nmda-contact-summary" class="nmda-summary nmda-summary-inline">0 个联系人</div></div>
              <div class="nmda-contact-toolbar nmda-contact-toolbar-unified">
                <input id="nmda-contact-search" type="text" placeholder="搜索邮箱 / 姓名 / 主题 / 状态 / 标记">
                <input id="nmda-contact-class-filter" type="text" placeholder="状态 / 策略 / 长期标记（多个需同时满足）">
              </div>
              <div id="nmda-contact-class-chips" class="nmda-tag-chips nmda-class-chip-bar"></div>
              <div class="nmda-table-wrap nmda-contact-table-wrap"><table class="nmda-table nmda-contact-table"><thead><tr><th>联系人</th><th>状态 / 标记</th><th>已发送</th><th>草稿</th><th>最后发送</th><th>最后草稿</th><th>最近发送主题</th></tr></thead><tbody id="nmda-contact-body"></tbody></table></div>
            </div>
          </section>
        </main>
      </section>`;
    document.documentElement.appendChild(root);
    return root;
  }

  const ui = buildUI();
  const $ = id => ui.querySelector(`#${id}`);
  const launcher = $('nmda-launcher'), panel = $('nmda-panel');
  document.documentElement.classList.add('nmda-app-document');
  document.body?.classList.add('nmda-app-body');
  ui.classList.add('nmda-standalone');
  panel.hidden = false;
  launcher.hidden = true;
  $('nmda-expand').hidden = true;
  $('nmda-close').hidden = true;
  const recipientsEl = $('nmda-recipients'), subjectEl = $('nmda-subject'), bodyEl = $('nmda-body-text'), filesEl = $('nmda-files');
  const scheduleAtEl = $('nmda-schedule-at');
  const fillButton = $('nmda-fill'), statusEl = $('nmda-status');

  let hostScrollSnapshot=null;
  function setHostScrollLocked(locked){
    const targets=[document.documentElement,document.body].filter(Boolean);
    if(locked&&!hostScrollSnapshot){
      hostScrollSnapshot=targets.map(el=>({el,value:el.style.getPropertyValue('overflow'),priority:el.style.getPropertyPriority('overflow')}));
      for(const el of targets)el.style.setProperty('overflow','hidden','important');
    }else if(!locked&&hostScrollSnapshot){
      for(const item of hostScrollSnapshot){if(item.value)item.el.style.setProperty('overflow',item.value,item.priority);else item.el.style.removeProperty('overflow');}
      hostScrollSnapshot=null;
    }
  }
  function syncModalState(){
    const modalOpen=[$('nmda-supplement-preflight'),$('nmda-attachment-manager-overlay')].some(el=>el&&!el.hidden);
    panel.classList.toggle('has-modal',modalOpen);
  }
  function setPanelOpen(open){panel.hidden=!open;setHostScrollLocked(open);if(open)syncModalState();}

  const connectionEl=$('nmda-mail-connection'), connectionTitleEl=$('nmda-mail-connection-title'), connectionDetailEl=$('nmda-mail-connection-detail'), openMailEl=$('nmda-open-mail');
  async function refreshMailboxConnection(){
    if(!connectionEl)return null;
    try{
      const state=await chrome.runtime.sendMessage({type:'NMDA_CONNECTION_STATUS'});
      const connected=!!state?.connected, authenticated=!!state?.authenticated;
      connectionEl.dataset.state=authenticated?'connected':connected?'login':'offline';
      connectionTitleEl.textContent=authenticated?(state.account?`网易邮箱 · ${state.account}`:'网易邮箱已连接'):connected?'网易邮箱已打开 · 待登录':'网易邮箱未连接';
      connectionDetailEl.textContent=authenticated?'已连接':connected?'请先登录':'未连接';
      openMailEl.textContent=connected?'切换邮箱':'连接邮箱';
      if(authenticated && state.account && typeof Contacts!=='undefined') {
        const normalized=Contacts?.normalizeEmail?.(state.account)||String(state.account).toLowerCase();
        if(contactBook?.loaded && contactBook.account!==normalized){await ensureContactBook(true);scheduleContactsRender({force:currentWorkbenchTab()==='contacts'});invalidateBatchView(true);}
      }
      return state;
    }catch(error){
      connectionEl.dataset.state='offline'; connectionTitleEl.textContent='连接状态不可用'; connectionDetailEl.textContent=error?.message||String(error); return null;
    }
  }
  openMailEl?.addEventListener('click',async()=>{openMailEl.disabled=true;try{await chrome.runtime.sendMessage({type:'NMDA_OPEN_MAIL',focus:true});}finally{openMailEl.disabled=false;setTimeout(refreshMailboxConnection,500);}});
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==='NMDA_CONNECTION_CHANGED') refreshMailboxConnection();
    if(message?.type==='NMDA_EXECUTION_PROGRESS_BROADCAST'){
      const handler=executionProgressHandlers.get(String(message.executionId||'')); if(handler) handler(message);
    }
  });
  window.addEventListener('focus',refreshMailboxConnection);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshMailboxConnection();});
  refreshMailboxConnection();

  const contactBook = { account: '', contacts: {}, loaded: false };

  // UI performance state: navigation must stay a cheap visibility change.
  // Expensive lists are rendered only after their underlying data becomes dirty,
  // and input-driven refreshes are coalesced into a single animation frame.
  const viewPerf = {
    batchDirty: true,
    batchAuxDirty: true,
    contactsDirty: true,
    batchFrame: 0,
    contactsFrame: 0,
    contactVersion: 0,
    contactCacheVersion: -1,
    contactCache: null,
    contactRenderLimit: 250,
    reviewRenderLimit: 250,
    formSaveTimer: 0,
    contactPersistTimer: 0,
    contactPersistPromise: null
  };

  function debounce(fn, delay = 120) {
    let timer = 0;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; fn(...args); }, delay);
    };
  }

  function markContactsChanged() {
    viewPerf.contactVersion++;
    viewPerf.contactsDirty = true;
    viewPerf.contactCache = null;
  }

  function invalidateBatchView(aux = true) {
    viewPerf.batchDirty = true;
    if (aux) viewPerf.batchAuxDirty = true;
  }

  function batchPaneVisible() {
    return !panel.hidden && currentWorkbenchTab() === 'batch';
  }

  function contactsPaneVisible() {
    return !panel.hidden && currentWorkbenchTab() === 'contacts';
  }

  function scheduleBatchRender({ aux = false, force = false } = {}) {
    invalidateBatchView(aux);
    if (!force && !batchPaneVisible()) return;
    if (viewPerf.batchFrame) cancelAnimationFrame(viewPerf.batchFrame);
    viewPerf.batchFrame = requestAnimationFrame(() => {
      viewPerf.batchFrame = 0;
      if (!force && !batchPaneVisible()) return;
      renderPreview({ aux: viewPerf.batchAuxDirty });
    });
  }

  function scheduleContactsRender({ force = false } = {}) {
    viewPerf.contactsDirty = true;
    if (!force && !contactsPaneVisible()) return;
    if (viewPerf.contactsFrame) cancelAnimationFrame(viewPerf.contactsFrame);
    viewPerf.contactsFrame = requestAnimationFrame(() => {
      viewPerf.contactsFrame = 0;
      if (!force && !contactsPaneVisible()) return;
      renderContacts();
    });
  }

  async function detectAccount() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_ACCOUNT_INFO' });
      if (result?.ok && result.uid) return Contacts?.normalizeEmail?.(result.uid) || String(result.uid).toLowerCase();
    } catch (_) {}
    const text = document.querySelector('#spnUid')?.textContent || '';
    return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9.-])/i)?.[0]?.toLowerCase() || 'default';
  }

  async function ensureContactBook(force = false) {
    if (!Contacts) return contactBook;
    const account = await detectAccount();
    if (force || !contactBook.loaded || contactBook.account !== account) {
      contactBook.account = account;
      contactBook.contacts = await Contacts.load(account);
      contactBook.loaded = true;
      markContactsChanged();
    }
    return contactBook;
  }

  async function persistContacts() {
    if (!Contacts || !contactBook.loaded) return;
    if (viewPerf.contactPersistTimer) { clearTimeout(viewPerf.contactPersistTimer); viewPerf.contactPersistTimer = 0; }
    const pending = Contacts.save(contactBook.account, contactBook.contacts);
    viewPerf.contactPersistPromise = pending;
    try { await pending; } finally { if (viewPerf.contactPersistPromise === pending) viewPerf.contactPersistPromise = null; }
  }

  function queueContactsPersist(delay = 350) {
    if (!Contacts || !contactBook.loaded) return;
    if (viewPerf.contactPersistTimer) clearTimeout(viewPerf.contactPersistTimer);
    viewPerf.contactPersistTimer = setTimeout(() => {
      viewPerf.contactPersistTimer = 0;
      persistContacts().catch(error => console.warn(`[${APP}] contact persistence failed`, error));
    }, delay);
  }

  function contactClassificationsForRecipients(raw) {
    if (!Contacts || !contactBook.loaded) return [];
    const values = [];
    for (const item of Contacts.parseRecipients(raw)) {
      const contact = contactBook.contacts[item.email] || Contacts.ensureContact({}, item.email);
      values.push(...Contacts.classificationLabels(contact));
    }
    return Contacts.mergeTags(values);
  }

  function contactStateForRecipients(raw) {
    if (!Contacts || !contactBook.loaded) return { stage:'未联系', stages:['未联系'], followUp:false, policies:[], blocked:false };
    const stages=[], policies=[]; let followUp=false;
    for (const item of Contacts.parseRecipients(raw)) {
      const contact = Contacts.normalizeContactShape(contactBook.contacts[item.email] || Contacts.ensureContact({}, item.email));
      stages.push(contact.stage || '未联系');
      if (contact.followUp) followUp=true;
      if (contact.policy && contact.policy !== '正常') policies.push(contact.policy);
    }
    const uniqueStages=[...new Set(stages.length?stages:['未联系'])];
    return {
      stage: uniqueStages.length===1 ? uniqueStages[0] : '多状态',
      stages: uniqueStages,
      followUp,
      policies:[...new Set(policies)],
      blocked:policies.length>0
    };
  }

  function taskBusinessTags(task) {
    const contactTags=task ? taskContactSnapshot(task).tags : [];
    const taskTags=parseTaskClassifications(task?.tags || []);
    return Contacts ? Contacts.mergeTags(contactTags, taskTags) : [...new Set([...contactTags,...taskTags])];
  }

  function contactTagsForRecipients(raw) {
    if (!Contacts || !contactBook.loaded) return [];
    const tags = [];
    for (const item of Contacts.parseRecipients(raw)) tags.push(...(contactBook.contacts[item.email]?.tags || []));
    return Contacts.mergeTags(tags);
  }

  function contactPolicyGateForRecipients(raw) {
    if (!Contacts || !contactBook.loaded) return { blocked: false, policies: [], reasons: [] };
    const policies = [];
    const reasons = [];
    for (const item of Contacts.parseRecipients(raw)) {
      const contact = contactBook.contacts[item.email];
      const policy = contact?.policy || '正常';
      if (policy !== '正常') {
        policies.push(policy);
        reasons.push(`${item.email}：${policy}`);
      }
    }
    return { blocked: policies.length > 0, policies: [...new Set(policies)], reasons };
  }

  function tagsText(tags) {
    return (Contacts?.parseTags?.(tags) || []).join('；');
  }

  function classificationChipHtml(item) {
    const kind = item?.kind || 'tag';
    const value = item?.value || item || '';
    return `<span class="nmda-class-chip" data-class-kind="${escapeHtml(kind)}">${escapeHtml(value)}</span>`;
  }

  function contactOperationalItems(contact) {
    if(!Contacts) return [];
    const c=Contacts.normalizeContactShape(contact||{});
    const items=[{kind:'stage',value:c.stage||'未联系'}];
    if(c.followUp)items.push({kind:'followup',value:'待跟进'});
    if(c.policy&&c.policy!=='正常')items.push({kind:'policy',value:c.policy});
    for(const tag of (Contacts.parseContactTags?.(c.tags||[])||[]))items.push({kind:'tag',value:tag});
    return items;
  }

  function contactOperationalLabels(contact) { return contactOperationalItems(contact).map(item=>item.value); }

  function contactClassificationChips(contact) {
    return contactOperationalItems(contact).map(classificationChipHtml).join('');
  }

  function setContactStatusMessage(message, kind = '') {
    const el = $('nmda-contact-status');
    if (!el) return;
    el.textContent = message;
    if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
  }

  function mailboxCoverageText(meta = {}) {
    if (!meta || (!meta.lastQuickAt && !meta.lastFullAt)) return '尚未读取邮箱状态。';
    const parts = [];
    if (meta.lastFullAt) parts.push(`最近修复：${Contacts.formatDisplayTime(meta.lastFullAt)}`);
    else if (meta.lastQuickAt) parts.push(`最近同步：${Contacts.formatDisplayTime(meta.lastQuickAt)}`);
    if (meta.sent) parts.push(`已发送 ${meta.sent.read ?? 0}${meta.sent.complete ? '（完整）' : meta.sent.total ? ` / ${meta.sent.total}` : ''}`);
    if (meta.drafts) parts.push(`草稿 ${meta.drafts.read ?? 0}${meta.drafts.complete ? '（完整）' : meta.drafts.total ? ` / ${meta.drafts.total}` : ''}`);
    if (meta.lastMode === 'full' && meta.complete) parts.push('邮箱记录已完整更新');
    return parts.join(' · ');
  }

  async function renderMailboxReadMeta(meta = null) {
    const el = $('nmda-mailbox-read-meta');
    if (!el || !Contacts) return;
    try {
      if (!meta) {
        await ensureContactBook();
        meta = await Contacts.loadSyncMeta(contactBook.account);
      }
      el.textContent = mailboxCoverageText(meta || {});
      el.dataset.complete = meta?.lastMode === 'full' && meta?.complete ? 'true' : 'false';
    } catch (_) { el.textContent = '暂时无法读取邮箱记录状态。'; }
  }

  function contactViewCache() {
    if(viewPerf.contactCache && viewPerf.contactCacheVersion===viewPerf.contactVersion)return viewPerf.contactCache;
    const rows=[];
    const stageCounts=Object.fromEntries(Contacts.STAGE_OPTIONS.map(stage=>[stage,0]));
    let followCount=0,pausedCount=0,noContactCount=0,withDraftCount=0;
    const classCounts=new Map();
    for(const raw of Object.values(contactBook.contacts||{})){
      const contact=Contacts.normalizeContactShape(raw);
      const labels=contactOperationalLabels(contact);
      stageCounts[contact.stage]=(stageCounts[contact.stage]||0)+1;
      if(contact.followUp)followCount++;
      if(contact.policy==='暂停')pausedCount++;
      if(contact.policy==='不再联系')noContactCount++;
      if(Number(contact.draftCount||0)>0)withDraftCount++;
      for(const value of (Contacts.parseContactTags?.(contact.tags||[])||[]))classCounts.set(value,(classCounts.get(value)||0)+1);
      const search=(`${contact.email} ${contact.name||''} ${contact.lastSubject||''} ${contact.lastDraftSubject||''} ${labels.join(' ')}`).toLowerCase();
      rows.push({contact,labelsLower:new Set(labels.map(value=>value.toLocaleLowerCase('zh-CN'))),search});
    }
    rows.sort((a,b)=>{
      const ta=Math.max(Date.parse(a.contact.lastSentAt||'')||0,Date.parse(a.contact.lastDraftAt||'')||0);
      const tb=Math.max(Date.parse(b.contact.lastSentAt||'')||0,Date.parse(b.contact.lastDraftAt||'')||0);
      return tb-ta||String(a.contact.email).localeCompare(String(b.contact.email));
    });
    const topClasses=[...classCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN')).slice(0,40);
    viewPerf.contactCache={rows,stageCounts,followCount,pausedCount,noContactCount,withDraftCount,topClasses};
    viewPerf.contactCacheVersion=viewPerf.contactVersion;
    return viewPerf.contactCache;
  }

  function renderContacts() {
    if(!Contacts)return;
    const body=$('nmda-contact-body'),summary=$('nmda-contact-summary'),chipBar=$('nmda-contact-class-chips');
    if(!body||!summary)return;
    const query=String($('nmda-contact-search')?.value||'').trim().toLowerCase();
    const classFilter=Contacts.parseTags($('nmda-contact-class-filter')?.value||'').map(value=>value.toLocaleLowerCase('zh-CN'));
    const cache=contactViewCache();
    let rows=cache.rows;
    if(classFilter.length)rows=rows.filter(item=>classFilter.every(value=>item.labelsLower.has(value)));
    if(query)rows=rows.filter(item=>item.search.includes(query));
    const allCount=cache.rows.length;
    summary.textContent=`${allCount} 个联系人 · ${Contacts.STAGE_OPTIONS.map(stage=>`${stage} ${cache.stageCounts[stage]||0}`).join(' · ')} · 有草稿 ${cache.withDraftCount} · 待跟进 ${cache.followCount} · 暂停 ${cache.pausedCount} · 不再联系 ${cache.noContactCount}`;

    if(chipBar){
      chipBar.innerHTML=cache.topClasses.length?cache.topClasses.map(([value,count])=>`<button type="button" class="nmda-tag-chip" data-contact-class-chip="${escapeHtml(value)}">${escapeHtml(value)} <small>${count}</small></button>`).join(''):'<span class="nmda-hint">暂无长期标记。状态统计已在右侧汇总。</span>';
    }

    const limit=Math.max(50,viewPerf.contactRenderLimit||250),visibleRows=rows.slice(0,limit);
    body.innerHTML=visibleRows.map(({contact})=>`<tr data-contact-row="${escapeHtml(contact.email)}">
      <td><strong>${escapeHtml(contact.name||contact.email)}</strong><small>${escapeHtml(contact.name?contact.email:'')}</small></td>
      <td class="nmda-contact-class-cell"><div class="nmda-class-preview">${contactClassificationChips(contact)}</div><div class="nmda-class-editor">
        <label><span>阶段</span><select class="nmda-class-select" data-contact-stage="${escapeHtml(contact.email)}">${Contacts.STAGE_OPTIONS.map(stage=>`<option value="${escapeHtml(stage)}" ${contact.stage===stage?'selected':''}>${escapeHtml(stage)}</option>`).join('')}</select></label>
        <label class="nmda-followup-toggle"><input type="checkbox" data-contact-followup="${escapeHtml(contact.email)}" ${contact.followUp?'checked':''}> 待跟进</label>
        <label><span>策略</span><select class="nmda-class-select" data-contact-policy="${escapeHtml(contact.email)}">${Contacts.POLICY_OPTIONS.map(policy=>`<option value="${escapeHtml(policy)}" ${contact.policy===policy?'selected':''}>${escapeHtml(policy)}</option>`).join('')}</select></label>
        <label class="nmda-class-tags"><span>长期标记</span><input class="nmda-contact-tags-input" data-contact-tags-email="${escapeHtml(contact.email)}" value="${escapeHtml(tagsText(contact.tags))}" placeholder="重点;第一批"></label>
      </div></td>
      <td>${Number(contact.sentCount||0)}</td><td><strong>${Number(contact.draftCount||0)}</strong>${Number(contact.draftCount||0)>0?'<small>当前已识别</small>':''}</td>
      <td title="${escapeHtml(contact.lastSentAt||'')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastSentAt))}</td>
      <td title="${escapeHtml(contact.lastDraftAt||'')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastDraftAt))}${contact.lastDraftSubject?`<small title="${escapeHtml(contact.lastDraftSubject)}">${escapeHtml(contact.lastDraftSubject)}</small>`:''}</td>
      <td title="${escapeHtml(contact.lastSubject||'')}">${escapeHtml(contact.lastSubject||'—')}</td></tr>`).join('');
    if(!rows.length)body.innerHTML='<tr><td colspan="7">暂无匹配联系人。可同步邮箱状态，或导入批量任务。</td></tr>';
    else if(rows.length>visibleRows.length)body.insertAdjacentHTML('beforeend',`<tr class="nmda-load-more-row"><td colspan="7"><button type="button" class="nmda-btn nmda-btn-small nmda-btn-quiet" data-contact-load-more>继续显示（${visibleRows.length}/${rows.length}）</button></td></tr>`);
    viewPerf.contactsDirty=false;
  }

  async function initContacts() {
    if(!Contacts){setContactStatusMessage('联系人模块未加载。','error');return;}
    try{
      await ensureContactBook(true);
      // Keep startup cheap: contacts stay data-only until the user opens that tab.
      scheduleContactsRender();
      await renderMailboxReadMeta();
      setContactStatusMessage(`当前邮箱：${contactBook.account}。联系人记录已就绪。`,'ok');
      if(typeof renderPreview==='function')scheduleBatchRender({aux:true});
    }catch(error){setContactStatusMessage(`联系人初始化失败：${error.message}`,'error');}
  }


  $('nmda-contact-class-chips')?.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-contact-class-chip]');if(!button)return;
    const input=$('nmda-contact-class-filter');if(!input)return;
    const now=Contacts.parseTags(input.value),clicked=button.dataset.contactClassChip,key=clicked.toLocaleLowerCase('zh-CN');
    const exists=now.some(value=>value.toLocaleLowerCase('zh-CN')===key);
    input.value=exists?now.filter(value=>value.toLocaleLowerCase('zh-CN')!==key).join(';'):Contacts.mergeTags(now,[clicked]).join(';');
    viewPerf.contactRenderLimit=250;scheduleContactsRender({force:contactsPaneVisible()});
  });

  $('nmda-contact-body')?.addEventListener('click',event=>{
    if(!event.target.closest?.('[data-contact-load-more]'))return;
    viewPerf.contactRenderLimit=(viewPerf.contactRenderLimit||250)+250;
    scheduleContactsRender({force:true});
  });

  $('nmda-contact-body')?.addEventListener('change',async event=>{
    const el=event.target;
    if(!(el instanceof HTMLInputElement||el instanceof HTMLSelectElement))return;
    let message='',kind='ok',affectsPolicy=false,affectsBatchView=false;
    if(el.dataset.contactStage){
      Contacts.setStage(contactBook.contacts,el.dataset.contactStage,el.value);
      message=`已更新 ${el.dataset.contactStage} 的互动阶段：${el.value}。`;affectsBatchView=true;
    }else if(el.dataset.contactPolicy){
      Contacts.setPolicy(contactBook.contacts,el.dataset.contactPolicy,el.value);
      message=`已更新 ${el.dataset.contactPolicy} 的联系策略：${el.value}。`;kind=el.value==='正常'?'ok':'warn';affectsPolicy=true;
    }else if(el.dataset.contactFollowup){
      Contacts.setFollowUp(contactBook.contacts,el.dataset.contactFollowup,el.checked);
      message=`${el.dataset.contactFollowup}${el.checked?' 已标记':' 已取消'}待跟进。`;affectsBatchView=true;
    }else if(el.dataset.contactTagsEmail){
      const contact=Contacts.setTags(contactBook.contacts,el.dataset.contactTagsEmail,el.value);
      message=`已更新 ${el.dataset.contactTagsEmail} 的长期标记：${tagsText(contact?.tags)||'无'}。`;affectsBatchView=true;
    }else return;
    markContactsChanged();
    queueContactsPersist();
    scheduleContactsRender();
    if(affectsPolicy&&batch.dataset)rebuildTasks();
    else if(affectsBatchView)scheduleBatchRender({aux:false});
    setContactStatusMessage(message,kind);
  });

  function setStatus(message, kind = '') {
    statusEl.textContent = message;
    if (kind) statusEl.dataset.kind = kind; else delete statusEl.dataset.kind;
  }

  function formState() {
    return { recipients: recipientsEl.value, subject: subjectEl.value, body: bodyEl.value, scheduleAt: scheduleAtEl.value };
  }

  async function saveFormState() {
    if (viewPerf.formSaveTimer) { clearTimeout(viewPerf.formSaveTimer); viewPerf.formSaveTimer = 0; }
    try { await chrome.storage.local.set({ [STORAGE_KEY]: formState() }); } catch (_) {}
  }

  function queueFormStateSave() {
    if (viewPerf.formSaveTimer) clearTimeout(viewPerf.formSaveTimer);
    viewPerf.formSaveTimer = setTimeout(() => {
      viewPerf.formSaveTimer = 0;
      saveFormState();
    }, 500);
  }

  async function restoreFormState() {
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) return;
      recipientsEl.value = stored.recipients || ''; subjectEl.value = stored.subject || ''; bodyEl.value = stored.body || '';
      scheduleAtEl.value = stored.scheduleEnabled === false ? '' : (stored.scheduleAt || '');
    } catch (_) {}
  }

  function currentWorkbenchTab() {
    return ui.querySelector('.nmda-tab.is-active')?.dataset.tab || 'batch';
  }

  function renderProcessGuide() {
    const guides = ui.querySelectorAll('.nmda-process-guide');
    if (!guides.length || typeof batch === 'undefined') return;
    const hasSource = !!batch.dataset;
    const handed = !!batch.handoffComplete;
    const attachmentIssues=hasSource && typeof importAttachmentStats==='function' ? importAttachmentStats().issues : 0;
    let review = 0, selected = 0, scheduled = 0, other = 0, completed = 0;
    for (const task of (batch.tasks || [])) {
      if (hasSource && typeof taskNeedsImportReview === 'function' && taskNeedsImportReview(task)) review++;
      if (hasSource && typeof taskIssueState === 'function' && taskIssueState(task).other.length) other++;
      if (handed && task.enabled && task.status === 'ready') { selected++; if (task.scheduleAt) scheduled++; }
      if (task.status === 'done' || task.status === 'running') completed++;
    }
    const blockers=review+attachmentIssues+other;
    const contextPending=hasSource && typeof supplementPreflightNeedsDecision==='function' && supplementPreflightNeedsDecision();
    const creating=!!batch.running || completed>0;
    guides.forEach(guide => {
      const currentStep = (!hasSource || contextPending) ? 1 : blockers ? 2 : creating ? 4 : 3;
      guide.dataset.currentStep = String(currentStep);
      const canView = step => step===1 || (step===2&&hasSource&&!contextPending) || (step===3&&hasSource&&!contextPending&&!blockers) || (step===4&&handed&&selected>0);
      if (!canView(Number(batch.uiStep||1))) batch.uiStep=currentStep;
      const title = guide.querySelector('.nmda-process-guide-title strong');
      if (title) title.textContent = `步骤 ${Number(batch.uiStep||currentStep)} / 4`;
      const workbench=guide.closest('.nmda-bulk-workbench');
      if(workbench)workbench.dataset.viewStep=String(batch.uiStep||currentStep);
      guide.querySelectorAll('[data-flow-step]').forEach(button => {
        const step = Number(button.dataset.flowStep || 0);
        let state='locked', unlocked=false;
        if(step===1){unlocked=true; state=(!hasSource||contextPending)?'active':'done';}
        else if(step===2){unlocked=hasSource&&!contextPending; state=!unlocked?'locked':blockers?'active':'done';}
        else if(step===3){unlocked=hasSource&&!contextPending&&!blockers; state=!unlocked?'locked':creating?'done':'active';}
        else if(step===4){unlocked=handed&&selected>0; state=creating?'active':unlocked?'ready':'locked';}
        button.dataset.state=state; button.classList.toggle('is-viewing',step===Number(batch.uiStep||currentStep)); button.setAttribute('aria-current',step===Number(batch.uiStep||currentStep)?'step':'false'); button.disabled=!unlocked && !(step===2&&hasSource);
        const small=button.querySelector('small');
        if(!small) return;
        if(step===1) small.textContent=!hasSource?'先导入邮件':contextPending?'补总名单 / 附件':'批次资料已准备';
        if(step===2) small.textContent=!hasSource?'添加资料后处理':contextPending?'先完成批次准备':blockers?`${blockers} 项待办`:'待办已完成';
        if(step===3) small.textContent=blockers?'先完成待办':selected?`已纳入 ${selected} 封${scheduled?` · 定时 ${scheduled}`:''}`:'暂无可创建邮件';
        if(step===4) small.textContent=creating?`${completed} 封已开始处理`:!unlocked?'确认邮件后可创建':`已可创建 ${selected} 封`;
      });
    });
  }

  function goToProcessStep(step) {
    const n = Number(step || 1);
    setWorkbenchTab('batch');
    batch.uiStep = n;
    renderProcessGuide();
    if (n === 1) return;
    if (n === 2) {
      if (!batch.dataset) { batch.uiStep=1; renderProcessGuide(); return; }
      openNextBlockingIssue();
      return;
    }
    if (!batch.handoffComplete) {
      batch.uiStep = 2;
      renderProcessGuide();
      setImportStatus('先完成当前待办，完成后会自动进入排期。', 'warn');
      return;
    }
    if(n===4){
      const target=$('nmda-run-card');
      target?.classList.add('is-attention');
      setTimeout(()=>target?.classList.remove('is-attention'),700);
      requestAnimationFrame(()=>$('nmda-batch-start')?.focus?.({preventScroll:true}));
    }
  }

  function setWorkbenchTab(name) {
    const current = currentWorkbenchTab();
    if (current !== name) {
      ui.querySelectorAll('.nmda-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
      ui.querySelectorAll('.nmda-tabpane').forEach(p => { p.hidden = p.dataset.pane !== name; });
      ui.querySelectorAll('[data-page-head]').forEach(head => { head.hidden = head.dataset.pageHead !== name; });
    }
    // Switching workspace is intentionally cheap. Re-render only when data changed,
    // and defer that work until the browser can paint the tab transition first.
    if (name === 'batch' && viewPerf.batchDirty) scheduleBatchRender();
    if (name === 'contacts' && viewPerf.contactsDirty) scheduleContactsRender();
  }

  launcher.addEventListener('click', () => {
    setPanelOpen(panel.hidden);
    if (!panel.hidden) {
      const name = currentWorkbenchTab();
      if (name === 'batch' && viewPerf.batchDirty) scheduleBatchRender();
      if (name === 'contacts' && viewPerf.contactsDirty) scheduleContactsRender();
    }
  });
  $('nmda-close').addEventListener('click', () => { setPanelOpen(false); });
  $('nmda-expand').addEventListener('click', () => {
    panel.classList.toggle('is-maximized');
    $('nmda-expand').textContent = panel.classList.contains('is-maximized') ? '◱' : '⛶';
    $('nmda-expand').title = panel.classList.contains('is-maximized') ? '还原工作台' : '全屏工作台';
  });
  ui.querySelectorAll('.nmda-tab').forEach(tab => tab.addEventListener('click', () => setWorkbenchTab(tab.dataset.tab)));
  ui.querySelectorAll('[data-flow-step]').forEach(button => button.addEventListener('click', () => goToProcessStep(button.dataset.flowStep)));
  $('nmda-go-import')?.addEventListener('click', () => { setWorkbenchTab('batch'); requestAnimationFrame(() => $('nmda-stage-prepare')?.scrollIntoView?.({behavior:'smooth', block:'start'})); });

  [recipientsEl, subjectEl, bodyEl, scheduleAtEl].forEach(el => {
    el.addEventListener('input', queueFormStateSave);
    el.addEventListener('change', saveFormState);
  });
  filesEl?.addEventListener('change', () => {
    const summary = $('nmda-single-file-summary');
    if (!summary) return;
    const files = [...(filesEl.files || [])];
    summary.textContent = files.length ? (files.length === 1 ? files[0].name : `已选择 ${files.length} 个附件`) : '未选择附件';
  });

  fillButton.addEventListener('click', async () => {
    fillButton.disabled = true; await saveFormState();
    try {
      setStatus('准备连接网易邮箱…');
      const outcome = await executeDraftRemotely({
        recipients: recipientsEl.value, subject: subjectEl.value, body: bodyEl.value,
        scheduleAt: scheduleAtEl.value, files: [...(filesEl.files || [])]
      }, { fresh: true, onProgress: progress => setStatus(progress.message || '正在创建草稿…') });
      const attachment = outcome.attachment || {};
      const attachmentWarning = attachment.verified === false && attachment.missingNames?.length ? `；附件页面暂未确认：${attachment.missingNames.join('、')}` : '';
      setStatus(`完成：草稿已确认保存（${outcome.saveOutcome?.evidence || '网易页面确认'}）${attachmentWarning}。`, attachmentWarning ? 'warn' : 'ok');
      refreshMailboxConnection();
    } catch (error) { console.error(`[${APP}]`, error); setStatus(`失败：${error.message}`, 'error'); }
    finally { fillButton.disabled = false; }
  });

  const batch = {
    dataset: null, collectionIndex: 0, collectionConfigs: new Map(), detection: null, mapping: {}, tasks: [],
    directoryFiles: [], taskFiles: [], routedAttachmentFiles: [], sharedFiles: [], fileIndex: Importer?.buildFileIndex?.([]),
    attachmentOverrides: new Map(), taskEdits: new Map(), running: false, stopRequested: false,
    importMeta: null, profileSuggestion: null,
    sessionId: 0, importBusy: false, schedulePlan: null,
    scheduleRules: { ...(Scheduler?.DEFAULT_RULES || { maxPerGroupPerRound:1, intervalDays:7, preserveExisting:true, intraRoundMinutes:10 }), startAt: Scheduler?.defaultStart?.() || '' },
    roster: emptyRosterState(), duplicateAudit:null,
    handoffComplete: false, autoAdvancing: false, reviewFilter: 'pending', reviewSearch: '', reviewSelected: new Set(), duplicateSelections: new Map(), attachmentAttentionShown: false, rosterPromptChoice:'idle', attachmentPromptDeferred:false, attachmentPrepChoice:'idle', supplementPreflightDone:false, supplementPreflightOpen:false, preflightView:'files', supportView:'roster', attachmentManagerOpen:false, uiStep:1, planningView:'rules', sourceInspectName:'', preflightFolderPath:'', preflightSearch:'', preflightReviewOnly:false, preflightPurposeFilter:'', ignoredAttachmentIdentities:new Set()
  };

  const importFileEl = $('nmda-import-file'), importDirEl = $('nmda-import-dir'), importPackageEl = $('nmda-import-package'), rosterFileEl = $('nmda-roster-file'), collectionSelectEl = $('nmda-collection-select'), mappingEl = $('nmda-mapping'), mappingToggleEl = $('nmda-toggle-mapping');
  const pasteSourceEl = $('nmda-paste-source'), importPreviewSummaryEl = $('nmda-import-preview-summary'), importReviewBtnEl = $('nmda-review-import-issues');
  const subjectAssistEl = $('nmda-subject-assist'), subjectAssistTitleEl = $('nmda-subject-assist-title'), subjectAssistCopyEl = $('nmda-subject-assist-copy');
  const importEditorOverlayEl = $('nmda-import-editor-overlay'), importEditRecipientsEl = $('nmda-import-edit-recipients'), importEditSubjectEl = $('nmda-import-edit-subject'), importEditBodyEl = $('nmda-import-edit-body'), importEditAttachmentsEl = $('nmda-import-edit-attachments'), importEditScheduleEl = $('nmda-import-edit-schedule'), importEditTagsEl = $('nmda-import-edit-tags'), importEditorEvidenceEl = $('nmda-import-editor-evidence');
  const reviewQueueEl = $('nmda-review-queue'), reviewSourceContextEl = $('nmda-review-source-context'), reviewSourceMetaEl = $('nmda-review-source-meta'), reviewCandidatesEl = $('nmda-review-email-candidates'), reviewProgressEl = $('nmda-review-progress'), reviewProblemSummaryEl = $('nmda-review-problem-summary'), reviewFeedbackEl = $('nmda-review-feedback');
  const reviewNavCountEl=$('nmda-review-nav-count'), reviewInlineEl=$('nmda-inline-review'), reviewPageSummaryEl=$('nmda-review-page-summary'), reviewPageEmptyEl=$('nmda-review-page-empty'), reviewQueueCaptionEl=$('nmda-review-queue-caption');
  const reviewWorkspaceTitleEl=$('nmda-review-workspace-title'), reviewWorkspaceDescEl=$('nmda-review-workspace-desc'), reviewActionsEl=$('nmda-review-actions'), reviewMoreMenuEl=$('nmda-review-more-menu'), reviewExitEl=$('nmda-import-editor-cancel');
  const reviewQueueTitleEl=$('nmda-review-queue-title'), reviewFilterEl=$('nmda-review-filter'), reviewSearchEl=$('nmda-review-search'), reviewMailTitleEl=$('nmda-review-mail-title'), reviewPositionEl=$('nmda-review-position'), reviewPrevEl=$('nmda-review-prev'), reviewNextEl=$('nmda-review-next');
  const reviewBatchbarEl=$('nmda-review-batchbar'), reviewSelectedCountEl=$('nmda-review-selected-count'), reviewEvidenceDetailsEl=$('nmda-review-evidence-details');
  const duplicateDecisionEl=$('nmda-duplicate-decision'), duplicateDecisionTitleEl=$('nmda-duplicate-decision-title'), duplicateDecisionCopyEl=$('nmda-duplicate-decision-copy'), duplicateDecisionKindEl=$('nmda-duplicate-decision-kind'), duplicateCandidatesEl=$('nmda-duplicate-candidates'), duplicateDecisionHintEl=$('nmda-duplicate-decision-hint'), duplicateKeepSelectedEl=$('nmda-duplicate-keep-selected'), duplicateKeepAllEl=$('nmda-duplicate-keep-all');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files'), sharedFilesEl = $('nmda-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status'), importStatusEl = $('nmda-import-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop');
  const scheduleStartEl = $('nmda-rule-start-at'), scheduleMaxSchoolEl = $('nmda-rule-max-school'), scheduleIntervalDaysEl = $('nmda-rule-interval-days'), schedulePreserveEl = $('nmda-rule-preserve-existing'), scheduleHolidayEl = $('nmda-rule-skip-holidays');
  const scheduleApplyEl = $('nmda-apply-schedule'), scheduleClearEl = $('nmda-clear-auto-schedule'), scheduleSummaryEl = $('nmda-schedule-summary'), scheduleRulePreviewEl = $('nmda-schedule-rule-preview'), schedulerCardEl = $('nmda-scheduler-card'), schedulerToggleLabelEl = $('nmda-scheduler-toggle-label');
  const batchSearchEl = $('nmda-batch-search');
  const batchTagIncludeEl = $('nmda-batch-tag-include'), batchStageFilterEl = $('nmda-batch-stage-filter');
  const importBusyBadgeEl = $('nmda-import-busy-badge'), resetImportEl = $('nmda-reset-import');
  let subjectAssistTimer = null;

  function isCurrentBatchSession(token) { return Number(token) === Number(batch.sessionId); }

  const SCHEDULE_PREFS_KEY = 'nmda.schedule.rules.v1';
  function loadScheduleRulePrefs() {
    try { const raw=JSON.parse(localStorage.getItem(SCHEDULE_PREFS_KEY)||'{}'); return Scheduler?.normalizeRules?.({...raw,startAt:''}) || raw; }
    catch (_) { return {}; }
  }
  function freshScheduleRules() {
    const prefs=loadScheduleRulePrefs();
    return {
      ...(Scheduler?.DEFAULT_RULES || {maxPerGroupPerRound:1,intervalDays:7,preserveExisting:true,intraRoundMinutes:10,skipHolidays:true}),
      ...prefs,
      startAt: Scheduler?.defaultStart?.() || ''
    };
  }
  function saveScheduleRulePrefs(rules) {
    try { localStorage.setItem(SCHEDULE_PREFS_KEY, JSON.stringify({maxPerGroupPerRound:rules.maxPerGroupPerRound,intervalDays:rules.intervalDays,preserveExisting:rules.preserveExisting,intraRoundMinutes:rules.intraRoundMinutes||10,skipHolidays:rules.skipHolidays!==false})); } catch (_) {}
  }
  function syncScheduleRuleControls() {
    if(!batch.scheduleRules) batch.scheduleRules=freshScheduleRules();
    if(scheduleStartEl && document.activeElement!==scheduleStartEl) scheduleStartEl.value=batch.scheduleRules.startAt||'';
    if(scheduleMaxSchoolEl && document.activeElement!==scheduleMaxSchoolEl) scheduleMaxSchoolEl.value=String(batch.scheduleRules.maxPerGroupPerRound||1);
    if(scheduleIntervalDaysEl && document.activeElement!==scheduleIntervalDaysEl) scheduleIntervalDaysEl.value=String(batch.scheduleRules.intervalDays||7);
    if(schedulePreserveEl) schedulePreserveEl.checked=batch.scheduleRules.preserveExisting!==false;
    if(scheduleHolidayEl) scheduleHolidayEl.checked=batch.scheduleRules.skipHolidays!==false;
  }
  function readScheduleRuleControls() {
    const rules=Scheduler?.normalizeRules?.({
      startAt:scheduleStartEl?.value||batch.scheduleRules?.startAt||'',
      maxPerGroupPerRound:scheduleMaxSchoolEl?.value||1,
      intervalDays:scheduleIntervalDaysEl?.value||7,
      preserveExisting:schedulePreserveEl?.checked!==false,
      intraRoundMinutes:batch.scheduleRules?.intraRoundMinutes||10,
      skipHolidays:scheduleHolidayEl?.checked!==false
    }) || {startAt:scheduleStartEl?.value||'',maxPerGroupPerRound:Number(scheduleMaxSchoolEl?.value||1),intervalDays:Number(scheduleIntervalDaysEl?.value||7),preserveExisting:schedulePreserveEl?.checked!==false,skipHolidays:scheduleHolidayEl?.checked!==false};
    batch.scheduleRules=rules; saveScheduleRulePrefs(rules); return rules;
  }
  batch.scheduleRules = freshScheduleRules();
  (async()=>{
    try{
      if(localStorage.getItem(SCHEDULE_PREFS_KEY))return;
      const legacy=await chrome.runtime.sendMessage({type:'NMDA_LEGACY_PREFS'});
      if(legacy?.ok&&legacy.scheduleRules){localStorage.setItem(SCHEDULE_PREFS_KEY,legacy.scheduleRules);batch.scheduleRules=freshScheduleRules();syncScheduleRuleControls();}
    }catch(_){}
  })();

  // One delegated handler replaces hundreds of row listeners that used to be
  // destroyed and rebound after every table refresh.
  previewBodyEl?.addEventListener('change', event => {
    const input=event.target;
    if(!(input instanceof HTMLInputElement))return;
    if(input.dataset.taskEnabled){
      const task=batch.tasks.find(item=>item.editKey===input.dataset.taskEnabled);if(!task)return;
      setTaskEdit(task,{enabled:input.checked});
      const row=input.closest('tr');if(row)row.dataset.enabled=input.checked?'1':'0';
      const stateCell=row?.querySelector('.nmda-task-state-cell');
      if(stateCell){const text=statusLabel(task),fileText=task.files?.length?` · 附件 ${task.files.length}`:'';stateCell.textContent=`${text}${fileText}`;stateCell.title=text;}
      renderBatchSummaryControls();
      renderScheduleCenter();
      // Only rebuild visible rows if an active search could depend on "未选择/可执行".
      if(String(batchSearchEl?.value||'').trim())scheduleBatchRender({aux:false});
      return;
    }
    if(input.dataset.taskSchedule){
      const task=batch.tasks.find(item=>item.editKey===input.dataset.taskSchedule);if(!task)return;
      const value=input.value||'';
      setTaskEdit(task,{scheduleAt:value,scheduleSource:value?'manual':'manual-clear',scheduleReason:value?'手工调整':''});
      const small=input.parentElement?.querySelector('small');if(small)small.textContent=scheduleSourceLabel(task);
      renderBatchSummaryControls();
      renderScheduleCenter();
      if(String(batchSearchEl?.value||'').trim())scheduleBatchRender({aux:false});
    }
  });

  reviewQueueEl?.addEventListener('click',event=>{
    if(event.target.closest?.('[data-review-load-more]')){viewPerf.reviewRenderLimit=(viewPerf.reviewRenderLimit||250)+250;renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');return;}
    const button=event.target.closest?.('[data-review-key]');if(!button)return;
    stashCurrentReviewDraft(); hideSubjectAssist();
    const task=(batch.tasks||[]).find(t=>t.editKey===button.dataset.reviewKey);if(task)openImportTaskEditor(task);
  });
  reviewQueueEl?.addEventListener('change',event=>{
    const input=event.target.closest?.('[data-review-select]');if(!input)return;
    const key=input.dataset.reviewSelect;if(!key)return;
    if(input.checked)batch.reviewSelected.add(key);else batch.reviewSelected.delete(key);
    input.closest('.nmda-review-queue-row')?.classList.toggle('is-selected',input.checked);
    renderReviewBatchActions();
    const visible=reviewVisibleTasks().filter(taskCanBatchConfirm),allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    const selectButton=$('nmda-review-select-filtered');if(selectButton){const batchMode=batch.reviewFilter==='pending'&&reviewTasks().length>0;selectButton.hidden=!batchMode||visible.length<2;selectButton.textContent=allSelected?'取消批量选择':`批量确认 ${visible.length} 封…`;}
  });


  reviewSearchEl?.addEventListener('input',()=>{
    batch.reviewSearch=String(reviewSearchEl.value||'');
    viewPerf.reviewRenderLimit=250;
    const currentKey=importEditorOverlayEl?.dataset.editKey||'';
    renderReviewQueue(currentKey);
    const visible=reviewVisibleTasks();
    if(visible.length && !visible.some(task=>task.editKey===currentKey))openImportTaskEditor(visible[0]);
    else{const current=(batch.tasks||[]).find(task=>task.editKey===currentKey);if(current)updateReviewMailNavigation(current);}
  });
  reviewPrevEl?.addEventListener('click',()=>navigateReviewMail(-1));
  reviewNextEl?.addEventListener('click',()=>navigateReviewMail(1));

  function referenceRosterCount() {
    return Number(rosterState()?.entries?.length || 0);
  }

  function rosterContextState() {
    if(referenceRosterCount())return 'added';
    if(batch.dataset && (batch.tasks||[]).length)return batch.rosterPromptChoice==='skipped'?'skipped':'pending';
    return 'prepare';
  }

  function rosterContextNeedsDecision() {
    return rosterContextState()==='pending';
  }

  function attachmentPreparedFileCount() {
    return uniqueFiles([...(batch.directoryFiles||[]), ...(batch.taskFiles||[]), ...(batch.routedAttachmentFiles||[]), ...(batch.sharedFiles||[])]).length;
  }

  function attachmentPreflightState() {
    const count=attachmentPreparedFileCount();
    if(count) return 'added';
    if(batch.dataset && (batch.tasks||[]).length) return batch.attachmentPrepChoice==='skipped'?'skipped':'pending';
    return 'prepare';
  }

  function supplementPreflightNeedsDecision() {
    return !!batch.dataset && !batch.supplementPreflightDone;
  }

  function attachmentRequirementRefs() {
    const refs=[];const seen=new Set();
    for(const task of batch.tasks||[]) for(const ref of task.attachmentRefs||[]){
      const key=Importer.normalizeFileKey(ref);if(!key||seen.has(key))continue;seen.add(key);refs.push(String(ref));
    }
    return refs;
  }

  function formatAttachmentSize(file) {
    const size=Number(file?.size||0);if(!size)return '大小未知';
    if(size<1024)return `${size} B`;
    if(size<1024*1024)return `${Math.max(1,Math.round(size/1024))} KB`;
    return `${(size/1024/1024).toFixed(size>=10*1024*1024?0:1)} MB`;
  }

  function attachmentAssetEntries() {
    const groups=[
      ['directory',batch.directoryFiles||[],'附件文件夹'],
      ['task',batch.taskFiles||[],'资料包 / 匹配库'],
      ['routed',batch.routedAttachmentFiles||[],'导入资料'],
      ['shared',batch.sharedFiles||[],'手动添加 · 直接发送']
    ];
    const out=[],seen=new Set();
    for(const [kind,files,source] of groups) for(const file of files){
      const identity=Importer.fileIdentity(file);if(!identity||seen.has(identity))continue;seen.add(identity);
      const used=(batch.tasks||[]).filter(task=>(task.files||[]).some(item=>Importer.fileIdentity(item)===identity)).length;
      out.push({file,identity,kind,source,used});
    }
    return out;
  }

  function sourceIdentityKey(value) {
    return String(value||'').replace(/\\/g,'/').replace(/^\.\//,'').trim();
  }

  function sourceIdentityMatches(value,sourceName,fileName='') {
    const candidate=sourceIdentityKey(value),full=sourceIdentityKey(sourceName),leaf=sourceIdentityKey(fileName||String(full).split('/').pop());
    if(!candidate)return false;
    return candidate===full||candidate===leaf;
  }

  function collectionDirectMatchesSource(collection,sourceName,fileName='') {
    return sourceIdentityMatches(collection?.source,sourceName,fileName);
  }

  function collectionMatchesSource(collection,sourceName,fileName='') {
    if(collectionDirectMatchesSource(collection,sourceName,fileName))return true;
    return (collection?.meta?.sourceMembers||[]).some(member=>sourceIdentityMatches(member,sourceName,fileName));
  }

  function sourceCollections(sourceName,fileName='') {
    const matches=recordSets().map((collection,index)=>({collection,index,direct:collectionDirectMatchesSource(collection,sourceName,fileName)})).filter(({collection})=>collectionMatchesSource(collection,sourceName,fileName));
    const direct=matches.filter(item=>item.direct);
    // Aggregate Word collections list every source in sourceMembers. They are an
    // execution view, not a per-file preview. Prefer the exact source collection
    // whenever it exists so selecting B.docx can never show A.docx's content.
    return (direct.length?direct:matches).map(({collection,index})=>({collection,index}));
  }

  function setSourcePurpose(sourceName,purpose,fileName='') {
    if(!['mail','roster','attachment','ignored'].includes(purpose))return;
    const resolvedFileName=fileName||String(sourceName||'').replace(/\\/g,'/').split('/').pop()||'';
    const related=sourceCollections(sourceName,resolvedFileName),primary=related.filter(({collection})=>!collection.meta?.supplemental),targets=primary.length?primary:related;
    if(!targets.length)return;
    for(const {collection,index} of targets){
      const config=ensureCollectionConfig(index);if(!config)continue;
      config.purpose=purpose;config.enabled=purpose==='mail';
      collection.meta={...(collection.meta||{}),purposeOverride:purpose,sourcePurpose:purpose,purposeConfidence:100,purposeReasons:['用户已确认资料用途']};
    }
    batch.handoffComplete=false;
    syncRoutedSources();
    clearStaleOverrides();
    batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());
    rebuildTasks();
    renderSourceInventory();renderCollectionList();renderPreflightSourceRoles();renderAttachmentAssetViews();renderSupplementPreflight();
    const label={mail:'邮件',roster:'参考总名单',attachment:'附件',ignored:'暂不使用'}[purpose];
    setImportStatus(`已将 ${resolvedFileName||sourceName} 调整为${label}，本批次结果已重新整理。`,'ok');
  }

  function sourcePurposeDecision(file) {
    const sourceName=sourceFileName(file),related=sourceCollections(sourceName,file?.name),primary=related.filter(({collection})=>!collection.meta?.supplemental),items=primary.length?primary:related;
    const userConfirmed=items.some(({collection})=>!!collection.meta?.purposeOverride);
    const configPurposes=[...new Set(items.map(({index})=>ensureCollectionConfig(index)?.purpose||'ignored'))];
    const evidence=items.map(({collection,index})=>({
      purpose:String(collection.meta?.sourcePurpose||'ambiguous'),
      confidence:Number(collection.meta?.purposeConfidence||0),
      reasons:collection.meta?.purposeReasons||[],index
    }));
    const scoreByPurpose=new Map();
    for(const item of evidence){
      if(!['mail','roster','attachment','ignored'].includes(item.purpose))continue;
      scoreByPurpose.set(item.purpose,Math.max(Number(scoreByPurpose.get(item.purpose)||0),item.confidence));
    }
    const ranked=[...scoreByPurpose.entries()].map(([purpose,confidence])=>({purpose,confidence})).sort((a,b)=>b.confidence-a.confidence);
    const top=ranked[0]||null,runner=ranked[1]||null;
    // A workbook can legitimately contain one useful roster sheet plus empty/helper
    // sheets. Do not make the whole file “待确认” merely because an auxiliary sheet
    // is ambiguous. Promote a single high-confidence source role only when it clearly
    // dominates every competing non-ambiguous role.
    const dominant=!userConfirmed&&top&&top.confidence>=85&&(!runner||runner.confidence<70||top.confidence-runner.confidence>=12)?top:null;
    let purpose='ignored';
    if(userConfirmed)purpose=configPurposes.length===1?configPurposes[0]:(configPurposes.find(value=>value!=='ignored')||configPurposes[0]||'ignored');
    else if(dominant)purpose=dominant.purpose;
    else if(configPurposes.length===1)purpose=configPurposes[0];
    const confidence=dominant?dominant.confidence:Math.max(0,...evidence.map(item=>item.confidence));
    const reasonSource=dominant?evidence.filter(item=>item.purpose===dominant.purpose):evidence;
    const reasons=[...new Set(reasonSource.flatMap(item=>item.reasons||[]))];
    const hasAmbiguous=evidence.some(item=>item.purpose==='ambiguous');
    const strongConflict=!!runner&&runner.confidence>=70&&(!top||top.confidence-runner.confidence<12);
    const needsReview=!userConfirmed&&!dominant&&(hasAmbiguous||confidence<70||strongConflict||!items.length);
    return{file,sourceName,purpose,confidence,reasons,items,needsReview,userConfirmed};
  }

  function roleConfidenceText(score) {
    const value=Number(score||0);return value>=90?'判断明确':value>=70?'基本确定':'需要留意';
  }

  function sourcePurposeOptions(selected) {
    const options=[['mail','邮件'],['roster','总名单'],['attachment','附件'],['review','待确认'],['ignored','暂不使用']];
    return options.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`).join('');
  }

  function sourceRoleVisual(purpose,needsReview=false) {
    if(needsReview)return{label:'待确认',icon:'!',tone:'review'};
    return {
      mail:{label:'邮件',icon:'✉',tone:'mail'},
      roster:{label:'总名单',icon:'名',tone:'roster'},
      attachment:{label:'附件',icon:'附',tone:'attachment'},
      ignored:{label:'暂不使用',icon:'×',tone:'ignored'}
    }[purpose]||{label:'待确认',icon:'!',tone:'review'};
  }

  function buildSourceFolderTree(decisions) {
    const root={name:'全部文件',path:'',count:0,direct:0,folders:new Map()};
    for(const decision of decisions){
      root.count++;
      const parts=String(decision.sourceName||'').replace(/\\/g,'/').split('/').filter(Boolean);parts.pop();
      if(!parts.length){root.direct++;continue;}
      let node=root,path='';
      for(const part of parts){
        path=path?`${path}/${part}`:part;
        if(!node.folders.has(part))node.folders.set(part,{name:part,path,count:0,direct:0,folders:new Map()});
        node=node.folders.get(part);node.count++;
      }
      node.direct++;
    }
    return root;
  }

  function sourceFolderNavHtml(node,depth=0) {
    return [...node.folders.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(folder=>{
      const active=batch.preflightFolderPath===folder.path;
      return `<div class="nmda-classify-folder-branch"><button class="nmda-classify-folder-row${active?' is-active':''}" type="button" data-preflight-folder="${escapeHtml(encodeURIComponent(folder.path))}" style="--depth:${depth}"><span class="nmda-classify-folder-chevron">›</span><span class="nmda-classify-folder-icon">▰</span><span class="nmda-classify-folder-name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</span><b>${folder.count}</b></button>${sourceFolderNavHtml(folder,depth+1)}</div>`;
    }).join('');
  }

  function sourceFileVisual(fileName) {
    const ext=String(fileName||'').split('.').pop().toLowerCase();
    if(['doc','docx','docm','rtf'].includes(ext))return{kind:'word',glyph:'W',label:ext==='rtf'?'RTF':'DOCX'};
    if(['xls','xlsx','ods','csv','tsv'].includes(ext))return{kind:'sheet',glyph:'X',label:['csv','tsv'].includes(ext)?ext.toUpperCase():'XLSX'};
    if(ext==='pdf')return{kind:'pdf',glyph:'P',label:'PDF'};
    if(['eml','msg'].includes(ext))return{kind:'email',glyph:'@',label:ext.toUpperCase()};
    if(['zip','rar','7z'].includes(ext))return{kind:'archive',glyph:'Z',label:ext.toUpperCase()};
    if(['jpg','jpeg','png','gif','webp','svg'].includes(ext))return{kind:'image',glyph:'▧',label:ext==='jpeg'?'JPG':ext.toUpperCase()};
    return{kind:'file',glyph:'F',label:(ext||'FILE').slice(0,5).toUpperCase()};
  }

  function sourceFileIconHtml(fileName) {
    const visual=sourceFileVisual(fileName);
    return `<span class="nmda-classify-file-icon" data-file-kind="${escapeHtml(visual.kind)}"><b>${escapeHtml(visual.glyph)}</b><small>${escapeHtml(visual.label)}</small></span>`;
  }

  function sourceFriendlyReason(decision) {
    if(decision.userConfirmed)return'你已确认这个文件的用途';
    const reason=String((decision.reasons||[]).find(Boolean)||'').trim();
    if(reason){
      if(reason.includes('证据不足或互相冲突'))return'文件同时具有多种用途特征，系统暂时没有替你决定';
      if(reason.includes('已停止自动分流'))return'文件用途不够明确，需要你看一眼内容后决定';
      if(reason.includes('普通文档缺少可验证'))return'暂时看不出明确的邮件、名单或附件用途';
      if(reason.includes('来源已明确指定用途'))return'这个用途来自你之前的选择';
      return reason.replace(/已按来源结构完成用途判断/g,'已根据文件内容判断用途');
    }
    if(decision.needsReview)return'系统不能完全确定，建议快速看一眼内容';
    if(decision.purpose==='mail')return'内容结构更像一封可以生成草稿的邮件';
    if(decision.purpose==='roster')return'内容更像联系人、导师或院校名单';
    if(decision.purpose==='attachment')return'内容更像需要随邮件使用的独立材料';
    return'当前不会参与本批次邮件创建';
  }

  function sourceFileTypeLabel(fileName) {
    const ext=String(fileName||'').split('.').pop().toLowerCase();
    if(['xls','xlsx','ods','csv','tsv'].includes(ext))return'表格';
    if(['doc','docx','docm','rtf'].includes(ext))return'Word';
    if(['eml','msg'].includes(ext))return'邮件文件';
    if(ext==='pdf')return'PDF';
    if(['zip','rar','7z'].includes(ext))return'压缩包';
    if(['jpg','jpeg','png','gif','webp','svg'].includes(ext))return'图片';
    return ext?ext.toUpperCase():'文件';
  }

  function sourcePrimaryCollection(decision) {
    const items=decision?.items||[],purpose=String(decision?.purpose||'');
    // When one workbook contains several sheets, preview the sheet that actually
    // supports the file-level decision instead of blindly taking the first sheet.
    const matchesPurpose=({collection,index})=>{
      const auto=String(collection?.meta?.sourcePurpose||''),configured=String(ensureCollectionConfig(index)?.purpose||'');
      return purpose&&purpose!=='ignored'&&(auto===purpose||configured===purpose);
    };
    return items.find(item=>matchesPurpose(item)&&!item.collection?.meta?.supplemental&&Array.isArray(item.collection?.rows)&&item.collection.rows.length)
      ||items.find(item=>matchesPurpose(item)&&Array.isArray(item.collection?.rows)&&item.collection.rows.length)
      ||items.find(({collection})=>!collection?.meta?.supplemental&&Array.isArray(collection?.rows)&&collection.rows.length)
      ||items.find(({collection})=>Array.isArray(collection?.rows)&&collection.rows.length)
      ||items[0]||null;
  }

  function sourceCollectionSnippet(decision,maxLength=86) {
    const item=sourcePrimaryCollection(decision),collection=item?.collection,rows=collection?.rows||[];
    if(!rows.length)return'';
    if(collection?.meta?.oneFileTask&&rows[1]){
      const subject=String(rows[1]?.[3]??'').replace(/\s+/g,' ').trim();
      const body=String(rows[1]?.[4]??'').replace(/\s+/g,' ').trim();
      const text=subject?`主题：${subject}${body?` · ${body}`:''}`:body;
      return text.length>maxLength?`${text.slice(0,maxLength)}…`:text;
    }
    const values=[];
    for(const row of rows.slice(0,6)){
      for(const cell of (row||[]).slice(0,6)){
        const text=String(cell??'').replace(/\s+/g,' ').trim();
        if(!text||values.includes(text))continue;
        values.push(text);
        if(values.join(' · ').length>=maxLength)break;
      }
      if(values.join(' · ').length>=maxLength)break;
    }
    const text=values.join(' · ');
    return text.length>maxLength?`${text.slice(0,maxLength)}…`:text;
  }

  function sourceTasksForDecision(decision) {
    const sourceName=sourceIdentityKey(decision?.sourceName),fileName=sourceIdentityKey(decision?.file?.name||String(sourceName).split('/').pop());
    const bySource=(batch.tasks||[]).filter(task=>!task.importExcluded&&sourceIdentityMatches(task.sourceFile,sourceName,fileName));
    if(bySource.length)return bySource;
    const indexes=new Set((decision?.items||[]).map(item=>item.index));
    return (batch.tasks||[]).filter(task=>indexes.has(Number(task.collectionIndex))&&!task.importExcluded);
  }

  function sourceRosterListHint(decision) {
    const item=sourcePrimaryCollection(decision),rows=item?.collection?.rows||[];
    if(rows.length<2)return'';
    const rosterDetection=typeof Importer.detectRosterHeader==='function'?Importer.detectRosterHeader(item.collection):null;
    const fallback=Importer.detectHeader(rows),headerIndex=rosterDetection&&Number(rosterDetection.index)>=0?Number(rosterDetection.index):Math.max(0,Number(fallback.index||0)),headers=(rows[headerIndex]||fallback.headers||[]).map(v=>String(v??'').trim());
    const records=Math.max(0,rows.length-headerIndex-1),sample=(rows[headerIndex+1]||[]).map(v=>String(v??'').replace(/\s+/g,' ').trim()).filter(Boolean);
    const usefulHeaders=headers.filter(Boolean).filter(h=>/学校|院校|大学|导师|教授|姓名|邮箱|方向|研究|联系人|university|school|supervisor|professor|name|email|research/i.test(h));
    const headerSummary=usefulHeaders.slice(0,3).join(' / ');
    const sampleSummary=sample.slice(0,2).join(' / ');
    return `${records} 条${headerSummary?` · ${headerSummary}`:''}${sampleSummary?` · 示例：${sampleSummary}`:''}`;
  }

  function sourceListContentHint(decision) {
    // The middle column exists only to answer “do I need to correct this file?”.
    // It intentionally shows a role-specific verification cue instead of dumping
    // raw headers/content that the user can inspect in the right pane.
    const tasks=sourceTasksForDecision(decision);
    if(decision.purpose==='mail'&&!decision.needsReview&&tasks.length){
      const task=tasks[0],subject=String(task.subject||'').replace(/\s+/g,' ').trim(),recipient=String(task.recipients||'').trim();
      if(recipient&&subject)return `${recipient} · ${subject}`;
      if(recipient)return `收件人 ${recipient}`;
      if(subject)return `主题 ${subject}`;
    }
    if(decision.purpose==='roster'&&!decision.needsReview){
      const rosterHint=sourceRosterListHint(decision);if(rosterHint)return rosterHint;
    }
    if(decision.needsReview){
      const rosterHint=sourceRosterListHint(decision);
      if(rosterHint)return `待确认 · ${rosterHint}`;
      return sourceFriendlyReason(decision);
    }
    const primary=sourcePrimaryCollection(decision),snippet=sourceCollectionSnippet(decision,72);
    if(decision.purpose==='attachment'){
      if(primary?.collection?.meta?.kind==='asset')return'—';
      return snippet?snippet:'—';
    }
    return snippet||'点击查看内容';
  }

  function sourceDecisionStateText(decision) {
    if(decision.userConfirmed)return'已修正';
    if(decision.needsReview)return'待确认';
    return decision.confidence>=85?'已识别':'建议看一眼';
  }

  function sourceDirectoryPath(sourceName) {
    const parts=String(sourceName||'').replace(/\\/g,'/').split('/').filter(Boolean);parts.pop();return parts.join('/');
  }

  function sourceVisibleDecisions(decisions) {
    const folder=String(batch.preflightFolderPath||''),query=String(batch.preflightSearch||'').trim().toLowerCase(),filter=String(batch.preflightPurposeFilter||'');
    return decisions.filter(decision=>{
      const directory=sourceDirectoryPath(decision.sourceName);
      if(folder && !(directory===folder||directory.startsWith(`${folder}/`)))return false;
      if(batch.preflightReviewOnly&&!decision.needsReview)return false;
      if(filter){if(filter==='review'){if(!decision.needsReview)return false;}else if(decision.needsReview||decision.purpose!==filter)return false;}
      if(query&&!`${decision.sourceName} ${decision.file?.name||''}`.toLowerCase().includes(query))return false;
      return true;
    });
  }

  function sourceFileRowsHtml(decisions) {
    if(!decisions.length)return'<div class="nmda-classify-empty"><span>⌕</span><strong>当前范围没有文件</strong><small>可以切换目录、清除筛选，或返回上传继续添加资料。</small></div>';
    return decisions.map(decision=>{
      const visual=sourceRoleVisual(decision.purpose,decision.needsReview),fileName=String(decision.sourceName||'').replace(/\\/g,'/').split('/').pop()||'未命名来源';
      const active=batch.sourceInspectName===decision.sourceName;
      const path=sourceDirectoryPath(decision.sourceName),meta=[path||'根目录',humanFileSize(decision.file?.size)].filter(Boolean).join(' · ');
      return `<div class="nmda-classify-file-row${active?' is-selected':''}" data-tone="${escapeHtml(visual.tone)}" data-review="${decision.needsReview?'1':'0'}" data-inspect-source="${escapeHtml(encodeURIComponent(decision.sourceName))}" data-source-row="${escapeHtml(encodeURIComponent(decision.sourceName))}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(fileName)}"><span class="nmda-classify-drag" draggable="true" data-source-drag="${escapeHtml(encodeURIComponent(decision.sourceName))}" title="拖动可快速归类" aria-label="拖动 ${escapeHtml(fileName)} 重新归类">⠿</span>${sourceFileIconHtml(fileName)}<div class="nmda-classify-file-main"><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(meta)}</small></div><span class="nmda-classify-purpose-pill" data-tone="${escapeHtml(visual.tone)}"><i>${escapeHtml(visual.icon)}</i><span>${escapeHtml(visual.label)}</span></span></div>`;
    }).join('');
  }

  function setSourceNeedsReview(sourceName,fileName='') {
    const resolvedFileName=fileName||String(sourceName||'').replace(/\\/g,'/').split('/').pop()||'';
    const related=sourceCollections(sourceName,resolvedFileName),primary=related.filter(({collection})=>!collection.meta?.supplemental),targets=primary.length?primary:related;
    if(!targets.length)return;
    for(const {collection,index} of targets){
      const config=ensureCollectionConfig(index);if(!config)continue;
      config.purpose='ignored';config.enabled=false;
      collection.meta={...(collection.meta||{}),purposeOverride:'',sourcePurpose:'ambiguous',purposeConfidence:0,purposeReasons:['已标记为待确认']};
    }
    batch.handoffComplete=false;syncRoutedSources();clearStaleOverrides();batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());rebuildTasks();
    renderSourceInventory();renderCollectionList();renderPreflightSourceRoles();renderAttachmentAssetViews();renderSupplementPreflight();
    setImportStatus(`已将 ${resolvedFileName||sourceName} 标记为待确认。`,'ok');
  }

  function sourceRosterPreviewHtml(decision) {
    const first=sourcePrimaryCollection(decision);if(!first)return'';
    const collection=first.collection,config=ensureCollectionConfig(first.index),rosterDetection=typeof Importer.detectRosterHeader==='function'?Importer.detectRosterHeader(collection):null,detection=config?.detection||Importer.detectHeader(collection.rows||[]),headerIndex=rosterDetection&&Number(rosterDetection.index)>=0?Number(rosterDetection.index):Math.max(0,Number(detection.index||0));
    const headers=(collection.rows?.[headerIndex]||detection.headers||[]).slice(0,4).map(value=>String(value||'').trim()||'字段');
    const rows=(collection.rows||[]).slice(headerIndex+1,headerIndex+4).map(row=>headers.map((_,i)=>String(row?.[i]??'').trim()));
    if(!headers.length||!rows.length)return'<div class="nmda-inspector-empty-preview">已识别为名单资料，暂无适合快速预览的表格内容。</div>';
    return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>内容预览</strong><span>约 ${Math.max(0,(collection.rows||[]).length-headerIndex-1)} 条</span></div><div class="nmda-inspector-mini-table"><div class="nmda-inspector-mini-row is-head">${headers.map(h=>`<span>${escapeHtml(h)}</span>`).join('')}</div>${rows.map(row=>`<div class="nmda-inspector-mini-row">${row.map(v=>`<span title="${escapeHtml(v)}">${escapeHtml(v||'—')}</span>`).join('')}</div>`).join('')}</div></div>`;
  }

  function sourceGenericPreviewHtml(decision) {
    const item=sourcePrimaryCollection(decision),collection=item?.collection,rows=(collection?.rows||[]).filter(row=>(row||[]).some(value=>String(value??'').trim()));
    if(!rows.length)return'<div class="nmda-inspector-empty-preview">暂时没有可展示的内容预览。</div>';
    if(collection?.meta?.oneFileTask&&rows[1]){
      const body=String(rows[1]?.[4]??'').trim(),subject=String(rows[1]?.[3]??'').trim();
      const text=(body||subject).replace(/\s+/g,' ').trim();
      return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>文件内容</strong><span>${escapeHtml(sourceFileTypeLabel(decision.file?.name||decision.sourceName))}</span></div><div class="nmda-inspector-text-preview">${escapeHtml(text?`${text.slice(0,420)}${text.length>420?'…':''}`:'暂时没有可展示的正文')}</div></div>`;
    }
    const width=Math.max(0,...rows.slice(0,5).map(row=>(row||[]).filter(value=>String(value??'').trim()).length));
    if(width>=2){
      const previewRows=rows.slice(0,4),cols=Math.min(4,Math.max(2,width));
      return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>文件内容</strong><span>前 ${previewRows.length} 行</span></div><div class="nmda-inspector-mini-table">${previewRows.map((row,rowIndex)=>`<div class="nmda-inspector-mini-row${rowIndex===0?' is-head':''}" style="--preview-cols:${cols}">${Array.from({length:cols},(_,i)=>{const value=String(row?.[i]??'').trim()||'—';return `<span title="${escapeHtml(value)}">${escapeHtml(value.length>34?`${value.slice(0,34)}…`:value)}</span>`;}).join('')}</div>`).join('')}</div></div>`;
    }
    const text=rows.slice(0,8).flat().map(value=>String(value??'').trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>文件内容</strong><span>${escapeHtml(sourceFileTypeLabel(decision.file?.name||decision.sourceName))}</span></div><div class="nmda-inspector-text-preview">${escapeHtml(text?`${text.slice(0,420)}${text.length>420?'…':''}`:'暂时没有可展示的内容')}</div></div>`;
  }

  function sourceInspectorContentHtml(decision) {
    const items=decision.items||[],tasks=sourceTasksForDecision(decision);
    if(decision.purpose==='mail'&&!decision.needsReview&&tasks.length){
      const task=tasks[0],body=String(task.body||'').replace(/\s+/g,' ').trim();
      return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>邮件内容</strong><span>${tasks.length>1?`共 ${tasks.length} 封`:'1 封邮件'}</span></div><div class="nmda-inspector-mail-fields"><div><span>收件人</span><strong>${escapeHtml(task.recipients||'尚未读取')}</strong></div><div><span>主题</span><strong>${escapeHtml(task.subject||'尚未读取')}</strong></div><div class="is-body"><span>正文</span><p>${escapeHtml(body?`${body.slice(0,520)}${body.length>520?'…':''}`:'尚未读取')}</p></div></div></div>`;
    }
    if(decision.purpose==='roster'&&!decision.needsReview)return sourceRosterPreviewHtml(decision);
    return sourceGenericPreviewHtml(decision);
  }

  function renderSourceInspector(decision) {
    const empty=$('nmda-source-inspector-empty'),card=$('nmda-source-inspector-card');if(!empty||!card)return;
    if(!decision){empty.hidden=false;card.hidden=true;return;}
    empty.hidden=true;card.hidden=false;
    const visual=sourceRoleVisual(decision.purpose,decision.needsReview),fileName=String(decision.sourceName||'').replace(/\\/g,'/').split('/').pop()||decision.sourceName;
    const title=$('nmda-source-inspector-title'),overview=$('nmda-source-inspector-overview'),content=$('nmda-source-inspector-content'),actions=$('nmda-source-inspector-actions');
    if(title)title.textContent='文件核验';
    if(overview){
      const reviewNote=decision.needsReview?`<div class="nmda-inspector-review-note"><span>!</span><div><strong>这个文件需要你决定用途</strong><small>${escapeHtml(sourceFriendlyReason(decision))}</small></div></div>`:'';
      overview.innerHTML=`<div class="nmda-inspector-file-title">${sourceFileIconHtml(fileName)}<div><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(sourceDirectoryPath(decision.sourceName)||'根目录')} · ${escapeHtml(humanFileSize(decision.file?.size))}</small></div></div>${reviewNote}`;
    }
    if(actions){
      const selected=decision.needsReview?'review':decision.purpose;
      actions.innerHTML=`<label class="nmda-inspector-purpose-field" data-review="${decision.needsReview?'1':'0'}"><span><strong>${decision.needsReview?'请选择文件用途':'文件用途'}</strong><small>${decision.needsReview?'看过下方内容后选择即可':'分类正确时无需修改'}</small></span><select data-inspector-purpose-select aria-label="修改当前文件用途">${sourcePurposeOptions(selected)}</select></label>`;
      actions.querySelector('[data-inspector-purpose-select]')?.addEventListener('change',event=>{const purpose=event.currentTarget.value;if(purpose==='review')setSourceNeedsReview(decision.sourceName);else setSourcePurpose(decision.sourceName,purpose);});
    }
    if(content)content.innerHTML=sourceInspectorContentHtml(decision);
    const pending=uniqueFiles(batch.dataset?.sourceFiles||[]).map(sourcePurposeDecision).filter(item=>item.needsReview&&item.sourceName!==decision.sourceName),next=$('nmda-source-next-review');
    if(next){next.hidden=!pending.length;next.dataset.nextSource=pending[0]?encodeURIComponent(pending[0].sourceName):'';next.textContent=pending.length?`下一个待确认 · 还剩 ${pending.length} 个 →`:'下一个待确认 →';}
  }

  function inspectSourceInPreflight(sourceName) {
    const related=sourceCollections(sourceName,String(sourceName||'').split('/').pop()||''),primary=related.filter(({collection})=>!collection.meta?.supplemental),items=primary.length?primary:related;
    if(!items.length)return;
    batch.sourceInspectName=sourceName;
    const first=items.find(({index})=>ensureCollectionConfig(index)?.purpose==='mail')||items[0];
    collectionSelectEl.innerHTML=items.map(({collection,index})=>{const config=ensureCollectionConfig(index),kind=collectionKind(collection,config?.purpose),detection=config?.detection||Importer.detectHeader(collection.rows||[]),records=Math.max(0,(collection.rows||[]).length-detection.index-1);return `<option value="${index}" ${index===first.index?'selected':''}>${escapeHtml(collection.name)} · ${escapeHtml(kind.label)} · ${records} 条</option>`;}).join('');
    $('nmda-collection-field').hidden=items.length<=1;
    configureCollection(first.index,false);
    const diagnostics=$('nmda-ingest-diagnostics');if(diagnostics){diagnostics.hidden=true;diagnostics.open=false;}
    renderPreflightSourceRoles();
  }

  function renderPreflightSourceRoles() {
    const details=$('nmda-preflight-source-routing'),list=$('nmda-preflight-source-routing-list'),summary=$('nmda-preflight-source-routing-summary'),chips=$('nmda-preflight-routing-chips'),dirNav=$('nmda-preflight-directory-nav');
    if(!details||!list||!summary)return;
    const files=uniqueFiles(batch.dataset?.sourceFiles||[]),decisions=files.map(sourcePurposeDecision);
    batch.preflightReviewOnly=false;
    const counts={mail:0,roster:0,attachment:0,ignored:0,review:0};
    for(const decision of decisions){if(decision.needsReview)counts.review++;else counts[decision.purpose]=(counts[decision.purpose]||0)+1;}
    const visible=sourceVisibleDecisions(decisions),folder=batch.preflightFolderPath||'',folderName=folder?folder.split('/').pop():'全部文件';
    const searchInput=$('nmda-preflight-source-search');if(searchInput&&searchInput.value!==String(batch.preflightSearch||''))searchInput.value=String(batch.preflightSearch||'');
    summary.textContent='文件列表';
    const subtitle=$('nmda-preflight-source-routing-subtitle');if(subtitle)subtitle.textContent=counts.review?`有 ${counts.review} 个待确认；点击文件查看内容并修改用途。`:'分类无误可直接继续。';
    const dirTitle=$('nmda-preflight-directory-title'),dirCount=$('nmda-preflight-directory-count');if(dirTitle)dirTitle.textContent=folderName;if(dirCount)dirCount.textContent=folder?`${visible.length}`:`${decisions.length}`;
    if(chips){
      const chip=(tone,label,count,icon)=>`<button type="button" data-preflight-filter="${tone}" data-tone="${tone}" class="${batch.preflightPurposeFilter===tone?'is-active':''}"><i>${icon}</i><span>${label}</span><b>${count}</b></button>`;
      chips.innerHTML=chip('mail','邮件',counts.mail,'✉')+chip('roster','总名单',counts.roster,'名')+chip('attachment','附件',counts.attachment,'附')+chip('review','待确认',counts.review,'!')+chip('ignored','暂不使用',counts.ignored,'×');
      chips.querySelectorAll('[data-preflight-filter]').forEach(button=>button.addEventListener('click',()=>{const value=button.dataset.preflightFilter||'';batch.preflightPurposeFilter=batch.preflightPurposeFilter===value?'':value;renderPreflightSourceRoles();}));
    }
    for(const key of Object.keys(counts)){const target=$('nmda-preflight-dropzones')?.querySelector(`[data-drop-count="${key}"]`);if(target)target.textContent=counts[key]||0;}
    if(dirNav){const tree=buildSourceFolderTree(decisions);dirNav.innerHTML=`<button class="nmda-classify-folder-row nmda-classify-folder-all${!batch.preflightFolderPath?' is-active':''}" type="button" data-preflight-folder=""><span class="nmda-classify-folder-icon">▦</span><span class="nmda-classify-folder-name">全部文件</span><b>${decisions.length}</b></button>${sourceFolderNavHtml(tree)}`;dirNav.querySelectorAll('[data-preflight-folder]').forEach(button=>button.addEventListener('click',()=>{batch.preflightFolderPath=decodeURIComponent(button.dataset.preflightFolder||'');renderPreflightSourceRoles();}));}
    details.hidden=!decisions.length;
    list.innerHTML=sourceFileRowsHtml(visible);
    list.querySelectorAll('[data-inspect-source]').forEach(row=>{
      row.addEventListener('click',event=>{if(event.target.closest('[data-source-drag]'))return;event.preventDefault();inspectSourceInPreflight(decodeURIComponent(row.dataset.inspectSource||''));});
      row.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();inspectSourceInPreflight(decodeURIComponent(row.dataset.inspectSource||''));});
    });
    list.querySelectorAll('[data-source-drag]').forEach(handle=>{
      handle.addEventListener('click',event=>event.stopPropagation());
      handle.addEventListener('dragstart',event=>{const source=decodeURIComponent(handle.dataset.sourceDrag||'');batch.sourceInspectName=source;event.dataTransfer?.setData('text/plain',source);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';handle.closest('.nmda-classify-file-row')?.classList.add('is-dragging');document.querySelector('.nmda-classify-dialog')?.classList.add('is-drag-classifying');});
      handle.addEventListener('dragend',()=>{handle.closest('.nmda-classify-file-row')?.classList.remove('is-dragging');document.querySelector('.nmda-classify-dialog')?.classList.remove('is-drag-classifying');});
    });
    const selected=decisions.find(item=>item.sourceName===batch.sourceInspectName);renderSourceInspector(selected||null);
  }

  function attachmentAssetRowsHtml(entries,{compact=false}={}) {
    return (entries||[]).map(entry=>{
      const usage=entry.kind==='shared'?'每封草稿':entry.used?`已匹配 ${entry.used} 封`:'待匹配';
      const correction=entry.kind==='routed'?`<label class="nmda-routed-purpose"><span class="sr-only">调整资料用途</span><select data-routed-source-purpose="${escapeHtml(encodeURIComponent(sourceFileName(entry.file)))}" title="如果自动分类不对，可在这里更改"><option value="attachment" selected>作为附件</option><option value="mail">改为邮件</option><option value="roster">改为总名单</option><option value="ignored">暂不使用</option></select></label>`:'';
      return `<div class="nmda-attachment-asset-row${compact?' is-compact':''}"><span class="nmda-attachment-file-icon" aria-hidden="true">↗</span><div class="nmda-attachment-file-main"><strong title="${escapeHtml(entry.file.name||'附件')}">${escapeHtml(entry.file.name||'附件')}</strong><small>${escapeHtml(formatAttachmentSize(entry.file))} · ${escapeHtml(entry.source)} · ${escapeHtml(usage)}</small></div><div class="nmda-attachment-asset-actions">${correction}<button class="nmda-text-action nmda-attachment-remove" type="button" data-attachment-remove="${escapeHtml(encodeURIComponent(entry.identity))}" aria-label="移除 ${escapeHtml(entry.file.name||'附件')}">移除</button></div></div>`;
    }).join('');
  }

  function renderAttachmentAssetViews() {
    const entries=attachmentAssetEntries(),count=entries.length;
    const inline=$('nmda-preflight-attachment-assets'),inlineList=$('nmda-preflight-attachment-assets-list'),inlineCount=$('nmda-preflight-attachment-assets-count');
    if(inline){inline.hidden=!count;if(inlineList)inlineList.innerHTML=attachmentAssetRowsHtml(entries.slice(0,5),{compact:true})+(count>5?`<button class="nmda-attachment-assets-more" type="button" data-open-attachment-manager>查看全部 ${count} 个附件</button>`:'');if(inlineCount)inlineCount.textContent=`${count} 个`;}
    const manager=$('nmda-attachment-manager-overlay'),list=$('nmda-attachment-manager-list'),empty=$('nmda-attachment-manager-empty'),summary=$('nmda-attachment-manager-summary');
    if(manager){manager.hidden=!batch.attachmentManagerOpen;manager.setAttribute('aria-hidden',batch.attachmentManagerOpen?'false':'true');}
    if(list)list.innerHTML=attachmentAssetRowsHtml(entries);
    for(const root of [inlineList,list].filter(Boolean))root.querySelectorAll('[data-routed-source-purpose]').forEach(select=>select.addEventListener('change',()=>setSourcePurpose(decodeURIComponent(select.dataset.routedSourcePurpose||''),select.value)));
    if(empty)empty.hidden=!!count;
    if(summary){
      const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
      summary.innerHTML=count?`已加入 <strong>${count}</strong> 个附件${stats.total?` · ${stats.total} 项邮件需求`:''}${stats.issues?` · <em>${stats.issues} 项仍待匹配</em>`:' · 当前需求已覆盖'}`:'尚未加入附件。';
    }
    syncModalState();
  }

  function openAttachmentManager() {
    batch.attachmentManagerOpen=true;renderAttachmentAssetViews();
  }

  function closeAttachmentManager() {
    batch.attachmentManagerOpen=false;renderAttachmentAssetViews();
  }

  function removeAttachmentAsset(identity) {
    if(!identity)return;
    const keep=file=>Importer.fileIdentity(file)!==identity;
    batch.ignoredAttachmentIdentities.add(identity);
    batch.directoryFiles=(batch.directoryFiles||[]).filter(keep);
    batch.taskFiles=(batch.taskFiles||[]).filter(keep);
    batch.routedAttachmentFiles=(batch.routedAttachmentFiles||[]).filter(keep);
    batch.sharedFiles=(batch.sharedFiles||[]).filter(keep);
    batch.attachmentPrepChoice=attachmentPreparedFileCount()?'added':(batch.supplementPreflightDone?'skipped':'pending');
    refreshFileIndex(false);renderSupplementPreflight();renderAttachmentAssetViews();
  }

  function clearAttachmentAssets() {
    for(const file of batch.routedAttachmentFiles||[])batch.ignoredAttachmentIdentities.add(Importer.fileIdentity(file));
    dirEl.value='';taskFilesEl.value='';sharedFilesEl.value='';
    batch.directoryFiles=[];batch.taskFiles=[];batch.routedAttachmentFiles=[];batch.sharedFiles=[];batch.attachmentOverrides.clear();
    batch.attachmentPrepChoice=batch.supplementPreflightDone?'skipped':'pending';
    refreshFileIndex(true);renderSupplementPreflight();renderAttachmentAssetViews();
  }

  function renderBatchPrepStrip() {
    const strip=$('nmda-batch-prep-strip');if(!strip)return;
    const hasBatch=!!batch.dataset&&!!(batch.tasks||[]).length;strip.hidden=!hasBatch;if(!hasBatch)return;
    const roster=$('nmda-prep-roster-state'),attachment=$('nmda-prep-attachment-state');
    const rState=rosterContextState(),aState=attachmentPreflightState(),rCount=referenceRosterCount(),aCount=attachmentPreparedFileCount(),stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
    if(roster){roster.dataset.state=rState;const strong=roster.querySelector('strong');if(strong)strong.textContent=rState==='added'?`${rCount} 条已加入`:rState==='skipped'?'未添加':'待确认';}
    if(attachment){attachment.dataset.state=aState;const strong=attachment.querySelector('strong');if(strong)strong.textContent=aCount?`${aCount} 个附件${stats.issues?` · ${stats.issues} 待匹配`:''}`:stats.issues?`${stats.issues} 项待补`:aState==='skipped'?'暂未添加':'待确认';}
    const manage=$('nmda-manage-attachments-strip');if(manage){manage.hidden=!aCount&&!stats.issues;manage.textContent=aCount?'查看 / 修改':'准备附件';}
    const button=$('nmda-edit-batch-prep');if(button)button.textContent=supplementPreflightNeedsDecision()?'继续准备':'补充资料';
  }

  function setPlanningView(view = 'rules') {
    const next=view==='mails'?'mails':'rules';
    batch.planningView=next;
    const card=$('nmda-preview-card');
    if(card)card.dataset.planningView=next;
    ui.querySelectorAll('[data-planning-view]').forEach(button=>{
      const active=button.dataset.planningView===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-current',active?'page':'false');
    });
  }

  function setPreflightView(view = 'files') {
    const next=view==='support'?'support':'files';
    batch.preflightView=next;
    const workspace=$('nmda-supplement-preflight')?.querySelector('.nmda-classify-workspace');
    if(workspace)workspace.dataset.preflightView=next;
    ui.querySelectorAll('[data-preflight-view]').forEach(button=>{
      const active=button.dataset.preflightView===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-current',active?'step':'false');
    });
    ui.querySelectorAll('[data-preflight-panel]').forEach(panel=>{
      panel.hidden=panel.dataset.preflightPanel!==next;
    });
    const button=$('nmda-complete-supplement-preflight');
    if(button&&!button.textContent.includes('待确认'))button.textContent=next==='support'?'完成并继续 →':'继续 →';
  }

  function setSupportView(view = 'roster') {
    const next=view==='attachment'?'attachment':'roster';
    batch.supportView=next;
    const support=$('nmda-supplement-preflight')?.querySelector('.nmda-classify-support-view');
    if(support)support.dataset.supportView=next;
    ui.querySelectorAll('button[data-support-view]').forEach(button=>{
      const active=button.dataset.supportView===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-current',active?'page':'false');
    });
    ui.querySelectorAll('[data-support-pane]').forEach(pane=>{pane.hidden=pane.dataset.supportPane!==next;});
  }

  function renderSupplementPreflight() {
    const overlay=$('nmda-supplement-preflight');if(!overlay)return;
    const hasBatch=!!batch.dataset,visible=hasBatch&&!!batch.supplementPreflightOpen;
    overlay.hidden=!visible;overlay.setAttribute('aria-hidden',visible?'false':'true');syncModalState();
    renderBatchPrepStrip();
    if(!hasBatch)return;
    const sourceDecisions=uniqueFiles(batch.dataset?.sourceFiles||[]).map(sourcePurposeDecision),reviewCount=sourceDecisions.filter(item=>item.needsReview).length,taskCount=(batch.tasks||[]).length;
    const headIcon=overlay.querySelector('.nmda-supplement-head-icon'),kicker=overlay.querySelector('.nmda-supplement-kicker'),title=$('nmda-supplement-title');
    if(headIcon){const attention=!taskCount||reviewCount>0;headIcon.dataset.state=attention?'review':'ok';headIcon.textContent=attention?'!':'✓';}
    if(kicker)kicker.textContent=reviewCount?`${reviewCount} 个文件待确认`:'文件用途已整理';
    if(title)title.textContent='检查导入结果';
    const rosterBox=$('nmda-preflight-roster-box'),attachmentBox=$('nmda-preflight-attachment-box'),supplements=$('nmda-preflight-supplements');
    if(rosterBox)rosterBox.hidden=false;if(attachmentBox)attachmentBox.hidden=false;if(supplements)supplements.hidden=false;
    setPreflightView(batch.preflightView||'files');
    setSupportView(batch.supportView||'roster');
    const completeButton=$('nmda-complete-supplement-preflight');if(completeButton)completeButton.textContent=reviewCount?`处理完 ${reviewCount} 个待确认后继续 →`:batch.preflightView==='support'?'完成并继续 →':'继续 →';

    const rState=rosterContextState(),rCount=referenceRosterCount();
    const rBox=$('nmda-preflight-roster-box'),rTitle=$('nmda-preflight-roster-title'),rCopy=$('nmda-preflight-roster-copy'),rStatus=$('nmda-preflight-roster-status'),rSkip=$('nmda-preflight-roster-skip');
    if(rBox)rBox.dataset.state=rState;
    if(rTitle)rTitle.textContent=rState==='added'?`参考总名单 · ${rCount} 条`:'参考总名单';
    if(rCopy)rCopy.textContent=rState==='added'?'名单已加入。':'已有总名单时可加入。';
    if(rStatus)rStatus.textContent=rState==='added'?`已加入 ${rCount} 条`:rState==='skipped'?'本批次未使用':'尚未添加';
    if(rSkip){rSkip.hidden=rState==='added';rSkip.textContent=rState==='skipped'?'已跳过':'跳过';}

    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,matched:0,issues:0};
    const aState=attachmentPreflightState(),aCount=attachmentPreparedFileCount(),refs=attachmentRequirementRefs();
    const aBox=$('nmda-preflight-attachment-box'),aTitle=$('nmda-preflight-attachment-title'),aCopy=$('nmda-preflight-attachment-copy'),aStatus=$('nmda-preflight-attachment-status'),aReq=$('nmda-preflight-attachment-requirements'),aSkip=$('nmda-preflight-attachment-skip');
    if(aBox)aBox.dataset.state=aState;
    if(aTitle)aTitle.textContent=stats.total?`附件 · ${stats.total} 项待准备`:'附件';
    if(aCopy)aCopy.textContent=stats.total?`本批次有 ${stats.total} 项附件待准备。`:'需要附件时再添加。';
    if(aReq){aReq.innerHTML=refs.length?refs.slice(0,3).map(ref=>`<span>${escapeHtml(ref)}</span>`).join('')+(refs.length>3?`<span>+${refs.length-3}</span>`:''):'';aReq.hidden=!refs.length;}
    if(aStatus)aStatus.textContent=aCount?`已加入 ${aCount} 个文件${stats.issues?` · ${stats.issues} 项待处理`:''}`:aState==='skipped'?'本批次暂未添加':stats.issues?`${stats.issues} 项待补`:'尚未添加';
    if(aSkip){aSkip.hidden=!!aCount;aSkip.textContent=aState==='skipped'?'已跳过':'暂不添加';}

    renderAttachmentAssetViews();renderPreflightSourceRoles();
    const batchSummary=$('nmda-preflight-batch-summary');if(batchSummary){const currentTaskCount=(batch.tasks||[]).length;batchSummary.textContent=reviewCount?`${reviewCount} 个文件待确认`:currentTaskCount?'分类已确认，可以继续':'还没有识别到邮件，请调整文件用途';}
    if(visible&&!batch.sourceInspectName&&sourceDecisions.length&&window.matchMedia('(min-width: 821px)').matches){const first=sourceDecisions.find(item=>item.needsReview)||sourceDecisions[0];requestAnimationFrame(()=>{if(batch.supplementPreflightOpen&&!batch.sourceInspectName)inspectSourceInPreflight(first.sourceName);});}
  }

  function openSupplementPreflight(view = 'files') {
    if(!batch.dataset)return;
    batch.preflightView=view==='support'?'support':'files';
    batch.supplementPreflightOpen=true;
    renderSupplementPreflight();
  }

  function completeSupplementPreflight() {
    if(!batch.dataset)return;
    if(rosterContextState()==='pending')batch.rosterPromptChoice='skipped';
    if(attachmentPreflightState()==='pending')batch.attachmentPrepChoice='skipped';
    batch.supplementPreflightDone=true;batch.supplementPreflightOpen=false;
    renderImportLifecycleState();scheduleBatchRender({aux:true,force:true});
    const mailPending=typeof reviewTasks==='function'?reviewTasks().length:0;
    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{issues:0};
    const hasTasks=!!(batch.tasks||[]).length;
    setImportStatus(!hasTasks?'核验已完成，但当前仍没有可创建邮件。可继续调整资料用途或追加邮件资料。':mailPending||stats.issues?'批次资料已准备。现在继续处理邮件与附件待办。':'批次资料已准备，正在进入选择与安排。',!hasTasks?'warn':'ok');
    if(!hasTasks)return;
    if(mailPending||stats.issues){
      batch.uiStep=2;
      renderProcessGuide();
      requestAnimationFrame(()=>openNextBlockingIssue());
    }else setTimeout(()=>void enterSelectionAndSchedule('批次资料已准备'),0);
  }

  function renderRosterContextCue() {
    const cue=$('nmda-roster-context-cue');if(!cue)return;
    const state=rosterContextState();cue.dataset.state=state;
    const eyebrow=$('nmda-roster-context-eyebrow'),title=$('nmda-roster-context-title'),copy=$('nmda-roster-context-copy'),status=$('nmda-roster-source-status'),upload=$('nmda-roster-upload-action'),skip=$('nmda-roster-skip'),remove=$('nmda-roster-remove'),benefits=$('nmda-roster-context-benefits');
    const count=referenceRosterCount();
    if(status)status.hidden=true;
    if(benefits)benefits.hidden=true;
    if(upload){upload.classList.toggle('nmda-btn-primary',state==='pending'||state==='prepare');upload.classList.toggle('nmda-btn-quiet',state==='added'||state==='skipped');}
    if(state==='prepare'){
      if(eyebrow)eyebrow.textContent='可选 · 参考名单';
      if(title)title.textContent='有参考总名单？可以一起加入';
      if(copy)copy.textContent='有名单可一起加入；没有也可以继续。';
      if(upload)upload.textContent='上传参考总名单';
      if(skip)skip.hidden=true;if(remove)remove.hidden=true;
    }else if(state==='pending'){
      if(eyebrow)eyebrow.textContent='可选增强';
      if(title)title.textContent='参考总名单可减少重复联系';
      if(copy)copy.textContent='有名单就加入；没有可直接跳过。';
      if(upload)upload.textContent='上传总名单';
      if(skip){skip.hidden=false;skip.textContent='暂不添加';}if(remove)remove.hidden=true;
    }else if(state==='added'){
      if(eyebrow)eyebrow.textContent='已加入';
      if(title)title.textContent=`参考总名单 · ${count} 条`;
      if(copy)copy.textContent='已加入本批次。';
      if(upload)upload.textContent='补充名单';
      if(skip)skip.hidden=true;if(remove){remove.hidden=false;remove.textContent='移除';}
    }else{
      if(eyebrow)eyebrow.textContent='已跳过';
      if(title)title.textContent='未使用参考总名单';
      if(copy)copy.textContent='需要时可随时补充。';
      if(upload)upload.textContent='补充名单';
      if(skip)skip.hidden=true;if(remove)remove.hidden=true;
    }
  }

  function renderAttachmentContextCue() {
    const cue=$('nmda-attachment-context-cue');if(!cue)return;
    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,matched:0,issues:0};
    const contextPending=typeof supplementPreflightNeedsDecision==='function'&&supplementPreflightNeedsDecision();
    const shouldShow=!!batch.dataset && stats.total>0 && stats.issues>0 && !batch.attachmentPromptDeferred && !contextPending;
    cue.hidden=!shouldShow;
    const bar=$('nmda-attachment-library-bar'),barTitle=$('nmda-attachment-library-bar-title'),barCopy=$('nmda-attachment-library-bar-copy'),prepared=attachmentPreparedFileCount();
    const showBar=!!batch.dataset&&!contextPending&&!shouldShow&&(prepared>0||stats.total>0);
    if(bar)bar.hidden=!showBar;
    if(showBar){if(barTitle)barTitle.textContent=`附件资料 · ${prepared} 个文件`;if(barCopy)barCopy.textContent=stats.total?`手动文件会直接发送；邮件需求已匹配 ${Math.max(0,stats.total-stats.issues)}/${stats.total}。`:'手动添加的文件会直接随本批次邮件发送，可随时增删。';}
    if(!shouldShow)return;
    const title=$('nmda-attachment-context-title'),copy=$('nmda-attachment-context-copy'),later=$('nmda-attachment-later'),sendAction=$('nmda-attachment-send-action'),dirAction=$('nmda-attachment-dir-action');
    const mailPending=typeof reviewTasks==='function'&&reviewTasks().length>0;
    if(sendAction){sendAction.classList.add('nmda-btn-primary');sendAction.classList.remove('nmda-btn-quiet');}
    if(dirAction){dirAction.classList.remove('nmda-btn-primary');dirAction.classList.add('nmda-btn-quiet');}
    if(title)title.textContent=`还有 ${stats.issues} 个附件待补`;
    if(copy)copy.textContent=mailPending
      ? `这是创建前必须完成的待办。手动添加的文件会直接发送；点名附件可用匹配文件夹补齐。`
      : `这是当前最后一项待办。手动添加即发送；补齐点名附件后会自动进入“选择与安排”。`;
    if(later)later.hidden=!mailPending;
  }

  function renderImportLifecycleState() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const active = !!batch.dataset || !!batch.importBusy || !!batch.roster?.entries?.length;
    if (resetImportEl) resetImportEl.hidden = !active;
    if (importBusyBadgeEl) importBusyBadgeEl.hidden = !batch.importBusy;
    const sourceCard = $('nmda-import-card');
    if (sourceCard) {
      sourceCard.dataset.busy = batch.importBusy ? '1' : '0';
      sourceCard.dataset.loaded = batch.dataset ? '1' : '0';
      const title = $('nmda-import-card-title');
      const desc = $('nmda-import-card-desc');
      if (title) title.textContent = batch.dataset ? '邮件资料已导入' : '导入邮件资料';
      if (desc) desc.textContent = batch.dataset
        ? '邮件资料已加入，可继续添加或进入批次资料。'
        : '把本批次邮件资料放进来。';
      const fileAction=ui.querySelector('label.nmda-source-action[for="nmda-import-file"] strong');
      const dirAction=ui.querySelector('label.nmda-source-action[for="nmda-import-dir"] strong');
      const pasteAction=$('nmda-show-paste')?.querySelector('strong');
      if(fileAction)fileAction.textContent=batch.dataset?'添加文件':'选择文件';
      if(dirAction)dirAction.textContent=batch.dataset?'添加文件夹':'选择文件夹';
      if(pasteAction)pasteAction.textContent=batch.dataset?'粘贴补充':'粘贴内容';
    }
    const workbench = ui.querySelector('.nmda-bulk-workbench');
    if (workbench) {
      workbench.dataset.phase = !batch.dataset ? 'empty' : (batch.handoffComplete ? 'ready' : 'review');
      if(!batch.dataset)batch.uiStep=1;
    }
    const prepButton=$('nmda-open-supplement-preflight');if(prepButton)prepButton.hidden=!batch.dataset;
    renderRosterContextCue();
    renderAttachmentContextCue();
    renderBatchPrepStrip();
    renderSupplementPreflight();
    renderAttachmentAssetViews();
  }

  function beginImportSession(message) {
    // The reference roster is an independent master-data source. Replacing the mail source keeps it;
    // only explicit ‘重新开始’ / ‘移除总名单’ clears the reference source.
    const previousRoster=rosterState();
    const keepRoster = previousRoster.manualEntries?.length ? emptyRosterState({
      dataset:previousRoster.dataset,manualEntries:[...previousRoster.manualEntries],entries:[...previousRoster.manualEntries],manualWarnings:[...(previousRoster.manualWarnings||[])],warnings:[...(previousRoster.manualWarnings||[])],manualSourceNames:[...(previousRoster.manualSourceNames||[])],sourceNames:[...(previousRoster.manualSourceNames||[])],enabled:previousRoster.enabled!==false,autoSchool:previousRoster.autoSchool!==false,strict:!!previousRoster.strict
    }) : null;
    resetImportWorkspace({ keepStatus: true, invalidate: true });
    if (keepRoster) {
      batch.roster = keepRoster;
      batch.rosterPromptChoice='added';
      syncRosterParts();
      renderRosterAudit();
    }
    const token = batch.sessionId;
    batch.importBusy = true;
    if(schedulerCardEl)schedulerCardEl.open=true;
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent='收起';
    renderImportLifecycleState();
    setImportStatus(message || '正在读取来源…');
    return token;
  }

  function finishImportSession(token) {
    if (!isCurrentBatchSession(token)) return false;
    batch.importBusy = false;
    renderImportLifecycleState();
    return true;
  }

  function recordSets() { return batch.dataset?.recordSets || batch.dataset?.sheets || []; }

  function currentCollection() { return recordSets()[batch.collectionIndex] || null; }

  function ensureCollectionConfig(index, { reset = false } = {}) {
    const collection = recordSets()[Number(index) || 0];
    if (!collection) return null;
    let config = batch.collectionConfigs.get(Number(index) || 0);
    if (!config || reset) {
      const detection = Importer.detectHeader(collection.rows || []);
      const classified=String(collection.meta?.sourcePurpose||'ambiguous');
      const purpose=['mail','roster','attachment','ignored'].includes(classified)?classified:'ignored';
      config = { purpose, enabled: purpose==='mail', detection, mapping: { ...detection.mapping }, profileSuggestion: null };
      batch.collectionConfigs.set(Number(index) || 0, config);
    }
    return config;
  }

  function taskEditKey(collectionIndex, rowIndex) { return `${collectionIndex}:${rowIndex}`; }

  function sourceFileName(file) {
    return String(file?.webkitRelativePath || file?._nmdaPath || file?.name || '未命名来源');
  }

  function humanFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function formatDisplayName(format) {
    const map = {
      'xlsx':'Excel / XLSX', 'ods':'OpenDocument / ODS', 'fods':'Flat ODS',
      'docx':'Word / DOCX', 'json':'JSON', 'ndjson':'JSONL / NDJSON',
      'delimited':'分隔文本', 'vertical-text':'字段式文本', 'html':'HTML 表格',
      'spreadsheetml':'Excel XML', 'mail-text':'邮件文本', 'attachment':'附件资料', 'nmda-zip':'ZIP 批次', 'multi':'混合来源'
    };
    return map[String(format || '').toLowerCase()] || String(format || '自动识别').toUpperCase();
  }

  function collectionKind(collection,overridePurpose='') {
    const meta = collection?.meta || {};
    const format = String(meta.format || batch.dataset?.format || '').toLowerCase();
    const purpose=String(overridePurpose||meta.sourcePurpose||'');
    if(purpose==='roster')return {label:'总名单',icon:'人',tone:'roster'};
    if(purpose==='attachment')return {label:'附件候选',icon:'⇧',tone:'attachment'};
    if(purpose==='ignored')return {label:'未使用资料',icon:'—',tone:'ignored'};
    if(purpose==='ambiguous')return {label:'待分类资料',icon:'?',tone:'ambiguous'};
    if (meta.mailFrames) return { label:'邮件内容', icon:'✉', tone:'mail' };
    if(purpose==='mail')return {label:'邮件任务',icon:'✉',tone:'mail'};
    if (meta.word) {
      if (meta.merged) return { label:'Word 邮件批次', icon:'W', tone:'word' };
      if (meta.kind === 'table') return { label:'Word 表格', icon:'W', tone:'word' };
      if (meta.kind === 'records') return { label:'Word 字段记录', icon:'W', tone:'word' };
      if (meta.kind === 'document') return { label:'Word 文档邮件', icon:'W', tone:'word' };
      return { label:'Word 内容', icon:'W', tone:'word' };
    }
    if (format.includes('json')) return { label:'JSON 记录', icon:'{}', tone:'json' };
    if (format === 'vertical-text') return { label:'字段式文本', icon:'¶', tone:'text' };
    if (format === 'delimited') return { label:'文本记录', icon:'≡', tone:'text' };
    if (format === 'html') return { label:'HTML 表格', icon:'<>', tone:'web' };
    if (format === 'spreadsheetml') return { label:'XML 记录', icon:'XML', tone:'xml' };
    if (meta.package) return { label:'批次包内容', icon:'ZIP', tone:'package' };
    if (['xlsx','ods','fods'].includes(format)) return { label:'表格记录', icon:'▦', tone:'table' };
    return { label:'标准化记录', icon:'◇', tone:'default' };
  }

  function renderSourceInventory() {
    const box = $('nmda-source-inventory');
    if (!box) return;
    const dataset = batch.dataset;
    if (!dataset) { box.hidden = true; box.innerHTML = ''; return; }
    const sets = recordSets();
    const sources = [...(dataset.sourceFiles || [])];
    const embeddedCount = (dataset.embeddedFiles || []).length;
    const warnings = dataset.warnings || [];
    const purposeLabel=purpose=>({mail:'邮件',roster:'参考名单',attachment:'附件',ignored:'未使用'}[purpose]||'未使用');
    const sourceRows = sources.length ? sources.map((file, index) => {
      const name = sourceFileName(file);
      const related = sets.map((rs,setIndex)=>({rs,setIndex})).filter(({rs}) => {
        const members=rs.meta?.sourceMembers||[];return String(rs.source||'')===String(file.name||'')||String(rs.source||'')===name||members.includes(file.name)||members.includes(name);
      });
      const purposes=[...new Set(related.map(({setIndex})=>ensureCollectionConfig(setIndex)?.purpose||'ignored'))];
      const formats = [...new Set(related.map(({rs}) => rs.meta?.format).filter(Boolean))];
      const format = formats.length ? formats.map(formatDisplayName).join(' + ') : formatDisplayName(dataset.format);
      const roleText=purposes.length?purposes.map(purposeLabel).join(' + '):'来源文件';
      const firstRelated=related.find(({rs})=>!rs.meta?.supplemental)||related[0];const kind=collectionKind(firstRelated?.rs,firstRelated?ensureCollectionConfig(firstRelated.setIndex)?.purpose:'ignored');
      const confidence=Number(firstRelated?.rs?.meta?.purposeConfidence||0),decision=confidence?` · ${roleConfidenceText(confidence)}`:'';
      return `<div class="nmda-source-item"><div class="nmda-source-item-icon">${escapeHtml(kind.icon)}</div><div class="nmda-source-item-main"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small>${escapeHtml(format)} · ${humanFileSize(file.size)}${escapeHtml(decision)}</small></div><span class="nmda-source-purpose" data-purpose="${escapeHtml(purposes[0]||'ignored')}">${escapeHtml(roleText)}</span><span class="nmda-source-item-index">${index + 1}</span></div>`;
    }).join('') : `<div class="nmda-source-item"><div class="nmda-source-item-icon">◇</div><div class="nmda-source-item-main"><strong>粘贴内容</strong><small>${escapeHtml(formatDisplayName(dataset.format))}</small></div></div>`;
    const fileCount=sources.length || 1;
    const taskCount=(batch.tasks||[]).length;
    const rosterCount=referenceRosterCount();
    const attachmentStats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
    const summaryParts=[`${fileCount} 个文件`,taskCount?`${taskCount} 封邮件`:''];
    if(rosterCount)summaryParts.push(`参考名单 ${rosterCount} 条`);
    if(attachmentStats.issues)summaryParts.push(`${attachmentStats.issues} 个附件待补`);
    const warningHtml = warnings.length ? `<details class="nmda-ingest-warnings"><summary>读取细节（${warnings.length}）</summary>${warnings.slice(0,20).map(w => `<div>${escapeHtml(w)}</div>`).join('')}${warnings.length > 20 ? `<div>另有 ${warnings.length - 20} 条未展开。</div>` : ''}</details>` : '';
    box.innerHTML = `<details class="nmda-source-inventory-details"><summary><span><strong>导入详情</strong><small>${summaryParts.filter(Boolean).join(' · ')}</small></span><span class="nmda-source-inventory-open">查看</span></summary><div class="nmda-source-list">${sourceRows}</div>${embeddedCount?`<div class="nmda-source-detail-note">已从资料包中加入 ${embeddedCount} 个附件文件。</div>`:''}${warningHtml}</details>`;
    box.hidden = false;
  }

  function renderCollectionList() {
    const box = $('nmda-collection-list');
    if (!box) return;
    const sets = recordSets();
    const focus=String(batch.sourceInspectName||'');
    const visible=sets.map((collection,index)=>({collection,index})).filter(({collection})=>!focus||collectionMatchesSource(collection,focus,focus.split('/').pop()||''));
    box.innerHTML = visible.map(({collection,index}) => {
      const config = ensureCollectionConfig(index);
      const kind = collectionKind(collection,config?.purpose);
      const detection = config?.detection || Importer.detectHeader(collection.rows || []);
      const count = Math.max(0, (collection.rows || []).length - detection.index - 1);
      const active = index === batch.collectionIndex;
      const scan = collection.meta?.mailScan;
      const detail = config?.purpose==='mail'&&collection.meta?.mailFrames && scan
        ? `${kind.label} · ${scan.records || count} 封 · ${scan.complete || 0} 可用 · ${scan.missingRecipients || 0} 待补邮箱`
        : `${kind.label} · ${count} 条记录${collection.meta?.sourcePurpose==='ambiguous'&&config?.purpose==='ignored'?' · 自动识别未采用':''}`;
      const option=(value,label)=>`<option value="${value}" ${config?.purpose===value?'selected':''}>${label}</option>`;
      const purposeControl=focus?'':`<label class="nmda-source-purpose-control"><span class="sr-only">资料用途</span><select data-source-purpose="${index}">${option('mail','作为邮件')}${option('roster','作为总名单')}${option('attachment','作为附件候选')}${option('ignored','暂不使用')}</select></label>`;
      return `<div class="nmda-collection-row ${active ? 'is-active' : ''}" data-purpose="${escapeHtml(config?.purpose||'ignored')}"><span class="nmda-collection-kind">${escapeHtml(kind.icon)}</span><span class="nmda-collection-main"><strong>${escapeHtml(collection.name || `内容 ${index + 1}`)}</strong><small>${escapeHtml(detail)}</small></span>${purposeControl}<button type="button" class="nmda-btn nmda-btn-small" data-inspect-collection="${index}">${active ? '正在查看' : '查看'}</button></div>`;
    }).join('')||'<div class="nmda-empty-inline">这个文件没有可展开的结构化内容。</div>';
    box.querySelectorAll('[data-source-purpose]').forEach(input => input.addEventListener('change', () => {
      const index = Number(input.dataset.sourcePurpose);
      const config = ensureCollectionConfig(index);
      if (!config) return;
      config.purpose=input.value;config.enabled=config.purpose==='mail';
      batch.handoffComplete=false;
      syncRoutedSources();refreshFileIndex(false);configureCollection(index,false);renderSourceInventory();renderCollectionList();renderPreflightSourceRoles();
    }));
    box.querySelectorAll('[data-inspect-collection]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.inspectCollection);
      collectionSelectEl.value = String(index);configureCollection(index, false);renderCollectionList();
    }));
  }

  function renderCollectionOverview() {
    const collection = currentCollection();
    const summary = $('nmda-structure-summary');
    const preview = $('nmda-structure-preview');
    if (!collection || !summary || !preview) return;
    const kind = collectionKind(collection,ensureCollectionConfig(batch.collectionIndex)?.purpose);
    const rows = collection.rows || [];
    const detection = batch.detection || Importer.detectHeader(rows);
    const dataCount = Math.max(0, rows.length - (detection.index + 1));
    const width = Math.max(0, ...rows.slice(0, 50).map(row => row?.length || 0));
    const source = collection.source || sourceFileName(batch.dataset?.sourceFiles?.[0]);
    const scan = collection.meta?.mailScan;
    const metricHtml = collection.meta?.mailFrames && scan
      ? `<span><strong>${scan.records || dataCount}</strong> 封邮件</span><span><strong>${scan.complete || 0}</strong> 可用</span><span><strong>${scan.missingRecipients || 0}</strong> 待补邮箱</span>`
      : `<span><strong>${dataCount}</strong> 条候选记录</span><span><strong>${width}</strong> 个来源字段</span>`;
    summary.innerHTML = `
      <div class="nmda-structure-identity" data-tone="${escapeHtml(kind.tone)}"><span>${escapeHtml(kind.icon)}</span><div><strong>${escapeHtml(kind.label)}</strong><small>${escapeHtml(collection.name || '未命名内容')}</small></div></div>
      <div class="nmda-structure-metrics">${metricHtml}<span title="${escapeHtml(String(source || ''))}"><strong>来源</strong> ${escapeHtml(String(source || '—'))}</span></div>`;
    const rawStart = Math.max(0, Math.min(detection.index, rows.length - 1));
    const sampleRows = rows.slice(rawStart, rawStart + 6);
    if (!sampleRows.length) { preview.innerHTML = '<div class="nmda-empty-inline">这里没有可预览的内容。</div>'; return; }
    const maxCols = Math.min(8, Math.max(...sampleRows.map(r => r?.length || 0), 1));
    preview.innerHTML = `<table><tbody>${sampleRows.map((row, ri) => `<tr class="${ri === 0 ? 'is-structure-head' : ''}">${Array.from({length:maxCols},(_,ci)=>`<td title="${escapeHtml(String(row?.[ci] ?? ''))}">${escapeHtml(String(row?.[ci] ?? '') || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderSemanticSummary() {
    const box = $('nmda-semantic-summary');
    if (!box || !batch.detection) return;
    const headers = batch.detection.headers || [];
    const mapping = batch.mapping || {};
    const confidence = batch.detection.confidence || {};
    const items = Importer.FIELD_DEFS.map(field => {
      const index = mapping[field.key];
      const mapped = index != null;
      const score = mapped ? Number(confidence[field.key] || 0) : 0;
      const tone = !mapped ? 'none' : score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low';
      return `<div class="nmda-semantic-item" data-confidence="${tone}"><span>${escapeHtml(field.label)}</span><strong>${mapped ? escapeHtml(headers[index] || `来源字段 ${Number(index)+1}`) : '未映射'}</strong>${mapped ? `<small>${score ? '已匹配' : '已设置'}</small>` : '<small>不会写入任务</small>'}</div>`;
    });
    box.innerHTML = items.join('');
  }

  function recipientLooksValid(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const direct=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}(?![A-Z0-9.\-])/i.test(raw);
    if (direct) return true;
    const parsed = Contacts?.parseRecipients?.(raw) || [];
    return parsed.some(item => /@/.test(String(item?.email || item || '')));
  }

  function isAutoResolvableReviewIssue(issue) {
    const text=String(issue||'');
    return /^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(text)
      || /未定位收件人|主题为空|正文过短/.test(text);
  }

  function effectiveImportConfidence(task) {
    let score=Number(task?.importConfidence||0);
    const issues=(task?.importIssues||[]).map(issue=>String(issue||''));
    if(String(task?.subject||'').trim() && issues.some(issue=>/主题为空|未找到 Subject/.test(issue))) score+=30;
    if(recipientLooksValid(task?.recipients||'') && issues.some(issue=>/未定位收件人|无收件人/.test(issue))) score+=15;
    if(String(task?.body||'').trim().length>=80 && issues.some(issue=>/正文过短/.test(issue))) score+=6;
    return Math.max(0,Math.min(100,score));
  }

  function unresolvedImportIssues(task) {
    const out=[];
    const effectiveConfidence=effectiveImportConfidence(task);
    if (!String(task?.recipients||'').trim()) out.push('缺少收件人');
    else if (!recipientLooksValid(task.recipients)) out.push('收件人邮箱格式无效');
    if (!String(task?.subject||'').trim()) out.push('缺少主题');
    if (!String(task?.body||'').trim()) out.push('缺少正文');
    // Human confirmation is scoped: deterministic missing fields disappear as soon as they are fixed.
    // Only ambiguous parsing / manual edits / roster conflicts require an explicit confirmation.
    if (!task?.reviewConfirmed) {
      if (effectiveConfidence && effectiveConfidence < 70) out.push('请检查邮件内容');
      for (const issue of task?.importIssues || []) {
        if (/未定位收件人/.test(issue) && task.recipients) continue;
        if (/主题为空|未找到 Subject/.test(issue) && task.subject) continue;
        if (/正文过短/.test(issue) && String(task.body||'').length>=40) continue;
        if (/置信度/.test(issue) && effectiveConfidence>=70) continue;
        if (/未找到邮件落款|未找到邮件称呼/.test(issue) && effectiveConfidence >= 80) continue;
        if (!out.includes(issue)) out.push(issue);
      }
    }
    if (task?.reviewDraftPending && !out.includes('修改待确认')) out.push('修改待确认');
    const duplicateConfirmed=new Set(task?.duplicateConfirmedGroups||[]);
    for(const item of task?.duplicateIssues||[]){
      const id=String(item?.id||''),message=String(item?.message||item||'');
      if(message && (!id || !duplicateConfirmed.has(id)) && !out.includes(message))out.push(message);
    }
    if (!task?.rosterConfirmed) for (const issue of task?.rosterIssues || []) if (!out.includes(issue)) out.push(issue);
    return out;
  }

  function taskIssueState(task) {
    const reviewIssues=unresolvedImportIssues(task);
    const content=reviewIssues.filter(isAutoResolvableReviewIssue);
    const review=reviewIssues.filter(issue=>!isAutoResolvableReviewIssue(issue));
    const attachment=[]; const schedule=[]; const policy=[]; const other=[];
    for(const error of task?.errors||[]){
      const text=String(error||'');
      if(/^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(text))continue;
      if(/^缺少附件：|^附件同名冲突：/.test(text)){attachment.push(text);continue;}
      if(/^定时时间无法识别：/.test(text)){schedule.push(text);continue;}
      if(/^联系策略：/.test(text)){policy.push(text);continue;}
      if((task?.rosterIssues||[]).includes(text))continue;
      other.push(text);
    }
    return {content,review,attachment,schedule,policy,other,reviewIssues};
  }

  function taskNeedsImportReview(task) { return !task?.importExcluded && unresolvedImportIssues(task).length > 0; }
  function taskCoreValid(task) { return recipientLooksValid(task?.recipients||'') && !!String(task?.subject||'').trim() && !!String(task?.body||'').trim(); }
  function unresolvedDuplicateGroups(task) {
    if(!task)return [];
    const confirmed=new Set(task.duplicateConfirmedGroups||[]);
    const ids=new Set(task.duplicateGroupIds||[]);
    return (batch.duplicateAudit?.groups||[]).filter(group=>ids.has(group.id)&&!confirmed.has(group.id));
  }
  function taskHasUnresolvedDuplicate(task) { return unresolvedDuplicateGroups(task).length>0; }
  function taskNeedsExplicitConfirmation(task) {
    if(!task || task.importExcluded)return false;
    const issues=unresolvedImportIssues(task);
    return !!task.reviewDraftPending || issues.some(issue=>!isAutoResolvableReviewIssue(issue));
  }
  // Duplicate groups require an explicit group decision. They must never disappear through the
  // generic "confirm selected" path, otherwise users can accidentally keep every duplicate.
  function taskCanBatchConfirm(task) { return taskCoreValid(task) && taskNeedsExplicitConfirmation(task) && !taskHasUnresolvedDuplicate(task); }
  function taskHasBlockingIssue(task) {
    if(!task || task.importExcluded || task.policyBlocked)return false;
    const state=taskIssueState(task);
    return state.content.length>0 || state.review.length>0 || state.attachment.length>0 || state.schedule.length>0 || state.other.length>0;
  }

  function excludedImportCount() {
    let count=0;
    for (const edit of batch.taskEdits.values()) if (edit?.importExcluded) count++;
    return count;
  }

  function taskSourceMeta(task) {
    const collection=recordSets()[Number(task?.collectionIndex)||0];
    const rowMeta=collection?.meta?.rowMeta?.[task?.rowIndex] || null;
    const sourceBlocks=rowMeta?.sourceContext?.length ? rowMeta.sourceContext : (collection?.meta?.sourceBlocks || []);
    const contextOffset=rowMeta?.sourceContext?.length ? Number(rowMeta.sourceContextStart||0) : 0;
    return {collection,rowMeta,sourceBlocks,contextOffset};
  }

  function reviewTaskPriority(task) {
    const issues=unresolvedImportIssues(task);
    if(issues.some(issue=>/收件人|邮箱/.test(issue)))return 0;
    if(issues.some(issue=>/缺少主题|主题为空|Subject|缺少正文/.test(issue)))return 1;
    if(issues.some(issue=>/^当前批次(?:疑似)?重复：/.test(issue)))return 2;
    if(issues.some(issue=>/总名单|联系人|院校/.test(issue)))return 3;
    if(issues.some(issue=>/边界|称呼|落款|置信度|请检查/.test(issue)))return 4;
    return 5;
  }

  function reviewTasks() {
    return (batch.tasks||[]).filter(taskNeedsImportReview).sort((a,b)=>reviewTaskPriority(a)-reviewTaskPriority(b) || String(a.editKey).localeCompare(String(b.editKey)));
  }

  function reviewVisibleTasks() {
    const tasks=(batch.tasks||[]).filter(task=>!task?.importExcluded);
    const scoped=batch.reviewFilter==='all' ? tasks : tasks.filter(taskNeedsImportReview).sort((a,b)=>reviewTaskPriority(a)-reviewTaskPriority(b) || String(a.editKey).localeCompare(String(b.editKey)));
    const query=String(batch.reviewSearch||'').trim().toLowerCase();
    if(!query)return scoped;
    return scoped.filter(task=>[task.id,task.collectionName,task.recipients,task.subject,task.sourceFile].some(value=>String(value||'').toLowerCase().includes(query)));
  }

  function selectedReviewTasks() {
    const selected=batch.reviewSelected instanceof Set ? batch.reviewSelected : new Set();
    return (batch.tasks||[]).filter(task=>!task?.importExcluded && selected.has(task.editKey));
  }

  function pruneReviewSelection() {
    if(!(batch.reviewSelected instanceof Set)) batch.reviewSelected=new Set();
    const valid=new Set((batch.tasks||[]).filter(task=>!task?.importExcluded).map(task=>task.editKey));
    for(const key of [...batch.reviewSelected]) if(!valid.has(key)) batch.reviewSelected.delete(key);
  }

  function missingSubjectTasks({selectedOnly=false}={}) {
    const pool=selectedOnly ? selectedReviewTasks() : (batch.tasks||[]).filter(task=>!task?.importExcluded);
    return pool.filter(task=>!String(task?.subject||'').trim());
  }

  function renderReviewBatchActions() {
    pruneReviewSelection();
    const selected=selectedReviewTasks().filter(taskCanBatchConfirm);
    const batchMode=batch.reviewFilter==='pending' && reviewTasks().length>0;
    if(reviewBatchbarEl) reviewBatchbarEl.hidden=!batchMode||!selected.length;
    if(reviewSelectedCountEl) reviewSelectedCountEl.textContent=selected.length?`已选 ${selected.length} 封需确认邮件`:'已选 0 封';
  }

  function reviewCurrentTask(){
    const key=importEditorOverlayEl?.dataset.editKey;
    return key ? (batch.tasks||[]).find(task=>task.editKey===key) || null : null;
  }

  function otherMissingSubjectTasks(currentKey='') {
    return (batch.tasks||[]).filter(task=>!task?.importExcluded && task.editKey!==currentKey && !String(task?.subject||'').trim());
  }

  function hideSubjectAssist(){
    if(subjectAssistEl) subjectAssistEl.hidden=true;
  }

  function autoSizeReviewBody(){
    if(!importEditBodyEl || importEditorOverlayEl?.hidden) return;
    requestAnimationFrame(()=>{
      const duplicateActive=importEditorOverlayEl?.classList.contains('has-duplicate-decision');
      const viewportCap=Math.max(210,Math.round(window.innerHeight*(duplicateActive ? .26 : .38)));
      const target=Math.min(Math.max(210,importEditBodyEl.scrollHeight+2),viewportCap);
      importEditBodyEl.style.height=`${target}px`;
      importEditBodyEl.style.overflowY=importEditBodyEl.scrollHeight>target?'auto':'hidden';
      importEditBodyEl.dataset.longBody=importEditBodyEl.scrollHeight>target?'1':'0';
    });
  }

  function stashCurrentReviewDraft(){
    const task=reviewCurrentTask(); if(!task)return null;
    const patch={
      recipients:String(importEditRecipientsEl?.value||'').trim(),
      subject:String(importEditSubjectEl?.value||'').trim(),
      body:String(importEditBodyEl?.value||''),
      attachments:String(importEditAttachmentsEl?.value||'').trim(),
      scheduleAt:String(importEditScheduleEl?.value||''),
      tags:String(importEditTagsEl?.value||'')
    };
    const currentAttachments=(task.attachmentRefs||[]).join('; ');
    const currentTags=(task.tags||[]).join('; ');
    const changed=patch.recipients!==String(task.recipients||'').trim()
      || patch.subject!==String(task.subject||'').trim()
      || patch.body!==String(task.body||'')
      || patch.attachments!==currentAttachments
      || patch.scheduleAt!==String(task.scheduleAt||'')
      || patch.tags!==currentTags;
    if(changed){setTaskEdit(task,patch);batch.handoffComplete=false;}
    return task;
  }

  function maybeOfferSubjectAssist(){
    const task=reviewCurrentTask();
    const subject=String(importEditSubjectEl?.value||'').trim();
    if(!task || !subject || importEditSubjectEl?.dataset.startedBlank!=='1'){hideSubjectAssist();return;}
    stashCurrentReviewDraft();
    const missing=otherMissingSubjectTasks(task.editKey);
    if(!missing.length){hideSubjectAssist();return;}
    if(subjectAssistTitleEl)subjectAssistTitleEl.textContent=`还有 ${missing.length} 封邮件缺少主题`;
    if(subjectAssistCopyEl)subjectAssistCopyEl.textContent=`是否也填写为“${subject.length>42?`${subject.slice(0,42)}…`:subject}”？不会覆盖已有主题。`;
    if(subjectAssistEl)subjectAssistEl.hidden=false;
  }

  async function applySubjectAssist(){
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
    const task=reviewCurrentTask();
    const subject=String(importEditSubjectEl?.value||'').trim();
    if(!task||!subject)return;
    stashCurrentReviewDraft();
    const missing=otherMissingSubjectTasks(task.editKey);
    const missingKeys=missing.map(item=>item.editKey);
    const pendingBefore=new Set(missing.filter(taskNeedsImportReview).map(item=>item.editKey));
    for(const item of missing)setTaskEdit(item,{subject});
    rebuildTasks();
    const currentMap=new Map((batch.tasks||[]).map(item=>[item.editKey,item]));
    const autoResolved=missingKeys.filter(key=>pendingBefore.has(key)&&currentMap.has(key)&&!taskNeedsImportReview(currentMap.get(key))).length;
    const stillPending=missingKeys.filter(key=>currentMap.has(key)&&taskNeedsImportReview(currentMap.get(key))).length;
    hideSubjectAssist();
    importEditSubjectEl.dataset.startedBlank='0';
    renderImportTaskPreview();
    renderImportHandoff();
    renderReviewPageOverview();
    const resolvedText=autoResolved?`，其中 ${autoResolved} 封已自动通过` : '';
    const pendingText=stillPending?`；${stillPending} 封还有其他内容需要处理` : '';
    setImportStatus(`已为另外 ${missing.length} 封缺少主题的邮件填写同一主题${resolvedText}${pendingText}。`,'ok');
    await continueAfterReviewResolution(missing.length?'主题已补齐':'当前主题已补齐');
  }

  async function confirmSelectedReviewTasks() {
    const selected=selectedReviewTasks().filter(taskCanBatchConfirm);
    if(!selected.length)return;
    batch.handoffComplete=false;
    let confirmed=0,blocked=0;
    for(const task of selected){
      const coreValid=taskCoreValid(task);
      if(!coreValid){blocked++;continue;}
      const prev=batch.taskEdits.get(task.editKey)||{};
      batch.taskEdits.set(task.editKey,{...prev,reviewConfirmed:true,reviewDraftPending:false,rosterConfirmed:(task.rosterIssues||[]).length?true:!!prev.rosterConfirmed});
      confirmed++;
    }
    batch.reviewSelected.clear();
    rebuildTasks();
    renderReviewPageOverview();
    const message=blocked
      ? `已保存 ${confirmed} 封；${blocked} 封仍缺少收件人、主题或正文。`
      : `已保存 ${confirmed} 封邮件。`;
    setImportStatus(message,blocked?'warn':'ok');
    if(!blocked)await continueAfterReviewResolution('所选邮件已确认');
  }

  function selectVisibleReviewTasks() {
    if(!(batch.reviewSelected instanceof Set))batch.reviewSelected=new Set();
    const visible=reviewVisibleTasks().filter(taskCanBatchConfirm);
    const allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    if(allSelected) for(const task of visible)batch.reviewSelected.delete(task.editKey);
    else for(const task of visible)batch.reviewSelected.add(task.editKey);
    renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');
    renderReviewBatchActions();
    const button=$('nmda-review-select-filtered');if(button)button.textContent=allSelected?`批量确认 ${visible.length} 封…`:'取消批量选择';
  }


  function duplicateCandidateScore(task) {
    if(!task)return -9999;
    let score=0;
    if(recipientLooksValid(task.recipients||''))score+=22;
    if(String(task.subject||'').trim())score+=18;
    const bodyLength=String(task.body||'').trim().length;
    score+=Math.min(28,bodyLength/18);
    score+=Math.min(25,Math.max(0,Number(task.importConfidence||0))*.25);
    if(task.manuallyEdited)score+=3;
    score-=(task.errors||[]).length*16;
    score-=(task.attachmentDetails||[]).filter(item=>item.status!=='matched').length*10;
    return score;
  }

  function recommendedDuplicateTask(group) {
    return [...(group?.tasks||[])].sort((a,b)=>duplicateCandidateScore(b)-duplicateCandidateScore(a) || String(a.editKey).localeCompare(String(b.editKey)))[0]||null;
  }

  function duplicateDecisionGroup(task) {
    return unresolvedDuplicateGroups(task)[0]||null;
  }

  function duplicateCandidateMeta(task) {
    const bits=[];
    if(task.sourceFile)bits.push(`来源 ${task.sourceFile}`);
    const bodyLength=String(task.body||'').trim().length;
    bits.push(`正文 ${bodyLength} 字`);
    if(task.files?.length)bits.push(`附件 ${task.files.length}`);
    return bits.join(' · ');
  }

  function reviewIssueLabel(issue) {
    const text=String(issue||'');
    if(/^当前批次(?:疑似)?重复：/.test(text))return '处理重复';
    if(/收件人存在多个|多个相近候选/.test(text))return '核对收件人';
    if(/未定位收件人|收件人邮箱|缺少收件人/.test(text))return '补收件人';
    if(/主题为空|未找到 Subject|缺少主题/.test(text))return '补主题';
    if(/缺少正文|正文过短/.test(text))return '补正文';
    if(/邮件落款后|邮件边界|称呼|落款|置信度|请检查/.test(text))return '核对正文';
    if(/总名单|联系人|院校/.test(text))return '核对联系人';
    return text==='修改待确认'?'确认修改':text;
  }

  function primaryReviewIssue(task){
    const issues=unresolvedImportIssues(task);
    const patterns=[/收件人存在多个|多个相近候选/,/未定位收件人|收件人邮箱|缺少收件人/,/主题为空|未找到 Subject|缺少主题/,/缺少正文|正文过短/,/^当前批次(?:疑似)?重复：/,/总名单|联系人|院校/,/邮件落款后|邮件边界|称呼|落款|置信度|请检查/,/修改待确认/];
    for(const pattern of patterns){const found=issues.find(issue=>pattern.test(String(issue||'')));if(found)return found;}
    return issues[0]||'';
  }

  function renderDuplicateDecision(task) {
    if(!duplicateDecisionEl||!duplicateCandidatesEl)return;
    const group=duplicateDecisionGroup(task);
    if(!group){duplicateDecisionEl.hidden=true;delete duplicateDecisionEl.dataset.groupId;importEditorOverlayEl?.classList.remove('has-duplicate-decision');return;}
    const recommended=recommendedDuplicateTask(group);
    const validKeys=new Set((group.tasks||[]).map(item=>item.editKey));
    const savedRaw=batch.duplicateSelections?.get?.(group.id);
    const savedList=Array.isArray(savedRaw)?savedRaw:(savedRaw?[savedRaw]:[]);
    const selectedKeys=new Set(savedList.filter(key=>validKeys.has(key)));
    if(!selectedKeys.size){const fallback=recommended?.editKey||group.tasks?.[0]?.editKey||'';if(fallback)selectedKeys.add(fallback);}
    if(batch.duplicateSelections instanceof Map)batch.duplicateSelections.set(group.id,[...selectedKeys]);
    if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.textContent=`保留所选（${selectedKeys.size}）`;
    duplicateDecisionEl.hidden=false;
    duplicateDecisionEl.dataset.groupId=group.id;
    importEditorOverlayEl?.classList.add('has-duplicate-decision');
    if(duplicateDecisionKindEl){duplicateDecisionKindEl.textContent=group.type==='exact-email'?'同一邮箱':'疑似同一联系人';duplicateDecisionKindEl.dataset.tone=group.type==='exact-email'?'strong':'soft';}
    if(duplicateKeepAllEl)duplicateKeepAllEl.textContent=group.type==='exact-email'?'全部保留':'不是同一联系人，全部保留';
    if(duplicateDecisionTitleEl)duplicateDecisionTitleEl.textContent=group.type==='exact-email'
      ? `同一收件人有 ${group.tasks?.length||0} 封邮件`
      : `可能是同一联系人：${group.tasks?.length||0} 封邮件`;
    if(duplicateDecisionCopyEl)duplicateDecisionCopyEl.textContent=group.type==='exact-email'
      ? `${group.email||group.label||'该收件人'}。下面已并排展示所有版本，请直接比较正文后勾选要创建的邮件。`
      : `${group.label||'姓名与院校相同'}。下面已并排展示所有候选，请根据正文和收件人直接决定保留哪些。`;
    const unresolvedCount=unresolvedDuplicateGroups(task).length;
    if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent=unresolvedCount>1
      ? `此封邮件还涉及 ${unresolvedCount-1} 组重复；处理本组后会继续提示。`
      : '默认勾选信息更完整的一封；你可以在同一视图里改成保留任意一封或多封。';
    const compareTasks=group.tasks||[];
    duplicateCandidatesEl.dataset.count=String(compareTasks.length);
    duplicateCandidatesEl.innerHTML=compareTasks.map((candidate,index)=>{
      const isRecommended=candidate.editKey===recommended?.editKey;
      const isSelected=selectedKeys.has(candidate.editKey);
      const body=String(candidate.body||'').trim();
      const title=String(candidate.subject||candidate.id||`邮件 ${index+1}`).trim()||`邮件 ${index+1}`;
      const recipient=String(candidate.recipients||'').trim()||'未填写收件人';
      return `<article class="nmda-duplicate-candidate ${isSelected?'is-selected':''} ${candidate.editKey===task.editKey?'is-current':''}" data-duplicate-row="${escapeHtml(candidate.editKey)}">
        <label class="nmda-duplicate-pick-line"><input type="checkbox" data-duplicate-pick="${escapeHtml(candidate.editKey)}" ${isSelected?'checked':''}><span><strong>保留此封</strong><small>${escapeHtml(duplicateCandidateMeta(candidate))}</small></span></label>
        <div class="nmda-duplicate-preview-head"><div class="nmda-duplicate-candidate-title"><strong>${escapeHtml(title)}</strong>${isRecommended?'<em>信息更完整</em>':''}${candidate.editKey===task.editKey?'<small>正在编辑</small>':''}</div><span class="nmda-duplicate-preview-recipient">${escapeHtml(recipient)}</span></div>
        <div class="nmda-duplicate-preview-body"><pre>${escapeHtml(body||'正文为空')}</pre></div>
        <button type="button" class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-duplicate-edit" data-duplicate-open="${escapeHtml(candidate.editKey)}">编辑这封</button>
      </article>`;
    }).join('');
  }

  async function keepSelectedDuplicateCandidate() {
    const groupId=duplicateDecisionEl?.dataset.groupId||'';
    if(!groupId)return;
    const selectedKeys=[...(duplicateCandidatesEl?.querySelectorAll('input[data-duplicate-pick]:checked')||[])].map(input=>input.dataset.duplicatePick).filter(Boolean);
    if(!selectedKeys.length){if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent='至少保留一封邮件；如本组全部不需要，请逐封排除或返回修改身份信息。';return;}
    const selectedSet=new Set(selectedKeys);
    const activeKey=importEditorOverlayEl?.dataset.editKey||'';
    stashCurrentReviewDraft();
    rebuildTasks();
    const group=(batch.duplicateAudit?.groups||[]).find(item=>item.id===groupId);
    if(!group){renderReviewPageOverview();await continueAfterReviewResolution('重复信息已变化，已重新核验');return;}
    const retained=(group.tasks||[]).filter(item=>selectedSet.has(item.editKey));
    if(!retained.length)return;
    for(const candidate of group.tasks||[]){
      if(selectedSet.has(candidate.editKey)){
        const prev=batch.taskEdits.get(candidate.editKey)||{};
        setTaskEdit(candidate,{duplicateConfirmedGroups:[...new Set([...(prev.duplicateConfirmedGroups||[]),groupId])]});
      }else setTaskEdit(candidate,{importExcluded:true});
    }
    batch.duplicateSelections?.delete?.(groupId);
    batch.reviewSelected?.clear?.();
    rebuildTasks();
    renderImportTaskPreview();renderImportHandoff();renderRosterAudit();renderReviewPageOverview();
    const kept=(batch.tasks||[]).find(item=>item.editKey===retained[0].editKey);
    const excludedCount=Math.max(0,(group.tasks?.length||0)-retained.length);
    const decisionSummary=`重复组已处理：保留 ${retained.length} 封${excludedCount?`，排除 ${excludedCount} 封`:''}`;
    setImportStatus(`${decisionSummary}。`,'ok');
    if(kept&&taskNeedsImportReview(kept))openImportTaskEditor(kept);
    else if(reviewTasks().length)openImportTaskEditor(reviewTasks()[0]);
    else await continueAfterReviewResolution(decisionSummary);
  }

  async function keepAllDuplicateCandidates() {
    const groupId=duplicateDecisionEl?.dataset.groupId||'';
    if(!groupId)return;
    stashCurrentReviewDraft();
    rebuildTasks();
    const group=(batch.duplicateAudit?.groups||[]).find(item=>item.id===groupId);
    if(!group){renderReviewPageOverview();await continueAfterReviewResolution('重复信息已变化，已重新核验');return;}
    for(const candidate of group.tasks||[]){
      const prev=batch.taskEdits.get(candidate.editKey)||{};
      setTaskEdit(candidate,{duplicateConfirmedGroups:[...new Set([...(prev.duplicateConfirmedGroups||[]),groupId])]});
    }
    batch.duplicateSelections?.delete?.(groupId);
    batch.reviewSelected?.clear?.();
    rebuildTasks();
    renderImportTaskPreview();renderImportHandoff();renderRosterAudit();renderReviewPageOverview();
    const decisionSummary=`已明确保留该组 ${group.tasks?.length||0} 封邮件（有意重复）`;
    setImportStatus(`${decisionSummary}；后续不再阻塞。`,'ok');
    const current=(batch.tasks||[]).find(item=>item.editKey===importEditorOverlayEl?.dataset.editKey);
    if(current&&taskNeedsImportReview(current))openImportTaskEditor(current);
    else if(reviewTasks().length)openImportTaskEditor(reviewTasks()[0]);
    else await continueAfterReviewResolution(decisionSummary);
  }

  function renderReviewPageOverview() {
    const tasks=(batch.tasks||[]).filter(task=>!task?.importExcluded);
    let pendingCount=0,checked=0;
    for(const task of tasks){if(taskNeedsImportReview(task))pendingCount++;else if(task.reviewConfirmed||task.rosterConfirmed)checked++;}
    const ready=Math.max(0,tasks.length-pendingCount-checked);
    const browseMode=pendingCount===0;
    if(browseMode && batch.reviewFilter==='pending') batch.reviewFilter='all';
    if(reviewWorkspaceTitleEl)reviewWorkspaceTitleEl.textContent=browseMode?'查看邮件':'处理待办';
    if(reviewWorkspaceDescEl)reviewWorkspaceDescEl.textContent=browseMode
      ? (batch.handoffComplete?'抽查或修改本批次邮件；完成后返回选择与安排。':'邮件已满足创建条件；可在这里抽查或编辑。')
      : '只处理会影响创建的事项；完成一项后自动续接下一项。';
    if(reviewExitEl)reviewExitEl.textContent=batch.handoffComplete?'返回选择与安排':'退出检查';
    if(reviewNavCountEl){reviewNavCountEl.hidden=!pendingCount;reviewNavCountEl.textContent=String(pendingCount);}
    if(reviewPageSummaryEl)reviewPageSummaryEl.innerHTML=tasks.length
      ? (browseMode
        ? `<span><strong>${tasks.length}</strong> 封邮件</span><span><strong>0</strong> 待办</span>`
        : `<span><strong>${pendingCount}</strong> 待处理</span><span><strong>${checked}</strong> 已检查</span><span><strong>${ready}</strong> 可直接使用</span>`)
      : '<span>尚无批量邮件</span>';
    if(reviewPageEmptyEl)reviewPageEmptyEl.hidden=!!tasks.length;
    const nextPendingBtn=$('nmda-review-next-pending');
    if(nextPendingBtn){
      const attachmentStats=typeof importAttachmentStats==='function'?importAttachmentStats():{issues:0};
      const canContinue=browseMode&&!batch.handoffComplete&&tasks.length>0;
      nextPendingBtn.hidden=!canContinue;
      nextPendingBtn.dataset.mode=canContinue?'continue':'next';
      if(canContinue)nextPendingBtn.textContent=attachmentStats.issues?`继续：添加附件（${attachmentStats.issues}）`:'继续：选择与安排';
      else nextPendingBtn.textContent='下一个待办';
    }
    if(reviewFilterEl)reviewFilterEl.hidden=browseMode;
    if(reviewQueueTitleEl)reviewQueueTitleEl.textContent=browseMode?'邮件列表':'待办列表';
    ui.querySelectorAll('[data-review-filter]').forEach(button=>button.classList.toggle('is-active',button.dataset.reviewFilter===batch.reviewFilter));
    if(reviewQueueCaptionEl)reviewQueueCaptionEl.textContent=browseMode?'选择一封查看或编辑':(batch.reviewFilter==='all'?'查看本批次全部邮件':'按影响程度显示必须处理的邮件');
    if(reviewSearchEl && reviewSearchEl.value!==String(batch.reviewSearch||''))reviewSearchEl.value=String(batch.reviewSearch||'');
    if(!tasks.length){if(importEditorOverlayEl)importEditorOverlayEl.hidden=true;renderReviewBatchActions();return;}
    renderReviewBatchActions();
    if(reviewInlineEl && !reviewInlineEl.hidden){
      renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');
      if(importEditorOverlayEl?.hidden){const first=reviewVisibleTasks()[0]||tasks[0];if(first)openImportTaskEditor(first);}
    }
  }

  function openReviewWorkspace() {
    batch.uiStep=2;
    renderProcessGuide();
    setWorkbenchTab('batch');
    reviewInlineEl?.closest('.nmda-bulk-workbench')?.classList.add('is-review-focus');
    reviewInlineEl?.closest('.nmda-page')?.classList.add('is-review-page-focus');
    ui.querySelector('[data-page-head="batch"]')?.classList.add('nmda-review-head-hidden');
    if(reviewInlineEl) reviewInlineEl.hidden=false;
    renderReviewPageOverview();
    const first=reviewVisibleTasks()[0] || (batch.tasks||[]).find(task=>!task?.importExcluded);
    if(first && importEditorOverlayEl?.hidden) openImportTaskEditor(first);
    requestAnimationFrame(() => reviewInlineEl?.scrollIntoView?.({behavior:'smooth',block:'start'}));
    setTimeout(() => reviewInlineEl?.scrollIntoView?.({behavior:'smooth',block:'start'}), 80);
  }

  function closeReviewWorkspace() {
    reviewInlineEl?.closest('.nmda-bulk-workbench')?.classList.remove('is-review-focus');
    reviewInlineEl?.closest('.nmda-page')?.classList.remove('is-review-page-focus');
    ui.querySelector('[data-page-head="batch"]')?.classList.remove('nmda-review-head-hidden');
    if(reviewInlineEl) reviewInlineEl.hidden=true;
    closeImportTaskEditor();
    if(batch.handoffComplete){
      scheduleBatchRender({aux:true,force:true});
      requestAnimationFrame(() => $('nmda-stage-execute')?.scrollIntoView?.({behavior:'smooth',block:'start'}));
    }else requestAnimationFrame(() => $('nmda-ingest-result-card')?.scrollIntoView?.({behavior:'smooth',block:'center'}));
  }

  function hideReviewWorkspaceWithoutStash() {
    hideSubjectAssist();
    reviewInlineEl?.closest('.nmda-bulk-workbench')?.classList.remove('is-review-focus');
    reviewInlineEl?.closest('.nmda-page')?.classList.remove('is-review-page-focus');
    ui.querySelector('[data-page-head="batch"]')?.classList.remove('nmda-review-head-hidden');
    if(duplicateDecisionEl){duplicateDecisionEl.hidden=true;delete duplicateDecisionEl.dataset.groupId;}
    if(reviewInlineEl)reviewInlineEl.hidden=true;
    if(importEditorOverlayEl){importEditorOverlayEl.hidden=true;delete importEditorOverlayEl.dataset.editKey;}
  }

  async function enterSelectionAndSchedule(reason='检查完成') {
    if(!batch.dataset || !batch.tasks?.length || batch.running || batch.autoAdvancing)return false;
    if((batch.tasks||[]).some(taskHasBlockingIssue))return false;
    if(supplementPreflightNeedsDecision()){
      openSupplementPreflight();
      setImportStatus('邮件已导入；先完成一次批次准备，再进入后续处理。','warn');
      return false;
    }
    if(batch.handoffComplete){
      batch.uiStep=3;
      if(!batch.planningView)batch.planningView='rules';
      setWorkbenchTab('batch');
      scheduleBatchRender({aux:true,force:true});
      requestAnimationFrame(()=>requestAnimationFrame(()=>$('nmda-stage-execute')?.scrollIntoView?.({behavior:'smooth',block:'start'})));
      return true;
    }
    const token=batch.sessionId;
    batch.autoAdvancing=true;
    try{
      await registerCurrentBatchContacts(token);
      if(!isCurrentBatchSession(token)||(batch.tasks||[]).some(taskHasBlockingIssue))return false;
      batch.handoffComplete=true;
      batch.uiStep=3;
      batch.planningView='rules';
      hideReviewWorkspaceWithoutStash();
      setWorkbenchTab('batch');
      setBatchStatus(`${reason}，已自动进入选择与安排。`,'ok');
      setImportStatus(`${reason}。下一步已为你展开，可以直接选择邮件和时间。`,'ok');
      scheduleBatchRender({aux:true,force:true});
      requestAnimationFrame(()=>requestAnimationFrame(()=>$('nmda-stage-execute')?.scrollIntoView?.({behavior:'smooth',block:'start'})));
      return true;
    }finally{
      batch.autoAdvancing=false;
      renderImportHandoff();
    }
  }

  async function continueAfterReviewResolution(reason='邮件检查完成') {
    const pending=reviewTasks();
    if(pending.length){
      if(batch.reviewFilter==='pending')openImportTaskEditor(pending[0]);
      else renderReviewPageOverview();
      return false;
    }
    const attachmentStats=importAttachmentStats();
    if(attachmentStats.issues){
      hideReviewWorkspaceWithoutStash();
      const card=$('nmda-attachments-card');
      if(card){card.hidden=false;card.open=true;batch.attachmentAttentionShown=true;}
      setImportStatus(`邮件内容已处理完成；还需要添加 ${attachmentStats.issues} 个附件。`,'warn');
      requestAnimationFrame(()=>card?.scrollIntoView?.({behavior:'smooth',block:'start'}));
      return false;
    }
    const other=(batch.tasks||[]).filter(task=>taskHasBlockingIssue(task));
    if(other.length){
      hideReviewWorkspaceWithoutStash();
      setImportStatus(`邮件内容已处理完成；还有 ${other.length} 封存在其他待办。`,'warn');
      requestAnimationFrame(()=>$('nmda-ingest-result-card')?.scrollIntoView?.({behavior:'smooth',block:'center'}));
      return false;
    }
    return enterSelectionAndSchedule(reason);
  }

  function unresolvedDuplicateGroupCount(){
    const ids=new Set();
    for(const task of (batch.tasks||[])){
      if(task?.importExcluded)continue;
      for(const group of unresolvedDuplicateGroups(task))if(group?.id)ids.add(group.id);
    }
    return ids.size;
  }

  function openNextBlockingIssue(preferred=''){
    setWorkbenchTab('batch');
    const reviewPending=reviewTasks();
    const attachmentStats=importAttachmentStats();
    if(preferred==='attachments' && attachmentStats.issues){
      hideReviewWorkspaceWithoutStash();
      const card=$('nmda-attachments-card');
      if(card){card.hidden=false;card.open=true;batch.attachmentAttentionShown=true;requestAnimationFrame(()=>card.scrollIntoView?.({behavior:'smooth',block:'start'}));}
      return true;
    }
    if(reviewPending.length){
      openReviewWorkspace();
      const target=reviewPending[0];
      if(target)openImportTaskEditor(target);
      return true;
    }
    if(attachmentStats.issues){
      const card=$('nmda-attachments-card');
      if(card){card.hidden=false;card.open=true;batch.attachmentAttentionShown=true;requestAnimationFrame(()=>card.scrollIntoView?.({behavior:'smooth',block:'start'}));}
      return true;
    }
    const other=(batch.tasks||[]).find(task=>taskHasBlockingIssue(task));
    if(other){
      setImportStatus('还有一项无法自动归类的待办，请查看待办中心说明。','warn');
      requestAnimationFrame(()=>$('nmda-ingest-result-card')?.scrollIntoView?.({behavior:'smooth',block:'center'}));
      return true;
    }
    return enterSelectionAndSchedule('待办已完成');
  }

  function openNextReviewTask(){
    const current=reviewCurrentTask();
    stashCurrentReviewDraft();
    rebuildTasks();
    const pending=reviewTasks();
    if(!pending.length){void continueAfterReviewResolution('邮件待办已完成');return;}
    const currentIndex=current?pending.findIndex(task=>task.editKey===current.editKey):-1;
    const next=pending[currentIndex>=0&&pending.length>1?(currentIndex+1)%pending.length:0]||pending[0];
    if(next)openImportTaskEditor(next);
  }

  function reviewCandidateEmails(task) {
    const {rowMeta,sourceBlocks,contextOffset=0}=taskSourceMeta(task);
    const candidates=[];
    const seen=new Set();
    const identityText=`${rowMeta?.heading||''} ${rowMeta?.salutation||''}`.toLowerCase();
    const identityTokens=identityText.replace(/[^a-z0-9\p{L}]+/gu,' ').split(/\s+/).filter(token=>token.length>=3&&!['dear','prof','professor','doctor','university','subject'].includes(token));
    const add=(email,index,score,reason,text='')=>{
      const key=String(email||'').toLowerCase();
      if(!key||seen.has(key))return;
      let adjusted=Number(score||0); const local=key.split('@')[0];
      if(identityTokens.some(token=>local.includes(token)))adjusted+=24;
      else if(Number.isFinite(index)&&rowMeta&&index>Number(rowMeta.endBlock??rowMeta.startBlock??0))adjusted-=36;
      if(reason==='当前邮件线索')adjusted+=20;
      if(adjusted<55)return;
      seen.add(key);
      candidates.push({email,index:Number.isFinite(index)?index:null,score:adjusted,reason,text});
    };
    for(const c of rowMeta?.recipientCandidates||[]) add(c.email,c.index,c.score,'原文附近',c.text||'');
    if(rowMeta?.recipientEvidence?.email) add(rowMeta.recipientEvidence.email,rowMeta.recipientEvidence.index,rowMeta.recipientEvidence.score,'当前邮件线索',rowMeta.recipientEvidence.text||'');
    if(sourceBlocks.length && rowMeta){
      const localStart=Math.max(0,Number(rowMeta.startBlock||0)-contextOffset-10), localEnd=Math.min(sourceBlocks.length-1,Number(rowMeta.endBlock ?? rowMeta.startBlock ?? 0)-contextOffset+10);
      // Reuse the recognizer's canonical recipient scoring instead of maintaining a second,
      // drifting email detector in the review UI. The UI may widen the evidence window for
      // manual recovery, but candidate semantics and penalties stay identical to parsing.
      const resolved=MailRecognizer?.resolveRecipientContext?.(sourceBlocks,localStart,localEnd,rowMeta?.salutation||'',{indexOffset:contextOffset});
      for(const c of resolved?.candidates||[]){
        const absolute=Number(c.index),reason=absolute<Number(rowMeta.startBlock||0)?'邮件前文附近':absolute>Number(rowMeta.endBlock??rowMeta.startBlock??0)?'邮件后文附近':'邮件正文范围';
        add(c.email,absolute,c.score,reason,c.text||'');
      }
    }
    if(task?.rosterEmailCandidate) add(task.rosterEmailCandidate,null,112,'总套磁名单唯一匹配',task?.rosterReference?.name||task?.rosterReference?.school||'总名单参考记录');
    return candidates.sort((a,b)=>b.score-a.score).slice(0,8);
  }

  function renderReviewQueue(activeKey='') {
    if(!reviewQueueEl)return;
    pruneReviewSelection();
    const allList=reviewVisibleTasks();
    const list=allList.slice(0,Math.max(50,viewPerf.reviewRenderLimit||250));
    const pendingCount=reviewTasks().length;
    if(reviewProgressEl) reviewProgressEl.textContent=pendingCount?`${pendingCount} 封待处理`:'没有待处理邮件';
    reviewQueueEl.innerHTML=list.length?list.map((task,index)=>{
      const issues=unresolvedImportIssues(task);
      const pending=issues.length>0;
      const status=pending?(reviewIssueLabel(primaryReviewIssue(task))||'待处理'):(task.reviewConfirmed||task.rosterConfirmed?'已检查':'可直接使用');
      const confirmable=taskCanBatchConfirm(task);
      const checked=confirmable&&batch.reviewSelected?.has(task.editKey)?'checked':'';
      const selectHtml=confirmable?`<label class="nmda-review-select"><input type="checkbox" data-review-select="${escapeHtml(task.editKey)}" ${checked} aria-label="选择 ${escapeHtml(task.id||`邮件 ${index+1}`)}"></label>`:'<span class="nmda-review-select-spacer"></span>';
      return `<div class="nmda-review-queue-row ${task.editKey===activeKey?'is-active':''} ${checked?'is-selected':''}" data-review-row="${escapeHtml(task.editKey)}">${selectHtml}<button type="button" class="nmda-review-queue-item" data-review-key="${escapeHtml(task.editKey)}"><span class="nmda-review-queue-index">${index+1}</span><span class="nmda-review-queue-main"><strong>${escapeHtml(task.id||`邮件 ${index+1}`)}</strong><small>${escapeHtml(task.subject||task.recipients||'未识别主题')}</small><em data-tone="${pending?'warn':'ok'}">${escapeHtml(status)}${pending&&issues.length>1?` · +${issues.length-1}`:''}</em></span></button></div>`;
    }).join(''):`<div class="nmda-review-empty">${batch.reviewFilter==='pending'?'当前没有需要修改的邮件。':'当前没有可查看的邮件。'}</div>`;
    if(allList.length>list.length)reviewQueueEl.insertAdjacentHTML('beforeend',`<button type="button" class="nmda-review-load-more" data-review-load-more>继续显示（${list.length}/${allList.length}）</button>`);
    renderReviewBatchActions();
    const visible=reviewVisibleTasks().filter(taskCanBatchConfirm);const allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    const selectButton=$('nmda-review-select-filtered');if(selectButton){const batchMode=batch.reviewFilter==='pending'&&pendingCount>0;selectButton.hidden=!batchMode||visible.length<2;selectButton.textContent=allSelected?'取消批量选择':`批量确认 ${visible.length} 封…`;}
    if(activeKey)requestAnimationFrame(()=>reviewQueueEl.querySelector(`[data-review-row="${CSS.escape(activeKey)}"]`)?.scrollIntoView?.({block:'nearest'}));
  }

  function renderReviewSource(task) {
    const issues=unresolvedImportIssues(task);
    const candidates=reviewCandidateEmails(task);
    const recipientAssist=$('nmda-recipient-assist');
    if(recipientAssist){
      const needsRecipient=issues.some(x=>/收件人|邮箱/.test(x))&&!recipientLooksValid(task.recipients);
      recipientAssist.hidden=!(needsRecipient&&candidates.length);
      recipientAssist.innerHTML=needsRecipient&&candidates.length
        ? `<span>可选收件人：</span>${candidates.slice(0,5).map(c=>`<button type="button" data-recipient-suggestion="${escapeHtml(c.email)}" title="${escapeHtml(c.reason||'')}" >${escapeHtml(c.email)}</button>`).join('')}`
        : '';
      recipientAssist.querySelectorAll('[data-recipient-suggestion]').forEach(button=>button.addEventListener('click',()=>{
        importEditRecipientsEl.value=button.dataset.recipientSuggestion||'';
        importEditRecipientsEl.dispatchEvent(new Event('input',{bubbles:true}));
        importEditRecipientsEl.dispatchEvent(new Event('change',{bubbles:true}));
      }));
    }
    // 用户决策界面只展示做决定所需的信息；解析证据保留在内部状态/诊断层，不进入邮件审阅主流程。
    if(!reviewSourceContextEl||!reviewSourceMetaEl||!reviewCandidatesEl)return;
    const {collection,rowMeta,sourceBlocks,contextOffset=0}=taskSourceMeta(task);
    const evidenceSet=new Set(task?.importEvidence||[]);
    const effectiveConfidence=effectiveImportConfidence(task);
    const excludedBlocks=rowMeta?.excludedBlocks||[];
    const recognizedRoles=new Set((rowMeta?.blockRoles||[]).flatMap(item=>(item.roles||[]).map(role=>role.role)));
    const hasSalutation=recognizedRoles.has('salutation')||evidenceSet.has('salutation');
    const hasClosing=recognizedRoles.has('closing')||evidenceSet.has('closing');
    const hasSignature=recognizedRoles.has('signature')||evidenceSet.has('signature');
    const boundaryLocated=Number.isFinite(Number(rowMeta?.structure?.mailEndBlock??rowMeta?.endBlock))&&(hasClosing||evidenceSet.has('tail-boundary'));
    reviewSourceMetaEl.innerHTML=`<div class="nmda-parse-steps"><span data-ok="${recipientLooksValid(task.recipients)?'1':'0'}">收件人</span><span data-ok="${String(task.subject||'').trim()?'1':'0'}">主题</span><span data-ok="${hasSalutation?'1':'0'}">称呼</span><span data-ok="${String(task.body||'').trim()?'1':'0'}">正文</span><span data-ok="${hasClosing?'1':'0'}">结束语</span><span data-ok="${hasSignature?'1':'0'}">署名</span><span data-ok="${boundaryLocated?'1':'0'}">边界</span></div><span><strong>${escapeHtml(task.sourceFile||collection?.source||'来源')}</strong></span><span>${escapeHtml(task.collectionName||collection?.name||'')}</span><span>识别 ${Math.round(effectiveConfidence)}%</span>${excludedBlocks.length?`<span>已隔离 ${excludedBlocks.length} 段非正文</span>`:''}${rowMeta?.heading?`<span title="${escapeHtml(rowMeta.heading)}">对象线索：${escapeHtml(rowMeta.heading)}</span>`:''}`;
    if(!sourceBlocks.length||!rowMeta){
      reviewSourceContextEl.innerHTML=`<div class="nmda-review-fallback"><strong>来源未提供原始块定位。</strong><p>${escapeHtml(task.subject||'')}</p><pre>${escapeHtml(task.body||'')}</pre></div>`; return;
    }
    const start=Math.max(0,Number(rowMeta.startBlock||0)-contextOffset-8), end=Math.min(sourceBlocks.length-1,Number(rowMeta.consumedEndBlock ?? rowMeta.endBlock ?? rowMeta.startBlock ?? 0)-contextOffset+8);
    const emailRe=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}(?![A-Z0-9.\-])/i;
    const subjectRe=/(?:^|[\s>*#\-])(?:\*{0,2})\s*(?:subject|主题|邮件主题|邮件标题)\s*[:：]/i;
    const salutationRe=/(?:\b(?:dear|hello|hi)\s+|尊敬的|敬爱的|教授.{0,10}您好|老师.{0,10}您好)/iu;
    const closeRe=/(?:yours\s+sincerely|sincerely|best\s+regards|kind\s+regards|此致\s*敬礼|祝好)/iu;
    const html=[];
    const excludedByIndex=new Map();
    for(const item of excludedBlocks){const index=Number(item.index),list=excludedByIndex.get(index)||[];list.push(item);excludedByIndex.set(index,list);}
    const rolesByIndex=new Map((rowMeta.blockRoles||[]).map(item=>[Number(item.index),item.roles||[]]));
    const hasStructuredRoles=rolesByIndex.size>0;
    for(let i=start;i<=end;i++){
      const block=sourceBlocks[i]||{}; const text=String(block.text||'');
      const labels=[];
      const absolute=i+contextOffset,excluded=excludedByIndex.get(absolute)||[],roles=rolesByIndex.get(absolute)||[];
      if(absolute===rowMeta.startBlock)labels.push('邮件起点'); if(absolute===rowMeta.endBlock)labels.push('邮件终点');
      if(hasStructuredRoles){for(const role of roles)if(role?.label)labels.push(role.label);}
      else{
        if(subjectRe.test(text))labels.push('主题'); if(salutationRe.test(text))labels.push('称呼'); if(closeRe.test(text))labels.push('结束语'); if(emailRe.test(text))labels.push('邮箱线索');
        for(const item of excluded)labels.push(`已排除·${item.label||'非正文'}`);
      }
      const uniqueLabels=[...new Set(labels)];
      const inside=absolute>=rowMeta.startBlock&&absolute<=rowMeta.endBlock;
      const hasRecipientRole=roles.some(role=>role.role==='recipient'||role.role==='recipient-candidate')||(!hasStructuredRoles&&emailRe.test(text));
      html.push(`<div class="nmda-source-block ${inside?'is-mail-range':'is-context'} ${hasRecipientRole?'has-email':''} ${excluded.length?'is-excluded':''}"><div class="nmda-source-block-gutter"><span>${absolute+1}</span>${uniqueLabels.map(x=>`<em>${escapeHtml(x)}</em>`).join('')}</div><pre>${escapeHtml(text)}</pre></div>`);
    }
    reviewSourceContextEl.innerHTML=html.join('');
    const firstAnchor=reviewSourceContextEl.querySelector('.is-mail-range'); firstAnchor?.scrollIntoView?.({block:'nearest'});
  }

  function updateReviewConfirmationControls(task) {
    const explicit=taskNeedsExplicitConfirmation(task);
    const duplicateActive=taskHasUnresolvedDuplicate(task);
    const visible=!!explicit&&!duplicateActive;
    const save=$('nmda-import-editor-save'), next=$('nmda-import-editor-next');
    if(save)save.hidden=!visible;
    if(next)next.hidden=!visible;
    if(reviewActionsEl)reviewActionsEl.hidden=!visible;
  }

  function updateReviewFieldStates(task) {
    const issues=unresolvedImportIssues(task);
    const map=[['recipients','nmda-review-field-recipients',/收件人|邮箱/],['subject','nmda-review-field-subject',/主题|Subject/],['body','nmda-review-field-body',/正文|邮件称呼|邮件落款|边界/]];
    for(const [,id,re] of map){const el=$(id); if(el)el.dataset.issue=issues.some(x=>re.test(x))?'1':'0';}
    if(reviewProblemSummaryEl){const labels=[...new Set(issues.map(reviewIssueLabel).filter(Boolean))];reviewProblemSummaryEl.textContent=issues.length?(issues.every(issue=>issue==='修改待确认')?'修改已保留，需要确认后继续。':`当前待办：${labels.join(' · ')}`):'内容完整；确定性问题补齐后会自动完成。';}
    renderDuplicateDecision(task);
    updateReviewConfirmationControls(task);
  }

  function refreshReviewDraftIndicators() {
    if(importEditorOverlayEl?.hidden)return;
    const problems=[];
    const recipientOk=recipientLooksValid(importEditRecipientsEl?.value||'');
    const subjectOk=!!String(importEditSubjectEl?.value||'').trim();
    const bodyOk=!!String(importEditBodyEl?.value||'').trim();
    const states=[['nmda-review-field-recipients',recipientOk,'收件人邮箱'],['nmda-review-field-subject',subjectOk,'主题'],['nmda-review-field-body',bodyOk,'正文']];
    for(const [id,ok,label] of states){const el=$(id);if(el){el.dataset.issue=ok?'0':'1';el.dataset.resolved=ok?'1':'0';}if(!ok)problems.push(label);}
    if(reviewProblemSummaryEl){
      const key=importEditorOverlayEl?.dataset.editKey;const task=(batch.tasks||[]).find(t=>t.editKey===key);const soft=(task?unresolvedImportIssues(task):[]).filter(x=>!/(收件人|邮箱|缺少主题|缺少正文)/.test(x));
      reviewProblemSummaryEl.textContent=problems.length?`仍需补充：${problems.join('、')}`:task?.reviewDraftPending?'修改已保留，需要确认后继续。':soft.filter(x=>x!=='修改待确认').length?`还需检查：${soft.filter(x=>x!=='修改待确认').join('；')}`:'内容完整；无需额外确认。';
      updateReviewConfirmationControls(task);
    }
    if(reviewFeedbackEl)reviewFeedbackEl.hidden=true;
  }

  function renderImportTaskPreview() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const resultCard=$('nmda-ingest-result-card');
    const tasks=batch.tasks||[];
    if(!batch.dataset){if(resultCard)resultCard.hidden=true;return;}
    if(resultCard)resultCard.hidden=false;
    let contentPending=0,reviewPending=0,otherBlocked=0,autoPassed=0,policyBlocked=0;
    for(const task of tasks){
      const state=taskIssueState(task);
      if(state.content.length)contentPending++;
      if(state.review.some(issue=>!/^当前批次(?:疑似)?重复：/.test(String(issue||''))))reviewPending++;
      if(state.other.length)otherBlocked++;
      if(task.policyBlocked)policyBlocked++;
      if(!taskHasBlockingIssue(task)&&!task.policyBlocked)autoPassed++;
    }
    const reviewTotal=tasks.filter(taskNeedsImportReview).length;
    const duplicateGroups=unresolvedDuplicateGroupCount();
    const stats=importAttachmentStats();
    const excluded=excludedImportCount();
    const totalDetected=tasks.length+excluded;
    const blockerTasks=tasks.filter(task=>taskHasBlockingIssue(task)).length;
    const metrics=[
      `<div class="nmda-health-metric is-total"><strong>${totalDetected}</strong><span>邮件</span></div>`,
      `<div class="nmda-health-metric is-ok"><strong>${autoPassed}</strong><span>可直接使用</span></div>`
    ];
    if(contentPending)metrics.push(`<div class="nmda-health-metric is-warn"><strong>${contentPending}</strong><span>需补内容</span></div>`);
    if(duplicateGroups)metrics.push(`<div class="nmda-health-metric is-warn"><strong>${duplicateGroups}</strong><span>重复组待选</span></div>`);
    if(reviewPending)metrics.push(`<div class="nmda-health-metric is-warn"><strong>${reviewPending}</strong><span>需人工核对</span></div>`);
    if(stats.issues)metrics.push(`<div class="nmda-health-metric is-warn is-attachment"><strong>${stats.issues}</strong><span>附件待补</span></div>`);
    if(otherBlocked)metrics.push(`<div class="nmda-health-metric is-error"><strong>${otherBlocked}</strong><span>其他阻塞</span></div>`);
    if(policyBlocked)metrics.push(`<div class="nmda-health-metric"><strong>${policyBlocked}</strong><span>联系限制</span></div>`);
    if(excluded)metrics.push(`<div class="nmda-health-metric"><strong>${excluded}</strong><span>已排除</span></div>`);
    if(importPreviewSummaryEl) importPreviewSummaryEl.innerHTML=metrics.join('');

    const guide=$('nmda-review-guidance');
    const contextPending=supplementPreflightNeedsDecision();
    if(guide){
      if(contextPending){
        guide.innerHTML='<span class="nmda-guidance-main"><strong>先完成批次准备</strong><small>参考总名单与附件会在导入后一次提示；没有的项目可以直接跳过。</small></span>';
        guide.dataset.state='context';
      }else if(blockerTasks||stats.issues){
        const parts=[];
        if(contentPending)parts.push(`${contentPending} 封先补收件人 / 主题 / 正文`);
        if(reviewPending)parts.push(`${reviewPending} 封需要人工核对`);
        if(duplicateGroups)parts.push(`${duplicateGroups} 组重复需要取舍`);
        if(stats.issues)parts.push(`${stats.issues} 个附件最后补齐`);
        if(otherBlocked)parts.push(`${otherBlocked} 封存在其他阻塞`);
        const mailBlockers=contentPending+reviewPending+duplicateGroups+otherBlocked;
        const titleText=mailBlockers?'建议先处理邮件内容':'补齐附件后即可继续';
        const nextText=mailBlockers&&stats.issues?`${parts.filter(x=>!x.includes('附件')).join('；')}；附件可最后统一补齐。`:parts.join('；');
        guide.innerHTML=`<span class="nmda-guidance-main"><strong>${titleText}</strong><small>${nextText}。</small></span>`;
        guide.dataset.state='pending';
      }else{
        guide.innerHTML='<span class="nmda-guidance-main"><strong>已准备好进入下一步</strong><small>选择本次要创建的邮件并设置时间。</small></span>';
        guide.dataset.state='ready';
      }
    }
    if(importReviewBtnEl){
      importReviewBtnEl.hidden=!tasks.length||contextPending;
      importReviewBtnEl.textContent=(blockerTasks||stats.issues)?`继续处理待办`:'查看邮件';
      importReviewBtnEl.dataset.mode=(blockerTasks||stats.issues)?'issues':'review';
    }
    const restoreExcluded=$('nmda-restore-excluded');
    if(restoreExcluded){restoreExcluded.hidden=!excluded;restoreExcluded.textContent=excluded?`恢复已排除（${excluded}）`:'恢复已排除';}
    renderAttachmentContextCue();
  }

  function updateReviewMailNavigation(task) {
    let visible=reviewVisibleTasks();
    let index=visible.findIndex(item=>item.editKey===task?.editKey);
    if(index<0){
      visible=(batch.tasks||[]).filter(item=>!item?.importExcluded);
      index=visible.findIndex(item=>item.editKey===task?.editKey);
    }
    const total=visible.length;
    if(reviewMailTitleEl)reviewMailTitleEl.textContent=String(task?.id||task?.collectionName||task?.recipients||'邮件内容');
    if(reviewPositionEl)reviewPositionEl.textContent=index>=0&&total?`${index+1} / ${total}`:`${total||0} 封`;
    if(reviewPrevEl){reviewPrevEl.disabled=index<=0;reviewPrevEl.title=index>0?'上一封邮件':'已经是第一封';}
    if(reviewNextEl){reviewNextEl.disabled=index<0||index>=total-1;reviewNextEl.title=index>=0&&index<total-1?'下一封邮件':'已经是最后一封';}
  }

  function navigateReviewMail(delta) {
    const current=reviewCurrentTask();
    if(!current)return;
    const visibleBefore=reviewVisibleTasks();
    const beforeIndex=visibleBefore.findIndex(item=>item.editKey===current.editKey);
    if(beforeIndex<0)return;
    const targetBefore=visibleBefore[beforeIndex+Number(delta||0)];
    if(!targetBefore)return;
    stashCurrentReviewDraft();
    rebuildTasks();
    renderReviewPageOverview();
    const target=(batch.tasks||[]).find(item=>item.editKey===targetBefore.editKey && !item?.importExcluded);
    if(target)openImportTaskEditor(target);
  }

  function openImportTaskEditor(task) {
    if (!task || !importEditorOverlayEl) return;
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
    if(reviewMoreMenuEl)reviewMoreMenuEl.open=false;
    setWorkbenchTab('batch');
    if(reviewInlineEl) reviewInlineEl.hidden=false;
    importEditorOverlayEl.dataset.editKey=task.editKey;
    importEditRecipientsEl.value=task.recipients||'';
    importEditSubjectEl.value=task.subject||'';
    importEditSubjectEl.dataset.startedBlank=String(task.subject||'').trim()?'0':'1';
    importEditBodyEl.value=task.body||'';
    hideSubjectAssist();
    importEditAttachmentsEl.value=(task.attachmentRefs||[]).join('; ');
    importEditScheduleEl.value=task.scheduleAt||'';
    importEditTagsEl.value=(task.tags||[]).join('; ');
    const issues=unresolvedImportIssues(task);
    const issueLabels=[...new Set(issues.map(reviewIssueLabel).filter(Boolean))];
    const editorTitle=$('nmda-import-editor-title');if(editorTitle)editorTitle.textContent=issues.length?`当前：${reviewIssueLabel(primaryReviewIssue(task))}`:'邮件内容';
    if(importEditorEvidenceEl)importEditorEvidenceEl.textContent=`${task.id || task.collectionName || '邮件'}${issues.length ? ` · ${issueLabels.join(' · ')}` : ' · 内容完整，可直接使用'}`;
    if(reviewFeedbackEl){reviewFeedbackEl.hidden=true;reviewFeedbackEl.textContent='';}
    updateReviewFieldStates(task);
    renderReviewSource(task);
    importEditorOverlayEl.hidden=false;
    renderReviewQueue(task.editKey);
    updateReviewMailNavigation(task);
    autoSizeReviewBody();
    setTimeout(()=>{
      if(issues.some(x=>/收件人|邮箱/.test(x)))importEditRecipientsEl?.focus({preventScroll:true});
      else if(issues.some(x=>/主题|Subject/.test(x)))importEditSubjectEl?.focus({preventScroll:true});
      else if(issues.some(x=>/正文|称呼|落款|边界/.test(x)))importEditBodyEl?.focus({preventScroll:true});
    },0);
  }

  function closeImportTaskEditor(){
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
    stashCurrentReviewDraft();
    hideSubjectAssist();
    if(importEditorOverlayEl){importEditorOverlayEl.hidden=true;delete importEditorOverlayEl.dataset.editKey;}
    renderReviewQueue('');
  }

  async function saveImportTaskEditor(goNext=false) {
    if(!importEditorOverlayEl)return;
    batch.handoffComplete=false;
    const key=importEditorOverlayEl.dataset.editKey;
    const task=(batch.tasks||[]).find(t=>t.editKey===key); if(!task){closeImportTaskEditor();return;}
    const recipients=importEditRecipientsEl.value.trim(), subject=importEditSubjectEl.value.trim(), body=importEditBodyEl.value;
    const coreValid=recipientLooksValid(recipients)&&!!subject&&!!String(body||'').trim();
    stashCurrentReviewDraft();
    const previousEdit=batch.taskEdits.get(key)||{};
    setTaskEdit(task,{
      reviewConfirmed:coreValid,
      rosterConfirmed: coreValid && !!(task.rosterIssues||[]).length ? true : (previousEdit.rosterConfirmed||false),
      duplicateConfirmedGroups:[...(previousEdit.duplicateConfirmedGroups||[])]
    });
    rebuildTasks();
    const current=(batch.tasks||[]).find(t=>t.editKey===key);
    if(current && taskNeedsImportReview(current)){
      if(reviewFeedbackEl){reviewFeedbackEl.hidden=false;reviewFeedbackEl.textContent=`仍需处理：${unresolvedImportIssues(current).join('；')}`;}
      openImportTaskEditor(current); return;
    }
    renderReviewPageOverview();
    if(!goNext){
      if(!reviewTasks().length){await continueAfterReviewResolution('邮件检查完成');return;}
      const saved=(batch.tasks||[]).find(t=>t.editKey===key);
      if(saved)openImportTaskEditor(saved);
      if(reviewFeedbackEl){reviewFeedbackEl.hidden=false;reviewFeedbackEl.textContent='已确认本封。';}
      return;
    }
    let next=null;
    if(batch.reviewFilter==='all'){
      const visible=reviewVisibleTasks();
      const idx=visible.findIndex(t=>t.editKey===key);
      next=visible[idx+1]||visible[0]||null;
      if(next?.editKey===key && visible.length===1)next=null;
    }else next=reviewTasks()[0]||null;
    if(next)openImportTaskEditor(next);else await continueAfterReviewResolution('邮件检查完成');
  }

  async function excludeCurrentReviewTask() {
    batch.handoffComplete=false;
    const key=importEditorOverlayEl?.dataset.editKey; if(!key)return;
    const task=(batch.tasks||[]).find(t=>t.editKey===key); if(!task)return;
    const label=String(task.subject||task.recipients||task.id||'这封邮件').trim();
    if(reviewMoreMenuEl)reviewMoreMenuEl.open=false;
    batch.reviewSelected?.delete?.(key);
    setTaskEdit(task,{importExcluded:true});
    rebuildTasks();
    setImportStatus(`已排除「${label}」；需要时可在待办中心恢复。`,'ok');
    const next=reviewVisibleTasks()[0]||null;
    if(next)openImportTaskEditor(next);else await continueAfterReviewResolution('待处理邮件已完成');
  }

  async function registerCurrentBatchContacts(sessionToken = batch.sessionId) {
    if (!Contacts || !(batch.tasks || []).length || !isCurrentBatchSession(sessionToken)) return 0;
    try {
      await ensureContactBook();
      if (!isCurrentBatchSession(sessionToken)) return 0;
      const recipients = [];
      for (const task of batch.tasks || []) recipients.push(...Contacts.parseRecipients(task.recipients));
      if (!isCurrentBatchSession(sessionToken)) return 0;
      const added = Contacts.mergeRecipientList(contactBook.contacts, recipients, '未联系');
      if (!isCurrentBatchSession(sessionToken)) return 0;
      if (added) markContactsChanged();
      await persistContacts();
      if (!isCurrentBatchSession(sessionToken)) return added;
      if (added) scheduleContactsRender();
      if (batch.dataset && added) scheduleBatchRender({aux:false});
      return added;
    } catch (error) {
      console.warn(`[${APP}] contact registration failed`, error);
      return 0;
    }
  }

  function parseTaskClassifications(value) {
    const items = Contacts?.parseTags?.(value) || [];
    const reserved = new Set((Contacts?.SYSTEM_CLASSIFICATIONS || []).map(item => item.toLocaleLowerCase('zh-CN')));
    return items.filter(item => !reserved.has(item.toLocaleLowerCase('zh-CN')));
  }

  function taskContactSnapshot(task) {
    if (!task) return { state:{stage:'未联系',stages:['未联系'],followUp:false,policies:[],blocked:false}, tags:[], classifications:[] };
    const recipients = task.recipients || '';
    if (task._contactSnapshotVersion === viewPerf.contactVersion && task._contactSnapshotRecipients === recipients && task._contactSnapshot) return task._contactSnapshot;
    const snapshot = {
      state: contactStateForRecipients(recipients),
      tags: contactTagsForRecipients(recipients),
      classifications: contactClassificationsForRecipients(recipients)
    };
    task._contactSnapshotVersion = viewPerf.contactVersion;
    task._contactSnapshotRecipients = recipients;
    task._contactSnapshot = snapshot;
    return snapshot;
  }

  function taskEffectiveClassifications(task) {
    const own = parseTaskClassifications(task.tags || []);
    return Contacts ? Contacts.mergeTags(taskContactSnapshot(task).classifications, own) : own;
  }

  // Backward-compatible internal alias: v0.7 stored task custom classifications in `tags`.
  function taskEffectiveTags(task) { return taskEffectiveClassifications(task); }

  function normalizedSearchText(value) {
    return String(value || '').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
  }

  function taskMatchesSearch(task) {
    const query = normalizedSearchText(batchSearchEl?.value || '');
    if (!query) return true;
    const state = taskContactSnapshot(task).state;
    const dynamic = normalizedSearchText([
      state.stages.join(' '),
      state.followUp ? '待跟进' : '',
      taskBusinessTags(task).join(' '),
      statusLabel(task)
    ].join(' '));
    const haystack = `${task._searchStatic || ''} ${dynamic}`;
    return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
  }

  function normalizedTagSet(tags) {
    return new Set((Contacts?.parseTags?.(tags) || []).map(tag => tag.toLocaleLowerCase('zh-CN')));
  }

  function taskMatchesTagFilter(task) {
    if (!taskMatchesSearch(task)) return false;
    const stageFilter=String(batchStageFilterEl?.value || '').trim();
    if(stageFilter){
      const state=taskContactSnapshot(task).state;
      if(!state.stages.includes(stageFilter)) return false;
    }
    const include = Contacts?.parseTags?.(batchTagIncludeEl?.value || '') || [];
    if (!include.length) return true;
    const own = normalizedTagSet(taskBusinessTags(task));
    const includeKeys = include.map(tag => tag.toLocaleLowerCase('zh-CN'));
    return includeKeys.every(tag => own.has(tag));
  }

  function filteredBatchTasks() {
    return (batch.tasks || []).filter(taskMatchesTagFilter);
  }

  function refreshTaskCoreValidation(task) {
    if(!task)return;
    const errors=(task.errors||[]).filter(error=>!/^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(String(error||'')));
    if(!String(task.recipients||'').trim())errors.push('缺少收件人');
    else if(!recipientLooksValid(task.recipients))errors.push('收件人邮箱格式无效');
    if(!String(task.subject||'').trim())errors.push('缺少主题');
    if(!String(task.body||'').trim())errors.push('缺少正文');
    task.errors=[...new Set(errors)];
    task.warnings=(task.warnings||[]).filter(warning=>{
      const text=String(warning||'');
      if(/主题为空/.test(text)&&String(task.subject||'').trim())return false;
      if(/未定位收件人|无收件人/.test(text)&&recipientLooksValid(task.recipients))return false;
      if(/正文过短/.test(text)&&String(task.body||'').length>=40)return false;
      return true;
    });
    if(task.status==='ready'||task.status==='error')task.status=task.errors.length?'error':'ready';
  }

  function setTaskEdit(task, patch) {
    const prev = batch.taskEdits.get(task.editKey) || {};
    const beforeReviewIssues=unresolvedImportIssues(task);
    const coreChanged=(patch.recipients!=null && String(patch.recipients||'').trim()!==String(task.recipients||'').trim())
      || (patch.subject!=null && String(patch.subject||'').trim()!==String(task.subject||'').trim())
      || (patch.body!=null && String(patch.body||'')!==String(task.body||''));
    const next = { ...prev, ...patch };
    const duplicateIdentityChanged=(patch.recipients!=null && String(patch.recipients||'').trim()!==String(task.recipients||'').trim())
      || (patch.school!=null && String(patch.school||'').trim()!==String(task.school||'').trim());
    if(duplicateIdentityChanged && patch.duplicateConfirmedGroups==null)next.duplicateConfirmedGroups=[];
    let deterministicRepairClearsAll=false;
    if(coreChanged && patch.reviewConfirmed==null && beforeReviewIssues.length){
      const hadDeterministicGap=beforeReviewIssues.some(isAutoResolvableReviewIssue)
        || !recipientLooksValid(task.recipients||'') || !String(task.subject||'').trim() || !String(task.body||'').trim();
      if(hadDeterministicGap){
        const prospective={...task,...patch,reviewConfirmed:false,reviewDraftPending:false};
        deterministicRepairClearsAll=unresolvedImportIssues(prospective).length===0;
      }
    }
    if(coreChanged && patch.reviewConfirmed==null){
      next.reviewConfirmed=false;
      // Missing-field repairs are evaluated against the resulting current facts. If the repair
      // removes every remaining review reason, no second confirmation is required. Editing a
      // previously clean mail or a genuinely ambiguous parse still needs explicit confirmation.
      next.reviewDraftPending=!deterministicRepairClearsAll;
    }
    if(patch.reviewConfirmed===true)next.reviewDraftPending=false;
    if (patch.tags != null) next.tags = parseTaskClassifications(patch.tags);
    batch.taskEdits.set(task.editKey, next);
    if (patch.enabled != null || patch.school != null || patch.scheduleAt != null) batch.schedulePlan = null;
    if (patch.enabled != null) task.enabled = !!patch.enabled;
    if(coreChanged && patch.reviewConfirmed==null){task.reviewConfirmed=false;task.reviewDraftPending=!deterministicRepairClearsAll;}
    if(patch.reviewConfirmed===true){task.reviewConfirmed=true;task.reviewDraftPending=false;}
    if(patch.duplicateConfirmedGroups!=null)task.duplicateConfirmedGroups=[...(patch.duplicateConfirmedGroups||[])];
    else if(duplicateIdentityChanged)task.duplicateConfirmedGroups=[];
    if (patch.recipients != null) task.recipients = String(patch.recipients || '').trim();
    if (patch.subject != null) task.subject = String(patch.subject || '').trim();
    if (patch.body != null) task.body = String(patch.body || '');
    if (patch.tags != null) task.tags = parseTaskClassifications(patch.tags);
    if (patch.school != null) task.school = String(patch.school || '').trim();
    if (patch.scheduleAt != null) task.scheduleAt = String(patch.scheduleAt || '');
    if (patch.scheduleSource != null) task.scheduleSource = String(patch.scheduleSource || '');
    if (patch.scheduleReason != null) task.scheduleReason = String(patch.scheduleReason || '');
    if (patch.recipients != null || patch.subject != null || patch.body != null) refreshTaskCoreValidation(task);
    if (patch.recipients != null || patch.subject != null || patch.body != null || patch.school != null || patch.scheduleAt != null || patch.tags != null) refreshTaskSearchStatic(task);
  }

  function mappingSelectHtml(field, headers) {
    const selected = batch.mapping[field.key];
    const options = [`<option value="">— 不导入 —</option>`, ...headers.map((header, index) => `<option value="${index}" ${Number(selected) === index ? 'selected' : ''}>${escapeHtml(header || `来源字段${index + 1}`)}</option>`)].join('');
    return `<label class="nmda-map-row"><span>${escapeHtml(field.label)}</span><select data-map-field="${field.key}">${options}</select></label>`;
  }

  function setMappingEditorOpen(open) {
    if (!mappingEl || !mappingToggleEl) return;
    const isOpen = !!open;
    mappingEl.hidden = !isOpen;
    mappingToggleEl.setAttribute('aria-expanded', String(isOpen));
    mappingToggleEl.textContent = isOpen ? '收起调整' : '调整对应内容';
  }

  function configureCollection(index, useAuto = true) {
    batch.collectionIndex = Number(index) || 0;
    const collection = currentCollection();
    if (!collection) return;
    const config = ensureCollectionConfig(batch.collectionIndex, { reset: useAuto });
    batch.detection = config.detection;
    batch.mapping = config.mapping;
    const headers = batch.detection.headers || [];
    const detectedCount = Object.keys(batch.mapping || {}).length;
    const hasCore = batch.mapping.recipients != null && (batch.mapping.subject != null || batch.mapping.body != null);
    const avgConfidence = Math.round(batch.detection.avgConfidence || 0);
    const lowFields = Object.entries(batch.detection.confidence || {}).filter(([key, score]) => batch.mapping[key] != null && score < 70).map(([key]) => Importer.FIELD_DEFS.find(x => x.key === key)?.label || key);
    const kind = collectionKind(collection,config.purpose);
    const isMail=config.purpose==='mail';
    const advancedMappingCard=$('nmda-mapping-card'); if(advancedMappingCard)advancedMappingCard.hidden=!isMail||!!collection.meta?.mailFrames;
    const originWord = collection.meta?.wordTaskRows;
    const mailScan = collection.meta?.mailScan;
    const originText = collection.meta?.mailFrames
      ? `已整理邮件内容${mailScan ? `（${mailScan.records || 0} 封）` : ''}`
      : originWord ? '已整理来源内容' : '已找到可用内容';
    $('nmda-header-info').textContent = isMail
      ? `${kind.label} · 已识别 ${detectedCount} 项内容${lowFields.length ? `；建议检查：${lowFields.join('、')}` : ''}${hasCore ? '。' : '；收件人、主题或正文仍需调整。'}`
      : `${kind.label} · ${(collection.meta?.purposeReasons||[]).join('；')||'该组内容不会生成邮件任务。'}`;
    mappingEl.innerHTML = isMail?Importer.FIELD_DEFS.map(field => mappingSelectHtml(field, headers)).join(''):'';
    const format = collection.meta?.format || batch.dataset?.format || '';
    config.profileSuggestion = isMail?(Importer.suggestProfile?.({ format, headers }) || null):null;
    batch.profileSuggestion = config.profileSuggestion;
    const applyProfileBtn = $('nmda-apply-profile');
    const profileInfo = $('nmda-profile-info');
    if (applyProfileBtn) applyProfileBtn.hidden = !(config.profileSuggestion?.score >= 0.72);
    if (profileInfo) profileInfo.textContent = config.profileSuggestion?.score >= 0.72 ? `可以使用已保存设置“${config.profileSuggestion.profile.name}”。` : '';
    setMappingEditorOpen(isMail&&(!hasCore || lowFields.length > 0));
    renderCollectionList();
    renderCollectionOverview();
    renderSemanticSummary();
    mappingEl.querySelectorAll('select[data-map-field]').forEach(select => select.addEventListener('change', () => {
      const field = select.dataset.mapField;
      if (select.value === '') delete config.mapping[field]; else config.mapping[field] = Number(select.value);
      batch.mapping = config.mapping;
      batch.handoffComplete=false;
      renderSemanticSummary();
      rebuildTasks();
    }));
    rebuildTasks();
  }

  function allAttachmentFiles() {
    return uniqueFiles([...batch.directoryFiles, ...batch.taskFiles, ...batch.routedAttachmentFiles, ...batch.sharedFiles]);
  }

  function attachmentPoolFiles() {
    return uniqueFiles([...batch.directoryFiles, ...batch.taskFiles, ...batch.routedAttachmentFiles]);
  }

  function clearStaleOverrides() {
    const valid = new Set(allAttachmentFiles().map(file => Importer.fileIdentity(file)));
    for (const [key, file] of batch.attachmentOverrides) {
      if (!valid.has(Importer.fileIdentity(file))) batch.attachmentOverrides.delete(key);
    }
  }

  function refreshFileIndex(resetOverrides = false) {
    if(batch.handoffComplete) batch.handoffComplete=false;
    if (resetOverrides) batch.attachmentOverrides.clear();
    clearStaleOverrides();
    const files = allAttachmentFiles();
    batch.fileIndex = Importer.buildFileIndex(files);
    const taskCount = attachmentPoolFiles().length;
    const sharedCount = uniqueFiles(batch.sharedFiles).length;
    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const sizeText = totalBytes < 1024 * 1024 ? `${Math.round(totalBytes / 1024)} KB` : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
    $('nmda-file-index-info').textContent = files.length
      ? `已选择 ${files.length} 个文件（匹配资料 ${taskCount}，直接发送 ${sharedCount}，共 ${sizeText}）。`
      : '尚未选择本地附件。';
    rebuildTasks();
    renderAttachmentAssetViews();
    if(batch.tasks.length){
      if(batch.dataset&&!batch.importBusy)void enterSelectionAndSchedule('资料已补齐');
    }
  }

  function mergeTaskFiles(resolvedFiles) {
    return uniqueFiles([...batch.sharedFiles, ...(resolvedFiles || [])]);
  }

  function resolveAttachmentRefs(refs) {
    const resolved = Importer.resolveFiles(refs, batch.fileIndex || Importer.buildFileIndex([]));
    const files = [];
    const missing = [];
    const ambiguous = [];
    const details = [];
    for (const detail of resolved.details || []) {
      const key = Importer.normalizeFileKey(detail.ref);
      const override = batch.attachmentOverrides.get(key);
      if (override) {
        files.push(override);
        details.push({ ...detail, status: 'matched', file: override, method: 'manual' });
      } else if (detail.status === 'matched') {
        files.push(detail.file); details.push(detail);
      } else {
        details.push(detail);
        if (detail.status === 'missing') missing.push(detail.ref); else ambiguous.push(detail.ref);
      }
    }
    return { files: uniqueFiles(files), missing, ambiguous, details };
  }

  function actionableAttachmentRefs(refs) {
    const nonRequirements=/^(?:https?:\/\/|www\.|source|sources|reference|references|profile|homepage|website|link|url|来源|参考资料|导师主页|教授主页|学校主页|网页链接)$/iu;
    return (refs||[]).map(ref=>String(ref||'').trim()).filter(ref=>{
      if(!ref||nonRequirements.test(ref))return false;
      if(/^(?:https?:\/\/|www\.)/iu.test(ref)){
        const clean=ref.split(/[?#]/)[0];
        return /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)$/iu.test(clean);
      }
      return true;
    });
  }

  function emptyRosterState(overrides={}) {
    return {dataset:null,entries:[],manualEntries:[],routedEntries:[],audit:null,warnings:[],manualWarnings:[],routedWarnings:[],enabled:true,autoSchool:true,strict:false,sourceNames:[],manualSourceNames:[],routedSourceNames:[],...overrides};
  }

  function rosterState() {
    if (!batch.roster) batch.roster=emptyRosterState();
    const state=batch.roster;
    if(!Array.isArray(state.manualEntries))state.manualEntries=state.routedEntries?.length?[]:[...(state.entries||[])];
    if(!Array.isArray(state.routedEntries))state.routedEntries=[];
    if(!Array.isArray(state.manualSourceNames))state.manualSourceNames=state.routedSourceNames?.length?[]:[...(state.sourceNames||[])];
    if(!Array.isArray(state.routedSourceNames))state.routedSourceNames=[];
    if(!Array.isArray(state.manualWarnings))state.manualWarnings=state.routedWarnings?.length?[]:[...(state.warnings||[])];
    if(!Array.isArray(state.routedWarnings))state.routedWarnings=[];
    return state;
  }

  function mergeUniqueRosterEntries(entries){
    const out=[],seen=new Set();
    for(const entry of entries||[]){
      const key=[String(entry?.email||'').toLowerCase(),Roster?.normalizeName?.(entry?.name||'')||'',String(entry?.schoolKey||entry?.school||'').toLowerCase()].join('|');
      if(key!=='||'&&seen.has(key))continue;if(key!=='||')seen.add(key);out.push(entry);
    }
    return out;
  }

  function syncRosterParts(){
    const state=rosterState();
    state.entries=mergeUniqueRosterEntries([...(state.manualEntries||[]),...(state.routedEntries||[])]);
    state.sourceNames=[...new Set([...(state.manualSourceNames||[]),...(state.routedSourceNames||[])])];
    state.warnings=[...new Set([...(state.manualWarnings||[]),...(state.routedWarnings||[])])];
    state.audit=null;
    const status=$('nmda-roster-source-status');
    if(status)status.textContent=state.entries.length?`已添加 ${state.entries.length} 条参考名单${state.sourceNames.length?` · ${state.sourceNames.join('、')}`:''}`:'未添加总名单。';
    const remove=$('nmda-roster-remove');if(remove)remove.hidden=!state.entries.length;
  }

  function syncRoutedSources(){
    const sets=recordSets(),rosterSets=[],attachmentSources=new Set();
    for(let index=0;index<sets.length;index++){
      const collection=sets[index],config=ensureCollectionConfig(index);if(!collection||!config)continue;
      if(config.purpose==='roster')rosterSets.push(collection);
      if(config.purpose==='attachment')for(const source of (collection.meta?.sourceMembers?.length?collection.meta.sourceMembers:[collection.source]))attachmentSources.add(String(source||''));
    }
    const state=rosterState();
    if(Roster&&rosterSets.length){
      const parsed=Roster.parseDataset({recordSets:rosterSets,sheets:rosterSets});
      state.routedEntries=parsed.entries||[];state.routedWarnings=parsed.warnings||[];state.routedSourceNames=[...new Set(rosterSets.map(set=>String(set.source||set.name||'')).filter(Boolean))];
    }else{state.routedEntries=[];state.routedWarnings=[];state.routedSourceNames=[];}
    syncRosterParts();
    batch.routedAttachmentFiles=uniqueFiles((batch.dataset?.sourceFiles||[]).filter(file=>(attachmentSources.has(sourceFileName(file))||attachmentSources.has(String(file?.name||'')))&&!batch.ignoredAttachmentIdentities.has(Importer.fileIdentity(file))));
  }

  function applyBatchDuplicateAudit(tasks){
    for(const task of tasks||[]){task.duplicateIssues=[];task.duplicateGroupIds=[];task.batchDuplicate=false;}
    const audit=Roster?.auditTaskDuplicates?.(tasks||[])||{groups:[],summary:{tasks:(tasks||[]).length,groups:0,exact:0,probable:0,affectedTasks:0}};
    for(const group of audit.groups||[]){
      const count=group.tasks?.length||0;
      const message=group.type==='exact-email'
        ? `当前批次重复：${group.email||group.label||'同一收件人'} 有 ${count} 封邮件，需选择保留版本`
        : `当前批次疑似重复：${group.label||'同一联系人'} 有 ${count} 封邮件，需确认是否为同一联系人`;
      for(const task of group.tasks||[]){
        if(!task)continue;task.batchDuplicate=true;
        if(!task.duplicateGroupIds.includes(group.id))task.duplicateGroupIds.push(group.id);
        if(!task.duplicateIssues.some(item=>item.id===group.id))task.duplicateIssues.push({id:group.id,message,type:group.type});
      }
    }
    batch.duplicateAudit=audit;
    return audit;
  }

  function applyRosterCrossCheck(tasks) {
    const state=rosterState();
    if(!Roster || !state.enabled || !state.entries.length){state.audit=null;return null;}
    const audit=Roster.crossCheck(tasks,state.entries);
    const byKey=new Map((tasks||[]).map(t=>[t.editKey,t]));
    for(const match of audit.matches){
      const task=match.task;if(!task)continue;
      const edit=batch.taskEdits.get(task.editKey)||{};
      task.rosterMatchStatus=match.status;
      task.rosterMatchScore=Number(match.score||0);
      task.rosterMatchBy=match.by||'';
      task.rosterReference=match.entry?{...match.entry}:null;
      task.rosterEmailCandidate=match.emailCandidate||'';
      task.rosterIssues=[];
      if(match.status==='conflict'&&match.entry?.school){
        task.scheduleGroupNotice=`院校信息不一致，排程已使用总名单中的“${match.entry.school}”`;
        if(state.autoSchool){task.school=match.entry.school;task.schoolSource='roster';}
      }
      if(match.schoolSupplement && state.autoSchool && match.entry?.school && !task.school){
        task.school=match.entry.school;task.schoolSource='roster';task.rosterSchoolSupplemented=true;
      }
      if(!edit.rosterConfirmed){
        if(match.status==='ambiguous')task.rosterIssues.push('总名单中找到多条相似记录，请检查联系人');
        if(match.status==='off-roster' && state.strict)task.rosterIssues.push('当前邮件未在总套磁名单中找到对应导师');
      }
      if(match.entry){
        task.rosterMeta={country:match.entry.country||'',batch:match.entry.batch||'',status:match.entry.status||'',priority:match.entry.priority||'',priorityOrder:match.entry.priorityOrder!=null&&String(match.entry.priorityOrder).trim()!==''&&Number.isFinite(Number(match.entry.priorityOrder))?Number(match.entry.priorityOrder):null,tags:[...(match.entry.tags||[])],notes:match.entry.notes||''};
      }
    }
    for(const dup of audit.duplicateMatches||[]){
      for(const m of dup.matches||[]){
        const task=byKey.get(m.task?.editKey);if(!task)continue;
        const edit=batch.taskEdits.get(task.editKey)||{};
        task.rosterDuplicate=true;
        if(!task.batchDuplicate && !edit.rosterConfirmed && !task.rosterIssues.includes('总名单核验：同一导师对应多封当前邮件'))task.rosterIssues.push('总名单核验：同一导师对应多封当前邮件');
      }
    }
    for(const task of tasks||[]){
      if(task.rosterMatchStatus==='off-roster' && !state.strict) task.warnings=[...new Set([...(task.warnings||[]),'总名单：当前邮件未匹配到参考名单（仅提示）'])];
      if((task.rosterIssues||[]).length){task.errors=[...new Set([...(task.errors||[]),...task.rosterIssues])];task.status='error';}
    }
    state.audit=audit;
    return audit;
  }

  function rosterEntryLabel(entry){
    if(!entry)return '未知记录';
    return [entry.name,entry.school,entry.email].filter(Boolean).join(' · ')||`第 ${entry.sourceRow||'?'} 行`;
  }

  function contactHistoryAudit(tasks){
    if(!Contacts||!contactBook.loaded)return {loaded:false,rows:[],affectedTasks:0,sentTasks:0,draftTasks:0};
    const rows=[];const affected=new Set(),sentTasks=new Set(),draftTasks=new Set();
    for(const task of tasks||[]){
      const taskKey=String(task?.editKey||task?.id||'');
      for(const recipient of Contacts.parseRecipients(task?.recipients||'')){
        const contact=contactBook.contacts?.[recipient.email];if(!contact)continue;
        const sentCount=Number(contact.sentCount||0),draftCount=Number(contact.draftCount||0);
        if(!sentCount&&!draftCount)continue;
        affected.add(taskKey);if(sentCount)sentTasks.add(taskKey);if(draftCount)draftTasks.add(taskKey);
        rows.push({task,email:recipient.email,sentCount,draftCount,lastSentAt:contact.lastSentAt||'',lastDraftAt:contact.lastDraftAt||'',lastSubject:contact.lastSubject||'',lastDraftSubject:contact.lastDraftSubject||''});
      }
    }
    return {loaded:true,rows,affectedTasks:affected.size,sentTasks:sentTasks.size,draftTasks:draftTasks.size};
  }

  function renderRosterAudit(){
    const state=rosterState(),card=$('nmda-roster-audit-card'),summary=$('nmda-roster-audit-summary'),note=$('nmda-roster-audit-note'),details=$('nmda-roster-audit-details');
    const enabledEl=$('nmda-roster-enabled'),schoolEl=$('nmda-roster-auto-school'),strictEl=$('nmda-roster-strict');
    if(enabledEl)enabledEl.checked=state.enabled!==false;if(schoolEl)schoolEl.checked=state.autoSchool!==false;if(strictEl)strictEl.checked=!!state.strict;
    if(!card)return;
    const tasks=batch.tasks||[];
    card.hidden=!tasks.length&&!state.entries.length;
    if(card.hidden)return;

    const duplicateAudit=batch.duplicateAudit || Roster?.auditTaskDuplicates?.(tasks) || {groups:[],summary:{tasks:tasks.length,groups:0,exact:0,probable:0,affectedTasks:0}};
    const history=contactHistoryAudit(tasks);
    const rosterAudit=state.entries.length ? (state.audit || (Roster&&tasks.length?Roster.crossCheck(tasks,state.entries):null)) : null;
    const dx=duplicateAudit.summary||{};
    const metrics=[];
    if(tasks.length)metrics.push(`<div class="nmda-import-metric"><strong>${tasks.length}</strong><span>当前邮件</span></div>`);
    metrics.push(`<div class="nmda-import-metric ${dx.groups?'is-warn':''}"><strong>${dx.groups||0}</strong><span>批次重复</span></div>`);
    if(history.loaded&&history.affectedTasks)metrics.push(`<div class="nmda-import-metric"><strong>${history.affectedTasks}</strong><span>已有记录</span></div>`);
    if(state.entries.length)metrics.push(`<div class="nmda-import-metric"><strong>${state.entries.length}</strong><span>参考名单</span></div>`);
    if(rosterAudit){
      const x=rosterAudit.summary||{};
      metrics.push(`<div class="nmda-import-metric"><strong>${x.matched||0}</strong><span>名单匹配</span></div>`);
      if(x.unwritten)metrics.push(`<div class="nmda-import-metric"><strong>${x.unwritten}</strong><span>尚未加入</span></div>`);
      if(x.ambiguous||x.duplicates)metrics.push(`<div class="nmda-import-metric is-warn"><strong>${(x.ambiguous||0)+(x.duplicates||0)}</strong><span>名单待核对</span></div>`);
    }
    if(summary)summary.innerHTML=metrics.join('');

    if(note){
      const parts=[];
      if(dx.groups)parts.push(`发现 <strong>${dx.groups}</strong> 组当前批次重复，请在“检查邮件”中选择保留版本；需要多封时可明确“全部保留”`);
      else if(tasks.length)parts.push('当前批次未发现重复联系人；无需总名单也会自动完成这一步');
      if(history.loaded&&history.affectedTasks)parts.push(`<strong>${history.affectedTasks}</strong> 封对应联系人已有邮箱发送或草稿记录，仅作提醒`);
      if(rosterAudit){
        const x=rosterAudit.summary||{};
        const rosterParts=[];
        if(x.schoolSupplements)rosterParts.push(`补充 ${x.schoolSupplements} 条院校信息`);
        if(x.emailCandidates)rosterParts.push(`找到 ${x.emailCandidates} 个缺失邮箱候选`);
        if(x.unwritten)rosterParts.push(`${x.unwritten} 位名单联系人尚未加入本批次`);
        parts.push(`参考总名单${rosterParts.length?`额外${rosterParts.join('、')}`:'已完成交叉核对'}`);
      }else if(state.entries.length&&!tasks.length)parts.push('参考总名单已就绪；加入邮件后会自动进行交叉核对');
      note.innerHTML=parts.length?`${parts.join('；')}。`:'核验将在加入邮件后自动开始。';
    }

    if(details){
      const section=(title,items,render,more=0)=>`<div class="nmda-roster-diff-section"><strong>${escapeHtml(title)}</strong>${items.length?`<div>${items.map(render).join('')}</div>`:'<small>无</small>'}${more>items.length?`<small>另有 ${more-items.length} 条未展开</small>`:''}</div>`;
      let html='';
      const duplicateGroups=(duplicateAudit.groups||[]).slice(0,12);
      html+=section('当前批次查重',duplicateGroups,g=>{
        const ids=(g.tasks||[]).map(task=>task.id||task.recipients||'邮件').slice(0,4).join('、');
        const kind=g.type==='exact-email'?'同一邮箱':'同名同院校';
        return `<span>${escapeHtml(g.label||g.email||'联系人')} · ${escapeHtml(kind)} · ${g.tasks?.length||0} 封${ids?` · ${escapeHtml(ids)}`:''}</span>`;
      },duplicateAudit.groups?.length||0);
      if(history.loaded){
        const historyRows=history.rows.slice(0,12);
        html+=section('邮箱历史（提示）',historyRows,row=>{
          const fact=[row.sentCount?`已发送 ${row.sentCount}`:'',row.draftCount?`已有草稿 ${row.draftCount}`:''].filter(Boolean).join(' · ');
          const subject=row.lastDraftSubject||row.lastSubject||'';
          return `<span>${escapeHtml(row.email)} · ${escapeHtml(fact)}${subject?` · ${escapeHtml(subject)}`:''}</span>`;
        },history.rows.length);
      }
      if(rosterAudit){
        const off=(rosterAudit.matches||[]).filter(m=>m.status==='off-roster').slice(0,12);
        const ambiguities=(rosterAudit.matches||[]).filter(m=>m.status==='ambiguous').slice(0,12);
        const scheduleDiffs=(rosterAudit.matches||[]).filter(m=>m.status==='conflict').slice(0,12);
        const unwritten=(rosterAudit.unwritten||[]).slice(0,12);
        const rosterDups=(rosterAudit.duplicateMatches||[]).slice(0,8);
        html+=section('尚未加入本批次',unwritten,e=>`<span>${escapeHtml(rosterEntryLabel(e))}${e.batch?` · ${escapeHtml(e.batch)}`:''}</span>`,rosterAudit.unwritten?.length||0);
        html+=section('不在参考名单',off,m=>`<span>${escapeHtml(m.task?.id||m.task?.recipients||'邮件')} · ${escapeHtml(m.task?.recipients||'')}</span>`,(rosterAudit.matches||[]).filter(m=>m.status==='off-roster').length);
        html+=section('名单匹配待核对',ambiguities,m=>`<span>${escapeHtml(m.task?.id||'邮件')} → 多个参考名单候选</span>`,(rosterAudit.matches||[]).filter(m=>m.status==='ambiguous').length);
        html+=section('排程参考（不影响邮件）',scheduleDiffs,m=>`<span>${escapeHtml(m.task?.id||'邮件')} → ${escapeHtml(rosterEntryLabel(m.entry))}</span>`,(rosterAudit.matches||[]).filter(m=>m.status==='conflict').length);
        html+=section('名单映射重复',rosterDups,d=>`<span>${escapeHtml(rosterEntryLabel(d.entry))} · ${d.matches?.length||0} 封邮件</span>`,rosterAudit.duplicateMatches?.length||0);
      }
      details.innerHTML=html;
    }
  }

  async function loadRosterFiles(files){
    const list=[...(files||[])].filter(Boolean);if(!list.length||!Importer||!Roster)return;
    const token=batch.sessionId;const status=$('nmda-roster-source-status');
    if(status)status.textContent=`正在读取总套磁名单（${list.length} 个文件）…`;
    try{
      const dataset=list.length===1?await Importer.parseFile(list[0]):await Importer.parseFiles(list,{ignoreUnsupported:true});
      if(!isCurrentBatchSession(token))return;
      const parsed=Roster.parseDataset(dataset);
      if(!parsed.entries.length)throw new Error('总名单中没有找到可用导师信息。请至少提供姓名、邮箱或学校中的一项。');
      for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
      batch.handoffComplete=false;
      const state=rosterState();state.dataset=dataset;state.manualEntries=parsed.entries;state.manualWarnings=parsed.warnings||[];state.manualSourceNames=list.map(f=>f.name);syncRosterParts();
      batch.rosterPromptChoice='added';
      if(status)status.textContent=`已添加 ${state.entries.length} 条参考名单${parsed.stats.invalidEmails?` · ${parsed.stats.invalidEmails} 条邮箱待检查`:''}${parsed.stats.duplicates?` · ${parsed.stats.duplicates} 条重复`:''}`;
      if(batch.dataset)rebuildTasks();else renderRosterAudit();
      renderImportLifecycleState();
      renderSupplementPreflight();
      if(batch.dataset&&batch.supplementPreflightDone)setTimeout(()=>void enterSelectionAndSchedule('参考总名单已加入'),0);
    }catch(error){console.error(`[${APP}] roster`,error);if(status)status.textContent=`总名单读取失败：${error.message}`;}
    finally{if(rosterFileEl)rosterFileEl.value='';}
  }

  function removeRoster(){
    batch.handoffComplete=false;
    for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
    for(const config of batch.collectionConfigs.values())if(config.purpose==='roster'){config.purpose='ignored';config.enabled=false;}
    batch.roster=emptyRosterState();
    batch.rosterPromptChoice=batch.dataset&&batch.tasks?.length?'pending':'idle';
    const status=$('nmda-roster-source-status');if(status)status.textContent='未添加参考总名单。';
    const remove=$('nmda-roster-remove');if(remove)remove.hidden=true;
    if(batch.dataset){rebuildTasks();renderSourceInventory();renderCollectionList();}else renderRosterAudit();
    renderImportLifecycleState();
  }

  function mergedRowSourcePurpose(sourceFile) {
    const source=sourceIdentityKey(sourceFile),leaf=String(source).split('/').pop();
    const candidates=recordSets().map((collection,index)=>({collection,index})).filter(({collection})=>collection.meta?.taskShadow&&collectionDirectMatchesSource(collection,source,leaf));
    if(!candidates.length)return'mail';
    const config=ensureCollectionConfig(candidates[0].index);
    return config?.enabled===false?'ignored':String(config?.purpose||'ignored');
  }

  function rebuildTasks() {
    if (!batch.dataset) { batch.tasks = []; scheduleBatchRender({aux:true}); return; }
    const tasks = [];
    const sets = recordSets();
    for (let collectionIndex = 0; collectionIndex < sets.length; collectionIndex++) {
      const collection = sets[collectionIndex];
      const config = ensureCollectionConfig(collectionIndex);
      if (!collection || !config || config.purpose !== 'mail' || config.enabled === false || collection.meta?.taskShadow) continue;
      const detection = config.detection;
      const mapping = config.mapping || {};
      const start = detection.index + 1;
      const getValue = (row, field) => { const col = mapping[field]; return col == null ? '' : (row?.[col] ?? ''); };
      for (let rowIndex = start; rowIndex < collection.rows.length; rowIndex++) {
        const row = collection.rows[rowIndex] || [];
        const editKey = taskEditKey(collectionIndex, rowIndex);
        const edit = batch.taskEdits.get(editKey) || {};
        if (edit.importExcluded === true) continue;
        const rowMeta = collection.meta?.rowMeta?.[rowIndex] || null;
        const rowSourceFile=String(rowMeta?.sourceFile||(collection.meta?.wordTaskRows?row?.[8]:'')||collection.source||'').trim();
        if(collection.meta?.merged&&rowSourceFile&&mergedRowSourcePurpose(rowSourceFile)!=='mail')continue;
        const sourceRecipients = String(getValue(row, 'recipients') ?? '').trim();
        const sourceSchoolRaw = String(getValue(row, 'school') ?? rowMeta?.school ?? '').trim();
        const sourceSubject = String(getValue(row, 'subject') ?? '').trim();
        const sourceBodyRaw = String(getValue(row, 'body') ?? '');
        const sourceBody = collection.meta?.mailFrames&&MailRecognizer?.sanitizeRecognizedBody
          ? MailRecognizer.sanitizeRecognizedBody(sourceBodyRaw).text
          : sourceBodyRaw;
        const sourceAttachmentRaw = getValue(row, 'attachments');
        const sourceScheduleRaw = getValue(row, 'scheduleAt');
        const sourceTags = getValue(row, 'tags');
        const recipients = String(edit.recipients != null ? edit.recipients : sourceRecipients).trim();
        const schoolSource=edit.school!=null?'manual':(sourceSchoolRaw?(collection.meta?.mailFrames?'recognized':'imported'):'');
        const schoolRaw=String(edit.school != null ? edit.school : sourceSchoolRaw).trim();
        const schoolEvidence=Scheduler?.institutionEvidence?.(schoolRaw,recipients,schoolSource)||{valid:!!schoolRaw&&!/^[A-Z0-9]$/i.test(schoolRaw),value:schoolRaw};
        const school=schoolEvidence.valid?String(schoolEvidence.value||schoolRaw).trim():'';
        const subject = String(edit.subject != null ? edit.subject : sourceSubject).trim();
        const body = String(edit.body != null ? edit.body : sourceBody);
        const attachmentRaw = edit.attachments != null ? edit.attachments : sourceAttachmentRaw;
        const rawAttachmentRefs = Importer.splitAttachments(attachmentRaw);
        const attachmentRefs = actionableAttachmentRefs(rawAttachmentRefs);
        const scheduleRaw = edit.scheduleAt != null ? edit.scheduleAt : sourceScheduleRaw;
        const scheduleSource = String(edit.scheduleSource || (String(sourceScheduleRaw ?? '').trim() ? 'imported' : '')).trim();
        const importedTags = parseTaskClassifications(edit.tags != null ? edit.tags : sourceTags);
        const id = String(edit.id != null ? edit.id : getValue(row, 'id') ?? '').trim() || `${collectionIndex + 1}-${rowIndex + 1}`;
        const meaningful = [recipients, subject, body, ...attachmentRefs, String(scheduleRaw ?? ''), ...importedTags].some(v => String(v).trim());
        if (!meaningful) continue;

        const errors = [], warnings = [];
        const importIssues = [...new Set(rowMeta?.issues || [])];
        const importConfidence = Number(rowMeta?.confidence || 0);
        if (!recipients) errors.push('缺少收件人');
        else if (!recipientLooksValid(recipients)) errors.push('收件人邮箱格式无效');
        if (!subject) errors.push('缺少主题');
        if (!String(body||'').trim()) errors.push('缺少正文');
        if (collection.meta?.mailFrames && importConfidence && importConfidence < 70) warnings.push('请检查邮件内容');
        for (const issue of importIssues) {
          if (/未定位收件人/.test(issue) && recipients) continue;
          if (/主题为空/.test(issue) && subject) continue;
          if (/正文过短/.test(issue) && body.length >= 40) continue;
          if (!errors.includes(issue) && !warnings.includes(issue)) warnings.push(issue);
        }
        let scheduleAt = '';
        if (String(scheduleRaw ?? '').trim()) {
          const parsed = Importer.parseDateValue(scheduleRaw);
          if (!parsed) warnings.push(`原定时时间无法识别：${scheduleRaw}；请在自动安排时间中重新选择`);
          else {
            scheduleAt = Importer.formatLocalDateTime(parsed);
            if (parsed.getTime() <= Date.now() + 60 * 1000) warnings.push('定时时间已过，建议手工修改或使用智能排程覆盖');
          }
        }

        const resolved = resolveAttachmentRefs(attachmentRefs);
        if (resolved.missing.length) errors.push(`缺少附件：${resolved.missing.join('、')}`);
        if (resolved.ambiguous.length) errors.push(`附件同名冲突：${resolved.ambiguous.join('、')}`);
        for (const detail of resolved.details) {
          if (detail.status === 'matched' && detail.method === 'relaxed-copy-suffix') warnings.push(`附件按下载副本名匹配：${detail.ref} → ${detail.file.name}`);
        }

        const gate = contactPolicyGateForRecipients(recipients);
        if (gate.policies.includes('不再联系')) errors.push(`联系策略：不再联系（${gate.reasons.join('、')}）`);
        else if (gate.policies.includes('暂停')) warnings.push(`联系策略：暂停（${gate.reasons.join('、')}）`);

        const policyBlocked = gate.blocked;
        const mergedFiles = mergeTaskFiles(resolved.files);
        const staticSearch = normalizedSearchText([
          id, rowIndex + 1, recipients, school, subject, body,
          mergedFiles.map(file => file.name).join(' '),
          scheduleAt ? scheduleAt.replace('T', ' ') : '',
          importedTags.join(' ')
        ].join(' '));
        tasks.push({
          id, rowIndex, collectionIndex, collectionName: collection.name || `内容 ${collectionIndex + 1}`, sourceFile: rowSourceFile,
          editKey, sourceRow: rowIndex + 1, recipients, school, schoolSource:school?schoolSource:'', ignoredSchool:schoolRaw&&!school?schoolRaw:'', subject, body, attachmentRefs, ignoredAttachmentRefs:rawAttachmentRefs.filter(ref=>!attachmentRefs.includes(ref)),
          tags: importedTags,
          enabled: policyBlocked ? false : edit.enabled !== false,
          policyBlocked, policyReasons: gate.reasons,
          files: mergedFiles, tableFiles: resolved.files, attachmentDetails: resolved.details,
          scheduleAt, scheduleSource, scheduleReason:String(edit.scheduleReason||''), errors:[...new Set(errors)], warnings:[...new Set(warnings)], status: errors.length ? 'error' : 'ready', runtimeError: '', note: '',
          importConfidence, importEvidence:[...(rowMeta?.evidence || [])], importIssues, importHeading:rowMeta?.heading || '', importRecipientEvidence:rowMeta?.recipientEvidence || null,
          reviewConfirmed: !!edit.reviewConfirmed, reviewDraftPending: !!edit.reviewDraftPending, rosterConfirmed: !!edit.rosterConfirmed,
          duplicateConfirmedGroups:Array.isArray(edit.duplicateConfirmedGroups)?[...edit.duplicateConfirmedGroups]:[], duplicateIssues:[], duplicateGroupIds:[], importExcluded:false,
          manuallyEdited: ['recipients','school','subject','body','attachments','scheduleAt','tags'].some(key=>edit[key]!=null), _searchStatic: staticSearch
        });
      }
    }
    applyBatchDuplicateAudit(tasks);
    applyRosterCrossCheck(tasks);
    batch.tasks = tasks;
    scheduleBatchRender({aux:true});
  }

  function statusLabel(task) {
    if (task.policyBlocked && task.status !== 'running' && task.status !== 'done') { const policies=task.policyReasons||[]; const label=(task.policyReasons||[]).some(x=>String(x).includes('不再联系'))?'已停止联系':'已暂停联系'; return `${label}：${policies.join('、')}`; }
    if (!task.enabled && task.status !== 'running' && task.status !== 'done') return '未选择';
    if (task.status === 'done') return '已完成';
    if (task.status === 'running') return '处理中';
    if(task.runtimeError)return `失败：${task.runtimeError}`;
    const state=taskIssueState(task);
    if(state.content.length){
      const labels=[];
      if(state.content.some(x=>/收件人|邮箱/.test(x)))labels.push('收件人');
      if(state.content.some(x=>/主题/.test(x)))labels.push('主题');
      if(state.content.some(x=>/正文/.test(x)))labels.push('正文');
      return `待补内容：${[...new Set(labels)].join('、')}`;
    }
    if(state.review.length)return `需要核对：${state.review[0].replace('修改待确认','修改内容')}`;
    if(state.attachment.length)return `待添加附件：${state.attachment[0].replace(/^缺少附件：|^附件同名冲突：/,'')}`;
    if(state.schedule.length)return '待调整时间';
    if(state.other.length)return `暂不可创建：${state.other[0]}`;
    if (task.status === 'error') return '暂不可创建';
    if (task.warnings.length) return `可创建（${task.warnings.join('；')}）`;
    return '可创建';
  }


  function renderTagChips() {
    const box = $('nmda-batch-tag-chips');
    if (!box || !Contacts) return;
    const counts = new Map();
    for (const task of batch.tasks || []) {
      for (const tag of taskBusinessTags(task)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
    box.innerHTML = tags.length ? tags.slice(0, 50).map(([tag, count]) => `<button type="button" class="nmda-tag-chip" data-tag-chip="${escapeHtml(tag)}">${escapeHtml(tag)} <small>${count}</small></button>`).join('') : '<span class="nmda-hint">当前任务没有业务标记。联系状态和联系策略不会混入标记。</span>';
    box.querySelectorAll('[data-tag-chip]').forEach(button => button.addEventListener('click', () => {
      const tagsNow = Contacts.parseTags(batchTagIncludeEl.value);
      const clicked = button.dataset.tagChip;
      const key = clicked.toLocaleLowerCase('zh-CN');
      const exists = tagsNow.some(tag => tag.toLocaleLowerCase('zh-CN') === key);
      batchTagIncludeEl.value = exists ? tagsNow.filter(tag => tag.toLocaleLowerCase('zh-CN') !== key).join(';') : Contacts.mergeTags(tagsNow, [clicked]).join(';');
      scheduleBatchRender({aux:false});
    }));
  }

  function importAttachmentStats() {
    const byRef=new Map();
    for(const task of batch.tasks||[]){
      for(const detail of (task.attachmentDetails||[])){
        const key=Importer.normalizeFileKey(detail.ref);
        if(!byRef.has(key))byRef.set(key,detail);
        else if(detail.status==='matched')byRef.set(key,detail);
      }
    }
    let matched=0,issues=0;
    for(const [key,detail] of byRef){
      if(batch.attachmentOverrides.get(key)||detail.status==='matched')matched++;else issues++;
    }
    return {total:byRef.size,matched,issues,shared:uniqueFiles(batch.sharedFiles).length};
  }

  function renderImportHandoff() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const card = $('nmda-import-handoff-card');
    const summary = $('nmda-import-ready-summary');
    const button = $('nmda-go-batch');
    const hint=$('nmda-handoff-hint');
    const hasDataset = !!batch.dataset;
    if (!card || !summary || !button) return;
    if (!hasDataset) { card.hidden=true; return; }
    const tasks = batch.tasks || [];
    const states=tasks.map(task=>[task,taskIssueState(task)]);
    const blockerTasks=states.filter(([task])=>taskHasBlockingIssue(task));
    const blocked=blockerTasks.length>0;
    const contextPending=supplementPreflightNeedsDecision();
    const ready=states.filter(([task])=>!taskHasBlockingIssue(task)&&!task.policyBlocked).length;
    const excluded=excludedImportCount();
    card.hidden = contextPending || blocked || !tasks.length;
    if(card.hidden)return;
    const metrics=[`<div class="nmda-import-metric"><strong>${tasks.length}</strong><span>邮件</span></div>`,`<div class="nmda-import-metric"><strong>${ready}</strong><span>可继续</span></div>`];
    if(excluded)metrics.push(`<div class="nmda-import-metric"><strong>${excluded}</strong><span>已排除</span></div>`);
    summary.innerHTML=metrics.join('');
    button.textContent = batch.handoffComplete ? '查看选择与安排' : '进入选择与安排';
    button.disabled = !tasks.length;
    if(hint)hint.textContent=batch.handoffComplete?'当前批次已进入选择与安排。':'全部待办已完成，可以继续。';
  }


  function scheduleSourceLabel(task) {
    const source=String(task?.scheduleSource||'');
    if(source==='auto')return '自动安排';
    if(source==='manual'||source==='manual-clear')return '手工调整';
    if(source==='imported')return '导入时间';
    return task?.scheduleAt?'已有时间':'未定时';
  }

  function renderScheduleCenter() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const card=$('nmda-scheduler-card'); if(!card)return;
    const tasks=batch.tasks||[], hasTasks=batch.handoffComplete&&tasks.length>0;
    card.hidden=!hasTasks; if(!hasTasks)return;
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent=card.open?'收起':'展开';
    if(!Scheduler){if(scheduleRulePreviewEl)scheduleRulePreviewEl.textContent='自动安排暂不可用。';if(scheduleApplyEl)scheduleApplyEl.disabled=true;return;}
    syncScheduleRuleControls();
    const selected=tasks.filter(t=>t.enabled&&t.status==='ready');
    const groups=new Map(); let fallback=0, auto=0, protectedCount=0, unscheduled=0;
    for(const task of selected){
      const group=Scheduler.groupForTask(task); groups.set(group.key,group);
      if(group.source==='domain'||group.source==='unknown')fallback++;
      if(task.scheduleSource==='auto'&&task.scheduleAt)auto++;
      else if(task.scheduleAt)protectedCount++;
      else unscheduled++;
    }
    const rules=batch.scheduleRules||freshScheduleRules();
    const audit=Scheduler.audit?.(selected,rules)||{conflicts:[],holidayConflicts:[]};
    const conflictCount=audit.conflicts?.length||0, holidayConflictCount=audit.holidayConflicts?.length||0;
    if(scheduleSummaryEl)scheduleSummaryEl.innerHTML=`<strong>${selected.length}</strong> 已选 · 自动 ${auto} · 已有 ${protectedCount} · 待排 ${unscheduled}${conflictCount?` · <span class="nmda-danger">同校冲突 ${conflictCount}</span>`:''}${holidayConflictCount?` · <span class="nmda-danger">休息日 ${holidayConflictCount}</span>`:''}`;
    if(scheduleRulePreviewEl){
      const conflictText=conflictCount?` · ${conflictCount} 个同校时间冲突`:'';const holidayText=holidayConflictCount?` · ${holidayConflictCount} 个已有时间落在休息日`:'';
      scheduleRulePreviewEl.textContent=`当前规则：每所院校每轮最多 ${rules.maxPerGroupPerRound||1} 位 · 间隔 ${rules.intervalDays||7} 天${rules.skipHolidays!==false?' · 跳过节假日/周末':''}${conflictText}${holidayText}`;
    }
    const scheduleContextCopy=$('nmda-schedule-context-copy');
    if(scheduleContextCopy){
      const rosterCount=referenceRosterCount();
      const schoolKnown=selected.filter(task=>String(task.school||'').trim()).length;
      const priorityKnown=selected.filter(task=>Scheduler.priorityForTask?.(task)?.has).length;
      const contextText=rosterCount?`已加入 ${rosterCount} 条参考名单；${schoolKnown} 封已有院校信息${priorityKnown?`，其中 ${priorityKnown} 封有明确顺序`:''}。`:`${schoolKnown} / ${selected.length} 封已有院校信息。`;
      scheduleContextCopy.textContent=`${contextText} 设置开始时间与同校间隔后应用。`;
    }
    if(scheduleApplyEl){scheduleApplyEl.disabled=batch.running||!selected.length;scheduleApplyEl.textContent=auto||unscheduled?'应用安排':'重新安排';}
    if(scheduleClearEl)scheduleClearEl.disabled=batch.running||!tasks.some(t=>t.scheduleSource==='auto'&&t.scheduleAt);
  }

  function applySmartSchedule() {
    if(!Scheduler){setBatchStatus('自动安排暂不可用。','error');return;}
    try{
      const rules=readScheduleRuleControls();
      const plan=Scheduler.buildPlan(batch.tasks||[],rules,new Date());
      for(const assignment of plan.assignments){
        const prev=batch.taskEdits.get(assignment.editKey)||{};
        batch.taskEdits.set(assignment.editKey,{...prev,scheduleAt:assignment.scheduleAt,scheduleSource:'auto',scheduleReason:assignment.reason});
      }
      batch.schedulePlan=plan;
      rebuildTasks();
      if(window.matchMedia('(max-width: 900px)').matches)setPlanningView('mails');
      const s=plan.summary, audit=Scheduler.audit?.(batch.tasks||[],rules)||{conflicts:[],holidayConflicts:[]};
      const fallbackCount=Number(s.fallbackTasks||s.fallbackGroups||0);
      const fallback='';
      const priority=s.priorityOrderedGroups?`；${s.priorityOrderedGroups} 所院校已按总名单顺序排列`:'';
      const holiday=s.holidayAdjusted?`；${s.holidayAdjusted} 封为避开节假日/周末自动顺延`:'';
      const unsupported='';
      const conflicts=(audit.conflicts?.length||0)+(audit.holidayConflicts?.length||0);
      const conflict=audit.conflicts?.length?`；保留的已有时间仍有 ${audit.conflicts.length} 个同校规则冲突，请手工调整或关闭“保留已有时间”后重排`:'';
      const holidayConflict=audit.holidayConflicts?.length?`；${audit.holidayConflicts.length} 个保留时间仍落在节假日/周末`:'';
      setBatchStatus(`时间已安排：${s.selected} 封邮件，自动安排 ${s.auto} 封，保留已有 ${s.preserved} 封，共 ${s.rounds} 轮${priority}${holiday}${fallback}${unsupported}${conflict}${holidayConflict}。`,conflicts?'warn':'ok');
    }catch(error){setBatchStatus(`安排时间失败：${error.message}`,'error');}
  }

  function clearAutoSchedule() {
    let cleared=0;
    for(const task of batch.tasks||[]){
      if(task.scheduleSource!=='auto')continue;
      const prev={...(batch.taskEdits.get(task.editKey)||{})};
      delete prev.scheduleAt; delete prev.scheduleSource; delete prev.scheduleReason;
      batch.taskEdits.set(task.editKey,prev); cleared++;
    }
    batch.schedulePlan=null;
    rebuildTasks();
    setBatchStatus(cleared?`已清除 ${cleared} 封任务的自动排程；导入或手工时间保持不变。`:'当前没有自动排程需要清除。',cleared?'ok':'warn');
  }

  function batchSummarySnapshot(tasks = batch.tasks || []) {
    const snapshot={errors:0,done:0,selectedReady:0,selectedScheduled:0,selectedTotal:0,unselected:0};
    for(const task of tasks){
      if(task.status==='error')snapshot.errors++;
      if(task.status==='done')snapshot.done++;
      if(task.enabled && task.status!=='done')snapshot.selectedTotal++;
      if(!task.enabled)snapshot.unselected++;
      if(task.enabled && task.status==='ready'){
        snapshot.selectedReady++;
        if(task.scheduleAt)snapshot.selectedScheduled++;
      }
    }
    return snapshot;
  }

  function renderBatchSummaryControls(tasks = batch.tasks || [], snapshot = batchSummarySnapshot(tasks)) {
    const summaryParts=[`共 <strong>${tasks.length}</strong> 封`,`本次 <strong>${snapshot.selectedTotal}</strong>`,`可创建 <strong>${snapshot.selectedReady}</strong>`];
    if(snapshot.selectedScheduled)summaryParts.push(`定时 ${snapshot.selectedScheduled}`);
    if(snapshot.errors)summaryParts.push(`<span class="nmda-danger">异常 ${snapshot.errors}</span>`);
    if(snapshot.done)summaryParts.push(`已完成 ${snapshot.done}`);
    batchSummaryEl.innerHTML=summaryParts.join(' · ');
    if(batchStartEl)batchStartEl.textContent=snapshot.selectedReady?`创建 ${snapshot.selectedReady} 封草稿`:'创建所选草稿';
    batchStartEl.disabled=batch.running||!batch.handoffComplete||!snapshot.selectedReady;
    const preflight=$('nmda-create-preflight');
    if(preflight){
      const selected=(tasks||[]).filter(task=>task.enabled&&task.status==='ready');
      const fileCount=selected.reduce((sum,task)=>sum+(task.files?.length||0),0);
      const excluded=typeof excludedImportCount==='function'?excludedImportCount():0;
      const facts=[`本次 ${snapshot.selectedReady} 封`,snapshot.selectedScheduled?`定时 ${snapshot.selectedScheduled} 封`:'普通草稿',fileCount?`附件 ${fileCount} 份`:'无附件',excluded?`已排除 ${excluded} 封`:''].filter(Boolean);
      preflight.innerHTML=`<span>${facts.map(item=>`<em>${escapeHtml(item)}</em>`).join('')}</span>${fileCount?'<button class="nmda-text-action" type="button" data-open-attachment-manager>查看附件</button>':''}`;
    }
    return snapshot;
  }

  function refreshTaskSearchStatic(task){
    if(!task)return;
    task._searchStatic=normalizedSearchText([
      task.id,task.sourceRow,task.recipients,task.school,task.subject,task.body,
      task.files?.map(file=>file.name).join(' ')||'',
      task.scheduleAt?task.scheduleAt.replace('T',' '):'',
      parseTaskClassifications(task.tags||[]).join(' ')
    ].join(' '));
  }

  function renderPreview({ aux = true } = {}) {
    const tasks=batch.tasks||[];
    const matched=filteredBatchTasks();
    const snapshot=renderBatchSummaryControls(tasks);
    previewBodyEl.innerHTML=matched.slice(0,150).map(task=>{
      const contactState=taskContactSnapshot(task).state;
      const sourceLabel=scheduleSourceLabel(task);
      const scheduleHtml=`<div class="nmda-schedule-edit-cell"><input type="datetime-local" data-task-schedule="${escapeHtml(task.editKey)}" value="${escapeHtml(task.scheduleAt||'')}" ${batch.running?'disabled':''}><small>${escapeHtml(sourceLabel)}</small></div>`;
      const statusText=statusLabel(task);
      const fileText=task.files?.length?` · 附件 ${task.files.length}`:'';
      return `<tr data-task-row="${escapeHtml(task.editKey)}" data-status="${task.status}" data-enabled="${task.enabled?'1':'0'}">
        <td><input type="checkbox" data-task-enabled="${escapeHtml(task.editKey)}" ${task.enabled?'checked':''} ${batch.running||task.policyBlocked||task.status==='running'||task.status==='done'?'disabled':''} title="${escapeHtml(task.policyBlocked?statusLabel(task):'')}"></td>
        <td class="nmda-recipient-cell" title="${escapeHtml(task.recipients)}"><strong>${escapeHtml(task.recipients||'—')}</strong><small>${escapeHtml(contactState.stage||'')}</small></td>
        <td class="nmda-subject-cell" title="${escapeHtml(task.subject)}">${escapeHtml(task.subject||'—')}</td>
        <td>${scheduleHtml}</td>
        <td class="nmda-task-state-cell" title="${escapeHtml(statusText)}">${escapeHtml(statusText)}${fileText}</td>
      </tr>`;
    }).join('');
    if(!matched.length)previewBodyEl.innerHTML='<tr><td colspan="5">没有匹配的邮件。调整搜索条件后再试。</td></tr>';
    else if(matched.length>150)previewBodyEl.insertAdjacentHTML('beforeend',`<tr><td colspan="5">当前只显示前 150 封，共 ${matched.length} 封。</td></tr>`);

    const hasTasks=batch.handoffComplete&&tasks.length>0;
    const emptyCard=$('nmda-batch-empty');
    if(emptyCard){
      const kicker=emptyCard.querySelector('.nmda-card-kicker'),title=emptyCard.querySelector('.nmda-card-title'),desc=emptyCard.querySelector('.nmda-card-desc'),action=$('nmda-go-import');
      if(tasks.length&&!batch.handoffComplete){
        if(kicker)kicker.textContent='待交接';if(title)title.textContent=`已准备 ${tasks.length} 封邮件，尚未进入排程`;
        if(desc)desc.textContent='回到上方准备区，处理必要问题后继续。';if(action)action.textContent='回到准备区';
      }else{
        if(kicker)kicker.textContent='批量任务';if(title)title.textContent='还没有准备好的批量任务';
        if(desc)desc.textContent='先在上方添加资料。';if(action)action.textContent='回到准备区';
      }
    }
    $('nmda-preview-card').hidden=!hasTasks;
    $('nmda-scheduler-card').hidden=!hasTasks;
    $('nmda-run-card').hidden=!hasTasks;
    $('nmda-batch-empty').hidden=true;
    const executeStage=$('nmda-stage-execute');if(executeStage)executeStage.hidden=!hasTasks;

    // Selection and filtering need only the table, summary, schedule and step rail.
    // Attachment resolution / roster / parsing work is recomputed only after structural changes.
    renderScheduleCenter();
    setPlanningView(batch.planningView||'rules');
    if(aux){
      renderTagChips();
      renderAttachmentCenter();
      renderImportTaskPreview();
      renderRosterAudit();
      renderImportHandoff();
      renderReviewPageOverview();
      viewPerf.batchAuxDirty=false;
    }
    viewPerf.batchDirty=false;
    return {matched:matched.length,...snapshot};
  }

  function renderAttachmentCenter() {
    const allRefs = [];
    for (const task of batch.tasks || []) allRefs.push(...(task.attachmentRefs || []));
    const uniqueRefs = [...new Map(allRefs.map(ref => [Importer.normalizeFileKey(ref), ref])).values()];
    const issues = new Map();
    let matched = 0;
    for (const ref of uniqueRefs) {
      const key = Importer.normalizeFileKey(ref);
      const override = batch.attachmentOverrides.get(key);
      if (override) { matched++; continue; }
      const detail = Importer.resolveOneFile(ref, batch.fileIndex || Importer.buildFileIndex([]));
      if (detail.status === 'matched') matched++;
      else issues.set(key, detail);
    }
    const shared = uniqueFiles(batch.sharedFiles);
    const card=$('nmda-attachments-card');
    const contextPending=typeof supplementPreflightNeedsDecision==='function'&&supplementPreflightNeedsDecision();
    if(card)card.hidden=contextPending||(!uniqueRefs.length&&!shared.length);
    const cardTitle=card?.querySelector('summary strong');
    const cardHint=card?.querySelector('summary small');
    if(cardTitle)cardTitle.textContent='附件明细';
    if(cardHint)cardHint.textContent=issues.size?`${issues.size} 个待补 · 展开查看匹配情况`:uniqueRefs.length?`已匹配 ${matched}/${uniqueRefs.length}`:'无附件要求';
    if(card)card.dataset.issue=issues.size?'1':'0';
    if(issues.size && card && !batch.attachmentAttentionShown && !reviewTasks().length){card.open=true;batch.attachmentAttentionShown=true;}
    else if(issues.size && card && reviewTasks().length && !batch.attachmentAttentionShown){card.open=false;}
    $('nmda-attachment-summary').innerHTML = uniqueRefs.length
      ? issues.size
        ? `资料中要求 <strong>${uniqueRefs.length}</strong> 个附件；已找到 <strong>${matched}</strong> 个，还有 <strong class="nmda-danger">${issues.size}</strong> 个尚未提供。选择文件或文件夹后会自动匹配。${shared.length?` 另有 ${shared.length} 个公共附件。`:''}`
        : `资料中要求的 <strong>${uniqueRefs.length}</strong> 个附件已全部找到。${shared.length?` 另有 ${shared.length} 个公共附件将加入每封邮件。`:''}`
      : `资料中没有要求专属附件。${shared.length?`已选择 ${shared.length} 个公共附件，将加入每封邮件。`:'无需处理附件。'}`;

    const box = $('nmda-attachment-resolution');
    const list = $('nmda-attachment-resolution-list');
    const subtitle=box?.querySelector('.nmda-card-subtitle');
    if(subtitle)subtitle.textContent=issues.size?'还需要这些附件':'附件已齐全';
    if (!issues.size) { box.hidden = true; list.innerHTML = ''; return; }
    box.hidden = false;
    const pool = allAttachmentFiles();
    list.innerHTML = [...issues.values()].map(detail => {
      const suggestions = Importer.suggestFiles(detail.ref, batch.fileIndex, Math.min(18, Math.max(8, pool.length)));
      const suggestedIds = new Set(suggestions.filter(item => item.score > 0).map(item => Importer.fileIdentity(item.file)));
      const candidates = suggestions.filter(item => item.score > 0);
      if (pool.length <= 24) {
        for (const file of pool) if (!suggestedIds.has(Importer.fileIdentity(file))) candidates.push({ file, score: 0 });
      }
      const options = candidates.map(item => `<option value="${escapeHtml(Importer.fileIdentity(item.file))}">${escapeHtml(item.file.webkitRelativePath || item.file.name)}${item.score >= 90 ? '（推荐）' : ''}</option>`).join('');
      const problem=detail.status === 'ambiguous' ? '找到多个同名文件，请选择正确的一个' : '资料要求此附件，但当前还没有找到对应文件';
      return `<div class="nmda-resolve-row"><div><strong title="${escapeHtml(detail.ref)}">${escapeHtml(detail.ref)}</strong><small>${problem}</small></div><select data-attachment-ref="${escapeHtml(Importer.normalizeFileKey(detail.ref))}"><option value="">— 选择对应文件 —</option>${options}</select></div>`;
    }).join('');
    list.querySelectorAll('select[data-attachment-ref]').forEach(select => select.addEventListener('change', () => {
      const key = select.dataset.attachmentRef;
      const file = allAttachmentFiles().find(item => Importer.fileIdentity(item) === select.value);
      if (file) batch.attachmentOverrides.set(key, file); else batch.attachmentOverrides.delete(key);
      rebuildTasks();
      void enterSelectionAndSchedule('附件已补齐');
    }));
  }

  function setImportStatus(message, kind = '') {
    if (!importStatusEl) return;
    importStatusEl.textContent = message;
    if (kind) importStatusEl.dataset.kind = kind; else delete importStatusEl.dataset.kind;
  }

  function setBatchStatus(message, kind = '') {
    batchStatusEl.textContent = message;
    if (kind) batchStatusEl.dataset.kind = kind; else delete batchStatusEl.dataset.kind;
  }

  async function applyImportedDataset(dataset, label = '数据', sessionToken = batch.sessionId) {
    if (!isCurrentBatchSession(sessionToken)) return false;
    batch.dataset = dataset;
    batch.duplicateAudit = null;
    batch.handoffComplete = false;
    batch.importMeta = dataset?.meta || null;
    batch.collectionConfigs.clear();
    batch.taskEdits.clear();
    batch.reviewSelected?.clear?.();
    batch.duplicateSelections?.clear?.();
    batch.reviewFilter='pending';
    batch.reviewSearch='';
    batch.attachmentAttentionShown=false;
    batch.supplementPreflightDone=false;batch.supplementPreflightOpen=false;batch.attachmentPrepChoice='pending';batch.sourceInspectName='';batch.preflightFolderPath='';batch.preflightSearch='';batch.preflightReviewOnly=false;batch.preflightPurposeFilter='';
    closeImportTaskEditor();
    batch.directoryFiles = []; batch.taskFiles = uniqueFiles(dataset?.embeddedFiles || []); batch.routedAttachmentFiles=[]; batch.sharedFiles = []; batch.attachmentOverrides.clear(); batch.ignoredAttachmentIdentities=new Set(); batch.attachmentManagerOpen=false;
    batch.fileIndex = Importer.buildFileIndex(batch.taskFiles);
    dirEl.value = ''; taskFilesEl.value = ''; sharedFilesEl.value = '';
    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    if (batchStageFilterEl) batchStageFilterEl.value = '';
    const sets = recordSets();
    sets.forEach((_, index) => ensureCollectionConfig(index, { reset: true }));
    syncRoutedSources();
    batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());
    const mailIndexes=sets.map((_,index)=>index).filter(index=>ensureCollectionConfig(index)?.purpose==='mail');
    const bestIndex=(mailIndexes.map(index=>({index,score:Number(Importer.detectHeader(sets[index]?.rows||[]).score||0)})).sort((a,b)=>b.score-a.score)[0]?.index)??0;
    batch.collectionIndex = bestIndex;
    collectionSelectEl.innerHTML = sets.map((collection, i) => {
      const config=ensureCollectionConfig(i),kind = collectionKind(collection,config?.purpose);
      const detection = Importer.detectHeader(collection.rows || []);
      const records = Math.max(0, (collection.rows || []).length - detection.index - 1);
      return `<option value="${i}" ${i === bestIndex ? 'selected' : ''}>${escapeHtml(collection.name)} · ${escapeHtml(kind.label)} · ${records} 条</option>`;
    }).join('');
    $('nmda-collection-field').hidden = sets.length <= 1;
    $('nmda-structure-card').hidden = false;
    $('nmda-mapping-card').hidden = false;
    $('nmda-ingest-diagnostics').hidden = true;
    $('nmda-ingest-result-card').hidden = false;
    $('nmda-attachments-card').hidden = false;
    configureCollection(bestIndex, false);
    renderSourceInventory();
    clearStaleOverrides();
    batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());
    batch.rosterPromptChoice=referenceRosterCount()?'added':'pending';
    batch.attachmentPrepChoice=attachmentPreparedFileCount()?'added':'pending';
    batch.attachmentPromptDeferred=false;
    if (!isCurrentBatchSession(sessionToken)) return false;
    const routedCounts=[...batch.collectionConfigs.values()].reduce((acc,config)=>{acc[config.purpose]=(acc[config.purpose]||0)+1;return acc;},{mail:0,roster:0,attachment:0,ignored:0});
    const sourceCount=dataset.sourceFiles?.length || 1;
    $('nmda-import-format-info').textContent = `已加入 ${sourceCount} 个文件 · ${batch.tasks.length} 封邮件${referenceRosterCount()?` · 参考名单 ${referenceRosterCount()} 条`:''}`;
    setImportStatus(routedCounts.mail
      ? `邮件已加入本批次。${referenceRosterCount()?'参考总名单已参与核对。':'有参考总名单可现在补充；没有可直接继续。'}`
      : `当前没有识别到可创建的邮件。已打开分类核验工作区，请先确认文件用途并直接修正。`,
      routedCounts.mail?'ok':'warn');
    renderImportLifecycleState();
    batch.supplementPreflightOpen=true;renderSupplementPreflight();
    if(!routedCounts.mail||!batch.tasks.length)setBatchStatus('当前没有生成邮件任务；非邮件资料不会占用任务数或阻塞后续流程。','warn');
    else setBatchStatus(`已准备 ${batch.tasks.length} 封邮件。${(batch.tasks||[]).some(taskHasBlockingIssue)?'完成必要待办后会自动进入下一步。':'内容已就绪，正在进入选择与安排。'}`, 'ok');
    if(batch.tasks.length){
      if(batch.supplementPreflightDone&&!(batch.tasks||[]).some(taskHasBlockingIssue))setTimeout(()=>void enterSelectionAndSchedule('解析完成'),0);
    }
    return true;
  }

  function resetImportWorkspace({ keepStatus = false, invalidate = true, message = '' } = {}) {
    if (invalidate) batch.sessionId += 1;
    batch.importBusy = false;
    batch.handoffComplete = false;
    batch.autoAdvancing = false;
    batch.dataset = null;
    batch.importMeta = null;
    batch.collectionIndex = 0;
    batch.collectionConfigs.clear();
    batch.detection = null;
    batch.mapping = {};
    batch.tasks = [];
    batch.duplicateAudit = null;
    batch.directoryFiles = [];
    batch.taskFiles = [];
    batch.routedAttachmentFiles = [];
    batch.sharedFiles = [];
    batch.ignoredAttachmentIdentities = new Set();
    batch.attachmentManagerOpen = false;
    batch.attachmentOverrides.clear();
    batch.taskEdits.clear();
    batch.reviewSelected?.clear?.();
    batch.duplicateSelections?.clear?.();
    batch.reviewFilter='pending';
    batch.reviewSearch='';
    batch.attachmentAttentionShown=false;
    batch.rosterPromptChoice='idle';
    batch.attachmentPromptDeferred=false;
    batch.attachmentPrepChoice='idle';
    batch.supplementPreflightDone=false;batch.supplementPreflightOpen=false;batch.preflightView='files';batch.planningView='rules';batch.sourceInspectName='';batch.preflightFolderPath='';batch.preflightSearch='';batch.preflightReviewOnly=false;batch.preflightPurposeFilter='';
    batch.fileIndex = Importer.buildFileIndex([]);
    batch.profileSuggestion = null;
    batch.stopRequested = false;
    batch.schedulePlan = null;
    batch.scheduleRules = freshScheduleRules();
    batch.roster = emptyRosterState();
    syncScheduleRuleControls();

    closeImportTaskEditor();
    [importFileEl, importDirEl, importPackageEl, rosterFileEl, dirEl, taskFilesEl, sharedFilesEl].forEach(el => { if (el) el.value = ''; });
    if (pasteSourceEl) pasteSourceEl.value = '';
    const pastePanel = $('nmda-paste-panel'); if (pastePanel) pastePanel.hidden = true;
    const diagnostics = $('nmda-ingest-diagnostics'); if (diagnostics) { diagnostics.hidden = true; diagnostics.open = false; }

    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    if (batchStageFilterEl) batchStageFilterEl.value = '';
    const bulkTag = $('nmda-bulk-tag-value'); if (bulkTag) bulkTag.value = '';

    ['nmda-structure-card','nmda-mapping-card','nmda-ingest-diagnostics','nmda-ingest-result-card','nmda-roster-audit-card','nmda-attachments-card','nmda-import-handoff-card','nmda-preview-card','nmda-scheduler-card','nmda-run-card'].forEach(id => {
      const el = $(id); if (el) el.hidden = true;
    });
    const inventory = $('nmda-source-inventory'); if (inventory) { inventory.hidden = true; inventory.innerHTML = ''; }
    if (collectionSelectEl) collectionSelectEl.innerHTML = '';
    const collectionList = $('nmda-collection-list'); if (collectionList) collectionList.innerHTML = '';
    const structureSummary = $('nmda-structure-summary'); if (structureSummary) structureSummary.innerHTML = '';
    const headerInfo = $('nmda-header-info'); if (headerInfo) headerInfo.textContent = '';
    const profileInfo = $('nmda-profile-info'); if (profileInfo) profileInfo.textContent = '';
    const mapping = $('nmda-mapping'); if (mapping) { mapping.innerHTML = ''; mapping.hidden = true; }
    const semantic = $('nmda-semantic-summary'); if (semantic) semantic.innerHTML = '';
    const structure = $('nmda-structure-preview'); if (structure) structure.innerHTML = '';
    const summary = $('nmda-import-preview-summary'); if (summary) summary.innerHTML = '';
    if (importPreviewSummaryEl) importPreviewSummaryEl.innerHTML = '';
    if (reviewQueueEl) reviewQueueEl.innerHTML = '';
    if (reviewSourceContextEl) reviewSourceContextEl.innerHTML = '';
    if (reviewSourceMetaEl) reviewSourceMetaEl.innerHTML = '';
    if (reviewCandidatesEl) reviewCandidatesEl.innerHTML = '';
    if (reviewProgressEl) reviewProgressEl.textContent = '';
    if (reviewNavCountEl) { reviewNavCountEl.hidden=true; reviewNavCountEl.textContent=''; }
    if (reviewPageSummaryEl) reviewPageSummaryEl.innerHTML='<span>尚无批量邮件</span>';
    if (reviewPageEmptyEl) reviewPageEmptyEl.hidden=false;
    if (reviewBatchbarEl) reviewBatchbarEl.hidden=true;
    const reviewGuide = $('nmda-review-guidance'); if (reviewGuide) reviewGuide.textContent = '解析完成后可查看每封邮件的结果。';
    const reviewBtn = $('nmda-review-import-issues'); if (reviewBtn) { reviewBtn.hidden = true; reviewBtn.textContent = '检查邮件'; }
    hideSubjectAssist();
    if(schedulerCardEl){schedulerCardEl.open=true;schedulerCardEl.hidden=true;}
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent='收起';
    const restoreBtn = $('nmda-restore-excluded'); if (restoreBtn) restoreBtn.hidden = true;
    const fileInfo = $('nmda-file-index-info'); if (fileInfo) fileInfo.textContent = '尚未选择本地附件。';
    const attachmentSummary = $('nmda-attachment-summary'); if (attachmentSummary) attachmentSummary.textContent = '尚未添加附件。';
    const attachmentResolution = $('nmda-attachment-resolution'); if (attachmentResolution) attachmentResolution.hidden = true;
    const attachmentResolutionList = $('nmda-attachment-resolution-list'); if (attachmentResolutionList) attachmentResolutionList.innerHTML = '';
    const readySummary = $('nmda-import-ready-summary'); if (readySummary) readySummary.textContent = '还没有准备好邮件。';

    $('nmda-batch-empty').hidden = false;
    $('nmda-import-format-info').textContent = '可直接加入常见文档、表格和文本。';
    const rosterStatus=$('nmda-roster-source-status'); if(rosterStatus)rosterStatus.textContent='尚未载入总套磁名单。';
    const rosterRemove=$('nmda-roster-remove'); if(rosterRemove)rosterRemove.hidden=true;
    const rosterSummary=$('nmda-roster-audit-summary'); if(rosterSummary)rosterSummary.innerHTML='';
    const rosterDetails=$('nmda-roster-audit-details'); if(rosterDetails)rosterDetails.innerHTML='';
    setBatchStatus('请先添加资料并检查解析结果。');
    renderImportLifecycleState();
    if (!keepStatus) setImportStatus(message || '还没有添加资料。');
    scheduleBatchRender({aux:true});
  }

  function clearImportOnError(error, sessionToken = batch.sessionId) {
    if (!isCurrentBatchSession(sessionToken)) return;
    console.error(`[${APP}] import`, error);
    resetImportWorkspace({ keepStatus: true, invalidate: true });
    setImportStatus(`读取失败：${error.message}`, 'error');
  }


  importFileEl.addEventListener('change', async () => {
    const files = [...(importFileEl.files || [])];
    if (!files.length || !Importer) return;
    const token = beginImportSession(`正在读取 ${files.length === 1 ? files[0].name : `${files.length} 个文件`}…`);
    try {
      const dataset = await Importer.parseFiles(files);
      if (!isCurrentBatchSession(token)) return;
      await applyImportedDataset(dataset, files.length === 1 ? files[0].name : `${files.length} 个文件`, token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); if (importFileEl) importFileEl.value = ''; }
  });

  importDirEl?.addEventListener('change', async () => {
    const files = [...(importDirEl.files || [])];
    if (!files.length || !Importer) return;
    const token = beginImportSession(`正在扫描文件夹（${files.length} 个文件）…`);
    try {
      const dataset = await Importer.parseDirectory(files);
      if (!isCurrentBatchSession(token)) return;
      await applyImportedDataset(dataset, `文件夹（${dataset.sourceFiles?.length || 0} 个可读取文件）`, token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); if (importDirEl) importDirEl.value = ''; }
  });

  importPackageEl?.addEventListener('change', async () => {
    const file = importPackageEl.files?.[0];
    if (!file || !Importer) return;
    const token = beginImportSession(`正在读取 ZIP ${file.name}…`);
    try {
      const dataset = await Importer.parseFile(file);
      if (!isCurrentBatchSession(token)) return;
      await applyImportedDataset(dataset, `ZIP ${file.name}`, token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); if (importPackageEl) importPackageEl.value = ''; }
  });


  rosterFileEl?.addEventListener('change', async () => {
    const files=[...(rosterFileEl.files||[])];
    if(files.length)await loadRosterFiles(files);
  });
  $('nmda-roster-remove')?.addEventListener('click', removeRoster);
  $('nmda-open-supplement-preflight')?.addEventListener('click',()=>openSupplementPreflight('files'));
  $('nmda-edit-batch-prep')?.addEventListener('click',()=>openSupplementPreflight('support'));
  $('nmda-close-supplement-preflight')?.addEventListener('click',()=>{batch.supplementPreflightOpen=false;renderSupplementPreflight();setImportStatus('已返回上传区。','ok');});
  $('nmda-preflight-source-search')?.addEventListener('input',event=>{batch.preflightSearch=String(event.target.value||'');renderPreflightSourceRoles();});
  $('nmda-source-inspector-close')?.addEventListener('click',()=>{batch.sourceInspectName='';const diagnostics=$('nmda-ingest-diagnostics');if(diagnostics){diagnostics.hidden=true;diagnostics.open=false;}renderPreflightSourceRoles();});
  ui.querySelectorAll('[data-preflight-view]').forEach(button=>button.addEventListener('click',()=>setPreflightView(button.dataset.preflightView)));
  ui.querySelectorAll('button[data-support-view]').forEach(button=>button.addEventListener('click',()=>setSupportView(button.dataset.supportView)));
  ui.querySelectorAll('[data-planning-view]').forEach(button=>button.addEventListener('click',()=>setPlanningView(button.dataset.planningView)));
  $('nmda-source-next-review')?.addEventListener('click',event=>{const source=decodeURIComponent(event.currentTarget.dataset.nextSource||'');if(source)inspectSourceInPreflight(source);});
  $('nmda-preflight-dropzones')?.querySelectorAll('[data-drop-purpose]').forEach(zone=>{
    zone.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';zone.classList.add('is-over');});
    zone.addEventListener('dragleave',event=>{if(!zone.contains(event.relatedTarget))zone.classList.remove('is-over');});
    zone.addEventListener('drop',event=>{event.preventDefault();zone.classList.remove('is-over');document.querySelector('.nmda-classify-dialog')?.classList.remove('is-drag-classifying');const source=event.dataTransfer?.getData('text/plain')||batch.sourceInspectName;if(!source)return;const purpose=zone.dataset.dropPurpose||'';if(purpose==='review')setSourceNeedsReview(source);else setSourcePurpose(source,purpose);});
  });
  $('nmda-preflight-roster-skip')?.addEventListener('click',()=>{batch.rosterPromptChoice='skipped';renderImportLifecycleState();renderSupplementPreflight();});
  $('nmda-preflight-attachment-skip')?.addEventListener('click',()=>{batch.attachmentPrepChoice='skipped';renderImportLifecycleState();renderSupplementPreflight();});
  $('nmda-complete-supplement-preflight')?.addEventListener('click',completeSupplementPreflight);
  $('nmda-roster-skip')?.addEventListener('click',()=>{
    batch.rosterPromptChoice='skipped';
    renderImportLifecycleState();
    scheduleBatchRender({aux:true,force:true});
    setImportStatus('已跳过参考总名单；当前批次仍会正常查重。','ok');
    renderSupplementPreflight();
    if(batch.supplementPreflightDone)setTimeout(()=>void enterSelectionAndSchedule('参考总名单已跳过'),0);
  });
  $('nmda-attachment-later')?.addEventListener('click',()=>{
    batch.attachmentPromptDeferred=true;
    renderAttachmentContextCue();
    setImportStatus('附件待办已保留；先处理邮件内容即可。','ok');
  });
  $('nmda-roster-enabled')?.addEventListener('change', e => {
    rosterState().enabled=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });
  $('nmda-roster-auto-school')?.addEventListener('change', e => {
    rosterState().autoSchool=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });
  $('nmda-roster-strict')?.addEventListener('change', e => {
    rosterState().strict=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });

  $('nmda-show-paste')?.addEventListener('click', () => {
    const panel = $('nmda-paste-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) pasteSourceEl?.focus();
  });

  $('nmda-paste-import')?.addEventListener('click', async () => {
    const text = String(pasteSourceEl?.value || '').trim();
    if (!text) { setImportStatus('请先粘贴需要导入的内容。', 'warn'); return; }
    const token = beginImportSession('正在读取粘贴内容…');
    try {
      const file = new File([text], `pasted-${Date.now()}.txt`, { type:'text/plain;charset=utf-8', lastModified:Date.now() });
      const dataset = await Importer.parseFile(file);
      if (!isCurrentBatchSession(token)) return;
      dataset.meta = { ...(dataset.meta || {}), pasted:true };
      await applyImportedDataset(dataset, '粘贴内容', token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); }
  });

  $('nmda-reset-import')?.addEventListener('click', () => {
    if (batch.running) { setImportStatus('正在创建草稿，暂时不能开始新批次。', 'warn'); return; }
    resetImportWorkspace({ message: '当前批次已彻底清空，可以载入新的来源。' });
  });

  $('nmda-go-batch')?.addEventListener('click', async () => {
    const button = $('nmda-go-batch');
    if (!button || button.disabled || !batch.tasks.length) return;
    if(batch.handoffComplete){setWorkbenchTab('batch');setBatchStatus(`当前有 ${batch.tasks.length} 封邮件。`, 'ok');requestAnimationFrame(() => $('nmda-stage-execute')?.scrollIntoView?.({behavior:'smooth', block:'start'}));return;}
    button.disabled = true;
    button.textContent = '正在进入下一步…';
    await enterSelectionAndSchedule('资料已就绪');
  });

  importReviewBtnEl?.addEventListener('click',()=>{if(importReviewBtnEl?.dataset.mode==='issues')openNextBlockingIssue();else openReviewWorkspace();});
  $('nmda-review-next-pending')?.addEventListener('click',()=>{
    const button=$('nmda-review-next-pending');
    if(button?.dataset.mode==='continue'){void continueAfterReviewResolution('邮件检查完成');return;}
    openNextReviewTask();
  });
  $('nmda-review-guidance')?.addEventListener('click',event=>{
    const action=event.target?.closest?.('[data-issue-action]')?.dataset?.issueAction;
    if(action==='next'||action==='review'){openNextBlockingIssue();return;}
    if(action==='attachments'){openNextBlockingIssue('attachments');}
  });
  ui.querySelectorAll('[data-review-filter]').forEach(button=>button.addEventListener('click',()=>{
    batch.reviewFilter=button.dataset.reviewFilter==='all'?'all':'pending';
    viewPerf.reviewRenderLimit=250;
    renderReviewPageOverview();
    const currentKey=importEditorOverlayEl?.dataset.editKey;
    const visible=reviewVisibleTasks();
    if(!visible.some(task=>task.editKey===currentKey)){const first=visible[0];if(first)openImportTaskEditor(first);else closeImportTaskEditor();}
  }));
  $('nmda-review-select-filtered')?.addEventListener('click',selectVisibleReviewTasks);
  $('nmda-review-clear-selected')?.addEventListener('click',()=>{batch.reviewSelected.clear();renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');renderReviewBatchActions();});
  $('nmda-review-confirm-selected')?.addEventListener('click',confirmSelectedReviewTasks);
  duplicateCandidatesEl?.addEventListener('change',event=>{
    const input=event.target?.closest?.('[data-duplicate-pick]');if(!input)return;
    const groupId=duplicateDecisionEl?.dataset.groupId||'';
    const selected=[...duplicateCandidatesEl.querySelectorAll('input[data-duplicate-pick]:checked')].map(item=>item.dataset.duplicatePick).filter(Boolean);
    if(groupId&&batch.duplicateSelections instanceof Map)batch.duplicateSelections.set(groupId,selected);
    duplicateCandidatesEl.querySelectorAll('[data-duplicate-row]').forEach(row=>row.classList.toggle('is-selected',selected.includes(row.dataset.duplicateRow)));
    if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.textContent=`保留所选（${selected.length}）`;
    if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent=selected.length?'未勾选的邮件将在确认后排除。':'至少保留一封；当前尚未选择任何邮件。';
  });
  duplicateCandidatesEl?.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-duplicate-open]');if(!button)return;
    const key=button.dataset.duplicateOpen||'';const groupId=duplicateDecisionEl?.dataset.groupId||'';
    if(groupId&&batch.duplicateSelections instanceof Map){const selected=[...duplicateCandidatesEl.querySelectorAll('input[data-duplicate-pick]:checked')].map(item=>item.dataset.duplicatePick).filter(Boolean);if(selected.length)batch.duplicateSelections.set(groupId,selected);}
    stashCurrentReviewDraft();rebuildTasks();const target=(batch.tasks||[]).find(item=>item.editKey===key);if(target)openImportTaskEditor(target);
  });
  $('nmda-duplicate-keep-selected')?.addEventListener('click',()=>void keepSelectedDuplicateCandidate());
  $('nmda-duplicate-keep-all')?.addEventListener('click',()=>void keepAllDuplicateCandidates());
  $('nmda-import-editor-close')?.addEventListener('click', closeReviewWorkspace);
  $('nmda-import-editor-cancel')?.addEventListener('click', closeReviewWorkspace);
  $('nmda-import-editor-save')?.addEventListener('click', () => saveImportTaskEditor(false));
  $('nmda-import-editor-next')?.addEventListener('click', () => saveImportTaskEditor(true));
  $('nmda-review-exclude')?.addEventListener('click', excludeCurrentReviewTask);
  [importEditRecipientsEl,importEditSubjectEl,importEditBodyEl].forEach(el=>el?.addEventListener('input',()=>{refreshReviewDraftIndicators();if(el===importEditBodyEl)autoSizeReviewBody();}));
  importEditSubjectEl?.addEventListener('input',()=>{
    hideSubjectAssist();
    if(subjectAssistTimer)clearTimeout(subjectAssistTimer);
    if(importEditSubjectEl.dataset.startedBlank==='1'&&String(importEditSubjectEl.value||'').trim())subjectAssistTimer=setTimeout(()=>{subjectAssistTimer=null;maybeOfferSubjectAssist();},650);
  });
  [importEditRecipientsEl,importEditBodyEl].forEach(el=>el?.addEventListener('change',async()=>{
    const key=importEditorOverlayEl?.dataset.editKey||'';
    stashCurrentReviewDraft();rebuildTasks();renderReviewQueue(key);
    const current=(batch.tasks||[]).find(task=>task.editKey===key);
    if(current&&!taskNeedsImportReview(current))await continueAfterReviewResolution('邮件内容已补齐');
    else if(current)openImportTaskEditor(current);
  }));
  importEditSubjectEl?.addEventListener('change',async()=>{
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
    const key=importEditorOverlayEl?.dataset.editKey||'';
    stashCurrentReviewDraft();rebuildTasks();renderReviewQueue(key);maybeOfferSubjectAssist();
    const offered=subjectAssistEl&&!subjectAssistEl.hidden;
    const current=(batch.tasks||[]).find(task=>task.editKey===key);
    if(!offered&&current&&!taskNeedsImportReview(current))await continueAfterReviewResolution('主题已补齐');
    else if(!offered&&current)openImportTaskEditor(current);
  });
  $('nmda-subject-assist-apply')?.addEventListener('click',()=>void applySubjectAssist());
  $('nmda-subject-assist-dismiss')?.addEventListener('click',async()=>{
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
    hideSubjectAssist();if(importEditSubjectEl)importEditSubjectEl.dataset.startedBlank='0';
    const key=importEditorOverlayEl?.dataset.editKey||'';
    const current=(batch.tasks||[]).find(task=>task.editKey===key);
    if(current&&!taskNeedsImportReview(current))await continueAfterReviewResolution('当前邮件已补齐');
  });
  schedulerCardEl?.addEventListener('toggle',()=>{if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent=schedulerCardEl.open?'收起':'展开';});
  $('nmda-restore-excluded')?.addEventListener('click', () => {
    batch.handoffComplete=false;
    for (const [key,edit] of batch.taskEdits) if(edit?.importExcluded) batch.taskEdits.set(key,{...edit,importExcluded:false});
    rebuildTasks();
  });

  mappingToggleEl?.addEventListener('click', () => setMappingEditorOpen(mappingEl.hidden));
  $('nmda-save-profile')?.addEventListener('click', () => {
    const collection = currentCollection();
    if (!collection || !batch.detection) return;
    const defaultName = `${collection.name || '内容'} 识别模板`;
    const name = prompt('为这套导入设置命名：', defaultName);
    if (!name) return;
    const headers = batch.detection.headers || [];
    const fieldHeaders = {};
    for (const [field, index] of Object.entries(batch.mapping || {})) fieldHeaders[field] = headers[index] || '';
    const profile = Importer.createProfile({
      name,
      format: collection.meta?.format || batch.dataset?.format || '',
      collectionName: collection.name || '',
      headers,
      mapping: batch.mapping,
      confidence: batch.detection.confidence || {}
    });
    profile.fieldHeaders = fieldHeaders;
    Importer.saveProfile(profile);
    $('nmda-profile-info').textContent = `已保存当前导入设置“${name}”。`;
  });
  $('nmda-apply-profile')?.addEventListener('click', () => {
    const suggestion = batch.profileSuggestion;
    const collection = currentCollection();
    if (!suggestion?.profile || !collection || !batch.detection) return;
    const headers = batch.detection.headers || [];
    const normalized = headers.map(Importer.normalizeHeader);
    const next = {};
    const profile = suggestion.profile;
    for (const [field, oldIndex] of Object.entries(profile.mapping || {})) {
      const wanted = Importer.normalizeHeader(profile.fieldHeaders?.[field] || profile.headers?.[oldIndex] || '');
      const currentIndex = wanted ? normalized.indexOf(wanted) : -1;
      if (currentIndex >= 0) next[field] = currentIndex;
      else if (Number(oldIndex) < headers.length) next[field] = Number(oldIndex);
    }
    const config = ensureCollectionConfig(batch.collectionIndex);
    config.mapping = next;
    batch.mapping = config.mapping;
    mappingEl.innerHTML = Importer.FIELD_DEFS.map(field => mappingSelectHtml(field, headers)).join('');
    mappingEl.querySelectorAll('select[data-map-field]').forEach(select => select.addEventListener('change', () => {
      const field = select.dataset.mapField;
      if (select.value === '') delete config.mapping[field]; else config.mapping[field] = Number(select.value);
      batch.mapping = config.mapping;
      batch.handoffComplete=false;
      renderSemanticSummary(); rebuildTasks();
    }));
    setMappingEditorOpen(true);
    renderSemanticSummary(); rebuildTasks();
    $('nmda-profile-info').textContent = `已使用导入设置“${profile.name}”。请检查邮件结果。`;
  });
  collectionSelectEl.addEventListener('change', () => { configureCollection(collectionSelectEl.value, false); renderCollectionList(); });
  dirEl.addEventListener('change', () => {
    for(const file of dirEl.files||[])batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.directoryFiles = uniqueFiles([...batch.directoryFiles, ...dirEl.files]);
    batch.attachmentPrepChoice='added';
    dirEl.value = ''; refreshFileIndex(true);renderSupplementPreflight();
  });
  // User intent wins: files explicitly chosen from the attachment UI are not
  // "candidates". They are direct-send attachments for every mail in this batch.
  // Only directory/package/auto-routed files stay in the matching pool.
  taskFilesEl.addEventListener('change', () => {
    for(const file of taskFilesEl.files||[])batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.sharedFiles = uniqueFiles([...batch.sharedFiles, ...taskFilesEl.files]);
    batch.attachmentPrepChoice='added';
    taskFilesEl.value = ''; refreshFileIndex(false);renderSupplementPreflight();
  });
  sharedFilesEl.addEventListener('change', () => {
    for(const file of sharedFilesEl.files||[])batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.sharedFiles = uniqueFiles([...batch.sharedFiles, ...sharedFilesEl.files]);
    batch.attachmentPrepChoice='added';
    sharedFilesEl.value = ''; refreshFileIndex(false);renderSupplementPreflight();
  });
  const attachmentDropEl = $('nmda-attachment-drop');
  ['dragenter','dragover'].forEach(type => attachmentDropEl.addEventListener(type, event => { event.preventDefault(); attachmentDropEl.classList.add('is-dragging'); }));
  ['dragleave','drop'].forEach(type => attachmentDropEl.addEventListener(type, event => { event.preventDefault(); attachmentDropEl.classList.remove('is-dragging'); }));
  attachmentDropEl.addEventListener('drop', event => {
    const dropped = [...(event.dataTransfer?.files || [])].filter(file => file && file.name);
    if (!dropped.length) return;
    for(const file of dropped)batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    // Dragging a local file into the explicit attachment drop-zone is also an
    // unambiguous send instruction, equivalent to clicking "添加并发送文件".
    batch.sharedFiles = uniqueFiles([...batch.sharedFiles, ...dropped]);
    batch.attachmentPrepChoice='added';
    refreshFileIndex(false);renderSupplementPreflight();
  });
  $('nmda-clear-attachments').addEventListener('click', () => {
    for(const config of batch.collectionConfigs.values())if(config.purpose==='attachment'){config.purpose='ignored';config.enabled=false;}
    renderSourceInventory();renderCollectionList();clearAttachmentAssets();
  });
  $('nmda-manager-clear-attachments')?.addEventListener('click',clearAttachmentAssets);
  $('nmda-close-attachment-manager')?.addEventListener('click',closeAttachmentManager);
  $('nmda-attachment-manager-done')?.addEventListener('click',closeAttachmentManager);
  $('nmda-manage-attachments-strip')?.addEventListener('click',openAttachmentManager);
  $('nmda-manage-attachments-todo')?.addEventListener('click',openAttachmentManager);
  $('nmda-manage-attachments-workflow')?.addEventListener('click',openAttachmentManager);
  $('nmda-attachment-manager-overlay')?.addEventListener('click',event=>{if(event.target===$('nmda-attachment-manager-overlay'))closeAttachmentManager();});
  ui.addEventListener('click',event=>{
    const remove=event.target.closest?.('[data-attachment-remove]');
    if(remove){removeAttachmentAsset(decodeURIComponent(remove.dataset.attachmentRemove||''));return;}
    if(event.target.closest?.('[data-open-attachment-manager]'))openAttachmentManager();
  });

  $('nmda-template').addEventListener('click', () => {
    const csv = '\ufeff编号,收件人,学校,主题,正文,附件,定时时间,任务标记\r\n001,mail-test@example.com,示例大学,测试主题,这是正文,该封专属材料.pdf,2026-08-25 09:30,第一批;重点\r\n002,mail-test-2@example.com,示例大学,测试主题2,这是正文2,,,第二批\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  scheduleApplyEl?.addEventListener('click', applySmartSchedule);
  scheduleClearEl?.addEventListener('click', clearAutoSchedule);
  [scheduleStartEl,scheduleMaxSchoolEl,scheduleIntervalDaysEl,schedulePreserveEl,scheduleHolidayEl].forEach(el=>el?.addEventListener('change',()=>{readScheduleRuleControls();batch.schedulePlan=null;renderScheduleCenter();}));
  syncScheduleRuleControls();

  const renderBatchFilterDebounced=debounce(()=>scheduleBatchRender({aux:false}),100);
  [batchSearchEl,batchTagIncludeEl].forEach(el=>el?.addEventListener('input',renderBatchFilterDebounced));
  batchStageFilterEl?.addEventListener('change',()=>scheduleBatchRender({aux:false}));

  function bulkEditFiltered(kind) {
    const targets = filteredBatchTasks().filter(task => task.status !== 'running' && task.status !== 'done');
    if (!targets.length) { setBatchStatus('当前检索/筛选结果没有可编辑任务。', 'warn'); return; }
    const tagValue = $('nmda-bulk-tag-value').value;
    const parsed = parseTaskClassifications(tagValue);
    if ((kind === 'addTag' || kind === 'removeTag') && !parsed.length) {
      setBatchStatus('请输入有效的任务标记。联系状态、待跟进和联系策略由联系人系统维护，不能作为任务标记。', 'warn'); return;
    }
    let affected = 0, blockedSkipped = 0;
    for (const task of targets) {
      if (kind === 'enable') {
        if (task.policyBlocked) { blockedSkipped++; continue; }
        setTaskEdit(task, { enabled: true }); affected++;
      }
      else if (kind === 'disable') { setTaskEdit(task, { enabled: false }); affected++; }
      else if (kind === 'addTag') { setTaskEdit(task, { tags: Contacts.mergeTags(task.tags || [], parsed) }); affected++; }
      else if (kind === 'removeTag') {
        const remove = new Set(parsed.map(tag => tag.toLocaleLowerCase('zh-CN')));
        setTaskEdit(task, { tags: parseTaskClassifications(task.tags || []).filter(tag => !remove.has(tag.toLocaleLowerCase('zh-CN'))) }); affected++;
      }
    }
    const actionText = { enable: '纳入筛选结果', disable: '排除筛选结果', addTag: `添加标记“${tagsText(parsed)}”`, removeTag: `移除标记“${tagsText(parsed)}”` }[kind];
    const skippedText = blockedSkipped ? `；另有 ${blockedSkipped} 封受联系策略拦截，无法选择` : '';
    setBatchStatus(`已对 ${affected} 封任务执行：${actionText}${skippedText}。`, blockedSkipped ? 'warn' : 'ok');
    scheduleBatchRender({aux:false});
  }

  $('nmda-bulk-add-tag').addEventListener('click', () => bulkEditFiltered('addTag'));
  $('nmda-bulk-remove-tag').addEventListener('click', () => bulkEditFiltered('removeTag'));
  $('nmda-bulk-enable').addEventListener('click', () => bulkEditFiltered('enable'));
  $('nmda-bulk-disable').addEventListener('click', () => bulkEditFiltered('disable'));
  $('nmda-clear-selection').addEventListener('click', () => {
    let affected = 0;
    for (const task of batch.tasks || []) {
      if (task.status === 'running' || task.status === 'done' || !task.enabled) continue;
      setTaskEdit(task, { enabled: false }); affected++;
    }
    setBatchStatus(`已排除 ${affected} 封任务；可逐封重新纳入，或使用“纳入筛选结果”。`, 'ok');
    scheduleBatchRender({aux:false});
  });
  $('nmda-clear-tag-filter').addEventListener('click', () => {
    if (batchSearchEl) batchSearchEl.value = '';
    if(batchTagIncludeEl)batchTagIncludeEl.value = '';
    if(batchStageFilterEl)batchStageFilterEl.value = '';
    scheduleBatchRender({aux:false});
  });

  const renderContactFilterDebounced=debounce(()=>{viewPerf.contactRenderLimit=250;scheduleContactsRender();},100);
  $('nmda-contact-search').addEventListener('input',renderContactFilterDebounced);
  $('nmda-contact-class-filter').addEventListener('input',renderContactFilterDebounced);


  async function runMailboxRead(mode = 'quick') {
    const full = mode === 'full';
    const refreshButton = $('nmda-refresh-history');
    const rebuildButton = $('nmda-rebuild-history');
    if (refreshButton) refreshButton.disabled = true;
    if (rebuildButton) rebuildButton.disabled = true;
    setContactStatusMessage(full
      ? '正在重建联系人记录…'
      : '正在快速读取最近邮箱变化…');
    try {
      await ensureContactBook();
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_READ_MAILBOX_STATE', mode: full ? 'full' : 'quick' });
      if (!result?.ok) throw new Error(`${result?.phase ? `${result.phase}：` : ''}${result?.reason || '邮箱读取失败'}`);
      const sent = result.sent || {}, drafts = result.drafts || {};
      const sentMessages = sent.messages || [], draftMessages = drafts.messages || [];

      if (full) {
        // Destructive replacement is allowed only from a proven complete snapshot.
        if (!sent.complete || !drafts.complete) {
          const sentWhy = sent.complete ? '完整' : (sent.stopReason || `${sent.messages?.length || 0}/${sent.total || '?'}`);
          const draftWhy = drafts.complete ? '完整' : (drafts.stopReason || `${drafts.messages?.length || 0}/${drafts.total || '?'}`);
          throw new Error(`完整覆盖未完成（已发送：${sentWhy}；草稿：${draftWhy}）。为保护现有数据，本次没有修改联系人库。`);
        }
        const rebuilt = Contacts.rebuildMailboxSnapshot(contactBook.contacts, sentMessages, draftMessages);
        // Persist the replacement before switching the live in-memory book: atomic at app level.
        await Contacts.save(contactBook.account, rebuilt.contacts);
        contactBook.contacts = rebuilt.contacts;
        markContactsChanged();
        const meta = {
          lastMode: 'full', complete: true, lastFullAt: new Date().toISOString(),
          sent: result.coverage?.sent || { read: sentMessages.length, total: sent.total || sentMessages.length, complete: true, pages: sent.pages || 0 },
          drafts: result.coverage?.drafts || { read: draftMessages.length, total: drafts.total || draftMessages.length, complete: true, pages: drafts.pages || 0 }
        };
        const previous = await Contacts.loadSyncMeta(contactBook.account);
        await Contacts.saveSyncMeta(contactBook.account, { ...previous, ...meta });
        await renderMailboxReadMeta({ ...previous, ...meta });
        scheduleContactsRender(); scheduleBatchRender({aux:true});
        setContactStatusMessage(`联系人记录重建完成：已发送 ${sentMessages.length} 封 · 草稿 ${draftMessages.length} 封 · 更新 ${rebuilt.contactFacts} 个联系人。${rebuilt.draftsWithoutRecipient ? ` ${rebuilt.draftsWithoutRecipient} 封草稿没有收件人，未关联联系人。` : ''}`, 'ok');
      } else {
        // Quick refresh works on a clone, so a storage failure never leaves a half-applied live state.
        const nextContacts = Contacts.cloneContacts(contactBook.contacts);
        const sentApplied = Contacts.applySentMessages(nextContacts, sentMessages);
        const draftApplied = Contacts.applyDraftMessages(nextContacts, draftMessages, { replaceActive: false });
        await Contacts.save(contactBook.account, nextContacts);
        contactBook.contacts = nextContacts;
        markContactsChanged();
        const previous = await Contacts.loadSyncMeta(contactBook.account);
        const meta = {
          ...previous, lastMode: 'quick', complete: false, lastQuickAt: new Date().toISOString(),
          sent: result.coverage?.sent || { read: sentMessages.length, total: sent.total || 0, complete: !!sent.complete, pages: sent.pages || 0 },
          drafts: result.coverage?.drafts || { read: draftMessages.length, total: drafts.total || 0, complete: !!drafts.complete, pages: drafts.pages || 0 }
        };
        await Contacts.saveSyncMeta(contactBook.account, meta);
        await renderMailboxReadMeta(meta);
        scheduleContactsRender(); scheduleBatchRender({aux:true});
        setContactStatusMessage(`邮箱同步完成：已发送 ${sentMessages.length} 封 · 草稿 ${draftMessages.length} 封。`, 'ok');
      }
    } catch (error) {
      console.error(`[${APP}] mailbox read ${mode}`, error);
      setContactStatusMessage(`${full ? '重建记录' : '同步邮箱'}失败：${error.message}`, 'error');
    } finally {
      if (refreshButton) refreshButton.disabled = false;
      if (rebuildButton) rebuildButton.disabled = false;
    }
  }

  $('nmda-refresh-history')?.addEventListener('click', () => runMailboxRead('quick'));
  $('nmda-rebuild-history')?.addEventListener('click', () => runMailboxRead('full'));

  $('nmda-export-contacts').addEventListener('click', async () => {
    try {
      await ensureContactBook();
      const csv = Contacts.toCsv(contactBook.contacts);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `netease-contacts-${contactBook.account.replace(/[^a-z0-9@._-]+/ig, '_')}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setContactStatusMessage('联系人状态与标记已导出为 CSV。', 'ok');
    } catch (error) { setContactStatusMessage(`导出失败：${error.message}`, 'error'); }
  });

  batchStopEl.addEventListener('click', () => {
    batch.stopRequested = true;
    batchStopEl.disabled = true;
    setBatchStatus('已请求停止：当前这一封完成后不会继续下一封。', 'warn');
  });

  function setBatchPlanningLocked(locked) {
    [batchSearchEl, batchTagIncludeEl, batchStageFilterEl].forEach(el => { if (el) el.disabled = !!locked; });
    if (mappingToggleEl) mappingToggleEl.disabled = !!locked;
    ['nmda-clear-tag-filter','nmda-bulk-add-tag','nmda-bulk-remove-tag','nmda-bulk-enable','nmda-bulk-disable','nmda-clear-selection','nmda-rule-start-at','nmda-rule-max-school','nmda-rule-interval-days','nmda-rule-preserve-existing','nmda-apply-schedule','nmda-clear-auto-schedule'].forEach(id => {
      const el = $(id); if (el) el.disabled = !!locked;
    });
  }

  batchStartEl.addEventListener('click', async () => {
    if (batch.running) return;
    if (!batch.handoffComplete) { setBatchStatus('当前邮件还没有完成必要核对，请先在批量工作台上方处理。', 'error'); return; }
    const executable = batch.tasks.filter(task => task.enabled && task.status === 'ready');
    if (!executable.length) { setBatchStatus('没有已选择且可创建的任务。请先在列表中勾选需要创建的草稿。', 'error'); return; }
    const staleScheduled=executable.filter(task=>task.scheduleAt && (Scheduler?.parseLocalDateTime?.(task.scheduleAt)?.getTime()||0) <= Date.now()+60*1000);
    if(staleScheduled.length){setBatchStatus(`有 ${staleScheduled.length} 封邮件的定时时间已过。请先在“安排时间”中更新或清空。`,'error');return;}
    const executableKeys = new Set(executable.map(task => task.editKey)); // freeze this run at start
    batch.uiStep=4; renderProcessGuide();
    batch.running = true; batch.stopRequested = false; batchStartEl.disabled = true; batchStopEl.disabled = false;
    importFileEl.disabled = true; if (importDirEl) importDirEl.disabled = true; if (importPackageEl) importPackageEl.disabled = true; if (rosterFileEl) rosterFileEl.disabled = true; collectionSelectEl.disabled = true; dirEl.disabled = true; taskFilesEl.disabled = true; sharedFilesEl.disabled = true; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=true; });
    setBatchPlanningLocked(true);
    let succeeded = 0, failed = 0;
    try {
      for (let i = 0; i < batch.tasks.length; i++) {
        const task = batch.tasks[i];
        if (!executableKeys.has(task.editKey) || task.status !== 'ready') continue;
        if (batch.stopRequested) break;
        task.status = 'running'; scheduleBatchRender({aux:false});
        setBatchStatus(`正在处理 ${succeeded + failed + 1}/${executable.length} · ${task.id} · ${task.subject || '(无主题)'}${task.scheduleAt ? ` · 定时 ${task.scheduleAt.replace('T', ' ')}` : ' · 未定时'}`);
        try {
          const outcome = await executeDraftRemotely(task, {
            fresh: true,
            onProgress: progress => setBatchStatus(`任务 ${task.id}：${progress.message || '正在创建草稿…'}`)
          });
          const upload = outcome.attachment || {};
          if (upload.verified === false && upload.missingNames?.length) {
            task.note = [task.note, `附件已提交上传，但页面未确认：${upload.missingNames.join('、')}`].filter(Boolean).join('；');
          }
          if (task.scheduleAt && outcome.actualMinute !== null && outcome.actualMinute !== undefined) {
            const requestedMinute = new Date(task.scheduleAt).getMinutes();
            if (Number(outcome.actualMinute) !== requestedMinute) task.note = [task.note, `分钟由 ${requestedMinute} 调整为 ${outcome.actualMinute}`].filter(Boolean).join('；');
          }
          task.note = [task.note, `草稿已确认保存（${outcome.saveOutcome?.kind || 'remote'}）`].filter(Boolean).join('；');
          task.status = 'done'; succeeded++;
          scheduleBatchRender({aux:false});
          await sleep(300);
        } catch (error) {
          console.error(`[${APP}] batch source record ${task.sourceRow}`, error);
          task.status = 'error'; task.runtimeError = error.message || String(error); failed++; scheduleBatchRender({aux:false});
          setBatchStatus(`任务 ${task.id} 失败，已自动停止：${task.runtimeError}。为避免页面状态异常导致串稿，不继续执行后续任务。`, 'error');
          break;
        }
      }
      const remaining = batch.tasks.filter(t => executableKeys.has(t.editKey) && t.status === 'ready').length;
      if (batch.stopRequested) setBatchStatus(`已停止。成功 ${succeeded}，失败 ${failed}，剩余 ${remaining}。`, 'warn');
      else if (failed) setBatchStatus(`批量处理结束：成功 ${succeeded}，失败 ${failed}。请查看预览状态。`, 'warn');
      else setBatchStatus(`批量处理完成：成功创建并保存 ${succeeded} 封草稿。`, 'ok');
    } finally {
      batch.running = false; batchStopEl.disabled = true;
      importFileEl.disabled = false; if (importDirEl) importDirEl.disabled = false; if (importPackageEl) importPackageEl.disabled = false; if (rosterFileEl) rosterFileEl.disabled = false; collectionSelectEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; sharedFilesEl.disabled = false; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=false; });
      setBatchPlanningLocked(false);
      scheduleBatchRender({aux:false});
    }
  });

  restoreFormState();
  invalidateBatchView(true);
  initContacts();
  console.info(`[${APP}] standalone workspace v2.2.0 decision workflow loaded`);
})();
