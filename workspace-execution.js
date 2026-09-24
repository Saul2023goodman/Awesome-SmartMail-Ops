(() => {
  'use strict';

  const Importer = globalThis.NMDAImporter;
  const Runtime = globalThis.NMDAWorkspaceRuntime;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const executionProgressHandlers = new Map();
  function handleProgress(message) {
    if (message?.type !== 'NMDA_EXECUTION_PROGRESS_BROADCAST' && message?.type !== 'NMDA_DRAFT_ATTACHMENT_PROGRESS_BROADCAST') return;
    executionProgressHandlers.get(String(message.executionId || ''))?.(message);
  }
  Runtime.subscribe('NMDA_EXECUTION_PROGRESS_BROADCAST', handleProgress);
  Runtime.subscribe('NMDA_DRAFT_ATTACHMENT_PROGRESS_BROADCAST', handleProgress);

  const runtimeExecutionFiles = new Map();
  let runtimeFileSourcePort = null;

  function bytesToBase64(bytes) {
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + step)));
    return btoa(binary);
  }

  function ensureRuntimeFileSourcePort() {
    if (runtimeFileSourcePort) return runtimeFileSourcePort;
    const port = Runtime.openFileSourcePort();
    runtimeFileSourcePort = port;
    port.onMessage.addListener(message => {
      if (message?.type !== 'NMDA_RUNTIME_FILE_REQUEST') return;
      void (async () => {
        const requestId = String(message.requestId || '');
        const id = String(message.id || '');
        const file = runtimeExecutionFiles.get(id) || null;
        if (!file) {
          port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:false, reason:'runtime-file-not-found' });
          return;
        }
        if (message.action === 'meta') {
          port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:true, id, name:String(file.name||'attachment'), typeName:String(file.type||'application/octet-stream'), size:Number(file.size||0), lastModified:Number(file.lastModified||Date.now()) });
          return;
        }
        if (message.action === 'chunk') {
          const offset = Math.max(0, Number(message.offset || 0));
          const length = Math.max(1, Number(message.length || 262144));
          const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
          port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:true, base64:bytesToBase64(bytes) });
          return;
        }
        port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:false, reason:'unknown-runtime-file-action' });
      })().catch(error => {
        try { port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId:String(message?.requestId||''), ok:false, reason:error?.message||String(error) }); } catch (_) {}
      });
    });
    port.onDisconnect.addListener(() => { if (runtimeFileSourcePort === port) runtimeFileSourcePort = null; });
    return port;
  }

  async function prepareRuntimeFileRefs(files) {
    const refs = [];
    if ((files || []).length) ensureRuntimeFileSourcePort();
    for (const file of files || []) {
      if (!file) continue;
      const id = crypto.randomUUID();
      const assetKey=String(Importer.fileIdentity(file));
      runtimeExecutionFiles.set(id, file);
      refs.push({ id, assetKey, name:String(file.name||'attachment'), size:Number(file.size||0), type:String(file.type||'application/octet-stream'), lastModified:Number(file.lastModified||Date.now()) });
    }
    if (refs.length) await sleep(20);
    return refs;
  }

  function releaseRuntimeFileRefs(refs) {
    for (const ref of refs || []) if (ref?.id) runtimeExecutionFiles.delete(String(ref.id));
  }


  async function executeDraftRemotely(task, { fresh = true, pauseEveryTime = false, ensureParagraphSpacing = true, fastCompose = false, scheduleDisplayAt = '', scheduleTimeZoneLabel = '', onProgress = () => {} } = {}) {
    const executionId = crypto.randomUUID();
    const refs = await prepareRuntimeFileRefs(task.files || []);
    executionProgressHandlers.set(executionId, onProgress);
    try {
      const connection = await Runtime.connectionStatus();
      if (!connection?.connected) throw new Error('没有检测到已打开的网易邮箱。请先点击右上角“打开网易邮箱”并完成登录。');
      if (!connection?.authenticated) throw new Error('网易邮箱页面已打开，但尚未检测到登录账号。请先完成登录。');
      const result = await Runtime.executeDraft({
        executionId, fresh, pauseEveryTime: !!pauseEveryTime, fastCompose: !!fastCompose,
        task: {
          recipients: task.recipients || '', cc: task.cc || '', bcc: task.bcc || '',
          subject: task.subject || '', body: task.body || '',
          bodyHtml: task.bodyHtml || '', bodyIsHtml: !!task.bodyIsHtml, ensureParagraphSpacing: ensureParagraphSpacing !== false,
          priority: Number(task.priority || 0) || 0, requestReadReceipt: !!task.requestReadReceipt,
          scheduleAt: task.scheduleAt || '', scheduleDisplayAt: task.scheduleAt ? scheduleDisplayAt : '', scheduleTimeZoneLabel, attachments: refs,
          composeMode: task.composeMode || 'new', parentMessageId: task.parentMessageId || task.providerMessageId || '', parentFid: Number(task.parentFid || 3) || 3
        }
      });
      if (!result?.ok) throw new Error(result?.reason || '网易邮箱执行器没有完成草稿创建。');
      return result.outcome || {};
    } finally {
      executionProgressHandlers.delete(executionId);
      releaseRuntimeFileRefs(refs);
    }
  }


  async function updateMailboxBatchMonitor(payload = {}) {
    try { return await Runtime.batchMonitor(payload); }
    catch (_) { return null; }
  }

  async function waitForMailboxExecutionReady(timeoutMs = 4500) {
    const deadline = Date.now() + Math.max(800, Number(timeoutMs || 0));
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await Runtime.connectionStatus();
        if (last?.connected && last?.authenticated) return last;
      } catch (_) {}
      await sleep(260);
    }
    return last;
  }

  function onProgress(executionId, handler) {
    const key = String(executionId);
    executionProgressHandlers.set(key, handler);
    return () => executionProgressHandlers.delete(key);
  }

  globalThis.NMDAWorkspaceExecution = Object.freeze({
    prepareRuntimeFileRefs, releaseRuntimeFileRefs, executeDraftRemotely,
    updateMailboxBatchMonitor, waitForMailboxExecutionReady, onProgress
  });
})();
