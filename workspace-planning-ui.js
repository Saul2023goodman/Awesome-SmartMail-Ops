(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = { planning:{rounds:[],schoolRows:[],unscheduled:[]}, taskViews:new Map(), running:false, zoneText:'' };
  globalThis.NMDAWorkspacePlanningUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish(next) { snapshot = next; for (const listener of listeners) listener(); }
  };
})();
