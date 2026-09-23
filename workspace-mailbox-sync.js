(() => {
  'use strict';

  const Runtime = globalThis.NMDAWorkspaceRuntime;
  const Connection = globalThis.NMDAConnection;
  const Operations = globalThis.NMDAMailboxOperations;
  const State = globalThis.NMDAWorkspaceState;
  const Persistence = globalThis.NMDAWorkspacePersistence;
  const appliedListeners = new Set();
  const lastRun = { quick:0, history:0, full:0 };
  const priority = { quick:1, history:2, full:3 };
  const ttl = { quick:30000, history:5*60*1000, full:10*60*1000 };
  let running = null;
  let runningKind = '';
  let generation = 0;
  let lastConnectionStatus = null;
  let started = false;

  function invalidate() { lastRun.quick = lastRun.history = lastRun.full = 0; }

  function schedule(kind = 'quick', options = {}) {
    queueMicrotask(() => { void request(kind, options).catch(error => console.warn('Automatic mailbox sync failed', error)); });
  }

  function cueForResult(kind, result) {
    const inferred = result?.historicalFollowUpsRecognized ? ` · 历史跟进 ${result.historicalFollowUpsRecognized}` : '';
    const months = Persistence.readHistoryMonths();
    const scope = months ? `最近 ${months} 个月 · ` : '';
    return kind === 'history'
      ? `${scope}历史核验完成${result?.outboundRead != null ? ` · 已发送 ${result.outboundRead}` : ''}${result?.draftsRead != null ? ` · 草稿 ${result.draftsRead}` : ''}${inferred}`
      : `${scope}已发送 ${result?.outboundRead || 0} · 草稿 ${result?.draftsRead || 0} · 收件 ${result?.inboxRead || 0}${inferred}`;
  }

  async function request(kind = 'quick', { force = false, source = 'auto' } = {}) {
    if (!priority[kind]) throw new Error(`Unknown mailbox sync kind: ${kind}`);
    if (!force && lastRun[kind] && Date.now() - lastRun[kind] < ttl[kind]) return null;
    if (running) {
      if (priority[kind] <= priority[runningKind]) return running;
      try { await running; } catch (error) { /* the stronger read still runs */ }
      return request(kind, { force:true, source });
    }

    let currentGeneration = ++generation;
    runningKind = kind;
    running = (async () => {
      try {
        const connection = await Runtime.connectionStatus();
        if (!connection?.connected || !connection?.authenticated) {
          Connection.setSyncCue('waiting', connection?.connected ? '完成登录后自动读取' : '连接网易邮箱后自动读取');
          return null;
        }
        const sourceLabel = source === 'import' ? '导入后核验历史'
          : source === 'ready-handoff' ? '任务就绪自动同步'
          : source.startsWith('tab:') ? '页面切换刷新'
          : source === 'connection' ? '邮箱连接完成' : '自动刷新';
        const detail = kind === 'history' ? `${sourceLabel} · 已发送 + 草稿`
          : kind === 'full' ? `${sourceLabel} · 完整邮箱`
          : `${sourceLabel} · 已发送 + 草稿 + 收件`;
        Connection.setSyncCue('syncing', detail);

        const accountBefore = State.operations.account;
        await State.ensureOperations();
        // A change discovered by this request belongs to its read. A later
        // account change still invalidates the result before it can be applied.
        if (State.operations.account !== accountBefore && generation === currentGeneration + 1) {
          currentGeneration = generation;
        }
        const applied = kind === 'history'
          ? await Operations.readDedupeHistory(State.operations.store)
          : await Operations.readOperations(State.operations.store, kind === 'full' ? 'full' : 'quick');
        if (generation !== currentGeneration) return null;
        State.setStore(applied.store);
        lastRun[kind] = Date.now();
        if (kind === 'full') lastRun.quick = lastRun.full;
        for (const listener of appliedListeners) {
          try { listener(applied); }
          catch (error) { console.error('Mailbox sync view update failed', error); }
        }
        Connection.setSyncCue('success', cueForResult(kind, applied));
        setTimeout(() => {
          if (generation === currentGeneration && !running && Connection.getSnapshot().status?.authenticated) {
            Connection.setSyncCue('idle', '后台按需保持最新');
          }
        }, 2200);
        return applied;
      } catch (error) {
        Connection.setSyncCue('error', error?.message || String(error));
        setTimeout(() => {
          if (generation === currentGeneration && !running && Connection.getSnapshot().status?.authenticated) {
            Connection.setSyncCue('idle', '稍后自动重试');
          }
        }, 4200);
        throw error;
      }
    })();
    try { return await running; }
    finally { running = null; runningKind = ''; }
  }

  async function onConnectionChanged() {
    const { status, error } = Connection.getSnapshot();
    if (!status || error || status === lastConnectionStatus) return;
    lastConnectionStatus = status;
    if (status.authenticated && status.account) {
      await State.ensureOperations();
      schedule('quick', { source:'connection' });
    } else if (!status.authenticated) {
      ++generation;
      invalidate();
      Connection.setSyncCue('waiting', status.connected ? '完成登录后自动读取' : '连接网易邮箱后自动读取');
    }
  }

  function start() {
    if (started) return;
    started = true;
    State.onAccountChange(() => { ++generation; invalidate(); });
    Connection.subscribe(() => { void onConnectionChanged().catch(error => console.warn('Connection handling failed', error)); });
    setTimeout(() => schedule('quick', { source:'startup' }), 120);
  }

  async function reset() {
    ++generation;
    if (running) { try { await running; } catch (error) { /* reset after failed read */ } }
    ++generation;
    invalidate();
    Connection.setSyncCue('idle', '本地数据已清空；进入邮件监测时可重新读取 163 邮箱');
  }

  globalThis.NMDAWorkspaceMailboxSync = Object.freeze({
    request, schedule, start, reset, invalidate,
    onApplied(listener) { appliedListeners.add(listener); return () => appliedListeners.delete(listener); }
  });
})();
