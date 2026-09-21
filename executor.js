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

  const PROMOTION_SPECS = [
    {
      key: 'english-optimize', label: '英文优化', blockingSave: true,
      markers: ['智能优化您的英文邮件', '一键纠错英文邮件，AI智能润色重写', '英文邮件一键纠错，AI智能润色重写'],
      roots: ['.Sky-gcmp-common-newdialog'], cancel: ['取消']
    },
    {
      key: 'ai-resume', label: 'AI 简历优化', blockingSave: false,
      markers: ['简历优化-AI求职小助手', '仅需1分钟，可通过专业的评估了解您的简历水平'],
      roots: ['.Sky-gCmp-aiprofile-intro-guide-popup'], cancel: ['取消']
    },
    {
      key: 'mailtrace', label: '邮件追踪推广', blockingSave: false,
      markers: ['新功能体验：邮件追踪', '功能升级：群发追踪', '功能升级：附件追踪', '邮件追踪功能全新升级'],
      roots: ['.Sky-gCmp-mailtrace-guide-dialog', '.Sky-gCmp-mailtrace-trail-guide-popup'],
      cancel: ['暂不体验', '暂不需要', '我知道了', '取消', '确定']
    },
    {
      key: 'big-attachment-member', label: '邮箱会员推广', blockingSave: false,
      markers: ['开通邮箱会员，享邮箱扩容、下载提速、追踪收件人是否已读'],
      roots: [], cancel: ['我知道了']
    }
  ];

  const activeInterruptionGuards = new Map();

  function promotionLayerFromMarker(spec) {
    const actionSelector = 'button,a,[role="button"],span,.nui-btn,.nui-txt-link';
    for (const action of document.querySelectorAll(actionSelector)) {
      if (!visible(action)) continue;
      const actionText = compactText(action);
      if (!spec.cancel.some(label => actionText === compactText(label))) continue;
      let node = action;
      for (let depth = 0; node && node !== document.body && depth < 10; depth++, node = node.parentElement) {
        const text = compactText(node);
        if (spec.markers.some(marker => text.includes(compactText(marker)))) return node;
      }
    }
    return null;
  }

  function findPromotionLayer(spec, allowMarkerFallback = true) {
    for (const selector of spec.roots || []) {
      const root = [...document.querySelectorAll(selector)].find(visible);
      if (root) return root;
    }
    return allowMarkerFallback ? promotionLayerFromMarker(spec) : null;
  }

  function clickPromotionDismiss(layer, spec) {
    if (!layer) return false;
    const candidates = [...layer.querySelectorAll('button,a,[role="button"],span,.nui-btn,.nui-txt-link')].filter(visible);
    for (const label of spec.cancel) {
      const wanted = compactText(label);
      const action = candidates.find(el => compactText(el) === wanted);
      if (action) { action.click(); return true; }
    }
    const close = candidates.find(el => {
      const aria = compactText(el.getAttribute?.('aria-label') || '');
      const title = compactText(el.getAttribute?.('title') || '');
      const cls = String(el.className || '');
      return aria === '关闭' || title === '关闭' || /closeable|dialog-close|popup-close/i.test(cls);
    });
    if (close) { close.click(); return true; }
    return false;
  }

  function findSenderNamePrompt() {
    const roots = [...document.querySelectorAll('[role="dialog"],[class*="msgbox"],[class*="Msgbox"],.nui-msgbox')].filter(visible);
    const matched = roots.find(root => {
      const text = compactText(root);
      return text.includes('您还没设置姓名') || text.includes('为方便对方确认，请填写您的姓名');
    });
    if (matched) return matched;
    const actions = [...document.querySelectorAll('button,a,[role="button"],span,.nui-btn')].filter(visible)
      .filter(el => compactText(el) === '保存并发送');
    for (const action of actions) {
      let node = action;
      for (let depth = 0; node && node !== document.body && depth < 10; depth++, node = node.parentElement) {
        const text = compactText(node);
        if (text.includes('还没设置姓名') || text.includes('填写您的姓名')) return node;
      }
    }
    return null;
  }

  function startComposeInterruptionGuard(executionId) {
    const id = String(executionId || '');
    activeInterruptionGuards.get(id)?.stop?.();
    const state = {
      phase: 'open', stopped: false, blockingSaveVersion: 0, dismissed: 0,
      seenNodes: new WeakSet(), reportedKeys: new Set(), observer: null, timer: null,
      lastMarkerFallbackAt: 0
    };
    const scan = () => {
      if (state.stopped) return [];
      const handled = [];
      const now = Date.now();
      const allowMarkerFallback = now - state.lastMarkerFallbackAt >= 900;
      if (allowMarkerFallback) state.lastMarkerFallbackAt = now;
      for (const spec of PROMOTION_SPECS) {
        const layer = findPromotionLayer(spec, allowMarkerFallback);
        if (!layer || state.seenNodes.has(layer)) continue;
        state.seenNodes.add(layer);
        if (!clickPromotionDismiss(layer, spec)) continue;
        state.dismissed++;
        if (spec.blockingSave) state.blockingSaveVersion++;
        handled.push({ key:spec.key, label:spec.label, blockingSave:!!spec.blockingSave });
        if (!state.reportedKeys.has(spec.key)) {
          state.reportedKeys.add(spec.key);
          reportProgress(id, state.phase, `已自动处理网易${spec.label}提示，继续执行。`, { interruption:'promotion', promotion:spec.key, autoDismissed:true });
        }
      }
      return handled;
    };
    const scheduleScan = () => {
      if (state.stopped || state.timer) return;
      state.timer = setTimeout(() => { state.timer = null; scan(); }, 30);
    };
    state.observer = new MutationObserver(scheduleScan);
    state.observer.observe(document.documentElement, { childList:true, subtree:true });
    const interval = setInterval(scan, 900);
    state.scan = scan;
    state.setPhase = phase => { state.phase = String(phase || state.phase || 'open'); scan(); };
    state.stop = () => {
      if (state.stopped) return;
      state.stopped = true;
      state.observer?.disconnect();
      if (state.timer) clearTimeout(state.timer);
      clearInterval(interval);
      activeInterruptionGuards.delete(id);
    };
    activeInterruptionGuards.set(id, state);
    scan();
    return state;
  }

  function stopComposeInterruptionGuard(executionId) {
    activeInterruptionGuards.get(String(executionId || ''))?.stop?.();
  }

  async function getComposeSenderState(identity) {
    try {
      const result = await chrome.runtime.sendMessage({ type:'NMDA_COMPOSE_SENDER_STATE', identity:identity || {} });
      return result?.ok ? result : { ok:false, resolved:false, reason:result?.reason || 'sender-state-unavailable' };
    } catch (error) {
      return { ok:false, resolved:false, reason:error?.message || String(error) };
    }
  }

  async function rearmSenderNamePrompt(identity) {
    try {
      return await chrome.runtime.sendMessage({ type:'NMDA_COMPOSE_REARM_SENDER_NAME', identity:identity || {} });
    } catch (error) {
      return { ok:false, reason:error?.message || String(error) };
    }
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

    // Follow-up reply must use NetEase's native "回复全部(带附件)" path. On Sent
    // messages (fid=3) the ordinary "回复" toolbar button is not present, so the old
    // DOM-text click path could never reliably start a reply job. The native assistant
    // path preserves thread metadata and asks ComposeManager for reply_all_ach, which in
    // turn uses replyallattach and carries the original attachment context server-side.
    if (mode === 'reply') {
      const native = await chrome.runtime.sendMessage({
        type:'NMDA_OPEN_REPLY_ALL_WITH_ATTACHMENTS',
        messageId:String(messageId || ''),
        fid:Number(fid || 3) || 3
      });
      if (!native?.ok) throw new Error(`已打开原邮件，但网易原生“回复全部（带附件）”入口不可用：${native?.reason || 'unknown'}`);
      return waitFor(() => {
        const root = findComposeRoot();
        if (!root) return null;
        const now = composeFingerprint(root);
        if (!beforeRoot || !before || (now && now !== before)) return root;
        return null;
      }, 14000, 120, '已调用网易原生“回复全部（带附件）”，但没有检测到新的回复 Compose。');
    }

    const labels = ['转发'];
    const action = await waitFor(() => findReadAction(labels), 10000, 120, `已打开原邮件，但没有找到“${labels[0]}”按钮。`);
    action.click();
    return waitFor(() => {
      const root = findComposeRoot();
      if (!root) return null;
      const now = composeFingerprint(root);
      if (!beforeRoot || !before || (now && now !== before)) return root;
      return null;
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

  function sanitizeComposeHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';
    const blocks = new Set(['div','p','ul','ol','li','blockquote','pre']);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
    const render = node => {
      if (node.nodeType === 3) return esc(node.nodeValue || '');
      if (node.nodeType !== 1) return '';
      const tag = String(node.tagName || '').toLowerCase();
      if (tag === 'br') return '<br>';
      const content = Array.from(node.childNodes || []).map(render).join('');
      const style = String(node.getAttribute?.('style') || '').toLowerCase();
      const bold = ['strong','b'].includes(tag) || /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style);
      const italic = ['em','i'].includes(tag) || /font-style\s*:\s*italic/.test(style);
      const underline = tag === 'u' || /text-decoration[^;]*underline/.test(style);
      const strike = ['s','strike','del'].includes(tag) || /text-decoration[^;]*(?:line-through|strike)/.test(style);
      let out = content;
      if (strike) out = `<s>${out}</s>`;
      if (underline) out = `<u>${out}</u>`;
      if (italic) out = `<em>${out}</em>`;
      if (bold) out = `<strong>${out}</strong>`;
      if (tag === 'a') {
        const href = String(node.getAttribute?.('href') || '').trim();
        if (/^(?:https?:|mailto:)/i.test(href)) out = `<a href="${esc(href)}">${out}</a>`;
      }
      if (blocks.has(tag)) out = `<${tag}>${out}</${tag}>`;
      return out;
    };
    return Array.from(root.childNodes || []).map(render).join('');
  }

  function composeNodeIsBlankBlock(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = String(node.tagName || '').toLowerCase();
    if (!['div','p'].includes(tag)) return false;
    const text = String(node.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (text) return false;
    return ![...node.querySelectorAll('*')].some(el => String(el.tagName || '').toLowerCase() !== 'br');
  }

  function ensureComposeParagraphSpacing(html) {
    const safe = String(html || '');
    if (!safe.trim()) return safe;
    const doc = new DOMParser().parseFromString(`<div>${safe}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return safe;
    const blockTags = new Set(['div','p','blockquote','ul','ol','pre']);
    const containerTags = new Set(['div','blockquote']);
    const addSpacing = container => {
      let previousContentBlock = null;
      let blankSincePrevious = false;
      for (const node of [...container.childNodes]) {
        if (node.nodeType === 3) {
          if (String(node.nodeValue || '').replace(/\u00a0/g, ' ').trim()) { previousContentBlock = null; blankSincePrevious = false; }
          continue;
        }
        if (node.nodeType !== 1) continue;
        const tag = String(node.tagName || '').toLowerCase();
        if (composeNodeIsBlankBlock(node)) {
          if (previousContentBlock) blankSincePrevious = true;
          continue;
        }
        if (!blockTags.has(tag)) {
          previousContentBlock = null; blankSincePrevious = false;
          continue;
        }
        const hasContent = !!(String(node.textContent || '').replace(/\u00a0/g, ' ').trim() || node.querySelector('img,table,hr'));
        if (!hasContent) continue;
        if (previousContentBlock && !blankSincePrevious) {
          const spacer = doc.createElement('div');
          spacer.setAttribute('data-nmda-paragraph-gap', '1');
          spacer.appendChild(doc.createElement('br'));
          container.insertBefore(spacer, node);
        }
        previousContentBlock = node;
        blankSincePrevious = false;
        if (containerTags.has(tag)) addSpacing(node);
      }
    };
    addSpacing(root);
    return root.innerHTML;
  }

  function composeBodyHtml(bodyText, bodyHtml = '', bodyIsHtml = false, ensureParagraphSpacing = true) {
    if (bodyIsHtml && String(bodyHtml || '').trim()) {
      const sanitized = sanitizeComposeHtml(bodyHtml);
      return ensureParagraphSpacing === false ? sanitized : ensureComposeParagraphSpacing(sanitized);
    }
    return plainTextToHtml(bodyText || '');
  }

  function composeBodyHtmlForFastNative(bodyText, bodyHtml = '', bodyIsHtml = false, ensureParagraphSpacing = true) {
    // In fast-native mode NetEase's own editor.set()/getFinal() performs the HTML
    // filtering and native root wrapping. Preserve rich source HTML here instead of
    // pre-flattening it with SmartMail's conservative DOM sanitizer.
    if (bodyIsHtml && String(bodyHtml || '').trim()) {
      const nativeSource = String(bodyHtml || '');
      return ensureParagraphSpacing === false ? nativeSource : ensureComposeParagraphSpacing(nativeSource);
    }
    return plainTextToHtml(bodyText || '');
  }

  async function applyFastNativeCompose(composeIdentity, task) {
    try {
      return await chrome.runtime.sendMessage({
        type:'NMDA_FAST_COMPOSE_APPLY',
        identity:composeIdentity || {},
        payload:{
          recipients:String(task.recipients || ''),
          cc:String(task.cc || ''),
          bcc:String(task.bcc || ''),
          subject:String(task.subject || ''),
          bodyHtml:composeBodyHtmlForFastNative(
            task.body || '',
            task.bodyHtml || '',
            !!task.bodyIsHtml,
            task.ensureParagraphSpacing !== false
          ),
          priority:Number(task.priority || 0) || 0,
          requestReadReceipt:!!task.requestReadReceipt,
          scheduleAt:String(task.scheduleAt || '')
        }
      });
    } catch (error) {
      return {ok:false,reason:error?.message || String(error)};
    }
  }

  async function submitFastNativeCompose(composeIdentity, scheduled) {
    const result = await chrome.runtime.sendMessage({
      type:'NMDA_FAST_COMPOSE_SUBMIT',
      identity:composeIdentity || {},
      scheduled:!!scheduled
    });
    if (!result?.ok) throw new Error(`极速 Compose 原生提交失败：${result?.reason || 'unknown'}`);
    return result;
  }

  async function setBody(root, bodyText, bodyHtml = '', bodyIsHtml = false, ensureParagraphSpacing = true) {
    const iframe = await waitFor(() => findEditorIframe(root), 8000, 120, '未找到正文编辑器 iframe。');
    const body = await waitFor(() => {
      try { return iframe.contentDocument?.body || null; } catch (_) { return null; }
    }, 8000, 120, '无法访问正文编辑器内容。');
    body.focus();
    // Drafts imported from the mailbox already contain NetEase-sanitized HTML.
    // Preserve that representation unless the user edited the plain-text body in
    // the workbench; ordinary file imports continue through the plain-text path.
    body.innerHTML = composeBodyHtml(bodyText, bodyHtml, bodyIsHtml, ensureParagraphSpacing);
    fire(body, 'input'); fire(body, 'change'); fire(body, 'blur');
  }


  async function prependBody(root, bodyText, bodyHtml = '', bodyIsHtml = false, ensureParagraphSpacing = true) {
    const iframe = await waitFor(() => findEditorIframe(root), 8000, 120, '未找到正文编辑器 iframe。');
    const body = await waitFor(() => {
      try { return iframe.contentDocument?.body || null; } catch (_) { return null; }
    }, 8000, 120, '无法访问正文编辑器内容。');
    const html = composeBodyHtml(bodyText, bodyHtml, bodyIsHtml, ensureParagraphSpacing);
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

  async function waitForDraftSaveOutcome({ scheduled, baseline, retrySubmit, executionId, guard, composeIdentity }) {
    if (scheduled) {
      let deadline = Date.now() + 9000;
      let poll = 0;
      let senderPromptActive = false;
      let senderPromptLastSeenAt = 0;
      let senderResolvedReported = false;
      let rearmAttempts = 0;
      let blockingPromoVersion = Number(guard?.blockingSaveVersion || 0);
      let retryAfterPromotionAt = 0;

      while (true) {
        guard?.scan?.();
        const deep = poll % 8 === 7;
        if (!baseline?.timedSuccessVisible && isTimedDraftSuccessVisible(deep)) {
          return { kind: 'scheduled-result', evidence: '定时发信设置成功' };
        }

        const senderPrompt = findSenderNamePrompt();
        if (senderPrompt) {
          senderPromptLastSeenAt = Date.now();
          if (!senderPromptActive) {
            senderPromptActive = true;
            senderResolvedReported = false;
            reportProgress(executionId, 'identity-required', '网易需要补充发件人姓名。请直接在当前弹窗填写；保存后本封会自动继续，无需重新开始。', { waitingFor:'sender-name', autoResume:true });
          }
          await sleep(120);
          poll++;
          continue;
        }

        if (senderPromptActive) {
          const senderState = await getComposeSenderState(composeIdentity);
          if (senderState?.resolved) {
            senderPromptActive = false;
            deadline = Date.now() + 12000;
            if (!senderResolvedReported) {
              senderResolvedReported = true;
              reportProgress(executionId, 'save', '发件人姓名已补全，网易正在自动继续当前定时任务…', { senderResolved:true, autoResumed:true });
            }
          } else if (Date.now() - senderPromptLastSeenAt >= 700) {
            // NetEase flips ntes_compose.senderName to 1 as soon as the prompt is shown.
            // If the prompt is closed without a saved name, re-arm that exact guard before
            // re-submitting so the task can never silently continue with the raw account name.
            const rearmed = await rearmSenderNamePrompt(composeIdentity);
            if (rearmed?.ok) {
              rearmAttempts++;
              reportProgress(executionId, 'identity-required', '发件人姓名尚未保存，已恢复网易姓名填写步骤；填写完成后会自动继续。', { waitingFor:'sender-name', autoResume:true, rearmAttempts });
              if (typeof retrySubmit === 'function') await retrySubmit();
              senderPromptLastSeenAt = Date.now();
              await sleep(220);
              poll++;
              continue;
            }
            // If the private flag cannot be re-armed, keep the same task alive instead of
            // failing the whole batch. The user can still fill the native dialog if it returns.
            senderPromptLastSeenAt = Date.now();
          }
        }

        const currentBlockingPromoVersion = Number(guard?.blockingSaveVersion || 0);
        if (currentBlockingPromoVersion > blockingPromoVersion) {
          blockingPromoVersion = currentBlockingPromoVersion;
          retryAfterPromotionAt = Date.now() + 220;
          deadline = Date.now() + 9000;
        }
        if (retryAfterPromotionAt && Date.now() >= retryAfterPromotionAt) {
          retryAfterPromotionAt = 0;
          if (typeof retrySubmit === 'function') await retrySubmit();
        }

        if (!senderPromptActive && Date.now() > deadline) {
          throw new Error('已点击“存草稿”，但未检测到“定时发信设置成功”。已保留当前 Compose，避免误写下一封。');
        }
        poll++;
        await sleep(100);
      }
    }

    return waitFor(() => {
      guard?.scan?.();
      const tip = findFreshRegularDraftSuccess(baseline);
      if (tip) return { kind: 'regular-tip', evidence: textOf(tip) };
      if (!baseline?.routeWasDraft && isDraftRoute()) {
        return { kind: 'draft-route', evidence: 'Compose 路由进入 draft' };
      }
      return null;
    }, 7000, 100, '已点击“存草稿”，但未检测到网易“成功保存到草稿箱”的新提示，已保留当前 Compose。');
  }

  async function saveDraft(root, options = {}) {
    // “存草稿” is a hard transaction boundary, but NetEase has TWO success
    // state machines:
    //   normal draft    -> editor remains open + transient success tip
    //   scheduled draft -> dedicated “定时发信设置成功” result page
    // Fast-native mode calls ComposeBase.send() directly; standard mode clicks the
    // visible button. Both share the same success evidence and interruption recovery.
    const scheduled = !!options.scheduled;
    const nativeSubmit = typeof options.nativeSubmit === 'function' ? options.nativeSubmit : null;
    let button = null;
    if (!nativeSubmit) {
      button = await waitFor(() => findSaveDraftButton(root), 5000, 120, '未找到“存草稿”按钮，已停止，避免草稿未保存。');
    }
    const baseline = captureDraftSaveBaseline();
    options.guard?.scan?.();
    const retrySubmit = async () => {
      if (nativeSubmit) return nativeSubmit();
      button?.click?.();
      return {ok:true,method:'dom-save-button'};
    };
    await retrySubmit();
    const outcome = await waitForDraftSaveOutcome({
      scheduled, baseline, retrySubmit,
      executionId: options.executionId || '',
      guard: options.guard || null,
      composeIdentity: options.composeIdentity || null
    });
    await sleep(scheduled ? 220 : 140);
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

  async function createDraftAttachmentSeed(message) {
    const executionId = String(message.executionId || '');
    const ref = message.file || null;
    if (!ref?.id) throw new Error('缺少新版附件运行时文件。');
    const file = await readRuntimeFile(ref);
    reportProgress(executionId,'attachment-seed','正在建立一次性网易附件源…',{name:file.name,size:file.size});
    let root = await openFreshCompose();
    let composeIdentity = await captureComposeIdentity();
    const guard = startComposeInterruptionGuard(executionId);
    guard.setPhase('attachment-seed');
    try {
      await setSubject(root, `[SmartMail 附件更新临时源] ${file.name}`);
      await setBody(root, 'SmartMail temporary attachment source. This draft will be removed automatically.', '', false, false);
      await addAttachments(root,[file],composeIdentity,(done,total,name,detail)=>{
        reportProgress(executionId,'attachment-seed',`正在上传新版附件 ${done}/${total}${name?` · ${name}`:''}`,{done,total,name,...(detail||{})});
      });
      reportProgress(executionId,'attachment-seed','新版附件已上传，正在保存临时源草稿…',{name:file.name});
      await saveDraft(root,{scheduled:false,executionId,guard,composeIdentity});
      try {
        const refreshed = await captureComposeIdentity();
        if (refreshed?.name) composeIdentity = refreshed;
      } catch (_) {}
      const exported = await chrome.runtime.sendMessage({
        type:'NMDA_DRAFT_ATTACHMENT_EXPORT_SOURCE',
        identity:composeIdentity,
        expected:[{assetKey:'replacement',name:file.name,size:file.size}]
      });
      const source = exported?.sources?.[0] || null;
      if (!source?.mid || !source?.part || !exported?.draftId) {
        throw new Error(exported?.reason || '网易未能建立可复用的附件源。');
      }
      reportProgress(executionId,'attachment-seed','新版附件源已就绪，开始原地更新草稿。',{draftId:exported.draftId,name:file.name});
      const cleanup = await closeExactCompose(composeIdentity);
      stopComposeInterruptionGuard(executionId);
      return {ok:true,source:{...source,name:file.name,size:file.size},seedDraftId:String(exported.draftId||source.draftId||''),cleanup};
    } catch (error) {
      try { await closeExactCompose(composeIdentity); } catch (_) {}
      stopComposeInterruptionGuard(executionId);
      throw error;
    }
  }

  async function executeDraft(message) {
    const executionId = String(message.executionId || '');
    const task = message.task || {};
    const fresh = message.fresh !== false;
    const composeMode = ['forward','reply','new'].includes(task.composeMode) ? task.composeMode : 'new';
    const contextual = composeMode === 'forward' || composeMode === 'reply';
    reportProgress(executionId, 'open', contextual ? `正在打开原邮件并进入${composeMode === 'forward' ? '转发' : '回复'}…` : '正在打开新的写信页…');
    let root = contextual
      ? await openContextCompose(composeMode, task.parentMessageId, task.parentFid || 3)
      : (fresh ? await openFreshCompose() : await openCompose());
    let composeIdentity = await captureComposeIdentity();
    const interruptionGuard = startComposeInterruptionGuard(executionId);
    interruptionGuard.setPhase('content');

    if (composeMode === 'reply') {
      // Compose shell can become visible before replyMessage() has finished filling the
      // provider-native reply data. Wait for NetEase to populate the expected recipients
      // before touching the editor, otherwise our Follow-up body can race the native fill.
      await waitFor(
        () => composeHasExpectedRecipient(root, task.recipients || '') ? true : null,
        12000,
        120,
        '网易原生“回复全部（带附件）”已打开，但收件人上下文没有完成回填。已停止以避免把 Follow-up 写成普通新邮件。'
      );
      const entry = String(composeIdentity?.fromEntry || '');
      const detail = String(composeIdentity?.fromEntryDetail || '');
      const nativeReplyAllAttach = entry === 'reply' && /reply_all_ach/i.test(detail);
      let inheritedCount = null;
      try {
        const attachmentState = await readComposeAttachmentState(composeIdentity);
        inheritedCount = (attachmentState.items || []).filter(item => !item?.inlined).length;
      } catch (_) {}
      reportProgress(
        executionId,
        'content',
        nativeReplyAllAttach
          ? `已进入网易原生“回复全部（带附件）”${Number.isFinite(inheritedCount) ? ` · 原生附件上下文 ${inheritedCount} 项` : ''}。`
          : '网易原生回复 Compose 已打开，正在保留线程与附件上下文。',
        { nativeReplyAllAttach, fromEntry:entry, fromEntryDetail:detail, inheritedAttachmentCount:inheritedCount }
      );
    }

    let fastNativeActive = false;
    let fastNativeDetail = null;
    const fastNativeRequested = message.fastCompose === true && composeMode === 'new';
    if (fastNativeRequested) {
      interruptionGuard.setPhase('fast-compose');
      reportProgress(executionId, 'fast-compose', '极速 Compose：正在通过网易原生 Compose 内核直写收件人、主题、正文与定时数据…', {fastCompose:true});
      const applied = await applyFastNativeCompose(composeIdentity, task);
      if (applied?.ok) {
        fastNativeActive = true;
        fastNativeDetail = applied;
        reportProgress(
          executionId,
          'fast-compose',
          `极速 Compose 已就绪 · 原生格式编译${task.scheduleAt ? ' · 原生定时' : ''}${applied.nativeContentLength ? ` · HTML ${applied.nativeContentLength} 字符` : ''}`,
          {fastCompose:true,nativeDirect:true,compiled:applied.compiled || null}
        );
      } else {
        reportProgress(
          executionId,
          'content',
          `极速 Compose 当前不可用，已自动回退标准模式：${applied?.reason || 'native-capability-unavailable'}`,
          {fastCompose:true,fallback:true,reason:applied?.reason || ''}
        );
      }
    } else if (message.fastCompose === true && contextual) {
      reportProgress(executionId, 'content', '当前为 Reply / Forward，上下文优先保真；本封自动使用标准原生 Compose。', {fastCompose:true,fallback:true,reason:'contextual-compose'});
    }

    if (!fastNativeActive) {
      reportProgress(executionId, 'content', contextual ? '正在保留网易原生邮件上下文并插入 Follow-up 正文…' : '正在填写收件人、主题和正文…');
      if (composeMode === 'forward' || composeMode === 'new') await setRecipients(root, task.recipients || '');
      await setAuxRecipients(root, task.cc || '', '抄送');
      await setAuxRecipients(root, task.bcc || '', '密送');
      if (composeMode === 'new') await setSubject(root, task.subject || '');
      if (contextual) await prependBody(root, task.body || '', task.bodyHtml || '', !!task.bodyIsHtml, task.ensureParagraphSpacing !== false);
      else await setBody(root, task.body || '', task.bodyHtml || '', !!task.bodyIsHtml, task.ensureParagraphSpacing !== false);
      if (Number(task.priority || 0) === 1) await enableComposeOption(root, '紧急', true);
      if (task.requestReadReceipt) await enableComposeOption(root, '已读回执', true);
    }

    let attachmentResult = { verified: true, missing: [], mode: 'none' };
    const refs = Array.isArray(task.attachments) ? task.attachments : [];
    if (refs.length) {
      interruptionGuard.setPhase('attachments');
      reportProgress(executionId, 'attachments', `正在准备 ${refs.length} 个新增附件…`);
      const files=[];
      for (let i=0;i<refs.length;i++) {
        files.push(await readRuntimeFile(refs[i]));
        reportProgress(executionId,'attachments',`正在读取附件 ${i+1}/${refs.length} · ${refs[i]?.name||''}`);
      }
      attachmentResult = await addAttachments(root, files, composeIdentity, (done,total,name,detail)=>{
        const registered=Number(detail?.registered||0), committed=Number(detail?.committed ?? done ?? 0), state=String(detail?.state||'');
        const text=state==='registered'
          ? `附件已加入网易队列 ${registered}/${total} · ${name}`
          : `正在确认附件上传 ${committed}/${total}${name?` · ${name}`:''}${state?` · ${attachmentStateLabel(state)}`:''}`;
        reportProgress(executionId,'attachments',text,{done:committed,total,name,...(detail||{})});
      });
      if (attachmentResult.verified !== true) {
        throw new Error(`附件未全部确认上传：${(attachmentResult.missing || []).map(file => file?.name || '').filter(Boolean).join('、') || '状态未知'}`);
      }
    } else {
      interruptionGuard.setPhase('attachments');
      reportProgress(executionId, 'attachments', contextual ? '保留网易原生转发 / 回复上下文中的附件状态。' : '没有附件，跳过附件步骤。');
    }

    let actualMinute = null;
    interruptionGuard.setPhase('schedule');
    if (task.scheduleAt) {
      const displaySchedule=String(task.scheduleDisplayAt||task.scheduleAt).replace('T',' '), zoneLabel=String(task.scheduleTimeZoneLabel||'').trim();
      if (fastNativeActive) {
        actualMinute = new Date(task.scheduleAt).getMinutes();
        reportProgress(executionId, 'schedule', `极速 Compose 已把定时 ${displaySchedule}${zoneLabel?` · ${zoneLabel} 当地时间`:''} 写入网易原生 Schedule 模型。`, {fastCompose:true,nativeSchedule:true});
      } else {
        reportProgress(executionId, 'schedule', `正在设置定时 ${displaySchedule}${zoneLabel?` · ${zoneLabel} 当地时间`:''}…`);
        actualMinute = await setSchedule(root, task.scheduleAt);
      }
    } else {
      reportProgress(executionId, 'schedule', fastNativeActive ? '极速 Compose：普通草稿无需定时步骤。' : '未设置定时，将保存普通草稿。');
    }

    if (message.pauseEveryTime === true) {
      interruptionGuard.setPhase('paused');
      reportProgress(executionId, 'paused', '信息已填写完成，等待人工检查后继续保存。', { paused:true });
      await waitForExecutionResume(executionId);
      interruptionGuard.setPhase('save');
      reportProgress(executionId, 'resume', '已继续，正在提交当前草稿。');
    }

    interruptionGuard.setPhase('save');
    reportProgress(
      executionId,
      'save',
      fastNativeActive
        ? `极速 Compose：正在通过网易原生 send() 提交并确认${task.scheduleAt ? '定时设置' : '草稿保存'}…`
        : `正在点击“存草稿”并确认${task.scheduleAt ? '定时设置' : '草稿保存'}…`,
      {fastCompose:fastNativeActive}
    );
    const saveOutcome = await saveDraft(root, {
      scheduled: !!task.scheduleAt,
      executionId,
      guard: interruptionGuard,
      composeIdentity,
      nativeSubmit: fastNativeActive ? (() => submitFastNativeCompose(composeIdentity, !!task.scheduleAt)) : null
    });
    const missingNames = (attachmentResult.missing || []).map(file => file?.name || '').filter(Boolean);

    interruptionGuard.setPhase('cleanup');
    reportProgress(executionId, 'cleanup', '草稿已保存，正在关闭本封网易写信标签…', { evidence: saveOutcome.evidence || '' });
    // Save is already confirmed. Stop popup observation before tearing the Compose module
    // down so MutationObserver work cannot compete with the close/next-open boundary.
    stopComposeInterruptionGuard(executionId);
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
        fastCompose: { requested:message.fastCompose === true, active:fastNativeActive, engine:fastNativeActive ? 'netease-native-direct' : 'standard-dom', detail:fastNativeDetail || null },
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
    if (message?.type === 'NMDA_DRAFT_ATTACHMENT_SEED') {
      createDraftAttachmentSeed(message).then(sendResponse).catch(error => {
        stopComposeInterruptionGuard(message?.executionId);
        reportProgress(message?.executionId,'error',error?.message||String(error));
        sendResponse({ok:false,reason:error?.message||String(error)});
      });
      return true;
    }
    if (message?.type === 'NMDA_EXECUTE_DRAFT') {
      executeDraft(message).then(sendResponse).catch(error => {
        stopComposeInterruptionGuard(message?.executionId);
        console.error(`[${APP}] remote execution`, error);
        reportProgress(message?.executionId, 'error', error?.message || String(error));
        sendResponse({ ok: false, reason: error?.message || String(error) });
      });
      return true;
    }
  });

})();
