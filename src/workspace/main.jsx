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
 * Shared connection state is initialized by workspace-connection.js before
 * this bundle runs.
 */
document.querySelectorAll('[data-workspace-mount="mailbox-connection"]').forEach(host => {
  createRoot(host).render(
    <StrictMode>
      <MailboxConnection />
    </StrictMode>
  );
});
