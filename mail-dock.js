(() => {
  'use strict';
  if (window.top !== window || document.getElementById('nmda-mail-dock-host')) return;

  const STORAGE_KEY = 'nmda.mailDock.pinned.v1';
  const host = document.createElement('div');
  host.id = 'nmda-mail-dock-host';
  host.dataset.open = 'false';
  host.innerHTML = `
    <div id="nmda-mail-dock-hotzone" aria-hidden="true"><div id="nmda-mail-dock-rail"></div></div>
    <aside id="nmda-mail-dock-panel" aria-label="SmartMail Ops" aria-hidden="true">
      <header class="nmda-dock-head">
        <div class="nmda-dock-brand">
          <div class="nmda-dock-brand-line">
            <span class="nmda-dock-mark">SM</span>
            <strong>SmartMail Ops</strong>
            <span class="nmda-dock-state" id="nmda-dock-state" data-state="offline">检查中</span>
          </div>
          <small id="nmda-dock-account">网易邮箱作业入口</small>
        </div>
        <div class="nmda-dock-head-actions">
          <button class="nmda-dock-icon" id="nmda-dock-pin" type="button" title="固定面板" aria-label="固定面板">⌖</button>
          <button class="nmda-dock-icon" id="nmda-dock-close" type="button" title="收起" aria-label="收起">×</button>
        </div>
      </header>
      <div class="nmda-dock-body">
        <div class="nmda-dock-section-title">作业入口</div>
        <div class="nmda-dock-list">
          <button class="nmda-dock-row" data-target="batch" data-primary="true" type="button">
            <span class="nmda-dock-row-icon">总</span><span class="nmda-dock-row-copy"><strong>批量工作台</strong><small>当前批次与作业状态</small></span><span class="nmda-dock-chevron">›</span>
          </button>
          <button class="nmda-dock-row" data-target="batch/1" type="button">
            <span class="nmda-dock-row-icon">入</span><span class="nmda-dock-row-copy"><strong>资料导入</strong><small>邮件、名单与附件</small></span><span class="nmda-dock-chevron">›</span>
          </button>
          <button class="nmda-dock-row" data-target="batch/2" type="button">
            <span class="nmda-dock-row-icon">核</span><span class="nmda-dock-row-copy"><strong>待办核验</strong><small>内容、去重与附件</small></span><span class="nmda-dock-chevron">›</span>
          </button>
          <button class="nmda-dock-row" data-target="batch/3" type="button">
            <span class="nmda-dock-row-icon">排</span><span class="nmda-dock-row-copy"><strong>排期与执行</strong><small>选择、排期与批量创建</small></span><span class="nmda-dock-chevron">›</span>
          </button>
          <button class="nmda-dock-row" data-target="contacts" type="button">
            <span class="nmda-dock-row-icon">联</span><span class="nmda-dock-row-copy"><strong>联系人</strong><small>邮箱状态与跟进记录</small></span><span class="nmda-dock-chevron">›</span>
          </button>
        </div>
        <div class="nmda-dock-divider"></div>
        <div class="nmda-dock-list">
          <button class="nmda-dock-row" id="nmda-dock-compose" type="button">
            <span class="nmda-dock-row-icon">写</span><span class="nmda-dock-row-copy"><strong>写信</strong><small>打开网易原生写信页</small></span><span class="nmda-dock-chevron">›</span>
          </button>
        </div>
      </div>
      <footer class="nmda-dock-footer"><span>悬停右侧边缘唤出</span><span><kbd>Alt</kbd> + <kbd>M</kbd></span></footer>
    </aside>`;

  document.documentElement.appendChild(host);

  const panel = host.querySelector('#nmda-mail-dock-panel');
  const hotzone = host.querySelector('#nmda-mail-dock-hotzone');
  const pinButton = host.querySelector('#nmda-dock-pin');
  const closeButton = host.querySelector('#nmda-dock-close');
  const stateEl = host.querySelector('#nmda-dock-state');
  const accountEl = host.querySelector('#nmda-dock-account');

  let pinned = false;
  let closeTimer = null;
  let openTimer = null;

  function setOpen(open) {
    host.dataset.open = open ? 'true' : 'false';
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function scheduleOpen() {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    openTimer = setTimeout(() => { setOpen(true); refreshStatus(); }, 70);
  }

  function scheduleClose() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (pinned) return;
    closeTimer = setTimeout(() => setOpen(false), 240);
  }

  function setPinned(next, persist = true) {
    pinned = !!next;
    pinButton.dataset.active = pinned ? 'true' : 'false';
    pinButton.title = pinned ? '取消固定' : '固定面板';
    if (pinned) setOpen(true);
    if (persist) chrome.storage.local.set({ [STORAGE_KEY]: pinned }).catch(() => {});
  }

  async function refreshStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'NMDA_CONNECTION_STATUS' });
      const online = !!status?.connected;
      stateEl.dataset.state = online ? 'online' : 'offline';
      stateEl.textContent = online ? '已连接' : '未连接';
      accountEl.textContent = status?.account ? String(status.account) : '网易邮箱作业入口';
    } catch (_) {
      stateEl.dataset.state = 'offline';
      stateEl.textContent = '未连接';
    }
  }

  async function openWorkspace(target) {
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_APP', target: String(target || 'batch') });
    } catch (error) {
      console.warn('[SmartMail Ops] open workspace failed', error);
    }
  }

  hotzone.addEventListener('mouseenter', scheduleOpen);
  panel.addEventListener('mouseenter', () => { clearTimeout(closeTimer); });
  host.addEventListener('mouseleave', scheduleClose);

  pinButton.addEventListener('click', event => {
    event.stopPropagation();
    setPinned(!pinned);
  });

  closeButton.addEventListener('click', event => {
    event.stopPropagation();
    setPinned(false);
    setOpen(false);
  });

  host.querySelectorAll('[data-target]').forEach(button => {
    button.addEventListener('click', () => openWorkspace(button.dataset.target));
  });

  host.querySelector('#nmda-dock-compose')?.addEventListener('click', async () => {
    try { await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_COMPOSE' }); }
    catch (error) { console.warn('[SmartMail Ops] open compose failed', error); }
  });

  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && String(event.key).toLowerCase() === 'm') {
      event.preventDefault();
      setOpen(host.dataset.open !== 'true');
    }
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'NMDA_CONNECTION_CHANGED') refreshStatus();
  });

  chrome.storage.local.get(STORAGE_KEY).then(value => setPinned(!!value?.[STORAGE_KEY], false)).catch(() => {});
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();
