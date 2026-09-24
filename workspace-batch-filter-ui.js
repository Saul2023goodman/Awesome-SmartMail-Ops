(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = {query:'',locked:false};
  function publish(next) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  globalThis.NMDAWorkspaceBatchFilterUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
