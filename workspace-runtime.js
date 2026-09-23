(() => {
  'use strict';

  const subscribers = new Map();
  chrome.runtime.onMessage.addListener(message => {
    const handlers = subscribers.get(message?.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(message); }
      catch (error) { console.error('Workspace runtime event handler failed', error); }
    }
  });

  function subscribe(type, handler) {
    if (!subscribers.has(type)) subscribers.set(type, new Set());
    subscribers.get(type).add(handler);
    return () => subscribers.get(type)?.delete(handler);
  }

  const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
  const connectionStatus = () => send('NMDA_CONNECTION_STATUS');
  const openMail = (focus = true) => send('NMDA_OPEN_MAIL', { focus });
  const openMessage = (messageId, fid = 3) => send('NMDA_OPEN_MAIL_MESSAGE', { messageId:String(messageId), fid:Number(fid) });
  const accountInfo = () => send('NMDA_ACCOUNT_INFO');
  const readSentDetails = messageIds => send('NMDA_READ_SENT_DETAILS', { messageIds });
  const readScheduledDrafts = historyMonths => send('NMDA_READ_SCHEDULED_DRAFTS', { historyMonths });
  const readDedupeHistory = historyMonths => send('NMDA_READ_DEDUPE_HISTORY', { historyMonths });
  const readMailboxState = (mode, historyMonths) => send('NMDA_READ_MAILBOX_STATE', { mode, historyMonths });
  const importDrafts = limit => send('NMDA_IMPORT_DRAFTS', { limit });
  const scanDraftAttachments = () => send('NMDA_SCAN_DRAFT_ATTACHMENTS');
  const executeDraft = payload => send('NMDA_EXECUTE_DRAFT', payload);
  const batchMonitor = payload => send('NMDA_BATCH_MONITOR', { payload });
  const cancelAttachment = executionId => send('NMDA_DRAFT_ATTACHMENT_CANCEL', { executionId });
  const monitorAttachment = ({ payload, focus = false }) => send('NMDA_DRAFT_ATTACHMENT_MONITOR', { focus, payload });
  const seedAttachment = (executionId, file) => send('NMDA_DRAFT_ATTACHMENT_SEED', { executionId, file });
  const mutateAttachment = payload => send('NMDA_DRAFT_ATTACHMENT_MUTATE', payload);
  const cleanupAttachmentSeed = (executionId, identity, draftId) =>
    send('NMDA_DRAFT_ATTACHMENT_SEED_CLEANUP', { executionId, identity, draftId });
  const openFileSourcePort = () => chrome.runtime.connect({ name:'NMDA_RUNTIME_FILE_SOURCE' });

  globalThis.NMDAWorkspaceRuntime = Object.freeze({
    subscribe, connectionStatus, openMail, openMessage, accountInfo,
    readSentDetails, readScheduledDrafts, readDedupeHistory, readMailboxState,
    importDrafts, scanDraftAttachments, executeDraft, batchMonitor,
    cancelAttachment, monitorAttachment, seedAttachment, mutateAttachment,
    cleanupAttachmentSeed, openFileSourcePort
  });
})();
