import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * MailboxConnection — first migrated workspace slice (issue #2).
 *
 * Renders the connection state owned by workspace-connection.js. Runtime
 * messages, refresh triggers and sync cues stay outside this view.
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
  const connection = globalThis.NMDAConnection;
  const { status, error, cue: syncCue } = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const [opening, setOpening] = useState(false);
  const view = error
    ? { state: 'offline', title: '连接状态不可用', detail: error, button: '连接邮箱' }
    : status ? deriveView(status) : INITIAL_VIEW;
  const cue = syncCue?.state === 'idle' && !syncCue.detail ? INITIAL_CUE : cueToView(syncCue);

  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, [connection]);

  async function openMail() {
    setOpening(true);
    try {
      await connection.openMail();
    } catch (error) {
      // The controller publishes the error for the connection detail.
    } finally {
      setOpening(false);
    }
  }

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
