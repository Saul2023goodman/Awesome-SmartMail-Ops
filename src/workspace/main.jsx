import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MailboxConnection from './MailboxConnection.jsx';
import Dashboard from './Dashboard.jsx';
import Monitor from './Monitor.jsx';
import UtilitiesHome from './UtilitiesHome.jsx';
import { WorkspaceTabs, WorkspacePageHeads } from './Navigation.jsx';
import ReviewBoard, { ReviewPreview, ReviewRail } from './ReviewBoard.jsx';
import { ReviewTop, ReviewBoardbar, ReviewBatchbar, ReviewEmpty, ReviewPreviewToolbar } from './ReviewControls.jsx';
import PlanningBoard from './PlanningBoard.jsx';
import './mailbox-connection.css';

/**
 * React workspace entry. Mount points come from the workspace shell template.
 * The classic service scripts initialize shared state before this module runs.
 */
document.querySelectorAll('[data-workspace-mount="mailbox-connection"]').forEach(host => {
  createRoot(host).render(
    <StrictMode>
      <MailboxConnection />
    </StrictMode>
  );
});

document.querySelectorAll('[data-workspace-mount="dashboard"]').forEach(host => {
  createRoot(host).render(<StrictMode><Dashboard /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="monitor"]').forEach(host => {
  createRoot(host).render(<StrictMode><Monitor /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="utilities-home"]').forEach(host => {
  createRoot(host).render(<StrictMode><UtilitiesHome /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="tabs"]').forEach(host => {
  createRoot(host).render(<StrictMode><WorkspaceTabs /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="page-heads"]').forEach(host => {
  createRoot(host).render(<StrictMode><WorkspacePageHeads /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="review-board"]').forEach(host => {
  createRoot(host).render(<StrictMode><ReviewBoard /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="review-preview"]').forEach(host => {
  createRoot(host).render(<StrictMode><ReviewPreview /></StrictMode>);
});

document.querySelectorAll('[data-workspace-mount="review-rail"]').forEach(host => {
  createRoot(host).render(<StrictMode><ReviewRail /></StrictMode>);
});

for (const [name, Component] of [['review-top', ReviewTop], ['review-boardbar', ReviewBoardbar], ['review-batchbar', ReviewBatchbar], ['review-empty', ReviewEmpty], ['review-preview-toolbar', ReviewPreviewToolbar]]) {
  document.querySelectorAll(`[data-workspace-mount="${name}"]`).forEach(host => {
    createRoot(host).render(<StrictMode><Component /></StrictMode>);
  });
}

document.querySelectorAll('[data-workspace-mount="planning-board"]').forEach(host => {
  createRoot(host).render(<StrictMode><PlanningBoard /></StrictMode>);
});
