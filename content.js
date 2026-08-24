(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const STORAGE_KEY = 'nmda.form.v2';
  const BATCH_FILTER_STORAGE_KEY = 'nmda.batch.filter.v1';
  const DEFAULT_TIMEOUT = 10000;
  const Importer = globalThis.NMDAImporter;
  const Contacts = globalThis.NMDAContacts;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  async function waitFor(fn, timeout = DEFAULT_TIMEOUT, interval = 120, message = '等待页面元素超时') {
    const start = Date.now();
    let lastError;
    while (Date.now() - start < timeout) {
      try {
        const value = fn();
        if (value) return value;
      } catch (error) { lastError = error; }
      await sleep(interval);
    }
    if (lastError) throw lastError;
    throw new Error(message || '等待页面状态超时');
  }

  function nativeSetValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function fire(el, type, options = {}) {
    let event;
    if (type.startsWith('key')) event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options });
    else event = new Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function compactText(valueOrEl) {
    const value = typeof valueOrEl === 'string' ? valueOrEl : textOf(valueOrEl);
    return String(value || '').replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]+/g, '');
  }

  function hasUiText(el, text) {
    const target = compactText(text);
    const actual = compactText(el);
    return !!target && (actual === target || actual.includes(target));
  }

  function findComposeRoot() {
    const semantic = [...document.querySelectorAll('[role="main"]')]
      .find(el => visible(el) && compactText(el.getAttribute('aria-label') || '').includes('写信'));
    if (semantic) return semantic;
    const moduleRoot = [...document.querySelectorAll('[id^="_dvModuleContainer_compose.ComposeModule_"]')].find(visible);
    if (moduleRoot) return moduleRoot;
    const subject = [...document.querySelectorAll('input[id$="_subjectInput"]')].find(visible);
    const recipient = [...document.querySelectorAll('input[aria-label^="收件人地址输入框"]')].find(visible);
    const anchor = subject || recipient;
    return anchor
      ? anchor.closest('[role="main"]') || anchor.closest('[id^="_dvModuleContainer_compose.ComposeModule_"]') || document
      : null;
  }

  function composeFingerprint(root = findComposeRoot()) {
    if (!root) return '';
    const subject = root.querySelector?.('input[id$="_subjectInput"]');
    const recipient = root.querySelector?.('input[aria-label^="收件人地址输入框"]');
    return subject?.id || recipient?.parentElement?.id || root.id || decodeURIComponent(location.hash || '');
  }

  async function tryOpenComposeViaPageApi() {
    try {
      return await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_COMPOSE' }) || { ok: false, reason: 'empty-response' };
    } catch (error) {
      return { ok: false, reason: error?.message || String(error) };
    }
  }

  function findWriteButton() {
    const navRoot = document.querySelector('#dvNavTop') || document.querySelector('#dvNavContainer') || document;
    const selectors = 'li[role="button"],button,[role="button"],a[role="button"]';
    let button = [...navRoot.querySelectorAll(selectors)].filter(visible).find(el => {
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      return hasUiText(el, '写信') || compactText(aria).includes('写信') || compactText(title).includes('写信');
    }) || null;
    if (button) return button;
    button = document.querySelector('#_mail_component_98_98');
    if (button && visible(button)) return button;
    return [...document.querySelectorAll(selectors)].filter(visible).find(el => hasUiText(el, '写信')) || null;
  }

  function navButtonDiagnostics() {
    const navRoot = document.querySelector('#dvNavTop') || document.querySelector('#dvNavContainer') || document;
    return [...navRoot.querySelectorAll('[role="button"],li,button')].filter(visible).slice(0, 12)
      .map(el => `${el.id || el.tagName}:${JSON.stringify(textOf(el))}`).join(' | ');
  }

  async function openCompose() {
    let root = findComposeRoot();
    if (root) return root;
    const apiResult = await tryOpenComposeViaPageApi();
    if (apiResult.ok) {
      try {
        root = await waitFor(findComposeRoot, 9000, 120, '');
        if (root) return root;
      } catch (_) {}
    }
    const writeButton = findWriteButton();
    if (!writeButton) throw new Error(`没有找到“写信”入口。页面接口：${apiResult.reason || '不可用'}。可见导航：${navButtonDiagnostics() || '无'}`);
    writeButton.click();
    return waitFor(findComposeRoot, 12000, 120, '点击“写信”后未检测到写信页面。');
  }

  async function openFreshCompose() {
    const beforeRoot = findComposeRoot();
    const before = composeFingerprint(beforeRoot);
    const isFresh = () => {
      const root = findComposeRoot();
      if (!root) return null;
      const now = composeFingerprint(root);
      if (!beforeRoot || !before || (now && now !== before)) return root;
      return null;
    };

    const apiResult = await tryOpenComposeViaPageApi();
    if (apiResult.ok) {
      try { return await waitFor(isFresh, 10000, 120, ''); }
      catch (_) {}
    }

    const writeButton = findWriteButton();
    if (!writeButton) throw new Error(`无法新建下一封写信。页面接口：${apiResult.reason || '不可用'}。`);
    writeButton.click();
    return waitFor(isFresh, 12000, 120, '已触发“写信”，但没有检测到新的 Compose 实例；为避免覆盖上一封草稿，批处理已停止。');
  }

  function findRecipientInput(root) {
    return root.querySelector('input[aria-label^="收件人地址输入框"]')
      || [...root.querySelectorAll('input[type="text"]')].find(el => (el.getAttribute('aria-label') || '').includes('收件人'))
      || null;
  }

  async function setRecipients(root, raw) {
    const addresses = String(raw || '').split(/[;,，；\n]+/).map(s => s.trim()).filter(Boolean);
    if (!addresses.length) return;
    const input = await waitFor(() => findRecipientInput(root), 8000, 100, '未找到收件人输入框。');
    input.focus();
    nativeSetValue(input, `${addresses.join(';')};`);
    fire(input, 'input');
    fire(input, 'change');
    await sleep(100);
    fire(input, 'blur');
    await sleep(350);
  }

  function findSubjectInput(root) {
    return root.querySelector('input[id$="_subjectInput"]')
      || [...root.querySelectorAll('input')].find(el => compactText(el.getAttribute('aria-label') || '').includes('主题'))
      || null;
  }

  async function setSubject(root, subject) {
    const input = await waitFor(() => findSubjectInput(root), 8000, 100, '未找到主题输入框。');
    input.focus();
    nativeSetValue(input, subject || '');
    fire(input, 'input'); fire(input, 'change'); fire(input, 'blur');
  }

  function findEditorIframe(root) {
    const editorFrame = [...root.querySelectorAll('div[id^="_mail_editor_"] iframe')].find(visible);
    if (editorFrame) return editorFrame;
    return [...root.querySelectorAll('iframe')].filter(visible).sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0] || null;
  }

  function plainTextToHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  async function setBody(root, bodyText) {
    const iframe = await waitFor(() => findEditorIframe(root), 8000, 120, '未找到正文编辑器 iframe。');
    const body = await waitFor(() => {
      try { return iframe.contentDocument?.body || null; } catch (_) { return null; }
    }, 8000, 120, '无法访问正文编辑器内容。');
    body.focus();
    body.innerHTML = plainTextToHtml(bodyText || '');
    fire(body, 'input'); fire(body, 'change'); fire(body, 'blur');
  }

  function findAttachmentInput(root) {
    return root.querySelector('div[id$="_attachBrowser"] > input[type="file"]')
      || [...root.querySelectorAll('input[type="file"]')].find(el => el.closest('[id$="_attachBrowser"]'))
      || root.querySelector('input[type="file"]') || null;
  }

  function uniqueFiles(files) {
    const map = new Map();
    for (const file of files || []) {
      if (!file) continue;
      const key = Importer?.fileIdentity?.(file) || `${file.name}|${file.size}|${file.lastModified}`;
      if (!map.has(key)) map.set(key, file);
    }
    return [...map.values()];
  }

  function attachmentNameVisible(root, fileName) {
    const wanted = compactText(fileName).toLowerCase();
    if (!wanted) return false;
    const nodes = root.querySelectorAll('a,span,div,li,p,[title],[aria-label]');
    for (const el of nodes) {
      if (el.matches?.('input[type="file"], [id$="_attachBrowser"]')) continue;
      const text = compactText(`${textOf(el)} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('aria-label') || ''}`).toLowerCase();
      if (text.includes(wanted)) return true;
    }
    return false;
  }

  async function waitAttachmentEvidence(root, files, timeout = 9000) {
    const start = Date.now();
    let missing = [...files];
    while (Date.now() - start < timeout) {
      missing = files.filter(file => !attachmentNameVisible(root, file.name));
      if (!missing.length) return { verified: true, missing: [] };
      await sleep(250);
    }
    return { verified: false, missing };
  }

  async function injectFilesIntoInput(input, files) {
    const dt = new DataTransfer();
    files.forEach(file => dt.items.add(file));
    try { input.files = dt.files; }
    catch (error) { throw new Error(`无法把附件交给网易上传控件：${error.message}`); }
    fire(input, 'input');
    fire(input, 'change');
  }

  async function addAttachments(root, files, onProgress = () => {}) {
    const selected = uniqueFiles(files);
    if (!selected.length) return { verified: true, missing: [], mode: 'none' };
    let input = await waitFor(() => findAttachmentInput(root), 8000, 120, '未找到网易邮箱附件控件。');

    // 优先模拟用户在文件选择器中一次多选：速度更快，也更贴近真实上传。
    if (input.multiple || selected.length === 1) {
      await injectFilesIntoInput(input, selected);
      onProgress(selected.length, selected.length, selected.map(file => file.name).join('、'));
      await sleep(450);
      const evidence = await waitAttachmentEvidence(root, selected);
      return { ...evidence, mode: 'multi' };
    }

    // 如果网易当前实例的 input 没有 multiple，则逐个交给控件；每次重新寻找 input，
    // 因为网易可能在一次上传后替换该 DOM 节点。
    for (let i = 0; i < selected.length; i++) {
      input = await waitFor(() => findAttachmentInput(root), 8000, 120, '附件上传过程中网易附件控件消失。');
      await injectFilesIntoInput(input, [selected[i]]);
      onProgress(i + 1, selected.length, selected[i].name);
      await sleep(550);
    }
    const evidence = await waitAttachmentEvidence(root, selected);
    return { ...evidence, mode: 'sequential' };
  }

  function findMoreSendOptions(root) {
    return [...root.querySelectorAll('a,[role="link"],button,[role="button"]')].filter(visible).find(el => hasUiText(el, '更多发送选项')) || null;
  }

  function findScheduleCheckbox(root) {
    const aria = [...root.querySelectorAll('[role="checkbox"]')].find(el => visible(el) && (
      compactText(el.getAttribute('aria-label') || '').includes('定时发送') || hasUiText(el, '定时发送')
    ));
    if (aria) return aria;
    const text = [...root.querySelectorAll('a,button,div,span,label')].filter(visible).find(el => hasUiText(el, '定时发送'));
    return text ? text.closest('[role="checkbox"]') || text : null;
  }

  function scheduleFields(root) {
    return {
      year: root.querySelector('select[id$="_scheduleYear"]'), month: root.querySelector('select[id$="_scheduleMonth"]'),
      day: root.querySelector('select[id$="_scheduleDay"]'), hour: root.querySelector('select[id$="_scheduleHour"]'),
      minute: root.querySelector('select[id$="_scheduleMinute"]')
    };
  }

  function allScheduleFieldsVisible(root) {
    return Object.values(scheduleFields(root)).every(el => el && visible(el));
  }

  async function ensureScheduleEnabled(root) {
    if (allScheduleFieldsVisible(root)) return;
    const more = findMoreSendOptions(root);
    if (more) { more.click(); await sleep(220); }
    let checkbox = findScheduleCheckbox(root);
    if (!checkbox) checkbox = await waitFor(() => findScheduleCheckbox(root), 3000, 120, '未找到“定时发送”选项。');
    if (!allScheduleFieldsVisible(root)) {
      checkbox.click();
      try { await waitFor(() => allScheduleFieldsVisible(root), 2500, 120, ''); }
      catch (_) {
        checkbox.click();
        await waitFor(() => allScheduleFieldsVisible(root), 3500, 120, '启用定时发送后没有出现日期时间控件。');
      }
    }
  }

  function setSelectValue(select, desired) {
    if (!select) throw new Error('定时发送下拉框不存在。');
    const values = [...select.options].map(o => o.value);
    let value = String(desired);
    if (!values.includes(value)) {
      const numeric = values.map(v => ({ v, n: Number(v) })).filter(x => Number.isFinite(x.n));
      if (!numeric.length) throw new Error(`下拉框不存在可用值：${desired}`);
      numeric.sort((a, b) => Math.abs(a.n - Number(desired)) - Math.abs(b.n - Number(desired)));
      value = numeric[0].v;
    }
    nativeSetValue(select, value); fire(select, 'input'); fire(select, 'change');
    return value;
  }

  async function setSchedule(root, datetimeLocal) {
    if (!datetimeLocal) throw new Error('已启用定时发送，但没有填写定时时间。');
    const date = new Date(datetimeLocal);
    if (Number.isNaN(date.getTime())) throw new Error('定时时间格式无效。');
    await ensureScheduleEnabled(root);
    const fields = scheduleFields(root);
    setSelectValue(fields.year, date.getFullYear());
    setSelectValue(fields.month, date.getMonth() + 1);
    setSelectValue(fields.day, date.getDate());
    setSelectValue(fields.hour, date.getHours());
    const actualMinute = setSelectValue(fields.minute, date.getMinutes());
    await sleep(180);
    return actualMinute;
  }

  function findSaveDraftButton(root) {
    return [...root.querySelectorAll('[role="button"],button,div')].filter(visible).find(el => {
      const txt = compactText(el), aria = compactText(el.getAttribute('aria-label') || '');
      return txt === '存草稿' || aria === '存草稿';
    }) || null;
  }

  function isDraftRoute() {
    try { return decodeURIComponent(location.hash || '').includes('"type":"draft"'); }
    catch (_) { return false; }
  }

  async function saveDraft(root) {
    const button = await waitFor(() => findSaveDraftButton(root), 5000, 120, '未找到“存草稿”按钮。');
    button.click();
    try { await waitFor(isDraftRoute, 2200, 100, ''); return true; }
    catch (_) { await sleep(500); return false; }
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
              <div class="nmda-subtitle">草稿 · 批量 · 分类 · 联系人</div>
            </div>
          </div>
          <div class="nmda-head-actions">
            <span class="nmda-safe-badge">只建草稿 · 不自动发送</span>
            <button class="nmda-icon-btn" id="nmda-expand" type="button" title="全屏 / 还原">⛶</button>
            <button class="nmda-icon-btn" id="nmda-collapse" type="button" title="收起工作台">—</button>
            <button class="nmda-icon-btn nmda-close" id="nmda-close" type="button" title="关闭">×</button>
          </div>
        </header>

        <nav class="nmda-tabs" aria-label="工作台模块">
          <div class="nmda-nav-label">工作区</div>
          <button class="nmda-tab is-active" data-tab="single" type="button"><span class="nmda-tab-icon">✎</span><span><strong>单封草稿</strong><small>快速填写一封</small></span></button>
          <button class="nmda-tab" data-tab="batch" type="button"><span class="nmda-tab-icon">▦</span><span><strong>批量任务</strong><small>导入、筛选、执行</small></span></button>
          <button class="nmda-tab" data-tab="contacts" type="button"><span class="nmda-tab-icon">◎</span><span><strong>联系人</strong><small>分类与历史</small></span></button>
          <div class="nmda-nav-foot">
            <div class="nmda-nav-foot-title">当前原则</div>
            <div>逐封创建新 Compose</div>
            <div>附件先预检再执行</div>
            <div>失败优先停下而非串稿</div>
          </div>
        </nav>

        <main class="nmda-main">
          <div class="nmda-page-head" data-page-head="single">
            <div><h2>单封草稿</h2><p>快速填充一封邮件，并可加入附件与定时时间。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="single">
            <div class="nmda-single-grid">
              <div class="nmda-card nmda-compose-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">MESSAGE</div><div class="nmda-card-title">邮件内容</div></div></div>
                <label class="nmda-field"><span class="nmda-label">收件人</span><textarea id="nmda-recipients" placeholder="a@example.com; b@example.com"></textarea><span class="nmda-hint">多人可用分号、逗号或换行分隔</span></label>
                <label class="nmda-field"><span class="nmda-label">主题</span><input id="nmda-subject" type="text" placeholder="邮件主题"></label>
                <label class="nmda-field nmda-grow-field"><span class="nmda-label">正文</span><textarea id="nmda-body-text" placeholder="邮件正文"></textarea></label>
              </div>

              <aside class="nmda-side-stack">
                <div class="nmda-card">
                  <div class="nmda-card-head"><div><div class="nmda-card-kicker">ATTACHMENTS</div><div class="nmda-card-title">附件</div></div></div>
                  <label class="nmda-field"><input id="nmda-files" type="file" multiple><span class="nmda-hint">文件仅保存在当前页面内存；刷新后需重新选择</span></label>
                </div>
                <div class="nmda-card">
                  <div class="nmda-card-head"><div><div class="nmda-card-kicker">SCHEDULE</div><div class="nmda-card-title">定时设置</div></div></div>
                  <div class="nmda-row"><label><input id="nmda-schedule-enabled" type="checkbox"> 设置定时发送</label></div>
                  <label class="nmda-field"><span class="nmda-label">定时时间</span><input id="nmda-schedule-at" type="datetime-local"></label>
                  <div class="nmda-row"><label><input id="nmda-auto-save" type="checkbox"> 填入后自动存草稿</label></div>
                </div>
                <div class="nmda-card nmda-action-card">
                  <div class="nmda-actions"><button class="nmda-btn" id="nmda-open-compose" type="button">只打开写信</button><button class="nmda-btn nmda-btn-primary" id="nmda-fill" type="button">填入草稿</button></div>
                  <div id="nmda-status">准备就绪。</div>
                </div>
              </aside>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="batch" hidden>
            <div><h2>批量任务</h2><p>从任务表导入，到附件匹配、联系人分类筛选和顺序建草稿。</p></div>
            <div class="nmda-stage-strip" aria-label="批量流程"><span>1 导入</span><span>2 映射</span><span>3 附件</span><span>4 筛选</span><span>5 执行</span></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="batch" hidden>
            <div class="nmda-batch-setup-grid">
              <div class="nmda-card" id="nmda-import-card">
                <div class="nmda-card-head"><div><div class="nmda-step-index">01</div><div><div class="nmda-card-title">导入任务表</div><div class="nmda-card-desc">XLSX / CSV / TSV / JSON</div></div></div></div>
                <input id="nmda-import-file" type="file" accept=".xlsx,.xls,.csv,.tsv,.json,.txt">
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-template" type="button">下载 CSV 模板</button><span class="nmda-hint">旧 .xls 请先另存为 XLSX/CSV</span></div>
              </div>

              <div class="nmda-card" id="nmda-sheet-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">02</div><div><div class="nmda-card-title">识别与字段映射</div><div class="nmda-card-desc">自动识别，可人工校正</div></div></div></div>
                <label class="nmda-field"><span class="nmda-label">工作表</span><select id="nmda-sheet-select"></select></label>
                <div id="nmda-header-info" class="nmda-hint"></div>
                <div id="nmda-mapping" class="nmda-mapping"></div>
              </div>

              <div class="nmda-card" id="nmda-attachments-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">03</div><div><div class="nmda-card-title">附件中心</div><div class="nmda-card-desc">公共附件 + 专属附件 + 目录匹配</div></div></div></div>
                <div id="nmda-attachment-summary" class="nmda-summary">导入任务后会统计需要匹配的附件。</div>
                <div class="nmda-attachment-grid">
                  <label class="nmda-file-source"><span class="nmda-label">专属附件</span><span class="nmda-hint">一次多选所有文件</span><input id="nmda-attachment-files" type="file" multiple></label>
                  <label class="nmda-file-source"><span class="nmda-label">附件总目录</span><span class="nmda-hint">支持相对路径</span><input id="nmda-attachment-dir" type="file" webkitdirectory multiple></label>
                  <label class="nmda-file-source nmda-file-source-shared"><span class="nmda-label">公共附件</span><span class="nmda-hint">每封邮件都添加</span><input id="nmda-shared-files" type="file" multiple></label>
                </div>
                <div id="nmda-attachment-drop" class="nmda-attachment-drop">拖入专属附件文件</div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-clear-attachments" type="button">清空附件</button><span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span></div>
                <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden>
                  <div class="nmda-card-subtitle">需要确认的附件</div>
                  <div class="nmda-hint">存在缺失或歧义时，在这里指定一次，本批次复用。</div>
                  <div id="nmda-attachment-resolution-list"></div>
                </div>
              </div>
            </div>

            <div class="nmda-card nmda-list-card" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-step-index">04</div><div><div class="nmda-card-title">发送列表</div><div class="nmda-card-desc">检索、分类筛选和发送范围在同一张任务表中完成</div></div></div><div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div></div>
              <div class="nmda-search-bar">
                <label class="nmda-field nmda-search-field"><span class="nmda-label">检索任务</span><input id="nmda-batch-search" type="search" placeholder="编号 / 收件人 / 主题 / 正文 / 分类 / 附件 / 定时时间"></label>
                <div class="nmda-search-help">检索会即时缩小当前列表，也可直接作为“本次执行范围”。</div>
              </div>
              <div class="nmda-filter-bar">
                <label class="nmda-field"><span class="nmda-label">包含分类</span><input id="nmda-batch-tag-include" type="text" placeholder="已回复;重点;第一批"></label>
                <label class="nmda-field nmda-compact-field"><span class="nmda-label">匹配方式</span><select id="nmda-batch-tag-mode"><option value="any">包含任一</option><option value="all">同时包含</option></select></label>
                <label class="nmda-field"><span class="nmda-label">排除分类</span><input id="nmda-batch-tag-exclude" type="text" placeholder="暂停;不再联系"></label>
                <button class="nmda-btn nmda-btn-small" id="nmda-clear-tag-filter" type="button">清除检索/筛选</button>
              </div>
              <div id="nmda-batch-tag-chips" class="nmda-tag-chips"></div>
              <div class="nmda-bulk-editor">
                <input id="nmda-bulk-tag-value" type="text" placeholder="批量自定义分类，如 第一批;重点">
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-add-tag" type="button">+ 分类</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-remove-tag" type="button">− 分类</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">纳入发送</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-disable" type="button">排除发送</button>
              </div>
              <div class="nmda-table-wrap nmda-batch-table-wrap"><table class="nmda-table nmda-batch-table"><thead><tr><th>发送</th><th>#</th><th>收件人</th><th>分类</th><th>定时时间</th><th>主题</th><th>附件</th><th>任务状态</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
            </div>

            <div class="nmda-card nmda-run-card" id="nmda-run-card" hidden>
              <div class="nmda-run-left"><div class="nmda-step-index">05</div><div><div class="nmda-card-title">顺序创建草稿</div><div id="nmda-batch-status" class="nmda-run-status">请先导入并确认预检结果。</div></div></div>
              <div class="nmda-run-controls">
                <label class="nmda-continue-toggle"><input id="nmda-continue-on-error" type="checkbox" checked> 单封失败后继续</label>
                <fieldset class="nmda-run-scope" aria-label="本次执行范围">
                  <legend>本次执行范围</legend>
                  <label class="nmda-scope-option"><input type="radio" name="nmda-run-scope" value="enabled" checked><span>全部已纳入任务</span><strong id="nmda-run-scope-all-count">0</strong></label>
                  <label class="nmda-scope-option"><input type="radio" name="nmda-run-scope" value="filtered"><span>仅当前检索/筛选结果</span><strong id="nmda-run-scope-filtered-count">0</strong></label>
                </fieldset>
                <div class="nmda-run-scope-note">这里只决定“这一次执行哪些已勾选任务”，不会修改列表里的发送勾选状态。</div>
                <button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">开始批量建草稿</button>
                <button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封后停止</button>
              </div>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="contacts" hidden>
            <div><h2>联系人</h2><p>用统一“分类”管理互动阶段、跟进、发送策略、自定义分类与历史。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="contacts" hidden>
            <div class="nmda-crm-top-grid">
              <div class="nmda-card nmda-mail-history-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">MAIL HISTORY</div><div class="nmda-card-title">邮箱历史同步</div></div></div>
                <div class="nmda-history-range">
                  <label class="nmda-field nmda-inline-field"><span class="nmda-label">读取范围</span><select id="nmda-mail-history-limit"><option value="50">最近 50 封</option><option value="100">最近 100 封</option><option value="200" selected>最近 200 封</option><option value="500">最近 500 封</option><option value="1000">最近 1000 封</option><option value="2000">最近 2000 封</option><option value="all">全部</option></select></label>
                  <span class="nmda-hint">超过 200 封时自动分页读取；“全部”最多保护性读取 10,000 封。</span>
                </div>
                <div class="nmda-history-actions">
                  <div class="nmda-history-source"><div><strong>已发送</strong><small>用于确认真实联系历史，并推进“未联系 → 已发送”</small></div><div class="nmda-row"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-read-sent" type="button">读取已发送</button><button class="nmda-btn nmda-btn-small" id="nmda-open-sent" type="button">打开</button></div></div>
                  <div class="nmda-history-source"><div><strong>草稿箱</strong><small>只记录“已准备未发送”，不会自动变成“已发送”</small></div><div class="nmda-row"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-read-drafts" type="button">读取草稿箱</button><button class="nmda-btn nmda-btn-small" id="nmda-open-drafts" type="button">打开</button></div></div>
                </div>
                <div id="nmda-contact-status" class="nmda-summary">正在初始化当前邮箱的联系人分类库…</div>
              </div>
              <div class="nmda-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">CONTACT BOOK</div><div class="nmda-card-title">联系人操作</div></div></div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-sync-batch-contacts" type="button">同步当前批量名单/分类</button><button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出联系人 CSV</button></div>
                <div class="nmda-hint">分类模型：互动阶段（单选）+ 待跟进（标记）+ 发送策略（单选）+ 自定义分类。暂停/不再联系会自动拦截批量任务。</div>
              </div>
            </div>

            <div class="nmda-card nmda-contact-list-card">
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-card-title">联系人列表</div><div class="nmda-card-desc">一个分类入口统一编辑阶段、跟进、发送策略和长期自定义分类</div></div><div id="nmda-contact-summary" class="nmda-summary nmda-summary-inline">0 个联系人</div></div>
              <div class="nmda-contact-toolbar nmda-contact-toolbar-unified">
                <input id="nmda-contact-search" type="text" placeholder="搜索邮箱 / 姓名 / 发送主题 / 草稿主题 / 分类">
                <input id="nmda-contact-class-filter" type="text" placeholder="分类筛选：已回复;待跟进;重点">
                <select id="nmda-contact-class-mode"><option value="any">匹配任一</option><option value="all">同时包含</option></select>
              </div>
              <div id="nmda-contact-class-chips" class="nmda-tag-chips nmda-class-chip-bar"></div>
              <div class="nmda-table-wrap nmda-contact-table-wrap"><table class="nmda-table nmda-contact-table"><thead><tr><th>联系人</th><th>分类</th><th>已发送</th><th>草稿</th><th>最后发送</th><th>最后草稿</th><th>最近发送主题</th></tr></thead><tbody id="nmda-contact-body"></tbody></table></div>
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
  const recipientsEl = $('nmda-recipients'), subjectEl = $('nmda-subject'), bodyEl = $('nmda-body-text'), filesEl = $('nmda-files');
  const scheduleEnabledEl = $('nmda-schedule-enabled'), scheduleAtEl = $('nmda-schedule-at'), autoSaveEl = $('nmda-auto-save');
  const fillButton = $('nmda-fill'), openButton = $('nmda-open-compose'), statusEl = $('nmda-status');

  const contactBook = { account: '', contacts: {}, loaded: false };

  async function detectAccount() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_ACCOUNT_INFO' });
      if (result?.ok && result.uid) return Contacts?.normalizeEmail?.(result.uid) || String(result.uid).toLowerCase();
    } catch (_) {}
    const text = document.querySelector('#spnUid')?.textContent || '';
    return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || 'default';
  }

  async function ensureContactBook(force = false) {
    if (!Contacts) return contactBook;
    const account = await detectAccount();
    if (force || !contactBook.loaded || contactBook.account !== account) {
      contactBook.account = account;
      contactBook.contacts = await Contacts.load(account);
      contactBook.loaded = true;
    }
    return contactBook;
  }

  async function persistContacts() {
    if (!Contacts || !contactBook.loaded) return;
    await Contacts.save(contactBook.account, contactBook.contacts);
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

  function contactClassificationChips(contact) {
    return (Contacts?.classificationItems?.(contact) || []).map(classificationChipHtml).join('');
  }

  function setContactStatusMessage(message, kind = '') {
    const el = $('nmda-contact-status');
    if (!el) return;
    el.textContent = message;
    if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
  }

  function renderContacts() {
    if (!Contacts) return;
    const body = $('nmda-contact-body');
    const summary = $('nmda-contact-summary');
    const chipBar = $('nmda-contact-class-chips');
    if (!body || !summary) return;
    const query = String($('nmda-contact-search')?.value || '').trim().toLowerCase();
    const classFilter = Contacts.parseTags($('nmda-contact-class-filter')?.value || '').map(value => value.toLocaleLowerCase('zh-CN'));
    const classMode = $('nmda-contact-class-mode')?.value || 'any';
    let list = Object.values(contactBook.contacts || {}).map(contact => Contacts.normalizeContactShape(contact));
    if (classFilter.length) list = list.filter(contact => {
      const own = new Set(Contacts.classificationLabels(contact).map(value => value.toLocaleLowerCase('zh-CN')));
      return classMode === 'all' ? classFilter.every(value => own.has(value)) : classFilter.some(value => own.has(value));
    });
    if (query) list = list.filter(contact => `${contact.email} ${contact.name || ''} ${contact.lastSubject || ''} ${contact.lastDraftSubject || ''} ${Contacts.classificationLabels(contact).join(' ')}`.toLowerCase().includes(query));
    list.sort((a, b) => {
      const ta = Math.max(Date.parse(a.lastSentAt || '') || 0, Date.parse(a.lastDraftAt || '') || 0);
      const tb = Math.max(Date.parse(b.lastSentAt || '') || 0, Date.parse(b.lastDraftAt || '') || 0);
      return tb - ta || String(a.email).localeCompare(String(b.email));
    });

    const all = Object.values(contactBook.contacts || {}).map(contact => Contacts.normalizeContactShape(contact));
    const stageCounts = Object.fromEntries(Contacts.STAGE_OPTIONS.map(stage => [stage, 0]));
    let followCount = 0, pausedCount = 0, noContactCount = 0, withDraftCount = 0;
    const classCounts = new Map();
    for (const contact of all) {
      stageCounts[contact.stage] = (stageCounts[contact.stage] || 0) + 1;
      if (contact.followUp) followCount++;
      if (contact.policy === '暂停') pausedCount++;
      if (contact.policy === '不再联系') noContactCount++;
      if (Number(contact.draftCount || 0) > 0) withDraftCount++;
      for (const value of Contacts.classificationLabels(contact)) classCounts.set(value, (classCounts.get(value) || 0) + 1);
    }
    summary.textContent = `${all.length} 个联系人 · ${Contacts.STAGE_OPTIONS.map(stage => `${stage} ${stageCounts[stage] || 0}`).join(' · ')} · 有草稿 ${withDraftCount} · 待跟进 ${followCount} · 暂停 ${pausedCount} · 不再联系 ${noContactCount}`;

    if (chipBar) {
      const top = [...classCounts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 40);
      chipBar.innerHTML = top.length ? top.map(([value,count]) => `<button type="button" class="nmda-tag-chip" data-contact-class-chip="${escapeHtml(value)}">${escapeHtml(value)} <small>${count}</small></button>`).join('') : '<span class="nmda-hint">暂无分类。</span>';
      chipBar.querySelectorAll('[data-contact-class-chip]').forEach(button => button.addEventListener('click', () => {
        const input = $('nmda-contact-class-filter');
        const now = Contacts.parseTags(input.value);
        const clicked = button.dataset.contactClassChip;
        const key = clicked.toLocaleLowerCase('zh-CN');
        const exists = now.some(value => value.toLocaleLowerCase('zh-CN') === key);
        input.value = exists ? now.filter(value => value.toLocaleLowerCase('zh-CN') !== key).join(';') : Contacts.mergeTags(now, [clicked]).join(';');
        renderContacts();
      }));
    }

    body.innerHTML = list.slice(0, 1000).map(contact => `
      <tr>
        <td><strong>${escapeHtml(contact.name || contact.email)}</strong><small>${escapeHtml(contact.name ? contact.email : '')}</small></td>
        <td class="nmda-contact-class-cell">
          <div class="nmda-class-preview">${contactClassificationChips(contact)}</div>
          <div class="nmda-class-editor">
            <label><span>阶段</span><select class="nmda-class-select" data-contact-stage="${escapeHtml(contact.email)}">${Contacts.STAGE_OPTIONS.map(stage => `<option value="${escapeHtml(stage)}" ${contact.stage === stage ? 'selected' : ''}>${escapeHtml(stage)}</option>`).join('')}</select></label>
            <label class="nmda-followup-toggle"><input type="checkbox" data-contact-followup="${escapeHtml(contact.email)}" ${contact.followUp ? 'checked' : ''}> 待跟进</label>
            <label><span>策略</span><select class="nmda-class-select" data-contact-policy="${escapeHtml(contact.email)}">${Contacts.POLICY_OPTIONS.map(policy => `<option value="${escapeHtml(policy)}" ${contact.policy === policy ? 'selected' : ''}>${escapeHtml(policy)}</option>`).join('')}</select></label>
            <label class="nmda-class-tags"><span>自定义分类</span><input class="nmda-contact-tags-input" data-contact-tags-email="${escapeHtml(contact.email)}" value="${escapeHtml(tagsText(contact.tags))}" placeholder="重点;第一批"></label>
          </div>
        </td>
        <td>${Number(contact.sentCount || 0)}</td>
        <td><strong>${Number(contact.draftCount || 0)}</strong>${Number(contact.draftCount || 0) > 0 ? '<small>当前已识别</small>' : ''}</td>
        <td title="${escapeHtml(contact.lastSentAt || '')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastSentAt))}</td>
        <td title="${escapeHtml(contact.lastDraftAt || '')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastDraftAt))}${contact.lastDraftSubject ? `<small title="${escapeHtml(contact.lastDraftSubject)}">${escapeHtml(contact.lastDraftSubject)}</small>` : ''}</td>
        <td title="${escapeHtml(contact.lastSubject || '')}">${escapeHtml(contact.lastSubject || '—')}</td>
      </tr>`).join('');
    if (!list.length) body.innerHTML = '<tr><td colspan="7">暂无匹配联系人。可读取“已发送”、草稿箱或同步当前批量名单。</td></tr>';
    else if (list.length > 1000) body.insertAdjacentHTML('beforeend', `<tr><td colspan="7">当前显示前 1000 个匹配联系人，共 ${list.length} 个。可用搜索或分类缩小范围。</td></tr>`);

    body.querySelectorAll('select[data-contact-stage]').forEach(select => select.addEventListener('change', async () => {
      Contacts.setStage(contactBook.contacts, select.dataset.contactStage, select.value);
      await persistContacts(); renderContacts(); if (typeof renderPreview === 'function') rebuildTasks();
      setContactStatusMessage(`已更新 ${select.dataset.contactStage} 的互动阶段：${select.value}。`, 'ok');
    }));
    body.querySelectorAll('select[data-contact-policy]').forEach(select => select.addEventListener('change', async () => {
      Contacts.setPolicy(contactBook.contacts, select.dataset.contactPolicy, select.value);
      await persistContacts(); renderContacts(); if (typeof renderPreview === 'function') rebuildTasks();
      setContactStatusMessage(`已更新 ${select.dataset.contactPolicy} 的发送策略：${select.value}。`, select.value === '正常' ? 'ok' : 'warn');
    }));
    body.querySelectorAll('input[data-contact-followup]').forEach(input => input.addEventListener('change', async () => {
      Contacts.setFollowUp(contactBook.contacts, input.dataset.contactFollowup, input.checked);
      await persistContacts(); renderContacts(); if (typeof renderPreview === 'function') renderPreview();
      setContactStatusMessage(`${input.dataset.contactFollowup}${input.checked ? ' 已标记' : ' 已取消'}待跟进。`, 'ok');
    }));
    body.querySelectorAll('input[data-contact-tags-email]').forEach(input => input.addEventListener('change', async () => {
      const contact = Contacts.setTags(contactBook.contacts, input.dataset.contactTagsEmail, input.value);
      await persistContacts(); renderContacts(); if (typeof renderPreview === 'function') renderPreview();
      setContactStatusMessage(`已更新 ${input.dataset.contactTagsEmail} 的自定义分类：${tagsText(contact?.tags) || '无'}。`, 'ok');
    }));
  }

  async function initContacts() {
    if (!Contacts) { setContactStatusMessage('联系人模块未加载。', 'error'); return; }
    try {
      await ensureContactBook(true);
      renderContacts();
      setContactStatusMessage(`当前邮箱：${contactBook.account}。联系人分类保存在本机浏览器；旧版状态已自动迁移为阶段 / 跟进 / 发送策略。`, 'ok');
      if (typeof renderPreview === 'function') renderPreview();
    } catch (error) {
      setContactStatusMessage(`联系人初始化失败：${error.message}`, 'error');
    }
  }

  function setStatus(message, kind = '') {
    statusEl.textContent = message;
    if (kind) statusEl.dataset.kind = kind; else delete statusEl.dataset.kind;
  }

  function formState() {
    return { recipients: recipientsEl.value, subject: subjectEl.value, body: bodyEl.value, scheduleEnabled: scheduleEnabledEl.checked, scheduleAt: scheduleAtEl.value, autoSave: autoSaveEl.checked };
  }

  async function saveFormState() {
    try { await chrome.storage.local.set({ [STORAGE_KEY]: formState() }); } catch (_) {}
  }

  async function restoreFormState() {
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) return;
      recipientsEl.value = stored.recipients || ''; subjectEl.value = stored.subject || ''; bodyEl.value = stored.body || '';
      scheduleEnabledEl.checked = !!stored.scheduleEnabled; scheduleAtEl.value = stored.scheduleAt || ''; autoSaveEl.checked = !!stored.autoSave;
    } catch (_) {}
  }

  function setWorkbenchTab(name) {
    ui.querySelectorAll('.nmda-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    ui.querySelectorAll('.nmda-tabpane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    ui.querySelectorAll('[data-page-head]').forEach(head => { head.hidden = head.dataset.pageHead !== name; });
  }

  launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('nmda-close').addEventListener('click', () => { panel.hidden = true; });
  $('nmda-collapse').addEventListener('click', () => { panel.hidden = true; });
  $('nmda-expand').addEventListener('click', () => {
    panel.classList.toggle('is-maximized');
    $('nmda-expand').textContent = panel.classList.contains('is-maximized') ? '◱' : '⛶';
    $('nmda-expand').title = panel.classList.contains('is-maximized') ? '还原工作台' : '全屏工作台';
  });
  ui.querySelectorAll('.nmda-tab').forEach(tab => tab.addEventListener('click', () => setWorkbenchTab(tab.dataset.tab)));

  [recipientsEl, subjectEl, bodyEl, scheduleEnabledEl, scheduleAtEl, autoSaveEl].forEach(el => {
    el.addEventListener('change', saveFormState); el.addEventListener('input', saveFormState);
  });

  openButton.addEventListener('click', async () => {
    openButton.disabled = true; setStatus('正在打开写信页…');
    try { await openCompose(); setStatus('写信页已打开。', 'ok'); }
    catch (error) { console.error(`[${APP}]`, error); setStatus(error.message, 'error'); }
    finally { openButton.disabled = false; }
  });

  fillButton.addEventListener('click', async () => {
    fillButton.disabled = true; openButton.disabled = true; await saveFormState();
    try {
      setStatus('1/6 打开写信页…'); const root = await openCompose();
      setStatus('2/6 填写收件人、主题和正文…'); await setRecipients(root, recipientsEl.value); await setSubject(root, subjectEl.value); await setBody(root, bodyEl.value);
      if (filesEl.files.length) {
        setStatus(`3/6 注入附件（0/${filesEl.files.length}）…`);
        const upload = await addAttachments(root, [...filesEl.files], (done, total, name) => setStatus(`3/6 上传附件（${done}/${total}）：${name}`));
        if (!upload.verified) setStatus(`3/6 已提交附件，但页面暂未确认：${upload.missing.map(file => file.name).join('、')}。将继续填写草稿。`, 'warn');
      } else setStatus('3/6 未选择附件，跳过。');
      if (scheduleEnabledEl.checked) {
        setStatus('4/6 设置定时发送…'); const minute = await setSchedule(root, scheduleAtEl.value);
        const requestedMinute = new Date(scheduleAtEl.value).getMinutes();
        if (Number(minute) !== requestedMinute) { setStatus(`4/6 定时已设置；分钟被网易可选项调整为 ${minute} 分。`, 'warn'); await sleep(500); }
      } else setStatus('4/6 未启用定时发送，跳过。');
      if (autoSaveEl.checked) { setStatus('5/6 保存草稿…'); await saveDraft(root); }
      else setStatus('5/6 保持在编辑页，不自动保存。');
      setStatus(autoSaveEl.checked ? '完成：内容已填入并保存为草稿。不会自动发送。' : '完成：内容已填入写信页。请人工检查。', 'ok');
    } catch (error) { console.error(`[${APP}]`, error); setStatus(`失败：${error.message}`, 'error'); }
    finally { fillButton.disabled = false; openButton.disabled = false; }
  });

  const batch = {
    workbook: null, sheetIndex: 0, detection: null, mapping: {}, tasks: [],
    directoryFiles: [], taskFiles: [], sharedFiles: [], fileIndex: Importer?.buildFileIndex?.([]),
    attachmentOverrides: new Map(), taskEdits: new Map(), running: false, stopRequested: false
  };

  const importFileEl = $('nmda-import-file'), sheetSelectEl = $('nmda-sheet-select'), mappingEl = $('nmda-mapping');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files'), sharedFilesEl = $('nmda-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop');
  const batchSearchEl = $('nmda-batch-search');
  const batchTagIncludeEl = $('nmda-batch-tag-include'), batchTagExcludeEl = $('nmda-batch-tag-exclude'), batchTagModeEl = $('nmda-batch-tag-mode');

  function currentSheet() { return batch.workbook?.sheets?.[batch.sheetIndex] || null; }

  function taskEditKey(rowIndex) { return `${batch.sheetIndex}:${rowIndex}`; }

  function parseTaskClassifications(value) {
    const items = Contacts?.parseTags?.(value) || [];
    const reserved = new Set((Contacts?.SYSTEM_CLASSIFICATIONS || []).map(item => item.toLocaleLowerCase('zh-CN')));
    return items.filter(item => !reserved.has(item.toLocaleLowerCase('zh-CN')));
  }

  function taskEffectiveClassifications(task) {
    return Contacts ? Contacts.mergeTags(contactClassificationsForRecipients(task.recipients), parseTaskClassifications(task.tags || [])) : parseTaskClassifications(task.tags || []);
  }

  // Backward-compatible internal alias: v0.7 stored task custom classifications in `tags`.
  function taskEffectiveTags(task) { return taskEffectiveClassifications(task); }

  function normalizedSearchText(value) {
    return String(value || '').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
  }

  function taskMatchesSearch(task) {
    const query = normalizedSearchText(batchSearchEl?.value || '');
    if (!query) return true;
    const haystack = normalizedSearchText([
      task.id,
      task.excelRow,
      task.recipients,
      task.subject,
      task.body,
      task.files?.map(file => file.name).join(' '),
      task.scheduleAt ? task.scheduleAt.replace('T', ' ') : '',
      taskEffectiveClassifications(task).join(' '),
      statusLabel(task)
    ].join(' '));
    return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
  }

  function normalizedTagSet(tags) {
    return new Set((Contacts?.parseTags?.(tags) || []).map(tag => tag.toLocaleLowerCase('zh-CN')));
  }

  function taskMatchesTagFilter(task) {
    if (!taskMatchesSearch(task)) return false;
    const own = normalizedTagSet(taskEffectiveClassifications(task));
    const include = Contacts?.parseTags?.(batchTagIncludeEl?.value || '') || [];
    const exclude = Contacts?.parseTags?.(batchTagExcludeEl?.value || '') || [];
    const mode = batchTagModeEl?.value || 'any';
    const includeKeys = include.map(tag => tag.toLocaleLowerCase('zh-CN'));
    const excludeKeys = exclude.map(tag => tag.toLocaleLowerCase('zh-CN'));
    if (excludeKeys.some(tag => own.has(tag))) return false;
    if (!includeKeys.length) return true;
    return mode === 'all' ? includeKeys.every(tag => own.has(tag)) : includeKeys.some(tag => own.has(tag));
  }

  function filteredBatchTasks() {
    return (batch.tasks || []).filter(taskMatchesTagFilter);
  }

  function setTaskEdit(task, patch) {
    const prev = batch.taskEdits.get(task.editKey) || {};
    const next = { ...prev, ...patch };
    if (patch.tags != null) next.tags = parseTaskClassifications(patch.tags);
    batch.taskEdits.set(task.editKey, next);
    if (patch.enabled != null) task.enabled = !!patch.enabled;
    if (patch.tags != null) task.tags = parseTaskClassifications(patch.tags);
  }

  async function saveBatchFilterState() {
    try { await chrome.storage.local.set({ [BATCH_FILTER_STORAGE_KEY]: { search: batchSearchEl?.value || '', include: batchTagIncludeEl?.value || '', exclude: batchTagExcludeEl?.value || '', mode: batchTagModeEl?.value || 'any' } }); } catch (_) {}
  }

  async function restoreBatchFilterState() {
    try {
      const stored = (await chrome.storage.local.get(BATCH_FILTER_STORAGE_KEY))[BATCH_FILTER_STORAGE_KEY] || {};
      if (batchSearchEl) batchSearchEl.value = stored.search || '';
      if (batchTagIncludeEl) batchTagIncludeEl.value = stored.include || '';
      if (batchTagExcludeEl) batchTagExcludeEl.value = stored.exclude || '';
      if (batchTagModeEl) batchTagModeEl.value = stored.mode === 'all' ? 'all' : 'any';
    } catch (_) {}
  }

  function mappingSelectHtml(field, headers) {
    const selected = batch.mapping[field.key];
    const options = [`<option value="">— 不导入 —</option>`, ...headers.map((header, index) => `<option value="${index}" ${Number(selected) === index ? 'selected' : ''}>${escapeHtml(header || `列${index + 1}`)}</option>`)].join('');
    return `<label class="nmda-map-row"><span>${escapeHtml(field.label)}</span><select data-map-field="${field.key}">${options}</select></label>`;
  }

  function configureSheet(index, useAuto = true) {
    batch.sheetIndex = Number(index) || 0;
    const sheet = currentSheet();
    if (!sheet) return;
    batch.detection = Importer.detectHeader(sheet.rows || []);
    batch.mapping = useAuto ? { ...batch.detection.mapping } : batch.mapping;
    const headers = batch.detection.headers || [];
    $('nmda-header-info').textContent = `识别表头：第 ${batch.detection.index + 1} 行；自动识别 ${Object.keys(batch.detection.mapping).length} 个字段。可在下方人工改列。`;
    mappingEl.innerHTML = Importer.FIELD_DEFS.map(field => mappingSelectHtml(field, headers)).join('');
    mappingEl.querySelectorAll('select[data-map-field]').forEach(select => select.addEventListener('change', () => {
      const field = select.dataset.mapField;
      if (select.value === '') delete batch.mapping[field]; else batch.mapping[field] = Number(select.value);
      rebuildTasks();
    }));
    rebuildTasks();
  }

  function allAttachmentFiles() {
    return uniqueFiles([...batch.directoryFiles, ...batch.taskFiles, ...batch.sharedFiles]);
  }

  function attachmentPoolFiles() {
    return uniqueFiles([...batch.directoryFiles, ...batch.taskFiles]);
  }

  function clearStaleOverrides() {
    const valid = new Set(allAttachmentFiles().map(file => Importer.fileIdentity(file)));
    for (const [key, file] of batch.attachmentOverrides) {
      if (!valid.has(Importer.fileIdentity(file))) batch.attachmentOverrides.delete(key);
    }
  }

  function refreshFileIndex(resetOverrides = false) {
    if (resetOverrides) batch.attachmentOverrides.clear();
    clearStaleOverrides();
    const files = allAttachmentFiles();
    batch.fileIndex = Importer.buildFileIndex(files);
    const taskCount = attachmentPoolFiles().length;
    const sharedCount = uniqueFiles(batch.sharedFiles).length;
    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const sizeText = totalBytes < 1024 * 1024 ? `${Math.round(totalBytes / 1024)} KB` : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
    $('nmda-file-index-info').textContent = files.length
      ? `已选择 ${files.length} 个文件（专属池 ${taskCount}，公共 ${sharedCount}，共 ${sizeText}）。`
      : '尚未选择本地附件。';
    rebuildTasks();
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

  function cellValue(row, field) {
    const col = batch.mapping[field];
    return col == null ? '' : (row?.[col] ?? '');
  }

  function rebuildTasks() {
    const sheet = currentSheet();
    if (!sheet || !batch.detection) return;
    const start = batch.detection.index + 1;
    const tasks = [];
    for (let rowIndex = start; rowIndex < sheet.rows.length; rowIndex++) {
      const row = sheet.rows[rowIndex] || [];
      const recipients = String(cellValue(row, 'recipients') ?? '').trim();
      const subject = String(cellValue(row, 'subject') ?? '').trim();
      const body = String(cellValue(row, 'body') ?? '');
      const attachmentRefs = Importer.splitAttachments(cellValue(row, 'attachments'));
      const scheduleRaw = cellValue(row, 'scheduleAt');
      const scheduleFlag = Importer.parseBoolean(cellValue(row, 'scheduleEnabled'));
      const importedTags = parseTaskClassifications(cellValue(row, 'tags'));
      const id = String(cellValue(row, 'id') ?? '').trim() || String(rowIndex + 1);
      const meaningful = [recipients, subject, body, ...attachmentRefs, String(scheduleRaw ?? ''), ...importedTags].some(v => String(v).trim());
      if (!meaningful) continue;

      const errors = [], warnings = [];
      if (!recipients) warnings.push('无收件人');
      let scheduleAt = '';
      if (String(scheduleRaw ?? '').trim()) {
        const parsed = Importer.parseDateValue(scheduleRaw);
        if (!parsed) errors.push(`定时时间无法识别：${scheduleRaw}`);
        else scheduleAt = Importer.formatLocalDateTime(parsed);
      }
      if (scheduleFlag === true && !scheduleAt) errors.push('标记为定时发送但没有有效定时时间');
      if (scheduleFlag === false) scheduleAt = '';

      const resolved = resolveAttachmentRefs(attachmentRefs);
      if (resolved.missing.length) errors.push(`缺少附件：${resolved.missing.join('、')}`);
      if (resolved.ambiguous.length) errors.push(`附件同名冲突：${resolved.ambiguous.join('、')}`);
      for (const detail of resolved.details) {
        if (detail.status === 'matched' && detail.method === 'relaxed-copy-suffix')
          warnings.push(`附件按下载副本名匹配：${detail.ref} → ${detail.file.name}`);
      }

      const gate = contactPolicyGateForRecipients(recipients);
      if (gate.policies.includes('不再联系')) errors.push(`联系人发送策略：不再联系（${gate.reasons.join('、')}）`);
      else if (gate.policies.includes('暂停')) warnings.push(`联系人发送策略：暂停（${gate.reasons.join('、')}）`);

      const editKey = taskEditKey(rowIndex);
      const edit = batch.taskEdits.get(editKey) || {};
      const policyBlocked = gate.blocked;
      tasks.push({
        id, rowIndex, editKey, excelRow: rowIndex + 1, recipients, subject, body, attachmentRefs,
        tags: edit.tags != null ? parseTaskClassifications(edit.tags) : importedTags,
        enabled: policyBlocked ? false : edit.enabled !== false,
        policyBlocked, policyReasons: gate.reasons,
        files: mergeTaskFiles(resolved.files), tableFiles: resolved.files, attachmentDetails: resolved.details,
        scheduleAt, errors, warnings, status: errors.length ? 'error' : 'ready', runtimeError: '', note: ''
      });
    }
    batch.tasks = tasks;
    renderPreview();
  }

  function statusLabel(task) {
    if (task.policyBlocked && task.status !== 'running' && task.status !== 'done') return `已拦截：${(task.policyReasons || []).join('、')}`;
    if (!task.enabled && task.status !== 'running' && task.status !== 'done') return '已排除发送';
    if (task.status === 'done') return '已完成';
    if (task.status === 'running') return '处理中';
    if (task.status === 'error') return task.runtimeError ? `失败：${task.runtimeError}` : `预检失败：${task.errors.join('；')}`;
    if (task.warnings.length) return `可执行（${task.warnings.join('；')}）`;
    return '可执行';
  }

  function renderTagChips() {
    const box = $('nmda-batch-tag-chips');
    if (!box || !Contacts) return;
    const counts = new Map();
    for (const task of batch.tasks || []) {
      for (const tag of taskEffectiveTags(task)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
    box.innerHTML = tags.length ? tags.slice(0, 50).map(([tag, count]) => `<button type="button" class="nmda-tag-chip" data-tag-chip="${escapeHtml(tag)}">${escapeHtml(tag)} <small>${count}</small></button>`).join('') : '<span class="nmda-hint">当前任务没有可用分类。联系人分类和任务自定义分类都会出现在这里。</span>';
    box.querySelectorAll('[data-tag-chip]').forEach(button => button.addEventListener('click', () => {
      const tagsNow = Contacts.parseTags(batchTagIncludeEl.value);
      const clicked = button.dataset.tagChip;
      const key = clicked.toLocaleLowerCase('zh-CN');
      const exists = tagsNow.some(tag => tag.toLocaleLowerCase('zh-CN') === key);
      batchTagIncludeEl.value = exists ? tagsNow.filter(tag => tag.toLocaleLowerCase('zh-CN') !== key).join(';') : Contacts.mergeTags(tagsNow, [clicked]).join(';');
      saveBatchFilterState();
      renderPreview();
    }));
  }

  function renderPreview() {
    const tasks = batch.tasks || [];
    const matched = filteredBatchTasks();
    const errors = tasks.filter(t => t.status === 'error').length;
    const done = tasks.filter(t => t.status === 'done').length;
    const enabledReady = tasks.filter(t => t.enabled && (t.status === 'ready' || t.status === 'running')).length;
    const disabled = tasks.filter(t => !t.enabled).length;
    const matchedEnabled = matched.filter(t => t.enabled).length;
    batchSummaryEl.innerHTML = `<strong>${tasks.length}</strong> 封任务 · 当前结果 <strong>${matched.length}</strong> 封（已纳入 ${matchedEnabled}） · 全部可执行 ${enabledReady} · 排除 ${disabled} · 错误 ${errors} · 已完成 ${done}`;
    const allScopeCount = tasks.filter(t => t.enabled && t.status === 'ready').length;
    const filteredScopeCount = matched.filter(t => t.enabled && t.status === 'ready').length;
    const allScopeCountEl = $('nmda-run-scope-all-count');
    const filteredScopeCountEl = $('nmda-run-scope-filtered-count');
    if (allScopeCountEl) allScopeCountEl.textContent = String(allScopeCount);
    if (filteredScopeCountEl) filteredScopeCountEl.textContent = String(filteredScopeCount);
    previewBodyEl.innerHTML = matched.slice(0, 150).map(task => {
      const contactClasses = contactClassificationsForRecipients(task.recipients);
      const effectiveClasses = taskEffectiveClassifications(task);
      const contactKeys = new Set(contactClasses.map(value => value.toLocaleLowerCase('zh-CN')));
      const classHtml = effectiveClasses.length ? effectiveClasses.map(value => {
        const system = Contacts.SYSTEM_CLASSIFICATIONS.includes(value);
        const fromContact = contactKeys.has(value.toLocaleLowerCase('zh-CN'));
        const kind = system ? 'system' : (fromContact ? 'tag' : 'task');
        const source = fromContact ? '联系人分类' : '当前任务分类';
        return classificationChipHtml({ kind, value }).replace('class="nmda-class-chip"', `class="nmda-class-chip" title="${escapeHtml(source)}"`);
      }).join('') : '<span class="nmda-hint">未分类</span>';
      const scheduleHtml = task.scheduleAt ? (() => {
        const [datePart, timePart = ''] = task.scheduleAt.replace('T', ' ').split(' ');
        return `<div class="nmda-schedule-cell" title="${escapeHtml(task.scheduleAt.replace('T', ' '))}"><strong>${escapeHtml(datePart)}</strong><small>${escapeHtml(timePart || '')}</small></div>`;
      })() : '<span class="nmda-hint">未定时</span>';
      return `
      <tr data-status="${task.status}" data-enabled="${task.enabled ? '1' : '0'}">
        <td><input type="checkbox" data-task-enabled="${escapeHtml(task.editKey)}" ${task.enabled ? 'checked' : ''} ${batch.running || task.policyBlocked || task.status === 'running' || task.status === 'done' ? 'disabled' : ''} title="${escapeHtml(task.policyBlocked ? statusLabel(task) : '')}"></td>
        <td>${escapeHtml(task.id)}</td>
        <td title="${escapeHtml(task.recipients)}">${escapeHtml(task.recipients || '—')}</td>
        <td class="nmda-unified-class-cell" title="全部分类：${escapeHtml(tagsText(effectiveClasses))}"><div class="nmda-class-preview nmda-class-preview-compact">${classHtml}</div><input class="nmda-task-tags-input" data-task-tags="${escapeHtml(task.editKey)}" value="${escapeHtml(tagsText(task.tags))}" placeholder="任务自定义分类" ${batch.running ? 'disabled' : ''}></td>
        <td>${scheduleHtml}</td>
        <td title="${escapeHtml(task.subject)}">${escapeHtml(task.subject || '—')}</td>
        <td title="${escapeHtml(task.files.map(file => file.name).join('；'))}">${task.files.length}</td>
        <td title="${escapeHtml(statusLabel(task))}">${escapeHtml(statusLabel(task))}</td>
      </tr>`;
    }).join('');
    if (!matched.length) previewBodyEl.innerHTML = '<tr><td colspan="8">当前检索/分类条件没有匹配任务。清除条件或调整关键词。</td></tr>';
    else if (matched.length > 150) previewBodyEl.insertAdjacentHTML('beforeend', `<tr><td colspan="8">仅显示前 150 行，当前结果实际有 ${matched.length} 行。</td></tr>`);
    previewBodyEl.querySelectorAll('[data-task-enabled]').forEach(input => input.addEventListener('change', () => {
      const task = batch.tasks.find(item => item.editKey === input.dataset.taskEnabled);
      if (!task) return;
      setTaskEdit(task, { enabled: input.checked });
      renderPreview();
    }));
    previewBodyEl.querySelectorAll('[data-task-tags]').forEach(input => input.addEventListener('change', () => {
      const task = batch.tasks.find(item => item.editKey === input.dataset.taskTags);
      if (!task) return;
      setTaskEdit(task, { tags: input.value });
      renderPreview();
    }));
    $('nmda-preview-card').hidden = !batch.workbook;
    $('nmda-run-card').hidden = !batch.workbook;
    batchStartEl.disabled = batch.running || !tasks.some(t => t.enabled && t.status === 'ready');
    renderTagChips();
    renderAttachmentCenter();
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
    $('nmda-attachment-summary').innerHTML = uniqueRefs.length
      ? `<strong>${matched}/${uniqueRefs.length}</strong> 个表格附件引用已匹配 · <strong>${shared.length}</strong> 个公共附件将加入每封邮件${issues.size ? ` · <span class="nmda-danger">${issues.size} 个待确认</span>` : ''}`
      : `表格没有专属附件引用 · <strong>${shared.length}</strong> 个公共附件将加入每封邮件`;

    const box = $('nmda-attachment-resolution');
    const list = $('nmda-attachment-resolution-list');
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
      return `<div class="nmda-resolve-row"><div><strong title="${escapeHtml(detail.ref)}">${escapeHtml(detail.ref)}</strong><small>${detail.status === 'ambiguous' ? '发现多个同名文件' : '尚未自动匹配'}</small></div><select data-attachment-ref="${escapeHtml(Importer.normalizeFileKey(detail.ref))}"><option value="">— 手动指定文件 —</option>${options}</select></div>`;
    }).join('');
    list.querySelectorAll('select[data-attachment-ref]').forEach(select => select.addEventListener('change', () => {
      const key = select.dataset.attachmentRef;
      const file = allAttachmentFiles().find(item => Importer.fileIdentity(item) === select.value);
      if (file) batch.attachmentOverrides.set(key, file); else batch.attachmentOverrides.delete(key);
      rebuildTasks();
    }));
  }

  function setBatchStatus(message, kind = '') {
    batchStatusEl.textContent = message;
    if (kind) batchStatusEl.dataset.kind = kind; else delete batchStatusEl.dataset.kind;
  }

  importFileEl.addEventListener('change', async () => {
    const file = importFileEl.files?.[0];
    if (!file || !Importer) return;
    setBatchStatus(`正在解析 ${file.name}…`);
    try {
      batch.workbook = await Importer.parseFile(file);
      batch.taskEdits.clear();
      const best = Importer.detectBestSheet(batch.workbook.sheets);
      batch.sheetIndex = best.index;
      sheetSelectEl.innerHTML = batch.workbook.sheets.map((sheet, i) => `<option value="${i}" ${i === best.index ? 'selected' : ''}>${escapeHtml(sheet.name)}（${sheet.rows.length} 行）</option>`).join('');
      $('nmda-sheet-card').hidden = false; $('nmda-attachments-card').hidden = false;
      configureSheet(best.index, true);
      setBatchStatus(`导入成功：${batch.workbook.sheets.length} 个工作表；已自动选择“${batch.workbook.sheets[best.index].name}”。`, 'ok');
    } catch (error) {
      console.error(`[${APP}] import`, error); batch.workbook = null; batch.tasks = [];
      $('nmda-sheet-card').hidden = true; $('nmda-attachments-card').hidden = true; $('nmda-preview-card').hidden = true; $('nmda-run-card').hidden = true;
      setBatchStatus(`导入失败：${error.message}`, 'error');
    }
  });

  sheetSelectEl.addEventListener('change', () => configureSheet(sheetSelectEl.value, true));
  dirEl.addEventListener('change', () => {
    batch.directoryFiles = uniqueFiles([...batch.directoryFiles, ...dirEl.files]);
    dirEl.value = ''; refreshFileIndex(true);
  });
  taskFilesEl.addEventListener('change', () => {
    batch.taskFiles = uniqueFiles([...batch.taskFiles, ...taskFilesEl.files]);
    taskFilesEl.value = ''; refreshFileIndex(true);
  });
  sharedFilesEl.addEventListener('change', () => {
    batch.sharedFiles = uniqueFiles([...batch.sharedFiles, ...sharedFilesEl.files]);
    sharedFilesEl.value = ''; refreshFileIndex(false);
  });
  const attachmentDropEl = $('nmda-attachment-drop');
  ['dragenter','dragover'].forEach(type => attachmentDropEl.addEventListener(type, event => { event.preventDefault(); attachmentDropEl.classList.add('is-dragging'); }));
  ['dragleave','drop'].forEach(type => attachmentDropEl.addEventListener(type, event => { event.preventDefault(); attachmentDropEl.classList.remove('is-dragging'); }));
  attachmentDropEl.addEventListener('drop', event => {
    const dropped = [...(event.dataTransfer?.files || [])].filter(file => file && file.name);
    if (!dropped.length) return;
    batch.taskFiles = uniqueFiles([...batch.taskFiles, ...dropped]);
    refreshFileIndex(true);
  });
  $('nmda-clear-attachments').addEventListener('click', () => {
    dirEl.value = ''; taskFilesEl.value = ''; sharedFilesEl.value = '';
    batch.directoryFiles = []; batch.taskFiles = []; batch.sharedFiles = []; batch.attachmentOverrides.clear();
    refreshFileIndex(true);
  });

  $('nmda-template').addEventListener('click', () => {
    const csv = '\ufeff编号,收件人,主题,正文,附件,定时时间,任务分类\r\n001,mail-test@example.com,测试主题,这是正文,该封专属材料.pdf,2026-08-25 09:30,第一批;重点\r\n002,mail-test-2@example.com,测试主题2,这是正文2,,2026-08-25 10:00,第二批\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  [batchSearchEl, batchTagIncludeEl, batchTagExcludeEl].forEach(el => el?.addEventListener('input', () => { saveBatchFilterState(); renderPreview(); }));
  batchTagModeEl?.addEventListener('change', () => { saveBatchFilterState(); renderPreview(); });

  function bulkEditFiltered(kind) {
    const targets = filteredBatchTasks().filter(task => task.status !== 'running' && task.status !== 'done');
    if (!targets.length) { setBatchStatus('当前检索/筛选结果没有可编辑任务。', 'warn'); return; }
    const tagValue = $('nmda-bulk-tag-value').value;
    const parsed = parseTaskClassifications(tagValue);
    if ((kind === 'addTag' || kind === 'removeTag') && !parsed.length) {
      setBatchStatus('请输入有效的任务自定义分类。互动阶段、待跟进、正常/暂停/不再联系属于联系人系统分类，不能作为任务自定义分类。', 'warn'); return;
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
    const actionText = { enable: '纳入发送', disable: '排除发送', addTag: `添加分类“${tagsText(parsed)}”`, removeTag: `移除分类“${tagsText(parsed)}”` }[kind];
    const skippedText = blockedSkipped ? `；另有 ${blockedSkipped} 封受联系人发送策略拦截，未加入发送` : '';
    setBatchStatus(`已对 ${affected} 封任务执行：${actionText}${skippedText}。`, blockedSkipped ? 'warn' : 'ok');
    renderPreview();
  }

  $('nmda-bulk-add-tag').addEventListener('click', () => bulkEditFiltered('addTag'));
  $('nmda-bulk-remove-tag').addEventListener('click', () => bulkEditFiltered('removeTag'));
  $('nmda-bulk-enable').addEventListener('click', () => bulkEditFiltered('enable'));
  $('nmda-bulk-disable').addEventListener('click', () => bulkEditFiltered('disable'));
  $('nmda-clear-tag-filter').addEventListener('click', () => {
    if (batchSearchEl) batchSearchEl.value = '';
    batchTagIncludeEl.value = '';
    batchTagExcludeEl.value = '';
    batchTagModeEl.value = 'any';
    saveBatchFilterState();
    renderPreview();
  });

  $('nmda-contact-search').addEventListener('input', renderContacts);
  $('nmda-contact-class-filter').addEventListener('input', renderContacts);
  $('nmda-contact-class-mode').addEventListener('change', renderContacts);

  $('nmda-open-sent').addEventListener('click', async () => {
    const button = $('nmda-open-sent');
    button.disabled = true;
    setContactStatusMessage('正在打开“已发送”…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_SENT' });
      if (!result?.ok) throw new Error(result?.reason || '无法打开已发送');
      setContactStatusMessage('已打开网易“已发送”文件夹。', 'ok');
    } catch (error) { setContactStatusMessage(`打开失败：${error.message}`, 'error'); }
    finally { button.disabled = false; }
  });

  $('nmda-read-sent').addEventListener('click', async () => {
    const button = $('nmda-read-sent');
    button.disabled = true;
    const limit = $('nmda-mail-history-limit').value || '200';
    const rangeText = limit === 'all' ? '全部' : `最近 ${limit} 封`;
    setContactStatusMessage(`正在读取${rangeText}已发送邮件…`);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_READ_SENT', limit });
      if (!result?.ok) throw new Error(result?.reason || '读取已发送失败');
      const account = Contacts.normalizeEmail(result.uid || await detectAccount()) || 'default';
      if (!contactBook.loaded || contactBook.account !== account) {
        contactBook.account = account;
        contactBook.contacts = await Contacts.load(account);
        contactBook.loaded = true;
      }
      const applied = Contacts.applySentMessages(contactBook.contacts, result.messages || []);
      await persistContacts();
      renderContacts();
      renderPreview();
      const successful = (result.messages || []).filter(message => !message.failed).length;
      const recipients = new Set((result.messages || []).flatMap(message => (message.recipients || []).map(r => Contacts.normalizeEmail(r.email))).filter(Boolean)).size;
      const coverage = result.complete ? '完整覆盖当前已发送' : `部分覆盖（邮箱共约 ${result.total || '未知'} 封）`;
      const paging = result.pages > 1 ? `；分页 ${result.pages} 页` : '';
      const warning = result.truncated ? `；未读完：${result.stopReason || '达到读取范围'}` : '';
      setContactStatusMessage(`已发送读取完成：${result.messages?.length || 0} 封，${coverage}${paging}${warning}；其中 ${successful} 封未标记为失败；识别 ${recipients} 个收件邮箱；新增 ${applied.newLinks} 条发送历史关联。`, result.truncated && limit === 'all' ? 'warn' : 'ok');
    } catch (error) {
      console.error(`[${APP}] sent scan`, error);
      setContactStatusMessage(`读取失败：${error.message}`, 'error');
    } finally { button.disabled = false; }
  });

  $('nmda-open-drafts').addEventListener('click', async () => {
    const button = $('nmda-open-drafts');
    button.disabled = true;
    setContactStatusMessage('正在打开“草稿箱”…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_DRAFTS' });
      if (!result?.ok) throw new Error(result?.reason || '无法打开草稿箱');
      setContactStatusMessage('已打开网易“草稿箱”。', 'ok');
    } catch (error) { setContactStatusMessage(`打开失败：${error.message}`, 'error'); }
    finally { button.disabled = false; }
  });

  $('nmda-read-drafts').addEventListener('click', async () => {
    const button = $('nmda-read-drafts');
    button.disabled = true;
    const limit = $('nmda-mail-history-limit').value || '200';
    const rangeText = limit === 'all' ? '全部' : `最近 ${limit} 封`;
    setContactStatusMessage(`正在读取${rangeText}草稿…`);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_READ_DRAFTS', limit });
      if (!result?.ok) throw new Error(result?.reason || '读取草稿箱失败');
      const account = Contacts.normalizeEmail(result.uid || await detectAccount()) || 'default';
      if (!contactBook.loaded || contactBook.account !== account) {
        contactBook.account = account;
        contactBook.contacts = await Contacts.load(account);
        contactBook.loaded = true;
      }
      const applied = Contacts.applyDraftMessages(contactBook.contacts, result.messages || [], { replaceActive: !!result.complete });
      await persistContacts();
      renderContacts();
      renderPreview();
      const recipients = new Set((result.messages || []).flatMap(message => (message.recipients || []).map(r => Contacts.normalizeEmail(r.email))).filter(Boolean)).size;
      const coverage = result.complete ? '已完整同步当前草稿箱，因此会清理已删除/已发送的旧草稿标记' : `部分同步（邮箱共约 ${result.total || '未知'} 封草稿），不会删除旧草稿标记`;
      const paging = result.pages > 1 ? `；分页 ${result.pages} 页` : '';
      const warning = result.truncated ? `；未读完：${result.stopReason || '达到读取范围'}` : '';
      setContactStatusMessage(`草稿箱读取完成：${result.messages?.length || 0} 封；${coverage}${paging}${warning}；关联 ${recipients} 个收件邮箱，新增 ${applied.newLinks} 条草稿关联；${applied.draftsWithoutRecipient} 封草稿尚未填写收件人，未关联联系人。草稿不会推进联系人为“已发送”。`, result.truncated && limit === 'all' ? 'warn' : 'ok');
    } catch (error) {
      console.error(`[${APP}] draft scan`, error);
      setContactStatusMessage(`草稿箱读取失败：${error.message}`, 'error');
    } finally { button.disabled = false; }
  });

  $('nmda-sync-batch-contacts').addEventListener('click', async () => {
    try {
      await ensureContactBook();
      const recipients = [];
      for (const task of batch.tasks || []) {
        const taskTags = parseTaskClassifications(task.tags || []);
        recipients.push(...Contacts.parseRecipients(task.recipients).map(item => ({ ...item, tags: taskTags })));
      }
      const added = Contacts.mergeRecipientList(contactBook.contacts, recipients, '未联系');
      await persistContacts();
      renderContacts();
      renderPreview();
      setContactStatusMessage(`已同步当前批量任务中的 ${new Set(recipients.map(item => item.email)).size} 个邮箱及任务分类；新增联系人 ${added} 个。`, 'ok');
    } catch (error) { setContactStatusMessage(`同步失败：${error.message}`, 'error'); }
  });

  $('nmda-export-contacts').addEventListener('click', async () => {
    try {
      await ensureContactBook();
      const csv = Contacts.toCsv(contactBook.contacts);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `netease-contacts-${contactBook.account.replace(/[^a-z0-9@._-]+/ig, '_')}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setContactStatusMessage('联系人分类已导出为 CSV。', 'ok');
    } catch (error) { setContactStatusMessage(`导出失败：${error.message}`, 'error'); }
  });

  batchStopEl.addEventListener('click', () => {
    batch.stopRequested = true;
    batchStopEl.disabled = true;
    setBatchStatus('已请求停止：当前这一封完成后不会继续下一封。', 'warn');
  });

  function setBatchPlanningLocked(locked) {
    [batchSearchEl, batchTagIncludeEl, batchTagExcludeEl, batchTagModeEl].forEach(el => { if (el) el.disabled = !!locked; });
    ui.querySelectorAll('input[name="nmda-run-scope"]').forEach(el => { el.disabled = !!locked; });
    ['nmda-clear-tag-filter','nmda-bulk-add-tag','nmda-bulk-remove-tag','nmda-bulk-enable','nmda-bulk-disable'].forEach(id => {
      const el = $(id); if (el) el.disabled = !!locked;
    });
  }

  function selectedRunScope() {
    return ui.querySelector('input[name="nmda-run-scope"]:checked')?.value === 'filtered' ? 'filtered' : 'enabled';
  }

  batchStartEl.addEventListener('click', async () => {
    if (batch.running) return;
    const runFilteredOnly = selectedRunScope() === 'filtered';
    const inRunScope = task => task.enabled && task.status === 'ready' && (!runFilteredOnly || taskMatchesTagFilter(task));
    const executable = batch.tasks.filter(inRunScope);
    if (!executable.length) { setBatchStatus(runFilteredOnly ? '当前检索/筛选结果中没有可执行任务。' : '没有可执行任务，请先修正预检错误或联系人发送策略。', 'error'); return; }
    const executableKeys = new Set(executable.map(task => task.editKey)); // freeze this run at start
    batch.running = true; batch.stopRequested = false; batchStartEl.disabled = true; batchStopEl.disabled = false;
    importFileEl.disabled = true; sheetSelectEl.disabled = true; dirEl.disabled = true; taskFilesEl.disabled = true; sharedFilesEl.disabled = true;
    setBatchPlanningLocked(true);
    let succeeded = 0, failed = 0;
    try {
      for (let i = 0; i < batch.tasks.length; i++) {
        const task = batch.tasks[i];
        if (!executableKeys.has(task.editKey) || task.status !== 'ready') continue;
        if (batch.stopRequested) break;
        task.status = 'running'; renderPreview();
        setBatchStatus(`正在处理 ${succeeded + failed + 1}/${executable.length} · ${task.id} · ${task.subject || '(无主题)'}${task.scheduleAt ? ` · 定时 ${task.scheduleAt.replace('T', ' ')}` : ' · 未定时'}`);
        try {
          const root = await openFreshCompose();
          await setRecipients(root, task.recipients);
          await setSubject(root, task.subject);
          await setBody(root, task.body);
          if (task.files.length) {
            const upload = await addAttachments(root, task.files, (done, total, name) => setBatchStatus(`任务 ${task.id}：附件 ${done}/${total} · ${name}`));
            if (!upload.verified) {
              const missingNames = upload.missing.map(file => file.name).join('、');
              task.note = [task.note, `附件已提交上传，但页面未确认：${missingNames}`].filter(Boolean).join('；');
            }
          }
          if (task.scheduleAt) {
            const actualMinute = await setSchedule(root, task.scheduleAt);
            const requestedMinute = new Date(task.scheduleAt).getMinutes();
            if (Number(actualMinute) !== requestedMinute) task.note = `分钟由 ${requestedMinute} 调整为 ${actualMinute}`;
          }
          const verified = await saveDraft(root);
          task.note = [task.note, verified ? '草稿路由已确认' : '已点击存草稿（路由未确认）'].filter(Boolean).join('；');
          task.status = 'done'; succeeded++;
          renderPreview();
          await sleep(600);
        } catch (error) {
          console.error(`[${APP}] batch row ${task.excelRow}`, error);
          task.status = 'error'; task.runtimeError = error.message || String(error); failed++; renderPreview();
          if (!$('nmda-continue-on-error').checked) { setBatchStatus(`任务 ${task.id} 失败，已停止：${task.runtimeError}`, 'error'); break; }
          await sleep(500);
        }
      }
      const remaining = batch.tasks.filter(t => executableKeys.has(t.editKey) && t.status === 'ready').length;
      if (batch.stopRequested) setBatchStatus(`已停止。成功 ${succeeded}，失败 ${failed}，剩余 ${remaining}。`, 'warn');
      else if (failed) setBatchStatus(`批量处理结束：成功 ${succeeded}，失败 ${failed}。请查看预览状态。`, 'warn');
      else setBatchStatus(`批量处理完成：成功创建并保存 ${succeeded} 封草稿。不会自动发送。`, 'ok');
    } finally {
      batch.running = false; batchStopEl.disabled = true;
      importFileEl.disabled = false; sheetSelectEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; sharedFilesEl.disabled = false;
      setBatchPlanningLocked(false);
      renderPreview();
    }
  });

  restoreFormState();
  restoreBatchFilterState().then(renderPreview);
  initContacts();
  console.info(`[${APP}] v0.8.0 loaded`);
})();
