(() => {
  'use strict';

  const DEFAULT_RULES = Object.freeze({
    maxPerGroupPerRound: 1,
    intervalDays: 7,
    preserveExisting: true,
    intraRoundMinutes: 10
  });

  function pad(n){ return String(n).padStart(2,'0'); }
  function formatLocalDateTime(date){
    if(!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function parseLocalDateTime(value){
    if(value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const raw=String(value||'').trim(); if(!raw) return null;
    const m=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})/);
    if(m){const d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],0,0);return Number.isNaN(d.getTime())?null:d;}
    const d=new Date(raw); return Number.isNaN(d.getTime())?null:d;
  }
  function defaultStart(now=new Date()){
    const d=new Date(now.getTime()+60*60*1000); d.setMinutes(0,0,0); return formatLocalDateTime(d);
  }
  function recipientDomain(recipients){
    const m=String(recipients||'').match(/@([A-Z0-9.-]+\.[A-Z]{2,})(?![A-Z0-9.-])/i); if(!m)return'';
    const raw=m[1].toLowerCase().replace(/^mail\./,'');
    const labels=raw.split('.').filter(Boolean); if(labels.length<2)return raw;
    const academicSuffixes=new Set(['edu.au','edu.hk','ac.uk','ac.nz','ac.jp','ac.kr','ac.in','edu.sg','edu.cn','edu.my','edu.tw','edu.ph','ac.za']);
    const last2=labels.slice(-2).join('.');
    if(academicSuffixes.has(last2)&&labels.length>=3)return labels.slice(-3).join('.');
    return labels.slice(-2).join('.');
  }
  function cleanInstitution(value){
    return String(value||'').normalize('NFKC').replace(/^[\s\-—–:：]+|[\s\-—–:：]+$/g,'').replace(/\s+/g,' ').trim();
  }
  function normalizeInstitutionKey(value){
    return cleanInstitution(value).toLowerCase()
      .replace(/^the\s+/,'')
      .replace(/\([^)]{1,20}\)/g,'')
      .replace(/[&＆]/g,'and')
      .replace(/[^a-z0-9\p{L}]+/gu,'')
      .trim();
  }
  function institutionEvidence(value,recipients='',source=''){
    const school=cleanInstitution(value),trusted=['roster','manual','recognized'].includes(String(source||''));
    if(!school)return{valid:false,value:'',reason:'empty'};
    if(/^(?:[a-z]|\d{1,3}|[a-z]\d{0,2}|(?:group|batch|round|wave|tier|class|category|tag)\s*[a-z0-9-]*|(?:第[\u4e00-\u5341\d]+批|分组|批次|类别|标签)\s*[a-z0-9-]*)$/i.test(school))return{valid:false,value:'',reason:'short-code'};
    const strong=/(?:university|college|school|institute|academy|polytechnic|conservatoire|faculty|department|大学|学院|学校|研究院|科学院|理工|师范|商学院|学部)/i.test(school);
    if(strong||trusted)return{valid:true,value:school,reason:strong?'institution-name':'trusted-source'};
    const domain=recipientDomain(recipients),key=normalizeInstitutionKey(school);
    const domainTokens=domain.split('.').filter(token=>token.length>=2&&!['edu','ac','com','org','net','mail'].includes(token));
    const matched=domainTokens.some(token=>key===token||key.includes(token)||token.includes(key));
    return matched?{valid:true,value:school,reason:'domain-match'}:{valid:false,value:'',reason:'unverified'};
  }
  function groupForTask(task){
    const evidence=institutionEvidence(task?.school||'',task?.recipients||'',task?.schoolSource||''),school=evidence.valid?evidence.value:'', domain=recipientDomain(task?.recipients||'');
    const generic=new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','qq.com','163.com','126.com','icloud.com','proton.me','protonmail.com']);
    // A roster/manual institution is the business grouping. Domain is only a
    // fallback: one university may use several faculty subdomains or aliases.
    if(school) return { key:`school:${normalizeInstitutionKey(school)}`, label:school, source:task?.schoolSource||'school', domain };
    if(domain&&!generic.has(domain)) return { key:`domain:${domain}`, label:`邮箱域名 · ${domain}`, source:'domain', domain };
    if(domain) return { key:`task:${task?.editKey||task?.id||domain}`, label:`未识别学校 · ${domain}`, source:'unknown', domain };
    return { key:`task:${task?.editKey||task?.id||Math.random()}`, label:'未识别学校', source:'unknown' };
  }
  function normalizeRules(input={}){
    const max=Math.max(1,Math.min(20,Number(input.maxPerGroupPerRound)||DEFAULT_RULES.maxPerGroupPerRound));
    const days=Math.max(1,Math.min(365,Number(input.intervalDays)||DEFAULT_RULES.intervalDays));
    return {
      startAt:String(input.startAt||'').trim(),
      maxPerGroupPerRound:max,
      intervalDays:days,
      preserveExisting:input.preserveExisting!==false,
      intraRoundMinutes:Math.max(0,Math.min(120,Number(input.intraRoundMinutes)||DEFAULT_RULES.intraRoundMinutes))
    };
  }


  function audit(tasks,rulesInput={}){
    const rules=normalizeRules(rulesInput), start=parseLocalDateTime(rules.startAt);
    if(!start)return {conflicts:[],scheduled:0};
    const intervalMs=rules.intervalDays*24*60*60*1000, buckets=new Map(); let scheduled=0;
    for(const task of (tasks||[]).filter(t=>t&&t.enabled&&t.status==='ready'&&t.scheduleAt)){
      const date=parseLocalDateTime(task.scheduleAt); if(!date)continue; scheduled++;
      let round=Math.floor((date.getTime()-start.getTime())/intervalMs); if(round<0&&date.getTime()+intervalMs>start.getTime())round=0; if(round<0)continue;
      const group=groupForTask(task), key=`${group.key}|${round}`;
      if(!buckets.has(key))buckets.set(key,{group,round,tasks:[]}); buckets.get(key).tasks.push(task);
    }
    const conflicts=[...buckets.values()].filter(x=>x.tasks.length>rules.maxPerGroupPerRound).map(x=>({groupLabel:x.group.label,roundIndex:x.round,count:x.tasks.length,limit:rules.maxPerGroupPerRound,tasks:x.tasks}));
    return {conflicts,scheduled};
  }

  function buildPlan(tasks,rulesInput={},now=new Date()){
    const rules=normalizeRules(rulesInput), start=parseLocalDateTime(rules.startAt);
    if(!start) throw new Error('请先设置排程起始时间。');
    if(start.getTime() <= now.getTime()+60*1000) throw new Error('排程起始时间需要晚于当前时间。');
    const intervalMs=rules.intervalDays*24*60*60*1000;
    const candidates=(tasks||[]).filter(t=>t && t.enabled && t.status==='ready');
    if(!candidates.length) throw new Error('当前没有已选择且预检通过的任务可排程。');

    const groups=new Map();
    for(const task of candidates){
      const group=groupForTask(task); if(!groups.has(group.key)) groups.set(group.key,{...group,tasks:[]});
      groups.get(group.key).tasks.push(task);
    }

    const assignments=[], preserved=[]; let maxRound=0, fallbackGroups=0, fallbackTasks=0;
    for(const group of groups.values()){
      if(group.source==='domain'||group.source==='unknown'){fallbackGroups++;fallbackTasks+=group.tasks.length;}
      const occupancy=new Map();
      const autoQueue=[];
      for(const task of group.tasks){
        const source=String(task.scheduleSource||'');
        const existingDate=parseLocalDateTime(task.scheduleAt);
        const isProtected=rules.preserveExisting && task.scheduleAt && source!=='auto' && existingDate && existingDate.getTime()>now.getTime()+60*1000;
        if(isProtected){
          const date=existingDate;
          if(date){
            let round=Math.floor((date.getTime()-start.getTime())/intervalMs);
            if(round<0 && date.getTime()+intervalMs>start.getTime()) round=0;
            if(round>=0){occupancy.set(round,(occupancy.get(round)||0)+1);maxRound=Math.max(maxRound,round);}
          }
          preserved.push({task,group,scheduleAt:task.scheduleAt,source:source||'existing'});
        }else autoQueue.push(task);
      }
      let cursorRound=0;
      for(const task of autoQueue){
        while((occupancy.get(cursorRound)||0)>=rules.maxPerGroupPerRound) cursorRound++;
        const slot=occupancy.get(cursorRound)||0;
        const when=new Date(start.getTime()+cursorRound*intervalMs+slot*rules.intraRoundMinutes*60*1000);
        occupancy.set(cursorRound,slot+1); maxRound=Math.max(maxRound,cursorRound);
        assignments.push({
          editKey:task.editKey, task, groupKey:group.key, groupLabel:group.label, groupSource:group.source,
          scheduleAt:formatLocalDateTime(when), roundIndex:cursorRound, slotIndex:slot,
          reason:`${group.label} · 第 ${cursorRound+1} 轮${rules.maxPerGroupPerRound>1?` · 轮内第 ${slot+1} 位`:''}`
        });
      }
    }
    return {
      rules, assignments, preserved,
      summary:{selected:candidates.length,groups:groups.size,auto:assignments.length,preserved:preserved.length,rounds:maxRound+1,fallbackGroups,fallbackTasks}
    };
  }

  globalThis.NMDAScheduler={DEFAULT_RULES,formatLocalDateTime,parseLocalDateTime,defaultStart,recipientDomain,cleanInstitution,normalizeInstitutionKey,institutionEvidence,groupForTask,normalizeRules,audit,buildPlan};
})();
