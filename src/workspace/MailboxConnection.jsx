import { useCallback, useEffect, useState } from 'react';

/**
 * MailboxConnection — first migrated workspace slice (issue #2).
 *
 * Owns the header mailbox capsule: polls NMDA_CONNECTION_STATUS through the
 * existing extension runtime (background.js / executor.js are untouched) and
 * renders the connection state plus the automatic sync cue. Legacy app.js keeps
 * the non-visual side effects (account switching, mailbox sync scheduling) by
 * listening to the `nmda:connection-status` window event this component emits
 * after every status refresh; it pushes sync-cue state back through
 * window.NMDAWorkspaceBridge.
 */

const INITIAL_VIEW = Object.freeze({
  state: 'checking',
  title: '正在检查网易邮箱',
  detail: '连接状态',
  button: '连接邮箱'
});

function deriveView(status) {
  const connected = !!status?.connected;
  const authenticated = !!status?.authenticated;
  if (authenticated) {
    return {
      state: 'connected',
      title: status.account ? `网易邮箱 · ${status.account}` : '网易邮箱已连接',
      detail: '已连接',
      button: '切换邮箱'
    };
  }
  if (connected) {
    return { state: 'login', title: '网易邮箱已打开 · 待登录', detail: '请先登录', button: '连接邮箱' };
  }
  return { state: 'offline', title: '网易邮箱未连接', detail: '未连接', button: '连接邮箱' };
}

// Before the first legacy cue arrives the capsule shows its static start text,
// matching the old server-rendered markup.
const INITIAL_CUE = Object.freeze({ state: 'idle', title: '邮箱同步', detail: '保持最新' });

const CUE_TITLES = {
  idle: '自动同步',
  syncing: '正在读取邮箱',
  success: '邮箱已同步',
  error: '同步异常',
  waiting: '等待邮箱连接'
};

const CUE_DETAILS = {
  idle: '保持最新',
  syncing: '已发送 · 草稿 · 收件',
  success: '邮箱已更新',
  error: '稍后自动重试',
  waiting: '登录后自动开始'
};

function cueToView(cue) {
  const state = cue?.state || 'idle';
  return {
    state,
    title: CUE_TITLES[state] || CUE_TITLES.idle,
    detail: cue?.detail || CUE_DETAILS[state] || ''
  };
}

export default function MailboxConnection() {
  const [view, setView] = useState(INITIAL_VIEW);
  const [cue, setCue] = useState(INITIAL_CUE);
  const [opening, setOpening] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'NMDA_CONNECTION_STATUS' });
      setView(deriveView(status));
      // Hand the raw status to legacy app.js for its non-visual side effects.
      window.dispatchEvent(new CustomEvent('nmda:connection-status', { detail: status || {} }));
    } catch (error) {
      setView({
        state: 'offline',
        title: '连接状态不可用',
        detail: error?.message || String(error),
        button: '连接邮箱'
      });
    }
  }, []);

  useEffect(() => {
    const onRuntimeMessage = message => {
      if (message?.type === 'NMDA_CONNECTION_CHANGED') void refresh();
    };
    const onFocus = () => void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };

    chrome.runtime?.onMessage.addListener(onRuntimeMessage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    void refresh();

    return () => {
      chrome.runtime?.onMessage.removeListener(onRuntimeMessage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Legacy mailbox-sync machinery drives the cue state.
  useEffect(() => {
    const bridge = window.NMDAWorkspaceBridge;
    if (!bridge?.subscribe) return undefined;
    const unsubscribe = bridge.subscribe(next => setCue(cueToView(next)));
    const current = bridge.syncCue;
    if (current) setCue(cueToView(current));
    return unsubscribe;
  }, []);

  const openMail = useCallback(async () => {
    setOpening(true);
    try {
      await chrome.runtime.sendMessage({ type: 'NMDA_OPEN_MAIL', focus: true });
    } catch (_) {
      // The refresh below surfaces the resulting offline/error state.
    } finally {
      setOpening(false);
      setTimeout(refresh, 500);
    }
  }, [refresh]);

  return (
    <div className="nmda-mail-connection" data-state={view.state}>
      <span className="nmda-mail-connection-dot"></span>
      <span className="nmda-mail-connection-copy">
        <strong>{view.title}</strong>
        <small className="nmda-mail-connection-detail">{view.detail}</small>
        <span
          className="nmda-mail-auto-sync"
          data-state={cue.state}
          aria-live="polite"
          title="SmartMail 会自动读取邮箱事实"
        >
          <span className="nmda-mail-auto-sync-track" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
          <span className="nmda-mail-auto-sync-copy">
            <strong>{cue.title}</strong>
            <small>{cue.detail}</small>
          </span>
        </span>
      </span>
      <button
        className="nmda-btn nmda-btn-small nmda-mail-open-button"
        type="button"
        onClick={openMail}
        disabled={opening}
      >
        {view.button}
      </button>
    </div>
  );
}
