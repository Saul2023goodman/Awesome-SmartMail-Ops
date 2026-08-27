const fs = require('fs');
const vm = require('vm');

global.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
vm.runInThisContext(fs.readFileSync('import-core.js', 'utf8'), { filename: 'import-core.js' });
vm.runInThisContext(fs.readFileSync('mail-recognizer.js', 'utf8'), { filename: 'mail-recognizer.js' });
global.NMDAImportAdapters = {
  FormatDetector: class {},
  registry: { find(){ return null; } },
  extOf(name=''){ return String(name).split('.').pop().toLowerCase(); },
  candidateDataFile(){ return true; }
};
vm.runInThisContext(fs.readFileSync('importer.js', 'utf8'), { filename: 'importer.js' });

const Core = global.NMDAImportCore;
const Importer = global.NMDAImporter;
const Mail = global.NMDAMailRecognizer;
const HEADERS = ['编号','收件人','学校 / 机构','主题','正文','附件','定时时间','任务标记','来源文件'];
const oneFile = (name, body) => new Core.NormalizedRecordSet({
  name: 'Word文档任务', source: name,
  rows: [HEADERS, ['1','','','',body,'','','',name]],
  meta: { word:true, kind:'document', wordTaskRows:true, oneFileTask:true }
});

const roleCases = [
  ['中文邮件：正文含 CV 类词汇', oneFile('张教授.docx', `老师您好！\n\n我是天津大学电气工程专业硕士生孙浩文。本科期间接受了系统的教育背景训练，也积累了科研经历，并参与论文发表与技能训练。\n\n我认真阅读了您的研究工作，对您的研究方向非常感兴趣，冒昧来信联系您，希望申请博士并有机会加入贵课题组，在您的指导下继续研究。\n\n感谢您的时间与阅读，期待您的回复。\n\n孙浩文`), 'mail'],
  ['中文邮件：教授您好', oneFile('联系导师.docx', `教授您好！\n\n我目前是某大学硕士生，写信希望向您咨询博士申请。我对您的研究工作很感兴趣，也希望有机会加入贵课题组。\n\n谢谢您的时间，期待进一步交流。\n\n李明`), 'mail'],
  ['中文邮件：张教授好', oneFile('professor-zhang.docx', `张教授好！\n\n我是某大学硕士生，冒昧来信联系您。我对您的课题很感兴趣，希望申请博士并在您的指导下开展研究。\n\n感谢您的阅读，期待您的回复。`), 'mail'],
  ['中文邮件：带材料小标题', oneFile('导师联系.docx', `李老师您好！\n\n我是某大学硕士生，冒昧来信联系您，希望申请博士。\n\n教育背景\n本科与硕士均为相关专业。\n\n科研经历\n完成项目 A 与 B。\n\n论文发表\n已有论文投稿。\n\n我对您的研究方向非常感兴趣，希望有机会加入贵课题组并在您的指导下继续研究。\n\n感谢您的时间，期待您的回复。`), 'mail'],
  ['英文邮件：原有能力不回归', oneFile('Professor-Smith.docx', `Dear Professor Smith,\n\nMy name is Alex Chen. I am writing to express my interest in pursuing a PhD under your supervision. My education and research experience include publications and technical skills relevant to your work.\n\nThank you for your time. I look forward to hearing from you.\n\nAlex Chen`), 'mail'],
  ['CV：无 CV 文件名但有章节结构', oneFile('Haowen-Sun.docx', `个人信息\n孙浩文 haowen@example.com\n\n教育背景\n天津大学 电气工程\n\n科研经历\n项目A\n\n论文发表\nPaper A\n\n技能\nPython MATLAB\n\n获奖经历\nScholarship`), 'attachment'],
  ['研究计划：章节结构', oneFile('proposal-draft.docx', `研究计划\n\n研究目标\n探讨某问题。\n\n研究方法\n采用实验和建模。\n\n预期成果\n形成论文。\n\n参考文献\n文献A`), 'attachment'],
  ['个人陈述：文件名优先', oneFile('个人陈述.docx', `尊敬的招生委员会：\n\n您好！我希望申请贵校项目，并介绍我的教育背景和科研经历。感谢您的阅读，期待有机会加入贵校。`), 'attachment'],
  ['推荐信：文件名优先', oneFile('推荐信.docx', `尊敬的招生委员会：\n\n我很高兴推荐张同学申请贵校项目。感谢您的审阅。`), 'attachment'],
  ['只有申请材料词汇：不自动吞成附件', oneFile('notes.docx', `本文总结教育背景、科研经历、论文发表与技能培养之间的关系。内容用于内部整理，不针对任何收件人，也没有发送意图。`), 'ambiguous'],
  ['总名单：身份表合同不回归', new Core.NormalizedRecordSet({ name:'Sheet1', source:'名单.xlsx', rows:[['学校','导师姓名','导师邮箱','优先级'],['A大学','张三','zhang@a.edu',1],['A大学','李四','li@a.edu',2]] }), 'roster'],
  ['名单文件名 + 导师结构：补充名单自动识别', new Core.NormalizedRecordSet({ name:'Sheet1', source:'北京985211补充名单.xlsx', meta:{format:'xlsx'}, rows:[['学校','导师','导师链接','研究方向'],['北京航空航天大学','聂玮','https://example.edu/nie','数字司法'],['北京航空航天大学','赵卫球','https://example.edu/zhao','民商法']] }), 'roster'],
  ['导师名单 + 单身份字段 + 研究字段：结构互证', new Core.NormalizedRecordSet({ name:'Sheet1', source:'第二批导师名单.xlsx', meta:{format:'xlsx'}, rows:[['导师','研究方向'],['张三','人工智能'],['李四','计算机视觉']] }), 'roster'],
  ['附件清单：文件名不能误导成总名单', new Core.NormalizedRecordSet({ name:'Sheet1', source:'附件清单.xlsx', meta:{format:'xlsx'}, rows:[['文件名','状态','备注'],['CV.pdf','已准备',''],['RP.pdf','待补','']] }), 'ambiguous'],
  ['普通名单：无联系人结构不自动归类', new Core.NormalizedRecordSet({ name:'Sheet1', source:'名单.xlsx', meta:{format:'xlsx'}, rows:[['设备','数量','价格'],['电脑',2,10000],['显示器',3,6000]] }), 'ambiguous'],
  ['发送清单：邮件结构优先于文件名', new Core.NormalizedRecordSet({ name:'Sheet1', source:'发送清单.xlsx', meta:{format:'xlsx'}, rows:[['收件人','主题','正文'],['a@example.edu','PhD inquiry','Dear Professor...']] }), 'mail']
];

let failed = 0;
for (const [name, recordSet, expected] of roleCases) {
  const result = Importer.classifyRecordSet(recordSet);
  const ok = result.purpose === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} role | ${name} | got=${result.purpose} ${result.confidence} | expected=${expected}`);
  if (!ok) console.dir(result, { depth: 5 });
}

// Multi-Word aggregation must keep per-file source shadows. The merged set is
// only the execution view; UI inspection/reclassification must still have one
// record set per original file, otherwise every file can display the first mail.
{
  const a=oneFile('第一批/A教授.docx', `张老师您好！\n\n我是A同学，写信咨询博士申请。\n\n谢谢您的时间。`);
  const b=oneFile('第二批/B教授.docx', `李老师您好！\n\n我是B同学，希望申请博士并加入您的团队。\n\n期待您的回复。`);
  a.meta={...a.meta,sourcePurpose:'mail',purposeConfidence:96,purposeReasons:['test']};
  b.meta={...b.meta,sourcePurpose:'mail',purposeConfidence:96,purposeReasons:['test']};
  const sets=[a,b];
  const merged=Importer.mergeWordTaskRecordSets(sets,{source:'multi-word'});
  const aggregate=sets.find(rs=>rs.meta?.merged);
  const shadows=sets.filter(rs=>rs.meta?.taskShadow);
  const ok=merged===true && sets.length===3 && shadows.length===2 && aggregate?.meta?.sourceMembers?.length===2 && shadows[0].source!==shadows[1].source;
  if(!ok)failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} source-isolation | merged=${merged} sets=${sets.length} shadows=${shadows.length} members=${aggregate?.meta?.sourceMembers?.length||0}`);
  if(!ok)console.dir(sets,{depth:4});
}

const frameCases = [
  ['无 Subject + 老师您好 + 无此致敬礼', `教授邮箱：zhang@univ.edu\n老师您好！\n我是天津大学硕士生，冒昧来信联系您，希望申请博士。我认真阅读了您的研究工作，对您的研究方向很感兴趣，希望有机会加入贵课题组并在您的指导下开展研究。\n感谢您的时间与阅读，期待您的回复。\n孙浩文`, 'zhang@univ.edu'],
  ['无 Subject + 张教授好', `收件人：li@univ.edu\n张教授好！\n我是某大学硕士生，给您写信希望咨询博士申请。我对您的研究方向非常感兴趣，希望有机会加入您的团队。\n感谢您的时间，期待您的回复。\n李明`, 'li@univ.edu'],
  ['新主题标签：邮件题目', `教授邮箱：wang@univ.edu\n邮件题目：博士申请咨询\n王老师您好！\n我是某大学硕士生，希望申请博士并加入贵课题组。\n祝您工作顺利。`, 'wang@univ.edu']
];
for (const [name, text, expectedRecipient] of frameCases) {
  const scan = Mail.recognizeMailText(text, { sourceFile:'case.txt', includeWeak:true });
  const frame = scan.records[0];
  const ok = !!frame && frame.recipients === expectedRecipient && frame.confidence >= 70;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} frame | ${name} | records=${scan.records.length} confidence=${frame?.confidence || 0} recipient=${frame?.recipients || ''}`);
  if (!ok) console.dir(scan, { depth: 4 });
}

if (failed) {
  console.error(`\n${failed} regression case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${roleCases.length + frameCases.length + 1} source-role/mail-frame/source-isolation regression cases passed.`);
