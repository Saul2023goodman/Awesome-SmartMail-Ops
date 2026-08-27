const fs=require('fs');
const js=fs.readFileSync('content.js','utf8');
const css=fs.readFileSync('content.css','utf8');
const manifest=require('./manifest.json');
const must=(ok,msg)=>{if(!ok)throw new Error(msg);};

must(manifest.version==='1.36.0','manifest version must be 1.36.0');
must(js.includes('<strong>确认与安排</strong>'),'workflow must frame stage 3 as confirmation, not mandatory selection');
must(js.includes('可创建邮件已默认纳入'),'default-to-all scope copy missing');
must(js.includes('class="nmda-scope-tools"'),'exception-only scope controls must be collapsible');
must(js.includes('<strong>筛选与排除</strong>'),'search must be demoted to exception handling');
must(js.includes('>纳入筛选结果</button>'),'filtered include action missing');
must(js.includes('>排除全部</button>'),'explicit exclude-all action missing');
must(css.includes('v1.36 · Default-to-all scope'),'scope hierarchy styling contract missing');

must(js.includes('function actionableAttachmentRefs(refs)'),'attachment obligation gate missing');
must(js.includes("if(/^(?:https?:\\/\\/|www\\.)/iu.test(ref))"),'URL evidence gate missing');
must(js.includes("/\\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)$/iu.test(clean)"),'direct-download exception missing');
must(js.includes('ignoredAttachmentRefs:rawAttachmentRefs.filter'),'discarded evidence must remain auditable');

console.log('v1.36 contract OK: default-to-all scope, exception-only search, and obligation-gated attachment requirements');
