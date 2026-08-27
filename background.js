'use strict';

function runMain(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args
  }).then(results => results?.[0]?.result || { ok: false, reason: 'no-execution-result' });
}

function readMailbox(tabId, fid, requested) {
  const raw = String(requested ?? '200').trim().toLowerCase();
  const requestedLimit = raw === 'all' || raw === '-1' ? -1 : Number(raw || 200);
  return runMain(tabId, (fidArg, requestedArg) => new Promise(async resolve => {
    try {
      if (!window.$?.DataAction) return resolve({ ok: false, reason: '$.DataAction unavailable' });
      const uid = typeof window.$S === 'function' ? String(window.$S('uid') || '') : '';
      const PAGE_SIZE = 200;
      // Full rebuild is an explicit maintenance operation. Keep a high safety ceiling,
      // but never call a capped scan 'complete'.
      const HARD_MAX = 100000;
      const MAX_PAGES = 600;
      const requestedAll = Number(requestedArg) < 0;
      const wanted = requestedAll ? HARD_MAX : Math.max(1, Math.min(HARD_MAX, Number(requestedArg) || 200));

      function requestPage(extra = {}, limit = PAGE_SIZE) {
        return new Promise((res, rej) => {
          try {
            const dataAction = new window.$.DataAction();
            dataAction.wmsvr({
              func: 'mbox:listMessages',
              body: {
                order: 'date',
                desc: true,
                fid: fidArg,
                summaryWindowSize: 0,
                limit,
                returnTotal: true,
                skipLockedFolders: true,
                ...extra
              },
              call(response) { res(response || {}); },
              error(error) { rej(new Error(error?.message || error?.code || 'mbox:listMessages failed')); },
              ignoreError: true
            });
          } catch (error) { rej(error); }
        });
      }

      function parseRecipients(item) {
        const recipients = [];
        try {
          const parsed = window.$.Uri?.getEmails?.(String(item?.to || ''));
          for (const match of parsed?.match || []) {
            const email = String(match?.address || '').trim().toLowerCase();
            if (!email) continue;
            recipients.push({ email, name: String(match?.name || '').trim() });
          }
        } catch (_) {}
        return recipients;
      }

      function normalize(item) {
        let sndStatus = item?.sndStatus;
        const flags = item?.flags || {};
        if (fidArg === 3) {
          if (typeof sndStatus !== 'number') {
            const queued = !!flags.rcptQueued, succeeded = !!flags.rcptSucceed, failed = !!flags.rcptFailed;
            if (queued || succeeded || failed) sndStatus = succeeded ? (failed ? 5 : 1) : (failed ? 4 : 1);
          } else if (sndStatus === 3 && flags.rcptFailed) sndStatus = 4;
        }
        const timestamp = item?.sentDate ?? item?.date ?? item?.receivedDate ?? item?.modifiedDate ?? '';
        return {
          id: String(item?.id || item?.mid || ''),
          subject: String(item?.subject || ''),
          toRaw: String(item?.to || ''),
          recipients: parseRecipients(item),
          sentAt: timestamp,
          savedAt: timestamp,
          sndStatus: typeof sndStatus === 'number' ? sndStatus : null,
          failed: fidArg === 3 && typeof sndStatus === 'number' ? sndStatus > 3 : false
        };
      }

      const seen = new Set();
      const messages = [];
      let total = 0;
      let totalKnown = false;
      let exhausted = false;
      let mode = null;
      let lastRaw = null;
      let pages = 0;
      let stopReason = '';

      function append(response) {
        const items = Array.isArray(response?.var) ? response.var : [];
        if (response?.total !== undefined && response?.total !== null && Number.isFinite(Number(response.total))) { total = Math.max(total, Number(response.total)); totalKnown = true; }
        let added = 0;
        for (const item of items) {
          const parsed = normalize(item);
          const key = parsed.id || `${parsed.savedAt}|${parsed.subject}|${parsed.toRaw}`;
          if (seen.has(key)) continue;
          seen.add(key);
          messages.push(parsed);
          added++;
        }
        lastRaw = items[items.length - 1] || lastRaw;
        return { items, added };
      }

      const firstLimit = Math.min(PAGE_SIZE, wanted);
      const first = await requestPage({}, firstLimit);
      pages++;
      const firstOutcome = append(first);
      if (!totalKnown && firstOutcome.items.length < firstLimit) exhausted = true;

      async function probeMode() {
        const lastId = String(lastRaw?.id || lastRaw?.mid || '');
        const candidates = [];
        if (lastId) candidates.push({ name: 'start-id', extra: { start: lastId } });
        candidates.push({ name: 'offset', extra: { offset: messages.length } });
        candidates.push({ name: 'start-index', extra: { start: messages.length } });
        for (const candidate of candidates) {
          try {
            const before = messages.length;
            const response = await requestPage(candidate.extra, Math.min(PAGE_SIZE, Math.max(1, wanted - messages.length)));
            pages++;
            const outcome = append(response);
            if (outcome.added > 0 && messages.length > before) {
              mode = candidate.name;
              if (outcome.items.length < Math.min(PAGE_SIZE, Math.max(1, wanted - before))) exhausted = true;
              return true;
            }
          } catch (_) {}
        }
        return false;
      }

      while (messages.length < wanted && !exhausted && (!totalKnown || messages.length < total) && pages < MAX_PAGES) {
        if (!mode) {
          const ok = await probeMode();
          if (!ok) { stopReason = 'pagination-unavailable'; break; }
          continue;
        }
        const lastId = String(lastRaw?.id || lastRaw?.mid || '');
        let extra = {};
        if (mode === 'start-id') extra = { start: lastId };
        else if (mode === 'offset') extra = { offset: messages.length };
        else extra = { start: messages.length };
        try {
          const before = messages.length;
          const pageLimit = Math.min(PAGE_SIZE, Math.max(1, wanted - messages.length));
          const response = await requestPage(extra, pageLimit);
          pages++;
          const outcome = append(response);
          if (!outcome.added || messages.length === before) { stopReason = 'pagination-stalled'; break; }
          if (outcome.items.length < pageLimit) exhausted = true;
        } catch (error) {
          stopReason = error?.message || 'pagination-failed';
          break;
        }
      }

      const effectiveTotal = totalKnown ? Math.max(total, messages.length) : messages.length;
      const targetCount = requestedAll ? Math.min(totalKnown ? effectiveTotal : messages.length, HARD_MAX) : Math.min(wanted, totalKnown ? effectiveTotal : messages.length);
      const resultMessages = messages.slice(0, targetCount);
      const complete = totalKnown ? (resultMessages.length >= effectiveTotal || effectiveTotal === 0) : exhausted;
      const reachedRequested = requestedAll ? complete : (resultMessages.length >= wanted || complete);
      if (requestedAll && totalKnown && effectiveTotal > HARD_MAX) stopReason = `hard-cap-${HARD_MAX}`;
      if (!complete && pages >= MAX_PAGES && !stopReason) stopReason = `page-cap-${MAX_PAGES}`;

      resolve({
        ok: true,
        uid,
        fid: fidArg,
        total: effectiveTotal,
        messages: resultMessages,
        pages,
        paginationMode: mode || 'single-page',
        complete,
        reachedRequested,
        truncated: !complete && (requestedAll || resultMessages.length < effectiveTotal),
        stopReason,
        hardMax: HARD_MAX
      });
    } catch (error) {
      resolve({ ok: false, reason: error?.message || String(error) });
    }
  }), [fid, requestedLimit]);
}

async function readMailboxState(tabId, mode = 'quick') {
  const full = mode === 'full';
  const requested = full ? 'all' : 500;
  const sent = await readMailbox(tabId, 3, requested);
  if (!sent?.ok) return { ok: false, phase: 'sent', reason: sent?.reason || '读取已发送失败', sent };
  const drafts = await readMailbox(tabId, 2, requested);
  if (!drafts?.ok) return { ok: false, phase: 'drafts', reason: drafts?.reason || '读取草稿箱失败', sent, drafts };
  const complete = !!sent.complete && !!drafts.complete;
  return {
    ok: true,
    mode: full ? 'full' : 'quick',
    uid: sent.uid || drafts.uid || '',
    sent, drafts, complete,
    coverage: {
      sent: { read: sent.messages?.length || 0, total: sent.total || 0, complete: !!sent.complete, pages: sent.pages || 0 },
      drafts: { read: drafts.messages?.length || 0, total: drafts.total || 0, complete: !!drafts.complete, pages: drafts.pages || 0 }
    }
  };
}

importScripts('file-vault.js');

const APP_URL = chrome.runtime.getURL('app.html');
const MAIL_URL = 'https://mail.163.com/';

async function listMailTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://mail.163.com/*'] });
  return tabs.sort((a,b) => Number(b.active)-Number(a.active) || Number(b.lastAccessed||0)-Number(a.lastAccessed||0));
}

async function resolveMailTab(sender, { create = false, focus = false } = {}) {
  let tab = sender?.tab?.url?.startsWith('https://mail.163.com/') ? sender.tab : null;
  if (!tab) tab = (await listMailTabs())[0] || null;
  if (!tab && create) tab = await chrome.tabs.create({ url: MAIL_URL, active: !!focus });
  if (tab && focus) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  return tab;
}

async function waitForExecutor(tabId, timeout = 10000) {
  const started = Date.now(); let lastError = null;
  while (Date.now() - started < timeout) {
    try { const ping = await chrome.tabs.sendMessage(tabId, { type: 'NMDA_PING' }); if (ping?.ok) return ping; }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error('网易邮箱执行器尚未就绪');
}

async function accountInfo(tabId) {
  return runMain(tabId, () => {
    try {
      const uid = typeof window.$S === 'function' ? (window.$S('uid') || '') : '';
      return { ok: true, uid: String(uid || '') };
    } catch (error) { return { ok: false, reason: error?.message || String(error) }; }
  });
}

async function connectionStatus(sender) {
  const tab = await resolveMailTab(sender);
  if (!tab?.id) return { ok: true, connected: false, authenticated: false };
  let executor = null;
  try { executor = await chrome.tabs.sendMessage(tab.id, { type: 'NMDA_PING' }); } catch (_) {}
  let account = { ok:false, uid:'' };
  if (executor?.ok) { try { account = await accountInfo(tab.id); } catch (_) {} }
  return {
    ok:true, connected:!!executor?.ok, authenticated:!!String(account?.uid||'').trim(), account:String(account?.uid||''),
    tabId:tab.id, active:!!tab.active, title:tab.title||'', url:tab.url||'', executor:executor?.role||''
  };
}

async function openApp() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => String(tab.url || '').split('#')[0].split('?')[0] === APP_URL);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active:true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId,{focused:true}).catch(()=>{});
    return existing;
  }
  return chrome.tabs.create({ url: APP_URL, active:true });
}

chrome.action.onClicked.addListener(() => { openApp().catch(console.error); });
chrome.runtime.onInstalled.addListener(() => { globalThis.NMDAVault?.cleanup?.().catch(()=>{}); });

function broadcastConnectionChange() {
  chrome.runtime.sendMessage({ type:'NMDA_CONNECTION_CHANGED' }).catch(()=>{});
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (String(tab?.url||'').startsWith('https://mail.163.com/') || String(changeInfo.url||'').startsWith('https://mail.163.com/')) broadcastConnectionChange(); });
chrome.tabs.onRemoved.addListener(() => { broadcastConnectionChange(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'NMDA_CONNECTION_STATUS') return connectionStatus(sender);
    if (message?.type === 'NMDA_OPEN_MAIL') {
      const tab = await resolveMailTab(sender, { create:true, focus:message.focus !== false });
      return { ok:!!tab?.id, tabId:tab?.id || null };
    }
    if (message?.type === 'NMDA_OPEN_APP') { const tab=await openApp(); return {ok:true,tabId:tab?.id||null}; }

    if (message?.type === 'NMDA_VAULT_META') {
      const meta = await globalThis.NMDAVault.meta(message.id);
      return meta ? { ok:true, ...meta } : { ok:false, reason:'vault-file-not-found' };
    }
    if (message?.type === 'NMDA_VAULT_CHUNK') {
      const base64 = await globalThis.NMDAVault.chunkBase64(message.id, Number(message.offset||0), Number(message.length||262144));
      return base64 === null ? {ok:false,reason:'vault-file-not-found'} : {ok:true,base64};
    }
    if (message?.type === 'NMDA_EXECUTION_PROGRESS') {
      chrome.runtime.sendMessage({ ...message, type:'NMDA_EXECUTION_PROGRESS_BROADCAST', tabId:sender.tab?.id || null }).catch(()=>{});
      return {ok:true};
    }

    const tab = await resolveMailTab(sender);
    const tabId = tab?.id;
    if (!tabId) return { ok:false, reason:'mailbox-not-connected' };

    if (message?.type === 'NMDA_EXECUTE_DRAFT') {
      await waitForExecutor(tabId);
      return chrome.tabs.sendMessage(tabId, message);
    }
    if (message?.type === 'NMDA_LEGACY_PREFS') {
      await waitForExecutor(tabId);
      return chrome.tabs.sendMessage(tabId, {type:'NMDA_LEGACY_PREFS'});
    }
    if (message?.type === 'NMDA_OPEN_COMPOSE') {
      return runMain(tabId, () => {
        try {
          if (window.Interface && typeof window.Interface.compose === 'function') { window.Interface.compose(); return { ok:true, method:'window.Interface.compose' }; }
          return { ok:false, reason:'window.Interface.compose unavailable' };
        } catch (error) { return {ok:false,reason:error?.message||String(error)}; }
      });
    }
    if (message?.type === 'NMDA_ACCOUNT_INFO') return accountInfo(tabId);
    if (message?.type === 'NMDA_READ_MAILBOX_STATE') return readMailboxState(tabId, message.mode === 'full' ? 'full' : 'quick');
    if (message?.type === 'NMDA_READ_SENT') return readMailbox(tabId,3,message.limit ?? 200);
    if (message?.type === 'NMDA_READ_DRAFTS') return readMailbox(tabId,2,message.limit ?? 200);
    return {ok:false,reason:'unknown-message'};
  })().then(sendResponse).catch(error => sendResponse({ok:false,reason:error?.message||String(error)}));
  return true;
});
