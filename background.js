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
      const HARD_MAX = 10000;
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

      while (messages.length < wanted && !exhausted && (!totalKnown || messages.length < total) && pages < 60) {
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
      if (requestedAll && totalKnown && effectiveTotal > HARD_MAX) stopReason = 'hard-cap-10000';

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, reason: 'missing-tab-id' });
    return;
  }

  if (message?.type === 'NMDA_OPEN_COMPOSE') {
    runMain(tabId, () => {
      try {
        if (window.Interface && typeof window.Interface.compose === 'function') {
          window.Interface.compose();
          return { ok: true, method: 'window.Interface.compose' };
        }
        return { ok: false, reason: 'window.Interface.compose unavailable' };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'NMDA_ACCOUNT_INFO') {
    runMain(tabId, () => {
      try {
        const uid = typeof window.$S === 'function' ? (window.$S('uid') || '') : '';
        return { ok: true, uid: String(uid || '') };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'NMDA_READ_SENT') {
    readMailbox(tabId, 3, message.limit ?? 200).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'NMDA_READ_DRAFTS') {
    readMailbox(tabId, 2, message.limit ?? 200).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }
});
