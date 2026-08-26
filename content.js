(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const STORAGE_KEY = 'nmda.form.v2';
  const DEFAULT_TIMEOUT = 10000;
  const Importer = globalThis.NMDAImporter;
  const Contacts = globalThis.NMDAContacts;
  const Scheduler = globalThis.NMDAScheduler;
  const Roster = globalThis.NMDARoster;
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

  function attachmentEvidenceText(root) {
    const parts = [];
    const nodes = root.querySelectorAll('a,span,div,li,p,[title],[aria-label]');
    for (const el of nodes) {
      if (el.matches?.('input[type="file"], [id$="_attachBrowser"]')) continue;
      const value = compactText(`${textOf(el)} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('aria-label') || ''}`).toLowerCase();
      if (value) parts.push(value);
    }
    return parts.join('\n');
  }

  function attachmentNameVisible(root, fileName, evidenceText = '') {
    const wanted = compactText(fileName).toLowerCase();
    if (!wanted) return false;
    const evidence = evidenceText || attachmentEvidenceText(root);
    return evidence.includes(wanted);
  }

  async function waitAttachmentEvidence(root, files, timeout = 9000) {
    const start = Date.now();
    let missing = [...files];
    while (Date.now() - start < timeout) {
      const evidence = attachmentEvidenceText(root);
      missing = files.filter(file => !attachmentNameVisible(root, file.name, evidence));
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
    // NetEase renders the visible label as <span class="nui-btn-text">存草稿</span>
    // inside a generated <div role="button" id="_mail_button_...">.  The generated
    // id is unstable, and in some Compose layouts the top toolbar is outside the
    // content root returned by findComposeRoot().  Resolve the semantic leaf first
    // and climb to the actual clickable button; search the current Compose scope
    // first, then fall back to the document.
    const scopes = [];
    if (root?.querySelectorAll) scopes.push(root);
    if (root !== document) scopes.push(document);

    for (const scope of scopes) {
      // Strongest evidence: NetEase's own button text span.
      const label = [...scope.querySelectorAll('span.nui-btn-text, [role="button"] span, button span')]
        .filter(visible)
        .find(el => compactText(el) === '存草稿');
      if (label) {
        const button = label.closest('[role="button"],button');
        if (button && visible(button)) return button;
      }

      // Accessibility/text fallback for variants that expose the label on the button.
      const button = [...scope.querySelectorAll('[role="button"],button')]
        .filter(visible)
        .find(el => {
          const aria = compactText(el.getAttribute('aria-label') || '');
          const title = compactText(el.getAttribute('title') || '');
          const ownLabel = [...el.querySelectorAll('span')].some(span => visible(span) && compactText(span) === '存草稿');
          return aria === '存草稿' || title === '存草稿' || ownLabel || compactText(el) === '存草稿';
        });
      if (button) return button;
    }
    return null;
  }

  function isDraftRoute() {
    try { return decodeURIComponent(location.hash || '').includes('"type":"draft"'); }
    catch (_) { return false; }
  }

  function regularDraftSuccessSignals() {
    // Normal drafts stay on the Compose page. NetEase confirms the save with a
    // transient green success tip such as “邮件已于13:23成功保存到草稿箱”.
    // Only visible success/tip nodes count; hidden historical tips remain in the DOM.
    const selectors = [
      '.nui-tips-suc',
      '.nui-frameTips.nui-tips-suc',
      '[aria-live="polite"]',
      '[role="status"]'
    ].join(',');
    return [...document.querySelectorAll(selectors)]
      .filter(visible)
      .filter(el => {
        const text = compactText(el);
        return text.includes('草稿箱') && (
          text.includes('成功保存') ||
          text.includes('已保存') ||
          text.includes('保存成功')
        );
      });
  }

  function draftSignalFingerprint(el) {
    if (!el) return '';
    return `${el.id || ''}|${compactText(el)}`;
  }

  function captureDraftSaveBaseline() {
    return {
      routeWasDraft: isDraftRoute(),
      regularSignals: new Set(regularDraftSuccessSignals().map(draftSignalFingerprint)),
      timedSuccessVisible: isTimedDraftSuccessVisible()
    };
  }

  function isTimedDraftSuccessVisible(deep = false) {
    // Prefer semantic/result-like nodes. A broad div scan is retained only as a
    // throttled compatibility fallback while waiting for NetEase's result page.
    const selector = deep
      ? 'h1,h2,h3,section,div,[role="main"],[role="status"]'
      : 'h1,h2,h3,[role="main"],[role="status"],.nui-tips-suc,[class*="success"],[class*="result"]';
    const candidates = [...document.querySelectorAll(selector)].filter(visible);
    return candidates.some(el => compactText(el).includes('定时发信设置成功'));
  }

  function findFreshRegularDraftSuccess(baseline) {
    const before = baseline?.regularSignals || new Set();
    return regularDraftSuccessSignals().find(el => !before.has(draftSignalFingerprint(el))) || null;
  }

  async function waitForDraftSaveOutcome({ scheduled, baseline }) {
    if (scheduled) {
      const start = Date.now();
      let poll = 0;
      while (Date.now() - start < 9000) {
        // Deep compatibility scans are much more expensive on NetEase's large DOM;
        // run them roughly once per 800 ms instead of every 100 ms.
        const deep = poll % 8 === 7;
        if (!baseline?.timedSuccessVisible && isTimedDraftSuccessVisible(deep)) {
          return { kind: 'scheduled-result', evidence: '定时发信设置成功' };
        }
        poll++;
        await sleep(100);
      }
      throw new Error('已点击“存草稿”，但未检测到“定时发信设置成功”，已停止，避免继续写下一封。');
    }

    return waitFor(() => {
      const tip = findFreshRegularDraftSuccess(baseline);
      if (tip) return { kind: 'regular-tip', evidence: textOf(tip) };
      if (!baseline?.routeWasDraft && isDraftRoute()) {
        return { kind: 'draft-route', evidence: 'Compose 路由进入 draft' };
      }
      return null;
    }, 7000, 100, '已点击“存草稿”，但未检测到网易“成功保存到草稿箱”的新提示，已停止，避免继续写下一封。');
  }

  async function saveDraft(root, options = {}) {
    // “存草稿” is a hard transaction boundary, but NetEase has TWO success
    // state machines:
    //   normal draft    -> editor remains open + transient success tip
    //   scheduled draft -> dedicated “定时发信设置成功” result page
    // Never infer success solely from navigation. Require fresh business evidence
    // produced after this click before the next batch task is allowed to start.
    const scheduled = !!options.scheduled;
    const button = await waitFor(() => findSaveDraftButton(root), 5000, 120, '未找到“存草稿”按钮，已停止，避免草稿未保存。');
    const baseline = captureDraftSaveBaseline();
    button.click();
    const outcome = await waitForDraftSaveOutcome({ scheduled, baseline });
    await sleep(scheduled ? 350 : 250);
    return outcome;
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
              <div class="nmda-subtitle">整理邮件并创建网易草稿</div>
            </div>
          </div>
          <div class="nmda-head-actions">
            <span class="nmda-safe-badge">只建草稿 · 不自动发送</span>
            <button class="nmda-icon-btn" id="nmda-expand" type="button" title="全屏 / 还原">⛶</button>
            <button class="nmda-icon-btn nmda-close" id="nmda-close" type="button" title="关闭">×</button>
          </div>
        </header>

        <nav class="nmda-tabs" aria-label="工作台模块">
          <div class="nmda-nav-label">工作区</div>
          <button class="nmda-tab is-active" data-tab="batch" type="button"><span class="nmda-tab-icon">▦</span><span><strong>批量草稿</strong><small>导入 · 检查 · 创建</small></span></button>
          <button class="nmda-tab" data-tab="single" type="button"><span class="nmda-tab-icon">✎</span><span><strong>单封草稿</strong><small>临时创建一封</small></span></button>
          <button class="nmda-tab" data-tab="contacts" type="button"><span class="nmda-tab-icon">◎</span><span><strong>联系人</strong><small>联系记录与跟进</small></span></button>

        </nav>

        <main class="nmda-main">
          <div class="nmda-page-head" data-page-head="single" hidden>
            <div><h2>单封草稿</h2><p>填写邮件内容，按需要加入附件或定时，然后保存草稿。</p></div>
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
                <div class="nmda-card">
                  <div class="nmda-card-head"><div><div class="nmda-card-title">附件</div></div></div>
                  <label class="nmda-field"><input id="nmda-files" type="file" multiple><span class="nmda-hint">文件仅保存在当前页面内存；刷新后需重新选择</span></label>
                </div>
                <div class="nmda-card">
                  <div class="nmda-card-head"><div><div class="nmda-card-title">定时时间</div></div></div>
                  <label class="nmda-field"><span class="nmda-label">可选</span><input id="nmda-schedule-at" type="datetime-local"><span class="nmda-hint">留空即普通草稿；填写时间则自动设置定时发送。</span></label>
                </div>
                <div class="nmda-card nmda-action-card">
                  <div class="nmda-actions"><button class="nmda-btn nmda-btn-primary" id="nmda-fill" type="button">创建草稿</button></div>
                  <div class="nmda-hint">创建后自动保存为草稿，不会自动发送。</div>
                  <div id="nmda-status">准备就绪。</div>
                </div>
              </aside>
            </div>
          </section>


          <div class="nmda-page-head" data-page-head="batch">
            <div><h2>批量草稿</h2><p>添加资料，检查解析结果，选择邮件并安排时间。</p></div>
            <div class="nmda-page-head-meta"><span class="nmda-safe-inline">只保存草稿</span></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page nmda-bulk-workbench" data-pane="batch">
            <aside class="nmda-process-guide" aria-label="批量流程">
              <div class="nmda-process-guide-title"><strong>当前批次</strong></div>
              <button type="button" data-flow-step="1"><span>1</span><strong>添加资料</strong><small>邮件与附件</small></button>
              <i></i>
              <button type="button" data-flow-step="2"><span>2</span><strong>检查邮件</strong><small>查看解析结果</small></button>
              <i></i>
              <button type="button" data-flow-step="3"><span>3</span><strong>选择与安排</strong><small>勾选并设置时间</small></button>
              <i></i>
              <button type="button" data-flow-step="4"><span>4</span><strong>创建草稿</strong><small>保存到草稿箱</small></button>
            </aside>

            <div class="nmda-workflow-stage-head" id="nmda-stage-prepare">
              <span class="nmda-stage-number">01</span><div><strong>准备邮件</strong><small>把邮件资料加入本批次。</small></div>
            </div>
            <div class="nmda-ingest-workspace nmda-ingest-workspace-v2">
              <div class="nmda-card nmda-ingest-source-card" id="nmda-import-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title">添加资料</div></div><div class="nmda-row nmda-wrap"><span class="nmda-import-busy-badge" id="nmda-import-busy-badge" hidden>正在处理…</span><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-reset-import" type="button" hidden>清空本批次</button></div></div>
                <input id="nmda-import-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <input id="nmda-import-dir" type="file" webkitdirectory multiple hidden>
                <input id="nmda-import-package" type="file" hidden accept=".zip">
                <input id="nmda-roster-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <div class="nmda-source-action-grid">
                  <label class="nmda-source-action" for="nmda-import-file"><span class="nmda-source-action-icon">＋</span><strong>选择文件</strong><small>Word、Excel、CSV、ZIP</small></label>
                  <label class="nmda-source-action" for="nmda-import-dir"><span class="nmda-source-action-icon">▤</span><strong>选择文件夹</strong><small>一次加入整个文件夹</small></label>
                  <label class="nmda-source-action nmda-source-action-legacy" for="nmda-import-package" hidden><span class="nmda-source-action-icon">▣</span><strong>打开 ZIP</strong></label>
                  <button class="nmda-source-action nmda-source-action-button" id="nmda-show-paste" type="button"><span class="nmda-source-action-icon">⌘</span><strong>粘贴内容</strong><small>直接粘贴文本或表格</small></button>
                </div>
                <div class="nmda-paste-panel" id="nmda-paste-panel" hidden>
                  <textarea id="nmda-paste-source" placeholder="粘贴邮件、名单或表格内容"></textarea>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-paste-import" type="button">加入本批次</button></div>
                </div>
                <div class="nmda-ingest-source-tools"><span id="nmda-import-format-info" class="nmda-hint">支持常见文档、表格和文本。</span><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-template" type="button">下载模板</button></div>
                <details class="nmda-compact-options">
                  <summary>更多资料（可选）</summary>
                  <div class="nmda-roster-source-strip">
                    <div><strong>总套磁名单</strong><small>用于补全学校和核对联系人。</small></div>
                    <div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-small" for="nmda-roster-file">选择总名单</label><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-remove" type="button" hidden>移除</button></div>
                  </div>
                  <div id="nmda-roster-source-status" class="nmda-hint">未添加总名单。</div>
                </details>
                <div id="nmda-import-status" class="nmda-summary nmda-import-status">还没有添加资料。</div>
                <div id="nmda-source-inventory" class="nmda-source-inventory" hidden></div>

                <details class="nmda-optional-source-details" id="nmda-attachments-card" hidden>
                  <summary><span><strong>添加附件</strong><small>仅在邮件需要附件时使用</small></span><span>展开</span></summary>
                  <div id="nmda-attachment-summary" class="nmda-summary">生成邮件后会显示附件匹配情况。</div>
                  <div class="nmda-attachment-grid nmda-attachment-grid-simple">
                    <div class="nmda-file-source"><span class="nmda-label">任务附件</span><div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-small nmda-file-button">选择文件<input id="nmda-attachment-files" type="file" multiple hidden></label><label class="nmda-btn nmda-btn-small nmda-file-button">选择目录<input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden></label></div></div>
                    <div class="nmda-file-source nmda-file-source-shared"><span class="nmda-label">每封都附加</span><label class="nmda-btn nmda-btn-small nmda-file-button">选择公共附件<input id="nmda-shared-files" type="file" multiple hidden></label></div>
                  </div>
                  <div id="nmda-attachment-drop" class="nmda-attachment-drop">也可以把附件拖到这里</div>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-clear-attachments" type="button">清空附件</button><span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span></div>
                  <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden><div class="nmda-card-subtitle">需要补充的附件</div><div id="nmda-attachment-resolution-list"></div></div>
                </details>
              </div>

              <div class="nmda-card nmda-ingest-result-card" id="nmda-ingest-result-card" hidden>
                <div class="nmda-card-head nmda-ingest-result-head">
                  <div><div class="nmda-card-title">解析结果</div></div>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-restore-excluded" type="button" hidden>恢复已排除</button><button class="nmda-btn nmda-btn-small" id="nmda-review-import-issues" type="button" hidden>检查邮件</button></div>
                </div>
                <div id="nmda-import-preview-summary" class="nmda-ingest-health"></div>
                <div id="nmda-review-guidance" class="nmda-review-guidance">解析完成后可查看每封邮件的结果。</div>
                <div class="nmda-import-handoff-card" id="nmda-import-handoff-card" hidden>
                  <div id="nmda-import-ready-summary" class="nmda-import-ready-summary">尚未生成任务。</div>
                  <div class="nmda-row nmda-import-handoff-actions"><span class="nmda-hint" id="nmda-handoff-hint"></span><button class="nmda-btn nmda-btn-primary" id="nmda-go-batch" type="button">继续选择邮件</button></div>
                </div>
              </div>

              <div class="nmda-card nmda-inline-review" id="nmda-inline-review" hidden>
                <div class="nmda-inline-review-top">
                  <div><div class="nmda-card-title">解析预览</div><div class="nmda-card-desc">检查系统整理出的收件人、主题和正文；有问题时直接修改。</div></div>
                  <div id="nmda-review-page-summary" class="nmda-review-page-summary"></div>
                </div>
                <div class="nmda-review-viewbar">
                  <div class="nmda-review-filter" role="group" aria-label="解析预览范围"><button class="is-active" type="button" data-review-filter="pending">待处理</button><button type="button" data-review-filter="all">全部邮件</button></div>
                  <div class="nmda-review-view-actions"><button class="nmda-btn nmda-btn-small" id="nmda-review-select-filtered" type="button">选择当前列表</button></div>
                </div>
                <div class="nmda-review-batchbar" id="nmda-review-batchbar" hidden>
                  <div><strong id="nmda-review-selected-count">已选 0 封</strong><small>可一次确认内容完整的所选邮件。</small></div>
                  <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-confirm-selected" type="button">确认所选</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-clear-selected" type="button">取消选择</button>
                </div>
                <div class="nmda-review-page-empty" id="nmda-review-page-empty">添加资料后，这里会显示解析结果。</div>
                <div class="nmda-review-workbench" id="nmda-import-editor-overlay" hidden>
                  <div class="nmda-review-head">
                    <div><div class="nmda-card-title" id="nmda-import-editor-title">解析预览</div><div class="nmda-card-desc" id="nmda-import-editor-evidence">选择一封邮件查看解析结果。</div></div>
                    <div class="nmda-review-head-actions"><span id="nmda-review-progress" class="nmda-review-progress"></span></div>
                  </div>
                  <div class="nmda-review-layout">
                    <aside class="nmda-review-queue-pane">
                      <div class="nmda-review-pane-title"><strong>邮件列表</strong><small id="nmda-review-queue-caption">优先显示需要修改的邮件</small></div>
                      <div id="nmda-review-queue" class="nmda-review-queue"></div>
                    </aside>
                    <section class="nmda-review-evidence-pane">
                      <div class="nmda-review-pane-title"><strong>原文</strong><small>用于对照</small></div>
                      <div id="nmda-review-source-meta" class="nmda-review-source-meta"></div>
                      <div id="nmda-review-email-candidates" class="nmda-review-candidates"></div>
                      <div id="nmda-review-source-context" class="nmda-review-source-context"></div>
                    </section>
                    <section class="nmda-review-edit-pane">
                      <div class="nmda-review-pane-title"><strong>邮件内容</strong><small id="nmda-review-problem-summary">需要时直接修改</small></div>
                      <div id="nmda-review-feedback" class="nmda-review-feedback" hidden></div>
                      <div class="nmda-import-editor-grid nmda-review-core-fields">
                        <label class="nmda-field" id="nmda-review-field-recipients"><span class="nmda-label">收件人</span><input id="nmda-import-edit-recipients" type="text" placeholder="recipient@example.edu"></label>
                        <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-subject"><span class="nmda-label">主题</span><input id="nmda-import-edit-subject" type="text"></label>
                        <div class="nmda-context-assist" id="nmda-subject-assist" hidden>
                          <div><strong id="nmda-subject-assist-title">还有邮件缺少主题</strong><small id="nmda-subject-assist-copy"></small></div>
                          <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-subject-assist-apply" type="button">一键填写</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-subject-assist-dismiss" type="button">不用</button></div>
                        </div>
                        <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-body"><span class="nmda-label">正文</span><textarea id="nmda-import-edit-body"></textarea></label>
                      </div>
                      <input id="nmda-import-edit-schedule" type="hidden">
                      <input id="nmda-import-edit-attachments" type="hidden">
                      <input id="nmda-import-edit-tags" type="hidden">
                      <div class="nmda-review-actions">
                        <button class="nmda-btn nmda-btn-danger-quiet" id="nmda-review-exclude" type="button">排除此封</button>
                        <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-quiet" id="nmda-import-editor-cancel" type="button">收起预览</button><button class="nmda-btn" id="nmda-import-editor-save" type="button">确认本封</button><button class="nmda-btn nmda-btn-primary" id="nmda-import-editor-next" type="button">确认并下一封</button></div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <div class="nmda-card nmda-roster-audit-card" id="nmda-roster-audit-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-card-title">名单差异</div></div></div>
                <input id="nmda-roster-enabled" type="checkbox" checked hidden>
                <input id="nmda-roster-auto-school" type="checkbox" checked hidden>
                <input id="nmda-roster-strict" type="checkbox" hidden>
                <div id="nmda-roster-audit-summary" class="nmda-ingest-health"></div>
                <div id="nmda-roster-audit-note" class="nmda-review-guidance"></div>
                <details class="nmda-roster-details"><summary>查看差异</summary><div id="nmda-roster-audit-details" class="nmda-roster-audit-details"></div></details>
              </div>

              <details class="nmda-card nmda-ingest-diagnostics" id="nmda-ingest-diagnostics" hidden>
                <summary><span><strong>读取结果不对？</strong><small>需要时再调整</small></span><span>展开</span></summary>
                <div class="nmda-diagnostics-grid">
                  <div class="nmda-ingest-structure-card" id="nmda-structure-card" hidden>
                    <div class="nmda-card-subtitle">来源内容</div>
                    <div class="nmda-field"><span class="nmda-label">本批次内容</span><div id="nmda-collection-list" class="nmda-collection-list"></div></div>
                    <label class="nmda-field" id="nmda-collection-field"><span class="nmda-label">当前内容</span><select id="nmda-collection-select"></select></label>
                    <div id="nmda-structure-summary" class="nmda-structure-summary"></div>
                    <div class="nmda-raw-preview-wrap"><div id="nmda-structure-preview" class="nmda-structure-preview"></div></div>
                  </div>
                  <div class="nmda-ingest-mapping-card" id="nmda-mapping-card" hidden>
                    <div class="nmda-card-subtitle">内容对应</div>
                    <div id="nmda-header-info" class="nmda-hint nmda-semantic-detection"></div>
                    <div id="nmda-semantic-summary" class="nmda-semantic-summary"></div>
                    <div class="nmda-row nmda-wrap nmda-mapping-actions"><button class="nmda-btn nmda-btn-small" id="nmda-apply-profile" type="button" hidden>使用已有设置</button><button class="nmda-btn nmda-btn-small" id="nmda-save-profile" type="button" hidden>保存当前设置</button><button class="nmda-btn nmda-btn-small" id="nmda-toggle-mapping" type="button">调整对应内容</button></div>
                    <div id="nmda-profile-info" class="nmda-hint"></div>
                    <div id="nmda-mapping" class="nmda-mapping nmda-semantic-mapping" hidden></div>
                  </div>
                </div>
              </details>
            </div>

            <div class="nmda-workflow-stage-separator" aria-hidden="true"></div>
            <div class="nmda-workflow-stage-head" id="nmda-stage-execute" hidden>
              <span class="nmda-stage-number">02</span><div><strong>选择与安排</strong><small>勾选本次要创建的邮件；需要时自动安排时间。</small></div>
            </div>
            <div class="nmda-batch-empty" id="nmda-batch-empty" hidden><button id="nmda-go-import" type="button" hidden>回到准备区</button></div>

            <div class="nmda-card nmda-list-card" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head"><div><div><div class="nmda-card-title">选择邮件</div><div class="nmda-card-desc">勾选本次要创建的邮件；时间可在表格中直接修改。</div></div></div><div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div></div>
              <div class="nmda-task-toolbar">
                <label class="nmda-search-field"><input id="nmda-batch-search" type="search" placeholder="搜索收件人、学校或主题"></label>
                <label class="nmda-compact-select"><span>联系状态</span><select id="nmda-batch-stage-filter"><option value="">全部</option><option value="未联系">未联系</option><option value="已发送">已发送</option><option value="已回复">已回复</option></select></label>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">选择当前结果</button>
                <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-selection" type="button">清空选择</button>
              </div>
              <input id="nmda-batch-tag-include" type="hidden"><button id="nmda-clear-tag-filter" type="button" hidden></button><div id="nmda-batch-tag-chips" hidden></div>
              <input id="nmda-bulk-tag-value" type="hidden"><button id="nmda-bulk-add-tag" type="button" hidden></button><button id="nmda-bulk-remove-tag" type="button" hidden></button><button id="nmda-bulk-disable" type="button" hidden></button>

              <details class="nmda-inline-scheduler" id="nmda-scheduler-card" hidden open>
                <summary><span><strong>自动安排时间</strong><small id="nmda-schedule-summary"></small></span><span id="nmda-scheduler-toggle-label">收起</span></summary>
                <div class="nmda-scheduler-grid">
                  <label class="nmda-field"><span class="nmda-label">开始时间</span><input id="nmda-rule-start-at" type="datetime-local"></label>
                  <label class="nmda-field"><span class="nmda-label">同校每轮最多</span><input id="nmda-rule-max-school" type="number" min="1" max="20" step="1" value="1"></label>
                  <label class="nmda-field"><span class="nmda-label">间隔</span><div class="nmda-input-suffix"><input id="nmda-rule-interval-days" type="number" min="1" max="365" step="1" value="7"><span>天</span></div></label>
                  <label class="nmda-check-card"><input id="nmda-rule-preserve-existing" type="checkbox" checked><span><strong>保留已有时间</strong></span></label>
                </div>
                <div class="nmda-scheduler-actions">
                  <div id="nmda-schedule-rule-preview" class="nmda-schedule-rule-preview">同校每 7 天最多 1 位。</div>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-auto-schedule" type="button">清除自动时间</button>
                  <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-apply-schedule" type="button">应用</button>
                </div>
              </details>

              <div class="nmda-table-wrap nmda-batch-table-wrap"><table class="nmda-table nmda-batch-table"><thead><tr><th>选择</th><th>收件人</th><th>学校</th><th>主题</th><th>时间</th><th>状态</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
            </div>

            <div class="nmda-card nmda-run-card" id="nmda-run-card" hidden>
              <div class="nmda-run-left"><div><div class="nmda-card-title">创建草稿</div><div id="nmda-batch-status" class="nmda-run-status">先选择要创建的邮件。</div></div></div>
              <div class="nmda-run-controls nmda-run-controls-simple">
                <button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">创建所选草稿</button>
                <button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封后停止</button>
              </div>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="contacts" hidden>
            <div><h2>联系人</h2><p>查看联系进度、发送记录与当前草稿，并管理后续跟进。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="contacts" hidden>
            <div class="nmda-crm-top-grid">
              <div class="nmda-card nmda-mail-history-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title">邮箱同步</div><div class="nmda-card-desc">读取最近的已发送和草稿变化，并更新联系人状态。</div></div><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-refresh-history" type="button">同步邮箱</button></div>
                <div id="nmda-mailbox-read-meta" class="nmda-read-meta">尚未同步邮箱状态。</div>
                <div id="nmda-contact-status" class="nmda-summary">正在加载联系人…</div>
                <details class="nmda-maintenance-details">
                  <summary>维护选项</summary>
                  <div class="nmda-maintenance-row"><div><strong>重建联系人记录</strong><small>仅在记录明显不一致时使用；会重新读取已发送和草稿。</small></div><button class="nmda-btn nmda-btn-small" id="nmda-rebuild-history" type="button">重建记录</button></div>
                </details>
              </div>
              <div class="nmda-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title">联系人操作</div></div></div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出联系人 CSV</button></div>
                <div class="nmda-hint">暂停或不再联系的联系人会自动从批量执行中拦截。</div>
              </div>
            </div>

            <div class="nmda-card nmda-contact-list-card">
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-card-title">联系人列表</div></div><div id="nmda-contact-summary" class="nmda-summary nmda-summary-inline">0 个联系人</div></div>
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
  const recipientsEl = $('nmda-recipients'), subjectEl = $('nmda-subject'), bodyEl = $('nmda-body-text'), filesEl = $('nmda-files');
  const scheduleAtEl = $('nmda-schedule-at');
  const fillButton = $('nmda-fill'), statusEl = $('nmda-status');

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
    return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || 'default';
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
      if(typeof renderPreview==='function')scheduleBatchRender({aux:false});
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
    let review = 0, selected = 0, scheduled = 0;
    for (const task of (batch.tasks || [])) {
      if (hasSource && typeof taskNeedsImportReview === 'function' && taskNeedsImportReview(task)) review++;
      if (handed && task.enabled && task.status === 'ready') { selected++; if (task.scheduleAt) scheduled++; }
    }
    guides.forEach(guide => {
      guide.querySelectorAll('[data-flow-step]').forEach(button => {
        const step = Number(button.dataset.flowStep || 0);
        let state='locked', unlocked=false;
        if(step===1){unlocked=true; state=!hasSource?'active':attachmentIssues?'active':'done';}
        else if(step===2){unlocked=hasSource; state=!hasSource?'locked':review?(attachmentIssues?'ready':'active'):'done';}
        else if(step===3){unlocked=handed; state=!handed?'locked':selected?'done':'active';}
        else if(step===4){unlocked=handed&&selected>0; state=unlocked?'active':'locked';}
        button.dataset.state=state; button.disabled=!unlocked;
        const small=button.querySelector('small');
        if(!small) return;
        if(step===1) small.textContent=!hasSource?'邮件与附件':attachmentIssues?`还需添加 ${attachmentIssues} 个附件`:'资料已就绪';
        if(step===2) small.textContent=!hasSource?'添加资料后查看':review?`${review} 封邮件待处理`:'邮件内容可用';
        if(step===3) small.textContent=!handed?'先处理必要问题':selected?`已选 ${selected} 封${scheduled?` · 定时 ${scheduled}`:''}`:'选择本次邮件';
        if(step===4) small.textContent=!unlocked?'选择邮件后可创建':`可创建 ${selected} 封`;
      });
    });
  }

  function goToProcessStep(step) {
    const n = Number(step || 1);
    if (n === 1) {
      setWorkbenchTab('batch');
      requestAnimationFrame(() => $('nmda-import-card')?.scrollIntoView?.({behavior:'smooth', block:'start'}));
      return;
    }
    if (n === 2) {
      if (!batch.dataset) { setWorkbenchTab('batch'); return; }
      openReviewWorkspace();
      return;
    }
    if (!batch.handoffComplete) {
      setWorkbenchTab('batch');
      setImportStatus('先把解析结果中必须补充的内容处理好，再继续选择邮件。', 'warn');
      requestAnimationFrame(() => $('nmda-ingest-result-card')?.scrollIntoView?.({behavior:'smooth', block:'center'}));
      return;
    }
    setWorkbenchTab('batch');
    requestAnimationFrame(() => {
      const target = n === 3 ? $('nmda-preview-card') : $('nmda-run-card');
      target?.scrollIntoView?.({behavior:'smooth', block:n===4?'end':'start'});
    });
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
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const name = currentWorkbenchTab();
      if (name === 'batch' && viewPerf.batchDirty) scheduleBatchRender();
      if (name === 'contacts' && viewPerf.contactsDirty) scheduleContactsRender();
    }
  });
  $('nmda-close').addEventListener('click', () => { panel.hidden = true; });
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

  fillButton.addEventListener('click', async () => {
    fillButton.disabled = true; await saveFormState();
    try {
      setStatus('1/5 打开写信页…'); const root = await openCompose();
      setStatus('2/5 填写收件人、主题和正文…'); await setRecipients(root, recipientsEl.value); await setSubject(root, subjectEl.value); await setBody(root, bodyEl.value);
      if (filesEl.files.length) {
        setStatus(`3/5 注入附件（0/${filesEl.files.length}）…`);
        const upload = await addAttachments(root, [...filesEl.files], (done, total, name) => setStatus(`3/5 上传附件（${done}/${total}）：${name}`));
        if (!upload.verified) setStatus(`3/5 已提交附件，但页面暂未确认：${upload.missing.map(file => file.name).join('、')}。将继续保存草稿。`, 'warn');
      } else setStatus('3/5 未选择附件，跳过。');
      if (scheduleAtEl.value) {
        setStatus('4/5 设置定时发送…'); const minute = await setSchedule(root, scheduleAtEl.value);
        const requestedMinute = new Date(scheduleAtEl.value).getMinutes();
        if (Number(minute) !== requestedMinute) { setStatus(`4/5 定时已设置；分钟被网易可选项调整为 ${minute} 分。`, 'warn'); await sleep(500); }
      } else setStatus('4/5 未填写定时时间，按普通草稿处理。');
      setStatus(`5/5 点击“存草稿”并确认${scheduleAtEl.value ? '定时设置成功' : '保存到草稿箱'}…`);
      const saveOutcome = await saveDraft(root, { scheduled: !!scheduleAtEl.value });
      setStatus(`完成：草稿已确认保存（${saveOutcome.evidence}）。不会自动发送。`, 'ok');
    } catch (error) { console.error(`[${APP}]`, error); setStatus(`失败：${error.message}`, 'error'); }
    finally { fillButton.disabled = false; }
  });

  const batch = {
    dataset: null, collectionIndex: 0, collectionConfigs: new Map(), detection: null, mapping: {}, tasks: [],
    directoryFiles: [], taskFiles: [], sharedFiles: [], fileIndex: Importer?.buildFileIndex?.([]),
    attachmentOverrides: new Map(), taskEdits: new Map(), running: false, stopRequested: false,
    importMeta: null, profileSuggestion: null,
    sessionId: 0, importBusy: false, schedulePlan: null,
    scheduleRules: { ...(Scheduler?.DEFAULT_RULES || { maxPerGroupPerRound:1, intervalDays:7, preserveExisting:true, intraRoundMinutes:10 }), startAt: Scheduler?.defaultStart?.() || '' },
    roster: { dataset:null, entries:[], audit:null, warnings:[], enabled:true, autoSchool:true, strict:false, sourceNames:[] },
    handoffComplete: false, reviewFilter: 'pending', reviewSelected: new Set(), attachmentAttentionShown: false
  };

  const importFileEl = $('nmda-import-file'), importDirEl = $('nmda-import-dir'), importPackageEl = $('nmda-import-package'), rosterFileEl = $('nmda-roster-file'), collectionSelectEl = $('nmda-collection-select'), mappingEl = $('nmda-mapping'), mappingToggleEl = $('nmda-toggle-mapping');
  const pasteSourceEl = $('nmda-paste-source'), importPreviewSummaryEl = $('nmda-import-preview-summary'), importReviewBtnEl = $('nmda-review-import-issues');
  const subjectAssistEl = $('nmda-subject-assist'), subjectAssistTitleEl = $('nmda-subject-assist-title'), subjectAssistCopyEl = $('nmda-subject-assist-copy');
  const importEditorOverlayEl = $('nmda-import-editor-overlay'), importEditRecipientsEl = $('nmda-import-edit-recipients'), importEditSubjectEl = $('nmda-import-edit-subject'), importEditBodyEl = $('nmda-import-edit-body'), importEditAttachmentsEl = $('nmda-import-edit-attachments'), importEditScheduleEl = $('nmda-import-edit-schedule'), importEditTagsEl = $('nmda-import-edit-tags'), importEditorEvidenceEl = $('nmda-import-editor-evidence');
  const reviewQueueEl = $('nmda-review-queue'), reviewSourceContextEl = $('nmda-review-source-context'), reviewSourceMetaEl = $('nmda-review-source-meta'), reviewCandidatesEl = $('nmda-review-email-candidates'), reviewProgressEl = $('nmda-review-progress'), reviewProblemSummaryEl = $('nmda-review-problem-summary'), reviewFeedbackEl = $('nmda-review-feedback');
  const reviewNavCountEl=$('nmda-review-nav-count'), reviewInlineEl=$('nmda-inline-review'), reviewPageSummaryEl=$('nmda-review-page-summary'), reviewPageEmptyEl=$('nmda-review-page-empty'), reviewQueueCaptionEl=$('nmda-review-queue-caption');
  const reviewBatchbarEl=$('nmda-review-batchbar'), reviewSelectedCountEl=$('nmda-review-selected-count');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files'), sharedFilesEl = $('nmda-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status'), importStatusEl = $('nmda-import-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop');
  const scheduleStartEl = $('nmda-rule-start-at'), scheduleMaxSchoolEl = $('nmda-rule-max-school'), scheduleIntervalDaysEl = $('nmda-rule-interval-days'), schedulePreserveEl = $('nmda-rule-preserve-existing');
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
      ...(Scheduler?.DEFAULT_RULES || {maxPerGroupPerRound:1,intervalDays:7,preserveExisting:true,intraRoundMinutes:10}),
      ...prefs,
      startAt: Scheduler?.defaultStart?.() || ''
    };
  }
  function saveScheduleRulePrefs(rules) {
    try { localStorage.setItem(SCHEDULE_PREFS_KEY, JSON.stringify({maxPerGroupPerRound:rules.maxPerGroupPerRound,intervalDays:rules.intervalDays,preserveExisting:rules.preserveExisting,intraRoundMinutes:rules.intraRoundMinutes||10})); } catch (_) {}
  }
  function syncScheduleRuleControls() {
    if(!batch.scheduleRules) batch.scheduleRules=freshScheduleRules();
    if(scheduleStartEl && document.activeElement!==scheduleStartEl) scheduleStartEl.value=batch.scheduleRules.startAt||'';
    if(scheduleMaxSchoolEl && document.activeElement!==scheduleMaxSchoolEl) scheduleMaxSchoolEl.value=String(batch.scheduleRules.maxPerGroupPerRound||1);
    if(scheduleIntervalDaysEl && document.activeElement!==scheduleIntervalDaysEl) scheduleIntervalDaysEl.value=String(batch.scheduleRules.intervalDays||7);
    if(schedulePreserveEl) schedulePreserveEl.checked=batch.scheduleRules.preserveExisting!==false;
  }
  function readScheduleRuleControls() {
    const rules=Scheduler?.normalizeRules?.({
      startAt:scheduleStartEl?.value||batch.scheduleRules?.startAt||'',
      maxPerGroupPerRound:scheduleMaxSchoolEl?.value||1,
      intervalDays:scheduleIntervalDaysEl?.value||7,
      preserveExisting:schedulePreserveEl?.checked!==false,
      intraRoundMinutes:batch.scheduleRules?.intraRoundMinutes||10
    }) || {startAt:scheduleStartEl?.value||'',maxPerGroupPerRound:Number(scheduleMaxSchoolEl?.value||1),intervalDays:Number(scheduleIntervalDaysEl?.value||7),preserveExisting:schedulePreserveEl?.checked!==false};
    batch.scheduleRules=rules; saveScheduleRulePrefs(rules); return rules;
  }
  batch.scheduleRules = freshScheduleRules();

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
    if(input.dataset.taskSchool){
      const task=batch.tasks.find(item=>item.editKey===input.dataset.taskSchool);if(!task)return;
      setTaskEdit(task,{school:input.value});
      // School affects roster matching and auto-schedule grouping, so this is a
      // real structural change rather than a cosmetic table edit.
      rebuildTasks();
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
    const visible=reviewVisibleTasks(),allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    const selectButton=$('nmda-review-select-filtered');if(selectButton)selectButton.textContent=allSelected?'取消当前选择':'选择当前列表';
  });


  function renderImportLifecycleState() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const active = !!batch.dataset || !!batch.importBusy || !!batch.roster?.entries?.length;
    if (resetImportEl) resetImportEl.hidden = !active;
    if (importBusyBadgeEl) importBusyBadgeEl.hidden = !batch.importBusy;
    const sourceCard = $('nmda-import-card');
    if (sourceCard) {
      sourceCard.dataset.busy = batch.importBusy ? '1' : '0';
      sourceCard.dataset.loaded = batch.dataset ? '1' : '0';
    }
  }

  function beginImportSession(message) {
    // The reference roster is an independent master-data source. Replacing the mail source keeps it;
    // only explicit ‘重新开始’ / ‘移除总名单’ clears the reference source.
    const keepRoster = batch.roster?.entries?.length ? batch.roster : null;
    resetImportWorkspace({ keepStatus: true, invalidate: true });
    if (keepRoster) {
      batch.roster = keepRoster;
      const rosterStatus=$('nmda-roster-source-status'); if(rosterStatus)rosterStatus.textContent=`已添加 ${keepRoster.entries.length} 条总名单人数${keepRoster.sourceNames?.length?` · ${keepRoster.sourceNames.join('、')}`:''}`;
      const rosterRemove=$('nmda-roster-remove'); if(rosterRemove)rosterRemove.hidden=false;
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
      const preferred = collection.meta?.preferred === true;
      const supplemental = collection.meta?.supplemental === true;
      config = { enabled: supplemental ? false : (preferred || (detection.recognized >= 2 && detection.core >= 1)), detection, mapping: { ...detection.mapping }, profileSuggestion: null };
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
      'spreadsheetml':'Excel XML', 'nmda-zip':'ZIP 批次', 'multi':'混合来源'
    };
    return map[String(format || '').toLowerCase()] || String(format || '自动识别').toUpperCase();
  }

  function collectionKind(collection) {
    const meta = collection?.meta || {};
    const format = String(meta.format || batch.dataset?.format || '').toLowerCase();
    if (meta.mailFrames) return { label:'邮件内容', icon:'✉', tone:'mail' };
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
    if (sources.length <= 1 && !embeddedCount && !warnings.length) { box.hidden = true; box.innerHTML = ''; return; }
    const sourceRows = sources.length ? sources.map((file, index) => {
      const name = sourceFileName(file);
      const related = sets.filter(rs => String(rs.source || '') === String(file.name || '') || String(rs.source || '') === name);
      const formats = [...new Set(related.map(rs => rs.meta?.format).filter(Boolean))];
      const format = formats.length ? formats.map(formatDisplayName).join(' + ') : formatDisplayName(dataset.format);
      return `<div class="nmda-source-item"><div class="nmda-source-item-icon">${escapeHtml(collectionKind(related[0]).icon)}</div><div class="nmda-source-item-main"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small>${escapeHtml(format)} · ${related.length || (sources.length === 1 ? sets.length : 0)} 组内容 · ${humanFileSize(file.size)}</small></div><span class="nmda-source-item-index">${index + 1}</span></div>`;
    }).join('') : `<div class="nmda-source-item"><div class="nmda-source-item-icon">◇</div><div class="nmda-source-item-main"><strong>粘贴内容</strong><small>${escapeHtml(formatDisplayName(dataset.format))} · ${sets.length} 组内容</small></div></div>`;
    const meta = `<div class="nmda-source-inventory-head"><strong>${sources.length || 1} 个来源</strong><span>${sets.length} 组内容${embeddedCount ? ` · ${embeddedCount} 个内嵌附件` : ''}${warnings.length ? ` · ${warnings.length} 条警告` : ''}</span></div>`;
    const warningHtml = warnings.length ? `<details class="nmda-ingest-warnings"><summary>查看 ${warnings.length} 条读取提示</summary>${warnings.slice(0,20).map(w => `<div>${escapeHtml(w)}</div>`).join('')}${warnings.length > 20 ? `<div>另有 ${warnings.length - 20} 条未展开。</div>` : ''}</details>` : '';
    box.innerHTML = meta + `<div class="nmda-source-list">${sourceRows}</div>` + warningHtml;
    box.hidden = false;
  }

  function renderCollectionList() {
    const box = $('nmda-collection-list');
    if (!box) return;
    const sets = recordSets();
    box.innerHTML = sets.map((collection, index) => {
      const config = ensureCollectionConfig(index);
      const kind = collectionKind(collection);
      const detection = config?.detection || Importer.detectHeader(collection.rows || []);
      const count = Math.max(0, (collection.rows || []).length - detection.index - 1);
      const active = index === batch.collectionIndex;
      const scan = collection.meta?.mailScan;
      const detail = collection.meta?.mailFrames && scan
        ? `${kind.label} · ${scan.records || count} 封 · ${scan.complete || 0} 可用 · ${scan.missingRecipients || 0} 待补邮箱`
        : `${kind.label} · ${count} 条记录`;
      return `<div class="nmda-collection-row ${active ? 'is-active' : ''}"><label><input type="checkbox" data-collection-enabled="${index}" ${config?.enabled !== false ? 'checked' : ''}><span class="nmda-collection-kind">${escapeHtml(kind.icon)}</span><span class="nmda-collection-main"><strong>${escapeHtml(collection.name || `内容 ${index + 1}`)}</strong><small>${escapeHtml(detail)}</small></span></label><button type="button" class="nmda-btn nmda-btn-small" data-inspect-collection="${index}">${active ? '正在查看' : '查看 / 调整'}</button></div>`;
    }).join('');
    box.querySelectorAll('[data-collection-enabled]').forEach(input => input.addEventListener('change', () => {
      const index = Number(input.dataset.collectionEnabled);
      const config = ensureCollectionConfig(index);
      if (!config) return;
      config.enabled = input.checked;
      batch.handoffComplete=false;
      rebuildTasks();
      renderCollectionList();
    }));
    box.querySelectorAll('[data-inspect-collection]').forEach(button => button.addEventListener('click', async () => {
      const index = Number(button.dataset.inspectCollection);
      collectionSelectEl.value = String(index);
      configureCollection(index, false);
      renderCollectionList();
    }));
  }

  function renderCollectionOverview() {
    const collection = currentCollection();
    const summary = $('nmda-structure-summary');
    const preview = $('nmda-structure-preview');
    if (!collection || !summary || !preview) return;
    const kind = collectionKind(collection);
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
    const direct=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i.test(raw);
    if (direct) return true;
    const parsed = Contacts?.parseRecipients?.(raw) || [];
    return parsed.some(item => /@/.test(String(item?.email || item || '')));
  }

  function isAutoResolvableReviewIssue(issue) {
    const text=String(issue||'');
    return /^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(text)
      || /未定位收件人|主题为空|正文过短/.test(text);
  }

  function unresolvedImportIssues(task) {
    const out=[];
    if (!String(task?.recipients||'').trim()) out.push('缺少收件人');
    else if (!recipientLooksValid(task.recipients)) out.push('收件人邮箱格式无效');
    if (!String(task?.subject||'').trim()) out.push('缺少主题');
    if (!String(task?.body||'').trim()) out.push('缺少正文');
    // Human confirmation is scoped: deterministic missing fields disappear as soon as they are fixed.
    // Only ambiguous parsing / manual edits / roster conflicts require an explicit confirmation.
    if (!task?.reviewConfirmed) {
      if (task?.importConfidence && task.importConfidence < 70) out.push('请检查邮件内容');
      for (const issue of task?.importIssues || []) {
        if (/未定位收件人/.test(issue) && task.recipients) continue;
        if (/主题为空/.test(issue) && task.subject) continue;
        if (/正文过短/.test(issue) && String(task.body||'').length>=40) continue;
        if (/置信度/.test(issue) && task.importConfidence>=70) continue;
        if (/未找到邮件落款|未找到邮件称呼|未找到 Subject/.test(issue) && task.importConfidence >= 80) continue;
        if (!out.includes(issue)) out.push(issue);
      }
    }
    if (task?.reviewDraftPending && !out.includes('修改待确认')) out.push('修改待确认');
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

  function reviewTasks() { return (batch.tasks||[]).filter(taskNeedsImportReview); }

  function reviewVisibleTasks() {
    const tasks=(batch.tasks||[]).filter(task=>!task?.importExcluded);
    return batch.reviewFilter==='all' ? tasks : tasks.filter(taskNeedsImportReview);
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
    const selected=selectedReviewTasks();
    if(reviewBatchbarEl) reviewBatchbarEl.hidden=!selected.length;
    if(reviewSelectedCountEl) reviewSelectedCountEl.textContent=selected.length?`已选 ${selected.length} 封`:'已选 0 封';
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
      importEditBodyEl.style.height='auto';
      importEditBodyEl.style.height=`${Math.max(240, importEditBodyEl.scrollHeight + 2)}px`;
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

  function applySubjectAssist(){
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
    const task=reviewCurrentTask();
    const subject=String(importEditSubjectEl?.value||'').trim();
    if(!task||!subject)return;
    stashCurrentReviewDraft();
    const missing=otherMissingSubjectTasks(task.editKey);
    const pendingBefore=new Set(missing.filter(taskNeedsImportReview).map(item=>item.editKey));
    for(const item of missing)setTaskEdit(item,{subject});
    const autoResolved=missing.filter(item=>pendingBefore.has(item.editKey)&&!taskNeedsImportReview(item)).length;
    const stillPending=missing.filter(taskNeedsImportReview).length;
    hideSubjectAssist();
    importEditSubjectEl.dataset.startedBlank='0';
    renderImportTaskPreview();
    renderImportHandoff();
    renderReviewPageOverview();
    const currentStillPending=taskNeedsImportReview(task);
    if(batch.reviewFilter==='pending' && !currentStillPending){
      const next=reviewTasks()[0]||null;
      if(next)openImportTaskEditor(next); else closeImportTaskEditor();
    }else renderReviewQueue(task.editKey);
    const resolvedText=autoResolved?`，其中 ${autoResolved} 封已自动完成检查`:'';
    const pendingText=stillPending?`；${stillPending} 封还有其他内容需要处理`:'';
    setImportStatus(`已为另外 ${missing.length} 封缺少主题的邮件填写同一主题${resolvedText}${pendingText}。`,'ok');
  }

  function confirmSelectedReviewTasks() {
    const selected=selectedReviewTasks();
    if(!selected.length)return;
    batch.handoffComplete=false;
    let confirmed=0,blocked=0;
    for(const task of selected){
      const coreValid=recipientLooksValid(task.recipients)&&!!String(task.subject||'').trim()&&!!String(task.body||'').trim();
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
  }

  function selectVisibleReviewTasks() {
    if(!(batch.reviewSelected instanceof Set))batch.reviewSelected=new Set();
    const visible=reviewVisibleTasks();
    const allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    if(allSelected) for(const task of visible)batch.reviewSelected.delete(task.editKey);
    else for(const task of visible)batch.reviewSelected.add(task.editKey);
    renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');
    renderReviewBatchActions();
    const button=$('nmda-review-select-filtered');if(button)button.textContent=allSelected?'选择当前列表':'取消当前选择';
  }

  function renderReviewPageOverview() {
    const tasks=(batch.tasks||[]).filter(task=>!task?.importExcluded);
    let pendingCount=0,checked=0;
    for(const task of tasks){if(taskNeedsImportReview(task))pendingCount++;else if(task.reviewConfirmed||task.rosterConfirmed)checked++;}
    const ready=Math.max(0,tasks.length-pendingCount-checked);
    if(reviewNavCountEl){reviewNavCountEl.hidden=!pendingCount;reviewNavCountEl.textContent=String(pendingCount);}
    if(reviewPageSummaryEl)reviewPageSummaryEl.innerHTML=tasks.length
      ? `<span><strong>${pendingCount}</strong> 待处理</span><span><strong>${checked}</strong> 已检查</span><span><strong>${ready}</strong> 可直接使用</span>`
      : '<span>尚无批量邮件</span>';
    if(reviewPageEmptyEl)reviewPageEmptyEl.hidden=!!tasks.length;
    ui.querySelectorAll('[data-review-filter]').forEach(button=>button.classList.toggle('is-active',button.dataset.reviewFilter===batch.reviewFilter));
    if(reviewQueueCaptionEl)reviewQueueCaptionEl.textContent=batch.reviewFilter==='all'?'显示全部邮件':'只显示需要补充或修正的邮件';
    if(!tasks.length){if(importEditorOverlayEl)importEditorOverlayEl.hidden=true;renderReviewBatchActions();return;}
    renderReviewBatchActions();
    if(reviewInlineEl && !reviewInlineEl.hidden){
      renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');
      if(importEditorOverlayEl?.hidden){const first=reviewVisibleTasks()[0]||tasks[0];if(first)openImportTaskEditor(first);}
    }
  }

  function openReviewWorkspace() {
    setWorkbenchTab('batch');
    if(reviewInlineEl) reviewInlineEl.hidden=false;
    renderReviewPageOverview();
    const first=reviewVisibleTasks()[0] || (batch.tasks||[]).find(task=>!task?.importExcluded);
    if(first && importEditorOverlayEl?.hidden) openImportTaskEditor(first);
    requestAnimationFrame(() => reviewInlineEl?.scrollIntoView?.({behavior:'smooth',block:'start'}));
  }

  function closeReviewWorkspace() {
    if(reviewInlineEl) reviewInlineEl.hidden=true;
    closeImportTaskEditor();
    requestAnimationFrame(() => $('nmda-ingest-result-card')?.scrollIntoView?.({behavior:'smooth',block:'center'}));
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
      const emailRe=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/ig;
      for(let i=localStart;i<=localEnd;i++){
        const text=String(sourceBlocks[i]?.text||''); let m;
        while((m=emailRe.exec(text))){
          const absolute=i+contextOffset; const dist=absolute < rowMeta.startBlock ? rowMeta.startBlock-absolute : absolute > rowMeta.endBlock ? absolute-rowMeta.endBlock : 0;
          let score=70-Math.min(45,dist*5); if(/📧/.test(text))score+=15; if(absolute>=rowMeta.startBlock&&absolute<=rowMeta.endBlock)score+=8;
          add(m[0],absolute,score,absolute<rowMeta.startBlock?'邮件前文附近':absolute>rowMeta.endBlock?'邮件后文附近':'邮件正文范围',text);
        }
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
      const status=pending?((issues[0]==='修改待确认'?'待确认':issues[0])||'待处理'):(task.reviewConfirmed||task.rosterConfirmed?'已检查':'可直接使用');
      const checked=batch.reviewSelected?.has(task.editKey)?'checked':'';
      return `<div class="nmda-review-queue-row ${task.editKey===activeKey?'is-active':''} ${checked?'is-selected':''}" data-review-row="${escapeHtml(task.editKey)}"><label class="nmda-review-select"><input type="checkbox" data-review-select="${escapeHtml(task.editKey)}" ${checked} aria-label="选择 ${escapeHtml(task.id||`邮件 ${index+1}`)}"></label><button type="button" class="nmda-review-queue-item" data-review-key="${escapeHtml(task.editKey)}"><span class="nmda-review-queue-index">${index+1}</span><span class="nmda-review-queue-main"><strong>${escapeHtml(task.id||`邮件 ${index+1}`)}</strong><small>${escapeHtml(task.subject||task.recipients||'未识别主题')}</small><em data-tone="${pending?'warn':'ok'}">${escapeHtml(status)}${pending&&issues.length>1?` · +${issues.length-1}`:''}</em></span></button></div>`;
    }).join(''):`<div class="nmda-review-empty">${batch.reviewFilter==='pending'?'当前没有需要修改的邮件。':'当前没有可查看的邮件。'}</div>`;
    if(allList.length>list.length)reviewQueueEl.insertAdjacentHTML('beforeend',`<button type="button" class="nmda-review-load-more" data-review-load-more>继续显示（${list.length}/${allList.length}）</button>`);
    renderReviewBatchActions();
    const visible=reviewVisibleTasks();const allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    const selectButton=$('nmda-review-select-filtered');if(selectButton)selectButton.textContent=allSelected?'取消当前选择':'选择当前列表';
  }

  function renderReviewSource(task) {
    if(!reviewSourceContextEl||!reviewSourceMetaEl||!reviewCandidatesEl)return;
    const {collection,rowMeta,sourceBlocks,contextOffset=0}=taskSourceMeta(task);
    const issues=unresolvedImportIssues(task);
    reviewSourceMetaEl.innerHTML=`<span><strong>${escapeHtml(task.sourceFile||collection?.source||'来源')}</strong></span><span>${escapeHtml(task.collectionName||collection?.name||'')}</span>${rowMeta?.heading?`<span title="${escapeHtml(rowMeta.heading)}">身份线索：${escapeHtml(rowMeta.heading)}</span>`:''}`;
    const candidates=reviewCandidateEmails(task);
    reviewCandidatesEl.innerHTML=candidates.length
      ? `<div class="nmda-review-candidate-title">可用邮箱候选 <small>点击后仍需确认</small></div><div class="nmda-review-candidate-list">${candidates.map(c=>`<button type="button" data-review-email="${escapeHtml(c.email)}" title="${escapeHtml(c.reason)}">${escapeHtml(c.email)}<small>${escapeHtml(c.reason)}</small></button>`).join('')}</div>`
      : (issues.some(x=>/收件人/.test(x))?'<div class="nmda-review-no-candidate">附近没有可直接采用的邮箱。请手工补充，或排除这封邮件。</div>':'');
    reviewCandidatesEl.querySelectorAll('[data-review-email]').forEach(button=>button.addEventListener('click',()=>{
      importEditRecipientsEl.value=button.dataset.reviewEmail||''; importEditRecipientsEl.focus();
    }));
    if(!sourceBlocks.length||!rowMeta){
      reviewSourceContextEl.innerHTML=`<div class="nmda-review-fallback"><strong>来源未提供原始块定位。</strong><p>${escapeHtml(task.subject||'')}</p><pre>${escapeHtml(task.body||'')}</pre></div>`; return;
    }
    const start=Math.max(0,Number(rowMeta.startBlock||0)-contextOffset-8), end=Math.min(sourceBlocks.length-1,Number(rowMeta.endBlock ?? rowMeta.startBlock ?? 0)-contextOffset+8);
    const emailRe=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i;
    const subjectRe=/(?:^|[\s>*#\-])(?:\*{0,2})\s*(?:subject|主题|邮件主题|邮件标题)\s*[:：]/i;
    const salutationRe=/(?:\b(?:dear|hello|hi)\s+|尊敬的|敬爱的|教授.{0,10}您好|老师.{0,10}您好)/iu;
    const closeRe=/(?:yours\s+sincerely|sincerely|best\s+regards|kind\s+regards|此致\s*敬礼|祝好)/iu;
    const html=[];
    for(let i=start;i<=end;i++){
      const block=sourceBlocks[i]||{}; const text=String(block.text||'');
      const labels=[];
      const absolute=i+contextOffset; if(absolute===rowMeta.startBlock)labels.push('邮件起点'); if(absolute===rowMeta.endBlock)labels.push('邮件终点');
      if(subjectRe.test(text))labels.push('Subject'); if(salutationRe.test(text))labels.push('称呼'); if(closeRe.test(text))labels.push('落款'); if(emailRe.test(text))labels.push('邮箱');
      const inside=absolute>=rowMeta.startBlock&&absolute<=rowMeta.endBlock;
      html.push(`<div class="nmda-source-block ${inside?'is-mail-range':'is-context'} ${labels.includes('邮箱')?'has-email':''}"><div class="nmda-source-block-gutter"><span>${absolute+1}</span>${labels.map(x=>`<em>${escapeHtml(x)}</em>`).join('')}</div><pre>${escapeHtml(text)}</pre></div>`);
    }
    reviewSourceContextEl.innerHTML=html.join('');
    const firstAnchor=reviewSourceContextEl.querySelector('.is-mail-range'); firstAnchor?.scrollIntoView?.({block:'nearest'});
  }

  function updateReviewFieldStates(task) {
    const issues=unresolvedImportIssues(task);
    const map=[['recipients','nmda-review-field-recipients',/收件人|邮箱/],['subject','nmda-review-field-subject',/主题|Subject/],['body','nmda-review-field-body',/正文|邮件称呼|邮件落款|边界/]];
    for(const [,id,re] of map){const el=$(id); if(el)el.dataset.issue=issues.some(x=>re.test(x))?'1':'0';}
    if(reviewProblemSummaryEl) reviewProblemSummaryEl.textContent=issues.length?(issues.every(issue=>issue==='修改待确认')?'修改已保留，确认本封后继续。':`当前需处理：${issues.map(issue=>issue==='修改待确认'?'待确认':issue).join('；')}`):'内容完整，可直接使用。';
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
      reviewProblemSummaryEl.textContent=problems.length?`仍需补充：${problems.join('、')}`:task?.reviewDraftPending?'修改已保留，确认本封后继续。':soft.filter(x=>x!=='修改待确认').length?`还需检查：${soft.filter(x=>x!=='修改待确认').join('；')}`:'内容完整，可直接使用。';
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
      if(state.review.length)reviewPending++;
      if(state.other.length)otherBlocked++;
      if(task.policyBlocked)policyBlocked++;
      if(!taskHasBlockingIssue(task)&&!task.policyBlocked)autoPassed++;
    }
    const reviewTotal=tasks.filter(taskNeedsImportReview).length;
    const stats=importAttachmentStats();
    const excluded=excludedImportCount();
    const totalDetected=tasks.length+excluded;
    const metrics=[
      `<div class="nmda-health-metric is-total"><strong>${totalDetected}</strong><span>已识别</span></div>`,
      `<div class="nmda-health-metric is-ok"><strong>${autoPassed}</strong><span>可继续</span></div>`
    ];
    if(contentPending)metrics.push(`<div class="nmda-health-metric is-warn"><strong>${contentPending}</strong><span>内容待补</span></div>`);
    if(reviewPending)metrics.push(`<div class="nmda-health-metric is-warn"><strong>${reviewPending}</strong><span>需要核对</span></div>`);
    if(stats.issues)metrics.push(`<div class="nmda-health-metric is-warn"><strong>${stats.issues}</strong><span>附件待加</span></div>`);
    if(otherBlocked)metrics.push(`<div class="nmda-health-metric is-error"><strong>${otherBlocked}</strong><span>其他阻塞</span></div>`);
    if(policyBlocked)metrics.push(`<div class="nmda-health-metric"><strong>${policyBlocked}</strong><span>联系限制</span></div>`);
    if(excluded)metrics.push(`<div class="nmda-health-metric"><strong>${excluded}</strong><span>已排除</span></div>`);
    if(importPreviewSummaryEl) importPreviewSummaryEl.innerHTML=metrics.join('');

    const guide=$('nmda-review-guidance');
    if(guide){
      const notes=[]; const actions=[];
      if(contentPending)notes.push(`<strong>${contentPending}</strong> 封邮件缺少必要内容`);
      if(reviewPending)notes.push(`<strong>${reviewPending}</strong> 封邮件需要核对解析结果`);
      if(stats.issues)notes.push(`<strong>${stats.issues}</strong> 个资料中要求的附件尚未添加`);
      if(otherBlocked)notes.push(`<strong>${otherBlocked}</strong> 封邮件还有其他阻塞`);
      if(reviewTotal)actions.push('<button type="button" class="nmda-guidance-action" data-issue-action="review">检查邮件</button>');
      if(stats.issues)actions.push('<button type="button" class="nmda-guidance-action" data-issue-action="attachments">添加附件</button>');
      guide.innerHTML=notes.length
        ? `<span>${notes.join('；')}。</span>${actions.length?`<span class="nmda-guidance-actions">${actions.join('')}</span>`:''}`
        : '当前资料已满足创建草稿所需条件，可以继续选择邮件。';
    }
    if(importReviewBtnEl){importReviewBtnEl.hidden=!tasks.length;importReviewBtnEl.textContent=reviewTotal?`检查邮件（${reviewTotal}）`:'查看邮件';}
    const restoreExcluded=$('nmda-restore-excluded');
    if(restoreExcluded){restoreExcluded.hidden=!excluded;restoreExcluded.textContent=excluded?`恢复已排除（${excluded}）`:'恢复已排除';}
  }

  function openImportTaskEditor(task) {
    if (!task || !importEditorOverlayEl) return;
    if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}
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
    importEditorEvidenceEl.textContent=`${task.id || task.collectionName || '邮件'}${issues.length ? ` · ${issues.join('、')}` : ' · 内容完整，可直接使用'}`;
    if(reviewFeedbackEl){reviewFeedbackEl.hidden=true;reviewFeedbackEl.textContent='';}
    updateReviewFieldStates(task);
    renderReviewSource(task);
    importEditorOverlayEl.hidden=false;
    renderReviewQueue(task.editKey);
    autoSizeReviewBody();
    setTimeout(()=>{
      if(issues.some(x=>/收件人|邮箱/.test(x)))importEditRecipientsEl?.focus();
      else if(issues.some(x=>/主题|Subject/.test(x)))importEditSubjectEl?.focus();
      else if(issues.some(x=>/正文|称呼|落款|边界/.test(x)))importEditBodyEl?.focus();
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
    setTaskEdit(task,{
      reviewConfirmed:coreValid, rosterConfirmed: coreValid && !!(task.rosterIssues||[]).length ? true : (batch.taskEdits.get(key)?.rosterConfirmed||false)
    });
    rebuildTasks();
    const current=(batch.tasks||[]).find(t=>t.editKey===key);
    if(current && taskNeedsImportReview(current)){
      if(reviewFeedbackEl){reviewFeedbackEl.hidden=false;reviewFeedbackEl.textContent=`仍需处理：${unresolvedImportIssues(current).join('；')}`;}
      openImportTaskEditor(current); return;
    }
    renderReviewPageOverview();
    if(!goNext){
      const saved=(batch.tasks||[]).find(t=>t.editKey===key);
      if(saved)openImportTaskEditor(saved);
      if(reviewFeedbackEl){reviewFeedbackEl.hidden=false;reviewFeedbackEl.textContent='已保存本封修改。';}
      return;
    }
    let next=null;
    if(batch.reviewFilter==='all'){
      const visible=reviewVisibleTasks();
      const idx=visible.findIndex(t=>t.editKey===key);
      next=visible[idx+1]||visible[0]||null;
      if(next?.editKey===key && visible.length===1)next=null;
    }else next=reviewTasks()[0]||null;
    if(next)openImportTaskEditor(next);else{closeImportTaskEditor();renderReviewPageOverview();}
  }

  async function excludeCurrentReviewTask() {
    batch.handoffComplete=false;
    const key=importEditorOverlayEl?.dataset.editKey; if(!key)return;
    const task=(batch.tasks||[]).find(t=>t.editKey===key); if(!task)return;
    batch.reviewSelected?.delete?.(key);
    setTaskEdit(task,{importExcluded:true});
    rebuildTasks();
    const next=reviewVisibleTasks()[0]||null;
    if(next)openImportTaskEditor(next);else{closeImportTaskEditor();renderReviewPageOverview();}
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
    const wasAutoResolvableOnly=beforeReviewIssues.length>0 && beforeReviewIssues.every(isAutoResolvableReviewIssue);
    const coreChanged=(patch.recipients!=null && String(patch.recipients||'').trim()!==String(task.recipients||'').trim())
      || (patch.subject!=null && String(patch.subject||'').trim()!==String(task.subject||'').trim())
      || (patch.body!=null && String(patch.body||'')!==String(task.body||''));
    const next = { ...prev, ...patch };
    if(coreChanged && patch.reviewConfirmed==null){
      next.reviewConfirmed=false;
      // A task that entered the queue only because a deterministic field was missing should leave
      // automatically once that field is corrected. Editing an already-clean/ambiguous mail still
      // requires explicit confirmation.
      next.reviewDraftPending=!wasAutoResolvableOnly;
    }
    if(patch.reviewConfirmed===true)next.reviewDraftPending=false;
    if (patch.tags != null) next.tags = parseTaskClassifications(patch.tags);
    batch.taskEdits.set(task.editKey, next);
    if (patch.enabled != null || patch.school != null || patch.scheduleAt != null) batch.schedulePlan = null;
    if (patch.enabled != null) task.enabled = !!patch.enabled;
    if(coreChanged && patch.reviewConfirmed==null){task.reviewConfirmed=false;task.reviewDraftPending=!wasAutoResolvableOnly;}
    if(patch.reviewConfirmed===true){task.reviewConfirmed=true;task.reviewDraftPending=false;}
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
    const kind = collectionKind(collection);
    const advancedMappingCard=$('nmda-mapping-card'); if(advancedMappingCard)advancedMappingCard.hidden=!!collection.meta?.mailFrames;
    const originWord = collection.meta?.wordTaskRows;
    const mailScan = collection.meta?.mailScan;
    const originText = collection.meta?.mailFrames
      ? `已整理邮件内容${mailScan ? `（${mailScan.records || 0} 封）` : ''}`
      : originWord ? '已整理来源内容' : '已找到可用内容';
    $('nmda-header-info').textContent = `${kind.label} · 已识别 ${detectedCount} 项内容${lowFields.length ? `；建议检查：${lowFields.join('、')}` : ''}${hasCore ? '。' : '；收件人、主题或正文仍需调整。'}`;
    mappingEl.innerHTML = Importer.FIELD_DEFS.map(field => mappingSelectHtml(field, headers)).join('');
    const format = collection.meta?.format || batch.dataset?.format || '';
    config.profileSuggestion = Importer.suggestProfile?.({ format, headers }) || null;
    batch.profileSuggestion = config.profileSuggestion;
    const applyProfileBtn = $('nmda-apply-profile');
    const profileInfo = $('nmda-profile-info');
    if (applyProfileBtn) applyProfileBtn.hidden = !(config.profileSuggestion?.score >= 0.72);
    if (profileInfo) profileInfo.textContent = config.profileSuggestion?.score >= 0.72 ? `可以使用已保存设置“${config.profileSuggestion.profile.name}”。` : '';
    setMappingEditorOpen(!hasCore || lowFields.length > 0);
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
      ? `已选择 ${files.length} 个文件（任务附件 ${taskCount}，公共附件 ${sharedCount}，共 ${sizeText}）。`
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

  function rosterState() {
    if (!batch.roster) batch.roster={dataset:null,entries:[],audit:null,warnings:[],enabled:true,autoSchool:true,strict:false,sourceNames:[]};
    return batch.roster;
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
      if(match.schoolSupplement && state.autoSchool && match.entry?.school && !task.school){
        task.school=match.entry.school;task.schoolSource='roster';task.rosterSchoolSupplemented=true;
      }
      if(!edit.rosterConfirmed){
        if(match.status==='conflict')task.rosterIssues.push(`总名单院校冲突：当前“${task.school||'未填写'}” / 总名单“${match.entry?.school||'未填写'}”`);
        if(match.status==='ambiguous')task.rosterIssues.push('总名单中找到多条相似记录，请检查联系人');
        if(match.status==='off-roster' && state.strict)task.rosterIssues.push('当前邮件未在总套磁名单中找到对应导师');
      }
      if(match.entry){
        task.rosterMeta={batch:match.entry.batch||'',status:match.entry.status||'',priority:match.entry.priority||'',tags:[...(match.entry.tags||[])],notes:match.entry.notes||''};
      }
    }
    for(const dup of audit.duplicateMatches||[]){
      for(const m of dup.matches||[]){
        const task=byKey.get(m.task?.editKey);if(!task)continue;
        const edit=batch.taskEdits.get(task.editKey)||{};
        task.rosterDuplicate=true;
        if(!edit.rosterConfirmed && !task.rosterIssues.includes('总名单核验：同一导师对应多封当前邮件'))task.rosterIssues.push('总名单核验：同一导师对应多封当前邮件');
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

  function renderRosterAudit(){
    const state=rosterState(),card=$('nmda-roster-audit-card'),summary=$('nmda-roster-audit-summary'),note=$('nmda-roster-audit-note'),details=$('nmda-roster-audit-details');
    const enabledEl=$('nmda-roster-enabled'),schoolEl=$('nmda-roster-auto-school'),strictEl=$('nmda-roster-strict');
    if(enabledEl)enabledEl.checked=state.enabled!==false;if(schoolEl)schoolEl.checked=state.autoSchool!==false;if(strictEl)strictEl.checked=!!state.strict;
    if(!card)return;
    card.hidden=!state.entries.length;
    if(!state.entries.length)return;
    const audit=state.audit || (Roster&&batch.tasks?.length?Roster.crossCheck(batch.tasks,state.entries):null);
    if(!audit){
      if(summary)summary.innerHTML=`<div class="nmda-import-metric"><strong>${state.entries.length}</strong><span>总名单人数</span></div>`;
      if(note)note.textContent='总名单已添加。导入邮件后会自动补充学校并标出需要检查的差异。';
      if(details)details.innerHTML='';
      return;
    }
    const x=audit.summary;
    if(summary)summary.innerHTML=`<div class="nmda-import-metric"><strong>${x.roster}</strong><span>总名单</span></div><div class="nmda-import-metric"><strong>${x.tasks}</strong><span>当前邮件</span></div><div class="nmda-import-metric"><strong>${x.matched}</strong><span>已匹配</span></div><div class="nmda-import-metric"><strong>${x.unwritten}</strong><span>尚未撰写</span></div><div class="nmda-import-metric ${x.offRoster?'is-warn':''}"><strong>${x.offRoster}</strong><span>名单外</span></div><div class="nmda-import-metric ${(x.ambiguous+x.conflicts+x.duplicates)?'is-warn':''}"><strong>${x.ambiguous+x.conflicts+x.duplicates}</strong><span>待核对</span></div>`;
    if(note)note.innerHTML=`已补充 <strong>${x.schoolSupplements}</strong> 条学校信息${x.emailCandidates?`，并为 <strong>${x.emailCandidates}</strong> 封缺邮箱邮件找到候选地址`:''}。总名单中尚未撰写的联系人不会影响本批次。`;
    if(details){
      const off=(audit.matches||[]).filter(m=>m.status==='off-roster').slice(0,12);
      const conflicts=(audit.matches||[]).filter(m=>m.status==='conflict'||m.status==='ambiguous').slice(0,12);
      const unwritten=(audit.unwritten||[]).slice(0,12);
      const dups=(audit.duplicateMatches||[]).slice(0,8);
      const section=(title,items,render,more=0)=>`<div class="nmda-roster-diff-section"><strong>${escapeHtml(title)}</strong>${items.length?`<div>${items.map(render).join('')}</div>`:'<small>无</small>'}${more>items.length?`<small>另有 ${more-items.length} 条未展开</small>`:''}</div>`;
      details.innerHTML=
        section('尚未加入本批次',unwritten,e=>`<span>${escapeHtml(rosterEntryLabel(e))}${e.batch?` · ${escapeHtml(e.batch)}`:''}</span>`,audit.unwritten?.length||0)+
        section('不在总名单',off,m=>`<span>${escapeHtml(m.task?.id||m.task?.recipients||'邮件')} · ${escapeHtml(m.task?.recipients||'')}</span>`,(audit.matches||[]).filter(m=>m.status==='off-roster').length)+
        section('需要核对',conflicts,m=>`<span>${escapeHtml(m.task?.id||'邮件')} → ${escapeHtml(m.status==='ambiguous'?'多个总名单候选':rosterEntryLabel(m.entry))}</span>`,(audit.matches||[]).filter(m=>m.status==='conflict'||m.status==='ambiguous').length)+
        section('可能重复',dups,d=>`<span>${escapeHtml(rosterEntryLabel(d.entry))} · ${d.matches?.length||0} 封邮件</span>`,audit.duplicateMatches?.length||0);
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
      batch.roster={...rosterState(),dataset,entries:parsed.entries,warnings:parsed.warnings||[],sourceNames:list.map(f=>f.name),audit:null};
      const remove=$('nmda-roster-remove');if(remove)remove.hidden=false;
      if(status)status.textContent=`已添加 ${parsed.stats.total} 条总名单人数 · 邮箱 ${parsed.stats.withEmail} · 院校 ${parsed.stats.withSchool}${parsed.stats.duplicates?` · 重复 ${parsed.stats.duplicates}`:''}`;
      if(batch.dataset)rebuildTasks();else renderRosterAudit();
      renderImportLifecycleState();
    }catch(error){console.error(`[${APP}] roster`,error);if(status)status.textContent=`总名单读取失败：${error.message}`;}
    finally{if(rosterFileEl)rosterFileEl.value='';}
  }

  function removeRoster(){
    batch.handoffComplete=false;
    for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
    batch.roster={dataset:null,entries:[],audit:null,warnings:[],enabled:true,autoSchool:true,strict:false,sourceNames:[]};
    const status=$('nmda-roster-source-status');if(status)status.textContent='尚未载入总套磁名单。';
    const remove=$('nmda-roster-remove');if(remove)remove.hidden=true;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
    renderImportLifecycleState();
  }

  function rebuildTasks() {
    if (!batch.dataset) { batch.tasks = []; scheduleBatchRender({aux:true}); return; }
    const tasks = [];
    const sets = recordSets();
    for (let collectionIndex = 0; collectionIndex < sets.length; collectionIndex++) {
      const collection = sets[collectionIndex];
      const config = ensureCollectionConfig(collectionIndex);
      if (!collection || !config || config.enabled === false) continue;
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
        const sourceRecipients = String(getValue(row, 'recipients') ?? '').trim();
        const sourceSchool = String(getValue(row, 'school') ?? rowMeta?.school ?? '').trim();
        const sourceSubject = String(getValue(row, 'subject') ?? '').trim();
        const sourceBody = String(getValue(row, 'body') ?? '');
        const sourceAttachmentRaw = getValue(row, 'attachments');
        const sourceScheduleRaw = getValue(row, 'scheduleAt');
        const sourceTags = getValue(row, 'tags');
        const recipients = String(edit.recipients != null ? edit.recipients : sourceRecipients).trim();
        const school = String(edit.school != null ? edit.school : sourceSchool).trim();
        const subject = String(edit.subject != null ? edit.subject : sourceSubject).trim();
        const body = String(edit.body != null ? edit.body : sourceBody);
        const attachmentRaw = edit.attachments != null ? edit.attachments : sourceAttachmentRaw;
        const attachmentRefs = Importer.splitAttachments(attachmentRaw);
        const scheduleRaw = edit.scheduleAt != null ? edit.scheduleAt : sourceScheduleRaw;
        const scheduleSource = String(edit.scheduleSource || (String(sourceScheduleRaw ?? '').trim() ? 'imported' : '')).trim();
        const importedTags = parseTaskClassifications(edit.tags != null ? edit.tags : sourceTags);
        const id = String(edit.id != null ? edit.id : getValue(row, 'id') ?? '').trim() || `${collectionIndex + 1}-${rowIndex + 1}`;
        const meaningful = [recipients, subject, body, ...attachmentRefs, String(scheduleRaw ?? ''), ...importedTags].some(v => String(v).trim());
        if (!meaningful) continue;

        const errors = [], warnings = [];
        const importIssues = [...new Set(rowMeta?.issues || [])];
        const importConfidence = Number(rowMeta?.confidence || 0);
        if (!recipients) {
          if (collection.meta?.mailFrames) errors.push('缺少收件人');
          else warnings.push('无收件人');
        }
        else if (!recipientLooksValid(recipients)) errors.push('收件人邮箱格式无效');
        if (collection.meta?.mailFrames && !subject) errors.push('缺少主题');
        if (collection.meta?.mailFrames && !String(body||'').trim()) errors.push('缺少正文');
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
          id, rowIndex, collectionIndex, collectionName: collection.name || `内容 ${collectionIndex + 1}`, sourceFile: rowMeta?.sourceFile || collection.source || '',
          editKey, sourceRow: rowIndex + 1, recipients, school, schoolSource: edit.school != null ? 'manual' : (sourceSchool ? (collection.meta?.mailFrames ? 'recognized' : 'imported') : ''), subject, body, attachmentRefs,
          tags: importedTags,
          enabled: policyBlocked ? false : edit.enabled !== false,
          policyBlocked, policyReasons: gate.reasons,
          files: mergedFiles, tableFiles: resolved.files, attachmentDetails: resolved.details,
          scheduleAt, scheduleSource, scheduleReason:String(edit.scheduleReason||''), errors:[...new Set(errors)], warnings:[...new Set(warnings)], status: errors.length ? 'error' : 'ready', runtimeError: '', note: '',
          importConfidence, importEvidence:[...(rowMeta?.evidence || [])], importIssues, importHeading:rowMeta?.heading || '', importRecipientEvidence:rowMeta?.recipientEvidence || null,
          reviewConfirmed: !!edit.reviewConfirmed, reviewDraftPending: !!edit.reviewDraftPending, rosterConfirmed: !!edit.rosterConfirmed, importExcluded:false,
          manuallyEdited: ['recipients','school','subject','body','attachments','scheduleAt','tags'].some(key=>edit[key]!=null), _searchStatic: staticSearch
        });
      }
    }
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
    card.hidden = !hasDataset;
    if (!hasDataset) return;
    const tasks = batch.tasks || [];
    const states=tasks.map(task=>[task,taskIssueState(task)]);
    const blockerTasks=states.filter(([task])=>taskHasBlockingIssue(task));
    const ready=states.filter(([task])=>!taskHasBlockingIssue(task)&&!task.policyBlocked).length;
    const review=tasks.filter(taskNeedsImportReview).length;
    const stats=importAttachmentStats();
    const excluded=excludedImportCount();
    const metrics=[`<div class="nmda-import-metric"><strong>${tasks.length}</strong><span>邮件</span></div>`,`<div class="nmda-import-metric"><strong>${ready}</strong><span>可继续</span></div>`];
    if(review)metrics.push(`<div class="nmda-import-metric is-warn"><strong>${review}</strong><span>邮件待处理</span></div>`);
    if(stats.issues)metrics.push(`<div class="nmda-import-metric is-warn"><strong>${stats.issues}</strong><span>附件待加</span></div>`);
    if(excluded)metrics.push(`<div class="nmda-import-metric"><strong>${excluded}</strong><span>已排除</span></div>`);
    summary.innerHTML=metrics.join('');
    const blocked=blockerTasks.length>0;
    button.textContent = !tasks.length ? '暂无邮件' : blocked ? '完成待办后继续' : batch.handoffComplete ? `已继续（${tasks.length}）` : `继续选择邮件（${tasks.length}）`;
    button.disabled = !tasks.length || blocked;
    if(hint){
      const parts=[];
      if(review)parts.push(`${review} 封邮件内容待处理`);
      if(stats.issues)parts.push(`${stats.issues} 个附件待添加`);
      const uncategorized=states.filter(([,state])=>state.other.length).length;
      if(uncategorized)parts.push(`${uncategorized} 封还有其他阻塞`);
      hint.textContent=blocked
        ? `还需完成：${parts.join('；')}。`
        : batch.handoffComplete?'当前批次已进入选择与安排；修改必要内容后会自动回到准备状态。':'资料已经就绪，可以继续选择本次要创建的邮件。';
    }
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
    const audit=Scheduler.audit?.(selected,rules)||{conflicts:[]};
    const conflictCount=audit.conflicts?.length||0;
    if(scheduleSummaryEl)scheduleSummaryEl.innerHTML=`<strong>${selected.length}</strong> 已选 · <strong>${groups.size}</strong> 组 · 自动 ${auto} · 已有 ${protectedCount} · 待排 ${unscheduled}${conflictCount?` · <span class="nmda-danger">冲突 ${conflictCount}</span>`:''}`;
    if(scheduleRulePreviewEl){
      const fallbackText='';
      const conflictText=conflictCount?` · ${conflictCount} 个时间冲突需要调整`:'';
      scheduleRulePreviewEl.textContent=`当前规则：同校每轮最多 ${rules.maxPerGroupPerRound||1} 位 · 间隔 ${rules.intervalDays||7} 天${conflictText}`;
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
      const s=plan.summary, audit=Scheduler.audit?.(batch.tasks||[],rules)||{conflicts:[]};
      const fallback=s.fallbackGroups?`；${s.fallbackGroups} 个分组未识别学校，已按邮箱分组`:'';
      const conflict=audit.conflicts?.length?`；保留的已有时间仍有 ${audit.conflicts.length} 个规则冲突，请手工调整或关闭“保留已有定时”后重排`:'';
      setBatchStatus(`时间已安排：${s.selected} 封任务，${s.groups} 个学校/分组，自动安排 ${s.auto} 封，保留已有 ${s.preserved} 封，共 ${s.rounds} 轮${fallback}${conflict}。`,audit.conflicts?.length?'warn':'ok');
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
    const summaryParts=[`共 <strong>${tasks.length}</strong> 封`,`已选 <strong>${snapshot.selectedTotal}</strong>`,`可创建 <strong>${snapshot.selectedReady}</strong>`];
    if(snapshot.selectedScheduled)summaryParts.push(`定时 ${snapshot.selectedScheduled}`);
    if(snapshot.errors)summaryParts.push(`<span class="nmda-danger">异常 ${snapshot.errors}</span>`);
    if(snapshot.done)summaryParts.push(`已完成 ${snapshot.done}`);
    batchSummaryEl.innerHTML=summaryParts.join(' · ');
    if(batchStartEl)batchStartEl.textContent=snapshot.selectedReady?`创建 ${snapshot.selectedReady} 封草稿`:'创建所选草稿';
    batchStartEl.disabled=batch.running||!batch.handoffComplete||!snapshot.selectedReady;
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
      const schoolHtml=`<input class="nmda-table-school-input" data-task-school="${escapeHtml(task.editKey)}" value="${escapeHtml(task.school||'')}" placeholder="学校 / 机构" ${batch.running?'disabled':''}>`;
      const sourceLabel=scheduleSourceLabel(task);
      const scheduleHtml=`<div class="nmda-schedule-edit-cell"><input type="datetime-local" data-task-schedule="${escapeHtml(task.editKey)}" value="${escapeHtml(task.scheduleAt||'')}" ${batch.running?'disabled':''}><small>${escapeHtml(sourceLabel)}</small></div>`;
      const statusText=statusLabel(task);
      const fileText=task.files?.length?` · 附件 ${task.files.length}`:'';
      return `<tr data-task-row="${escapeHtml(task.editKey)}" data-status="${task.status}" data-enabled="${task.enabled?'1':'0'}">
        <td><input type="checkbox" data-task-enabled="${escapeHtml(task.editKey)}" ${task.enabled?'checked':''} ${batch.running||task.policyBlocked||task.status==='running'||task.status==='done'?'disabled':''} title="${escapeHtml(task.policyBlocked?statusLabel(task):'')}"></td>
        <td class="nmda-recipient-cell" title="${escapeHtml(task.recipients)}"><strong>${escapeHtml(task.recipients||'—')}</strong><small>${escapeHtml(contactState.stage||'')}</small></td>
        <td>${schoolHtml}</td>
        <td class="nmda-subject-cell" title="${escapeHtml(task.subject)}">${escapeHtml(task.subject||'—')}</td>
        <td>${scheduleHtml}</td>
        <td class="nmda-task-state-cell" title="${escapeHtml(statusText)}">${escapeHtml(statusText)}${fileText}</td>
      </tr>`;
    }).join('');
    if(!matched.length)previewBodyEl.innerHTML='<tr><td colspan="6">没有匹配的邮件。调整搜索条件后再试。</td></tr>';
    else if(matched.length>150)previewBodyEl.insertAdjacentHTML('beforeend',`<tr><td colspan="6">当前只显示前 150 封，共 ${matched.length} 封。</td></tr>`);

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
    const cardTitle=card?.querySelector('summary strong');
    const cardHint=card?.querySelector('summary small');
    if(cardTitle)cardTitle.textContent=issues.size?`需要添加附件（${issues.size}）`:'附件';
    if(cardHint)cardHint.textContent=issues.size?'资料中已列出附件，请把对应文件加入本批次':uniqueRefs.length?`已匹配 ${matched}/${uniqueRefs.length} 个要求附件`:'没有要求附件时可忽略';
    if(card)card.dataset.issue=issues.size?'1':'0';
    if(issues.size && card && !batch.attachmentAttentionShown){card.open=true;batch.attachmentAttentionShown=true;}
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
    batch.handoffComplete = false;
    batch.importMeta = dataset?.meta || null;
    batch.collectionConfigs.clear();
    batch.taskEdits.clear();
    batch.reviewSelected?.clear?.();
    batch.reviewFilter='pending';
    batch.attachmentAttentionShown=false;
    closeImportTaskEditor();
    batch.directoryFiles = []; batch.taskFiles = uniqueFiles(dataset?.embeddedFiles || []); batch.sharedFiles = []; batch.attachmentOverrides.clear();
    batch.fileIndex = Importer.buildFileIndex(batch.taskFiles);
    dirEl.value = ''; taskFilesEl.value = ''; sharedFilesEl.value = '';
    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    if (batchStageFilterEl) batchStageFilterEl.value = '';
    const sets = recordSets();
    sets.forEach((_, index) => ensureCollectionConfig(index, { reset: true }));
    const best = (Importer.detectBestRecordSet?.(sets) || Importer.detectBestSheet(sets));
    if (![...batch.collectionConfigs.values()].some(config => config.enabled)) { const bestConfig = ensureCollectionConfig(best.index); if (bestConfig) bestConfig.enabled = true; }
    batch.collectionIndex = best.index;
    collectionSelectEl.innerHTML = sets.map((collection, i) => {
      const kind = collectionKind(collection);
      const detection = Importer.detectHeader(collection.rows || []);
      const records = Math.max(0, (collection.rows || []).length - detection.index - 1);
      return `<option value="${i}" ${i === best.index ? 'selected' : ''}>${escapeHtml(collection.name)} · ${escapeHtml(kind.label)} · ${records} 条</option>`;
    }).join('');
    $('nmda-collection-field').hidden = sets.length <= 1;
    $('nmda-structure-card').hidden = false;
    $('nmda-mapping-card').hidden = false;
    $('nmda-ingest-diagnostics').hidden = false;
    $('nmda-ingest-result-card').hidden = false;
    $('nmda-attachments-card').hidden = false;
    renderSourceInventory();
    configureCollection(best.index, false);
    refreshFileIndex(false);
    if (!isCurrentBatchSession(sessionToken)) return false;
    const warningText = dataset.warnings?.length ? `；${dataset.warnings.length} 条读取提示` : '';
    const embeddedText = dataset.embeddedFiles?.length ? `；自动载入 ${dataset.embeddedFiles.length} 个包内附件` : '';
    const formatText = dataset.format ? `；${formatDisplayName(dataset.format)}` : '';
    $('nmda-import-format-info').textContent = `已添加 ${dataset.sourceFiles?.length || 1} 个来源 · ${sets.length} 组内容${embeddedText}${warningText}。`;
    const selected = sets[best.index];
    const includedCount = [...batch.collectionConfigs.values()].filter(config => config.enabled).length;
    setImportStatus(`读取完成：${label}；找到 ${sets.length} 组内容，已使用 ${includedCount} 组${warningText}。`, dataset.warnings?.length ? 'warn' : 'ok');
    renderImportLifecycleState();
    setBatchStatus(`已准备 ${batch.tasks.length} 封邮件。完成必要核对后即可继续选择任务。`, 'ok');
    return true;
  }

  function resetImportWorkspace({ keepStatus = false, invalidate = true, message = '' } = {}) {
    if (invalidate) batch.sessionId += 1;
    batch.importBusy = false;
    batch.handoffComplete = false;
    batch.dataset = null;
    batch.importMeta = null;
    batch.collectionIndex = 0;
    batch.collectionConfigs.clear();
    batch.detection = null;
    batch.mapping = {};
    batch.tasks = [];
    batch.directoryFiles = [];
    batch.taskFiles = [];
    batch.sharedFiles = [];
    batch.attachmentOverrides.clear();
    batch.taskEdits.clear();
    batch.reviewSelected?.clear?.();
    batch.reviewFilter='pending';
    batch.attachmentAttentionShown=false;
    batch.fileIndex = Importer.buildFileIndex([]);
    batch.profileSuggestion = null;
    batch.stopRequested = false;
    batch.schedulePlan = null;
    batch.scheduleRules = freshScheduleRules();
    batch.roster = { dataset:null, entries:[], audit:null, warnings:[], enabled:true, autoSchool:true, strict:false, sourceNames:[] };
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
    const attachmentSummary = $('nmda-attachment-summary'); if (attachmentSummary) attachmentSummary.textContent = '生成邮件后会显示附件匹配情况。';
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
      const dataset = files.length === 1 ? await Importer.parseFile(files[0]) : await Importer.parseFiles(files);
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
    const token = batch.sessionId;
    button.disabled = true;
    button.textContent = '正在进入下一步…';
    try {
      await registerCurrentBatchContacts(token);
      if (!isCurrentBatchSession(token)) return;
      batch.handoffComplete = true;
      setWorkbenchTab('batch');
      setBatchStatus(`已准备 ${batch.tasks.length} 封邮件。选择本次要创建的草稿。`, 'ok');
      requestAnimationFrame(() => $('nmda-stage-execute')?.scrollIntoView?.({behavior:'smooth', block:'start'}));
    } finally {
      if (isCurrentBatchSession(token)) renderImportHandoff();
    }
  });

  importReviewBtnEl?.addEventListener('click', openReviewWorkspace);
  $('nmda-review-guidance')?.addEventListener('click',event=>{
    const action=event.target?.closest?.('[data-issue-action]')?.dataset?.issueAction;
    if(action==='review'){openReviewWorkspace();return;}
    if(action==='attachments'){
      const card=$('nmda-attachments-card');
      if(card){card.hidden=false;card.open=true;batch.attachmentAttentionShown=true;requestAnimationFrame(()=>card.scrollIntoView?.({behavior:'smooth',block:'start'}));}
    }
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
  [importEditRecipientsEl,importEditBodyEl].forEach(el=>el?.addEventListener('change',()=>{stashCurrentReviewDraft();renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');}));
  importEditSubjectEl?.addEventListener('change',()=>{if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}stashCurrentReviewDraft();renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');maybeOfferSubjectAssist();});
  $('nmda-subject-assist-apply')?.addEventListener('click',applySubjectAssist);
  $('nmda-subject-assist-dismiss')?.addEventListener('click',()=>{if(subjectAssistTimer){clearTimeout(subjectAssistTimer);subjectAssistTimer=null;}hideSubjectAssist();if(importEditSubjectEl)importEditSubjectEl.dataset.startedBlank='0';});
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
    const csv = '\ufeff编号,收件人,学校,主题,正文,附件,定时时间,任务标记\r\n001,mail-test@example.com,示例大学,测试主题,这是正文,该封专属材料.pdf,2026-08-25 09:30,第一批;重点\r\n002,mail-test-2@example.com,示例大学,测试主题2,这是正文2,,,第二批\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  scheduleApplyEl?.addEventListener('click', applySmartSchedule);
  scheduleClearEl?.addEventListener('click', clearAutoSchedule);
  [scheduleStartEl,scheduleMaxSchoolEl,scheduleIntervalDaysEl,schedulePreserveEl].forEach(el=>el?.addEventListener('change',()=>{readScheduleRuleControls();batch.schedulePlan=null;renderScheduleCenter();}));
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
    const actionText = { enable: '选择当前结果', disable: '取消当前结果', addTag: `添加标记“${tagsText(parsed)}”`, removeTag: `移除标记“${tagsText(parsed)}”` }[kind];
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
    setBatchStatus(`已清空选择：取消 ${affected} 封任务。`, 'ok');
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
        scheduleContactsRender(); scheduleBatchRender({aux:false});
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
        scheduleContactsRender(); scheduleBatchRender({aux:false});
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
          setBatchStatus(`任务 ${task.id}：点击“存草稿”并确认${task.scheduleAt ? '定时设置成功' : '保存到草稿箱'}…`);
          const saveOutcome = await saveDraft(root, { scheduled: !!task.scheduleAt });
          task.note = [task.note, `草稿已确认保存（${saveOutcome.kind}）`].filter(Boolean).join('；');
          task.status = 'done'; succeeded++;
          scheduleBatchRender({aux:false});
          await sleep(600);
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
      else setBatchStatus(`批量处理完成：成功创建并保存 ${succeeded} 封草稿。不会自动发送。`, 'ok');
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
  console.info(`[${APP}] v1.17.0 loaded`);
})();
