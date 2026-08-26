const tasks=[
  {editKey:'a',recipients:'a@example.edu',subject:'A',body:'Body A',rosterIssues:[]},
  {editKey:'b',recipients:'b@example.edu',subject:'',body:'Body B',rosterIssues:[]},
  {editKey:'c',recipients:'bad-address',subject:'C',body:'Body C',rosterIssues:['school mismatch']},
  {editKey:'d',recipients:'d@example.edu',subject:'D',body:'Body D',rosterIssues:['school mismatch']}
];
const selected=new Set(['a','b','c','d']);
const edits=new Map();
const recipientLooksValid=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim());
let confirmed=0,blocked=0;
for(const task of tasks.filter(t=>selected.has(t.editKey))){
  const coreValid=recipientLooksValid(task.recipients)&&!!String(task.subject||'').trim()&&!!String(task.body||'').trim();
  if(!coreValid){blocked++;continue;}
  const prev=edits.get(task.editKey)||{};
  edits.set(task.editKey,{...prev,reviewConfirmed:true,rosterConfirmed:(task.rosterIssues||[]).length?true:!!prev.rosterConfirmed});
  confirmed++;
}
if(confirmed!==2||blocked!==2) throw new Error(`expected 2 confirmed / 2 blocked; got ${confirmed}/${blocked}`);
if(!edits.get('a')?.reviewConfirmed||!edits.get('d')?.reviewConfirmed) throw new Error('valid selected items were not confirmed');
if(edits.has('b')||edits.has('c')) throw new Error('invalid selected items must remain unconfirmed');
if(!edits.get('d')?.rosterConfirmed) throw new Error('selected valid roster issue should be explicitly confirmed');
console.log('review batch regression OK: valid selected items confirmed in one action; incomplete items remain pending');
