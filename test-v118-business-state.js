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
  sliceFunction('isAutoResolvableReviewIssue','unresolvedImportIssues'),
  sliceFunction('unresolvedImportIssues','taskIssueState'),
  sliceFunction('taskIssueState','taskNeedsImportReview'),
  sliceFunction('taskNeedsImportReview','taskHasBlockingIssue'),
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

const ambiguous={...base,editKey:'b',subject:'',errors:['缺少主题'],importIssues:['主题为空'],importConfidence:55,reviewDraftPending:false,status:'error'};
sandbox.setTaskEdit(ambiguous,{subject:'Same subject'});
if(!ambiguous.reviewDraftPending)throw new Error('ambiguous parsing edit must still require confirmation');
if(!sandbox.taskNeedsImportReview(ambiguous))throw new Error('low-confidence mail must remain pending after subject repair');

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
if(!js.includes('data-issue-action="attachments"'))throw new Error('attachment guidance action missing');
console.log('v1.18 business-state regression OK: deterministic fixes auto-resolve; attachment and scheduling routes are explicit');
