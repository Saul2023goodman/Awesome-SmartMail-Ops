import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('connection controller owns refreshes, broadcasts and observable failures', async () => {
  const messages = [];
  const runtimeListeners = new Set();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const context = {
    chrome: { runtime: {
      sendMessage: async message => {
        messages.push(message);
        if (message.type === 'NMDA_OPEN_MAIL') return { ok:false, reason:'mailbox unavailable' };
        return { connected:true, authenticated:true, account:'user@example.com' };
      },
      onMessage: {
        addListener: listener => runtimeListeners.add(listener),
        removeListener: listener => runtimeListeners.delete(listener)
      }
    } },
    window: {
      addEventListener: (type, listener) => windowListeners.set(type, listener),
      removeEventListener: type => windowListeners.delete(type)
    },
    document: {
      hidden:false,
      addEventListener: (type, listener) => documentListeners.set(type, listener),
      removeEventListener: type => documentListeners.delete(type)
    },
    setTimeout
  };
  runInNewContext(source('workspace-connection.js'), context);
  const connection = context.NMDAConnection;
  let updates = 0;
  connection.subscribe(() => { updates++; });
  connection.start();
  await connection.refresh();
  assert.equal(connection.getSnapshot().status.account, 'user@example.com');
  assert.equal(runtimeListeners.size, 1);
  connection.setSyncCue('syncing', 'reading');
  assert.equal(connection.getSnapshot().cue.detail, 'reading');
  await assert.rejects(connection.openMail(), /mailbox unavailable/);
  assert.equal(connection.getSnapshot().error, 'mailbox unavailable');
  assert.ok(updates >= 3);
  assert.ok(messages.some(message => message.type === 'NMDA_CONNECTION_STATUS'));
  connection.stop();
  assert.equal(runtimeListeners.size, 0);
  assert.equal(windowListeners.size, 0);
  assert.equal(documentListeners.size, 0);
});

test('workspace persistence saves a recoverable snapshot without attachment bytes', async () => {
  const stored = new Map();
  const prefs = new Map();
  const context = {
    chrome: { storage: { local: {
      get: async key => ({ [key]:stored.get(key) }),
      set: async values => { for (const [key, value] of Object.entries(values)) stored.set(key, value); },
      remove: async key => { stored.delete(key); }
    } } },
    localStorage: {
      getItem: key => prefs.get(key) ?? null,
      setItem: (key, value) => prefs.set(key, value),
      removeItem: key => prefs.delete(key)
    },
    console
  };
  runInNewContext(source('workspace-persistence.js'), context);
  const persistence = context.NMDAWorkspacePersistence;
  const batch = {
    dataset:{ recordSets:[{ rows:[{ email:'a@example.com' }] }], sourceFiles:[{name:'source.csv',size:12}], embeddedFiles:[{ bytes:'secret' }], meta:{} },
    collectionIndex:0, collectionConfigs:new Map([[0,{name:'first'}]]), taskEdits:new Map(),
    formatGovernanceRules:[], formatGovernanceDraftRules:[], reviewSelected:new Set(['1']),
    duplicateSelections:new Map(), roster:{}, rosterPlanner:{}, scheduleRules:{weekdays:[1]}
  };
  await persistence.saveWorkspace(batch);
  const restored = await persistence.loadWorkspace();
  const hydrated = persistence.hydrate(restored);
  assert.equal(restored.dataset.recordSets[0].rows[0].email, 'a@example.com');
  assert.deepEqual(JSON.parse(JSON.stringify(restored.dataset.embeddedFiles)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.collectionConfigs)), [[0,{name:'first'}]]);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.reviewSelected)), ['1']);
  assert.equal(hydrated.collectionConfigs.get(0).name, 'first');
  assert.equal(hydrated.reviewSelected.has('1'), true);
  assert.equal(hydrated.attachmentPrepChoice, 'pending');
  persistence.writeHistoryMonths(100);
  assert.equal(persistence.readHistoryMonths(), 60);
  persistence.writeFollowUpPrefs({ delayDays:4, maxAttempts:2, composeMode:'reply' });
  assert.equal(persistence.readFollowUpPrefs().composeMode, 'reply');
  await persistence.saveWorkspace({ dataset:null });
  assert.equal(await persistence.loadWorkspace(), null);
});

test('mailbox operation ingestion rejects incomplete full reads before changing state', async () => {
  let result = { ok:true, sent:{complete:true,messages:[{id:'sent'}]}, drafts:{complete:false,messages:[]}, inbox:{complete:true,messages:[]} };
  let ingestions = 0;
  const context = {
    NMDAOperations: {
      ingestMailboxSnapshot: (store, sent, drafts, inbox, coverage) => {
        ingestions++;
        return { store:{...store, sent}, outboundRead:sent.length, coverage };
      },
      ingestMailboxDedupeSnapshot: () => { throw new Error('unexpected dedupe ingestion'); }
    },
    NMDAWorkspacePersistence:{ readHistoryMonths:() => 6 },
    chrome:{ runtime:{ sendMessage:async message => {
      assert.equal(message.type, 'NMDA_READ_MAILBOX_STATE');
      assert.equal(message.historyMonths, 6);
      return result;
    } } }
  };
  runInNewContext(source('mailbox-operations.js'), context);
  const mailbox = context.NMDAMailboxOperations;
  await assert.rejects(mailbox.readOperations({version:1}, 'full'), /完整邮箱快照未完成/);
  assert.equal(ingestions, 0);
  result = { ...result, drafts:{complete:true,messages:[]} };
  const applied = await mailbox.readOperations({version:1}, 'full');
  assert.equal(ingestions, 1);
  assert.equal(applied.store.sent[0].id, 'sent');
  assert.equal(applied.coverage.mode, 'full');
});
