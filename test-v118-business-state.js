const fs=require('fs');
const vm=require('vm');
const js=fs.readFileSync(__dirname+'/content.js','utf8');

function sliceFunction(name,nextName){
  const start=js.indexOf(`  function ${name}(`);
  const end=js.indexOf(`\n  function ${nextName}(`,start);
  if(start<0||end<0)throw new Error(`cannot extract ${name}`);
  return js.slice(start,end);
}
const code=[
  sliceFunction('recipientLooksValid','isAutoResolvableReviewIssue'),
  sliceFunction('isAutoResolvableReviewIssue','effectiveImportConfidence'),
  sliceFunction('effectiveImportConfidence','unresolvedImportIssues'),
  sliceFunction('unresolvedImportIssues','taskIssueState'),
  sliceFunction('taskIssueState','taskNeedsImportReview'),
  sliceFunction('taskNeedsImportReview','taskCoreValid'),
  sliceFunction('taskCoreValid','taskNeedsExplicitConfirmation'),
  sliceFunction('taskNeedsExplicitConfirmation','taskCanBatchConfirm'),
  sliceFunction('taskCanBatchConfirm','taskHasBlockingIssue'),
  sliceFunction('taskHasBlockingIssue','excludedImportCount'),
  sliceFunction('refreshTaskCoreValidation','setTaskEdit'),
  sliceFunction('setTaskEdit','mappingSelectHtml')
].join('\n');
const sandbox={
  batch:{taskEdits:new Map(),schedulePlan:null},
  Contacts:{parseRecipients:v=>String(v||'').split(/[;,]/).map(email=>({email:email.trim()}))},
  parseTaskClassifications:v=>Array.isArray(v)?v:String(v||'').split(/[;,]/).filter(Boolean),
  refreshTaskSearchStatic:()=>{}
};
vm.createContext(sandbox);
vm.runInContext(code,sandbox);

const base={editKey:'a',recipients:'a@example.edu',subject:'',body:'A'.repeat(80),errors:['缺少主题'],warnings:[],importIssues:['主题为空'],importConfidence:92,reviewConfirmed:false,reviewDraftPending:false,rosterConfirmed:false,rosterIssues:[],importExcluded:false,policyBlocked:false,status:'error',tags:[]};
if(!sandbox.taskNeedsImportReview(base))throw new Error('missing subject must enter pending review');
sandbox.setTaskEdit(base,{subject:'Prospective PhD Enquiry'});
if(base.reviewDraftPending)throw new Error('deterministic subject repair must not create sticky confirmation state');
if(sandbox.taskNeedsImportReview(base))throw new Error('subject-only task must leave pending immediately after repair');
if(base.status!=='ready')throw new Error(`repaired subject-only task should become ready, got ${base.status}`);

const subjectOnlyLow={...base,editKey:'b',subject:'',errors:['缺少主题'],importIssues:['未找到 Subject 标记','邮件边界识别置信度较低'],importConfidence:55,reviewDraftPending:false,status:'error'};
sandbox.setTaskEdit(subjectOnlyLow,{subject:'Same subject'});
if(subjectOnlyLow.reviewDraftPending)throw new Error('subject-derived low confidence should not create sticky confirmation after subject is supplied');
if(sandbox.taskNeedsImportReview(subjectOnlyLow))throw new Error('supplying the missing subject should recompute effective evidence and clear stale subject-derived review state');

const ambiguous={...base,editKey:'b2',subject:'',errors:['缺少主题'],importIssues:['主题为空','候选邮件边界重叠'],importConfidence:55,reviewDraftPending:false,status:'error'};
sandbox.setTaskEdit(ambiguous,{subject:'Same subject'});
if(!ambiguous.reviewDraftPending)throw new Error('genuinely ambiguous parsing edit must still require confirmation');
if(!sandbox.taskNeedsImportReview(ambiguous))throw new Error('non-deterministic parsing ambiguity must remain pending');

const clean={...base,editKey:'c',subject:'Original',errors:[],importIssues:[],importConfidence:95,status:'ready',reviewDraftPending:false};
sandbox.setTaskEdit(clean,{subject:'Edited'});
if(!clean.reviewDraftPending||!sandbox.taskNeedsImportReview(clean))throw new Error('editing an already-clean mail should require explicit confirmation');

const attachment={...base,editKey:'d',subject:'Ready',errors:['缺少附件：cv.pdf'],importIssues:[],status:'error'};
const state=sandbox.taskIssueState(attachment);
if(state.attachment.length!==1)throw new Error('missing attachment must be categorized as attachment');
if(sandbox.taskNeedsImportReview(attachment))throw new Error('missing attachment must not be mixed into parsing review');
if(!sandbox.taskHasBlockingIssue(attachment))throw new Error('missing attachment must still block handoff');

if(!js.includes("warnings.push(`原定时时间无法识别：${scheduleRaw}；请在自动安排时间中重新选择`)"))throw new Error('invalid imported schedule should defer to scheduling step instead of hard-blocking');
if(!js.includes('<span>附件待加</span>'))throw new Error('attachment summary category missing');
if(!js.includes("openNextBlockingIssue('attachments')"))throw new Error('attachment fallback must route through the unified next-action resolver');
if(!js.includes('还有待办，不需要自己找顺序'))throw new Error('blocked guidance must explain the system-controlled task order');
console.log('business-state regression OK: current facts clear stale subject review state; true ambiguity and attachment blockers remain explicit');
