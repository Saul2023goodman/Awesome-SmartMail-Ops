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
  'Official university profile: https://example.edu/faculty',
  'Source URL: https://example.edu/faculty',
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

// v1.21 structure-sequence regressions: punctuation residue, split closings, role evidence, and split metadata.
{
  const scan=Mail.recognizeMailFrames([
    '孙教授 — 示例大学','📧 sun@example.edu','主题：博士申请咨询','尊敬的孙教授：',
    '感谢您审阅来信。我希望进一步了解课题组的博士招生与研究安排。',
    '基于上述学习与实践积累，我希望继续研究人工智能及其治理问题。',
    '此致\n敬礼—','孙潇阳'
  ],{includeWeak:true});
  const record=scan.records[0];
  assert.strictEqual(record.subject,'博士申请咨询','Chinese Subject marker was not localized');
  assert(record.body.endsWith('孙潇阳'),'Chinese signature after a closing dash was dropped');
  assert(!record.issues.some(issue=>/未归类内容/.test(issue)),'closing punctuation became an ambiguous tail');
  assert.strictEqual(record.endBlock,7,'mail end should be the signer, not the closing phrase');
  const roles=new Map(record.blockRoles.map(item=>[item.index,item.roles.map(role=>role.role)]));
  assert(roles.get(6).includes('closing'),'Chinese closing role missing');
  assert(roles.get(7).includes('signature'),'Chinese signature role missing');
}

{
  const scan=Mail.recognizeMailFrames([
    '孙教授 — 示例大学','📧 sun@example.edu','主题：123','尊敬的孙教授：',
    '这是一段足够长的正文，用于验证纯数字主题在主题标记之后不会被误判为记录编号。','此致\n敬礼—','孙潇阳'
  ],{includeWeak:true});
  assert.strictEqual(scan.records[0].subject,'123','numeric subject was mistaken for a record marker');
}

{
  const scan=Mail.recognizeMailFrames([
    '孙教授 — 示例大学','📧 sun@example.edu','主题：','123','尊敬的孙教授：',
    '这是一段足够长的正文，用于验证主题标签与纯数字主题分处两个原始段落时仍保持字段归属。','此致\n敬礼—','孙潇阳'
  ],{includeWeak:true});
  assert.strictEqual(scan.records[0].subject,'123','split numeric subject lost its positional field meaning');
}

{
  const scan=Mail.recognizeMailFrames([
    '孙教授 — 示例大学','📧 sun@example.edu','Subject: PhD enquiry','尊敬的孙教授：',
    '这是一段足够长的正文，用于验证此致与敬礼分别位于不同 Word 段落时仍能形成同一个结束语结构。',
    '此致','敬礼—','孙潇阳'
  ],{includeWeak:true});
  const record=scan.records[0];
  assert(record.body.includes('此致\n\n敬礼—'),'split Chinese closing was not joined into the mail');
  assert(record.body.endsWith('孙潇阳'),'split closing lost the signer');
  assert.strictEqual(record.structure.closeStartBlock,5);
  assert.strictEqual(record.structure.closeEndBlock,6);
  assert.strictEqual(record.structure.signatureEndBlock,7);
}

{
  const {record}=recognize(['Research source','https://example.edu/faculty','Attachments','CV.pdf','Transcript.pdf']);
  assert(!record.body.includes('Research source'),'bare source heading leaked into the body');
  assert(!record.body.includes('example.edu/faculty'),'source continuation leaked into the body');
  assert(record.sourceReferences.includes('https://example.edu/faculty'),'split source value was not preserved');
  assert.strictEqual(record.attachments,'CV.pdf; Transcript.pdf','split attachment list was not routed');
  assert(record.excludedBlocks.length>=5,'split metadata evidence was not fully retained');
}

{
  const scan=Mail.recognizeMailFrames([
    'Professor Yin — University of Queensland','📧 h.yin1@uq.edu.au','Subject: Prospective PhD Enquiry','Dear Professor Yin,',
    'Many thanks for sharing your recent work; it helped me refine the proposed study and its evaluation plan.',
    'Best regards to everyone in the laboratory, whose related work has also informed this research direction.',
    'A final substantive paragraph completes the request for doctoral supervision and future discussion.','Yours sincerely,','Xiong Guo'
  ],{includeWeak:true});
  const record=scan.records[0];
  assert(record.body.includes('Many thanks for sharing'),'ordinary gratitude sentence was mistaken for the closing');
  assert(record.body.includes('Best regards to everyone'),'ordinary regards sentence was mistaken for the closing');
  assert(record.body.endsWith('Xiong Guo'));
}

{
  const scan=Mail.recognizeMailFrames([
    'Professor Yin — University of Queensland','📧 h.yin1@uq.edu.au','Subject: Prospective PhD Enquiry','Dear Professor Yin,',
    'Thank you','This standalone acknowledgement is followed by more substantive body content and therefore is not the structural end of the message.',
    'The final paragraph completes the request for doctoral supervision, research discussion, and possible next steps.','Yours sincerely,','Xiong Guo'
  ],{includeWeak:true});
  const record=scan.records[0];
  assert(record.body.includes('This standalone acknowledgement'),'an early standalone closing phrase truncated later body content');
  assert(record.body.endsWith('Xiong Guo'));
}

{
  const scan=Mail.recognizeMailFrames([
    'Professor Yin — University of Queensland','first@example.edu','second@example.edu','Subject: Prospective PhD Enquiry','Dear Professor Yin,',
    'This complete email contains sufficient body text to test ambiguity handling between two equally plausible nearby recipient candidates.','Yours sincerely,','Xiong Guo'
  ],{includeWeak:true});
  assert.strictEqual(scan.records[0].recipients,'','equally plausible recipients should not be selected silently');
  assert(scan.records[0].issues.includes('收件人存在多个相近候选'));
  assert.strictEqual(scan.records[0].blockRoles.flatMap(item=>item.roles).filter(role=>role.role==='recipient-candidate').length,2,'ambiguous email locations should remain visible');
}

console.log('parser structure regression OK: split closings, punctuation, semantic roles, split metadata, and ambiguity handled');

{
  const scan=Mail.recognizeMailFrames([
    'Professor Yin — University of Queensland','📧 h.yin1@uq.edu.au','**Subject:** Markdown title','**Dear Professor Yin,**',
    'This sufficiently complete paragraph verifies that presentation markup does not change semantic component localization.','**Yours sincerely,**','**Xiong Guo**',
    '### Research source','- https://example.edu/profile'
  ],{includeWeak:true});
  const record=scan.records[0];
  assert.strictEqual(record.subject,'Markdown title');
  assert(record.body.endsWith('Xiong Guo'));
  assert(!record.body.includes('Research source'));
  assert(record.sourceReferences.includes('https://example.edu/profile'));
}

console.log('parser presentation regression OK: Markdown decoration does not alter field roles');
