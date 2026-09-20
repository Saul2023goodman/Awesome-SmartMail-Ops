(() => {
  'use strict';
  const Core=globalThis.NMDAImportCore, Mail=globalThis.NMDAMailRecognizer;
  if(!Core||!Mail)throw new Error('Import Adapter 初始化失败：邮件识别核心未加载。');

  function bytesOf(buffer){ return buffer instanceof Uint8Array?buffer:new Uint8Array(buffer); }
  function decodeText(buffer){
    const bytes=bytesOf(buffer);
    for(const enc of ['utf-8','gb18030']){
      try{return new TextDecoder(enc,{fatal:enc==='utf-8'}).decode(bytes).replace(/^\ufeff/,'');}catch(_){}
    }
    return new TextDecoder().decode(bytes).replace(/^\ufeff/,'');
  }
  function extOf(name){ const m=String(name||'').toLowerCase().match(/\.([^.\\/]+)$/); return m?.[1]||''; }
  function starts(bytes,arr){return arr.every((v,i)=>bytes[i]===v);}

  function findEocd(view){ const min=Math.max(0,view.byteLength-65557); for(let i=view.byteLength-22;i>=min;i--)if(view.getUint32(i,true)===0x06054b50)return i; throw new Error('ZIP 目录损坏或文件不是有效 ZIP。'); }
  async function inflateRaw(bytes){
    if(typeof DecompressionStream!=='function')throw new Error('当前 Chrome 不支持 ZIP 解压。');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buffer){
    const view=new DataView(buffer), bytes=new Uint8Array(buffer), eocd=findEocd(view), total=view.getUint16(eocd+10,true); let pos=view.getUint32(eocd+16,true);
    const entries=new Map(), decoder=new TextDecoder('utf-8');
    for(let idx=0;idx<total;idx++){
      if(view.getUint32(pos,true)!==0x02014b50)throw new Error('ZIP 中央目录损坏。');
      const method=view.getUint16(pos+10,true), compressedSize=view.getUint32(pos+20,true), fileNameLength=view.getUint16(pos+28,true), extraLength=view.getUint16(pos+30,true), commentLength=view.getUint16(pos+32,true), localOffset=view.getUint32(pos+42,true);
      const name=decoder.decode(bytes.slice(pos+46,pos+46+fileNameLength)).replace(/^\/+/, '');
      if(view.getUint32(localOffset,true)!==0x04034b50)throw new Error(`ZIP 项损坏：${name}`);
      const localNameLength=view.getUint16(localOffset+26,true), localExtraLength=view.getUint16(localOffset+28,true), dataStart=localOffset+30+localNameLength+localExtraLength, compressed=bytes.slice(dataStart,dataStart+compressedSize);
      let output;if(method===0)output=compressed;else if(method===8)output=await inflateRaw(compressed);else throw new Error(`ZIP 压缩方式 ${method} 暂不支持。`);
      entries.set(name,output); pos+=46+fileNameLength+extraLength+commentLength;
    }
    return entries;
  }
  function xmlFromBytes(bytes,label='XML'){
    const doc=new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes),'application/xml');
    if(doc.querySelector('parsererror'))throw new Error(`${label} 无法解析。`); return doc;
  }
  function xmlFromText(text,label='XML'){
    const doc=new DOMParser().parseFromString(text,'application/xml'); if(doc.querySelector('parsererror'))throw new Error(`${label} 无法解析。`); return doc;
  }
  function els(root,name){
    if(!root)return[]; try{const n=root.getElementsByTagNameNS?.('*',name);if(n?.length)return Array.from(n);}catch(_){}
    return Array.from(root.getElementsByTagName?.('*')||[]).filter(el=>(el.localName||el.tagName||'').split(':').pop()===name);
  }
  function first(root,name){return els(root,name)[0]||null;}
  function attrLocal(el,name){
    if(!el)return null; if(el.hasAttribute?.(name))return el.getAttribute(name);
    for(const a of Array.from(el.attributes||[]))if((a.localName||a.name||'').split(':').pop()===name)return a.value;
    return null;
  }

  // Rich-mail import deliberately keeps only portable author emphasis.  The goal is
  // not to reproduce arbitrary Word/HTML styling, but to preserve meaningful email
  // formatting (italic/bold/underline/strike, links and line breaks) all the way to
  // preview + NetEase compose without importing unsafe style/event markup.
  function escapeRichText(value){return String(value??'').replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));}
  function wrapRichFlags(content,{bold=false,italic=false,underline=false,strike=false}={}){
    let out=content;if(strike)out=`<s>${out}</s>`;if(underline)out=`<u>${out}</u>`;if(italic)out=`<em>${out}</em>`;if(bold)out=`<strong>${out}</strong>`;return out;
  }
  function safeRichHref(value){
    const href=String(value||'').trim();
    return /^(?:https?:|mailto:)/i.test(href)?href:'';
  }
  function sanitizeInlineRichHtml(html){
    const doc=new DOMParser().parseFromString(`<div>${String(html||'')}</div>`,'text/html'),root=doc.body.firstElementChild;
    if(!root)return'';
    const render=node=>{
      if(node.nodeType===3)return escapeRichText(node.nodeValue||'');
      if(node.nodeType!==1)return'';
      const tag=String(node.tagName||'').toLowerCase();
      if(tag==='br')return'<br>';
      const content=Array.from(node.childNodes||[]).map(render).join('');
      const style=String(node.getAttribute?.('style')||'').toLowerCase();
      const flags={
        bold:['strong','b'].includes(tag)||/font-weight\s*:\s*(?:bold|[6-9]00)/.test(style),
        italic:['em','i'].includes(tag)||/font-style\s*:\s*italic/.test(style),
        underline:tag==='u'||/text-decoration[^;]*underline/.test(style),
        strike:['s','strike','del'].includes(tag)||/text-decoration[^;]*(?:line-through|strike)/.test(style)
      };
      let out=wrapRichFlags(content,flags);
      if(tag==='a'){
        const href=safeRichHref(node.getAttribute?.('href'));
        if(href)out=`<a href="${escapeRichText(href)}">${out}</a>`;
      }
      return out;
    };
    return Array.from(root.childNodes||[]).map(render).join('');
  }
  function richFormatFeatures(html){
    const value=String(html||'');
    return{
      italic:(value.match(/<(?:em|i)\b/gi)||[]).length,
      bold:(value.match(/<(?:strong|b)\b/gi)||[]).length,
      underline:(value.match(/<u\b/gi)||[]).length,
      strike:(value.match(/<s\b/gi)||[]).length,
      link:(value.match(/<a\b/gi)||[]).length
    };
  }

  function detectDelimited(text,preferred=null){
    if(preferred)return preferred; const lines=text.split(/\r?\n/).filter(l=>l.trim()).slice(0,12), choices=[',','\t',';','|']; let best={d:',',score:-1};
    for(const d of choices){const counts=lines.map(line=>{let q=false,c=0;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"')i++;else q=!q;}else if(!q&&ch===d)c++;}return c;}); const nonZero=counts.filter(Boolean); const consistency=nonZero.length?1-(Math.max(...nonZero)-Math.min(...nonZero))/Math.max(1,Math.max(...nonZero)):0; const score=counts.reduce((a,b)=>a+b,0)+nonZero.length*4+consistency*12;if(score>best.score)best={d,score};}
    return best.d;
  }
  function parseDelimited(text,d){
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=ch;}else if(ch==='"')quoted=true;else if(ch===d){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=ch;}
    if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);} return Core.normalizeRows(rows);
  }

  function objectArrayToRows(items){
    const headers=[],seen=new Set(); for(const item of items){if(!item||typeof item!=='object'||Array.isArray(item))continue;for(const k of Object.keys(item))if(!seen.has(k)){seen.add(k);headers.push(k);}}
    return [headers,...items.map(item=>headers.map(k=>{const v=item?.[k];if(Array.isArray(v))return v.join(';');if(v&&typeof v==='object')return JSON.stringify(v);return v??'';}))];
  }
  function parseJsonValue(data){
    if(Array.isArray(data)){if(!data.length)return[[]];if(Array.isArray(data[0]))return data;return objectArrayToRows(data);}
    if(data&&typeof data==='object'){
      for(const key of ['data','items','records','rows','tasks','emails'])if(Array.isArray(data[key]))return parseJsonValue(data[key]);
      const arrays=Object.values(data).filter(Array.isArray); if(arrays.length===1)return parseJsonValue(arrays[0]); return objectArrayToRows([data]);
    }
    throw new Error('JSON 顶层必须是对象或数组。');
  }
  function parseNdjson(text){const arr=[];for(const [i,line] of text.split(/\r?\n/).entries()){if(!line.trim())continue;try{arr.push(JSON.parse(line));}catch(e){throw new Error(`JSONL 第 ${i+1} 行无法解析：${e.message}`);}}return parseJsonValue(arr);}

  function parseVerticalRecords(text){
    const blocks=text.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean), records=[]; let recognized=0;
    for(const block of blocks){const obj={};for(const line of block.split(/\r?\n/)){const m=line.match(/^\s*([^:：]{1,40})\s*[:：]\s*(.*)$/);if(!m)continue;const match=Core.matchHeader(m[1]);if(match){obj[match.field]=m[2];recognized++;}else obj[m[1].trim()]=m[2];}if(Object.keys(obj).length)records.push(obj);}
    if(records.length>=2&&recognized>=records.length)return objectArrayToRows(records); return null;
  }

  function parseHtmlTables(text){
    const doc=new DOMParser().parseFromString(text,'text/html'), tables=[...doc.querySelectorAll('table')];
    return tables.map((table,i)=>{const rows=[...table.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll(':scope > th, :scope > td')].map(td=>td.innerText||td.textContent||'')); return {name:table.getAttribute('aria-label')||table.querySelector('caption')?.textContent?.trim()||`HTML表格${i+1}`,rows};});
  }

  function parseSpreadsheetXml(doc){
    const sheets=[]; for(const ws of els(doc,'Worksheet')){const name=attrLocal(ws,'Name')||`Sheet${sheets.length+1}`, rows=[];for(const rowEl of els(first(ws,'Table')||ws,'Row')){const row=[];let col=0;for(const cell of Array.from(rowEl.children||[]).filter(x=>(x.localName||'').split(':').pop()==='Cell')){const idx=Number(attrLocal(cell,'Index'));if(idx>0)col=idx-1;const data=first(cell,'Data');row[col++]=data?.textContent??'';}rows.push(row);}sheets.push({name,rows});}
    if(!sheets.length)throw new Error('Excel XML 中没有 Worksheet。'); return sheets;
  }

  function parseOdsDocument(doc){
    const sheets=[]; for(const table of els(doc,'table')){const name=attrLocal(table,'name')||`Sheet${sheets.length+1}`, rows=[];for(const rowEl of Array.from(table.children||[]).filter(x=>(x.localName||'').split(':').pop()==='table-row')){const repeatRow=Math.min(1000,Number(attrLocal(rowEl,'number-rows-repeated'))||1);const row=[];for(const cell of Array.from(rowEl.children||[]).filter(x=>['table-cell','covered-table-cell'].includes((x.localName||'').split(':').pop()))){const repeat=Math.min(1000,Number(attrLocal(cell,'number-columns-repeated'))||1);let value='';const valueType=attrLocal(cell,'value-type'), date=attrLocal(cell,'date-value'), num=attrLocal(cell,'value');if(date)value=date;else if(valueType==='float'&&num!=null)value=Number(num);else value=els(cell,'p').map(p=>p.textContent||'').join('\n');for(let i=0;i<repeat;i++)row.push(value);}for(let r=0;r<repeatRow;r++)rows.push([...row]);}sheets.push({name,rows});}
    if(!sheets.length)throw new Error('ODS/FODS 中没有工作表。'); return sheets;
  }


  // ---------- Source-agnostic Mail Primitive Bridge ----------
  // Every text-capable format can feed ordered blocks here. Format adapters only preserve order;
  // mail-recognizer.js owns segmentation and semantic evidence.
  function mailRecordSetFromBlocks(blocks,sourceFile,{preferred=true,minStrongRatio=.6}={}){
    const scan=Mail.recognizeMailFrames(blocks,{sourceFile,includeWeak:true});
    if(!scan.records.length)return null;
    const strong=scan.records.filter(r=>r.confidence>=70).length;
    if(strong<Math.max(1,Math.ceil(scan.records.length*minStrongRatio)))return null;
    const sourceBlocks=(scan.blocks||[]).map(b=>({index:b.index,type:b.type||'block',style:b.style||'',tag:b.tag||'',text:b.text||'',formatFeatures:{...(b.formatFeatures||{})}}));
    const rowMeta=Mail.rowMetaFromRecords(scan.records);
    // Keep a compact evidence window per mail row. This survives multi-file merging, where collection-level
    // sourceBlocks would otherwise become ambiguous across different source documents.
    for(const meta of Object.values(rowMeta)){
      const start=Math.max(0,Number(meta.startBlock||0)-8), end=Math.min(sourceBlocks.length-1,Number(meta.consumedEndBlock ?? meta.endBlock ?? meta.startBlock ?? 0)+8);
      meta.sourceContext=sourceBlocks.slice(start,end+1).map((b,pos)=>({...b,position:start+pos}));
      meta.sourceContextStart=start;
    }
    const recordSet={name:`邮件基础信息识别（${scan.records.length} 条）`,rows:Mail.recordsToRows(scan.records),source:sourceFile,meta:{
      kind:'mail-frames',mailFrames:true,preferred,rowMeta,mailScan:scan.stats,
      // Preserve full ordered primitive blocks for single-source diagnostics; rowMeta.sourceContext is the
      // portable human-review evidence used after multi-source merges.
      sourceBlocks
    }};
    const incomplete=scan.records.filter(r=>!r.recipients||!r.subject||!r.body).length;
    const warnings=[];
    if(incomplete)warnings.push(`邮件原语识别得到 ${scan.records.length} 条邮件，其中 ${incomplete} 条缺少收件人/主题/正文之一，已保留进入人工校正队列。`);
    if(scan.stats.averageConfidence<80)warnings.push(`邮件原语识别平均置信度 ${scan.stats.averageConfidence}%，建议检查待确认记录。`);
    return{recordSet,scan,warnings};
  }

  function htmlOrderedBlocks(text){
    const doc=new DOMParser().parseFromString(text,'text/html'), body=doc.body;
    if(!body)return[];
    const selector='h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,address,tr,div,section,article';
    const blocks=[];
    for(const el of Array.from(body.querySelectorAll(selector))){
      const tag=(el.tagName||'').toLowerCase();
      if(['div','section','article'].includes(tag) && el.querySelector(selector))continue;
      let value='';
      if(tag==='tr')value=Array.from(el.querySelectorAll(':scope > th, :scope > td')).map(x=>x.textContent||'').join(' | ');
      else value=el.textContent||'';
      value=value.replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').trim();
      if(value){const html=tag==='tr'?'':sanitizeInlineRichHtml(el.innerHTML||'');blocks.push({type:`html-${tag}`,tag,text:value,html,formatFeatures:richFormatFeatures(html)});}
    }
    if(!blocks.length){
      const raw=String(body.textContent||'').replace(/\r\n?/g,'\n');
      for(const line of raw.split(/\n+/).map(x=>x.trim()).filter(Boolean))blocks.push({type:'html-text',text:line,html:escapeRichText(line),formatFeatures:{italic:0,bold:0,underline:0,strike:0,link:0}});
    }
    return blocks;
  }

  // ---------- Word OOXML Adapter ----------
  // 只提取语义文本与表格；不把 Word HTML/样式注入网易页面。
  function localName(node){return (node?.localName||node?.nodeName||'').split(':').pop();}
  function wordNodeText(root){
    if(!root)return'';
    let out='';
    const walk=node=>{
      const name=localName(node);
      if(name==='t'||name==='delText'||name==='instrText')out+=node.textContent||'';
      else if(name==='tab')out+='\t';
      else if(name==='br'||name==='cr')out+='\n';
      else if(name==='noBreakHyphen')out+='-';
      else if(name==='softHyphen')out+='\u00ad';
      else for(const child of Array.from(node.childNodes||[]))walk(child);
    };
    walk(root);
    return out.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function wordRunRichHtml(run){
    if(!run)return'';
    const rPr=Array.from(run.children||[]).find(x=>localName(x)==='rPr');
    const on=name=>{
      const node=rPr&&Array.from(rPr.children||[]).find(x=>localName(x)===name);if(!node)return false;
      const val=String(attrLocal(node,'val')??'true').toLowerCase();return !['0','false','off','none'].includes(val);
    };
    let out='';
    const walk=node=>{
      const name=localName(node);
      if(name==='t'||name==='delText'||name==='instrText')out+=escapeRichText(node.textContent||'');
      else if(name==='tab')out+='&emsp;';
      else if(name==='br'||name==='cr')out+='<br>';
      else if(name==='noBreakHyphen')out+='-';
      else if(name==='softHyphen')out+='&shy;';
      else if(name!=='rPr')for(const child of Array.from(node.childNodes||[]))walk(child);
    };
    for(const child of Array.from(run.childNodes||[]))if(localName(child)!=='rPr')walk(child);
    return wrapRichFlags(out,{bold:on('b')||on('bCs'),italic:on('i')||on('iCs'),underline:!!(rPr&&Array.from(rPr.children||[]).find(x=>localName(x)==='u'&&!['0','false','off','none'].includes(String(attrLocal(x,'val')??'single').toLowerCase()))),strike:on('strike')||on('dstrike')});
  }
  function wordParagraphRichHtml(p){
    if(!p)return'';
    const render=node=>{
      const name=localName(node);
      if(name==='r')return wordRunRichHtml(node);
      if(['hyperlink','smartTag','sdt','sdtContent','ins','del'].includes(name))return Array.from(node.children||[]).map(render).join('');
      return'';
    };
    return Array.from(p.children||[]).map(render).join('');
  }
  function wordParagraphStyle(p){
    const pPr=Array.from(p?.children||[]).find(x=>localName(x)==='pPr');
    const pStyle=pPr&&els(pPr,'pStyle')[0];
    return attrLocal(pStyle,'val')||'';
  }
  function parseWordTable(tbl){
    const rows=[];
    for(const tr of Array.from(tbl.children||[]).filter(x=>localName(x)==='tr')){
      const row=[];
      for(const tc of Array.from(tr.children||[]).filter(x=>localName(x)==='tc')){
        const parts=[];
        for(const child of Array.from(tc.children||[])){
          const n=localName(child);
          if(n==='p'){const t=wordNodeText(child);if(t)parts.push(t);}
          else if(n==='tbl'){
            const nested=parseWordTable(child);
            const t=nested.map(r=>r.filter(Boolean).join(' | ')).filter(Boolean).join('\n');
            if(t)parts.push(t);
          }
        }
        row.push(parts.join('\n'));
      }
      rows.push(row);
    }
    return Core.normalizeRows(rows);
  }
  function splitWordFieldLine(text){
    const m=String(text||'').match(/^\s*([^:：]{1,48})\s*[:：]\s*(.*)$/s);
    if(!m)return null;
    const match=Core.matchHeader(m[1]);
    return match?{field:match.field,value:m[2]||'',label:m[1].trim()}:null;
  }
  const WORD_STD_HEADERS=['编号','收件人','学校 / 机构','主题','正文','附件','定时时间','任务标记','来源文件'];
  function standardWordRows(records){
    return [WORD_STD_HEADERS,...records.map(r=>[
      r.id||'',r.recipients||'',r.school||'',r.subject||'',r.body||'',r.attachments||'',r.scheduleAt||'',r.tags||'',r.sourceFile||''
    ])];
  }
  function parseWordKeyValueTable(rows,sourceFile=''){
    const usable=(rows||[]).filter(r=>r?.some(v=>String(v??'').trim()));
    if(usable.length<2)return null;
    const recognized=usable.filter(r=>Core.matchHeader(String(r?.[0]??'').trim())).length;
    if(recognized<2||recognized/usable.length<0.55)return null;
    const records=[];let current={};
    const flush=()=>{if(Object.keys(current).length){current.sourceFile=sourceFile;records.push(current);}current={};};
    for(const row of usable){
      const label=String(row?.[0]??'').trim();
      const value=(row||[]).slice(1).map(v=>String(v??'').trim()).filter(Boolean).join('\n');
      const m=Core.matchHeader(label);if(!m)continue;
      if((m.field==='recipients'||m.field==='id')&&current[m.field]&&Object.keys(current).length>=2)flush();
      if(current[m.field])current[m.field]=`${current[m.field]};${value}`;else current[m.field]=value;
    }
    flush();
    return records.length?standardWordRows(records):null;
  }
  function parseWordKeyValueRecords(paragraphs,sourceFile=''){
    const records=[];let current={},activeField=null,recognized=0;
    const flush=()=>{
      if(Object.keys(current).some(k=>k!=='sourceFile'&&String(current[k]??'').trim())){
        current.sourceFile=sourceFile;records.push(current);
      }
      current={};activeField=null;
    };
    for(const raw of paragraphs){
      const text=String(raw?.text??raw??'');
      if(!text.trim()){
        if(activeField==='body'&&current.body&&!current.body.endsWith('\n'))current.body+='\n';
        continue;
      }
      const parsed=splitWordFieldLine(text);
      if(parsed){
        if((parsed.field==='recipients'||parsed.field==='id'||parsed.field==='subject')&&current[parsed.field]&&Object.keys(current).length>=2)flush();
        recognized++;activeField=parsed.field;
        if(parsed.field==='body')current.body=parsed.value||'';
        else if(current[parsed.field])current[parsed.field]=`${current[parsed.field]};${parsed.value}`;
        else current[parsed.field]=parsed.value;
        continue;
      }
      const boundary=Mail.classifyBoundaryBlock?.(text,{phase:'open-ended'});
      if(activeField==='body'&&boundary?.hard){activeField=null;continue;}
      if(activeField==='body')current.body=(current.body?`${current.body}\n`:'')+text;
      else if((current.recipients||current.subject)&&!current.body){current.body=text;activeField='body';}
    }
    flush();
    const useful=records.filter(r=>r.recipients||r.subject||r.body);
    return useful.length&&recognized>=1?standardWordRows(useful):null;
  }
  function parseDocxDocument(doc,sourceFile=''){
    const body=first(doc,'body');if(!body)throw new Error('DOCX 缺少 Word 正文。');
    const tables=[],paragraphs=[],blocks=[];let tableIndex=0;
    for(const child of Array.from(body.children||[])){
      const n=localName(child);
      if(n==='tbl'){
        const rows=parseWordTable(child);
        if(rows.some(r=>r.some(v=>String(v??'').trim()))){
          const table={name:`Word表格${++tableIndex}`,rows,source:sourceFile,meta:{word:true,kind:'table'}};
          tables.push(table);
          for(const row of rows){const text=(row||[]).map(v=>String(v??'').trim()).filter(Boolean).join(' | ');if(text)blocks.push({type:'table-row',text,table:table.name});}
        }
      }else if(n==='p'){
        const html=wordParagraphRichHtml(child),para={text:wordNodeText(child),style:wordParagraphStyle(child),html,formatFeatures:richFormatFeatures(html)};
        paragraphs.push(para); if(para.text)blocks.push({type:'paragraph',text:para.text,style:para.style,html:para.html,formatFeatures:para.formatFeatures});
      }
    }
    return{tables,paragraphs,blocks};
  }
  async function parseDocx(buffer,file){
    const entries=await unzip(buffer),documentBytes=entries.get('word/document.xml');
    if(!documentBytes)throw new Error('DOCX 缺少 word/document.xml。');
    const parsed=parseDocxDocument(xmlFromBytes(documentBytes,'Word document.xml'),file.name);
    const recordSets=[],warnings=[];

    // Source-agnostic first pass: find actual mail frames from the most primitive email evidence.
    // Word paragraph/table structure is treated only as an ordered text carrier.
    const mailBridge=mailRecordSetFromBlocks(parsed.blocks,file.name,{preferred:true,minStrongRatio:.55});
    const mailScan=mailBridge?.scan || {records:[],stats:{records:0,averageConfidence:0}};
    if(mailBridge){
      mailBridge.recordSet.meta={...mailBridge.recordSet.meta,word:true,wordTaskRows:true};
      recordSets.push(mailBridge.recordSet);
      warnings.push(...mailBridge.warnings);
    }

    // Structured fallbacks remain available when no robust mail frame exists.
    for(const table of parsed.tables){
      const kv=parseWordKeyValueTable(table.rows,file.name);
      if(kv)recordSets.push({name:`${table.name} · 字段记录`,rows:kv,source:file.name,meta:{word:true,kind:'key-value-table',wordTaskRows:true,supplemental:mailScan.records.length>0}});
      else recordSets.push({...table,meta:{...(table.meta||{}),supplemental:mailScan.records.length>0}});
    }
    const paragraphs=parsed.paragraphs.map(p=>p.text);
    if(!mailScan.records.length){
      const structured=parseWordKeyValueRecords(paragraphs,file.name);
      if(structured)recordSets.push({name:'Word字段记录',rows:structured,source:file.name,meta:{word:true,kind:'records',wordTaskRows:true}});
    }
    if(!recordSets.length){
      const body=paragraphs.filter(Boolean).join('\n\n').trim();
      if(!body)throw new Error('Word 文档没有可读取的正文或表格。');
      const stem=String(file.name||'Word').replace(/\.[^.]+$/,'');
      recordSets.push({name:'Word文档任务',rows:standardWordRows([{id:stem,body,sourceFile:file.name}]),source:file.name,meta:{word:true,kind:'document',wordTaskRows:true,oneFileTask:true}});
    }
    const media=[...entries.keys()].filter(n=>n.startsWith('word/media/')&&!n.endsWith('/'));
    if(media.length)warnings.push(`Word 文档包含 ${media.length} 个内嵌媒体文件；当前只提取正文/表格，内嵌图片不会自动作为邮件附件。`);
    return{recordSets,warnings,entries,mailScan};
  }

  function resolveTarget(base,target){if(String(target||'').startsWith('/'))return String(target).replace(/^\/+/, '');const p=base.split('/');p.pop();for(const part of String(target||'').split('/')){if(!part||part==='.')continue;if(part==='..')p.pop();else p.push(part);}return p.join('/');}
  function columnIndex(ref){const letters=String(ref||'').match(/^[A-Z]+/i)?.[0]?.toUpperCase()||'';let n=0;for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;return Math.max(0,n-1);}
  function parseSharedStrings(doc){return doc?els(doc,'si').map(si=>els(si,'t').map(t=>t.textContent||'').join('')):[];}

  const EXCEL_INDEXED_COLORS=['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080'];
  const EXCEL_BUILTIN_DATE_FORMATS=new Map([
    [14,'m/d/yy'],[15,'d-mmm-yy'],[16,'d-mmm'],[17,'mmm-yy'],[18,'h:mm AM/PM'],[19,'h:mm:ss AM/PM'],[20,'h:mm'],[21,'h:mm:ss'],[22,'m/d/yy h:mm'],
    [27,'yyyy/m/d'],[28,'yyyy/m/d'],[29,'yyyy/m/d'],[30,'m/d/yy'],[31,'yyyy年m月d日'],[32,'h时mm分'],[33,'h时mm分ss秒'],[34,'上午/下午h时mm分'],[35,'上午/下午h时mm分ss秒'],[36,'yyyy年m月'],
    [45,'mm:ss'],[46,'[h]:mm:ss'],[47,'mmss.0'],[50,'yyyy/m/d'],[51,'yyyy/m/d'],[52,'yyyy/m/d'],[53,'yyyy/m/d'],[54,'yyyy/m/d'],[55,'yyyy/m/d'],[56,'yyyy/m/d'],[57,'yyyy/m/d'],[58,'yyyy/m/d']
  ]);
  function clampByte(v){return Math.max(0,Math.min(255,Math.round(Number(v)||0)));}
  function normalizeHexColor(raw){
    const value=String(raw||'').replace(/^#/,'').trim();
    if(/^[0-9a-f]{8}$/i.test(value))return value.slice(2).toUpperCase();
    if(/^[0-9a-f]{6}$/i.test(value))return value.toUpperCase();
    return '';
  }
  function tintHexColor(hex,tintRaw){
    const clean=normalizeHexColor(hex);if(!clean)return'';
    const tint=Number(tintRaw);if(!Number.isFinite(tint)||Math.abs(tint)<1e-9)return clean;
    const channels=[0,2,4].map(i=>parseInt(clean.slice(i,i+2),16));
    const adjusted=channels.map(c=>tint<0?c*(1+tint):c*(1-tint)+255*tint);
    return adjusted.map(c=>clampByte(c).toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  function parseThemeColors(doc){
    const scheme=first(doc,'clrScheme');if(!scheme)return[];
    const out=[];
    for(const child of Array.from(scheme.children||[])){
      const color=first(child,'srgbClr')||first(child,'sysClr');
      const raw=color?.getAttribute?.('val')||color?.getAttribute?.('lastClr')||'';
      out.push(normalizeHexColor(raw));
    }
    return out;
  }
  function resolveExcelColor(colorEl,theme=[]){
    if(!colorEl)return'';
    let hex=normalizeHexColor(colorEl.getAttribute?.('rgb')||'');
    if(!hex){
      const themeIndex=Number(colorEl.getAttribute?.('theme'));
      if(Number.isInteger(themeIndex)&&themeIndex>=0)hex=theme[themeIndex]||'';
    }
    if(!hex){
      const indexed=Number(colorEl.getAttribute?.('indexed'));
      if(Number.isInteger(indexed)&&indexed>=0)hex=EXCEL_INDEXED_COLORS[indexed]||'';
    }
    if(!hex&&String(colorEl.getAttribute?.('auto')||'')==='1')hex='';
    return tintHexColor(hex,colorEl.getAttribute?.('tint'));
  }
  function directChildren(root,name){return Array.from(root?.children||[]).filter(el=>(el.localName||el.tagName||'').split(':').pop()===name);}
  function parseBorderSide(side,theme){
    if(!side)return null;const style=String(side.getAttribute?.('style')||'');const color=resolveExcelColor(first(side,'color'),theme);
    return style||color?{style,color:color?`#${color}`:''}:null;
  }
  function parseXlsxStyles(stylesDoc,themeDoc){
    const theme=parseThemeColors(themeDoc),customNumFmts=new Map();
    for(const numFmt of els(first(stylesDoc,'numFmts'),'numFmt')){
      const id=Number(numFmt.getAttribute('numFmtId')),code=String(numFmt.getAttribute('formatCode')||'');if(Number.isFinite(id))customNumFmts.set(id,code);
    }
    const fonts=directChildren(first(stylesDoc,'fonts'),'font').map(font=>{
      const size=Number(first(font,'sz')?.getAttribute?.('val'))||null;
      const name=String(first(font,'name')?.getAttribute?.('val')||'');
      const color=resolveExcelColor(first(font,'color'),theme);
      return {bold:!!first(font,'b'),italic:!!first(font,'i'),underline:!!first(font,'u'),strike:!!first(font,'strike'),size,name,color:color?`#${color}`:''};
    });
    const fills=directChildren(first(stylesDoc,'fills'),'fill').map(fill=>{
      const pattern=first(fill,'patternFill'),patternType=String(pattern?.getAttribute?.('patternType')||'');
      const fg=resolveExcelColor(first(pattern,'fgColor'),theme),bg=resolveExcelColor(first(pattern,'bgColor'),theme);
      return {pattern:patternType,fg:fg?`#${fg}`:'',bg:bg?`#${bg}`:''};
    });
    const borders=directChildren(first(stylesDoc,'borders'),'border').map(border=>({
      left:parseBorderSide(first(border,'left'),theme),right:parseBorderSide(first(border,'right'),theme),top:parseBorderSide(first(border,'top'),theme),bottom:parseBorderSide(first(border,'bottom'),theme)
    }));
    const xfs=directChildren(first(stylesDoc,'cellXfs'),'xf');
    const styles=xfs.map((xf,index)=>{
      const fontId=Number(xf.getAttribute('fontId'))||0,fillId=Number(xf.getAttribute('fillId'))||0,borderId=Number(xf.getAttribute('borderId'))||0,numFmtId=Number(xf.getAttribute('numFmtId'))||0;
      const alignment=first(xf,'alignment');
      const numberFormat=customNumFmts.get(numFmtId)||EXCEL_BUILTIN_DATE_FORMATS.get(numFmtId)||'';
      return {id:index,font:fonts[fontId]||{},fill:fills[fillId]||{},border:borders[borderId]||{},numFmtId,numberFormat,alignment:{horizontal:String(alignment?.getAttribute?.('horizontal')||''),vertical:String(alignment?.getAttribute?.('vertical')||''),wrap:String(alignment?.getAttribute?.('wrapText')||'')==='1',textRotation:Number(alignment?.getAttribute?.('textRotation')||0)||0}};
    });
    return {styles:styles.length?styles:[{id:0,font:{},fill:{},border:{},numFmtId:0,numberFormat:'',alignment:{}}],theme};
  }
  function looksLikeExcelDateFormat(code){
    const clean=String(code||'').replace(/"[^"]*"/g,'').replace(/\\./g,'').replace(/\[[^\]]*\]/g,'').toLowerCase();
    if(!clean)return false;
    return /(?:^|[^a-z])[ymdhis]+(?:[^a-z]|$)/.test(clean)||/(?:am\/pm|上午|下午|年|月|日|时|分|秒)/.test(clean);
  }
  function excelSerialToText(value,numberFormat=''){
    const serial=Number(value);if(!Number.isFinite(serial)||!looksLikeExcelDateFormat(numberFormat))return value;
    const ms=Math.round((serial-25569)*86400000),date=new Date(ms);if(Number.isNaN(date.getTime()))return value;
    const pad=n=>String(n).padStart(2,'0'),y=date.getUTCFullYear(),m=pad(date.getUTCMonth()+1),d=pad(date.getUTCDate()),hh=pad(date.getUTCHours()),mm=pad(date.getUTCMinutes()),ss=pad(date.getUTCSeconds());
    const hasTime=/(?:h|s|am\/pm|时|分|秒)/i.test(String(numberFormat||''));
    return hasTime?`${y}-${m}-${d} ${hh}:${mm}${ss!=='00'?`:${ss}`:''}`:`${y}-${m}-${d}`;
  }
  function parseWorksheet(doc,shared,styleBook={styles:[{}]}){
    const rows=[],cellStyles=[],rowStyles={},rowHeights={},hiddenRows=[],colWidths=[],colStyles=[],hiddenCols=[],merges=[];let maxCol=0;
    for(const rowEl of els(doc,'row')){
      const rn=Number(rowEl.getAttribute('r'))||rows.length+1,row=[];
      const rowStyleId=Math.max(0,Number(rowEl.getAttribute('s'))||0);if(rowStyleId)rowStyles[rn-1]=rowStyleId;
      const ht=Number(rowEl.getAttribute('ht'));if(Number.isFinite(ht)&&ht>0)rowHeights[rn-1]=ht;
      if(String(rowEl.getAttribute('hidden')||'')==='1')hiddenRows.push(rn-1);
      for(const c of directChildren(rowEl,'c')){
        const col=columnIndex(c.getAttribute('r')),type=c.getAttribute('t')||'',v=first(c,'v')?.textContent??'',styleId=Math.max(0,Number(c.getAttribute('s'))||0);let value=v;
        if(type==='s')value=shared[Number(v)]??'';
        else if(type==='inlineStr')value=els(c,'t').map(t=>t.textContent||'').join('');
        else if(type==='b')value=v==='1';
        else if(type==='str')value=String(v||'');
        else if(type==='n'||!type){const n=Number(v);value=v!==''&&Number.isFinite(n)?excelSerialToText(n,styleBook.styles?.[styleId]?.numberFormat||''):v;}
        row[col]=value;maxCol=Math.max(maxCol,col+1);if(styleId)cellStyles.push([rn-1,col,styleId]);
      }
      while(rows.length<rn-1)rows.push([]);rows[rn-1]=row;
    }
    for(const colEl of els(first(doc,'cols'),'col')){
      const min=Math.max(1,Number(colEl.getAttribute('min'))||1),max=Math.max(min,Number(colEl.getAttribute('max'))||min),width=Number(colEl.getAttribute('width')),colStyleId=Math.max(0,Number(colEl.getAttribute('style'))||0);
      if(Number.isFinite(width)&&width>0)colWidths.push([min-1,max-1,width]);
      if(colStyleId)colStyles.push([min-1,max-1,colStyleId]);
      if(String(colEl.getAttribute('hidden')||'')==='1')hiddenCols.push([min-1,max-1]);
    }
    // Excel stores a merged range's value only in its top-left cell. Vertical
    // merges are commonly used for one university spanning several supervisors;
    // expand that hierarchy before semantic detection so downstream logic sees
    // the institution on every record. Horizontal header merges stay untouched.
    for(const merge of els(doc,'mergeCell')){
      const ref=String(merge.getAttribute('ref')||''),parts=ref.split(':');if(parts.length!==2)continue;
      const a=parts[0].match(/^([A-Z]+)(\d+)$/i),b=parts[1].match(/^([A-Z]+)(\d+)$/i);if(!a||!b)continue;
      const c1=columnIndex(a[1]),c2=columnIndex(b[1]),r1=Number(a[2])-1,r2=Number(b[2])-1;merges.push([r1,c1,r2,c2]);maxCol=Math.max(maxCol,c2+1);
      // Keep worksheet rows visually faithful to the XLSX. A merged cell's value
      // stays only at its real top-left anchor. Semantic consumers resolve merged
      // context separately; mutating rows here makes the renderer look as though
      // Excel merges were split into independent cells.
    }
    const normalized=Core.normalizeRows(rows);
    return {rows:normalized,visual:{version:1,styleTable:styleBook.styles||[],cellStyles,rowStyles,colStyles,merges,rowHeights,colWidths,hiddenRows,hiddenCols,usedRange:{rows:normalized.length,cols:maxCol},hasFormatting:!!(cellStyles.length||Object.keys(rowStyles).length||colStyles.length||merges.length||Object.keys(rowHeights).length||colWidths.length)}};
  }
  function xmlEntry(entries,path,required=true){const bytes=entries.get(path.replace(/^\/+/,''));if(!bytes){if(!required)return null;throw new Error(`文件缺少：${path}`);}return xmlFromBytes(bytes,path);}
  async function parseXlsx(buffer){
    const entries=await unzip(buffer),wb=xmlEntry(entries,'xl/workbook.xml'),rels=xmlEntry(entries,'xl/_rels/workbook.xml.rels'),shared=parseSharedStrings(xmlEntry(entries,'xl/sharedStrings.xml',false));
    const stylesDoc=xmlEntry(entries,'xl/styles.xml',false),themeDoc=xmlEntry(entries,'xl/theme/theme1.xml',false),styleBook=parseXlsxStyles(stylesDoc,themeDoc),relMap=new Map();
    for(const rel of els(rels,'Relationship'))relMap.set(rel.getAttribute('Id'),rel.getAttribute('Target'));
    const sheets=[];
    for(const sh of els(wb,'sheet')){
      const name=sh.getAttribute('name')||`Sheet${sheets.length+1}`,rid=sh.getAttribute('r:id')||attrLocal(sh,'id'),target=relMap.get(rid);if(!target)continue;
      const path=resolveTarget('xl/workbook.xml',target),parsed=parseWorksheet(xmlEntry(entries,path),shared,styleBook);
      sheets.push({name,rows:parsed.rows,meta:{xlsx:true,excelVisual:parsed.visual}});
    }
    if(!sheets.length)throw new Error('XLSX 中没有可读取的工作表。');return {sheets,entries};
  }
  async function parseOdsZip(buffer){const entries=await unzip(buffer), content=entries.get('content.xml');if(!content)throw new Error('ODS 缺少 content.xml。');return {sheets:parseOdsDocument(xmlFromBytes(content,'ODS content.xml')),entries};}

  function makeVirtualFile(name,bytes){const file=new File([bytes],name,{type:'application/octet-stream'});try{Object.defineProperty(file,'_nmdaPath',{value:name,configurable:true});}catch(_){}return file;}

  const SUPPORTED_EXT=new Set(['xlsx','ods','fods','docx','docm','dotx','doc','csv','tsv','txt','psv','json','jsonl','ndjson','html','htm','xml','zip']);
  function candidateDataFile(file){return SUPPORTED_EXT.has(extOf(file?.name));}

  class FormatDetector {
    async detect(file,buffer=null){
      const ext=extOf(file?.name), ab=buffer||await file.arrayBuffer(), bytes=bytesOf(ab), head=decodeText(bytes.slice(0,Math.min(bytes.length,4096))).trimStart();
      if(starts(bytes,[0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]))return {format:['doc','dot'].includes(ext)?'doc':'xls',container:'ole',ext};
      if(starts(bytes,[0x50,0x4B,0x03,0x04])){
        try{const entries=await unzip(ab);if(entries.has('xl/workbook.xml'))return{format:'xlsx',container:'zip',ext,entries};if(entries.has('word/document.xml'))return{format:'docx',container:'zip',ext,entries};if(entries.has('content.xml')&&entries.has('META-INF/manifest.xml'))return{format:'ods',container:'zip',ext,entries};return{format:'zip',container:'zip',ext,entries};}catch(_){return{format:'zip',container:'zip',ext};}
      }
      if(/^\s*[\[{]/.test(head)){if(ext==='jsonl'||ext==='ndjson')return{format:'ndjson',container:'text',ext};try{JSON.parse(head.length<4096?head:decodeText(bytes));return{format:'json',container:'text',ext};}catch(_){}}
      if(/^<\?xml/i.test(head) || (ext==='xml' && /^<[^>]+/.test(head))){
        if(/office:document|urn:oasis:names:tc:opendocument/i.test(head))return{format:'fods',container:'xml',ext};
        if(/urn:schemas-microsoft-com:office:spreadsheet|<Workbook\b/i.test(head))return{format:'spreadsheetml',container:'xml',ext};
        return{format:'xml',container:'xml',ext};
      }
      if(/<!doctype\s+html|<html\b|<table\b/i.test(head))return{format:'html',container:'text',ext};
      if(ext==='jsonl'||ext==='ndjson')return{format:'ndjson',container:'text',ext};
      if(ext==='tsv')return{format:'delimited',delimiter:'\t',container:'text',ext};
      if(ext==='psv')return{format:'delimited',delimiter:'|',container:'text',ext};
      if(['csv','txt'].includes(ext))return{format:'delimited',container:'text',ext};
      return{format:ext||'text',container:'text',ext};
    }
  }

  class AdapterRegistry{
    constructor(){this.adapters=[];} register(adapter){this.adapters.push(adapter);return this;} find(format){return this.adapters.find(a=>a.formats.includes(format));}
  }

  const registry=new AdapterRegistry();
  registry.register({name:'XLSX Adapter',formats:['xlsx'],async parse({file,buffer}){const r=await parseXlsx(buffer);return new Core.NormalizedDataset({format:'xlsx',sourceFiles:[file],recordSets:r.sheets.map(s=>({...s,source:file.name}))});}});
  registry.register({name:'Word DOCX Adapter',formats:['docx'],async parse({file,buffer}){const r=await parseDocx(buffer,file);return new Core.NormalizedDataset({format:'docx',sourceFiles:[file],recordSets:r.recordSets,warnings:r.warnings,meta:{word:true}});}});
  registry.register({name:'ODS Adapter',formats:['ods'],async parse({file,buffer}){const r=await parseOdsZip(buffer);return new Core.NormalizedDataset({format:'ods',sourceFiles:[file],recordSets:r.sheets.map(s=>({...s,source:file.name}))});}});
  registry.register({name:'FODS Adapter',formats:['fods'],async parse({file,buffer}){const doc=xmlFromText(decodeText(buffer),'FODS');return new Core.NormalizedDataset({format:'fods',sourceFiles:[file],recordSets:parseOdsDocument(doc).map(s=>({...s,source:file.name}))});}});
  registry.register({name:'Excel 2003 XML Adapter',formats:['spreadsheetml'],async parse({file,buffer}){return new Core.NormalizedDataset({format:'spreadsheetml',sourceFiles:[file],recordSets:parseSpreadsheetXml(xmlFromText(decodeText(buffer),'Excel XML')).map(s=>({...s,source:file.name}))});}});
  registry.register({name:'HTML Adapter',formats:['html'],async parse({file,buffer}){
    const text=decodeText(buffer), tables=parseHtmlTables(text), bridge=mailRecordSetFromBlocks(htmlOrderedBlocks(text),file.name,{preferred:true,minStrongRatio:.6});
    const recordSets=[]; const warnings=[];
    if(bridge){recordSets.push(bridge.recordSet);warnings.push(...bridge.warnings);}
    for(const table of tables)recordSets.push({...table,source:file.name,meta:{...(table.meta||{}),supplemental:!!bridge}});
    if(!recordSets.length)throw new Error('HTML 中没有识别到邮件正文或表格记录。');
    return new Core.NormalizedDataset({format:'html',sourceFiles:[file],recordSets,warnings});
  }});
  registry.register({name:'JSON Adapter',formats:['json'],async parse({file,buffer}){return new Core.NormalizedDataset({format:'json',sourceFiles:[file],recordSets:[{name:file.name,rows:parseJsonValue(JSON.parse(decodeText(buffer))),source:file.name}]});}});
  registry.register({name:'NDJSON Adapter',formats:['ndjson'],async parse({file,buffer}){return new Core.NormalizedDataset({format:'ndjson',sourceFiles:[file],recordSets:[{name:file.name,rows:parseNdjson(decodeText(buffer)),source:file.name}]});}});
  registry.register({name:'Delimited Text Adapter',formats:['delimited','txt','csv','tsv','psv','text'],async parse({file,buffer,detection}){
    const text=decodeText(buffer), ext=extOf(file?.name);
    // Plain/free text may be a concatenation of complete emails. Detect mail frames before assuming rows/columns.
    if(!['csv','tsv','psv'].includes(ext)){
      const bridge=mailRecordSetFromBlocks(String(text||'').replace(/\r\n?/g,'\n').split(/\n+/).map(text=>({type:'text-line',text})),file.name,{preferred:true,minStrongRatio:.6});
      if(bridge)return new Core.NormalizedDataset({format:'mail-text',sourceFiles:[file],recordSets:[bridge.recordSet],warnings:bridge.warnings});
    }
    const vertical=parseVerticalRecords(text);if(vertical)return new Core.NormalizedDataset({format:'vertical-text',sourceFiles:[file],recordSets:[{name:file.name,rows:vertical,source:file.name}]});
    const delimiter=detection.delimiter||detectDelimited(text);return new Core.NormalizedDataset({format:'delimited',sourceFiles:[file],recordSets:[{name:file.name,rows:parseDelimited(text,delimiter),source:file.name}],meta:{delimiter}});
  }});

  globalThis.NMDAImportAdapters={FormatDetector,AdapterRegistry,registry,decodeText,unzip,parseXlsx,parseOdsZip,parseDelimited,detectDelimited,parseJsonValue,parseNdjson,parseVerticalRecords,parseHtmlTables,parseSpreadsheetXml,parseOdsDocument,parseDocx,parseDocxDocument,parseWordTable,parseWordKeyValueTable,parseWordKeyValueRecords,mailRecordSetFromBlocks,htmlOrderedBlocks,makeVirtualFile,candidateDataFile,extOf,SUPPORTED_EXT};
})();
