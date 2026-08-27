const fs=require('fs');
const js=fs.readFileSync(__dirname+'/content.js','utf8');
const css=fs.readFileSync(__dirname+'/content.css','utf8');

function must(condition,message){if(!condition)throw new Error(message);}
must(js.includes('id="nmda-duplicate-decision"'),'duplicate decision panel missing');
must(js.includes('id="nmda-duplicate-keep-selected"'),'keep-selected group action missing');
must(js.includes('id="nmda-duplicate-keep-all"'),'keep-all exception action missing');
must(js.includes('type="checkbox" data-duplicate-pick'),'duplicate candidates must support retaining an arbitrary subset, not radio-only single selection');
must(js.includes('!taskHasUnresolvedDuplicate(task)'),'generic batch confirmation must not silently resolve duplicate groups');
must(js.includes("else setTaskEdit(candidate,{importExcluded:true})"),'unselected duplicate candidates must be excluded after group decision');
must(js.includes("duplicateConfirmedGroups:[...new Set([...(prev.duplicateConfirmedGroups||[]),groupId])]"),'retained candidates must remember the explicit group decision');
must(!js.includes("...(task.duplicateGroupIds||[])])]});\n      confirmed++"),'generic selected confirmation must not auto-confirm duplicate group ids');
must(/\.nmda-duplicate-decision\s*\{/.test(css),'duplicate decision visual treatment missing');
console.log('duplicate decision contract OK: group-level subset selection, explicit keep-all, no silent dedupe confirmation');
