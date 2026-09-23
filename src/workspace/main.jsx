import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MailboxConnection from './MailboxConnection.jsx';
import './mailbox-connection.css';

/**
 * React workspace entry (issue #2).
 *
 * Mount points are plain elements rendered by the legacy buildUI() in app.js
 * and tagged with data-workspace-mount. Module scripts execute after the
 * classic scripts, so the hosts already exist when this runs.
 *
 * The bridge is normally created by app.js; the fallback keeps the workspace
 * renderable when the legacy script is absent (e.g. isolated dev pages).
 */
window.NMDAWorkspaceBridge ||= {
  syncCue: { state: 'idle', detail: '' },
  listeners: new Set(),
  setSyncCue(state, detail = '') {
    this.syncCue = { state: String(state || 'idle'), detail: String(detail || '') };
    this.listeners.forEach(fn => {
      try { fn(this.syncCue); } catch (_) { /* subscriber gone */ }
    });
  },
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
};

document.querySelectorAll('[data-workspace-mount="mailbox-connection"]').forEach(host => {
  createRoot(host).render(
    <StrictMode>
      <MailboxConnection />
    </StrictMode>
  );
});
