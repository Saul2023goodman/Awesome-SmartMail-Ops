(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const STORAGE_KEY = 'nmda.form.v2';
  const DEFAULT_TIMEOUT = 10000;
  const Importer = globalThis.NMDAImporter;
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

  async function addAttachments(root, files, onProgress = () => {}) {
    if (!files?.length) return;
    const input = await waitFor(() => findAttachmentInput(root), 8000, 120, '未找到网易邮箱附件控件。');
    for (let i = 0; i < files.length; i++) {
      const dt = new DataTransfer();
      dt.items.add(files[i]);
      try { input.files = dt.files; }
      catch (error) { throw new Error(`附件“${files[i].name}”无法注入：${error.message}`); }
      fire(input, 'change');
      onProgress(i + 1, files.length, files[i].name);
      await sleep(1000);
    }
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
            <div class="nmda-card-title">3. 建立附件文件池</div>
            <label class="nmda-field"><span class="nmda-label">选择附件目录</span><input id="nmda-attachment-dir" type="file" webkitdirectory multiple><span class="nmda-hint">表格“附件”列写文件名或相对路径，例如 offer.pdf；A/offer.pdf</span></label>
            <label class="nmda-field"><span class="nmda-label">追加独立文件</span><input id="nmda-attachment-files" type="file" multiple></label>
            <div id="nmda-file-index-info" class="nmda-hint">尚未选择附件。</div>
          </div>

          <div class="nmda-import-card" id="nmda-preview-card" hidden>
            <div class="nmda-card-title">4. 导入预检</div>
            <div id="nmda-batch-summary" class="nmda-summary"></div>
            <div class="nmda-table-wrap"><table class="nmda-table"><thead><tr><th>#</th><th>收件人</th><th>主题</th><th>附件</th><th>定时</th><th>状态</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
          </div>

          <div class="nmda-import-card" id="nmda-run-card" hidden>
            <div class="nmda-card-title">5. 顺序创建草稿</div>
            <div class="nmda-row nmda-wrap"><label><input id="nmda-continue-on-error" type="checkbox" checked> 单封失败后继续下一封</label></div>
            <div class="nmda-actions"><button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">开始批量建草稿</button><button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封完成后停止</button></div>
            <div id="nmda-batch-status">请先导入并确认预检结果。</div>
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
        await addAttachments(root, [...filesEl.files], (done, total, name) => setStatus(`3/6 注入附件（${done}/${total}）：${name}`));
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
    directoryFiles: [], extraFiles: [], fileIndex: Importer?.buildFileIndex?.([]),
    running: false, stopRequested: false
  };

  const importFileEl = $('nmda-import-file'), sheetSelectEl = $('nmda-sheet-select'), mappingEl = $('nmda-mapping');
  const dirEl = $('nmda-attachment-dir'), extraFilesEl = $('nmda-attachment-files');
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
    const map = new Map();
    for (const file of [...batch.directoryFiles, ...batch.extraFiles]) {
      const key = `${file.webkitRelativePath || file.name}|${file.size}|${file.lastModified}`;
      if (!map.has(key)) map.set(key, file);
    }
    return [...map.values()];
  }

  function refreshFileIndex() {
    const files = allAttachmentFiles();
    batch.fileIndex = Importer.buildFileIndex(files);
    $('nmda-file-index-info').textContent = files.length ? `已建立 ${files.length} 个本地文件的匹配索引。` : '尚未选择附件。';
    rebuildTasks();
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

      const resolved = Importer.resolveFiles(attachmentRefs, batch.fileIndex || Importer.buildFileIndex([]));
      if (resolved.missing.length) errors.push(`缺少附件：${resolved.missing.join('、')}`);
      if (resolved.ambiguous.length) errors.push(`附件同名冲突：${resolved.ambiguous.join('、')}`);

      tasks.push({
        id, rowIndex, excelRow: rowIndex + 1, recipients, subject, body, attachmentRefs,
        files: resolved.files, scheduleAt, errors, warnings,
        status: errors.length ? 'error' : 'ready', runtimeError: '', note: ''
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
    previewBodyEl.innerHTML = tasks.slice(0, 100).map(task => `
      <tr data-status="${task.status}"><td>${escapeHtml(task.id)}</td><td title="${escapeHtml(task.recipients)}">${escapeHtml(task.recipients || '—')}</td><td title="${escapeHtml(task.subject)}">${escapeHtml(task.subject || '—')}</td><td>${task.attachmentRefs.length}</td><td>${escapeHtml(task.scheduleAt ? task.scheduleAt.replace('T', ' ') : '—')}</td><td title="${escapeHtml(statusLabel(task))}">${escapeHtml(statusLabel(task))}</td></tr>`).join('');
    if (tasks.length > 100) previewBodyEl.insertAdjacentHTML('beforeend', `<tr><td colspan="6">仅显示前 100 行，实际将处理 ${tasks.length} 行。</td></tr>`);
    $('nmda-preview-card').hidden = !batch.workbook;
    $('nmda-run-card').hidden = !batch.workbook;
    batchStartEl.disabled = batch.running || !tasks.some(t => t.status === 'ready');
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
  dirEl.addEventListener('change', () => { batch.directoryFiles = [...dirEl.files]; refreshFileIndex(); });
  extraFilesEl.addEventListener('change', () => { batch.extraFiles = [...extraFilesEl.files]; refreshFileIndex(); });

  $('nmda-template').addEventListener('click', () => {
    const csv = '\ufeff编号,收件人,主题,正文,附件,定时时间\r\n001,mail-test@example.com,测试主题,这是正文,材料.pdf;附件2.docx,2026-08-25 09:30\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    importFileEl.disabled = true; sheetSelectEl.disabled = true; dirEl.disabled = true; extraFilesEl.disabled = true;
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
          if (task.files.length) await addAttachments(root, task.files, (done, total, name) => setBatchStatus(`任务 ${task.id}：附件 ${done}/${total} · ${name}`));
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
      importFileEl.disabled = false; sheetSelectEl.disabled = false; dirEl.disabled = false; extraFilesEl.disabled = false;
      renderPreview();
    }
  });

  restoreFormState();
  console.info(`[${APP}] v0.2.1 loaded`);
})();
