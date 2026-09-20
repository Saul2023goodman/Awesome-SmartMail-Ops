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
    const rawIntents=saved?.intents&&typeof saved.intents==='object'?saved.intents:{},intents={};
    // 3.8.51 semantic migration: R1/R2 are within-school priority rounds.
    // Legacy `batch/roundIndex` fields remain synchronized only for workspace compatibility;
    // they are never interpreted as calendar schedule cycles.
    for(const [key,raw] of Object.entries(rawIntents)){
      const item={...raw};
      const legacyManual=item.batch&&(String(item.batchSource||'').startsWith('manual')||['feature-selection','box-selection','batch-review'].includes(String(item.batchSource||'')));
      if(item.batch&&!legacyManual&&!item.priorityRoundLabel){
        delete item.batch;delete item.roundIndex;delete item.batchSource;delete item.batchSuppressed;
      }
      const label=clean(item.priorityRoundLabel||item.batch||'');
      const idx=item.priorityRoundIndex!=null?Number(item.priorityRoundIndex):(item.roundIndex!=null?Number(item.roundIndex):parseRound(label));
      if(label&&Number.isInteger(idx)&&idx>=0){
        item.priorityRoundLabel=label;item.priorityRoundIndex=idx;item.priorityRoundSource=item.priorityRoundSource||item.batchSource||'manual-migrated';
        item.batch=label;item.roundIndex=idx;item.batchSource=item.batchSource||item.priorityRoundSource;
      }
      if(item.priorityRoundSuppressed||item.batchSuppressed){item.priorityRoundSuppressed=true;item.batchSuppressed=true;}
      intents[key]=item;
    }
    const priorityRounds=[];
    const addRound=raw=>{const label=clean(typeof raw==='string'?raw:raw?.label);if(parseRound(label)!=null&&!priorityRounds.includes(label))priorityRounds.push(label);};
    for(const raw of (Array.isArray(saved?.priorityRounds)?saved.priorityRounds:(Array.isArray(saved?.batches)?saved.batches:[])))addRound(raw);
    for(const intent of Object.values(intents))if(intent?.priorityRoundLabel||intent?.batch)addRound(intent.priorityRoundLabel||intent.batch);
    const active=clean(saved?.activePriorityRound||saved?.activeBatch);
    const activePriorityRound=priorityRounds.includes(active)?active:'';
    return {version:5,sourceKey:clean(saved?.sourceKey),intents,priorityRounds,batches:[...priorityRounds],activePriorityRound,activeBatch:activePriorityRound,lastSelection:saved?.lastSelection||null,lastUpdatedAt:clean(saved?.lastUpdatedAt),showIrrelevantColumns:!!saved?.showIrrelevantColumns};
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
  function columnWeight(set,col){
    const visual=excelVisual(set)||{};let width=10;
    for(const spec of visual.colWidths||[]){const [a,b,w]=spec||[];if(col>=Number(a)&&col<=Number(b)&&Number(w)>0){width=Number(w);break;}}
    return Math.max(3,Math.min(40,width));
  }
  function mergedAnchorFor(set,row,col){
    for(const merge of excelVisual(set)?.merges||[]){
      if(!Array.isArray(merge)||merge.length<4)continue;let [r1,c1,r2,c2]=merge.map(Number);if(r2<r1)[r1,r2]=[r2,r1];if(c2<c1)[c1,c2]=[c2,c1];
      if(row>=r1&&row<=r2&&col>=c1&&col<=c2)return [r1,c1];
    }
    return null;
  }
  function styleHasSignal(style={}){
    const fill=clean(style.fill?.fg||style.fill?.bg),font=style.font||{},border=style.border||{};
    return !!(fill||font.color||font.bold||font.italic||font.underline||Object.values(border).some(x=>x?.style));
  }
  function visualStyleAt(set,row,col,cache=null){
    const direct=styleAt(set,row,col,cache);if(styleHasSignal(direct))return direct;
    const anchor=mergedAnchorFor(set,row,col);return anchor?styleAt(set,anchor[0],anchor[1],cache):direct;
  }
  function normalizedFill(value){
    let v=clean(value).toUpperCase();if(!v)return'';if(!v.startsWith('#')&&/^[0-9A-F]{6,8}$/.test(v))v=`#${v}`;
    if(/^#?(?:FFFFFF|FFFFFFFF|00000000|FFFFFF00)$/i.test(v))return'';return v;
  }
  const COLOR_SIMILARITY_THRESHOLD=12;
  function rgbForColor(value){
    const v=normalizedFill(value);if(!/^#[0-9A-F]{6}$/i.test(v))return null;
    return [1,3,5].map(i=>parseInt(v.slice(i,i+2),16));
  }
  function labForColor(value){
    const rgb=rgbForColor(value);if(!rgb)return null;
    const linear=rgb.map(channel=>{const c=channel/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
    const [r,g,b]=linear,x=(r*0.4124564+g*0.3575761+b*0.1804375)/0.95047,y=(r*0.2126729+g*0.7151522+b*0.0721750),z=(r*0.0193339+g*0.1191920+b*0.9503041)/1.08883;
    const f=t=>t>0.008856?Math.cbrt(t):(7.787*t)+(16/116),fx=f(x),fy=f(y),fz=f(z);
    return [(116*fy)-16,500*(fx-fy),200*(fy-fz)];
  }
  function colorDistance(a,b){
    const x=labForColor(a),y=labForColor(b);if(!x||!y)return a===b?0:Infinity;
    return Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2]);
  }
  function clusterWeightedColors(map,threshold=COLOR_SIMILARITY_THRESHOLD){
    const items=[...map.entries()].map(([value,weight])=>({value,weight:Number(weight)||0})).filter(item=>item.value&&item.weight>0).sort((a,b)=>b.weight-a.weight||a.value.localeCompare(b.value)),clusters=[];
    for(const item of items){
      let best=null;
      for(const cluster of clusters){const distance=colorDistance(item.value,cluster.value);if(distance<=threshold&&(!best||distance<best.distance))best={cluster,distance};}
      if(best){best.cluster.weight+=item.weight;best.cluster.members.push(item);}
      else clusters.push({value:item.value,weight:item.weight,members:[item]});
    }
    return clusters.sort((a,b)=>b.weight-a.weight||a.value.localeCompare(b.value));
  }
  function orderColorGroups(groups=[]){
    const remaining=[...groups].sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value));if(remaining.length<2)return remaining;
    const ordered=[remaining.shift()];
    while(remaining.length){const last=ordered[ordered.length-1];let bestIndex=0,bestDistance=Infinity;for(let i=0;i<remaining.length;i++){const distance=colorDistance(last.value,remaining[i].value);if(distance<bestDistance-1e-9||(Math.abs(distance-bestDistance)<1e-9&&remaining[i].count>remaining[bestIndex].count)){bestDistance=distance;bestIndex=i;}}ordered.push(remaining.splice(bestIndex,1)[0]);}
    return ordered;
  }
  function featureColumns(set){
    const plan=columnPlan(set),all=[];
    if(plan?.relevant?.size>=2)for(const c of plan.relevant)if(!plan.originalHidden?.has(c))all.push(c);
    else for(let c=0;c<(plan?.maxCols||0);c++)if(!plan.originalHidden?.has(c)&&!plan.emptyHidden?.has(c))all.push(c);
    return all;
  }
  function topWeighted(map){return [...map.entries()].sort((a,b)=>b[1]-a[1])[0]||null;}
  function dominantRowFeature(set,row,cache=null){
    const data=cache||styleLookup(set),cols=featureColumns(set);if(!cols.length)return null;
    const fills=new Map(),fontColors=new Map(),borders=new Map();let bold=0,italic=0,textWeight=0;
    for(const col of cols){
      const weight=columnWeight(set,col),style=visualStyleAt(set,row,col,data)||{},fill=normalizedFill(style.fill?.fg||style.fill?.bg||'');
      if(fill)fills.set(fill,(fills.get(fill)||0)+weight);
      const value=clean(set?.rows?.[row]?.[col]);if(value)textWeight+=weight;
      const fc=clean(style.font?.color);if(fc&&!/^#?(?:000000|FF000000|111111|222222|333333)$/i.test(fc))fontColors.set(fc,(fontColors.get(fc)||0)+weight);
      if(style.font?.bold)bold+=weight;if(style.font?.italic)italic+=weight;
      for(const side of ['top','right','bottom','left']){const b=style.border?.[side];if(b?.style&&/^(?:medium|thick|double)$/i.test(String(b.style))){const k=String(b.style).toLowerCase();borders.set(k,(borders.get(k)||0)+weight);break;}}
    }
    const chooseDominant=(map,kind,label)=>{const ordered=[...map.entries()].sort((a,b)=>b[1]-a[1]);if(!ordered.length)return null;const [value,weight]=ordered[0],runner=ordered[1]?.[1]||0;if(runner&&weight<runner*1.2)return null;return {kind,value,label,weight};};
    const fillClusters=clusterWeightedColors(fills),clusteredFills=new Map(fillClusters.map(cluster=>[cluster.value,cluster.weight]));
    // Fill is the strongest row-level signal. Similar shades are first collapsed into
    // one perceptual color family, so accidental Excel shade drift does not split one
    // row into competing colors. Column widths still decide how much each area weighs.
    const fill=chooseDominant(clusteredFills,'fill','颜色');if(fill){const cluster=fillClusters.find(item=>item.value===fill.value);if(cluster?.members?.length>1)fill.variants=cluster.members.map(item=>item.value);return fill;}
    const fontColor=chooseDominant(fontColors,'font-color','字体色');if(fontColor)return fontColor;
    const border=chooseDominant(borders,'border','粗边框');if(border)return border;
    const denom=Math.max(1,textWeight||cols.reduce((n,c)=>n+columnWeight(set,c),0));
    if(bold/denom>=0.6)return {kind:'bold',value:'bold',label:'加粗',weight:bold};
    if(italic/denom>=0.6)return {kind:'italic',value:'italic',label:'斜体',weight:italic};
    return null;
  }
  function dominantRowFill(set,row,cache=null){const f=dominantRowFeature(set,row,cache);return f?.kind==='fill'?f.value:'';}
  function visualGroups(set,{startRow=1}={}){
    const cache=styleLookup(set),byFill=new Map();
    for(let row=Math.max(0,startRow);row<(set?.rows?.length||0);row++){const feature=dominantRowFeature(set,row,cache);if(feature?.kind!=='fill')continue;const fill=feature.value;if(!byFill.has(fill))byFill.set(fill,[]);byFill.get(fill).push(row);}
    const exact=[...byFill.entries()].map(([value,rows])=>({value,rows,count:rows.length})),clusters=[];
    for(const item of exact.sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value))){let best=null;for(const cluster of clusters){const distance=colorDistance(item.value,cluster.value);if(distance<=COLOR_SIMILARITY_THRESHOLD&&(!best||distance<best.distance))best={cluster,distance};}if(best){best.cluster.rows.push(...item.rows);best.cluster.count+=item.count;best.cluster.variants.push(item.value);}else clusters.push({value:item.value,fill:item.value,rows:[...item.rows],count:item.count,variants:[item.value]});}
    return orderColorGroups(clusters).map(group=>{const rows=[...new Set(group.rows)].sort((a,b)=>a-b),spans=[];let a=null,b=null;for(const row of rows){if(a==null){a=b=row;continue;}if(row===b+1){b=row;continue;}spans.push([a,b]);a=b=row;}if(a!=null)spans.push([a,b]);return {...group,rows,spans,count:rows.length,key:`fill:${group.value}`,kind:'fill',label:'颜色'};});
  }
  function featureGroups(set,{rows:rowFilter=null,startRow=1}={}){
    const allowed=rowFilter?new Set(rowFilter):null,cache=styleLookup(set),fillRows=new Map(),groups=new Map();
    for(let row=Math.max(0,startRow);row<(set?.rows?.length||0);row++){
      if(allowed&&!allowed.has(row))continue;const feature=dominantRowFeature(set,row,cache);if(!feature)continue;
      if(feature.kind==='fill'){if(!fillRows.has(feature.value))fillRows.set(feature.value,[]);fillRows.get(feature.value).push(row);continue;}
      const key=`${feature.kind}:${feature.value}`;if(!groups.has(key))groups.set(key,{key,rows:[],kind:feature.kind,value:feature.value,label:feature.label});groups.get(key).rows.push(row);
    }
    const fillClusters=[];for(const [value,rows] of [...fillRows.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]))){let best=null;for(const cluster of fillClusters){const distance=colorDistance(value,cluster.value);if(distance<=COLOR_SIMILARITY_THRESHOLD&&(!best||distance<best.distance))best={cluster,distance};}if(best){best.cluster.rows.push(...rows);best.cluster.variants.push(value);}else fillClusters.push({key:`fill:${value}`,rows:[...rows],kind:'fill',value,label:'颜色',variants:[value]});}
    const fills=orderColorGroups(fillClusters.map(g=>({...g,rows:[...new Set(g.rows)].sort((a,b)=>a-b),count:new Set(g.rows).size}))).map(g=>({...g,key:`fill:${g.value}`}));
    const others=[...groups.values()].map(g=>({...g,count:g.rows.length})).filter(g=>g.count>=2).sort((a,b)=>{const weight={'font-color':1,bold:2,border:3,italic:4};return (weight[a.kind]??9)-(weight[b.kind]??9)||b.count-a.count||a.key.localeCompare(b.key);});
    return [...fills,...others];
  }
  function explicitPriorityRound(entry={}){
    const explicit=entry?.priorityRoundExplicit===true||entry?.batchExplicit===true;if(!explicit)return'';
    const raw=entry?.priorityRound||entry?.batch||'';const round=parseRound(raw);return round!=null?`R${round+1}`:'';
  }
  const explicitBatch=explicitPriorityRound;
  function knownPriorityRounds(state,entries=[]){
    const labels=[];const push=raw=>{const label=clean(raw);if(label&&!labels.includes(label))labels.push(label);};
    for(const label of state?.priorityRounds||state?.batches||[])push(label);
    for(const entry of entries||[])push(explicitPriorityRound(entry));
    for(const entry of entries||[]){const intent=intentForEntry(state,entry);push(intent?.priorityRoundLabel||intent?.batch);}
    return labels.sort((a,b)=>{const ar=parseRound(a),br=parseRound(b);if(ar!=null||br!=null)return (ar??9999)-(br??9999)||a.localeCompare(b);return a.localeCompare(b);});
  }
  const knownBatches=knownPriorityRounds;
  function nextPriorityRoundLabel(state,entries=[]){const used=new Set();for(const label of knownPriorityRounds(state,entries)){const round=parseRound(label);if(round!=null)used.add(round+1);}let n=1;while(used.has(n)&&n<999)n++;return `R${n}`;}
  const nextBatchLabel=nextPriorityRoundLabel;
  function createPriorityRound(state,entries=[],preferred=''){
    const next=createState(state),label=clean(preferred)||nextPriorityRoundLabel(next,entries);if(!next.priorityRounds.includes(label))next.priorityRounds.push(label);next.batches=[...next.priorityRounds];next.activePriorityRound=label;next.activeBatch=label;next.lastUpdatedAt=new Date().toISOString();return {state:next,label};
  }
  const createBatch=createPriorityRound;
  function setActivePriorityRound(state,label=''){const next=createState(state),value=clean(label);next.activePriorityRound=value;next.activeBatch=value;return next;}
  const setActiveBatch=setActivePriorityRound;
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
    const m=String(raw||'').match(/(?:第\s*)?([一二三四五六七八九十]{1,3})\s*轮/);if(!m)return null;
    const chars=m[1],digit={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    if(chars==='十')return 10;if(chars.includes('十')){const [a,b]=chars.split('十');return (a?digit[a]||0:1)*10+(b?digit[b]||0:0);}return digit[chars]||null;
  }
  function parseRound(value){
    const raw=clean(value);if(!raw)return null;let m=raw.match(/^(?:R|ROUND)\s*[-:#]?\s*(\d+)$/i)||raw.match(/^(?:第\s*)?(\d+)\s*轮$/);
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
      const label=clean(value);if(!label)return {state:next,targets:[],warning:'请先新建或选择一个优先轮次。'};const roundIndex=parseRound(label);for(const entry of targets){const key=entryKey(entry),base=next.intents[key]||{};next.intents[key]={...base,priorityRoundLabel:label,priorityRoundIndex:roundIndex,priorityRoundSource:'manual-selection',batch:label,roundIndex,batchSource:'manual-selection',evidence};}
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
        delete base.priorityRoundLabel;delete base.priorityRoundIndex;delete base.priorityRoundSource;delete base.batch;delete base.roundIndex;delete base.batchSource;
        if(explicitPriorityRound(entry)){base.priorityRoundSuppressed=true;base.batchSuppressed=true;base.priorityRoundSource='manual-clear';base.batchSource='manual-clear';next.intents[key]={...base,evidence};}
        else{delete base.priorityRoundSuppressed;delete base.batchSuppressed;if(!Object.keys(base).some(k=>!['evidence'].includes(k)))delete next.intents[key];else next.intents[key]={...base,evidence};}
      }
      else{const label=clean(batch);if(!label)continue;const roundIndex=parseRound(label);delete base.priorityRoundSuppressed;delete base.batchSuppressed;next.intents[key]={...base,priorityRoundLabel:label,priorityRoundIndex:roundIndex,priorityRoundSource:evidenceSource,batch:label,roundIndex,batchSource:evidenceSource,evidence};if(!next.priorityRounds.includes(label))next.priorityRounds.push(label);next.batches=[...next.priorityRounds];next.activePriorityRound=label;next.activeBatch=label;}
    }
    if(!unique.length)return {state:next,targets:[],warning:'当前选择没有命中联系人。'};
    if(!clear&&!clean(batch))return {state:next,targets:[],warning:'请先新建或选择一个优先轮次。'};
    next.sourceKey=sourceKey(set);next.lastUpdatedAt=stamp;return {state:next,targets:unique};
  }
  function summary(state,entries=[]){
    let priority=0,batch=0,fixed=0,label=0;
    for(const entry of entries){const intent=intentForEntry(state,entry);if(!intent)continue;if(Number.isFinite(Number(intent.priorityOrder)))priority++;if(intent.priorityRoundLabel||intent.batch)batch++;if(intent.fixedAt)fixed++;if(intent.label)label++;}
    return {priority,batch,fixed,label,total:new Set(entries.filter(e=>intentForEntry(state,e)).map(entryKey)).size};
  }

  const applyPriorityRoundToEntries=applyBatchToEntries;
  globalThis.NMDARosterPlanner={createState,sourceKey,entryKey,excelVisual,styleLookup,styleAt,cssForStyle,columnLabel,rangeLabel,normalizeRange,columnPlan,projectedMerges,dominantRowFeature,visualGroups,featureGroups,colorDistance,entriesForRange,intentForEntry,parseRound,explicitPriorityRound,explicitBatch,knownPriorityRounds,knownBatches,nextPriorityRoundLabel,nextBatchLabel,createPriorityRound,createBatch,setActivePriorityRound,setActiveBatch,applyInterpretation,applyPriorityRoundToEntries,applyBatchToEntries,summary};
})();
