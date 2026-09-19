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
          flags: { ...flags },
          scheduledDraft,
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

async function readDedupeHistory(tabId) {
  const sent = await readMailbox(tabId, 3, -1);
  if (!sent?.ok) return { ok:false, phase:'sent', reason:sent?.reason||'读取已发送失败', sent };
  const drafts = await readMailbox(tabId, 2, -1);
  if (!drafts?.ok) return { ok:false, phase:'drafts', reason:drafts?.reason||'读取草稿箱失败', sent, drafts };
  const complete = !!sent.complete && !!drafts.complete;
  return {
    ok:true, uid:sent.uid||drafts.uid||'', sent, drafts, complete,
    coverage:{
      sent:{read:sent.messages?.length||0,total:sent.total||0,complete:!!sent.complete,pages:sent.pages||0},
      drafts:{read:drafts.messages?.length||0,total:drafts.total||0,complete:!!drafts.complete,pages:drafts.pages||0}
    }
  };
}

async function readMailboxState(tabId, mode = 'quick') {
  const full = mode === 'full';
  const requested = full ? -1 : 500;
  const sent = await readMailbox(tabId, 3, requested);
  if (!sent?.ok) return { ok: false, phase: 'sent', reason: sent?.reason || '读取已发送失败', sent };
  const drafts = await readMailbox(tabId, 2, requested);
  if (!drafts?.ok) return { ok: false, phase: 'drafts', reason: drafts?.reason || '读取草稿箱失败', sent, drafts };
  const inbox = await readMailbox(tabId, 1, requested);
  if (!inbox?.ok) return { ok: false, phase: 'inbox', reason: inbox?.reason || '读取收件箱失败', sent, drafts, inbox };
  const complete = !!sent.complete && !!drafts.complete && !!inbox.complete;
  return {
    ok: true,
    mode: full ? 'full' : 'quick',
    uid: sent.uid || drafts.uid || inbox.uid || '',
    sent, drafts, inbox, complete,
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

function normalizeAppTarget(target = '') {
  const value = String(target || '').trim().replace(/^#+/, '');
  return /^(batch(?:\/[12])?|dispatch|monitor)$/.test(value) ? value : 'batch';
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
    if (message?.type === 'NMDA_READ_DEDUPE_HISTORY') return readDedupeHistory(tabId);
    if (message?.type === 'NMDA_READ_SENT_DETAILS') return readSentDetails(tabId, message.messageIds || []);
    if (message?.type === 'NMDA_IMPORT_DRAFTS') return readDraftImport(tabId,message.limit ?? 300);
    return {ok:false,reason:'unknown-message'};
  })().then(sendResponse).catch(error => sendResponse({ok:false,reason:error?.message||String(error)}));
  return true;
});
