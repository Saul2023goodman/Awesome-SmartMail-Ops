(() => {
  'use strict';

  const DEFAULT_RULES = Object.freeze({
    maxPerGroupPerRound: 1,
    weekdays: Object.freeze([4]),
    localTime: '07:30',
    timeZone: 'system',
    skipStart: '',
    skipEnd: '',
    preserveExisting: true,
    includeMailboxScheduled: true,
    sameGroupIntervalDays: 7,
    // Legacy compatibility only. Automatic schedules no longer stagger minutes.
    intraRoundMinutes: 0,
    skipHolidays: true
  });

  const REGION_PRESETS = Object.freeze([
    { value:'system', label:'本机 / 网易当前时区', country:'' },
    { value:'Asia/Shanghai', label:'中国 · 上海', country:'CN' },
    { value:'Asia/Hong_Kong', label:'中国香港', country:'HK' },
    { value:'Asia/Singapore', label:'新加坡', country:'SG' },
    { value:'Asia/Kuala_Lumpur', label:'马来西亚 · 吉隆坡', country:'MY' },
    { value:'Australia/Sydney', label:'澳大利亚 · Sydney / Melbourne', country:'AU' },
    { value:'Australia/Brisbane', label:'澳大利亚 · Brisbane', country:'AU' },
    { value:'Australia/Adelaide', label:'澳大利亚 · Adelaide', country:'AU' },
    { value:'Australia/Perth', label:'澳大利亚 · Perth', country:'AU' },
    { value:'Pacific/Auckland', label:'新西兰 · Auckland', country:'NZ' },
    { value:'Europe/London', label:'英国 · London', country:'UK' },
    { value:'America/New_York', label:'美国 / 加拿大 · Eastern', country:'US' },
    { value:'America/Chicago', label:'美国 · Central', country:'US' },
    { value:'America/Denver', label:'美国 · Mountain', country:'US' },
    { value:'America/Los_Angeles', label:'美国 / 加拿大 · Pacific', country:'US' },
    { value:'America/Toronto', label:'加拿大 · Toronto', country:'CA' },
    { value:'America/Vancouver', label:'加拿大 · Vancouver', country:'CA' }
  ]);

  const HOLIDAY_CACHE=new Map();
  const COUNTRY_ALIASES=new Map([
    ['us','US'],['usa','US'],['unitedstates','US'],['unitedstatesofamerica','US'],['美国','US'],['美國','US'],
    ['canada','CA'],['ca','CA'],['加拿大','CA'],
    ['australia','AU'],['au','AU'],['澳大利亚','AU'],['澳大利亞','AU'],['澳洲','AU'],
    ['unitedkingdom','UK'],['uk','UK'],['greatbritain','UK'],['britain','UK'],['英国','UK'],['英國','UK'],
    ['england','UK'],['wales','UK'],
    ['newzealand','NZ'],['nz','NZ'],['新西兰','NZ'],['新西蘭','NZ']
  ]);

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
  function systemTimeZone(){
    try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch(_){return'UTC';}
  }
  function normalizeTimeZone(value){
    const raw=String(value||'system').trim()||'system';
    if(raw==='system')return'system';
    try{new Intl.DateTimeFormat('en-US',{timeZone:raw}).format(new Date());return raw;}catch(_){return'system';}
  }
  function timeZoneLabel(value){
    const zone=normalizeTimeZone(value);if(zone==='system')return '本机 / 网易当前时区';
    return REGION_PRESETS.find(item=>item.value===zone)?.label||zone;
  }
  function regionCountryForTimeZone(value){
    const zone=normalizeTimeZone(value);return REGION_PRESETS.find(item=>item.value===zone)?.country||'';
  }
  function datePartsInZone(value,timeZone='system'){
    const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return null;
    const zone=normalizeTimeZone(timeZone);
    if(zone==='system')return {year:date.getFullYear(),month:date.getMonth()+1,day:date.getDate(),hour:date.getHours(),minute:date.getMinutes(),weekday:date.getDay()};
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
    const bag={};for(const part of parts)if(part.type!=='literal')bag[part.type]=Number(part.value);
    const utc=new Date(Date.UTC(bag.year,(bag.month||1)-1,bag.day||1));
    return {year:bag.year,month:bag.month,day:bag.day,hour:bag.hour===24?0:bag.hour,minute:bag.minute,weekday:utc.getUTCDay()};
  }
  function dateKeyFromParts(parts){return parts?`${parts.year}-${pad(parts.month)}-${pad(parts.day)}`:'';}
  function localDateKey(value,timeZone='system'){return dateKeyFromParts(datePartsInZone(value,timeZone));}
  function formatInTimeZone(value,timeZone='system'){
    const parts=datePartsInZone(value,timeZone);if(!parts)return'';
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  }
  function zonedLocalToDate(dayKey,timeValue='00:00',timeZone='system'){
    const dm=String(dayKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/),tm=String(timeValue||'00:00').match(/^(\d{1,2}):(\d{2})$/);if(!dm||!tm)return null;
    const y=+dm[1],m=+dm[2],d=+dm[3],h=+tm[1],mi=+tm[2],zone=normalizeTimeZone(timeZone);
    if(zone==='system'){const out=new Date(y,m-1,d,h,mi,0,0);return Number.isNaN(out.getTime())?null:out;}
    const wanted=Date.UTC(y,m-1,d,h,mi,0,0);let out=new Date(wanted);
    for(let i=0;i<5;i++){
      const parts=datePartsInZone(out,zone);if(!parts)break;
      const represented=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,0,0),delta=wanted-represented;
      if(Math.abs(delta)<1000)break;out=new Date(out.getTime()+delta);
    }
    return out;
  }
  function defaultStartDate(now=new Date(),timeZone='system'){return localDateKey(now,timeZone);}
  function defaultLocalTime(){return DEFAULT_RULES.localTime;}
  function addDateKeyDays(key,days){
    const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return'';const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+Number(days||0)));return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  }
  function weekdayForDateKey(key){const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return NaN;return new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).getUTCDay();}
  function normalizeWeekdays(value){
    const source=Array.isArray(value)?value:String(value||'').split(',');const out=[...new Set(source.map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=5))].sort((a,b)=>a-b);return out.length?out:[...DEFAULT_RULES.weekdays];
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
    if(school) return { key:`school:${normalizeInstitutionKey(school)}`, label:school, source:task?.schoolSource||'school', domain };
    if(domain&&!generic.has(domain)) return { key:`domain:${domain}`, label:`邮箱域名 · ${domain}`, source:'domain', domain };
    if(domain) return { key:`task:${task?.editKey||task?.id||domain}`, label:`未识别学校 · ${domain}`, source:'unknown', domain };
    return { key:`task:${task?.editKey||task?.id||Math.random()}`, label:'未识别学校', source:'unknown' };
  }
  function normalizeRules(input={}){
    const max=Math.max(1,Math.min(20,Number(input.maxPerGroupPerRound)||DEFAULT_RULES.maxPerGroupPerRound));
    const timeZone=normalizeTimeZone(input.timeZone||DEFAULT_RULES.timeZone);
    const legacyStart=parseLocalDateTime(input.startAt||'');
    const legacyParts=legacyStart?datePartsInZone(legacyStart,timeZone):null;
    const startDate=String(input.startDate||dateKeyFromParts(legacyParts)||defaultStartDate(new Date(),timeZone)).trim();
    const localTime=String(input.localTime||(legacyParts?`${pad(legacyParts.hour)}:${pad(legacyParts.minute)}`:DEFAULT_RULES.localTime)).trim();
    let weekdays=input.weekdays;
    if((!Array.isArray(weekdays)||!weekdays.length)&&legacyParts)weekdays=[legacyParts.weekday].filter(n=>n>=1&&n<=5);
    const skipStart=String(input.skipStart||'').trim(),skipEnd=String(input.skipEnd||'').trim();
    const intervalRaw=Number(input.sameGroupIntervalDays ?? input.intervalDays ?? DEFAULT_RULES.sameGroupIntervalDays);
    const sameGroupIntervalDays=Number.isFinite(intervalRaw)?Math.max(0,Math.min(365,intervalRaw)):DEFAULT_RULES.sameGroupIntervalDays;
    const startInstant=zonedLocalToDate(startDate,localTime,timeZone);
    return {
      startAt:startInstant?formatLocalDateTime(startInstant):'',
      startDate,
      localTime:/^\d{1,2}:\d{2}$/.test(localTime)?localTime:DEFAULT_RULES.localTime,
      timeZone,
      weekdays:normalizeWeekdays(weekdays),
      skipStart,
      skipEnd,
      maxPerGroupPerRound:max,
      preserveExisting:input.preserveExisting!==false,
      includeMailboxScheduled:input.includeMailboxScheduled!==false,
      sameGroupIntervalDays,
      // Retained so older saved workspaces can still be read; it no longer changes send time.
      intraRoundMinutes:0,
      skipHolidays:input.skipHolidays!==false
    };
  }

  function compactKey(v){return String(v??'').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9\p{L}]+/gu,'');}
  function normalizeCountry(value){
    const raw=compactKey(value); if(!raw)return'';
    if(COUNTRY_ALIASES.has(raw))return COUNTRY_ALIASES.get(raw);
    for(const [alias,code] of COUNTRY_ALIASES){if(alias.length>=4&&(raw.includes(alias)||alias.includes(raw)))return code;}
    return '';
  }
  function countryForTask(task){
    const raw=task?.rosterMeta?.country||task?.rosterReference?.country||task?.country||'';
    return {raw:String(raw||'').trim(),code:normalizeCountry(raw)};
  }
  function parsePriority(value){
    if(value==null||value==='')return {has:false,rank:Number.POSITIVE_INFINITY,raw:''};
    if(typeof value==='number'&&Number.isFinite(value))return {has:true,rank:value,raw:String(value)};
    const raw=String(value).normalize('NFKC').trim(); if(!raw)return {has:false,rank:Number.POSITIVE_INFINITY,raw:''};
    let m=raw.match(/(?:^|[^\d])(?:第\s*)?(\d+(?:\.\d+)?)(?:\s*(?:位|名|顺序|順位|priority|rank))?/i);
    if(m)return {has:true,rank:Number(m[1]),raw};
    m=raw.match(/^p\s*(\d+(?:\.\d+)?)$/i);if(m)return {has:true,rank:Number(m[1]),raw};
    if(/^(?:最高|最优|最優|urgent|highest|top)$/i.test(raw))return {has:true,rank:-100,raw};
    if(/^(?:高|优先|優先|high)$/i.test(raw))return {has:true,rank:100,raw};
    if(/^(?:中|普通|normal|medium)$/i.test(raw))return {has:true,rank:200,raw};
    if(/^(?:低|low)$/i.test(raw))return {has:true,rank:300,raw};
    m=raw.match(/^(?:tier\s*)?([a-z])$/i);if(m)return {has:true,rank:1000+(m[1].toUpperCase().charCodeAt(0)-65),raw};
    return {has:false,rank:Number.POSITIVE_INFINITY,raw};
  }
  function priorityForTask(task){
    const explicit=task?.rosterMeta?.priorityOrder ?? task?.rosterReference?.priorityOrder;
    if(Number.isFinite(Number(explicit))&&String(explicit??'').trim()!=='')return {has:true,rank:Number(explicit),raw:String(task?.rosterMeta?.priority||task?.rosterReference?.priority||explicit)};
    return parsePriority(task?.rosterMeta?.priority ?? task?.rosterReference?.priority ?? task?.priority ?? '');
  }
  function priorityRoundForTask(task){
    const explicit=task?.rosterMeta?.priorityRoundIndex ?? task?.rosterMeta?.plannerRound;
    const explicitLabel=task?.rosterMeta?.priorityRoundLabel || task?.rosterMeta?.batch || '';
    if(explicit!=null&&String(explicit).trim()!==''&&Number.isInteger(Number(explicit))&&Number(explicit)>=0)return {has:true,round:Number(explicit),raw:String(explicitLabel||`R${Number(explicit)+1}`)};
    const raw=String(task?.rosterMeta?.priorityRoundLabel||task?.rosterMeta?.batch||task?.rosterReference?.priorityRound||task?.rosterReference?.batch||'').normalize('NFKC').trim();if(!raw)return {has:false,round:null,raw:''};
    const match=raw.match(/(?:^|\b)R\s*(\d+)\b/i)||raw.match(/(?:第\s*)?(\d+)\s*轮/)||(/^\d+$/.test(raw)?[raw,raw]:null);
    let n=Number(match?.[1]);
    if(!Number.isInteger(n)||n<=0){const cm=raw.match(/(?:第\s*)?([一二三四五六七八九十]{1,3})\s*轮/);if(cm){const digit={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},chars=cm[1];if(chars==='十')n=10;else if(chars.includes('十')){const [a,b]=chars.split('十');n=(a?digit[a]||0:1)*10+(b?digit[b]||0:0);}else n=digit[chars]||0;}}
    return Number.isInteger(n)&&n>0?{has:true,round:n-1,raw}:{has:false,round:null,raw};
  }
  // Backward-compatible export name. This is a roster priority round, not a schedule round.
  const roundForTask=priorityRoundForTask;

  function dateKey(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;}
  function addDays(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return d;}
  function nthWeekday(year,month,weekday,n){const d=new Date(year,month,1);const offset=(weekday-d.getDay()+7)%7;d.setDate(1+offset+(n-1)*7);return d;}
  function lastWeekday(year,month,weekday){const d=new Date(year,month+1,0);d.setDate(d.getDate()-((d.getDay()-weekday+7)%7));return d;}
  function easterSunday(year){
    const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31)-1,day=((h+l-7*m+114)%31)+1;
    return new Date(year,month,day);
  }
  function put(map,date,name){map.set(dateKey(date),name);}
  function putObservedNextWeekday(map,date,name){
    put(map,date,name);
    if(date.getDay()===0||date.getDay()===6){let d=addDays(date,date.getDay()===6?2:1);while(map.has(dateKey(d)))d=addDays(d,1);put(map,d,`${name}（补休）`);}
  }
  function putObservedUS(map,date,name){
    put(map,date,name);let observed=null;
    if(date.getDay()===6)observed=addDays(date,-1);else if(date.getDay()===0)observed=addDays(date,1);
    if(observed)put(map,observed,`${name}（补休）`);
  }
  function buildHolidayMap(code,year){
    const map=new Map(),easter=easterSunday(year);
    if(code==='US'){
      putObservedUS(map,new Date(year,0,1),'New Year’s Day');
      put(map,nthWeekday(year,0,1,3),'Martin Luther King Jr. Day');
      put(map,nthWeekday(year,1,1,3),"Washington’s Birthday");
      put(map,lastWeekday(year,4,1),'Memorial Day');
      putObservedUS(map,new Date(year,5,19),'Juneteenth');
      putObservedUS(map,new Date(year,6,4),'Independence Day');
      put(map,nthWeekday(year,8,1,1),'Labor Day');
      put(map,nthWeekday(year,9,1,2),'Columbus Day');
      putObservedUS(map,new Date(year,10,11),'Veterans Day');
      put(map,nthWeekday(year,10,4,4),'Thanksgiving Day');
      putObservedUS(map,new Date(year,11,25),'Christmas Day');
    }else if(code==='CA'){
      putObservedNextWeekday(map,new Date(year,0,1),"New Year’s Day");
      put(map,addDays(easter,-2),'Good Friday');
      const may25=new Date(year,4,25),victoria=addDays(may25,-((may25.getDay()+6)%7||7));put(map,victoria,'Victoria Day');
      putObservedNextWeekday(map,new Date(year,6,1),'Canada Day');
      put(map,nthWeekday(year,8,1,1),'Labour Day');
      putObservedNextWeekday(map,new Date(year,8,30),'National Day for Truth and Reconciliation');
      put(map,nthWeekday(year,9,1,2),'Thanksgiving');
      putObservedNextWeekday(map,new Date(year,10,11),'Remembrance Day');
      putObservedNextWeekday(map,new Date(year,11,25),'Christmas Day');
      putObservedNextWeekday(map,new Date(year,11,26),'Boxing Day');
    }else if(code==='AU'){
      putObservedNextWeekday(map,new Date(year,0,1),"New Year’s Day");
      putObservedNextWeekday(map,new Date(year,0,26),'Australia Day');
      put(map,addDays(easter,-2),'Good Friday');
      put(map,addDays(easter,1),'Easter Monday');
      put(map,new Date(year,3,25),'ANZAC Day');
      putObservedNextWeekday(map,new Date(year,11,25),'Christmas Day');
      putObservedNextWeekday(map,new Date(year,11,26),'Boxing Day');
    }else if(code==='UK'){
      putObservedNextWeekday(map,new Date(year,0,1),"New Year’s Day");
      put(map,addDays(easter,-2),'Good Friday');
      put(map,addDays(easter,1),'Easter Monday');
      put(map,nthWeekday(year,4,1,1),'Early May bank holiday');
      put(map,lastWeekday(year,4,1),'Spring bank holiday');
      put(map,lastWeekday(year,7,1),'Summer bank holiday');
      putObservedNextWeekday(map,new Date(year,11,25),'Christmas Day');
      putObservedNextWeekday(map,new Date(year,11,26),'Boxing Day');
    }else if(code==='NZ'){
      putObservedNextWeekday(map,new Date(year,0,1),"New Year’s Day");
      putObservedNextWeekday(map,new Date(year,0,2),'Day after New Year’s Day');
      putObservedNextWeekday(map,new Date(year,1,6),'Waitangi Day');
      put(map,addDays(easter,-2),'Good Friday');
      put(map,addDays(easter,1),'Easter Monday');
      putObservedNextWeekday(map,new Date(year,3,25),'ANZAC Day');
      put(map,nthWeekday(year,5,1,1),"King’s Birthday");
      put(map,nthWeekday(year,9,1,4),'Labour Day');
      putObservedNextWeekday(map,new Date(year,11,25),'Christmas Day');
      putObservedNextWeekday(map,new Date(year,11,26),'Boxing Day');
    }
    return map;
  }
  function holidayMap(code,year){
    if(!code)return new Map();const key=`${code}:${year}`;if(!HOLIDAY_CACHE.has(key))HOLIDAY_CACHE.set(key,buildHolidayMap(code,year));return HOLIDAY_CACHE.get(key);
  }
  function holidayName(date,code){
    if(!code)return'';const key=dateKey(date);for(const year of [date.getFullYear()-1,date.getFullYear(),date.getFullYear()+1]){const name=holidayMap(code,year).get(key);if(name)return name;}return'';
  }
  function skipRangeBounds(rules){
    let start=String(rules?.skipStart||'').trim(),end=String(rules?.skipEnd||'').trim();
    if(start&&!end)end=start;if(end&&!start)start=end;if(start&&end&&start>end)[start,end]=[end,start];return {start,end};
  }
  function isSkippedDateKey(key,rules){const {start,end}=skipRangeBounds(rules);return !!(start&&end&&key>=start&&key<=end);}
  function countryForSchedule(task,rules={}){
    const regionCode=regionCountryForTimeZone(rules.timeZone);if(regionCode)return {raw:timeZoneLabel(rules.timeZone),code:regionCode};
    return countryForTask(task);
  }
  function holidayNameForDateKey(key,code){
    const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m||!code)return'';
    return holidayName(new Date(+m[1],+m[2]-1,+m[3]),code);
  }
  function nonWorkingInfo(date,task,rules={}){
    const normalized=normalizeRules(rules),zone=normalized.timeZone,key=localDateKey(date,zone),weekday=weekdayForDateKey(key),country=countryForSchedule(task,normalized);
    const selected=!normalized.weekdays.includes(weekday),skipRange=isSkippedDateKey(key,normalized),holiday=normalized.skipHolidays?holidayNameForDateKey(key,country.code):'';
    const weekend=weekday===0||weekday===6;
    return {nonWorking:selected||skipRange||!!holiday,selected,skipRange,weekend,holiday,country,countrySupported:!!country.code,dateKey:key,weekday};
  }
  function adjustForNonWorkingDay(date,task,rules){
    const normalized=normalizeRules(rules),original=new Date(date),reasons=[];let key=localDateKey(original,normalized.timeZone),shifted=0,country=countryForSchedule(task,normalized),countrySupported=!!country.code;
    for(let guard=0;guard<370;guard++){
      const candidate=zonedLocalToDate(key,normalized.localTime,normalized.timeZone);if(!candidate)break;
      const info=nonWorkingInfo(candidate,task,normalized);country=info.country;countrySupported=info.countrySupported;
      if(!info.nonWorking)return {date:candidate,shiftedDays:shifted,reasons,country,countrySupported,dateKey:key};
      if(info.selected&&!reasons.includes('非所选工作日'))reasons.push('非所选工作日');
      if(info.skipRange&&!reasons.includes('跳过时间段'))reasons.push('跳过时间段');
      if(info.holiday&&!reasons.includes(info.holiday))reasons.push(info.holiday);
      key=addDateKeyDays(key,1);shifted++;
    }
    return {date:original,shiftedDays:0,reasons,country,countrySupported,dateKey:localDateKey(original,normalized.timeZone)};
  }

  function localMinuteValue(time){const m=String(time||'').match(/^(\d{1,2}):(\d{2})$/);return m?Math.max(0,Math.min(1439,(+m[1])*60+(+m[2]))):450;}
  function minuteTime(value){const total=Math.max(0,Math.min(1439,Number(value)||0));return `${pad(Math.floor(total/60))}:${pad(total%60)}`;}
  function scheduleInstantForDate(key,rules,slot=0){
    // The operator-selected local time is authoritative. Multiple independent
    // tasks may legitimately share the same clock time; scheduling constraints
    // operate on dates / institutions, never by silently nudging minutes.
    const normalized=normalizeRules(rules),minute=localMinuteValue(normalized.localTime);
    if(minute>=1440)return null;return zonedLocalToDate(key,minuteTime(minute),normalized.timeZone);
  }
  function dateKeyOrdinal(key){
    const m=String(key||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/86400000):NaN;
  }
  function dateKeyDistance(a,b){
    const aa=dateKeyOrdinal(a),bb=dateKeyOrdinal(b);return Number.isFinite(aa)&&Number.isFinite(bb)?Math.abs(aa-bb):Number.POSITIVE_INFINITY;
  }
  function calendarReasonForKey(key,task,rules){
    const normalized=normalizeRules(rules),weekday=weekdayForDateKey(key),reasons=[],country=countryForSchedule(task,normalized);
    if(!normalized.weekdays.includes(weekday))reasons.push('非所选工作日');
    if(isSkippedDateKey(key,normalized))reasons.push('跳过时间段');
    if(normalized.skipHolidays){const holiday=holidayNameForDateKey(key,country.code);if(holiday)reasons.push(holiday);}
    return {blocked:reasons.length>0,reasons,country,weekday};
  }
  function nextEligibleDateKey(fromKey,task,rules,now=null,minInstant=null){
    const normalized=normalizeRules(rules);let key=String(fromKey||normalized.startDate||'');
    for(let guard=0;guard<730;guard++,key=addDateKeyDays(key,1)){
      const calendar=calendarReasonForKey(key,task,normalized);if(calendar.blocked)continue;
      const instant=scheduleInstantForDate(key,normalized,0);if(!instant)continue;
      if(now&&instant.getTime()<=now.getTime()+60*1000)continue;
      if(minInstant&&instant.getTime()<minInstant.getTime())continue;
      return key;
    }
    return '';
  }

  function normalizeExternalAnchor(anchor){
    if(!anchor||typeof anchor!=='object')return null;
    const date=parseLocalDateTime(anchor.scheduleAt);if(!date)return null;
    let recipients=anchor.recipients||anchor.toRaw||'';
    if(Array.isArray(recipients))recipients=recipients.map(item=>item?.name?`${item.name} <${item.email||''}>`:item?.email||'').filter(Boolean).join('; ');
    return {
      ...anchor,
      id:String(anchor.id||''),
      scheduleAt:formatLocalDateTime(date),
      recipients:String(recipients||''),
      subject:String(anchor.subject||''),
      school:String(anchor.school||''),
      schoolSource:String(anchor.schoolSource||''),
      _scheduleDate:date
    };
  }
  function audit(tasks,rulesInput={},context={}){
    const rules=normalizeRules(rulesInput),buckets=new Map();let scheduled=0;
    const holidayConflicts=[];
    for(const task of (tasks||[]).filter(t=>t&&t.enabled&&t.status==='ready'&&t.scheduleAt)){
      const date=parseLocalDateTime(task.scheduleAt);if(!date)continue;scheduled++;
      const dayKey=localDateKey(date,rules.timeZone),calendar=calendarReasonForKey(dayKey,task,rules);
      if(calendar.blocked)holidayConflicts.push({task,date,info:{...calendar,dateKey:dayKey,nonWorking:true}});
      const group=groupForTask(task),key=`${group.key}|${dayKey}`;
      if(!buckets.has(key))buckets.set(key,{group,dayKey,tasks:[],anchors:[]});buckets.get(key).tasks.push(task);
    }
    const currentDraftIds=new Set((tasks||[]).map(task=>String(task?.mailboxDraftId||'')).filter(Boolean));
    const anchors=rules.includeMailboxScheduled?(context.externalAnchors||[]).map(normalizeExternalAnchor).filter(anchor=>anchor&&!currentDraftIds.has(anchor.id)):[];
    for(const anchor of anchors){
      const dayKey=localDateKey(anchor._scheduleDate,rules.timeZone),group=groupForTask(anchor),key=`${group.key}|${dayKey}`;
      if(!buckets.has(key))buckets.set(key,{group,dayKey,tasks:[],anchors:[]});buckets.get(key).anchors.push(anchor);
    }
    const conflicts=[...buckets.values()].filter(x=>x.tasks.length>rules.maxPerGroupPerRound).map(x=>({groupLabel:x.group.label,dayKey:x.dayKey,count:x.tasks.length,limit:rules.maxPerGroupPerRound,tasks:x.tasks}));
    const externalConflicts=[...buckets.values()].filter(x=>x.tasks.length&&x.tasks.length+x.anchors.length>rules.maxPerGroupPerRound).map(x=>({groupLabel:x.group.label,dayKey:x.dayKey,count:x.tasks.length+x.anchors.length,currentCount:x.tasks.length,lockedCount:x.anchors.length,limit:rules.maxPerGroupPerRound,tasks:x.tasks,anchors:x.anchors}));
    const byGroup=new Map();
    for(const bucket of buckets.values()){
      if(!byGroup.has(bucket.group.key))byGroup.set(bucket.group.key,{group:bucket.group,entries:[]});
      const target=byGroup.get(bucket.group.key).entries;
      for(const task of bucket.tasks)target.push({kind:'task',task,dayKey:bucket.dayKey});
      for(const anchor of bucket.anchors)target.push({kind:'anchor',anchor,dayKey:bucket.dayKey});
    }
    const intervalConflicts=[];
    if(rules.sameGroupIntervalDays>0){
      for(const item of byGroup.values()){
        const entries=item.entries.sort((a,b)=>dateKeyOrdinal(a.dayKey)-dateKeyOrdinal(b.dayKey));
        for(let i=1;i<entries.length;i++){
          const earlier=entries[i-1],later=entries[i],gapDays=dateKeyDistance(earlier.dayKey,later.dayKey);
          if(gapDays<rules.sameGroupIntervalDays&&(earlier.kind==='task'||later.kind==='task'))intervalConflicts.push({groupLabel:item.group.label,earlier,later,gapDays,limitDays:rules.sameGroupIntervalDays});
        }
      }
    }
    // Exact clock-time equality is not a conflict: NetEase can hold multiple
    // independently scheduled drafts for the same minute. Keep the field for API compatibility.
    const timeConflicts=[];
    return {conflicts,externalConflicts,intervalConflicts,timeConflicts,holidayConflicts,scheduled,externalCount:anchors.length};
  }

  function buildPlan(tasks,rulesInput={},now=new Date(),context={}){
    const rules=normalizeRules(rulesInput);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(rules.startDate))throw new Error('请选择开始日期。');
    if(!/^\d{1,2}:\d{2}$/.test(rules.localTime))throw new Error('请选择当地发送时间。');
    if(!rules.weekdays.length)throw new Error('请至少选择一个工作日。');
    const candidates=(tasks||[]).filter(t=>t&&t.enabled&&t.status==='ready');
    if(!candidates.length)throw new Error('当前没有已选择且预检通过的任务可排程。');

    const currentDraftIds=new Set(candidates.map(task=>String(task.mailboxDraftId||'')).filter(Boolean));
    const externalAnchors=rules.includeMailboxScheduled?(context.externalAnchors||[]).map(normalizeExternalAnchor).filter(anchor=>anchor&&anchor._scheduleDate.getTime()>now.getTime()+60*1000&&!currentDraftIds.has(anchor.id)):[];
    const externalByGroup=new Map();
    for(const anchor of externalAnchors){
      const group=groupForTask(anchor);if(!externalByGroup.has(group.key))externalByGroup.set(group.key,[]);externalByGroup.get(group.key).push({anchor,group});
    }

    const taskOrder=new Map(candidates.map((task,index)=>[task,index])),groups=new Map();
    for(const task of candidates){
      const group=groupForTask(task);if(!groups.has(group.key))groups.set(group.key,{...group,tasks:[]});groups.get(group.key).tasks.push(task);
      // Existing times are protected by their own school/date constraints below.
      // Equal clock times across different schools are intentionally allowed.
    }

    const assignments=[],preserved=[],usedSendDays=new Set();
    let priorityOrderedGroups=0,holidayAdjusted=0,skipAdjusted=0,intervalAdjusted=0;
    for(const group of groups.values()){
      const occupancy=new Map(),protectedPriority=[],usedGroupDays=new Set();
      for(const item of externalByGroup.get(group.key)||[]){
        const key=localDateKey(item.anchor._scheduleDate,rules.timeZone);occupancy.set(key,(occupancy.get(key)||0)+1);usedSendDays.add(key);usedGroupDays.add(key);
      }
      const autoQueue=[];
      for(const task of group.tasks){
        const source=String(task.scheduleSource||''),existingDate=parseLocalDateTime(task.scheduleAt);
        const providerLocked=source==='mailbox'&&!!task.mailboxDraftId&&existingDate&&existingDate.getTime()>now.getTime()+60*1000;
        const rosterFixed=source==='roster-fixed'&&existingDate&&existingDate.getTime()>now.getTime()+60*1000;
        const isProtected=providerLocked||rosterFixed||(rules.preserveExisting&&task.scheduleAt&&source!=='auto'&&existingDate&&existingDate.getTime()>now.getTime()+60*1000);
        if(isProtected){
          const key=localDateKey(existingDate,rules.timeZone);occupancy.set(key,(occupancy.get(key)||0)+1);usedSendDays.add(key);usedGroupDays.add(key);
          const protectedRound=priorityRoundForTask(task);if(protectedRound.has)protectedPriority.push({priority:protectedRound.round,instant:existingDate,label:protectedRound.raw||`R${protectedRound.round+1}`,dateKey:key});
          preserved.push({task,group,scheduleAt:task.scheduleAt,source:source||'existing'});
        }else autoQueue.push(task);
      }
      const withPriority=autoQueue.filter(task=>priorityForTask(task).has);if(withPriority.length&&autoQueue.length>1)priorityOrderedGroups++;
      autoQueue.sort((a,b)=>{
        const ra=priorityRoundForTask(a),rb=priorityRoundForTask(b);if(ra.has!==rb.has)return ra.has?-1:1;if(ra.has&&rb.has&&ra.round!==rb.round)return ra.round-rb.round;
        const pa=priorityForTask(a),pb=priorityForTask(b);if(pa.has!==pb.has)return pa.has?-1:1;if(pa.rank!==pb.rank)return pa.rank-pb.rank;return (taskOrder.get(a)||0)-(taskOrder.get(b)||0);
      });

      let cursorKey=rules.startDate;
      for(const task of autoQueue){
        const priorityRound=priorityRoundForTask(task),earlierProtected=priorityRound.has?protectedPriority.filter(item=>item.priority<priorityRound.round):[];
        const laterProtected=priorityRound.has?protectedPriority.filter(item=>item.priority>priorityRound.round):[];
        const minInstant=earlierProtected.length?new Date(Math.max(...earlierProtected.map(item=>item.instant.getTime()))+60*1000):null;
        const ceilingInstant=laterProtected.length?new Date(Math.min(...laterProtected.map(item=>item.instant.getTime()))):null;
        let key=cursorKey||rules.startDate,when=null,slot=0,calendarHolidaySeen=false,calendarSkipSeen=false,intervalGapSeen=false;
        for(let guard=0;guard<730&&!when;guard++,key=addDateKeyDays(key,1)){
          const calendar=calendarReasonForKey(key,task,rules);
          if(calendar.blocked){if(calendar.reasons.includes('跳过时间段'))calendarSkipSeen=true;if(calendar.reasons.some(r=>r!=='非所选工作日'&&r!=='跳过时间段'))calendarHolidaySeen=true;continue;}
          slot=occupancy.get(key)||0;if(slot>=rules.maxPerGroupPerRound)continue;
          if(rules.sameGroupIntervalDays>0&&[...usedGroupDays].some(day=>dateKeyDistance(day,key)<rules.sameGroupIntervalDays)){intervalGapSeen=true;continue;}
          let candidate=scheduleInstantForDate(key,rules,slot);if(!candidate)continue;
          if(candidate.getTime()<=now.getTime()+60*1000)continue;
          if(minInstant&&candidate.getTime()<minInstant.getTime())continue;
          if(ceilingInstant&&candidate.getTime()>=ceilingInstant.getTime()){
            const blocker=laterProtected.sort((a,b)=>a.instant-b.instant||a.priority-b.priority)[0];
            throw new Error(`${group.label} 的固定/已有时间与同校优先轮次冲突：${priorityRound.raw||`R${priorityRound.round+1}`} 无法排在 ${blocker.label} 之前。请调整固定时间或优先轮次。`);
          }
          // Do not mutate the chosen clock time to avoid an unrelated message.
          // Cross-school same-minute schedules are valid; school spacing is date-based.
          if(localDateKey(candidate,rules.timeZone)!==key)continue;
          if(ceilingInstant&&candidate.getTime()>=ceilingInstant.getTime())continue;
          when=candidate;break;
        }
        if(!when)throw new Error(`无法为 ${group.label} 找到符合规则的发送日期。请检查开始日期、工作日、跳过时间段或已有排期。`);
        if(calendarHolidaySeen)holidayAdjusted++;if(calendarSkipSeen)skipAdjusted++;if(intervalGapSeen)intervalAdjusted++;
        occupancy.set(key,slot+1);usedGroupDays.add(key);usedSendDays.add(key);cursorKey=key;
        const priority=priorityForTask(task),localLabel=formatInTimeZone(when,rules.timeZone).replace('T',' '),reasonParts=[`${group.label} · ${localLabel} · ${timeZoneLabel(rules.timeZone)}`];
        if(rules.maxPerGroupPerRound>1)reasonParts.push(`当日第 ${slot+1} 位`);
        if(priorityRound.has)reasonParts.push(`同校优先轮次 ${priorityRound.raw||`R${priorityRound.round+1}`}`);
        if(priority.has)reasonParts.push(`名单顺序 ${priority.raw||priority.rank}`);
        if(intervalGapSeen&&rules.sameGroupIntervalDays>0)reasonParts.push(`同校至少间隔 ${rules.sameGroupIntervalDays} 天`);
        if(calendarSkipSeen)reasonParts.push('已避开跳过时间段');if(calendarHolidaySeen)reasonParts.push('已避开当地节假日');
        assignments.push({
          editKey:task.editKey,task,groupKey:group.key,groupLabel:group.label,groupSource:group.source,
          scheduleAt:formatLocalDateTime(when),originalScheduleAt:formatLocalDateTime(scheduleInstantForDate(key,rules,slot)),scheduleDayKey:key,scheduleCycleIndex:0,roundIndex:0,slotIndex:slot,
          priorityRoundIndex:priorityRound.has?priorityRound.round:null,priorityRoundLabel:priorityRound.has?(priorityRound.raw||`R${priorityRound.round+1}`):'',
          priorityRank:priority.has?priority.rank:null,priorityLabel:priority.has?(priority.raw||String(priority.rank)):'',
          holidayShiftDays:calendarHolidaySeen?1:0,holidayReasons:calendarHolidaySeen?['当地节假日']:[],country:countryForSchedule(task,rules).raw||countryForSchedule(task,rules).code||'',
          lockedTimeShiftMinutes:0,localScheduleAt:formatInTimeZone(when,rules.timeZone),timeZone:rules.timeZone,
          reason:reasonParts.join(' · ')
        });
      }
    }
    const autoDays=new Set(assignments.map(item=>item.scheduleDayKey).filter(Boolean));
    return {
      rules,assignments,preserved,externalAnchors,
      summary:{selected:candidates.length,groups:groups.size,auto:assignments.length,preserved:preserved.length,externalAnchors:externalAnchors.length,externalGroups:externalByGroup.size,scheduleDays:autoDays.size,scheduleCycles:autoDays.size,rounds:autoDays.size,priorityOrderedGroups,holidayAdjusted,skipAdjusted,intervalAdjusted,lockedTimeAdjusted:0}
    };
  }

  globalThis.NMDAScheduler={DEFAULT_RULES,REGION_PRESETS,formatLocalDateTime,parseLocalDateTime,defaultStart,defaultStartDate,defaultLocalTime,systemTimeZone,normalizeTimeZone,timeZoneLabel,regionCountryForTimeZone,datePartsInZone,localDateKey,formatInTimeZone,zonedLocalToDate,weekdayForDateKey,normalizeWeekdays,recipientDomain,cleanInstitution,normalizeInstitutionKey,institutionEvidence,groupForTask,normalizeRules,normalizeCountry,countryForTask,parsePriority,priorityForTask,priorityRoundForTask,roundForTask,holidayName,nonWorkingInfo,adjustForNonWorkingDay,isSkippedDateKey,audit,buildPlan};
})();
