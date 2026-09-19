(() => {
  'use strict';

  const SCHEMA_VERSION = 5;
  const STORAGE_PREFIX = 'nmda.operations.v1:';
  const FOLLOWUP_STATES = ['due', 'prepared', 'confirmed', 'scheduled', 'sent', 'blocked', 'cancelled'];
  const REPLY_KINDS = ['human', 'automatic', 'ambiguous', 'bounce', 'system'];
  const GUARD_MODES = ['normal', 'paused', 'do-not-contact'];
  const COMPOSE_MODES = ['forward', 'reply', 'new'];
  const DEFAULT_FOLLOWUP_POLICY = Object.freeze({ enabled: true, delayDays: 7, maxAttempts: 2, composeMode: 'forward', templateBody: '', templateVersion: 0 });

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeTag(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function parseTags(value) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(/[;,，；|\n]+/);
    const seen = new Set();
    const tags = [];
    for (const item of raw) {
      const tag = normalizeTag(item);
      if (!tag) continue;
      const key = tag.toLocaleLowerCase('zh-CN');
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  }

  function mergeTags(...values) {
    return parseTags(values.flatMap(value => Array.isArray(value) ? value : parseTags(value)));
  }

  function parseRecipients(raw) {
    const text = String(raw || '');
    const results = [];
    const seen = new Set();
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9.-])/ig;
    let match;
    while ((match = emailRegex.exec(text))) {
      const email = normalizeEmail(match[0]);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const left = text.slice(Math.max(0, match.index - 100), match.index);
      const nameMatch = left.match(/(?:^|[;,，；\n])\s*([^<;,，；\n]{1,60})\s*<?\s*$/);
      const name = (nameMatch?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
      results.push({ email, name: name && !name.includes('@') ? name : '' });
    }
    return results;
  }

  function timeMs(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') {
      const n = value < 1e12 ? value * 1000 : value;
      return Number.isFinite(n) ? n : 0;
    }
    const s = String(value).trim();
    if (/^\d{10,13}$/.test(s)) {
      const n = Number(s);
      return n < 1e12 ? n * 1000 : n;
    }
    const direct = Date.parse(s);
    if (Number.isFinite(direct)) return direct;
    const normalized = s.replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, ' ').replace(/\s+/g, ' ').trim();
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isoTime(value) {
    const ms = timeMs(value);
    return ms ? new Date(ms).toISOString() : '';
  }

  function formatDisplayTime(value) {
    const ms = timeMs(value);
    if (!ms) return '—';
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }


  function subjectThreadKey(value) {
    let text = String(value || '').trim();
    let previous = '';
    while (text && text !== previous) {
      previous = text;
      text = text.replace(/^\s*(?:(?:re|fw|fwd|aw|sv)\s*[:：]|回复\s*[:：]|答复\s*[:：]|转发\s*[:：])\s*/i, '');
    }
    return text.toLocaleLowerCase('zh-CN').replace(/[\s\u00a0]+/g, ' ').trim();
  }

  function recipientKey(recipients = []) {
    return [...new Set((recipients || []).map(item => normalizeEmail(item?.email || item?.address)).filter(Boolean))].sort().join(';');
  }

  function truthyFlag(flags, patterns = []) {
    const source = flags && typeof flags === 'object' ? flags : {};
    return Object.entries(source).some(([key, value]) => {
      if (!value || value === '0' || value === 0 || value === false) return false;
      const normalized = String(key || '').toLowerCase();
      return patterns.some(pattern => normalized.includes(pattern));
    });
  }

  function classifyInboundMessage(message = {}) {
    const subject = String(message.subject || '');
    const sender = normalizeEmail(message.sender?.email || message.sender || message.from || '');
    const flags = message.flags || {};
    const bounceSubject = /(mail delivery|delivery status|delivery failure|undeliver|returned mail|failure notice|退信|投递失败|无法投递|邮件投递)/i.test(subject);
    if (bounceSubject || /(?:mailer-daemon|postmaster)@/i.test(sender)) {
      return { kind: 'bounce', evidence: { rule: bounceSubject ? 'subject-bounce-pattern' : 'sender-bounce-pattern' } };
    }
    const automaticFlag = truthyFlag(flags, ['autoreply', 'auto_reply', 'autoresponse', 'auto_response', 'vacation', 'outofoffice', 'ooo']);
    const automaticSubject = /(automatic reply|auto(?:matic)?[- ]?reply|out of office|away from (?:the )?office|vacation reply|自动回复|自动答复|不在办公室|休假自动|外出自动)/i.test(subject);
    if (automaticFlag || automaticSubject) {
      return { kind: 'automatic', evidence: { rule: automaticFlag ? 'mailbox-auto-flag' : 'subject-auto-pattern' } };
    }
    if (/(?:no[-_.]?reply|noreply|do[-_.]?not[-_.]?reply)@/i.test(sender)) {
      return { kind: 'system', evidence: { rule: 'sender-no-reply-pattern' } };
    }
    return { kind: 'human', evidence: { rule: 'ordinary-inbound' } };
  }

  function storageKey(account) {
    return `${STORAGE_PREFIX}${normalizeEmail(account) || 'default'}`;
  }

  function nowIso() { return new Date().toISOString(); }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function createStore(account = 'default') {
    const now = nowIso();
    return {
      schemaVersion: SCHEMA_VERSION,
      account: normalizeEmail(account) || 'default',
      createdAt: now,
      updatedAt: now,
      outboundRecords: {},
      draftRecords: {},
      inboundRecords: {},
      replyObservations: {},
      derivedTasks: {},
      recipientGuards: {},
      followUpPolicies: { default: { ...DEFAULT_FOLLOWUP_POLICY }, overrides: {} },
      mailboxSync: {},
      migration: {}
    };
  }

  function normalizePolicy(value = {}) {
    const delayDays = Math.max(0, Number(value.delayDays ?? DEFAULT_FOLLOWUP_POLICY.delayDays) || 0);
    const maxAttempts = Math.max(0, Math.floor(Number(value.maxAttempts ?? DEFAULT_FOLLOWUP_POLICY.maxAttempts) || 0));
    const composeMode = COMPOSE_MODES.includes(value.composeMode) ? value.composeMode : DEFAULT_FOLLOWUP_POLICY.composeMode;
    const templateBody = String(value.templateBody ?? DEFAULT_FOLLOWUP_POLICY.templateBody).replace(/\r\n?/g, '\n').trim();
    const templateVersion = Math.max(0, Math.floor(Number(value.templateVersion ?? DEFAULT_FOLLOWUP_POLICY.templateVersion) || 0));
    return { enabled: value.enabled !== false, delayDays, maxAttempts, composeMode, templateBody, templateVersion };
  }

  function normalizeStore(raw, account = '') {
    const base = createStore(account || raw?.account || 'default');
    if (!raw || typeof raw !== 'object') return base;
    const store = {
      ...base,
      ...raw,
      schemaVersion: SCHEMA_VERSION,
      account: normalizeEmail(raw.account || account) || 'default',
      outboundRecords: raw.outboundRecords && typeof raw.outboundRecords === 'object' ? raw.outboundRecords : {},
      draftRecords: raw.draftRecords && typeof raw.draftRecords === 'object' ? raw.draftRecords : {},
      inboundRecords: raw.inboundRecords && typeof raw.inboundRecords === 'object' ? raw.inboundRecords : {},
      replyObservations: raw.replyObservations && typeof raw.replyObservations === 'object' ? raw.replyObservations : {},
      derivedTasks: raw.derivedTasks && typeof raw.derivedTasks === 'object' ? raw.derivedTasks : {},
      recipientGuards: raw.recipientGuards && typeof raw.recipientGuards === 'object' ? raw.recipientGuards : {},
      followUpPolicies: {
        default: normalizePolicy(raw.followUpPolicies?.default || DEFAULT_FOLLOWUP_POLICY),
        overrides: raw.followUpPolicies?.overrides && typeof raw.followUpPolicies.overrides === 'object' ? raw.followUpPolicies.overrides : {}
      },
      mailboxSync: raw.mailboxSync && typeof raw.mailboxSync === 'object' ? raw.mailboxSync : {},
      migration: raw.migration && typeof raw.migration === 'object' ? raw.migration : {}
    };
    for (const [key, guard] of Object.entries(store.recipientGuards)) {
      const mode = GUARD_MODES.includes(guard?.mode) ? guard.mode : 'normal';
      store.recipientGuards[normalizeEmail(key)] = { ...guard, email: normalizeEmail(guard?.email || key), mode };
      if (normalizeEmail(key) !== key) delete store.recipientGuards[key];
    }
    for (const [key, task] of Object.entries(store.derivedTasks)) {
      if (!task || typeof task !== 'object') continue;
      const dispatch = task.dispatch && typeof task.dispatch === 'object' ? task.dispatch : {};
      store.derivedTasks[key] = {
        ...task,
        dispatch: {
          queued: dispatch.queued === true,
          enabled: dispatch.enabled !== false,
          scheduleAt: String(dispatch.scheduleAt || task.scheduledAt || ''),
          scheduleSource: String(dispatch.scheduleSource || ''),
          scheduleReason: String(dispatch.scheduleReason || ''),
          queuedAt: String(dispatch.queuedAt || ''),
          dequeuedAt: String(dispatch.dequeuedAt || ''),
          dequeuedReason: String(dispatch.dequeuedReason || '')
        }
      };
    }
    return store;
  }

  function providerRecordId(kind, message, fallback = '') {
    const providerId = String(message?.id || message?.messageId || message?.providerMessageId || '').trim();
    if (providerId) return `${kind}:provider:${providerId}`;
    const stamp = message?.sentAt ?? message?.savedAt ?? message?.receivedAt ?? message?.sentDate ?? message?.date ?? '';
    const recipients = (message?.recipients || []).map(item => normalizeEmail(item?.email || item?.address)).filter(Boolean).sort().join(',');
    return `${kind}:derived:${stableHash(`${stamp}|${message?.subject || ''}|${recipients}|${fallback}`)}`;
  }

  function outboundFromMailbox(message) {
    const recipients = (message?.recipients || []).map(item => ({
      email: normalizeEmail(item?.email || item?.address),
      name: String(item?.name || '').trim()
    })).filter(item => item.email);
    const id = providerRecordId('outbound', message);
    return {
      id,
      providerMessageId: String(message?.id || message?.messageId || '').trim(),
      source: 'mailbox',
      status: message?.failed ? 'failed' : 'sent',
      kind: 'unlinked',
      taskId: '',
      rootTaskId: '',
      parentTaskId: '',
      parentOutboundId: '',
      sequence: 0,
      recipients,
      subject: String(message?.subject || ''),
      sentAt: isoTime(message?.sentAt ?? message?.sentDate ?? message?.date),
      observedAt: nowIso(),
      mailboxFolder: 'sent'
    };
  }

  function draftFromMailbox(message) {
    const recipients = (message?.recipients || []).map(item => ({
      email: normalizeEmail(item?.email || item?.address),
      name: String(item?.name || '').trim()
    })).filter(item => item.email);
    const id = providerRecordId('draft', message);
    return {
      id,
      providerMessageId: String(message?.id || message?.messageId || '').trim(),
      source: 'mailbox',
      status: 'present',
      kind: 'unlinked',
      taskId: '',
      rootTaskId: '',
      parentTaskId: '',
      parentOutboundId: '',
      sequence: 0,
      recipients,
      subject: String(message?.subject || ''),
      savedAt: isoTime(message?.savedAt ?? message?.sentAt ?? message?.sentDate ?? message?.date ?? message?.receivedDate),
      scheduleAt: isoTime(message?.scheduleAt || message?.sendAt || ''),
      observedAt: nowIso(),
      mailboxFolder: 'draft'
    };
  }


  function inboundFromMailbox(message) {
    const senderEmail = normalizeEmail(message?.sender?.email || message?.senderEmail || message?.fromEmail || message?.from || '');
    const senderName = String(message?.sender?.name || message?.senderName || '').trim();
    const id = providerRecordId('inbound', message, senderEmail);
    return {
      id,
      providerMessageId: String(message?.id || message?.messageId || '').trim(),
      source: 'mailbox',
      sender: { email: senderEmail, name: senderName },
      subject: String(message?.subject || ''),
      receivedAt: isoTime(message?.receivedAt ?? message?.receivedDate ?? message?.date ?? message?.sentAt),
      threadId: String(message?.threadId || message?.conversationId || '').trim(),
      inReplyTo: String(message?.inReplyTo || '').trim(),
      references: String(message?.references || '').trim(),
      flags: message?.flags && typeof message.flags === 'object' ? clone(message.flags) : {},
      observedAt: nowIso(),
      mailboxFolder: 'inbox'
    };
  }

  function sameRecipientSet(a = [], b = []) {
    const left = recipientKey(a), right = recipientKey(b);
    return !!left && left === right;
  }

  function reconcileOutboundsToDrafts(storeInput) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const drafts = Object.values(next.draftRecords).filter(record => record?.rootTaskId && record?.taskId);
    let linked = 0;
    for (const outbound of Object.values(next.outboundRecords)) {
      if (!outbound || outbound.status !== 'sent' || outbound.rootTaskId) continue;
      const sentMs = timeMs(outbound.sentAt);
      const outSubject = subjectThreadKey(outbound.subject);
      const candidates = drafts.map(draft => {
        const savedMs = timeMs(draft.scheduleAt || draft.savedAt);
        if (!savedMs || !sentMs || sentMs < savedMs - 6 * 3600000 || sentMs > savedMs + 45 * 86400000) return null;
        let score = 0;
        if (sameRecipientSet(outbound.recipients, draft.recipients)) score += 8;
        else {
          const outSet = new Set((outbound.recipients || []).map(item => normalizeEmail(item.email)).filter(Boolean));
          if ((draft.recipients || []).some(item => outSet.has(normalizeEmail(item.email)))) score += 4;
        }
        if (outSubject && outSubject === subjectThreadKey(draft.subject)) score += 8;
        const distanceDays = Math.abs(sentMs - savedMs) / 86400000;
        score += Math.max(0, 4 - Math.min(4, distanceDays));
        return score >= 12 ? { draft, score, savedMs } : null;
      }).filter(Boolean).sort((a, b) => b.score - a.score || b.savedMs - a.savedMs);
      if (!candidates.length) continue;
      if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].draft.rootTaskId !== candidates[0].draft.rootTaskId) continue;
      const draft = candidates[0].draft;
      outbound.taskId = draft.taskId;
      outbound.rootTaskId = draft.rootTaskId;
      outbound.parentTaskId = draft.parentTaskId || '';
      outbound.parentOutboundId = draft.parentOutboundId || '';
      outbound.sequence = Number(draft.sequence || 0);
      outbound.kind = draft.kind === 'follow_up' || Number(draft.sequence || 0) > 0 ? 'follow_up' : 'initial';
      outbound.linkedAt = nowIso();
      outbound.linkEvidence = { kind: 'draft-reconciliation', draftId: draft.id, score: candidates[0].score };
      draft.status = 'sent';
      draft.sentOutboundId = outbound.id;
      draft.sentAt = outbound.sentAt;
      if (draft.kind === 'follow_up' && next.derivedTasks[draft.taskId]) {
        const task = next.derivedTasks[draft.taskId];
        task.state = 'sent';
        task.sentOutboundId = outbound.id;
        task.updatedAt = nowIso();
      }
      linked++;
    }
    next.updatedAt = nowIso();
    return { store: next, linked };
  }

  function ensureMonitoringRoots(storeInput) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    let adopted = 0;
    for (const outbound of Object.values(next.outboundRecords)) {
      if (!outbound || outbound.status !== 'sent' || outbound.rootTaskId) continue;
      const rootTaskId = `mailroot:${stableHash(outbound.providerMessageId || outbound.id)}`;
      outbound.taskId = rootTaskId;
      outbound.rootTaskId = rootTaskId;
      outbound.parentTaskId = '';
      outbound.parentOutboundId = '';
      outbound.sequence = 0;
      outbound.kind = 'initial';
      outbound.linkedAt = outbound.linkedAt || nowIso();
      outbound.linkEvidence = { kind: 'automatic-mailbox-monitoring' };
      adopted++;
    }
    if (adopted) next.updatedAt = nowIso();
    return { store: next, adopted };
  }

  function findReplyAssociationCandidates(storeInput, inbound) {
    const store = normalizeStore(storeInput);
    const sender = normalizeEmail(inbound?.sender?.email || inbound?.sender || '');
    const receivedMs = timeMs(inbound?.receivedAt);
    if (!sender || !receivedMs) return [];
    const subjectKey = subjectThreadKey(inbound.subject);
    const refs = `${inbound.inReplyTo || ''} ${inbound.references || ''}`;
    return Object.values(store.outboundRecords).filter(outbound => {
      if (!outbound?.rootTaskId || outbound.status !== 'sent') return false;
      if (timeMs(outbound.sentAt) > receivedMs) return false;
      return (outbound.recipients || []).some(item => normalizeEmail(item.email) === sender);
    }).map(outbound => {
      let score = 0;
      const outboundSubject = subjectThreadKey(outbound.subject);
      if (subjectKey && outboundSubject && subjectKey === outboundSubject) score += 10;
      if (outbound.providerMessageId && refs.includes(outbound.providerMessageId)) score += 20;
      const ageDays = Math.max(0, (receivedMs - timeMs(outbound.sentAt)) / 86400000);
      if (ageDays <= 2) score += 4;
      else if (ageDays <= 14) score += 3;
      else if (ageDays <= 45) score += 2;
      else if (ageDays <= 120) score += 1;
      return { outbound, score, subjectMatch: !!subjectKey && subjectKey === outboundSubject, ageDays };
    }).filter(item => item.ageDays <= 180).sort((a, b) => b.score - a.score || timeMs(b.outbound.sentAt) - timeMs(a.outbound.sentAt));
  }

  function reconcileInboundReplies(storeInput) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    let associated = 0, ambiguous = 0, automatic = 0, human = 0;
    for (const inbound of Object.values(next.inboundRecords)) {
      if (!inbound?.sender?.email) continue;
      const obsId = inbound.providerMessageId ? `reply:provider:${inbound.providerMessageId}` : `reply:inbound:${stableHash(inbound.id)}`;
      const existing = next.replyObservations[obsId];
      if (existing?.evidence?.manual === true) continue;
      const candidates = findReplyAssociationCandidates(next, inbound);
      if (!candidates.length) {
        if (existing && !existing.rootTaskId) next.replyObservations[obsId] = { ...existing, observedAt: nowIso() };
        continue;
      }
      const best = candidates[0];
      const classified = classifyInboundMessage(inbound);
      const strong = best.subjectMatch || best.score >= 12 || (classified.kind === 'automatic' && candidates.length === 1);
      const kind = strong ? classified.kind : 'ambiguous';
      const observation = {
        id: obsId,
        providerMessageId: inbound.providerMessageId || '',
        source: 'mailbox-monitor',
        kind,
        sender: inbound.sender.email,
        subject: inbound.subject,
        receivedAt: inbound.receivedAt,
        rootTaskId: best.outbound.rootTaskId,
        relatedOutboundId: best.outbound.id,
        evidence: {
          ...classified.evidence,
          association: strong ? (best.subjectMatch ? 'sender+subject' : 'provider-reference') : 'sender-only',
          score: best.score,
          inboundId: inbound.id,
          candidates: candidates.slice(0, 4).map(item => ({ outboundId: item.outbound.id, rootTaskId: item.outbound.rootTaskId, score: item.score }))
        },
        observedAt: nowIso()
      };
      next.replyObservations[obsId] = observation;
      associated++;
      if (kind === 'ambiguous') ambiguous++;
      else if (kind === 'automatic') automatic++;
      else if (kind === 'human') human++;
    }
    const refreshed = refreshDerivedTaskBlocks(next);
    return { store: refreshed.store, associated, ambiguous, automatic, human, blockedTasks: refreshed.blockedTasks, restoredTasks: refreshed.restoredTasks };
  }

  function setReplyObservationDisposition(storeInput, observationId, disposition) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const observation = next.replyObservations[observationId];
    if (!observation) throw new Error(`找不到 reply observation：${observationId}`);
    if (!['human', 'automatic', 'unrelated'].includes(disposition)) throw new Error(`未知回复处理方式：${disposition}`);
    if (disposition === 'unrelated') {
      observation.kind = 'system';
      observation.rootTaskId = '';
      observation.relatedOutboundId = '';
    } else {
      observation.kind = disposition;
    }
    observation.evidence = { ...(observation.evidence || {}), manual: true, manualDisposition: disposition, changedAt: nowIso() };
    observation.observedAt = nowIso();
    const refreshed = refreshDerivedTaskBlocks(next);
    refreshed.store.updatedAt = nowIso();
    return { store: refreshed.store, observation: refreshed.store.replyObservations[observationId] };
  }

  function ingestMailboxSnapshot(storeInput, sentMessages = [], draftMessages = [], inboxMessages = [], options = {}) {
    if (!Array.isArray(inboxMessages)) {
      options = inboxMessages || {};
      inboxMessages = [];
    }
    const store = normalizeStore(storeInput);
    const full = options.mode === 'full' || options.full === true;
    if (full && options.complete !== true) throw new Error('完整覆盖要求 complete=true，避免用不完整邮箱快照删除事实。');
    const next = clone(store);
    const observedAt = nowIso();
    const incomingOutbound = {};
    const incomingDrafts = {};
    const incomingInbound = {};
    let failedMessages = 0;
    let draftsWithoutRecipient = 0;
    let inboundWithoutSender = 0;

    for (const message of sentMessages || []) {
      if (message?.failed) { failedMessages++; continue; }
      const record = outboundFromMailbox(message);
      if (!record.recipients.length) continue;
      const existing = next.outboundRecords[record.id] || {};
      incomingOutbound[record.id] = {
        ...existing, ...record, observedAt,
        taskId: existing.taskId || record.taskId || '',
        rootTaskId: existing.rootTaskId || record.rootTaskId || '',
        parentTaskId: existing.parentTaskId || record.parentTaskId || '',
        parentOutboundId: existing.parentOutboundId || record.parentOutboundId || '',
        sequence: existing.rootTaskId ? Number(existing.sequence || 0) : Number(record.sequence || 0),
        kind: existing.rootTaskId ? (existing.kind || 'initial') : record.kind
      };
    }
    for (const message of draftMessages || []) {
      const record = draftFromMailbox(message);
      if (!record.recipients.length) { draftsWithoutRecipient++; continue; }
      const existing = next.draftRecords[record.id] || {};
      incomingDrafts[record.id] = {
        ...existing, ...record, observedAt,
        taskId: existing.taskId || record.taskId || '',
        rootTaskId: existing.rootTaskId || record.rootTaskId || '',
        parentTaskId: existing.parentTaskId || record.parentTaskId || '',
        parentOutboundId: existing.parentOutboundId || record.parentOutboundId || '',
        sequence: existing.rootTaskId ? Number(existing.sequence || 0) : Number(record.sequence || 0),
        kind: existing.rootTaskId ? (existing.kind || 'initial') : record.kind
      };
    }
    for (const message of inboxMessages || []) {
      const record = inboundFromMailbox(message);
      if (!record.sender.email) { inboundWithoutSender++; continue; }
      const existing = next.inboundRecords[record.id] || {};
      incomingInbound[record.id] = { ...existing, ...record, observedAt };
    }

    if (full) {
      const linkedOutbound = Object.fromEntries(Object.entries(next.outboundRecords).filter(([, record]) => record?.source !== 'mailbox' || record?.taskId || record?.rootTaskId));
      const linkedDrafts = Object.fromEntries(Object.entries(next.draftRecords).filter(([, record]) => record?.source !== 'mailbox' || record?.taskId || record?.rootTaskId));
      next.outboundRecords = { ...linkedOutbound, ...incomingOutbound };
      next.draftRecords = { ...linkedDrafts, ...incomingDrafts };
      next.inboundRecords = { ...incomingInbound };
    } else {
      next.outboundRecords = { ...next.outboundRecords, ...incomingOutbound };
      next.draftRecords = { ...next.draftRecords, ...incomingDrafts };
      next.inboundRecords = { ...next.inboundRecords, ...incomingInbound };
    }

    const linked = reconcileOutboundsToDrafts(next);
    const monitored = ensureMonitoringRoots(linked.store);
    const replies = reconcileInboundReplies(monitored.store);
    const finalStore = replies.store;
    finalStore.mailboxSync = {
      ...finalStore.mailboxSync,
      lastMode: full ? 'full' : 'quick',
      complete: full,
      lastQuickAt: !full ? observedAt : finalStore.mailboxSync.lastQuickAt || '',
      lastFullAt: full ? observedAt : finalStore.mailboxSync.lastFullAt || '',
      sent: options.sentCoverage || { read: Object.keys(incomingOutbound).length },
      drafts: options.draftCoverage || { read: Object.keys(incomingDrafts).length },
      inbox: options.inboxCoverage || { read: Object.keys(incomingInbound).length }
    };
    finalStore.updatedAt = observedAt;
    return {
      store: finalStore,
      outboundRead: Object.keys(incomingOutbound).length,
      draftsRead: Object.keys(incomingDrafts).length,
      inboxRead: Object.keys(incomingInbound).length,
      autoMonitored: monitored.adopted,
      linkedOutbounds: linked.linked,
      repliesAssociated: replies.associated,
      ambiguousReplies: replies.ambiguous,
      automaticReplies: replies.automatic,
      humanReplies: replies.human,
      failedMessages,
      draftsWithoutRecipient,
      inboundWithoutSender
    };
  }


  function ingestMailboxDedupeSnapshot(storeInput, sentMessages = [], draftMessages = [], options = {}) {
    if (options.complete !== true) throw new Error('导入查重要求已发送与草稿箱完整读取，避免遗漏历史重复。');
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const observedAt = nowIso();
    const incomingOutbound = {};
    const incomingDrafts = {};
    let failedMessages = 0;
    let draftsWithoutRecipient = 0;

    for (const message of sentMessages || []) {
      if (message?.failed) { failedMessages++; continue; }
      const record = outboundFromMailbox(message);
      if (!record.recipients.length) continue;
      const existing = next.outboundRecords[record.id] || {};
      incomingOutbound[record.id] = {
        ...existing, ...record, observedAt,
        taskId: existing.taskId || record.taskId || '',
        rootTaskId: existing.rootTaskId || record.rootTaskId || '',
        parentTaskId: existing.parentTaskId || record.parentTaskId || '',
        parentOutboundId: existing.parentOutboundId || record.parentOutboundId || '',
        sequence: existing.rootTaskId ? Number(existing.sequence || 0) : Number(record.sequence || 0),
        kind: existing.rootTaskId ? (existing.kind || 'initial') : record.kind
      };
    }
    for (const message of draftMessages || []) {
      const record = draftFromMailbox(message);
      if (!record.recipients.length) { draftsWithoutRecipient++; continue; }
      const existing = next.draftRecords[record.id] || {};
      incomingDrafts[record.id] = {
        ...existing, ...record, observedAt,
        taskId: existing.taskId || record.taskId || '',
        rootTaskId: existing.rootTaskId || record.rootTaskId || '',
        parentTaskId: existing.parentTaskId || record.parentTaskId || '',
        parentOutboundId: existing.parentOutboundId || record.parentOutboundId || '',
        sequence: existing.rootTaskId ? Number(existing.sequence || 0) : Number(record.sequence || 0),
        kind: existing.rootTaskId ? (existing.kind || 'initial') : record.kind
      };
    }

    const linkedOutbound = Object.fromEntries(Object.entries(next.outboundRecords).filter(([, record]) => record?.source !== 'mailbox' || record?.taskId || record?.rootTaskId));
    const linkedDrafts = Object.fromEntries(Object.entries(next.draftRecords).filter(([, record]) => record?.source !== 'mailbox' || record?.taskId || record?.rootTaskId));
    next.outboundRecords = { ...linkedOutbound, ...incomingOutbound };
    next.draftRecords = { ...linkedDrafts, ...incomingDrafts };

    const linked = reconcileOutboundsToDrafts(next);
    const monitored = ensureMonitoringRoots(linked.store);
    const finalStore = monitored.store;
    finalStore.mailboxSync = {
      ...finalStore.mailboxSync,
      lastDedupeAt: observedAt,
      dedupeComplete: true,
      sent: options.sentCoverage || { read: Object.keys(incomingOutbound).length, complete: true },
      drafts: options.draftCoverage || { read: Object.keys(incomingDrafts).length, complete: true }
    };
    finalStore.updatedAt = observedAt;
    return {
      store: finalStore,
      outboundRead: Object.keys(incomingOutbound).length,
      draftsRead: Object.keys(incomingDrafts).length,
      autoMonitored: monitored.adopted,
      linkedOutbounds: linked.linked,
      failedMessages,
      draftsWithoutRecipient
    };
  }

  function recordPreparedDraft(storeInput, task = {}, outcome = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const taskId = String(task.editKey || task.id || '').trim();
    if (!taskId) throw new Error('记录草稿需要 task id。');
    const rootTaskId = String(task.rootTaskId || (task.kind === 'follow_up' ? task.parentTaskId : '') || taskId);
    const parentTaskId = String(task.parentTaskId || '');
    const parentOutboundId = String(task.parentOutboundId || '');
    const sequence = Math.max(0, Number(task.sequence || 0) || 0);
    const providerMessageId = String(outcome?.providerMessageId || outcome?.draftId || outcome?.saveOutcome?.id || '').trim();
    const id = providerMessageId ? `draft:provider:${providerMessageId}` : `draft:task:${stableHash(`${taskId}|${task.subject || ''}|${task.scheduleAt || ''}`)}`;
    next.draftRecords[id] = {
      ...(next.draftRecords[id] || {}), id, providerMessageId, source: 'execution', status: 'prepared',
      kind: task.kind === 'follow_up' ? 'follow_up' : 'initial', taskId, rootTaskId, parentTaskId, parentOutboundId, sequence,
      recipients: parseRecipients(task.recipients || ''), subject: String(task.subject || ''),
      savedAt: nowIso(), scheduleAt: isoTime(task.scheduleAt || ''), composeMode: task.composeMode || (task.kind === 'follow_up' ? 'forward' : 'new'),
      contentVersion: Math.max(1, Number(task.contentVersion || 1) || 1)
    };
    next.updatedAt = nowIso();
    return { store: next, record: next.draftRecords[id] };
  }

  function linkOutbound(storeInput, outboundId, link = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const record = next.outboundRecords[outboundId];
    if (!record) throw new Error(`找不到 outbound record：${outboundId}`);
    const taskId = String(link.taskId || record.taskId || '').trim();
    const rootTaskId = String(link.rootTaskId || record.rootTaskId || taskId).trim();
    const sequence = Math.max(0, Number(link.sequence ?? record.sequence ?? 0) || 0);
    next.outboundRecords[outboundId] = {
      ...record,
      taskId,
      rootTaskId,
      parentTaskId: String(link.parentTaskId || record.parentTaskId || ''),
      parentOutboundId: String(link.parentOutboundId || record.parentOutboundId || ''),
      sequence,
      kind: sequence > 0 || link.kind === 'follow_up' ? 'follow_up' : 'initial',
      linkedAt: nowIso()
    };
    next.updatedAt = nowIso();
    return { store: next, record: next.outboundRecords[outboundId] };
  }

  function setRecipientGuard(storeInput, email, mode = 'normal', details = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    email = normalizeEmail(email);
    if (!email) throw new Error('recipient guard 需要邮箱。');
    if (!GUARD_MODES.includes(mode)) throw new Error(`未知 recipient guard：${mode}`);
    if (mode === 'normal') delete next.recipientGuards[email];
    else next.recipientGuards[email] = { email, mode, reason: String(details.reason || ''), source: details.source || 'manual', changedAt: nowIso() };
    next.updatedAt = nowIso();
    return { store: next, guard: next.recipientGuards[email] || { email, mode: 'normal' } };
  }

  function initialOutboundForRoot(storeInput, rootTaskId) {
    const outbounds = outboundForRoot(storeInput, rootTaskId);
    return outbounds.find(item => Number(item.sequence || 0) === 0) || outbounds[0] || null;
  }

  function setOutboundContentSnapshot(storeInput, outboundId, content = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const record = next.outboundRecords[String(outboundId || '')];
    if (!record) throw new Error(`找不到 outbound record：${outboundId}`);
    const body = String(content.body || '').replace(/\r\n?/g, '\n').trim();
    record.body = body;
    record.bodyHtml = String(content.bodyHtml || '');
    record.bodyIsHtml = content.bodyIsHtml === true || content.isHtml === true;
    record.contentObservedAt = nowIso();
    record.contentSource = String(content.source || 'initial-message-detail');
    record.contentReadError = '';
    record.contentReadErrorDetail = '';
    record.contentReadAttemptedAt = record.contentObservedAt;
    next.updatedAt = nowIso();
    return { store: next, record };
  }

  function setOutboundContentReadFailure(storeInput, outboundId, code = 'sent-read-failed', detail = '') {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const record = next.outboundRecords[String(outboundId || '')];
    if (!record) throw new Error(`找不到 outbound record：${outboundId}`);
    record.contentReadError = String(code || 'sent-read-failed');
    record.contentReadErrorDetail = String(detail || '');
    record.contentReadAttemptedAt = nowIso();
    next.updatedAt = nowIso();
    return { store: next, record };
  }

  function extractInitialPersonalization(bodyRaw = '') {
    const body = String(bodyRaw || '').replace(/\r\n?/g, '\n').trim();
    if (!body) return { ok: false, salutation: '', signature: '', reason: 'initial-body-missing' };
    const lines = body.split('\n');
    let first = 0;
    while (first < lines.length && !lines[first].trim()) first++;
    let salutation = '';
    if (first < lines.length && /^(?:dear\b|hi\b|hello\b|prof(?:essor)?\.?\b|dr\.?\b|尊敬的|您好)/i.test(lines[first].trim())) {
      salutation = lines[first].trim();
    }
    let close = -1;
    const closeRe = /^(?:best(?:\s+regards)?|kind\s+regards|warm\s+regards|regards|sincerely|yours\s+sincerely|best\s+wishes|many\s+thanks|thank\s+you|谢谢|此致|祝好)[,!，！。]?$/i;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
      if (closeRe.test(lines[i].trim())) { close = i; break; }
    }
    const signature = close >= 0 ? lines.slice(close).join('\n').trim() : '';
    if (!salutation || !signature) return { ok: false, salutation, signature, reason: !salutation && !signature ? 'salutation-and-signature-missing' : (!salutation ? 'salutation-missing' : 'signature-missing') };
    return { ok: true, salutation, signature, reason: '' };
  }

  function renderFollowUpTemplate(storeInput, rootTaskId, policyInput = null) {
    const store = normalizeStore(storeInput);
    const policy = policyInput ? normalizePolicy(policyInput) : policyForRoot(store, rootTaskId);
    if (!policy.templateBody) return { ok: false, reason: 'template-missing', body: '', policy };
    const initial = initialOutboundForRoot(store, rootTaskId);
    if (!initial) return { ok: false, reason: 'initial-outbound-missing', body: '', policy };
    if (!String(initial.body || '').trim() && initial.contentReadError) {
      return { ok: false, reason: String(initial.contentReadError), reasonDetail: String(initial.contentReadErrorDetail || ''), body: '', policy, initial };
    }
    const personalization = extractInitialPersonalization(initial.body || '');
    if (!personalization.ok) return { ok: false, reason: personalization.reason, body: '', policy, initial, personalization };
    const body = [personalization.salutation, policy.templateBody, personalization.signature].filter(Boolean).join('\n\n');
    return { ok: true, body, policy, initial, personalization };
  }

  function guardForRecipients(storeInput, recipientsRaw) {
    const store = normalizeStore(storeInput);
    const matches = [];
    for (const recipient of parseRecipients(recipientsRaw)) {
      const guard = store.recipientGuards[recipient.email];
      if (guard && guard.mode !== 'normal') matches.push(guard);
    }
    const modes = [...new Set(matches.map(item => item.mode))];
    return {
      blocked: matches.length > 0,
      modes,
      reasons: matches.map(item => `${item.email}：${item.mode === 'do-not-contact' ? '不再联系' : '暂停'}`),
      matches
    };
  }

  function policyForRoot(storeInput, rootTaskId) {
    const store = normalizeStore(storeInput);
    const override = store.followUpPolicies.overrides?.[String(rootTaskId || '')] || {};
    return normalizePolicy({ ...store.followUpPolicies.default, ...override });
  }

  function setFollowUpPolicy(storeInput, rootTaskId, patch = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const key = String(rootTaskId || '');
    const current = key ? policyForRoot(next, key) : normalizePolicy(next.followUpPolicies.default);
    const candidate = { ...current, ...patch };
    if (patch.templateBody !== undefined && String(patch.templateBody || '').replace(/\r\n?/g, '\n').trim() !== current.templateBody) {
      candidate.templateVersion = Math.max(1, Number(current.templateVersion || 0) + 1);
    }
    if (!key) {
      next.followUpPolicies.default = normalizePolicy(candidate);
    } else {
      const existingOverride = next.followUpPolicies.overrides[key] && typeof next.followUpPolicies.overrides[key] === 'object' ? next.followUpPolicies.overrides[key] : {};
      const overridePatch = { ...patch };
      if (patch.templateBody !== undefined) overridePatch.templateVersion = candidate.templateVersion;
      next.followUpPolicies.overrides[key] = { ...existingOverride, ...overridePatch };
    }
    next.updatedAt = nowIso();
    return { store: next, policy: policyForRoot(next, key) };
  }

  function recordReplyObservation(storeInput, observation = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const kind = REPLY_KINDS.includes(observation.kind) ? observation.kind : 'ambiguous';
    const receivedAt = isoTime(observation.receivedAt || observation.date || nowIso()) || nowIso();
    const providerMessageId = String(observation.providerMessageId || observation.id || '').trim();
    const rootTaskId = String(observation.rootTaskId || '').trim();
    const relatedOutboundId = String(observation.relatedOutboundId || '').trim();
    const id = providerMessageId
      ? `reply:provider:${providerMessageId}`
      : `reply:derived:${stableHash(`${rootTaskId}|${relatedOutboundId}|${observation.sender || ''}|${receivedAt}|${observation.subject || ''}`)}`;
    next.replyObservations[id] = {
      id, providerMessageId, source: observation.source || 'mailbox', kind,
      sender: normalizeEmail(observation.sender || observation.from || ''), subject: String(observation.subject || ''), receivedAt,
      rootTaskId, relatedOutboundId,
      evidence: observation.evidence && typeof observation.evidence === 'object' ? clone(observation.evidence) : {},
      observedAt: nowIso()
    };
    next.updatedAt = nowIso();
    return { store: next, observation: next.replyObservations[id] };
  }

  function outboundForRoot(storeInput, rootTaskId) {
    const store = normalizeStore(storeInput);
    return Object.values(store.outboundRecords).filter(record => record?.rootTaskId === String(rootTaskId) && record?.status === 'sent')
      .sort((a, b) => timeMs(a.sentAt) - timeMs(b.sentAt));
  }

  function observationsAfter(storeInput, rootTaskId, afterTime) {
    const store = normalizeStore(storeInput);
    const threshold = timeMs(afterTime);
    return Object.values(store.replyObservations).filter(obs => obs?.rootTaskId === String(rootTaskId) && timeMs(obs.receivedAt) >= threshold)
      .sort((a, b) => timeMs(a.receivedAt) - timeMs(b.receivedAt));
  }

  function refreshDerivedTaskBlocks(storeInput) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    let blockedTasks = 0, restoredTasks = 0;
    for (const task of Object.values(next.derivedTasks)) {
      if (!task || task.kind !== 'follow_up' || task.state === 'sent' || task.state === 'cancelled') continue;
      const parent = next.outboundRecords[task.parentOutboundId] || outboundForRoot(next, task.rootTaskId).find(item => Number(item.sequence || 0) === Number(task.sequence || 0) - 1) || null;
      const after = parent?.sentAt || '';
      const guard = guardForRecipients(next, (task.recipients || []).map(item => item.email).join(';'));
      const replies = observationsAfter(next, task.rootTaskId, after);
      const blockingObservation = replies.find(item => item.kind === 'human' || item.kind === 'ambiguous') || null;
      const blocker = guard.blocked
        ? { type: 'recipient-guard', modes: guard.modes, reasons: guard.reasons }
        : blockingObservation
          ? { type: 'reply', observationId: blockingObservation.id, kind: blockingObservation.kind, subject: blockingObservation.subject || '' }
          : null;
      if (blocker) {
        if (task.state !== 'blocked') {
          task.blockedFromState = task.state;
          task.state = 'blocked';
          blockedTasks++;
        }
        task.blocker = blocker;
        task.updatedAt = nowIso();
      } else if (task.state === 'blocked' && task.blocker && ['reply', 'recipient-guard'].includes(task.blocker.type)) {
        task.state = task.blockedFromState && task.blockedFromState !== 'blocked' ? task.blockedFromState : (task.body || task.subject ? 'prepared' : 'due');
        task.blockedFromState = '';
        task.blocker = null;
        task.updatedAt = nowIso();
        restoredTasks++;
      }
    }
    next.updatedAt = nowIso();
    return { store: next, blockedTasks, restoredTasks };
  }

  function existingFollowUp(storeInput, rootTaskId, sequence) {
    const store = normalizeStore(storeInput);
    return Object.values(store.derivedTasks).find(task => task?.kind === 'follow_up' && task?.rootTaskId === String(rootTaskId) && Number(task.sequence) === Number(sequence) && task.state !== 'cancelled') || null;
  }

  function evaluateFollowUpEligibility(storeInput, rootTaskId, options = {}) {
    const store = normalizeStore(storeInput);
    rootTaskId = String(rootTaskId || '').trim();
    if (!rootTaskId) return { eligible: false, hardBlocked: true, reason: 'missing-root-task' };
    const policy = policyForRoot(store, rootTaskId);
    if (!policy.enabled) return { eligible: false, hardBlocked: true, reason: 'follow-up-disabled', policy };
    const outbound = outboundForRoot(store, rootTaskId);
    if (!outbound.length) return { eligible: false, hardBlocked: true, reason: 'no-sent-outbound', policy };
    const lastOutbound = outbound[outbound.length - 1];
    const sequence = Math.max(1, Number(lastOutbound.sequence || 0) + 1);
    if (Number(lastOutbound.sequence || 0) >= policy.maxAttempts) return { eligible: false, hardBlocked: true, reason: 'max-attempts-reached', policy, lastOutbound, sequence };
    const guard = guardForRecipients(store, (lastOutbound.recipients || []).map(item => item.email).join(';'));
    if (guard.blocked) return { eligible: false, hardBlocked: true, reason: 'recipient-guard', policy, lastOutbound, sequence, guard };
    const replies = observationsAfter(store, rootTaskId, lastOutbound.sentAt);
    const human = replies.find(item => item.kind === 'human');
    if (human) return { eligible: false, hardBlocked: true, reason: 'human-reply', policy, lastOutbound, sequence, blockingObservation: human };
    const ambiguous = replies.find(item => item.kind === 'ambiguous');
    if (ambiguous) return { eligible: false, hardBlocked: true, reason: 'ambiguous-reply', policy, lastOutbound, sequence, blockingObservation: ambiguous };
    const existing = existingFollowUp(store, rootTaskId, sequence);
    if (existing) return { eligible: false, hardBlocked: true, reason: 'follow-up-already-exists', policy, lastOutbound, sequence, existing };
    const dueAtMs = timeMs(lastOutbound.sentAt) + policy.delayDays * 86400000;
    const dueAt = dueAtMs ? new Date(dueAtMs).toISOString() : '';
    const now = timeMs(options.now || Date.now());
    const due = !!dueAtMs && now >= dueAtMs;
    if (!due && options.ignoreTiming !== true) return { eligible: false, hardBlocked: false, reason: 'waiting', policy, lastOutbound, sequence, dueAt, automaticReplies: replies.filter(item => item.kind === 'automatic') };
    return { eligible: true, hardBlocked: false, reason: due ? 'due' : 'manual-early', policy, lastOutbound, sequence, dueAt, automaticReplies: replies.filter(item => item.kind === 'automatic') };
  }

  function createFollowUpTask(storeInput, rootTaskId, options = {}) {
    const store = normalizeStore(storeInput);
    const eligibility = evaluateFollowUpEligibility(store, rootTaskId, { now: options.now, ignoreTiming: options.manual === true });
    if (!eligibility.eligible) throw new Error(`当前不能创建 Follow-up：${eligibility.reason}`);
    const next = clone(store);
    const { lastOutbound, sequence, policy, dueAt } = eligibility;
    const rendered = renderFollowUpTemplate(next, rootTaskId, policy);
    if (!rendered.ok) throw new Error(`当前不能生成 Follow-up：${rendered.reason}`);
    const id = `followup:${stableHash(`${rootTaskId}|${sequence}`)}`;
    const now = nowIso();
    const task = {
      id,
      kind: 'follow_up',
      rootTaskId: String(rootTaskId),
      parentTaskId: String(lastOutbound.taskId || rootTaskId),
      parentOutboundId: lastOutbound.id,
      sequence,
      state: 'confirmed',
      dueAt,
      createdAt: now,
      updatedAt: now,
      createdReason: eligibility.reason,
      recipients: (lastOutbound.recipients || []).map(item => ({ ...item })),
      subject: policy.composeMode === 'new' ? `Re: ${lastOutbound.subject || ''}`.trim() : String(lastOutbound.subject || ''),
      body: rendered.body,
      composeMode: policy.composeMode,
      contentVersion: 1,
      confirmedVersion: 1,
      confirmedAt: now,
      generatedFromTemplateVersion: policy.templateVersion,
      personalization: { salutation: rendered.personalization.salutation, signature: rendered.personalization.signature, initialOutboundId: rendered.initial.id },
      scheduledAt: '',
      sentOutboundId: '',
      blocker: null,
      dispatch: { queued: true, enabled: true, scheduleAt: '', scheduleSource: 'followup-template', scheduleReason: 'template-generated', queuedAt: now, dequeuedAt: '', dequeuedReason: '' }
    };
    next.derivedTasks[id] = task;
    next.updatedAt = now;
    return { store: next, task, eligibility };
  }

  function createFollowUpTasks(storeInput, rootTaskIds = [], options = {}) {
    const next = clone(normalizeStore(storeInput));
    const created = [];
    const skipped = [];
    const seen = new Set();
    for (const rawId of Array.isArray(rootTaskIds) ? rootTaskIds : []) {
      const rootTaskId = String(rawId || '').trim();
      if (!rootTaskId || seen.has(rootTaskId)) continue;
      seen.add(rootTaskId);
      const eligibility = evaluateFollowUpEligibility(next, rootTaskId, { now: options.now, ignoreTiming: false });
      if (!eligibility.eligible) { skipped.push({ rootTaskId, reason: eligibility.reason }); continue; }
      const { lastOutbound, sequence, policy, dueAt } = eligibility;
      const rendered = renderFollowUpTemplate(next, rootTaskId, policy);
      if (!rendered.ok) { skipped.push({ rootTaskId, reason: rendered.reason }); continue; }
      const id = `followup:${stableHash(`${rootTaskId}|${sequence}`)}`;
      const now = nowIso();
      const task = {
        id, kind: 'follow_up', rootTaskId,
        parentTaskId: String(lastOutbound.taskId || rootTaskId), parentOutboundId: lastOutbound.id,
        sequence, state: 'confirmed', dueAt, createdAt: now, updatedAt: now, createdReason: eligibility.reason,
        recipients: (lastOutbound.recipients || []).map(item => ({ ...item })),
        subject: policy.composeMode === 'new' ? `Re: ${lastOutbound.subject || ''}`.trim() : String(lastOutbound.subject || ''),
        body: rendered.body, composeMode: policy.composeMode,
        contentVersion: 1, confirmedVersion: 1, confirmedAt: now,
        generatedFromTemplateVersion: policy.templateVersion,
        personalization: { salutation: rendered.personalization.salutation, signature: rendered.personalization.signature, initialOutboundId: rendered.initial.id },
        scheduledAt: '', sentOutboundId: '', blocker: null,
        dispatch: { queued: true, enabled: true, scheduleAt: '', scheduleSource: 'followup-template', scheduleReason: 'template-generated', queuedAt: now, dequeuedAt: '', dequeuedReason: '' }
      };
      next.derivedTasks[id] = task;
      next.updatedAt = now;
      created.push(task);
    }
    return { store: next, created, skipped };
  }

  function updateDerivedTaskContent(storeInput, taskId, patch = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const current = next.derivedTasks[taskId];
    if (!current) throw new Error(`找不到 derived task：${taskId}`);
    if (current.state === 'sent' || current.state === 'cancelled') throw new Error('已发送或已取消的 Follow-up 不可修改。');
    const changed = ['subject', 'body', 'composeMode'].some(key => patch[key] !== undefined && patch[key] !== current[key]);
    const composeMode = patch.composeMode === undefined ? current.composeMode : (COMPOSE_MODES.includes(patch.composeMode) ? patch.composeMode : current.composeMode);
    const task = { ...current, ...patch, composeMode, updatedAt: nowIso() };
    if (changed) {
      task.contentVersion = Math.max(1, Number(current.contentVersion || 1) + 1);
      task.confirmedVersion = null;
      task.confirmedAt = '';
      if (task.state === 'confirmed' || task.state === 'scheduled') task.state = 'prepared';
      if (task.dispatch?.queued) {
        task.dispatch = { ...task.dispatch, queued: false, dequeuedAt: nowIso(), dequeuedReason: 'content-changed' };
      }
    }
    if (task.state === 'due' && (task.subject || task.body)) task.state = 'prepared';
    next.derivedTasks[taskId] = task;
    next.updatedAt = task.updatedAt;
    return { store: next, task };
  }

  function confirmDerivedTask(storeInput, taskId) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const task = next.derivedTasks[taskId];
    if (!task) throw new Error(`找不到 derived task：${taskId}`);
    if (!['due', 'prepared', 'confirmed'].includes(task.state)) throw new Error(`当前状态不能确认：${task.state}`);
    task.confirmedVersion = Math.max(1, Number(task.contentVersion || 1));
    task.confirmedAt = nowIso();
    task.state = 'confirmed';
    task.updatedAt = task.confirmedAt;
    next.updatedAt = task.updatedAt;
    return { store: next, task };
  }

  function setDerivedTaskState(storeInput, taskId, state, patch = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const task = next.derivedTasks[taskId];
    if (!task) throw new Error(`找不到 derived task：${taskId}`);
    if (!FOLLOWUP_STATES.includes(state)) throw new Error(`未知 Follow-up state：${state}`);
    if ((state === 'scheduled' || state === 'sent') && Number(task.confirmedVersion) !== Number(task.contentVersion)) throw new Error('内容版本未确认，不能执行。');
    next.derivedTasks[taskId] = { ...task, ...patch, state, updatedAt: nowIso() };
    next.updatedAt = next.derivedTasks[taskId].updatedAt;
    return { store: next, task: next.derivedTasks[taskId] };
  }


  function queueDerivedTaskForDispatch(storeInput, taskId) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const task = next.derivedTasks[taskId];
    if (!task) throw new Error(`找不到 derived task：${taskId}`);
    if (['sent', 'cancelled', 'blocked'].includes(task.state)) throw new Error(`当前状态不能进入选择与排期：${task.state}`);
    if (Number(task.confirmedVersion) !== Number(task.contentVersion)) throw new Error('内容版本未确认，不能进入选择与排期。');
    if (!String(task.body || '').trim()) throw new Error('Follow-up 正文为空，不能进入选择与排期。');
    const now = nowIso();
    task.dispatch = {
      ...(task.dispatch || {}), queued: true, enabled: task.dispatch?.enabled !== false,
      scheduleAt: String(task.dispatch?.scheduleAt || ''), scheduleSource: String(task.dispatch?.scheduleSource || ''), scheduleReason: String(task.dispatch?.scheduleReason || ''),
      queuedAt: task.dispatch?.queuedAt || now, dequeuedAt: '', dequeuedReason: ''
    };
    task.updatedAt = now;
    next.updatedAt = now;
    return { store: next, task };
  }

  function updateDerivedTaskDispatch(storeInput, taskId, patch = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const task = next.derivedTasks[taskId];
    if (!task) throw new Error(`找不到 derived task：${taskId}`);
    const current = task.dispatch || {};
    const dispatch = {
      queued: patch.queued === undefined ? current.queued === true : patch.queued === true,
      enabled: patch.enabled === undefined ? current.enabled !== false : patch.enabled !== false,
      scheduleAt: patch.scheduleAt === undefined ? String(current.scheduleAt || '') : String(patch.scheduleAt || ''),
      scheduleSource: patch.scheduleSource === undefined ? String(current.scheduleSource || '') : String(patch.scheduleSource || ''),
      scheduleReason: patch.scheduleReason === undefined ? String(current.scheduleReason || '') : String(patch.scheduleReason || ''),
      queuedAt: String(current.queuedAt || ''),
      dequeuedAt: String(current.dequeuedAt || ''),
      dequeuedReason: String(current.dequeuedReason || '')
    };
    const now = nowIso();
    if (dispatch.queued && !current.queued) { dispatch.queuedAt = now; dispatch.dequeuedAt = ''; dispatch.dequeuedReason = ''; }
    if (!dispatch.queued && current.queued) { dispatch.dequeuedAt = now; dispatch.dequeuedReason = String(patch.dequeuedReason || 'manual'); }
    task.dispatch = dispatch;
    task.updatedAt = now;
    next.updatedAt = now;
    return { store: next, task };
  }

  function queuedDerivedTasks(storeInput) {
    const store = normalizeStore(storeInput);
    return Object.values(store.derivedTasks)
      .filter(task => task?.kind === 'follow_up' && task?.dispatch?.queued === true && task.state !== 'sent' && task.state !== 'cancelled')
      .sort((a, b) => timeMs(a.dispatch?.queuedAt || a.createdAt) - timeMs(b.dispatch?.queuedAt || b.createdAt));
  }

  function mailboxHistoryForRecipients(storeInput, recipientsRaw) {
    const store = normalizeStore(storeInput);
    const emails = new Set(parseRecipients(recipientsRaw).map(item => item.email));
    const sent = Object.values(store.outboundRecords).filter(record => (record.recipients || []).some(item => emails.has(item.email)))
      .sort((a, b) => timeMs(b.sentAt) - timeMs(a.sentAt));
    const drafts = Object.values(store.draftRecords).filter(record => (record.recipients || []).some(item => emails.has(item.email)))
      .sort((a, b) => timeMs(b.savedAt) - timeMs(a.savedAt));
    return { sent, drafts, sentCount: sent.length, draftCount: drafts.length, lastSentAt: sent[0]?.sentAt || '', lastDraftAt: drafts[0]?.savedAt || '', lastSubject: sent[0]?.subject || '', lastDraftSubject: drafts[0]?.subject || '' };
  }

  function monitoringRoots(storeInput) {
    const store = normalizeStore(storeInput);
    const groups = new Map();
    for (const outbound of Object.values(store.outboundRecords)) {
      if (!outbound?.rootTaskId || outbound.status !== 'sent') continue;
      if (!groups.has(outbound.rootTaskId)) groups.set(outbound.rootTaskId, []);
      groups.get(outbound.rootTaskId).push(outbound);
    }
    return [...groups.entries()].map(([rootTaskId, outbounds]) => {
      outbounds.sort((a, b) => timeMs(a.sentAt) - timeMs(b.sentAt));
      const lastOutbound = outbounds[outbounds.length - 1];
      const replies = observationsAfter(store, rootTaskId, lastOutbound.sentAt);
      const tasks = Object.values(store.derivedTasks).filter(task => task?.rootTaskId === rootTaskId).sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
      const eligibility = evaluateFollowUpEligibility(store, rootTaskId);
      const policy = policyForRoot(store, rootTaskId);
      return { rootTaskId, outbounds, lastOutbound, replies, tasks, eligibility, policy };
    }).sort((a, b) => timeMs(b.lastOutbound.sentAt) - timeMs(a.lastOutbound.sentAt));
  }

  async function load(account) {
    const key = storageKey(account);
    const result = await chrome.storage.local.get(key);
    let store = normalizeStore(result[key], account);
    let migration = null;
    const monitored = ensureMonitoringRoots(store);
    if (monitored.adopted) {
      store = reconcileInboundReplies(monitored.store).store;
      migration = { autoMonitoringRoots: monitored.adopted };
      await chrome.storage.local.set({ [key]: store });
    }
    return { store, migration };
  }

  async function save(account, storeInput) {
    const store = normalizeStore(storeInput, account);
    store.updatedAt = nowIso();
    await chrome.storage.local.set({ [storageKey(account)]: store });
    return store;
  }

  globalThis.NMDAOperations = {
    SCHEMA_VERSION,
    FOLLOWUP_STATES,
    REPLY_KINDS,
    GUARD_MODES,
    COMPOSE_MODES,
    DEFAULT_FOLLOWUP_POLICY: { ...DEFAULT_FOLLOWUP_POLICY },
    normalizeEmail,
    normalizeTag,
    parseTags,
    mergeTags,
    parseRecipients,
    timeMs,
    isoTime,
    formatDisplayTime,
    stableHash,
    subjectThreadKey,
    classifyInboundMessage,
    createStore,
    normalizeStore,
    load,
    save,
    ingestMailboxSnapshot,
    ingestMailboxDedupeSnapshot,
    reconcileOutboundsToDrafts,
    reconcileInboundReplies,
    ensureMonitoringRoots,
    recordPreparedDraft,
    linkOutbound,
    setRecipientGuard,
    guardForRecipients,
    policyForRoot,
    setFollowUpPolicy,
    initialOutboundForRoot,
    setOutboundContentSnapshot,
    setOutboundContentReadFailure,
    extractInitialPersonalization,
    renderFollowUpTemplate,
    recordReplyObservation,
    setReplyObservationDisposition,
    outboundForRoot,
    observationsAfter,
    existingFollowUp,
    refreshDerivedTaskBlocks,
    evaluateFollowUpEligibility,
    createFollowUpTask,
    createFollowUpTasks,
    updateDerivedTaskContent,
    confirmDerivedTask,
    setDerivedTaskState,
    queueDerivedTaskForDispatch,
    updateDerivedTaskDispatch,
    queuedDerivedTasks,
    mailboxHistoryForRecipients,
    monitoringRoots
  };
})();
