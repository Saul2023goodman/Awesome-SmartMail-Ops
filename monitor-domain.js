(() => {
  'use strict';

  const Operations = globalThis.NMDAOperations;
  const State = globalThis.NMDAWorkspaceState;
  const operationState = State.operations;
  const batch = State.batch;

function monitorRecipientText(record) {
    return (record?.recipients || []).map(item => item.name ? `${item.name} <${item.email}>` : item.email).filter(Boolean).join('; ');
  }

function monitorGroupState(group) {
    const activeTask=[...(group.tasks||[])].reverse().find(task=>!['sent','cancelled'].includes(task.state)) || null;
    const scheduledDraft=(group.scheduledFollowUpDrafts||[])[0] || group.eligibility?.scheduledDraft || null;
    const effectiveReply=[...(group.replies||[])].reverse().find(item=>Operations.isEffectiveReplyObservation(item)) || group.humanReply || null;
    const ambiguous=[...(group.replies||[])].reverse().find(item=>item.kind==='ambiguous') || null;
    if(effectiveReply){
      return scheduledDraft
        ? {key:'blocked',tone:'blocked',label:'已回复 · 有定时跟进邮件',detail:`网易草稿箱仍有 ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)} 的定时发送，请先处理该草稿`,observation:effectiveReply,scheduledDraft,activeTask:null,humanManaged:true}
        : {key:'replied',tone:'replied',label:'已回复',detail:'有效回复，需要人工回复；SmartMail 不再生成跟进邮件',observation:effectiveReply,activeTask,humanManaged:group.humanManaged===true};
    }
    if(ambiguous)return scheduledDraft
      ? {key:'blocked',tone:'blocked',label:'有来信待确认 · 已有定时跟进邮件',detail:`先查看这封来信，再决定是否保留 ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)} 的定时发送`,observation:ambiguous,scheduledDraft,activeTask:null}
      : {key:'blocked',tone:'blocked',label:'有来信待确认',detail:'请先查看来信，确认是否属于有效回复',observation:ambiguous,activeTask};
    if(activeTask?.state==='blocked')return {key:'blocked',tone:'blocked',label:'跟进已阻断',detail:activeTask.blocker?.kind==='human'?'已收到有效回复，需要人工回复':'需要处理阻断原因',activeTask};
    if(scheduledDraft){
      const sequence=Math.max(1,Number(scheduledDraft.sequence||scheduledDraft.observedSequence||group.eligibility?.sequence||1));
      const maxAttempts=Math.max(0,Number(group.policy?.maxAttempts||0));
      if(sequence>maxAttempts)return {key:'blocked',tone:'blocked',label:'已安排发送 · 超出规则',detail:`第 ${sequence} 次跟进 · ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)}；当前最多允许 ${maxAttempts} 次`,scheduledDraft,activeTask:null};
      return {key:'waiting',tone:'scheduled',label:'已安排发送',detail:`第 ${sequence} 次跟进 · ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)}`,scheduledDraft,activeTask:null};
    }
    if(activeTask){
      const reviewed=!!activeTask.reviewedAt && Number(activeTask.confirmedVersion)===Number(activeTask.contentVersion);
      const autoReviewed=reviewed && activeTask.reviewDecision==='auto';
      const label=reviewed?'已生成 · 可排期':'已生成 · 需审阅';
      const sequence=Math.max(1,Number(activeTask.sequence||1));
      const detail=activeTask.draftPreparedAt?`第 ${sequence} 次跟进 · 草稿已创建`:activeTask.dispatch?.queued?(activeTask.dispatch.scheduleAt?`第 ${sequence} 次跟进 · 已安排 ${Operations.formatDisplayTime(activeTask.dispatch.scheduleAt)}`:`第 ${sequence} 次跟进 · ${autoReviewed?'模板检查完整，已进入安排发送':'已进入安排发送'}`):(reviewed?`第 ${sequence} 次跟进 · 等待进入安排发送`:`第 ${sequence} 次跟进 · 生成后发现异常，请到审阅邮件处理`);
      return {key:'due',tone:'due',label,detail,activeTask};
    }
    if(group.eligibility?.eligible){
      const sequence=Math.max(1,Number(group.eligibility.sequence||1));
      const delayDays=Math.max(0,Number(group.policy?.delayDays??Operations.DEFAULT_FOLLOWUP_POLICY.delayDays));
      return {key:'due',tone:'due',label:'现在可以准备跟进',detail:`距上次发送已达到 ${delayDays} 天 · 可准备第 ${sequence} 次跟进`};
    }
    if(group.eligibility?.reason==='scheduled-follow-up-exists'){
      const sequence=Math.max(1,Number(group.eligibility.sequence||group.eligibility.scheduledDraft?.sequence||1));
      return {key:'waiting',tone:'scheduled',label:'已安排发送',detail:`第 ${sequence} 次跟进 · ${Operations.formatDisplayTime(group.eligibility.scheduledDraft?.scheduleAt||group.eligibility.dueAt)}`,scheduledDraft:group.eligibility.scheduledDraft||null,activeTask:null};
    }
    if(group.eligibility?.reason==='waiting'){
      const sequence=Math.max(1,Number(group.eligibility.sequence||1));
      return {key:'waiting',tone:'',label:'还在等待',detail:`预计 ${Operations.formatDisplayTime(group.eligibility.dueAt)} 后可准备第 ${sequence} 次跟进`};
    }
    if(group.eligibility?.reason==='human-managed-conversation')return {key:'replied',tone:'replied',label:'已回复',detail:'有效回复，需要人工回复；SmartMail 不再生成跟进邮件',observation:group.eligibility.blockingObservation||null,humanManaged:true};
    if(group.eligibility?.reason==='max-attempts-reached')return {key:'waiting',tone:'',label:'本轮跟进已完成',detail:`已达到最多 ${group.policy.maxAttempts} 次跟进`};
    if(group.eligibility?.reason==='recipient-guard')return {key:'blocked',tone:'blocked',label:'联系规则阻断',detail:(group.eligibility.guard?.reasons||[]).join('；')||'已暂停联系'};
    return {key:'waiting',tone:'',label:'监测中',detail:group.eligibility?.reason||'等待邮箱事实'};
  }

function monitorDecisionPath(group, state) {
    const st=state||monitorGroupState(group);
    const eligibility=group?.eligibility||{};
    const last=group?.lastOutbound||{};
    const sequence=Math.max(1,Number(eligibility.sequence||st?.scheduledDraft?.sequence||st?.activeTask?.sequence||1));
    const sentAt=last.sentAt?Operations.formatDisplayTime(last.sentAt):'已识别';
    const nodes=[{kind:'fact',title:'已经联系',value:sentAt,tone:'done'}];
    const effectiveReply=[...(group?.replies||[])].reverse().find(item=>Operations.isEffectiveReplyObservation(item))||group?.humanReply||null;
    const ambiguous=[...(group?.replies||[])].reverse().find(item=>item.kind==='ambiguous')||null;
    const automatic=[...(group?.replies||[])].reverse().find(item=>item.kind==='automatic')||null;
    if(effectiveReply){
      nodes.push({kind:'decision',title:'有有效回复吗？',value:'有',tone:'stop'});
      if(st?.scheduledDraft)nodes.push({kind:'result',title:'需要你处理',value:'先处理回复与已安排邮件',tone:'warn'});
      else nodes.push({kind:'result',title:'下一步',value:'转人工回复，不再自动跟进',tone:'reply'});
      return nodes;
    }
    if(ambiguous){
      nodes.push({kind:'decision',title:'发现一封来信',value:'需要确认',tone:'warn'});
      nodes.push({kind:'result',title:'下一步',value:'查看来信后确认是否停止跟进',tone:'warn'});
      return nodes;
    }
    nodes.push({kind:'decision',title:'有有效回复吗？',value:automatic?'没有 · 自动回复不计入':'没有',tone:'pass'});
    const scheduled=st?.scheduledDraft||eligibility.scheduledDraft||null;
    if(scheduled){
      nodes.push({kind:'decision',title:'已有后续安排吗？',value:'有',tone:'scheduled'});
      nodes.push({kind:'result',title:`跟进 #${sequence}`,value:`等待 ${Operations.formatDisplayTime(scheduled.scheduleAt||eligibility.dueAt)} 发送`,tone:'scheduled'});
      return nodes;
    }
    nodes.push({kind:'decision',title:'已有后续安排吗？',value:'没有',tone:'pass'});
    if(st?.activeTask){
      const reviewed=!!st.activeTask.reviewedAt&&Number(st.activeTask.confirmedVersion)===Number(st.activeTask.contentVersion);
      nodes.push({kind:'decision',title:'跟进内容准备好了吗？',value:'已生成',tone:'prepared'});
      nodes.push({kind:'result',title:`跟进 #${Math.max(1,Number(st.activeTask.sequence||sequence))}`,value:st.activeTask.dispatch?.queued?'已进入安排发送':(reviewed?'等待进入安排发送':'需要完成审阅邮件'),tone:'prepared'});
      return nodes;
    }
    if(eligibility.reason==='max-attempts-reached'){
      nodes.push({kind:'decision',title:'还允许继续跟进吗？',value:'已到次数上限',tone:'stop'});
      nodes.push({kind:'result',title:'本轮结束',value:`已完成最多 ${Math.max(0,Number(group?.policy?.maxAttempts||0))} 次跟进`,tone:'muted'});
      return nodes;
    }
    if(eligibility.reason==='recipient-guard'){
      nodes.push({kind:'decision',title:'还允许继续联系吗？',value:'已暂停',tone:'stop'});
      nodes.push({kind:'result',title:'需要处理',value:(eligibility.guard?.reasons||[]).join('；')||'当前联系规则阻止继续发送',tone:'warn'});
      return nodes;
    }
    const due=eligibility.eligible===true;
    nodes.push({kind:'decision',title:'到跟进时间了吗？',value:due?'到了':'还没有',tone:due?'due':'waiting'});
    if(due)nodes.push({kind:'result',title:`跟进 #${sequence}`,value:'现在可以准备',tone:'due'});
    else if(eligibility.reason==='waiting')nodes.push({kind:'result',title:'继续等待',value:`预计 ${Operations.formatDisplayTime(eligibility.dueAt)} 后可准备`,tone:'waiting'});
    else nodes.push({kind:'result',title:'继续监测',value:st?.detail||'等待新的邮箱变化',tone:'muted'});
    return nodes;
  }

function monitorCreatable(group) {
    return !group.viewState?.activeTask && group.eligibility?.eligible === true;
  }

function monitorContactIdentity(group) {
    const recipients=group?.lastOutbound?.recipients||group?.outbounds?.[0]?.recipients||[];
    const normalized=recipients.map(item=>({email:String(item?.email||item?.address||'').trim().toLowerCase(),name:String(item?.name||'').trim()})).filter(item=>item.email);
    const email=normalized.map(item=>item.email).join('; ');
    const names=[...new Set(normalized.map(item=>item.name).filter(Boolean))];
    const name=names.length===1?names[0]:'';
    return {email:email||monitorRecipientText(group?.lastOutbound)||'未知联系人',name};
  }

function monitorContactMetrics(group) {
    const outbounds=group?.outbounds||[];
    const followUps=Math.max(0,Number(group?.completedFollowUps||0));
    const effectiveReplies=(group?.replies||[]).filter(item=>Operations.isEffectiveReplyObservation(item));
    const last=group?.lastOutbound||outbounds[outbounds.length-1]||null;
    return {touches:outbounds.length,followUps,replies:effectiveReplies.length,lastAt:last?.sentAt||'',lastSubject:last?.subject||''};
  }

function monitorSummary(enriched=[]) {
    const total=enriched.length;
    const replied=enriched.filter(item=>(item.replies||[]).some(reply=>Operations.isEffectiveReplyObservation(reply))||item.humanReply).length;
    const blocked=enriched.filter(item=>item.viewState?.key==='blocked').length;
    const due=enriched.filter(item=>item.viewState?.key==='due').length;
    const creatable=enriched.filter(monitorCreatable).length;
    const prepared=enriched.filter(item=>item.viewState?.key==='due'&&!!item.viewState?.activeTask).length;
    const scheduled=enriched.filter(item=>item.viewState?.tone==='scheduled').length;
    const waiting=enriched.filter(item=>item.viewState?.key==='waiting'&&item.viewState?.tone!=='scheduled'&&item.eligibility?.reason!=='max-attempts-reached').length;
    const complete=enriched.filter(item=>item.eligibility?.reason==='max-attempts-reached').length;
    const followUps=enriched.reduce((sum,item)=>sum+Math.max(0,Number(item.completedFollowUps||0)),0);
    return {total,replied,blocked,due,creatable,prepared,scheduled,waiting,complete,followUps,unreplied:Math.max(0,total-replied)};
  }

function monitorHasEffectiveReply(group) {
    return !!((group?.replies||[]).some(reply=>Operations.isEffectiveReplyObservation(reply))||group?.humanReply);
  }

function monitorIsComplete(group) {
    return group?.eligibility?.reason==='max-attempts-reached';
  }

function monitorHasAmbiguousReply(group) {
    return group?.viewState?.observation?.kind==='ambiguous';
  }

function monitorQueueFor(group) {
    if(monitorIsComplete(group))return 'complete';
    const st=group?.viewState||{};
    if(st.key==='due'||st.key==='blocked'||monitorHasEffectiveReply(group))return 'attention';
    return 'waiting';
  }

function monitorMatchesQueue(group, filter='all') {
    const key=filter||'all';
    return key==='all' || monitorQueueFor(group)===key;
  }

function monitorMatchesSubfilter(group, subfilter='all') {
    const key=subfilter||'all', st=group?.viewState||{};
    if(key==='all')return true;
    if(key==='due')return st.key==='due';
    if(key==='replied')return monitorHasEffectiveReply(group);
    if(key==='ambiguous')return monitorHasAmbiguousReply(group);
    if(key==='issue')return monitorQueueFor(group)==='attention' && st.key!=='due' && !monitorHasEffectiveReply(group) && !monitorHasAmbiguousReply(group);
    if(key==='time')return monitorQueueFor(group)==='waiting' && st.tone!=='scheduled';
    if(key==='scheduled')return st.tone==='scheduled';
    return true;
  }

function monitorMatchesAttempts(group, attempts='all') {
    const key=attempts||'all';
    if(key==='all')return true;
    const count=Math.max(0,Number(group?.completedFollowUps||0));
    if(key==='2plus')return count>=2;
    return count===Math.max(0,Number(key||0));
  }

function monitorDisplayReplySubject(value='', group=null, observation=null) {
    const raw=String(value||'').trim();
    if(!raw)return '(无主题)';
    // Some mailbox list variants decorate auto-response subjects even when the
    // opened message displays the normal thread subject. Keep that raw value for
    // deterministic classification, but do not present the provider decoration as
    // if SmartMail edited the user's subject.
    const cleaned=raw.replace(/^\s*(?:(?:automatic(?:ally)?|automated|auto(?:matic)?)\s*(?:reply|response)|auto[- ]?response)\s*[:：-]\s*/i,'').trim();
    if(cleaned&&cleaned!==raw&&group){
      const related=(group.outbounds||[]).find(record=>String(record?.id||'')===String(observation?.relatedOutboundId||''))||group.lastOutbound||null;
      const relatedSubject=String(related?.subject||'').trim();
      if(relatedSubject&&Operations.subjectThreadKey(cleaned)===Operations.subjectThreadKey(relatedSubject))return relatedSubject;
    }
    return cleaned||raw;
  }

function monitorContactStatusLabel(group) {
    const st=group?.viewState||{};
    if(st.key==='replied')return '已有回复';
    if(st.key==='blocked')return st.observation?.kind==='ambiguous'?'需要确认来信':'需要处理';
    if(st.key==='due')return st.activeTask?'跟进已准备':'需要跟进';
    if(st.tone==='scheduled')return '已安排跟进';
    if(group?.eligibility?.reason==='max-attempts-reached')return '跟进已结束';
    return '等待中';
  }

function dashboardTaskContacts() {
    const map=new Map();
    const merge=(emailRaw,nameRaw='',schoolRaw='',taskIncrement=0)=>{
      const email=Operations.normalizeEmail(emailRaw||'');
      if(!email||email===operationState.account)return;
      const current=map.get(email)||{email,name:'',school:'',planned:true,tasks:0};
      current.tasks+=Math.max(0,Number(taskIncrement||0));
      if(!current.name&&nameRaw)current.name=String(nameRaw).trim();
      if(!current.school&&schoolRaw)current.school=String(schoolRaw).trim();
      map.set(email,current);
    };
    // The master roster is the closest thing to the operator's promised target pool.
    // Merge it before prepared mails so contacts with a roster identity remain in the
    // denominator even when their message is not ready yet.
    for(const entry of (batch?.roster?.entries||[]))merge(entry?.email||'',entry?.name||'',entry?.school||'',0);
    for(const task of (batch?.tasks||[])){
      if(task?.dispatchKind==='follow_up')continue;
      const recipients=Operations.parseRecipients(task?.recipients||'');
      for(const recipient of recipients)merge(recipient?.email||'',recipient?.name||'',task?.school||'',1);
    }
    return map;
  }

function dashboardHumanReplies(group){
    return (group?.replies||[]).filter(reply=>Operations.isEffectiveReplyObservation(reply))
      .sort((a,b)=>Operations.timeMs(a?.receivedAt)-Operations.timeMs(b?.receivedAt));
  }

function dashboardGroupEmail(group){
    return Operations.normalizeEmail(monitorContactIdentity(group).email);
  }

function dashboardReplyAfterFollowUp(group,reply){
    if(!reply)return false;
    const related=(group?.outbounds||[]).find(record=>String(record?.id||'')===String(reply?.relatedOutboundId||''));
    return Math.max(0,Number(related?.effectiveSequence??related?.sequence??0))>0;
  }

function dashboardContactSignal(group,meta={}){
    const replies=dashboardHumanReplies(group);
    const followUps=Math.max(0,Number(group?.completedFollowUps||0));
    const active=!!group?.operatorContinued;
    const strong=active&&replies.length>=2;
    return {
      email:meta.email||dashboardGroupEmail(group),
      name:meta.name||monitorContactIdentity(group)?.name||'',
      school:meta.school||'',
      group,replies,followUps,active,strong,
      level:strong?'strong':active?'active':replies.length?'reply':followUps?'followup':'base',
      firstReplyAfterFollowUp:dashboardReplyAfterFollowUp(group,replies[0]||null),
      lastAt:Math.max(
        Operations.timeMs(group?.lastOutbound?.sentAt||''),
        ...replies.map(reply=>Operations.timeMs(reply?.receivedAt||'')),
        0
      )
    };
  }

function dashboardSnapshot(){
    const planned=dashboardTaskContacts();
    const allGroups=Operations&&operationState.loaded?Operations.monitoringRoots(operationState.store):[];
    const groupByEmail=new Map();
    for(const group of allGroups){const email=dashboardGroupEmail(group);if(email)groupByEmail.set(email,group);}
    const plannedMode=planned.size>0;
    const scopedGroups=plannedMode?allGroups.filter(group=>planned.has(dashboardGroupEmail(group))):allGroups;
    const contacts=[];
    if(plannedMode){
      for(const meta of planned.values()){
        const group=groupByEmail.get(meta.email)||null;
        contacts.push(group?dashboardContactSignal(group,meta):{...meta,group:null,replies:[],followUps:0,active:false,strong:false,level:'planned',firstReplyAfterFollowUp:false,lastAt:0});
      }
    }else{
      for(const group of scopedGroups)contacts.push(dashboardContactSignal(group,{}));
    }
    const signals=scopedGroups.map(group=>dashboardContactSignal(group,planned.get(dashboardGroupEmail(group))||{}));
    const reachedCount=plannedMode?signals.length:scopedGroups.length;
    const plannedCount=plannedMode?planned.size:reachedCount;
    const followedUp=signals.filter(contact=>contact.followUps>0).length;
    const human=signals.filter(contact=>contact.replies.length>0).length;
    const active=signals.filter(contact=>contact.active).length;
    const strong=signals.filter(contact=>contact.strong).length;
    const followUpEmergence=signals.filter(contact=>contact.replies.length&&contact.firstReplyAfterFollowUp).length;
    const activeAfterFollowUp=signals.filter(contact=>contact.active&&contact.firstReplyAfterFollowUp).length;
    const schoolSet=new Set([...planned.values()].map(item=>item.school).filter(Boolean));
    const reachedSchoolSet=new Set(signals.map(item=>item.school).filter(Boolean));
    const store=operationState.store||{};
    const sync=store.mailboxSync||{};
    const mailboxKnown=Object.keys(store.outboundRecords||{}).length>0||!!(sync.lastQuickAt||sync.lastFullAt||sync.lastDedupeAt);
    const policy=store.followUpPolicies?.default||Operations.DEFAULT_FOLLOWUP_POLICY;
    return {planned,plannedMode,groups:scopedGroups,signals,contacts,reachedCount,plannedCount,followedUp,human,active,strong,followUpEmergence,activeAfterFollowUp,schoolCount:schoolSet.size,reachedSchoolCount:reachedSchoolSet.size,mailboxKnown,policy};
  }

  globalThis.NMDAMonitorDomain = Object.freeze({ monitorGroupState, monitorDecisionPath, monitorCreatable, monitorContactIdentity, monitorContactMetrics, monitorSummary, monitorQueueFor, monitorMatchesQueue, monitorMatchesSubfilter, monitorMatchesAttempts, monitorDisplayReplySubject, monitorContactStatusLabel, dashboardHumanReplies, dashboardSnapshot });
})();
