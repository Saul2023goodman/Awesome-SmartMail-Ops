const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');
const must=[
  ['subject assist UI','id="nmda-subject-assist"'],
  ['subject assist action','function applySubjectAssist()'],
  ['auto-growing review body','function autoSizeReviewBody()'],
  ['draft pending confirmation','reviewDraftPending'],
  ['default-open scheduler','id="nmda-scheduler-card" hidden open'],
  ['confirm current label','>确认本封</button>'],
  ['confirm next label','>确认并下一封</button>']
];
for(const [name,text] of must) if(!js.includes(text)) throw new Error(`${name} missing`);
for(const obsolete of ['id="nmda-bulk-subject-panel"','placeholder="统一补充空白主题"']) if(js.includes(obsolete)) throw new Error(`obsolete standalone bulk subject UI remains: ${obsolete}`);
if(!/function otherMissingSubjectTasks\(currentKey=''\)[\s\S]*?task\.editKey!==currentKey[\s\S]*?!String\(task\?\.subject\|\|''\)\.trim\(\)/.test(js)) throw new Error('subject assist scope is not other blank subjects only');
if(!/\.nmda-review-layout\s*\{[\s\S]*?max-height:none\s*!important/.test(css)) throw new Error('review layout is still viewport-clipped');
if(!/v1\.19[\s\S]*?\.nmda-review-evidence-pane[\s\S]*?grid-row:2\s*!important/.test(css)) throw new Error('parsing evidence should be secondary to editable mail');
if(!/\.nmda-review-edit-pane\s*\{[\s\S]*?overflow:visible\s*!important/.test(css)) throw new Error('edit pane still has nested scroll');
if(!/\.nmda-review-core-fields textarea\s*\{[\s\S]*?overflow:hidden/.test(css)) throw new Error('body textarea still uses internal scroll');
console.log('review contract OK: editable mail stays full-height; parsing evidence is secondary; scheduler remains default-open');
