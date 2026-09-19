(() => {
  'use strict';
  if (window.top !== window || document.getElementById('nmda-mail-dock-host')) return;

  const host = document.createElement('div');
  host.id = 'nmda-mail-dock-host';
  host.dataset.open = 'false';
  host.dataset.section = 'workflow';
  host.dataset.execution = 'idle';
  host.innerHTML = `
    <section id="nmda-mail-dock-panel" class="nmda-dock-panel" aria-label="SmartMail 控制中心" aria-hidden="true">
      <header class="nmda-dock-panel-head">
        <div class="nmda-dock-panel-title">
          <span>SMARTMAIL OPS</span>
          <strong id="nmda-dock-panel-name">邮件作业</strong>
          <small id="nmda-dock-panel-desc">准备、监测与统一执行</small>
        </div>
        <button class="nmda-dock-close" id="nmda-dock-close" type="button" aria-label="关闭">×</button>
      </header>

      <nav class="nmda-dock-tabs" aria-label="SmartMail 模块">
        <button type="button" data-section="workflow">作业</button>
        <button type="button" data-section="monitor">监测</button>
        <button type="button" data-section="execution">执行<span class="nmda-dock-tab-badge" id="nmda-dock-tab-execution-badge" hidden></span></button>
        <button type="button" data-section="status">状态</button>
      </nav>

      <div class="nmda-dock-panel-body" id="nmda-dock-panel-body"></div>
      <footer class="nmda-dock-panel-foot">
        <span class="nmda-dock-account"><i id="nmda-dock-connection-dot"></i><span id="nmda-dock-account">网易邮箱</span></span>
        <button id="nmda-dock-compose" type="button">写信</button>
      </footer>
    </section>

    <button id="nmda-dock-launcher" class="nmda-dock-launcher" type="button" aria-label="打开 SmartMail" aria-expanded="false" title="SmartMail Ops · Alt+M">
      <span class="nmda-dock-launcher-mark">SM</span>
      <span class="nmda-dock-launcher-dot" id="nmda-dock-launcher-dot"></span>
      <span class="nmda-dock-exec-badge" id="nmda-dock-exec-badge" hidden></span>
    </button>`;

  document.documentElement.appendChild(host);

  const panel = host.querySelector('#nmda-mail-dock-panel');
  const panelBody = host.querySelector('#nmda-dock-panel-body');
  const panelName = host.querySelector('#nmda-dock-panel-name');
  const panelDesc = host.querySelector('#nmda-dock-panel-desc');
  const launcher = host.querySelector('#nmda-dock-launcher');
  const launcherDot = host.querySelector('#nmda-dock-launcher-dot');
  const execBadge = host.querySelector('#nmda-dock-exec-badge');
  const tabExecBadge = host.querySelector('#nmda-dock-tab-execution-badge');
  const accountEl = host.querySelector('#nmda-dock-account');
  const connectionDot = host.querySelector('#nmda-dock-connection-dot');
  const tabButtons = [...host.querySelectorAll('.nmda-dock-tabs [data-section]')];

  let currentSection = 'workflow';
  let lastNonExecutionSection = 'workflow';
  let lastStatus = { connected: false, account: '' };
  const execution = {
    total: 0,
    current: 0,
    succeeded: 0,
    failed: 0,
    remaining: 0,
    status: 'idle',
    task: null,
    message: '',
    events: []
  };

  const sections = {
    workflow: { name: '邮件作业', desc: '导入、审阅与选择排期' },
    monitor: { name: '邮件监测', desc: '人工读取回复并生成 Follow-up' },
    execution: { name: '执行状态', desc: '统一查看当前草稿执行' },
    status: { name: '连接状态', desc: 'SmartMail 与当前网易邮箱' }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function isExecutionFinished() {
    return ['done', 'error', 'stopped'].includes(execution.status);
  }

  function setOpen(open) {
    host.dataset.open = open ? 'true' : 'false';
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function openWorkspace(target) {
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_APP', target: String(target || 'batch') });
      setOpen(false);
    } catch (error) {
      console.warn('[SmartMail Ops] open workspace failed', error);
    }
  }

  function renderWorkflow() {
    panelBody.innerHTML = `
      <div class="nmda-dock-menu">
        <button class="nmda-dock-menu-row" data-target="batch" type="button"><span>导</span><div><strong>导入资料</strong><small>识别来源、查重与附件准备</small></div><b>→</b></button>
        <button class="nmda-dock-menu-row" data-target="review" type="button"><span>审</span><div><strong>邮件审阅</strong><small>核对初始邮件并完成 Pass</small></div><b>→</b></button>
        <button class="nmda-dock-menu-row" data-target="dispatch" type="button"><span>排</span><div><strong>选择与排期</strong><small>Initial + Follow-up 统一执行</small></div><b>→</b></button>
      </div>`;
    panelBody.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => openWorkspace(button.dataset.target)));
  }

  function renderMonitor() {
    panelBody.innerHTML = `
      <div class="nmda-dock-callout">
        <strong>邮件监测</strong>
        <small>人工读取邮箱事实，识别回复并批量生成 Follow-up Task。</small>
        <button type="button" data-target="monitor">打开邮件监测</button>
      </div>`;
    panelBody.querySelector('[data-target="monitor"]')?.addEventListener('click', () => openWorkspace('monitor'));
  }

  function renderStatus() {
    const online = !!lastStatus.connected;
    panelBody.innerHTML = `
      <div class="nmda-dock-status-card" data-state="${online ? 'online' : 'offline'}">
        <i></i>
        <div><strong>${online ? '已连接' : '未连接'}</strong><small>${escapeHtml(lastStatus.account || '未识别当前网易邮箱账号')}</small></div>
      </div>
      <div class="nmda-dock-note">SmartMail 不会后台轮询邮箱；邮箱事实只在你主动读取时更新。</div>`;
  }

  function executionPct() {
    if (!execution.total) return 0;
    const done = Math.max(0, Number(execution.succeeded || 0) + Number(execution.failed || 0));
    if (execution.status === 'done') return 100;
    return Math.min(100, Math.max(0, (done / Number(execution.total)) * 100));
  }

  function renderExecution() {
    if (execution.status === 'idle') {
      panelBody.innerHTML = `
        <div class="nmda-dock-exec-empty">
          <span>EXECUTION</span>
          <strong>当前没有执行任务</strong>
          <small>Initial 与 Follow-up 都从「选择与排期」进入同一个执行队列。</small>
          <button type="button" data-target="dispatch">打开选择与排期</button>
        </div>`;
      panelBody.querySelector('[data-target="dispatch"]')?.addEventListener('click', () => openWorkspace('dispatch'));
      return;
    }

    const finished = isExecutionFinished();
    const done = Math.max(0, Number(execution.succeeded || 0) + Number(execution.failed || 0));
    const events = execution.events.slice(0, 5).map(item => `
      <div class="nmda-dock-exec-event" data-kind="${escapeHtml(item.kind || '')}">
        <i></i><div><strong>${escapeHtml(item.title || '')}</strong><small>${escapeHtml(item.detail || '')}</small></div>
      </div>`).join('');

    panelBody.innerHTML = `
      <div class="nmda-dock-exec" data-state="${escapeHtml(execution.status)}">
        <div class="nmda-dock-exec-summary">
          <div><span>${finished ? '执行结果' : '正在执行'}</span><strong>${done} / ${Number(execution.total || 0)}</strong></div>
          <div class="nmda-dock-exec-stats"><span>成功 <b>${Number(execution.succeeded || 0)}</b></span><span>剩余 <b>${Math.max(0, Number(execution.remaining || 0))}</b></span></div>
        </div>
        <div class="nmda-dock-exec-progress"><i style="width:${executionPct()}%"></i></div>
        <div class="nmda-dock-exec-current">
          <div><span>当前任务</span><b>${execution.current && execution.total ? `${Number(execution.current)} / ${Number(execution.total)}` : '—'}</b></div>
          <strong>${escapeHtml(execution.task?.recipient || (finished ? '本次执行已结束' : '等待下一封邮件'))}</strong>
          <small>${escapeHtml(execution.task?.subject || '')}</small>
          <p>${escapeHtml(execution.message || (finished ? '可以返回选择与排期查看结果。' : '正在准备执行队列。'))}</p>
        </div>
        <div class="nmda-dock-exec-events">${events || '<div class="nmda-dock-exec-event is-muted"><i></i><div><strong>等待执行事件</strong><small>进度会显示在这里</small></div></div>'}</div>
        <div class="nmda-dock-exec-actions">
          ${!finished ? '<button type="button" data-role="stop">当前封后停止</button>' : ''}
          <button type="button" data-target="dispatch" class="is-primary">${finished ? '返回选择与排期' : '打开选择与排期'}</button>
        </div>
      </div>`;

    panelBody.querySelector('[data-role="stop"]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = '已请求停止';
      await chrome.runtime.sendMessage({ type: 'NMDA_BATCH_STOP_REQUEST' }).catch(() => {});
    });
    panelBody.querySelector('[data-target="dispatch"]')?.addEventListener('click', () => openWorkspace('dispatch'));
  }

  function renderSection(sectionName) {
    const section = sections[sectionName] || sections.workflow;
    currentSection = sectionName in sections ? sectionName : 'workflow';
    if (currentSection !== 'execution') lastNonExecutionSection = currentSection;
    host.dataset.section = currentSection;
    panelName.textContent = section.name;
    panelDesc.textContent = section.desc;
    tabButtons.forEach(button => button.dataset.active = button.dataset.section === currentSection ? 'true' : 'false');

    if (currentSection === 'workflow') renderWorkflow();
    else if (currentSection === 'monitor') renderMonitor();
    else if (currentSection === 'execution') renderExecution();
    else renderStatus();
  }

  function openPanel(preferredSection) {
    const section = preferredSection || (execution.status !== 'idle' ? 'execution' : lastNonExecutionSection || 'workflow');
    renderSection(section);
    setOpen(true);
    refreshStatus();
  }

  function executionEvent(kind, title, detail = '') {
    execution.events.unshift({ kind, title, detail, time: Date.now() });
    execution.events = execution.events.slice(0, 6);
  }

  function syncExecutionChrome() {
    host.dataset.execution = execution.status || 'idle';
    const active = execution.status !== 'idle';
    const done = Math.max(0, Number(execution.succeeded || 0) + Number(execution.failed || 0));
    const text = execution.status === 'running'
      ? `${Math.min(Number(execution.current || done || 0), Number(execution.total || 0))}/${Number(execution.total || 0)}`
      : execution.status === 'done' ? '✓' : ['error', 'stopped'].includes(execution.status) ? '!' : '';
    execBadge.hidden = !active;
    execBadge.textContent = text;
    tabExecBadge.hidden = !active;
    tabExecBadge.textContent = execution.status === 'running' ? `${Math.min(Number(execution.current || done || 0), Number(execution.total || 0))}/${Number(execution.total || 0)}` : text;
    launcher.title = execution.status === 'running'
      ? `SmartMail 正在执行 · ${done}/${Number(execution.total || 0)}`
      : 'SmartMail Ops · Alt+M';
    if (currentSection === 'execution' && host.dataset.open === 'true') renderSection('execution');
  }

  function updateExecution(payload = {}) {
    const action = String(payload.action || '');
    if (action === 'start') {
      Object.assign(execution, {
        total: Number(payload.total || 0), current: 0, succeeded: 0, failed: 0,
        remaining: Number(payload.remaining ?? payload.total ?? 0), status: 'running',
        task: null, message: '正在准备第一封邮件。', events: []
      });
      executionEvent('running', '执行已开始', `共 ${execution.total} 封邮件`);
    } else if (action === 'task-start') {
      Object.assign(execution, {
        current: Number(payload.current || 0), total: Number(payload.total || execution.total),
        succeeded: Number(payload.succeeded || 0), failed: Number(payload.failed || 0),
        remaining: Number(payload.remaining ?? execution.remaining), status: 'running',
        task: payload.task || null, message: '正在打开写信页…'
      });
      executionEvent('running', `开始 ${payload.task?.id || `第 ${payload.current} 封`}`, payload.task?.subject || payload.task?.recipient || '');
    } else if (action === 'task-progress') {
      Object.assign(execution, {
        current: Number(payload.current || execution.current), total: Number(payload.total || execution.total),
        succeeded: Number(payload.succeeded ?? execution.succeeded), failed: Number(payload.failed ?? execution.failed),
        remaining: Number(payload.remaining ?? execution.remaining), task: payload.task || execution.task,
        message: String(payload.message || '正在处理…')
      });
    } else if (action === 'task-done') {
      Object.assign(execution, {
        current: Number(payload.current || execution.current), succeeded: Number(payload.succeeded || execution.succeeded),
        failed: Number(payload.failed || execution.failed), remaining: Number(payload.remaining ?? execution.remaining),
        task: payload.task || execution.task, message: String(payload.message || '草稿已保存')
      });
      executionEvent('done', `${payload.task?.id || '当前邮件'} 已完成`, payload.task?.subject || payload.task?.recipient || '');
    } else if (action === 'task-error') {
      Object.assign(execution, {
        current: Number(payload.current || execution.current), succeeded: Number(payload.succeeded || execution.succeeded),
        failed: Number(payload.failed || execution.failed), remaining: Number(payload.remaining ?? execution.remaining),
        task: payload.task || execution.task, message: String(payload.message || '执行失败'), status: 'error'
      });
      executionEvent('error', `${payload.task?.id || '当前邮件'} 执行失败`, payload.message || '');
    } else if (action === 'finish') {
      Object.assign(execution, {
        total: Number(payload.total || execution.total), succeeded: Number(payload.succeeded || 0),
        failed: Number(payload.failed || 0), remaining: Number(payload.remaining || 0),
        status: String(payload.status || 'done'), message: String(payload.message || '执行结束')
      });
      executionEvent(execution.status === 'done' ? 'done' : 'error', execution.status === 'done' ? '全部完成' : '执行结束', execution.message);
    }
    syncExecutionChrome();
    return { ok: true };
  }

  async function refreshStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'NMDA_CONNECTION_STATUS' });
      lastStatus = { connected: !!status?.connected, account: status?.account ? String(status.account) : '' };
    } catch (_) {
      lastStatus = { connected: false, account: '' };
    }
    const online = !!lastStatus.connected;
    launcherDot.dataset.state = online ? 'online' : 'offline';
    connectionDot.dataset.state = online ? 'online' : 'offline';
    accountEl.textContent = lastStatus.account || (online ? '已连接网易邮箱' : '网易邮箱未连接');
    if (currentSection === 'status' && host.dataset.open === 'true') renderSection('status');
  }

  launcher.addEventListener('click', event => {
    event.stopPropagation();
    if (host.dataset.open === 'true') setOpen(false);
    else openPanel();
  });
  host.querySelector('#nmda-dock-close')?.addEventListener('click', () => setOpen(false));

  tabButtons.forEach(button => button.addEventListener('click', () => renderSection(button.dataset.section)));

  host.querySelector('#nmda-dock-compose')?.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_COMPOSE' });
      setOpen(false);
    } catch (error) {
      console.warn('[SmartMail Ops] open compose failed', error);
    }
  });

  document.addEventListener('pointerdown', event => {
    if (host.dataset.open !== 'true') return;
    if (!host.contains(event.target)) setOpen(false);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && String(event.key).toLowerCase() === 'm') {
      event.preventDefault();
      if (host.dataset.open === 'true') setOpen(false);
      else openPanel();
    }
    if (event.key === 'Escape' && host.dataset.open === 'true') setOpen(false);
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'NMDA_CONNECTION_CHANGED') {
      refreshStatus();
      return;
    }
    if (message?.type === 'NMDA_BATCH_MONITOR') {
      try { sendResponse(updateExecution(message.payload || {})); }
      catch (error) { sendResponse({ ok: false, reason: error?.message || String(error) }); }
    }
  });

  renderSection('workflow');
  syncExecutionChrome();
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();
