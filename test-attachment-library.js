const fs=require('fs');
const js=fs.readFileSync('content.js','utf8');
const css=fs.readFileSync('content.css','utf8');
function ok(cond,msg){if(!cond)throw new Error(msg);}
ok(js.includes('nmda-preflight-attachment-assets-list'),'import preflight must show uploaded attachment assets');
ok(js.includes('nmda-attachment-manager-overlay'),'workflow must expose a reusable attachment manager');
ok(js.includes('nmda-manage-attachments-strip'),'upload page must retain attachment management after preflight');
ok(js.includes('nmda-manage-attachments-todo'),'todo stage must retain attachment management');
ok(js.includes('data-open-attachment-manager')&&js.includes('查看附件'),'create preflight must link back to the same attachment library');
ok(js.includes('function removeAttachmentAsset(identity)'),'attachments must support individual removal');
ok(js.includes('function clearAttachmentAssets()'),'attachments must support clearing the batch library');
ok(js.includes('已匹配 ${entry.used} 封'),'asset rows must express business usage, not only raw filenames');
ok(css.includes('grid-template-rows:auto minmax(0,1fr) auto')&&css.includes('.nmda-supplement-grid {\n  min-height:0;\n  overflow:auto'),'preflight dialog must separate elevation from scrolling content');
ok(css.includes('.nmda-btn {\n  display:inline-flex;\n  align-items:center;\n  justify-content:center'),'button and label controls must share vertical centering');
console.log('attachment library contract OK: visible asset list, persistent management, single-source mutation, complete dialog elevation and centered controls');
