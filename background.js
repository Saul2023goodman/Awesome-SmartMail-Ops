'use strict';

importScripts('operations.js');

function runMain(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args
  }).then(results => results?.[0]?.result || { ok: false, reason: 'no-execution-result' });
}

function readMailbox(tabId, fid, requested, historyMonths = 0) {
  const raw = String(requested ?? '200').trim().toLowerCase();
  const requestedLimit = raw === 'all' || raw === '-1' ? -1 : Number(raw || 200);
  const historyMonthsLimit = Math.max(0, Math.min(60, Math.floor(Number(historyMonths) || 0)));
  return runMain(tabId, (fidArg, requestedArg, historyMonthsArg) => new Promise(async resolve => {
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
      const historyMonths = Math.max(0, Math.min(60, Math.floor(Number(historyMonthsArg) || 0)));

      function subtractCalendarMonths(date, months) {
        const copy = new Date(date.getTime());
        const originalDay = copy.getDate();
        copy.setDate(1);
        copy.setMonth(copy.getMonth() - months);
        const lastDay = new Date(copy.getFullYear(), copy.getMonth() + 1, 0).getDate();
        copy.setDate(Math.min(originalDay, lastDay));
        return copy;
      }

      const cutoffDate = historyMonths > 0 ? subtractCalendarMonths(new Date(), historyMonths) : null;
      const cutoffMs = cutoffDate ? cutoffDate.getTime() : 0;
      const cutoffAt = cutoffDate ? cutoffDate.toISOString() : '';

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


      function parseSender(item) {
        const raw = String(item?.from || item?.sender || item?.mailFrom || '');
        try {
          const parsed = window.$.Uri?.getEmails?.(raw);
          const match = parsed?.match?.[0];
          const email = String(match?.address || '').trim().toLowerCase();
          if (email) return { email, name: String(match?.name || '').trim(), raw };
        } catch (_) {}
        const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
        const name = raw.replace(email, '').replace(/[<>"']/g, '').trim();
        return { email, name, raw };
      }

      function normalizeMailboxDate(value) {
        if (value == null || value === '') return '';
        try {
          let date = null;
          if (value instanceof Date && !Number.isNaN(value.getTime())) date = value;
          else if (value && typeof value === 'object' && typeof value.getTime === 'function') {
            const time = Number(value.getTime());
            if (Number.isFinite(time)) date = new Date(time);
          } else if (typeof value === 'number' || /^\d{10,13}$/.test(String(value).trim())) {
            let time = Number(value); if (time < 1e12) time *= 1000;
            const candidate = new Date(time); if (!Number.isNaN(candidate.getTime())) date = candidate;
          }
          if (date) {
            const pad = number => String(number).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
          }
        } catch (_) {}
        return String(value).trim();
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
        const sentRaw = item?.sentDate ?? item?.date ?? item?.receivedDate ?? item?.modifiedDate ?? '';
        const sentTimestamp = normalizeMailboxDate(sentRaw);
        const explicitScheduleRaw = item?.scheduleAt ?? item?.scheduleDate ?? item?.scheduledAt ?? item?.scheduledDate ?? item?.scheduledTime ?? item?.planSendTime ?? item?.deliverAt ?? item?.sendAt ?? item?.sendTime ?? '';
        const explicitSchedule = normalizeMailboxDate(explicitScheduleRaw);
        let futureSent = false;
        try {
          const parsed = sentTimestamp ? new Date(sentTimestamp) : null;
          futureSent = !!parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now() + 60 * 1000;
        } catch (_) {}
        // The official NetEase draft-open path passes folderData.sentDate into Compose
        // whenever flags.scheduleDelivery is true. Some mailbox variants omit that flag
        // even though the draft row still carries a future sentDate, so a future sentDate
        // in fid=2 is also strong schedule evidence.
        const scheduledDraft = fidArg === 2 && (!!flags.scheduleDelivery || !!explicitSchedule || futureSent);
        const scheduleValue = scheduledDraft ? (explicitSchedule || sentTimestamp) : explicitSchedule;
        const savedRaw = item?.modifiedDate ?? item?.date ?? item?.receivedDate ?? (scheduledDraft ? '' : item?.sentDate) ?? '';
        const savedTimestamp = normalizeMailboxDate(savedRaw);
        const sender = parseSender(item);
        const previewRaw = item?.summary ?? item?.preview ?? item?.abstract ?? item?.snippet ?? item?.textPreview ?? '';
        const preview = String(previewRaw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
        return {
          id: String(item?.id || item?.mid || ''),
          subject: String(item?.subject || ''),
          toRaw: String(item?.to || ''),
          fromRaw: sender.raw || String(item?.from || ''),
          sender: { email: sender.email, name: sender.name },
          recipients: parseRecipients(item),
          sentAt: sentTimestamp,
          receivedAt: fidArg === 1 ? sentTimestamp : '',
          savedAt: savedTimestamp,
          scheduleAt: scheduleValue,
          scheduleEvidence: scheduledDraft ? (flags.scheduleDelivery ? 'scheduleDelivery-flag' : (explicitSchedule ? 'explicit-schedule-field' : (futureSent ? 'future-sentDate' : ''))) : '',
          threadId: String(item?.threadId || item?.conversationId || item?.cid || item?.tid || ''),
          inReplyTo: String(item?.inReplyTo || item?.inreplyto || ''),
          references: Array.isArray(item?.references) ? item.references.join(' ') : String(item?.references || ''),
          preview,
          flags: { ...flags },
          scheduledDraft,
          sndStatus: typeof sndStatus === 'number' ? sndStatus : null,
          failed: fidArg === 3 && typeof sndStatus === 'number' ? sndStatus > 3 : false
        };
      }

      function mailboxRecordTimeMs(parsed) {
        const candidates = fidArg === 2
          ? [parsed?.scheduleAt, parsed?.savedAt, parsed?.sentAt]
          : fidArg === 1
            ? [parsed?.receivedAt, parsed?.sentAt]
            : [parsed?.sentAt];
        for (const value of candidates) {
          if (!value) continue;
          const ms = new Date(value).getTime();
          if (Number.isFinite(ms)) return ms;
        }
        return 0;
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
      let rawRowsRead = 0;
      let cutoffReached = false;
      let excludedOlder = 0;

      function append(response) {
        const items = Array.isArray(response?.var) ? response.var : [];
        rawRowsRead += items.length;
        if (response?.total !== undefined && response?.total !== null && Number.isFinite(Number(response.total))) { total = Math.max(total, Number(response.total)); totalKnown = true; }
        let added = 0;
        let oldestParsedMs = 0;
        for (const item of items) {
          const parsed = normalize(item);
          const recordMs = mailboxRecordTimeMs(parsed);
          if (recordMs && (!oldestParsedMs || recordMs < oldestParsedMs)) oldestParsedMs = recordMs;
          if (cutoffMs && recordMs && recordMs < cutoffMs) { excludedOlder++; continue; }
          const key = parsed.id || `${parsed.savedAt}|${parsed.subject}|${parsed.toRaw}`;
          if (seen.has(key)) continue;
          seen.add(key);
          messages.push(parsed);
          added++;
        }
        if (cutoffMs && oldestParsedMs && oldestParsedMs < cutoffMs) cutoffReached = true;
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
        candidates.push({ name: 'offset', extra: { offset: rawRowsRead } });
        candidates.push({ name: 'start-index', extra: { start: rawRowsRead } });
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
            if (cutoffReached) { mode = candidate.name; return true; }
          } catch (_) {}
        }
        return false;
      }

      while (messages.length < wanted && !exhausted && !cutoffReached && (!totalKnown || rawRowsRead < total) && pages < MAX_PAGES) {
        if (!mode) {
          const ok = await probeMode();
          if (!ok) { stopReason = 'pagination-unavailable'; break; }
          continue;
        }
        const lastId = String(lastRaw?.id || lastRaw?.mid || '');
        let extra = {};
        if (mode === 'start-id') extra = { start: lastId };
        else if (mode === 'offset') extra = { offset: rawRowsRead };
        else extra = { start: rawRowsRead };
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

      const effectiveTotal = totalKnown ? Math.max(total, rawRowsRead, messages.length) : Math.max(rawRowsRead, messages.length);
      const targetCount = requestedAll ? Math.min(messages.length, HARD_MAX) : Math.min(wanted, messages.length);
      const resultMessages = messages.slice(0, targetCount);
      const serverComplete = totalKnown ? (rawRowsRead >= effectiveTotal || effectiveTotal === 0) : exhausted;
      const complete = cutoffMs ? (cutoffReached || serverComplete) : serverComplete;
      const reachedRequested = requestedAll ? complete : (resultMessages.length >= wanted || complete);
      if (requestedAll && !cutoffMs && totalKnown && effectiveTotal > HARD_MAX) stopReason = `hard-cap-${HARD_MAX}`;
      if (!complete && pages >= MAX_PAGES && !stopReason) stopReason = `page-cap-${MAX_PAGES}`;
      if (cutoffReached) stopReason = 'history-window-reached';
      const scopedTotal = cutoffMs && complete ? resultMessages.length : effectiveTotal;

      resolve({
        ok: true,
        uid,
        fid: fidArg,
        total: scopedTotal,
        serverTotal: effectiveTotal,
        messages: resultMessages,
        pages,
        paginationMode: mode || 'single-page',
        complete,
        serverComplete,
        reachedRequested,
        truncated: !complete && (requestedAll || resultMessages.length < scopedTotal),
        serverTruncated: !serverComplete,
        stopReason,
        hardMax: HARD_MAX,
        historyMonths,
        cutoffAt,
        cutoffReached,
        excludedOlder
      });
    } catch (error) {
      resolve({ ok: false, reason: error?.message || String(error) });
    }
  }), [fid, requestedLimit, historyMonthsLimit]);
}


async function readScheduledDraftAnchors(tabId, historyMonths = 0) {
  const drafts = await readMailbox(tabId, 2, -1, historyMonths);
  if (!drafts?.ok) return { ok:false, reason:drafts?.reason || '读取草稿箱失败', drafts };
  const now = Date.now() + 60 * 1000;
  const scheduled = (drafts.messages || []).filter(item => {
    if (!item?.scheduledDraft || !item?.scheduleAt) return false;
    const date = new Date(item.scheduleAt);
    return !Number.isNaN(date.getTime()) && date.getTime() > now;
  }).map(item => ({
    id:String(item.id || ''),
    recipients:Array.isArray(item.recipients) ? item.recipients.map(recipient => ({email:String(recipient?.email||''),name:String(recipient?.name||'')})) : [],
    toRaw:String(item.toRaw || ''),
    subject:String(item.subject || ''),
    scheduleAt:String(item.scheduleAt || ''),
    scheduleEvidence:String(item.scheduleEvidence || ''),
    savedAt:String(item.savedAt || ''),
    flags:{...(item.flags || {})}
  }));
  return {
    ok:true,
    uid:String(drafts.uid || ''),
    complete:!!drafts.complete,
    total:Number(drafts.total || 0),
    read:Number(drafts.messages?.length || 0),
    scheduled
  };
}

async function readDedupeHistory(tabId, historyMonths = 0) {
  const sent = await readMailbox(tabId, 3, -1, historyMonths);
  if (!sent?.ok) return { ok:false, phase:'sent', reason:sent?.reason||'读取已发送失败', sent };
  const drafts = await readMailbox(tabId, 2, -1, historyMonths);
  if (!drafts?.ok) return { ok:false, phase:'drafts', reason:drafts?.reason||'读取草稿箱失败', sent, drafts };
  const complete = !!sent.complete && !!drafts.complete;
  return {
    ok:true, uid:sent.uid||drafts.uid||'', sent, drafts, complete,
    historyMonths:Math.max(0, Number(historyMonths)||0), cutoffAt:sent.cutoffAt||drafts.cutoffAt||'',
    coverage:{
      sent:{read:sent.messages?.length||0,total:sent.total||0,complete:!!sent.complete,pages:sent.pages||0},
      drafts:{read:drafts.messages?.length||0,total:drafts.total||0,complete:!!drafts.complete,pages:drafts.pages||0}
    }
  };
}

async function readMailboxState(tabId, mode = 'quick', historyMonths = 0) {
  const full = mode === 'full';
  const requested = full ? -1 : 500;
  const sent = await readMailbox(tabId, 3, requested, historyMonths);
  if (!sent?.ok) return { ok: false, phase: 'sent', reason: sent?.reason || '读取已发送失败', sent };
  const drafts = await readMailbox(tabId, 2, requested, historyMonths);
  if (!drafts?.ok) return { ok: false, phase: 'drafts', reason: drafts?.reason || '读取草稿箱失败', sent, drafts };
  const inbox = await readMailbox(tabId, 1, requested, historyMonths);
  if (!inbox?.ok) return { ok: false, phase: 'inbox', reason: inbox?.reason || '读取收件箱失败', sent, drafts, inbox };
  const complete = !!sent.complete && !!drafts.complete && !!inbox.complete;
  return {
    ok: true,
    mode: full ? 'full' : 'quick',
    uid: sent.uid || drafts.uid || inbox.uid || '',
    sent, drafts, inbox, complete,
    historyMonths:Math.max(0, Number(historyMonths)||0), cutoffAt:sent.cutoffAt||drafts.cutoffAt||inbox.cutoffAt||'',
    coverage: {
      sent: { read: sent.messages?.length || 0, total: sent.total || 0, complete: !!sent.complete, pages: sent.pages || 0 },
      drafts: { read: drafts.messages?.length || 0, total: drafts.total || 0, complete: !!drafts.complete, pages: drafts.pages || 0 },
      inbox: { read: inbox.messages?.length || 0, total: inbox.total || 0, complete: !!inbox.complete, pages: inbox.pages || 0 }
    }
  };
}

async function readDraftDetail(tabId, summary = {}) {
  return runMain(tabId, (summaryArg) => new Promise(async resolve => {
    try {
      if (!window.$?.DataAction) return resolve({ ok:false, reason:'$.DataAction unavailable' });
      const id = String(summaryArg?.id || '').trim();
      if (!id) return resolve({ ok:false, reason:'draft-id-missing' });

      // The webmail source itself opens a draft by calling:
      //   mbox:restoreDraft { id }
      // The response.var object is the compose data model consumed by fillContent().
      // Reading this model is faster and much more stable than opening every draft
      // and scraping the editor iframe.
      function request(func, body) {
        return new Promise((res, rej) => {
          try {
            const action = new window.$.DataAction();
            action.wmsvr({
              func,
              body,
              call(response) { res(response || {}); },
              error(error) { rej(new Error(error?.message || error?.code || `${func} failed`)); },
              ignoreError: true
            });
          } catch (error) { rej(error); }
        });
      }

      function normalizeSchedule(value) {
        if (value == null || value === '') return '';
        let d = null;
        try {
          if (value instanceof Date && !Number.isNaN(value.getTime())) d = value;
          else if (value && typeof value === 'object' && typeof value.getTime === 'function') {
            const time = Number(value.getTime()); if (Number.isFinite(time)) d = new Date(time);
          } else if (typeof value === 'number' || /^\d{10,13}$/.test(String(value).trim())) {
            let n = Number(value); if (n < 1e12) n *= 1000;
            const candidate = new Date(n); if (!Number.isNaN(candidate.getTime())) d = candidate;
          } else {
            const candidate = new Date(String(value)); if (!Number.isNaN(candidate.getTime())) d = candidate;
          }
        } catch (_) {}
        if (d) {
          const pad = number => String(number).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        return String(value).trim();
      }

      function htmlToText(value, isHtml) {
        let raw = String(value ?? '');
        if (!raw) return '';
        if (isHtml === false || !/<[a-z][\s\S]*>/i.test(raw)) return raw.replace(/\r\n?/g,'\n').trim();
        raw = raw
          .replace(/<\s*br\s*\/?\s*>/gi,'\n')
          .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi,'\n')
          .replace(/<\s*li\b[^>]*>/gi,'• ');
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        doc.querySelectorAll('script,style,noscript').forEach(el => el.remove());
        return String(doc.body?.textContent || '')
          .replace(/\u00a0/g,' ')
          .replace(/[ \t]+\n/g,'\n')
          .replace(/\n{3,}/g,'\n\n')
          .trim();
      }

      function recipientText(value) {
        const format = item => {
          if (typeof item === 'string') return item.trim();
          if (!item || typeof item !== 'object') return '';
          const email = String(item.address || item.email || item.mail || '').trim();
          const name = String(item.name || item.displayName || '').trim();
          return email ? (name ? `${name} <${email}>` : email) : '';
        };
        if (Array.isArray(value)) return value.map(format).filter(Boolean).join('; ');
        return format(value) || String(value || '').trim();
      }

      function attachmentList(value, kind='attachment') {
        const values = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
        const out = [], seen = new Set();
        for (const item of values) {
          if (!item) continue;
          if (typeof item === 'string') {
            const name = item.trim(); if (!name) continue;
            const key = `${kind}|${name}`.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
            out.push({name,size:0,id:'',url:'',contentType:'',kind});
            continue;
          }
          if (typeof item !== 'object') continue;
          const name = String(item.name || item.fileName || item.filename || item.displayName || '').trim();
          const attachmentId = String(item.id || item.attachmentId || item.aid || item.partId || item.fileId || '').trim();
          const url = String(item.url || item.downloadUrl || item.href || '').trim();
          if (!name && !attachmentId) continue;
          const key = `${kind}|${attachmentId}|${name}`.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
          out.push({
            name: name || `附件 ${attachmentId}`,
            size: Number(item.size || item.fileSize || item.length || 0) || 0,
            id: attachmentId,
            url,
            contentType: String(item.contentType || item.type || '').trim(),
            inlined: !!item.inlined,
            mixed: !!item.mixed,
            kind
          });
        }
        return out;
      }

      // Locked drafts are intentionally not auto-unlocked. The official UI invokes a
      // separate unlock flow first; silently changing lock state during an import would
      // be an unexpected mailbox mutation.
      if (summaryArg?.flags?.locked) {
        return resolve({
          ok:false, id, locked:true, reason:'草稿已锁定；请先在网易邮箱解锁后重新读取',
          subject:String(summaryArg?.subject||''), recipients:String(summaryArg?.toRaw||''),
          body:'', bodyHtml:'', scheduleAt:normalizeSchedule(summaryArg?.scheduleAt||''),
          savedAt:String(summaryArg?.savedAt||''), attachments:[], detailSource:'locked-metadata-only'
        });
      }

      let response;
      try {
        response = await request('mbox:restoreDraft', { id });
      } catch (error) {
        return resolve({ ok:false, id, reason:error?.message || 'mbox:restoreDraft 读取失败', detailSource:'mbox:restoreDraft' });
      }

      const successCode = window.$?.S_OK;
      if (response?.code !== undefined && successCode !== undefined && response.code !== successCode) {
        return resolve({ ok:false, id, reason:`mbox:restoreDraft code=${String(response.code)}`, detailSource:'mbox:restoreDraft' });
      }
      const direct = response?.var;
      if (!direct || typeof direct !== 'object' || Array.isArray(direct)) {
        return resolve({ ok:false, id, reason:'mbox:restoreDraft 返回的 var 为空或格式错误', detailSource:'mbox:restoreDraft' });
      }

      // Native restoreDraft schema consumed by ComposeBase.fillContent():
      // account, to, cc, bcc, showOneRcpt, subject, priority,
      // requestReadReceipt, scheduleDate, content, isHtml, attachments, link.
      const subject = String(direct.subject ?? summaryArg?.subject ?? '').trim();
      const recipients = recipientText(direct.to) || String(summaryArg?.toRaw || '').trim();
      const cc = recipientText(direct.cc);
      const bcc = recipientText(direct.bcc);
      const bodyHtml = direct.content == null ? '' : String(direct.content);
      const isHtml = direct.isHtml !== false;
      const body = htmlToText(bodyHtml, isHtml);
      const attachments = [
        ...attachmentList(direct.attachments, 'attachment'),
        ...attachmentList(direct.link, 'cloud-link')
      ];

      const scheduledByList = !!summaryArg?.flags?.scheduleDelivery || !!summaryArg?.scheduledDraft;
      // Match NetEase's own Compose restore behavior: for a scheduled draft the list
      // row's sentDate is authoritative and is written back to response.scheduleDate
      // after restoreDraft returns. restoreDraft.scheduleDate is only a fallback.
      const listSchedule = normalizeSchedule(summaryArg?.scheduleAt || (scheduledByList ? summaryArg?.sentAt : ''));
      const restoredSchedule = normalizeSchedule(direct.scheduleDate || direct.scheduleAt || '');
      const scheduleAt = scheduledByList ? (listSchedule || restoredSchedule) : (restoredSchedule || listSchedule);
      const savedAt = String(summaryArg?.savedAt || direct.modifiedDate || direct.saveDate || '').trim();
      const rawKeys = Object.keys(direct).slice(0,80);

      resolve({
        ok:true, id, subject, recipients, cc, bcc, body, bodyHtml, isHtml,
        scheduleAt, savedAt, attachments,
        scheduleEvidence: scheduledByList ? String(summaryArg?.scheduleEvidence || 'mailbox-list') : (restoredSchedule ? 'restoreDraft' : ''),
        account:String(direct.account || '').trim(),
        priority:Number(direct.priority || 0) || 0,
        requestReadReceipt:!!direct.requestReadReceipt,
        showOneRcpt:!!direct.showOneRcpt,
        detailSource:'mbox:restoreDraft',
        directSchema:true,
        rawKeys
      });
    } catch (error) {
      resolve({ ok:false, id:String(summaryArg?.id||''), reason:error?.message || String(error) });
    }
  }), [summary]);
}


async function readSentDetail(tabId, messageId) {
  const id = String(messageId || '').trim();
  if (!id) return { ok:false, id:'', reasonCode:'initial-provider-id-missing', reason:'缺少已发送邮件 provider message id' };
  return runMain(tabId, (idArg) => new Promise(async resolve => {
    try {
      if (!window.$?.DataAction) return resolve({ ok:false, id:idArg, reasonCode:'sent-read-unavailable', reason:'$.DataAction unavailable' });

      function requestReadMessage(body) {
        return new Promise((res, rej) => {
          try {
            const action = new window.$.DataAction();
            action.wmsvr({
              func:'mbox:readMessage',
              body,
              call(response){ res(response || {}); },
              error(error){ rej(new Error(error?.message || error?.code || 'mbox:readMessage failed')); },
              ignoreError:true,
              hideWait:true
            });
          } catch (error) { rej(error); }
        });
      }

      function htmlToText(value, forceHtml = null) {
        const raw = String(value ?? '');
        if (!raw) return '';
        const looksHtml = forceHtml === true || (forceHtml !== false && /<[a-z][\s\S]*>/i.test(raw));
        if (!looksHtml) return raw.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
        const doc = new DOMParser().parseFromString(raw,'text/html');
        doc.querySelectorAll('script,style,noscript').forEach(el=>el.remove());

        // Convert DOM to rendered-text semantics instead of using textContent directly.
        // This matters for Word/Office HTML: source line wrapping inside <span> nodes
        // is collapsible whitespace in the browser, while <p>/<div>/<br> carry the
        // semantic paragraph breaks that Follow-up personalization needs.
        const blockTags = new Set(['P','DIV','LI','TR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE']);
        function renderNode(node) {
          if (!node) return '';
          if (node.nodeType === Node.TEXT_NODE) {
            return String(node.nodeValue || '').replace(/[\u00a0\t\r\n ]+/g,' ');
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          const tag = String(node.tagName || '').toUpperCase();
          if (tag === 'BR') return '\n';
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return '';
          let text = '';
          for (const child of node.childNodes || []) text += renderNode(child);
          if (tag === 'LI') text = `• ${text}`;
          if (blockTags.has(tag)) text += '\n\n';
          return text;
        }

        let text = '';
        for (const child of doc.body?.childNodes || []) text += renderNode(child);
        return text
          .replace(/[ \t]+\n/g,'\n')
          .replace(/\n[ \t]+/g,'\n')
          .replace(/ {2,}/g,' ')
          .replace(/\n{3,}/g,'\n\n')
          .trim();
      }

      // 1) Read metadata using NetEase's own ReadAction contract. The provider's
      // body is not expected to live here; readMessage establishes the canonical
      // message record/context and gives us subject + a validated message id.
      const officialBody = {
        id:idArg,
        header:true,
        returnImageInfo:true,
        returnAntispamInfo:true,
        autoName:true,
        returnHeaders:{
          'Resent-From':'A',
          'Sender':'A',
          'List-Unsubscribe':'A',
          'Reply-To':'A',
          'From':''
        },
        supportTNEF:false
      };
      let response;
      try {
        response = await requestReadMessage(officialBody);
      } catch (error) {
        return resolve({ ok:false, id:idArg, reasonCode:'sent-read-failed', reason:error?.message || String(error) });
      }
      const successCode = window.$?.S_OK;
      if (response?.code !== undefined && successCode !== undefined && response.code !== successCode) {
        return resolve({ ok:false, id:idArg, reasonCode:'sent-read-failed', reason:`mbox:readMessage code=${String(response.code)}` });
      }
      const root = response?.var;
      if (!root || typeof root !== 'object') return resolve({ ok:false, id:idArg, reasonCode:'sent-read-empty', reason:'mbox:readMessage 返回的 var 为空' });
      const subject = String(root?.subject || '').trim();

      // 2) NetEase's MailReader loads the actual body in a separate readhtml frame.
      // Mirror the provider's own MailReader.initialize() URL construction:
      //   $.Ext.read_noSsidRead ? read/readhtml3.jsp?mid=... : $G.environment.readUrl + &mid=...
      function buildReadHtmlUrl() {
        const dollar = window.$;
        const globalG = window.$G || (typeof $G !== 'undefined' ? $G : null);
        let base = '';
        if (dollar?.Ext?.read_noSsidRead) {
          base = `read/readhtml3.jsp?mid=${encodeURIComponent(idArg)}`;
        } else {
          const providerReadUrl = String(globalG?.environment?.readUrl || '').trim();
          if (!providerReadUrl) return '';
          base = `${providerReadUrl}${providerReadUrl.includes('?') ? '&' : '?'}mid=${encodeURIComponent(idArg)}`;
        }
        const getState = window.$S || (typeof $S !== 'undefined' ? $S : null);
        const userType = String(getState?.('ad')?.userType || '').trim();
        if (userType) base += `${base.includes('?') ? '&' : '?'}userType=${encodeURIComponent(userType)}`;
        return new URL(base, window.location.href).href;
      }

      function parseReadHtml(rawHtml) {
        const html = String(rawHtml || '');
        if (!html.trim()) return { ok:false, reason:'readhtml 响应为空' };
        try {
          const doc = new DOMParser().parseFromString(html,'text/html');
          const template = doc.querySelector('template#contentTemplate');
          if (!template?.content) return { ok:false, reason:'readhtml 中缺少 template#contentTemplate' };

          // Provider contract: NetEase's own readhtml script appends the complete
          // contentTemplate.content fragment into #content. The fragment itself is
          // therefore authoritative; data-ntes=ntes_mail_body_root is only one
          // Compose serialization shape and is not required (Word/Mso HTML omits it).
          const container = doc.createElement('div');
          container.appendChild(template.content.cloneNode(true));
          const bodyHtml = String(container.innerHTML || '');
          if (!bodyHtml.trim()) return { ok:false, reason:'contentTemplate 正文内容为空' };
          const body = htmlToText(bodyHtml, true);
          if (!body.trim()) return { ok:false, reason:'contentTemplate 未产生可读正文' };
          return { ok:true, body, bodyHtml, bodySource:'readhtml:template#contentTemplate' };
        } catch (error) {
          return { ok:false, reason:error?.message || String(error) };
        }
      }

      let readHtmlFailure = '';
      let readHtmlStatus = 0;
      let readHtmlFetched = false;
      try {
        const readHtmlUrl = buildReadHtmlUrl();
        if (!readHtmlUrl) return resolve({ ok:false, id:idArg, subject, reasonCode:'sent-readhtml-url-unavailable', reason:'网易页面未提供 readhtml URL', detailSource:'readhtml', responseCode:response.code });
        const bodyResponse = await fetch(readHtmlUrl, {
          method:'GET',
          credentials:'include',
          cache:'no-store',
          redirect:'follow'
        });
        readHtmlStatus = Number(bodyResponse.status || 0) || 0;
        if (!bodyResponse.ok) {
          readHtmlFailure = `readhtml HTTP ${bodyResponse.status}`;
        } else {
          readHtmlFetched = true;
          const rawHtml = await bodyResponse.text();
          const parsed = parseReadHtml(rawHtml);
          if (parsed.ok) {
            return resolve({
              ok:true,
              id:idArg,
              subject,
              body:parsed.body,
              bodyHtml:parsed.bodyHtml,
              isHtml:true,
              bodySource:parsed.bodySource,
              detailSource:'readhtml',
              responseCode:response.code,
              readHtmlStatus
            });
          }
          readHtmlFailure = parsed.reason || 'readhtml 正文解析失败';
        }
      } catch (error) {
        readHtmlFailure = error?.message || String(error);
      }

      return resolve({
        ok:false,
        id:idArg,
        subject,
        reasonCode: readHtmlFetched ? 'sent-readhtml-parse-failed' : 'sent-readhtml-failed',
        reason: readHtmlFailure || 'readhtml3.jsp 未返回可解析正文',
        detailSource:'readhtml',
        responseCode:response.code,
        readHtmlStatus,
        rawKeys:Object.keys(root).slice(0,80)
      });
    } catch (error) {
      resolve({ ok:false, id:idArg, reasonCode:'sent-read-failed', reason:error?.message || String(error) });
    }
  }), [id]);
}

async function readSentDetails(tabId, messageIds = []) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0,500);
  const details = new Array(ids.length);
  let cursor = 0;
  const workerCount = Math.min(4, Math.max(1, ids.length));
  async function worker() {
    while (cursor < ids.length) {
      const index = cursor++;
      details[index] = await readSentDetail(tabId, ids[index]);
    }
  }
  await Promise.all(Array.from({length:workerCount}, worker));
  return { ok:true, details, failures:details.filter(item => item && item.ok === false).length };
}

async function readDraftImport(tabId, requested = 300) {
  const limit = Math.max(1, Math.min(1000, Number(requested) || 300));
  const listing = await readMailbox(tabId, 2, limit);
  if (!listing?.ok) return { ok:false, reason:listing?.reason || '读取草稿箱失败', listing };
  const summaries = Array.isArray(listing.messages) ? listing.messages : [];
  const details = new Array(summaries.length);
  let cursor = 0;
  const workerCount = Math.min(4, Math.max(1, summaries.length));
  async function worker() {
    while (cursor < summaries.length) {
      const index = cursor++;
      const summary = summaries[index];
      try { details[index] = await readDraftDetail(tabId, summary); }
      catch (error) { details[index] = { ok:false, id:summary?.id || '', reason:error?.message || String(error) }; }
    }
  }
  await Promise.all(Array.from({length:workerCount}, worker));
  return {
    ok:true,
    uid:listing.uid || '',
    total:listing.total || summaries.length,
    read:summaries.length,
    complete:!!listing.complete,
    truncated:!!listing.truncated,
    drafts:summaries.map((summary,index) => ({ ...summary, ...(details[index] || {}), summary })),
    failures:details.filter(item => item && item.ok === false).length
  };
}


const APP_URL = chrome.runtime.getURL('app.html');

const MAIL_URL = 'https://mail.163.com/';


let runtimeFileSourcePort = null;
const runtimeFileRequests = new Map();

function rejectRuntimeFileRequests(reason = 'runtime-file-source-disconnected') {
  for (const [requestId, pending] of runtimeFileRequests.entries()) {
    clearTimeout(pending.timer);
    pending.resolve({ ok:false, reason });
    runtimeFileRequests.delete(requestId);
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'NMDA_RUNTIME_FILE_SOURCE') return;
  if (runtimeFileSourcePort && runtimeFileSourcePort !== port) {
    try { runtimeFileSourcePort.disconnect(); } catch (_) {}
  }
  runtimeFileSourcePort = port;
  port.onMessage.addListener(message => {
    if (message?.type !== 'NMDA_RUNTIME_FILE_RESPONSE') return;
    const requestId = String(message.requestId || '');
    const pending = runtimeFileRequests.get(requestId);
    if (!pending) return;
    runtimeFileRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(message);
  });
  port.onDisconnect.addListener(() => {
    if (runtimeFileSourcePort === port) runtimeFileSourcePort = null;
    rejectRuntimeFileRequests();
  });
});

function requestRuntimeFile(action, payload = {}) {
  if (!runtimeFileSourcePort) return Promise.resolve({ ok:false, reason:'runtime-file-source-unavailable' });
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (!runtimeFileRequests.has(requestId)) return;
      runtimeFileRequests.delete(requestId);
      resolve({ ok:false, reason:'runtime-file-source-timeout' });
    }, 15000);
    runtimeFileRequests.set(requestId, { resolve, timer });
    try {
      runtimeFileSourcePort.postMessage({ type:'NMDA_RUNTIME_FILE_REQUEST', requestId, action, ...payload });
    } catch (error) {
      clearTimeout(timer);
      runtimeFileRequests.delete(requestId);
      resolve({ ok:false, reason:error?.message||String(error) });
    }
  });
}

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

function normalizeAppTarget(target = '') {
  const value = String(target || '').trim().replace(/^#+/, '');
  return /^(batch(?:\/[12])?|review|dispatch|monitor)$/.test(value) ? value : 'batch';
}

async function openApp(target = 'batch') {
  const hash = normalizeAppTarget(target);
  const targetUrl = `${APP_URL}#${hash}`;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => String(tab.url || '').split('#')[0].split('?')[0] === APP_URL);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { url: targetUrl, active:true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId,{focused:true}).catch(()=>{});
    return existing;
  }
  return chrome.tabs.create({ url: targetUrl, active:true });
}

chrome.action.onClicked.addListener(() => { openApp('batch').catch(console.error); });

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
    if (message?.type === 'NMDA_OPEN_MAIL_MESSAGE') {
      const id = String(message.messageId || '').trim();
      if (!id) {
        const tab = await resolveMailTab(sender, { create:true, focus:true });
        return { ok:!!tab?.id, tabId:tab?.id || null, fallback:true };
      }
      const tab = await resolveMailTab(sender, { create:true, focus:true });
      if (!tab?.id) return { ok:false, reason:'mailbox-tab-unavailable' };
      await waitForExecutor(tab.id).catch(()=>null);
      const fid = Number(message.fid || 1) || 1;
      const opened = await runMain(tab.id, (idArg, fidArg) => {
        try {
          const payload = { area:'normal', isThread:false, viewType:'', id:String(idArg), fid:Number(fidArg || 1) || 1 };
          location.hash = `module=read.ReadModule%7C${encodeURIComponent(JSON.stringify(payload))}`;
          return { ok:true, id:String(idArg), fid:payload.fid };
        } catch (error) { return { ok:false, reason:error?.message || String(error) }; }
      }, [id, fid]);
      return { ...(opened || {ok:false}), tabId:tab.id };
    }
    if (message?.type === 'NMDA_OPEN_APP') { const tab=await openApp(message.target); return {ok:true,tabId:tab?.id||null}; }
    if (message?.type === 'NMDA_BATCH_MONITOR') {
      const tab=await resolveMailTab(sender,{create:false,focus:false});
      if(!tab?.id)return {ok:false,reason:'mailbox-not-connected'};
      await waitForExecutor(tab.id).catch(()=>null);
      try{return await chrome.tabs.sendMessage(tab.id,{type:'NMDA_BATCH_MONITOR',payload:message.payload||{}});}
      catch(error){return {ok:false,reason:error?.message||String(error)};}
    }
    if (message?.type === 'NMDA_BATCH_STOP_REQUEST') {
      chrome.runtime.sendMessage({type:'NMDA_BATCH_STOP_BROADCAST'}).catch(()=>{});
      return {ok:true};
    }

    if (message?.type === 'NMDA_RUNTIME_FILE_META') {
      const result = await requestRuntimeFile('meta', { id:String(message.id||'') });
      return result?.ok ? { ok:true, id:result.id, name:result.name, type:result.typeName, size:result.size, lastModified:result.lastModified } : result;
    }
    if (message?.type === 'NMDA_RUNTIME_FILE_CHUNK') {
      return requestRuntimeFile('chunk', { id:String(message.id||''), offset:Number(message.offset||0), length:Number(message.length||262144) });
    }
    if (message?.type === 'NMDA_EXECUTION_PROGRESS') {
      chrome.runtime.sendMessage({ ...message, type:'NMDA_EXECUTION_PROGRESS_BROADCAST', tabId:sender.tab?.id || null }).catch(()=>{});
      return {ok:true};
    }
    if (message?.type === 'NMDA_EXECUTION_RESUME_REQUEST') {
      const resumeTab = await resolveMailTab(sender);
      if (!resumeTab?.id) return {ok:false,reason:'mailbox-not-connected'};
      await waitForExecutor(resumeTab.id);
      return chrome.tabs.sendMessage(resumeTab.id, { type:'NMDA_EXECUTION_RESUME', executionId:String(message.executionId || '') });
    }

    const tab = await resolveMailTab(sender);
    const tabId = tab?.id;
    if (!tabId) return { ok:false, reason:'mailbox-not-connected' };

    if (message?.type === 'NMDA_EXECUTE_DRAFT') {
      await waitForExecutor(tabId);
      return chrome.tabs.sendMessage(tabId, message);
    }
    if (message?.type === 'NMDA_COMPOSE_IDENTITY') {
      return runMain(tabId, () => {
        try {
          const mod = window.$?.Context?.module || window.$?.Context?.getModule?.() || null;
          if (!mod || String(mod.mtype || '') !== 'compose.ComposeModule') return {ok:false,reason:'active-module-is-not-compose'};
          const info = mod.info || null;
          const readInfo = key => {
            try { return String(info?.get?.({ [key]: true }) || ''); } catch (_) { return ''; }
          };
          let fromEntry = '', fromEntryDetail = '';
          try { fromEntry = String(mod.data?.get?.({status:'fromEntry'}) || ''); } catch (_) {}
          try { fromEntryDetail = String(mod.data?.get?.({status:'fromEntryDetail'}) || ''); } catch (_) {}
          const identity = {
            name: String(mod.name || ''),
            mtype: String(mod.mtype || ''),
            cid: readInfo('cid'),
            did: readInfo('did'),
            containerId: String(mod.container?.id || mod.container?.dom?.id || ''),
            fromEntry,
            fromEntryDetail
          };
          if (!identity.name) return {ok:false,reason:'compose-module-name-unavailable'};
          return {ok:true,identity};
        } catch (error) { return {ok:false,reason:error?.message||String(error)}; }
      });
    }
    if (message?.type === 'NMDA_COMPOSE_SENDER_STATE') {
      return runMain(tabId, identityArg => {
        try {
          const identity = identityArg || {};
          const targetName = String(identity.name || '');
          const group = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
          const modules = Object.values(group).filter(Boolean);
          const target = modules.find(mod => String(mod?.name || '') === targetName)
            || (String(window.$?.Context?.module?.mtype || '') === 'compose.ComposeModule' ? window.$.Context.module : null);
          if (!target) return {ok:false,resolved:false,reason:'compose-module-not-found'};
          let sender = null;
          try { sender = target.form?.getSender?.() || null; } catch (_) {}
          const address = String(sender?.address || '');
          const name = String(sender?.name || '').trim();
          const localPart = String(address.split('@')[0] || '').trim();
          let attrs = null;
          try { attrs = typeof window.$S === 'function' ? window.$S('attrs') : null; } catch (_) {}
          const user = attrs?.user || {};
          const trueName = String(user.true_name || '').trim();
          const nickName = String(user.nick_name || '').trim();
          const displaySender = Number(user.displaysender);
          let promptFlag = '';
          try { promptFlag = String(window.$?.Ud?.get?.({field:'ntes_compose',flag:'senderName'}) ?? ''); } catch (_) {}
          const resolved = !!trueName || (!!name && !!localPart && name !== localPart) || (displaySender === 1 && !!nickName);
          return {ok:true,resolved,address,name,localPart,trueName,nickName,displaySender,promptFlag,identity:{name:String(target.name||'')}};
        } catch (error) { return {ok:false,resolved:false,reason:error?.message||String(error)}; }
      }, [message.identity || {}]);
    }
    if (message?.type === 'NMDA_COMPOSE_REARM_SENDER_NAME') {
      return runMain(tabId, identityArg => {
        try {
          const identity = identityArg || {};
          const targetName = String(identity.name || '');
          const group = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
          const target = Object.values(group).filter(Boolean).find(mod => String(mod?.name || '') === targetName)
            || (String(window.$?.Context?.module?.mtype || '') === 'compose.ComposeModule' ? window.$.Context.module : null);
          if (!target) return {ok:false,reason:'compose-module-not-found'};
          if (!window.$?.Ud?.set) return {ok:false,reason:'netease-userdata-set-unavailable'};
          window.$.Ud.set({field:'ntes_compose',flag:'senderName',value:'0'});
          return {ok:true,rearmed:true,identity:{name:String(target.name||'')}};
        } catch (error) { return {ok:false,reason:error?.message||String(error)}; }
      }, [message.identity || {}]);
    }

    if (message?.type === 'NMDA_FAST_COMPOSE_APPLY') {
      return runMain(tabId, (identityArg, payloadArg) => new Promise(resolve => {
        const identity = identityArg || {};
        const payload = payloadArg || {};
        const targetName = String(identity.name || '');
        const started = Date.now();

        const findTarget = () => {
          const group = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
          return Object.values(group).filter(Boolean).find(mod => String(mod?.name || '') === targetName)
            || (String(window.$?.Context?.module?.mtype || '') === 'compose.ComposeModule' ? window.$.Context.module : null);
        };

        const parseRecipients = raw => {
          const result = [];
          const seen = new Set();
          const chunks = String(raw || '').split(/[;,，；\n]+/).map(value => value.trim()).filter(Boolean);
          for (const chunk of chunks) {
            let matches = [];
            try { matches = window.$?.Uri?.getEmails?.(chunk)?.match || []; } catch (_) {}
            if (!matches.length) {
              const address = chunk.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
              if (address) matches = [{address,name:''}];
            }
            for (const match of matches) {
              const address = String(match?.address || '').trim();
              if (!address || seen.has(address.toLowerCase())) continue;
              seen.add(address.toLowerCase());
              try { result.push(new window.$.Email(address, String(match?.name || '').trim())); }
              catch (_) { result.push(address); }
            }
          }
          return result;
        };

        const attempt = () => {
          try {
            const target = findTarget();
            if (!target) {
              if (Date.now() - started < 6000) return setTimeout(attempt, 60);
              return resolve({ok:false,reason:'compose-module-not-found'});
            }
            const fromEntry = String(target.data?.get?.({status:'fromEntry'}) || '');
            if (fromEntry && fromEntry !== 'compose') {
              return resolve({ok:false,reason:`fast-compose-context-not-supported:${fromEntry}`});
            }
            const ready = !!(
              target.form?.setContact &&
              target.form?.setSubject &&
              target.editor?.set &&
              target.editor?.editorCmpt?.rendered &&
              target.base?.sendBuild &&
              target.base?.send
            );
            if (!ready) {
              if (Date.now() - started < 6000) return setTimeout(attempt, 60);
              return resolve({ok:false,reason:'native-compose-core-not-ready'});
            }

            const to = parseRecipients(payload.recipients);
            const cc = parseRecipients(payload.cc);
            const bcc = parseRecipients(payload.bcc);
            if (!to.length) return resolve({ok:false,reason:'fast-compose-recipient-empty'});

            target.form.setContact(to, 'to');
            target.form.setContact(cc.length ? cc : null, 'cc');
            target.form.setContact(bcc.length ? bcc : null, 'bcc');
            target.form.setSubject(String(payload.subject || ''));
            target.editor.set({html:String(payload.bodyHtml || '')});

            if (Number(payload.priority || 0) === 1) {
              if (typeof target.form.setCheckbox !== 'function') return resolve({ok:false,reason:'native-priority-option-unavailable'});
              target.form.setCheckbox('priority', true, true);
            }
            if (payload.requestReadReceipt) {
              if (typeof target.form.setCheckbox !== 'function') return resolve({ok:false,reason:'native-receipt-option-unavailable'});
              target.form.setCheckbox('receipt', true, true);
            }

            const scheduled = !!String(payload.scheduleAt || '').trim();
            if (scheduled) {
              const date = new Date(String(payload.scheduleAt || ''));
              if (Number.isNaN(date.getTime())) return resolve({ok:false,reason:'fast-compose-schedule-invalid'});
              if (!target.schedule?.set) return resolve({ok:false,reason:'native-schedule-model-unavailable'});
              // sendBuild(schedule) reads schedule.status.date and applies NetEase's
              // own getWithTimeZoneFixed() conversion. We deliberately avoid the UI selects.
              target.schedule.set({status:'date', value:date});
            }

            // Compile through NetEase's own editor.getFinal()/sendBuild() now. This is
            // both a capability probe and a structural preflight for the final native send.
            const action = scheduled ? 'schedule' : 'save';
            const compiled = target.base.sendBuild({action}) || {};
            const scheduleDate = compiled.scheduleDate instanceof Date
              ? compiled.scheduleDate.toISOString()
              : String(compiled.scheduleDate || '');
            return resolve({
              ok:true,
              method:'compose-native-direct',
              identity:{name:String(target.name || '')},
              fromEntry,
              nativeContentLength:String(compiled.content || '').length,
              compiled:{
                toCount:Array.isArray(compiled.to) ? compiled.to.length : 0,
                ccCount:Array.isArray(compiled.cc) ? compiled.cc.length : 0,
                bccCount:Array.isArray(compiled.bcc) ? compiled.bcc.length : 0,
                subject:String(compiled.subject || ''),
                isHtml:compiled.isHtml !== false,
                priority:Number(compiled.priority || 3),
                requestReadReceipt:!!compiled.requestReadReceipt,
                charset:String(compiled.charset || ''),
                scheduleDate
              }
            });
          } catch (error) {
            resolve({ok:false,reason:error?.message || String(error)});
          }
        };
        attempt();
      }), [message.identity || {}, message.payload || {}]);
    }
    if (message?.type === 'NMDA_FAST_COMPOSE_SUBMIT') {
      return runMain(tabId, (identityArg, scheduledArg) => {
        try {
          const identity = identityArg || {};
          const targetName = String(identity.name || '');
          const group = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
          const target = Object.values(group).filter(Boolean).find(mod => String(mod?.name || '') === targetName)
            || (String(window.$?.Context?.module?.mtype || '') === 'compose.ComposeModule' ? window.$.Context.module : null);
          if (!target) return {ok:false,reason:'compose-module-not-found'};
          if (typeof target.base?.send !== 'function') return {ok:false,reason:'native-compose-send-unavailable'};
          const action = scheduledArg ? 'schedule' : 'save';
          target.base.send({action,source:'nmda-fast-compose'});
          return {ok:true,method:'compose.base.send',action,identity:{name:String(target.name || '')}};
        } catch (error) { return {ok:false,reason:error?.message || String(error)}; }
      }, [message.identity || {}, !!message.scheduled]);
    }
    if (message?.type === 'NMDA_COMPOSE_ATTACHMENT_STATE') {
      return runMain(tabId, identityArg => {
        try {
          const identity = identityArg || {};
          const targetName = String(identity.name || '');
          if (!targetName) return {ok:false,reason:'compose-identity-name-missing'};
          const group = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
          const modules = Object.values(group).filter(Boolean);
          const target = modules.find(mod => String(mod?.name || '') === targetName) || null;
          if (!target) return {ok:false,reason:'compose-module-not-found'};
          const attach = target.attach || null;
          if (!attach || typeof attach.fileGet !== 'function') return {ok:false,reason:'compose-attach-model-unavailable'};
          const files = attach.fileGet() || [];
          const items = files.map(file => {
            const blob = file?.blob || null;
            return {
              cid:String(file?.cid || ''),
              name:String(file?.name || blob?.name || ''),
              type:String(file?.type || ''),
              state:String(file?.state || ''),
              size:Number(file?.size || blob?.size || 0),
              bytesLoaded:Number(file?.bytesLoaded || 0),
              percent:Number.isFinite(Number(file?.percent)) ? Number(file.percent) : null,
              sid:String(file?.sid || ''),
              fid:String(file?.fid || ''),
              mid:String(file?.mid || ''),
              err:String(file?.err || ''),
              cloud:!!file?.cloud,
              context:!!file?.context,
              inlined:!!file?.inlined,
              blobName:String(blob?.name || ''),
              blobSize:Number(blob?.size || 0),
              blobLastModified:Number(blob?.lastModified || 0)
            };
          });
          let pending = false, hasError = false;
          try { pending = !!attach.fileIsUpload?.(); } catch (_) { pending = items.some(item => ['select','hash','wait','upload','fast','pause'].includes(item.state)); }
          try { hasError = !!attach.fileIsError?.(); } catch (_) { hasError = items.some(item => item.state === 'error'); }
          return {ok:true,identity:{name:targetName},pending,hasError,items};
        } catch (error) { return {ok:false,reason:error?.message||String(error)}; }
      }, [message.identity || {}]);
    }
    if (message?.type === 'NMDA_FAST_ATTACHMENT_BIND') {
      return runMain(tabId, (identityArg, sourcesArg) => new Promise(resolve => {
        try {
          const identity=identityArg||{};
          const targetName=String(identity.name||'');
          const group=window.$?.JS?.modules?.['compose.ComposeModule']||{};
          const target=Object.values(group).filter(Boolean).find(mod=>String(mod?.name||'')===targetName)
            || (String(window.$?.Context?.module?.mtype||'')==='compose.ComposeModule'?window.$.Context.module:null);
          if(!target)return resolve({ok:false,reason:'compose-module-not-found',accepted:[],rejected:(sourcesArg||[]).map(item=>String(item?.assetKey||''))});
          if(typeof target.action?.syncAttach!=='function')return resolve({ok:false,reason:'compose-syncAttach-unavailable',accepted:[],rejected:(sourcesArg||[]).map(item=>String(item?.assetKey||''))});
          if(typeof target.attach?.storageAdd!=='function')return resolve({ok:false,reason:'compose-storageAdd-unavailable',accepted:[],rejected:(sourcesArg||[]).map(item=>String(item?.assetKey||''))});
          const requested=(Array.isArray(sourcesArg)?sourcesArg:[]).map(item=>({
            assetKey:String(item?.assetKey||''),name:String(item?.name||''),size:Number(item?.size||0),mid:String(item?.mid||''),part:String(item?.part||'')
          })).filter(item=>item.assetKey&&item.name&&item.mid&&item.part);
          if(!requested.length)return resolve({ok:true,accepted:[],rejected:[]});
          const normalizeId=value=>{const raw=String(value||'');return raw.includes(':')?raw.split(':').pop():raw;};
          const body=requested.map(item=>({type:'internal',_mid:item.mid,_part:item.part,name:item.name,size:item.size}));
          let settled=false;
          const timer=setTimeout(()=>{if(!settled){settled=true;resolve({ok:false,reason:'fast-attachment-bind-timeout',accepted:[],rejected:requested.map(item=>item.assetKey)});}},9000);
          target.action.syncAttach({attachments:body,callback(response){
            if(settled)return;
            settled=true;clearTimeout(timer);
            try{
              const success=window.$?.S_OK;
              if(response?.code!==undefined && success!==undefined && response.code!==success){
                return resolve({ok:false,reason:`mbox:compose continue code=${String(response.code)}`,accepted:[],rejected:requested.map(item=>item.assetKey)});
              }
              const returned=Array.isArray(response?.var?.attachments)?response.var.attachments:[];
              const acceptedRemote=[];const accepted=[];const rejected=[];
              for(const req of requested){
                const hit=returned.find(item=>{
                  if(!item||item.deleted||String(item.type||'')!=='internal')return false;
                  if(String(item.name||item.fileName||'')!==req.name)return false;
                  const remoteMid=normalizeId(item._mid||item.mid||'');
                  if(remoteMid!==normalizeId(req.mid))return false;
                  const remoteSize=Number(item.size||0);
                  return !req.size||!remoteSize||Math.abs(remoteSize-req.size)<100;
                });
                if(hit){accepted.push(req.assetKey);acceptedRemote.push(hit);}else rejected.push(req.assetKey);
              }
              if(acceptedRemote.length)target.attach.storageAdd(acceptedRemote);
              return resolve({ok:true,method:'mbox:compose-continue-internal',accepted,rejected,count:accepted.length});
            }catch(error){return resolve({ok:false,reason:error?.message||String(error),accepted:[],rejected:requested.map(item=>item.assetKey)});}
          }});
        }catch(error){resolve({ok:false,reason:error?.message||String(error),accepted:[],rejected:(sourcesArg||[]).map(item=>String(item?.assetKey||''))});}
      }),[message.identity||{},message.sources||[]]);
    }
    if (message?.type === 'NMDA_FAST_ATTACHMENT_EXPORT_SOURCE') {
      return runMain(tabId, (identityArg, expectedArg) => new Promise(resolve => {
        try{
          const identity=identityArg||{};
          const targetName=String(identity.name||'');
          const group=window.$?.JS?.modules?.['compose.ComposeModule']||{};
          const target=Object.values(group).filter(Boolean).find(mod=>String(mod?.name||'')===targetName)
            || (String(window.$?.Context?.module?.mtype||'')==='compose.ComposeModule'?window.$.Context.module:null);
          if(!target)return resolve({ok:false,reason:'compose-module-not-found',sources:[]});
          if(!window.$?.DataAction)return resolve({ok:false,reason:'$.DataAction unavailable',sources:[]});
          let draftId='';
          try{draftId=String(target.info?.get?.({did:true})||'');}catch(_){}
          if(!draftId){
            try{const cid=String(target.info?.get?.({cid:true})||'');if(cid&&!cid.startsWith('c:'))draftId=cid;}catch(_){}
          }
          if(!draftId)return resolve({ok:false,reason:'saved-draft-id-unavailable',sources:[]});
          const expected=(Array.isArray(expectedArg)?expectedArg:[]).map(item=>({assetKey:String(item?.assetKey||''),name:String(item?.name||''),size:Number(item?.size||0)})).filter(item=>item.assetKey&&item.name);
          if(!expected.length)return resolve({ok:true,draftId,sources:[]});
          const signature=item=>`${String(item?.name||'').toLowerCase()}|${Number(item?.size||0)}`;
          const duplicateSigs=new Set();const seenSigs=new Set();
          for(const item of expected){const sig=signature(item);if(seenSigs.has(sig))duplicateSigs.add(sig);else seenSigs.add(sig);}
          const normalizeId=value=>{const raw=String(value||'');return raw.includes(':')?raw.split(':').pop():raw;};
          const sameId=(a,b)=>String(a||'')===String(b||'')||normalizeId(a)===normalizeId(b);
          const started=Date.now();
          const request=()=>{
            const action=new window.$.DataAction();
            action.wmsvr({
              func:'mbox:listAttachments',
              body:{order:'date',limit:200,desc:true,skipLockedFolders:true},
              ignoreError:true,
              call(response){
                try{
                  const values=Array.isArray(response?.var)?response.var:(response?.var&&typeof response.var==='object'?Object.values(response.var):[]);
                  const draftItems=values.filter(item=>sameId(item?.id,draftId));
                  const sources=[];const used=new Set();
                  for(const exp of expected){
                    const sig=signature(exp);if(duplicateSigs.has(sig))continue;
                    const index=draftItems.findIndex((item,idx)=>!used.has(idx)&&String(item?.attn||item?.name||'')===exp.name&&(!exp.size||!Number(item?.attsize||item?.size||0)||Math.abs(Number(item?.attsize||item?.size||0)-exp.size)<100)&&String(item?.partId??item?._part??'')!=='');
                    if(index<0)continue;
                    used.add(index);const item=draftItems[index];
                    sources.push({assetKey:exp.assetKey,name:exp.name,size:exp.size,mid:String(item.id||draftId),part:String(item.partId??item._part??''),draftId});
                  }
                  if(sources.length===expected.filter(item=>!duplicateSigs.has(signature(item))).length || Date.now()-started>=5500){
                    return resolve({ok:sources.length>0,draftId,sources,reason:sources.length?'':'attachment-source-not-indexed'});
                  }
                  setTimeout(request,250);
                }catch(error){resolve({ok:false,draftId,sources:[],reason:error?.message||String(error)});}
              },
              error(error){
                if(Date.now()-started<5500)return setTimeout(request,300);
                resolve({ok:false,draftId,sources:[],reason:error?.message||error?.code||'mbox:listAttachments failed'});
              }
            });
          };
          request();
        }catch(error){resolve({ok:false,reason:error?.message||String(error),sources:[]});}
      }),[message.identity||{},message.expected||[]]);
    }

    if (message?.type === 'NMDA_CLOSE_COMPOSE') {
      return runMain(tabId, identityArg => new Promise(resolve => {
        try {
          const identity = identityArg || {};
          const targetName = String(identity.name || '');
          if (!targetName) return resolve({ok:false,reason:'compose-identity-name-missing'});
          const group = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
          const modules = Object.values(group).filter(Boolean);
          const target = modules.find(mod => String(mod?.name || '') === targetName) || null;
          if (!target) return resolve({ok:true,alreadyClosed:true,removed:false});
          if (!window.$?.MultiTab?.remove) return resolve({ok:false,reason:'netease-multitab-remove-unavailable'});
          window.$.MultiTab.remove(target);
          const started = Date.now();
          const check = () => {
            try {
              const currentGroup = window.$?.JS?.modules?.['compose.ComposeModule'] || {};
              const stillExists = Object.values(currentGroup).some(mod => String(mod?.name || '') === targetName);
              if (!stillExists) return resolve({ok:true,removed:true,alreadyClosed:false});
              if (Date.now() - started >= 3500) return resolve({ok:false,reason:'compose-module-still-present-after-close'});
              setTimeout(check, 80);
            } catch (error) { resolve({ok:false,reason:error?.message||String(error)}); }
          };
          setTimeout(check, 60);
        } catch (error) { resolve({ok:false,reason:error?.message||String(error)}); }
      }), [message.identity || {}]);
    }
    if (message?.type === 'NMDA_OPEN_REPLY_ALL_WITH_ATTACHMENTS') {
      return runMain(tabId, (messageIdArg, fidArg) => new Promise(resolve => {
        const messageId = String(messageIdArg || '').trim();
        const fid = Number(fidArg || 3) || 3;
        const started = Date.now();
        if (!messageId) return resolve({ok:false,reason:'reply-parent-message-id-missing'});

        const moduleMessageId = mod => String(
          mod?.reader?.mid || mod?.mid || mod?.reader?.data?.id || mod?.reader?.data?.mid || mod?.folderData?.id || ''
        ).trim();
        const collectReadModules = () => {
          const out = [];
          const context = window.$?.Context?.module || window.$?.Context?.getModule?.() || null;
          if (context && /^read\.(?:Read|Thread)Module$/.test(String(context.mtype || ''))) out.push(context);
          for (const type of ['read.ReadModule','read.ThreadModule']) {
            const group = window.$?.JS?.modules?.[type] || {};
            for (const mod of Object.values(group)) if (mod && !out.includes(mod)) out.push(mod);
          }
          return out;
        };
        const findTarget = () => {
          const modules = collectReadModules();
          return modules.find(mod => moduleMessageId(mod) === messageId)
            || modules.find(mod => String(mod?.reader?.folderData?.fid || mod?.folderData?.fid || '') === String(fid) && decodeURIComponent(String(location.hash || '')).includes(messageId))
            || null;
        };
        const attempt = () => {
          try {
            const target = findTarget();
            const assistant = target?.reader?.assistant || null;
            if (target && assistant && typeof assistant.fullReply === 'function') {
              assistant.fullReply({ withAttachments:true });
              return resolve({
                ok:true,
                method:'reader.assistant.fullReply',
                nativeAction:'reply_all_ach',
                withAttachments:true,
                replyAll:true,
                messageId,
                fid,
                readModuleName:String(target.name || ''),
                readModuleType:String(target.mtype || '')
              });
            }
            if (Date.now() - started >= 10000) {
              return resolve({
                ok:false,
                reason: target ? 'native-read-assistant-fullReply-unavailable' : 'native-read-module-not-ready',
                messageId,
                fid,
                contextType:String(window.$?.Context?.module?.mtype || '')
              });
            }
            setTimeout(attempt, 100);
          } catch (error) {
            resolve({ok:false,reason:error?.message || String(error),messageId,fid});
          }
        };
        attempt();
      }), [message.messageId || '', message.fid || 3]);
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
    if (message?.type === 'NMDA_READ_MAILBOX_STATE') return readMailboxState(tabId, message.mode === 'full' ? 'full' : 'quick', message.historyMonths);
    if (message?.type === 'NMDA_READ_DEDUPE_HISTORY') return readDedupeHistory(tabId, message.historyMonths);
    if (message?.type === 'NMDA_READ_SCHEDULED_DRAFTS') return readScheduledDraftAnchors(tabId, message.historyMonths);
    if (message?.type === 'NMDA_READ_SENT_DETAILS') return readSentDetails(tabId, message.messageIds || []);
    if (message?.type === 'NMDA_IMPORT_DRAFTS') return readDraftImport(tabId,message.limit ?? 300);
    return {ok:false,reason:'unknown-message'};
  })().then(sendResponse).catch(error => sendResponse({ok:false,reason:error?.message||String(error)}));
  return true;
});
