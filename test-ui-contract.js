const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const m=js.match(/root\.innerHTML = `([\s\S]*?)`;\n\s*document\.documentElement\.appendChild/);
if(!m) throw new Error('buildUI template not found');
const html=m[1];
for(const label of ['添加资料','核对邮件','选择与定时','创建草稿']) {
  if(!html.includes(`<strong>${label}</strong>`)) throw new Error(`missing flow step: ${label}`);
}
for(const tech of ['EXCEPTION REVIEW','MAILBOX STATE','CONTACT BOOK','MESSAGE</div>','ATTACHMENTS</div>','SCHEDULE</div>','识别诊断与高级映射','证据分']) {
  if(html.includes(tech)) throw new Error(`technical UI text leaked: ${tech}`);
}
if(!html.includes('<strong>批量工作台</strong>') || html.includes('data-tab="import"')) throw new Error('unified batch workbench IA missing');
if((html.match(/class="nmda-process-guide"/g)||[]).length !== 1) throw new Error('process guide should appear exactly once');
if(!html.includes('同步邮箱') || !html.includes('维护选项')) throw new Error('contact sync / maintenance hierarchy missing');
console.log('ui contract OK: unified batch workbench, single flow guide, simplified contact maintenance');
