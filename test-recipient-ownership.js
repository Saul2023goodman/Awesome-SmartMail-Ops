const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

vm.runInThisContext(fs.readFileSync('mail-recognizer.js','utf8'),{filename:'mail-recognizer.js'});
const Mail=globalThis.NMDAMailRecognizer;

function scan(blocks){return Mail.recognizeMailFrames(blocks,{includeWeak:true});}

// Regression from v1.21: the previous frame's post-close exclusion pass must not consume
// a next-record recipient that appears before the next record marker/heading/Subject.
{
  const blocks=[
    'Professor Liu — University A','📧 liu@university-a.edu','Subject: First','Dear Professor Liu,',
    'This first email has enough substantive content to establish a stable mail frame and test ownership boundaries.',
    'Yours sincerely,','Junhao Jiao','✏️ 契合点：数字化转型与消费者研究',
    '📧 michel.desbordes@universite-paris-saclay.fr（请以官网为准）','9.','Michel Desbordes — Université Paris-Saclay',
    'Subject: PhD Application Fall 2027 — Junhao Jiao｜Sports Marketing & Event Management','Dear Prof. Desbordes,',
    'This second email has enough substantive content to verify that the next recipient remains owned by the second mail frame.',
    'Yours sincerely,','Junhao Jiao'
  ];
  const result=scan(blocks);
  assert.strictEqual(result.records.length,2);
  assert.strictEqual(result.records[1].recipients,'michel.desbordes@universite-paris-saclay.fr');
  assert(result.records[0].consumedEndBlock < 8,'previous frame consumed the next recipient preamble');
  assert(!result.records[0].excludedBlocks.some(item=>/michel\.desbordes/i.test(item.text||'')),'next recipient was attached to previous frame exclusions');
}

// Markdown identity headings can carry the only recipient email. They must be recognized as
// record headings before generic Markdown/noise handling, otherwise consumedEndBlock hides them.
{
  const blocks=[
    'Professor A — University A','📧 a@university-a.edu','Subject: First','Dear Professor A,',
    'This first email has sufficient body content for a stable frame and a completed signature boundary.',
    'Yours sincerely,','Junhao Jiao','改写点标注：','- 调整措辞','---','# 第一部分','## 香港地区',
    '### 1. Jin Li — jli1@hku.hk','**完整套磁信：**','---','**Subject: PhD Application Fall 2027 — Junhao Jiao｜Sports Economics**','Dear Prof. Li,',
    'This second email has sufficient body content to verify an email embedded in a Markdown identity heading.',
    'Yours sincerely,','Junhao Jiao'
  ];
  const result=scan(blocks);
  assert.strictEqual(result.records.length,2);
  assert.strictEqual(result.records[1].recipients,'jli1@hku.hk');
  assert(/Jin Li/.test(result.records[1].heading),'Markdown identity heading was not preserved for the next frame');
}

// The safety rule added in v1.20 remains intact: an email inside previous-record source metadata
// must not become the next recipient simply because it is close to the next Subject.
{
  const result=scan([
    'Professor A — University A','📧 a@university-a.edu','Subject: First','Dear Professor A,',
    'This first email has sufficient body content for stable parsing and source metadata isolation.',
    'Yours sincerely,','Junhao Jiao','Research source: wrong-recipient@example.edu — official university page',
    'Subject: Second','Dear Professor B,','This second email has enough body content to remain a valid mail frame.','Yours sincerely,','Junhao Jiao'
  ]);
  assert.strictEqual(result.records.length,2);
  assert.notStrictEqual(result.records[1].recipients,'wrong-recipient@example.edu');
}

console.log('recipient ownership regression OK: next-record preambles survive tail isolation; source-email leakage remains blocked');
