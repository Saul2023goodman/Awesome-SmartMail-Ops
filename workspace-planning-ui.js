(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = { planning:{rounds:[],schoolRows:[],unscheduled:[]}, taskViews:new Map(), running:false, zoneText:'', overview:{schools:0,rounds:0,selected:0,ready:0,unscheduled:0,warnings:[],ruleSummary:'',showMailbox:false,lockedCount:null}, summary:{total:0,initial:0,followUp:0,selectedTotal:0,ready:0,scheduled:0,errors:0,done:0}, preflight:{facts:[],unscheduled:0,attachmentless:0,ready:0} };
  function publish(next) { snapshot = next; for (const listener of listeners) listener(); }
  globalThis.NMDAWorkspacePlanningUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
