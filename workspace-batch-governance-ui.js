(() => {
  'use strict';
  const listeners = new Set();
  let snapshot = {
    open:false,
    customOpen:false,
    phrase:'',
    formats:['italic'],
    caseSensitive:true,
    subjectValue:'',
    subjectFocusToken:0,
    subject:{count:0,badge:'完整',suggestionVisible:false,suggestionLabel:'',suggestionTitle:'',disabled:true,resultTitle:'主题完整',resultCopy:'当前所有初始邮件均已有主题。'},
    formatCount:0,
    entryCount:0,
    entryTitle:'当前批次未发现待处理的确定性批量事项',
    suggestions:[],
    suggestionSummary:'',
    queue:{visible:false,count:0,affected:0,rules:[]},
    history:[],
    analysis:{headline:'',copy:'输入固定文本后检查命中范围。',rows:[],moreCount:0,addDisabled:true,addLabel:'加入本次处理'},
    planSummary:'尚未配置可执行批量处理',
    apply:{disabled:true,busy:false,label:'应用批量处理'}
  };
  function publish(next) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  globalThis.NMDAWorkspaceBatchGovernanceUi = {
    getSnapshot:() => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    publishPatch(patch) { publish({ ...snapshot, ...patch }); }
  };
})();
