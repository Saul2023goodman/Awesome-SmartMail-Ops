(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const STORAGE_KEY = 'nmda.form.v1';
  const DEFAULT_TIMEOUT = 10000;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
      } catch (error) {
        lastError = error;
      }
      await sleep(interval);
    }
    if (lastError) throw lastError;
    throw new Error(message);
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
    if (type.startsWith('key')) {
      event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options });
    } else {
      event = new Event(type, { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(event);
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findVisibleByText(text, root = document, role = null) {
    const selector = role ? `[role="${CSS.escape(role)}"]` : 'a,button,div,span,li,label';
    return [...root.querySelectorAll(selector)]
      .filter(visible)
      .find(el => textOf(el) === text || textOf(el).includes(text)) || null;
  }

  function findComposeRoot() {
    const semantic = [...document.querySelectorAll('[role="main"]')]
      .find(el => visible(el) && (el.getAttribute('aria-label') || '').includes('写信'));
    if (semantic) return semantic;

    return [...document.querySelectorAll('[id^="_dvModuleContainer_compose.ComposeModule_"]')]
      .find(visible) || null;
  }

  async function openCompose() {
    let root = findComposeRoot();
    if (root) return root;

    const navRoot = document.querySelector('#dvNavTop') || document.querySelector('#dvNavContainer') || document;
    let writeButton = findVisibleByText('写信', navRoot, 'button');
    if (!writeButton) {
      writeButton = [...navRoot.querySelectorAll('li[role="button"], [role="button"]')]
        .filter(visible)
        .find(el => textOf(el).includes('写信')) || null;
    }
    if (!writeButton) {
      writeButton = [...document.querySelectorAll('li[role="button"], [role="button"]')]
        .filter(visible)
        .find(el => textOf(el).includes('写信')) || null;
    }
    if (!writeButton) throw new Error('没有找到“写信”按钮，请先进入网易邮箱主界面。');

    writeButton.click();
    root = await waitFor(findComposeRoot, 12000, 120, '点击“写信”后未检测到写信页面。');
    return root;
  }

  function findRecipientInput(root) {
    return root.querySelector('input[aria-label^="收件人地址输入框"]')
      || [...root.querySelectorAll('input[type="text"]')].find(el => (el.getAttribute('aria-label') || '').includes('收件人'))
      || null;
  }

  async function setRecipients(root, raw) {
    const addresses = raw
      .split(/[;,，；\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (!addresses.length) return;

    const input = await waitFor(() => findRecipientInput(root), 8000, 100, '未找到收件人输入框。');
    input.focus();
    nativeSetValue(input, addresses.join(';'));
    fire(input, 'input');
    fire(input, 'change');
    await sleep(100);
    fire(input, 'blur');
    await sleep(350);
  }

  function findSubjectInput(root) {
    return root.querySelector('input[id$="_subjectInput"]')
      || [...root.querySelectorAll('input')].find(el => (el.getAttribute('aria-label') || '').replace(/\s/g, '').includes('主题'))
      || null;
  }

  async function setSubject(root, subject) {
    const input = await waitFor(() => findSubjectInput(root), 8000, 100, '未找到主题输入框。');
    input.focus();
    nativeSetValue(input, subject || '');
    fire(input, 'input');
    fire(input, 'change');
    fire(input, 'blur');
  }

  function findEditorIframe(root) {
    const editorFrame = [...root.querySelectorAll('div[id^="_mail_editor_"] iframe')].find(visible);
    if (editorFrame) return editorFrame;
    return [...root.querySelectorAll('iframe')].filter(visible).sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
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
      try {
        return iframe.contentDocument?.body || null;
      } catch (_) {
        return null;
      }
    }, 8000, 120, '无法访问正文编辑器内容。');

    body.focus();
    body.innerHTML = plainTextToHtml(bodyText || '');
    fire(body, 'input');
    fire(body, 'change');
    fire(body, 'blur');
  }

  function findAttachmentInput(root) {
    return root.querySelector('div[id$="_attachBrowser"] > input[type="file"]')
      || [...root.querySelectorAll('input[type="file"]')].find(el => el.closest('[id$="_attachBrowser"]'))
      || root.querySelector('input[type="file"]')
      || null;
  }

  async function addAttachments(root, files, onProgress = () => {}) {
    if (!files?.length) return;

    const input = await waitFor(() => findAttachmentInput(root), 8000, 120, '未找到网易邮箱附件控件。');

    // 逐个注入，避免网易邮箱一次只消费第一个文件的情况。
    for (let i = 0; i < files.length; i++) {
      const dt = new DataTransfer();
      dt.items.add(files[i]);
      try {
        input.files = dt.files;
      } catch (error) {
        throw new Error(`附件“${files[i].name}”无法注入：${error.message}`);
      }
      fire(input, 'change');
      onProgress(i + 1, files.length, files[i].name);
      await sleep(900);
    }
  }

  function findMoreSendOptions(root) {
    return [...root.querySelectorAll('a,[role="link"],button,[role="button"]')]
      .filter(visible)
      .find(el => textOf(el).includes('更多发送选项')) || null;
  }

  function findScheduleCheckbox(root) {
    const aria = [...root.querySelectorAll('[role="checkbox"]')]
      .find(el => visible(el) && ((el.getAttribute('aria-label') || '').includes('定时发送') || textOf(el).includes('定时发送')));
    if (aria) return aria;

    const text = findVisibleByText('定时发送', root);
    if (!text) return null;
    return text.closest('[role="checkbox"]') || text;
  }

  function scheduleFields(root) {
    return {
      year: root.querySelector('select[id$="_scheduleYear"]'),
      month: root.querySelector('select[id$="_scheduleMonth"]'),
      day: root.querySelector('select[id$="_scheduleDay"]'),
      hour: root.querySelector('select[id$="_scheduleHour"]'),
      minute: root.querySelector('select[id$="_scheduleMinute"]')
    };
  }

  function allScheduleFieldsVisible(root) {
    const fields = scheduleFields(root);
    return Object.values(fields).every(el => el && visible(el));
  }

  async function ensureScheduleEnabled(root) {
    if (allScheduleFieldsVisible(root)) return;

    const more = findMoreSendOptions(root);
    if (more) {
      more.click();
      await sleep(220);
    }

    let checkbox = findScheduleCheckbox(root);
    if (!checkbox) {
      // 某些版本第一次点击只展开“更多”区域，再稍等一次。
      checkbox = await waitFor(() => findScheduleCheckbox(root), 3000, 120, '未找到“定时发送”选项。');
    }

    if (!allScheduleFieldsVisible(root)) {
      checkbox.click();
      try {
        await waitFor(() => allScheduleFieldsVisible(root), 2500, 120, '');
      } catch (_) {
        // Recorder 出现过同一 checkbox 连续两次点击；这里用“状态未出现”作为第二次点击条件，而不是盲目双击。
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
      const numeric = values
        .map(v => ({ v, n: Number(v) }))
        .filter(x => Number.isFinite(x.n));
      if (!numeric.length) throw new Error(`下拉框不存在可用值：${desired}`);
      numeric.sort((a, b) => Math.abs(a.n - Number(desired)) - Math.abs(b.n - Number(desired)));
      value = numeric[0].v;
    }
    nativeSetValue(select, value);
    fire(select, 'input');
    fire(select, 'change');
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
    const candidates = [...root.querySelectorAll('[role="button"],button,div')].filter(visible);
    return candidates.find(el => {
      const txt = textOf(el);
      const aria = el.getAttribute('aria-label') || '';
      return txt === '存草稿' || aria === '存草稿';
    }) || null;
  }

  async function saveDraft(root) {
    const button = await waitFor(() => findSaveDraftButton(root), 5000, 120, '未找到“存草稿”按钮。');
    button.click();
    await sleep(700);
  }

  function buildUI() {
    const root = document.createElement('div');
    root.id = 'nmda-root';
    root.innerHTML = `
      <button id="nmda-launcher" type="button" title="网易邮箱草稿助手">草稿</button>
      <section id="nmda-panel" hidden>
        <div class="nmda-head">
          <div>
            <div class="nmda-title">网易邮箱草稿助手</div>
            <div class="nmda-subtitle">自动填入，不会自动发送</div>
          </div>
          <button class="nmda-close" id="nmda-close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="nmda-body">
          <label class="nmda-field">
            <span class="nmda-label">收件人</span>
            <textarea id="nmda-recipients" placeholder="a@example.com; b@example.com"></textarea>
            <span class="nmda-hint">多人可用分号、逗号或换行分隔</span>
          </label>

          <label class="nmda-field">
            <span class="nmda-label">主题</span>
            <input id="nmda-subject" type="text" placeholder="邮件主题">
          </label>

          <label class="nmda-field">
            <span class="nmda-label">正文</span>
            <textarea id="nmda-body-text" placeholder="邮件正文"></textarea>
          </label>

          <label class="nmda-field">
            <span class="nmda-label">附件</span>
            <input id="nmda-files" type="file" multiple>
            <span class="nmda-hint">文件只保存在当前页面内存；刷新后需重新选择</span>
          </label>

          <div class="nmda-schedule-box">
            <div class="nmda-row">
              <label><input id="nmda-schedule-enabled" type="checkbox"> 设置定时发送</label>
            </div>
            <label class="nmda-field">
              <span class="nmda-label">定时时间</span>
              <input id="nmda-schedule-at" type="datetime-local">
            </label>
          </div>

          <div class="nmda-row">
            <label><input id="nmda-auto-save" type="checkbox"> 填入后自动点击“存草稿”</label>
          </div>

          <div class="nmda-actions">
            <button class="nmda-btn" id="nmda-open-compose" type="button">只打开写信</button>
            <button class="nmda-btn nmda-btn-primary" id="nmda-fill" type="button">填入草稿</button>
          </div>

          <div id="nmda-status">准备就绪。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(root);
    return root;
  }

  const ui = buildUI();
  const $ = (id) => ui.querySelector(`#${id}`);
  const launcher = $('nmda-launcher');
  const panel = $('nmda-panel');
  const recipientsEl = $('nmda-recipients');
  const subjectEl = $('nmda-subject');
  const bodyEl = $('nmda-body-text');
  const filesEl = $('nmda-files');
  const scheduleEnabledEl = $('nmda-schedule-enabled');
  const scheduleAtEl = $('nmda-schedule-at');
  const autoSaveEl = $('nmda-auto-save');
  const fillButton = $('nmda-fill');
  const openButton = $('nmda-open-compose');
  const statusEl = $('nmda-status');

  function setStatus(message, kind = '') {
    statusEl.textContent = message;
    if (kind) statusEl.dataset.kind = kind;
    else delete statusEl.dataset.kind;
  }

  function formState() {
    return {
      recipients: recipientsEl.value,
      subject: subjectEl.value,
      body: bodyEl.value,
      scheduleEnabled: scheduleEnabledEl.checked,
      scheduleAt: scheduleAtEl.value,
      autoSave: autoSaveEl.checked
    };
  }

  async function saveFormState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: formState() });
    } catch (_) {}
  }

  async function restoreFormState() {
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      if (!stored) return;
      recipientsEl.value = stored.recipients || '';
      subjectEl.value = stored.subject || '';
      bodyEl.value = stored.body || '';
      scheduleEnabledEl.checked = !!stored.scheduleEnabled;
      scheduleAtEl.value = stored.scheduleAt || '';
      autoSaveEl.checked = !!stored.autoSave;
    } catch (_) {}
  }

  launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('nmda-close').addEventListener('click', () => { panel.hidden = true; });

  [recipientsEl, subjectEl, bodyEl, scheduleEnabledEl, scheduleAtEl, autoSaveEl].forEach(el => {
    el.addEventListener('change', saveFormState);
    el.addEventListener('input', saveFormState);
  });

  openButton.addEventListener('click', async () => {
    openButton.disabled = true;
    setStatus('正在打开写信页…');
    try {
      await openCompose();
      setStatus('写信页已打开。', 'ok');
    } catch (error) {
      console.error(`[${APP}]`, error);
      setStatus(error.message, 'error');
    } finally {
      openButton.disabled = false;
    }
  });

  fillButton.addEventListener('click', async () => {
    fillButton.disabled = true;
    openButton.disabled = true;
    await saveFormState();

    try {
      setStatus('1/6 打开写信页…');
      const root = await openCompose();

      setStatus('2/6 填写收件人、主题和正文…');
      await setRecipients(root, recipientsEl.value);
      await setSubject(root, subjectEl.value);
      await setBody(root, bodyEl.value);

      if (filesEl.files.length) {
        setStatus(`3/6 注入附件（0/${filesEl.files.length}）…`);
        await addAttachments(root, [...filesEl.files], (done, total, name) => {
          setStatus(`3/6 注入附件（${done}/${total}）：${name}`);
        });
      } else {
        setStatus('3/6 未选择附件，跳过。');
      }

      if (scheduleEnabledEl.checked) {
        setStatus('4/6 设置定时发送…');
        const minute = await setSchedule(root, scheduleAtEl.value);
        const requestedMinute = new Date(scheduleAtEl.value).getMinutes();
        if (Number(minute) !== requestedMinute) {
          setStatus(`4/6 定时已设置；分钟被网易可选项调整为 ${minute} 分。`, 'warn');
          await sleep(500);
        }
      } else {
        setStatus('4/6 未启用定时发送，跳过。');
      }

      if (autoSaveEl.checked) {
        setStatus('5/6 保存草稿…');
        await saveDraft(root);
      } else {
        setStatus('5/6 保持在编辑页，不自动保存。');
      }

      setStatus(
        autoSaveEl.checked
          ? '完成：内容已填入，并已点击“存草稿”。不会自动发送。'
          : '完成：内容已填入写信页。请人工检查后保存或发送。',
        'ok'
      );
    } catch (error) {
      console.error(`[${APP}]`, error);
      setStatus(`失败：${error.message}`, 'error');
    } finally {
      fillButton.disabled = false;
      openButton.disabled = false;
    }
  });

  restoreFormState();
  console.info(`[${APP}] loaded`);
})();
