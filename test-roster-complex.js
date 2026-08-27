const fs=require('fs'),vm=require('vm'),assert=require('assert');
const sandbox={globalThis:{}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('scheduler.js','utf8'),sandbox);
vm.runInContext(fs.readFileSync('roster.js','utf8'),sandbox);
const R=sandbox.globalThis.NMDARoster,S=sandbox.globalThis.NMDAScheduler;

const parsed=R.parseDataset({sheets:[{name:'Roster',source:'merged.xlsx',rows:[
  ['University','School/Department','Supervisor','Email'],
  ['RMIT University','Mathematical Sciences','Dr. Haydar Demirhan','haydar.demirhan@rmit.edu.au'],
  ['', '', 'Associate Professor Brett Carter','brett.carter@rmit.edu.au'],
  ['', '', 'Dr. Alan Both','alan.both@rmit.edu.au'],
  [],
  ['University of Wollongong','School of Science','Professor Sarah Hamylton','sarah_hamylton@uow.edu.au']
]}]});

assert.strictEqual(parsed.entries.length,4);
assert.strictEqual(parsed.entries[1].school,'RMIT University','merged/blank hierarchy should inherit institution');
assert.strictEqual(parsed.entries[2].school,'RMIT University','department column must not replace institution');
assert.strictEqual(parsed.entries[3].school,'University of Wollongong','empty separator must reset hierarchy');

const duplicate=[...parsed.entries,{...parsed.entries[1],key:'duplicate-rich',batch:'第一批'}];
const audit=R.crossCheck([
  {editKey:'a',id:'2-3',recipients:'Brett Carter <brett.carter@rmit.edu.au>; assistant@example.com',school:''},
  {editKey:'b',id:'Sarah Hamylton',recipients:'',school:'Wollongong University'}
],duplicate);
assert.strictEqual(audit.matches[0].status,'matched');
assert.strictEqual(audit.matches[0].entry.school,'RMIT University');
assert.strictEqual(audit.matches[0].schoolSupplement,true);
assert.strictEqual(audit.matches[1].status,'matched');
assert.strictEqual(R.sameSchool('University of Wollongong','Wollongong University'),true);
const malformed=R.parseDataset({sheets:[{name:'Bad email',rows:[['University','Supervisor','Email'],['UOW','Professor Example','person@uow.edu.x']]}]});
assert.strictEqual(malformed.stats.invalidEmails,1,'malformed trailing domain must not be accepted as a partial email');
assert.strictEqual(malformed.entries[0].email,'');

const group=S.groupForTask({editKey:'x',recipients:'person@faculty.example.edu.au',school:'Example University',schoolSource:'roster'});
assert.strictEqual(group.key,'school:exampleuniversity','trusted institution must outrank domain grouping');
console.log('complex roster + institution scheduling regression OK');
