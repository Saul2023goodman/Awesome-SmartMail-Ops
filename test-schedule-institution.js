const assert=require('assert');
const fs=require('fs');
require('./scheduler.js');

const Scheduler=globalThis.NMDAScheduler;

assert.equal(Scheduler.institutionEvidence('B','person@anu.edu.au','imported').valid,false,'single-letter batch codes are not institutions');
assert.equal(Scheduler.institutionEvidence('第三批','person@anu.edu.au','imported').valid,false,'batch labels are not institutions');
assert.equal(Scheduler.institutionEvidence('ANU','person@anu.edu.au','imported').valid,true,'an acronym matching the academic domain is usable');
assert.equal(Scheduler.institutionEvidence('UQ','person@gmail.com','roster').valid,true,'a roster-provided acronym is trusted');

const fallback=Scheduler.groupForTask({editKey:'t1',recipients:'person@anu.edu.au',school:'B',schoolSource:'imported'});
assert.equal(fallback.key,'domain:anu.edu.au');
assert.equal(fallback.source,'domain');
assert(!fallback.label.includes('B'),'invalid source values must not leak into schedule labels');

const start=new Date(Date.now()+2*60*60*1000);start.setSeconds(0,0);
const tasks=[
  {editKey:'a',id:'a',recipients:'a@anu.edu.au',school:'A',schoolSource:'imported',enabled:true,status:'ready',scheduleAt:''},
  {editKey:'b',id:'b',recipients:'b@anu.edu.au',school:'B',schoolSource:'imported',enabled:true,status:'ready',scheduleAt:''}
];
const plan=Scheduler.buildPlan(tasks,{startAt:Scheduler.formatLocalDateTime(start),maxPerGroupPerRound:1,intervalDays:7,preserveExisting:true},new Date());
assert.equal(plan.summary.groups,1,'invalid A/B labels must not split one academic domain into fake schools');
assert.deepEqual(plan.assignments.map(item=>item.roundIndex),[0,1],'same-domain recipients must still be staggered');

const content=fs.readFileSync(__dirname+'/content.js','utf8');
assert(content.includes('Scheduler?.institutionEvidence?.(schoolRaw,recipients,schoolSource)'),'task construction must sanitize institution values before roster and scheduling');
assert(content.includes("ignoredSchool:schoolRaw&&!school?schoolRaw:''"),'discarded schedule metadata should remain internally traceable without entering the table');
assert(!content.includes("if(match.status==='conflict')task.rosterIssues.push"),'institution-only roster differences must not block draft creation');

console.log('schedule institution regression OK: short codes hidden; verified institution/domain grouping preserved');
