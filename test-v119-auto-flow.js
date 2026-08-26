const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');

for(const token of [
  'async function enterSelectionAndSchedule',
  'async function continueAfterReviewResolution',
  "已自动进入选择与安排",
  "if(batch.supplementPreflightDone&&!(batch.tasks||[]).some(taskHasBlockingIssue))setTimeout(()=>void enterSelectionAndSchedule('解析完成'),0)",
  "if(batch.dataset&&!batch.importBusy)void enterSelectionAndSchedule('资料已补齐')",
  "if(!reviewTasks().length){await continueAfterReviewResolution('邮件检查完成');return;}"
]) if(!js.includes(token)) throw new Error(`auto-flow contract missing: ${token}`);

if(!js.includes("if (/主题为空|未找到 Subject/.test(issue) && task.subject) continue;")) throw new Error('filled subject must clear stale subject parser issues');
if(!js.includes('function effectiveImportConfidence(task)')) throw new Error('current-state confidence recomputation missing');
if(!js.includes('function taskCanBatchConfirm(task)')) throw new Error('batch confirmation should be limited to genuinely ambiguous complete mails');
if(!js.includes("selectButton.hidden=!batchMode||visible.length<2")) throw new Error('bulk confirmation selector should appear only in pending-review mode when batching saves effort');
if(js.includes('id="nmda-review-evidence-details"') || js.includes('<strong>识别依据</strong>')) throw new Error('technical parsing evidence should stay out of the user review flow');
if(!/v1\.19[\s\S]*?\.nmda-review-edit-pane[\s\S]*?grid-row:1\s*!important/.test(css)) throw new Error('editable mail is not visually primary');
if(!/v1\.29[\s\S]*?\.nmda-review-actions\s*\{[\s\S]*?position:static\s*!important/.test(css)) throw new Error('mail actions must remain in document flow instead of covering the message');
console.log('v1.30 auto-flow contract OK: deterministic repairs auto-resolve, completed checks auto-advance, technical evidence stays out of the main review flow, and review actions never cover message content');
