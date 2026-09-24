(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = {
    activeView:'home',
    draftAttachmentSummary:'读取草稿箱',
    draftAttachment:{
      draftsCount:0,withAttachments:0,versionCount:0,selectedCount:0,
      groups:[],selectedKey:'',selectedName:'',selectedCopy:'选择后会显示受影响的全部草稿。',
      targets:[],allSelected:false,replacementName:'选择新版附件',replacementMeta:'只需选择一次；每封邮件都会先核对新草稿，再替换旧草稿。',
      loading:false,running:false,stopping:false,cancelRequested:false,runLabel:'更新选中的草稿',
      result:{message:'',tone:'ok'},progress:{message:'',tone:''},
      motion:{visible:false,phase:'read',title:'准备附件更新',count:'0 / 0',oldName:'旧附件',newName:'新版附件',subject:'等待开始',message:'开始后会切换到 163 邮箱，并同步显示当前进度。',stages:[]}
    }
  };
  function publish(next) { snapshot = next; for (const listener of listeners) listener(); }
  globalThis.NMDAWorkspaceUtilityUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
