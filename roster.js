(() => {
  'use strict';

  const FIELD_ALIASES = {
    email:['邮箱','邮箱地址','导师邮箱','教授邮箱','联系邮箱','email','email address','mail','contact email'],
    name:['导师','导师姓名','教授','教授姓名','姓名','老师','联系人','supervisor','professor','faculty','name','contact name'],
    school:['学校','院校','大学','高校','所属学校','所属院校','机构','单位','university','school','institution','organisation','organization','affiliation'],
    batch:['批次','轮次','第几批','联系批次','发送批次','batch','round','wave'],
    status:['状态','联系状态','套磁状态','申请状态','status','contact status'],
    priority:['优先级','优先度','排序','等级','priority','rank','tier'],
    tags:['分类','标签','分组','类别','方向','tag','tags','category','group'],
    notes:['备注','说明','comment','comments','note','notes','remark','remarks']
  };

  function norm(v){return String(v??'').normalize('NFKC').trim().toLowerCase().replace(/[\s\u00a0\u200b_\-—–:：()（）\[\]【】<>《》\/\\.,，;；]+/g,'');}
  function clean(v){return String(v??'').normalize('NFKC').replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g,' ').replace(/\s+/g,' ').trim();}
  function emailOf(v){const m=String(v??'').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);return m?m[0].toLowerCase():'';}
  function emailsOf(v){
    const out=[],seen=new Set();
    for(const match of String(v??'').matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/ig)){
      const email=String(match[0]||'').toLowerCase();
      if(email&&!seen.has(email)){seen.add(email);out.push(email);}
    }
    return out;
  }
  function splitTags(v){return String(v??'').split(/[;；|,，\n]+/).map(clean).filter(Boolean);}
  function normalizeName(v){
    return clean(v).toLowerCase()
      .replace(/^\s*(?:prof(?:essor)?|dr|mr|mrs|ms)\.?\s+/i,'')
      .replace(/[（(][^）)]{0,60}[）)]/g,'')
      .replace(/\s+[—–-]\s+.*$/,'')
      .replace(/[^a-z0-9\p{L}]+/gu,'');
  }
  function looksGenericId(v){const s=clean(v);return !s||/^\d+(?:[-.]\d+)*$/.test(s)||/^\d+[-_]\d+$/.test(s);}
  function taskName(task){
    const id=clean(task?.id||''); if(id&&!looksGenericId(id)) return id.replace(/^\d+[.、)）:]\s*/,'').replace(/\s+[—–-]\s+.*$/,'').trim();
    const h=clean(task?.importHeading||'').replace(/^\d+[.、)）:]\s*/,'');
    if(h){const p=h.split(/\s+[—–-]\s+/)[0]; if(p&&!looksGenericId(p))return p.trim();}
    const s=clean(task?.importRecipientEvidence?.text||'');
    return s&&!emailOf(s)?s:'';
  }
  function schoolKey(v){
    const scheduler=globalThis.NMDAScheduler;
    return scheduler?.normalizeInstitutionKey ? scheduler.normalizeInstitutionKey(v) : norm(v).replace(/^the/,'');
  }
  function sameSchool(a,b){const x=schoolKey(a),y=schoolKey(b);return !!x&&!!y&&(x===y||x.includes(y)||y.includes(x));}

  function headerScore(header, aliases){
    const h=norm(header); if(!h)return 0; let best=0;
    for(const raw of aliases){const a=norm(raw);if(!a)continue;if(h===a)best=Math.max(best,100);else if(h.includes(a)||a.includes(h))best=Math.max(best,72+Math.min(20,a.length));}
    return best;
  }
  function detectColumns(rows){
    let best={row:0,score:-1,map:{}};
    const limit=Math.min(rows?.length||0,40);
    for(let r=0;r<limit;r++){
      const row=rows[r]||[];const map={};let score=0,recognized=0;
      for(let c=0;c<row.length;c++){
        for(const [field,aliases] of Object.entries(FIELD_ALIASES)){
          const s=headerScore(row[c],aliases);if(s && (!map[field]||s>map[field].score)){map[field]={index:c,score:s};}
        }
      }
      for(const x of Object.values(map)){score+=x.score;recognized++;}
      score+=recognized*120-r*3;
      if(score>best.score)best={row:r,score,map};
    }
    return best;
  }
  function likelyName(row,used=new Set()){
    for(let i=0;i<row.length;i++){
      if(used.has(i))continue;const s=clean(row[i]);if(!s||emailOf(s)||s.length>100)continue;
      if(/(?:university|college|school|institute|大学|学院|学校)/i.test(s))continue;
      if(/^(?:yes|no|是|否|第一批|第二批|第三批|a|b|c)$/i.test(s))continue;
      if(/[A-Za-z\p{L}]/u.test(s)&&s.split(/\s+/).length<=8)return s;
    }
    return '';
  }
  function likelySchool(row,used=new Set()){
    for(let i=0;i<row.length;i++){
      if(used.has(i))continue;const s=clean(row[i]);if(!s||emailOf(s)||s.length>180)continue;
      if(/(?:university|college|school|institute|academy|polytechnic|大学|学院|学校|研究院|理工|师范|商学院)/i.test(s))return s;
    }
    return '';
  }

  function parseDataset(dataset){
    const entries=[],warnings=[];
    for(const set of (dataset?.sheets||dataset?.recordSets||[])){
      const rows=set?.rows||[]; if(!rows.length)continue;
      const d=detectColumns(rows);
      const hasIdentityHeader=!!(d.map.email||d.map.name||d.map.school);
      const start=hasIdentityHeader?Math.min(rows.length,d.row+1):0;
      for(let r=start;r<rows.length;r++){
        const row=rows[r]||[];if(!row.some(v=>clean(v)))continue;
        const get=f=>d.map[f]?row[d.map[f].index]:'';
        const used=new Set(Object.values(d.map).map(x=>x.index));
        let email=emailOf(get('email'));
        if(!email){for(const v of row){email=emailOf(v);if(email)break;}}
        let name=clean(get('name'))||likelyName(row,used);
        let school=clean(get('school'))||likelySchool(row,used);
        if(!hasIdentityHeader && !email && !(name&&school)) continue;
        const batch=clean(get('batch')),status=clean(get('status')),priority=clean(get('priority')),tags=splitTags(get('tags')),notes=clean(get('notes'));
        if(!email&&!name&&!school)continue;
        entries.push({
          key:`r${entries.length+1}`,email,name,school,batch,status,priority,tags,notes,
          source:set.source||set.name||'',collection:set.name||'',sourceRow:r+1,
          nameKey:normalizeName(name),schoolKey:schoolKey(school)
        });
      }
    }
    const emailCounts=new Map(),nameCounts=new Map();
    for(const e of entries){if(e.email)emailCounts.set(e.email,(emailCounts.get(e.email)||0)+1);if(e.nameKey)nameCounts.set(e.nameKey,(nameCounts.get(e.nameKey)||0)+1);}
    const duplicates=entries.filter(e=>(e.email&&emailCounts.get(e.email)>1)||(!e.email&&e.nameKey&&nameCounts.get(e.nameKey)>1));
    if(duplicates.length)warnings.push(`总名单中有 ${duplicates.length} 条身份重复记录，交叉核验时会保守处理。`);
    return {entries,warnings,stats:{total:entries.length,withEmail:entries.filter(e=>e.email).length,withSchool:entries.filter(e=>e.school).length,duplicates:duplicates.length}};
  }

  function buildMatchIndex(entries){
    const list=Array.isArray(entries)?entries:[];
    const byEmail=new Map(),byName=new Map(),byKey=new Map();
    for(const entry of list){
      if(entry?.key)byKey.set(entry.key,entry);
      if(entry?.email){if(!byEmail.has(entry.email))byEmail.set(entry.email,[]);byEmail.get(entry.email).push(entry);}
      if(entry?.nameKey){if(!byName.has(entry.nameKey))byName.set(entry.nameKey,[]);byName.get(entry.nameKey).push(entry);}
    }
    return {entries:list,byEmail,byName,byKey};
  }

  function matchOne(task,entriesOrIndex){
    const index=Array.isArray(entriesOrIndex)?buildMatchIndex(entriesOrIndex):(entriesOrIndex?.byEmail?entriesOrIndex:buildMatchIndex([]));
    const email=emailOf(task?.recipients||''),name=taskName(task),nameKey=normalizeName(name),school=clean(task?.school||'');
    let candidates=[];
    if(email){candidates=(index.byEmail.get(email)||[]).map(e=>({entry:e,score:100,by:'email'}));}
    if(!candidates.length&&nameKey&&school){candidates=(index.byName.get(nameKey)||[]).filter(e=>e.school&&sameSchool(e.school,school)).map(e=>({entry:e,score:94,by:'name+school'}));}
    if(!candidates.length&&nameKey){
      const same=index.byName.get(nameKey)||[];if(same.length===1)candidates=[{entry:same[0],score:82,by:'unique-name'}];else if(same.length>1)candidates=same.map(e=>({entry:e,score:68,by:'ambiguous-name'}));
    }
    if(!candidates.length)return {status:'off-roster',task,email,name,candidates:[]};
    const top=candidates[0],ties=candidates.filter(c=>c.score===top.score);
    if(ties.length>1)return {status:'ambiguous',task,email,name,candidates:ties,score:top.score,by:top.by};
    const entry=top.entry;
    const schoolConflict=!!(school&&entry.school&&!sameSchool(school,entry.school));
    return {status:schoolConflict?'conflict':'matched',task,email,name,entry,score:top.score,by:top.by,schoolConflict,
      schoolSupplement:!school&&!!entry.school&&top.score>=82,
      emailCandidate:!email&&!!entry.email&&top.score>=82?entry.email:''};
  }

  function auditTaskDuplicates(tasks){
    const list=Array.isArray(tasks)?tasks.filter(Boolean):[];
    const taskKey=(task,index)=>String(task?.editKey||task?.id||`task-${index}`);
    const byEmail=new Map(),byNameSchool=new Map();
    list.forEach((task,index)=>{
      for(const email of emailsOf(task?.recipients||'')){
        if(!byEmail.has(email))byEmail.set(email,[]);
        byEmail.get(email).push(task);
      }
      const nameKey=normalizeName(taskName(task));
      const institutionKey=schoolKey(task?.school||'');
      if(nameKey&&institutionKey){
        const key=`${nameKey}|${institutionKey}`;
        if(!byNameSchool.has(key))byNameSchool.set(key,{name:taskName(task),school:clean(task?.school||''),tasks:[]});
        byNameSchool.get(key).tasks.push(task);
      }
    });

    const groups=[],coveredPairs=new Set();
    const addPairs=groupTasks=>{
      for(let i=0;i<groupTasks.length;i++)for(let j=i+1;j<groupTasks.length;j++){
        const a=taskKey(groupTasks[i],i),b=taskKey(groupTasks[j],j);coveredPairs.add([a,b].sort().join('::'));
      }
    };
    for(const [email,groupTasks] of byEmail){
      const unique=[...new Map(groupTasks.map((task,index)=>[taskKey(task,index),task])).values()];
      if(unique.length<2)continue;
      groups.push({id:`email:${email}`,type:'exact-email',confidence:100,email,label:email,tasks:unique});
      addPairs(unique);
    }
    for(const [key,group] of byNameSchool){
      const unique=[...new Map(group.tasks.map((task,index)=>[taskKey(task,index),task])).values()];
      if(unique.length<2)continue;
      let hasUncoveredPair=false;
      for(let i=0;i<unique.length&&!hasUncoveredPair;i++)for(let j=i+1;j<unique.length;j++){
        const pair=[taskKey(unique[i],i),taskKey(unique[j],j)].sort().join('::');
        if(!coveredPairs.has(pair)){hasUncoveredPair=true;break;}
      }
      if(!hasUncoveredPair)continue;
      groups.push({id:`name-school:${key}`,type:'name-school',confidence:90,name:group.name,school:group.school,label:[group.name,group.school].filter(Boolean).join(' · '),tasks:unique});
    }
    const affected=new Set();for(const group of groups)for(const task of group.tasks)affected.add(taskKey(task,0));
    return {
      groups,
      exactGroups:groups.filter(group=>group.type==='exact-email'),
      probableGroups:groups.filter(group=>group.type==='name-school'),
      summary:{tasks:list.length,groups:groups.length,exact:groups.filter(group=>group.type==='exact-email').length,probable:groups.filter(group=>group.type==='name-school').length,affectedTasks:affected.size}
    };
  }

  function crossCheck(tasks,entries){
    const list=entries||[],index=buildMatchIndex(list);
    const matches=(tasks||[]).map(task=>matchOne(task,index));
    const byRoster=new Map();
    for(const m of matches){if(m.entry){if(!byRoster.has(m.entry.key))byRoster.set(m.entry.key,[]);byRoster.get(m.entry.key).push(m);}}
    const duplicateMatches=[];
    for(const [key,listOfMatches] of byRoster){if(listOfMatches.length>1)duplicateMatches.push({entry:index.byKey.get(key),matches:listOfMatches});}
    const matchedKeys=new Set([...byRoster.keys()]);
    const unwritten=list.filter(e=>!matchedKeys.has(e.key));
    return {
      matches,unwritten,duplicateMatches,
      summary:{
        roster:(entries||[]).length,tasks:(tasks||[]).length,
        matched:matches.filter(m=>m.status==='matched'||m.status==='conflict').length,
        offRoster:matches.filter(m=>m.status==='off-roster').length,
        ambiguous:matches.filter(m=>m.status==='ambiguous').length,
        conflicts:matches.filter(m=>m.status==='conflict').length,
        unwritten:unwritten.length,duplicates:duplicateMatches.length,
        schoolSupplements:matches.filter(m=>m.schoolSupplement).length,
        emailCandidates:matches.filter(m=>m.emailCandidate).length
      }
    };
  }

  globalThis.NMDARoster={FIELD_ALIASES,normalizeName,taskName,schoolKey,parseDataset,auditTaskDuplicates,crossCheck,matchOne,buildMatchIndex};
})();
