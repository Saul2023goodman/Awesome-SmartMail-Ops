(() => {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_PREFIX = 'nmda.operations.v1:';
  const LEGACY_CONTACT_PREFIX = 'nmda.contacts.v1:';
  const FOLLOWUP_STATES = ['due', 'prepared', 'confirmed', 'scheduled', 'sent', 'blocked', 'cancelled'];
  const REPLY_KINDS = ['human', 'automatic', 'ambiguous', 'bounce', 'system'];
  const GUARD_MODES = ['normal', 'paused', 'do-not-contact'];
  const COMPOSE_MODES = ['forward', 'reply', 'new'];
  const DEFAULT_FOLLOWUP_POLICY = Object.freeze({ enabled: true, delayDays: 7, maxAttempts: 2, composeMode: 'forward' });

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

  function storageKey(account) {
    return `${STORAGE_PREFIX}${normalizeEmail(account) || 'default'}`;
  }

  function legacyStorageKey(account) {
    return `${LEGACY_CONTACT_PREFIX}${normalizeEmail(account) || 'default'}`;
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
    return { enabled: value.enabled !== false, delayDays, maxAttempts, composeMode };
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

  function ingestMailboxSnapshot(storeInput, sentMessages = [], draftMessages = [], options = {}) {
    const store = normalizeStore(storeInput);
    const full = options.mode === 'full' || options.full === true;
    if (full && options.complete !== true) throw new Error('完整覆盖要求 complete=true，避免用不完整邮箱快照删除事实。');
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

    if (full) {
      const linkedOutbound = Object.fromEntries(Object.entries(next.outboundRecords).filter(([, record]) => record?.source !== 'mailbox' || record?.taskId || record?.rootTaskId));
      const linkedDrafts = Object.fromEntries(Object.entries(next.draftRecords).filter(([, record]) => record?.source !== 'mailbox' || record?.taskId || record?.rootTaskId));
      next.outboundRecords = { ...linkedOutbound, ...incomingOutbound };
      next.draftRecords = { ...linkedDrafts, ...incomingDrafts };
    } else {
      next.outboundRecords = { ...next.outboundRecords, ...incomingOutbound };
      next.draftRecords = { ...next.draftRecords, ...incomingDrafts };
    }

    next.mailboxSync = {
      ...next.mailboxSync,
      lastMode: full ? 'full' : 'quick',
      complete: full,
      lastQuickAt: !full ? observedAt : next.mailboxSync.lastQuickAt || '',
      lastFullAt: full ? observedAt : next.mailboxSync.lastFullAt || '',
      sent: options.sentCoverage || { read: Object.keys(incomingOutbound).length },
      drafts: options.draftCoverage || { read: Object.keys(incomingDrafts).length }
    };
    next.updatedAt = observedAt;
    return {
      store: next,
      outboundRead: Object.keys(incomingOutbound).length,
      draftsRead: Object.keys(incomingDrafts).length,
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
    if (!rootTaskId) next.followUpPolicies.default = normalizePolicy({ ...next.followUpPolicies.default, ...patch });
    else next.followUpPolicies.overrides[String(rootTaskId)] = normalizePolicy({ ...policyForRoot(next, rootTaskId), ...patch });
    next.updatedAt = nowIso();
    return { store: next, policy: policyForRoot(next, rootTaskId) };
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
    const id = `followup:${stableHash(`${rootTaskId}|${sequence}`)}`;
    const now = nowIso();
    const task = {
      id,
      kind: 'follow_up',
      rootTaskId: String(rootTaskId),
      parentTaskId: String(lastOutbound.taskId || rootTaskId),
      parentOutboundId: lastOutbound.id,
      sequence,
      state: 'due',
      dueAt,
      createdAt: now,
      updatedAt: now,
      createdReason: eligibility.reason,
      recipients: (lastOutbound.recipients || []).map(item => ({ ...item })),
      subject: '',
      body: '',
      composeMode: policy.composeMode,
      contentVersion: 1,
      confirmedVersion: null,
      confirmedAt: '',
      scheduledAt: '',
      sentOutboundId: '',
      blocker: null
    };
    next.derivedTasks[id] = task;
    next.updatedAt = now;
    return { store: next, task, eligibility };
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

  function mailboxHistoryForRecipients(storeInput, recipientsRaw) {
    const store = normalizeStore(storeInput);
    const emails = new Set(parseRecipients(recipientsRaw).map(item => item.email));
    const sent = Object.values(store.outboundRecords).filter(record => (record.recipients || []).some(item => emails.has(item.email)))
      .sort((a, b) => timeMs(b.sentAt) - timeMs(a.sentAt));
    const drafts = Object.values(store.draftRecords).filter(record => (record.recipients || []).some(item => emails.has(item.email)))
      .sort((a, b) => timeMs(b.savedAt) - timeMs(a.savedAt));
    return { sent, drafts, sentCount: sent.length, draftCount: drafts.length, lastSentAt: sent[0]?.sentAt || '', lastDraftAt: drafts[0]?.savedAt || '', lastSubject: sent[0]?.subject || '', lastDraftSubject: drafts[0]?.subject || '' };
  }

  function migrateLegacyContacts(storeInput, legacyContacts = {}) {
    const store = normalizeStore(storeInput);
    if (store.migration?.contactsV1At) return { store, migrated: false, outbound: 0, drafts: 0, guards: 0 };
    const next = clone(store);
    let outbound = 0, drafts = 0, guards = 0;
    for (const [rawEmail, contact] of Object.entries(legacyContacts || {})) {
      const email = normalizeEmail(contact?.email || rawEmail);
      if (!email) continue;
      const policy = contact?.policy;
      if (policy === '暂停' || policy === '不再联系') {
        next.recipientGuards[email] = { email, mode: policy === '不再联系' ? 'do-not-contact' : 'paused', reason: '从 v3.5 联系策略迁移', source: 'legacy-contact-migration', changedAt: nowIso() };
        guards++;
      }
      for (const item of contact?.history || []) {
        const providerId = String(item.id || '').trim();
        const id = providerId
          ? `outbound:legacy-provider:${stableHash(providerId)}`
          : `outbound:legacy:${stableHash(`${item.sentAt || ''}|${item.subject || ''}|${email}`)}`;
        const previous = next.outboundRecords[id];
        if (previous) {
          const seen = new Set((previous.recipients || []).map(recipient => recipient.email));
          if (!seen.has(email)) previous.recipients.push({ email, name: String(contact?.name || '') });
          continue;
        }
        next.outboundRecords[id] = {
          id, providerMessageId: providerId, source: 'legacy-contact-migration', status: 'sent', kind: 'unlinked', taskId: '', rootTaskId: '', parentTaskId: '', parentOutboundId: '', sequence: 0,
          recipients: [{ email, name: String(contact?.name || '') }], subject: String(item.subject || ''), sentAt: isoTime(item.sentAt), observedAt: nowIso(), mailboxFolder: 'sent'
        };
        outbound++;
      }
      for (const item of contact?.draftHistory || []) {
        const providerId = String(item.id || '').trim();
        const id = providerId
          ? `draft:legacy-provider:${stableHash(providerId)}`
          : `draft:legacy:${stableHash(`${item.savedAt || ''}|${item.subject || ''}|${email}`)}`;
        const previous = next.draftRecords[id];
        if (previous) {
          const seen = new Set((previous.recipients || []).map(recipient => recipient.email));
          if (!seen.has(email)) previous.recipients.push({ email, name: String(contact?.name || '') });
          continue;
        }
        next.draftRecords[id] = {
          id, providerMessageId: providerId, source: 'legacy-contact-migration', status: 'present', kind: 'unlinked', taskId: '', rootTaskId: '', parentTaskId: '', parentOutboundId: '', sequence: 0,
          recipients: [{ email, name: String(contact?.name || '') }], subject: String(item.subject || ''), savedAt: isoTime(item.savedAt), scheduleAt: '', observedAt: nowIso(), mailboxFolder: 'draft'
        };
        drafts++;
      }
    }
    next.migration = { ...next.migration, contactsV1At: nowIso(), contactsV1RetainedForRollback: true };
    next.updatedAt = nowIso();
    return { store: next, migrated: true, outbound, drafts, guards };
  }

  async function load(account) {
    const key = storageKey(account);
    const result = await chrome.storage.local.get([key, legacyStorageKey(account)]);
    let store = normalizeStore(result[key], account);
    let migration = null;
    if (!result[key] && result[legacyStorageKey(account)] && typeof result[legacyStorageKey(account)] === 'object') {
      migration = migrateLegacyContacts(store, result[legacyStorageKey(account)]);
      store = migration.store;
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
    createStore,
    normalizeStore,
    load,
    save,
    ingestMailboxSnapshot,
    recordPreparedDraft,
    linkOutbound,
    setRecipientGuard,
    guardForRecipients,
    policyForRoot,
    setFollowUpPolicy,
    recordReplyObservation,
    outboundForRoot,
    observationsAfter,
    existingFollowUp,
    evaluateFollowUpEligibility,
    createFollowUpTask,
    updateDerivedTaskContent,
    confirmDerivedTask,
    setDerivedTaskState,
    mailboxHistoryForRecipients,
    migrateLegacyContacts
  };
})();
