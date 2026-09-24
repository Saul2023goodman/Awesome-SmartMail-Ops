(() => {
  'use strict';

  // The review controller publishes a view model after task decisions change.
  // React owns the board DOM; the controller no longer replaces its children.
  const listeners = new Set();
  let snapshot = { items:[], total:0, filter:'all', activeKey:'', limit:0 };
  const previewListeners = new Set();
  let previewSnapshot = { items:[], total:0, filter:'all', activeKey:'', preserveScroll:false };
  function publish(next) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function publishPreview(next) {
    previewSnapshot = next;
    for (const listener of previewListeners) listener();
  }
  globalThis.NMDAWorkspaceReviewBoard = {
    publish,
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publishPreview,
    getPreviewSnapshot:() => previewSnapshot,
    subscribePreview(listener) { previewListeners.add(listener); return () => previewListeners.delete(listener); }
  };
})();
