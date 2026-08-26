const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');
const required=[
  ['post-import supplement dialog','id="nmda-supplement-preflight"'],
  ['roster box in preflight','id="nmda-preflight-roster-box"'],
  ['attachment box in preflight','id="nmda-preflight-attachment-box"'],
  ['attachment folder shortcut','for="nmda-attachment-dir"'],
  ['attachment file shortcut','for="nmda-attachment-files"'],
  ['explicit complete action','id="nmda-complete-supplement-preflight"'],
  ['batch-level preflight gate','function supplementPreflightNeedsDecision'],
  ['selection pauses for batch preparation','if(supplementPreflightNeedsDecision())'],
  ['step rail respects batch preparation','typeof supplementPreflightNeedsDecision'],
  ['persistent batch prep strip','id="nmda-batch-prep-strip"'],
  ['schedule preflight','id="nmda-schedule-context-cue"'],
  ['create preflight','id="nmda-create-preflight"'],
  ['safe create message','只创建 / 保存草稿，不自动发送'],
];
for(const [name,needle] of required) if(!js.includes(needle)) throw new Error(`context preflight missing: ${name}`);
if(js.includes('<summary>更多资料（可选）</summary>')) throw new Error('supplementary sources must not be hidden in a generic more-options disclosure');
if(!css.includes('v1.33 · Import preflight')) throw new Error('import preflight CSS layer missing');
console.log('context preflight contract OK: mail import is followed by one explicit roster + attachment preparation dialog, while later stages keep their own just-in-time checks');
