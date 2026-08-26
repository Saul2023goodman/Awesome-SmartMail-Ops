const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');
const required=[
  ['visible roster import cue','id="nmda-roster-context-cue"'],
  ['direct roster upload','id="nmda-roster-upload-action"'],
  ['explicit optional skip','id="nmda-roster-skip"'],
  ['roster decision state','function rosterContextNeedsDecision'],
  ['selection pauses for roster choice','if(rosterContextNeedsDecision())'],
  ['step rail respects context decision','contextPending=hasSource'],
  ['attachment just-in-time cue','id="nmda-attachment-context-cue"'],
  ['attachment folder shortcut','for="nmda-attachment-dir"'],
  ['schedule preflight','id="nmda-schedule-context-cue"'],
  ['create preflight','id="nmda-create-preflight"'],
  ['safe create message','只创建 / 保存草稿，不自动发送'],
];
for(const [name,needle] of required) if(!js.includes(needle)) throw new Error(`context preflight missing: ${name}`);
if(js.includes('<summary>更多资料（可选）</summary>')) throw new Error('reference roster must not be hidden in generic more-options disclosure');
if(!css.includes('v1.31 · Context preflight')) throw new Error('context preflight CSS layer missing');
console.log('context preflight contract OK: roster is prompted at import; attachment, schedule and create stages provide just-in-time context without turning optional data into a hard requirement');
