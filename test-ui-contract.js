const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');
const m=js.match(/root\.innerHTML = `([\s\S]*?)`;\n\s*document\.documentElement\.appendChild/);
if(!m) throw new Error('buildUI template not found');
const html=m[1];

for(const label of ['添加资料','检查邮件','选择与安排','创建草稿']) {
  if(!html.includes(`<strong>${label}</strong>`)) throw new Error(`missing user flow step: ${label}`);
}
if(html.includes('data-flow-step="5"')) throw new Error('batch flow should be four user actions, not five internal stages');
if((html.match(/class="nmda-process-guide"/g)||[]).length!==1) throw new Error('workflow rail should exist once in the batch workspace');

if(!html.includes('data-tab="batch"') || !html.includes('<strong>批量草稿</strong>')) throw new Error('batch drafting primary workspace missing');
if(html.includes('data-tab="review"') || html.includes('data-pane="review"')) throw new Error('parsing preview must not be a primary workspace');
if(!html.includes('data-tab="single"') || !html.includes('data-tab="contacts"')) throw new Error('single draft / contacts primary workspaces missing');

const batchStart=html.indexOf('data-pane="batch"');
const contactsStart=html.indexOf('data-pane="contacts"');
const batchHtml=html.slice(batchStart,contactsStart>batchStart?contactsStart:undefined);
if(!batchHtml.includes('id="nmda-inline-review"') || !batchHtml.includes('<div class="nmda-card-title">检查邮件</div>')) throw new Error('inline mail review missing from batch flow');
if(!batchHtml.includes('data-review-filter="pending">待处理</button>') || !batchHtml.includes('data-review-filter="all">全部邮件</button>')) throw new Error('parsing preview filters missing');
if(batchHtml.includes('id="nmda-bulk-subject-panel"') || batchHtml.includes('placeholder="统一补充空白主题"')) throw new Error('subject batch fill must not remain as a separate visible control');
if(!batchHtml.includes('id="nmda-subject-assist"') || !batchHtml.includes('id="nmda-subject-assist-apply"')) throw new Error('contextual one-click subject suggestion missing');
if(!batchHtml.includes('id="nmda-review-confirm-selected"') || !batchHtml.includes('>确认所选</button>')) throw new Error('ambiguous selected edits still need one confirmation action');
if(!batchHtml.includes('id="nmda-review-evidence-details"') || !batchHtml.includes('<strong>解析依据</strong>')) throw new Error('secondary parsing evidence disclosure missing');

const previewCardStart=batchHtml.indexOf('id="nmda-preview-card"');
const schedulerStart=batchHtml.indexOf('id="nmda-scheduler-card"');
const previewCardEnd=batchHtml.indexOf('id="nmda-run-card"');
if(!(previewCardStart>=0 && schedulerStart>previewCardStart && schedulerStart<previewCardEnd)) throw new Error('automatic scheduling must be folded into selection card');
if(!batchHtml.includes('id="nmda-scheduler-card" hidden open')) throw new Error('automatic scheduling should default open when selection stage becomes available');
if(!batchHtml.includes('<th>选择</th><th>收件人</th><th>学校</th><th>主题</th><th>时间</th><th>状态</th>')) throw new Error('batch table should use the compact six-column decision layout');

for(const tech of ['质量门','自动复核','机器先','人工确认','EXCEPTION REVIEW','MAILBOX STATE','CONTACT BOOK','识别诊断与高级映射']) {
  if(html.includes(tech)) throw new Error(`technical / internal copy leaked into primary UI: ${tech}`);
}

if(!/\.nmda-bulk-workbench > \.nmda-process-guide[\s\S]*?position:sticky/.test(css)) throw new Error('right sticky workflow rail missing');
if(!/\.nmda-batch-table\s*\{[^}]*min-width:930px/.test(css)) throw new Error('compact batch table width contract missing');
if(!/\.nmda-run-card\s*\{[\s\S]*?position:static\s*!important/.test(css)) throw new Error('final action card must not overlap content as a sticky layer');
if(!/v1\.19[\s\S]*?\.nmda-review-edit-pane[\s\S]*?grid-row:1\s*!important/.test(css)) throw new Error('editable mail must be the primary review pane');
if(!/\.nmda-review-core-fields textarea[\s\S]*?overflow:hidden/.test(css)) throw new Error('review body should auto-grow instead of adding nested scrolling');
if(!/grid-template-columns:148px minmax\(0,1fr\)/.test(css)) throw new Error('primary navigation width was not reduced');

if(!html.includes('同步邮箱') || !html.includes('维护选项')) throw new Error('contact sync / maintenance hierarchy missing');
console.log('ui contract OK: edit-first mail review, secondary parsing evidence, contextual subject assist, default-open scheduling, compact non-overlapping flow');
