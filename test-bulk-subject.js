const tasks=[
  {editKey:'a',subject:'',recipients:'a@example.edu'},
  {editKey:'b',subject:'Existing subject',recipients:'b@example.edu'},
  {editKey:'c',subject:'   ',recipients:'c@example.edu'}
];
const edits=new Map([['c',{recipients:'c@example.edu'}]]);
const value='Prospective PhD Application — Junhao Jiao';
const missing=tasks.filter(t=>!String(t.subject||'').trim());
for(const task of missing){const prev=edits.get(task.editKey)||{};if(!String(task.subject||'').trim())edits.set(task.editKey,{...prev,subject:value});}
if(missing.length!==2)throw new Error('missing count');
if(edits.get('a').subject!==value||edits.get('c').subject!==value)throw new Error('blank fill failed');
if(edits.has('b'))throw new Error('existing subject overwritten');
if(edits.get('c').recipients!=='c@example.edu')throw new Error('existing edit lost');
console.log('bulk subject regression OK:', missing.length, 'filled; existing subject untouched; prior edits preserved');
