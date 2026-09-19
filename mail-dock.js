(() => {
  'use strict';
  if (window.top !== window || document.getElementById('nmda-mail-dock-host')) return;

  const host = document.createElement('div');
  host.id = 'nmda-mail-dock-host';
  host.dataset.open = 'false';
  host.dataset.section = 'workflow';
  host.innerHTML = `
    <aside id="nmda-mail-dock-secondary" class="nmda-dock-secondary" aria-label="SmartMail 二级菜单" aria-hidden="true">
      <header class="nmda-dock-secondary-head">
        <div class="nmda-dock-secondary-title">
          <span class="nmda-dock-kicker">SmartMail Ops</span>
          <strong id="nmda-dock-secondary-name">邮件作业</strong>
          <small id="nmda-dock-secondary-desc">导入、审阅、排期与创建</small>
        </div>
        <span class="nmda-dock-connection" id="nmda-dock-connection" data-state="offline" title="连接状态">
          <i></i><span id="nmda-dock-connection-text">检查中</span>
        </span>
      </header>
      <div class="nmda-dock-secondary-body" id="nmda-dock-secondary-body"></div>
      <footer class="nmda-dock-secondary-footer">
        <span id="nmda-dock-account">网易邮箱</span>
        <span><kbd>Alt</kbd><span class="nmda-dock-plus">+</span><kbd>M</kbd></span>
      </footer>
    </aside>

    <nav id="nmda-mail-dock-primary" class="nmda-dock-primary" aria-label="SmartMail 一级菜单">
      <button class="nmda-dock-brand-button" data-section="workflow" type="button" aria-label="SmartMail 作业菜单" title="SmartMail Ops">
        <span class="nmda-dock-brand-mark">SM</span>
      </button>

      <div class="nmda-dock-primary-divider"></div>

      <button class="nmda-dock-primary-item" data-section="workflow" type="button" aria-label="作业" aria-expanded="false">
        <span class="nmda-dock-primary-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 4.75h14A1.25 1.25 0 0 1 20.25 6v12A1.25 1.25 0 0 1 19 19.25H5A1.25 1.25 0 0 1 3.75 18V6A1.25 1.25 0 0 1 5 4.75Z"/><path d="M7.5 9h9M7.5 12h9M7.5 15h5"/></svg>
        </span>
        <span class="nmda-dock-primary-label">作业</span>
      </button>

      <button class="nmda-dock-primary-item" data-section="contacts" type="button" aria-label="联系人" aria-expanded="false">
        <span class="nmda-dock-primary-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.25"/><path d="M3.75 18c.55-3.1 2.37-4.75 5.25-4.75s4.7 1.65 5.25 4.75M15.25 7.25h5M17.75 4.75v5"/></svg>
        </span>
        <span class="nmda-dock-primary-label">联系人</span>
      </button>

      <button class="nmda-dock-primary-item" id="nmda-dock-compose" type="button" aria-label="写信" title="打开网易写信">
        <span class="nmda-dock-primary-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 18.75 6.1 14.4 16.95 3.55a1.35 1.35 0 0 1 1.9 0l1.6 1.6a1.35 1.35 0 0 1 0 1.9L9.6 17.9 5 18.75Z"/><path d="m14.8 5.7 3.5 3.5M5.9 14.55l3.55 3.55"/></svg>
        </span>
        <span class="nmda-dock-primary-label">写信</span>
      </button>

      <div class="nmda-dock-primary-spacer"></div>

      <button class="nmda-dock-status-button" id="nmda-dock-status-button" data-section="status" type="button" aria-label="连接状态" aria-expanded="false">
        <span class="nmda-dock-status-dot" id="nmda-dock-status-dot" data-state="offline"></span>
        <span class="nmda-dock-primary-label">状态</span>
      </button>
    </nav>`;

  document.documentElement.appendChild(host);

  const secondary = host.querySelector('#nmda-mail-dock-secondary');
  const secondaryBody = host.querySelector('#nmda-dock-secondary-body');
  const secondaryName = host.querySelector('#nmda-dock-secondary-name');
  const secondaryDesc = host.querySelector('#nmda-dock-secondary-desc');
  const connection = host.querySelector('#nmda-dock-connection');
  const connectionText = host.querySelector('#nmda-dock-connection-text');
  const accountEl = host.querySelector('#nmda-dock-account');
  const statusDot = host.querySelector('#nmda-dock-status-dot');
  const sectionButtons = [...host.querySelectorAll('[data-section]')];

  let currentSection = 'workflow';
  let openTimer = null;
  let closeTimer = null;
  let lastStatus = { connected: false, account: '' };

  const sections = {
    workflow: {
      name: '邮件作业',
      desc: '导入、审阅、排期与创建',
      items: [
        { target: 'batch', step: '总', title: '批量工作台', detail: '当前批次与作业状态', primary: true },
        { target: 'batch/1', step: '01', title: '资料导入', detail: '邮件、名单与附件' },
        { target: 'batch/2', step: '02', title: '邮件审阅', detail: '收件人、主题、正文与重复' },
        { target: 'batch/3', step: '03', title: '排期与执行', detail: '选择、排期与批量创建' }
      ]
    },
    contacts: {
      name: '联系人',
      desc: '邮箱状态与跟进记录',
      items: [
        { target: 'contacts', step: '联', title: '联系人工作区', detail: '查看邮箱状态与历史记录', primary: true }
      ]
    },
    status: {
      name: '连接状态',
      desc: '浏览器插件与网易邮箱',
      status: true,
      items: []
    }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function setOpen(open) {
    host.dataset.open = open ? 'true' : 'false';
    secondary.setAttribute('aria-hidden', open ? 'false' : 'true');
    sectionButtons.forEach(button => {
      if (!button.classList.contains('nmda-dock-brand-button') && button.id !== 'nmda-dock-compose') {
        button.setAttribute('aria-expanded', open && button.dataset.section === currentSection ? 'true' : 'false');
      }
    });
  }

  function renderSection(sectionName) {
    const section = sections[sectionName] || sections.workflow;
    currentSection = sectionName in sections ? sectionName : 'workflow';
    host.dataset.section = currentSection;
    secondaryName.textContent = section.name;
    secondaryDesc.textContent = section.desc;

    sectionButtons.forEach(button => {
      button.dataset.active = button.dataset.section === currentSection ? 'true' : 'false';
    });

    if (section.status) {
      const online = !!lastStatus.connected;
      secondaryBody.innerHTML = `
        <div class="nmda-dock-status-card" data-state="${online ? 'online' : 'offline'}">
          <div class="nmda-dock-status-card-mark"><span></span></div>
          <div class="nmda-dock-status-card-copy">
            <strong>${online ? '已连接' : '未连接'}</strong>
            <small>${escapeHtml(lastStatus.account || '未识别当前网易邮箱账号')}</small>
          </div>
        </div>
        <div class="nmda-dock-note">一级菜单固定显示；二级菜单在悬停时展开。</div>`;
      return;
    }

    secondaryBody.innerHTML = `
      <div class="nmda-dock-menu">
        ${section.items.map(item => `
          <button class="nmda-dock-menu-row" data-target="${escapeHtml(item.target)}" data-primary="${item.primary ? 'true' : 'false'}" type="button">
            <span class="nmda-dock-menu-step">${escapeHtml(item.step)}</span>
            <span class="nmda-dock-menu-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span>
            <span class="nmda-dock-menu-arrow" aria-hidden="true">→</span>
          </button>`).join('')}
      </div>`;

    secondaryBody.querySelectorAll('[data-target]').forEach(button => {
      button.addEventListener('click', () => openWorkspace(button.dataset.target));
    });
  }

  function showSection(sectionName, delay = 45) {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    openTimer = setTimeout(() => {
      renderSection(sectionName);
      setOpen(true);
      refreshStatus();
    }, delay);
  }

  function scheduleClose() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(false), 260);
  }

  async function refreshStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'NMDA_CONNECTION_STATUS' });
      lastStatus = {
        connected: !!status?.connected,
        account: status?.account ? String(status.account) : ''
      };
      const online = lastStatus.connected;
      connection.dataset.state = online ? 'online' : 'offline';
      connectionText.textContent = online ? '已连接' : '未连接';
      statusDot.dataset.state = online ? 'online' : 'offline';
      accountEl.textContent = lastStatus.account || '网易邮箱';
      host.querySelector('#nmda-dock-status-button').title = online
        ? `已连接${lastStatus.account ? ` · ${lastStatus.account}` : ''}`
        : '未连接';
      if (currentSection === 'status' && host.dataset.open === 'true') renderSection('status');
    } catch (_) {
      lastStatus = { connected: false, account: '' };
      connection.dataset.state = 'offline';
      connectionText.textContent = '未连接';
      statusDot.dataset.state = 'offline';
      if (currentSection === 'status' && host.dataset.open === 'true') renderSection('status');
    }
  }

  async function openWorkspace(target) {
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_APP', target: String(target || 'batch') });
      setOpen(false);
    } catch (error) {
      console.warn('[SmartMail Ops] open workspace failed', error);
    }
  }

  host.querySelectorAll('[data-section]').forEach(button => {
    const section = button.dataset.section;
    button.addEventListener('mouseenter', () => showSection(section));
    button.addEventListener('focus', () => showSection(section, 0));
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (host.dataset.open === 'true' && currentSection === section) {
        setOpen(false);
      } else {
        showSection(section, 0);
      }
    });
  });

  secondary.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
  });
  host.addEventListener('mouseleave', scheduleClose);

  host.querySelector('#nmda-dock-compose')?.addEventListener('click', async event => {
    event.stopPropagation();
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_COMPOSE' });
      setOpen(false);
    } catch (error) {
      console.warn('[SmartMail Ops] open compose failed', error);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && String(event.key).toLowerCase() === 'm') {
      event.preventDefault();
      if (host.dataset.open === 'true') setOpen(false);
      else showSection('workflow', 0);
    }
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'NMDA_CONNECTION_CHANGED') refreshStatus();
  });

  renderSection('workflow');
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();
