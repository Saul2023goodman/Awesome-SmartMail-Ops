(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = {visible:false,title:'快速设置时间',presets:[],showNative:true,position:{left:12,top:12,width:330}};
  function publish(next) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  globalThis.NMDAWorkspaceSmartTemporalUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
