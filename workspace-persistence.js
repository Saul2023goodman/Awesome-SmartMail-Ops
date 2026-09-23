(() => {
  'use strict';

  const WORKSPACE_KEY = 'nmda.workspace.v2';
  const HISTORY_MONTHS_KEY = 'nmda.mailbox.historyMonths';
  const FOLLOWUP_PREFS_KEY = 'nmda.followup.settings.v1';

  function plainClone(value) {
    return JSON.parse(JSON.stringify(value, (key, item) => {
      if (typeof File !== 'undefined' && item instanceof File) return { __nmdaFileMeta:true, ...fileMeta(item) };
      if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined;
      if (item instanceof Map) return { __nmdaMap:true, entries:[...item.entries()] };
      if (item instanceof Set) return { __nmdaSet:true, values:[...item.values()] };
      return item;
    }));
  }

  function fileMeta(file) {
    return {
      name:String(file?.name || file?.webkitRelativePath || file?._nmdaPath || '未命名来源'),
      size:Number(file?.size || 0),
      type:String(file?.type || ''),
      lastModified:Number(file?.lastModified || 0),
      _nmdaPath:String(file?._nmdaPath || file?.webkitRelativePath || file?.name || '')
    };
  }

  function serializableDataset(dataset) {
    if (!dataset) return null;
    const sets = plainClone(dataset.recordSets || dataset.sheets || []);
    const meta = plainClone(dataset.meta || {});
    if (Array.isArray(meta.containerFiles)) meta.containerFiles = meta.containerFiles.map(fileMeta);
    return {
      ...plainClone(dataset),
      recordSets:sets,
      sheets:sets,
      sourceFiles:(dataset.sourceFiles || []).map(fileMeta),
      // File bytes are intentionally never stored; attachments must be reselected.
      embeddedFiles:[],
      meta
    };
  }

  function snapshot(batch) {
    if (!batch.dataset) return null;
    return {
      version:2,
      savedAt:new Date().toISOString(),
      dataset:serializableDataset(batch.dataset),
      collectionIndex:Number(batch.collectionIndex || 0),
      collectionConfigs:plainClone([...batch.collectionConfigs.entries()]),
      taskEdits:plainClone([...batch.taskEdits.entries()]),
      formatGovernanceRules:plainClone(batch.formatGovernanceRules || []),
      formatGovernanceDraftRules:plainClone(batch.formatGovernanceDraftRules || []),
      reviewSelected:[...batch.reviewSelected],
      duplicateSelections:plainClone([...batch.duplicateSelections.entries()]),
      handoffComplete:!!batch.handoffComplete,
      reviewFilter:String(batch.reviewFilter || 'all'),
      reviewSearch:String(batch.reviewSearch || ''),
      roster:plainClone(batch.roster),
      rosterPlanner:plainClone(batch.rosterPlanner),
      supplementPreflightDone:!!batch.supplementPreflightDone,
      rosterPromptChoice:String(batch.rosterPromptChoice || 'idle'),
      attachmentPrepChoice:String(batch.attachmentPrepChoice || 'idle'),
      scheduleRules:plainClone(batch.scheduleRules),
      planningView:String(batch.planningView || 'mails')
    };
  }

  async function saveWorkspace(batch) {
    const saved = snapshot(batch);
    if (saved) await chrome.storage.local.set({ [WORKSPACE_KEY]:saved });
    else await chrome.storage.local.remove(WORKSPACE_KEY);
  }

  async function loadWorkspace() {
    const result = await chrome.storage.local.get(WORKSPACE_KEY);
    const saved = result?.[WORKSPACE_KEY];
    return saved?.version === 2 && Array.isArray(saved?.dataset?.recordSets) && saved.dataset.recordSets.length
      ? saved : null;
  }

  function hydrate(saved) {
    if (!saved?.dataset?.recordSets?.length) throw new Error('Workspace snapshot has no record sets');
    const sets = saved.dataset.recordSets;
    const dataset = { ...saved.dataset, recordSets:sets, sheets:sets, embeddedFiles:[] };
    const index = Number(saved.collectionIndex);
    return {
      dataset,
      importMeta:dataset.meta || null,
      collectionIndex:Number.isFinite(index) ? Math.max(0, Math.min(Math.floor(index), sets.length - 1)) : 0,
      collectionConfigs:new Map(Array.isArray(saved.collectionConfigs) ? saved.collectionConfigs : []),
      taskEdits:new Map(Array.isArray(saved.taskEdits) ? saved.taskEdits : []),
      formatGovernanceRules:Array.isArray(saved.formatGovernanceRules) ? saved.formatGovernanceRules : [],
      formatGovernanceDraftRules:Array.isArray(saved.formatGovernanceDraftRules) ? saved.formatGovernanceDraftRules : [],
      reviewSelected:new Set(Array.isArray(saved.reviewSelected) ? saved.reviewSelected : []),
      duplicateSelections:new Map(Array.isArray(saved.duplicateSelections) ? saved.duplicateSelections : []),
      handoffComplete:!!saved.handoffComplete,
      reviewFilter:String(saved.reviewFilter || 'all'),
      reviewSearch:String(saved.reviewSearch || ''),
      roster:saved.roster || null,
      rosterPlanner:saved.rosterPlanner || null,
      supplementPreflightDone:!!saved.supplementPreflightDone,
      rosterPromptChoice:String(saved.rosterPromptChoice || 'pending'),
      attachmentPrepChoice:'pending',
      scheduleRules:saved.scheduleRules || null,
      planningView:String(saved.planningView || 'mails')
    };
  }

  async function clearWorkspace() { await chrome.storage.local.remove(WORKSPACE_KEY); }

  function readHistoryMonths() {
    try {
      const raw = localStorage.getItem(HISTORY_MONTHS_KEY);
      if (raw == null || raw === '') return 0;
      const value = Math.floor(Number(raw));
      return Number.isFinite(value) ? Math.max(0, Math.min(60, value)) : 0;
    } catch (error) {
      console.warn('Mailbox history preference unavailable', error);
      return 0;
    }
  }

  function writeHistoryMonths(value) {
    const months = Math.max(0, Math.min(60, Math.floor(Number(value) || 0)));
    try { localStorage.setItem(HISTORY_MONTHS_KEY, String(months)); }
    catch (error) { console.warn('Mailbox history preference could not be saved', error); }
    return months;
  }

  function readFollowUpPrefs(defaults = {}) {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(FOLLOWUP_PREFS_KEY) || '{}'); }
    catch (error) {
      console.warn('Follow-up preferences invalid; using defaults', error);
      raw = {};
    }
    return {
      delayDays:Math.max(0, Number(raw.delayDays ?? defaults.delayDays ?? 7) || 0),
      maxAttempts:Math.max(0, Math.floor(Number(raw.maxAttempts ?? defaults.maxAttempts ?? 2) || 0)),
      composeMode:['forward','reply','new'].includes(raw.composeMode) ? raw.composeMode : (defaults.composeMode || 'forward'),
      templateBody:String(raw.templateBody || '').replace(/\r\n?/g, '\n').trim(),
      templateVersion:Math.max(0, Math.floor(Number(raw.templateVersion || 0) || 0))
    };
  }

  function writeFollowUpPrefs(policy) {
    if (!policy) return;
    try {
      localStorage.setItem(FOLLOWUP_PREFS_KEY, JSON.stringify({
        delayDays:Number(policy.delayDays || 0), maxAttempts:Number(policy.maxAttempts || 0),
        composeMode:String(policy.composeMode || 'forward'), templateBody:String(policy.templateBody || ''),
        templateVersion:Number(policy.templateVersion || 0)
      }));
    } catch (error) { console.warn('Follow-up preferences could not be saved', error); }
  }

  function clearPreferences() {
    try {
      localStorage.removeItem(HISTORY_MONTHS_KEY);
      localStorage.removeItem(FOLLOWUP_PREFS_KEY);
    } catch (error) { console.warn('Workspace preferences could not be cleared', error); }
  }

  globalThis.NMDAWorkspacePersistence = Object.freeze({
    snapshot, hydrate, saveWorkspace, loadWorkspace, clearWorkspace,
    readHistoryMonths, writeHistoryMonths,
    readFollowUpPrefs, writeFollowUpPrefs, clearPreferences
  });
})();
