const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');
const m=js.match(/root\.innerHTML = `([\s\S]*?)`;\n\s*document\.documentElement\.appendChild/);
if(!m) throw new Error('buildUI template not found');
const html=m[1];

for(const label of ['添加资料','逐条确认','选择任务','安排时间','创建草稿']) {
  if(!html.includes(`<strong>${label}</strong>`)) throw new Error(`missing flow step: ${label}`);
}
for(const tech of ['EXCEPTION REVIEW','MAILBOX STATE','CONTACT BOOK','MESSAGE</div>','ATTACHMENTS</div>','SCHEDULE</div>','识别诊断与高级映射','证据分']) {
  if(html.includes(tech)) throw new Error(`technical UI text leaked: ${tech}`);
}

if(!html.includes('data-tab="batch"') || html.includes('data-tab="import"')) throw new Error('batch workbench IA missing');
if(!html.includes('data-tab="review"') || !html.includes('<strong>逐条确认</strong><small>核验 · 修正 · 放行</small>')) throw new Error('review must be an independent primary workspace');
if(!html.includes('id="nmda-review-nav-count"')) throw new Error('review pending count missing from primary navigation');

const guides=(html.match(/class="nmda-process-guide"/g)||[]).length;
if(guides!==2) throw new Error(`process guide should be present in batch and review workspaces; got ${guides}`);
if(!/\.nmda-bulk-workbench > \.nmda-process-guide,[\s\S]*?\.nmda-review-page > \.nmda-process-guide[\s\S]*?position:sticky/.test(css)) throw new Error('right sticky workflow rail missing');
if(!/\.nmda-process-guide\s*\{[\s\S]*?flex-direction:column/.test(css)) throw new Error('workflow rail is not vertical');

const reviewStart=html.indexOf('data-pane="review"');
const contactsStart=html.indexOf('data-pane="contacts"');
const reviewHtml=html.slice(reviewStart,contactsStart>reviewStart?contactsStart:undefined);
if(!reviewHtml.includes('id="nmda-bulk-subject-open"')) throw new Error('bulk subject must live inside review workspace');
if(!reviewHtml.includes('id="nmda-review-confirm-selected"')) throw new Error('batch save/confirm action missing in review workspace');
if(!reviewHtml.includes('保存并确认所选')) throw new Error('batch confirm label missing');
if(!reviewHtml.includes('data-review-filter="pending"') || !reviewHtml.includes('data-review-filter="all"')) throw new Error('review pending/all modes missing');
if(!reviewHtml.includes('id="nmda-review-select-filtered"')) throw new Error('review selection control missing');

const batchStart=html.indexOf('data-pane="batch"');
const reviewPaneStart=html.indexOf('data-pane="review"');
const batchHtml=html.slice(batchStart,reviewPaneStart);
if(batchHtml.includes('id="nmda-bulk-subject-open"')) throw new Error('bulk subject leaked back into batch workspace');
if(html.includes('id="nmda-import-preview-card"') || html.includes('抽查邮件')) throw new Error('duplicate import sampling table should be removed, not merely hidden');
if(!html.includes('进入任务选择')) throw new Error('handoff should be phrased as entering task selection, not duplicate confirmation');

if(!html.includes('同步邮箱') || !html.includes('维护选项')) throw new Error('contact sync / maintenance hierarchy missing');
console.log('ui contract OK: independent review gate, selected-only batch actions, right sticky vertical flow rail');
