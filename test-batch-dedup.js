const fs=require('fs');const vm=require('vm');const assert=require('assert');
const ctx={console};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('roster.js','utf8'),ctx);
const R=ctx.NMDARoster;

let audit=R.auditTaskDuplicates([
  {editKey:'a',id:'Prof Ada',recipients:'ada@example.edu',school:'Example University'},
  {editKey:'b',id:'Prof Bob',recipients:'Ada <ada@example.edu>',school:'Other University'},
  {editKey:'c',id:'Prof Carol',recipients:'carol@example.edu',school:'Example University'}
]);
assert.equal(audit.summary.groups,1,'same recipient email must be detected without a roster');
assert.equal(audit.summary.exact,1);assert.equal(audit.summary.affectedTasks,2);
assert.equal(audit.groups[0].email,'ada@example.edu');

audit=R.auditTaskDuplicates([
  {editKey:'a',id:'Ada Smith',recipients:'',school:'Example University'},
  {editKey:'b',id:'Prof. Ada Smith',recipients:'',school:'Example University'},
  {editKey:'c',id:'Ada Smith',recipients:'',school:'Different University'}
]);
assert.equal(audit.summary.groups,1,'same normalized name + institution should be a probable duplicate');
assert.equal(audit.summary.probable,1);assert.equal(audit.groups[0].type,'name-school');

audit=R.auditTaskDuplicates([
  {editKey:'a',id:'Ada Smith',recipients:'ada@example.edu; team@example.edu',school:'Example University'},
  {editKey:'b',id:'Ada Smith',recipients:'team@example.edu',school:'Example University'}
]);
assert.equal(audit.summary.exact,1,'shared address inside multi-recipient strings must be detected');
assert.equal(audit.summary.groups,1,'exact email evidence must suppress redundant name+school group for same pair');

const content=fs.readFileSync('content.js','utf8');
assert(content.includes('applyBatchDuplicateAudit(tasks);\n    applyRosterCrossCheck(tasks);'),'batch self-check must run before optional roster cross-check');
assert(content.includes("card.hidden=!tasks.length&&!state.entries.length"),'contact audit card must be available with tasks even when no roster exists');
assert(content.includes('当前批次未发现重复联系人；无需总名单也会自动完成这一步'),'UI must explain roster-independent dedupe');
assert(content.includes('duplicateConfirmedGroups'),'duplicate confirmation must be scoped to stable duplicate groups');
console.log('batch dedupe regression OK: roster-independent exact/probable matching, multi-recipient sharing, and UI flow contract');
