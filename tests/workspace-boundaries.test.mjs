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
  runInNewContext(source('workspace-runtime.js'), context);
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
  assert.equal(runtimeListeners.size, 1); // the runtime boundary remains the sole Chrome listener
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
    NMDAWorkspaceRuntime:{ readMailboxState:async (mode, historyMonths) => {
      assert.equal(mode, 'full');
      assert.equal(historyMonths, 6);
      return result;
    } }
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

test('mailbox sync owns freshness, store updates, and reset without a view', async () => {
  const cues = [];
  let reads = 0;
  const context = {
    NMDAWorkspaceRuntime:{ connectionStatus:async () => ({connected:true,authenticated:true}) },
    NMDAConnection:{
      setSyncCue:(state, detail) => cues.push({state,detail}),
      subscribe:() => () => {},
      getSnapshot:() => ({status:null,error:''})
    },
    NMDAMailboxOperations:{
      readOperations:async store => ({store:{...store,reads:++reads},outboundRead:1,draftsRead:0,inboxRead:0}),
      readDedupeHistory:async () => { throw new Error('unexpected history read'); }
    },
    NMDAWorkspaceState:{
      operations:{store:{reads:0}},
      ensureOperations:async () => {},
      setStore(store) { this.operations.store = store; }
    },
    NMDAWorkspacePersistence:{readHistoryMonths:() => 0},
    console, queueMicrotask, setTimeout:() => 0
  };
  runInNewContext(source('workspace-mailbox-sync.js'), context);
  const sync = context.NMDAWorkspaceMailboxSync;
  let applied = 0;
  sync.onApplied(() => { applied++; });
  await sync.request('quick');
  assert.equal(context.NMDAWorkspaceState.operations.store.reads, 1);
  assert.equal(await sync.request('quick'), null);
  assert.equal(reads, 1);
  sync.invalidate();
  await sync.request('quick');
  assert.equal(reads, 2);
  assert.equal(applied, 2);
  await sync.reset();
  assert.equal(cues.at(-1).state, 'idle');
});

test('mailbox sync accepts an account found by its own read and discards an older account result', async () => {
  let accountChanged;
  let finishRead;
  let reads = 0;
  const state = {
    operations:{account:'',store:{account:''}},
    async ensureOperations() {
      if (!this.operations.account) {
        this.operations.account = 'first@example.com';
        this.operations.store = {account:'first@example.com'};
        accountChanged();
      }
    },
    setStore(store) { this.operations.store = store; },
    onAccountChange(listener) { accountChanged = listener; return () => {}; }
  };
  const context = {
    NMDAWorkspaceRuntime:{connectionStatus:async () => ({connected:true,authenticated:true})},
    NMDAConnection:{setSyncCue:() => {},subscribe:() => () => {},getSnapshot:() => ({status:null})},
    NMDAMailboxOperations:{
      readOperations:async store => {
        reads++;
        if (reads === 1) return {store:{...store,applied:true}};
        return new Promise(resolve => { finishRead = () => resolve({store:{...store,applied:true}}); });
      }
    },
    NMDAWorkspaceState:state,
    NMDAWorkspacePersistence:{readHistoryMonths:() => 0},
    console, queueMicrotask, setTimeout:() => 0
  };
  runInNewContext(source('workspace-mailbox-sync.js'), context);
  const sync = context.NMDAWorkspaceMailboxSync;
  sync.start();
  await sync.request('quick');
  assert.equal(state.operations.store.applied, true);
  const pending = sync.request('quick', {force:true});
  for (let i = 0; i < 10 && !finishRead; i++) await Promise.resolve();
  assert.equal(typeof finishRead, 'function');
  state.operations.account = 'second@example.com';
  state.operations.store = {account:'second@example.com'};
  accountChanged();
  finishRead();
  assert.equal(await pending, null);
  assert.equal(state.operations.store.account, 'second@example.com');
});

test('state owner restores batch data and keeps persistence paused through view hydration', async () => {
  let saved = 0;
  const context = {
    NMDAOperations:{
      DEFAULT_FOLLOWUP_POLICY:{delayDays:7,maxAttempts:2,composeMode:'forward'},
      createStore:account => ({account,followUpPolicies:{default:{}}}),
      setFollowUpPolicy:(store, key, prefs) => ({store:{...store,followUpPolicies:{default:prefs}}}),
      normalizeEmail:value => value.toLowerCase()
    },
    NMDAWorkspaceRuntime:{accountInfo:async () => ({ok:true,uid:'USER@example.com'})},
    NMDAWorkspacePersistence:{
      readFollowUpPrefs:() => ({delayDays:7,maxAttempts:2,composeMode:'forward'}),
      readScheduleRules:() => ({}),
      loadWorkspace:async () => ({dataset:{recordSets:[{rows:[['email'],['a@example.com']]}],meta:{}},collectionIndex:0}),
      hydrate:snapshot => ({dataset:snapshot.dataset,roster:null,rosterPlanner:null,scheduleRules:null,collectionIndex:0}),
      saveWorkspace:async () => {saved++;},
      clearWorkspace:async () => {}
    },
    NMDAImporter:{buildFileIndex:() => ({files:[]})},
    NMDAScheduler:{
      DEFAULT_RULES:{weekdays:[4],localTime:'07:30',timeZone:'system'},
      defaultStartDate:() => '2026-09-23', defaultLocalTime:() => '07:30',
      normalizeRules:rules => ({weekdays:[4],localTime:'07:30',timeZone:'system',...rules})
    },
    NMDARosterPlanner:{createState:() => ({version:1})},
    console, setTimeout, clearTimeout
  };
  runInNewContext(source('workspace-state.js'), context);
  const state = context.NMDAWorkspaceState;
  await state.ensureOperations();
  assert.equal(state.operations.account, 'user@example.com');
  assert.equal(await state.restoreBatch(), true);
  assert.equal(state.batch.dataset.recordSets[0].rows.length, 2);
  await state.persistNow();
  assert.equal(saved, 0);
  state.finishRestore();
  await state.persistNow();
  assert.equal(saved, 1);
});

test('import and monitor domain calculations work without UI or runtime APIs', () => {
  const imports = {
    NMDAImporter:{fileIdentity:file => file.name},
    NMDAImportCore:{normalizeHeader:value => String(value).toLowerCase()}
  };
  runInNewContext(source('import-domain.js'), imports);
  const first = {recordSets:[{source:'a',name:'one',rows:[['email'],['a@example.com']]}],sourceFiles:[{name:'one.csv'}],warnings:[]};
  const second = {recordSets:[{source:'b',name:'two',rows:[['email'],['b@example.com']]}],sourceFiles:[{name:'one.csv'},{name:'two.csv'}],warnings:['notice']};
  const merged = imports.NMDAImportDomain.mergeImportedDatasets(first, second);
  assert.equal(merged.recordSets.length, 2);
  assert.equal(merged.sourceFiles.length, 2);
  assert.equal(merged.warnings[0], 'notice');
  const draft = imports.NMDAImportDomain.mailboxDraftDataset({drafts:[{id:'d1',recipients:'a@example.com',subject:'Hello',body:'Body'}],complete:true});
  assert.equal(draft.recordSets[0].rows[1][0], 'd1');

  const monitor = {
    NMDAOperations:{
      DEFAULT_FOLLOWUP_POLICY:{delayDays:7,maxAttempts:2},
      isEffectiveReplyObservation:reply => reply.kind === 'human',
      formatDisplayTime:value => value,
      timeMs:() => 0,
      normalizeEmail:value => String(value).toLowerCase(),
      parseRecipients:() => [],
      monitoringRoots:() => []
    },
    NMDAWorkspaceState:{operations:{account:'me@example.com',loaded:true,store:{}},batch:{roster:{entries:[]},tasks:[]}}
  };
  runInNewContext(source('monitor-domain.js'), monitor);
  const group = {outbounds:[{sentAt:'yesterday'}],replies:[{kind:'human'}],eligibility:{}};
  assert.equal(monitor.NMDAMonitorDomain.monitorGroupState(group).key, 'replied');
  assert.equal(monitor.NMDAMonitorDomain.monitorDecisionPath(group)[1].value, '有');
});

test('runtime boundary preserves typed command payloads and routes events', async () => {
  const sent = [];
  let onMessage;
  const context = {
    chrome:{runtime:{
      onMessage:{addListener:listener => {onMessage = listener;}},
      sendMessage:async message => {sent.push(message); return {ok:true};},
      connect:() => ({name:'file-source'})
    }},
    console
  };
  runInNewContext(source('workspace-runtime.js'), context);
  const runtime = context.NMDAWorkspaceRuntime;
  await runtime.monitorAttachment({focus:true,payload:{action:'start',executionId:'x'}});
  await runtime.mutateAttachment({executionId:'x',draftId:'d1'});
  assert.equal(sent[0].type, 'NMDA_DRAFT_ATTACHMENT_MONITOR');
  assert.equal(sent[0].payload.action, 'start');
  assert.equal(sent[1].type, 'NMDA_DRAFT_ATTACHMENT_MUTATE');
  assert.equal(sent[1].draftId, 'd1');
  let events = 0;
  const unsubscribe = runtime.subscribe('NMDA_BATCH_STOP_BROADCAST', () => {events++;});
  onMessage({type:'NMDA_BATCH_STOP_BROADCAST'});
  unsubscribe();
  onMessage({type:'NMDA_BATCH_STOP_BROADCAST'});
  assert.equal(events, 1);
});

test('execution service constructs the canonical draft request without view state', async () => {
  let submitted;
  const context = {
    NMDAImporter:{fileIdentity:file => file.name},
    NMDAWorkspaceRuntime:{
      subscribe:() => () => {},
      connectionStatus:async () => ({connected:true,authenticated:true}),
      executeDraft:async payload => {submitted = payload; return {ok:true,outcome:{id:'draft-1'}};}
    },
    crypto:{randomUUID:() => 'execution-1'},
    setTimeout,
    btoa,
    console
  };
  runInNewContext(source('workspace-execution.js'), context);
  const outcome = await context.NMDAWorkspaceExecution.executeDraftRemotely(
    {recipients:'a@example.com',subject:'Hello',body:'Body',scheduleAt:'2026-10-01T07:30',files:[]},
    {scheduleDisplayAt:'2026-10-01 07:30',scheduleTimeZoneLabel:'本机时间'}
  );
  assert.equal(outcome.id, 'draft-1');
  assert.equal(submitted.executionId, 'execution-1');
  assert.equal(submitted.task.scheduleDisplayAt, '2026-10-01 07:30');
  assert.equal(submitted.task.scheduleTimeZoneLabel, '本机时间');
});

test('follow-up service validates and saves templates through state and persistence', async () => {
  let persisted;
  let refreshed = 0;
  const policy = { delayDays:7, maxAttempts:2, composeMode:'forward', templateBody:'Old body' };
  const state = {
    operations:{store:{followUpPolicies:{default:policy},derivedTasks:{one:{kind:'follow_up',state:'draft',templateManaged:true}}}},
    batch:{tasks:[]},
    ensureOperations:async () => {},
    setStore(store) { this.operations.store = store; }
  };
  const context = {
    NMDAOperations:{
      DEFAULT_FOLLOWUP_POLICY:policy,
      setFollowUpPolicy:(store, _root, patch) => ({store:{...store,followUpPolicies:{default:{...store.followUpPolicies.default,...patch}}}}),
      refreshTemplateManagedFollowUps:store => { refreshed++; return {store,refreshed:[{id:'one'}],skipped:[]}; },
      policyForRoot:store => store.followUpPolicies.default
    },
    NMDAWorkspaceRuntime:{},
    NMDAWorkspaceState:state,
    NMDAWorkspacePersistence:{writeFollowUpPrefs:value => {persisted = value;}},
    NMDAWorkspaceMailboxSync:{}
  };
  runInNewContext(source('workspace-followup.js'), context);
  const followUp = context.NMDAWorkspaceFollowUp;
  assert.equal(followUp.validateTemplateBody('Dear Professor,\nBody').valid, false);
  assert.equal(followUp.templateState('New body').syncable.length, 1);
  const result = await followUp.saveTemplate('New body', true);
  assert.equal(result.refreshedCount, 1);
  assert.equal(refreshed, 1);
  assert.equal(state.operations.store.followUpPolicies.default.templateBody, 'New body');
  assert.equal(persisted.templateBody, 'New body');
});

test('workspace navigation publishes tab and review count without the DOM', () => {
  const context = {};
  runInNewContext(source('workspace-navigation.js'), context);
  const navigation = context.NMDAWorkspaceNavigation;
  let updates = 0;
  const unsubscribe = navigation.subscribe(() => { updates++; });
  navigation.setTab('review');
  navigation.setReviewCount(4);
  assert.equal(navigation.getSnapshot().tab, 'review');
  assert.equal(navigation.getSnapshot().reviewCount, 4);
  assert.equal(updates, 2);
  assert.throws(() => navigation.setTab('missing'), /Unknown workspace tab/);
  unsubscribe();
  navigation.setTab('batch');
  assert.equal(updates, 2);
});
