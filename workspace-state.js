(() => {
  'use strict';

  const Operations = globalThis.NMDAOperations;
  const Runtime = globalThis.NMDAWorkspaceRuntime;
  const Persistence = globalThis.NMDAWorkspacePersistence;
  const Importer = globalThis.NMDAImporter;
  const Scheduler = globalThis.NMDAScheduler;
  const RosterPlanner = globalThis.NMDARosterPlanner;
  const accountListeners = new Set();
  const changeListeners = new Set();
  let version = 0;
  function changed() {
    ++version;
    for (const listener of changeListeners) listener();
  }

  function withFollowUpPrefs(store) {
    const prefs = Persistence.readFollowUpPrefs(Operations.DEFAULT_FOLLOWUP_POLICY);
    const result = Operations.setFollowUpPolicy(store, '', prefs);
    if (prefs.templateVersion > 0) result.store.followUpPolicies.default.templateVersion = prefs.templateVersion;
    return result.store;
  }

  const operations = {
    account:'',
    store:withFollowUpPrefs(Operations.createStore('default')),
    loaded:false
  };

  function emptyRosterState(overrides = {}) {
    return {
      dataset:null, datasets:[], entries:[], manualEntries:[], routedEntries:[],
      audit:null, warnings:[], manualWarnings:[], routedWarnings:[],
      enabled:true, autoSchool:true, strict:false,
      sourceNames:[], manualSourceNames:[], routedSourceNames:[], ...overrides
    };
  }

  function freshScheduleRules() {
    const prefs = Scheduler.normalizeRules({ ...Persistence.readScheduleRules(), startAt:'' });
    const timeZone = prefs.timeZone || 'system';
    return Scheduler.normalizeRules({
      ...Scheduler.DEFAULT_RULES,
      ...prefs,
      startDate:prefs.startDate || Scheduler.defaultStartDate(new Date(), timeZone),
      localTime:prefs.localTime || Scheduler.defaultLocalTime()
    });
  }

  const batch = {
    dataset:null, collectionIndex:0, collectionConfigs:new Map(), detection:null, mapping:{}, tasks:[],
    directoryFiles:[], taskFiles:[], routedAttachmentFiles:[], fileIndex:Importer.buildFileIndex([]),
    attachmentOverrides:new Map(), attachmentPolicies:new Map(), attachmentTargetEditing:'', attachmentTargetSearch:'', taskEdits:new Map(),
    running:false, stopRequested:false, pauseEveryTime:false, composeParagraphSpacing:true, fastCompose:false,
    importMeta:null, sessionId:0, importBusy:false, schedulePlan:null,
    existingScheduleAnchors:[], existingScheduleReadAt:'', existingScheduleStatus:'idle', existingScheduleError:'',
    scheduleRules:{ ...Scheduler.DEFAULT_RULES, startDate:Scheduler.defaultStartDate(new Date(), 'system'), localTime:Scheduler.defaultLocalTime() },
    roster:emptyRosterState(), rosterPlanner:RosterPlanner.createState(), rosterPlannerOpen:false, duplicateAudit:null,
    handoffComplete:false, autoAdvancing:false, reviewFilter:'all', reviewSearch:'', reviewSelected:new Set(), reviewSurface:'board',
    reviewPreviewKey:'', reviewEditingKey:'', duplicateSelections:new Map(), attachmentAttentionShown:false,
    rosterPromptChoice:'idle', attachmentPromptDeferred:false, attachmentPrepChoice:'idle', supplementPreflightDone:false,
    supplementPreflightOpen:false, preflightView:'files', supportView:'roster', attachmentManagerOpen:false,
    uiStep:1, planningView:'mails', reviewReturnStep:2, sourceInspectName:'', preflightFolderPath:'', preflightSearch:'',
    preflightReviewOnly:false, preflightPurposeFilter:'', ignoredAttachmentIdentities:new Set(),
    formatGovernanceRules:[], formatGovernanceDraftRules:[]
  };

  function rosterState() {
    return batch.roster;
  }

  let saveTimer = 0;
  let restoring = false;
  let writeTail = Promise.resolve();
  function enqueueWrite(write) {
    const next = writeTail.catch(() => {}).then(write);
    writeTail = next;
    return next;
  }
  async function persistNow() {
    if (restoring) return;
    try { await enqueueWrite(() => Persistence.saveWorkspace(batch)); }
    catch (error) { console.warn('Workspace persistence failed', error); }
  }
  function schedulePersist() {
    if (restoring) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      void persistNow();
    }, 220);
  }
  async function restoreBatch() {
    restoring = true;
    try {
      const saved = await Persistence.loadWorkspace();
      if (!saved) { restoring = false; return false; }
      const restored = Persistence.hydrate(saved);
      Object.assign(batch, restored);
      batch.roster = restored.roster ? { ...emptyRosterState(), ...restored.roster } : emptyRosterState();
      batch.rosterPlanner = RosterPlanner.createState(restored.rosterPlanner);
      batch.scheduleRules = restored.scheduleRules ? { ...freshScheduleRules(), ...restored.scheduleRules } : freshScheduleRules();
      batch.directoryFiles = []; batch.taskFiles = []; batch.routedAttachmentFiles = [];
      batch.attachmentOverrides.clear(); batch.attachmentPolicies = new Map();
      batch.fileIndex = Importer.buildFileIndex([]);
      changed();
      return true;
    } catch (error) { restoring = false; throw error; }
  }
  function finishRestore() { restoring = false; }
  async function clearWorkspace() {
    if (restoring) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    await enqueueWrite(() => Persistence.clearWorkspace());
  }

  async function detectAccount() {
    try {
      const result = await Runtime.accountInfo();
      if (result?.ok && result.uid) return Operations.normalizeEmail(result.uid) || String(result.uid).toLowerCase();
    } catch (error) {
      console.warn('Mailbox account lookup failed; using session default', error);
    }
    return 'default';
  }

  function resetOperations(account = 'default') {
    const previous = operations.account;
    operations.account = account;
    operations.store = withFollowUpPrefs(Operations.createStore(account));
    operations.loaded = true;
    changed();
    if (previous !== account) for (const listener of accountListeners) listener(account);
    return operations;
  }

  async function ensureOperations(force = false) {
    const account = await detectAccount();
    if (force || !operations.loaded || operations.account !== account) resetOperations(account);
    return operations;
  }

  function setStore(store) {
    operations.store = store;
    changed();
    return store;
  }

  globalThis.NMDAWorkspaceState = Object.freeze({
    operations, batch, emptyRosterState, rosterState, freshScheduleRules,
    persistNow, schedulePersist, restoreBatch, finishRestore, clearWorkspace,
    detectAccount, ensureOperations, resetOperations, setStore,
    changed,
    subscribe(listener) { changeListeners.add(listener); return () => changeListeners.delete(listener); },
    getVersion:() => version,
    onAccountChange(listener) { accountListeners.add(listener); return () => accountListeners.delete(listener); }
  });
})();
