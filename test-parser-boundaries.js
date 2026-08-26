const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

vm.runInThisContext(fs.readFileSync('mail-recognizer.js','utf8'),{filename:'mail-recognizer.js'});
const Mail=globalThis.NMDAMailRecognizer;

function recognize(tail,{closing=true}={}){
  const blocks=[
    'Professor Hongzhi Yin — University of Queensland',
    '📧 h.yin1@uq.edu.au',
    'Subject: Prospective PhD Enquiry — Medical Image Learning',
    'Dear Professor Yin,',
    'I am writing to ask about doctoral opportunities in your group. My research focuses on robust medical image learning under limited annotations and changing clinical conditions.',
    'My prior work includes segmentation, self-supervised learning, model evaluation, and deployment for real clinical settings.',
    ...(closing?['Yours sincerely,','Xiong Guo']:[]),
    ...tail
  ];
  const scan=Mail.recognizeMailFrames(blocks,{includeWeak:true});
  assert.strictEqual(scan.records.length,1,'expected one mail frame');
  return{record:scan.records[0],scan};
}

{
  const {record,scan}=recognize(['Research source: Professor Hongzhi Yin’s official UQ profile and publication record — https://eecs.uq.edu.au/profile/2696/hongzhi-yin']);
  assert(record.body.includes('Xiong Guo'),'sender name should remain in signature');
  assert(!record.body.includes('Research source'),'research source contaminated the body');
  assert.strictEqual(record.excludedBlocks[0].field,'source');
  assert(record.evidence.includes('tail-boundary'));
  assert.strictEqual(scan.stats.excludedTailBlocks,1);
}

for(const line of [
  '资料来源：https://example.edu/profile',
  '参考文献：https://example.edu/paper',
  'Professor profile: https://example.edu/faculty',
  'Sources: official faculty page and publication list',
  '改写说明：突出方法契合度'
]){
  const {record}=recognize([line]);
  assert(!record.body.includes(line),`metadata variant leaked into body: ${line}`);
  assert(record.excludedBlocks.length===1,`metadata variant was not explained: ${line}`);
}

{
  const {record}=recognize(['Attachments: CV.pdf; Transcript.pdf']);
  assert.strictEqual(record.attachments,'CV.pdf; Transcript.pdf');
  assert(!record.body.includes('Attachments:'));
}

{
  const {record}=recognize(['Scheduled send time: 2026-09-03 07:30']);
  assert.strictEqual(record.scheduleAt,'2026-09-03 07:30');
  assert(!record.body.includes('Scheduled send time'));
}

{
  const {record}=recognize(['PhD Candidate','School of Medicine','Website: https://xiong.example','P.S.: I would also be happy to provide code samples.','Research source: https://example.edu/profile']);
  for(const wanted of ['PhD Candidate','School of Medicine','Website: https://xiong.example','P.S.: I would also be happy to provide code samples.'])assert(record.body.includes(wanted),`valid signature/postscript was removed: ${wanted}`);
  assert(!record.body.includes('Research source'));
}

{
  const scan=Mail.recognizeMailFrames([
    'Professor Hongzhi Yin — University of Queensland','📧 h.yin1@uq.edu.au','Subject: Prospective PhD Enquiry','Dear Professor Yin,',
    'Research source is an important methodological concern in my proposed work, and I plan to evaluate provenance throughout the project.',
    'This paragraph provides enough substantive context for reliable frame recognition.','Yours sincerely,','Xiong Guo'
  ],{includeWeak:true});
  assert(scan.records[0].body.includes('Research source is an important methodological concern'),'ordinary body prose was over-filtered');
}

{
  const {record}=recognize(['This unexpected prose appears after a completed signature.']);
  assert(!record.body.includes('This unexpected prose'),'ambiguous post-close prose must not be silently promoted');
  assert(record.issues.includes('邮件落款后存在未归类内容，已从正文隔离'),'ambiguous post-close prose must require review');
}

{
  const {record}=recognize(['Research source: https://example.edu/profile'],{closing:false});
  assert(!record.body.includes('Research source'),'open-ended mail tail was not isolated');
  assert(record.issues.includes('未找到邮件落款'));
}

{
  const cleaned=Mail.sanitizeRecognizedBody('Dear Professor Yin,\n\nA sufficiently complete email body paragraph.\n\nYours sincerely,\n\nXiong Guo\n\nResearch source: https://example.edu/profile');
  assert(cleaned.text.endsWith('Xiong Guo'));
  assert(!cleaned.text.includes('Research source'));
  assert.strictEqual(cleaned.excludedBlocks[0].field,'source');
}

{
  const scan=Mail.recognizeMailFrames([
    'Professor Hongzhi Yin — University of Queensland','📧 h.yin1@uq.edu.au','Subject: Prospective PhD Enquiry','Dear Professor Yin,',
    'This is a sufficiently long email paragraph about research alignment, doctoral study, robust learning, and clinical deployment.',
    'A second paragraph supplies enough context for stable recognition.','Yours sincerely,\nXiong Guo\nResearch source: https://example.edu/profile'
  ],{includeWeak:true});
  assert(scan.records[0].body.endsWith('Xiong Guo'),'inline signature should remain');
  assert(!scan.records[0].body.includes('Research source'),'same-block metadata leaked into the body');
  assert.strictEqual(scan.records[0].excludedBlocks[0].field,'source');
}

{
  const scan=Mail.recognizeMailFrames([
    'Professor Hongzhi Yin — University of Queensland','📧 h.yin1@uq.edu.au','Subject: Prospective PhD Enquiry',
    'Dear Professor Yin,\nThis is a sufficiently long email paragraph about robust learning and clinical deployment.\nA second substantive line completes the request.\nResearch source: https://example.edu/profile'
  ],{includeWeak:true});
  assert(!scan.records[0].body.includes('Research source'),'same-block open-ended metadata leaked into the body');
}

{
  const scan=Mail.recognizeMailFrames([
    'First Professor — First University','📧 first@example.edu','Subject: First mail','Dear Professor First,',
    'This complete first email contains sufficient substantive body text for parser recognition and testing.','Yours sincerely,','Xiong Guo',
    'Research source: wrong-recipient@example.edu — official university page',
    'Subject: Second mail','Dear Professor Second,','This second complete email contains sufficient substantive body text for parser recognition and testing.','Yours sincerely,','Xiong Guo'
  ],{includeWeak:true});
  assert.strictEqual(scan.records.length,2);
  assert.notStrictEqual(scan.records[1].recipients,'wrong-recipient@example.edu','source metadata email became the next recipient');
}

console.log('parser boundary regression OK: metadata isolated; signatures, postscripts, and ordinary prose protected');
