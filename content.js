(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const STORAGE_KEY = 'nmda.form.v2';
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
      <button id="nmda-launcher" type="button" title="网易邮箱草稿助手">草稿</button>
      <section id="nmda-panel" hidden>
        <div class="nmda-head">
          <div><div class="nmda-title">网易邮箱草稿助手</div><div class="nmda-subtitle">单封 / 批量建草稿，不会自动发送</div></div>
          <button class="nmda-close" id="nmda-close" type="button">×</button>
        </div>
        <div class="nmda-tabs">
          <button class="nmda-tab is-active" data-tab="single" type="button">单封</button>
          <button class="nmda-tab" data-tab="batch" type="button">批量</button>
          <button class="nmda-tab" data-tab="contacts" type="button">联系人</button>
        </div>

        <div class="nmda-body nmda-tabpane" data-pane="single">
          <label class="nmda-field"><span class="nmda-label">收件人</span><textarea id="nmda-recipients" placeholder="a@example.com; b@example.com"></textarea><span class="nmda-hint">多人可用分号、逗号或换行分隔</span></label>
          <label class="nmda-field"><span class="nmda-label">主题</span><input id="nmda-subject" type="text" placeholder="邮件主题"></label>
          <label class="nmda-field"><span class="nmda-label">正文</span><textarea id="nmda-body-text" placeholder="邮件正文"></textarea></label>
          <label class="nmda-field"><span class="nmda-label">附件</span><input id="nmda-files" type="file" multiple><span class="nmda-hint">文件只保存在当前页面内存；刷新后需重新选择</span></label>
          <div class="nmda-schedule-box"><div class="nmda-row"><label><input id="nmda-schedule-enabled" type="checkbox"> 设置定时发送</label></div><label class="nmda-field"><span class="nmda-label">定时时间</span><input id="nmda-schedule-at" type="datetime-local"></label></div>
          <div class="nmda-row"><label><input id="nmda-auto-save" type="checkbox"> 填入后自动点击“存草稿”</label></div>
          <div class="nmda-actions"><button class="nmda-btn" id="nmda-open-compose" type="button">只打开写信</button><button class="nmda-btn nmda-btn-primary" id="nmda-fill" type="button">填入草稿</button></div>
          <div id="nmda-status">准备就绪。</div>
        </div>

        <div class="nmda-body nmda-tabpane" data-pane="batch" hidden>
          <div class="nmda-import-card">
            <div class="nmda-card-title">1. 导入任务表</div>
            <input id="nmda-import-file" type="file" accept=".xlsx,.xls,.csv,.tsv,.json,.txt">
            <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-template" type="button">下载 CSV 模板</button><span class="nmda-hint">支持 XLSX / CSV / TSV / JSON；旧 .xls 请先另存</span></div>
          </div>

          <div class="nmda-import-card" id="nmda-sheet-card" hidden>
            <div class="nmda-card-title">2. 识别工作表与字段</div>
            <label class="nmda-field"><span class="nmda-label">工作表</span><select id="nmda-sheet-select"></select></label>
            <div id="nmda-header-info" class="nmda-hint"></div>
            <div id="nmda-mapping" class="nmda-mapping"></div>
          </div>

          <div class="nmda-import-card" id="nmda-attachments-card" hidden>
            <div class="nmda-card-title">3. 准备附件</div>
            <div class="nmda-hint">实际使用建议：表格只写每封邮件的专属附件名；同一份 CV、成绩单等可直接设为“公共附件”，无需在每一行重复填写。</div>
            <div id="nmda-attachment-summary" class="nmda-summary">导入任务后会统计需要匹配的附件。</div>
            <div class="nmda-attachment-grid">
              <label class="nmda-field"><span class="nmda-label">选择专属附件文件（推荐）</span><input id="nmda-attachment-files" type="file" multiple><span class="nmda-hint">可一次多选所有附件；插件按表格中的文件名自动分配到对应邮件。</span></label>
              <label class="nmda-field"><span class="nmda-label">或扫描附件总目录</span><input id="nmda-attachment-dir" type="file" webkitdirectory multiple><span class="nmda-hint">适合附件很多或按学生/导师分文件夹保存；支持相对路径匹配。</span></label>
            </div>
            <div id="nmda-attachment-drop" class="nmda-attachment-drop">也可以把专属附件文件直接拖到这里</div>
            <label class="nmda-field nmda-shared-box"><span class="nmda-label">公共附件（每一封都添加）</span><input id="nmda-shared-files" type="file" multiple><span class="nmda-hint">例如统一 CV / 成绩单。表格“附件”列可以留空，也可以再写每封专属文件。</span></label>
            <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-clear-attachments" type="button">清空附件选择</button><span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span></div>
            <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden>
              <div class="nmda-card-subtitle">需要你确认的附件</div>
              <div class="nmda-hint">找不到或出现同名文件时，不再阻塞在“猜文件”：直接在这里指定一次，本批次所有相同引用都会复用该选择。</div>
              <div id="nmda-attachment-resolution-list"></div>
            </div>
          </div>

          <div class="nmda-import-card" id="nmda-preview-card" hidden>
            <div class="nmda-card-title">4. 导入预检</div>
            <div id="nmda-batch-summary" class="nmda-summary"></div>
            <div class="nmda-table-wrap"><table class="nmda-table"><thead><tr><th>#</th><th>收件人</th><th>联系人状态</th><th>主题</th><th>附件</th><th>定时</th><th>任务状态</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
          </div>

          <div class="nmda-import-card" id="nmda-run-card" hidden>
            <div class="nmda-card-title">5. 顺序创建草稿</div>
            <div class="nmda-row nmda-wrap"><label><input id="nmda-continue-on-error" type="checkbox" checked> 单封失败后继续下一封</label></div>
            <div class="nmda-actions"><button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">开始批量建草稿</button><button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封完成后停止</button></div>
            <div id="nmda-batch-status">请先导入并确认预检结果。</div>
          </div>
        </div>

        <div class="nmda-body nmda-tabpane" data-pane="contacts" hidden>
          <div class="nmda-import-card">
            <div class="nmda-card-title">联系人状态库</div>
            <div class="nmda-hint">读取网易“已发送”邮件后自动建立联系人记录。自动扫描只会把“未联系”升级为“已发送”，不会覆盖你手工标记的“已回复 / 待跟进 / 暂停 / 不再联系”。</div>
            <div class="nmda-row nmda-wrap">
              <label class="nmda-field nmda-inline-field"><span class="nmda-label">读取范围</span><select id="nmda-sent-limit"><option value="50">最近 50 封</option><option value="100">最近 100 封</option><option value="200" selected>最近 200 封</option></select></label>
              <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-read-sent" type="button">读取已发送</button>
              <button class="nmda-btn nmda-btn-small" id="nmda-open-sent" type="button">打开已发送</button>
            </div>
            <div class="nmda-row nmda-wrap">
              <button class="nmda-btn nmda-btn-small" id="nmda-sync-batch-contacts" type="button">同步当前批量名单</button>
              <button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出联系人 CSV</button>
            </div>
            <div id="nmda-contact-status" class="nmda-summary">正在初始化当前邮箱的联系人状态库…</div>
          </div>

          <div class="nmda-import-card">
            <div class="nmda-row nmda-contact-toolbar">
              <input id="nmda-contact-search" type="text" placeholder="搜索邮箱 / 姓名 / 最近主题">
              <select id="nmda-contact-filter"><option value="">全部状态</option>${Contacts ? Contacts.STATUS_OPTIONS.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('') : ''}</select>
            </div>
            <div id="nmda-contact-summary" class="nmda-summary">0 个联系人</div>
            <div class="nmda-table-wrap nmda-contact-table-wrap"><table class="nmda-table nmda-contact-table"><thead><tr><th>联系人</th><th>状态</th><th>发送</th><th>最后发送</th><th>最近主题</th></tr></thead><tbody id="nmda-contact-body"></tbody></table></div>
          </div>
        </div>
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

  function contactStatusForRecipients(raw) {
    if (!Contacts || !contactBook.loaded) return '未载入';
    const recipients = Contacts.parseRecipients(raw);
    if (!recipients.length) return '—';
    const states = [...new Set(recipients.map(item => contactBook.contacts[item.email]?.status || '未联系'))];
    return states.join(' / ');
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
    if (!body || !summary) return;
    const query = String($('nmda-contact-search')?.value || '').trim().toLowerCase();
    const filter = $('nmda-contact-filter')?.value || '';
    let list = Object.values(contactBook.contacts || {});
    if (filter) list = list.filter(contact => contact.status === filter);
    if (query) list = list.filter(contact => `${contact.email} ${contact.name || ''} ${contact.lastSubject || ''}`.toLowerCase().includes(query));
    list.sort((a, b) => {
      const ta = Date.parse(a.lastSentAt || '') || 0, tb = Date.parse(b.lastSentAt || '') || 0;
      return tb - ta || String(a.email).localeCompare(String(b.email));
    });

    const all = Object.values(contactBook.contacts || {});
    const counts = {};
    for (const contact of all) counts[contact.status || '未联系'] = (counts[contact.status || '未联系'] || 0) + 1;
    summary.textContent = `${all.length} 个联系人 · ${Contacts.STATUS_OPTIONS.map(status => `${status} ${counts[status] || 0}`).join(' · ')}`;

    body.innerHTML = list.slice(0, 300).map(contact => `
      <tr>
        <td><strong>${escapeHtml(contact.name || contact.email)}</strong><small>${escapeHtml(contact.name ? contact.email : '')}</small></td>
        <td><select class="nmda-contact-status-select" data-contact-email="${escapeHtml(contact.email)}">${Contacts.STATUS_OPTIONS.map(status => `<option value="${escapeHtml(status)}" ${contact.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select></td>
        <td>${Number(contact.sentCount || 0)}</td>
        <td title="${escapeHtml(contact.lastSentAt || '')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastSentAt))}</td>
        <td title="${escapeHtml(contact.lastSubject || '')}">${escapeHtml(contact.lastSubject || '—')}</td>
      </tr>`).join('');
    if (!list.length) body.innerHTML = '<tr><td colspan="5">暂无联系人。可读取“已发送”或同步当前批量名单。</td></tr>';
    else if (list.length > 300) body.insertAdjacentHTML('beforeend', `<tr><td colspan="5">当前显示前 300 个匹配联系人，共 ${list.length} 个。</td></tr>`);

    body.querySelectorAll('select[data-contact-email]').forEach(select => select.addEventListener('change', async () => {
      Contacts.setStatus(contactBook.contacts, select.dataset.contactEmail, select.value);
      await persistContacts();
      renderContacts();
      if (typeof renderPreview === 'function') renderPreview();
      setContactStatusMessage(`已将 ${select.dataset.contactEmail} 标记为“${select.value}”。`, 'ok');
    }));
  }

  async function initContacts() {
    if (!Contacts) { setContactStatusMessage('联系人模块未加载。', 'error'); return; }
    try {
      await ensureContactBook(true);
      renderContacts();
      setContactStatusMessage(`当前邮箱：${contactBook.account}。联系人状态保存在本机浏览器，不会上传到外部服务。`, 'ok');
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

  launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('nmda-close').addEventListener('click', () => { panel.hidden = true; });
  ui.querySelectorAll('.nmda-tab').forEach(tab => tab.addEventListener('click', () => {
    ui.querySelectorAll('.nmda-tab').forEach(t => t.classList.toggle('is-active', t === tab));
    ui.querySelectorAll('.nmda-tabpane').forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
  }));

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
    attachmentOverrides: new Map(), running: false, stopRequested: false
  };

  const importFileEl = $('nmda-import-file'), sheetSelectEl = $('nmda-sheet-select'), mappingEl = $('nmda-mapping');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files'), sharedFilesEl = $('nmda-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop');

  function currentSheet() { return batch.workbook?.sheets?.[batch.sheetIndex] || null; }

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
      const id = String(cellValue(row, 'id') ?? '').trim() || String(rowIndex + 1);
      const meaningful = [recipients, subject, body, ...attachmentRefs, String(scheduleRaw ?? '')].some(v => String(v).trim());
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

      tasks.push({
        id, rowIndex, excelRow: rowIndex + 1, recipients, subject, body, attachmentRefs,
        files: mergeTaskFiles(resolved.files), tableFiles: resolved.files, attachmentDetails: resolved.details,
        scheduleAt, errors, warnings, status: errors.length ? 'error' : 'ready', runtimeError: '', note: ''
      });
    }
    batch.tasks = tasks;
    renderPreview();
  }

  function statusLabel(task) {
    if (task.status === 'done') return '已完成';
    if (task.status === 'running') return '处理中';
    if (task.status === 'error') return task.runtimeError ? `失败：${task.runtimeError}` : `预检失败：${task.errors.join('；')}`;
    if (task.warnings.length) return `可执行（${task.warnings.join('；')}）`;
    return '可执行';
  }

  function renderPreview() {
    const tasks = batch.tasks || [];
    const errors = tasks.filter(t => t.status === 'error').length;
    const done = tasks.filter(t => t.status === 'done').length;
    const ready = tasks.filter(t => t.status === 'ready' || t.status === 'running').length;
    batchSummaryEl.innerHTML = `<strong>${tasks.length}</strong> 封任务 · <span>${ready} 可执行</span> · <span>${errors} 错误</span> · <span>${done} 已完成</span>`;
    previewBodyEl.innerHTML = tasks.slice(0, 100).map(task => {
      const contactStatus = contactStatusForRecipients(task.recipients);
      return `
      <tr data-status="${task.status}"><td>${escapeHtml(task.id)}</td><td title="${escapeHtml(task.recipients)}">${escapeHtml(task.recipients || '—')}</td><td title="${escapeHtml(contactStatus)}">${escapeHtml(contactStatus)}</td><td title="${escapeHtml(task.subject)}">${escapeHtml(task.subject || '—')}</td><td title="${escapeHtml(task.files.map(file => file.name).join('；'))}">${task.files.length}</td><td>${escapeHtml(task.scheduleAt ? task.scheduleAt.replace('T', ' ') : '—')}</td><td title="${escapeHtml(statusLabel(task))}">${escapeHtml(statusLabel(task))}</td></tr>`;
    }).join('');
    if (tasks.length > 100) previewBodyEl.insertAdjacentHTML('beforeend', `<tr><td colspan="7">仅显示前 100 行，实际将处理 ${tasks.length} 行。</td></tr>`);
    $('nmda-preview-card').hidden = !batch.workbook;
    $('nmda-run-card').hidden = !batch.workbook;
    batchStartEl.disabled = batch.running || !tasks.some(t => t.status === 'ready');
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
    const csv = '\ufeff编号,收件人,主题,正文,附件,定时时间\r\n001,mail-test@example.com,测试主题,这是正文,该封专属材料.pdf,2026-08-25 09:30\r\n002,mail-test-2@example.com,测试主题2,这是正文2,,2026-08-25 10:00\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('nmda-contact-search').addEventListener('input', renderContacts);
  $('nmda-contact-filter').addEventListener('change', renderContacts);

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
    const limit = Number($('nmda-sent-limit').value || 200);
    setContactStatusMessage(`正在读取最近 ${limit} 封已发送邮件…`);
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
      setContactStatusMessage(`读取完成：获得 ${result.messages?.length || 0} 封记录，其中 ${successful} 封未标记为发送失败；识别 ${recipients} 个收件邮箱；新增 ${applied.newLinks} 条“联系人 ↔ 已发送邮件”关联。`, 'ok');
    } catch (error) {
      console.error(`[${APP}] sent scan`, error);
      setContactStatusMessage(`读取失败：${error.message}`, 'error');
    } finally { button.disabled = false; }
  });

  $('nmda-sync-batch-contacts').addEventListener('click', async () => {
    try {
      await ensureContactBook();
      const recipients = [];
      for (const task of batch.tasks || []) recipients.push(...Contacts.parseRecipients(task.recipients));
      const added = Contacts.mergeRecipientList(contactBook.contacts, recipients, '未联系');
      await persistContacts();
      renderContacts();
      renderPreview();
      setContactStatusMessage(`已同步当前批量任务中的 ${new Set(recipients.map(item => item.email)).size} 个邮箱；新增联系人 ${added} 个。`, 'ok');
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
      setContactStatusMessage('联系人状态已导出为 CSV。', 'ok');
    } catch (error) { setContactStatusMessage(`导出失败：${error.message}`, 'error'); }
  });

  batchStopEl.addEventListener('click', () => {
    batch.stopRequested = true;
    batchStopEl.disabled = true;
    setBatchStatus('已请求停止：当前这一封完成后不会继续下一封。', 'warn');
  });

  batchStartEl.addEventListener('click', async () => {
    if (batch.running) return;
    const executable = batch.tasks.filter(t => t.status === 'ready');
    if (!executable.length) { setBatchStatus('没有可执行任务，请先修正预检错误。', 'error'); return; }
    batch.running = true; batch.stopRequested = false; batchStartEl.disabled = true; batchStopEl.disabled = false;
    importFileEl.disabled = true; sheetSelectEl.disabled = true; dirEl.disabled = true; taskFilesEl.disabled = true; sharedFilesEl.disabled = true;
    let succeeded = 0, failed = 0;
    try {
      for (let i = 0; i < batch.tasks.length; i++) {
        const task = batch.tasks[i];
        if (task.status !== 'ready') continue;
        if (batch.stopRequested) break;
        task.status = 'running'; renderPreview();
        setBatchStatus(`正在处理 ${i + 1}/${batch.tasks.length} · ${task.id} · ${task.subject || '(无主题)'}`);
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
      const remaining = batch.tasks.filter(t => t.status === 'ready').length;
      if (batch.stopRequested) setBatchStatus(`已停止。成功 ${succeeded}，失败 ${failed}，剩余 ${remaining}。`, 'warn');
      else if (failed) setBatchStatus(`批量处理结束：成功 ${succeeded}，失败 ${failed}。请查看预览状态。`, 'warn');
      else setBatchStatus(`批量处理完成：成功创建并保存 ${succeeded} 封草稿。不会自动发送。`, 'ok');
    } finally {
      batch.running = false; batchStopEl.disabled = true;
      importFileEl.disabled = false; sheetSelectEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; sharedFilesEl.disabled = false;
      renderPreview();
    }
  });

  restoreFormState();
  initContacts();
  console.info(`[${APP}] v0.4.0 loaded`);
})();
