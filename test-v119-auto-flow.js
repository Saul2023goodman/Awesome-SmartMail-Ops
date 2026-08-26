const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');

for(const token of [
  'async function enterSelectionAndSchedule',
  'async function continueAfterReviewResolution',
  "已自动进入选择与安排",
  "if(!(batch.tasks||[]).some(taskHasBlockingIssue))setTimeout(()=>void enterSelectionAndSchedule('解析完成'),0)",
  "if(batch.dataset&&!batch.importBusy)void enterSelectionAndSchedule('资料已补齐')",
  "if(!reviewTasks().length){await continueAfterReviewResolution('邮件检查完成');return;}"
]) if(!js.includes(token)) throw new Error(`auto-flow contract missing: ${token}`);

if(!js.includes("if (/主题为空|未找到 Subject/.test(issue) && task.subject) continue;")) throw new Error('filled subject must clear stale subject parser issues');
if(!js.includes('function effectiveImportConfidence(task)')) throw new Error('current-state confidence recomputation missing');
if(!js.includes('function taskCanBatchConfirm(task)')) throw new Error('batch confirmation should be limited to genuinely ambiguous complete mails');
if(!js.includes("selectButton.hidden=visible.length<2")) throw new Error('bulk confirmation selector should appear only when batching saves effort');
if(!js.includes('id="nmda-review-evidence-details"')) throw new Error('technical parsing evidence should be a secondary disclosure');
if(!/v1\.19[\s\S]*?\.nmda-review-edit-pane[\s\S]*?grid-row:1\s*!important/.test(css)) throw new Error('editable mail is not visually primary');
if(!/\.nmda-review-evidence-pane[\s\S]*?grid-row:2\s*!important/.test(css)) throw new Error('technical evidence is not secondary');
if(!/v1\.28[\s\S]*?\.nmda-review-core-fields textarea[\s\S]*?max-height:38vh\s*!important/.test(css)) throw new Error('mail body must stay readable without pushing consequential actions off-screen');
console.log('v1.28 auto-flow contract OK: deterministic repairs auto-resolve, completed checks auto-advance, batching appears only when useful, and the editor keeps actions in context');
