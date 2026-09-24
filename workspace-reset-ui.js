(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = {open:false,confirmed:false,status:{visible:false,tone:'',message:''},actionLabel:'清除全部数据',actionDisabled:true};
  function publish(next) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  globalThis.NMDAWorkspaceResetUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
