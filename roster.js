(() => {
  'use strict';

  const FIELD_ALIASES = {
    email:['邮箱','邮箱地址','导师邮箱','教授邮箱','联系邮箱','email','email address','mail','contact email'],
    name:['导师','导师姓名','教授','教授姓名','姓名','老师','联系人','supervisor','professor','faculty','name','contact name'],
    school:['学校','院校','大学','高校','所属学校','所属院校','机构','单位','university','school','institution','organisation','organization','affiliation'],
    country:['国家','国家地区','国家/地区','地区','所在国家','country','country/region','country region','region'],
    // Roster round is a within-school priority concept, never a scheduling batch.
    // Deliberately do not treat generic '批次 / batch / wave / 发送批次' headers as priority rounds.
    batch:['轮次','第几轮','联系轮次','同校轮次','优先轮次','优先级轮次','round','priority round','priorityround'],
    status:['状态','联系状态','套磁状态','申请状态','status','contact status'],
    priority:['套磁顺序','联系顺序','发送顺序','优先级','优先度','排序','顺序','等级','priority','rank','tier','order','sequence','contact order','outreach order'],
    schedule:['定时','定时时间','发送时间','计划时间','计划发送','预约发送','scheduled at','schedule','send time','send date','scheduled time'],
    tags:['分类','标签','分组','类别','方向','tag','tags','category','group'],
    notes:['备注','说明','comment','comments','note','notes','remark','remarks']
  };

  function norm(v){return String(v??'').normalize('NFKC').trim().toLowerCase().replace(/[\s\u00a0\u200b_\-—–:：()（）\[\]【】<>《》\/\\.,，;；]+/g,'');}
  function decodeEscapedUnicode(v){
    return String(v??'')
      .replace(/#U([0-9a-f]{4,6})/giu,(_,hex)=>{try{return String.fromCodePoint(parseInt(hex,16));}catch(_e){return _;}})
      .replace(/_x([0-9a-f]{4})_/giu,(_,hex)=>{try{return String.fromCharCode(parseInt(hex,16));}catch(_e){return _;}});
  }
  function clean(v){return decodeEscapedUnicode(v).normalize('NFKC').replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g,' ').replace(/\s+/g,' ').trim();}
  function foldLatin(v){return clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'');}
  function emailOf(v){const m=String(v??'').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}(?![A-Z0-9.\-])/i);return m?m[0].toLowerCase():'';}
  function emailsOf(v){
    const out=[],seen=new Set();
    for(const match of String(v??'').matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}(?![A-Z0-9.\-])/ig)){
      const email=String(match[0]||'').toLowerCase();
      if(email&&!seen.has(email)){seen.add(email);out.push(email);}
    }
    return out;
  }
  function splitTags(v){return String(v??'').split(/[;；|,，\n]+/).map(clean).filter(Boolean);}
  function parsePriorityOrder(v){
    const raw=clean(v);if(!raw)return null;
    const scheduler=globalThis.NMDAScheduler;
    const parsed=scheduler?.parsePriority?.(raw);
    if(parsed?.has&&Number.isFinite(parsed.rank))return parsed.rank;
    const m=raw.match(/(?:第\s*)?(\d+(?:\.\d+)?)/);return m?Number(m[1]):null;
  }
  function normalizeName(v){
    return foldLatin(v).toLowerCase()
      .replace(/^\s*(?:prof(?:essor)?|dr|mr|mrs|ms)\.?\s+/i,'')
      .replace(/[（(][^）)]{0,60}[）)]/g,'')
      .replace(/\s+[—–-]\s+.*$/,'')
      .replace(/[^a-z0-9\p{L}]+/gu,'');
  }
  function nameKeys(v){
    const raw=clean(v)
      .replace(/^\s*(?:(?:associate|assistant|adjunct|emeritus)\s+)?(?:prof(?:essor)?|dr|mr|mrs|ms)\.?\s+/i,'')
      .replace(/[（(][^）)]{0,60}[）)]/g,'')
      .replace(/\s+[—–-]\s+.*$/,'')
      .trim();
    if(!raw||emailOf(raw))return[];
    const out=new Set(),direct=normalizeName(raw);if(direct)out.add(direct);
    const comma=raw.split(/\s*[,，]\s*/).filter(Boolean);
    if(comma.length===2){const swapped=normalizeName(`${comma[1]} ${comma[0]}`);if(swapped)out.add(swapped);}
    const latinTokens=raw.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(token=>token&&!/^(?:professor|prof|doctor|dr|associate|assistant|adjunct|emeritus|mr|mrs|ms)$/.test(token));
    if(latinTokens.length>=2&&latinTokens.length<=8)out.add([...latinTokens].sort().join(''));
    return [...out];
  }
  function sourceNameCandidate(task){
    const raw=clean(task?.sourceFile||task?.collectionName||'');
    if(!raw)return'';
    const base=raw.split(/[\\/]/).pop()||raw;
    return clean(base.replace(/\.(?:docx?|docm|dotx|txt|html?|rtf|pdf)$/i,'').replace(/\.paras$/i,'').replace(/\s*\((?:copy|副本|\d+)\)\s*$/i,''));
  }
  function surnameKey(v){
    const raw=foldLatin(v).toLowerCase()
      .replace(/^\s*(?:(?:associate|assistant|adjunct|emeritus)\s+)?(?:prof(?:essor)?|dr|mr|mrs|ms)\.?\s+/i,'')
      .replace(/[（(][^）)]{0,60}[）)]/g,'')
      .replace(/[^a-z0-9\p{L}'’\-]+/gu,' ')
      .trim();
    if(!raw||emailOf(raw))return'';
    const tokens=raw.split(/\s+/).filter(Boolean);
    return normalizeName(tokens[tokens.length-1]||'');
  }
  function looksGenericId(v){const s=clean(v);return !s||/^\d+(?:[-.]\d+)*$/.test(s)||/^\d+[-_]\d+$/.test(s);}
  function taskNameCandidates(task){
    const values=[task?.name,task?.supervisor,task?.contactName];
    const sourceName=sourceNameCandidate(task);if(sourceName)values.push(sourceName);
    const evidence=clean(task?.importRecipientEvidence?.text||'');if(evidence&&!emailOf(evidence))values.push(evidence);
    const rawSalutation=clean(task?.importSalutation||'') || clean(String(task?.body||'').match(/(?:^|\n)\s*(?:Dear|Hello|Hi)\s+([^\n,:：]{2,90})/i)?.[1]||'');
    const salutation=rawSalutation.replace(/^\s*(?:dear|hello|hi)\s+/i,'').replace(/^\s*(?:(?:associate|assistant)\s+)?(?:prof(?:essor)?|dr)\.?\s+/i,'').replace(/[,:：].*$/,'').trim();
    if(salutation&&!emailOf(salutation))values.push(salutation);
    const heading=clean(task?.importHeading||'').replace(/^\d+[.、)）:]\s*/,'');
    if(heading)values.push(heading.split(/\s+[—–-]\s+/)[0]);
    for(const part of String(task?.recipients||'').split(/[;；,，\n]+/)){
      const display=clean(part.match(/^\s*([^<>]+?)\s*<[^>]+>/)?.[1]||'');if(display)values.push(display);
    }
    const id=clean(task?.id||'').replace(/^\d+[.、)）:]\s*/,'').replace(/\s+[—–-]\s+.*$/,'').trim();
    if(id&&!looksGenericId(id)&&!emailOf(id))values.push(id);
    const seen=new Set(),out=[];
    for(const value of values){const key=normalizeName(value);if(!key||seen.has(key))continue;seen.add(key);out.push(clean(value));}
    return out;
  }
  function taskName(task){return taskNameCandidates(task)[0]||'';}
  function schoolKey(v){
    const scheduler=globalThis.NMDAScheduler;
    return scheduler?.normalizeInstitutionKey ? scheduler.normalizeInstitutionKey(v) : norm(v).replace(/^the/,'');
  }
  function schoolSignature(v){
    const tokens=clean(v).toLowerCase().replace(/[&＆]/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/)
      .filter(token=>token&&!/^(?:the|of|and|university|college|school|institute|institution|academy|faculty|department|dept)$/.test(token));
    return tokens.length?[...new Set(tokens)].sort().join(''):'';
  }
  function sameSchool(a,b){
    const x=schoolKey(a),y=schoolKey(b);if(!x||!y)return false;
    if(x===y)return true;
    if(Math.min(x.length,y.length)>=5&&(x.includes(y)||y.includes(x)))return true;
    const sx=schoolSignature(a),sy=schoolSignature(b);return !!sx&&sx.length>=3&&sx===sy;
  }

  function headerLike(value){
    const raw=clean(value);if(!raw||raw.length>42)return false;
    if(/[\r\n]/.test(raw)||/(?:https?:\/\/|www\.)/i.test(raw))return false;
    // A real column header is normally a compact noun phrase, not a sentence or
    // application note. This prevents body text such as "round:R1/3 ..." from
    // being promoted to the within-school priority-round column.
    if(/[。！？!?]/.test(raw)&&raw.length>18)return false;
    return true;
  }
  function headerScore(header, aliases){
    if(!headerLike(header))return 0;
    const h=norm(header); if(!h)return 0; let best=0;
    for(const raw of aliases){
      const a=norm(raw);if(!a)continue;
      if(h===a)best=Math.max(best,100);
      else if((h.includes(a)||a.includes(h))&&Math.min(h.length,a.length)>=4&&Math.max(h.length,a.length)<=24)best=Math.max(best,84+Math.min(10,a.length));
    }
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

  function mergedAnchorMap(set){
    const map=new Map(),rows=set?.rows||[];
    for(const merge of set?.meta?.excelVisual?.merges||[]){
      if(!Array.isArray(merge)||merge.length<4)continue;
      let [r1,c1,r2,c2]=merge.map(Number);if(![r1,c1,r2,c2].every(Number.isFinite))continue;
      if(r2<r1)[r1,r2]=[r2,r1];if(c2<c1)[c1,c2]=[c2,c1];
      const anchor=rows[r1]?.[c1];if(anchor==null||clean(anchor)==='')continue;
      for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++)if(r!==r1||c!==c1)map.set(`${r}:${c}`,anchor);
    }
    return map;
  }
  function semanticCell(set,row,col,mergeMap=null){
    const direct=set?.rows?.[row]?.[col];if(direct!=null&&clean(direct)!=='')return direct;
    return (mergeMap||mergedAnchorMap(set)).get(`${row}:${col}`)??direct??'';
  }
  function strictRoundToken(value,{allowBareNumber=false}={}){
    const raw=clean(value);if(!raw)return null;let m=null;
    m=raw.match(/^(?:R|ROUND)\s*[-:#]?\s*(\d+)$/i);
    if(!m)m=raw.match(/^(?:第\s*)?(\d+)\s*轮$/);
    if(!m){
      const cm=raw.match(/^(?:第\s*)?([一二三四五六七八九十]{1,3})\s*轮$/);
      if(cm){const digit={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},chars=cm[1];let n=null;if(chars==='十')n=10;else if(chars.includes('十')){const [a,b]=chars.split('十');n=(a?digit[a]||0:1)*10+(b?digit[b]||0:0);}else n=digit[chars]||null;return Number.isInteger(n)&&n>0?n:null;}
    }
    if(!m&&allowBareNumber&&/^\d+$/.test(raw))m=[raw,raw];
    const n=m?Number(m[1]):null;return Number.isInteger(n)&&n>0?n:null;
  }
  function strictMappedField(d,rows,field){
    const spec=d?.map?.[field];if(!spec||Number(spec.score)<96)return null;
    const header=rows?.[d.row]?.[spec.index];return headerLike(header)?spec:null;
  }

  function parseDataset(dataset){
    const entries=[],warnings=[],invalidEmailRows=[];
    for(const set of (dataset?.sheets||dataset?.recordSets||[])){
      const rows=set?.rows||[]; if(!rows.length)continue;
      const d=detectColumns(rows),mergeMap=mergedAnchorMap(set);
      const strictBatchSpec=strictMappedField(d,rows,'batch'),strictScheduleSpec=strictMappedField(d,rows,'schedule');
      const hasIdentityHeader=!!(d.map.email||d.map.name||d.map.school);
      const start=hasIdentityHeader?Math.min(rows.length,d.row+1):0;
      let inheritedSchool='';
      for(let r=start;r<rows.length;r++){
        const row=rows[r]||[];
        if(!row.some(v=>clean(v))){inheritedSchool='';continue;}
        const get=f=>d.map[f]?semanticCell(set,r,d.map[f].index,mergeMap):'';
        const used=new Set(Object.values(d.map).map(x=>x.index));
        const emailCell=clean(get('email'));
        let email=emailOf(emailCell);
        if(!email){for(const v of row){email=emailOf(v);if(email)break;}}
        if(emailCell.includes('@')&&!email)invalidEmailRows.push({source:set.source||set.name||'',row:r+1,value:emailCell});
        let name=clean(get('name'))||likelyName(row,used);
        const explicitSchool=clean(get('school'));
        if(explicitSchool)inheritedSchool=explicitSchool;
        // Excel stores a vertically merged institution only in the first row. CSV exports
        // often preserve the same hierarchy as blanks, so inherit only the recognized
        // institution column and reset at an empty separator row.
        let school=explicitSchool||(d.map.school?inheritedSchool:likelySchool(row,used));
        if(!d.map.school&&school)inheritedSchool=school;
        if(!hasIdentityHeader && !email && !(name&&school)) continue;
        const country=clean(get('country')),status=clean(get('status')),priority=clean(get('priority')),priorityOrder=parsePriorityOrder(priority),tags=splitTags(get('tags')),notes=clean(get('notes'));
        const batchRaw=strictBatchSpec?clean(semanticCell(set,r,strictBatchSpec.index,mergeMap)):'';
        const batchNumber=strictBatchSpec?strictRoundToken(batchRaw,{allowBareNumber:true}):null;
        const batchExplicit=Number.isInteger(batchNumber)&&batchNumber>0,batch=batchExplicit?`R${batchNumber}`:'';
        const priorityRoundIndex=batchExplicit?batchNumber-1:null,priorityRound=batch;
        const scheduleRaw=strictScheduleSpec?clean(semanticCell(set,r,strictScheduleSpec.index,mergeMap)):'';
        const scheduleDate=scheduleRaw?globalThis.NMDAImporter?.parseDateValue?.(scheduleRaw)||null:null,scheduleAt=scheduleDate?globalThis.NMDAImporter?.formatLocalDateTime?.(scheduleDate)||scheduleRaw:'';
        const scheduleExplicit=!!scheduleAt;
        if(!email&&!name&&!school)continue;
        entries.push({
          key:`r${entries.length+1}`,email,name,school,country,
          // Compatibility aliases (`batch*`) are retained for persisted 3.8.x workspaces,
          // but their meaning here is strictly the within-school priority round.
          priorityRound,priorityRoundIndex,priorityRoundExplicit:batchExplicit,priorityRoundRaw:batchRaw,
          batch,batchRaw,batchExplicit,batchSourceHeader:batchExplicit?clean(rows?.[d.row]?.[strictBatchSpec?.index]||''):'',status,priority,priorityOrder,scheduleRaw,scheduleAt,scheduleExplicit,tags,notes,
          source:set.source||set.name||'',collection:set.name||'',sourceRow:r+1,
          nameKey:normalizeName(name),nameKeys:nameKeys(name),schoolKey:schoolKey(school),schoolInherited:!explicitSchool&&!!school
        });
      }
    }
    const emailCounts=new Map(),nameCounts=new Map();
    for(const e of entries){if(e.email)emailCounts.set(e.email,(emailCounts.get(e.email)||0)+1);if(e.nameKey)nameCounts.set(e.nameKey,(nameCounts.get(e.nameKey)||0)+1);}
    const duplicates=entries.filter(e=>(e.email&&emailCounts.get(e.email)>1)||(!e.email&&e.nameKey&&nameCounts.get(e.nameKey)>1));
    if(duplicates.length)warnings.push(`总名单中有 ${duplicates.length} 条身份重复记录，交叉核验时会保守处理。`);
    if(invalidEmailRows.length)warnings.push(`总名单中有 ${invalidEmailRows.length} 条邮箱格式不完整；仍会尝试按姓名与院校匹配。`);
    return {entries,warnings,invalidEmailRows,stats:{total:entries.length,withEmail:entries.filter(e=>e.email).length,withSchool:entries.filter(e=>e.school).length,duplicates:duplicates.length,invalidEmails:invalidEmailRows.length}};
  }

  function buildMatchIndex(entries){
    const list=Array.isArray(entries)?entries:[];
    const byEmail=new Map(),byName=new Map(),bySurname=new Map(),byKey=new Map();
    const push=(map,key,entry)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(entry);};
    for(const entry of list){
      if(entry?.key)byKey.set(entry.key,entry);
      if(entry?.email)push(byEmail,String(entry.email).toLowerCase(),entry);
      // Always rebuild keys from the current display name so persisted rosters from
      // older versions immediately benefit from Unicode folding and new aliases.
      const keys=[...new Set([...(entry?.nameKeys||[]),...nameKeys(entry?.name||'')])];
      for(const key of keys)push(byName,key,entry);
      const surname=surnameKey(entry?.name||'');if(surname&&surname.length>=3)push(bySurname,surname,entry);
    }
    return {entries:list,byEmail,byName,bySurname,byKey};
  }

  function matchOne(task,entriesOrIndex){
    const index=Array.isArray(entriesOrIndex)?buildMatchIndex(entriesOrIndex):(entriesOrIndex?.byEmail?entriesOrIndex:buildMatchIndex([]));
    const emails=emailsOf(task?.recipients||''),email=emails[0]||'',names=taskNameCandidates(task),name=names[0]||'',keys=[...new Set(names.flatMap(nameKeys))],school=clean(task?.school||'');
    const sourceName=sourceNameCandidate(task),sourceKeys=nameKeys(sourceName),salutationName=clean(task?.importSalutation||'').replace(/^\s*(?:dear|hello|hi)\s+/i,'').replace(/^\s*(?:(?:associate|assistant)\s+)?(?:prof(?:essor)?|dr)\.?\s+/i,'').replace(/[,，:：!！].*$/,'').trim(),salutationSurname=surnameKey(salutationName);
    const domainOf=value=>globalThis.NMDAScheduler?.recipientDomain?.(value)||String(value||'').split('@')[1]?.toLowerCase()||'';
    const taskDomains=new Set(emails.map(domainOf).filter(Boolean)),found=new Map();
    const add=(entry,score,by)=>{if(!entry)return;const key=entry.key||`${entry.email}|${entry.name}|${entry.school}`;const prev=found.get(key);if(!prev||score>prev.score)found.set(key,{entry,score,by});};
    for(const address of emails)for(const entry of (index.byEmail.get(address)||[]))add(entry,120,'email');
    // One-document-per-contact imports carry high-quality identity evidence in the
    // source filename even when the email body contains only a surname salutation.
    for(const key of sourceKeys){
      const same=[...new Map((index.byName.get(key)||[]).map(entry=>[entry.key||`${entry.email}|${entry.school}`,entry])).values()];
      if(same.length===1)add(same[0],116,'source-file-name');
      else for(const entry of same)add(entry,92,'ambiguous-source-file-name');
    }
    for(const key of keys){
      const same=[...new Map((index.byName.get(key)||[]).map(entry=>[entry.key||`${entry.email}|${entry.school}`,entry])).values()];
      for(const entry of same){
        if(school&&entry.school&&sameSchool(entry.school,school))add(entry,108,'name+school');
        const entryDomain=domainOf(entry.email);if(entryDomain&&taskDomains.has(entryDomain))add(entry,102,'name+domain');
      }
      if(same.length===1)add(same[0],90,'unique-name');
      else for(const entry of same)add(entry,70,'ambiguous-name');
    }
    // A surname-only salutation (e.g. "Dear Prof. Bemmann") is useful when it is
    // unique inside the current roster. It is intentionally weaker than a source
    // filename/full-name match and does not override conflicting stronger evidence.
    if(salutationSurname&&salutationSurname.length>=3){
      const same=[...new Map((index.bySurname?.get(salutationSurname)||[]).map(entry=>[entry.key||`${entry.email}|${entry.school}`,entry])).values()];
      if(same.length===1)add(same[0],88,'unique-surname-salutation');
      else for(const entry of same)add(entry,68,'ambiguous-surname-salutation');
    }
    // A structured mailbox such as first.last@school.edu is useful only when it maps
    // to one roster name; it never overrides stronger email/name evidence.
    for(const address of emails){
      const local=normalizeName(address.split('@')[0].replace(/[._+\-]+/g,' '));if(local.length<5)continue;
      const same=index.byName.get(local)||[];if(same.length===1)add(same[0],84,'email-name');
    }
    const richness=entry=>Number(!!entry.school)*4+Number(!!entry.email)*2+Number(!!entry.name)+Number(!!entry.batch)+Number(!!entry.status);
    let candidates=[...found.values()].sort((a,b)=>b.score-a.score||richness(b.entry)-richness(a.entry));
    if(!candidates.length)return {status:'off-roster',task,email,emails,name,names,candidates:[]};
    if(school){const bestSchool=candidates.find(candidate=>candidate.entry.school&&sameSchool(candidate.entry.school,school));if(bestSchool&&bestSchool.score>=candidates[0].score-8)candidates=[bestSchool,...candidates.filter(candidate=>candidate!==bestSchool)];}
    const top=candidates[0],ties=candidates.filter(c=>c.score===top.score);
    if(ties.length>1){
      const sameEmail=top.by==='email'&&new Set(ties.map(c=>c.entry.email).filter(Boolean)).size===1;
      const namesInTie=new Set(ties.map(c=>normalizeName(c.entry.name)).filter(Boolean)),schoolsInTie=new Set(ties.map(c=>schoolKey(c.entry.school)).filter(Boolean));
      const equivalent=sameEmail&&namesInTie.size<=1&&schoolsInTie.size<=1;
      if(!equivalent)return {status:'ambiguous',task,email,emails,name,names,candidates:ties,score:top.score,by:top.by};
    }
    const entry=top.entry;
    const schoolConflict=!!(school&&entry.school&&!sameSchool(school,entry.school));
    const emailConflict=!!(email&&entry.email&&!emails.includes(String(entry.email).toLowerCase())&&top.score>=108);
    return {status:schoolConflict?'conflict':'matched',task,email,emails,name,names,entry,score:top.score,by:top.by,schoolConflict,emailConflict,
      schoolSupplement:!school&&!!entry.school&&top.score>=84,
      emailCandidate:!email&&!!entry.email&&top.score>=84?entry.email:''};
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
        emailCandidates:matches.filter(m=>m.emailCandidate).length,
        emailConflicts:matches.filter(m=>m.emailConflict).length
      }
    };
  }

  globalThis.NMDARoster={FIELD_ALIASES,normalizeName,nameKeys,taskName,taskNameCandidates,sourceNameCandidate,surnameKey,decodeEscapedUnicode,schoolKey,sameSchool,parsePriorityOrder,detectColumns,parseDataset,auditTaskDuplicates,crossCheck,matchOne,buildMatchIndex};
})();
