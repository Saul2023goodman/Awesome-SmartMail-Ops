(() => {
  'use strict';

  const Roster=globalThis.NMDARoster;
  function clean(v){return String(v??'').trim();}
  function sourceKey(set={}){return `${clean(set.source)}::${clean(set.name)}`;}
  function entryKey(entry={}){
    const email=clean(entry.email).toLowerCase();if(email)return `email:${email}`;
    const name=Roster?.normalizeName?.(entry.name||'')||clean(entry.name).toLowerCase();
    const school=Roster?.schoolKey?.(entry.school||'')||clean(entry.school).toLowerCase();
    return `person:${name}|${school}`;
  }
  function createState(saved={}){
    const intents=saved?.intents&&typeof saved.intents==='object'?saved.intents:{};
    return {version:1,sourceKey:clean(saved?.sourceKey),intents:{...intents},lastSelection:saved?.lastSelection||null,lastUpdatedAt:clean(saved?.lastUpdatedAt)};
  }
  function excelVisual(set){return set?.meta?.excelVisual||null;}
  function styleLookup(set){
    const visual=excelVisual(set),map=new Map();
    for(const item of visual?.cellStyles||[]){if(Array.isArray(item)&&item.length>=3)map.set(`${item[0]}:${item[1]}`,Number(item[2])||0);}
    return {visual,map};
  }
  function styleAt(set,row,col,cache=null){
    const data=cache||styleLookup(set),visual=data.visual||{};let id=data.map.get(`${row}:${col}`)||0;
    if(!id)id=Number(visual.rowStyles?.[row]||0)||0;
    if(!id)for(const spec of visual.colStyles||[]){const [a,b,styleId]=spec||[];if(col>=Number(a)&&col<=Number(b)){id=Number(styleId)||0;if(id)break;}}
    return visual.styleTable?.[id]||visual.styleTable?.[0]||{};
  }
  function cssForStyle(style={}){
    const css=[];
    const fill=style.fill?.fg||style.fill?.bg||'';if(fill)css.push(`background:${fill}`);
    if(style.font?.color)css.push(`color:${style.font.color}`);
    if(style.font?.bold)css.push('font-weight:700');
    if(style.font?.italic)css.push('font-style:italic');
    if(style.font?.underline)css.push('text-decoration:underline');
    if(Number(style.font?.size)>0)css.push(`font-size:${Math.max(9,Math.min(16,Number(style.font.size)))}px`);
    const h=style.alignment?.horizontal;if(['left','center','right'].includes(h))css.push(`text-align:${h}`);
    const v=style.alignment?.vertical;if(['top','center','bottom'].includes(v))css.push(`vertical-align:${v==='center'?'middle':v}`);
    if(style.alignment?.wrap)css.push('white-space:normal');
    const borderMap={thin:'1px',medium:'2px',thick:'3px',hair:'1px',dashed:'1px',dotted:'1px',double:'3px'};
    for(const side of ['top','right','bottom','left']){
      const spec=style.border?.[side];if(!spec?.style)continue;const width=borderMap[spec.style]||'1px',line=spec.style==='dashed'?'dashed':spec.style==='dotted'?'dotted':spec.style==='double'?'double':'solid';
      css.push(`border-${side}:${width} ${line} ${spec.color||'#CBD5E1'}`);
    }
    return css.join(';');
  }
  function columnLabel(index){let n=Number(index)+1,out='';while(n>0){const rem=(n-1)%26;out=String.fromCharCode(65+rem)+out;n=Math.floor((n-1)/26);}return out;}
  function rangeLabel(range){if(!range)return'';const r1=Math.min(range.r1,range.r2),r2=Math.max(range.r1,range.r2),c1=Math.min(range.c1,range.c2),c2=Math.max(range.c1,range.c2);return `${columnLabel(c1)}${r1+1}:${columnLabel(c2)}${r2+1}`;}
  function normalizeRange(range){if(!range)return null;return {r1:Math.min(range.r1,range.r2),r2:Math.max(range.r1,range.r2),c1:Math.min(range.c1,range.c2),c2:Math.max(range.c1,range.c2)};}
  function dominantRowFill(set,row,cache=null){
    const data=cache||styleLookup(set),values=set?.rows?.[row]||[];const counts=new Map();let styled=0;
    for(let col=0;col<values.length;col++){
      if(clean(values[col])==='')continue;const fill=styleAt(set,row,col,data)?.fill?.fg||'';if(!fill)continue;styled++;counts.set(fill,(counts.get(fill)||0)+1);
    }
    if(!counts.size)return'';return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  }
  function visualGroups(set,{startRow=1}={}){
    const cache=styleLookup(set),byFill=new Map();
    for(let row=Math.max(0,startRow);row<(set?.rows?.length||0);row++){
      const fill=dominantRowFill(set,row,cache);if(!fill)continue;if(!byFill.has(fill))byFill.set(fill,[]);byFill.get(fill).push(row);
    }
    const groups=[];
    for(const [fill,rows] of byFill){
      const spans=[];let a=null,b=null;
      for(const row of rows){if(a==null){a=b=row;continue;}if(row===b+1){b=row;continue;}spans.push([a,b]);a=b=row;}if(a!=null)spans.push([a,b]);
      groups.push({fill,rows,spans,count:rows.length});
    }
    return groups.sort((a,b)=>b.count-a.count||a.fill.localeCompare(b.fill));
  }
  function entriesForRange(entries,set,range){
    const n=normalizeRange(range);if(!n)return[];const source=clean(set?.source),collection=clean(set?.name);
    return (entries||[]).filter(entry=>{
      const row=Number(entry?.sourceRow||0)-1;if(row<n.r1||row>n.r2)return false;
      const sourceOk=!source||clean(entry?.source)===source||clean(entry?.source).split(' · ').includes(source);
      const collectionOk=!collection||!clean(entry?.collection)||clean(entry?.collection)===collection;
      return sourceOk&&collectionOk;
    }).sort((a,b)=>Number(a.sourceRow||0)-Number(b.sourceRow||0));
  }
  function intentForEntry(state,entry){return state?.intents?.[entryKey(entry)]||null;}
  function parseRound(value){
    const raw=clean(value);if(!raw)return null;let m=raw.match(/(?:^|\b)R\s*(\d+)\b/i)||raw.match(/(?:第\s*)?(\d+)\s*(?:批|轮)/);if(!m&&/^\d+$/.test(raw))m=[raw,raw];
    const n=Number(m?.[1]);return Number.isInteger(n)&&n>0?n-1:null;
  }
  function applyInterpretation(state,entries,set,range,{semantic,value}={}){
    const next=createState(state),targets=entriesForRange(entries,set,range),stamp=new Date().toISOString(),evidence={source:clean(set?.source),collection:clean(set?.name),range:rangeLabel(range),at:stamp};
    if(!targets.length)return {state:next,targets:[],warning:'选区没有命中总名单联系人行。'};
    if(semantic==='clear'){
      for(const entry of targets)delete next.intents[entryKey(entry)];
    }else if(semantic==='priority-sequence'){
      let rank=Math.max(1,Number(value)||1);for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,priorityOrder:rank++,prioritySource:'manual-selection',evidence};}
    }else if(semantic==='batch'){
      const label=clean(value)||'R1',roundIndex=parseRound(label);for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,batch:label,roundIndex, batchSource:'manual-selection',evidence};}
    }else if(semantic==='fixed-time'){
      const fixedAt=clean(value);if(!fixedAt)return {state:next,targets:[],warning:'请选择固定发送时间。'};for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,fixedAt,fixedSource:'manual-selection',evidence};}
    }else if(semantic==='label'){
      const label=clean(value);if(!label)return {state:next,targets:[],warning:'请输入标签含义。'};for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,label,labelSource:'manual-selection',evidence};}
    }
    next.sourceKey=sourceKey(set);next.lastSelection=normalizeRange(range);next.lastUpdatedAt=stamp;
    return {state:next,targets};
  }
  function summary(state,entries=[]){
    let priority=0,batch=0,fixed=0,label=0;
    for(const entry of entries){const intent=intentForEntry(state,entry);if(!intent)continue;if(Number.isFinite(Number(intent.priorityOrder)))priority++;if(intent.batch)batch++;if(intent.fixedAt)fixed++;if(intent.label)label++;}
    return {priority,batch,fixed,label,total:new Set(entries.filter(e=>intentForEntry(state,e)).map(entryKey)).size};
  }

  globalThis.NMDARosterPlanner={createState,sourceKey,entryKey,excelVisual,styleLookup,styleAt,cssForStyle,columnLabel,rangeLabel,normalizeRange,visualGroups,entriesForRange,intentForEntry,parseRound,applyInterpretation,summary};
})();
