const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync('roster.js','utf8');
const sandbox={globalThis:{}};vm.createContext(sandbox);vm.runInContext(code,sandbox);
const R=sandbox.globalThis.NMDARoster;
assert(R && typeof R.crossCheck==='function' && typeof R.buildMatchIndex==='function');
const entries=[
  {key:'r1',name:'Alice Zhang',nameKey:'alicezhang',email:'alice@example.com',school:'School A'},
  {key:'r2',name:'Bob Li',nameKey:'bobli',email:'bob@example.com',school:'School B'},
  {key:'r3',name:'Bob Li',nameKey:'bobli',email:'bob2@example.com',school:'School C'}
];
const result=R.crossCheck([
  {recipients:'alice@example.com',school:'',subject:'Hello Alice'},
  {recipients:'Bob Li <bob@example.com>',school:'School B',subject:'Hello Bob'},
  {recipients:'missing@example.com',school:'',subject:'Unknown'}
],entries);
assert.strictEqual(result.matches.length,3);
assert.strictEqual(result.matches[0].entry?.email,'alice@example.com');
assert.strictEqual(result.matches[1].entry?.email,'bob@example.com');
assert.strictEqual(result.matches[2].status,'off-roster');
console.log('roster indexed lookup regression OK');
