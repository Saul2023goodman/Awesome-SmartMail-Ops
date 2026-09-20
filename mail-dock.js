(() => {
  'use strict';
  if (window.top !== window || document.getElementById('nmda-mail-dock-host')) return;

  const host = document.createElement('div');
  host.id = 'nmda-mail-dock-host';
  host.dataset.open = 'false';
  host.dataset.execution = 'idle';
  host.innerHTML = `
    <section id="nmda-mail-dock-panel" class="nmda-dock-panel" aria-label="SmartMail" aria-hidden="true">
      <button id="nmda-dock-open-app" class="nmda-dock-primary" type="button" aria-label="打开 SmartMail">
        <span class="nmda-dock-brand" aria-hidden="true">SM</span>
        <span class="nmda-dock-primary-copy">
          <strong>SmartMail Ops</strong>
          <small><i id="nmda-dock-connection-dot"></i><span id="nmda-dock-account">检查连接中…</span></small>
        </span>
        <span class="nmda-dock-open-arrow" aria-hidden="true">↗</span>
      </button>

      <section id="nmda-dock-execution" class="nmda-dock-execution" hidden aria-label="执行状态">
        <div class="nmda-dock-exec-head">
          <div><span id="nmda-dock-exec-label">执行中</span><strong id="nmda-dock-exec-count">0 / 0</strong></div>
          <span class="nmda-dock-exec-state" id="nmda-dock-exec-state">运行</span>
        </div>
        <div class="nmda-dock-exec-progress"><i id="nmda-dock-exec-progress-bar"></i></div>
        <div class="nmda-dock-exec-current">
          <strong id="nmda-dock-exec-recipient">准备执行…</strong>
          <small id="nmda-dock-exec-subject"></small>
          <p id="nmda-dock-exec-message">正在准备执行队列。</p>
        </div>
        <div class="nmda-dock-exec-actions">
          <button id="nmda-dock-resume" class="is-primary" type="button" hidden>继续保存</button>
          <button id="nmda-dock-stop" type="button">当前封后停止</button>
          <button id="nmda-dock-open-dispatch" type="button">打开选择与排期</button>
        </div>
      </section>
    </section>

    <button id="nmda-dock-launcher" class="nmda-dock-launcher" type="button" aria-label="SmartMail" aria-expanded="false" title="SmartMail Ops · Alt+M">
      <span class="nmda-dock-launcher-mark">SM</span>
      <span class="nmda-dock-launcher-dot" id="nmda-dock-launcher-dot"></span>
      <span class="nmda-dock-exec-badge" id="nmda-dock-exec-badge" hidden></span>
    </button>`;

  document.documentElement.appendChild(host);

  const panel = host.querySelector('#nmda-mail-dock-panel');
  const launcher = host.querySelector('#nmda-dock-launcher');
  const launcherDot = host.querySelector('#nmda-dock-launcher-dot');
  const execBadge = host.querySelector('#nmda-dock-exec-badge');
  const accountEl = host.querySelector('#nmda-dock-account');
  const connectionDot = host.querySelector('#nmda-dock-connection-dot');
  const executionEl = host.querySelector('#nmda-dock-execution');
  const execLabel = host.querySelector('#nmda-dock-exec-label');
  const execCount = host.querySelector('#nmda-dock-exec-count');
  const execState = host.querySelector('#nmda-dock-exec-state');
  const execProgressBar = host.querySelector('#nmda-dock-exec-progress-bar');
  const execRecipient = host.querySelector('#nmda-dock-exec-recipient');
  const execSubject = host.querySelector('#nmda-dock-exec-subject');
  const execMessage = host.querySelector('#nmda-dock-exec-message');
  const stopButton = host.querySelector('#nmda-dock-stop');
  const resumeButton = host.querySelector('#nmda-dock-resume');

  let lastStatus = { connected: false, account: '' };
  let executionResetTimer = null;
  const execution = {
    total: 0,
    current: 0,
    succeeded: 0,
    failed: 0,
    remaining: 0,
    status: 'idle',
    executionId: '',
    task: null,
    message: ''
  };

  function setOpen(open) {
    host.dataset.open = open ? 'true' : 'false';
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function openWorkspace(target = 'batch') {
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_APP', target: String(target || 'batch') });
      setOpen(false);
    } catch (error) {
      console.warn('[SmartMail Ops] open workspace failed', error);
    }
  }

  function executionPct() {
    if (!execution.total) return 0;
    const done = Math.max(0, Number(execution.succeeded || 0) + Number(execution.failed || 0));
    if (execution.status === 'done') return 100;
    return Math.min(100, Math.max(0, (done / Number(execution.total)) * 100));
  }

  function hasExecutionContext() {
    return execution.status !== 'idle';
  }

  function renderExecution() {
    const visible = hasExecutionContext();
    executionEl.hidden = !visible;
    host.dataset.execution = execution.status || 'idle';
    if (!visible) return;

    const done = Math.max(0, Number(execution.succeeded || 0) + Number(execution.failed || 0));
    const current = Math.min(Math.max(Number(execution.current || done || 0), 0), Math.max(Number(execution.total || 0), 0));
    const finished = ['done', 'error', 'stopped'].includes(execution.status);
    const paused = execution.status === 'paused';
    const stateLabel = execution.status === 'done' ? '完成' : execution.status === 'error' ? '异常' : execution.status === 'stopped' ? '已停止' : paused ? '待确认' : '运行';

    execLabel.textContent = paused ? '等待人工检查' : execution.status === 'running' ? '正在执行' : '执行结果';
    execCount.textContent = `${finished ? done : current} / ${Number(execution.total || 0)}`;
    execState.textContent = stateLabel;
    execState.dataset.state = execution.status;
    execProgressBar.style.width = `${executionPct()}%`;
    execRecipient.textContent = execution.task?.recipient || (finished ? '本次执行已结束' : '准备下一封邮件…');
    execSubject.textContent = execution.task?.subject || '';
    execMessage.textContent = execution.message || (finished ? `成功 ${Number(execution.succeeded || 0)} · 失败 ${Number(execution.failed || 0)}` : '正在处理…');
    resumeButton.hidden = !paused;
    resumeButton.disabled = false;
    resumeButton.textContent = '继续保存';
    stopButton.hidden = finished;
    stopButton.disabled = false;
    stopButton.textContent = '当前封后停止';
  }

  function syncExecutionChrome() {
    renderExecution();
    const active = hasExecutionContext();
    const done = Math.max(0, Number(execution.succeeded || 0) + Number(execution.failed || 0));
    const text = ['running','paused'].includes(execution.status)
      ? `${Math.min(Number(execution.current || done || 0), Number(execution.total || 0))}/${Number(execution.total || 0)}`
      : execution.status === 'done' ? '✓' : ['error', 'stopped'].includes(execution.status) ? '!' : '';
    execBadge.hidden = !active;
    execBadge.textContent = text;
    launcher.title = execution.status === 'paused' ? 'SmartMail 等待人工检查' : execution.status === 'running'
      ? `SmartMail 正在执行 · ${done}/${Number(execution.total || 0)}`
      : 'SmartMail Ops · Alt+M';
  }

  function updateExecution(payload = {}) {
    const action = String(payload.action || '');
    if (action === 'start') {
      if (executionResetTimer) { clearTimeout(executionResetTimer); executionResetTimer = null; }
      Object.assign(execution, {
        total: Number(payload.total || 0), current: 0, succeeded: 0, failed: 0,
        remaining: Number(payload.remaining ?? payload.total ?? 0), status: 'running', executionId:'',
        task: null, message: '正在准备第一封邮件。'
      });
      setOpen(true);
    } else if (action === 'task-start') {
      Object.assign(execution, {
        current: Number(payload.current || 0), total: Number(payload.total || execution.total),
        succeeded: Number(payload.succeeded || 0), failed: Number(payload.failed || 0),
        remaining: Number(payload.remaining ?? execution.remaining), status: 'running', executionId:'',
        task: payload.task || null, message: '正在打开写信页…'
      });
    } else if (action === 'task-progress') {
      const phase = String(payload.phase || '');
      Object.assign(execution, {
        current: Number(payload.current || execution.current), total: Number(payload.total || execution.total),
        succeeded: Number(payload.succeeded ?? execution.succeeded), failed: Number(payload.failed ?? execution.failed),
        remaining: Number(payload.remaining ?? execution.remaining), task: payload.task || execution.task,
        executionId: String(payload.executionId || execution.executionId || ''),
        status: phase === 'paused' ? 'paused' : 'running',
        message: String(payload.message || '正在处理…')
      });
      if (phase === 'paused') setOpen(true);
    } else if (action === 'task-done') {
      Object.assign(execution, {
        current: Number(payload.current || execution.current), succeeded: Number(payload.succeeded || execution.succeeded),
        failed: Number(payload.failed || execution.failed), remaining: Number(payload.remaining ?? execution.remaining),
        task: payload.task || execution.task, executionId:'', message: String(payload.message || '草稿已保存'), status:'running'
      });
    } else if (action === 'task-error') {
      Object.assign(execution, {
        current: Number(payload.current || execution.current), succeeded: Number(payload.succeeded || execution.succeeded),
        failed: Number(payload.failed || execution.failed), remaining: Number(payload.remaining ?? execution.remaining),
        task: payload.task || execution.task, executionId:'', message: String(payload.message || '执行失败'), status: 'error'
      });
      setOpen(true);
    } else if (action === 'finish') {
      Object.assign(execution, {
        total: Number(payload.total || execution.total), succeeded: Number(payload.succeeded || 0),
        failed: Number(payload.failed || 0), remaining: Number(payload.remaining || 0),
        status: String(payload.status || 'done'), executionId:'', message: String(payload.message || '执行结束')
      });
      setOpen(true);
      if (executionResetTimer) clearTimeout(executionResetTimer);
      executionResetTimer = setTimeout(() => {
        execution.status = 'idle';
        execution.task = null;
        execution.message = '';
        executionResetTimer = null;
        syncExecutionChrome();
      }, 6000);
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
    accountEl.textContent = lastStatus.account || (online ? '网易邮箱已连接' : '网易邮箱未连接');
  }

  launcher.addEventListener('click', event => {
    event.stopPropagation();
    if (host.dataset.open === 'true') setOpen(false);
    else {
      setOpen(true);
      refreshStatus();
      renderExecution();
    }
  });

  host.querySelector('#nmda-dock-open-app')?.addEventListener('click', () => openWorkspace('batch'));
  host.querySelector('#nmda-dock-open-dispatch')?.addEventListener('click', () => openWorkspace('dispatch'));

  resumeButton?.addEventListener('click', async event => {
    const executionId = String(execution.executionId || '');
    if (!executionId) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = '继续中…';
    const result = await chrome.runtime.sendMessage({ type:'NMDA_EXECUTION_RESUME_REQUEST', executionId }).catch(error => ({ok:false,reason:error?.message||String(error)}));
    if (!result?.ok) {
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = '继续保存';
      execMessage.textContent = `无法继续：${result?.reason || '执行状态已变化'}`;
    }
  });

  stopButton?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = '已请求停止';
    await chrome.runtime.sendMessage({ type: 'NMDA_BATCH_STOP_REQUEST' }).catch(() => {});
    if (execution.status === 'paused' && execution.executionId) {
      await chrome.runtime.sendMessage({ type:'NMDA_EXECUTION_RESUME_REQUEST', executionId:String(execution.executionId) }).catch(() => {});
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
      else {
        setOpen(true);
        refreshStatus();
        renderExecution();
      }
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

  syncExecutionChrome();
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();
