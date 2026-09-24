(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = {
    locked:false,
    controls:{timeZone:'system',startDate:'',localTime:'07:30',maxPerGroupPerRound:'1',sameGroupIntervalDays:'7',weekdays:[4],skipStart:'',skipEnd:'',preserveExisting:true,includeMailboxScheduled:true,skipHolidays:true},
    guide:['is-warning','','is-active'],
    summary:{selected:0,unscheduled:0,protected:0,showExternal:false,external:0,conflicts:[]},
    outcome:{tone:'neutral',marker:'→',lead:'先完成发送窗口',headline:'地区、开始日期、工作日和当地时间',detail:'完成后这里会直接告诉你将安排多少封、覆盖多少个发送日。'},
    prioritySummary:'未设置时按现有名单顺序排期。',priorityLabel:'设置优先级',priorityDisabled:false,priorityTitle:'',
    rulePreview:'周四 · 07:30 当地时间 · 同校至少间隔 7 天 · 每校每个发送日最多 1 位。',
    applyDisabled:false,applyLabel:'生成本批时间',applyHint:'按上方规则自动安排',clearDisabled:true,toast:null
  };
  function publish(next) { snapshot=next; for(const listener of listeners)listener(); }
  globalThis.NMDAWorkspaceScheduleUi={
    getSnapshot:()=>snapshot,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    publish,
    publishPatch(patch){publish({...snapshot,...patch});}
  };
})();
