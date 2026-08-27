const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');
const m=js.match(/root\.innerHTML = `([\s\S]*?)`;\n\s*document\.documentElement\.appendChild/);
if(!m) throw new Error('buildUI template not found');
const html=m[1];

for(const label of ['添加资料','处理待办','选择与安排','创建草稿']) {
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
if(!batchHtml.includes('id="nmda-inline-review"') || !batchHtml.includes('id="nmda-review-workspace-title">处理待办</div>')) throw new Error('inline guided todo review missing from batch flow');
if(!batchHtml.includes('data-review-filter="pending">只看待办</button>') || !batchHtml.includes('data-review-filter="all">全部邮件</button>')) throw new Error('guided review filters missing');
if(batchHtml.includes('id="nmda-bulk-subject-panel"') || batchHtml.includes('placeholder="统一补充空白主题"')) throw new Error('subject batch fill must not remain as a separate visible control');
if(!batchHtml.includes('id="nmda-subject-assist"') || !batchHtml.includes('id="nmda-subject-assist-apply"')) throw new Error('contextual one-click subject suggestion missing');
if(!batchHtml.includes('id="nmda-review-confirm-selected"') || !batchHtml.includes('>确认所选</button>')) throw new Error('ambiguous selected edits still need one confirmation action');
if(batchHtml.includes('nmda-review-evidence-details') || batchHtml.includes('<strong>识别依据</strong>')) throw new Error('parsing evidence must not appear in the user review flow');

const previewCardStart=batchHtml.indexOf('id="nmda-preview-card"');
const schedulerStart=batchHtml.indexOf('id="nmda-scheduler-card"');
const previewTableStart=batchHtml.indexOf('class="nmda-table-wrap nmda-batch-table-wrap"');
if(!(previewCardStart>=0 && schedulerStart>previewCardStart && schedulerStart<previewTableStart)) throw new Error('automatic scheduling must be folded into selection card');
if(!batchHtml.includes('id="nmda-scheduler-card" hidden open')) throw new Error('automatic scheduling should default open when selection stage becomes available');
if(!batchHtml.includes('<th>选择</th><th>收件人</th><th>主题</th><th>发送时间</th><th>结果</th>')) throw new Error('batch table should use the five-column user decision layout');
if(batchHtml.includes('<th>学校</th>')||js.includes('data-task-school')) throw new Error('institution is schedule metadata and must not remain a primary editable table column');
if(!batchHtml.includes('院校信息只用于避免同校联系过于集中')) throw new Error('schedule purpose should be explained in user-facing language');

for(const tech of ['质量门','自动复核','机器先','人工确认','EXCEPTION REVIEW','MAILBOX STATE','CONTACT BOOK','识别诊断与高级映射']) {
  if(html.includes(tech)) throw new Error(`technical / internal copy leaked into primary UI: ${tech}`);
}

if(!/\.nmda-bulk-workbench > \.nmda-process-guide[\s\S]*?position:sticky/.test(css)) throw new Error('right sticky workflow rail missing');
if(!/v1\.23[\s\S]*?\.nmda-batch-table\s*\{[^}]*min-width:820px/.test(css)) throw new Error('five-column batch table width contract missing');
const guideStart=batchHtml.indexOf('class="nmda-process-guide"'),guideEnd=batchHtml.indexOf('</aside>',guideStart),runCardStart=batchHtml.indexOf('id="nmda-run-card"');
if(!(guideStart>=0&&runCardStart>guideStart&&runCardStart<guideEnd)) throw new Error('final create action must live in the right workflow rail');
if(!/v1\.35[\s\S]*?\.nmda-rail-create-card\s*\{[\s\S]*?position:static\s*!important/.test(css)) throw new Error('right-side create card layout contract missing');
if(!/v1\.19[\s\S]*?\.nmda-review-edit-pane[\s\S]*?grid-row:1\s*!important/.test(css)) throw new Error('editable mail must be the primary review pane');
if(!/v1\.29[\s\S]*?\.nmda-review-actions\s*\{[\s\S]*?position:static\s*!important/.test(css)) throw new Error('review confirmation actions must stay in layout instead of floating over mail content');
if(!batchHtml.includes('id="nmda-review-search"') || !batchHtml.includes('id="nmda-review-prev"') || !batchHtml.includes('id="nmda-review-next"')) throw new Error('review canvas search and sequential navigation missing');
if(batchHtml.includes('id="nmda-review-more-menu"')) throw new Error('single-action more menu adds unnecessary interaction cost');
if(!batchHtml.includes('id="nmda-review-exclude"') || !batchHtml.includes('>排除此封</button>')) throw new Error('exclude must be a direct mail-level action');
if(!js.includes('nmda-duplicate-preview-body') || !js.includes('保留此封') || !js.includes('编辑这封')) throw new Error('duplicate decision must provide simultaneous side-by-side mail previews');
if(!/v1\.30[\s\S]*?nmda-duplicate-candidates\[data-count=\"3\"\][\s\S]*?repeat\(3/.test(css)) throw new Error('three-way duplicate comparison layout missing');
if(!/grid-template-columns:148px minmax\(0,1fr\)/.test(css)) throw new Error('primary navigation width was not reduced');

if(!html.includes('同步邮箱') || !html.includes('记录异常时再维护')) throw new Error('contact sync / maintenance hierarchy missing');
console.log('ui contract OK: decision-first review canvas, direct exclude, no parsing evidence, simultaneous duplicate comparison, searchable queue, sequential navigation, contextual subject assist, default-open scheduling');
