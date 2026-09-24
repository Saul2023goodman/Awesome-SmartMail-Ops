(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = { loaded:false, active:false, busy:false, locked:false, draftBusy:false, formatInfo:'先加入邮件资料。', clearVersion:0,
    prep:{visible:false,rosterState:'pending',rosterText:'待确认',attachmentState:'pending',attachmentText:'待确认',manageText:'准备附件',buttonText:'补充资料'},
    inventory:{visible:false,summary:'',rows:[],containerNames:'',duplicateCount:0,embeddedCount:0,warnings:[]},
    status:{message:'还没有添加资料。',kind:''},
    preflight:{view:'files',reviewCount:0,taskCount:0},
    sourceUi:{counts:{mail:0,roster:0,attachment:0,review:0,ignored:0},filter:'',folder:'',total:0,folders:[],rows:[]} };
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
