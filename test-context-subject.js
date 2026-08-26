const tasks=[
  {editKey:'current',subject:'Prospective PhD Enquiry',importExcluded:false},
  {editKey:'blank1',subject:'',importExcluded:false},
  {editKey:'existing',subject:'Existing subject',importExcluded:false},
  {editKey:'blank2',subject:'   ',importExcluded:false},
  {editKey:'excluded',subject:'',importExcluded:true}
];
const edits=new Map([['blank2',{recipients:'keep@example.edu'}]]);
const subject=tasks[0].subject;
const missing=tasks.filter(task=>!task.importExcluded && task.editKey!=='current' && !String(task.subject||'').trim());
for(const task of missing){
  const prev=edits.get(task.editKey)||{};
  edits.set(task.editKey,{...prev,subject});
}
if(missing.length!==2) throw new Error('context subject assist should target all other non-excluded blanks');
if(edits.get('blank1').subject!==subject||edits.get('blank2').subject!==subject) throw new Error('blank subjects not filled');
if(edits.has('existing')) throw new Error('existing subject overwritten');
if(edits.has('excluded')) throw new Error('excluded task modified');
if(edits.get('blank2').recipients!=='keep@example.edu') throw new Error('existing edit lost');
console.log('context subject regression OK: other blanks filled; existing/excluded subjects untouched');
