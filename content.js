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

  function isTimedDraftSuccessVisible() {
    // Scheduled drafts use a different NetEase state machine: clicking “存草稿”
    // commits the schedule and replaces the editor body with a success result page.
    // The business evidence is the result text, not a particular generated id/URL.
    const candidates = [
      ...document.querySelectorAll('h1,h2,h3,section,div,[role="main"],[role="status"]')
    ].filter(visible);
    return candidates.some(el => compactText(el).includes('定时发信设置成功'));
  }

  function findFreshRegularDraftSuccess(baseline) {
    const before = baseline?.regularSignals || new Set();
    return regularDraftSuccessSignals().find(el => !before.has(draftSignalFingerprint(el))) || null;
  }

  async function waitForDraftSaveOutcome({ scheduled, baseline }) {
    const timeout = scheduled ? 9000 : 7000;
    return waitFor(() => {
      if (scheduled) {
        if (!baseline?.timedSuccessVisible && isTimedDraftSuccessVisible()) {
          return { kind: 'scheduled-result', evidence: '定时发信设置成功' };
        }
        return null;
      }

      const tip = findFreshRegularDraftSuccess(baseline);
      if (tip) return { kind: 'regular-tip', evidence: textOf(tip) };

      // Compatibility fallback: some NetEase variants may still transition from a
      // fresh compose route to type:draft. It is accepted only as a NEW transition,
      // never merely because the current page was already editing a draft.
      if (!baseline?.routeWasDraft && isDraftRoute()) {
        return { kind: 'draft-route', evidence: 'Compose 路由进入 draft' };
      }
      return null;
    }, timeout, 100, scheduled
      ? '已点击“存草稿”，但未检测到“定时发信设置成功”，已停止，避免继续写下一封。'
      : '已点击“存草稿”，但未检测到网易“成功保存到草稿箱”的新提示，已停止，避免继续写下一封。');
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
              <div class="nmda-subtitle">草稿 · 数据摄取 · 批量 · 联系人</div>
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
          <button class="nmda-tab is-active" data-tab="single" type="button"><span class="nmda-tab-icon">✎</span><span><strong>单封草稿</strong><small>快速填写一封</small></span></button>
          <button class="nmda-tab" data-tab="import" type="button"><span class="nmda-tab-icon">⇧</span><span><strong>数据摄取</strong><small>来源、结构、语义</small></span></button>
          <button class="nmda-tab" data-tab="batch" type="button"><span class="nmda-tab-icon">▦</span><span><strong>批量任务</strong><small>筛选、选择、执行</small></span></button>
          <button class="nmda-tab" data-tab="contacts" type="button"><span class="nmda-tab-icon">◎</span><span><strong>联系人</strong><small>分类与历史</small></span></button>
          <div class="nmda-nav-foot">
            <div class="nmda-nav-foot-title">当前原则</div>
            <div>数据摄取只负责生成任务</div>
            <div>勾选是唯一执行依据</div>
            <div>任何执行错误立即停止</div>
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
                  <div class="nmda-card-head"><div><div class="nmda-card-kicker">SCHEDULE</div><div class="nmda-card-title">定时时间</div></div></div>
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


          <div class="nmda-page-head" data-page-head="import" hidden>
            <div><h2>数据摄取工作台</h2><p>从文件、目录、Word、文本、JSON 或批次包中提取内容，理解结构并转换成标准邮件任务。</p></div>
            <div class="nmda-stage-strip" aria-label="数据摄取流程"><span>1 数据源</span><span>2 内容结构</span><span>3 语义映射</span><span>4 校验</span><span>5 任务</span></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page" data-pane="import" hidden>
            <div class="nmda-ingest-workspace">
              <div class="nmda-card nmda-ingest-source-card" id="nmda-import-card">
                <div class="nmda-card-head"><div><div class="nmda-step-index">01</div><div><div class="nmda-card-title">数据源</div><div class="nmda-card-desc">先告诉系统“数据从哪里来”，格式由引擎自行探测</div></div></div><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-reset-import" type="button">清空本次导入</button></div>
                <input id="nmda-import-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <input id="nmda-import-dir" type="file" webkitdirectory multiple hidden>
                <input id="nmda-import-package" type="file" hidden accept=".zip">
                <div class="nmda-source-action-grid">
                  <label class="nmda-source-action" for="nmda-import-file"><span class="nmda-source-action-icon">＋</span><strong>文件 / 多文件</strong><small>表格、Word、JSON、文本等可混合选择</small></label>
                  <label class="nmda-source-action" for="nmda-import-dir"><span class="nmda-source-action-icon">▤</span><strong>整个目录</strong><small>批量扫描目录中的可识别数据文件</small></label>
                  <label class="nmda-source-action" for="nmda-import-package"><span class="nmda-source-action-icon">▣</span><strong>ZIP 批次包</strong><small>任务数据与附件可放在同一个批次包</small></label>
                  <button class="nmda-source-action nmda-source-action-button" id="nmda-show-paste" type="button"><span class="nmda-source-action-icon">⌘</span><strong>粘贴数据</strong><small>直接粘贴 CSV / TSV / JSON / 字段式文本</small></button>
                </div>
                <div class="nmda-paste-panel" id="nmda-paste-panel" hidden>
                  <textarea id="nmda-paste-source" placeholder="可直接粘贴：\n收件人,主题,正文\na@example.com,Hello,正文…\n\n也支持 JSON / JSONL / 字段式文本"></textarea>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-paste-import" type="button">解析粘贴内容</button><span class="nmda-hint">无需选择格式，内容探测器会自动判断。</span></div>
                </div>
                <div class="nmda-ingest-source-tools"><button class="nmda-btn nmda-btn-small" id="nmda-template" type="button">下载标准任务 CSV 示例</button><span id="nmda-import-format-info" class="nmda-hint">支持结构化表格、Word 邮件记录、多文件、目录、JSON/JSONL、HTML/XML 与 ZIP 批次。</span></div>
                <div id="nmda-import-status" class="nmda-summary nmda-import-status">尚未载入数据源。</div>
                <div id="nmda-source-inventory" class="nmda-source-inventory" hidden></div>
              </div>

              <div class="nmda-card nmda-ingest-structure-card" id="nmda-structure-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">02</div><div><div class="nmda-card-title">内容结构</div><div class="nmda-card-desc">选择系统从来源中提取出的“内容集合”，不假设来源必须是表格</div></div></div></div>
                <div class="nmda-field"><span class="nmda-label">参与本批次的内容集合</span><div id="nmda-collection-list" class="nmda-collection-list"></div><span class="nmda-hint">默认全部参与；可以排除说明页、无关表格或辅助文档。每个集合保留自己的语义映射。</span></div>
                <label class="nmda-field" id="nmda-collection-field"><span class="nmda-label">当前检查 / 校正对象</span><select id="nmda-collection-select"></select></label>
                <div id="nmda-structure-summary" class="nmda-structure-summary"></div>
                <div class="nmda-raw-preview-wrap"><div class="nmda-card-subtitle">来源内容抽样</div><div id="nmda-structure-preview" class="nmda-structure-preview"></div></div>
              </div>

              <div class="nmda-card nmda-ingest-mapping-card" id="nmda-mapping-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">03</div><div><div class="nmda-card-title">语义映射</div><div class="nmda-card-desc">把来源中的字段、段落或内容槽映射成邮件语义</div></div></div></div>
                <div id="nmda-header-info" class="nmda-hint nmda-semantic-detection"></div>
                <div id="nmda-semantic-summary" class="nmda-semantic-summary"></div>
                <div class="nmda-row nmda-wrap nmda-mapping-actions"><button class="nmda-btn nmda-btn-small" id="nmda-apply-profile" type="button" hidden>应用识别模板</button><button class="nmda-btn nmda-btn-small" id="nmda-save-profile" type="button">保存识别模板</button><button class="nmda-btn nmda-btn-small" id="nmda-toggle-mapping" type="button">人工校正</button></div>
                <div id="nmda-profile-info" class="nmda-hint"></div>
                <div id="nmda-mapping" class="nmda-mapping nmda-semantic-mapping" hidden></div>
              </div>

              <div class="nmda-card nmda-ingest-preview-card" id="nmda-import-preview-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">04</div><div><div class="nmda-card-title">任务预览与校验</div><div class="nmda-card-desc">在交给批量工作台前，先确认每条来源记录最终会变成什么邮件</div></div></div><div id="nmda-import-preview-summary" class="nmda-summary nmda-summary-inline"></div></div>
                <div class="nmda-table-wrap nmda-import-preview-table-wrap">
                  <table class="nmda-table nmda-import-preview-table"><thead><tr><th>来源</th><th>收件人</th><th>主题 / 正文</th><th>附件</th><th>定时时间</th><th>分类</th><th>校验</th></tr></thead><tbody id="nmda-import-preview-body"></tbody></table>
                </div>
              </div>

              <div class="nmda-card nmda-import-attachments-card" id="nmda-attachments-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">04</div><div><div class="nmda-card-title">附件与文件解析</div><div class="nmda-card-desc">为任务中的附件引用建立真实文件关联；ZIP 内附件会自动进入本批次</div></div></div></div>
                <div id="nmda-attachment-summary" class="nmda-summary">解析出任务后会统计需要匹配的附件。</div>
                <div class="nmda-attachment-grid nmda-attachment-grid-simple">
                  <div class="nmda-file-source"><span class="nmda-label">任务文件池</span><span class="nmda-hint">选择相关文件或整个目录，系统按相对路径 / 文件名 / 下载副本名自动匹配。</span><div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-small nmda-file-button">选择文件<input id="nmda-attachment-files" type="file" multiple hidden></label><label class="nmda-btn nmda-btn-small nmda-file-button">选择目录<input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden></label></div></div>
                  <div class="nmda-file-source nmda-file-source-shared"><span class="nmda-label">公共附件</span><span class="nmda-hint">选择后自动加入本批次每一封邮件。</span><label class="nmda-btn nmda-btn-small nmda-file-button">选择公共附件<input id="nmda-shared-files" type="file" multiple hidden></label></div>
                </div>
                <div id="nmda-attachment-drop" class="nmda-attachment-drop">也可以把任务相关附件直接拖到这里</div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-clear-attachments" type="button">清空本批附件</button><span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span></div>
                <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden>
                  <div class="nmda-card-subtitle">需要人工确认的附件</div>
                  <div class="nmda-hint">仅在自动匹配缺失或有歧义时介入；一次指定，本批次复用。</div>
                  <div id="nmda-attachment-resolution-list"></div>
                </div>
              </div>

              <div class="nmda-card nmda-import-handoff-card" id="nmda-import-handoff-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-step-index">05</div><div><div class="nmda-card-title">生成标准任务</div><div class="nmda-card-desc">统一格式、结构与附件后，交给批量任务工作台</div></div></div></div>
                <div id="nmda-import-ready-summary" class="nmda-import-ready-summary">尚未生成任务。</div>
                <div class="nmda-row nmda-import-handoff-actions"><span class="nmda-hint">数据摄取工作台只负责理解和生成任务，不会操作网易写信页面。</span><button class="nmda-btn nmda-btn-primary" id="nmda-go-batch" type="button">进入批量任务</button></div>
              </div>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="batch" hidden>
            <div><h2>批量任务</h2><p>对已经导入的任务进行检索、分类、选择和草稿创建。</p></div>
            <div class="nmda-stage-strip" aria-label="批量流程"><span>1 管理任务</span><span>2 创建草稿</span></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="batch" hidden>
            <div class="nmda-card nmda-batch-empty" id="nmda-batch-empty">
              <div><div class="nmda-card-kicker">NO TASKS</div><div class="nmda-card-title">还没有可管理的批量任务</div><div class="nmda-card-desc">先在数据摄取工作台载入来源、确认语义并完成附件匹配。</div></div>
              <button class="nmda-btn nmda-btn-primary" id="nmda-go-import" type="button">前往数据摄取</button>
            </div>

            <div class="nmda-card nmda-list-card" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-step-index">01</div><div><div class="nmda-card-title">任务列表</div><div class="nmda-card-desc">检索负责找任务，勾选决定真正执行哪些草稿</div></div></div><div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div></div>
              <div class="nmda-search-bar">
                <label class="nmda-field nmda-search-field"><span class="nmda-label">检索任务</span><input id="nmda-batch-search" type="search" placeholder="编号 / 收件人 / 主题 / 正文 / 分类 / 附件 / 定时时间"></label>
                <div class="nmda-search-help">检索只改变当前视图，不会改变已选择任务。</div>
              </div>
              <div class="nmda-filter-bar">
                <label class="nmda-field"><span class="nmda-label">包含分类</span><input id="nmda-batch-tag-include" type="text" placeholder="已回复;重点;第一批"><span class="nmda-hint">填写多个分类时需同时满足</span></label>
                <label class="nmda-field"><span class="nmda-label">排除分类</span><input id="nmda-batch-tag-exclude" type="text" placeholder="暂停;不再联系"></label>
                <button class="nmda-btn nmda-btn-small" id="nmda-clear-tag-filter" type="button">清除检索/筛选</button>
              </div>
              <div id="nmda-batch-tag-chips" class="nmda-tag-chips"></div>
              <div class="nmda-bulk-editor">
                <input id="nmda-bulk-tag-value" type="text" placeholder="批量自定义分类，如 第一批;重点">
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-add-tag" type="button">添加分类</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-remove-tag" type="button">移除分类</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">选择当前结果</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-disable" type="button">取消当前结果</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-clear-selection" type="button">清空选择</button>
              </div>
              <div class="nmda-table-wrap nmda-batch-table-wrap"><table class="nmda-table nmda-batch-table"><thead><tr><th>选择</th><th>#</th><th>收件人</th><th>分类</th><th>定时时间</th><th>主题</th><th>附件</th><th>任务状态</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
            </div>

            <div class="nmda-card nmda-run-card" id="nmda-run-card" hidden>
              <div class="nmda-run-left"><div class="nmda-step-index">02</div><div><div class="nmda-card-title">创建所选草稿</div><div id="nmda-batch-status" class="nmda-run-status">请先导入并选择要创建的任务。</div></div></div>
              <div class="nmda-run-controls nmda-run-controls-simple">
                <div class="nmda-run-rule">仅执行已勾选且预检通过的任务；任何执行错误都会立即停止，避免串稿。</div>
                <button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">创建所选草稿</button>
                <button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封后停止</button>
              </div>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="contacts" hidden>
            <div><h2>联系人</h2><p>用统一“分类”管理互动阶段、跟进、联系策略、自定义分类与历史。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="contacts" hidden>
            <div class="nmda-crm-top-grid">
              <div class="nmda-card nmda-mail-history-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">MAIL HISTORY</div><div class="nmda-card-title">邮箱历史同步</div></div></div>
                <div class="nmda-history-range">
                  <label class="nmda-field nmda-inline-field"><span class="nmda-label">读取范围</span><select id="nmda-mail-history-limit"><option value="50">最近 50 封</option><option value="100">最近 100 封</option><option value="200" selected>最近 200 封</option><option value="500">最近 500 封</option><option value="1000">最近 1000 封</option><option value="2000">最近 2000 封</option><option value="all">全部</option></select></label>
                  <span class="nmda-hint">超过 200 封时自动分页读取；“全部”最多保护性读取 10,000 封。</span>
                </div>
                <div class="nmda-history-actions nmda-history-actions-unified">
                  <div class="nmda-history-source"><div><strong>已发送 + 草稿箱</strong><small>一次同步真实发送记录和当前草稿；草稿只产生“有草稿”，不会推进为“已发送”。</small></div><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-sync-history" type="button">同步邮箱历史</button></div>
                </div>
                <div id="nmda-contact-status" class="nmda-summary">正在初始化当前邮箱的联系人分类库…</div>
              </div>
              <div class="nmda-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">CONTACT BOOK</div><div class="nmda-card-title">联系人操作</div></div></div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出联系人 CSV</button></div>
                <div class="nmda-hint">导入批量任务时会自动建立“未联系”联系人，但任务分类不会自动写入长期联系人分类。暂停/不再联系会自动拦截任务。</div>
              </div>
            </div>

            <div class="nmda-card nmda-contact-list-card">
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-card-title">联系人列表</div><div class="nmda-card-desc">一个分类入口统一编辑阶段、跟进、联系策略和长期自定义分类</div></div><div id="nmda-contact-summary" class="nmda-summary nmda-summary-inline">0 个联系人</div></div>
              <div class="nmda-contact-toolbar nmda-contact-toolbar-unified">
                <input id="nmda-contact-search" type="text" placeholder="搜索邮箱 / 姓名 / 发送主题 / 草稿主题 / 分类">
                <input id="nmda-contact-class-filter" type="text" placeholder="分类筛选：已回复;待跟进;重点（多个需同时满足）">
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
  const scheduleAtEl = $('nmda-schedule-at');
  const fillButton = $('nmda-fill'), statusEl = $('nmda-status');

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
    let list = Object.values(contactBook.contacts || {}).map(contact => Contacts.normalizeContactShape(contact));
    if (classFilter.length) list = list.filter(contact => {
      const own = new Set(Contacts.classificationLabels(contact).map(value => value.toLocaleLowerCase('zh-CN')));
      return classFilter.every(value => own.has(value));
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
    if (!list.length) body.innerHTML = '<tr><td colspan="7">暂无匹配联系人。可同步邮箱历史或导入批量任务。</td></tr>';
    else if (list.length > 1000) body.insertAdjacentHTML('beforeend', `<tr><td colspan="7">当前显示前 1000 个匹配联系人，共 ${list.length} 个。可用搜索或分类缩小范围。</td></tr>`);

    body.querySelectorAll('select[data-contact-stage]').forEach(select => select.addEventListener('change', async () => {
      Contacts.setStage(contactBook.contacts, select.dataset.contactStage, select.value);
      await persistContacts(); renderContacts(); if (typeof renderPreview === 'function') rebuildTasks();
      setContactStatusMessage(`已更新 ${select.dataset.contactStage} 的互动阶段：${select.value}。`, 'ok');
    }));
    body.querySelectorAll('select[data-contact-policy]').forEach(select => select.addEventListener('change', async () => {
      Contacts.setPolicy(contactBook.contacts, select.dataset.contactPolicy, select.value);
      await persistContacts(); renderContacts(); if (typeof renderPreview === 'function') rebuildTasks();
      setContactStatusMessage(`已更新 ${select.dataset.contactPolicy} 的联系策略：${select.value}。`, select.value === '正常' ? 'ok' : 'warn');
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
      setContactStatusMessage(`当前邮箱：${contactBook.account}。联系人分类保存在本机浏览器；旧版状态已自动迁移为阶段 / 跟进 / 联系策略。`, 'ok');
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
    return { recipients: recipientsEl.value, subject: subjectEl.value, body: bodyEl.value, scheduleAt: scheduleAtEl.value };
  }

  async function saveFormState() {
    try { await chrome.storage.local.set({ [STORAGE_KEY]: formState() }); } catch (_) {}
  }

  async function restoreFormState() {
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) return;
      recipientsEl.value = stored.recipients || ''; subjectEl.value = stored.subject || ''; bodyEl.value = stored.body || '';
      scheduleAtEl.value = stored.scheduleEnabled === false ? '' : (stored.scheduleAt || '');
    } catch (_) {}
  }

  function setWorkbenchTab(name) {
    ui.querySelectorAll('.nmda-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    ui.querySelectorAll('.nmda-tabpane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    ui.querySelectorAll('[data-page-head]').forEach(head => { head.hidden = head.dataset.pageHead !== name; });
  }

  launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('nmda-close').addEventListener('click', () => { panel.hidden = true; });
  $('nmda-expand').addEventListener('click', () => {
    panel.classList.toggle('is-maximized');
    $('nmda-expand').textContent = panel.classList.contains('is-maximized') ? '◱' : '⛶';
    $('nmda-expand').title = panel.classList.contains('is-maximized') ? '还原工作台' : '全屏工作台';
  });
  ui.querySelectorAll('.nmda-tab').forEach(tab => tab.addEventListener('click', () => setWorkbenchTab(tab.dataset.tab)));
  $('nmda-go-batch')?.addEventListener('click', () => setWorkbenchTab('batch'));
  $('nmda-go-import')?.addEventListener('click', () => setWorkbenchTab('import'));

  [recipientsEl, subjectEl, bodyEl, scheduleAtEl].forEach(el => {
    el.addEventListener('change', saveFormState); el.addEventListener('input', saveFormState);
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
    importMeta: null, profileSuggestion: null
  };

  const importFileEl = $('nmda-import-file'), importDirEl = $('nmda-import-dir'), importPackageEl = $('nmda-import-package'), collectionSelectEl = $('nmda-collection-select'), mappingEl = $('nmda-mapping'), mappingToggleEl = $('nmda-toggle-mapping');
  const pasteSourceEl = $('nmda-paste-source'), importPreviewBodyEl = $('nmda-import-preview-body'), importPreviewSummaryEl = $('nmda-import-preview-summary');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files'), sharedFilesEl = $('nmda-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status'), importStatusEl = $('nmda-import-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop');
  const batchSearchEl = $('nmda-batch-search');
  const batchTagIncludeEl = $('nmda-batch-tag-include'), batchTagExcludeEl = $('nmda-batch-tag-exclude');

  function recordSets() { return batch.dataset?.recordSets || batch.dataset?.sheets || []; }

  function currentCollection() { return recordSets()[batch.collectionIndex] || null; }

  function ensureCollectionConfig(index, { reset = false } = {}) {
    const collection = recordSets()[Number(index) || 0];
    if (!collection) return null;
    let config = batch.collectionConfigs.get(Number(index) || 0);
    if (!config || reset) {
      const detection = Importer.detectHeader(collection.rows || []);
      config = { enabled: detection.recognized >= 2 && detection.core >= 1, detection, mapping: { ...detection.mapping }, profileSuggestion: null };
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
    const sourceRows = sources.length ? sources.map((file, index) => {
      const name = sourceFileName(file);
      const related = sets.filter(rs => String(rs.source || '') === String(file.name || '') || String(rs.source || '') === name);
      const formats = [...new Set(related.map(rs => rs.meta?.format).filter(Boolean))];
      const format = formats.length ? formats.map(formatDisplayName).join(' + ') : formatDisplayName(dataset.format);
      return `<div class="nmda-source-item"><div class="nmda-source-item-icon">${escapeHtml(collectionKind(related[0]).icon)}</div><div class="nmda-source-item-main"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small>${escapeHtml(format)} · ${related.length || (sources.length === 1 ? sets.length : 0)} 个内容集合 · ${humanFileSize(file.size)}</small></div><span class="nmda-source-item-index">${index + 1}</span></div>`;
    }).join('') : `<div class="nmda-source-item"><div class="nmda-source-item-icon">◇</div><div class="nmda-source-item-main"><strong>内存数据源</strong><small>${escapeHtml(formatDisplayName(dataset.format))} · ${sets.length} 个内容集合</small></div></div>`;
    const meta = `<div class="nmda-source-inventory-head"><strong>${sources.length || 1} 个数据源</strong><span>${sets.length} 个内容集合${embeddedCount ? ` · ${embeddedCount} 个内嵌附件` : ''}${warnings.length ? ` · ${warnings.length} 条警告` : ''}</span></div>`;
    const warningHtml = warnings.length ? `<details class="nmda-ingest-warnings"><summary>查看 ${warnings.length} 条解析警告</summary>${warnings.slice(0,20).map(w => `<div>${escapeHtml(w)}</div>`).join('')}${warnings.length > 20 ? `<div>另有 ${warnings.length - 20} 条未展开。</div>` : ''}</details>` : '';
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
      return `<div class="nmda-collection-row ${active ? 'is-active' : ''}"><label><input type="checkbox" data-collection-enabled="${index}" ${config?.enabled !== false ? 'checked' : ''}><span class="nmda-collection-kind">${escapeHtml(kind.icon)}</span><span class="nmda-collection-main"><strong>${escapeHtml(collection.name || `内容集合 ${index + 1}`)}</strong><small>${escapeHtml(kind.label)} · ${count} 条记录</small></span></label><button type="button" class="nmda-btn nmda-btn-small" data-inspect-collection="${index}">${active ? '正在检查' : '检查 / 校正'}</button></div>`;
    }).join('');
    box.querySelectorAll('[data-collection-enabled]').forEach(input => input.addEventListener('change', () => {
      const index = Number(input.dataset.collectionEnabled);
      const config = ensureCollectionConfig(index);
      if (!config) return;
      config.enabled = input.checked;
      rebuildTasks();
      renderCollectionList();
    }));
    box.querySelectorAll('[data-inspect-collection]').forEach(button => button.addEventListener('click', async () => {
      const index = Number(button.dataset.inspectCollection);
      collectionSelectEl.value = String(index);
      configureCollection(index, false);
      renderCollectionList();
      await registerCurrentBatchContacts();
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
    summary.innerHTML = `
      <div class="nmda-structure-identity" data-tone="${escapeHtml(kind.tone)}"><span>${escapeHtml(kind.icon)}</span><div><strong>${escapeHtml(kind.label)}</strong><small>${escapeHtml(collection.name || '未命名内容集合')}</small></div></div>
      <div class="nmda-structure-metrics"><span><strong>${dataCount}</strong> 条候选记录</span><span><strong>${width}</strong> 个来源字段</span><span title="${escapeHtml(String(source || ''))}"><strong>来源</strong> ${escapeHtml(String(source || '—'))}</span></div>`;
    const rawStart = Math.max(0, Math.min(detection.index, rows.length - 1));
    const sampleRows = rows.slice(rawStart, rawStart + 6);
    if (!sampleRows.length) { preview.innerHTML = '<div class="nmda-empty-inline">这个内容集合没有可预览的记录。</div>'; return; }
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
      return `<div class="nmda-semantic-item" data-confidence="${tone}"><span>${escapeHtml(field.label)}</span><strong>${mapped ? escapeHtml(headers[index] || `来源字段 ${Number(index)+1}`) : '未映射'}</strong>${mapped ? `<small>${score ? `${Math.round(score)}% 置信度` : '人工/模板映射'}</small>` : '<small>不会写入任务</small>'}</div>`;
    });
    box.innerHTML = items.join('');
  }

  function renderImportTaskPreview() {
    const card = $('nmda-import-preview-card');
    if (!card || !importPreviewBodyEl || !importPreviewSummaryEl) return;
    const tasks = batch.tasks || [];
    if (!batch.dataset) { card.hidden = true; return; }
    card.hidden = false;
    const ready = tasks.filter(t => t.status === 'ready').length;
    const errors = tasks.filter(t => t.status === 'error').length;
    const warnings = tasks.filter(t => t.warnings?.length && t.status !== 'error').length;
    importPreviewSummaryEl.innerHTML = `<strong>${tasks.length}</strong> 条任务 · <span class="nmda-ok-text">${ready} 可用</span>${warnings ? ` · <span class="nmda-warn-text">${warnings} 提示</span>` : ''}${errors ? ` · <span class="nmda-danger">${errors} 错误</span>` : ''}`;
    const sample = tasks.slice(0, 24);
    importPreviewBodyEl.innerHTML = sample.length ? sample.map((task, idx) => {
      const validation = task.status === 'error' ? `错误：${task.errors.join('；')}` : task.warnings?.length ? `提示：${task.warnings.join('；')}` : '通过';
      const validationClass = task.status === 'error' ? 'is-error' : task.warnings?.length ? 'is-warn' : 'is-ok';
      const bodySnippet = String(task.body || '').replace(/\s+/g,' ').trim().slice(0,90);
      const schedule = task.scheduleAt ? task.scheduleAt.replace('T',' ') : '未定时';
      return `<tr><td title="${escapeHtml(`${task.collectionName || ''} · ${task.sourceFile || ''}`)}"><strong>${escapeHtml(task.collectionName || `记录 ${idx + 1}`)}</strong><small>${escapeHtml(task.sourceFile || `第 ${task.sourceRow} 条`)}</small></td><td title="${escapeHtml(task.recipients)}">${escapeHtml(task.recipients || '—')}</td><td><strong title="${escapeHtml(task.subject)}">${escapeHtml(task.subject || '—')}</strong>${bodySnippet ? `<small title="${escapeHtml(task.body)}">${escapeHtml(bodySnippet)}${String(task.body||'').length>90?'…':''}</small>` : ''}</td><td>${task.attachmentRefs?.length || 0}</td><td>${escapeHtml(schedule)}</td><td>${escapeHtml((task.tags || []).join(' · ') || '—')}</td><td><span class="nmda-validation-pill ${validationClass}" title="${escapeHtml(validation)}">${escapeHtml(validation)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="7">当前内容集合还没有生成有效任务。请检查语义映射。</td></tr>';
    if (tasks.length > sample.length) importPreviewBodyEl.insertAdjacentHTML('beforeend', `<tr><td colspan="7">预览前 ${sample.length} 条；当前共 ${tasks.length} 条任务。</td></tr>`);
  }

  async function registerCurrentBatchContacts() {
    if (!Contacts || !(batch.tasks || []).length) return 0;
    try {
      await ensureContactBook();
      const recipients = [];
      for (const task of batch.tasks || []) recipients.push(...Contacts.parseRecipients(task.recipients));
      const added = Contacts.mergeRecipientList(contactBook.contacts, recipients, '未联系');
      await persistContacts();
      renderContacts();
      if (batch.dataset) rebuildTasks();
      return added;
    } catch (error) {
      console.warn(`[${APP}] automatic contact registration failed`, error);
      return 0;
    }
  }

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
      task.sourceRow,
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
    const includeKeys = include.map(tag => tag.toLocaleLowerCase('zh-CN'));
    const excludeKeys = exclude.map(tag => tag.toLocaleLowerCase('zh-CN'));
    if (excludeKeys.some(tag => own.has(tag))) return false;
    if (!includeKeys.length) return true;
    return includeKeys.every(tag => own.has(tag));
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
    mappingToggleEl.textContent = isOpen ? '收起映射' : '人工校正';
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
    const originWord = collection.meta?.wordTaskRows;
    const originText = originWord ? '系统已将 Word 内容标准化为邮件记录' : `系统在来源内容第 ${batch.detection.index + 1} 行识别到记录字段`;
    $('nmda-header-info').textContent = `${kind.label} · ${originText}；识别 ${detectedCount} 个邮件语义；平均置信度 ${avgConfidence || 0}%${lowFields.length ? `；建议检查：${lowFields.join('、')}` : ''}${hasCore ? '。' : '；尚缺核心邮件语义，需要人工校正。'}`;
    mappingEl.innerHTML = Importer.FIELD_DEFS.map(field => mappingSelectHtml(field, headers)).join('');
    const format = collection.meta?.format || batch.dataset?.format || '';
    config.profileSuggestion = Importer.suggestProfile?.({ format, headers }) || null;
    batch.profileSuggestion = config.profileSuggestion;
    const applyProfileBtn = $('nmda-apply-profile');
    const profileInfo = $('nmda-profile-info');
    if (applyProfileBtn) applyProfileBtn.hidden = !(config.profileSuggestion?.score >= 0.72);
    if (profileInfo) profileInfo.textContent = config.profileSuggestion?.score >= 0.72 ? `发现相似识别模板“${config.profileSuggestion.profile.name}”（匹配 ${Math.round(config.profileSuggestion.score * 100)}%）。模板只负责语义映射，不改变来源内容。` : '';
    setMappingEditorOpen(!hasCore || lowFields.length > 0);
    renderCollectionList();
    renderCollectionOverview();
    renderSemanticSummary();
    mappingEl.querySelectorAll('select[data-map-field]').forEach(select => select.addEventListener('change', () => {
      const field = select.dataset.mapField;
      if (select.value === '') delete config.mapping[field]; else config.mapping[field] = Number(select.value);
      batch.mapping = config.mapping;
      renderSemanticSummary();
      rebuildTasks();
      registerCurrentBatchContacts();
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

  function rebuildTasks() {
    if (!batch.dataset) { batch.tasks = []; renderPreview(); return; }
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
        const recipients = String(getValue(row, 'recipients') ?? '').trim();
        const subject = String(getValue(row, 'subject') ?? '').trim();
        const body = String(getValue(row, 'body') ?? '');
        const attachmentRefs = Importer.splitAttachments(getValue(row, 'attachments'));
        const scheduleRaw = getValue(row, 'scheduleAt');
        const importedTags = parseTaskClassifications(getValue(row, 'tags'));
        const id = String(getValue(row, 'id') ?? '').trim() || `${collectionIndex + 1}-${rowIndex + 1}`;
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

        const resolved = resolveAttachmentRefs(attachmentRefs);
        if (resolved.missing.length) errors.push(`缺少附件：${resolved.missing.join('、')}`);
        if (resolved.ambiguous.length) errors.push(`附件同名冲突：${resolved.ambiguous.join('、')}`);
        for (const detail of resolved.details) {
          if (detail.status === 'matched' && detail.method === 'relaxed-copy-suffix') warnings.push(`附件按下载副本名匹配：${detail.ref} → ${detail.file.name}`);
        }

        const gate = contactPolicyGateForRecipients(recipients);
        if (gate.policies.includes('不再联系')) errors.push(`联系策略：不再联系（${gate.reasons.join('、')}）`);
        else if (gate.policies.includes('暂停')) warnings.push(`联系策略：暂停（${gate.reasons.join('、')}）`);

        const editKey = taskEditKey(collectionIndex, rowIndex);
        const edit = batch.taskEdits.get(editKey) || {};
        const policyBlocked = gate.blocked;
        tasks.push({
          id, rowIndex, collectionIndex, collectionName: collection.name || `内容集合 ${collectionIndex + 1}`, sourceFile: collection.source || '',
          editKey, sourceRow: rowIndex + 1, recipients, subject, body, attachmentRefs,
          tags: edit.tags != null ? parseTaskClassifications(edit.tags) : importedTags,
          enabled: policyBlocked ? false : edit.enabled !== false,
          policyBlocked, policyReasons: gate.reasons,
          files: mergeTaskFiles(resolved.files), tableFiles: resolved.files, attachmentDetails: resolved.details,
          scheduleAt, errors, warnings, status: errors.length ? 'error' : 'ready', runtimeError: '', note: ''
        });
      }
    }
    batch.tasks = tasks;
    renderPreview();
  }

  function statusLabel(task) {
    if (task.policyBlocked && task.status !== 'running' && task.status !== 'done') return `已拦截：${(task.policyReasons || []).join('、')}`;
    if (!task.enabled && task.status !== 'running' && task.status !== 'done') return '未选择';
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
      renderPreview();
    }));
  }

  function importAttachmentStats() {
    const refs = [];
    for (const task of batch.tasks || []) refs.push(...(task.attachmentRefs || []));
    const uniqueRefs = [...new Map(refs.map(ref => [Importer.normalizeFileKey(ref), ref])).values()];
    let matched = 0, issues = 0;
    for (const ref of uniqueRefs) {
      const key = Importer.normalizeFileKey(ref);
      if (batch.attachmentOverrides.get(key)) { matched++; continue; }
      const detail = Importer.resolveOneFile(ref, batch.fileIndex || Importer.buildFileIndex([]));
      if (detail.status === 'matched') matched++; else issues++;
    }
    return { total: uniqueRefs.length, matched, issues, shared: uniqueFiles(batch.sharedFiles).length };
  }

  function renderImportHandoff() {
    const card = $('nmda-import-handoff-card');
    const summary = $('nmda-import-ready-summary');
    const button = $('nmda-go-batch');
    const hasDataset = !!batch.dataset;
    if (!card || !summary || !button) return;
    card.hidden = !hasDataset;
    if (!hasDataset) return;
    const tasks = batch.tasks || [];
    const ready = tasks.filter(task => task.status === 'ready').length;
    const errors = tasks.filter(task => task.status === 'error').length;
    const scheduled = tasks.filter(task => !!task.scheduleAt).length;
    const stats = importAttachmentStats();
    const includedCollections = [...batch.collectionConfigs.values()].filter(config => config.enabled).length;
    const totalCollections = recordSets().length;
    summary.innerHTML = `<div class="nmda-import-metric"><strong>${includedCollections}/${totalCollections}</strong><span>参与内容集合</span></div><div class="nmda-import-metric"><strong>${tasks.length}</strong><span>生成任务</span></div><div class="nmda-import-metric"><strong>${ready}</strong><span>预检可用</span></div><div class="nmda-import-metric"><strong>${scheduled}</strong><span>定时任务</span></div><div class="nmda-import-metric ${errors ? 'is-warn' : ''}"><strong>${errors}</strong><span>任务错误</span></div><div class="nmda-import-metric ${stats.issues ? 'is-warn' : ''}"><strong>${stats.issues}</strong><span>附件待确认</span></div>`;
    button.textContent = tasks.length ? `进入批量任务（${tasks.length}）` : '进入批量任务';
    button.disabled = !tasks.length;
  }

  function renderPreview() {
    const tasks = batch.tasks || [];
    const matched = filteredBatchTasks();
    const errors = tasks.filter(t => t.status === 'error').length;
    const done = tasks.filter(t => t.status === 'done').length;
    const selectedReady = tasks.filter(t => t.enabled && t.status === 'ready').length;
    const selectedTotal = tasks.filter(t => t.enabled && t.status !== 'done').length;
    const unselected = tasks.filter(t => !t.enabled).length;
    const matchedSelected = matched.filter(t => t.enabled).length;
    batchSummaryEl.innerHTML = `<strong>${tasks.length}</strong> 封任务 · 当前结果 <strong>${matched.length}</strong>（已选 ${matchedSelected}） · 已选择 <strong>${selectedTotal}</strong> · 可创建 ${selectedReady} · 未选择 ${unselected} · 错误 ${errors} · 已完成 ${done}`;
    if (batchStartEl) batchStartEl.textContent = selectedReady ? `创建 ${selectedReady} 封草稿` : '创建所选草稿';
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
    const hasTasks = !!batch.dataset && tasks.length > 0;
    $('nmda-preview-card').hidden = !hasTasks;
    $('nmda-run-card').hidden = !hasTasks;
    $('nmda-batch-empty').hidden = hasTasks;
    batchStartEl.disabled = batch.running || !tasks.some(t => t.enabled && t.status === 'ready');
    renderTagChips();
    renderAttachmentCenter();
    renderImportTaskPreview();
    renderImportHandoff();
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
      ? `<strong>${matched}/${uniqueRefs.length}</strong> 个来源附件引用已匹配 · <strong>${shared.length}</strong> 个公共附件将加入每封邮件${issues.size ? ` · <span class="nmda-danger">${issues.size} 个待确认</span>` : ''}`
      : `当前任务没有专属附件引用 · <strong>${shared.length}</strong> 个公共附件将加入每封邮件`;

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

  function setImportStatus(message, kind = '') {
    if (!importStatusEl) return;
    importStatusEl.textContent = message;
    if (kind) importStatusEl.dataset.kind = kind; else delete importStatusEl.dataset.kind;
  }

  function setBatchStatus(message, kind = '') {
    batchStatusEl.textContent = message;
    if (kind) batchStatusEl.dataset.kind = kind; else delete batchStatusEl.dataset.kind;
  }

  async function applyImportedDataset(dataset, label = '数据') {
    batch.dataset = dataset;
    batch.importMeta = dataset?.meta || null;
    batch.collectionConfigs.clear();
    batch.taskEdits.clear();
    batch.directoryFiles = []; batch.taskFiles = uniqueFiles(dataset?.embeddedFiles || []); batch.sharedFiles = []; batch.attachmentOverrides.clear();
    batch.fileIndex = Importer.buildFileIndex(batch.taskFiles);
    dirEl.value = ''; taskFilesEl.value = ''; sharedFilesEl.value = '';
    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    if (batchTagExcludeEl) batchTagExcludeEl.value = '';
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
    $('nmda-import-preview-card').hidden = false;
    $('nmda-attachments-card').hidden = false;
    renderSourceInventory();
    configureCollection(best.index, false);
    refreshFileIndex(false);
    const addedContacts = await registerCurrentBatchContacts();
    const warningText = dataset.warnings?.length ? `；${dataset.warnings.length} 条解析警告` : '';
    const embeddedText = dataset.embeddedFiles?.length ? `；自动载入 ${dataset.embeddedFiles.length} 个包内附件` : '';
    const formatText = dataset.format ? `；${formatDisplayName(dataset.format)}` : '';
    $('nmda-import-format-info').textContent = `已载入 ${dataset.sourceFiles?.length || 1} 个数据源，提取 ${sets.length} 个内容集合${formatText}${embeddedText}${warningText}。`;
    const selected = sets[best.index];
    const includedCount = [...batch.collectionConfigs.values()].filter(config => config.enabled).length;
    setImportStatus(`解析完成：${label}；提取 ${sets.length} 个内容集合，自动纳入 ${includedCount} 个；当前检查“${selected?.name || '内容集合'}”${addedContacts ? `；新增 ${addedContacts} 个未联系联系人` : ''}${warningText}。`, dataset.warnings?.length ? 'warn' : 'ok');
    setBatchStatus(`数据摄取工作台已生成 ${batch.tasks.length} 封标准任务。请在批量任务中检索、检查并选择需要创建的草稿。`, 'ok');
  }

  function resetImportWorkspace({ keepStatus = false } = {}) {
    batch.dataset = null; batch.importMeta = null; batch.collectionIndex = 0; batch.collectionConfigs.clear(); batch.detection = null; batch.mapping = {}; batch.tasks = [];
    batch.directoryFiles = []; batch.taskFiles = []; batch.sharedFiles = []; batch.attachmentOverrides.clear(); batch.taskEdits.clear();
    batch.fileIndex = Importer.buildFileIndex([]); batch.profileSuggestion = null;
    [importFileEl, importDirEl, importPackageEl, dirEl, taskFilesEl, sharedFilesEl].forEach(el => { if (el) el.value = ''; });
    if (pasteSourceEl) pasteSourceEl.value = '';
    ['nmda-structure-card','nmda-mapping-card','nmda-import-preview-card','nmda-attachments-card','nmda-import-handoff-card','nmda-preview-card','nmda-run-card'].forEach(id => { const el = $(id); if (el) el.hidden = true; });
    const inventory = $('nmda-source-inventory'); if (inventory) { inventory.hidden = true; inventory.innerHTML = ''; }
    const mapping = $('nmda-mapping'); if (mapping) mapping.innerHTML = '';
    const semantic = $('nmda-semantic-summary'); if (semantic) semantic.innerHTML = '';
    const structure = $('nmda-structure-preview'); if (structure) structure.innerHTML = '';
    $('nmda-batch-empty').hidden = false;
    $('nmda-import-format-info').textContent = '支持结构化表格、Word 邮件记录、多文件、目录、JSON/JSONL、HTML/XML 与 ZIP 批次。';
    if (!keepStatus) setImportStatus('尚未载入数据源。');
    renderPreview();
  }

  function clearImportOnError(error) {
    console.error(`[${APP}] import`, error);
    resetImportWorkspace({ keepStatus: true });
    setImportStatus(`解析失败：${error.message}`, 'error');
  }

  importFileEl.addEventListener('change', async () => {
    const files = [...(importFileEl.files || [])];
    if (!files.length || !Importer) return;
    setImportStatus(`正在解析 ${files.length === 1 ? files[0].name : `${files.length} 个文件`}…`);
    try {
      const dataset = files.length === 1 ? await Importer.parseFile(files[0]) : await Importer.parseFiles(files);
      await applyImportedDataset(dataset, files.length === 1 ? files[0].name : `${files.length} 个文件`);
    } catch (error) { clearImportOnError(error); }
    finally { importFileEl.value = ''; }
  });

  importDirEl?.addEventListener('change', async () => {
    const files = [...(importDirEl.files || [])];
    if (!files.length || !Importer) return;
    setImportStatus(`正在扫描数据目录（${files.length} 个文件）…`);
    try {
      const dataset = await Importer.parseDirectory(files);
      await applyImportedDataset(dataset, `数据目录（${dataset.sourceFiles?.length || 0} 个可读取文件）`);
    } catch (error) { clearImportOnError(error); }
    finally { importDirEl.value = ''; }
  });

  importPackageEl?.addEventListener('change', async () => {
    const file = importPackageEl.files?.[0];
    if (!file || !Importer) return;
    setImportStatus(`正在解析批次包 ${file.name}…`);
    try {
      const dataset = await Importer.parseFile(file);
      await applyImportedDataset(dataset, `批次包 ${file.name}`);
    } catch (error) { clearImportOnError(error); }
    finally { importPackageEl.value = ''; }
  });

  $('nmda-show-paste')?.addEventListener('click', () => {
    const panel = $('nmda-paste-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) pasteSourceEl?.focus();
  });

  $('nmda-paste-import')?.addEventListener('click', async () => {
    const text = String(pasteSourceEl?.value || '').trim();
    if (!text) { setImportStatus('请先粘贴需要解析的数据。', 'warn'); return; }
    setImportStatus('正在识别粘贴内容的结构…');
    try {
      const file = new File([text], `pasted-${Date.now()}.txt`, { type:'text/plain;charset=utf-8', lastModified:Date.now() });
      const dataset = await Importer.parseFile(file);
      dataset.meta = { ...(dataset.meta || {}), pasted:true };
      await applyImportedDataset(dataset, '粘贴数据');
    } catch (error) { clearImportOnError(error); }
  });

  $('nmda-reset-import')?.addEventListener('click', () => {
    if (batch.running) { setImportStatus('批量任务运行期间不能清空导入。', 'warn'); return; }
    resetImportWorkspace();
  });

  mappingToggleEl?.addEventListener('click', () => setMappingEditorOpen(mappingEl.hidden));
  $('nmda-save-profile')?.addEventListener('click', () => {
    const collection = currentCollection();
    if (!collection || !batch.detection) return;
    const defaultName = `${collection.name || '内容'} 识别模板`;
    const name = prompt('为这套语义映射命名：', defaultName);
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
    $('nmda-profile-info').textContent = `已保存识别模板“${name}”。以后遇到相似内容结构会提示复用。`;
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
      renderSemanticSummary(); rebuildTasks(); registerCurrentBatchContacts();
    }));
    setMappingEditorOpen(true);
    renderSemanticSummary(); rebuildTasks(); registerCurrentBatchContacts();
    $('nmda-profile-info').textContent = `已应用识别模板“${profile.name}”。请检查语义映射和任务预览。`;
  });
  collectionSelectEl.addEventListener('change', async () => { configureCollection(collectionSelectEl.value, false); renderCollectionList(); await registerCurrentBatchContacts(); });
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

  [batchSearchEl, batchTagIncludeEl, batchTagExcludeEl].forEach(el => el?.addEventListener('input', renderPreview));

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
    const actionText = { enable: '选择当前结果', disable: '取消当前结果', addTag: `添加分类“${tagsText(parsed)}”`, removeTag: `移除分类“${tagsText(parsed)}”` }[kind];
    const skippedText = blockedSkipped ? `；另有 ${blockedSkipped} 封受联系策略拦截，无法选择` : '';
    setBatchStatus(`已对 ${affected} 封任务执行：${actionText}${skippedText}。`, blockedSkipped ? 'warn' : 'ok');
    renderPreview();
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
    renderPreview();
  });
  $('nmda-clear-tag-filter').addEventListener('click', () => {
    if (batchSearchEl) batchSearchEl.value = '';
    batchTagIncludeEl.value = '';
    batchTagExcludeEl.value = '';
    renderPreview();
  });

  $('nmda-contact-search').addEventListener('input', renderContacts);
  $('nmda-contact-class-filter').addEventListener('input', renderContacts);

  $('nmda-sync-history').addEventListener('click', async () => {
    const button = $('nmda-sync-history');
    button.disabled = true;
    const limit = $('nmda-mail-history-limit').value || '200';
    const rangeText = limit === 'all' ? '全部' : `最近 ${limit} 封/箱`;
    setContactStatusMessage(`正在同步${rangeText}邮箱历史：先读取已发送，再读取草稿箱…`);
    const notes = [];
    let warning = false;
    try {
      const sent = await chrome.runtime.sendMessage({ type: 'NMDA_READ_SENT', limit });
      if (!sent?.ok) throw new Error(sent?.reason || '读取已发送失败');
      const account = Contacts.normalizeEmail(sent.uid || await detectAccount()) || 'default';
      if (!contactBook.loaded || contactBook.account !== account) {
        contactBook.account = account;
        contactBook.contacts = await Contacts.load(account);
        contactBook.loaded = true;
      }
      const sentApplied = Contacts.applySentMessages(contactBook.contacts, sent.messages || []);
      const successful = (sent.messages || []).filter(message => !message.failed).length;
      notes.push(`已发送 ${sent.messages?.length || 0} 封（有效 ${successful}，新增历史 ${sentApplied.newLinks}）`);
      if (sent.truncated) { warning = true; notes.push(`已发送未完整覆盖：${sent.stopReason || '达到读取范围'}`); }

      setContactStatusMessage(`已完成已发送；正在读取${rangeText}草稿箱…`);
      const drafts = await chrome.runtime.sendMessage({ type: 'NMDA_READ_DRAFTS', limit });
      if (!drafts?.ok) throw new Error(drafts?.reason || '读取草稿箱失败');
      const draftApplied = Contacts.applyDraftMessages(contactBook.contacts, drafts.messages || [], { replaceActive: !!drafts.complete });
      notes.push(`草稿 ${drafts.messages?.length || 0} 封（新增历史 ${draftApplied.newLinks}，无收件人 ${draftApplied.draftsWithoutRecipient}）`);
      if (drafts.truncated) { warning = true; notes.push(`草稿未完整覆盖：${drafts.stopReason || '达到读取范围'}`); }
      if (drafts.complete) notes.push('草稿箱已完整覆盖并清理过期“有草稿”标记');

      await persistContacts();
      renderContacts();
      renderPreview();
      setContactStatusMessage(`邮箱历史同步完成：${notes.join('；')}。草稿不会推进联系人为“已发送”。`, warning ? 'warn' : 'ok');
    } catch (error) {
      console.error(`[${APP}] history sync`, error);
      // Preserve any successfully applied first-stage data instead of discarding it.
      try { await persistContacts(); renderContacts(); renderPreview(); } catch (_) {}
      setContactStatusMessage(`邮箱历史同步中断：${error.message}${notes.length ? `；已保留：${notes.join('；')}` : ''}`, 'error');
    } finally { button.disabled = false; }
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
    [batchSearchEl, batchTagIncludeEl, batchTagExcludeEl].forEach(el => { if (el) el.disabled = !!locked; });
    if (mappingToggleEl) mappingToggleEl.disabled = !!locked;
    ['nmda-clear-tag-filter','nmda-bulk-add-tag','nmda-bulk-remove-tag','nmda-bulk-enable','nmda-bulk-disable','nmda-clear-selection'].forEach(id => {
      const el = $(id); if (el) el.disabled = !!locked;
    });
  }

  batchStartEl.addEventListener('click', async () => {
    if (batch.running) return;
    const executable = batch.tasks.filter(task => task.enabled && task.status === 'ready');
    if (!executable.length) { setBatchStatus('没有已选择且预检通过的任务。请先在列表中勾选需要创建的草稿。', 'error'); return; }
    const executableKeys = new Set(executable.map(task => task.editKey)); // freeze this run at start
    batch.running = true; batch.stopRequested = false; batchStartEl.disabled = true; batchStopEl.disabled = false;
    importFileEl.disabled = true; if (importDirEl) importDirEl.disabled = true; if (importPackageEl) importPackageEl.disabled = true; collectionSelectEl.disabled = true; dirEl.disabled = true; taskFilesEl.disabled = true; sharedFilesEl.disabled = true; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=true; });
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
          setBatchStatus(`任务 ${task.id}：点击“存草稿”并确认${task.scheduleAt ? '定时设置成功' : '保存到草稿箱'}…`);
          const saveOutcome = await saveDraft(root, { scheduled: !!task.scheduleAt });
          task.note = [task.note, `草稿已确认保存（${saveOutcome.kind}）`].filter(Boolean).join('；');
          task.status = 'done'; succeeded++;
          renderPreview();
          await sleep(600);
        } catch (error) {
          console.error(`[${APP}] batch source record ${task.sourceRow}`, error);
          task.status = 'error'; task.runtimeError = error.message || String(error); failed++; renderPreview();
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
      importFileEl.disabled = false; if (importDirEl) importDirEl.disabled = false; if (importPackageEl) importPackageEl.disabled = false; collectionSelectEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; sharedFilesEl.disabled = false; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=false; });
      setBatchPlanningLocked(false);
      renderPreview();
    }
  });

  restoreFormState();
  renderPreview();
  initContacts();
  console.info(`[${APP}] v1.4.0 loaded`);
})();
