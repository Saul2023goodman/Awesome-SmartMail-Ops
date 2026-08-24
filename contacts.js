(() => {
  'use strict';

  const STORAGE_PREFIX = 'nmda.contacts.v1:';
  const STATUS_OPTIONS = ['未联系', '已发送', '已回复', '待跟进', '暂停', '不再联系'];

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

  async function load(account) {
    const key = storageKey(account);
    const stored = (await chrome.storage.local.get(key))[key];
    if (!stored || typeof stored !== 'object') return {};
    for (const contact of Object.values(stored)) {
      if (contact && typeof contact === 'object') contact.tags = parseTags(contact.tags || []);
    }
    return stored;
  }

  async function save(account, contacts) {
    const key = storageKey(account);
    await chrome.storage.local.set({ [key]: contacts || {} });
  }

  function ensureContact(contacts, email, patch = {}) {
    email = normalizeEmail(email);
    if (!email) return null;
    const now = new Date().toISOString();
    const prev = contacts[email] || {};
    const next = {
      email,
      name: patch.name || prev.name || '',
      status: prev.status || patch.status || '未联系',
      tags: mergeTags(prev.tags || [], patch.tags || []),
      sentCount: Number(prev.sentCount || 0),
      lastSentAt: prev.lastSentAt || '',
      lastSubject: prev.lastSubject || '',
      sentMessageIds: Array.isArray(prev.sentMessageIds) ? prev.sentMessageIds : [],
      history: Array.isArray(prev.history) ? prev.history : [],
      createdAt: prev.createdAt || now,
      updatedAt: now,
      ...prev,
      ...patch,
      email
    };
    if (prev.status) next.status = prev.status;
    next.tags = patch.replaceTags ? parseTags(patch.tags || []) : mergeTags(prev.tags || [], patch.tags || []);
    delete next.replaceTags;
    if (!STATUS_OPTIONS.includes(next.status)) next.status = '未联系';
    contacts[email] = next;
    return next;
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
        if (!contact.status || contact.status === '未联系') contact.status = '已发送';
        contact.updatedAt = new Date().toISOString();
      }
    }
    return { contacts, contactsTouched, newLinks, failedMessages };
  }

  function mergeRecipientList(contacts, recipients, defaultStatus = '未联系') {
    let added = 0;
    for (const item of recipients || []) {
      const email = normalizeEmail(item.email || item.address);
      if (!email) continue;
      const existed = !!contacts[email];
      ensureContact(contacts, email, { name: item.name || '', status: defaultStatus, tags: item.tags || [] });
      if (!existed) added++;
    }
    return added;
  }

  function setStatus(contacts, email, status) {
    if (!STATUS_OPTIONS.includes(status)) throw new Error(`未知联系人状态：${status}`);
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.status = status;
    contact.statusChangedAt = new Date().toISOString();
    contact.updatedAt = contact.statusChangedAt;
    return contact;
  }

  function setTags(contacts, email, tags) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.tags = parseTags(tags);
    contact.tagsChangedAt = new Date().toISOString();
    contact.updatedAt = contact.tagsChangedAt;
    return contact;
  }

  function addTags(contacts, email, tags) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    contact.tags = mergeTags(contact.tags || [], tags || []);
    contact.tagsChangedAt = new Date().toISOString();
    contact.updatedAt = contact.tagsChangedAt;
    return contact;
  }

  function removeTags(contacts, email, tags) {
    const contact = ensureContact(contacts, email);
    if (!contact) return null;
    const remove = new Set(parseTags(tags).map(tag => tag.toLocaleLowerCase('zh-CN')));
    contact.tags = parseTags(contact.tags || []).filter(tag => !remove.has(tag.toLocaleLowerCase('zh-CN')));
    contact.tagsChangedAt = new Date().toISOString();
    contact.updatedAt = contact.tagsChangedAt;
    return contact;
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
    const rows = [['邮箱', '姓名', '状态', '标签', '已识别发送次数', '最后发送时间', '最后主题']];
    Object.values(contacts || {}).sort((a, b) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email))).forEach(c => {
      rows.push([c.email, c.name || '', c.status || '未联系', parseTags(c.tags || []).join(';'), c.sentCount || 0, c.lastSentAt || '', c.lastSubject || '']);
    });
    return '\ufeff' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  }

  globalThis.NMDAContacts = {
    STATUS_OPTIONS,
    normalizeEmail,
    normalizeTag,
    parseTags,
    mergeTags,
    parseRecipients,
    load,
    save,
    ensureContact,
    applySentMessages,
    mergeRecipientList,
    setStatus,
    setTags,
    addTags,
    removeTags,
    formatDisplayTime,
    toCsv
  };
})();
