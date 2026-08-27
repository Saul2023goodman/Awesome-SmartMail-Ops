(() => {
  'use strict';

  // VM-only fallback. In the real extension Chrome provides these APIs, so this
  // file is never loaded by manifest.json and cannot affect production usage.
  if (globalThis.chrome?.storage?.local && globalThis.chrome?.runtime?.sendMessage) return;

  const PREFIX = 'nmda.vm.storage.';
  const memory = new Map();
  const readOne = key => {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (_) { return undefined; }
  };

  const storageLocal = {
    async get(keys) {
      if (keys == null) {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith(PREFIX)) continue;
          out[key.slice(PREFIX.length)] = readOne(key.slice(PREFIX.length));
        }
        return out;
      }
      if (typeof keys === 'string') return { [keys]: readOne(keys) };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, readOne(key)]));
      if (typeof keys === 'object') {
        const out = {};
        for (const [key, fallback] of Object.entries(keys)) {
          const value = readOne(key);
          out[key] = value === undefined ? fallback : value;
        }
        return out;
      }
      return {};
    },
    async set(values) {
      for (const [key, value] of Object.entries(values || {})) {
        memory.set(key, value);
        try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {}
      }
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) { memory.delete(key); try { localStorage.removeItem(PREFIX + key); } catch (_) {} }
    },
    async clear() {
      memory.clear();
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(PREFIX)) keys.push(key);
        }
        keys.forEach(key => localStorage.removeItem(key));
      } catch (_) {}
    }
  };

  globalThis.chrome = {
    ...(globalThis.chrome || {}),
    storage: { ...(globalThis.chrome?.storage || {}), local: storageLocal },
    runtime: {
      ...(globalThis.chrome?.runtime || {}),
      async sendMessage(message) {
        switch (message?.type) {
          case 'NMDA_ACCOUNT_INFO':
            return { ok: true, uid: 'vm-preview@163.com', vm: true };
          case 'NMDA_OPEN_COMPOSE':
            return { ok: false, reason: 'VM 预览不连接真实网易写信页', vm: true };
          case 'NMDA_READ_MAILBOX_STATE':
            return {
              ok: true,
              mode: message.mode === 'full' ? 'full' : 'quick',
              uid: 'vm-preview@163.com',
              complete: true,
              sent: { ok: true, messages: [], total: 0, complete: true, pages: 0 },
              drafts: { ok: true, messages: [], total: 0, complete: true, pages: 0 },
              coverage: {
                sent: { read: 0, total: 0, complete: true, pages: 0 },
                drafts: { read: 0, total: 0, complete: true, pages: 0 }
              },
              vm: true
            };
          default:
            return { ok: false, reason: 'VM 预览未模拟该浏览器动作', vm: true };
        }
      }
    }
  };
})();
