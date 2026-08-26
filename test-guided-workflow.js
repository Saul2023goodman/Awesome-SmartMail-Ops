const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');

const required=[
  ['step 2 is business todo stage',`<strong>处理待办</strong><small>补内容 · 去重 · 附件</small>`],
  ['single next-action router exists','function openNextBlockingIssue'],
  ['review queue is priority sorted','function reviewTaskPriority'],
  ['human issue labels are action-oriented','return \'补收件人\''],
  ['duplicate issue label is action-oriented','return \'处理重复\''],
  ['review next action exists','id="nmda-review-next-pending"'],
  ['blocked handoff is removed rather than disabled','card.hidden = blocked || !tasks.length'],
  ['attachment does not steal focus before mail todos',"!batch.attachmentAttentionShown && !reviewTasks().length"],
  ['ready step four is not current','state=creating?\'active\':unlocked?\'ready\':\'locked\''],
  ['review enters focus mode',"classList.add('is-review-focus')"],
  ['review exit restores workflow context',"classList.remove('is-review-focus')"],
];
for(const [name,needle] of required) if(!js.includes(needle)) throw new Error(`guided workflow missing: ${name}`);
if(!css.includes('v1.28 · Guided workflow')) throw new Error('guided workflow CSS layer missing');
if(!/\.nmda-review-actions\s*\{[\s\S]*?position:sticky\s*!important/.test(css)) throw new Error('review actions must remain visible');
if(!/\.nmda-run-card\s*\{[\s\S]*?position:sticky\s*!important/.test(css)) throw new Error('create action must remain visible');
if(!/\.nmda-inline-review-top\s*\{[\s\S]*?position:sticky/.test(css)) throw new Error('review context bar must remain visible');
if(!/\.nmda-bulk-workbench\.is-review-focus[\s\S]*?#nmda-import-card/.test(css)) throw new Error('review focus mode must remove unrelated stages from the scroll path');
if(!/\.nmda-duplicate-actions\s*\{[\s\S]*?position:sticky/.test(css)) throw new Error('duplicate decision action must remain reachable while comparing long groups');
console.log('guided workflow contract OK: unified todos, focus-mode review, prioritized next action, stable context, and sticky consequential actions');
