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
              <div class="nmda-subtitle">草稿 · 导入 · 批量 · 联系人</div>
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
          <button class="nmda-tab" data-tab="import" type="button"><span class="nmda-tab-icon">⇧</span><span><strong>导入任务</strong><small>载入、校验、交接</small></span></button>
          <button class="nmda-tab" data-tab="batch" type="button"><span class="nmda-tab-icon">▦</span><span><strong>批量任务</strong><small>筛选、选择、执行</small></span></button>
          <button class="nmda-tab" data-tab="contacts" type="button"><span class="nmda-tab-icon">◎</span><span><strong>联系人</strong><small>状态与历史</small></span></button>

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
            <div><h2>导入任务</h2><p>把文件、目录、ZIP 或粘贴内容转换成可靠邮件任务。机器先处理，只有异常才需要人工确认。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page" data-pane="import" hidden>
            <div class="nmda-ingest-workspace nmda-ingest-workspace-v2">
              <div class="nmda-card nmda-ingest-source-card" id="nmda-import-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title">选择来源</div><div class="nmda-card-desc">无需先整理格式；系统自动寻找邮件并生成任务。</div></div><div class="nmda-row nmda-wrap"><span class="nmda-import-busy-badge" id="nmda-import-busy-badge" hidden>正在处理…</span><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-reset-import" type="button" hidden title="清除当前来源、识别结果、人工修正、附件匹配和任务；不会删除联系人历史">重新开始</button></div></div>
                <input id="nmda-import-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <input id="nmda-import-dir" type="file" webkitdirectory multiple hidden>
                <input id="nmda-import-package" type="file" hidden accept=".zip">
                <input id="nmda-roster-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <div class="nmda-source-action-grid">
                  <label class="nmda-source-action" for="nmda-import-file"><span class="nmda-source-action-icon">＋</span><strong>选择文件</strong><small>可多选、可混合格式</small></label>
                  <label class="nmda-source-action" for="nmda-import-dir"><span class="nmda-source-action-icon">▤</span><strong>选择文件夹</strong><small>批量扫描整个目录</small></label>
                  <label class="nmda-source-action" for="nmda-import-package"><span class="nmda-source-action-icon">▣</span><strong>打开 ZIP</strong><small>任务与附件一起导入</small></label>
                  <button class="nmda-source-action nmda-source-action-button" id="nmda-show-paste" type="button"><span class="nmda-source-action-icon">⌘</span><strong>粘贴内容</strong><small>直接解析剪贴板文本</small></button>
                </div>
                <div class="nmda-paste-panel" id="nmda-paste-panel" hidden>
                  <textarea id="nmda-paste-source" placeholder="直接粘贴原始内容。无需先整理成 Excel；系统会先寻找邮件本体。"></textarea>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-paste-import" type="button">识别粘贴内容</button><span class="nmda-hint">原始排版可以混乱，识别器优先寻找邮件基础信息。</span></div>
                </div>
                <div class="nmda-ingest-source-tools"><span id="nmda-import-format-info" class="nmda-hint">支持 Word、表格、JSON/JSONL、文本、HTML/XML、多文件、目录与 ZIP。</span><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-template" type="button">任务模板</button></div>
                <div class="nmda-roster-source-strip">
                  <div><strong>总套磁名单 <span>可选参考源</span></strong><small>用于身份核验、院校补全和覆盖检查；不会生成邮件任务，也不要求与已撰写邮件数量相等。</small></div>
                  <div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-small" for="nmda-roster-file">导入总名单</label><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-remove" type="button" hidden>移除</button></div>
                </div>
                <div id="nmda-roster-source-status" class="nmda-hint">尚未载入总套磁名单。</div>
                <div id="nmda-import-status" class="nmda-summary nmda-import-status">尚未载入数据源。</div>
                <div id="nmda-source-inventory" class="nmda-source-inventory" hidden></div>
              </div>

              <div class="nmda-card nmda-ingest-result-card" id="nmda-ingest-result-card" hidden>
                <div class="nmda-card-head nmda-ingest-result-head">
                  <div><div><div class="nmda-card-title">识别结果</div><div class="nmda-card-desc">先看能否直接使用；只有不确定项才进入人工处理。</div></div></div>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-restore-excluded" type="button" hidden>恢复已排除</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-bulk-subject-open" type="button" hidden>批量补主题</button><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-import-issues" type="button" hidden>处理待确认</button></div>
                </div>
                <div id="nmda-import-preview-summary" class="nmda-ingest-health"></div>
                <div id="nmda-review-guidance" class="nmda-review-guidance">系统完成识别后，会把“自动通过 / 待确认 / 阻塞问题”分开。人工校正只处理待确认项。</div>
                <div class="nmda-bulk-subject-panel" id="nmda-bulk-subject-panel" hidden>
                  <div class="nmda-bulk-subject-copy"><strong>批量补充缺失主题</strong><small id="nmda-bulk-subject-summary">只填写空白主题，不覆盖任何已有主题。</small></div>
                  <div class="nmda-bulk-subject-form"><input id="nmda-bulk-subject-value" type="text" placeholder="输入统一邮件主题"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-bulk-subject-apply" type="button">填入缺失主题</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-bulk-subject-cancel" type="button">取消</button></div>
                </div>
              </div>

              <div class="nmda-card nmda-roster-audit-card" id="nmda-roster-audit-card" hidden>
                <div class="nmda-card-head">
                  <div><div class="nmda-card-title">总名单交叉核验</div><div class="nmda-card-desc">把总套磁名单当作参考主数据：核对身份、补学校，并解释“总名单数量 ≠ 已撰写邮件数量”的差异。</div></div>
                  <div class="nmda-row nmda-wrap"><label class="nmda-toggle-inline"><input id="nmda-roster-enabled" type="checkbox" checked>启用核验</label><label class="nmda-toggle-inline"><input id="nmda-roster-auto-school" type="checkbox" checked>自动补空缺学校</label></div>
                </div>
                <div id="nmda-roster-audit-summary" class="nmda-ingest-health"></div>
                <div id="nmda-roster-audit-note" class="nmda-review-guidance"></div>
                <details class="nmda-roster-details">
                  <summary>查看差异与核验策略</summary>
                  <div class="nmda-row nmda-wrap nmda-roster-policy"><label class="nmda-toggle-inline"><input id="nmda-roster-strict" type="checkbox">严格模式：名单外邮件需人工确认</label><span class="nmda-hint">默认只提示，不阻塞；适合总名单仍在持续变化的业务。</span></div>
                  <div id="nmda-roster-audit-details" class="nmda-roster-audit-details"></div>
                </details>
              </div>

              <div class="nmda-card nmda-review-workbench" id="nmda-import-editor-overlay" hidden>
                <div class="nmda-review-head">
                  <div><div class="nmda-card-kicker">EXCEPTION REVIEW</div><div class="nmda-card-title" id="nmda-import-editor-title">异常处理中心</div><div class="nmda-card-desc" id="nmda-import-editor-evidence">只修复当前真正不确定的信息；所有判断都回到原始来源证据。</div></div>
                  <div class="nmda-review-head-actions"><span id="nmda-review-progress" class="nmda-review-progress"></span><button class="nmda-icon-btn" id="nmda-import-editor-close" type="button" aria-label="关闭异常处理">×</button></div>
                </div>
                <div class="nmda-review-layout">
                  <aside class="nmda-review-queue-pane">
                    <div class="nmda-review-pane-title"><strong>待确认队列</strong><small>只列出需要人判断的邮件</small></div>
                    <div id="nmda-review-queue" class="nmda-review-queue"></div>
                  </aside>
                  <section class="nmda-review-evidence-pane">
                    <div class="nmda-review-pane-title"><strong>原文证据</strong><small>邮件边界及前后上下文；不是重新生成的摘要</small></div>
                    <div id="nmda-review-source-meta" class="nmda-review-source-meta"></div>
                    <div id="nmda-review-email-candidates" class="nmda-review-candidates"></div>
                    <div id="nmda-review-source-context" class="nmda-review-source-context"></div>
                  </section>
                  <section class="nmda-review-edit-pane">
                    <div class="nmda-review-pane-title"><strong>最小校正</strong><small id="nmda-review-problem-summary">只编辑缺失或可疑字段</small></div>
                    <div id="nmda-review-feedback" class="nmda-review-feedback" hidden></div>
                    <div class="nmda-import-editor-grid nmda-review-core-fields">
                      <label class="nmda-field" id="nmda-review-field-recipients"><span class="nmda-label">收件人 <em>必需</em></span><input id="nmda-import-edit-recipients" type="text" placeholder="recipient@example.edu"></label>
                      <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-subject"><span class="nmda-label">主题 <em>必需</em></span><input id="nmda-import-edit-subject" type="text"></label>
                      <label class="nmda-field nmda-import-editor-wide" id="nmda-review-field-body"><span class="nmda-label">正文 <em>必需</em></span><textarea id="nmda-import-edit-body"></textarea></label>
                    </div>
                    <details class="nmda-review-optional">
                      <summary>附加信息（通常无需在这里修改）</summary>
                      <div class="nmda-import-editor-grid">
                        <label class="nmda-field"><span class="nmda-label">定时时间</span><input id="nmda-import-edit-schedule" type="datetime-local"></label>
                        <label class="nmda-field"><span class="nmda-label">附件引用</span><input id="nmda-import-edit-attachments" type="text" placeholder="CV.pdf; Proposal.pdf"></label>
                        <label class="nmda-field nmda-import-editor-wide"><span class="nmda-label">任务标记</span><input id="nmda-import-edit-tags" type="text" placeholder="第一批;重点"></label>
                      </div>
                    </details>
                    <div class="nmda-review-actions">
                      <button class="nmda-btn nmda-btn-danger-quiet" id="nmda-review-exclude" type="button">排除这封邮件</button>
                      <div class="nmda-row nmda-wrap"><button class="nmda-btn" id="nmda-import-editor-cancel" type="button">暂时退出</button><button class="nmda-btn" id="nmda-import-editor-save" type="button">保存 / 确认</button><button class="nmda-btn nmda-btn-primary" id="nmda-import-editor-next" type="button">保存并处理下一条</button></div>
                    </div>
                  </section>
                </div>
              </div>

              <details class="nmda-card nmda-ingest-diagnostics" id="nmda-ingest-diagnostics" hidden>
                <summary><span><strong>识别诊断与高级映射</strong><small>仅在自动识别明显错误时使用；普通用户无需进入</small></span><span>高级</span></summary>
                <div class="nmda-diagnostics-grid">
                  <div class="nmda-ingest-structure-card" id="nmda-structure-card" hidden>
                    <div class="nmda-card-subtitle">来源与内容集合</div>
                    <div class="nmda-field"><span class="nmda-label">参与本批次的内容集合</span><div id="nmda-collection-list" class="nmda-collection-list"></div></div>
                    <label class="nmda-field" id="nmda-collection-field"><span class="nmda-label">当前诊断对象</span><select id="nmda-collection-select"></select></label>
                    <div id="nmda-structure-summary" class="nmda-structure-summary"></div>
                    <div class="nmda-raw-preview-wrap"><div class="nmda-card-subtitle">来源内容抽样</div><div id="nmda-structure-preview" class="nmda-structure-preview"></div></div>
                  </div>
                  <div class="nmda-ingest-mapping-card" id="nmda-mapping-card" hidden>
                    <div class="nmda-card-subtitle">结构化字段映射</div>
                    <div id="nmda-header-info" class="nmda-hint nmda-semantic-detection"></div>
                    <div id="nmda-semantic-summary" class="nmda-semantic-summary"></div>
                    <div class="nmda-row nmda-wrap nmda-mapping-actions"><button class="nmda-btn nmda-btn-small" id="nmda-apply-profile" type="button" hidden>应用识别模板</button><button class="nmda-btn nmda-btn-small" id="nmda-save-profile" type="button">保存识别模板</button><button class="nmda-btn nmda-btn-small" id="nmda-toggle-mapping" type="button">展开字段映射</button></div>
                    <div id="nmda-profile-info" class="nmda-hint"></div>
                    <div id="nmda-mapping" class="nmda-mapping nmda-semantic-mapping" hidden></div>
                  </div>
                </div>
              </details>

              <div class="nmda-card nmda-ingest-preview-card" id="nmda-import-preview-card" hidden>
                <div class="nmda-card-head"><div><div class="nmda-card-title">任务抽查</div><div class="nmda-card-desc">这里用于抽查机器结果；真正需要处理的记录会进入上方异常队列。</div></div><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-toggle-import-preview" type="button">展开全部抽查</button></div>
                <div class="nmda-table-wrap nmda-import-preview-table-wrap" id="nmda-import-preview-table-wrap" hidden>
                  <table class="nmda-table nmda-import-preview-table"><thead><tr><th>来源</th><th>收件人</th><th>主题 / 正文</th><th>附件</th><th>定时时间</th><th>标记</th><th>状态</th></tr></thead><tbody id="nmda-import-preview-body"></tbody></table>
                </div>
              </div>

              <div class="nmda-card nmda-import-attachments-card" id="nmda-attachments-card" hidden>
                <div class="nmda-card-head"><div><div><div class="nmda-card-title">附件</div><div class="nmda-card-desc">自动匹配任务附件；公共附件会加入每一封邮件。</div></div></div></div>
                <div id="nmda-attachment-summary" class="nmda-summary">解析出任务后会统计需要匹配的附件。</div>
                <div class="nmda-attachment-grid nmda-attachment-grid-simple">
                  <div class="nmda-file-source"><span class="nmda-label">任务文件池</span><span class="nmda-hint">按相对路径 / 文件名 / 下载副本名自动匹配。</span><div class="nmda-row nmda-wrap"><label class="nmda-btn nmda-btn-small nmda-file-button">选择文件<input id="nmda-attachment-files" type="file" multiple hidden></label><label class="nmda-btn nmda-btn-small nmda-file-button">选择目录<input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden></label></div></div>
                  <div class="nmda-file-source nmda-file-source-shared"><span class="nmda-label">公共附件</span><span class="nmda-hint">自动加入本批次每一封邮件。</span><label class="nmda-btn nmda-btn-small nmda-file-button">选择公共附件<input id="nmda-shared-files" type="file" multiple hidden></label></div>
                </div>
                <div id="nmda-attachment-drop" class="nmda-attachment-drop">也可以把任务相关附件直接拖到这里</div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-clear-attachments" type="button">清空本批附件</button><span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span></div>
                <div id="nmda-attachment-resolution" class="nmda-attachment-resolution" hidden><div class="nmda-card-subtitle">需要人工确认的附件</div><div class="nmda-hint">仅处理自动匹配失败或歧义，一次指定后本批复用。</div><div id="nmda-attachment-resolution-list"></div></div>
              </div>

              <div class="nmda-card nmda-import-handoff-card" id="nmda-import-handoff-card" hidden>
                <div class="nmda-card-head"><div><div><div class="nmda-card-title">完成导入</div><div class="nmda-card-desc">问题全部处理后，再进入批量任务。</div></div></div></div>
                <div id="nmda-import-ready-summary" class="nmda-import-ready-summary">尚未生成任务。</div>
                <div class="nmda-row nmda-import-handoff-actions"><span class="nmda-hint" id="nmda-handoff-hint">导入阶段只生成任务，不会操作网易写信页面。</span><button class="nmda-btn nmda-btn-primary" id="nmda-go-batch" type="button">进入批量任务</button></div>
              </div>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="batch" hidden>
            <div><h2>批量任务</h2><p>检索负责找到任务，勾选决定真正创建哪些草稿。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="batch" hidden>
            <div class="nmda-card nmda-batch-empty" id="nmda-batch-empty">
              <div><div class="nmda-card-kicker">批量任务</div><div class="nmda-card-title">尚无可管理任务</div><div class="nmda-card-desc">先完成导入、必要校验和任务交接。</div></div>
              <button class="nmda-btn nmda-btn-primary" id="nmda-go-import" type="button">前往导入任务</button>
            </div>

            <div class="nmda-card nmda-list-card" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-step-index">01</div><div><div class="nmda-card-title">任务列表</div><div class="nmda-card-desc">检索负责找任务，勾选决定真正执行哪些草稿</div></div></div><div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div></div>
              <div class="nmda-search-bar">
                <label class="nmda-field nmda-search-field"><span class="nmda-label">检索任务</span><input id="nmda-batch-search" type="search" placeholder="编号 / 收件人 / 学校 / 主题 / 正文 / 状态 / 标记 / 附件 / 定时时间"></label>
                <div class="nmda-search-help">检索只改变当前视图，不会改变已选择任务。</div>
              </div>
              <div class="nmda-filter-bar nmda-batch-filter-bar">
                <label class="nmda-field"><span class="nmda-label">联系状态</span><select id="nmda-batch-stage-filter"><option value="">全部状态</option><option value="未联系">未联系</option><option value="已发送">已发送</option><option value="已回复">已回复</option></select></label>
                <label class="nmda-field"><span class="nmda-label">业务标记</span><input id="nmda-batch-tag-include" type="text" placeholder="如 第一批;重点"><span class="nmda-hint">只筛选自定义标记；多个标记需同时满足</span></label>
                <button class="nmda-btn nmda-btn-small" id="nmda-clear-tag-filter" type="button">清除筛选</button>
              </div>
              <div id="nmda-batch-tag-chips" class="nmda-tag-chips"></div>
              <div class="nmda-bulk-editor">
                <input id="nmda-bulk-tag-value" type="text" placeholder="批量任务标记，如 第一批;重点">
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-add-tag" type="button">添加标记</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-remove-tag" type="button">移除标记</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">选择当前结果</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-bulk-disable" type="button">取消当前结果</button>
                <button class="nmda-btn nmda-btn-small" id="nmda-clear-selection" type="button">清空选择</button>
              </div>
              <div class="nmda-table-wrap nmda-batch-table-wrap"><table class="nmda-table nmda-batch-table"><thead><tr><th>选择</th><th>#</th><th>收件人</th><th>学校 / 分组</th><th>联系 / 标记</th><th>定时时间</th><th>主题</th><th>附件</th><th>任务状态</th></tr></thead><tbody id="nmda-preview-body"></tbody></table></div>
            </div>

            <div class="nmda-card nmda-scheduler-card" id="nmda-scheduler-card" hidden>
              <div class="nmda-card-head nmda-scheduler-head">
                <div><div class="nmda-step-index">02</div><div><div class="nmda-card-title">智能排程</div><div class="nmda-card-desc">默认：同一学校每轮最多 1 位；下一轮间隔 7 天。仅作用于已选择且预检通过的任务。</div></div></div>
                <div id="nmda-schedule-summary" class="nmda-summary nmda-summary-inline"></div>
              </div>
              <div class="nmda-scheduler-grid">
                <label class="nmda-field"><span class="nmda-label">首轮开始时间</span><input id="nmda-rule-start-at" type="datetime-local"><span class="nmda-hint">不同学校可同轮安排；同校按轮次自动后移。</span></label>
                <label class="nmda-field"><span class="nmda-label">同校每轮最多</span><input id="nmda-rule-max-school" type="number" min="1" max="20" step="1" value="1"><span class="nmda-hint">默认 1 位</span></label>
                <label class="nmda-field"><span class="nmda-label">轮次间隔</span><div class="nmda-input-suffix"><input id="nmda-rule-interval-days" type="number" min="1" max="365" step="1" value="7"><span>天</span></div><span class="nmda-hint">默认 7 天</span></label>
                <label class="nmda-check-card"><input id="nmda-rule-preserve-existing" type="checkbox" checked><span><strong>保留已有定时</strong><small>导入或手工设置的时间不覆盖；重新排程只刷新自动时间。</small></span></label>
              </div>
              <div class="nmda-scheduler-actions">
                <div id="nmda-schedule-rule-preview" class="nmda-schedule-rule-preview">学校优先分组；学校缺失时自动按收件邮箱域名分组。</div>
                <button class="nmda-btn" id="nmda-clear-auto-schedule" type="button">清除自动排程</button>
                <button class="nmda-btn nmda-btn-primary" id="nmda-apply-schedule" type="button">生成 / 更新排程</button>
              </div>
            </div>

            <div class="nmda-card nmda-run-card" id="nmda-run-card" hidden>
              <div class="nmda-run-left"><div class="nmda-step-index">03</div><div><div class="nmda-card-title">创建所选草稿</div><div id="nmda-batch-status" class="nmda-run-status">请先导入并选择要创建的任务。</div></div></div>
              <div class="nmda-run-controls nmda-run-controls-simple">
                <div class="nmda-run-rule">仅执行已勾选且预检通过的任务；任何执行错误都会立即停止，避免串稿。</div>
                <button class="nmda-btn nmda-btn-primary" id="nmda-batch-start" type="button">创建所选草稿</button>
                <button class="nmda-btn" id="nmda-batch-stop" type="button" disabled>当前封后停止</button>
              </div>
            </div>
          </section>

          <div class="nmda-page-head" data-page-head="contacts" hidden>
            <div><h2>联系人</h2><p>状态用于记录互动进度，策略用于安全拦截，标记只做长期业务整理。</p></div>
          </div>
          <section class="nmda-tabpane nmda-page" data-pane="contacts" hidden>
            <div class="nmda-crm-top-grid">
              <div class="nmda-card nmda-mail-history-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">MAILBOX STATE</div><div class="nmda-card-title">邮箱读取与重建</div><div class="nmda-card-desc">读取只重建“已发送 / 当前草稿”的邮箱证据；互动状态、策略与长期标记独立保存。</div></div></div>
                <div class="nmda-read-model">
                  <div class="nmda-read-layer"><strong>邮箱证据</strong><span>已发送、草稿、时间、主题、收件人</span><small>可重新读取、可完整重建</small></div>
                  <div class="nmda-read-arrow">→</div>
                  <div class="nmda-read-layer"><strong>人工决策</strong><span>互动状态、待跟进、联系策略、长期标记</span><small>完整重建也不会覆盖</small></div>
                </div>
                <div class="nmda-history-actions nmda-history-actions-maintenance">
                  <div class="nmda-history-source"><div><strong>快速刷新</strong><small>读取最近变化并增量合并。适合日常使用，不负责清除已经从邮箱中删除的旧快照记录。</small></div><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-refresh-history" type="button">快速刷新</button></div>
                  <div class="nmda-history-source nmda-history-source-rebuild"><div><strong>完整重建</strong><small>完整分页读取“已发送 + 草稿箱”，两边都完整后才原子替换邮箱快照；失败则旧数据完全不动。</small></div><button class="nmda-btn nmda-btn-small" id="nmda-rebuild-history" type="button">完整重建</button></div>
                </div>
                <div id="nmda-mailbox-read-meta" class="nmda-read-meta">尚未读取邮箱状态。</div>
                <div id="nmda-contact-status" class="nmda-summary">正在初始化当前邮箱的联系人状态库…</div>
              </div>
              <div class="nmda-card">
                <div class="nmda-card-head"><div><div class="nmda-card-kicker">CONTACT BOOK</div><div class="nmda-card-title">联系人操作</div></div></div>
                <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-small" id="nmda-export-contacts" type="button">导出联系人 CSV</button></div>
                <div class="nmda-hint">导入批量任务时会自动建立“未联系”联系人；任务标记不会自动写入联系人长期标记。暂停/不再联系会自动拦截任务。</div>
              </div>
            </div>

            <div class="nmda-card nmda-contact-list-card">
              <div class="nmda-card-head nmda-list-head"><div><div class="nmda-card-title">联系人列表</div><div class="nmda-card-desc">互动状态、联系策略和长期标记各司其职，不再混为一类</div></div><div id="nmda-contact-summary" class="nmda-summary nmda-summary-inline">0 个联系人</div></div>
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
    const contactTags=contactTagsForRecipients(task?.recipients || '');
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
    if (meta.lastFullAt) parts.push(`最近完整重建：${Contacts.formatDisplayTime(meta.lastFullAt)}`);
    else if (meta.lastQuickAt) parts.push(`最近快速刷新：${Contacts.formatDisplayTime(meta.lastQuickAt)}`);
    if (meta.sent) parts.push(`已发送 ${meta.sent.read ?? 0}${meta.sent.complete ? '（完整）' : meta.sent.total ? ` / ${meta.sent.total}` : ''}`);
    if (meta.drafts) parts.push(`草稿 ${meta.drafts.read ?? 0}${meta.drafts.complete ? '（完整）' : meta.drafts.total ? ` / ${meta.drafts.total}` : ''}`);
    if (meta.lastMode === 'full' && meta.complete) parts.push('当前邮箱快照已完整重建');
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
    } catch (_) { el.textContent = '读取状态元数据不可用。'; }
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
      const own = new Set(contactOperationalLabels(contact).map(value => value.toLocaleLowerCase('zh-CN')));
      return classFilter.every(value => own.has(value));
    });
    if (query) list = list.filter(contact => `${contact.email} ${contact.name || ''} ${contact.lastSubject || ''} ${contact.lastDraftSubject || ''} ${contactOperationalLabels(contact).join(' ')}`.toLowerCase().includes(query));
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
      for (const value of (Contacts.parseContactTags?.(contact.tags||[])||[])) classCounts.set(value, (classCounts.get(value) || 0) + 1);
    }
    summary.textContent = `${all.length} 个联系人 · ${Contacts.STAGE_OPTIONS.map(stage => `${stage} ${stageCounts[stage] || 0}`).join(' · ')} · 有草稿 ${withDraftCount} · 待跟进 ${followCount} · 暂停 ${pausedCount} · 不再联系 ${noContactCount}`;

    if (chipBar) {
      const top = [...classCounts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 40);
      chipBar.innerHTML = top.length ? top.map(([value,count]) => `<button type="button" class="nmda-tag-chip" data-contact-class-chip="${escapeHtml(value)}">${escapeHtml(value)} <small>${count}</small></button>`).join('') : '<span class="nmda-hint">暂无长期标记。状态统计已在右侧汇总。</span>';
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
            <label class="nmda-class-tags"><span>长期标记</span><input class="nmda-contact-tags-input" data-contact-tags-email="${escapeHtml(contact.email)}" value="${escapeHtml(tagsText(contact.tags))}" placeholder="重点;第一批"></label>
          </div>
        </td>
        <td>${Number(contact.sentCount || 0)}</td>
        <td><strong>${Number(contact.draftCount || 0)}</strong>${Number(contact.draftCount || 0) > 0 ? '<small>当前已识别</small>' : ''}</td>
        <td title="${escapeHtml(contact.lastSentAt || '')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastSentAt))}</td>
        <td title="${escapeHtml(contact.lastDraftAt || '')}">${escapeHtml(Contacts.formatDisplayTime(contact.lastDraftAt))}${contact.lastDraftSubject ? `<small title="${escapeHtml(contact.lastDraftSubject)}">${escapeHtml(contact.lastDraftSubject)}</small>` : ''}</td>
        <td title="${escapeHtml(contact.lastSubject || '')}">${escapeHtml(contact.lastSubject || '—')}</td>
      </tr>`).join('');
    if (!list.length) body.innerHTML = '<tr><td colspan="7">暂无匹配联系人。可快速刷新 / 完整重建邮箱状态，或导入批量任务。</td></tr>';
    else if (list.length > 1000) body.insertAdjacentHTML('beforeend', `<tr><td colspan="7">当前显示前 1000 个匹配联系人，共 ${list.length} 个。可用搜索或状态/标记缩小范围。</td></tr>`);

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
      setContactStatusMessage(`已更新 ${input.dataset.contactTagsEmail} 的长期标记：${tagsText(contact?.tags) || '无'}。`, 'ok');
    }));
  }

  async function initContacts() {
    if (!Contacts) { setContactStatusMessage('联系人模块未加载。', 'error'); return; }
    try {
      await ensureContactBook(true);
      renderContacts();
      await renderMailboxReadMeta();
      setContactStatusMessage(`当前邮箱：${contactBook.account}。邮箱读取只维护证据层；互动状态、跟进、联系策略和长期标记独立保存。`, 'ok');
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
    // Pane visibility must always be derived from the current domain state, never from stale DOM.
    if(name==='batch' && typeof renderPreview==='function') renderPreview();
    if(name==='contacts' && typeof renderContacts==='function') renderContacts();
  }

  launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('nmda-close').addEventListener('click', () => { panel.hidden = true; });
  $('nmda-expand').addEventListener('click', () => {
    panel.classList.toggle('is-maximized');
    $('nmda-expand').textContent = panel.classList.contains('is-maximized') ? '◱' : '⛶';
    $('nmda-expand').title = panel.classList.contains('is-maximized') ? '还原工作台' : '全屏工作台';
  });
  ui.querySelectorAll('.nmda-tab').forEach(tab => tab.addEventListener('click', () => setWorkbenchTab(tab.dataset.tab)));
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
    importMeta: null, profileSuggestion: null, importPreviewExpanded: false,
    sessionId: 0, importBusy: false, schedulePlan: null,
    scheduleRules: { ...(Scheduler?.DEFAULT_RULES || { maxPerGroupPerRound:1, intervalDays:7, preserveExisting:true, intraRoundMinutes:10 }), startAt: Scheduler?.defaultStart?.() || '' },
    roster: { dataset:null, entries:[], audit:null, warnings:[], enabled:true, autoSchool:true, strict:false, sourceNames:[] },
    handoffComplete: false
  };

  const importFileEl = $('nmda-import-file'), importDirEl = $('nmda-import-dir'), importPackageEl = $('nmda-import-package'), rosterFileEl = $('nmda-roster-file'), collectionSelectEl = $('nmda-collection-select'), mappingEl = $('nmda-mapping'), mappingToggleEl = $('nmda-toggle-mapping');
  const pasteSourceEl = $('nmda-paste-source'), importPreviewBodyEl = $('nmda-import-preview-body'), importPreviewSummaryEl = $('nmda-import-preview-summary'), importReviewBtnEl = $('nmda-review-import-issues');
  const bulkSubjectOpenEl = $('nmda-bulk-subject-open'), bulkSubjectPanelEl = $('nmda-bulk-subject-panel'), bulkSubjectValueEl = $('nmda-bulk-subject-value'), bulkSubjectSummaryEl = $('nmda-bulk-subject-summary');
  const importEditorOverlayEl = $('nmda-import-editor-overlay'), importEditRecipientsEl = $('nmda-import-edit-recipients'), importEditSubjectEl = $('nmda-import-edit-subject'), importEditBodyEl = $('nmda-import-edit-body'), importEditAttachmentsEl = $('nmda-import-edit-attachments'), importEditScheduleEl = $('nmda-import-edit-schedule'), importEditTagsEl = $('nmda-import-edit-tags'), importEditorEvidenceEl = $('nmda-import-editor-evidence');
  const reviewQueueEl = $('nmda-review-queue'), reviewSourceContextEl = $('nmda-review-source-context'), reviewSourceMetaEl = $('nmda-review-source-meta'), reviewCandidatesEl = $('nmda-review-email-candidates'), reviewProgressEl = $('nmda-review-progress'), reviewProblemSummaryEl = $('nmda-review-problem-summary'), reviewFeedbackEl = $('nmda-review-feedback');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files'), sharedFilesEl = $('nmda-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status'), importStatusEl = $('nmda-import-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop');
  const scheduleStartEl = $('nmda-rule-start-at'), scheduleMaxSchoolEl = $('nmda-rule-max-school'), scheduleIntervalDaysEl = $('nmda-rule-interval-days'), schedulePreserveEl = $('nmda-rule-preserve-existing');
  const scheduleApplyEl = $('nmda-apply-schedule'), scheduleClearEl = $('nmda-clear-auto-schedule'), scheduleSummaryEl = $('nmda-schedule-summary'), scheduleRulePreviewEl = $('nmda-schedule-rule-preview');
  const batchSearchEl = $('nmda-batch-search');
  const batchTagIncludeEl = $('nmda-batch-tag-include'), batchStageFilterEl = $('nmda-batch-stage-filter');
  const importBusyBadgeEl = $('nmda-import-busy-badge'), resetImportEl = $('nmda-reset-import');

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

  function renderImportLifecycleState() {
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
      const rosterStatus=$('nmda-roster-source-status'); if(rosterStatus)rosterStatus.textContent=`已载入 ${keepRoster.entries.length} 条总名单记录${keepRoster.sourceNames?.length?` · ${keepRoster.sourceNames.join('、')}`:''}`;
      const rosterRemove=$('nmda-roster-remove'); if(rosterRemove)rosterRemove.hidden=false;
      renderRosterAudit();
    }
    const token = batch.sessionId;
    batch.importBusy = true;
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
    if (meta.mailFrames) return { label:'邮件基础信息识别', icon:'✉', tone:'mail' };
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
      const scan = collection.meta?.mailScan;
      const detail = collection.meta?.mailFrames && scan
        ? `${kind.label} · ${scan.records || count} 条 · ${scan.complete || 0} 信息完整 · ${scan.missingRecipients || 0} 待补邮箱 · ${scan.averageConfidence || 0}%`
        : `${kind.label} · ${count} 条记录`;
      return `<div class="nmda-collection-row ${active ? 'is-active' : ''}"><label><input type="checkbox" data-collection-enabled="${index}" ${config?.enabled !== false ? 'checked' : ''}><span class="nmda-collection-kind">${escapeHtml(kind.icon)}</span><span class="nmda-collection-main"><strong>${escapeHtml(collection.name || `内容集合 ${index + 1}`)}</strong><small>${escapeHtml(detail)}</small></span></label><button type="button" class="nmda-btn nmda-btn-small" data-inspect-collection="${index}">${active ? '正在检查' : '检查 / 校正'}</button></div>`;
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
      ? `<span><strong>${scan.records || dataCount}</strong> 个邮件候选</span><span><strong>${scan.complete || 0}</strong> 基础信息完整</span><span><strong>${scan.missingRecipients || 0}</strong> 待补邮箱</span><span><strong>${scan.averageConfidence || 0}%</strong> 平均证据</span>`
      : `<span><strong>${dataCount}</strong> 条候选记录</span><span><strong>${width}</strong> 个来源字段</span>`;
    summary.innerHTML = `
      <div class="nmda-structure-identity" data-tone="${escapeHtml(kind.tone)}"><span>${escapeHtml(kind.icon)}</span><div><strong>${escapeHtml(kind.label)}</strong><small>${escapeHtml(collection.name || '未命名内容集合')}</small></div></div>
      <div class="nmda-structure-metrics">${metricHtml}<span title="${escapeHtml(String(source || ''))}"><strong>来源</strong> ${escapeHtml(String(source || '—'))}</span></div>`;
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

  function recipientLooksValid(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const direct=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i.test(raw);
    if (direct) return true;
    const parsed = Contacts?.parseRecipients?.(raw) || [];
    return parsed.some(item => /@/.test(String(item?.email || item || '')));
  }

  function unresolvedImportIssues(task) {
    const out=[];
    if (!String(task?.recipients||'').trim()) out.push('缺少收件人');
    else if (!recipientLooksValid(task.recipients)) out.push('收件人邮箱格式无效');
    if (!String(task?.subject||'').trim()) out.push('缺少主题');
    if (!String(task?.body||'').trim()) out.push('缺少正文');
    // Human confirmation is scoped: mail-frame confirmation must not silently suppress later roster conflicts.
    if (!task?.reviewConfirmed) {
      if (task?.importConfidence && task.importConfidence < 70) out.push(`邮件边界证据 ${Math.round(task.importConfidence)}%`);
      for (const issue of task?.importIssues || []) {
        if (/未定位收件人/.test(issue) && task.recipients) continue;
        if (/主题为空/.test(issue) && task.subject) continue;
        if (/正文过短/.test(issue) && String(task.body||'').length>=40) continue;
        if (/置信度/.test(issue) && task.importConfidence>=70) continue;
        if (/未找到邮件落款|未找到邮件称呼|未找到 Subject/.test(issue) && task.importConfidence >= 80) continue;
        if (!out.includes(issue)) out.push(issue);
      }
    }
    if (!task?.rosterConfirmed) for (const issue of task?.rosterIssues || []) if (!out.includes(issue)) out.push(issue);
    return out;
  }

  function taskNeedsImportReview(task) { return !task?.importExcluded && unresolvedImportIssues(task).length > 0; }

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

  function missingSubjectTasks() {
    return (batch.tasks || []).filter(task => !task?.importExcluded && !String(task?.subject || '').trim());
  }

  function setBulkSubjectPanel(open = true) {
    if (!bulkSubjectPanelEl) return;
    const missing = missingSubjectTasks();
    bulkSubjectPanelEl.hidden = !open || !missing.length;
    if (bulkSubjectSummaryEl) bulkSubjectSummaryEl.textContent = missing.length
      ? `当前 ${missing.length} 封邮件缺少主题。只填空白主题，不覆盖已有主题；其他异常仍会继续保留。`
      : '当前没有缺失主题。';
    if (open && missing.length) {
      if (bulkSubjectValueEl) { bulkSubjectValueEl.value = ''; setTimeout(() => bulkSubjectValueEl.focus(), 0); }
    }
  }

  function applyBulkMissingSubject() {
    const subject = String(bulkSubjectValueEl?.value || '').trim();
    const missing = missingSubjectTasks();
    if (!subject) {
      if (bulkSubjectSummaryEl) bulkSubjectSummaryEl.textContent = '请输入要批量填入的主题。';
      bulkSubjectValueEl?.focus();
      return;
    }
    if (!missing.length) { setBulkSubjectPanel(false); return; }
    batch.handoffComplete = false;
    for (const task of missing) {
      const prev = batch.taskEdits.get(task.editKey) || {};
      // Subject batching is deliberately fill-only: never overwrite a source or manually entered subject.
      if (!String(task.subject || '').trim()) batch.taskEdits.set(task.editKey, { ...prev, subject });
    }
    const count = missing.length;
    setBulkSubjectPanel(false);
    rebuildTasks();
    setImportStatus(`已为 ${count} 封缺失主题的邮件批量填入主题；已有主题保持不变。`, 'ok');
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
      if(reason==='当前识别证据')adjusted+=20;
      if(adjusted<55)return;
      seen.add(key);
      candidates.push({email,index:Number.isFinite(index)?index:null,score:adjusted,reason,text});
    };
    for(const c of rowMeta?.recipientCandidates||[]) add(c.email,c.index,c.score,'识别器附近候选',c.text||'');
    if(rowMeta?.recipientEvidence?.email) add(rowMeta.recipientEvidence.email,rowMeta.recipientEvidence.index,rowMeta.recipientEvidence.score,'当前识别证据',rowMeta.recipientEvidence.text||'');
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
    const list=reviewTasks();
    if(reviewProgressEl) reviewProgressEl.textContent=list.length?`${list.length} 条待确认`:'全部已处理';
    reviewQueueEl.innerHTML=list.length?list.map((task,index)=>{
      const issues=unresolvedImportIssues(task);
      const label=issues[0]||'待确认';
      return `<button type="button" class="nmda-review-queue-item ${task.editKey===activeKey?'is-active':''}" data-review-key="${escapeHtml(task.editKey)}"><span class="nmda-review-queue-index">${index+1}</span><span class="nmda-review-queue-main"><strong>${escapeHtml(task.id||`邮件 ${index+1}`)}</strong><small>${escapeHtml(task.subject||task.recipients||'未识别主题')}</small><em>${escapeHtml(label)}${issues.length>1?` · +${issues.length-1}`:''}</em></span><span class="nmda-review-queue-confidence">${task.importConfidence?`${Math.round(task.importConfidence)}%`:'—'}</span></button>`;
    }).join(''):'<div class="nmda-review-empty">没有待确认邮件。机器结果已经通过核心信息校验。</div>';
    reviewQueueEl.querySelectorAll('[data-review-key]').forEach(button=>button.addEventListener('click',()=>{
      const task=(batch.tasks||[]).find(t=>t.editKey===button.dataset.reviewKey); if(task)openImportTaskEditor(task);
    }));
  }

  function renderReviewSource(task) {
    if(!reviewSourceContextEl||!reviewSourceMetaEl||!reviewCandidatesEl)return;
    const {collection,rowMeta,sourceBlocks,contextOffset=0}=taskSourceMeta(task);
    const issues=unresolvedImportIssues(task);
    reviewSourceMetaEl.innerHTML=`<span><strong>${escapeHtml(task.sourceFile||collection?.source||'来源')}</strong></span><span>${escapeHtml(task.collectionName||collection?.name||'')}</span>${rowMeta?.heading?`<span title="${escapeHtml(rowMeta.heading)}">身份线索：${escapeHtml(rowMeta.heading)}</span>`:''}`;
    const candidates=reviewCandidateEmails(task);
    reviewCandidatesEl.innerHTML=candidates.length
      ? `<div class="nmda-review-candidate-title">附近邮箱候选 <small>只作为建议，点击后仍需确认</small></div><div class="nmda-review-candidate-list">${candidates.map(c=>`<button type="button" data-review-email="${escapeHtml(c.email)}" title="${escapeHtml(c.reason)} · 证据分 ${Math.round(c.score)}">${escapeHtml(c.email)}<small>${escapeHtml(c.reason)}</small></button>`).join('')}</div>`
      : (issues.some(x=>/收件人/.test(x))?'<div class="nmda-review-no-candidate">原文附近没有可靠邮箱候选。请从可信来源补充邮箱，或排除这封邮件。</div>':'');
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
    if(reviewProblemSummaryEl) reviewProblemSummaryEl.textContent=issues.length?`当前只需处理：${issues.join('；')}`:'核心信息完整，可直接确认。';
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
      reviewProblemSummaryEl.textContent=problems.length?`仍需补充：${problems.join('、')}`:soft.length?`核心信息已完整；保存后确认：${soft.join('；')}`:'核心信息已完整，保存后即可通过。';
    }
    if(reviewFeedbackEl)reviewFeedbackEl.hidden=true;
  }

  function renderImportTaskPreview() {
    const card = $('nmda-import-preview-card');
    const resultCard=$('nmda-ingest-result-card');
    if (!card || !importPreviewBodyEl || !importPreviewSummaryEl) return;
    const tasks = batch.tasks || [];
    if (!batch.dataset) { card.hidden = true; if(resultCard)resultCard.hidden=true; return; }
    card.hidden = false; if(resultCard)resultCard.hidden=false;
    const previewWrap=$('nmda-import-preview-table-wrap'); if(previewWrap)previewWrap.hidden=!batch.importPreviewExpanded;
    const previewToggle=$('nmda-toggle-import-preview'); if(previewToggle)previewToggle.textContent=batch.importPreviewExpanded?'收起抽查':'展开任务抽查';
    const ready = tasks.filter(t => t.status === 'ready').length;
    const review = tasks.filter(taskNeedsImportReview).length;
    const excluded=excludedImportCount();
    const totalDetected=tasks.length+excluded;
    const extraErrors=tasks.filter(t=>!taskNeedsImportReview(t)&&(t.errors||[]).some(error=>!/联系策略/.test(error))).length;
    const autoPassed=tasks.filter(t=>!taskNeedsImportReview(t)&&!(t.errors||[]).some(error=>!/联系策略/.test(error))).length;
    importPreviewSummaryEl.innerHTML=`<div class="nmda-health-metric is-total"><strong>${totalDetected}</strong><span>识别邮件</span></div><div class="nmda-health-metric is-ok"><strong>${autoPassed}</strong><span>自动通过</span></div><div class="nmda-health-metric ${review?'is-warn':'is-ok'}"><strong>${review}</strong><span>待人工确认</span></div><div class="nmda-health-metric ${extraErrors?'is-error':''}"><strong>${extraErrors}</strong><span>其他阻塞问题</span></div>${excluded?`<div class="nmda-health-metric"><strong>${excluded}</strong><span>已人工排除</span></div>`:''}`;
    const guide=$('nmda-review-guidance');
    if(guide) guide.innerHTML=review?`机器已经完成大部分工作。当前只需处理 <strong>${review}</strong> 条不确定邮件；打开异常处理中心可直接查看原文证据。`:`<strong>核心邮件信息已全部确认。</strong> 如需抽查机器结果，可在下方任务抽查中检查任意邮件。`;
    if (importReviewBtnEl) { importReviewBtnEl.hidden = !review; importReviewBtnEl.textContent = review ? `处理 ${review} 条待确认` : '全部已确认'; }
    const missingSubjects = missingSubjectTasks().length;
    if (bulkSubjectOpenEl) { bulkSubjectOpenEl.hidden = !missingSubjects; bulkSubjectOpenEl.textContent = missingSubjects ? `批量补主题（${missingSubjects}）` : '批量补主题'; }
    if (bulkSubjectPanelEl && !missingSubjects) bulkSubjectPanelEl.hidden = true;
    if (bulkSubjectSummaryEl && missingSubjects && !bulkSubjectPanelEl?.hidden) bulkSubjectSummaryEl.textContent = `当前 ${missingSubjects} 封邮件缺少主题。只填空白主题，不覆盖已有主题；其他异常仍会继续保留。`;
    const restoreExcluded=$('nmda-restore-excluded'); if(restoreExcluded){restoreExcluded.hidden=!excluded;restoreExcluded.textContent=excluded?`恢复已排除（${excluded}）`:'恢复已排除';}
    const limit=batch.importPreviewExpanded?Math.min(150,tasks.length):Math.min(12,tasks.length);
    const sample = tasks.slice(0, limit);
    importPreviewBodyEl.innerHTML = sample.length ? sample.map((task, idx) => {
      const reviewIssues=unresolvedImportIssues(task);
      const validation = task.status === 'error' ? `错误：${task.errors.join('；')}` : task.reviewConfirmed ? '人工确认通过' : task.warnings?.length ? `提示：${task.warnings.join('；')}` : '自动通过';
      const validationClass = task.status === 'error' ? 'is-error' : reviewIssues.length || task.warnings?.length ? 'is-warn' : 'is-ok';
      const bodySnippet = String(task.body || '').replace(/\s+/g,' ').trim().slice(0,90);
      const schedule = task.scheduleAt ? task.scheduleAt.replace('T',' ') : '未定时';
      const confidence = task.importConfidence ? `${Math.round(task.importConfidence)}%` : '结构化';
      const reviewText = reviewIssues.length ? reviewIssues.join('；') : validation;
      return `<tr data-import-task-row="${escapeHtml(task.editKey)}"><td title="${escapeHtml(`${task.collectionName || ''} · ${task.sourceFile || ''}`)}"><strong>${escapeHtml(task.id || task.collectionName || `记录 ${idx + 1}`)}</strong><small>${escapeHtml(task.sourceFile || `第 ${task.sourceRow} 条`)}</small></td><td title="${escapeHtml(task.recipients)}">${escapeHtml(task.recipients || '—')}</td><td><strong title="${escapeHtml(task.subject)}">${escapeHtml(task.subject || '—')}</strong>${bodySnippet ? `<small title="${escapeHtml(task.body)}">${escapeHtml(bodySnippet)}${String(task.body||'').length>90?'…':''}</small>` : ''}</td><td>${task.attachmentRefs?.length || 0}</td><td>${escapeHtml(schedule)}</td><td>${escapeHtml((task.tags || []).join(' · ') || '—')}</td><td><div class="nmda-import-validation-stack"><span class="nmda-validation-pill ${validationClass}" title="${escapeHtml(reviewText)}">${escapeHtml(reviewIssues.length ? '待确认' : validation)}</span><small>证据 ${escapeHtml(confidence)}</small><button class="nmda-btn nmda-btn-tiny" type="button" data-import-edit="${escapeHtml(task.editKey)}">${reviewIssues.length ? '处理异常' : '抽查'}</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="7">还没有生成邮件任务。</td></tr>';
    if (tasks.length > sample.length) importPreviewBodyEl.insertAdjacentHTML('beforeend', `<tr><td colspan="7">当前仅显示 ${sample.length}/${tasks.length} 条。点击“展开全部抽查”查看更多。</td></tr>`);
    importPreviewBodyEl.querySelectorAll('[data-import-edit]').forEach(button=>button.addEventListener('click',()=>{
      const task=batch.tasks.find(t=>t.editKey===button.dataset.importEdit); if(task)openImportTaskEditor(task);
    }));
    renderReviewQueue(importEditorOverlayEl?.dataset.editKey||'');
  }

  function openImportTaskEditor(task) {
    if (!task || !importEditorOverlayEl) return;
    importEditorOverlayEl.dataset.editKey=task.editKey;
    importEditRecipientsEl.value=task.recipients||'';
    importEditSubjectEl.value=task.subject||'';
    importEditBodyEl.value=task.body||'';
    importEditAttachmentsEl.value=(task.attachmentRefs||[]).join('; ');
    importEditScheduleEl.value=task.scheduleAt||'';
    importEditTagsEl.value=(task.tags||[]).join('; ');
    const issues=unresolvedImportIssues(task);
    const evidence=(task.importEvidence||[]).join(' + ')||'来源字段';
    importEditorEvidenceEl.textContent=`${task.id || task.collectionName || '邮件'} · ${task.importConfidence ? `证据 ${Math.round(task.importConfidence)}% · ` : ''}${evidence}${issues.length ? ` · ${issues.join('、')}` : ' · 核心信息完整，可确认或修改'}`;
    if(reviewFeedbackEl){reviewFeedbackEl.hidden=true;reviewFeedbackEl.textContent='';}
    updateReviewFieldStates(task);
    renderReviewSource(task);
    importEditorOverlayEl.hidden=false;
    renderReviewQueue(task.editKey);
    setTimeout(()=>{
      if(issues.some(x=>/收件人|邮箱/.test(x)))importEditRecipientsEl?.focus();
      else if(issues.some(x=>/主题|Subject/.test(x)))importEditSubjectEl?.focus();
      else if(issues.some(x=>/正文|称呼|落款|边界/.test(x)))importEditBodyEl?.focus();
    },0);
  }

  function closeImportTaskEditor(){
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
    setTaskEdit(task,{
      recipients,subject,body,attachments:importEditAttachmentsEl.value.trim(),scheduleAt:importEditScheduleEl.value,tags:importEditTagsEl.value,
      reviewConfirmed:coreValid, rosterConfirmed: coreValid && !!(task.rosterIssues||[]).length ? true : (batch.taskEdits.get(key)?.rosterConfirmed||false)
    });
    rebuildTasks();
    const current=(batch.tasks||[]).find(t=>t.editKey===key);
    if(current && taskNeedsImportReview(current)){
      if(reviewFeedbackEl){reviewFeedbackEl.hidden=false;reviewFeedbackEl.textContent=`仍需处理：${unresolvedImportIssues(current).join('；')}`;}
      openImportTaskEditor(current); return;
    }
    if(!goNext){closeImportTaskEditor();return;}
    const next=reviewTasks()[0];
    if(next)openImportTaskEditor(next);else closeImportTaskEditor();
  }

  async function excludeCurrentReviewTask() {
    batch.handoffComplete=false;
    const key=importEditorOverlayEl?.dataset.editKey; if(!key)return;
    const task=(batch.tasks||[]).find(t=>t.editKey===key); if(!task)return;
    setTaskEdit(task,{importExcluded:true});
    rebuildTasks();
    const next=reviewTasks()[0];
    if(next)openImportTaskEditor(next);else closeImportTaskEditor();
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
      await persistContacts();
      if (!isCurrentBatchSession(sessionToken)) return added;
      renderContacts();
      if (batch.dataset) rebuildTasks();
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
      task.school,
      task.subject,
      task.body,
      task.files?.map(file => file.name).join(' '),
      task.scheduleAt ? task.scheduleAt.replace('T', ' ') : '',
      contactStateForRecipients(task.recipients).stages.join(' '),
      contactStateForRecipients(task.recipients).followUp ? '待跟进' : '',
      taskBusinessTags(task).join(' '),
      statusLabel(task)
    ].join(' '));
    return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
  }

  function normalizedTagSet(tags) {
    return new Set((Contacts?.parseTags?.(tags) || []).map(tag => tag.toLocaleLowerCase('zh-CN')));
  }

  function taskMatchesTagFilter(task) {
    if (!taskMatchesSearch(task)) return false;
    const stageFilter=String(batchStageFilterEl?.value || '').trim();
    const state=contactStateForRecipients(task.recipients);
    if(stageFilter && !state.stages.includes(stageFilter)) return false;
    const own = normalizedTagSet(taskBusinessTags(task));
    const include = Contacts?.parseTags?.(batchTagIncludeEl?.value || '') || [];
    const includeKeys = include.map(tag => tag.toLocaleLowerCase('zh-CN'));
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
    if (patch.enabled != null || patch.school != null || patch.scheduleAt != null) batch.schedulePlan = null;
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
    mappingToggleEl.textContent = isOpen ? '收起字段映射' : '展开字段映射';
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
      ? `系统不依赖 Word/表格结构，按 Subject / 称呼 / 正文 / 落款 / 邮箱证据识别邮件帧${mailScan ? `（${mailScan.records || 0} 条，平均 ${mailScan.averageConfidence || 0}%）` : ''}`
      : originWord ? '系统已将来源内容标准化为邮件记录' : `系统在来源内容第 ${batch.detection.index + 1} 行识别到记录字段`;
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
        if(match.status==='ambiguous')task.rosterIssues.push('总名单匹配存在多个候选，需要确认身份');
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
      if(summary)summary.innerHTML=`<div class="nmda-import-metric"><strong>${state.entries.length}</strong><span>总名单记录</span></div>`;
      if(note)note.textContent='总名单已载入。继续导入实际邮件后，系统会进行身份对齐与覆盖核验。';
      if(details)details.innerHTML='';
      return;
    }
    const x=audit.summary;
    if(summary)summary.innerHTML=`<div class="nmda-import-metric"><strong>${x.roster}</strong><span>总名单</span></div><div class="nmda-import-metric"><strong>${x.tasks}</strong><span>已撰写邮件</span></div><div class="nmda-import-metric"><strong>${x.matched}</strong><span>已对齐</span></div><div class="nmda-import-metric"><strong>${x.unwritten}</strong><span>名单未撰写</span></div><div class="nmda-import-metric ${x.offRoster?'is-warn':''}"><strong>${x.offRoster}</strong><span>名单外邮件</span></div><div class="nmda-import-metric ${(x.ambiguous+x.conflicts+x.duplicates)?'is-warn':''}"><strong>${x.ambiguous+x.conflicts+x.duplicates}</strong><span>需核验差异</span></div>`;
    if(note)note.innerHTML=`数量不要求相等：总名单是候选池，实际邮件只是当前已撰写子集。已用总名单自动补充 <strong>${x.schoolSupplements}</strong> 条空缺院校信息${x.emailCandidates?`；为 <strong>${x.emailCandidates}</strong> 条缺邮箱邮件提供可信候选`:''}。名单未撰写只表示“尚未进入邮件执行层”，不会被当成错误。`;
    if(details){
      const off=(audit.matches||[]).filter(m=>m.status==='off-roster').slice(0,12);
      const conflicts=(audit.matches||[]).filter(m=>m.status==='conflict'||m.status==='ambiguous').slice(0,12);
      const unwritten=(audit.unwritten||[]).slice(0,12);
      const dups=(audit.duplicateMatches||[]).slice(0,8);
      const section=(title,items,render,more=0)=>`<div class="nmda-roster-diff-section"><strong>${escapeHtml(title)}</strong>${items.length?`<div>${items.map(render).join('')}</div>`:'<small>无</small>'}${more>items.length?`<small>另有 ${more-items.length} 条未展开</small>`:''}</div>`;
      details.innerHTML=
        section('总名单尚未撰写',unwritten,e=>`<span>${escapeHtml(rosterEntryLabel(e))}${e.batch?` · ${escapeHtml(e.batch)}`:''}</span>`,audit.unwritten?.length||0)+
        section('当前邮件不在总名单',off,m=>`<span>${escapeHtml(m.task?.id||m.task?.recipients||'邮件')} · ${escapeHtml(m.task?.recipients||'')}</span>`,(audit.matches||[]).filter(m=>m.status==='off-roster').length)+
        section('身份 / 院校冲突',conflicts,m=>`<span>${escapeHtml(m.task?.id||'邮件')} → ${escapeHtml(m.status==='ambiguous'?'多个总名单候选':rosterEntryLabel(m.entry))}</span>`,(audit.matches||[]).filter(m=>m.status==='conflict'||m.status==='ambiguous').length)+
        section('疑似重复撰写',dups,d=>`<span>${escapeHtml(rosterEntryLabel(d.entry))} · ${d.matches?.length||0} 封邮件</span>`,audit.duplicateMatches?.length||0);
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
      if(!parsed.entries.length)throw new Error('没有识别到可用于核验的导师记录。总名单至少应包含导师姓名、邮箱或学校中的一项。');
      for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
      batch.handoffComplete=false;
      batch.roster={...rosterState(),dataset,entries:parsed.entries,warnings:parsed.warnings||[],sourceNames:list.map(f=>f.name),audit:null};
      const remove=$('nmda-roster-remove');if(remove)remove.hidden=false;
      if(status)status.textContent=`已载入 ${parsed.stats.total} 条总名单记录 · 邮箱 ${parsed.stats.withEmail} · 院校 ${parsed.stats.withSchool}${parsed.stats.duplicates?` · 重复 ${parsed.stats.duplicates}`:''}`;
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
          if (collection.meta?.mailFrames) errors.push('缺少收件人，需要人工确认');
          else warnings.push('无收件人');
        }
        else if (!recipientLooksValid(recipients)) errors.push('收件人邮箱格式无效，需要人工确认');
        if (collection.meta?.mailFrames && !subject) errors.push('缺少主题，需要人工确认');
        if (collection.meta?.mailFrames && !String(body||'').trim()) errors.push('缺少正文，需要人工确认');
        if (collection.meta?.mailFrames && importConfidence && importConfidence < 70) warnings.push(`邮件证据识别置信度 ${Math.round(importConfidence)}%`);
        for (const issue of importIssues) {
          if (/未定位收件人/.test(issue) && recipients) continue;
          if (/主题为空/.test(issue) && subject) continue;
          if (/正文过短/.test(issue) && body.length >= 40) continue;
          if (!errors.includes(issue) && !warnings.includes(issue)) warnings.push(issue);
        }
        let scheduleAt = '';
        if (String(scheduleRaw ?? '').trim()) {
          const parsed = Importer.parseDateValue(scheduleRaw);
          if (!parsed) errors.push(`定时时间无法识别：${scheduleRaw}`);
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
        tasks.push({
          id, rowIndex, collectionIndex, collectionName: collection.name || `内容集合 ${collectionIndex + 1}`, sourceFile: rowMeta?.sourceFile || collection.source || '',
          editKey, sourceRow: rowIndex + 1, recipients, school, schoolSource: edit.school != null ? 'manual' : (sourceSchool ? (collection.meta?.mailFrames ? 'recognized' : 'imported') : ''), subject, body, attachmentRefs,
          tags: importedTags,
          enabled: policyBlocked ? false : edit.enabled !== false,
          policyBlocked, policyReasons: gate.reasons,
          files: mergeTaskFiles(resolved.files), tableFiles: resolved.files, attachmentDetails: resolved.details,
          scheduleAt, scheduleSource, scheduleReason:String(edit.scheduleReason||''), errors:[...new Set(errors)], warnings:[...new Set(warnings)], status: errors.length ? 'error' : 'ready', runtimeError: '', note: '',
          importConfidence, importEvidence:[...(rowMeta?.evidence || [])], importIssues, importHeading:rowMeta?.heading || '', importRecipientEvidence:rowMeta?.recipientEvidence || null,
          reviewConfirmed: !!edit.reviewConfirmed, rosterConfirmed: !!edit.rosterConfirmed, importExcluded:false,
          manuallyEdited: ['recipients','school','subject','body','attachments','scheduleAt','tags'].some(key=>edit[key]!=null)
        });
      }
    }
    applyRosterCrossCheck(tasks);
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
    const hint=$('nmda-handoff-hint');
    const hasDataset = !!batch.dataset;
    if (!card || !summary || !button) return;
    card.hidden = !hasDataset;
    if (!hasDataset) return;
    const tasks = batch.tasks || [];
    const ready = tasks.filter(task => task.status === 'ready').length;
    const scheduled = tasks.filter(task => !!task.scheduleAt).length;
    const review = tasks.filter(taskNeedsImportReview).length;
    const stats = importAttachmentStats();
    const excluded=excludedImportCount();
    const blockerTasks=tasks.filter(task=>taskNeedsImportReview(task)||(task.errors||[]).some(error=>!/联系策略/.test(error)));
    const blockers=new Set(blockerTasks.map(task=>task.editKey));
    summary.innerHTML = `<div class="nmda-import-metric"><strong>${tasks.length}</strong><span>保留任务</span></div><div class="nmda-import-metric"><strong>${ready}</strong><span>预检可用</span></div><div class="nmda-import-metric"><strong>${scheduled}</strong><span>定时任务</span></div><div class="nmda-import-metric ${review ? 'is-warn' : ''}"><strong>${review}</strong><span>核心信息待确认</span></div><div class="nmda-import-metric ${stats.issues ? 'is-warn' : ''}"><strong>${stats.issues}</strong><span>附件待确认</span></div>${excluded?`<div class="nmda-import-metric"><strong>${excluded}</strong><span>已人工排除</span></div>`:''}`;
    const blocked=blockers.size>0||stats.issues>0;
    button.textContent = !tasks.length ? '暂无可交接任务' : blocked ? `先处理 ${Math.max(blockers.size,review)+stats.issues} 个问题` : batch.handoffComplete ? `返回批量任务（${tasks.length}）` : `进入批量任务（${tasks.length}）`;
    button.disabled = !tasks.length || blocked;
    if(hint) hint.textContent=blocked?'为了避免把不完整邮件带入执行阶段，待确认核心信息和附件问题必须先处理或明确排除。':batch.handoffComplete?'当前批次已经交接；如修改核心邮件信息或字段映射，需要重新完成交接。':'当前批次已通过摄取校验，可以安全交给批量任务工作台。';
  }


  function scheduleSourceLabel(task) {
    const source=String(task?.scheduleSource||'');
    if(source==='auto')return '自动排程';
    if(source==='manual'||source==='manual-clear')return '手工调整';
    if(source==='imported')return '导入时间';
    return task?.scheduleAt?'已有时间':'未定时';
  }

  function renderScheduleCenter() {
    const card=$('nmda-scheduler-card'); if(!card)return;
    const tasks=batch.tasks||[], hasTasks=batch.handoffComplete&&tasks.length>0;
    card.hidden=!hasTasks; if(!hasTasks)return;
    if(!Scheduler){if(scheduleRulePreviewEl)scheduleRulePreviewEl.textContent='排程引擎未加载。';if(scheduleApplyEl)scheduleApplyEl.disabled=true;return;}
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
      const fallbackText=fallback?`；${fallback} 封缺少明确学校：机构邮箱按域名归组，公共邮箱保持独立并建议人工补学校`:'；学校信息已覆盖当前已选任务';
      const conflictText=conflictCount?`；当前已有时间存在 ${conflictCount} 个同校轮次冲突，可手工调整或关闭“保留已有定时”后重排`:'';
      scheduleRulePreviewEl.textContent=`规则：同校每轮最多 ${rules.maxPerGroupPerRound||1} 位 → 下一轮 ${rules.intervalDays||7} 天后${fallbackText}${conflictText}。`;
    }
    if(scheduleApplyEl){scheduleApplyEl.disabled=batch.running||!selected.length;scheduleApplyEl.textContent=auto||unscheduled?'生成 / 更新排程':'重新生成排程';}
    if(scheduleClearEl)scheduleClearEl.disabled=batch.running||!tasks.some(t=>t.scheduleSource==='auto'&&t.scheduleAt);
  }

  function applySmartSchedule() {
    if(!Scheduler){setBatchStatus('排程引擎未加载。','error');return;}
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
      const fallback=s.fallbackGroups?`；${s.fallbackGroups} 个分组使用邮箱域名兜底`:'';
      const conflict=audit.conflicts?.length?`；保留的已有时间仍有 ${audit.conflicts.length} 个规则冲突，请手工调整或关闭“保留已有定时”后重排`:'';
      setBatchStatus(`排程完成：${s.selected} 封任务，${s.groups} 个学校/分组，自动安排 ${s.auto} 封，保留已有 ${s.preserved} 封，共 ${s.rounds} 轮${fallback}${conflict}。`,audit.conflicts?.length?'warn':'ok');
    }catch(error){setBatchStatus(`排程失败：${error.message}`,'error');}
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

  function renderPreview() {
    const tasks = batch.tasks || [];
    const matched = filteredBatchTasks();
    const errors = tasks.filter(t => t.status === 'error').length;
    const done = tasks.filter(t => t.status === 'done').length;
    const selectedReadyTasks = tasks.filter(t => t.enabled && t.status === 'ready');
    const selectedReady = selectedReadyTasks.length;
    const selectedScheduled = selectedReadyTasks.filter(t=>!!t.scheduleAt).length;
    const selectedTotal = tasks.filter(t => t.enabled && t.status !== 'done').length;
    const unselected = tasks.filter(t => !t.enabled).length;
    const matchedSelected = matched.filter(t => t.enabled).length;
    const summaryParts=[`<strong>${tasks.length}</strong> 封`,`当前 ${matched.length}`,`已选 <strong>${selectedTotal}</strong>`,`可创建 <strong>${selectedReady}</strong>`];
    if(selectedScheduled)summaryParts.push(`定时 ${selectedScheduled}`);
    if(errors)summaryParts.push(`<span class="nmda-danger">异常 ${errors}</span>`);
    if(done)summaryParts.push(`已完成 ${done}`);
    batchSummaryEl.innerHTML=summaryParts.join(' · ');
    if (batchStartEl) batchStartEl.textContent = selectedReady ? `创建 ${selectedReady} 封草稿` : '创建所选草稿';
    previewBodyEl.innerHTML = matched.slice(0, 150).map(task => {
      const contactState=contactStateForRecipients(task.recipients);
      const businessTags=taskBusinessTags(task);
      const visibleTags=businessTags.slice(0,2);
      const markHtml=visibleTags.map(value=>`<span class="nmda-business-mark" title="${escapeHtml(value)}">${escapeHtml(value)}</span>`).join('') + (businessTags.length>2?`<span class="nmda-more-mark">+${businessTags.length-2}</span>`:'');
      const stateHtml=`<div class="nmda-contact-state-line"><span class="nmda-state-pill" data-stage="${escapeHtml(contactState.stage)}">${escapeHtml(contactState.stage)}</span>${contactState.followUp?'<span class="nmda-state-pill is-followup">待跟进</span>':''}</div>`;
      const group = Scheduler?.groupForTask?.(task) || {label:task.school||'未识别学校',source:task.school?'school':'unknown'};
      const groupSourceLabel = group.source === 'domain' ? '域名兜底' : group.source === 'manual' ? '手工' : group.source === 'roster' ? '总名单补全' : group.source === 'recognized' ? 'Word识别' : group.source === 'imported' ? '导入' : (task.school ? '学校' : '待确认');
      const rosterHint=[task.rosterMeta?.batch,task.rosterMeta?.priority,task.rosterMeta?.status].filter(Boolean).join(' · ');
      const schoolHtml = `<div class="nmda-school-cell"><input data-task-school="${escapeHtml(task.editKey)}" value="${escapeHtml(task.school||'')}" placeholder="学校 / 机构" ${batch.running?'disabled':''}><small title="${escapeHtml(group.label + (rosterHint?` · 总名单：${rosterHint}`:''))}">${escapeHtml(task.school ? groupSourceLabel : group.label)}</small></div>`;
      const sourceLabel=scheduleSourceLabel(task);
      const scheduleHtml = `<div class="nmda-schedule-edit-cell"><input type="datetime-local" data-task-schedule="${escapeHtml(task.editKey)}" value="${escapeHtml(task.scheduleAt||'')}" ${batch.running?'disabled':''}><small title="${escapeHtml(task.scheduleReason||sourceLabel)}">${escapeHtml(sourceLabel)}${task.scheduleReason?` · ${escapeHtml(task.scheduleReason)}`:''}</small></div>`;
      return `
      <tr data-status="${task.status}" data-enabled="${task.enabled ? '1' : '0'}">
        <td><input type="checkbox" data-task-enabled="${escapeHtml(task.editKey)}" ${task.enabled ? 'checked' : ''} ${batch.running || task.policyBlocked || task.status === 'running' || task.status === 'done' ? 'disabled' : ''} title="${escapeHtml(task.policyBlocked ? statusLabel(task) : '')}"></td>
        <td>${escapeHtml(task.id)}</td>
        <td title="${escapeHtml(task.recipients)}">${escapeHtml(task.recipients || '—')}</td>
        <td>${schoolHtml}</td>
        <td class="nmda-contact-task-cell" title="联系状态：${escapeHtml(contactState.stages.join(' / '))}${businessTags.length?`；业务标记：${escapeHtml(tagsText(businessTags))}`:''}">${stateHtml}<div class="nmda-business-mark-line">${markHtml || '<span class="nmda-hint">无业务标记</span>'}</div><input class="nmda-task-tags-input nmda-quiet-input" data-task-tags="${escapeHtml(task.editKey)}" value="${escapeHtml(tagsText(task.tags))}" placeholder="添加任务标记" ${batch.running ? 'disabled' : ''}></td>
        <td>${scheduleHtml}</td>
        <td title="${escapeHtml(task.subject)}">${escapeHtml(task.subject || '—')}</td>
        <td title="${escapeHtml(task.files.map(file => file.name).join('；'))}">${task.files.length}</td>
        <td title="${escapeHtml(statusLabel(task))}">${escapeHtml(statusLabel(task))}</td>
      </tr>`;
    }).join('');
    if (!matched.length) previewBodyEl.innerHTML = '<tr><td colspan="9">当前检索/筛选条件没有匹配任务。清除条件或调整关键词。</td></tr>';
    else if (matched.length > 150) previewBodyEl.insertAdjacentHTML('beforeend', `<tr><td colspan="9">仅显示前 150 行，当前结果实际有 ${matched.length} 行。</td></tr>`);
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
    previewBodyEl.querySelectorAll('[data-task-school]').forEach(input => input.addEventListener('change', () => {
      const task=batch.tasks.find(item=>item.editKey===input.dataset.taskSchool); if(!task)return;
      setTaskEdit(task,{school:input.value}); batch.schedulePlan=null; rebuildTasks();
    }));
    previewBodyEl.querySelectorAll('[data-task-schedule]').forEach(input => input.addEventListener('change', () => {
      const task=batch.tasks.find(item=>item.editKey===input.dataset.taskSchedule); if(!task)return;
      const value=input.value||'';
      setTaskEdit(task,{scheduleAt:value,scheduleSource:value?'manual':'manual-clear',scheduleReason:value?'手工调整':''}); batch.schedulePlan=null; rebuildTasks();
    }));
    const hasTasks = batch.handoffComplete && tasks.length > 0;
    const emptyCard=$('nmda-batch-empty');
    if(emptyCard){
      const kicker=emptyCard.querySelector('.nmda-card-kicker'), title=emptyCard.querySelector('.nmda-card-title'), desc=emptyCard.querySelector('.nmda-card-desc'), action=$('nmda-go-import');
      if(tasks.length && !batch.handoffComplete){
        if(kicker)kicker.textContent='待交接'; if(title)title.textContent=`已识别 ${tasks.length} 封邮件，尚未进入批量任务`;
        if(desc)desc.textContent='返回导入任务完成必要校验并点击“进入批量任务”。临时识别结果不会直接进入执行阶段。'; if(action)action.textContent='返回完成导入';
      }else{
        if(kicker)kicker.textContent='批量任务'; if(title)title.textContent='尚无可管理任务';
        if(desc)desc.textContent='先在导入任务中载入来源、处理必要问题并完成交接。'; if(action)action.textContent='前往导入任务';
      }
    }
    $('nmda-preview-card').hidden = !hasTasks;
    $('nmda-scheduler-card').hidden = !hasTasks;
    $('nmda-run-card').hidden = !hasTasks;
    $('nmda-batch-empty').hidden = hasTasks;
    batchStartEl.disabled = batch.running || !batch.handoffComplete || !tasks.some(t => t.enabled && t.status === 'ready');
    renderTagChips();
    renderScheduleCenter();
    renderAttachmentCenter();
    renderImportTaskPreview();
    renderRosterAudit();
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

  async function applyImportedDataset(dataset, label = '数据', sessionToken = batch.sessionId) {
    if (!isCurrentBatchSession(sessionToken)) return false;
    batch.dataset = dataset;
    batch.handoffComplete = false;
    batch.importMeta = dataset?.meta || null;
    batch.collectionConfigs.clear();
    batch.taskEdits.clear();
    batch.importPreviewExpanded=false;
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
    $('nmda-import-preview-card').hidden = false;
    $('nmda-attachments-card').hidden = false;
    renderSourceInventory();
    configureCollection(best.index, false);
    refreshFileIndex(false);
    if (!isCurrentBatchSession(sessionToken)) return false;
    const warningText = dataset.warnings?.length ? `；${dataset.warnings.length} 条解析警告` : '';
    const embeddedText = dataset.embeddedFiles?.length ? `；自动载入 ${dataset.embeddedFiles.length} 个包内附件` : '';
    const formatText = dataset.format ? `；${formatDisplayName(dataset.format)}` : '';
    $('nmda-import-format-info').textContent = `已载入 ${dataset.sourceFiles?.length || 1} 个数据源，提取 ${sets.length} 个内容集合${formatText}${embeddedText}${warningText}。`;
    const selected = sets[best.index];
    const includedCount = [...batch.collectionConfigs.values()].filter(config => config.enabled).length;
    setImportStatus(`解析完成：${label}；提取 ${sets.length} 个内容集合，自动纳入 ${includedCount} 个；当前检查“${selected?.name || '内容集合'}”${warningText}。`, dataset.warnings?.length ? 'warn' : 'ok');
    renderImportLifecycleState();
    setBatchStatus(`已导入 ${batch.tasks.length} 封任务。进入批量任务后再选择需要创建的草稿。`, 'ok');
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
    batch.fileIndex = Importer.buildFileIndex([]);
    batch.profileSuggestion = null;
    batch.importPreviewExpanded = false;
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

    ['nmda-structure-card','nmda-mapping-card','nmda-ingest-diagnostics','nmda-ingest-result-card','nmda-roster-audit-card','nmda-import-preview-card','nmda-attachments-card','nmda-import-handoff-card','nmda-preview-card','nmda-scheduler-card','nmda-run-card'].forEach(id => {
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
    if (importPreviewBodyEl) importPreviewBodyEl.innerHTML = '';
    if (importPreviewSummaryEl) importPreviewSummaryEl.innerHTML = '';
    if (reviewQueueEl) reviewQueueEl.innerHTML = '';
    if (reviewSourceContextEl) reviewSourceContextEl.innerHTML = '';
    if (reviewSourceMetaEl) reviewSourceMetaEl.innerHTML = '';
    if (reviewCandidatesEl) reviewCandidatesEl.innerHTML = '';
    if (reviewProgressEl) reviewProgressEl.textContent = '';
    const reviewGuide = $('nmda-review-guidance'); if (reviewGuide) reviewGuide.textContent = '载入来源后，系统会把自动通过与待确认邮件分开。';
    const reviewBtn = $('nmda-review-import-issues'); if (reviewBtn) { reviewBtn.hidden = true; reviewBtn.textContent = '处理待确认'; }
    const bulkSubjectBtn = $('nmda-bulk-subject-open'); if (bulkSubjectBtn) { bulkSubjectBtn.hidden = true; bulkSubjectBtn.textContent = '批量补主题'; }
    if (bulkSubjectPanelEl) bulkSubjectPanelEl.hidden = true;
    if (bulkSubjectValueEl) bulkSubjectValueEl.value = '';
    const restoreBtn = $('nmda-restore-excluded'); if (restoreBtn) restoreBtn.hidden = true;
    const fileInfo = $('nmda-file-index-info'); if (fileInfo) fileInfo.textContent = '尚未选择本地附件。';
    const attachmentSummary = $('nmda-attachment-summary'); if (attachmentSummary) attachmentSummary.textContent = '解析出任务后会统计需要匹配的附件。';
    const attachmentResolution = $('nmda-attachment-resolution'); if (attachmentResolution) attachmentResolution.hidden = true;
    const attachmentResolutionList = $('nmda-attachment-resolution-list'); if (attachmentResolutionList) attachmentResolutionList.innerHTML = '';
    const readySummary = $('nmda-import-ready-summary'); if (readySummary) readySummary.textContent = '尚未生成任务。';

    $('nmda-batch-empty').hidden = false;
    $('nmda-import-format-info').textContent = '支持 Word、表格、JSON/JSONL、文本、HTML/XML、多文件、目录与 ZIP。';
    const rosterStatus=$('nmda-roster-source-status'); if(rosterStatus)rosterStatus.textContent='尚未载入总套磁名单。';
    const rosterRemove=$('nmda-roster-remove'); if(rosterRemove)rosterRemove.hidden=true;
    const rosterSummary=$('nmda-roster-audit-summary'); if(rosterSummary)rosterSummary.innerHTML='';
    const rosterDetails=$('nmda-roster-audit-details'); if(rosterDetails)rosterDetails.innerHTML='';
    setBatchStatus('请先导入任务。');
    renderImportLifecycleState();
    if (!keepStatus) setImportStatus(message || '尚未载入数据源。');
    renderPreview();
  }

  function clearImportOnError(error, sessionToken = batch.sessionId) {
    if (!isCurrentBatchSession(sessionToken)) return;
    console.error(`[${APP}] import`, error);
    resetImportWorkspace({ keepStatus: true, invalidate: true });
    setImportStatus(`解析失败：${error.message}`, 'error');
  }


  importFileEl.addEventListener('change', async () => {
    const files = [...(importFileEl.files || [])];
    if (!files.length || !Importer) return;
    const token = beginImportSession(`正在解析 ${files.length === 1 ? files[0].name : `${files.length} 个文件`}…`);
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
    const token = beginImportSession(`正在解析 ZIP ${file.name}…`);
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
    if (!text) { setImportStatus('请先粘贴需要解析的数据。', 'warn'); return; }
    const token = beginImportSession('正在识别粘贴内容…');
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
    if (batch.running) { setImportStatus('批量任务正在执行，不能开始新批次。', 'warn'); return; }
    resetImportWorkspace({ message: '当前批次已彻底清空，可以载入新的来源。' });
  });

  $('nmda-go-batch')?.addEventListener('click', async () => {
    const button = $('nmda-go-batch');
    if (!button || button.disabled || !batch.tasks.length) return;
    if(batch.handoffComplete){setWorkbenchTab('batch');setBatchStatus(`当前批次包含 ${batch.tasks.length} 封任务。`, 'ok');return;}
    const token = batch.sessionId;
    button.disabled = true;
    button.textContent = '正在准备批量任务…';
    try {
      await registerCurrentBatchContacts(token);
      if (!isCurrentBatchSession(token)) return;
      batch.handoffComplete = true;
      setWorkbenchTab('batch');
      setBatchStatus(`已接收 ${batch.tasks.length} 封任务。勾选决定实际创建哪些草稿。`, 'ok');
    } finally {
      if (isCurrentBatchSession(token)) renderImportHandoff();
    }
  });

  importReviewBtnEl?.addEventListener('click', () => {
    const task=reviewTasks()[0];
    if(task)openImportTaskEditor(task);
  });
  bulkSubjectOpenEl?.addEventListener('click', () => setBulkSubjectPanel(bulkSubjectPanelEl?.hidden !== false));
  $('nmda-bulk-subject-cancel')?.addEventListener('click', () => setBulkSubjectPanel(false));
  $('nmda-bulk-subject-apply')?.addEventListener('click', applyBulkMissingSubject);
  bulkSubjectValueEl?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyBulkMissingSubject(); } });
  $('nmda-import-editor-close')?.addEventListener('click', closeImportTaskEditor);
  $('nmda-import-editor-cancel')?.addEventListener('click', closeImportTaskEditor);
  $('nmda-import-editor-save')?.addEventListener('click', () => saveImportTaskEditor(false));
  $('nmda-import-editor-next')?.addEventListener('click', () => saveImportTaskEditor(true));
  $('nmda-review-exclude')?.addEventListener('click', excludeCurrentReviewTask);
  [importEditRecipientsEl,importEditSubjectEl,importEditBodyEl].forEach(el=>el?.addEventListener('input',refreshReviewDraftIndicators));
  $('nmda-toggle-import-preview')?.addEventListener('click', () => {
    batch.importPreviewExpanded=!batch.importPreviewExpanded;
    renderImportTaskPreview();
  });
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
      batch.handoffComplete=false;
      renderSemanticSummary(); rebuildTasks();
    }));
    setMappingEditorOpen(true);
    renderSemanticSummary(); rebuildTasks();
    $('nmda-profile-info').textContent = `已应用识别模板“${profile.name}”。请检查语义映射和任务预览。`;
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

  [batchSearchEl, batchTagIncludeEl].forEach(el => el?.addEventListener('input', renderPreview));
  batchStageFilterEl?.addEventListener('change', renderPreview);

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
    if(batchTagIncludeEl)batchTagIncludeEl.value = '';
    if(batchStageFilterEl)batchStageFilterEl.value = '';
    renderPreview();
  });

  $('nmda-contact-search').addEventListener('input', renderContacts);
  $('nmda-contact-class-filter').addEventListener('input', renderContacts);

  async function runMailboxRead(mode = 'quick') {
    const full = mode === 'full';
    const refreshButton = $('nmda-refresh-history');
    const rebuildButton = $('nmda-rebuild-history');
    if (refreshButton) refreshButton.disabled = true;
    if (rebuildButton) rebuildButton.disabled = true;
    setContactStatusMessage(full
      ? '正在完整读取已发送与草稿箱；只有两个文件夹都完整覆盖后才会替换当前邮箱快照…'
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
        const meta = {
          lastMode: 'full', complete: true, lastFullAt: new Date().toISOString(),
          sent: result.coverage?.sent || { read: sentMessages.length, total: sent.total || sentMessages.length, complete: true, pages: sent.pages || 0 },
          drafts: result.coverage?.drafts || { read: draftMessages.length, total: drafts.total || draftMessages.length, complete: true, pages: drafts.pages || 0 }
        };
        const previous = await Contacts.loadSyncMeta(contactBook.account);
        await Contacts.saveSyncMeta(contactBook.account, { ...previous, ...meta });
        await renderMailboxReadMeta({ ...previous, ...meta });
        renderContacts(); renderPreview();
        setContactStatusMessage(`完整重建完成：已发送 ${sentMessages.length} 封、草稿 ${draftMessages.length} 封；重算 ${rebuilt.contactFacts} 个联系人邮箱证据。已回复 / 待跟进 / 暂停 / 不再联系 / 长期标记均保留。${rebuilt.draftsWithoutRecipient ? ` ${rebuilt.draftsWithoutRecipient} 封草稿没有收件人，未关联联系人。` : ''}`, 'ok');
      } else {
        // Quick refresh works on a clone, so a storage failure never leaves a half-applied live state.
        const nextContacts = Contacts.cloneContacts(contactBook.contacts);
        const sentApplied = Contacts.applySentMessages(nextContacts, sentMessages);
        const draftApplied = Contacts.applyDraftMessages(nextContacts, draftMessages, { replaceActive: false });
        await Contacts.save(contactBook.account, nextContacts);
        contactBook.contacts = nextContacts;
        const previous = await Contacts.loadSyncMeta(contactBook.account);
        const meta = {
          ...previous, lastMode: 'quick', complete: false, lastQuickAt: new Date().toISOString(),
          sent: result.coverage?.sent || { read: sentMessages.length, total: sent.total || 0, complete: !!sent.complete, pages: sent.pages || 0 },
          drafts: result.coverage?.drafts || { read: draftMessages.length, total: drafts.total || 0, complete: !!drafts.complete, pages: drafts.pages || 0 }
        };
        await Contacts.saveSyncMeta(contactBook.account, meta);
        await renderMailboxReadMeta(meta);
        renderContacts(); renderPreview();
        setContactStatusMessage(`快速刷新完成：读取已发送 ${sentMessages.length} 封、草稿 ${draftMessages.length} 封；新增发送证据 ${sentApplied.newLinks} 条、草稿证据 ${draftApplied.newLinks} 条。快速刷新不会删除旧快照；需要彻底校准时使用“完整重建”。`, 'ok');
      }
    } catch (error) {
      console.error(`[${APP}] mailbox read ${mode}`, error);
      setContactStatusMessage(`${full ? '完整重建' : '快速刷新'}失败：${error.message}`, 'error');
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
    if (!batch.handoffComplete) { setBatchStatus('当前任务仍处于导入校验阶段，请先完成“进入批量任务”交接。', 'error'); return; }
    const executable = batch.tasks.filter(task => task.enabled && task.status === 'ready');
    if (!executable.length) { setBatchStatus('没有已选择且预检通过的任务。请先在列表中勾选需要创建的草稿。', 'error'); return; }
    const staleScheduled=executable.filter(task=>task.scheduleAt && (Scheduler?.parseLocalDateTime?.(task.scheduleAt)?.getTime()||0) <= Date.now()+60*1000);
    if(staleScheduled.length){setBatchStatus(`有 ${staleScheduled.length} 封已选择任务的定时时间已过。请先在“智能排程”中更新，或手工清空对应定时时间。`,'error');return;}
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
      importFileEl.disabled = false; if (importDirEl) importDirEl.disabled = false; if (importPackageEl) importPackageEl.disabled = false; if (rosterFileEl) rosterFileEl.disabled = false; collectionSelectEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; sharedFilesEl.disabled = false; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=false; });
      setBatchPlanningLocked(false);
      renderPreview();
    }
  });

  restoreFormState();
  renderPreview();
  initContacts();
  console.info(`[${APP}] v1.11.1 loaded`);
})();
