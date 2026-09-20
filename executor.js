(() => {
  'use strict';

  if (window.top !== window) return;

  const APP = 'NetEase Mail Draft Assistant';
  const DEFAULT_TIMEOUT = 10000;
  const Importer = globalThis.NMDAImporter;
  const MailRecognizer = globalThis.NMDAMailRecognizer;
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


  function findReadAction(labels = []) {
    const wanted = labels.map(compactText).filter(Boolean);
    const selectors = 'button,a,[role="button"],li[role="button"],span[role="button"],.nui-btn,.nui-txt-link';
    const candidates = [...document.querySelectorAll(selectors)].filter(visible);
    return candidates.find(el => {
      const text = compactText(el);
      const aria = compactText(el.getAttribute?.('aria-label') || '');
      const title = compactText(el.getAttribute?.('title') || '');
      return wanted.some(label => text === label || aria === label || title === label);
    }) || null;
  }

  async function openNativeMessageContext(messageId, fid = 3) {
    const id = String(messageId || '').trim();
    if (!id) throw new Error('缺少原邮件 message id，无法打开网易原生上下文。');
    const payload = { area:'normal', isThread:false, viewType:'', id, fid:Number(fid || 3) || 3 };
    location.hash = `module=read.ReadModule%7C${encodeURIComponent(JSON.stringify(payload))}`;
    await waitFor(() => {
      const hash = decodeURIComponent(String(location.hash || ''));
      return hash.includes('read.ReadModule') && hash.includes(id) ? true : null;
    }, 6000, 100, '网易邮箱没有切换到原邮件。');
    await sleep(250);
  }

  async function openContextCompose(mode, messageId, fid = 3) {
    const beforeRoot = findComposeRoot();
    const before = composeFingerprint(beforeRoot);
    await openNativeMessageContext(messageId, fid);
    const labels = mode === 'reply' ? ['回复'] : ['转发'];
    const action = await waitFor(() => findReadAction(labels), 10000, 120, `已打开原邮件，但没有找到“${labels[0]}”按钮。`);
    action.click();
    return waitFor(() => {
      const root = findComposeRoot();
      if (!root) return null;
      const now = composeFingerprint(root);
      if (!beforeRoot || !before || (now && now !== before)) return root;
      return root;
    }, 12000, 120, `点击“${labels[0]}”后没有检测到网易原生写信窗口。`);
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


  function composeHasExpectedRecipient(root, raw) {
    const emails = String(raw || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
    if (!emails.length) return true;
    const text = String(root?.innerText || root?.textContent || '').toLowerCase();
    return emails.every(email => text.includes(String(email).toLowerCase()));
  }

  function splitRecipientAddresses(raw) {
    return String(raw || '').split(/[;,，；\n]+/).map(s => s.trim()).filter(Boolean);
  }

  function findAuxRecipientInput(root, label) {
    const target = compactText(label);
    const candidates = [...root.querySelectorAll('input,textarea,[contenteditable="true"]')];
    return candidates.find(el => {
      const aria = compactText(el.getAttribute?.('aria-label') || '');
      const title = compactText(el.getAttribute?.('title') || '');
      return visible(el) && (aria.includes(target) || title.includes(target));
    }) || null;
  }

  function findComposeLink(root, label) {
    const target = compactText(label);
    return [...root.querySelectorAll('a,[role="button"],button,.nui-txt-link')]
      .filter(visible)
      .find(el => compactText(el) === target || compactText(el.getAttribute('title') || '') === target) || null;
  }

  async function setAuxRecipients(root, raw, label) {
    const addresses = splitRecipientAddresses(raw);
    if (!addresses.length) return;
    let input = findAuxRecipientInput(root, label);
    if (!input) {
      const link = findComposeLink(root, label);
      if (!link) throw new Error(`原草稿含${label}，但当前网易写信页没有找到“${label}”入口。为避免丢失收件信息，已停止。`);
      link.click();
      input = await waitFor(() => findAuxRecipientInput(root, label), 5000, 100, `已点击“${label}”，但没有出现${label}输入框。`);
    }
    input.focus();
    nativeSetValue(input, `${addresses.join(';')};`);
    fire(input, 'input');
    fire(input, 'change');
    await sleep(100);
    fire(input, 'blur');
    await sleep(250);
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

  async function setBody(root, bodyText, bodyHtml = '', bodyIsHtml = false) {
    const iframe = await waitFor(() => findEditorIframe(root), 8000, 120, '未找到正文编辑器 iframe。');
    const body = await waitFor(() => {
      try { return iframe.contentDocument?.body || null; } catch (_) { return null; }
    }, 8000, 120, '无法访问正文编辑器内容。');
    body.focus();
    // Drafts imported from the mailbox already contain NetEase-sanitized HTML.
    // Preserve that representation unless the user edited the plain-text body in
    // the workbench; ordinary file imports continue through the plain-text path.
    if (bodyIsHtml && String(bodyHtml || '').trim()) body.innerHTML = String(bodyHtml);
    else body.innerHTML = plainTextToHtml(bodyText || '');
    fire(body, 'input'); fire(body, 'change'); fire(body, 'blur');
  }


  async function prependBody(root, bodyText, bodyHtml = '', bodyIsHtml = false) {
    const iframe = await waitFor(() => findEditorIframe(root), 8000, 120, '未找到正文编辑器 iframe。');
    const body = await waitFor(() => {
      try { return iframe.contentDocument?.body || null; } catch (_) { return null; }
    }, 8000, 120, '无法访问正文编辑器内容。');
    const html = bodyIsHtml && String(bodyHtml || '').trim() ? String(bodyHtml) : plainTextToHtml(bodyText || '');
    if (!String(html || '').trim()) return;
    body.focus();
    const wrapper = body.ownerDocument.createElement('div');
    wrapper.setAttribute('data-nmda-followup', '1');
    wrapper.innerHTML = `${html}<div><br></div>`;
    body.insertBefore(wrapper, body.firstChild || null);
    fire(body, 'input'); fire(body, 'change'); fire(body, 'blur');
  }

  function findComposeOption(root, label) {
    const target = compactText(label);
    return [...root.querySelectorAll('[role="checkbox"],.nui-chk')]
      .filter(visible)
      .find(el => compactText(el).includes(target) || compactText(el.getAttribute('aria-label') || '').includes(target) || compactText(el.getAttribute('title') || '').includes(target)) || null;
  }

  async function ensureMoreOptions(root) {
    const existing = findComposeLink(root, '更多选项');
    if (existing) {
      existing.click();
      await sleep(150);
    }
  }

  async function enableComposeOption(root, label, enabled) {
    if (!enabled) return;
    let option = findComposeOption(root, label);
    if (!option) {
      await ensureMoreOptions(root);
      option = await waitFor(() => findComposeOption(root, label), 3000, 100, `原草稿启用了“${label}”，但当前页面无法定位该选项。`);
    }
    const checked = option.getAttribute('aria-checked') === 'true'
      || option.classList.contains('nui-chk-checked')
      || !!option.querySelector('.nui-ico-checkbox-checked,.nui-ico-checkbox-checked2');
    if (!checked) {
      option.click();
      await sleep(120);
    }
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

  function attachmentFileSignature(file) {
    return {
      name: String(file?.name || ''),
      size: Number(file?.size || 0),
      lastModified: Number(file?.lastModified || 0)
    };
  }

  function normalizedAttachmentName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function attachmentModelMatchesFile(item, file) {
    if (!item || !file) return false;
    const expected = attachmentFileSignature(file);
    const names = [item.name, item.blobName].map(normalizedAttachmentName).filter(Boolean);
    if (!names.includes(normalizedAttachmentName(expected.name))) return false;
    const modelSize = Number(item.blobSize || item.size || 0);
    if (expected.size > 0 && modelSize > 0 && modelSize !== expected.size) return false;
    if (expected.lastModified > 0 && Number(item.blobLastModified || 0) > 0 && Number(item.blobLastModified) !== expected.lastModified) return false;
    return true;
  }

  function attachmentStateLabel(state) {
    return ({
      select:'已加入队列', hash:'正在校验', wait:'等待上传', upload:'正在上传', fast:'快速上传',
      pause:'已暂停', success:'上传完成', link:'上传完成', error:'上传失败'
    })[String(state || '')] || String(state || '未知状态');
  }

  async function readComposeAttachmentState(identity) {
    const result = await chrome.runtime.sendMessage({ type:'NMDA_COMPOSE_ATTACHMENT_STATE', identity: identity || {} });
    if (!result?.ok) throw new Error(`无法读取网易附件状态：${result?.reason || 'unknown'}`);
    return result;
  }

  function findAttachmentModelItem(state, file) {
    const items = Array.isArray(state?.items) ? state.items : [];
    // Only local-upload object types can satisfy an expected SmartMail file. Existing
    // forwarded/storage attachments with the same filename must never suppress a new upload.
    const localTypes = new Set(['native','form','plugin']);
    const candidates = items.filter(item => localTypes.has(String(item.type || '')) && attachmentModelMatchesFile(item, file));
    if (!candidates.length) return null;
    return candidates.find(item => !item.context) || candidates[0];
  }

  async function injectFileIntoInput(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    try { input.files = dt.files; }
    catch (error) { throw new Error(`无法把附件交给网易上传控件：${error.message}`); }
    const assigned = [...(input.files || [])];
    if (assigned.length !== 1 || assigned[0]?.name !== file.name || Number(assigned[0]?.size || 0) !== Number(file.size || 0)) {
      throw new Error(`网易附件控件没有完整接收文件：${file.name}`);
    }
    fire(input, 'input');
    fire(input, 'change');
  }

  async function waitForAttachmentRegistration(identity, file, timeout = 6500) {
    const started = Date.now();
    let lastState = null;
    while (Date.now() - started < timeout) {
      lastState = await readComposeAttachmentState(identity);
      const item = findAttachmentModelItem(lastState, file);
      if (item) return { state:lastState, item };
      await sleep(120);
    }
    throw new Error(`网易没有把附件加入上传队列：${file.name}`);
  }

  async function waitForAttachmentsCommitted(identity, files, onProgress = () => {}) {
    const expected = uniqueFiles(files);
    if (!expected.length) return { verified:true, missing:[], mode:'none', states:[] };
    const started = Date.now();
    const absoluteLimit = 15 * 60 * 1000;
    const idleLimit = 30000;
    let lastActivityAt = Date.now();
    let lastFingerprint = '';
    let lastState = null;

    while (Date.now() - started < absoluteLimit) {
      const state = await readComposeAttachmentState(identity);
      lastState = state;
      const matched = expected.map(file => ({ file, item:findAttachmentModelItem(state, file) }));
      const missing = matched.filter(entry => !entry.item).map(entry => entry.file);
      if (missing.length) throw new Error(`网易附件队列缺少：${missing.map(file => file.name).join('、')}`);

      const errors = matched.filter(entry => entry.item?.state === 'error');
      if (errors.length) {
        throw new Error(`附件上传失败：${errors.map(entry => `${entry.file.name}${entry.item.err ? `（${entry.item.err}）` : ''}`).join('、')}`);
      }

      const committed = matched.filter(entry => ['success','link'].includes(String(entry.item?.state || '')));
      const deferredPost = matched.filter(entry => String(entry.item?.type || '') === 'form' && String(entry.item?.state || '') === 'wait');
      if (committed.length + deferredPost.length === expected.length) {
        return {
          verified:true,
          missing:[],
          mode: deferredPost.length ? 'post-deferred' : 'native-committed',
          states:matched.map(entry => ({ name:entry.file.name, state:entry.item?.state || '', type:entry.item?.type || '', sid:entry.item?.sid || '', fid:entry.item?.fid || '' }))
        };
      }

      const fingerprint = matched.map(entry => [
        entry.file.name,
        entry.item?.state || '',
        Number(entry.item?.bytesLoaded || 0),
        Number(entry.item?.percent ?? -1)
      ].join(':')).join('|');
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        lastActivityAt = Date.now();
      } else if (Date.now() - lastActivityAt > idleLimit) {
        const pendingText = matched.filter(entry => !['success','link'].includes(String(entry.item?.state || '')))
          .map(entry => `${entry.file.name}：${attachmentStateLabel(entry.item?.state)}`).join('；');
        throw new Error(`附件上传长时间无进展：${pendingText || '未知状态'}`);
      }

      const active = matched.find(entry => !['success','link'].includes(String(entry.item?.state || '')));
      onProgress(committed.length, expected.length, active?.file?.name || '', {
        registered: expected.length,
        committed: committed.length,
        state: active?.item?.state || '',
        bytesLoaded:Number(active?.item?.bytesLoaded || 0),
        size:Number(active?.item?.size || active?.file?.size || 0)
      });
      await sleep(180);
    }

    const pending = expected.map(file => ({ file, item:findAttachmentModelItem(lastState, file) }))
      .filter(entry => !['success','link'].includes(String(entry.item?.state || '')))
      .map(entry => `${entry.file.name}：${attachmentStateLabel(entry.item?.state)}`);
    throw new Error(`附件上传未完成：${pending.join('；') || '超过安全上限'}`);
  }

  async function addAttachments(root, files, composeIdentity, onProgress = () => {}) {
    const selected = uniqueFiles(files);
    if (!selected.length) return { verified:true, missing:[], mode:'none', states:[] };

    // Do not inject a whole FileList and infer success from visible filenames.
    // NetEase maintains its own upload queue, so register each file explicitly and
    // wait for an acknowledgement from the Compose attachment model before adding the next.
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      const before = await readComposeAttachmentState(composeIdentity);
      if (!findAttachmentModelItem(before, file)) {
        const input = await waitFor(() => findAttachmentInput(root), 8000, 120, '附件上传过程中网易附件控件消失。');
        await injectFileIntoInput(input, file);
        const registered = await waitForAttachmentRegistration(composeIdentity, file);
        if (registered.item?.state === 'error') {
          throw new Error(`附件加入队列后立即失败：${file.name}${registered.item.err ? `（${registered.item.err}）` : ''}`);
        }
      }
      onProgress(0, selected.length, file.name, { registered:i + 1, committed:0, state:'registered' });
    }

    return waitForAttachmentsCommitted(composeIdentity, selected, onProgress);
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



  function bytesFromBase64(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function readRuntimeFile(ref) {
    const id = String(ref?.id || '');
    if (!id) throw new Error('附件运行时引用缺少 id。');
    const meta = await chrome.runtime.sendMessage({ type: 'NMDA_RUNTIME_FILE_META', id });
    if (!meta?.ok) throw new Error(`无法读取附件 ${ref?.name || id}：${meta?.reason || '运行时文件不存在'}`);
    const chunkSize = 256 * 1024;
    const parts = [];
    let received = 0;
    for (let offset = 0; offset < meta.size; offset += chunkSize) {
      const requested = Math.min(chunkSize, meta.size - offset);
      const chunk = await chrome.runtime.sendMessage({ type: 'NMDA_RUNTIME_FILE_CHUNK', id, offset, length: requested });
      if (!chunk?.ok) throw new Error(`读取附件 ${meta.name} 失败：${chunk?.reason || 'chunk-error'}`);
      const bytes = bytesFromBase64(chunk.base64);
      if (bytes.length !== requested) throw new Error(`附件传输块长度不一致：${meta.name} · ${offset} · 期望 ${requested}，实际 ${bytes.length}`);
      parts.push(bytes);
      received += bytes.length;
    }
    if (received !== Number(meta.size || 0)) throw new Error(`附件运行时传输不完整：${meta.name} · 期望 ${meta.size} bytes，实际 ${received} bytes`);
    const file = new File(parts, meta.name, { type: meta.type || 'application/octet-stream', lastModified: meta.lastModified || Date.now() });
    if (file.size !== Number(meta.size || 0)) throw new Error(`附件重建后大小不一致：${meta.name} · 期望 ${meta.size} bytes，实际 ${file.size} bytes`);
    return file;
  }

  function reportProgress(executionId, phase, message, detail = {}) {
    chrome.runtime.sendMessage({
      type: 'NMDA_EXECUTION_PROGRESS', executionId: String(executionId || ''), phase,
      message: String(message || ''), detail
    }).catch(() => {});
  }

  const executionPauseWaiters = new Map();

  async function captureComposeIdentity() {
    const result = await chrome.runtime.sendMessage({ type: 'NMDA_COMPOSE_IDENTITY' });
    if (!result?.ok || !result.identity) {
      throw new Error(`无法锁定当前网易写信标签：${result?.reason || 'compose-identity-unavailable'}。已停止，避免后续误关其他标签。`);
    }
    return result.identity;
  }

  function waitForExecutionResume(executionId) {
    const id = String(executionId || '');
    if (!id) return Promise.reject(new Error('暂停模式缺少 execution id。'));
    if (executionPauseWaiters.has(id)) return Promise.reject(new Error('当前执行已经处于暂停状态。'));
    return new Promise(resolve => {
      executionPauseWaiters.set(id, () => {
        executionPauseWaiters.delete(id);
        resolve();
      });
    });
  }

  async function closeExactCompose(identity) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_CLOSE_COMPOSE', identity });
      if (result?.ok) return result;
      return { ok:false, reason:result?.reason || 'compose-close-failed' };
    } catch (error) {
      return { ok:false, reason:error?.message || String(error) };
    }
  }

  async function executeDraft(message) {
    const executionId = String(message.executionId || '');
    const task = message.task || {};
    const fresh = message.fresh !== false;
    const composeMode = ['forward','reply','new'].includes(task.composeMode) ? task.composeMode : 'new';
    const contextual = composeMode === 'forward' || composeMode === 'reply';
    reportProgress(executionId, 'open', contextual ? `正在打开原邮件并进入${composeMode === 'forward' ? '转发' : '回复'}…` : '正在打开新的写信页…');
    const root = contextual
      ? await openContextCompose(composeMode, task.parentMessageId, task.parentFid || 3)
      : (fresh ? await openFreshCompose() : await openCompose());
    const composeIdentity = await captureComposeIdentity();

    reportProgress(executionId, 'content', contextual ? '正在保留网易原生邮件上下文并插入 Follow-up 正文…' : '正在填写收件人、主题和正文…');
    if (composeMode === 'forward' || composeMode === 'new') await setRecipients(root, task.recipients || '');
    else if (composeMode === 'reply' && !composeHasExpectedRecipient(root, task.recipients || '')) await setRecipients(root, task.recipients || '');
    await setAuxRecipients(root, task.cc || '', '抄送');
    await setAuxRecipients(root, task.bcc || '', '密送');
    if (composeMode === 'new') await setSubject(root, task.subject || '');
    if (contextual) await prependBody(root, task.body || '', task.bodyHtml || '', !!task.bodyIsHtml);
    else await setBody(root, task.body || '', task.bodyHtml || '', !!task.bodyIsHtml);
    if (Number(task.priority || 0) === 1) await enableComposeOption(root, '紧急', true);
    if (task.requestReadReceipt) await enableComposeOption(root, '已读回执', true);

    let attachmentResult = { verified: true, missing: [], mode: 'none' };
    const refs = Array.isArray(task.attachments) ? task.attachments : [];
    if (refs.length) {
      reportProgress(executionId, 'attachments', `正在准备 ${refs.length} 个新增附件…`);
      const files = [];
      for (let i = 0; i < refs.length; i++) {
        files.push(await readRuntimeFile(refs[i]));
        reportProgress(executionId, 'attachments', `正在读取附件 ${i + 1}/${refs.length} · ${refs[i]?.name || ''}`);
      }
      attachmentResult = await addAttachments(root, files, composeIdentity, (done, total, name, detail = {}) => {
        const registered = Number(detail.registered || 0);
        const committed = Number(detail.committed ?? done ?? 0);
        const state = String(detail.state || '');
        const message = state === 'registered'
          ? `附件已加入网易队列 ${registered}/${total} · ${name}`
          : `正在确认附件上传 ${committed}/${total}${name ? ` · ${name}` : ''}${state ? ` · ${attachmentStateLabel(state)}` : ''}`;
        reportProgress(executionId, 'attachments', message, { done:committed, total, name, ...detail });
      });
      if (attachmentResult.verified !== true) {
        throw new Error(`附件未全部确认上传：${(attachmentResult.missing || []).map(file => file?.name || '').filter(Boolean).join('、') || '状态未知'}`);
      }
    } else {
      reportProgress(executionId, 'attachments', contextual ? '保留网易原生转发 / 回复上下文中的附件状态。' : '没有附件，跳过附件步骤。');
    }

    let actualMinute = null;
    if (task.scheduleAt) {
      reportProgress(executionId, 'schedule', `正在设置定时 ${String(task.scheduleAt).replace('T', ' ')}…`);
      actualMinute = await setSchedule(root, task.scheduleAt);
    } else {
      reportProgress(executionId, 'schedule', '未设置定时，将保存普通草稿。');
    }

    if (message.pauseEveryTime === true) {
      reportProgress(executionId, 'paused', '信息已填写完成，等待人工检查后继续保存。', { paused:true });
      await waitForExecutionResume(executionId);
      reportProgress(executionId, 'resume', '已继续，正在提交当前草稿。');
    }

    reportProgress(executionId, 'save', `正在点击“存草稿”并确认${task.scheduleAt ? '定时设置' : '草稿保存'}…`);
    const saveOutcome = await saveDraft(root, { scheduled: !!task.scheduleAt });
    const missingNames = (attachmentResult.missing || []).map(file => file?.name || '').filter(Boolean);

    reportProgress(executionId, 'cleanup', '草稿已保存，正在关闭本封网易写信标签…', { evidence: saveOutcome.evidence || '' });
    const cleanup = await closeExactCompose(composeIdentity);
    if (!cleanup.ok) {
      reportProgress(executionId, 'cleanup-error', `草稿已保存，但写信标签未能安全关闭：${cleanup.reason || '未知原因'}`, { saved:true });
    } else {
      reportProgress(executionId, 'done', '草稿已确认保存，写信标签已关闭。', { evidence: saveOutcome.evidence || '' });
    }
    return {
      ok: true,
      outcome: {
        saveOutcome,
        actualMinute,
        composeMode,
        cleanup,
        parentMessageId: contextual ? String(task.parentMessageId || '') : '',
        attachment: { verified: !!attachmentResult.verified, mode: attachmentResult.mode || 'none', missingNames }
      }
    };
  }



  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'NMDA_PING') {
      sendResponse({ ok: true, role: 'netease-mail-executor', composeOpen: !!findComposeRoot() });
      return;
    }
    if (message?.type === 'NMDA_EXECUTION_RESUME') {
      const id = String(message.executionId || '');
      const resume = executionPauseWaiters.get(id);
      if (!resume) { sendResponse({ ok:false, reason:'execution-not-paused' }); return; }
      resume();
      sendResponse({ ok:true, resumed:true });
      return;
    }
    if (message?.type === 'NMDA_EXECUTE_DRAFT') {
      executeDraft(message).then(sendResponse).catch(error => {
        console.error(`[${APP}] remote execution`, error);
        reportProgress(message?.executionId, 'error', error?.message || String(error));
        sendResponse({ ok: false, reason: error?.message || String(error) });
      });
      return true;
    }
  });

})();
