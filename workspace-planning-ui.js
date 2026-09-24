(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = { planning:{rounds:[],schoolRows:[],unscheduled:[]}, taskViews:new Map(), running:false, zoneText:'', overview:{schools:0,rounds:0,selected:0,ready:0,unscheduled:0,warnings:[],ruleSummary:'',showMailbox:false,lockedCount:null}, summary:{total:0,initial:0,followUp:0,selectedTotal:0,ready:0,scheduled:0,errors:0,done:0}, preflight:{facts:[],unscheduled:0,attachmentless:0,ready:0}, rosterPlanner:{visible:false,returnToSchedule:false,selection:null,selectionView:{label:'尚未选择',detail:'可选：新建 R1/R2… 后按颜色 / 特征选择或直接框选联系人加入；也可以跳过。',canAdd:false,canClear:false,activeBatch:'',activeState:'empty'},sources:[],selectedSourceKey:'',features:[],featureEmptyText:'没有名单特征可选择',batches:[],batchSummary:{empty:true,assigned:0,unassigned:0,text:'没有总名单时仍可直接使用时间安排。'},table:{columns:[],rows:[],empty:true,emptyText:'未找到总名单'},summary:{empty:true,text:'等待读取总名单…'},columnToggle:{visible:false,pressed:false,label:'显示全部列',focus:'正在整理名单…',title:''}} };
  function publish(next) { snapshot = next; for (const listener of listeners) listener(); }
  globalThis.NMDAWorkspacePlanningUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
