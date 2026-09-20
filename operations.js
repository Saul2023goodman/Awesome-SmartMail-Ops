(() => {
  'use strict';

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

  function conversationKeyForOutbound(record = {}) {
    const recipients = recipientKey(record.recipients || []);
    const subject = subjectThreadKey(record.subject || '');
    return recipients && subject ? `${recipients}|${subject}` : '';
  }

  // Follow-up lineage is contact-based, not subject-based. Subject text can drift
  // between forwards, manual sends, tests, or provider-generated variants; treating
  // each subject as a new conversation would incorrectly create multiple independent
  // Follow-up chains for the same recipient. The recipient set is the stable identity
  // for automated follow-up eligibility.
  function followUpConversationKeyForOutbound(record = {}) {
    const recipients = recipientKey(record.recipients || []);
    return recipients ? `recipient:${recipients}` : '';
  }

  function decorateConversationOutbounds(records = []) {
    const sorted = [...(records || [])].filter(record => record?.status === 'sent').sort((a, b) => timeMs(a.sentAt) - timeMs(b.sentAt));
    return sorted.map((record, index) => {
      const declaredSequence = Math.max(0, Number(record.sequence || 0) || 0);
      const observedSequence = Math.max(index, Math.max(0, Number(record.observedSequence || 0) || 0), declaredSequence);
      const effectiveKind = observedSequence > 0 ? 'follow_up' : 'initial';
      const sequenceSource = declaredSequence > 0 || record.kind === 'follow_up'
        ? 'linked-task'
        : observedSequence > 0 ? 'mailbox-history' : 'initial';
      return {
        ...record,
        declaredSequence,
        declaredKind: record.kind || 'unlinked',
        observedSequence,
        effectiveSequence: observedSequence,
        effectiveKind,
        sequence: observedSequence,
        kind: effectiveKind,
        sequenceSource
      };
    });
  }

  function conversationContextFromStore(store, rootTaskId) {
    const allOutbounds = Object.values(store?.outboundRecords || {}).filter(record => record?.rootTaskId && record?.status === 'sent');
    const ownOutbounds = allOutbounds.filter(record => record?.rootTaskId === String(rootTaskId));
    const keys = new Set(ownOutbounds.map(followUpConversationKeyForOutbound).filter(Boolean));
    const rootIds = new Set([String(rootTaskId)]);
    if (keys.size) {
      for (const outbound of allOutbounds) {
        const key = followUpConversationKeyForOutbound(outbound);
        if (key && keys.has(key)) rootIds.add(String(outbound.rootTaskId));
      }
    }
    const conversationOutbounds = decorateConversationOutbounds(allOutbounds.filter(outbound => rootIds.has(String(outbound.rootTaskId)) && (!keys.size || keys.has(followUpConversationKeyForOutbound(outbound)))));
    const observations = Object.values(store?.replyObservations || {})
      .filter(obs => obs?.rootTaskId && rootIds.has(String(obs.rootTaskId)))
      .sort((a, b) => timeMs(a.receivedAt) - timeMs(b.receivedAt));
    const human = [...observations].reverse().find(obs => obs.kind === 'human') || null;
    const ambiguous = [...observations].reverse().find(obs => obs.kind === 'ambiguous') || null;
    const completedFollowUps = conversationOutbounds.reduce((max, record) => Math.max(max, Number(record.effectiveSequence || 0)), 0);
    const scheduledDrafts = scheduledMailboxDraftsForConversation(store, { keys:[...keys], outbounds:conversationOutbounds });
    return {
      keys: [...keys],
      rootIds: [...rootIds],
      observations,
      human,
      ambiguous,
      outbounds: conversationOutbounds,
      lastOutbound: conversationOutbounds[conversationOutbounds.length - 1] || null,
      completedFollowUps,
      scheduledDrafts
    };
  }

  function conversationContextForRoot(storeInput, rootTaskId) {
    return conversationContextFromStore(normalizeStore(storeInput), rootTaskId);
  }

  function truthyFlag(flags, patterns = []) {
    const source = flags && typeof flags === 'object' ? flags : {};
    return Object.entries(source).some(([key, value]) => {
      if (!value || value === '0' || value === 0 || value === false) return false;
      const normalized = String(key || '').toLowerCase();
      return patterns.some(pattern => normalized.includes(pattern));
    });
  }

  const AUTO_REPLY_FAST_WINDOW_MS = 3 * 60 * 1000;

  function classifyInboundMessage(message = {}, context = {}) {
    const subject = String(message.subject || '');
    const sender = normalizeEmail(message.sender?.email || message.sender || message.from || '');
    const senderName = String(message.sender?.name || message.senderName || '').trim();
    const preview = String(message.preview || message.summary || message.snippet || message.abstract || message.body || message.text || '').replace(/\s+/g, ' ').trim();
    const flags = message.flags || {};
    const bounceSubject = /(mail delivery|delivery status|delivery failure|undeliver|returned mail|failure notice|退信|投递失败|无法投递|邮件投递)/i.test(subject);
    if (bounceSubject || /(?:mailer-daemon|postmaster)@/i.test(sender)) {
      return { kind: 'bounce', evidence: { rule: bounceSubject ? 'subject-bounce-pattern' : 'sender-bounce-pattern', confidence: 'high' } };
    }

    const automaticFlag = truthyFlag(flags, [
      'autoreply', 'auto_reply', 'autoresponse', 'auto_response', 'auto-submitted', 'autosubmitted',
      'vacation', 'outofoffice', 'out_of_office', 'ooo', 'automated', 'autogenerated'
    ]);
    const automaticSubject = /(automatic(?:ally)?[ -]?(?:reply|response)|auto(?:matic)?[ -]?(?:reply|response)|auto[- ]?response|automated response|out of office|away from (?:the )?office|vacation (?:reply|response)|absence notification|annual leave|currently on leave|自动回复|自动答复|自动应答|不在办公室|休假自动|外出自动|离岗自动)/i.test(subject);
    const automaticSender = /(?:^|[^a-z])(auto(?:reply|response|responder)?|automatic|autoresponder|vacation responder|out of office)(?:[^a-z]|$)/i.test(`${senderName} ${sender.split('@')[0] || ''}`);
    const automaticBodyStrong = /(this is (?:an )?(?:automatic|automated) (?:reply|response)|i am (?:currently )?(?:out of|away from) (?:the )?office|i am (?:currently )?on (?:annual )?leave|i will (?:be back|return) on|limited access to (?:my )?email|no access to (?:my )?email|vacation responder|此邮件为自动回复|这是一封自动回复|当前不在办公室|目前不在办公室|正在休假|休假期间|外出期间|无法及时回复邮件)/i.test(preview);
    if (automaticFlag || automaticSubject || automaticSender || automaticBodyStrong) {
      const rule = automaticFlag ? 'mailbox-auto-flag' : automaticSubject ? 'subject-auto-pattern' : automaticSender ? 'sender-auto-pattern' : 'body-auto-pattern';
      return { kind: 'automatic', evidence: { rule, confidence: 'high', autoReplyFeature: true } };
    }

    if (/(?:no[-_.]?reply|noreply|do[-_.]?not[-_.]?reply)@/i.test(sender)) {
      return { kind: 'system', evidence: { rule: 'sender-no-reply-pattern', confidence: 'high' } };
    }

    const weakAutomaticBody = /(thank you for (?:your )?(?:email|message)|thanks for (?:your )?(?:email|message)|we (?:have )?received your (?:email|message)|your (?:email|message) has been received|感谢您的来信|感谢您的邮件|您的邮件已收到|我们已收到您的邮件)/i.test(preview);
    const relatedOutbound = context.relatedOutbound || null;
    const sentMs = timeMs(relatedOutbound?.sentAt || context.sentAt);
    const receivedMs = timeMs(message.receivedAt || context.receivedAt);
    const replyDelayMs = sentMs && receivedMs ? receivedMs - sentMs : NaN;
    const nearImmediate = Number.isFinite(replyDelayMs) && replyDelayMs >= 0 && replyDelayMs <= AUTO_REPLY_FAST_WINDOW_MS;
    const directAssociation = context.referenceMatch === true || context.subjectMatch === true || Number(context.associationScore || 0) >= 10;

    // Operational heuristic: a reply that comes back within three minutes on a
    // directly-associated thread is overwhelmingly likely to be an autoresponder
    // in this bulk-outreach workflow. Treat it as automatic (therefore non-blocking),
    // but mark it heuristic so the monitoring UI can expose a one-click correction.
    if (nearImmediate && directAssociation) {
      return {
        kind: 'automatic',
        evidence: {
          rule: weakAutomaticBody ? 'near-immediate+generic-auto-text' : 'near-immediate-reply<=3m',
          confidence: weakAutomaticBody ? 'medium' : 'heuristic',
          heuristic: true,
          autoReplyFeature: true,
          replyDelayMs,
          replyDelaySeconds: Math.round(replyDelayMs / 1000),
          thresholdMs: AUTO_REPLY_FAST_WINDOW_MS
        }
      };
    }

    return { kind: 'human', evidence: { rule: 'ordinary-inbound', confidence: 'default' } };
  }

  function isEffectiveReplyObservation(observation) {
    return !!observation && observation.kind === 'human';
  }

  function hasAutoReplyFeature(observation) {
    return !!observation && (observation.evidence?.autoReplyFeature === true || observation.kind === 'automatic');
  }

  function nowIso() { return new Date().toISOString(); }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function createStore(account = 'default') {
    const now = nowIso();
    return {
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
      mailboxSync: {}
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
      mailboxSync: raw.mailboxSync && typeof raw.mailboxSync === 'object' ? raw.mailboxSync : {}
    };
    for (const [key, guard] of Object.entries(store.recipientGuards)) {
      const mode = GUARD_MODES.includes(guard?.mode) ? guard.mode : 'normal';
      store.recipientGuards[normalizeEmail(key)] = { ...guard, email: normalizeEmail(guard?.email || key), mode };
      if (normalizeEmail(key) !== key) delete store.recipientGuards[key];
    }
    for (const [key, task] of Object.entries(store.derivedTasks)) {
      if (!task || typeof task !== 'object') continue;
      const dispatch = task.dispatch && typeof task.dispatch === 'object' ? task.dispatch : {};
      const normalizedTask = {
        ...task,
        reviewedAt: String(task.reviewedAt || ''),
        reviewDecision: ['auto', 'manual'].includes(task.reviewDecision) ? task.reviewDecision : (task.reviewedAt ? 'manual' : ''),
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
      store.derivedTasks[key] = normalizedTask;
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
      scheduledDraft: message?.scheduledDraft === true || !!isoTime(message?.scheduleAt || message?.sendAt || ''),
      scheduleEvidence: String(message?.scheduleEvidence || ''),
      mailboxPresentAt: '',
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
      preview: String(message?.preview || message?.summary || message?.snippet || message?.abstract || '').slice(0, 4000),
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


  function scheduledMailboxDraftsForConversation(storeInput, conversation, options = {}) {
    const store = normalizeStore(storeInput);
    const keys = new Set((conversation?.keys || []).filter(Boolean));
    if (!keys.size && Array.isArray(conversation?.outbounds)) {
      for (const outbound of conversation.outbounds) {
        const key = followUpConversationKeyForOutbound(outbound);
        if (key) keys.add(key);
      }
    }
    const now = timeMs(options.now || Date.now());
    return Object.values(store.draftRecords || {}).filter(draft => {
      if (!draft || draft.status === 'sent') return false;
      if (draft.mailboxFolder !== 'draft') return false;
      if (!draft.mailboxPresentAt && draft.source === 'mailbox') return false;
      if (!(draft.scheduledDraft === true || !!draft.scheduleAt)) return false;
      const scheduleMs = timeMs(draft.scheduleAt);
      if (!scheduleMs || scheduleMs <= now - 60000) return false;
      const key = recipientKey(draft.recipients || []);
      return !!key && keys.has(`recipient:${key}`);
    }).sort((a, b) => timeMs(a.scheduleAt) - timeMs(b.scheduleAt) || timeMs(a.savedAt) - timeMs(b.savedAt));
  }

  function reconcileScheduledFollowUpDrafts(storeInput, options = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const now = timeMs(options.now || Date.now());
    const buckets = new Map();
    for (const outbound of Object.values(next.outboundRecords || {})) {
      if (!outbound?.rootTaskId || outbound.status !== 'sent') continue;
      const key = followUpConversationKeyForOutbound(outbound);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(outbound);
    }

    // First release tasks that were only suppressed because a mailbox scheduled
    // draft existed but is no longer present in the latest complete draft scan.
    const liveScheduledDraftIds = new Set(Object.values(next.draftRecords || {}).filter(draft => {
      if (!draft || draft.mailboxFolder !== 'draft') return false;
      if (!draft.mailboxPresentAt && draft.source === 'mailbox') return false;
      if (!(draft.scheduledDraft === true || !!draft.scheduleAt)) return false;
      return timeMs(draft.scheduleAt) > now - 60000;
    }).map(draft => draft.id));
    let restoredTasks = 0;
    for (const task of Object.values(next.derivedTasks || {})) {
      if (!task?.scheduledExternally || task.state === 'sent' || task.state === 'cancelled') continue;
      if (task.mailboxScheduledDraftId && liveScheduledDraftIds.has(task.mailboxScheduledDraftId)) continue;
      const previousState = String(task.scheduledExternalPreviousState || '');
      const previousDispatch = task.scheduledExternalPreviousDispatch && typeof task.scheduledExternalPreviousDispatch === 'object'
        ? clone(task.scheduledExternalPreviousDispatch) : null;
      task.state = previousState && previousState !== 'scheduled' ? previousState : (task.reviewedAt ? 'confirmed' : (task.body || task.subject ? 'prepared' : 'due'));
      task.dispatch = previousDispatch || { ...(task.dispatch || {}), queued:false, scheduleAt:'', scheduleSource:'', scheduleReason:'', dequeuedAt:'', dequeuedReason:'' };
      task.draftPreparedAt = String(task.scheduledExternalPreviousDraftPreparedAt || '');
      task.scheduledAt = String(task.scheduledExternalPreviousScheduledAt || '');
      task.scheduledExternally = false;
      task.mailboxScheduledDraftId = '';
      task.mailboxScheduledProviderId = '';
      task.scheduledExternalPreviousState = '';
      task.scheduledExternalPreviousDispatch = null;
      task.scheduledExternalPreviousDraftPreparedAt = '';
      task.scheduledExternalPreviousScheduledAt = '';
      task.updatedAt = nowIso();
      restoredTasks++;
    }

    let recognizedDrafts = 0;
    let reconciledTasks = 0;
    for (const [conversationKey, records] of buckets.entries()) {
      const decorated = decorateConversationOutbounds(records);
      if (!decorated.length) continue;
      const rootIds = [...new Set(decorated.map(record => String(record.rootTaskId || '')).filter(Boolean))];
      const canonicalRootId = String(decorated[0]?.rootTaskId || rootIds[0] || '');
      const keys = [conversationKey];
      const drafts = scheduledMailboxDraftsForConversation(next, { keys, outbounds: decorated }, { now });
      if (!drafts.length) continue;
      const completedFollowUps = decorated.reduce((max, record) => Math.max(max, Number(record.effectiveSequence || 0)), 0);
      const lastOutbound = decorated[decorated.length - 1] || null;
      drafts.forEach((draft, index) => {
        const sequence = completedFollowUps + index + 1;
        const live = next.draftRecords[draft.id];
        if (!live) return;
        live.rootTaskId = canonicalRootId;
        live.parentTaskId = String(lastOutbound?.taskId || canonicalRootId || '');
        live.parentOutboundId = String(lastOutbound?.id || '');
        live.sequence = sequence;
        live.kind = 'follow_up';
        live.observedSequence = sequence;
        live.observedKind = 'follow_up';
        live.observedConversationKey = conversationKey;
        live.observedSequenceSource = 'scheduled-mailbox-draft';
        live.scheduledFollowUpRecognizedAt = nowIso();
        recognizedDrafts++;

        const rootSet = new Set(rootIds);
        const task = Object.values(next.derivedTasks || {}).find(item => item?.kind === 'follow_up'
          && rootSet.has(String(item.rootTaskId || ''))
          && Number(item.sequence || 0) === Number(sequence)
          && !['sent','cancelled'].includes(item.state));
        if (!task) return;
        if (!task.scheduledExternally) {
          task.scheduledExternalPreviousState = task.state;
          task.scheduledExternalPreviousDispatch = clone(task.dispatch || {});
          task.scheduledExternalPreviousDraftPreparedAt = String(task.draftPreparedAt || '');
          task.scheduledExternalPreviousScheduledAt = String(task.scheduledAt || '');
        }
        task.state = 'scheduled';
        task.scheduledExternally = true;
        task.mailboxScheduledDraftId = live.id;
        task.mailboxScheduledProviderId = live.providerMessageId || '';
        task.draftPreparedAt = task.draftPreparedAt || live.mailboxPresentAt || live.observedAt || nowIso();
        task.scheduledAt = live.scheduleAt || task.scheduledAt || '';
        task.dispatch = {
          ...(task.dispatch || {}),
          queued: false,
          scheduleAt: live.scheduleAt || '',
          scheduleSource: 'mailbox-scheduled-draft',
          scheduleReason: '网易草稿箱已存在定时 Follow-up',
          dequeuedAt: nowIso(),
          dequeuedReason: 'mailbox-scheduled-followup-exists'
        };
        task.updatedAt = nowIso();
        reconciledTasks++;
      });
    }
    if (recognizedDrafts || reconciledTasks || restoredTasks) next.updatedAt = nowIso();
    return { store: next, recognizedDrafts, reconciledTasks, restoredTasks };
  }

  function reconcileObservedFollowUpHistory(storeInput) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const buckets = new Map();
    for (const outbound of Object.values(next.outboundRecords || {})) {
      if (!outbound?.rootTaskId || outbound.status !== 'sent') continue;
      const key = followUpConversationKeyForOutbound(outbound);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(outbound);
    }

    let recognizedFollowUps = 0;
    let reconciledTasks = 0;
    let conversations = 0;
    for (const [conversationKey, records] of buckets.entries()) {
      const decorated = decorateConversationOutbounds(records);
      if (!decorated.length) continue;
      conversations++;
      const rootIds = new Set(decorated.map(record => String(record.rootTaskId || '')).filter(Boolean));
      const humanManaged = Object.values(next.replyObservations || {}).some(obs => obs?.kind === 'human' && rootIds.has(String(obs.rootTaskId || '')));
      const byId = new Map(decorated.map(record => [record.id, record]));

      for (const decoratedRecord of decorated) {
        const record = next.outboundRecords[decoratedRecord.id];
        if (!record) continue;
        const previousObserved = Math.max(0, Number(record.observedSequence || 0) || 0);
        record.observedConversationKey = conversationKey;
        record.observedSequence = Number(decoratedRecord.effectiveSequence || 0);
        record.observedKind = decoratedRecord.effectiveKind;
        record.observedSequenceSource = decoratedRecord.sequenceSource;
        if (decoratedRecord.effectiveSequence > 0 && previousObserved !== decoratedRecord.effectiveSequence && decoratedRecord.sequenceSource === 'mailbox-history') recognizedFollowUps++;
      }

      // Mailbox sent history is authoritative. If an already-created Follow-up task
      // is covered by an observed second/third outbound in the same conversation,
      // reconcile the task to Sent instead of allowing a duplicate Follow-up to be
      // generated. A valid reply still ends automation, so do not auto-reconcile
      // post-reply operator correspondence into the bulk Follow-up workflow.
      if (!humanManaged) {
        const outboundIds = new Set(decorated.map(record => record.id));
        const tasks = Object.values(next.derivedTasks || {}).filter(task => task?.kind === 'follow_up' && (rootIds.has(String(task.rootTaskId || '')) || outboundIds.has(String(task.parentOutboundId || ''))));
        for (const task of tasks) {
          if (!task || ['sent', 'cancelled'].includes(task.state)) continue;
          const sequence = Math.max(1, Number(task.sequence || 0) || 0);
          const target = decorated.find(record => Number(record.effectiveSequence || 0) === sequence);
          if (!target) continue;
          task.state = 'sent';
          task.sentOutboundId = target.id;
          task.sentAt = target.sentAt || task.sentAt || '';
          task.sentReconciledAt = nowIso();
          task.sentReconciledReason = 'observed-mailbox-followup';
          task.updatedAt = task.sentReconciledAt;
          task.dispatch = {
            ...(task.dispatch || {}),
            queued: false,
            scheduleAt: '',
            scheduleSource: '',
            scheduleReason: 'observed-mailbox-followup',
            dequeuedAt: task.sentReconciledAt,
            dequeuedReason: 'already-sent-in-mailbox'
          };
          const targetRecord = next.outboundRecords[target.id];
          if (targetRecord) targetRecord.observedTaskId = task.id;
          reconciledTasks++;
        }
      }
    }
    if (recognizedFollowUps || reconciledTasks) next.updatedAt = nowIso();
    return { store: next, recognizedFollowUps, reconciledTasks, conversations };
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
      const referenceMatch = !!outbound.providerMessageId && refs.includes(outbound.providerMessageId);
      if (referenceMatch) score += 20;
      const ageDays = Math.max(0, (receivedMs - timeMs(outbound.sentAt)) / 86400000);
      if (ageDays <= 2) score += 4;
      else if (ageDays <= 14) score += 3;
      else if (ageDays <= 45) score += 2;
      else if (ageDays <= 120) score += 1;
      return { outbound, score, subjectMatch: !!subjectKey && subjectKey === outboundSubject, referenceMatch, ageDays };
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
      const classified = classifyInboundMessage(inbound, {
        relatedOutbound: best.outbound,
        associationScore: best.score,
        subjectMatch: best.subjectMatch,
        referenceMatch: best.referenceMatch
      });
      const strong = best.subjectMatch || best.score >= 12 || best.referenceMatch || (classified.kind === 'automatic' && candidates.length === 1);
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
    observation.evidence = { ...(observation.evidence || {}), manual: true, manualDisposition: disposition, autoReplyFeature: disposition === 'automatic' ? true : (disposition === 'human' ? false : observation.evidence?.autoReplyFeature), changedAt: nowIso() };
    observation.observedAt = nowIso();
    const refreshed = refreshDerivedTaskBlocks(next);
    const observed = reconcileObservedFollowUpHistory(refreshed.store);
    observed.store.updatedAt = nowIso();
    return { store: observed.store, observation: observed.store.replyObservations[observationId] };
  }

  function retainExistingMailboxRecord(record, historyCutoffAt = '', timeField = '') {
    if (!record || record.source !== 'mailbox') return true;
    const cutoffMs = timeMs(historyCutoffAt);
    if (!cutoffMs) return !!(record.taskId || record.rootTaskId);
    const recordMs = timeMs(record?.[timeField]);
    return !!recordMs && recordMs >= cutoffMs;
  }

  function pruneMailboxReplyObservationsForWindow(observations = {}, historyCutoffAt = '') {
    const cutoffMs = timeMs(historyCutoffAt);
    if (!cutoffMs) return observations;
    return Object.fromEntries(Object.entries(observations || {}).filter(([, observation]) => {
      if (!observation || observation.source !== 'mailbox') return true;
      const receivedMs = timeMs(observation.receivedAt);
      return !!receivedMs && receivedMs >= cutoffMs;
    }));
  }

  function pruneOrphanedMailboxFollowUps(storeInput) {
    const store = storeInput;
    const liveRoots = new Set(Object.values(store.outboundRecords || {}).map(record => String(record?.rootTaskId || '')).filter(Boolean));
    for (const [taskId, task] of Object.entries(store.derivedTasks || {})) {
      const rootTaskId = String(task?.rootTaskId || '');
      if (task?.kind !== 'follow_up' || !rootTaskId.startsWith('mailroot:') || liveRoots.has(rootTaskId)) continue;
      delete store.derivedTasks[taskId];
    }
    return store;
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
    if (options.draftCoverage?.complete === true) {
      for (const draft of Object.values(next.draftRecords || {})) {
        if (draft && draft.mailboxFolder === 'draft') draft.mailboxPresentAt = '';
      }
    }
    for (const message of draftMessages || []) {
      const record = draftFromMailbox(message);
      if (!record.recipients.length) { draftsWithoutRecipient++; continue; }
      const existing = next.draftRecords[record.id] || {};
      incomingDrafts[record.id] = {
        ...existing, ...record, observedAt, mailboxPresentAt: observedAt,
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
      const historyCutoffAt = String(options.historyCutoffAt || '');
      const linkedOutbound = Object.fromEntries(Object.entries(next.outboundRecords).filter(([, record]) => retainExistingMailboxRecord(record, historyCutoffAt, 'sentAt')));
      const linkedDrafts = Object.fromEntries(Object.entries(next.draftRecords).filter(([, record]) => retainExistingMailboxRecord(record, historyCutoffAt, 'savedAt')));
      next.outboundRecords = { ...linkedOutbound, ...incomingOutbound };
      next.draftRecords = { ...linkedDrafts, ...incomingDrafts };
      next.inboundRecords = { ...incomingInbound };
      next.replyObservations = pruneMailboxReplyObservationsForWindow(next.replyObservations, historyCutoffAt);
      if (historyCutoffAt) pruneOrphanedMailboxFollowUps(next);
    } else {
      next.outboundRecords = { ...next.outboundRecords, ...incomingOutbound };
      next.draftRecords = { ...next.draftRecords, ...incomingDrafts };
      next.inboundRecords = { ...next.inboundRecords, ...incomingInbound };
    }

    const linked = reconcileOutboundsToDrafts(next);
    const monitored = ensureMonitoringRoots(linked.store);
    const replies = reconcileInboundReplies(monitored.store);
    const observed = reconcileObservedFollowUpHistory(replies.store);
    const scheduledDrafts = reconcileScheduledFollowUpDrafts(observed.store);
    const refreshed = refreshDerivedTaskBlocks(scheduledDrafts.store);
    const finalStore = refreshed.store;
    finalStore.mailboxSync = {
      ...finalStore.mailboxSync,
      lastMode: full ? 'full' : 'quick',
      complete: full,
      lastQuickAt: !full ? observedAt : finalStore.mailboxSync.lastQuickAt || '',
      lastFullAt: full ? observedAt : finalStore.mailboxSync.lastFullAt || '',
      sent: options.sentCoverage || { read: Object.keys(incomingOutbound).length },
      drafts: options.draftCoverage || { read: Object.keys(incomingDrafts).length },
      inbox: options.inboxCoverage || { read: Object.keys(incomingInbound).length },
      historyMonths: Math.max(0, Math.floor(Number(options.historyMonths || 0) || 0)),
      historyCutoffAt: String(options.historyCutoffAt || '')
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
      historicalFollowUpsRecognized: observed.recognizedFollowUps,
      followUpTasksReconciled: observed.reconciledTasks,
      scheduledFollowUpDraftsRecognized: scheduledDrafts.recognizedDrafts,
      scheduledFollowUpTasksReconciled: scheduledDrafts.reconciledTasks,
      followUpsBlocked: refreshed.blockedTasks,
      followUpsDequeued: refreshed.dequeuedTasks,
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
    if (options.draftCoverage?.complete === true || options.complete === true) {
      for (const draft of Object.values(next.draftRecords || {})) {
        if (draft && draft.mailboxFolder === 'draft') draft.mailboxPresentAt = '';
      }
    }
    for (const message of draftMessages || []) {
      const record = draftFromMailbox(message);
      if (!record.recipients.length) { draftsWithoutRecipient++; continue; }
      const existing = next.draftRecords[record.id] || {};
      incomingDrafts[record.id] = {
        ...existing, ...record, observedAt, mailboxPresentAt: observedAt,
        taskId: existing.taskId || record.taskId || '',
        rootTaskId: existing.rootTaskId || record.rootTaskId || '',
        parentTaskId: existing.parentTaskId || record.parentTaskId || '',
        parentOutboundId: existing.parentOutboundId || record.parentOutboundId || '',
        sequence: existing.rootTaskId ? Number(existing.sequence || 0) : Number(record.sequence || 0),
        kind: existing.rootTaskId ? (existing.kind || 'initial') : record.kind
      };
    }

    const historyCutoffAt = String(options.historyCutoffAt || '');
    const linkedOutbound = Object.fromEntries(Object.entries(next.outboundRecords).filter(([, record]) => retainExistingMailboxRecord(record, historyCutoffAt, 'sentAt')));
    const linkedDrafts = Object.fromEntries(Object.entries(next.draftRecords).filter(([, record]) => retainExistingMailboxRecord(record, historyCutoffAt, 'savedAt')));
    next.outboundRecords = { ...linkedOutbound, ...incomingOutbound };
    next.draftRecords = { ...linkedDrafts, ...incomingDrafts };
    if (historyCutoffAt) pruneOrphanedMailboxFollowUps(next);

    const linked = reconcileOutboundsToDrafts(next);
    const monitored = ensureMonitoringRoots(linked.store);
    const observed = reconcileObservedFollowUpHistory(monitored.store);
    const scheduledDrafts = reconcileScheduledFollowUpDrafts(observed.store);
    const finalStore = scheduledDrafts.store;
    finalStore.mailboxSync = {
      ...finalStore.mailboxSync,
      lastDedupeAt: observedAt,
      dedupeComplete: true,
      sent: options.sentCoverage || { read: Object.keys(incomingOutbound).length, complete: true },
      drafts: options.draftCoverage || { read: Object.keys(incomingDrafts).length, complete: true },
      historyMonths: Math.max(0, Math.floor(Number(options.historyMonths || 0) || 0)),
      historyCutoffAt: String(options.historyCutoffAt || '')
    };
    finalStore.updatedAt = observedAt;
    return {
      store: finalStore,
      outboundRead: Object.keys(incomingOutbound).length,
      draftsRead: Object.keys(incomingDrafts).length,
      autoMonitored: monitored.adopted,
      linkedOutbounds: linked.linked,
      historicalFollowUpsRecognized: observed.recognizedFollowUps,
      followUpTasksReconciled: observed.reconciledTasks,
      scheduledFollowUpDraftsRecognized: scheduledDrafts.recognizedDrafts,
      scheduledFollowUpTasksReconciled: scheduledDrafts.reconciledTasks,
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
    const refreshed = refreshDerivedTaskBlocks(next);
    const observed = reconcileObservedFollowUpHistory(refreshed.store);
    return { store: observed.store, observation: observed.store.replyObservations[id] };
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
    let blockedTasks = 0, restoredTasks = 0, dequeuedTasks = 0;
    for (const task of Object.values(next.derivedTasks)) {
      if (!task || task.kind !== 'follow_up' || task.state === 'sent' || task.state === 'cancelled') continue;
      const conversation = conversationContextFromStore(next, task.rootTaskId);
      const parent = next.outboundRecords[task.parentOutboundId]
        || conversation.outbounds.find(item => Number(item.effectiveSequence || item.sequence || 0) === Number(task.sequence || 0) - 1)
        || null;
      const after = parent?.sentAt || '';
      const recipientEmails = (task.recipients || []).map(item => normalizeEmail(item?.email || item?.address)).filter(Boolean);
      const guardMatches = recipientEmails.map(email => next.recipientGuards[email]).filter(guard => guard && guard.mode !== 'normal');
      const guard = { blocked: guardMatches.length > 0, modes: [...new Set(guardMatches.map(item => item.mode))], reasons: guardMatches.map(item => `${item.email}：${item.mode === 'do-not-contact' ? '不再联系' : '暂停'}`) };
      const human = conversation.human;
      const threshold = timeMs(after);
      const replies = conversation.observations.filter(obs => timeMs(obs.receivedAt) >= threshold);
      const ambiguous = replies.find(item => item.kind === 'ambiguous') || null;
      const blocker = guard.blocked
        ? { type: 'recipient-guard', modes: guard.modes, reasons: guard.reasons }
        : human
          ? { type: 'human-conversation', observationId: human.id, kind: 'human', subject: human.subject || '', receivedAt: human.receivedAt || '' }
          : ambiguous
            ? { type: 'reply', observationId: ambiguous.id, kind: 'ambiguous', subject: ambiguous.subject || '' }
            : null;
      if (blocker) {
        if (task.state !== 'blocked') {
          task.blockedFromState = task.state;
          task.state = 'blocked';
          blockedTasks++;
        }
        task.blocker = blocker;
        if (human && task.dispatch?.queued === true) {
          task.dispatch.queued = false;
          task.dispatch.dequeuedAt = nowIso();
          task.dispatch.dequeuedReason = 'human-reply';
          task.dispatch.scheduleSource = '';
          task.dispatch.scheduleReason = 'human-managed-conversation';
          task.dispatch.queuedAt = '';
          dequeuedTasks++;
        }
        task.updatedAt = nowIso();
      } else if (task.state === 'blocked' && task.blocker && ['reply', 'human-conversation', 'recipient-guard'].includes(task.blocker.type)) {
        task.state = task.blockedFromState && task.blockedFromState !== 'blocked' ? task.blockedFromState : (task.body || task.subject ? 'prepared' : 'due');
        task.blockedFromState = '';
        task.blocker = null;
        task.updatedAt = nowIso();
        restoredTasks++;
      }
    }
    next.updatedAt = nowIso();
    return { store: next, blockedTasks, restoredTasks, dequeuedTasks };
  }

  function existingFollowUp(storeInput, rootTaskId, sequence) {
    const store = normalizeStore(storeInput);
    const conversation = conversationContextFromStore(store, rootTaskId);
    const rootIds = new Set(conversation.rootIds.length ? conversation.rootIds : [String(rootTaskId)]);
    return Object.values(store.derivedTasks).find(task => task?.kind === 'follow_up' && rootIds.has(String(task.rootTaskId || '')) && Number(task.sequence) === Number(sequence) && task.state !== 'cancelled') || null;
  }

  function evaluateFollowUpEligibility(storeInput, rootTaskId, options = {}) {
    const store = normalizeStore(storeInput);
    rootTaskId = String(rootTaskId || '').trim();
    if (!rootTaskId) return { eligible: false, hardBlocked: true, reason: 'missing-root-task' };
    const policy = policyForRoot(store, rootTaskId);
    if (!policy.enabled) return { eligible: false, hardBlocked: true, reason: 'follow-up-disabled', policy };

    // Eligibility is conversation-based, not task-record-based. A second outbound
    // with the same recipient + normalized subject is already Follow-up #1 even
    // when it was sent manually or by an older version of the plugin.
    const conversation = conversationContextForRoot(store, rootTaskId);
    const outbound = conversation.outbounds;
    if (!outbound.length) return { eligible: false, hardBlocked: true, reason: 'no-sent-outbound', policy };
    const lastOutbound = conversation.lastOutbound || outbound[outbound.length - 1];
    const completedFollowUps = Math.max(0, Number(conversation.completedFollowUps || 0));
    const sequence = completedFollowUps + 1;
    const human = conversation.human;
    if (human) return { eligible: false, hardBlocked: true, reason: 'human-managed-conversation', policy, lastOutbound, sequence, completedFollowUps, blockingObservation: human, conversationRootIds: conversation.rootIds, scheduledDrafts: conversation.scheduledDrafts || [] };
    const scheduledDraft = (conversation.scheduledDrafts || []).find(draft => Number(draft.sequence || draft.observedSequence || 0) === Number(sequence)) || (conversation.scheduledDrafts || [])[0] || null;
    if (scheduledDraft) return { eligible: false, hardBlocked: true, reason: 'scheduled-follow-up-exists', policy, lastOutbound, sequence:Number(scheduledDraft.sequence || scheduledDraft.observedSequence || sequence), completedFollowUps, scheduledDraft, scheduledDrafts:conversation.scheduledDrafts || [], dueAt:scheduledDraft.scheduleAt || '', conversationRootIds: conversation.rootIds };
    if (completedFollowUps >= policy.maxAttempts) return { eligible: false, hardBlocked: true, reason: 'max-attempts-reached', policy, lastOutbound, sequence, completedFollowUps, conversationRootIds: conversation.rootIds };
    const guard = guardForRecipients(store, (lastOutbound.recipients || []).map(item => item.email).join(';'));
    if (guard.blocked) return { eligible: false, hardBlocked: true, reason: 'recipient-guard', policy, lastOutbound, sequence, completedFollowUps, guard, conversationRootIds: conversation.rootIds };
    const threshold = timeMs(lastOutbound.sentAt);
    const replies = conversation.observations.filter(obs => timeMs(obs.receivedAt) >= threshold);
    const ambiguous = replies.find(item => item.kind === 'ambiguous');
    if (ambiguous) return { eligible: false, hardBlocked: true, reason: 'ambiguous-reply', policy, lastOutbound, sequence, completedFollowUps, blockingObservation: ambiguous, conversationRootIds: conversation.rootIds };
    const existing = existingFollowUp(store, rootTaskId, sequence);
    if (existing) return { eligible: false, hardBlocked: true, reason: 'follow-up-already-exists', policy, lastOutbound, sequence, completedFollowUps, existing, conversationRootIds: conversation.rootIds };
    const dueAtMs = timeMs(lastOutbound.sentAt) + policy.delayDays * 86400000;
    const dueAt = dueAtMs ? new Date(dueAtMs).toISOString() : '';
    const now = timeMs(options.now || Date.now());
    const due = !!dueAtMs && now >= dueAtMs;
    const automaticReplies = replies.filter(item => item.kind === 'automatic');
    if (!due && options.ignoreTiming !== true) return { eligible: false, hardBlocked: false, reason: 'waiting', policy, lastOutbound, sequence, completedFollowUps, dueAt, automaticReplies, conversationRootIds: conversation.rootIds };
    return { eligible: true, hardBlocked: false, reason: due ? 'due' : 'manual-early', policy, lastOutbound, sequence, completedFollowUps, dueAt, automaticReplies, conversationRootIds: conversation.rootIds };
  }

  function followUpReviewIssues(task) {
    const issues = [];
    if (!task || task.kind !== 'follow_up') return ['invalid-follow-up-task'];
    if (!recipientKey(task.recipients || [])) issues.push('missing-recipient');
    if (!String(task.body || '').trim()) issues.push('missing-body');
    if (task.composeMode === 'new') {
      const subject = String(task.subject || '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim();
      if (!subject) issues.push('missing-subject');
    }
    if (task.state === 'blocked' || task.blocker) issues.push('blocked');
    return issues;
  }

  function applyFollowUpReviewDecision(task, decision = 'manual', at = nowIso()) {
    const issues = followUpReviewIssues(task);
    if (issues.length) return { ok: false, issues, task };
    task.confirmedVersion = Math.max(1, Number(task.contentVersion || 1));
    task.confirmedAt = at;
    task.reviewedAt = at;
    task.reviewDecision = decision === 'auto' ? 'auto' : 'manual';
    task.state = 'confirmed';
    task.dispatch = {
      ...(task.dispatch || {}),
      queued: true,
      enabled: task.dispatch?.enabled !== false,
      scheduleAt: String(task.dispatch?.scheduleAt || ''),
      scheduleSource: decision === 'auto' ? 'review-auto' : 'review',
      scheduleReason: decision === 'auto' ? 'review-auto-passed' : 'review-passed',
      queuedAt: task.dispatch?.queuedAt || at,
      dequeuedAt: '',
      dequeuedReason: ''
    };
    task.updatedAt = at;
    return { ok: true, issues: [], task };
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
      state: 'prepared',
      dueAt,
      createdAt: now,
      updatedAt: now,
      createdReason: eligibility.reason,
      recipients: (lastOutbound.recipients || []).map(item => ({ ...item })),
      subject: policy.composeMode === 'new' ? `Re: ${lastOutbound.subject || ''}`.trim() : String(lastOutbound.subject || ''),
      body: rendered.body,
      bodyHtml: '',
      bodyIsHtml: false,
      composeMode: policy.composeMode,
      contentVersion: 1,
      confirmedVersion: null,
      confirmedAt: '',
      reviewedAt: '',
      reviewDecision: '',
      generatedFromTemplateVersion: policy.templateVersion,
      templateManaged: true,
      personalization: { salutation: rendered.personalization.salutation, signature: rendered.personalization.signature, initialOutboundId: rendered.initial.id },
      scheduledAt: '',
      sentOutboundId: '',
      blocker: null,
      dispatch: { queued: false, enabled: true, scheduleAt: '', scheduleSource: '', scheduleReason: 'awaiting-review', queuedAt: '', dequeuedAt: '', dequeuedReason: '' }
    };
    const review = applyFollowUpReviewDecision(task, 'auto', now);
    if (!review.ok) {
      task.state = 'prepared';
      task.dispatch = { ...task.dispatch, queued: false, scheduleSource: '', scheduleReason: 'awaiting-review', queuedAt: '' };
    }
    next.derivedTasks[id] = task;
    next.updatedAt = now;
    return { store: next, task, eligibility, review };
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
        sequence, state: 'prepared', dueAt, createdAt: now, updatedAt: now, createdReason: eligibility.reason,
        recipients: (lastOutbound.recipients || []).map(item => ({ ...item })),
        subject: policy.composeMode === 'new' ? `Re: ${lastOutbound.subject || ''}`.trim() : String(lastOutbound.subject || ''),
        body: rendered.body, composeMode: policy.composeMode,
        contentVersion: 1, confirmedVersion: null, confirmedAt: '', reviewedAt: '', reviewDecision: '',
        generatedFromTemplateVersion: policy.templateVersion,
        templateManaged: true,
        personalization: { salutation: rendered.personalization.salutation, signature: rendered.personalization.signature, initialOutboundId: rendered.initial.id },
        scheduledAt: '', sentOutboundId: '', blocker: null,
        dispatch: { queued: false, enabled: true, scheduleAt: '', scheduleSource: '', scheduleReason: 'awaiting-review', queuedAt: '', dequeuedAt: '', dequeuedReason: '' }
      };
      const review = applyFollowUpReviewDecision(task, 'auto', now);
      if (!review.ok) {
        task.state = 'prepared';
        task.dispatch = { ...task.dispatch, queued: false, scheduleSource: '', scheduleReason: 'awaiting-review', queuedAt: '' };
      }
      next.derivedTasks[id] = task;
      next.updatedAt = now;
      created.push(task);
    }
    return { store: next, created, skipped };
  }

  function refreshTemplateManagedFollowUps(storeInput, options = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const rootFilter = new Set((Array.isArray(options.rootTaskIds) ? options.rootTaskIds : []).map(value => String(value || '').trim()).filter(Boolean));
    const refreshed = [];
    const skipped = [];
    const now = nowIso();
    for (const task of Object.values(next.derivedTasks || {})) {
      if (!task || task.kind !== 'follow_up') continue;
      if (rootFilter.size && !rootFilter.has(String(task.rootTaskId || ''))) continue;
      if (['sent', 'cancelled', 'blocked', 'scheduled'].includes(task.state)) {
        skipped.push({ taskId: task.id, rootTaskId: task.rootTaskId, reason: task.state === 'scheduled' ? 'already-scheduled' : `state-${task.state}` });
        continue;
      }
      const managed = task.templateManaged === true || (task.templateManaged === undefined && Number(task.contentVersion || 1) === 1);
      if (!managed) { skipped.push({ taskId: task.id, rootTaskId: task.rootTaskId, reason: 'manually-edited' }); continue; }
      const policy = policyForRoot(next, task.rootTaskId);
      if (Number(task.generatedFromTemplateVersion || 0) === Number(policy.templateVersion || 0)) continue;
      const rendered = renderFollowUpTemplate(next, task.rootTaskId, policy);
      if (!rendered.ok) { skipped.push({ taskId: task.id, rootTaskId: task.rootTaskId, reason: rendered.reason }); continue; }
      const bodyChanged = String(task.body || '') !== String(rendered.body || '');
      task.body = rendered.body;
      task.bodyHtml = '';
      task.bodyIsHtml = false;
      task.generatedFromTemplateVersion = Number(policy.templateVersion || 0);
      task.templateManaged = true;
      task.personalization = { salutation: rendered.personalization.salutation, signature: rendered.personalization.signature, initialOutboundId: rendered.initial.id };
      task.updatedAt = now;
      if (bodyChanged) task.contentVersion = Math.max(1, Number(task.contentVersion || 1) + 1);
      task.confirmedVersion = null;
      task.confirmedAt = '';
      task.reviewedAt = '';
      task.reviewDecision = '';
      if (task.dispatch?.queued) task.dispatch = { ...task.dispatch, queued: false, dequeuedAt: now, dequeuedReason: 'template-updated' };
      task.state = 'prepared';
      const review = applyFollowUpReviewDecision(task, 'auto', now);
      if (!review.ok) {
        task.state = 'prepared';
        task.dispatch = { ...(task.dispatch || {}), queued: false, scheduleSource: '', scheduleReason: 'awaiting-review', queuedAt: '' };
      }
      // policyForRoot/renderFollowUpTemplate normalize the store and may replace the
      // derived task object. Reattach this updated task explicitly so the refresh is
      // authoritative rather than mutating a stale reference.
      next.derivedTasks[task.id] = task;
      refreshed.push({ taskId: task.id, rootTaskId: task.rootTaskId, sequence: Number(task.sequence || 1), bodyChanged, reviewDecision: task.reviewDecision || '', state: task.state });
    }
    next.updatedAt = now;
    return { store: next, refreshed, skipped };
  }


  function updateDerivedTaskContent(storeInput, taskId, patch = {}) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const current = next.derivedTasks[taskId];
    if (!current) throw new Error(`找不到 derived task：${taskId}`);
    if (current.state === 'sent' || current.state === 'cancelled') throw new Error('已发送或已取消的 Follow-up 不可修改。');
    const changed = ['recipients', 'subject', 'body', 'bodyHtml', 'bodyIsHtml', 'composeMode'].some(key => patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(current[key]));
    const composeMode = patch.composeMode === undefined ? current.composeMode : (COMPOSE_MODES.includes(patch.composeMode) ? patch.composeMode : current.composeMode);
    const task = { ...current, ...patch, composeMode, updatedAt: nowIso() };
    if (changed) {
      task.contentVersion = Math.max(1, Number(current.contentVersion || 1) + 1);
      const bodyChanged = ['body', 'bodyHtml', 'bodyIsHtml'].some(key => patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(current[key]));
      if (bodyChanged) task.templateManaged = false;
      task.confirmedVersion = null;
      task.confirmedAt = '';
      task.reviewedAt = '';
      task.reviewDecision = '';
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

  function passDerivedTaskReview(storeInput, taskId) {
    const store = normalizeStore(storeInput);
    const next = clone(store);
    const task = next.derivedTasks[taskId];
    if (!task) throw new Error(`找不到 derived task：${taskId}`);
    if (['sent', 'cancelled', 'blocked'].includes(task.state)) throw new Error(`当前状态不能通过审阅：${task.state}`);
    const now = nowIso();
    const review = applyFollowUpReviewDecision(task, 'manual', now);
    if (!review.ok) {
      const labels = review.issues.map(issue => ({'missing-recipient':'缺少收件人','missing-body':'正文为空','missing-subject':'新邮件模式缺少主题','blocked':'Follow-up 已阻断'}[issue] || issue));
      throw new Error(`${labels.join('；')}，不能通过审阅。`);
    }
    next.updatedAt = now;
    return { store: next, task, review };
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
      .filter(task => task?.kind === 'follow_up' && task?.dispatch?.queued === true && !['sent', 'cancelled', 'blocked'].includes(task.state) && !task.blocker)
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
    const buckets = new Map();
    for (const outbound of Object.values(store.outboundRecords || {})) {
      if (!outbound?.rootTaskId || outbound.status !== 'sent') continue;
      const conversationKey = followUpConversationKeyForOutbound(outbound);
      const bucketKey = conversationKey || `root:${String(outbound.rootTaskId)}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, { conversationKey, records: [] });
      buckets.get(bucketKey).records.push(outbound);
    }

    const result = [];
    for (const { conversationKey, records } of buckets.values()) {
      const outbounds = decorateConversationOutbounds(records);
      if (!outbounds.length) continue;
      const rootIds = [...new Set(outbounds.map(record => String(record.rootTaskId || '')).filter(Boolean))];
      const canonicalRootId = String(outbounds[0]?.rootTaskId || rootIds[0] || '');
      const replies = Object.values(store.replyObservations || {})
        .filter(obs => obs?.rootTaskId && rootIds.includes(String(obs.rootTaskId)))
        .sort((a, b) => timeMs(a.receivedAt) - timeMs(b.receivedAt));
      const humanObservations = replies.filter(obs => obs.kind === 'human');
      const humanReply = humanObservations[humanObservations.length - 1] || null;
      const tasks = Object.values(store.derivedTasks || {})
        .filter(task => task?.rootTaskId && rootIds.includes(String(task.rootTaskId)))
        .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
      const eligibility = evaluateFollowUpEligibility(store, canonicalRootId);
      const policy = policyForRoot(store, canonicalRootId);
      const lastOutbound = outbounds[outbounds.length - 1];
      const operatorContinued = !!humanReply && !!lastOutbound && timeMs(lastOutbound.sentAt) > timeMs(humanReply.receivedAt);
      result.push({
        rootTaskId: canonicalRootId,
        conversationKey,
        conversationRootIds: rootIds,
        outbounds,
        lastOutbound,
        replies,
        tasks,
        eligibility,
        policy,
        humanManaged: !!humanReply,
        humanReply,
        operatorContinued,
        scheduledFollowUpDrafts: eligibility?.scheduledDrafts || (conversationContextFromStore(store, canonicalRootId).scheduledDrafts || []),
        completedFollowUps: Math.max(0, Number(eligibility?.completedFollowUps ?? outbounds[outbounds.length - 1]?.effectiveSequence ?? 0))
      });
    }
    return result.sort((a, b) => timeMs(b.lastOutbound?.sentAt) - timeMs(a.lastOutbound?.sentAt));
  }

  // Runtime-only domain state. SmartMail is a batch execution tool, not a local database.
  // Mailbox facts, Review tasks, Follow-up lineage and Dispatch state live only in the
  // currently open app page and are discarded on reload/close. Persistent preferences
  // (templates/rules) are owned by app.js separately from this domain store.

  globalThis.NMDAOperations = {
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
    conversationKeyForOutbound,
    followUpConversationKeyForOutbound,
    decorateConversationOutbounds,
    conversationContextForRoot,
    classifyInboundMessage,
    isEffectiveReplyObservation,
    hasAutoReplyFeature,
    createStore,
    normalizeStore,
    ingestMailboxSnapshot,
    ingestMailboxDedupeSnapshot,
    reconcileOutboundsToDrafts,
    reconcileInboundReplies,
    reconcileObservedFollowUpHistory,
    reconcileScheduledFollowUpDrafts,
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
    passDerivedTaskReview,
    refreshTemplateManagedFollowUps,
    updateDerivedTaskContent,
    setDerivedTaskState,
    updateDerivedTaskDispatch,
    queuedDerivedTasks,
    mailboxHistoryForRecipients,
    monitoringRoots
  };
})();
