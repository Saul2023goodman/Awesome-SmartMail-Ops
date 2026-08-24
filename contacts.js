(() => {
  'use strict';

  const STORAGE_PREFIX = 'nmda.contacts.v1:'; // keep the old key so v0.6 data migrates in place
  const STAGE_OPTIONS = ['未联系', '已发送', '已回复'];
  const POLICY_OPTIONS = ['正常', '暂停', '不再联系'];
  const STATUS_OPTIONS = ['未联系', '已发送', '已回复', '待跟进', '暂停', '不再联系']; // compatibility
  const SYSTEM_CLASSIFICATIONS = new Set([...STAGE_OPTIONS, '待跟进', ...POLICY_OPTIONS, '有草稿']);

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

  function parseContactTags(value) {
    return parseTags(value).filter(tag => !SYSTEM_CLASSIFICATIONS.has(tag));
  }

  function mergeTags(...values) {
    const seen = new Set();
    const tags = [];
    for (const value of values) {
      for (const tag of parseTags(value)) {
        const key = tag.toLocaleLowerCase('zh-CN');
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
      }
    }
    return tags;
  }

  function mergeContactTags(...values) {
    return parseContactTags(mergeTags(...values));
  }

  function parseRecipients(raw) {
    const text = String(raw || '');
    const results = [];
    const seen = new Set();
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
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

  function storageKey(account) {
    return `${STORAGE_PREFIX}${normalizeEmail(account) || 'default'}`;
  }

  function inferredStage(sentCount) {
    return Number(sentCount || 0) > 0 ? '已发送' : '未联系';
  }

  function legacyDimensions(status, sentCount) {
    const base = { stage: inferredStage(sentCount), policy: '正常', followUp: false };
    if (status === '未联系' || status === '已发送' || status === '已回复') base.stage = status;
    else if (status === '待跟进') base.followUp = true;
    else if (status === '暂停') base.policy = '暂停';
    else if (status === '不再联系') base.policy = '不再联系';
    return base;
  }

  function normalizeContactShape(contact, email = '') {
    if (!contact || typeof contact !== 'object') contact = {};
    const legacy = legacyDimensions(contact.status, contact.sentCount);
    contact.email = normalizeEmail(contact.email || email);
    contact.stage = STAGE_OPTIONS.includes(contact.stage) ? contact.stage : legacy.stage;
    contact.policy = POLICY_OPTIONS.includes(contact.policy) ? contact.policy : legacy.policy;
    contact.followUp = typeof contact.followUp === 'boolean' ? contact.followUp : legacy.followUp;
    contact.tags = parseContactTags(contact.tags || []);
    contact.sentCount = Number(contact.sentCount || 0);
    contact.sentMessageIds = Array.isArray(contact.sentMessageIds) ? contact.sentMessageIds : [];
    contact.history = Array.isArray(contact.history) ? contact.history : [];
    contact.draftCount = Number(contact.draftCount || 0);
    contact.draftMessageIds = Array.isArray(contact.draftMessageIds) ? contact.draftMessageIds : [];
    contact.draftHistory = Array.isArray(contact.draftHistory) ? contact.draftHistory : [];
    contact.lastDraftAt = contact.lastDraftAt || '';
    contact.lastDraftSubject = contact.lastDraftSubject || '';
    // Keep a backward-compatible shadow value. New code never uses it as the full workflow state.
    contact.status = contact.stage;
    return contact;
  }

  async function load(account) {
    const key = storageKey(account);
    const stored = (await chrome.storage.local.get(key))[key];
    if (!stored || typeof stored !== 'object') return {};
    for (const [email, contact] of Object.entries(stored)) stored[email] = normalizeContactShape(contact, email);
    return stored;
  }

  async function save(account, contacts) {
    const key = storageKey(account);
    const normalized = {};
    for (const [email, contact] of Object.entries(contacts || {})) normalized[normalizeEmail(email)] = normalizeContactShape(contact, email);
    await chrome.storage.local.set({ [key]: normalized });
  }

  function ensureContact(contacts, email, patch = {}) {
    email = normalizeEmail(email);
    if (!email) return null;
    const now = new Date().toISOString();
    const prev = normalizeContactShape(contacts[email] || {}, email);
    const legacyPatch = patch.status ? legacyDimensions(patch.status, prev.sentCount) : {};
    const next = {
      email,
      name: patch.name || prev.name || '',
      stage: STAGE_OPTIONS.includes(patch.stage) ? patch.stage : (legacyPatch.stage || prev.stage || '未联系'),
      policy: POLICY_OPTIONS.includes(patch.policy) ? patch.policy : (legacyPatch.policy || prev.policy || '正常'),
      followUp: typeof patch.followUp === 'boolean' ? patch.followUp : (patch.status === '待跟进' ? true : !!prev.followUp),
      tags: patch.replaceTags ? parseContactTags(patch.tags || []) : mergeContactTags(prev.tags || [], patch.tags || []),
      sentCount: Number(prev.sentCount || 0),
      lastSentAt: prev.lastSentAt || '',
      lastSubject: prev.lastSubject || '',
      sentMessageIds: Array.isArray(prev.sentMessageIds) ? prev.sentMessageIds : [],
      history: Array.isArray(prev.history) ? prev.history : [],
      draftCount: Number(prev.draftCount || 0),
      lastDraftAt: prev.lastDraftAt || '',
      lastDraftSubject: prev.lastDraftSubject || '',
      draftMessageIds: Array.isArray(prev.draftMessageIds) ? prev.draftMessageIds : [],
      draftHistory: Array.isArray(prev.draftHistory) ? prev.draftHistory : [],
      createdAt: prev.createdAt || now,
      updatedAt: now,
      ...prev,
      ...patch,
      email
    };
    if (patch.status === '暂停' || patch.status === '不再联系') next.policy = patch.status;
    if (patch.status === '待跟进') next.followUp = true;
    if (STAGE_OPTIONS.includes(patch.status)) next.stage = patch.status;
    if (!STAGE_OPTIONS.includes(next.stage)) next.stage = inferredStage(next.sentCount);
    if (!POLICY_OPTIONS.includes(next.policy)) next.policy = '正常';
    next.followUp = !!next.followUp;
    next.tags = patch.replaceTags ? parseContactTags(patch.tags || []) : mergeContactTags(prev.tags || [], patch.tags || []);
    next.status = next.stage;
    delete next.replaceTags;
    contacts[email] = normalizeContactShape(next, email);
    return contacts[email];
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

  function sentRecordId(message, email) {
    return String(message.id || `${message.sentAt || message.sentDate || ''}|${message.subject || ''}|${email}`);
  }

  function applySentMessages(contacts, messages) {
    let contactsTouched = 0;
    let newLinks = 0;
    let failedMessages = 0;
    for (const message of messages || []) {
      if (message.failed) { failedMessages++; continue; }
      const sentIso = isoTime(message.sentAt ?? message.sentDate ?? message.date);
      for (const recipient of message.recipients || []) {
        const email = normalizeEmail(recipient.email || recipient.address);
        if (!email) continue;
        const contact = ensureContact(contacts, email, { name: recipient.name || '' });
        contactsTouched++;
        const mid = sentRecordId(message, email);
        const ids = new Set(contact.sentMessageIds || []);
        if (!ids.has(mid)) {
          ids.add(mid);
          newLinks++;
          contact.sentCount = Number(contact.sentCount || 0) + 1;
          contact.sentMessageIds = [...ids].slice(-500);
          contact.history = [
            { id: mid, subject: message.subject || '', sentAt: sentIso, to: recipient.name || email },
            ...(contact.history || []).filter(item => item.id !== mid)
          ].slice(0, 50);
        }
        if (sentIso && (!contact.lastSentAt || timeMs(sentIso) >= timeMs(contact.lastSentAt))) {
          contact.lastSentAt = sentIso;
          contact.lastSubject = message.subject || contact.lastSubject || '';
        }
        if (contact.stage === '未联系') contact.stage = '已发送';
        contact.status = contact.stage;
        contact.updatedAt = new Date().toISOString();
      }
    }
    return { contacts, contactsTouched, newLinks, failedMessages };
  }

  function draftRecordId(message, email) {
    return String(message.id || `${message.savedAt || message.sentAt || message.date || ''}|${message.subject || ''}|${email}`);
  }

  function clearActiveDraftState(contacts) {
    for (const raw of Object.values(contacts || {})) {
      const contact = normalizeContactShape(raw);
      contact.draftCount = 0;
      contact.draftMessageIds = [];
      contact.draftHistory = [];
      contact.lastDraftAt = '';
      contact.lastDraftSubject = '';
    }
  }

  function applyDraftMessages(contacts, messages, options = {}) {
    const replaceActive = !!options.replaceActive;
    if (replaceActive) clearActiveDraftState(contacts);
    let contactsTouched = 0;
    let newLinks = 0;
    let draftsWithoutRecipient = 0;
    for (const message of messages || []) {
      const savedIso = isoTime(message.savedAt ?? message.sentAt ?? message.sentDate ?? message.date ?? message.receivedDate);
      const recipients = message.recipients || [];
      if (!recipients.length) { draftsWithoutRecipient++; continue; }
      for (const recipient of recipients) {
        const email = normalizeEmail(recipient.email || recipient.address);
        if (!email) continue;
        const contact = ensureContact(contacts, email, { name: recipient.name || '' });
        contactsTouched++;
        const mid = draftRecordId(message, email);
        const ids = new Set(contact.draftMessageIds || []);
        if (!ids.has(mid)) {
          ids.add(mid);
          newLinks++;
          contact.draftMessageIds = [...ids].slice(-1000);
        }
        const history = [
          { id: mid, subject: message.subject || '', savedAt: savedIso, to: recipient.name || email },
          ...(contact.draftHistory || []).filter(item => item.id !== mid)
        ];
        history.sort((a, b) => timeMs(b.savedAt) - timeMs(a.savedAt));
        contact.draftHistory = history.slice(0, 100);
        contact.draftCount = contact.draftMessageIds.length;
        if (savedIso && (!contact.lastDraftAt || timeMs(savedIso) >= timeMs(contact.lastDraftAt))) {
          contact.lastDraftAt = savedIso;
          contact.lastDraftSubject = message.subject || contact.lastDraftSubject || '';
        }
        // Drafts are preparation state only. Never advance 未联系 -> 已发送 here.
        contact.updatedAt = new Date().toISOString();
      }
    }
    return { contacts, contactsTouched, newLinks, draftsWithoutRecipient, replaceActive };
  }

  function mergeRecipientList(contacts, recipients, defaultStage = '未联系') {
    let added = 0;
    for (const item of recipients || []) {
      const email = normalizeEmail(item.email || item.address);
      if (!email) continue;
      const existed = !!contacts[email];
      ensureContact(contacts, email, { name: item.name || '', stage: STAGE_OPTIONS.includes(defaultStage) ? defaultStage : '未联系', tags: item.tags || [] });
      if (!existed) added++;
    }
    return added;
  }

  function setStage(contacts, email, stage) {
    if (!STAGE_OPTIONS.includes(stage)) throw new Error(`未知互动阶段：${stage}`);
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.stage = stage;
    contact.status = stage;
    contact.stageChangedAt = new Date().toISOString();
    contact.updatedAt = contact.stageChangedAt;
    return contact;
  }

  function setPolicy(contacts, email, policy) {
    if (!POLICY_OPTIONS.includes(policy)) throw new Error(`未知发送策略：${policy}`);
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.policy = policy;
    contact.policyChangedAt = new Date().toISOString();
    contact.updatedAt = contact.policyChangedAt;
    return contact;
  }

  function setFollowUp(contacts, email, followUp) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.followUp = !!followUp;
    contact.followUpChangedAt = new Date().toISOString();
    contact.updatedAt = contact.followUpChangedAt;
    return contact;
  }

  function setStatus(contacts, email, status) {
    if (!STATUS_OPTIONS.includes(status)) throw new Error(`未知联系人状态：${status}`);
    if (STAGE_OPTIONS.includes(status)) return setStage(contacts, email, status);
    if (status === '待跟进') return setFollowUp(contacts, email, true);
    return setPolicy(contacts, email, status);
  }

  function setTags(contacts, email, tags) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.tags = parseContactTags(tags);
    contact.tagsChangedAt = new Date().toISOString();
    contact.updatedAt = contact.tagsChangedAt;
    return contact;
  }

  function addTags(contacts, email, tags) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.tags = mergeContactTags(contact.tags || [], tags || []);
    contact.tagsChangedAt = new Date().toISOString();
    contact.updatedAt = contact.tagsChangedAt;
    return contact;
  }

  function removeTags(contacts, email, tags) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    const remove = new Set(parseContactTags(tags).map(tag => tag.toLocaleLowerCase('zh-CN')));
    contact.tags = parseContactTags(contact.tags || []).filter(tag => !remove.has(tag.toLocaleLowerCase('zh-CN')));
    contact.tagsChangedAt = new Date().toISOString();
    contact.updatedAt = contact.tagsChangedAt;
    return contact;
  }

  function classificationItems(contact) {
    contact = normalizeContactShape(contact || {});
    const items = [{ kind: 'stage', value: contact.stage || '未联系' }];
    if (contact.followUp) items.push({ kind: 'followup', value: '待跟进' });
    if (contact.policy && contact.policy !== '正常') items.push({ kind: 'policy', value: contact.policy });
    if (Number(contact.draftCount || 0) > 0) items.push({ kind: 'draft', value: '有草稿' });
    for (const tag of parseContactTags(contact.tags || [])) items.push({ kind: 'tag', value: tag });
    return items;
  }

  function classificationLabels(contact) {
    return classificationItems(contact).map(item => item.value);
  }

  function policyBlocksSend(contact) {
    contact = normalizeContactShape(contact || {});
    return contact.policy === '暂停' || contact.policy === '不再联系';
  }

  function formatDisplayTime(value) {
    const ms = timeMs(value);
    if (!ms) return '—';
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(contacts) {
    const rows = [['邮箱', '姓名', '互动阶段', '待跟进', '发送策略', '自定义分类', '已识别发送次数', '最后发送时间', '最后发送主题', '当前草稿数', '最后草稿时间', '最后草稿主题']];
    Object.values(contacts || {}).sort((a, b) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email))).forEach(raw => {
      const c = normalizeContactShape(raw);
      rows.push([c.email, c.name || '', c.stage || '未联系', c.followUp ? '是' : '否', c.policy || '正常', parseContactTags(c.tags || []).join(';'), c.sentCount || 0, c.lastSentAt || '', c.lastSubject || '', c.draftCount || 0, c.lastDraftAt || '', c.lastDraftSubject || '']);
    });
    return '\ufeff' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  }

  globalThis.NMDAContacts = {
    STATUS_OPTIONS,
    STAGE_OPTIONS,
    POLICY_OPTIONS,
    SYSTEM_CLASSIFICATIONS: [...SYSTEM_CLASSIFICATIONS],
    normalizeEmail,
    normalizeTag,
    parseTags,
    parseContactTags,
    mergeTags,
    mergeContactTags,
    parseRecipients,
    normalizeContactShape,
    load,
    save,
    ensureContact,
    applySentMessages,
    applyDraftMessages,
    clearActiveDraftState,
    mergeRecipientList,
    setStatus,
    setStage,
    setPolicy,
    setFollowUp,
    setTags,
    addTags,
    removeTags,
    classificationItems,
    classificationLabels,
    policyBlocksSend,
    formatDisplayTime,
    toCsv
  };
})();
