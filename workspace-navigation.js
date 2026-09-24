(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = Object.freeze({ tab:'batch', reviewCount:0 });
  function publish(patch) {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }
  globalThis.NMDAWorkspaceNavigation = Object.freeze({
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setTab(tab) {
      if (!['batch','review','dispatch','dashboard','utilities'].includes(tab)) throw new Error(`Unknown workspace tab: ${tab}`);
      if (tab !== snapshot.tab) publish({ tab });
    },
    setReviewCount(count) {
      const next = Math.max(0, Math.floor(Number(count) || 0));
      if (next !== snapshot.reviewCount) publish({ reviewCount:next });
    }
  });
})();
