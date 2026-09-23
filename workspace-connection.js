(() => {
  'use strict';

  // The connection capsule and mailbox sync service observe the same state.
  // This is the only workspace owner of connection messages and refresh triggers.
  const Runtime = globalThis.NMDAWorkspaceRuntime;
  const listeners = new Set();
  let snapshot = {
    status: null,
    error: '',
    cue: { state: 'idle', detail: '' }
  };
  let started = false;
  let unsubscribeRuntime = null;
  let refreshVersion = 0;

  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      try { listener(); }
      catch (error) { console.error('Connection subscriber failed', error); }
    }
  }

  async function refresh() {
    const version = ++refreshVersion;
    try {
      const status = await Runtime.connectionStatus();
      if (!status || typeof status.connected !== 'boolean' || typeof status.authenticated !== 'boolean') {
        throw new Error('邮箱连接状态响应无效。');
      }
      if (version === refreshVersion) publish({ status, error: '' });
      return status;
    } catch (error) {
      if (version === refreshVersion) publish({ status: null, error: error?.message || String(error) });
      throw error;
    }
  }

  async function openMail() {
    try {
      const result = await Runtime.openMail(true);
      if (!result?.ok) throw new Error(result?.reason || '无法打开网易邮箱。');
      setTimeout(() => { void refresh().catch(() => {}); }, 500);
      return result;
    } catch (error) {
      publish({ error: error?.message || String(error) });
      throw error;
    }
  }

  function onRuntimeMessage(message) {
    if (message?.type === 'NMDA_CONNECTION_CHANGED') void refresh().catch(() => {});
  }
  function onFocus() { void refresh().catch(() => {}); }
  function onVisibility() { if (!document.hidden) void refresh().catch(() => {}); }

  function start() {
    if (started) return;
    started = true;
    unsubscribeRuntime = Runtime.subscribe('NMDA_CONNECTION_CHANGED', onRuntimeMessage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    void refresh().catch(() => {});
  }

  function stop() {
    if (!started) return;
    started = false;
    ++refreshVersion;
    unsubscribeRuntime?.();
    unsubscribeRuntime = null;
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  globalThis.NMDAConnection = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    openMail,
    start,
    stop,
    setSyncCue(state = 'idle', detail = '') {
      publish({ cue: { state: String(state || 'idle'), detail: String(detail || '') } });
    }
  });
})();
