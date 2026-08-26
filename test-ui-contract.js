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
if(!html.includes('导入与核对') || !html.includes('批量创建')) throw new Error('business nav labels missing');
console.log('ui contract OK: flow-first labels present; default technical labels removed');
