const tasks=[
  {editKey:'a',subject:'',recipients:'a@example.edu'},
  {editKey:'b',subject:'Existing subject',recipients:'b@example.edu'},
  {editKey:'c',subject:'   ',recipients:'c@example.edu'},
  {editKey:'d',subject:'',recipients:'d@example.edu'}
];
const selected=new Set(['a','b','c']);
const edits=new Map([['c',{recipients:'c@example.edu'}]]);
const value='Prospective PhD Application — Junhao Jiao';
const selectedTasks=tasks.filter(t=>selected.has(t.editKey));
const missing=selectedTasks.filter(t=>!String(t.subject||'').trim());
for(const task of missing){
  const prev=edits.get(task.editKey)||{};
  if(!String(task.subject||'').trim()) edits.set(task.editKey,{...prev,subject:value});
}
if(missing.length!==2) throw new Error('selected missing count');
if(edits.get('a').subject!==value||edits.get('c').subject!==value) throw new Error('selected blank fill failed');
if(edits.has('b')) throw new Error('existing selected subject overwritten');
if(edits.has('d')) throw new Error('unselected blank subject must not be filled');
if(edits.get('c').recipients!=='c@example.edu') throw new Error('existing edit lost');
console.log('bulk subject regression OK: selected blanks filled; existing and unselected subjects untouched');
