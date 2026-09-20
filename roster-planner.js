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
    const batches=[];
    for(const raw of (Array.isArray(saved?.batches)?saved.batches:[])){const label=clean(typeof raw==='string'?raw:raw?.label);if(label&&!batches.includes(label))batches.push(label);}
    // Migrate batches created by older planner versions without inventing any new rounds.
    for(const intent of Object.values(intents)){const label=clean(intent?.batch);if(label&&intent?.batchSource&&intent.batchSource!=='excel'&&!batches.includes(label))batches.push(label);}
    return {version:3,sourceKey:clean(saved?.sourceKey),intents:{...intents},batches,activeBatch:clean(saved?.activeBatch),lastSelection:saved?.lastSelection||null,lastUpdatedAt:clean(saved?.lastUpdatedAt),showIrrelevantColumns:!!saved?.showIrrelevantColumns};
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

  function columnPlan(set){
    const rows=set?.rows||[],visual=excelVisual(set)||{},maxCols=Math.max(Number(visual.usedRange?.cols||0),...rows.slice(0,320).map(row=>row?.length||0),0);
    const detection=Roster?.detectColumns?.(rows)||{row:0,map:{}};
    const mapped=new Map();
    for(const [field,spec] of Object.entries(detection?.map||{})){
      const index=Number(spec?.index);if(Number.isInteger(index)&&index>=0&&index<maxCols)mapped.set(index,field);
    }
    const identityFields=new Set(['name','email','school']);
    const schedulingFields=new Set(['country','priority','batch','schedule','status']);
    const relevant=new Set();
    for(const [index,field] of mapped)if(identityFields.has(field)||schedulingFields.has(field))relevant.add(index);
    const headerRow=Math.max(0,Number(detection?.row)||0),header=rows[headerRow]||[];
    // Keep a compact sequence/id column when it sits next to the operational fields.
    for(let c=0;c<maxCols;c++){
      if(relevant.has(c))continue;const label=clean(header[c]).toLowerCase();
      if(/^(?:#|no\.?|序号|编号|id|index|序列)$/i.test(label)){relevant.add(c);break;}
    }
    const nonEmpty=new Set();
    for(let c=0;c<maxCols;c++){
      if(rows.slice(0,Math.min(rows.length,220)).some(row=>clean(row?.[c])!==''))nonEmpty.add(c);
    }
    // Be conservative when the sheet could not be confidently interpreted: do not
    // collapse an unfamiliar workbook into a misleading narrow projection.
    const identityMapped=[...mapped.values()].filter(field=>identityFields.has(field)).length;
    if(relevant.size<2||identityMapped<1)for(const c of nonEmpty)relevant.add(c);
    const originalHidden=new Set();for(const spec of visual.hiddenCols||[]){const [a,b]=spec||[];for(let c=Math.max(0,Number(a)||0);c<=Math.min(maxCols-1,Number(b)||0);c++)originalHidden.add(c);}
    const autoHidden=new Set();for(let c=0;c<maxCols;c++)if(nonEmpty.has(c)&&!relevant.has(c)&&!originalHidden.has(c))autoHidden.add(c);
    const emptyHidden=new Set();for(let c=0;c<maxCols;c++)if(!nonEmpty.has(c)&&!originalHidden.has(c))emptyHidden.add(c);
    const fields=[...mapped.entries()].sort((a,b)=>a[0]-b[0]).map(([index,field])=>({index,field,label:clean(header[index])||columnLabel(index)}));
    return {maxCols,headerRow,relevant,autoHidden,emptyHidden,originalHidden,mapped,fields,visibleCount:[...relevant].filter(c=>!originalHidden.has(c)).length};
  }
  function projectedMerges(set,{hiddenCols=[],hiddenRows=[]}={}){
    const hiddenColSet=hiddenCols instanceof Set?hiddenCols:new Set(hiddenCols||[]),hiddenRowSet=hiddenRows instanceof Set?hiddenRows:new Set(hiddenRows||[]),top=new Map(),covered=new Set();
    for(const merge of excelVisual(set)?.merges||[]){
      if(!Array.isArray(merge)||merge.length<4)continue;let [r1,c1,r2,c2]=merge.map(Number);if(![r1,c1,r2,c2].every(Number.isFinite))continue;
      if(r2<r1)[r1,r2]=[r2,r1];if(c2<c1)[c1,c2]=[c2,c1];
      const rows=[];for(let r=r1;r<=r2;r++)if(!hiddenRowSet.has(r))rows.push(r);
      const cols=[];for(let c=c1;c<=c2;c++)if(!hiddenColSet.has(c))cols.push(c);
      if(!rows.length||!cols.length)continue;
      const ar=rows[0],ac=cols[0];top.set(`${ar}:${ac}`,{rowSpan:rows.length,colSpan:cols.length,source:[r1,c1,r2,c2],anchor:[r1,c1]});
      for(const r of rows)for(const c of cols)if(r!==ar||c!==ac)covered.add(`${r}:${c}`);
    }
    return {top,covered};
  }
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

  function featureGroups(set,{rows:rowFilter=null,startRow=1}={}){
    const allowed=rowFilter?new Set(rowFilter):null,cache=styleLookup(set),groups=new Map();
    const add=(key,data,row)=>{if(!key)return;if(!groups.has(key))groups.set(key,{key,rows:[],...data});const g=groups.get(key);if(!g.rows.includes(row))g.rows.push(row);};
    for(let row=Math.max(0,startRow);row<(set?.rows?.length||0);row++){
      if(allowed&&!allowed.has(row))continue;
      const values=set?.rows?.[row]||[];
      const fill=dominantRowFill(set,row,cache);if(fill)add(`fill:${fill}`,{kind:'fill',value:fill,label:'颜色'},row);
      let bold=false,italic=false;const fontColors=new Map(),strongBorders=new Map();
      for(let col=0;col<values.length;col++){
        if(clean(values[col])==='')continue;const style=styleAt(set,row,col,cache)||{};
        if(style.font?.bold)bold=true;if(style.font?.italic)italic=true;
        const fontColor=clean(style.font?.color);if(fontColor&&!/^#?(?:000000|111111|222222|333333)$/i.test(fontColor))fontColors.set(fontColor,(fontColors.get(fontColor)||0)+1);
        for(const side of ['top','right','bottom','left']){const b=style.border?.[side];if(b?.style&&/^(?:medium|thick|double)$/i.test(String(b.style)))strongBorders.set(String(b.style).toLowerCase(),(strongBorders.get(String(b.style).toLowerCase())||0)+1);}
      }
      if(bold)add('font:bold',{kind:'bold',value:'bold',label:'加粗'},row);
      if(italic)add('font:italic',{kind:'italic',value:'italic',label:'斜体'},row);
      if(fontColors.size){const [color]=[...fontColors.entries()].sort((a,b)=>b[1]-a[1])[0];add(`font-color:${color}`,{kind:'font-color',value:color,label:'字体色'},row);}
      if(strongBorders.size){const [style]=[...strongBorders.entries()].sort((a,b)=>b[1]-a[1])[0];add(`border:${style}`,{kind:'border',value:style,label:'粗边框'},row);}
    }
    return [...groups.values()].map(g=>({...g,count:g.rows.length})).filter(g=>g.kind==='fill'||g.count>=2).sort((a,b)=>{
      const weight={fill:0,bold:1,'font-color':2,border:3,italic:4};return (weight[a.kind]??9)-(weight[b.kind]??9)||b.count-a.count||a.key.localeCompare(b.key);
    });
  }
  function explicitBatch(entry={}){const label=clean(entry?.batch);return parseRound(label)!=null?label:'';}
  function knownBatches(state,entries=[]){
    const labels=[];const push=raw=>{const label=clean(raw);if(label&&!labels.includes(label))labels.push(label);};
    for(const label of state?.batches||[])push(label);
    for(const entry of entries||[])push(explicitBatch(entry));
    for(const entry of entries||[])push(intentForEntry(state,entry)?.batch);
    return labels.sort((a,b)=>{const ar=parseRound(a),br=parseRound(b);if(ar!=null||br!=null)return (ar??9999)-(br??9999)||a.localeCompare(b);return a.localeCompare(b);});
  }
  function nextBatchLabel(state,entries=[]){const used=new Set();for(const label of knownBatches(state,entries)){const round=parseRound(label);if(round!=null)used.add(round+1);}let n=1;while(used.has(n)&&n<999)n++;return `R${n}`;}
  function createBatch(state,entries=[],preferred=''){
    const next=createState(state),label=clean(preferred)||nextBatchLabel(next,entries);if(!next.batches.includes(label))next.batches.push(label);next.activeBatch=label;next.lastUpdatedAt=new Date().toISOString();return {state:next,label};
  }
  function setActiveBatch(state,label=''){const next=createState(state);next.activeBatch=clean(label);return next;}
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
  function chineseRoundNumber(raw){
    const m=String(raw||'').match(/(?:第\s*)?([一二三四五六七八九十]{1,3})\s*(?:批|轮)/);if(!m)return null;
    const chars=m[1],digit={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    if(chars==='十')return 10;if(chars.includes('十')){const [a,b]=chars.split('十');return (a?digit[a]||0:1)*10+(b?digit[b]||0:0);}return digit[chars]||null;
  }
  function parseRound(value){
    const raw=clean(value);if(!raw)return null;let m=raw.match(/(?:^|\b)R\s*(\d+)\b/i)||raw.match(/(?:第\s*)?(\d+)\s*(?:批|轮)/);if(!m&&/^\d+$/.test(raw))m=[raw,raw];
    const n=m?Number(m[1]):chineseRoundNumber(raw);return Number.isInteger(n)&&n>0?n-1:null;
  }
  function applyInterpretation(state,entries,set,range,{semantic,value}={}){
    const next=createState(state),targets=entriesForRange(entries,set,range),stamp=new Date().toISOString(),evidence={source:clean(set?.source),collection:clean(set?.name),range:rangeLabel(range),at:stamp};
    if(!targets.length)return {state:next,targets:[],warning:'选区没有命中总名单联系人行。'};
    if(semantic==='clear'){
      for(const entry of targets)delete next.intents[entryKey(entry)];
    }else if(semantic==='priority-sequence'){
      let rank=Math.max(1,Number(value)||1);for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,priorityOrder:rank++,prioritySource:'manual-selection',evidence};}
    }else if(semantic==='batch'){
      const label=clean(value);if(!label)return {state:next,targets:[],warning:'请先新建或选择一个批次。'};const roundIndex=parseRound(label);for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,batch:label,roundIndex, batchSource:'manual-selection',evidence};}
    }else if(semantic==='fixed-time'){
      const fixedAt=clean(value);if(!fixedAt)return {state:next,targets:[],warning:'请选择固定发送时间。'};for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,fixedAt,fixedSource:'manual-selection',evidence};}
    }else if(semantic==='label'){
      const label=clean(value);if(!label)return {state:next,targets:[],warning:'请输入标签含义。'};for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,label,labelSource:'manual-selection',evidence};}
    }
    next.sourceKey=sourceKey(set);next.lastSelection=normalizeRange(range);next.lastUpdatedAt=stamp;
    return {state:next,targets};
  }

  function applyBatchToEntries(state,targets,set,{batch='',clear=false,evidenceSource='manual'}={}){
    const next=createState(state),stamp=new Date().toISOString(),unique=[],seen=new Set(),evidence={source:clean(set?.source),collection:clean(set?.name),selection:evidenceSource,at:stamp};
    for(const entry of targets||[]){const key=entryKey(entry);if(seen.has(key))continue;seen.add(key);unique.push(entry);const base={...(next.intents[key]||{})};
      if(clear){
        delete base.batch;delete base.roundIndex;delete base.batchSource;
        if(explicitBatch(entry)){base.batchSuppressed=true;base.batchSource='manual-clear';next.intents[key]={...base,evidence};}
        else{delete base.batchSuppressed;if(!Object.keys(base).some(k=>!['evidence'].includes(k)))delete next.intents[key];else next.intents[key]={...base,evidence};}
      }
      else{const label=clean(batch);if(!label)continue;delete base.batchSuppressed;next.intents[key]={...base,batch:label,roundIndex:parseRound(label),batchSource:evidenceSource,evidence};if(!next.batches.includes(label))next.batches.push(label);next.activeBatch=label;}
    }
    if(!unique.length)return {state:next,targets:[],warning:'当前选择没有命中联系人。'};
    if(!clear&&!clean(batch))return {state:next,targets:[],warning:'请先新建或选择一个批次。'};
    next.sourceKey=sourceKey(set);next.lastUpdatedAt=stamp;return {state:next,targets:unique};
  }
  function summary(state,entries=[]){
    let priority=0,batch=0,fixed=0,label=0;
    for(const entry of entries){const intent=intentForEntry(state,entry);if(!intent)continue;if(Number.isFinite(Number(intent.priorityOrder)))priority++;if(intent.batch)batch++;if(intent.fixedAt)fixed++;if(intent.label)label++;}
    return {priority,batch,fixed,label,total:new Set(entries.filter(e=>intentForEntry(state,e)).map(entryKey)).size};
  }

  globalThis.NMDARosterPlanner={createState,sourceKey,entryKey,excelVisual,styleLookup,styleAt,cssForStyle,columnLabel,rangeLabel,normalizeRange,columnPlan,projectedMerges,visualGroups,featureGroups,entriesForRange,intentForEntry,parseRound,explicitBatch,knownBatches,nextBatchLabel,createBatch,setActiveBatch,applyInterpretation,applyBatchToEntries,summary};
})();
