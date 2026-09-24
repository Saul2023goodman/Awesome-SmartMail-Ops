(() => {
  'use strict';

  // The review controller publishes a view model after task decisions change.
  // React owns the board DOM; the controller no longer replaces its children.
  const listeners = new Set();
  let snapshot = { items:[], total:0, filter:'all', activeKey:'', limit:0 };
  const previewListeners = new Set();
  let previewSnapshot = { items:[], total:0, filter:'all', activeKey:'', preserveScroll:false };
  const controlsListeners = new Set();
  let controlsSnapshot = {
    count:0, pending:0, counts:{all:0,auto:0,pending:0,confirmed:0},
    filter:'all', search:'', emptyHint:'', nextMode:'next', nextLabel:'下一个需处理',nextDisabled:false,
    trash:[], batchLaunch:{empty:true,subjectCount:0,queuedCount:0,meta:'导入邮件后可用',title:'准备好邮件后可使用批量处理'},
    selectedCount:0,batchbarVisible:false,selectVisibleCount:0,selectVisibleHidden:true,allVisibleSelected:false,
    surface:'board',previewMeta:'逐封核对 · 可直接编辑当前邮件'
  };
  function publish(next) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function publishPreview(next) {
    previewSnapshot = next;
    for (const listener of previewListeners) listener();
  }
  function publishControls(patch) {
    controlsSnapshot = { ...controlsSnapshot, ...patch };
    for (const listener of controlsListeners) listener();
  }
  globalThis.NMDAWorkspaceReviewBoard = {
    publish,
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publishPreview,
    getPreviewSnapshot:() => previewSnapshot,
    subscribePreview(listener) { previewListeners.add(listener); return () => previewListeners.delete(listener); },
    publishControls,
    getControlsSnapshot:() => controlsSnapshot,
    subscribeControls(listener) { controlsListeners.add(listener); return () => controlsListeners.delete(listener); }
  };
})();
