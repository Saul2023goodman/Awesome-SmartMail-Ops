(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = { loaded:false, active:false, busy:false, locked:false, draftBusy:false, formatInfo:'先加入邮件资料。', clearVersion:0 };
  function publishPatch(patch) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  globalThis.NMDAWorkspaceImportUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publishPatch
  };
})();
