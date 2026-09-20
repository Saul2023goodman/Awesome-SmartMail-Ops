(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const Importer = globalThis.NMDAImporter;
  const MailRecognizer = globalThis.NMDAMailRecognizer;
  const Operations = globalThis.NMDAOperations;
  const Scheduler = globalThis.NMDAScheduler;
  const Dispatch = globalThis.NMDADispatch;
  const Roster = globalThis.NMDARoster;
  const RosterPlanner = globalThis.NMDARosterPlanner;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const executionProgressHandlers = new Map();

  function uniqueFiles(files) {
    const map = new Map();
    for (const file of files || []) {
      if (!file) continue;
      const key = Importer?.fileIdentity?.(file) || `${file.name}|${file.size}|${file.lastModified}`;
      if (!map.has(key)) map.set(key, file);
    }
    return [...map.values()];
  }

  const runtimeExecutionFiles = new Map();
  let runtimeFileSourcePort = null;

  function bytesToBase64(bytes) {
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + step)));
    return btoa(binary);
  }

  function ensureRuntimeFileSourcePort() {
    if (runtimeFileSourcePort) return runtimeFileSourcePort;
    const port = chrome.runtime.connect({ name: 'NMDA_RUNTIME_FILE_SOURCE' });
    runtimeFileSourcePort = port;
    port.onMessage.addListener(message => {
      if (message?.type !== 'NMDA_RUNTIME_FILE_REQUEST') return;
      void (async () => {
        const requestId = String(message.requestId || '');
        const id = String(message.id || '');
        const file = runtimeExecutionFiles.get(id) || null;
        if (!file) {
          port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:false, reason:'runtime-file-not-found' });
          return;
        }
        if (message.action === 'meta') {
          port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:true, id, name:String(file.name||'attachment'), typeName:String(file.type||'application/octet-stream'), size:Number(file.size||0), lastModified:Number(file.lastModified||Date.now()) });
          return;
        }
        if (message.action === 'chunk') {
          const offset = Math.max(0, Number(message.offset || 0));
          const length = Math.max(1, Number(message.length || 262144));
          const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
          port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:true, base64:bytesToBase64(bytes) });
          return;
        }
        port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId, ok:false, reason:'unknown-runtime-file-action' });
      })().catch(error => {
        try { port.postMessage({ type:'NMDA_RUNTIME_FILE_RESPONSE', requestId:String(message?.requestId||''), ok:false, reason:error?.message||String(error) }); } catch (_) {}
      });
    });
    port.onDisconnect.addListener(() => { if (runtimeFileSourcePort === port) runtimeFileSourcePort = null; });
    return port;
  }

  async function prepareRuntimeFileRefs(files) {
    const refs = [];
    if ((files || []).length) ensureRuntimeFileSourcePort();
    for (const file of files || []) {
      if (!file) continue;
      const id = crypto.randomUUID();
      runtimeExecutionFiles.set(id, file);
      refs.push({ id, name:String(file.name||'attachment'), size:Number(file.size||0), type:String(file.type||'application/octet-stream'), lastModified:Number(file.lastModified||Date.now()) });
    }
    if (refs.length) await sleep(20);
    return refs;
  }

  function releaseRuntimeFileRefs(refs) {
    for (const ref of refs || []) if (ref?.id) runtimeExecutionFiles.delete(String(ref.id));
  }


  async function executeDraftRemotely(task, { fresh = true, pauseEveryTime = false, onProgress = () => {} } = {}) {
    const executionId = crypto.randomUUID();
    const refs = await prepareRuntimeFileRefs(task.files || []);
    executionProgressHandlers.set(executionId, onProgress);
    try {
      const connection = await chrome.runtime.sendMessage({ type: 'NMDA_CONNECTION_STATUS' });
      if (!connection?.connected) throw new Error('没有检测到已打开的网易邮箱。请先点击右上角“打开网易邮箱”并完成登录。');
      if (!connection?.authenticated) throw new Error('网易邮箱页面已打开，但尚未检测到登录账号。请先完成登录。');
      const result = await chrome.runtime.sendMessage({
        type: 'NMDA_EXECUTE_DRAFT', executionId, fresh, pauseEveryTime: !!pauseEveryTime,
        task: {
          recipients: task.recipients || '', cc: task.cc || '', bcc: task.bcc || '',
          subject: task.subject || '', body: task.body || '',
          bodyHtml: task.bodyHtml || '', bodyIsHtml: !!task.bodyIsHtml,
          priority: Number(task.priority || 0) || 0, requestReadReceipt: !!task.requestReadReceipt,
          scheduleAt: task.scheduleAt || '', scheduleDisplayAt: task.scheduleAt ? scheduleValueForDisplay(task.scheduleAt,batch.scheduleRules||freshScheduleRules()) : '', scheduleTimeZoneLabel: scheduleZoneText(batch.scheduleRules||freshScheduleRules()), attachments: refs,
          composeMode: task.composeMode || 'new', parentMessageId: task.parentMessageId || task.providerMessageId || '', parentFid: Number(task.parentFid || 3) || 3
        }
      });
      if (!result?.ok) throw new Error(result?.reason || '网易邮箱执行器没有完成草稿创建。');
      return result.outcome || {};
    } finally {
      executionProgressHandlers.delete(executionId);
      releaseRuntimeFileRefs(refs);
    }
  }


  async function updateMailboxBatchMonitor(payload = {}) {
    try { return await chrome.runtime.sendMessage({ type:'NMDA_BATCH_MONITOR', payload }); }
    catch (_) { return null; }
  }

  async function waitForMailboxExecutionReady(timeoutMs = 4500) {
    const deadline = Date.now() + Math.max(800, Number(timeoutMs || 0));
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await chrome.runtime.sendMessage({ type:'NMDA_CONNECTION_STATUS' });
        if (last?.connected && last?.authenticated) return last;
      } catch (_) {}
      await sleep(260);
    }
    return last;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }

  const MAIL_RICH_BLOCK_TAGS=new Set(['div','p','ul','ol','li','blockquote','pre']);
  function safeMailRichHref(value){const href=String(value||'').trim();return /^(?:https?:|mailto:)/i.test(href)?href:'';}
  function wrapMailRichFlags(content,{bold=false,italic=false,underline=false,strike=false}={}){
    let out=content;if(strike)out=`<s>${out}</s>`;if(underline)out=`<u>${out}</u>`;if(italic)out=`<em>${out}</em>`;if(bold)out=`<strong>${out}</strong>`;return out;
  }
  function sanitizeEmailRichHtml(html){
    const doc=new DOMParser().parseFromString(`<div>${String(html||'')}</div>`,'text/html'),root=doc.body.firstElementChild;
    if(!root)return'';
    const render=node=>{
      if(node.nodeType===3)return escapeHtml(node.nodeValue||'');
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
      let out=wrapMailRichFlags(content,flags);
      if(tag==='a'){
        const href=safeMailRichHref(node.getAttribute?.('href'));
        if(href)out=`<a href="${escapeHtml(href)}">${out}</a>`;
      }
      if(MAIL_RICH_BLOCK_TAGS.has(tag))out=`<${tag}>${out}</${tag}>`;
      return out;
    };
    return Array.from(root.childNodes||[]).map(render).join('');
  }
  function plainMailBodyToHtml(text){
    const value=String(text||'').replace(/\r\n?/g,'\n');
    return value.split(/\n{2,}/).map(part=>`<div>${escapeHtml(part).replace(/\n/g,'<br>')}</div>`).join('');
  }
  // Italic and quotation marks are different authoring devices, but both are
  // high-value review attention signals: the writer deliberately delimited a
  // phrase that deserves a faster second look. Keep the original representation
  // intact and add review-only attention markup; never rewrite quotes as italics.
  function mailQuotedAttentionRanges(text){
    const source=String(text||''),ranges=[];
    const patterns=[
      /“[^”\n]{2,220}”/gu,
      /‘[^’\n]{2,220}’/gu,
      /「[^」\n]{2,220}」/gu,
      /『[^』\n]{2,220}』/gu,
      /«[^»\n]{2,220}»/gu,
      /‹[^›\n]{2,220}›/gu,
      /"[^"\n]{2,220}"/g
    ];
    for(const re of patterns){let m;while((m=re.exec(source))){
      const value=m[0],inner=value.slice(1,-1).trim();
      // Ignore quote-like technical fragments; this layer is for authored prose.
      if(!inner||/^(?:https?:\/\/|mailto:)/i.test(inner))continue;
      ranges.push({start:m.index,end:m.index+value.length,label:'引号强调'});
      if(!value.length)re.lastIndex++;
    }}
    ranges.sort((a,b)=>a.start-b.start||(b.end-b.start)-(a.end-a.start));
    const chosen=[];let cursor=-1;
    for(const range of ranges){if(range.start<cursor)continue;chosen.push(range);cursor=range.end;}
    return chosen;
  }
  function mailRichPlainText(html){
    const doc=new DOMParser().parseFromString(`<div>${String(html||'')}</div>`,'text/html');
    return String(doc.body?.firstElementChild?.textContent||'');
  }
  function mailRichFormatFeatures(html){
    const value=String(html||'');
    return{
      italic:(value.match(/<(?:em|i)\b/gi)||[]).length,
      bold:(value.match(/<(?:strong|b)\b/gi)||[]).length,
      underline:(value.match(/<u\b/gi)||[]).length,
      strike:(value.match(/<s\b/gi)||[]).length,
      link:(value.match(/<a\b/gi)||[]).length,
      list:(value.match(/<(?:ul|ol|li)\b/gi)||[]).length,
      quote:mailQuotedAttentionRanges(mailRichPlainText(value)).length,
      quoteBlock:(value.match(/<blockquote\b/gi)||[]).length
    };
  }
  function mailRichHasMeaningfulFormatting(html){
    const f=mailRichFormatFeatures(html);
    // Quotation punctuation is an attention signal, not rich-text state by itself.
    return ['italic','bold','underline','strike','link','list','quoteBlock'].some(key=>Number(f[key]||0)>0);
  }
  function mailRichAttentionLabel(html){
    const f=mailRichFormatFeatures(html),labels=[];
    if(f.italic)labels.push(`斜体 ${f.italic}`);
    if(f.quote)labels.push(`引号 ${f.quote}`);
    if(f.quoteBlock)labels.push(`引用块 ${f.quoteBlock}`);
    return labels.join(' · ');
  }
  function mailRichFeatureLabel(html){
    const f=mailRichFormatFeatures(html),labels=[];
    if(f.bold)labels.push(`加粗 ${f.bold}`);if(f.underline)labels.push(`下划线 ${f.underline}`);if(f.link)labels.push(`链接 ${f.link}`);if(f.strike)labels.push(`删除线 ${f.strike}`);if(f.list)labels.push('列表');
    return labels.join(' · ');
  }
  function mailRichHtmlToText(html){
    const doc=new DOMParser().parseFromString(`<div>${sanitizeEmailRichHtml(html)}</div>`,'text/html'),root=doc.body.firstElementChild;
    if(!root)return'';
    const blockTags=new Set(['div','p','li','blockquote','pre','ul','ol']);
    const read=node=>{
      if(node.nodeType===3)return node.nodeValue||'';
      if(node.nodeType!==1)return'';
      const tag=String(node.tagName||'').toLowerCase();if(tag==='br')return'\n';
      const content=Array.from(node.childNodes||[]).map(read).join('');
      return blockTags.has(tag)?`${content}\n\n`:content;
    };
    return Array.from(root.childNodes||[]).map(read).join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function taskRichBodyHtml(task){
    const source=task?.bodyIsHtml&&String(task?.bodyHtml||'').trim()?String(task.bodyHtml):plainMailBodyToHtml(task?.body||'');
    return sanitizeEmailRichHtml(source);
  }

  // Batch format governance repairs deterministic formatting drift in template-derived
  // drafts without changing wording. A rule targets one exact fixed phrase and ensures
  // the requested inline format wherever that phrase appears in the current draft set.
  // Review/approval state is preserved because the operator authorizes the exact batch
  // mutation after seeing its match preview.
  const MAIL_GOVERNANCE_FORMATS={
    italic:{label:'斜体',tag:'em',selectors:'em,i'},
    bold:{label:'加粗',tag:'strong',selectors:'strong,b'},
    underline:{label:'下划线',tag:'u',selectors:'u'},
    strike:{label:'删除线',tag:'s',selectors:'s,strike,del'}
  };
  function normalizeGovernancePhrase(value){return String(value||'').replace(/\r\n?/g,'\n').trim();}
  function governanceTaskText(task){return mailRichHtmlToText(taskRichBodyHtml(task));}
  function governanceFindPositions(text,phrase,caseSensitive=true){
    const source=String(text||''),needle=String(phrase||'');if(!needle)return[];
    const hay=caseSensitive?source:source.toLocaleLowerCase('en-US'),look=caseSensitive?needle:needle.toLocaleLowerCase('en-US');
    const out=[];let offset=0;
    while(offset<=hay.length-look.length){const index=hay.indexOf(look,offset);if(index<0)break;out.push({start:index,end:index+needle.length});offset=index+Math.max(1,needle.length);}
    return out;
  }
  function governanceTextIndex(root){
    const doc=root.ownerDocument,walker=doc.createTreeWalker(root,4),segments=[];let node,cursor=0;
    while((node=walker.nextNode())){const text=String(node.nodeValue||'');segments.push({node,start:cursor,end:cursor+text.length});cursor+=text.length;}
    return{segments,text:String(root.textContent||'')};
  }
  function governanceBlockOwner(node,root){
    let el=node?.parentElement||null;while(el&&el!==root){if(MAIL_RICH_BLOCK_TAGS.has(String(el.tagName||'').toLowerCase()))return el;el=el.parentElement;}return root;
  }
  function governanceNodeHasFormat(node,key,root){
    const meta=MAIL_GOVERNANCE_FORMATS[key];if(!meta)return true;let el=node?.parentElement||null;
    while(el&&el!==root){if(el.matches?.(meta.selectors))return true;el=el.parentElement;}return false;
  }
  function governanceOccurrenceRefs(index,position,root){
    const hits=index.segments.filter(seg=>seg.end>position.start&&seg.start<position.end&&seg.end>seg.start);if(!hits.length)return null;
    const first=hits[0],last=hits[hits.length-1],startOffset=Math.max(0,position.start-first.start),endOffset=Math.max(0,position.end-last.start);
    if(governanceBlockOwner(first.node,root)!==governanceBlockOwner(last.node,root))return{skipped:true};
    return{hits,first,last,startOffset,endOffset,skipped:false};
  }
  function governanceOccurrenceCompliant(refs,formats,root){
    if(!refs||refs.skipped)return false;
    return formats.every(key=>refs.hits.filter(seg=>String(seg.node.nodeValue||'').trim()).every(seg=>governanceNodeHasFormat(seg.node,key,root)));
  }
  function inspectGovernanceRuleHtml(html,rule,{apply=false}={}){
    const safe=sanitizeEmailRichHtml(html),doc=new DOMParser().parseFromString(`<div id="nmda-governance-root">${safe}</div>`,'text/html'),root=doc.getElementById('nmda-governance-root');
    if(!root)return{html:safe,matches:0,compliant:0,changed:0,skipped:0};
    const phrase=normalizeGovernancePhrase(rule?.phrase),formats=(rule?.formats||[]).filter(key=>MAIL_GOVERNANCE_FORMATS[key]);
    if(phrase.length<2||phrase.includes('\n')||!formats.length)return{html:safe,matches:0,compliant:0,changed:0,skipped:0};
    const index=governanceTextIndex(root),positions=governanceFindPositions(index.text,phrase,rule?.caseSensitive!==false),occurrences=[];
    for(const position of positions){const refs=governanceOccurrenceRefs(index,position,root);if(!refs)continue;const compliant=!refs.skipped&&governanceOccurrenceCompliant(refs,formats,root);occurrences.push({position,refs,compliant});}
    let changed=0;
    if(apply){
      for(const occurrence of [...occurrences].reverse()){
        const refs=occurrence.refs;if(!refs||refs.skipped||occurrence.compliant)continue;
        const missing=formats.filter(key=>!refs.hits.filter(seg=>String(seg.node.nodeValue||'').trim()).every(seg=>governanceNodeHasFormat(seg.node,key,root)));
        if(!missing.length)continue;
        try{
          const range=doc.createRange();range.setStart(refs.first.node,refs.startOffset);range.setEnd(refs.last.node,refs.endOffset);
          let wrapped=range.extractContents();
          for(const key of missing){const el=doc.createElement(MAIL_GOVERNANCE_FORMATS[key].tag);el.appendChild(wrapped);wrapped=el;}
          range.insertNode(wrapped);changed++;
        }catch(_){refs.skipped=true;}
      }
    }
    return{
      html:apply?sanitizeEmailRichHtml(root.innerHTML):safe,
      matches:occurrences.length,
      compliant:occurrences.filter(item=>item.compliant).length,
      changed,
      skipped:occurrences.filter(item=>item.refs?.skipped).length
    };
  }
  function decorateReviewRichHtml(task){
    const safe=taskRichBodyHtml(task);if(!safe)return escapeHtml(task?.body||'（正文为空）');
    const doc=new DOMParser().parseFromString(`<div id="nmda-rich-root">${safe}</div>`,'text/html'),root=doc.getElementById('nmda-rich-root');if(!root)return safe;
    const formatMap=[['em,i','italic','斜体强调'],['strong,b','bold','加粗'],['u','underline','下划线'],['s','strike','删除线'],['a','link','链接'],['blockquote','quote-block','引用块']];
    for(const [selector,type,label] of formatMap)root.querySelectorAll(selector).forEach(el=>{el.classList.add('nmda-format-mark');el.dataset.format=type;el.title=label;});

    // Quotation punctuation is plain text, so add a review-only wrapper around the
    // exact authored span. The punctuation itself remains untouched and the wrapper
    // is never written back to task.bodyHtml / NetEase compose.
    const quoteWalker=doc.createTreeWalker(root,4),quoteNodes=[];let quoteNode;
    while((quoteNode=quoteWalker.nextNode()))if(String(quoteNode.nodeValue||'').trim())quoteNodes.push(quoteNode);
    for(const textNode of quoteNodes){
      if(textNode.parentElement?.closest?.('[data-format="quote"]'))continue;
      const source=String(textNode.nodeValue||''),ranges=mailQuotedAttentionRanges(source);if(!ranges.length)continue;
      const frag=doc.createDocumentFragment();let cursor=0;
      for(const range of ranges){
        if(range.start>cursor)frag.appendChild(doc.createTextNode(source.slice(cursor,range.start)));
        const mark=doc.createElement('span');mark.className='nmda-format-mark nmda-attention-mark';mark.dataset.format='quote';mark.title='引号强调';mark.textContent=source.slice(range.start,range.end);frag.appendChild(mark);cursor=range.end;
      }
      if(cursor<source.length)frag.appendChild(doc.createTextNode(source.slice(cursor)));
      textNode.replaceWith(frag);
    }

    const walker=doc.createTreeWalker(root,4),nodes=[];let node;
    while((node=walker.nextNode()))if(String(node.nodeValue||'').trim())nodes.push(node);
    for(const textNode of nodes){
      const source=String(textNode.nodeValue||''),ranges=reviewSemanticRanges(source,task).ranges;if(!ranges.length)continue;
      const frag=doc.createDocumentFragment();let cursor=0;
      for(const range of ranges){
        if(range.start>cursor)frag.appendChild(doc.createTextNode(source.slice(cursor,range.start)));
        const mark=doc.createElement('mark');mark.className='nmda-semantic-mark';mark.dataset.semantic=range.type;mark.title=range.label;mark.textContent=source.slice(range.start,range.end);frag.appendChild(mark);cursor=range.end;
      }
      if(cursor<source.length)frag.appendChild(doc.createTextNode(source.slice(cursor)));
      textNode.replaceWith(frag);
    }
    return root.innerHTML;
  }


  const NMDA_ICONS = {
    app: '<path d="M5.25 6.5h6.5a4.75 4.75 0 0 1 0 9.5H8.5"/><circle cx="5.25" cy="6.5" r="1.75"/><circle cx="15.25" cy="11.25" r="1.75"/><circle cx="8.5" cy="16" r="1.75"/>',
    expand: '<path d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13"/><path d="M8 6 3.5 3.5M12 6l4.5-2.5M8 14l-4.5 2.5M12 14l4.5 2.5"/>',
    close: '<path d="M5 5l10 10M15 5 5 15"/>',
    batch: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.2"/>',
    review: '<path d="M6 2.75h6.5l3 3v11.5H6z"/><path d="M12.5 2.75v3h3M8.5 8.5h4.75M8.5 11.25h4.75M8.5 14h3"/>',
    dispatch: '<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13"/><circle cx="6.5" cy="5.5" r="1.25"/><circle cx="12.5" cy="10" r="1.25"/><circle cx="9" cy="14.5" r="1.25"/>',
    monitor: '<path d="M3.5 5.75h13v8.75h-13z"/><path d="m3.5 6.5 6.5 4.75 6.5-4.75"/><circle cx="14.75" cy="5" r="1.75"/>',
    import: '<path d="M10 3.5v8"/><path d="m6.75 8.25 3.25 3.25 3.25-3.25"/><path d="M4 13.5h12v3H4z"/>',
    file: '<path d="M6 2.75h5.75l3.25 3.25V17.25H6z"/><path d="M11.75 2.75V6h3.25"/><path d="M8 9.25h4M8 12h4"/>',
    folder: '<path d="M2.75 5.5h4l1.5 1.75h9v7.75H2.75z"/>',
    paste: '<rect x="5.25" y="4.25" width="9.5" height="12" rx="1.6"/><path d="M8 4.25V3.5h4v.75M8.25 7.75h3.5M8.25 10.5h4.5M8.25 13.25h4.5"/>',
    mail: '<path d="M3.5 5.75h13v8.75h-13z"/><path d="m3.5 6.5 6.5 4.75 6.5-4.75"/>',
    roster: '<circle cx="7" cy="7" r="2"/><circle cx="13.5" cy="6.5" r="1.75"/><path d="M3.75 14c.7-1.95 2.45-3 4.25-3s3.55 1.05 4.25 3"/><path d="M11 13.75c.45-1.35 1.7-2.15 3.05-2.15 1.3 0 2.55.75 3.2 2.15"/>',
    attachment: '<path d="M7.25 9.75 11 6a2.25 2.25 0 1 1 3.2 3.2l-5 5a3.25 3.25 0 0 1-4.6-4.6l5.25-5.25"/>',
    warning: '<path d="M10 3.5 16.5 15H3.5L10 3.5Z"/><path d="M10 7.5v3.75M10 13.25v.25"/>',
    ignored: '<circle cx="10" cy="10" r="6.5"/><path d="M6.5 6.5l7 7"/>',
    search: '<circle cx="8.5" cy="8.5" r="4.75"/><path d="M12 12 16 16"/>',
    success: '<path d="M4.75 10.25 8 13.5l7.25-7.25"/>',
    archive: '<path d="M4 4.75h12v3H4z"/><path d="M5 7.75h10v7.5H5z"/><path d="M8 10.75h4"/>',
    trash: '<path d="M4.75 6.25h10.5M8 3.75h4l.75 2.5H7.25L8 3.75Z"/><path d="M6.25 6.25 7 16h6l.75-9.75M8.75 9v4.25M11.25 9v4.25"/>',
    doc: '<path d="M6 2.75h5.75l3.25 3.25V17.25H6z"/><path d="M11.75 2.75V6h3.25"/><path d="M8 9.25h4M8 12h4M8 14.75h4"/>',
    code: '<path d="m7.25 6.25-3 3.75 3 3.75M12.75 6.25l3 3.75-3 3.75M10.75 4.75 9.25 15.25"/>',
    table: '<rect x="3.5" y="4" width="13" height="12" rx="1.4"/><path d="M3.5 8h13M8 4v12M12 4v12"/>',
    text: '<path d="M5 6h10M5 9.5h10M5 13h7.5"/>',
    source: '<path d="M10 3.75 15.5 10 10 16.25 4.5 10Z"/>',
    dot: '<circle cx="10" cy="10" r="1.6"/>'
  };

  function iconSvg(name) {
    const body = NMDA_ICONS[name] || NMDA_ICONS.source;
    return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  function setUnifiedIcon(element, name) {
    if (!element || !name) return;
    if (element.dataset.nmdaIconName === name) return;
    element.dataset.nmdaIconName = name;
    element.innerHTML = iconSvg(name);
  }

  function textIconToName(value) {
    const key = String(value || '').trim();
    return ({
      '✉':'mail','名':'roster','人':'roster','附':'attachment','⇧':'attachment','!':'warning','×':'close','✓':'success','⌕':'search','↓':'import','＋':'file','▤':'folder','⌘':'paste','◎':'roster','?':'warning','—':'ignored','W':'doc','{}':'code','¶':'text','≡':'text','<>':'code','XML':'code','▦':'table','◇':'source','ZIP':'archive'
    })[key] || '';
  }

  function decorateUnifiedIcons(scope = document) {
    const root = scope?.querySelector ? scope : document;
    setUnifiedIcon(root.querySelector('.nmda-launcher-mark'), 'app');
    setUnifiedIcon(root.querySelector('.nmda-brand-mark'), 'app');
    setUnifiedIcon(root.querySelector('#nmda-expand'), 'expand');
    setUnifiedIcon(root.querySelector('#nmda-close'), 'close');

    root.querySelectorAll('.nmda-tab').forEach(tab => {
      const iconHost = tab.querySelector('.nmda-tab-icon');
      const tabName = String(tab.dataset.tab || '');
      const name = ({ batch:'batch', review:'review', dispatch:'dispatch', monitor:'monitor' })[tabName] || 'source';
      setUnifiedIcon(iconHost, name);
    });

    const directMap = new Map([
      ['#nmda-import-drop-zone .nmda-import-drop-zone-icon span','import'],
      ['label[for="nmda-import-file"] .nmda-source-action-icon','file'],
      ['label[for="nmda-import-dir"] .nmda-source-action-icon','folder'],
      ['#nmda-show-paste .nmda-source-action-icon','paste'],
      ['#nmda-import-drafts .nmda-source-action-icon','mail'],
      ['.nmda-context-cue-icon','roster'],
      ['.nmda-mail-handoff-mark','app'],
      ['.nmda-attachment-manager-drop-icon','attachment'],
      ['.nmda-classify-search > span','search'],
      ['.nmda-review-search > span','search'],
      ['.nmda-review-problem-shape','warning'],
      ['.nmda-plan-motion-check','success'],
      ['.nmda-supplement-dialog .nmda-dialog-status-icon','success'],
      ['.nmda-attachment-target-toolbar label > span','search'],
      ['.nmda-classify-folder-icon','folder'],
      ['.nmda-review-trash-icon','trash']
    ]);
    directMap.forEach((name, selector) => root.querySelectorAll(selector).forEach(el => setUnifiedIcon(el, name)));

    root.querySelectorAll('.nmda-classify-dropzone .nmda-drop-icon').forEach(el => {
      const purpose = el.closest('.nmda-classify-dropzone')?.dataset.dropPurpose || '';
      const name = ({ mail:'mail', roster:'roster', attachment:'attachment', review:'warning', ignored:'ignored' })[purpose] || textIconToName(el.textContent) || 'source';
      setUnifiedIcon(el, name);
    });

    root.querySelectorAll('.nmda-source-item-icon, .nmda-review-source-badge .nmda-source-item-icon, .nmda-dialog-status-icon, .nmda-support-view-toggle > button > span:first-child, .nmda-inspector-review-note > span:first-child').forEach(el => {
      const name = textIconToName(el.textContent) || (el.closest('.nmda-inspector-review-note') ? 'warning' : 'source');
      setUnifiedIcon(el, name || 'source');
    });
  }

  function buildUI() {
    const root = document.createElement('div');
    root.id = 'nmda-root';
    root.innerHTML = `
      <button id="nmda-launcher" type="button" title="网易邮箱外联工作台" aria-label="打开网易邮箱外联工作台">
        <span class="nmda-launcher-mark">N</span><span class="nmda-launcher-dot"></span>
      </button>
      <section id="nmda-panel" hidden aria-label="网易邮箱外联工作台">
        <header class="nmda-head">
          <div class="nmda-brand">
            <div class="nmda-brand-mark">N</div>
            <div>
              <div class="nmda-title">SmartMail Ops</div>
              <div class="nmda-subtitle">批量邮件作业</div>
            </div>
          </div>
          <div class="nmda-head-actions">
            <div class="nmda-mail-connection" id="nmda-mail-connection" data-state="checking">
              <span class="nmda-mail-connection-dot"></span>
              <span class="nmda-mail-connection-copy">
                <strong id="nmda-mail-connection-title">正在检查网易邮箱</strong>
                <small id="nmda-mail-connection-detail" class="nmda-mail-connection-detail">连接状态</small>
                <span class="nmda-mail-auto-sync" id="nmda-mail-auto-sync" data-state="idle" aria-live="polite" title="SmartMail 会自动读取邮箱事实">
                  <span class="nmda-mail-auto-sync-track" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
                  <span class="nmda-mail-auto-sync-copy"><strong id="nmda-mail-auto-sync-title">自动同步</strong><small id="nmda-mail-auto-sync-detail">后台保持最新</small></span>
                </span>
              </span>
              <button class="nmda-btn nmda-btn-small nmda-mail-open-button" id="nmda-open-mail" type="button">连接邮箱</button>
            </div>
            <button class="nmda-icon-btn" id="nmda-expand" type="button" title="全屏 / 还原">⛶</button>
            <button class="nmda-icon-btn nmda-close" id="nmda-close" type="button" title="关闭">×</button>
          </div>
        </header>

        <nav class="nmda-tabs" aria-label="工作台模块">
          <div class="nmda-nav-label">工作区</div>
          <button class="nmda-tab is-active" data-tab="batch" type="button" title="导入资料"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg></span><span><strong>导入资料</strong><small>识别 · 查重 · 附件</small></span></button>
          <button class="nmda-tab" data-tab="review" type="button" title="邮件审阅"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><span><strong>邮件审阅</strong><small>Initial · Follow-up · Pass</small></span><b class="nmda-tab-count" id="nmda-review-nav-count" hidden>0</b></button>
          <button class="nmda-tab" data-tab="dispatch" type="button" title="选择与排期"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="8" cy="6" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="11" cy="18" r="1.8"/></svg></span><span><strong>选择与排期</strong><small>初始邮件 · Follow-up</small></span></button>
          <button class="nmda-tab" data-tab="monitor" type="button" title="邮件监测"><span class="nmda-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5h16v10H4z"/><path d="m4 8 8 6 8-6"/><circle cx="18" cy="6" r="2.5"/></svg></span><span><strong>邮件监测</strong><small>回复 · Follow-up</small></span></button>

        </nav>

        <main class="nmda-main">
          <div class="nmda-page-head" data-page-head="batch">
            <div><h2>导入资料</h2><p>识别来源 → 完成查重与附件准备 → 进入邮件审阅</p></div>
          </div>
          <div class="nmda-page-head" data-page-head="review" hidden>
            <div><h2>邮件审阅</h2><p>统一审阅 Initial 与 Follow-up → Pass → 进入选择与排期</p></div>
          </div>
          <div class="nmda-page-head" data-page-head="dispatch" hidden>
            <div><h2>选择与排期</h2><p>汇合初始邮件与 Follow-up → 选择范围 → 安排时间 → 统一执行</p></div>
          </div>
          <div class="nmda-page-head" data-page-head="monitor" hidden>
            <div><h2>邮件监测</h2><p>已发送 + 草稿箱 → 回复识别 → 定时 Follow-up 对账 → 到期生成</p></div>
          </div>
          <section class="nmda-tabpane nmda-page nmda-ingest-page nmda-bulk-workbench" data-pane="batch" data-phase="empty">
            <div class="nmda-workflow-stage-head" id="nmda-stage-prepare">
              <span class="nmda-stage-number">01</span><div><strong>准备邮件</strong><small>把邮件资料加入本批次。</small></div>
            </div>
            <div class="nmda-ingest-workspace nmda-ingest-workspace-v2">
              <div class="nmda-card nmda-ingest-source-card" id="nmda-import-card">
                <div class="nmda-card-head"><div><div class="nmda-card-title" id="nmda-import-card-title">导入邮件资料</div><div class="nmda-card-desc" id="nmda-import-card-desc">把本批次邮件资料放进来。</div></div><div class="nmda-row nmda-wrap"><span class="nmda-import-busy-badge" id="nmda-import-busy-badge" hidden>正在处理…</span><span class="nmda-workspace-saved-badge" id="nmda-workspace-saved-badge" hidden>本地保存 · 可继续追加</span><button class="nmda-btn nmda-btn-small" id="nmda-open-supplement-preflight" type="button" hidden>批次准备</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-reset-import" type="button" hidden>清空本批次</button></div></div>
                <input id="nmda-import-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip,.pdf,.ppt,.pptx,.rtf,.png,.jpg,.jpeg,.gif,.webp,.svg,.rar,.7z">
                <input id="nmda-import-dir" type="file" webkitdirectory multiple hidden>
                <input id="nmda-roster-file" type="file" multiple hidden accept=".xlsx,.xls,.ods,.fods,.docx,.docm,.dotx,.doc,.csv,.tsv,.psv,.json,.jsonl,.ndjson,.txt,.html,.htm,.xml,.zip">
                <div class="nmda-import-drop-zone" id="nmda-import-drop-zone" role="button" tabindex="0" aria-label="拖入邮件资料，或点击选择文件">
                  <div class="nmda-import-drop-zone-icon" aria-hidden="true"><span>↓</span></div>
                  <div class="nmda-import-drop-zone-copy"><strong>把邮件、名单与附件拖到这里</strong><small>统一导入并识别用途；支持文件、文件夹与 ZIP</small></div>
                  <div class="nmda-import-drop-zone-types"><span>DOCX</span><span>XLSX</span><span>PDF</span><span>ZIP</span><span>更多</span></div>
                </div>
                <div class="nmda-source-action-grid nmda-source-action-grid-compact">
                  <label class="nmda-source-action" for="nmda-import-file"><span class="nmda-source-action-icon">＋</span><strong>选择文件</strong><small>从电脑选择资料</small></label>
                  <label class="nmda-source-action" for="nmda-import-dir"><span class="nmda-source-action-icon">▤</span><strong>选择文件夹</strong><small>批量加入整个文件夹</small></label>
                  <button class="nmda-source-action nmda-source-action-button" id="nmda-show-paste" type="button"><span class="nmda-source-action-icon">⌘</span><strong>粘贴内容</strong><small>粘贴邮件文本或表格</small></button>
                  <button class="nmda-source-action nmda-source-action-button nmda-source-action-mailbox" id="nmda-import-drafts" type="button"><span class="nmda-source-action-icon">✉</span><strong>读取草稿箱</strong><small>识别正文、主题、定时与附件</small></button>
                </div>
                <div class="nmda-paste-panel" id="nmda-paste-panel" hidden>
                  <textarea id="nmda-paste-source" placeholder="粘贴邮件、名单或表格内容"></textarea>
                  <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-paste-import" type="button">加入本批次</button></div>
                </div>
                <div class="nmda-ingest-source-tools"><span id="nmda-import-format-info" class="nmda-hint">先加入邮件资料。</span><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-template" type="button">下载模板</button></div>
                <div class="nmda-batch-prep-strip" id="nmda-batch-prep-strip" hidden>
                  <div class="nmda-batch-prep-label"><span>导入准备</span><small>名单与附件均在此阶段完成</small></div>
                  <div class="nmda-batch-prep-item" id="nmda-prep-roster-state" data-state="pending"><span>参考总名单</span><strong>未决定</strong></div>
                  <div class="nmda-batch-prep-item nmda-batch-prep-attachment" id="nmda-prep-attachment-state" data-state="pending"><div><span>附件</span><strong>未准备</strong></div><button class="nmda-text-action" id="nmda-manage-attachments-strip" type="button">查看 / 修改</button></div>
                  <button class="nmda-btn nmda-btn-small" id="nmda-edit-batch-prep" type="button">补充资料</button>
                </div>
                <div class="nmda-context-cue nmda-roster-context-cue" id="nmda-roster-context-cue" data-state="prepare">
                  <div class="nmda-context-cue-icon" aria-hidden="true">◎</div>
                  <div class="nmda-context-cue-main">
                    <span class="nmda-context-eyebrow" id="nmda-roster-context-eyebrow">推荐 · 导入时补充</span>
                    <strong id="nmda-roster-context-title">有参考总名单？建议一起加入</strong>
                    <small id="nmda-roster-context-copy">会自动匹配导入邮件，用于联系人核对与信息补全；没有也可以继续。</small>
                    <div class="nmda-context-benefits" id="nmda-roster-context-benefits"><span>匹配导入邮件</span><span>补全院校 / 邮箱</span><span>发现名单遗漏</span></div>
                    <div id="nmda-roster-source-status" class="nmda-context-status">未添加参考总名单。</div>
                  </div>
                  <div class="nmda-context-cue-actions">
                    <label class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-roster-upload-action" for="nmda-roster-file">上传参考总名单</label>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-skip" type="button" hidden>本批次暂不添加</button>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-remove" type="button" hidden>移除</button>
                  </div>
                </div>
                <div id="nmda-import-status" class="nmda-summary nmda-import-status">还没有添加资料。</div>
                <div id="nmda-source-inventory" class="nmda-source-inventory" hidden></div>
                <section class="nmda-import-dedupe-card nmda-roster-audit-card" id="nmda-roster-audit-card" hidden>
                  <div class="nmda-import-dedupe-head"><div><span>导入查重</span><strong>批次重复 + 邮箱历史防重</strong></div><div class="nmda-import-dedupe-head-actions"><small id="nmda-import-dedupe-state">正在核验</small><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-dedupe-refresh-mailbox" type="button">重新核验</button></div></div>
                  <input id="nmda-roster-enabled" type="checkbox" checked hidden>
                  <input id="nmda-roster-auto-school" type="checkbox" checked hidden>
                  <input id="nmda-roster-strict" type="checkbox" hidden>
                  <div id="nmda-roster-audit-summary" class="nmda-ingest-health"></div>
                  <div id="nmda-roster-audit-note" class="nmda-review-guidance"></div>
                  <section class="nmda-draft-history-filter" id="nmda-draft-history-filter" hidden>
                    <div class="nmda-draft-history-filter-head">
                      <div><strong>已有草稿命中 <span id="nmda-draft-history-count">0</span> 封</strong><small>这些邮件在网易草稿箱中已有对应收件人，不做正文版本对比。</small></div>
                      <span>草稿防重</span>
                    </div>
                    <div class="nmda-draft-history-filter-list" id="nmda-draft-history-list"></div>
                    <div class="nmda-draft-history-filter-actions">
                      <small id="nmda-draft-history-hint">默认勾选全部命中项；筛除后可直接到草稿箱继续处理已有 Draft。</small>
                      <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary" id="nmda-draft-history-exclude" type="button">筛除所选</button><button class="nmda-btn" id="nmda-draft-history-keep" type="button">仍保留所选</button></div>
                    </div>
                  </section>
                  <section class="nmda-duplicate-decision nmda-import-duplicate-decision" id="nmda-duplicate-decision" hidden>
                    <div class="nmda-duplicate-decision-head">
                      <div><strong id="nmda-duplicate-decision-title">发现重复邮件</strong><small id="nmda-duplicate-decision-copy">在导入阶段决定实际进入本批次的版本。</small></div>
                      <span class="nmda-duplicate-kind" id="nmda-duplicate-decision-kind">重复</span>
                    </div>
                    <div class="nmda-duplicate-candidates" id="nmda-duplicate-candidates"></div>
                    <div class="nmda-duplicate-actions">
                      <span class="nmda-hint" id="nmda-duplicate-decision-hint">默认勾选信息更完整的一封；也可以明确保留多封。</span>
                      <div class="nmda-row nmda-wrap"><button class="nmda-btn nmda-btn-primary" id="nmda-duplicate-keep-selected" type="button">保留所选（1）</button><button class="nmda-btn" id="nmda-duplicate-keep-all" type="button">全部保留</button></div>
                    </div>
                  </section>
                  <details class="nmda-roster-details"><summary>查看查重依据</summary><div id="nmda-roster-audit-details" class="nmda-roster-audit-details"></div></details>
                </section>

              </div>

              <div class="nmda-supplement-preflight" id="nmda-supplement-preflight" hidden aria-hidden="true">
                <section class="nmda-supplement-dialog nmda-classify-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-supplement-title">
                  <header class="nmda-classify-head">
                    <div class="nmda-classify-head-main">
                      <div class="nmda-supplement-head-icon" data-state="ok">✓</div>
                      <div>
                        <span class="nmda-supplement-kicker">导入完成</span>
                        <h3 id="nmda-supplement-title">确认文件用途</h3>
                        <p>确认有疑问的文件即可。</p>
                      </div>
                    </div>
                    <div class="nmda-classify-head-summary" id="nmda-preflight-routing-chips" aria-label="分类概览"></div>
                  </header>

                  <nav class="nmda-classify-modebar" aria-label="导入核验步骤">
                    <button class="is-active" type="button" data-preflight-view="files"><span>1</span><strong>核验文件</strong><small>确认用途</small></button>
                    <button type="button" data-preflight-view="support"><span>2</span><strong>参考名单</strong><small>可选核对来源</small></button>
                  </nav>

                  <div class="nmda-classify-workspace" data-preflight-view="files">
                    <div class="nmda-classify-files-view" data-preflight-panel="files">
                    <aside class="nmda-classify-sidebar">
                      <div class="nmda-classify-pane-head">
                        <div><span>目录 / 批次</span><strong id="nmda-preflight-directory-title">全部文件</strong></div>
                        <span id="nmda-preflight-directory-count">0</span>
                      </div>
                      <div class="nmda-classify-directory-nav" id="nmda-preflight-directory-nav"></div>


                    </aside>

                    <section class="nmda-preflight-source-routing nmda-classify-main" id="nmda-preflight-source-routing">
                      <div class="nmda-classify-toolbar">
                        <div class="nmda-classify-toolbar-title">
                          <strong id="nmda-preflight-source-routing-summary">文件列表</strong>
                          <small id="nmda-preflight-source-routing-subtitle">点击文件在右侧查看内容；用途不对时再修改。</small>
                        </div>
                        <div class="nmda-classify-toolbar-actions">
                          <label class="nmda-classify-search"><span>⌕</span><input id="nmda-preflight-source-search" type="search" placeholder="搜索文件名或目录"></label>
                        </div>
                      </div>

                      <div class="nmda-classify-dropzones" id="nmda-preflight-dropzones" aria-label="拖拽文件重新分类">
                        <button class="nmda-classify-dropzone" data-drop-purpose="mail" data-tone="mail" type="button"><span class="nmda-drop-icon">✉</span><span><strong>邮件</strong><small>拖到这里</small></span><b data-drop-count="mail">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="roster" data-tone="roster" type="button"><span class="nmda-drop-icon">名</span><span><strong>总名单</strong><small>拖到这里</small></span><b data-drop-count="roster">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="attachment" data-tone="attachment" type="button"><span class="nmda-drop-icon">附</span><span><strong>附件</strong><small>拖到这里</small></span><b data-drop-count="attachment">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="review" data-tone="review" type="button"><span class="nmda-drop-icon">!</span><span><strong>待确认</strong><small>稍后再看</small></span><b data-drop-count="review">0</b></button>
                        <button class="nmda-classify-dropzone" data-drop-purpose="ignored" data-tone="ignored" type="button"><span class="nmda-drop-icon">×</span><span><strong>暂不使用</strong><small>本批次忽略</small></span><b data-drop-count="ignored">0</b></button>
                      </div>

                      <div class="nmda-preflight-routing-tip" hidden><span>↕</span><small>拖动文件时会出现快速归类区域。</small></div>
                      <div class="nmda-preflight-source-routing-list nmda-classify-file-list" id="nmda-preflight-source-routing-list"></div>
                    </section>

                    <aside class="nmda-classify-inspector-pane" aria-label="当前文件核验">
                      <div class="nmda-source-inspector-empty" id="nmda-source-inspector-empty">
                        <span class="nmda-source-inspector-empty-icon">⌁</span>
                        <strong>选择一个文件查看内容</strong>
                        <small>分类正确无需操作；只有发现用途不对时才修改。</small>
                      </div>
                      <div class="nmda-source-inspector-card" id="nmda-source-inspector-card" hidden>
                        <div class="nmda-source-inspector-card-head">
                          <button class="nmda-source-inspector-close" id="nmda-source-inspector-close" type="button" aria-label="返回文件列表">←</button>
                          <div><span>当前文件</span><strong id="nmda-source-inspector-title">文件核验</strong></div>
                        </div>
                        <div class="nmda-source-inspector-overview" id="nmda-source-inspector-overview"></div>
                        <div class="nmda-source-inspector-actions" id="nmda-source-inspector-actions"></div>
                        <div class="nmda-source-inspector-content" id="nmda-source-inspector-content"></div>
                        <button class="nmda-source-next-review" id="nmda-source-next-review" type="button" hidden>查看下一个待确认 →</button>
                      </div>
                    </aside>
                    </div>

                    <section class="nmda-classify-support-view" data-preflight-panel="support" data-support-view="roster" hidden>
                      <header class="nmda-support-view-head">
                        <div><span>批次资料</span><strong>按需要补充</strong></div>
                        <nav class="nmda-support-modebar" aria-label="批次资料类型">
                          <button class="is-active" type="button" data-support-view="roster"><span>名</span><strong>参考名单</strong></button>
                          <button type="button" data-support-view="attachment"><span>附</span><strong>附件</strong></button>
                        </nav>
                      </header>
                    <section class="nmda-classify-supplements nmda-classify-upload-dock" id="nmda-preflight-supplements" aria-label="批次资料">
                        <div class="nmda-classify-supplement-stack">
                          <article class="nmda-supplement-box nmda-supplement-box-compact" id="nmda-preflight-roster-box" data-support-pane="roster" data-state="pending">
                            <div class="nmda-supplement-box-icon">名</div>
                            <div class="nmda-supplement-box-main">
                              <strong id="nmda-preflight-roster-title">参考总名单</strong>
                              <small id="nmda-preflight-roster-copy">已有总名单时可加入。</small>
                              <div class="nmda-supplement-status" id="nmda-preflight-roster-status">尚未添加</div>
                            </div>
                            <div class="nmda-supplement-actions">
                              <label class="nmda-btn nmda-btn-small nmda-btn-primary" for="nmda-roster-file">上传名单</label>
                            </div>
                          </article>
                          <article class="nmda-supplement-box nmda-supplement-box-compact nmda-supplement-box-attachment" id="nmda-preflight-attachment-box" data-support-pane="attachment" data-state="pending">
                            <div class="nmda-supplement-box-icon">附</div>
                            <div class="nmda-supplement-box-main">
                              <strong id="nmda-preflight-attachment-title">附件工作台</strong>
                              <small id="nmda-preflight-attachment-copy">所有附件统一在一个面板中配置发送范围。</small>
                              <div class="nmda-attachment-requirements" id="nmda-preflight-attachment-requirements"></div>
                              <div class="nmda-supplement-status" id="nmda-preflight-attachment-status">尚未添加</div>
                              <div class="nmda-attachment-assets nmda-attachment-assets-inline" id="nmda-preflight-attachment-assets" hidden>
                                <div class="nmda-attachment-assets-head"><strong>附件状态</strong><span id="nmda-preflight-attachment-assets-count"></span></div>
                                <div class="nmda-attachment-assets-list" id="nmda-preflight-attachment-assets-list"></div>
                              </div>
                            </div>
                            <div class="nmda-supplement-actions">
                              <button class="nmda-btn nmda-btn-small nmda-btn-primary" type="button" data-open-attachment-manager>打开附件工作台</button>
                            </div>
                          </article>
                        </div>
                      </section>
                    </section>
                  </div>

                  <footer class="nmda-supplement-foot nmda-classify-foot">
                    <button class="nmda-btn nmda-btn-quiet" id="nmda-close-supplement-preflight" type="button">返回上传</button>
                    <div class="nmda-classify-foot-summary"><strong id="nmda-preflight-batch-summary">正在核验本批次</strong><small>无误即可继续。</small></div>
                    <button class="nmda-btn nmda-btn-primary" id="nmda-complete-supplement-preflight" type="button">完成分类</button>
                  </footer>
                </section>
              </div>

              <div class="nmda-attachment-manager-overlay" id="nmda-attachment-manager-overlay" hidden aria-hidden="true">
                <section class="nmda-attachment-manager" role="region" aria-labelledby="nmda-attachment-manager-title">
                  <div class="nmda-attachment-manager-head">
                    <div><span class="nmda-supplement-kicker">统一附件配置</span><h3 id="nmda-attachment-manager-title">附件工作台</h3><p>每个文件只配置“发给哪些邮件”。拖入文件或文件夹后，可自动匹配、应用全部邮件，或精确指定邮件。</p></div>
                    <button class="nmda-icon-btn" id="nmda-close-attachment-manager" type="button" aria-label="关闭附件工作台">×</button>
                  </div>
                  <div class="nmda-attachment-manager-body">
                    <div class="nmda-attachment-workspace-stats" id="nmda-attachment-manager-summary">尚未加入附件。</div>
                    <div class="nmda-attachment-manager-drop" id="nmda-attachment-manager-drop" tabindex="0" role="button" aria-label="拖入或选择附件">
                      <span class="nmda-attachment-manager-drop-icon">⇧</span>
                      <div><strong>拖入附件或文件夹</strong><small>也可以点击选择文件；文件夹会保留相对路径并参与自动匹配。</small></div>
                      <span class="nmda-attachment-manager-drop-action">选择文件</span>
                    </div>
                    <div class="nmda-attachment-manager-addbar">
                      <label class="nmda-btn nmda-btn-small nmda-btn-primary" for="nmda-attachment-files">选择文件</label>
                      <label class="nmda-btn nmda-btn-small" for="nmda-attachment-dir">选择文件夹</label>
                      <input id="nmda-attachment-files" type="file" multiple hidden>
                      <input id="nmda-attachment-dir" type="file" webkitdirectory multiple hidden>
                      <span id="nmda-file-index-info" class="nmda-hint">尚未选择本地附件。</span>
                    </div>
                    <section class="nmda-attachment-workspace-section">
                      <header><div><strong>附件文件</strong></div><span id="nmda-attachment-manager-file-count">0 个</span></header>
                      <div class="nmda-attachment-assets" id="nmda-attachment-manager-assets">
                        <div class="nmda-attachment-assets-list nmda-attachment-workspace-list" id="nmda-attachment-manager-list"></div>
                        <div class="nmda-attachment-assets-empty" id="nmda-attachment-manager-empty">还没有附件。把文件拖到上方即可开始配置。</div>
                      </div>
                    </section>
                    <section class="nmda-attachment-target-editor" id="nmda-attachment-target-editor" hidden>
                      <header><div><span>指定邮件</span><strong id="nmda-attachment-target-title">选择适用邮件</strong></div><button class="nmda-icon-btn" id="nmda-attachment-target-close" type="button" aria-label="关闭指定邮件设置">×</button></header>
                      <div class="nmda-attachment-target-toolbar"><label><span>⌕</span><input id="nmda-attachment-target-search" type="search" placeholder="搜索收件人、主题或学校"></label><button class="nmda-btn nmda-btn-small" id="nmda-attachment-target-all" type="button">全选当前</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-attachment-target-clear" type="button">清空</button></div>
                      <div class="nmda-attachment-target-list" id="nmda-attachment-target-list"></div>
                    </section>
                    <section class="nmda-attachment-workspace-section nmda-attachment-requirement-section" id="nmda-attachment-manager-requirements-section">
                      <header><div><strong>邮件中的附件要求</strong></div><span id="nmda-attachment-manager-requirements-count">0 项</span></header>
                      <div class="nmda-attachment-requirement-list" id="nmda-attachment-manager-requirements"></div>
                    </section>
                  </div>
                  <div class="nmda-attachment-manager-foot">
                    <button class="nmda-btn nmda-btn-danger-quiet" id="nmda-manager-clear-attachments" type="button">清空附件</button>
                    <div class="nmda-row nmda-wrap"><span class="nmda-hint" id="nmda-attachment-manager-foot-note"></span><button class="nmda-btn nmda-btn-primary" id="nmda-attachment-manager-done" type="button">完成</button></div>
                  </div>
                </section>
              </div>

              <div class="nmda-card nmda-inline-review" id="nmda-inline-review" hidden>
                <div class="nmda-inline-review-top">
                  <div><div class="nmda-card-title" id="nmda-review-workspace-title">邮件审阅</div><div class="nmda-card-desc" id="nmda-review-workspace-desc"></div></div>
                  <div class="nmda-inline-review-actions"><details class="nmda-review-trash" id="nmda-review-trash"><summary class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-trash-trigger" id="nmda-review-trash-trigger" title="查看被排除的邮件"><span class="nmda-review-trash-icon" aria-hidden="true"></span><span>垃圾箱</span><strong id="nmda-review-trash-count">0</strong></summary><div class="nmda-review-trash-popover"><header><div><strong>垃圾箱</strong><small>排除只影响后续排期与发送，邮件内容仍保留。</small></div><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-trash-restore-all" type="button">全部恢复</button></header><div class="nmda-review-trash-list" id="nmda-review-trash-list"></div><div class="nmda-review-trash-empty" id="nmda-review-trash-empty">垃圾箱为空</div></div></details><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-next-pending" type="button">下一个需处理</button></div>
                </div>
                <div class="nmda-review-boardbar nmda-review-boardbar-unified">
                  <div class="nmda-review-filter nmda-review-status-tabs" id="nmda-review-filter" role="group" aria-label="邮件状态筛选">
                    <button class="is-active" type="button" data-review-filter="all"><span>全部</span><strong>0</strong></button>
                    <button type="button" data-review-filter="auto"><span>自动通过</span><strong>0</strong></button>
                    <button type="button" data-review-filter="pending"><span>需处理</span><strong>0</strong></button>
                    <button type="button" data-review-filter="confirmed"><span>已确认</span><strong>0</strong></button>
                  </div>
                  <div class="nmda-review-queue-tools">
                    <label class="nmda-review-search"><span aria-hidden="true">⌕</span><input id="nmda-review-search" type="search" placeholder="搜索收件人 / 邮箱 / 主题" autocomplete="off"></label>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-bulk-entry" id="nmda-review-select-filtered" type="button">批量确认…</button>
                  </div>
                </div>
                <section class="nmda-format-governance nmda-batch-standards" id="nmda-format-governance" hidden aria-label="Preview 批量处理">
                  <header class="nmda-format-governance-head nmda-batch-standards-head">
                    <div><strong>批量处理</strong><small id="nmda-batch-standards-desc">只显示当前真正需要处理的批量事项：补齐主题、处理检测到的格式偏移。</small></div>
                    <button class="nmda-icon-btn" id="nmda-format-governance-close" type="button" aria-label="关闭批量处理">×</button>
                  </header>
                  <div class="nmda-batch-standards-overview" aria-label="批量处理检查结果">
                    <span data-standard-summary="subject"><i>T</i><b>主题补齐</b><strong id="nmda-batch-standard-subject-count">0</strong><small>缺失</small></span>
                    <span data-standard-summary="format"><i>✦</i><b>格式偏移</b><strong id="nmda-batch-standard-format-count">0</strong><small>推荐</small></span>
                    <span data-standard-summary="followup" hidden><i>↗</i><b>Follow-up 模板</b><strong id="nmda-batch-followup-count">未设置</strong><small id="nmda-batch-followup-summary">按需显示</small></span>
                  </div>
                  <section class="nmda-batch-standard-card is-subject" id="nmda-batch-standard-subject">
                    <header><div><strong>主题完整性</strong><small>仅补空白 Initial 主题，不覆盖任何已有主题；Follow-up 主题链保持原样。</small></div><b id="nmda-batch-standard-subject-badge">0 封</b></header>
                    <label class="nmda-batch-standard-subject-field"><span>补齐为</span><input id="nmda-batch-standard-subject-input" type="text" maxlength="240" placeholder="输入统一主题" autocomplete="off"></label>
                    <button class="nmda-batch-standard-suggestion" id="nmda-batch-standard-subject-suggestion" type="button" hidden></button>
                    <div class="nmda-batch-standard-result" id="nmda-batch-standard-subject-result">正在检查主题完整性…</div>
                  </section>
                  <section class="nmda-batch-standard-card is-format" id="nmda-batch-standard-format">
                    <header><div><strong>格式偏移</strong><small>默认只展示系统从当前邮件中检测到的偏移推荐；选择后一次批量修复。</small></div></header>
                    <div class="nmda-format-governance-suggestions" id="nmda-format-governance-suggestions"></div>
                    <div class="nmda-format-governance-queue" id="nmda-format-governance-queue" hidden></div>
                    <details class="nmda-format-governance-custom" id="nmda-format-governance-custom">
                      <summary><span><strong>自定义格式规则</strong><small>仅在推荐无法覆盖时使用</small></span><i aria-hidden="true">⌄</i></summary>
                      <div class="nmda-format-governance-custom-body">
                        <div class="nmda-format-governance-builder">
                          <label class="nmda-format-governance-phrase"><span>固定文本</span><input id="nmda-format-governance-phrase" type="text" maxlength="240" placeholder="例如：Computational Imaging" autocomplete="off"><small>精确匹配正文中的固定表达。</small></label>
                          <div class="nmda-format-governance-formats" role="group" aria-label="需要统一的格式">
                            <span>统一为</span>
                            <button class="is-active" type="button" data-governance-format="italic" aria-pressed="true" title="斜体"><em>I</em><small>斜体</small></button>
                            <button type="button" data-governance-format="bold" aria-pressed="false" title="加粗"><strong>B</strong><small>加粗</small></button>
                            <button type="button" data-governance-format="underline" aria-pressed="false" title="下划线"><u>U</u><small>下划线</small></button>
                            <button type="button" data-governance-format="strike" aria-pressed="false" title="删除线"><s>S</s><small>删除线</small></button>
                          </div>
                          <label class="nmda-format-governance-case"><input id="nmda-format-governance-case" type="checkbox" checked><span>区分大小写</span></label>
                          <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-format-governance-add" id="nmda-format-governance-add" type="button" disabled>加入本次处理</button>
                        </div>
                        <div class="nmda-format-governance-result" id="nmda-format-governance-result">输入固定文本后检查命中范围。</div>
                        <div class="nmda-format-governance-list" id="nmda-format-governance-list" hidden></div>
                        <div id="nmda-format-governance-history" class="nmda-format-governance-history"></div>
                      </div>
                    </details>
                  </section>
                  <section class="nmda-batch-standard-card is-followup" id="nmda-batch-followup-template-card" hidden>
                    <header><div><strong>Follow-up 正文模板</strong><small>这是批量派生规则，不是单封邮件编辑。称呼与署名从 Initial 自动继承，这里只维护中间正文。</small></div><b id="nmda-batch-followup-badge">未设置</b></header>
                    <div class="nmda-batch-followup-structure" aria-label="Follow-up 模板结构"><span>继承称呼</span><i>+</i><strong>正文模板</strong><i>+</i><span>继承署名</span></div>
                    <label class="nmda-batch-followup-template-field"><textarea id="nmda-batch-followup-template" rows="4" placeholder="例如：I wanted to follow up on my previous email regarding ..."></textarea></label>
                    <label class="nmda-batch-followup-sync"><input id="nmda-batch-followup-sync" type="checkbox" checked><span>同步刷新尚未发送、且仍由模板管理的 Follow-up</span><small id="nmda-batch-followup-sync-count">0 封可同步</small></label>
                    <div class="nmda-batch-standard-result" id="nmda-batch-followup-result"><strong>未设置模板</strong><span>保存后，后续到期的 Follow-up 才能按模板批量派生。</span></div>
                  </section>
                  <footer class="nmda-format-governance-actions nmda-batch-standards-actions">
                    <div id="nmda-batch-standard-plan-summary" class="nmda-batch-standard-plan-summary">尚未配置可执行批量处理</div>
                    <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-format-governance-apply" type="button" disabled>应用批量处理</button>
                  </footer>
                </section>

                <div class="nmda-review-batchbar" id="nmda-review-batchbar" hidden>
                  <div><strong id="nmda-review-selected-count">已选 0 封</strong></div>
                  <div class="nmda-row"><button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-review-confirm-selected" type="button">确认所选</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-review-clear-selected" type="button">取消</button></div>
                </div>
                <div class="nmda-review-page-empty" id="nmda-review-page-empty">添加资料后，这里会显示每封邮件的识别状态。</div>
                <div class="nmda-review-preview-toolbar" id="nmda-review-preview-toolbar" hidden>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-review-preview-back" id="nmda-review-preview-back" type="button">← 返回邮件列表</button>
                  <div class="nmda-review-preview-toolbar-copy"><strong>邮件 Preview</strong><small id="nmda-review-preview-meta">只读预览 · 当前邮件可原位编辑</small></div>
                  <div class="nmda-review-preview-key" aria-label="关键信息定位标识">
                    <span class="nmda-semantic-legend-item" data-semantic="advisor"><i></i><strong>导师</strong></span>
                    <span class="nmda-semantic-legend-item" data-semantic="student"><i></i><strong>学生</strong></span>
                    <span class="nmda-semantic-legend-item" data-semantic="institution"><i></i><strong>学校 / 机构</strong></span>
                    <span class="nmda-semantic-legend-item" data-semantic="anchor"><i></i><strong>称呼 / 身份 / 意图 / 落款</strong></span>
                    <span class="nmda-semantic-legend-item" data-semantic="degree"><i></i><strong>学位 / 时间</strong></span>
                    <span class="nmda-semantic-legend-item" data-semantic="attention"><i></i><strong>重点表达</strong><small>斜体 / 引号 / 引用</small></span>
                    <span class="nmda-semantic-legend-item" data-semantic="format"><i></i><strong>其他格式</strong><small>加粗 / 下划线 / 链接</small></span>
                  </div>
                </div>
                <aside class="nmda-review-preview-rail" id="nmda-review-preview-rail" hidden aria-label="Preview 邮件导航">
                  <div class="nmda-review-preview-rail-head"><div><strong>邮件</strong><small id="nmda-review-preview-rail-count">0</small></div></div>
                  <div class="nmda-review-preview-rail-list" id="nmda-review-preview-rail-list"></div>
                </aside>
                <div id="nmda-review-queue" class="nmda-review-queue nmda-review-mail-grid"></div>
                <div class="nmda-preview-format-dock" id="nmda-preview-format-dock" aria-label="Preview 批量处理">
                  <button class="nmda-review-format-entry nmda-preview-format-entry" id="nmda-review-format-governance" type="button" aria-expanded="false" title="处理可批量执行的规范与派生规则">
                    <span class="nmda-preview-format-glyph nmda-preview-standard-glyph" aria-hidden="true"><i></i><b></b></span>
                    <span class="nmda-preview-format-label">批量处理</span>
                    <strong id="nmda-preview-format-drift-count" hidden>0</strong>
                  </button>
                </div>

              </div>


            </div>




          </section>


          <section class="nmda-tabpane nmda-page nmda-dispatch-page" data-pane="dispatch" hidden>
            <div class="nmda-dispatch-intro">
              <div><strong>执行池</strong><small></small></div>
              <div class="nmda-dispatch-source-summary" id="nmda-dispatch-source-summary"></div>
            </div>
            <div class="nmda-batch-empty" id="nmda-batch-empty" hidden></div>
            <div class="nmda-card nmda-list-card nmda-planning-workspace" id="nmda-preview-card" hidden>
              <div class="nmda-card-head nmda-list-head nmda-planning-head">
                <div><div class="nmda-card-title">安排本次邮件</div><div class="nmda-card-desc"></div></div>
                <div class="nmda-planning-head-actions">
                  <div id="nmda-batch-summary" class="nmda-summary nmda-summary-inline"></div>
                  <button class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-open-schedule-modal" type="button">时间规划</button>
                </div>
              </div>
              <div class="nmda-planning-overview" id="nmda-planning-overview"></div>
              <details class="nmda-scope-tools" id="nmda-scope-tools">
                <summary><span><strong>筛选邮件</strong></span><span class="nmda-scope-toggle">展开</span></summary>
                <div class="nmda-task-toolbar">
                  <label class="nmda-search-field"><input id="nmda-batch-search" type="search" placeholder="搜索收件人 / 学校 / 邮箱"></label>
                  <button class="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button">纳入筛选结果</button>
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-selection" type="button">排除全部</button>
                </div>
              </details>
              <input id="nmda-batch-tag-include" type="hidden"><button id="nmda-clear-tag-filter" type="button" hidden></button><div id="nmda-batch-tag-chips" hidden></div>
              <input id="nmda-bulk-tag-value" type="hidden"><button id="nmda-bulk-add-tag" type="button" hidden></button><button id="nmda-bulk-remove-tag" type="button" hidden></button><button id="nmda-bulk-disable" type="button" hidden></button>
              <div class="nmda-table-wrap nmda-batch-table-wrap"><div class="nmda-planning-board" id="nmda-preview-body"></div></div>
              <div class="nmda-mail-handoff-bar" id="nmda-mail-handoff-bar">
                <div class="nmda-mail-handoff-copy"><span class="nmda-mail-handoff-mark" aria-hidden="true">N</span><div><strong id="nmda-batch-status">准备转到网易邮箱执行</strong><div class="nmda-create-preflight" id="nmda-create-preflight">确认本次范围与排期后，真实创建过程将在网易邮箱页面显示。</div></div></div>
                <label class="nmda-execution-mode" title="每封邮件填写完成后暂停，人工检查后再保存"><input id="nmda-pause-every-time" type="checkbox"><span>每封填写后暂停</span></label>
                <button class="nmda-btn nmda-btn-primary nmda-mail-handoff-action" id="nmda-batch-start" type="button">前往网易邮箱并创建所选草稿</button>
                <button id="nmda-batch-stop" type="button" hidden disabled>当前封后停止</button>
              </div>
            </div>

            <section class="nmda-roster-planner-view" id="nmda-roster-planner-view" hidden aria-labelledby="nmda-roster-planner-title">
              <header class="nmda-roster-planner-view-head">
                <div class="nmda-roster-planner-view-leading">
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-roster-planner-back" type="button">← 返回时间规划</button>
                  <div><span class="nmda-dialog-eyebrow">Within-school priority · Optional</span><h2 id="nmda-roster-planner-title">同校优先级 · 可选</h2><p>仅在需要明确同一学校内的联系先后时设置 R1/R2…；它只是时间规划的可选约束，不设置时按现有名单顺序正常排期。</p></div>
                </div>
                <div class="nmda-roster-planner-view-actions">
                  <button class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-roster-planner-done" type="button">完成并返回时间规划</button>
                </div>
              </header>

              <div class="nmda-roster-planner-workspace">
                <div class="nmda-roster-planner-commandbar">
                  <div class="nmda-roster-source-cluster">
                    <div class="nmda-roster-planner-source">
                      <span>总名单</span>
                      <select id="nmda-roster-planner-source" aria-label="选择名单工作表"></select>
                    </div>
                    <div class="nmda-roster-planner-summary" id="nmda-roster-planner-summary">等待读取总名单…</div>
                  </div>

                  <div class="nmda-roster-color-strip" aria-label="按格式特征快速选择联系人">
                    <span class="nmda-roster-color-strip-label">快速选人</span>
                    <div class="nmda-roster-visual-groups" id="nmda-roster-visual-groups"></div>
                  </div>

                  <div class="nmda-roster-planner-canvas-tools">
                    <span class="nmda-roster-column-focus" id="nmda-roster-column-focus">正在整理名单…</span>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-roster-column-toggle" id="nmda-roster-column-toggle" type="button" hidden>显示全部列</button>
                    <div class="nmda-roster-planner-selection-mini" id="nmda-roster-selection-mini">尚未选择</div>
                  </div>
                </div>

                <div class="nmda-roster-intent-summary" id="nmda-roster-intent-summary"></div>

                <main class="nmda-roster-planner-canvas">
                  <div class="nmda-roster-planner-canvas-head">
                    <div class="nmda-roster-selection-context">
                      <div class="nmda-roster-selection-copy">
                        <strong id="nmda-roster-selection-label">尚未选择</strong>
                        <small id="nmda-roster-selection-detail">可选：新建 R1/R2… 后按颜色 / 特征选择或直接框选联系人加入；也可以跳过。</small>
                      </div>
                      <div class="nmda-roster-active-batch" id="nmda-roster-active-batch" data-state="empty">
                        <span>当前同校优先级</span><strong id="nmda-roster-active-batch-label">未创建</strong>
                      </div>
                      <button class="nmda-btn nmda-btn-small nmda-btn-primary nmda-roster-batch-add" id="nmda-roster-batch-add" type="button" disabled>加入当前优先级</button>
                      <button class="nmda-btn nmda-btn-small nmda-roster-batch-create" id="nmda-roster-batch-create" type="button">＋ 新建优先级</button>
                      <button class="nmda-btn nmda-btn-small nmda-btn-quiet nmda-roster-batch-clear" id="nmda-roster-batch-clear" type="button" disabled>移出优先级</button>
                    </div>
                  </div>
                  <div class="nmda-roster-sheet-viewport" id="nmda-roster-sheet-viewport" tabindex="0" aria-label="总名单预览，可拖动框选联系人">
                    <table class="nmda-roster-sheet-table" id="nmda-roster-sheet-table"></table>
                  </div>
                </main>
              </div>
            </section>

            <div class="nmda-workflow-modal-overlay" id="nmda-schedule-modal" hidden>
              <section class="nmda-workflow-dialog nmda-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-schedule-dialog-title">
                <header class="nmda-workflow-dialog-head">
                  <div><span class="nmda-dialog-eyebrow">本次发送计划</span><h3 id="nmda-schedule-dialog-title">时间规划</h3><p>先确定发送时间规则，再生成最终排期；同校优先级只是可选的排序约束，不设置也可直接规划。</p></div>
                  <button class="nmda-dialog-close" id="nmda-close-schedule-modal" type="button" aria-label="关闭时间规划">×</button>
                </header>
                <section class="nmda-schedule-dialog-body" id="nmda-scheduler-card">
                  <div class="nmda-schedule-dialog-summary" id="nmda-schedule-summary"></div>
                  <div class="nmda-schedule-priority-card" id="nmda-schedule-priority-card">
                    <div class="nmda-schedule-priority-copy">
                      <span>可选约束</span>
                      <strong>同校优先级</strong>
                      <small id="nmda-schedule-priority-summary">未设置时按现有名单顺序排期。</small>
                    </div>
                    <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-schedule-open-priority" type="button">设置优先级</button>
                  </div>
                  <div class="nmda-scheduler-grid nmda-scheduler-calendar-grid">
                    <label class="nmda-field nmda-schedule-region-field"><span class="nmda-label">地区 · Local time</span><select id="nmda-rule-time-zone">
                      <option value="system">本机 / 网易当前时区</option>
                      <option value="Asia/Shanghai">中国 · 上海</option>
                      <option value="Asia/Hong_Kong">中国香港</option>
                      <option value="Asia/Singapore">新加坡</option>
                      <option value="Asia/Kuala_Lumpur">马来西亚 · 吉隆坡</option>
                      <option value="Australia/Sydney">澳大利亚 · Sydney / Melbourne</option>
                      <option value="Australia/Brisbane">澳大利亚 · Brisbane</option>
                      <option value="Australia/Adelaide">澳大利亚 · Adelaide</option>
                      <option value="Australia/Perth">澳大利亚 · Perth</option>
                      <option value="Pacific/Auckland">新西兰 · Auckland</option>
                      <option value="Europe/London">英国 · London</option>
                      <option value="America/New_York">美国 / 加拿大 · Eastern</option>
                      <option value="America/Chicago">美国 · Central</option>
                      <option value="America/Denver">美国 · Mountain</option>
                      <option value="America/Los_Angeles">美国 / 加拿大 · Pacific</option>
                      <option value="America/Toronto">加拿大 · Toronto</option>
                      <option value="America/Vancouver">加拿大 · Vancouver</option>
                    </select><small class="nmda-field-hint">按所选地区当地时间规划，执行时自动换算到网易当前时区。</small></label>
                    <label class="nmda-field"><span class="nmda-label">开始日期</span><input id="nmda-rule-start-date" type="date"></label>
                    <label class="nmda-field"><span class="nmda-label">当地发送时间</span><input id="nmda-rule-local-time" type="time" step="300" value="07:30"></label>
                    <label class="nmda-field"><span class="nmda-label">每校每个发送日最多</span><input id="nmda-rule-max-school" type="number" min="1" max="20" step="1" value="1"></label>
                    <div class="nmda-field nmda-workday-field"><span class="nmda-label">发送工作日</span><div class="nmda-workday-picker" role="group" aria-label="选择发送工作日">
                      <label><input type="checkbox" data-schedule-weekday value="1"><span>周一</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="2"><span>周二</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="3"><span>周三</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="4" checked><span>周四</span></label>
                      <label><input type="checkbox" data-schedule-weekday value="5"><span>周五</span></label>
                    </div><small class="nmda-field-hint">取代固定“+7 天”；只在勾选的工作日安排新邮件。</small></div>
                    <div class="nmda-field nmda-skip-range-field"><span class="nmda-label">跳过时间段 · 可选</span><div class="nmda-skip-range-inputs"><input id="nmda-rule-skip-start" type="date" aria-label="跳过开始日期"><span>至</span><input id="nmda-rule-skip-end" type="date" aria-label="跳过结束日期"></div><small class="nmda-field-hint">例如假期、申请季间隔；区间内不安排新邮件。</small></div>
                    <label class="nmda-check-card"><input id="nmda-rule-preserve-existing" type="checkbox" checked><span><strong>保留本批已有时间</strong></span></label>
                    <label class="nmda-check-card"><input id="nmda-rule-include-mailbox-scheduled" type="checkbox" checked><span><strong>纳入网易已有排期</strong></span></label>
                    <label class="nmda-check-card nmda-schedule-wide-check"><input id="nmda-rule-skip-holidays" type="checkbox" checked><span><strong>避开可识别的当地节假日</strong></span></label>
                  </div>
                  <div class="nmda-schedule-rule-preview" id="nmda-schedule-rule-preview">周四 · 07:30 当地时间 · 每校每个发送日最多 1 位。</div>
                </section>
                <footer class="nmda-workflow-dialog-foot">
                  <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-auto-schedule" type="button">清除自动时间</button>
                  <div class="nmda-dialog-foot-spacer"></div>
                  <button class="nmda-btn nmda-btn-small" id="nmda-cancel-schedule-modal" type="button">取消</button>
                  <button class="nmda-btn nmda-btn-primary nmda-btn-small" id="nmda-apply-schedule" type="button">应用排期</button>
                </footer>
              </section>
            </div>

          </section>


          <section class="nmda-tabpane nmda-page nmda-monitor-page" data-pane="monitor" hidden>
            <div class="nmda-monitor-toolbar">
              <div class="nmda-monitor-toolbar-copy"><div><strong>邮件监测</strong><small id="nmda-monitor-sync-copy"></small></div></div>
              <div class="nmda-row nmda-wrap nmda-monitor-toolbar-actions">
                <label class="nmda-monitor-history-window" title="超过读取范围的邮件不会请求，也不会参与查重、回复识别或 Follow-up 计算。"><span>读取范围</span><select id="nmda-monitor-history-months"><option value="3">最近 3 个月</option><option value="6">最近 6 个月</option><option value="9">最近 9 个月</option><option value="12">最近 12 个月</option><option value="18">最近 18 个月</option><option value="24">最近 24 个月</option><option value="0">全部邮件</option></select></label>
                <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-monitor-sync" type="button">立即刷新</button>
                <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-monitor-full-sync" type="button">重读范围</button>
              </div>
            </div>

            <div class="nmda-monitor-stats" id="nmda-monitor-stats"></div>

            <div class="nmda-monitor-rulebar" id="nmda-monitor-policy">
              <div class="nmda-monitor-rulebar-title"><strong>Follow-up 规则</strong><small></small></div>
              <div class="nmda-monitor-rulebar-controls">
                <label><span>发送后</span><input id="nmda-monitor-delay" type="number" min="0" max="365" step="1"><span>天</span></label>
                <span class="nmda-monitor-rule-sep">·</span>
                <label><span>最多</span><input id="nmda-monitor-max" type="number" min="0" max="20" step="1"><span>次</span></label>
                <span class="nmda-monitor-rule-sep">·</span>
                <label><span>方式</span><select id="nmda-monitor-compose-mode"><option value="forward">Forward</option><option value="reply">Reply</option><option value="new">New message</option></select></label>
                <button class="nmda-btn nmda-btn-small" id="nmda-monitor-save-policy" type="button">保存规则</button><button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-monitor-open-template" type="button">批量处理 →</button>
              </div>
              <small class="nmda-monitor-rule-note"></small>
            </div>

            <div class="nmda-monitor-filterbar">
              <div class="nmda-monitor-filters" role="group" aria-label="邮件监测筛选">
                <button type="button" data-monitor-filter="all" class="is-active">全部</button>
                <button type="button" data-monitor-filter="due">待跟进</button>
                <button type="button" data-monitor-filter="waiting">等待中</button>
                <button type="button" data-monitor-filter="replied">已回复</button>
                <button type="button" data-monitor-filter="blocked">需处理</button>
              </div>
              <input class="nmda-monitor-search" id="nmda-monitor-search" type="search" placeholder="搜索收件人或主题">
            </div>

            <div class="nmda-monitor-bulkbar" id="nmda-monitor-bulkbar" hidden>
              <label class="nmda-monitor-select-all"><input id="nmda-monitor-select-visible" type="checkbox"><span>选择当前可生成</span></label>
              <span class="nmda-monitor-selection-copy" id="nmda-monitor-selection-copy">已选择 0</span>
              <div class="nmda-monitor-bulk-actions">
                <button class="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-monitor-clear-selection" type="button">清除</button>
                <button class="nmda-btn nmda-btn-small nmda-btn-primary" id="nmda-monitor-batch-create" type="button">批量生成 Follow-up</button>
              </div>
            </div>

            <div class="nmda-monitor-notice" id="nmda-monitor-notice" hidden></div>
            <div class="nmda-monitor-list" id="nmda-monitor-list"></div>

          </section>

        </main>
      </section>`;
    document.documentElement.appendChild(root);
    decorateUnifiedIcons(root);
    return root;
  }

  const ui = buildUI();
  let unifiedIconRefreshQueued = false;
  const queueUnifiedIconRefresh = () => {
    if (unifiedIconRefreshQueued) return;
    unifiedIconRefreshQueued = true;
    queueMicrotask(() => { unifiedIconRefreshQueued = false; decorateUnifiedIcons(ui); });
  };
  new MutationObserver(mutations => {
    for (const mutation of mutations || []) {
      if (mutation.type === 'childList' && (mutation.addedNodes?.length || mutation.removedNodes?.length)) { queueUnifiedIconRefresh(); return; }
    }
  }).observe(ui, { childList:true, subtree:true });
  // v3.8.7: Review is a first-class workspace. Import owns source preparation;
  // Review owns message decisions; Dispatch owns execution.
  const reviewCardHost=ui.querySelector('#nmda-inline-review');
  const dispatchPaneHost=ui.querySelector('[data-pane="dispatch"]');
  if(reviewCardHost&&dispatchPaneHost){
    const reviewPane=document.createElement('section');
    reviewPane.className='nmda-tabpane nmda-page nmda-review-main-page nmda-bulk-workbench is-review-focus is-review-page-focus';
    reviewPane.dataset.pane='review';
    reviewPane.hidden=true;
    reviewCardHost.hidden=false;
    reviewPane.appendChild(reviewCardHost);
    dispatchPaneHost.before(reviewPane);
  }
  const batchPaneHost=ui.querySelector('[data-pane="batch"]');
  if(batchPaneHost&&!ui.querySelector('#nmda-import-handoff-card')){
    const next=document.createElement('section');
    next.id='nmda-import-handoff-card';
    next.className='nmda-next-step-card nmda-import-next-step';
    next.hidden=true;
    next.innerHTML='<div class="nmda-next-step-copy"><span class="nmda-next-step-kicker">导入完成</span><strong>进入邮件审阅</strong><small id="nmda-handoff-hint"></small></div><div class="nmda-import-ready-summary" id="nmda-import-ready-summary"></div><button class="nmda-btn nmda-btn-primary nmda-next-step-action" id="nmda-go-batch" type="button">邮件审阅 →</button>';
    batchPaneHost.appendChild(next);
  }
  // Attachments belong to import, so their single workspace is physically mounted
  // inside the import card instead of a portal.
  const attachmentWorkspace=ui.querySelector('#nmda-attachment-manager-overlay');
  const importCardHost=ui.querySelector('#nmda-import-card');
  if(attachmentWorkspace&&importCardHost){
    attachmentWorkspace.classList.add('nmda-attachment-manager-inline');
    importCardHost.appendChild(attachmentWorkspace);
  }
  const $ = id => ui.querySelector(`#${id}`);
  const launcher = $('nmda-launcher'), panel = $('nmda-panel');
  document.documentElement.classList.add('nmda-app-document');
  document.body?.classList.add('nmda-app-body');
  ui.classList.add('nmda-standalone');
  panel.hidden = false;
  launcher.hidden = true;
  $('nmda-expand').hidden = true;
  $('nmda-close').hidden = true;
  let hostScrollSnapshot=null;
  function setHostScrollLocked(locked){
    const targets=[document.documentElement,document.body].filter(Boolean);
    if(locked&&!hostScrollSnapshot){
      hostScrollSnapshot=targets.map(el=>({el,value:el.style.getPropertyValue('overflow'),priority:el.style.getPropertyPriority('overflow')}));
      for(const el of targets)el.style.setProperty('overflow','hidden','important');
    }else if(!locked&&hostScrollSnapshot){
      for(const item of hostScrollSnapshot){if(item.value)item.el.style.setProperty('overflow',item.value,item.priority);else item.el.style.removeProperty('overflow');}
      hostScrollSnapshot=null;
    }
  }
  function syncModalState(){
    const modalOpen=[$('nmda-supplement-preflight'),$('nmda-schedule-modal')].some(el=>el&&!el.hidden);
    panel.classList.toggle('has-modal',modalOpen);
  }
  function setPanelOpen(open){panel.hidden=!open;setHostScrollLocked(open);if(open)syncModalState();}

  const connectionEl=$('nmda-mail-connection'), connectionTitleEl=$('nmda-mail-connection-title'), connectionDetailEl=$('nmda-mail-connection-detail'), openMailEl=$('nmda-open-mail');
  const mailboxAutoSyncEl=$('nmda-mail-auto-sync'), mailboxAutoSyncTitleEl=$('nmda-mail-auto-sync-title'), mailboxAutoSyncDetailEl=$('nmda-mail-auto-sync-detail');
  const mailboxAutoSyncState={running:null,runningKind:'',lastQuickAt:0,lastHistoryAt:0,lastFullAt:0,generation:0};
  function setMailboxAutoSyncCue(state='idle',detail=''){
    if(!mailboxAutoSyncEl)return;
    mailboxAutoSyncEl.dataset.state=state;
    const titles={idle:'自动同步',syncing:'正在读取邮箱',success:'邮箱已同步',error:'同步异常',waiting:'等待邮箱连接'};
    if(mailboxAutoSyncTitleEl)mailboxAutoSyncTitleEl.textContent=titles[state]||titles.idle;
    if(mailboxAutoSyncDetailEl)mailboxAutoSyncDetailEl.textContent=detail||({idle:'后台保持最新',syncing:'已发送 · 草稿 · 收件',success:'邮箱事实已更新',error:'稍后自动重试',waiting:'登录后自动开始'}[state]||'');
  }
  function mailboxSyncKindPriority(kind='quick'){
    return ({quick:1,history:2,full:3})[kind]||1;
  }
  function scheduleMailboxAutoSync(kind='quick',options={}){
    queueMicrotask(()=>{ requestAutoMailboxSync(kind,options).catch(()=>{}); });
  }
  async function refreshMailboxConnection(){
    if(!connectionEl)return null;
    try{
      const state=await chrome.runtime.sendMessage({type:'NMDA_CONNECTION_STATUS'});
      const connected=!!state?.connected, authenticated=!!state?.authenticated;
      connectionEl.dataset.state=authenticated?'connected':connected?'login':'offline';
      connectionTitleEl.textContent=authenticated?(state.account?`网易邮箱 · ${state.account}`:'网易邮箱已连接'):connected?'网易邮箱已打开 · 待登录':'网易邮箱未连接';
      connectionDetailEl.textContent=authenticated?'已连接':connected?'请先登录':'未连接';
      openMailEl.textContent=connected?'切换邮箱':'连接邮箱';
      if(authenticated && state.account && Operations) {
        const normalized=Operations.normalizeEmail(state.account)||String(state.account).toLowerCase();
        if(operationState.loaded && operationState.account!==normalized){await ensureOperationStore(true);invalidateBatchView(true);}
        scheduleMailboxAutoSync('quick',{source:'connection'});
      } else if(!authenticated) {
        setMailboxAutoSyncCue(connected?'waiting':'waiting',connected?'完成登录后自动读取':'连接网易邮箱后自动读取');
      }
      return state;
    }catch(error){
      connectionEl.dataset.state='offline'; connectionTitleEl.textContent='连接状态不可用'; connectionDetailEl.textContent=error?.message||String(error); return null;
    }
  }
  openMailEl?.addEventListener('click',async()=>{openMailEl.disabled=true;try{await chrome.runtime.sendMessage({type:'NMDA_OPEN_MAIL',focus:true});}finally{openMailEl.disabled=false;setTimeout(refreshMailboxConnection,500);}});
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==='NMDA_CONNECTION_CHANGED') refreshMailboxConnection();
    if(message?.type==='NMDA_EXECUTION_PROGRESS_BROADCAST'){
      const handler=executionProgressHandlers.get(String(message.executionId||'')); if(handler) handler(message);
    }
    if(message?.type==='NMDA_BATCH_STOP_BROADCAST' && batch?.running){
      batch.stopRequested=true;
      if(batchStopEl)batchStopEl.disabled=true;
      setBatchStatus('网易邮箱已请求停止：当前这一封完成后不会继续下一封。','warn');
    }
  });
  window.addEventListener('focus',refreshMailboxConnection);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshMailboxConnection();});
  refreshMailboxConnection();
  setTimeout(()=>scheduleMailboxAutoSync('quick',{source:'startup'}),120);

  const MAILBOX_HISTORY_MONTHS_KEY = 'nmda.mailbox.historyMonths';
  const DEFAULT_MAILBOX_HISTORY_MONTHS = 6;

  function readMailboxHistoryMonths() {
    try {
      const raw = localStorage.getItem(MAILBOX_HISTORY_MONTHS_KEY);
      if (raw == null || raw === '') return DEFAULT_MAILBOX_HISTORY_MONTHS;
      const value = Math.floor(Number(raw));
      return Number.isFinite(value) ? Math.max(0, Math.min(60, value)) : DEFAULT_MAILBOX_HISTORY_MONTHS;
    } catch (_) { return DEFAULT_MAILBOX_HISTORY_MONTHS; }
  }

  function writeMailboxHistoryMonths(value) {
    const months = Math.max(0, Math.min(60, Math.floor(Number(value) || 0)));
    try { localStorage.setItem(MAILBOX_HISTORY_MONTHS_KEY, String(months)); } catch (_) {}
    return months;
  }

  const FOLLOWUP_PREFS_KEY = 'nmda.followup.settings.v1';

  function readFollowUpPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(FOLLOWUP_PREFS_KEY) || '{}');
      return {
        enabled: raw.enabled !== false,
        delayDays: Math.max(0, Number(raw.delayDays ?? Operations?.DEFAULT_FOLLOWUP_POLICY?.delayDays ?? 7) || 0),
        maxAttempts: Math.max(0, Math.floor(Number(raw.maxAttempts ?? Operations?.DEFAULT_FOLLOWUP_POLICY?.maxAttempts ?? 2) || 0)),
        composeMode: ['forward','reply','new'].includes(raw.composeMode) ? raw.composeMode : (Operations?.DEFAULT_FOLLOWUP_POLICY?.composeMode || 'forward'),
        templateBody: String(raw.templateBody || '').replace(/\r\n?/g, '\n').trim(),
        templateVersion: Math.max(0, Math.floor(Number(raw.templateVersion || 0) || 0))
      };
    } catch (_) { return { ...(Operations?.DEFAULT_FOLLOWUP_POLICY || {}) }; }
  }

  function applyFollowUpPrefs(store) {
    if (!Operations || !store) return store;
    const prefs = readFollowUpPrefs();
    const result = Operations.setFollowUpPolicy(store, '', prefs);
    if (prefs.templateVersion > 0) result.store.followUpPolicies.default.templateVersion = prefs.templateVersion;
    return result.store;
  }

  function writeFollowUpPrefs(policy) {
    if (!policy) return;
    try {
      localStorage.setItem(FOLLOWUP_PREFS_KEY, JSON.stringify({
        enabled: policy.enabled !== false, delayDays:Number(policy.delayDays||0), maxAttempts:Number(policy.maxAttempts||0),
        composeMode:String(policy.composeMode||'forward'), templateBody:String(policy.templateBody||''), templateVersion:Number(policy.templateVersion||0)
      }));
    } catch (_) {}
  }

  const operationState = { account: '', store: Operations ? applyFollowUpPrefs(Operations.createStore('default')) : null, loaded: false };

  const REVIEW_RENDER_CHUNK = 32;

  // Mailbox facts / execution runtime remain session-scoped, but the parsed working set is persisted locally.
  // This lets operators build one batch across multiple imports and recover parsed Review/Dispatch work after reload.
  const viewPerf = {
    batchDirty: true,
    batchAuxDirty: true,
    batchFrame: 0,
    reviewRenderLimit: REVIEW_RENDER_CHUNK,
    formSaveTimer: 0,
  };

  function debounce(fn, delay = 120) {
    let timer = 0;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; fn(...args); }, delay);
    };
  }

  function invalidateBatchView(aux = true) {
    viewPerf.batchDirty = true;
    if (aux) viewPerf.batchAuxDirty = true;
  }

  function batchPaneVisible() {
    return !panel.hidden && ['batch','dispatch'].includes(currentWorkbenchTab());
  }

  function scheduleBatchRender({ aux = false, force = false } = {}) {
    invalidateBatchView(aux);
    if (typeof scheduleWorkspacePersist === 'function') scheduleWorkspacePersist();
    if (!force && !batchPaneVisible()) return;
    if (viewPerf.batchFrame) cancelAnimationFrame(viewPerf.batchFrame);
    viewPerf.batchFrame = requestAnimationFrame(() => {
      viewPerf.batchFrame = 0;
      if (!force && !batchPaneVisible()) return;
      renderPreview({ aux: viewPerf.batchAuxDirty });
    });
  }

  async function detectAccount() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'NMDA_ACCOUNT_INFO' });
      if (result?.ok && result.uid) return Operations?.normalizeEmail?.(result.uid) || String(result.uid).toLowerCase();
    } catch (_) {}
    const text = document.querySelector('#spnUid')?.textContent || '';
    return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9.-])/i)?.[0]?.toLowerCase() || 'default';
  }

  async function ensureOperationStore(force = false) {
    if (!Operations) return operationState;
    const account = await detectAccount();
    if (force || !operationState.loaded || operationState.account !== account) {
      operationState.account = account;
      operationState.store = applyFollowUpPrefs(Operations.createStore(account));
      operationState.loaded = true;
      dispatchRuntime?.clear?.();
    }
    return operationState;
  }

  async function commitRuntimeOperations() {
    // Deliberately no persistence: domain state belongs to the current app session only.
    return operationState.store;
  }


  const dispatchRuntime = new Map();

  function dispatchTasks() {
    const initial = batch?.handoffComplete ? (batch.tasks || []) : [];
    const tasks = Dispatch?.buildQueue ? Dispatch.buildQueue(initial, operationState.loaded ? operationState.store : null) : initial;
    return tasks.map(task => {
      const runtime = dispatchRuntime.get(task.editKey);
      return runtime ? { ...task, ...runtime } : task;
    });
  }

  function dispatchTaskByKey(key) {
    return dispatchTasks().find(task => String(task.editKey) === String(key)) || null;
  }

  async function updateDispatchTask(task, patch = {}) {
    if (!task) return null;
    if (task.dispatchKind === 'follow_up') {
      await ensureOperationStore();
      const result = Operations.updateDerivedTaskDispatch(operationState.store, task._sourceTaskId || task.id, patch);
      operationState.store = result.store;
      await commitRuntimeOperations();
      return Dispatch?.followUpTaskToDispatch?.(result.task, operationState.store) || null;
    }
    const original=(batch.tasks||[]).find(item=>String(item.editKey)===String(task.editKey)) || task;
    setTaskEdit(original, patch);
    return original;
  }

  function setDispatchRuntime(task, patch = {}) {
    if (!task?.editKey) return;
    if (task.dispatchKind === 'follow_up') {
      const current = dispatchRuntime.get(task.editKey) || {};
      dispatchRuntime.set(task.editKey, { ...current, ...patch });
      return;
    }
    const original=(batch.tasks||[]).find(item=>String(item.editKey)===String(task.editKey));
    if(original)Object.assign(original,patch);
  }

  function clearDispatchRuntime(task) {
    if (task?.editKey) dispatchRuntime.delete(task.editKey);
  }

  function renderDispatchSourceSummary(tasks = dispatchTasks()) {
    const el=$('nmda-dispatch-source-summary');if(!el)return;
    const counts=Dispatch?.sourceCounts?.(tasks)||{initial:tasks.filter(t=>t.dispatchKind!=='follow_up').length,followUp:tasks.filter(t=>t.dispatchKind==='follow_up').length,total:tasks.length};
    el.innerHTML=`<span>执行池 <strong>${counts.total}</strong></span><span>初始邮件 <strong>${counts.initial}</strong></span><span>Follow-up <strong>${counts.followUp}</strong></span>`;
  }


  const monitorState = { filter:'all', search:'', syncing:false, lastRenderAt:0, selectedRootIds:new Set() };

  function monitorEls() {
    return {
      stats:$('nmda-monitor-stats'), list:$('nmda-monitor-list'),
      notice:$('nmda-monitor-notice'), syncCopy:$('nmda-monitor-sync-copy'), delay:$('nmda-monitor-delay'), max:$('nmda-monitor-max'), compose:$('nmda-monitor-compose-mode'), historyMonths:$('nmda-monitor-history-months'),
      bulkbar:$('nmda-monitor-bulkbar'), selectVisible:$('nmda-monitor-select-visible'), selectionCopy:$('nmda-monitor-selection-copy'), batchCreate:$('nmda-monitor-batch-create')
    };
  }

  function setMonitorNotice(message='', tone='') {
    const el=$('nmda-monitor-notice'); if(!el)return;
    el.hidden=!message; el.textContent=message||''; if(tone)el.dataset.tone=tone;else delete el.dataset.tone;
  }

  function monitorRecipientText(record) {
    return (record?.recipients || []).map(item => item.name ? `${item.name} <${item.email}>` : item.email).filter(Boolean).join('; ');
  }

  function monitorGroupState(group) {
    const activeTask=[...(group.tasks||[])].reverse().find(task=>!['sent','cancelled'].includes(task.state)) || null;
    const scheduledDraft=(group.scheduledFollowUpDrafts||[])[0] || group.eligibility?.scheduledDraft || null;
    const effectiveReply=[...(group.replies||[])].reverse().find(item=>Operations?.isEffectiveReplyObservation?.(item) || item.kind==='human') || group.humanReply || null;
    const ambiguous=[...(group.replies||[])].reverse().find(item=>item.kind==='ambiguous') || null;
    if(effectiveReply){
      return scheduledDraft
        ? {key:'blocked',tone:'blocked',label:'已回复 · 有定时 Follow-up',detail:`网易草稿箱仍有 ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)} 的定时发送，请先处理该草稿`,observation:effectiveReply,scheduledDraft,activeTask:null,humanManaged:true}
        : {key:'replied',tone:'replied',label:'已回复',detail:'有效回复，需要人工回复；SmartMail 不再生成 Follow-up',observation:effectiveReply,activeTask,humanManaged:group.humanManaged===true};
    }
    if(ambiguous)return scheduledDraft
      ? {key:'blocked',tone:'blocked',label:'回复待判断 · 已有定时 Follow-up',detail:`先判断回复，并留意 ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)} 的网易定时草稿`,observation:ambiguous,scheduledDraft,activeTask:null}
      : {key:'blocked',tone:'blocked',label:'回复待判断',detail:ambiguous.subject||'需要人工确认',observation:ambiguous,activeTask};
    if(activeTask?.state==='blocked')return {key:'blocked',tone:'blocked',label:'跟进已阻断',detail:activeTask.blocker?.kind==='human'?'已收到有效回复，需要人工回复':'需要处理阻断原因',activeTask};
    if(scheduledDraft){
      const sequence=Math.max(1,Number(scheduledDraft.sequence||scheduledDraft.observedSequence||group.eligibility?.sequence||1));
      const maxAttempts=Math.max(0,Number(group.policy?.maxAttempts||0));
      if(sequence>maxAttempts)return {key:'blocked',tone:'blocked',label:`Follow-up #${sequence} 已定时 · 超出上限`,detail:`网易草稿箱 · ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)}；当前规则最多 ${maxAttempts} 次`,scheduledDraft,activeTask:null};
      return {key:'waiting',tone:'scheduled',label:`Follow-up #${sequence} 已定时`,detail:`网易草稿箱 · ${Operations.formatDisplayTime(scheduledDraft.scheduleAt)}`,scheduledDraft,activeTask:null};
    }
    if(activeTask){
      const reviewed=!!activeTask.reviewedAt && Number(activeTask.confirmedVersion)===Number(activeTask.contentVersion);
      const autoReviewed=reviewed && activeTask.reviewDecision==='auto';
      const reviewLabel=autoReviewed?'自动通过':reviewed?'已确认':'需处理';
      const label=`Follow-up #${activeTask.sequence} · ${reviewLabel}`;
      const detail=activeTask.draftPreparedAt?'草稿已创建':activeTask.dispatch?.queued?(activeTask.dispatch.scheduleAt?`已安排 ${Operations.formatDisplayTime(activeTask.dispatch.scheduleAt)}`:(autoReviewed?'模板检查完整，已进入选择与排期':'已进入选择与排期')):(reviewed?'等待进入选择与排期':'模板生成后检测到异常，请到邮件审阅处理');
      return {key:'due',tone:'due',label,detail,activeTask};
    }
    if(group.eligibility?.eligible)return {key:'due',tone:'due',label:`Follow-up #${group.eligibility.sequence} 到期`,detail:'可以创建跟进任务'};
    if(group.eligibility?.reason==='scheduled-follow-up-exists')return {key:'waiting',tone:'scheduled',label:`Follow-up #${group.eligibility.sequence||1} 已定时`,detail:`网易草稿箱 · ${Operations.formatDisplayTime(group.eligibility.scheduledDraft?.scheduleAt||group.eligibility.dueAt)}`,scheduledDraft:group.eligibility.scheduledDraft||null,activeTask:null};
    if(group.eligibility?.reason==='waiting')return {key:'waiting',tone:'',label:'等待中',detail:`到期 ${Operations.formatDisplayTime(group.eligibility.dueAt)}`};
    if(group.eligibility?.reason==='human-managed-conversation')return {key:'replied',tone:'replied',label:'已回复',detail:'有效回复，需要人工回复；SmartMail 不再生成 Follow-up',observation:group.eligibility.blockingObservation||null,humanManaged:true};
    if(group.eligibility?.reason==='follow-up-disabled')return {key:'blocked',tone:'',label:'Follow-up 已暂停',detail:'仍检测回复，只暂停生成新的 Follow-up'};
    if(group.eligibility?.reason==='max-attempts-reached')return {key:'waiting',tone:'',label:'已达跟进上限',detail:`最多 ${group.policy.maxAttempts} 次 Follow-up`};
    if(group.eligibility?.reason==='recipient-guard')return {key:'blocked',tone:'blocked',label:'联系规则阻断',detail:(group.eligibility.guard?.reasons||[]).join('；')||'已暂停联系'};
    return {key:'waiting',tone:'',label:'监测中',detail:group.eligibility?.reason||'等待邮箱事实'};
  }

  function monitorCreatable(group) {
    return !group.viewState?.activeTask && group.eligibility?.eligible === true;
  }

  function monitorSelectedIds() {
    return monitorState.selectedRootIds instanceof Set ? monitorState.selectedRootIds : (monitorState.selectedRootIds=new Set());
  }

  function pruneMonitorSelection(enriched) {
    const valid=new Set((enriched||[]).filter(monitorCreatable).map(item=>item.rootTaskId));
    const selected=monitorSelectedIds();
    [...selected].forEach(id=>{if(!valid.has(id))selected.delete(id);});
    return selected;
  }

  function renderMonitoring() {
    if(!Operations || !operationState.loaded)return;
    const els=monitorEls();
    const groups=Operations.monitoringRoots(operationState.store);
    const enriched=groups.map(group=>({...group,viewState:monitorGroupState(group)}));
    const due=enriched.filter(item=>item.viewState.key==='due').length;
    const replied=enriched.filter(item=>item.viewState.key==='replied' && (Operations?.isEffectiveReplyObservation?.(item.viewState.observation) || item.viewState.observation?.kind==='human')).length;
    const blocked=enriched.filter(item=>item.viewState.key==='blocked').length;
    const waiting=enriched.filter(item=>item.viewState.key==='waiting').length;
    if(els.stats)els.stats.innerHTML=`
      <div class="nmda-monitor-stat"><strong>${groups.length}</strong><span>已发送线程</span></div>
      <div class="nmda-monitor-stat" data-tone="due"><strong>${due}</strong><span>待跟进</span></div>
      <div class="nmda-monitor-stat" data-tone="reply"><strong>${replied}</strong><span>已回复</span></div>
      <div class="nmda-monitor-stat" data-tone="block"><strong>${blocked}</strong><span>需处理</span></div>`;
    const policy=operationState.store.followUpPolicies?.default || Operations.DEFAULT_FOLLOWUP_POLICY;
    if(els.delay && document.activeElement!==els.delay)els.delay.value=String(policy.delayDays ?? 7);
    if(els.max && document.activeElement!==els.max)els.max.value=String(policy.maxAttempts ?? 2);
    if(els.compose && document.activeElement!==els.compose)els.compose.value=policy.composeMode || 'forward';
    const configuredHistoryMonths=readMailboxHistoryMonths();
    if(els.historyMonths && document.activeElement!==els.historyMonths)els.historyMonths.value=String(configuredHistoryMonths);
    const sync=operationState.store.mailboxSync||{};
    if(els.syncCopy){
      const last=sync.lastQuickAt||sync.lastFullAt;
      const draftCoverage=sync.drafts?.read!==undefined?` · 草稿 ${sync.drafts.read}/${sync.drafts.total ?? sync.drafts.read}`:'';
      const inboxCoverage=sync.inbox?.read!==undefined?` · 收件 ${sync.inbox.read}/${sync.inbox.total ?? sync.inbox.read}`:'';
      const coverage=`${draftCoverage}${inboxCoverage}`;
      const historyCopy=configuredHistoryMonths?` · 最近 ${configuredHistoryMonths} 个月`:' · 全部邮件';
      els.syncCopy.textContent=last?`自动同步 ${Operations.formatDisplayTime(last)}${historyCopy}${coverage}`:`等待首次自动同步${historyCopy}；连接网易邮箱后自动读取。`;
    }
    const query=String(monitorState.search||'').toLocaleLowerCase('zh-CN').trim();
    const visible=enriched.filter(item=>{
      if(monitorState.filter!=='all' && item.viewState.key!==monitorState.filter)return false;
      if(!query)return true;
      const hay=[monitorRecipientText(item.lastOutbound),item.lastOutbound?.subject,item.viewState.label,item.viewState.detail].join(' ').toLocaleLowerCase('zh-CN');
      return query.split(/\s+/).every(token=>hay.includes(token));
    });
    const selected=pruneMonitorSelection(enriched);
    const visibleCreatable=visible.filter(monitorCreatable);
    const allCreatable=enriched.filter(monitorCreatable);
    if(els.bulkbar)els.bulkbar.hidden=allCreatable.length===0;
    if(els.selectionCopy)els.selectionCopy.textContent=`已选择 ${selected.size} · 当前可生成 ${visibleCreatable.length}`;
    if(els.batchCreate)els.batchCreate.disabled=selected.size===0;
    if(els.selectVisible){
      const selectedVisible=visibleCreatable.filter(item=>selected.has(item.rootTaskId)).length;
      els.selectVisible.disabled=visibleCreatable.length===0;
      els.selectVisible.checked=visibleCreatable.length>0 && selectedVisible===visibleCreatable.length;
      els.selectVisible.indeterminate=selectedVisible>0 && selectedVisible<visibleCreatable.length;
    }
    if(els.list){
      if(!visible.length){
        els.list.innerHTML=`<div class="nmda-monitor-empty"><div><strong>${groups.length?'当前筛选没有邮件':'尚无已发送邮件'}</strong><small>${groups.length?'切换筛选条件，或清空搜索。':'连接网易邮箱后会自动读取并更新已发送、草稿与回复事实；无需手动触发。'}</small></div></div>`;
      }else{
        els.list.innerHTML=visible.map(group=>{
          const last=group.lastOutbound, st=group.viewState, active=st.activeTask;
          const dueAt=st.scheduledDraft?.scheduleAt || group.eligibility?.dueAt || active?.dueAt || '';
          const displaySubject=st.scheduledDraft?.subject || last.subject || '';
          const enabled=group.policy?.enabled!==false;
          const actions=[];
          if(st.key==='replied' && st.observation){
            const messageId=String(st.observation?.providerMessageId||'').trim();
            actions.push(`<button class="nmda-btn nmda-btn-small nmda-btn-primary" type="button" data-monitor-open-mail="${escapeHtml(messageId)}">前往邮箱</button>`);
          }
          if(!group.humanManaged && active){
            if(active.dispatch?.queued)actions.push(`<button class="nmda-btn nmda-btn-small nmda-btn-primary" type="button" data-monitor-dispatch="${escapeHtml(active.id)}">查看排期</button>`);
            else actions.push(`<button class="nmda-btn nmda-btn-small nmda-btn-primary" type="button" data-monitor-review="${escapeHtml(active.id)}">去审阅</button>`);
            if(!['sent','cancelled'].includes(active.state))actions.push(`<button class="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" data-monitor-cancel-followup="${escapeHtml(active.id)}">取消跟进</button>`);
          }
          else if(!group.humanManaged && group.eligibility?.eligible)actions.push(`<button class="nmda-btn nmda-btn-primary nmda-btn-small" type="button" data-monitor-create="${escapeHtml(group.rootTaskId)}">模板生成</button>`);
          else if(group.eligibility?.reason==='waiting')actions.push(`<button class="nmda-btn nmda-btn-small" type="button" data-monitor-create="${escapeHtml(group.rootTaskId)}" data-manual="1">模板提前生成</button>`);
          if(!st.scheduledDraft && !['human-reply','human-managed-conversation','max-attempts-reached','recipient-guard','scheduled-follow-up-exists'].includes(group.eligibility?.reason)){
            actions.push(`<button class="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" data-monitor-toggle="${escapeHtml(group.rootTaskId)}" data-enabled="${enabled?'1':'0'}">${enabled?'暂停 Follow-up':'恢复 Follow-up'}</button>`);
          }
          let evidence='';
          const ambiguous=(group.replies||[]).filter(obs=>obs.kind==='ambiguous').slice(-1)[0];
          if(ambiguous){
            evidence=`<div class="nmda-monitor-reply-evidence"><span>回复待判断：${escapeHtml(ambiguous.sender||'')} · ${escapeHtml(ambiguous.subject||'(无主题)')}</span><button type="button" data-reply-id="${escapeHtml(ambiguous.id)}" data-reply-disposition="human">计为已回复</button><button type="button" data-reply-id="${escapeHtml(ambiguous.id)}" data-reply-disposition="automatic">自动回复 · 忽略</button><button type="button" data-reply-id="${escapeHtml(ambiguous.id)}" data-reply-disposition="unrelated">与本邮件无关</button></div>`;
          }
          const selectable=monitorCreatable(group);
          const selectionCell=selectable?`<label class="nmda-monitor-row-select" title="选择生成 Follow-up"><input type="checkbox" data-monitor-select="${escapeHtml(group.rootTaskId)}" ${selected.has(group.rootTaskId)?'checked':''}><span class="sr-only">选择此邮件</span></label>`:`<span class="nmda-monitor-row-select-placeholder" aria-hidden="true"></span>`;
          return `<article class="nmda-monitor-row${selectable?' is-selectable':''}" data-tone="${escapeHtml(st.tone||'')}">
            ${selectionCell}
            <div class="nmda-monitor-row-main"><strong>${escapeHtml(monitorRecipientText(last)||'未知收件人')}</strong><small>${escapeHtml(st.scheduledDraft?`草稿箱已识别定时 Follow-up #${Math.max(1,Number(st.scheduledDraft.sequence||st.scheduledDraft.observedSequence||1))}`:(st.key==='replied'?'有效回复 · 待人工回复':(last.kind==='follow_up'?`最近发送 Follow-up #${last.sequence}${last.sequenceSource==='mailbox-history'?' · 邮箱历史识别':''}`:'初始 outreach')))}</small><div class="nmda-monitor-subject" title="${escapeHtml(displaySubject)}">${escapeHtml(displaySubject||'(无主题)')}</div></div>
            <div class="nmda-monitor-row-state"><span class="nmda-monitor-badge" data-tone="${escapeHtml(st.tone||'')}">${escapeHtml(st.label)}</span><small>${escapeHtml(st.detail||'')}</small></div>
            <div class="nmda-monitor-row-time"><div><span>最近发送</span><strong>${escapeHtml(Operations.formatDisplayTime(last.sentAt))}</strong></div><div><span>下一节点</span><strong>${dueAt?escapeHtml(Operations.formatDisplayTime(dueAt)):'—'}</strong></div></div>
            <div class="nmda-monitor-row-actions">${actions.join('')}</div>${evidence}</article>`;
        }).join('');
      }
    }
    monitorState.lastRenderAt=Date.now();
  }

  async function loadMonitoring() {
    await ensureOperationStore();
    renderMonitoring();
  }

  async function syncMonitoringMailbox(mode='quick') {
    if(monitorState.syncing)return null;
    monitorState.syncing=true;
    const quick=$('nmda-monitor-sync'), full=$('nmda-monitor-full-sync'), historySelect=$('nmda-monitor-history-months');
    if(quick)quick.disabled=true;if(full)full.disabled=true;if(historySelect)historySelect.disabled=true;
    const historyMonths=readMailboxHistoryMonths();
    const rangeCopy=historyMonths?`最近 ${historyMonths} 个月`:'全部邮件';
    setMonitorNotice(mode==='full'?`正在重读${rangeCopy}的已发送、草稿和收件箱…`:`正在读取${rangeCopy}的邮箱事实…`);
    try{
      const result=await requestAutoMailboxSync(mode==='full'?'full':'quick',{source:'monitor-manual',force:true});
      const extra=result?`已发送 ${result.outboundRead||0} · 草稿 ${result.draftsRead||0} · 收件 ${result.inboxRead||0} · 关联回复 ${result.repliesAssociated||0}${result.historicalFollowUpsRecognized?` · 识别历史 Follow-up ${result.historicalFollowUpsRecognized}`:''}${result.scheduledFollowUpDraftsRecognized?` · 已定时 Follow-up ${result.scheduledFollowUpDraftsRecognized}`:''}${result.autoMonitored?` · 自动纳入 ${result.autoMonitored}`:''}`:'同步完成';
      setMonitorNotice(`读取完成：${extra}`,'ok');
      renderMonitoring();
      renderReviewPageOverview();
      return result;
    }catch(error){
      setMonitorNotice(`读取失败：${error?.message||String(error)}`,'error');
      throw error;
    }finally{
      monitorState.syncing=false;if(quick)quick.disabled=false;if(full)full.disabled=false;if(historySelect)historySelect.disabled=false;
    }
  }

  function followUpTemplateReasonText(reason, detail='') {
    const code=String(reason||'');
    const labels={
      'template-missing':'未配置 Follow-up 模板',
      'initial-outbound-missing':'找不到 Initial 已发送记录',
      'initial-provider-id-missing':'Initial 已发送记录缺少 provider message id',
      'sent-read-unavailable':'当前 163 页面无法调用邮件读取接口',
      'sent-read-failed':'读取 Initial 已发送正文失败',
      'sent-read-empty':'163 返回的 Initial 邮件详情为空',
      'sent-readhtml-url-unavailable':'网易页面未提供 Initial 正文读取地址',
      'sent-readhtml-failed':'读取 Initial 正文页失败',
      'sent-readhtml-parse-failed':'已读取 Initial 正文页，但未解析出邮件正文',
      'initial-body-missing':'Initial 正文尚未缓存',
      'salutation-and-signature-missing':'Initial 正文中未识别到称呼和署名',
      'salutation-missing':'Initial 正文中未识别到称呼',
      'signature-missing':'Initial 正文中未识别到署名'
    };
    const base=labels[code]||code||'无法生成 Follow-up';
    return detail?`${base}：${detail}`:base;
  }

  async function hydrateInitialContentForRoots(rootTaskIds = []) {
    await ensureOperationStore();
    const roots=[...new Set((rootTaskIds||[]).map(value=>String(value||'').trim()).filter(Boolean))];
    const remote=[];
    for(const rootTaskId of roots){
      let initial=Operations.initialOutboundForRoot(operationState.store,rootTaskId);
      if(!initial)continue;
      if(String(initial.body||'').trim())continue;

      // Prefer the exact Initial task body when this message originated from the
      // current SmartMail batch. Historical mailbox mail falls through to readMessage.
      const local=(batch.tasks||[]).find(task=>String(task.editKey||task.id||'')===rootTaskId && String(task.body||'').trim());
      if(local){
        const updated=Operations.setOutboundContentSnapshot(operationState.store,initial.id,{body:local.body||'',bodyHtml:local.bodyHtml||'',bodyIsHtml:!!local.bodyIsHtml,source:'initial-task'});
        operationState.store=updated.store;
        initial=updated.record;
      }
      if(String(initial?.body||'').trim())continue;

      if(!String(initial?.providerMessageId||'').trim()){
        const failed=Operations.setOutboundContentReadFailure(operationState.store,initial.id,'initial-provider-id-missing','无法定位 163 已发送邮件详情');
        operationState.store=failed.store;
        continue;
      }
      remote.push({rootTaskId,outboundId:initial.id,providerMessageId:String(initial.providerMessageId)});
    }

    if(remote.length){
      const response=await chrome.runtime.sendMessage({type:'NMDA_READ_SENT_DETAILS',messageIds:remote.map(item=>item.providerMessageId)});
      if(!response?.ok)throw new Error(response?.reason||'读取 Initial 邮件正文失败。');
      const byId=new Map((response.details||[]).map(item=>[String(item?.id||''),item]));
      for(const item of remote){
        const detail=byId.get(String(item.providerMessageId));
        if(!detail){
          const failed=Operations.setOutboundContentReadFailure(operationState.store,item.outboundId,'sent-read-failed','读取结果中缺少对应 message id');
          operationState.store=failed.store;
          continue;
        }
        if(!detail.ok){
          const code=String(detail.reasonCode||'sent-read-failed');
          const failed=Operations.setOutboundContentReadFailure(operationState.store,item.outboundId,code,detail.reason||'');
          operationState.store=failed.store;
          continue;
        }
        const updated=Operations.setOutboundContentSnapshot(operationState.store,item.outboundId,{body:detail.body,bodyHtml:detail.bodyHtml||'',isHtml:detail.isHtml===true,source:`sent-message-detail:${detail.bodySource}`});
        operationState.store=updated.store;
      }
    }

    await commitRuntimeOperations();
    return roots.map(rootTaskId=>{
      const rendered=Operations.renderFollowUpTemplate(operationState.store,rootTaskId);
      return {rootTaskId,rendered,reasonText:rendered?.ok?'':followUpTemplateReasonText(rendered?.reason,rendered?.reasonDetail)};
    });
  }

  async function createMonitorFollowUp(rootTaskId, manual=false) {
    await ensureOperationStore();
    const policy=Operations.policyForRoot(operationState.store,rootTaskId);
    if(!String(policy.templateBody||'').trim()){setMonitorNotice('请先在邮件 Preview 的“批量处理”中配置 Follow-up 正文模板。','warn');return;}
    try{
      const hydrated=await hydrateInitialContentForRoots([rootTaskId]);
      const prep=hydrated[0]?.rendered;
      if(!prep?.ok){setMonitorNotice(`无法模板生成：${hydrated[0]?.reasonText||followUpTemplateReasonText(prep?.reason,prep?.reasonDetail)}`,'error');return;}
      const created=Operations.createFollowUpTask(operationState.store,rootTaskId,{manual});
      operationState.store=created.store;
      await commitRuntimeOperations();
      renderMonitoring();
      const autoPassed=created.task.reviewDecision==='auto' && created.task.dispatch?.queued===true;
      setMonitorNotice(autoPassed
        ? `Follow-up #${created.task.sequence} 已按模板生成并自动通过审阅，已进入“选择与排期”。`
        : `Follow-up #${created.task.sequence} 已按模板生成；检测到异常，请到“邮件审阅”处理。`,autoPassed?'ok':'warn');
      renderReviewPageOverview();
    }catch(error){setMonitorNotice(error?.message||String(error),'error');}
  }

  async function batchCreateMonitorFollowUps() {
    await ensureOperationStore();
    const selected=[...monitorSelectedIds()];
    if(!selected.length){setMonitorNotice('请先选择已经到期、可生成 Follow-up 的邮件。','warn');return;}
    const policy=operationState.store.followUpPolicies?.default || Operations.DEFAULT_FOLLOWUP_POLICY;
    if(!String(policy.templateBody||'').trim()){setMonitorNotice('请先在邮件 Preview 的“批量处理”中配置 Follow-up 正文模板，再批量生成。','warn');return;}
    try{
      setMonitorNotice(`正在读取 ${selected.length} 条 Initial 邮件的称呼与署名…`);
      const hydrated=await hydrateInitialContentForRoots(selected);
      const readyRoots=hydrated.filter(item=>item.rendered?.ok).map(item=>item.rootTaskId);
      const hydrateSkipped=hydrated.filter(item=>!item.rendered?.ok).map(item=>({rootTaskId:item.rootTaskId,reason:item.rendered?.reason||'initial-body-missing',reasonText:item.reasonText||followUpTemplateReasonText(item.rendered?.reason,item.rendered?.reasonDetail)}));
      const result=Operations.createFollowUpTasks(operationState.store,readyRoots);
      operationState.store=result.store;
      await commitRuntimeOperations();
      monitorSelectedIds().clear();
      renderMonitoring();
      const createSkipped=(result.skipped||[]).map(item=>({...item,reasonText:followUpTemplateReasonText(item.reason)}));
      const allSkipped=[...hydrateSkipped,...createSkipped];
      const reasons=[...new Set(allSkipped.map(item=>item.reasonText||item.reason).filter(Boolean))];
      const autoPassed=result.created.filter(task=>task.reviewDecision==='auto'&&task.dispatch?.queued===true).length;
      const needsReview=result.created.length-autoPassed;
      const generatedCopy=`已生成 ${result.created.length} 个 Follow-up · ${autoPassed} 自动通过${needsReview?` · ${needsReview} 需处理`:''}`;
      setMonitorNotice(`${generatedCopy}${allSkipped.length?`；${allSkipped.length} 个未生成${reasons.length?`（${reasons.slice(0,4).join('；')}${reasons.length>4?'；…':''}）`:''}`:''}。`,result.created.length?'ok':'warn');
      renderReviewPageOverview();
    }catch(error){setMonitorNotice(`批量生成失败：${error?.message||String(error)}`,'error');}
  }

  async function cancelMonitorFollowUp(taskId) {
    await ensureOperationStore();
    const task=operationState.store.derivedTasks?.[taskId];
    if(!task)return;
    if(!confirm(`取消 Follow-up #${task.sequence}？已创建的网易草稿不会被自动删除。`))return;
    try{
      const result=Operations.setDerivedTaskState(operationState.store,taskId,'cancelled');
      operationState.store=result.store;await commitRuntimeOperations();renderMonitoring();renderReviewPageOverview();setMonitorNotice('本次 Follow-up 已取消；如仍符合规则，可按当前模板重新生成。','ok');
    }catch(error){setMonitorNotice(error?.message||String(error),'error');}
  }


  function bindMonitoringUI() {
    $('nmda-monitor-sync')?.addEventListener('click',()=>void syncMonitoringMailbox('quick'));
    $('nmda-monitor-full-sync')?.addEventListener('click',()=>{const months=readMailboxHistoryMonths();const range=months?`最近 ${months} 个月`:'全部邮件';if(confirm(`将按“${range}”重新读取已发送、草稿和收件箱，并用该范围重建邮箱历史，继续吗？`))void syncMonitoringMailbox('full');});
    $('nmda-monitor-history-months')?.addEventListener('change',event=>{void (async()=>{
      const months=writeMailboxHistoryMonths(event.currentTarget.value);
      mailboxAutoSyncState.lastQuickAt=0;mailboxAutoSyncState.lastHistoryAt=0;mailboxAutoSyncState.lastFullAt=0;
      renderMonitoring();
      setMonitorNotice(months?`读取范围已改为最近 ${months} 个月；正在清理旧范围并重读。`:'读取范围已改为全部邮件；正在重读邮箱历史。');
      try{await syncMonitoringMailbox('full');}catch(_){}
    })();});
    $('nmda-monitor-save-policy')?.addEventListener('click',async()=>{
      await ensureOperationStore();
      const result=Operations.setFollowUpPolicy(operationState.store,'',{delayDays:Number($('nmda-monitor-delay').value||0),maxAttempts:Number($('nmda-monitor-max').value||0),composeMode:$('nmda-monitor-compose-mode').value||'forward'});
      operationState.store=result.store;writeFollowUpPrefs(result.policy);await commitRuntimeOperations();renderMonitoring();setMonitorNotice('Follow-up 规则已保存；模板正文在“邮件审阅”中维护。','ok');
    });
    $('nmda-monitor-open-template')?.addEventListener('click',()=>void openBatchProcessingToFollowUp());
    ui.querySelectorAll('[data-monitor-filter]').forEach(button=>button.addEventListener('click',()=>{monitorState.filter=button.dataset.monitorFilter||'all';ui.querySelectorAll('[data-monitor-filter]').forEach(item=>item.classList.toggle('is-active',item===button));renderMonitoring();}));
    $('nmda-monitor-search')?.addEventListener('input',event=>{monitorState.search=event.currentTarget.value||'';renderMonitoring();});
    $('nmda-monitor-select-visible')?.addEventListener('change',event=>{
      const selected=monitorSelectedIds();
      const groups=Operations.monitoringRoots(operationState.store).map(group=>({...group,viewState:monitorGroupState(group)}));
      const query=String(monitorState.search||'').toLocaleLowerCase('zh-CN').trim();
      const visible=groups.filter(item=>{
        if(monitorState.filter!=='all'&&item.viewState.key!==monitorState.filter)return false;
        if(query){const hay=[monitorRecipientText(item.lastOutbound),item.lastOutbound?.subject,item.viewState.label,item.viewState.detail].join(' ').toLocaleLowerCase('zh-CN');if(!query.split(/\s+/).every(token=>hay.includes(token)))return false;}
        return monitorCreatable(item);
      });
      visible.forEach(item=>event.currentTarget.checked?selected.add(item.rootTaskId):selected.delete(item.rootTaskId));
      renderMonitoring();
    });
    $('nmda-monitor-clear-selection')?.addEventListener('click',()=>{monitorSelectedIds().clear();renderMonitoring();});
    $('nmda-monitor-batch-create')?.addEventListener('click',()=>void batchCreateMonitorFollowUps());
    $('nmda-monitor-list')?.addEventListener('change',event=>{
      const checkbox=event.target.closest('[data-monitor-select]');if(!checkbox)return;
      const selected=monitorSelectedIds();
      checkbox.checked?selected.add(checkbox.dataset.monitorSelect):selected.delete(checkbox.dataset.monitorSelect);
      renderMonitoring();
    });
    $('nmda-monitor-list')?.addEventListener('click',event=>{
      const openMail=event.target.closest('[data-monitor-open-mail]');if(openMail){void (async()=>{const messageId=String(openMail.dataset.monitorOpenMail||'').trim();const result=messageId?await chrome.runtime.sendMessage({type:'NMDA_OPEN_MAIL_MESSAGE',messageId,fid:1}):await chrome.runtime.sendMessage({type:'NMDA_OPEN_MAIL',focus:true});if(!result?.ok)setMonitorNotice(result?.reason||'无法打开网易邮箱中的回复，请先确认邮箱已登录。','error');})();return;}
      const create=event.target.closest('[data-monitor-create]');if(create){void createMonitorFollowUp(create.dataset.monitorCreate,create.dataset.manual==='1');return;}
      const dispatch=event.target.closest('[data-monitor-dispatch]');if(dispatch){setWorkbenchTab('dispatch');history.replaceState(null,'','#dispatch');scheduleBatchRender({aux:false,force:true});return;}
      const review=event.target.closest('[data-monitor-review]');if(review){void openReviewWorkspace({pendingOnly:false,taskKey:`fu-review:${review.dataset.monitorReview}`});return;}
      const cancelFollowUp=event.target.closest('[data-monitor-cancel-followup]');if(cancelFollowUp){void cancelMonitorFollowUp(cancelFollowUp.dataset.monitorCancelFollowup);return;}
      const toggle=event.target.closest('[data-monitor-toggle]');if(toggle){void (async()=>{await ensureOperationStore();const enabled=toggle.dataset.enabled!=='1';const result=Operations.setFollowUpPolicy(operationState.store,toggle.dataset.monitorToggle,{enabled});operationState.store=result.store;await commitRuntimeOperations();renderMonitoring();setMonitorNotice(enabled?'已恢复 Follow-up；邮件检测始终保持在读取范围内。':'已暂停新的 Follow-up；邮件检测仍会继续记录回复事实。','ok');})();return;}
      const disposition=event.target.closest('[data-reply-disposition]');if(disposition){void (async()=>{await ensureOperationStore();const result=Operations.setReplyObservationDisposition(operationState.store,disposition.dataset.replyId,disposition.dataset.replyDisposition);operationState.store=result.store;await commitRuntimeOperations();renderMonitoring();renderReviewPageOverview();setMonitorNotice('回复状态已更新，并重新计算 Follow-up。','ok');})();}
    });
  }

  bindMonitoringUI();

  function taskBusinessTags(task) {
    return Operations?.parseTags?.(task?.tags || []) || [];
  }

  function outreachPolicyGateForRecipients(raw) {
    if (!Operations || !operationState.loaded) return { blocked: false, modes: [], reasons: [] };
    return Operations.guardForRecipients(operationState.store, raw);
  }

  function tagsText(tags) {
    return (Operations?.parseTags?.(tags) || []).join('；');
  }

  function currentWorkbenchTab() {
    return ui.querySelector('.nmda-tab.is-active')?.dataset.tab || 'batch';
  }

  function processStepAccess(step, options={}) {
    const n=Math.min(2,Math.max(1,Number(step||1)));
    const from=Math.min(2,Math.max(1,Number(options.fromStep ?? batch.uiStep ?? 1)));
    const hasSource=!!batch.dataset;
    const contextPending=hasSource && typeof supplementPreflightNeedsDecision==='function' && supplementPreflightNeedsDecision();
    const attachmentIssues=hasSource && typeof importAttachmentStats==='function' ? Number(importAttachmentStats().issues||0) : 0;
    const blockers=hasSource && Array.isArray(batch.tasks) ? batch.tasks.filter(task=>typeof taskHasPrePlanningBlocker==='function' && taskHasPrePlanningBlocker(task)).length : 0;
    let ready=true, reason='';
    if(n===2 && !hasSource){ready=false;reason='尚未导入资料。';}
    return {allowed:true,ready,reason,hasSource,contextPending,attachmentIssues,blockers,fromStep:from,direction:n<from?'backward':n>from?'forward':'current'};
  }

  function renderProcessGuide() {
    const guides = ui.querySelectorAll('.nmda-process-guide');
    if (!guides.length || typeof batch === 'undefined') return;
    const hasSource = !!batch.dataset;
    const attachmentIssues=hasSource && typeof importAttachmentStats==='function' ? Number(importAttachmentStats().issues||0) : 0;
    const duplicateIssues=hasSource && typeof unresolvedDuplicateGroupCount==='function' ? Number(unresolvedDuplicateGroupCount()||0) : 0;
    let review = 0, other = 0;
    for (const task of (batch.tasks || [])) {
      if (hasSource && typeof taskNeedsImportReview === 'function' && taskNeedsImportReview(task)) review++;
      if (hasSource && typeof taskIssueState === 'function' && taskIssueState(task).other.length) other++;

    }
    const blockers=review+other;
    const contextPending=hasSource && typeof supplementPreflightNeedsDecision==='function' && supplementPreflightNeedsDecision();
    const viewing=Math.min(2,Math.max(1,Number(batch.uiStep||1)));
    guides.forEach(guide => {
      guide.dataset.currentStep = String(viewing);
      const title = guide.querySelector('.nmda-process-guide-title strong');
      if (title) title.textContent = `步骤 ${viewing} / 2`;
      const workbench=guide.closest('.nmda-bulk-workbench');
      if(workbench)workbench.dataset.viewStep=String(viewing);
      guide.querySelectorAll('[data-flow-step]').forEach(button => {
        const step = Number(button.dataset.flowStep || 0);
        const access=processStepAccess(step);
        let state='ready';
        if(step===1) state=hasSource&&!contextPending&&!attachmentIssues&&!duplicateIssues?'done':'ready';
        else if(step===2) state=hasSource&&!duplicateIssues&&!blockers?'done':'ready';
        button.dataset.state=state;
        button.classList.toggle('is-viewing',step===viewing);
        button.setAttribute('aria-current',step===viewing?'step':'false');
        button.disabled=false;
        button.setAttribute('aria-disabled','false');
        if(access.reason)button.title=`可查看 · ${access.reason}`;else button.removeAttribute('title');
        const small=button.querySelector('small');
        if(!small) return;
        if(step===1) small.textContent=!hasSource?'先导入资料':contextPending?'完成导入核对':attachmentIssues?`附件待处理 ${attachmentIssues} 项`:duplicateIssues?`查重待处理 ${duplicateIssues} 组`:'导入准备已完成';
        if(step===2) small.textContent=!hasSource?'添加资料后审阅':contextPending||attachmentIssues?'先完成导入准备':duplicateIssues?'先完成导入查重':blockers?`${blockers} 项待审阅`:'审阅完成';
      });
    });
    syncStageSurfaceVisibility(viewing);
  }

  function syncBatchStageHash(step) {
    const target='#batch';
    if(location.hash!==target)history.replaceState(null,'',target);
  }

  function syncStageSurfaceVisibility(step=batch.uiStep) {
    const n=Math.min(2,Math.max(1,Number(step||1)));
    const workbench=ui.querySelector('.nmda-bulk-workbench');
    const ingest=ui.querySelector('.nmda-ingest-workspace-v2');
    if(workbench)workbench.dataset.viewStep=String(n);
    if(ingest)ingest.hidden=false;
  }

  async function goToProcessStep(step, options={}) {
    const n = Math.min(2,Math.max(1,Number(step || 1)));
    setWorkbenchTab('batch');
    closeScheduleModal({restoreFocus:false});
    closeRosterPlannerView({restoreFocus:false});
    if(n!==1){
      if(batch.supplementPreflightOpen){batch.supplementPreflightOpen=false;renderSupplementPreflight();}
      if(batch.attachmentManagerOpen)closeAttachmentManager();
    }
    if(n!==2 && reviewInlineEl && !reviewInlineEl.hidden){
      if(batch.reviewEditingKey){setImportStatus('请先保存或取消当前邮件的编辑，再离开邮件审阅。','warn');return false;}
      hideReviewWorkspaceWithoutStash();
    }
    if(n===2 && unresolvedDuplicateGroupCount()>0){
      batch.uiStep=1;
      renderProcessGuide();
      renderRosterAudit();
      setImportStatus(`导入查重还有 ${unresolvedDuplicateGroupCount()} 组未处理；先决定保留版本，再进入邮件审阅。`,'warn');
      requestAnimationFrame(()=>$('nmda-roster-audit-card')?.scrollIntoView?.({block:'nearest',behavior:'smooth'}));
      return false;
    }
    batch.uiStep=1;
    renderProcessGuide();
    if(options.syncHash!==false)syncBatchStageHash(1);
    if(n===1){scheduleBatchRender({aux:true,force:true});return true;}
    return !!openReviewWorkspace({pendingOnly:false,fromStageNav:true});
  }

  function setWorkbenchTab(name) {
    const current = currentWorkbenchTab();
    if(name!=='dispatch'&&batch?.rosterPlannerOpen)closeRosterPlannerView({restoreFocus:false});
    if (current !== name) {
      ui.querySelectorAll('.nmda-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
      ui.querySelectorAll('.nmda-tabpane').forEach(p => { p.hidden = p.dataset.pane !== name; });
      ui.querySelectorAll('[data-page-head]').forEach(head => { head.hidden = head.dataset.pageHead !== name; });
    }
    if (name === 'batch' && viewPerf.batchDirty) scheduleBatchRender();
    if (name === 'review') requestAnimationFrame(() => { if(reviewInlineEl)reviewInlineEl.hidden=false; void (async()=>{ await ensureOperationStore(); renderReviewPageOverview(); })(); });
    if (name === 'dispatch') requestAnimationFrame(() => { void (async()=>{ await ensureOperationStore(); scheduleBatchRender({aux:false,force:true}); })(); });
    if (name === 'monitor') requestAnimationFrame(() => { void loadMonitoring(); });
    if(name==='batch' && batch?.dataset && !mailboxDedupeSnapshotAvailable()) scheduleMailboxAutoSync('history',{source:'batch'});
    else scheduleMailboxAutoSync('quick',{source:`tab:${name}`});
  }

  launcher.addEventListener('click', () => {
    setPanelOpen(panel.hidden);
    if (!panel.hidden) {
      const name = currentWorkbenchTab();
      if ((name === 'batch' || name === 'dispatch') && viewPerf.batchDirty) scheduleBatchRender({aux:name==='batch'});
    }
  });
  $('nmda-close').addEventListener('click', () => { setPanelOpen(false); });
  $('nmda-expand').addEventListener('click', () => {
    panel.classList.toggle('is-maximized');
    $('nmda-expand').textContent = panel.classList.contains('is-maximized') ? '◱' : '⛶';
    $('nmda-expand').title = panel.classList.contains('is-maximized') ? '还原工作台' : '全屏工作台';
  });
  ui.querySelectorAll('.nmda-tab').forEach(tab => tab.addEventListener('click', () => {
    const name=tab.dataset.tab;
    if(name==='review'){void openReviewWorkspace({pendingOnly:false,fromStageNav:true});return;}
    setWorkbenchTab(name);
    history.replaceState(null,'',`#${name}`);
  }));
  ui.querySelectorAll('[data-flow-step]').forEach(button => button.addEventListener('click', () => { void goToProcessStep(button.dataset.flowStep); }));

  const batch = {
    dataset: null, collectionIndex: 0, collectionConfigs: new Map(), detection: null, mapping: {}, tasks: [],
    directoryFiles: [], taskFiles: [], routedAttachmentFiles: [], fileIndex: Importer?.buildFileIndex?.([]),
    attachmentOverrides: new Map(), attachmentPolicies: new Map(), attachmentTargetEditing:'', attachmentTargetSearch:'', taskEdits: new Map(), running: false, stopRequested: false, pauseEveryTime: false,
    importMeta: null,
    sessionId: 0, importBusy: false, schedulePlan: null, existingScheduleAnchors: [], existingScheduleReadAt: '', existingScheduleStatus: 'idle', existingScheduleError: '',
    scheduleRules: { ...(Scheduler?.DEFAULT_RULES || { maxPerGroupPerRound:1, weekdays:[4], localTime:'07:30', timeZone:'system', preserveExisting:true, includeMailboxScheduled:true, intraRoundMinutes:10, skipHolidays:true }), startDate: Scheduler?.defaultStartDate?.(new Date(),'system') || '', localTime: Scheduler?.defaultLocalTime?.() || '07:30' },
    roster: emptyRosterState(), rosterPlanner:RosterPlanner?.createState?.()||{version:1,sourceKey:'',intents:{}}, rosterPlannerOpen:false, duplicateAudit:null,
    handoffComplete: false, autoAdvancing: false, reviewFilter: 'all', reviewSearch: '', reviewSelected: new Set(), reviewSurface:'board', reviewPreviewKey:'', reviewEditingKey:'', duplicateSelections: new Map(), attachmentAttentionShown: false, rosterPromptChoice:'idle', attachmentPromptDeferred:false, attachmentPrepChoice:'idle', supplementPreflightDone:false, supplementPreflightOpen:false, preflightView:'files', supportView:'roster', attachmentManagerOpen:false, uiStep:1, planningView:'mails', reviewReturnStep:2, sourceInspectName:'', preflightFolderPath:'', preflightSearch:'', preflightReviewOnly:false, preflightPurposeFilter:'', ignoredAttachmentIdentities:new Set(), formatGovernanceRules:[], formatGovernanceDraftRules:[]
  };



  const WORKSPACE_STORAGE_KEY = 'nmda.workspace.v2';
  let workspaceSaveTimer = 0;
  let workspaceRestoring = false;

  function storagePlainClone(value) {
    try {
      return JSON.parse(JSON.stringify(value, (key, item) => {
        if (typeof File !== 'undefined' && item instanceof File) {
          return { __nmdaFileMeta:true, name:String(item.name||''), size:Number(item.size||0), type:String(item.type||''), lastModified:Number(item.lastModified||0), _nmdaPath:String(item._nmdaPath||item.webkitRelativePath||item.name||'') };
        }
        if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined;
        if (item instanceof Map) return { __nmdaMap:true, entries:[...item.entries()] };
        if (item instanceof Set) return { __nmdaSet:true, values:[...item.values()] };
        return item;
      }));
    } catch (error) {
      console.warn(`[${APP}] workspace clone failed`, error);
      return null;
    }
  }

  function sourceFileMeta(file) {
    return {
      name:String(file?.name||sourceFileName(file)||''),
      size:Number(file?.size||0),
      type:String(file?.type||''),
      lastModified:Number(file?.lastModified||0),
      _nmdaPath:String(file?._nmdaPath||file?.webkitRelativePath||file?.name||'')
    };
  }

  function serializableDataset(dataset) {
    if (!dataset) return null;
    const sets = storagePlainClone(dataset.recordSets || dataset.sheets || []) || [];
    const meta = storagePlainClone(dataset.meta || {}) || {};
    if (meta && Array.isArray(meta.containerFiles)) meta.containerFiles = meta.containerFiles.map(sourceFileMeta);
    return {
      ...storagePlainClone(dataset),
      recordSets:sets,
      sheets:sets,
      sourceFiles:(dataset.sourceFiles||[]).map(sourceFileMeta),
      // Attachment bytes are intentionally not persisted. After reload the parsed mail
      // survives, but files must be reselected before execution.
      embeddedFiles:[],
      meta
    };
  }

  function workspaceSnapshot() {
    if (!batch.dataset) return null;
    return {
      version:2,
      savedAt:new Date().toISOString(),
      dataset:serializableDataset(batch.dataset),
      collectionIndex:Number(batch.collectionIndex||0),
      collectionConfigs:storagePlainClone([...batch.collectionConfigs.entries()]) || [],
      taskEdits:storagePlainClone([...batch.taskEdits.entries()]) || [],
      formatGovernanceRules:storagePlainClone(batch.formatGovernanceRules||[]) || [],
      formatGovernanceDraftRules:storagePlainClone(batch.formatGovernanceDraftRules||[]) || [],
      reviewSelected:[...batch.reviewSelected],
      duplicateSelections:storagePlainClone([...batch.duplicateSelections.entries()]) || [],
      handoffComplete:!!batch.handoffComplete,
      reviewFilter:String(batch.reviewFilter||'all'),
      reviewSearch:String(batch.reviewSearch||''),
      roster:storagePlainClone(batch.roster),
      rosterPlanner:storagePlainClone(batch.rosterPlanner),
      supplementPreflightDone:!!batch.supplementPreflightDone,
      rosterPromptChoice:String(batch.rosterPromptChoice||'idle'),
      attachmentPrepChoice:String(batch.attachmentPrepChoice||'idle'),
      scheduleRules:storagePlainClone(batch.scheduleRules),
      planningView:String(batch.planningView||'mails')
    };
  }

  async function persistWorkspaceNow() {
    if (workspaceRestoring || !chrome?.storage?.local) return;
    const snapshot = workspaceSnapshot();
    try {
      if (!snapshot) await chrome.storage.local.remove(WORKSPACE_STORAGE_KEY);
      else await chrome.storage.local.set({ [WORKSPACE_STORAGE_KEY]:snapshot });
    } catch (error) {
      console.warn(`[${APP}] workspace persistence failed`, error);
    }
  }

  function scheduleWorkspacePersist() {
    if (workspaceRestoring) return;
    if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => { workspaceSaveTimer=0; void persistWorkspaceNow(); }, 220);
  }

  async function restoreWorkspaceFromStorage() {
    if (!chrome?.storage?.local) return false;
    workspaceRestoring = true;
    try {
      const result = await chrome.storage.local.get(WORKSPACE_STORAGE_KEY);
      const saved = result?.[WORKSPACE_STORAGE_KEY];
      if (!saved?.dataset?.recordSets?.length) return false;
      const sets = saved.dataset.recordSets || [];
      batch.dataset = { ...saved.dataset, recordSets:sets, sheets:sets, embeddedFiles:[] };
      batch.importMeta = batch.dataset.meta || null;
      batch.collectionIndex = Math.max(0, Math.min(Number(saved.collectionIndex||0), Math.max(0,sets.length-1)));
      batch.collectionConfigs = new Map(Array.isArray(saved.collectionConfigs)?saved.collectionConfigs:[]);
      batch.taskEdits = new Map(Array.isArray(saved.taskEdits)?saved.taskEdits:[]);
      batch.formatGovernanceRules = Array.isArray(saved.formatGovernanceRules)?saved.formatGovernanceRules:[];
      batch.formatGovernanceDraftRules = Array.isArray(saved.formatGovernanceDraftRules)?saved.formatGovernanceDraftRules:[];
      batch.reviewSelected = new Set(Array.isArray(saved.reviewSelected)?saved.reviewSelected:[]);
      batch.duplicateSelections = new Map(Array.isArray(saved.duplicateSelections)?saved.duplicateSelections:[]);
      batch.handoffComplete = !!saved.handoffComplete;
      batch.reviewFilter = String(saved.reviewFilter||'all');
      batch.reviewSearch = String(saved.reviewSearch||'');
      batch.roster = saved.roster ? { ...emptyRosterState(), ...saved.roster } : emptyRosterState();
      batch.rosterPlanner = RosterPlanner?.createState?.(saved.rosterPlanner)||{version:1,sourceKey:'',intents:{}};
      // Normalize persisted roster fragments before task rebuilding so historical multi-import
      // workspaces get the same stable identity keys and dedupe behavior as new imports.
      syncRosterParts();
      batch.supplementPreflightDone = !!saved.supplementPreflightDone;
      batch.rosterPromptChoice = String(saved.rosterPromptChoice||'pending');
      batch.attachmentPrepChoice = 'pending'; // file bytes never survive a reload
      batch.scheduleRules = saved.scheduleRules ? { ...freshScheduleRules(), ...saved.scheduleRules } : freshScheduleRules();
      batch.planningView = String(saved.planningView||'mails');
      batch.directoryFiles=[]; batch.taskFiles=[]; batch.routedAttachmentFiles=[];
      batch.attachmentOverrides.clear(); batch.attachmentPolicies=new Map(); batch.fileIndex=Importer.buildFileIndex([]);
      sets.forEach((_,index)=>{ if(!batch.collectionConfigs.has(index)) ensureCollectionConfig(index,{reset:true}); });
      configureCollection(batch.collectionIndex,false);
      renderSourceInventory();
      renderImportLifecycleState();
      renderAttachmentAssetViews();
      renderSupplementPreflight();
      syncScheduleRuleControls();
      setImportStatus(`已恢复上次工作集 · ${batch.tasks.length} 封邮件。可继续添加文件、文件夹、名单或附件。`,'ok');
      if ((batch.tasks||[]).some(task => (task.attachmentRefs||[]).length)) {
        setBatchStatus('已恢复邮件与审阅状态；本地附件文件不会永久存储，请在执行前重新选择附件。','warn');
      }
      if(reviewQueueEl) reviewQueueEl.scrollTop=0;
      return true;
    } catch (error) {
      console.warn(`[${APP}] workspace restore failed`, error);
      return false;
    } finally {
      workspaceRestoring=false;
    }
  }

  function fastRowsFingerprint(rows=[]) {
    let hash=2166136261;
    const text=JSON.stringify(rows||[]);
    for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(36);
  }

  function recordSetImportKey(set={}) {
    const meta=set.meta||{};
    return [String(set.source||''),String(set.name||''),String(meta.format||''),String((set.rows||[]).length),fastRowsFingerprint(set.rows||[])].join('|');
  }

  function mergeImportedDatasets(existing,incoming) {
    if(!existing)return incoming;
    if(!incoming)return existing;
    const oldSets=[...(existing.recordSets||existing.sheets||[])];
    const seen=new Set(oldSets.map(recordSetImportKey));
    const added=[];
    for(const set of (incoming.recordSets||incoming.sheets||[])){
      const key=recordSetImportKey(set);
      if(seen.has(key))continue;
      seen.add(key);added.push(set);
    }
    const sets=[...oldSets,...added];
    const sources=uniqueFiles([...(existing.sourceFiles||[]),...(incoming.sourceFiles||[])]);
    const embedded=uniqueFiles([...(existing.embeddedFiles||[]),...(incoming.embeddedFiles||[])]);
    const warnings=[...new Set([...(existing.warnings||[]),...(incoming.warnings||[])])];
    const oldMeta=existing.meta||{},newMeta=incoming.meta||{};
    const containerFiles=uniqueFiles([...(oldMeta.containerFiles||[]),...(newMeta.containerFiles||[])]);
    return {
      ...existing,
      recordSets:sets,
      sheets:sets,
      sourceFiles:sources,
      embeddedFiles:embedded,
      warnings,
      format:String(existing.format||'')===String(incoming.format||'')?existing.format:'multi',
      meta:{...oldMeta,...newMeta,containerFiles,duplicateSourceCount:Number(oldMeta.duplicateSourceCount||0)+Number(newMeta.duplicateSourceCount||0),incrementalImport:true,lastImportAt:new Date().toISOString()}
    };
  }

  const importFileEl = $('nmda-import-file'), importDirEl = $('nmda-import-dir'), rosterFileEl = $('nmda-roster-file');
  const pasteSourceEl = $('nmda-paste-source');
  const reviewQueueEl = $('nmda-review-queue'), reviewPreviewRailEl=$('nmda-review-preview-rail'), reviewPreviewRailListEl=$('nmda-review-preview-rail-list'), reviewPreviewRailCountEl=$('nmda-review-preview-rail-count'), reviewProgressEl = $('nmda-review-progress');
  const reviewNavCountEl=$('nmda-review-nav-count'), reviewInlineEl=$('nmda-inline-review'), reviewPageEmptyEl=$('nmda-review-page-empty');
  const reviewWorkspaceTitleEl=$('nmda-review-workspace-title'), reviewWorkspaceDescEl=$('nmda-review-workspace-desc');
  const reviewFilterEl=$('nmda-review-filter'), reviewSearchEl=$('nmda-review-search');
  const reviewBatchbarEl=$('nmda-review-batchbar'), reviewSelectedCountEl=$('nmda-review-selected-count');
  const formatGovernanceEntryEl=$('nmda-review-format-governance'), formatGovernanceEntryCountEl=$('nmda-preview-format-drift-count'), formatGovernanceEl=$('nmda-format-governance'), formatGovernancePhraseEl=$('nmda-format-governance-phrase'), formatGovernanceCaseEl=$('nmda-format-governance-case'), formatGovernanceResultEl=$('nmda-format-governance-result'), formatGovernanceListEl=$('nmda-format-governance-list'), formatGovernanceApplyEl=$('nmda-format-governance-apply'), formatGovernanceSuggestionsEl=$('nmda-format-governance-suggestions'), formatGovernanceQueueEl=$('nmda-format-governance-queue'), formatGovernanceAddEl=$('nmda-format-governance-add'), formatGovernanceHistoryEl=$('nmda-format-governance-history');
  const batchStandardSubjectCountEl=$('nmda-batch-standard-subject-count'), batchStandardFormatCountEl=$('nmda-batch-standard-format-count'), batchStandardSubjectBadgeEl=$('nmda-batch-standard-subject-badge'), batchStandardSubjectInputEl=$('nmda-batch-standard-subject-input'), batchStandardSubjectSuggestionEl=$('nmda-batch-standard-subject-suggestion'), batchStandardSubjectResultEl=$('nmda-batch-standard-subject-result'), batchStandardPlanSummaryEl=$('nmda-batch-standard-plan-summary');
  const batchFollowUpCountEl=$('nmda-batch-followup-count'), batchFollowUpSummaryEl=$('nmda-batch-followup-summary'), batchFollowUpBadgeEl=$('nmda-batch-followup-badge'), batchFollowUpTemplateEl=$('nmda-batch-followup-template'), batchFollowUpSyncEl=$('nmda-batch-followup-sync'), batchFollowUpSyncCountEl=$('nmda-batch-followup-sync-count'), batchFollowUpResultEl=$('nmda-batch-followup-result');
  const batchFollowUpCardEl=$('nmda-batch-followup-template-card'), batchFollowUpOverviewEl=ui.querySelector('[data-standard-summary="followup"]'), batchStandardsEl=$('nmda-format-governance'), batchStandardsDescEl=$('nmda-batch-standards-desc');
  const duplicateDecisionEl=$('nmda-duplicate-decision'), duplicateDecisionTitleEl=$('nmda-duplicate-decision-title'), duplicateDecisionCopyEl=$('nmda-duplicate-decision-copy'), duplicateDecisionKindEl=$('nmda-duplicate-decision-kind'), duplicateCandidatesEl=$('nmda-duplicate-candidates'), duplicateDecisionHintEl=$('nmda-duplicate-decision-hint'), duplicateKeepSelectedEl=$('nmda-duplicate-keep-selected'), duplicateKeepAllEl=$('nmda-duplicate-keep-all');
  const draftHistoryFilterEl=$('nmda-draft-history-filter'), draftHistoryCountEl=$('nmda-draft-history-count'), draftHistoryListEl=$('nmda-draft-history-list'), draftHistoryHintEl=$('nmda-draft-history-hint'), draftHistoryExcludeEl=$('nmda-draft-history-exclude'), draftHistoryKeepEl=$('nmda-draft-history-keep');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files');
  const draftImportEl = $('nmda-import-drafts'), preSendMatchFilesEl = $('nmda-pre-send-match-files'), preSendSharedFilesEl = $('nmda-pre-send-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchSummaryEl = $('nmda-batch-summary'), batchStatusEl = $('nmda-batch-status'), importStatusEl = $('nmda-import-status');
  const planningOverviewEl = $('nmda-planning-overview');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop'), batchPauseEveryTimeEl = $('nmda-pause-every-time');
  const scheduleStartDateEl = $('nmda-rule-start-date'), scheduleLocalTimeEl = $('nmda-rule-local-time'), scheduleTimeZoneEl = $('nmda-rule-time-zone'), scheduleWeekdayEls = [...ui.querySelectorAll('[data-schedule-weekday]')], scheduleSkipStartEl = $('nmda-rule-skip-start'), scheduleSkipEndEl = $('nmda-rule-skip-end'), scheduleMaxSchoolEl = $('nmda-rule-max-school'), schedulePreserveEl = $('nmda-rule-preserve-existing'), scheduleMailboxExistingEl = $('nmda-rule-include-mailbox-scheduled'), scheduleHolidayEl = $('nmda-rule-skip-holidays');
  const scheduleApplyEl = $('nmda-apply-schedule'), scheduleClearEl = $('nmda-clear-auto-schedule'), scheduleSummaryEl = $('nmda-schedule-summary'), scheduleRulePreviewEl = $('nmda-schedule-rule-preview'), schedulerCardEl = $('nmda-scheduler-card'), schedulerToggleLabelEl = $('nmda-scheduler-toggle-label');
  const rosterPlannerViewEl=$('nmda-roster-planner-view'), rosterPlannerSourceEl=$('nmda-roster-planner-source'), rosterPlannerSummaryEl=$('nmda-roster-planner-summary'), rosterVisualGroupsEl=$('nmda-roster-visual-groups'), rosterSheetViewportEl=$('nmda-roster-sheet-viewport'), rosterSheetTableEl=$('nmda-roster-sheet-table'), rosterSelectionMiniEl=$('nmda-roster-selection-mini'), rosterColumnFocusEl=$('nmda-roster-column-focus'), rosterColumnToggleEl=$('nmda-roster-column-toggle'), rosterSelectionLabelEl=$('nmda-roster-selection-label'), rosterSelectionDetailEl=$('nmda-roster-selection-detail'), rosterActiveBatchEl=$('nmda-roster-active-batch'), rosterActiveBatchLabelEl=$('nmda-roster-active-batch-label'), rosterBatchAddEl=$('nmda-roster-batch-add'), rosterBatchCreateEl=$('nmda-roster-batch-create'), rosterBatchClearEl=$('nmda-roster-batch-clear'), rosterIntentSummaryEl=$('nmda-roster-intent-summary');
  const batchSearchEl = $('nmda-batch-search');
  const batchTagIncludeEl = $('nmda-batch-tag-include');
  const importBusyBadgeEl = $('nmda-import-busy-badge'), resetImportEl = $('nmda-reset-import');
  function isCurrentBatchSession(token) { return Number(token) === Number(batch.sessionId); }

  const SCHEDULE_PREFS_KEY = 'nmda.schedule.rules.v1';
  function loadScheduleRulePrefs() {
    try { const raw=JSON.parse(localStorage.getItem(SCHEDULE_PREFS_KEY)||'{}'); return Scheduler?.normalizeRules?.({...raw,startAt:''}) || raw; }
    catch (_) { return {}; }
  }
  function freshScheduleRules() {
    const prefs=loadScheduleRulePrefs();
    const timeZone=prefs.timeZone||'system';
    return Scheduler?.normalizeRules?.({
      ...(Scheduler?.DEFAULT_RULES || {maxPerGroupPerRound:1,weekdays:[4],localTime:'07:30',timeZone:'system',preserveExisting:true,includeMailboxScheduled:true,intraRoundMinutes:10,skipHolidays:true}),
      ...prefs,
      startDate:prefs.startDate||Scheduler?.defaultStartDate?.(new Date(),timeZone)||'',
      localTime:prefs.localTime||Scheduler?.defaultLocalTime?.()||'07:30'
    }) || {...prefs,startDate:prefs.startDate||'',localTime:prefs.localTime||'07:30',timeZone,weekdays:Array.isArray(prefs.weekdays)&&prefs.weekdays.length?prefs.weekdays:[4]};
  }
  function saveScheduleRulePrefs(rules) {
    try { localStorage.setItem(SCHEDULE_PREFS_KEY, JSON.stringify({maxPerGroupPerRound:rules.maxPerGroupPerRound,weekdays:rules.weekdays,localTime:rules.localTime,timeZone:rules.timeZone,skipStart:rules.skipStart||'',skipEnd:rules.skipEnd||'',preserveExisting:rules.preserveExisting,includeMailboxScheduled:rules.includeMailboxScheduled!==false,intraRoundMinutes:rules.intraRoundMinutes||10,skipHolidays:rules.skipHolidays!==false})); } catch (_) {}
  }
  function syncScheduleRuleControls() {
    if(!batch.scheduleRules) batch.scheduleRules=freshScheduleRules();
    const rules=Scheduler?.normalizeRules?.(batch.scheduleRules)||batch.scheduleRules;
    batch.scheduleRules=rules;
    if(scheduleStartDateEl && document.activeElement!==scheduleStartDateEl) scheduleStartDateEl.value=rules.startDate||'';
    if(scheduleLocalTimeEl && document.activeElement!==scheduleLocalTimeEl) scheduleLocalTimeEl.value=rules.localTime||'07:30';
    if(scheduleTimeZoneEl && document.activeElement!==scheduleTimeZoneEl) scheduleTimeZoneEl.value=rules.timeZone||'system';
    if(scheduleMaxSchoolEl && document.activeElement!==scheduleMaxSchoolEl) scheduleMaxSchoolEl.value=String(rules.maxPerGroupPerRound||1);
    for(const el of scheduleWeekdayEls) el.checked=(rules.weekdays||[]).includes(Number(el.value));
    if(scheduleSkipStartEl && document.activeElement!==scheduleSkipStartEl) scheduleSkipStartEl.value=rules.skipStart||'';
    if(scheduleSkipEndEl && document.activeElement!==scheduleSkipEndEl) scheduleSkipEndEl.value=rules.skipEnd||'';
    if(schedulePreserveEl) schedulePreserveEl.checked=rules.preserveExisting!==false;
    if(scheduleMailboxExistingEl) scheduleMailboxExistingEl.checked=rules.includeMailboxScheduled!==false;
    if(scheduleHolidayEl) scheduleHolidayEl.checked=rules.skipHolidays!==false;
  }
  function readScheduleRuleControls() {
    const weekdays=scheduleWeekdayEls.filter(el=>el.checked).map(el=>Number(el.value));
    if(!weekdays.length){
      const fallback=scheduleWeekdayEls.find(el=>Number(el.value)===4)||scheduleWeekdayEls[0];if(fallback)fallback.checked=true;weekdays.push(Number(fallback?.value||4));
    }
    const rules=Scheduler?.normalizeRules?.({
      startDate:scheduleStartDateEl?.value||batch.scheduleRules?.startDate||Scheduler?.defaultStartDate?.(new Date(),scheduleTimeZoneEl?.value||batch.scheduleRules?.timeZone||'system')||'',
      localTime:scheduleLocalTimeEl?.value||batch.scheduleRules?.localTime||'07:30',
      timeZone:scheduleTimeZoneEl?.value||batch.scheduleRules?.timeZone||'system',
      weekdays,
      skipStart:scheduleSkipStartEl?.value||'',
      skipEnd:scheduleSkipEndEl?.value||'',
      maxPerGroupPerRound:scheduleMaxSchoolEl?.value||1,
      preserveExisting:schedulePreserveEl?.checked!==false,
      includeMailboxScheduled:scheduleMailboxExistingEl?.checked!==false,
      intraRoundMinutes:batch.scheduleRules?.intraRoundMinutes||10,
      skipHolidays:scheduleHolidayEl?.checked!==false
    }) || {startDate:scheduleStartDateEl?.value||'',localTime:scheduleLocalTimeEl?.value||'07:30',timeZone:scheduleTimeZoneEl?.value||'system',weekdays,skipStart:scheduleSkipStartEl?.value||'',skipEnd:scheduleSkipEndEl?.value||'',maxPerGroupPerRound:Number(scheduleMaxSchoolEl?.value||1),preserveExisting:schedulePreserveEl?.checked!==false,includeMailboxScheduled:scheduleMailboxExistingEl?.checked!==false,skipHolidays:scheduleHolidayEl?.checked!==false};
    batch.scheduleRules=rules; saveScheduleRulePrefs(rules); return rules;
  }
  batch.scheduleRules = freshScheduleRules();

  let rosterPlannerSelection=null, rosterPlannerSelectedRows=null, rosterPlannerSelectionKind='', rosterPlannerSelectionMeta='', rosterPlannerFeatureKey='', rosterPlannerAnchor=null, rosterPlannerDragging=false;
  function rosterPlannerSources(){
    if(!RosterPlanner)return[];
    const out=[],seen=new Set(),pushSet=(set,origin)=>{
      if(!set?.rows?.length||!set?.meta?.excelVisual)return;
      const key=RosterPlanner.sourceKey(set);if(seen.has(key))return;seen.add(key);out.push({key,set,origin});
    };
    const state=rosterState();
    const datasets=Array.isArray(state.datasets)&&state.datasets.length?state.datasets:(state.dataset?[state.dataset]:[]);
    for(const dataset of [...datasets].reverse())for(const set of (dataset?.recordSets||dataset?.sheets||[]))pushSet(set,'manual');
    const sets=recordSets();
    for(let i=0;i<sets.length;i++){const set=sets[i],config=ensureCollectionConfig(i);if(config?.purpose==='roster')pushSet(set,'routed');}
    return out;
  }
  function rosterPlannerEntriesForSet(set){
    if(!set||!Roster)return[];
    try{return Roster.parseDataset({recordSets:[set],sheets:[set]}).entries||[];}catch(_){return[];}
  }
  function rosterPlannerCurrentSource(){
    const sources=rosterPlannerSources();if(!sources.length)return null;
    const wanted=String(batch.rosterPlanner?.sourceKey||'');return sources.find(item=>item.key===wanted)||sources[0];
  }
  function rosterPlannerColumnProjection(set){
    const plan=RosterPlanner?.columnPlan?.(set)||{maxCols:Math.max(...(set?.rows||[]).map(row=>row?.length||0),1),autoHidden:new Set(),emptyHidden:new Set(),originalHidden:new Set(),relevant:new Set()};
    const showAll=!!batch.rosterPlanner?.showIrrelevantColumns,hiddenCols=new Set(plan.originalHidden||[]);
    if(!showAll){for(const c of plan.autoHidden||[])hiddenCols.add(c);for(const c of plan.emptyHidden||[])hiddenCols.add(c);}
    return {plan,hiddenCols,showAll};
  }
  function rosterPlannerMergeMaps(set,hiddenCols=new Set(),hiddenRows=new Set()){
    return RosterPlanner?.projectedMerges?.(set,{hiddenCols,hiddenRows})||{top:new Map(),covered:new Set()};
  }
  function rosterPlannerColumnWidths(set,maxCols){
    const widths=Array.from({length:maxCols},(_,c)=>Math.min(280,Math.max(88,Math.max(...(set.rows||[]).slice(0,60).map(row=>String(row?.[c]??'').length),6)*7+24)));
    for(const spec of set?.meta?.excelVisual?.colWidths||[]){const [a,b,width]=spec||[];for(let c=Math.max(0,a||0);c<=Math.min(maxCols-1,b||0);c++)widths[c]=Math.min(360,Math.max(54,Number(width||10)*7+8));}
    return widths;
  }
  function renderRosterPlannerTable(set){
    if(!rosterSheetTableEl)return;
    const rows=set?.rows||[],visual=set?.meta?.excelVisual||{},maxRows=Math.min(rows.length,320),projection=rosterPlannerColumnProjection(set),plan=projection.plan,maxCols=Math.min(40,Math.max(Number(plan.maxCols||0),Number(visual.usedRange?.cols||0),...rows.slice(0,maxRows).map(row=>row?.length||0),1));
    const hiddenRows=new Set(visual.hiddenRows||[]),hiddenColSet=projection.hiddenCols,widths=rosterPlannerColumnWidths(set,maxCols),merge=rosterPlannerMergeMaps(set,hiddenColSet,hiddenRows),styleCache=RosterPlanner.styleLookup(set);
    const visibleCols=[];for(let c=0;c<maxCols;c++)if(!hiddenColSet.has(c))visibleCols.push(c);
    const rowBatch=new Map();
    for(const entry of rosterPlannerEntriesForSet(set)){
      const row=Math.max(0,Number(entry?.sourceRow||0)-1),label=rosterPlannerEffectiveBatch(entry);if(label)rowBatch.set(row,label);
    }
    let html='<colgroup><col style="width:52px">'+visibleCols.map(c=>`<col style="width:${Math.round(widths[c])}px">`).join('')+'</colgroup><thead><tr><th class="nmda-roster-corner"></th>';
    for(const c of visibleCols)html+=`<th class="nmda-roster-colhead" data-col="${c}">${RosterPlanner.columnLabel(c)}</th>`;html+='</tr></thead><tbody>';
    for(let r=0;r<maxRows;r++){
      if(hiddenRows.has(r))continue;
      const rowHeight=Number(visual.rowHeights?.[r]||0),trStyle=rowHeight?`height:${Math.max(22,Math.min(110,rowHeight*1.333))}px;`:'';
      const batchLabel=rowBatch.get(r)||'';
      html+=`<tr style="${trStyle}"${batchLabel?` data-roster-row-batch="${escapeHtml(batchLabel)}"`:''}><th class="nmda-roster-rowhead" data-row="${r}"><span>${r+1}</span>${batchLabel?`<b>${escapeHtml(batchLabel)}</b>`:''}</th>`;
      for(const c of visibleCols){
        if(merge.covered.has(`${r}:${c}`))continue;
        const span=merge.top.get(`${r}:${c}`)||{},sourceAnchor=span.anchor||[r,c],sr=Number(sourceAnchor[0]),sc=Number(sourceAnchor[1]),style=RosterPlanner.styleAt(set,sr,sc,styleCache),css=RosterPlanner.cssForStyle(style),value=String(rows[sr]?.[sc]??rows[r]?.[c]??'');
        const spanAttrs=`${span.rowSpan>1?` rowspan="${span.rowSpan}"`:''}${span.colSpan>1?` colspan="${span.colSpan}"`:''}`;
        const mergeData=span.source?` data-merge-r1="${span.source[0]}" data-merge-c1="${span.source[1]}" data-merge-r2="${span.source[2]}" data-merge-c2="${span.source[3]}"`:'';
        html+=`<td data-roster-cell data-row="${r}" data-col="${c}"${spanAttrs}${mergeData} style="${css}"><span>${escapeHtml(value)}</span></td>`;
      }
      html+='</tr>';
    }
    html+='</tbody>';rosterSheetTableEl.innerHTML=html;paintRosterPlannerSelection();
    const autoHiddenCount=(plan.autoHidden?.size||0)+(plan.emptyHidden?.size||0);
    if(rosterColumnFocusEl){
      rosterColumnFocusEl.textContent=projection.showAll?'全部列':'主要列';
      rosterColumnFocusEl.title=projection.showAll?'当前显示全部可见列':'当前只显示姓名、邮箱、院校和排期相关主要列';
    }
    if(rosterColumnToggleEl){
      rosterColumnToggleEl.hidden=!autoHiddenCount;rosterColumnToggleEl.textContent=projection.showAll?'只看主要列':'查看全部列';
      rosterColumnToggleEl.setAttribute('aria-pressed',projection.showAll?'true':'false');
    }
  }
  function rosterPlannerSelectionEntries(){
    const current=rosterPlannerCurrentSource();if(!current)return[];
    const entries=rosterPlannerEntriesForSet(current.set);
    if(rosterPlannerSelectedRows?.size){return entries.filter(entry=>rosterPlannerSelectedRows.has(Number(entry?.sourceRow||0)-1)).sort((a,b)=>Number(a.sourceRow||0)-Number(b.sourceRow||0));}
    if(!rosterPlannerSelection)return[];
    return RosterPlanner.entriesForRange(entries,current.set,rosterPlannerSelection);
  }
  function rosterPlannerExplicitBatch(entry){
    if(!entry)return'';
    if(RosterPlanner?.explicitPriorityRound)return String(RosterPlanner.explicitPriorityRound(entry)||'').trim();
    if(RosterPlanner?.explicitBatch)return String(RosterPlanner.explicitBatch(entry)||'').trim();
    const raw=String(entry?.priorityRound||entry?.batch||'').trim();return RosterPlanner?.parseRound?.(raw)!=null?raw:'';
  }
  function rosterPlannerEffectiveBatch(entry){
    const intent=RosterPlanner?.intentForEntry?.(batch.rosterPlanner,entry)||null;
    if(intent?.priorityRoundSuppressed||intent?.batchSuppressed)return'';
    return String(intent?.priorityRoundLabel||intent?.batch||rosterPlannerExplicitBatch(entry)||'').trim();
  }
  function rosterPlannerFeatureGroups(set,entries=rosterPlannerEntriesForSet(set)){
    if(!set||!RosterPlanner)return[];
    const entryRows=new Set(entries.map(entry=>Math.max(0,Number(entry?.sourceRow||0)-1)));
    const firstRow=entryRows.size?Math.min(...entryRows):1;
    const groups=(RosterPlanner.featureGroups?.(set,{rows:entryRows,startRow:firstRow})||RosterPlanner.visualGroups?.(set,{startRow:firstRow})||[]);
    return groups.map(group=>{
      const rowSet=new Set(group.rows||[]),matched=entries.filter(entry=>rowSet.has(Number(entry?.sourceRow||0)-1));
      return {...group,key:group.key||`fill:${group.fill||group.value||''}`,kind:group.kind||'fill',value:group.value||group.fill||'',entries:matched};
    }).filter(group=>group.entries.length);
  }
  function rosterPlannerBatchCounts(entries=[]){
    const known=RosterPlanner?.knownBatches?.(batch.rosterPlanner,entries)||[];
    const counts=new Map(known.map(label=>[label,0]));let unassigned=0,fixed=0;
    for(const entry of entries){
      const label=rosterPlannerEffectiveBatch(entry);
      if(label){counts.set(label,(counts.get(label)||0)+1);continue;}
      if(String(entry?.scheduleAt||'').trim()){fixed++;continue;}
      unassigned++;
    }
    const ordered=[...counts.entries()].sort((a,b)=>{const an=RosterPlanner?.parseRound?.(a[0]),bn=RosterPlanner?.parseRound?.(b[0]);return (an??999)-(bn??999)||a[0].localeCompare(b[0]);});
    return {ordered,unassigned,fixed,known};
  }
  function rosterPlannerActiveBatch(){return String(batch.rosterPlanner?.activePriorityRound||batch.rosterPlanner?.activeBatch||'').trim();}
  function paintRosterPlannerSelection(){
    if(!rosterSheetTableEl)return;const range=RosterPlanner?.normalizeRange?.(rosterPlannerSelection),selectedRows=rosterPlannerSelectedRows;
    rosterSheetTableEl.querySelectorAll('[data-roster-cell]').forEach(cell=>{
      const r=Number(cell.dataset.row),c=Number(cell.dataset.col),selected=selectedRows?.size?selectedRows.has(r):!!range&&r>=range.r1&&r<=range.r2&&c>=range.c1&&c<=range.c2;
      cell.classList.toggle('is-selected',selected);
    });
    rosterSheetTableEl.querySelectorAll('.nmda-roster-rowhead').forEach(head=>{
      const r=Number(head.dataset.row),selected=selectedRows?.size?selectedRows.has(r):!!range&&r>=range.r1&&r<=range.r2;
      head.classList.toggle('is-selected',selected);
    });
    const entries=rosterPlannerSelectionEntries();
    let label='尚未选择';
    if(selectedRows?.size){
      if(rosterPlannerSelectionKind==='batch')label=`${rosterPlannerSelectionMeta||'同校优先级'} · ${entries.length} 位`;
      else if(rosterPlannerSelectionKind==='unassigned')label=`待分 · ${entries.length} 位`;
      else if(rosterPlannerSelectionKind==='fixed')label=`固定时间 · ${entries.length} 位`;
      else if(rosterPlannerSelectionKind==='feature')label=`${rosterPlannerSelectionMeta||'特征'} · ${entries.length} 位`;
      else label=`已选择 · ${entries.length} 位`;
    }else if(range)label=`框选 ${RosterPlanner.rangeLabel(range)} · ${entries.length} 位`;
    if(rosterSelectionMiniEl)rosterSelectionMiniEl.textContent=label;
    if(rosterSelectionLabelEl)rosterSelectionLabelEl.textContent=label;
    const active=rosterPlannerActiveBatch();
    if(rosterSelectionDetailEl){
      rosterSelectionDetailEl.textContent=entries.length
        ? (active?`已选联系人；加入 ${active} 后会直接在名单中标记。`:'已选联系人；先新建一个同校优先级，再加入。')
        : (selectedRows?.size||range?'当前选择没有命中可识别联系人。':'新建同校优先级后，可按每行主导颜色 / 格式快速选人，也可直接框选。');
    }
    if(rosterActiveBatchEl)rosterActiveBatchEl.dataset.state=active?'ready':'empty';
    if(rosterActiveBatchLabelEl)rosterActiveBatchLabelEl.textContent=active||'未创建';
    if(rosterBatchAddEl){rosterBatchAddEl.disabled=!entries.length||!active;rosterBatchAddEl.textContent=active?`加入 ${active}`:'先新建轮次';}
    if(rosterBatchClearEl)rosterBatchClearEl.disabled=!entries.length||!entries.some(entry=>!!rosterPlannerEffectiveBatch(entry));
  }
  function rosterFeatureChip(group,index){
    const count=group.entries?.length||0,key=escapeHtml(group.key||''),active=rosterPlannerFeatureKey===group.key?' is-active':'';
    if(group.kind==='fill'){const variants=Array.isArray(group.variants)?group.variants.length:1,hint=variants>1?`相近色已合并 ${variants} 种原始颜色 · `:'';return `<button class="nmda-roster-visual-chip${active}" type="button" data-roster-feature-index="${index}" title="${escapeHtml(hint)}选择这一颜色族的 ${count} 位联系人"><i style="background:${escapeHtml(group.value||group.fill||'#fff')}"></i><span>${variants>1?'近似色':'颜色'}</span><b>${count}</b></button>`;}
    if(group.kind==='font-color')return `<button class="nmda-roster-visual-chip${active}" type="button" data-roster-feature-index="${index}" title="选择这一字体颜色的 ${count} 位联系人"><i class="is-font-color" style="color:${escapeHtml(group.value||'#334155')}">A</i><span>字体色</span><b>${count}</b></button>`;
    if(group.kind==='bold')return `<button class="nmda-roster-visual-chip${active}" type="button" data-roster-feature-index="${index}" title="选择加粗的 ${count} 位联系人"><i class="is-format-mark"><strong>B</strong></i><span>加粗</span><b>${count}</b></button>`;
    if(group.kind==='italic')return `<button class="nmda-roster-visual-chip${active}" type="button" data-roster-feature-index="${index}" title="选择斜体的 ${count} 位联系人"><i class="is-format-mark"><em>I</em></i><span>斜体</span><b>${count}</b></button>`;
    return `<button class="nmda-roster-visual-chip${active}" type="button" data-roster-feature-index="${index}" title="选择具有相同格式特征的 ${count} 位联系人"><i class="is-border-mark"></i><span>边框</span><b>${count}</b></button>`;
  }
  function renderRosterPlanner(){
    if(!rosterPlannerViewEl||!RosterPlanner)return;
    batch.rosterPlanner=RosterPlanner.createState(batch.rosterPlanner);
    const sources=rosterPlannerSources();
    if(rosterPlannerSourceEl){rosterPlannerSourceEl.innerHTML=sources.map(item=>`<option value="${escapeHtml(item.key)}">${escapeHtml(item.set.source||'Excel')} · ${escapeHtml(item.set.name||'Sheet')}</option>`).join('');rosterPlannerSourceEl.disabled=!sources.length;}
    if(!sources.length){
      if(rosterPlannerSummaryEl)rosterPlannerSummaryEl.textContent='未找到可用于设置同校优先级的 XLSX 总名单';
      if(rosterSheetTableEl)rosterSheetTableEl.innerHTML='<tbody><tr><td class="nmda-roster-empty-sheet">未找到总名单</td></tr></tbody>';
      if(rosterVisualGroupsEl)rosterVisualGroupsEl.innerHTML='<span class="nmda-roster-visual-label">没有名单特征可选择</span>';
      if(rosterIntentSummaryEl)rosterIntentSummaryEl.innerHTML='<div class="nmda-roster-batch-overview-empty">没有总名单时仍可直接使用时间规划。</div>';
      paintRosterPlannerSelection();return;
    }
    let current=rosterPlannerCurrentSource();if(!current)current=sources[0];batch.rosterPlanner.sourceKey=current.key;if(rosterPlannerSourceEl)rosterPlannerSourceEl.value=current.key;
    const set=current.set,entries=rosterPlannerEntriesForSet(set),groups=rosterPlannerFeatureGroups(set,entries),batchCounts=rosterPlannerBatchCounts(entries);
    const assigned=batchCounts.ordered.reduce((sum,item)=>sum+item[1],0);
    if(rosterPlannerSummaryEl)rosterPlannerSummaryEl.innerHTML=`<strong>${entries.length}</strong><span>联系人</span><i></i><b>${assigned}</b><span>已设优先级</span>${batchCounts.fixed?`<i></i><b>${batchCounts.fixed}</b><span>固定时间</span>`:''}<i></i><b>${batchCounts.unassigned}</b><span>未设置 · 可选</span>`;
    if(rosterVisualGroupsEl)rosterVisualGroupsEl.innerHTML=groups.length?groups.slice(0,24).map(rosterFeatureChip).join(''):'<span class="nmda-roster-visual-label">没有可复用的格式特征，直接框选即可</span>';
    renderRosterPlannerTable(set);
    if(rosterIntentSummaryEl){
      const active=rosterPlannerActiveBatch(),isUnassigned=rosterPlannerSelectionKind==='unassigned',isFixed=rosterPlannerSelectionKind==='fixed';
      const segments=batchCounts.ordered.map(([label,count])=>{
        const explicit=entries.some(entry=>rosterPlannerExplicitBatch(entry)===label),title=explicit?'Excel 中有明确同校优先级；点击查看成员':'你新建的同校优先级；点击查看成员';
        return `<button type="button" class="nmda-roster-batch-segment${active===label?' is-active':''}" data-roster-batch-focus="${escapeHtml(label)}" style="--weight:${Math.max(1,count)}" title="${escapeHtml(title)}"><span>${escapeHtml(label)}</span><b>${count}</b></button>`;
      }).join('');
      const fixed=batchCounts.fixed?`<button type="button" class="nmda-roster-batch-segment is-fixed${isFixed?' is-active':''}" data-roster-batch-focus="__fixed__" style="--weight:${Math.max(1,batchCounts.fixed)}" title="Excel 中已有明确发送时间；该时间直接进入排期，不再由同校优先级决定日期"><span>固定时间</span><b>${batchCounts.fixed}</b></button>`:'';
      const unassigned=batchCounts.unassigned?`<button type="button" class="nmda-roster-batch-segment is-unassigned${isUnassigned?' is-active':''}" data-roster-batch-focus="__unassigned__" style="--weight:${Math.max(1,batchCounts.unassigned)}" title="未设置同校优先级（可选）；不影响排期"><span>未设置 · 可选</span><b>${batchCounts.unassigned}</b></button>`:'';
      const empty=!segments?'<div class="nmda-roster-batch-empty-state"><strong>未设置同校优先级</strong><span>这是可选项；需要控制同校先后时再新建 R1/R2…。</span></div>':'';
      rosterIntentSummaryEl.innerHTML=`<div class="nmda-roster-batch-overview-title"><strong>同校优先级 · 可选</strong><span>${assigned} 已设 · ${batchCounts.unassigned} 未设置</span></div><div class="nmda-roster-batch-track">${segments}${fixed}${unassigned}${empty}</div><small>不设置也可直接排期；设置后仅约束同校先后。相近颜色只用于辅助选人，R1/R2 不代表发送日期。</small>`;
    }
    paintRosterPlannerSelection();
  }
  function openRosterPlannerView({returnToSchedule=false}={}){
    if(!dispatchTasks().length){setBatchStatus('执行池为空；请先从邮件审阅进入选择与排期。','warn');return;}
    if(returnToSchedule)batch.rosterPlannerReturnToSchedule=true;
    closeScheduleModal({restoreFocus:false});
    batch.rosterPlannerOpen=true;
    if(dispatchPaneHost)dispatchPaneHost.classList.add('is-roster-planning');
    if(rosterPlannerViewEl)rosterPlannerViewEl.hidden=false;
    renderRosterPlanner();
    requestAnimationFrame(()=>rosterSheetViewportEl?.focus?.({preventScroll:true}));
  }
  function closeRosterPlannerView({restoreFocus=true}={}){
    const returnToSchedule=!!batch.rosterPlannerReturnToSchedule;
    batch.rosterPlannerReturnToSchedule=false;
    batch.rosterPlannerOpen=false;
    if(dispatchPaneHost)dispatchPaneHost.classList.remove('is-roster-planning');
    if(rosterPlannerViewEl)rosterPlannerViewEl.hidden=true;
    if(returnToSchedule){openScheduleModal();return;}
    if(restoreFocus)requestAnimationFrame(()=>$('nmda-open-schedule-modal')?.focus?.({preventScroll:true}));
  }
  function clearRosterPlannerSelection(){
    rosterPlannerSelection=null;rosterPlannerSelectedRows=null;rosterPlannerSelectionKind='';rosterPlannerSelectionMeta='';rosterPlannerFeatureKey='';rosterPlannerAnchor=null;rosterPlannerDragging=false;paintRosterPlannerSelection();renderRosterPlanner();
  }
  function createRosterPlannerBatch(){
    const current=rosterPlannerCurrentSource();if(!current||!RosterPlanner)return;
    const entries=rosterPlannerEntriesForSet(current.set),created=(RosterPlanner.createPriorityRound?.(batch.rosterPlanner,entries)||RosterPlanner.createBatch?.(batch.rosterPlanner,entries))||null;if(!created)return;
    batch.rosterPlanner=created.state;batch.handoffComplete=false;batch.schedulePlan=null;scheduleWorkspacePersist();renderRosterPlanner();
    setBatchStatus(`已新建同校优先级 ${created.label}。现在按行主导颜色 / 格式选择，或框选联系人后加入该优先级。`,'ok');
  }
  function applyRosterPlannerBatch(label,{clear=false}={}){
    const current=rosterPlannerCurrentSource();if(!current||!RosterPlanner)return;
    const targets=rosterPlannerSelectionEntries();if(!targets.length){setBatchStatus('请先按行主导颜色 / 格式选择，或在名单上框选联系人。','warn');return;}
    const targetLabel=clear?'':String(label||rosterPlannerActiveBatch()||'').trim();if(!clear&&!targetLabel){setBatchStatus('请先新建一个同校优先级。','warn');return;}
    const source=rosterPlannerSelectionKind==='feature'?'feature-selection':rosterPlannerSelectionKind==='batch'||rosterPlannerSelectionKind==='unassigned'?'batch-review':'box-selection';
    const result=(RosterPlanner.applyPriorityRoundToEntries||RosterPlanner.applyBatchToEntries)(batch.rosterPlanner,targets,current.set,{batch:targetLabel,clear,evidenceSource:source});
    if(result.warning){setBatchStatus(result.warning,'warn');return;}
    batch.rosterPlanner=result.state;batch.handoffComplete=false;batch.schedulePlan=null;
    if(rosterPlannerSelectionKind==='batch'||rosterPlannerSelectionKind==='unassigned'){rosterPlannerSelectionKind=clear?'unassigned':'batch';rosterPlannerSelectionMeta=clear?'':targetLabel;}
    scheduleWorkspacePersist();
    if(batch.dataset)rebuildTasks();renderRosterPlanner();renderScheduleCenter();
    setBatchStatus(clear?`已将 ${result.targets.length} 位联系人移出同校优先级。`:`已将 ${result.targets.length} 位联系人设为 ${targetLabel}。`,'ok');
  }

  function scheduleRecipientEmails(value){
    const text=Array.isArray(value)?value.map(item=>item?.email||item?.address||'').join('; '):String(value||'');
    return [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(email=>email.toLowerCase()))];
  }

  function enrichExistingScheduleAnchors(rawAnchors=[],tasks=dispatchTasks()){
    const exactSchools=new Map(),domainSchools=new Map();
    for(const task of tasks||[]){
      const school=String(task?.school||'').trim();if(!school)continue;
      for(const email of scheduleRecipientEmails(task?.recipients||'')){
        if(!exactSchools.has(email))exactSchools.set(email,new Set());exactSchools.get(email).add(school);
      }
      const domain=Scheduler?.recipientDomain?.(task?.recipients||'')||'';
      if(domain){if(!domainSchools.has(domain))domainSchools.set(domain,new Set());domainSchools.get(domain).add(school);}
    }
    return (rawAnchors||[]).map(anchor=>{
      const recipients=Array.isArray(anchor?.recipients)&&anchor.recipients.length
        ? anchor.recipients.map(item=>item?.name?`${item.name} <${item.email||''}>`:item?.email||'').filter(Boolean).join('; ')
        : String(anchor?.toRaw||'');
      const emails=scheduleRecipientEmails(recipients);
      const exactCandidates=new Set();for(const email of emails)for(const school of exactSchools.get(email)||[])exactCandidates.add(school);
      const domain=Scheduler?.recipientDomain?.(recipients)||'';
      const domainCandidates=domainSchools.get(domain)||new Set();
      const school=exactCandidates.size===1?[...exactCandidates][0]:(!exactCandidates.size&&domainCandidates.size===1?[...domainCandidates][0]:'');
      return {
        id:String(anchor?.id||''),recipients,subject:String(anchor?.subject||''),scheduleAt:String(anchor?.scheduleAt||''),
        scheduleEvidence:String(anchor?.scheduleEvidence||''),savedAt:String(anchor?.savedAt||''),school,schoolSource:school?'recognized':'',
        _immutableAnchor:true,_provider:'netease-draft'
      };
    }).filter(anchor=>anchor.id&&anchor.scheduleAt);
  }

  async function readExistingScheduleAnchors({required=true}={}){
    batch.existingScheduleStatus='loading';batch.existingScheduleError='';renderScheduleCenter();
    let result;
    try{result=await chrome.runtime.sendMessage({type:'NMDA_READ_SCHEDULED_DRAFTS',historyMonths:readMailboxHistoryMonths()});}
    catch(error){result={ok:false,reason:error?.message||String(error)};}
    if(!result?.ok){
      batch.existingScheduleAnchors=[];batch.existingScheduleStatus='error';batch.existingScheduleError=String(result?.reason||'读取失败');renderScheduleCenter();
      if(required)throw new Error(`无法读取网易已有排期：${batch.existingScheduleError}`);
      return [];
    }
    if(!result.complete){
      batch.existingScheduleAnchors=[];batch.existingScheduleStatus='error';batch.existingScheduleError=`草稿箱读取不完整（${result.read||0}/${result.total||'?'}）`;renderScheduleCenter();
      if(required)throw new Error(`网易已有排期读取不完整（${result.read||0}/${result.total||'?'}），无法保证不冲突。`);
      return [];
    }
    batch.existingScheduleAnchors=enrichExistingScheduleAnchors(result.scheduled||[],dispatchTasks());
    batch.existingScheduleReadAt=new Date().toISOString();batch.existingScheduleStatus='ok';batch.existingScheduleError='';renderScheduleCenter();
    return batch.existingScheduleAnchors;
  }

  // One delegated handler replaces hundreds of row listeners that used to be
  // destroyed and rebound after every table refresh.
  previewBodyEl?.addEventListener('change', event => {
    const input=event.target;
    if(!(input instanceof HTMLInputElement))return;
    if(input.dataset.taskEnabled){
      const task=dispatchTaskByKey(input.dataset.taskEnabled);if(!task)return;
      void (async()=>{await updateDispatchTask(task,{enabled:input.checked});renderBatchSummaryControls(dispatchTasks());renderScheduleCenter();scheduleBatchRender({aux:false,force:true});})();
      return;
    }
    if(input.dataset.taskSchedule){
      const task=dispatchTaskByKey(input.dataset.taskSchedule);if(!task)return;
      const displayValue=input.value||'',value=scheduleValueFromDisplay(displayValue,batch.scheduleRules||freshScheduleRules());
      void (async()=>{await updateDispatchTask(task,{scheduleAt:value,scheduleSource:value?'manual':'manual-clear',scheduleReason:value?`手工调整 · ${scheduleZoneText(batch.scheduleRules||freshScheduleRules())} 当地时间`:''});renderBatchSummaryControls(dispatchTasks());renderScheduleCenter();scheduleBatchRender({aux:false,force:true});})();
    }
  });

  reviewQueueEl?.addEventListener('mousedown',event=>{
    const rich=event.target.closest?.('[data-preview-rich-command]');
    if(rich)event.preventDefault();
  });

  reviewQueueEl?.addEventListener('click',event=>{
    const loadMore=event.target.closest?.('[data-review-load-more]');
    if(loadMore){viewPerf.reviewRenderLimit=(viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK)+REVIEW_RENDER_CHUNK;renderReviewQueue(batch.reviewSurface==='preview'?(batch.reviewEditingKey||batch.reviewPreviewKey):'',{preserveScroll:true});return;}
    const previewAction=event.target.closest?.('[data-review-preview-key]');
    if(previewAction){openReviewPreview(previewAction.dataset.reviewPreviewKey);return;}
    const editAction=event.target.closest?.('[data-preview-edit-key],[data-review-edit-key]');
    if(editAction){beginPreviewEdit(editAction.dataset.previewEditKey||editAction.dataset.reviewEditKey);return;}
    const cancel=event.target.closest?.('[data-preview-edit-cancel]');if(cancel){cancelPreviewEdit(cancel.dataset.previewEditCancel);return;}
    const save=event.target.closest?.('[data-preview-edit-save]');if(save){void savePreviewEdit(save.dataset.previewEditSave);return;}
    const confirm=event.target.closest?.('[data-preview-confirm-key]');if(confirm){void confirmPreviewTask(confirm.dataset.previewConfirmKey);return;}
    const exclude=event.target.closest?.('[data-preview-exclude-key]');if(exclude){void excludePreviewTask(exclude.dataset.previewExcludeKey);return;}
    const suggestion=event.target.closest?.('[data-preview-recipient-suggestion]');
    if(suggestion){const page=suggestion.closest('.nmda-review-preview-page');const input=page?.querySelector?.('[data-preview-edit-recipients]');if(input){input.value=suggestion.dataset.previewRecipientSuggestion||'';input.focus();setPreviewEditFeedback(page.dataset.reviewRow,'','warn');}return;}
    const rich=event.target.closest?.('[data-preview-rich-command]');
    if(rich){const page=rich.closest('.nmda-review-preview-page');const editor=page?.querySelector?.('[data-preview-edit-body]');if(!editor)return;editor.focus();try{document.execCommand(String(rich.dataset.previewRichCommand||''),false,null);}catch(_){ }editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'format'}));return;}
  });
  reviewPreviewRailEl?.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-review-rail-key]');if(!target)return;
    const key=String(target.dataset.reviewRailKey||'');
    if(batch.reviewEditingKey&&batch.reviewEditingKey!==key){setImportStatus('请先保存或取消当前邮件的编辑。','warn');return;}
    if(key)focusReviewTask(key,{behavior:'smooth',block:'start'});
  });

  reviewQueueEl?.addEventListener('change',event=>{
    const input=event.target.closest?.('[data-review-select]');if(!input)return;
    const key=input.dataset.reviewSelect;if(!key)return;
    if(input.checked)batch.reviewSelected.add(key);else batch.reviewSelected.delete(key);
    input.closest('.nmda-review-preview-page, .nmda-mail-review-card')?.classList.toggle('is-selected',input.checked);
    renderReviewBatchActions();
    const visible=reviewVisibleTasks().filter(taskCanBatchConfirm),allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    const selectButton=$('nmda-review-select-filtered');if(selectButton){const batchMode=batch.reviewFilter==='pending'&&reviewTasks().length>0;selectButton.hidden=!batchMode||visible.length<2;selectButton.textContent=allSelected?'取消批量选择':`批量确认 ${visible.length} 封…`;}
  });

  let reviewScrollFrame=0;
  reviewQueueEl?.addEventListener('scroll',()=>{
    if(reviewScrollFrame)return;
    reviewScrollFrame=requestAnimationFrame(()=>{
      reviewScrollFrame=0;
      if(!reviewQueueEl || reviewQueueEl.clientHeight<=0)return;
      if(batch.reviewSurface==='preview')syncReviewPreviewActiveFromScroll();
      const remaining=reviewQueueEl.scrollHeight-reviewQueueEl.scrollTop-reviewQueueEl.clientHeight;
      if(remaining>Math.max(420,reviewQueueEl.clientHeight*.55))return;
      const total=reviewQueueItems(reviewVisibleTasks()).length;
      const current=Math.max(REVIEW_RENDER_CHUNK,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
      if(current>=total)return;
      viewPerf.reviewRenderLimit=Math.min(total,current+REVIEW_RENDER_CHUNK);
      renderReviewQueue(batch.reviewEditingKey||batch.reviewPreviewKey||'',{preserveScroll:true});
    });
  },{passive:true});


  reviewSearchEl?.addEventListener('input',()=>{
    batch.reviewSearch=String(reviewSearchEl.value||'');
    viewPerf.reviewRenderLimit=REVIEW_RENDER_CHUNK;
    if(reviewQueueEl)reviewQueueEl.scrollTop=0;
    if(batch.reviewEditingKey){reviewSearchEl.value=String(batch.reviewSearch||'');setImportStatus('请先保存或取消当前邮件的编辑，再搜索。','warn');return;}
    const currentKey=batch.reviewPreviewKey||'';
    renderReviewQueue(currentKey);
    const visible=reviewVisibleTasks();
    if(currentKey && !visible.some(task=>task.editKey===currentKey)){batch.reviewPreviewKey='';if(batch.reviewSurface==='preview'&&visible[0])focusReviewTask(visible[0].editKey,{behavior:'auto'});}
  });
  planningOverviewEl?.addEventListener('click', event=>{
    const show=event.target.closest?.('[data-show-unscheduled]');
    if(show){
      const box=$('nmda-unscheduled-exceptions');
      if(box){ box.hidden=!box.hidden; if(!box.hidden)box.scrollIntoView({block:'nearest',behavior:'smooth'}); }
    }
  });

  function referenceRosterCount() {
    return Number(rosterState()?.entries?.length || 0);
  }

  function rosterContextState() {
    if(referenceRosterCount())return 'added';
    if(batch.dataset && (batch.tasks||[]).length)return batch.rosterPromptChoice==='skipped'?'skipped':'pending';
    return 'prepare';
  }


  function attachmentPreparedFileCount() {
    return uniqueFiles([...(batch.directoryFiles||[]), ...(batch.taskFiles||[]), ...(batch.routedAttachmentFiles||[])]).length;
  }

  function attachmentPreflightState() {
    const count=attachmentPreparedFileCount();
    if(count) return 'added';
    if(batch.dataset && (batch.tasks||[]).length) return batch.attachmentPrepChoice==='skipped'?'skipped':'pending';
    return 'prepare';
  }

  function supplementPreflightNeedsDecision() {
    return !!batch.dataset && !batch.supplementPreflightDone;
  }

  function attachmentRequirementRefs() {
    const refs=[];const seen=new Set();
    for(const task of batch.tasks||[]) for(const ref of task.attachmentRefs||[]){
      const key=Importer.normalizeFileKey(ref);if(!key||seen.has(key))continue;seen.add(key);refs.push(String(ref));
    }
    return refs;
  }

  function formatAttachmentSize(file) {
    const size=Number(file?.size||0);if(!size)return '大小未知';
    if(size<1024)return `${size} B`;
    if(size<1024*1024)return `${Math.max(1,Math.round(size/1024))} KB`;
    return `${(size/1024/1024).toFixed(size>=10*1024*1024?0:1)} MB`;
  }

  function attachmentPolicyStore(){
    if(!(batch.attachmentPolicies instanceof Map))batch.attachmentPolicies=new Map();
    return batch.attachmentPolicies;
  }

  function attachmentDefaultMode(kind='task'){
    if(kind==='shared')return 'all';
    if(kind==='directory'||kind==='routed')return 'smart';
    return attachmentRequirementRefs().length?'smart':'all';
  }

  function ensureAttachmentPolicy(file,kind='task',options={}){
    const identity=Importer.fileIdentity(file);if(!identity)return {mode:'smart',targets:[],source:''};
    const store=attachmentPolicyStore();let policy=store.get(identity);
    if(!policy){policy={mode:options.mode||attachmentDefaultMode(kind),targets:[],source:options.source||''};store.set(identity,policy);}
    else{
      if(options.source&&!policy.source)policy.source=options.source;
      if(options.mode&&!policy.mode)policy.mode=options.mode;
      if(!Array.isArray(policy.targets))policy.targets=[];
    }
    return policy;
  }

  function attachmentKindForFile(file){
    const id=Importer.fileIdentity(file),has=items=>(items||[]).some(item=>Importer.fileIdentity(item)===id);
    if(has(batch.directoryFiles))return 'directory';
    if(has(batch.routedAttachmentFiles))return 'routed';
    return 'task';
  }

  function syncAttachmentPolicies(){
    const store=attachmentPolicyStore(),valid=new Set();
    const groups=[['directory',batch.directoryFiles||[],'文件夹'],['task',batch.taskFiles||[],'手动添加'],['routed',batch.routedAttachmentFiles||[],'随资料导入']];
    for(const [kind,files,source] of groups)for(const file of files){const id=Importer.fileIdentity(file);if(!id)continue;valid.add(id);ensureAttachmentPolicy(file,kind,{source});}
    for(const id of [...store.keys()])if(!valid.has(id))store.delete(id);
  }

  function attachmentPolicyForFile(file){syncAttachmentPolicies();return ensureAttachmentPolicy(file,attachmentKindForFile(file));}

  function attachmentAssetEntries() {
    syncAttachmentPolicies();
    const groups=[
      ['directory',batch.directoryFiles||[],'文件夹导入'],
      ['task',batch.taskFiles||[],'手动添加'],
      ['routed',batch.routedAttachmentFiles||[],'随资料导入']
    ];
    const out=[],seen=new Set();
    for(const [kind,files,source] of groups) for(const file of files){
      const identity=Importer.fileIdentity(file);if(!identity||seen.has(identity))continue;seen.add(identity);
      const used=(batch.tasks||[]).filter(task=>(task.files||[]).some(item=>Importer.fileIdentity(item)===identity)).length;
      const policy=ensureAttachmentPolicy(file,kind,{source});
      out.push({file,identity,kind,source:policy.source||source,used,policy});
    }
    return out;
  }

  function setAttachmentPolicy(identity,mode){
    const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===identity);if(!file)return;
    const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));
    policy.mode=['smart','all','selected'].includes(mode)?mode:'smart';
    if(policy.mode!=='selected')batch.attachmentTargetEditing='';
    batch.attachmentPolicies.set(identity,policy);batch.handoffComplete=false;
    rebuildTasks();renderAttachmentAssetViews();
  }

  function setAttachmentTarget(identity,taskKey,checked){
    const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===identity);if(!file)return;
    const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));policy.mode='selected';
    const targets=new Set(policy.targets||[]);checked?targets.add(taskKey):targets.delete(taskKey);policy.targets=[...targets];
    batch.attachmentPolicies.set(identity,policy);batch.handoffComplete=false;rebuildTasks();renderAttachmentAssetViews();
  }

  function addAttachmentFiles(files,{source='手动添加',mode=''}={}){
    files=uniqueFiles(files||[]);if(!files.length)return 0;
    for(const file of files)batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.taskFiles=uniqueFiles([...(batch.taskFiles||[]),...files]);
    const inferred=mode||((files.some(file=>String(file?._nmdaPath||file?.webkitRelativePath||'').includes('/')))?'smart':attachmentDefaultMode('task'));
    for(const file of files)ensureAttachmentPolicy(file,'task',{source,mode:inferred});
    batch.attachmentPrepChoice='added';refreshFileIndex(false);renderSupplementPreflight();
    return files.length;
  }

  function sourceIdentityKey(value) {
    return String(value||'').replace(/\\/g,'/').replace(/^\.\//,'').trim();
  }

  function sourceIdentityMatches(value,sourceName,fileName='') {
    const candidate=sourceIdentityKey(value),full=sourceIdentityKey(sourceName),leaf=sourceIdentityKey(fileName||String(full).split('/').pop());
    if(!candidate)return false;
    return candidate===full||candidate===leaf;
  }

  function collectionDirectMatchesSource(collection,sourceName,fileName='') {
    return sourceIdentityMatches(collection?.source,sourceName,fileName);
  }

  function collectionMatchesSource(collection,sourceName,fileName='') {
    if(collectionDirectMatchesSource(collection,sourceName,fileName))return true;
    return (collection?.meta?.sourceMembers||[]).some(member=>sourceIdentityMatches(member,sourceName,fileName));
  }

  function sourceCollections(sourceName,fileName='') {
    const matches=recordSets().map((collection,index)=>({collection,index,direct:collectionDirectMatchesSource(collection,sourceName,fileName)})).filter(({collection})=>collectionMatchesSource(collection,sourceName,fileName));
    const direct=matches.filter(item=>item.direct);
    // Aggregate Word collections list every source in sourceMembers. They are an
    // execution view, not a per-file preview. Prefer the exact source collection
    // whenever it exists so selecting B.docx can never show A.docx's content.
    return (direct.length?direct:matches).map(({collection,index})=>({collection,index}));
  }

  function setSourcePurpose(sourceName,purpose,fileName='') {
    if(!['mail','roster','attachment','ignored'].includes(purpose))return;
    const resolvedFileName=fileName||String(sourceName||'').replace(/\\/g,'/').split('/').pop()||'';
    const related=sourceCollections(sourceName,resolvedFileName),primary=related.filter(({collection})=>!collection.meta?.supplemental),targets=primary.length?primary:related;
    if(!targets.length)return;
    for(const {collection,index} of targets){
      const config=ensureCollectionConfig(index);if(!config)continue;
      config.purpose=purpose;config.enabled=purpose==='mail';
      collection.meta={...(collection.meta||{}),purposeOverride:purpose,sourcePurpose:purpose,purposeConfidence:100,purposeReasons:['用户已确认资料用途']};
    }
    batch.handoffComplete=false;
    syncRoutedSources();
    clearStaleOverrides();
    batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());
    rebuildTasks();
    renderSourceInventory();renderPreflightSourceRoles();renderAttachmentAssetViews();renderSupplementPreflight();
    const label={mail:'邮件',roster:'参考总名单',attachment:'附件',ignored:'暂不使用'}[purpose];
    setImportStatus(`已将 ${resolvedFileName||sourceName} 调整为${label}，本批次结果已重新整理。`,'ok');
  }

  function sourcePurposeDecision(file) {
    const sourceName=sourceFileName(file),related=sourceCollections(sourceName,file?.name),primary=related.filter(({collection})=>!collection.meta?.supplemental),items=primary.length?primary:related;
    const userConfirmed=items.some(({collection})=>!!collection.meta?.purposeOverride);
    const configPurposes=[...new Set(items.map(({index})=>ensureCollectionConfig(index)?.purpose||'ignored'))];
    const evidence=items.map(({collection,index})=>({
      purpose:String(collection.meta?.sourcePurpose||'ambiguous'),
      confidence:Number(collection.meta?.purposeConfidence||0),
      reasons:collection.meta?.purposeReasons||[],index
    }));
    const scoreByPurpose=new Map();
    for(const item of evidence){
      if(!['mail','roster','attachment','ignored'].includes(item.purpose))continue;
      scoreByPurpose.set(item.purpose,Math.max(Number(scoreByPurpose.get(item.purpose)||0),item.confidence));
    }
    const ranked=[...scoreByPurpose.entries()].map(([purpose,confidence])=>({purpose,confidence})).sort((a,b)=>b.confidence-a.confidence);
    const top=ranked[0]||null,runner=ranked[1]||null;
    // A workbook can legitimately contain one useful roster sheet plus empty/helper
    // sheets. Do not make the whole file “待确认” merely because an auxiliary sheet
    // is ambiguous. Promote a single high-confidence source role only when it clearly
    // dominates every competing non-ambiguous role.
    const dominant=!userConfirmed&&top&&top.confidence>=85&&(!runner||runner.confidence<70||top.confidence-runner.confidence>=12)?top:null;
    let purpose='ignored';
    if(userConfirmed)purpose=configPurposes.length===1?configPurposes[0]:(configPurposes.find(value=>value!=='ignored')||configPurposes[0]||'ignored');
    else if(dominant)purpose=dominant.purpose;
    else if(configPurposes.length===1)purpose=configPurposes[0];
    const confidence=dominant?dominant.confidence:Math.max(0,...evidence.map(item=>item.confidence));
    const reasonSource=dominant?evidence.filter(item=>item.purpose===dominant.purpose):evidence;
    const reasons=[...new Set(reasonSource.flatMap(item=>item.reasons||[]))];
    const hasAmbiguous=evidence.some(item=>item.purpose==='ambiguous');
    const strongConflict=!!runner&&runner.confidence>=70&&(!top||top.confidence-runner.confidence<12);
    const needsReview=!userConfirmed&&!dominant&&(hasAmbiguous||confidence<70||strongConflict||!items.length);
    return{file,sourceName,purpose,confidence,reasons,items,needsReview,userConfirmed};
  }

  function roleConfidenceText(score) {
    const value=Number(score||0);return value>=90?'判断明确':value>=70?'基本确定':'需要留意';
  }

  function sourcePurposeOptions(selected) {
    const options=[['mail','邮件'],['roster','总名单'],['attachment','附件'],['review','待确认'],['ignored','暂不使用']];
    return options.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`).join('');
  }

  function sourceRoleVisual(purpose,needsReview=false) {
    if(needsReview)return{label:'待确认',icon:'!',tone:'review'};
    return {
      mail:{label:'邮件',icon:'✉',tone:'mail'},
      roster:{label:'总名单',icon:'名',tone:'roster'},
      attachment:{label:'附件',icon:'附',tone:'attachment'},
      ignored:{label:'暂不使用',icon:'×',tone:'ignored'}
    }[purpose]||{label:'待确认',icon:'!',tone:'review'};
  }

  function buildSourceFolderTree(decisions) {
    const root={name:'全部文件',path:'',count:0,direct:0,folders:new Map()};
    for(const decision of decisions){
      root.count++;
      const parts=String(decision.sourceName||'').replace(/\\/g,'/').split('/').filter(Boolean);parts.pop();
      if(!parts.length){root.direct++;continue;}
      let node=root,path='';
      for(const part of parts){
        path=path?`${path}/${part}`:part;
        if(!node.folders.has(part))node.folders.set(part,{name:part,path,count:0,direct:0,folders:new Map()});
        node=node.folders.get(part);node.count++;
      }
      node.direct++;
    }
    return root;
  }

  function sourceFolderNavHtml(node,depth=0) {
    return [...node.folders.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(folder=>{
      const active=batch.preflightFolderPath===folder.path;
      return `<div class="nmda-classify-folder-branch"><button class="nmda-classify-folder-row${active?' is-active':''}" type="button" data-preflight-folder="${escapeHtml(encodeURIComponent(folder.path))}" style="--depth:${depth}"><span class="nmda-classify-folder-chevron">›</span><span class="nmda-classify-folder-icon">▰</span><span class="nmda-classify-folder-name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</span><b>${folder.count}</b></button>${sourceFolderNavHtml(folder,depth+1)}</div>`;
    }).join('');
  }

  function sourceFileVisual(fileName) {
    const ext=String(fileName||'').split('.').pop().toLowerCase();
    if(['doc','docx','docm','rtf'].includes(ext))return{kind:'word',glyph:'W',label:ext==='rtf'?'RTF':'DOCX'};
    if(['xls','xlsx','ods','csv','tsv'].includes(ext))return{kind:'sheet',glyph:'X',label:['csv','tsv'].includes(ext)?ext.toUpperCase():'XLSX'};
    if(ext==='pdf')return{kind:'pdf',glyph:'P',label:'PDF'};
    if(['eml','msg'].includes(ext))return{kind:'email',glyph:'@',label:ext.toUpperCase()};
    if(['zip','rar','7z'].includes(ext))return{kind:'archive',glyph:'Z',label:ext.toUpperCase()};
    if(['jpg','jpeg','png','gif','webp','svg'].includes(ext))return{kind:'image',glyph:'▧',label:ext==='jpeg'?'JPG':ext.toUpperCase()};
    return{kind:'file',glyph:'F',label:(ext||'FILE').slice(0,5).toUpperCase()};
  }

  function sourceFileIconHtml(fileName) {
    const visual=sourceFileVisual(fileName);
    return `<span class="nmda-classify-file-icon" data-file-kind="${escapeHtml(visual.kind)}"><b>${escapeHtml(visual.glyph)}</b><small>${escapeHtml(visual.label)}</small></span>`;
  }

  function sourceFriendlyReason(decision) {
    if(decision.userConfirmed)return'你已确认这个文件的用途';
    const reason=String((decision.reasons||[]).find(Boolean)||'').trim();
    if(reason){
      if(reason.includes('证据不足或互相冲突'))return'文件同时具有多种用途特征，系统暂时没有替你决定';
      if(reason.includes('已停止自动分流'))return'文件用途不够明确，需要你看一眼内容后决定';
      if(reason.includes('普通文档缺少可验证'))return'暂时看不出明确的邮件、名单或附件用途';
      if(reason.includes('来源已明确指定用途'))return'这个用途来自你之前的选择';
      return reason.replace(/已按来源结构完成用途判断/g,'已根据文件内容判断用途');
    }
    if(decision.needsReview)return'系统不能完全确定，建议快速看一眼内容';
    if(decision.purpose==='mail')return'内容结构更像一封可以生成草稿的邮件';
    if(decision.purpose==='roster')return'内容更像联系人、导师或院校名单';
    if(decision.purpose==='attachment')return'内容更像需要随邮件使用的独立材料';
    return'当前不会参与本批次邮件创建';
  }

  function sourceFileTypeLabel(fileName) {
    const ext=String(fileName||'').split('.').pop().toLowerCase();
    if(['xls','xlsx','ods','csv','tsv'].includes(ext))return'表格';
    if(['doc','docx','docm','rtf'].includes(ext))return'Word';
    if(['eml','msg'].includes(ext))return'邮件文件';
    if(ext==='pdf')return'PDF';
    if(['zip','rar','7z'].includes(ext))return'压缩包';
    if(['jpg','jpeg','png','gif','webp','svg'].includes(ext))return'图片';
    return ext?ext.toUpperCase():'文件';
  }

  function sourcePrimaryCollection(decision) {
    const items=decision?.items||[],purpose=String(decision?.purpose||'');
    // When one workbook contains several sheets, preview the sheet that actually
    // supports the file-level decision instead of blindly taking the first sheet.
    const matchesPurpose=({collection,index})=>{
      const auto=String(collection?.meta?.sourcePurpose||''),configured=String(ensureCollectionConfig(index)?.purpose||'');
      return purpose&&purpose!=='ignored'&&(auto===purpose||configured===purpose);
    };
    return items.find(item=>matchesPurpose(item)&&!item.collection?.meta?.supplemental&&Array.isArray(item.collection?.rows)&&item.collection.rows.length)
      ||items.find(item=>matchesPurpose(item)&&Array.isArray(item.collection?.rows)&&item.collection.rows.length)
      ||items.find(({collection})=>!collection?.meta?.supplemental&&Array.isArray(collection?.rows)&&collection.rows.length)
      ||items.find(({collection})=>Array.isArray(collection?.rows)&&collection.rows.length)
      ||items[0]||null;
  }

  function sourceTasksForDecision(decision) {
    const sourceName=sourceIdentityKey(decision?.sourceName),fileName=sourceIdentityKey(decision?.file?.name||String(sourceName).split('/').pop());
    const bySource=(batch.tasks||[]).filter(task=>!task.importExcluded&&sourceIdentityMatches(task.sourceFile,sourceName,fileName));
    if(bySource.length)return bySource;
    const indexes=new Set((decision?.items||[]).map(item=>item.index));
    return (batch.tasks||[]).filter(task=>indexes.has(Number(task.collectionIndex))&&!task.importExcluded);
  }

  function sourceDirectoryPath(sourceName) {
    const parts=String(sourceName||'').replace(/\\/g,'/').split('/').filter(Boolean);parts.pop();return parts.join('/');
  }

  function sourceVisibleDecisions(decisions) {
    const folder=String(batch.preflightFolderPath||''),query=String(batch.preflightSearch||'').trim().toLowerCase(),filter=String(batch.preflightPurposeFilter||'');
    return decisions.filter(decision=>{
      const directory=sourceDirectoryPath(decision.sourceName);
      if(folder && !(directory===folder||directory.startsWith(`${folder}/`)))return false;
      if(batch.preflightReviewOnly&&!decision.needsReview)return false;
      if(filter){if(filter==='review'){if(!decision.needsReview)return false;}else if(decision.needsReview||decision.purpose!==filter)return false;}
      if(query&&!`${decision.sourceName} ${decision.file?.name||''}`.toLowerCase().includes(query))return false;
      return true;
    });
  }

  function sourceFileRowsHtml(decisions) {
    if(!decisions.length)return'<div class="nmda-classify-empty"><span>⌕</span><strong>当前范围没有文件</strong><small>可以切换目录、清除筛选，或返回上传继续添加资料。</small></div>';
    return decisions.map(decision=>{
      const visual=sourceRoleVisual(decision.purpose,decision.needsReview),fileName=String(decision.sourceName||'').replace(/\\/g,'/').split('/').pop()||'未命名来源';
      const active=batch.sourceInspectName===decision.sourceName;
      const path=sourceDirectoryPath(decision.sourceName),meta=[path||'根目录',humanFileSize(decision.file?.size)].filter(Boolean).join(' · ');
      return `<div class="nmda-classify-file-row${active?' is-selected':''}" data-tone="${escapeHtml(visual.tone)}" data-review="${decision.needsReview?'1':'0'}" data-inspect-source="${escapeHtml(encodeURIComponent(decision.sourceName))}" data-source-row="${escapeHtml(encodeURIComponent(decision.sourceName))}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(fileName)}"><span class="nmda-classify-drag" draggable="true" data-source-drag="${escapeHtml(encodeURIComponent(decision.sourceName))}" title="拖动可快速归类" aria-label="拖动 ${escapeHtml(fileName)} 重新归类">⠿</span>${sourceFileIconHtml(fileName)}<div class="nmda-classify-file-main"><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(meta)}</small></div><span class="nmda-classify-purpose-pill" data-tone="${escapeHtml(visual.tone)}"><i>${escapeHtml(visual.icon)}</i><span>${escapeHtml(visual.label)}</span></span></div>`;
    }).join('');
  }

  function setSourceNeedsReview(sourceName,fileName='') {
    const resolvedFileName=fileName||String(sourceName||'').replace(/\\/g,'/').split('/').pop()||'';
    const related=sourceCollections(sourceName,resolvedFileName),primary=related.filter(({collection})=>!collection.meta?.supplemental),targets=primary.length?primary:related;
    if(!targets.length)return;
    for(const {collection,index} of targets){
      const config=ensureCollectionConfig(index);if(!config)continue;
      config.purpose='ignored';config.enabled=false;
      collection.meta={...(collection.meta||{}),purposeOverride:'',sourcePurpose:'ambiguous',purposeConfidence:0,purposeReasons:['已标记为待确认']};
    }
    batch.handoffComplete=false;syncRoutedSources();clearStaleOverrides();batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());rebuildTasks();
    renderSourceInventory();renderPreflightSourceRoles();renderAttachmentAssetViews();renderSupplementPreflight();
    setImportStatus(`已将 ${resolvedFileName||sourceName} 标记为待确认。`,'ok');
  }

  function sourceRosterPreviewHtml(decision) {
    const first=sourcePrimaryCollection(decision);if(!first)return'';
    const collection=first.collection,config=ensureCollectionConfig(first.index),rosterDetection=typeof Importer.detectRosterHeader==='function'?Importer.detectRosterHeader(collection):null,detection=config?.detection||Importer.detectHeader(collection.rows||[]),headerIndex=rosterDetection&&Number(rosterDetection.index)>=0?Number(rosterDetection.index):Math.max(0,Number(detection.index||0));
    const headers=(collection.rows?.[headerIndex]||detection.headers||[]).slice(0,4).map(value=>String(value||'').trim()||'字段');
    const rows=(collection.rows||[]).slice(headerIndex+1,headerIndex+4).map(row=>headers.map((_,i)=>String(row?.[i]??'').trim()));
    if(!headers.length||!rows.length)return'<div class="nmda-inspector-empty-preview">已识别为名单资料，暂无适合快速预览的表格内容。</div>';
    return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>内容预览</strong><span>约 ${Math.max(0,(collection.rows||[]).length-headerIndex-1)} 条</span></div><div class="nmda-inspector-mini-table"><div class="nmda-inspector-mini-row is-head">${headers.map(h=>`<span>${escapeHtml(h)}</span>`).join('')}</div>${rows.map(row=>`<div class="nmda-inspector-mini-row">${row.map(v=>`<span title="${escapeHtml(v)}">${escapeHtml(v||'—')}</span>`).join('')}</div>`).join('')}</div></div>`;
  }

  function sourceGenericPreviewHtml(decision) {
    const item=sourcePrimaryCollection(decision),collection=item?.collection,rows=(collection?.rows||[]).filter(row=>(row||[]).some(value=>String(value??'').trim()));
    if(!rows.length)return'<div class="nmda-inspector-empty-preview">暂时没有可展示的内容预览。</div>';
    if(collection?.meta?.oneFileTask&&rows[1]){
      const body=String(rows[1]?.[4]??'').trim(),subject=String(rows[1]?.[3]??'').trim();
      const text=(body||subject).replace(/\s+/g,' ').trim();
      return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>文件内容</strong><span>${escapeHtml(sourceFileTypeLabel(decision.file?.name||decision.sourceName))}</span></div><div class="nmda-inspector-text-preview">${escapeHtml(text?`${text.slice(0,420)}${text.length>420?'…':''}`:'暂时没有可展示的正文')}</div></div>`;
    }
    const width=Math.max(0,...rows.slice(0,5).map(row=>(row||[]).filter(value=>String(value??'').trim()).length));
    if(width>=2){
      const previewRows=rows.slice(0,4),cols=Math.min(4,Math.max(2,width));
      return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>文件内容</strong><span>前 ${previewRows.length} 行</span></div><div class="nmda-inspector-mini-table">${previewRows.map((row,rowIndex)=>`<div class="nmda-inspector-mini-row${rowIndex===0?' is-head':''}" style="--preview-cols:${cols}">${Array.from({length:cols},(_,i)=>{const value=String(row?.[i]??'').trim()||'—';return `<span title="${escapeHtml(value)}">${escapeHtml(value.length>34?`${value.slice(0,34)}…`:value)}</span>`;}).join('')}</div>`).join('')}</div></div>`;
    }
    const text=rows.slice(0,8).flat().map(value=>String(value??'').trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>文件内容</strong><span>${escapeHtml(sourceFileTypeLabel(decision.file?.name||decision.sourceName))}</span></div><div class="nmda-inspector-text-preview">${escapeHtml(text?`${text.slice(0,420)}${text.length>420?'…':''}`:'暂时没有可展示的内容')}</div></div>`;
  }

  function sourceInspectorContentHtml(decision) {
    const items=decision.items||[],tasks=sourceTasksForDecision(decision);
    if(decision.purpose==='mail'&&!decision.needsReview&&tasks.length){
      const task=tasks[0],body=String(task.body||'').replace(/\s+/g,' ').trim();
      return `<div class="nmda-inspector-preview-block"><div class="nmda-inspector-preview-head"><strong>邮件内容</strong><span>${tasks.length>1?`共 ${tasks.length} 封`:'1 封邮件'}</span></div><div class="nmda-inspector-mail-fields"><div><span>收件人</span><strong>${escapeHtml(task.recipients||'尚未读取')}</strong></div><div><span>主题</span><strong>${escapeHtml(task.subject||'尚未读取')}</strong></div><div class="is-body"><span>正文</span><p>${escapeHtml(body?`${body.slice(0,520)}${body.length>520?'…':''}`:'尚未读取')}</p></div></div></div>`;
    }
    if(decision.purpose==='roster'&&!decision.needsReview)return sourceRosterPreviewHtml(decision);
    return sourceGenericPreviewHtml(decision);
  }

  function renderSourceInspector(decision) {
    const empty=$('nmda-source-inspector-empty'),card=$('nmda-source-inspector-card');if(!empty||!card)return;
    if(!decision){empty.hidden=false;card.hidden=true;return;}
    empty.hidden=true;card.hidden=false;
    const visual=sourceRoleVisual(decision.purpose,decision.needsReview),fileName=String(decision.sourceName||'').replace(/\\/g,'/').split('/').pop()||decision.sourceName;
    const title=$('nmda-source-inspector-title'),overview=$('nmda-source-inspector-overview'),content=$('nmda-source-inspector-content'),actions=$('nmda-source-inspector-actions');
    if(title)title.textContent='文件核验';
    if(overview){
      const reviewNote=decision.needsReview?`<div class="nmda-inspector-review-note"><span>!</span><div><strong>这个文件需要你决定用途</strong><small>${escapeHtml(sourceFriendlyReason(decision))}</small></div></div>`:'';
      overview.innerHTML=`<div class="nmda-inspector-file-title">${sourceFileIconHtml(fileName)}<div><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(sourceDirectoryPath(decision.sourceName)||'根目录')} · ${escapeHtml(humanFileSize(decision.file?.size))}</small></div></div>${reviewNote}`;
    }
    if(actions){
      const mountPurposeSelect=()=>{
        const selected=decision.needsReview?'review':decision.purpose;
        actions.innerHTML=`<label class="nmda-inspector-purpose-field" data-review="${decision.needsReview?'1':'0'}"><span><strong>${decision.needsReview?'请选择文件用途':'调整文件用途'}</strong><small>${decision.needsReview?'看过下方内容后选择即可':'仅当自动分类确实不对时修改'}</small></span><select data-inspector-purpose-select aria-label="修改当前文件用途">${sourcePurposeOptions(selected)}</select></label>`;
        actions.querySelector('[data-inspector-purpose-select]')?.addEventListener('change',event=>{const purpose=event.currentTarget.value;if(purpose==='review')setSourceNeedsReview(decision.sourceName);else setSourcePurpose(decision.sourceName,purpose);});
      };
      if(decision.needsReview)mountPurposeSelect();
      else{
        actions.innerHTML=`<div class="nmda-inspector-auto-purpose" data-tone="${escapeHtml(visual.tone)}"><span class="nmda-inspector-auto-purpose-icon">${escapeHtml(visual.icon)}</span><span><strong>已识别为${escapeHtml(visual.label)}</strong><small>无需选择格式；系统会按此用途继续。</small></span><button type="button" data-edit-source-purpose>分类有误</button></div>`;
        actions.querySelector('[data-edit-source-purpose]')?.addEventListener('click',mountPurposeSelect);
      }
    }
    if(content)content.innerHTML=sourceInspectorContentHtml(decision);
    const pending=uniqueFiles(batch.dataset?.sourceFiles||[]).map(sourcePurposeDecision).filter(item=>item.needsReview&&item.sourceName!==decision.sourceName),next=$('nmda-source-next-review');
    if(next){next.hidden=!pending.length;next.dataset.nextSource=pending[0]?encodeURIComponent(pending[0].sourceName):'';next.textContent=pending.length?`下一个待确认 · 还剩 ${pending.length} 个 →`:'下一个待确认 →';}
  }

  function inspectSourceInPreflight(sourceName) {
    const related=sourceCollections(sourceName,String(sourceName||'').split('/').pop()||''),primary=related.filter(({collection})=>!collection.meta?.supplemental),items=primary.length?primary:related;
    if(!items.length)return;
    batch.sourceInspectName=sourceName;
    const first=items.find(({index})=>ensureCollectionConfig(index)?.purpose==='mail')||items[0];
    configureCollection(first.index,false);
    renderPreflightSourceRoles();
  }

  function renderPreflightSourceRoles() {
    const details=$('nmda-preflight-source-routing'),list=$('nmda-preflight-source-routing-list'),summary=$('nmda-preflight-source-routing-summary'),chips=$('nmda-preflight-routing-chips'),dirNav=$('nmda-preflight-directory-nav');
    if(!details||!list||!summary)return;
    const files=uniqueFiles(batch.dataset?.sourceFiles||[]),decisions=files.map(sourcePurposeDecision);
    batch.preflightReviewOnly=false;
    const counts={mail:0,roster:0,attachment:0,ignored:0,review:0};
    for(const decision of decisions){if(decision.needsReview)counts.review++;else counts[decision.purpose]=(counts[decision.purpose]||0)+1;}
    const visible=sourceVisibleDecisions(decisions),folder=batch.preflightFolderPath||'',folderName=folder?folder.split('/').pop():'全部文件';
    const searchInput=$('nmda-preflight-source-search');if(searchInput&&searchInput.value!==String(batch.preflightSearch||''))searchInput.value=String(batch.preflightSearch||'');
    summary.textContent='文件列表';
    const subtitle=$('nmda-preflight-source-routing-subtitle');if(subtitle)subtitle.textContent=counts.review?`有 ${counts.review} 个待确认；点击文件查看内容并修改用途。`:'分类无误可直接继续。';
    const dirTitle=$('nmda-preflight-directory-title'),dirCount=$('nmda-preflight-directory-count');if(dirTitle)dirTitle.textContent=folderName;if(dirCount)dirCount.textContent=folder?`${visible.length}`:`${decisions.length}`;
    if(chips){
      const chip=(tone,label,count,icon)=>`<button type="button" data-preflight-filter="${tone}" data-tone="${tone}" class="${batch.preflightPurposeFilter===tone?'is-active':''}"><i>${icon}</i><span>${label}</span><b>${count}</b></button>`;
      chips.innerHTML=chip('mail','邮件',counts.mail,'✉')+chip('roster','总名单',counts.roster,'名')+chip('attachment','附件',counts.attachment,'附')+chip('review','待确认',counts.review,'!')+chip('ignored','暂不使用',counts.ignored,'×');
      chips.querySelectorAll('[data-preflight-filter]').forEach(button=>button.addEventListener('click',()=>{const value=button.dataset.preflightFilter||'';batch.preflightPurposeFilter=batch.preflightPurposeFilter===value?'':value;renderPreflightSourceRoles();}));
    }
    for(const key of Object.keys(counts)){const target=$('nmda-preflight-dropzones')?.querySelector(`[data-drop-count="${key}"]`);if(target)target.textContent=counts[key]||0;}
    if(dirNav){const tree=buildSourceFolderTree(decisions);dirNav.innerHTML=`<button class="nmda-classify-folder-row nmda-classify-folder-all${!batch.preflightFolderPath?' is-active':''}" type="button" data-preflight-folder=""><span class="nmda-classify-folder-icon">▦</span><span class="nmda-classify-folder-name">全部文件</span><b>${decisions.length}</b></button>${sourceFolderNavHtml(tree)}`;dirNav.querySelectorAll('[data-preflight-folder]').forEach(button=>button.addEventListener('click',()=>{batch.preflightFolderPath=decodeURIComponent(button.dataset.preflightFolder||'');renderPreflightSourceRoles();}));}
    details.hidden=!decisions.length;
    list.innerHTML=sourceFileRowsHtml(visible);
    list.querySelectorAll('[data-inspect-source]').forEach(row=>{
      row.addEventListener('click',event=>{if(event.target.closest('[data-source-drag]'))return;event.preventDefault();inspectSourceInPreflight(decodeURIComponent(row.dataset.inspectSource||''));});
      row.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();inspectSourceInPreflight(decodeURIComponent(row.dataset.inspectSource||''));});
    });
    list.querySelectorAll('[data-source-drag]').forEach(handle=>{
      handle.addEventListener('click',event=>event.stopPropagation());
      handle.addEventListener('dragstart',event=>{const source=decodeURIComponent(handle.dataset.sourceDrag||'');batch.sourceInspectName=source;event.dataTransfer?.setData('text/plain',source);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';handle.closest('.nmda-classify-file-row')?.classList.add('is-dragging');document.querySelector('.nmda-classify-dialog')?.classList.add('is-drag-classifying');});
      handle.addEventListener('dragend',()=>{handle.closest('.nmda-classify-file-row')?.classList.remove('is-dragging');document.querySelector('.nmda-classify-dialog')?.classList.remove('is-drag-classifying');});
    });
    const selected=decisions.find(item=>item.sourceName===batch.sourceInspectName);renderSourceInspector(selected||null);
  }

  function attachmentAssetRowsHtml(entries,{compact=false}={}) {
    const totalTasks=(batch.tasks||[]).filter(task=>task.enabled&&!task.policyBlocked).length;
    return (entries||[]).map(entry=>{
      const policy=entry.policy||ensureAttachmentPolicy(entry.file,entry.kind);
      const scope=policy.mode==='all'?`全部 ${totalTasks} 封`:policy.mode==='selected'?`指定 ${(policy.targets||[]).length} 封`:(entry.used?`自动匹配 ${entry.used} 封`:'自动匹配 · 尚未命中');
      const tone=policy.mode==='smart'&&!entry.used?'warn':'ok';
      const targetButton=policy.mode==='selected'?`<button class="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" data-attachment-target-config="${escapeHtml(encodeURIComponent(entry.identity))}">选择邮件</button>`:'';
      return `<div class="nmda-attachment-asset-row nmda-attachment-workspace-row${compact?' is-compact':''}" data-attachment-identity="${escapeHtml(encodeURIComponent(entry.identity))}"><span class="nmda-attachment-file-icon" aria-hidden="true">↗</span><div class="nmda-attachment-file-main"><strong title="${escapeHtml(entry.file.name||'附件')}">${escapeHtml(entry.file.name||'附件')}</strong><small>${escapeHtml(formatAttachmentSize(entry.file))} · ${escapeHtml(entry.source||'附件')}</small></div><div class="nmda-attachment-scope"><label><span>适用范围</span><select data-attachment-policy="${escapeHtml(encodeURIComponent(entry.identity))}"><option value="smart" ${policy.mode==='smart'?'selected':''}>自动匹配邮件需求</option><option value="all" ${policy.mode==='all'?'selected':''}>全部邮件</option><option value="selected" ${policy.mode==='selected'?'selected':''}>指定邮件…</option></select></label><span class="nmda-attachment-scope-state" data-tone="${tone}">${escapeHtml(scope)}</span></div><div class="nmda-attachment-asset-actions">${targetButton}<button class="nmda-text-action nmda-attachment-remove" type="button" data-attachment-remove="${escapeHtml(encodeURIComponent(entry.identity))}" aria-label="移除 ${escapeHtml(entry.file.name||'附件')}">移除</button></div></div>`;
    }).join('');
  }

  function attachmentRequirementOverview(){
    const map=new Map();
    for(const task of batch.tasks||[])for(const detail of task.attachmentDetails||[]){
      const key=Importer.normalizeFileKey(detail.ref);if(!key)continue;
      if(!map.has(key))map.set(key,{key,ref:String(detail.ref),total:0,matched:0,ambiguous:0,missing:0,files:new Set()});
      const item=map.get(key);item.total++;
      if(detail.status==='matched'){item.matched++;if(detail.file?.name)item.files.add(detail.file.name);}else if(detail.status==='ambiguous')item.ambiguous++;else item.missing++;
    }
    return [...map.values()];
  }

  function attachmentRequirementRowsHtml(){
    const items=attachmentRequirementOverview();if(!items.length)return '<div class="nmda-attachment-assets-empty">当前邮件没有点名附件要求。你仍可以把附件设置为“全部邮件”或“指定邮件”。</div>';
    const pool=allAttachmentFiles();
    return items.map(item=>{
      const complete=item.matched>=item.total,tone=complete?'ok':item.ambiguous?'warn':'danger';
      const status=complete?`已覆盖 ${item.matched}/${item.total}`:`待补 ${item.total-item.matched}/${item.total}`;
      let control='';
      if(!complete&&pool.length){
        const options=pool.map(file=>`<option value="${escapeHtml(Importer.fileIdentity(file))}">${escapeHtml(file.webkitRelativePath||file._nmdaPath||file.name)}</option>`).join('');
        control=`<select data-attachment-ref="${escapeHtml(item.key)}"><option value="">使用现有附件…</option>${options}</select>`;
      }
      return `<div class="nmda-attachment-requirement-row"><div><strong>${escapeHtml(item.ref)}</strong><small>${item.files.size?`已使用：${escapeHtml([...item.files].join('、'))}`:'邮件中明确要求此附件'}</small></div><span data-tone="${tone}">${escapeHtml(status)}</span>${control}</div>`;
    }).join('');
  }

  function renderAttachmentTargetEditor(){
    const wrap=$('nmda-attachment-target-editor'),list=$('nmda-attachment-target-list'),title=$('nmda-attachment-target-title'),search=$('nmda-attachment-target-search');if(!wrap||!list)return;
    const identity=batch.attachmentTargetEditing||'',file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===identity);
    if(!file){wrap.hidden=true;return;}
    const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));if(policy.mode!=='selected'){wrap.hidden=true;return;}
    wrap.hidden=false;if(title)title.textContent=`${file.name} · 指定邮件`;if(search&&search.value!==String(batch.attachmentTargetSearch||''))search.value=String(batch.attachmentTargetSearch||'');
    const q=normalizedSearchText(batch.attachmentTargetSearch||''),targets=new Set(policy.targets||[]);
    const tasks=(batch.tasks||[]).filter(task=>!q||normalizedSearchText([task.recipients,task.subject,task.school].join(' ')).includes(q));
    list.innerHTML=tasks.length?tasks.map(task=>`<label class="nmda-attachment-target-row"><input type="checkbox" data-attachment-target-task="${escapeHtml(encodeURIComponent(task.editKey))}" ${targets.has(task.editKey)?'checked':''}><span><strong>${escapeHtml(task.recipients||'未填写收件人')}</strong><small>${escapeHtml(task.subject||'无主题')}${task.school?` · ${escapeHtml(task.school)}`:''}</small></span></label>`).join(''):'<div class="nmda-attachment-assets-empty">没有匹配当前搜索的邮件。</div>';
    list.querySelectorAll('[data-attachment-target-task]').forEach(input=>input.addEventListener('change',()=>setAttachmentTarget(identity,decodeURIComponent(input.dataset.attachmentTargetTask||''),input.checked)));
  }

  function renderAttachmentAssetViews() {
    const entries=attachmentAssetEntries(),count=entries.length;
    const inline=$('nmda-preflight-attachment-assets'),inlineList=$('nmda-preflight-attachment-assets-list'),inlineCount=$('nmda-preflight-attachment-assets-count');
    if(inline){inline.hidden=!count;if(inlineList)inlineList.innerHTML=count?`<button class="nmda-attachment-assets-more" type="button" data-open-attachment-manager>${count} 个附件 · 打开工作台查看配置</button>`:'';if(inlineCount)inlineCount.textContent=`${count} 个`;}
    const manager=$('nmda-attachment-manager-overlay'),list=$('nmda-attachment-manager-list'),empty=$('nmda-attachment-manager-empty'),summary=$('nmda-attachment-manager-summary'),fileCount=$('nmda-attachment-manager-file-count');
    if(manager){manager.hidden=!batch.attachmentManagerOpen;manager.setAttribute('aria-hidden',batch.attachmentManagerOpen?'false':'true');}
    if(list)list.innerHTML=attachmentAssetRowsHtml(entries);
    if(fileCount)fileCount.textContent=`${count} 个`;
    if(empty)empty.hidden=!!count;
    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,matched:0,issues:0};
    const modes={smart:0,all:0,selected:0};for(const entry of entries)modes[entry.policy?.mode||'smart']=(modes[entry.policy?.mode||'smart']||0)+1;
    if(summary)summary.innerHTML=`<span><strong>${count}</strong><small>附件文件</small></span><span><strong>${stats.matched||0}/${stats.total||0}</strong><small>邮件要求已覆盖</small></span><span data-tone="${stats.issues?'warn':'ok'}"><strong>${stats.issues||0}</strong><small>仍待补</small></span><span><strong>${modes.smart}/${modes.all}/${modes.selected}</strong><small>自动 / 全部 / 指定</small></span>`;
    const req=$('nmda-attachment-manager-requirements'),reqCount=$('nmda-attachment-manager-requirements-count');if(req)req.innerHTML=attachmentRequirementRowsHtml();if(reqCount)reqCount.textContent=`${stats.total||0} 项`;
    list?.querySelectorAll('[data-attachment-policy]').forEach(select=>select.addEventListener('change',()=>{const id=decodeURIComponent(select.dataset.attachmentPolicy||'');setAttachmentPolicy(id,select.value);if(select.value==='selected'){batch.attachmentTargetEditing=id;batch.attachmentTargetSearch='';renderAttachmentAssetViews();}}));
    list?.querySelectorAll('[data-attachment-target-config]').forEach(button=>button.addEventListener('click',()=>{batch.attachmentTargetEditing=decodeURIComponent(button.dataset.attachmentTargetConfig||'');batch.attachmentTargetSearch='';renderAttachmentAssetViews();}));
    req?.querySelectorAll('select[data-attachment-ref]').forEach(select=>select.addEventListener('change',()=>{const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===select.value);if(file)batch.attachmentOverrides.set(select.dataset.attachmentRef,file);else batch.attachmentOverrides.delete(select.dataset.attachmentRef);rebuildTasks();renderAttachmentAssetViews();}));
    renderAttachmentTargetEditor();
    renderBatchPrepStrip();
    renderProcessGuide();
    syncModalState();
  }

  function openAttachmentManager() {
    if(!batch.dataset)return;
    setWorkbenchTab('batch');
    hideReviewWorkspaceWithoutStash();
    batch.supplementPreflightOpen=false;
    batch.uiStep=1;
    batch.attachmentManagerOpen=true;
    renderSupplementPreflight();
    renderAttachmentAssetViews();
    requestAnimationFrame(()=>$('nmda-attachment-manager-overlay')?.scrollIntoView?.({behavior:'smooth',block:'nearest'}));
  }
  function closeAttachmentManager() { batch.attachmentManagerOpen=false;batch.attachmentTargetEditing='';batch.attachmentTargetSearch='';renderAttachmentAssetViews(); }

  function removeAttachmentAsset(identity) {
    if(!identity)return;
    const keep=file=>Importer.fileIdentity(file)!==identity;
    batch.ignoredAttachmentIdentities.add(identity);
    batch.directoryFiles=(batch.directoryFiles||[]).filter(keep);batch.taskFiles=(batch.taskFiles||[]).filter(keep);batch.routedAttachmentFiles=(batch.routedAttachmentFiles||[]).filter(keep);
    batch.attachmentPolicies?.delete(identity);if(batch.attachmentTargetEditing===identity)batch.attachmentTargetEditing='';
    batch.attachmentPrepChoice=attachmentPreparedFileCount()?'added':(batch.supplementPreflightDone?'skipped':'pending');
    refreshFileIndex(false);renderSupplementPreflight();renderAttachmentAssetViews();
  }

  function clearAttachmentAssets() {
    for(const file of batch.routedAttachmentFiles||[])batch.ignoredAttachmentIdentities.add(Importer.fileIdentity(file));
    if(dirEl)dirEl.value='';if(taskFilesEl)taskFilesEl.value='';if(preSendMatchFilesEl)preSendMatchFilesEl.value='';if(preSendSharedFilesEl)preSendSharedFilesEl.value='';
    batch.directoryFiles=[];batch.taskFiles=[];batch.routedAttachmentFiles=[];batch.attachmentOverrides.clear();batch.attachmentPolicies=new Map();batch.attachmentTargetEditing='';
    batch.attachmentPrepChoice=batch.supplementPreflightDone?'skipped':'pending';refreshFileIndex(true);renderSupplementPreflight();renderAttachmentAssetViews();
  }

  function renderBatchPrepStrip() {
    const strip=$('nmda-batch-prep-strip');if(!strip)return;
    const hasBatch=!!batch.dataset&&!!(batch.tasks||[]).length;strip.hidden=!hasBatch;if(!hasBatch)return;
    const roster=$('nmda-prep-roster-state'),attachment=$('nmda-prep-attachment-state');
    const rState=rosterContextState(),aState=attachmentPreflightState(),rCount=referenceRosterCount(),aCount=attachmentPreparedFileCount(),stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
    if(roster){roster.dataset.state=rState;const strong=roster.querySelector('strong');if(strong)strong.textContent=rState==='added'?`${rCount} 条已加入`:rState==='skipped'?'未添加':'待确认';}
    if(attachment){attachment.dataset.state=aState;const strong=attachment.querySelector('strong');if(strong)strong.textContent=aCount?`${aCount} 个附件${stats.issues?` · ${stats.issues} 待匹配`:''}`:stats.issues?`${stats.issues} 项待补`:aState==='skipped'?'暂未添加':'待确认';}
    const manage=$('nmda-manage-attachments-strip');if(manage){manage.hidden=false;manage.textContent=aCount?'查看 / 修改':'准备附件';}
    const button=$('nmda-edit-batch-prep');if(button)button.textContent=supplementPreflightNeedsDecision()?'继续准备':'补充资料';
  }

  function setPlanningView(view = 'mails') {
    const next='mails';
    batch.planningView=next;
    const card=$('nmda-preview-card');
    if(card)card.dataset.planningView=next;
    ui.querySelectorAll('[data-planning-view]').forEach(button=>{
      const active=button.dataset.planningView===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-current',active?'page':'false');
    });
  }

  function openScheduleModal() {
    if(!dispatchTasks().length){
      setBatchStatus('执行池为空；请先从邮件审阅进入选择与排期。','warn');
      return;
    }
    const overlay=$('nmda-schedule-modal');
    if(!overlay)return;
    overlay.hidden=false;
    syncModalState();
    renderScheduleCenter();
    requestAnimationFrame(()=>scheduleTimeZoneEl?.focus?.({preventScroll:true}));
  }

  function closeScheduleModal({restoreFocus=true} = {}) {
    const overlay=$('nmda-schedule-modal');
    if(!overlay || overlay.hidden)return;
    overlay.hidden=true;
    syncModalState();
    if(restoreFocus)requestAnimationFrame(()=>{
      const target=batch?.rosterPlannerOpen?$('nmda-roster-planner-done'):$('nmda-open-schedule-modal');
      target?.focus?.({preventScroll:true});
    });
  }

  function setPreflightView(view = 'files') {
    const next=view==='support'?'support':'files';
    batch.preflightView=next;
    const workspace=$('nmda-supplement-preflight')?.querySelector('.nmda-classify-workspace');
    if(workspace)workspace.dataset.preflightView=next;
    ui.querySelectorAll('[data-preflight-view]').forEach(button=>{
      const active=button.dataset.preflightView===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-current',active?'step':'false');
    });
    ui.querySelectorAll('[data-preflight-panel]').forEach(panel=>{
      panel.hidden=panel.dataset.preflightPanel!==next;
    });
    const button=$('nmda-complete-supplement-preflight');
    if(button&&!button.textContent.includes('待确认'))button.textContent='完成分类';
  }

  function setSupportView(view = 'roster') {
    const next=view==='attachment'?'attachment':'roster';
    batch.supportView=next;
    const support=$('nmda-supplement-preflight')?.querySelector('.nmda-classify-support-view');
    if(support)support.dataset.supportView=next;
    ui.querySelectorAll('button[data-support-view]').forEach(button=>{
      const active=button.dataset.supportView===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-current',active?'page':'false');
    });
    ui.querySelectorAll('[data-support-pane]').forEach(pane=>{pane.hidden=pane.dataset.supportPane!==next;});
  }

  function renderSupplementPreflight() {
    const overlay=$('nmda-supplement-preflight');if(!overlay)return;
    const hasBatch=!!batch.dataset,visible=hasBatch&&!!batch.supplementPreflightOpen;
    overlay.hidden=!visible;overlay.setAttribute('aria-hidden',visible?'false':'true');syncModalState();
    renderBatchPrepStrip();
    if(!hasBatch)return;
    const sourceDecisions=uniqueFiles(batch.dataset?.sourceFiles||[]).map(sourcePurposeDecision),reviewCount=sourceDecisions.filter(item=>item.needsReview).length,taskCount=(batch.tasks||[]).length;
    const headIcon=overlay.querySelector('.nmda-supplement-head-icon'),kicker=overlay.querySelector('.nmda-supplement-kicker'),title=$('nmda-supplement-title');
    if(headIcon){const attention=!taskCount||reviewCount>0;headIcon.dataset.state=attention?'review':'ok';headIcon.textContent=attention?'!':'✓';}
    if(kicker)kicker.textContent=reviewCount?`${reviewCount} 个文件待确认`:'文件用途已整理';
    if(title)title.textContent='检查导入结果';
    const rosterBox=$('nmda-preflight-roster-box'),attachmentBox=$('nmda-preflight-attachment-box'),supplements=$('nmda-preflight-supplements');
    if(rosterBox)rosterBox.hidden=false;if(attachmentBox)attachmentBox.hidden=true;if(supplements)supplements.hidden=false;
    setPreflightView(batch.preflightView||'files');
    setSupportView('roster');
    const completeButton=$('nmda-complete-supplement-preflight');if(completeButton)completeButton.textContent=reviewCount?`处理 ${reviewCount} 个待确认`:'完成分类';

    const rState=rosterContextState(),rCount=referenceRosterCount();
    const rBox=$('nmda-preflight-roster-box'),rTitle=$('nmda-preflight-roster-title'),rCopy=$('nmda-preflight-roster-copy'),rStatus=$('nmda-preflight-roster-status'),rSkip=$('nmda-preflight-roster-skip');
    if(rBox)rBox.dataset.state=rState;
    if(rTitle)rTitle.textContent=rState==='added'?`参考总名单 · ${rCount} 条`:'参考总名单';
    if(rCopy)rCopy.textContent=rState==='added'?'名单已加入。':'已有总名单时可加入。';
    if(rStatus)rStatus.textContent=rState==='added'?`已加入 ${rCount} 条`:rState==='skipped'?'本批次未使用':'尚未添加';
    if(rSkip){rSkip.hidden=rState==='added';rSkip.textContent=rState==='skipped'?'已跳过':'跳过';}

    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,matched:0,issues:0};
    const aState=attachmentPreflightState(),aCount=attachmentPreparedFileCount(),refs=attachmentRequirementRefs();
    const aBox=$('nmda-preflight-attachment-box'),aTitle=$('nmda-preflight-attachment-title'),aCopy=$('nmda-preflight-attachment-copy'),aStatus=$('nmda-preflight-attachment-status'),aReq=$('nmda-preflight-attachment-requirements'),aSkip=$('nmda-preflight-attachment-skip');
    if(aBox)aBox.dataset.state=aState;
    if(aTitle)aTitle.textContent=stats.total?`附件工作台 · ${stats.total} 项邮件要求`:'附件工作台';
    if(aCopy)aCopy.textContent=stats.total?`统一查看文件、匹配状态和发送范围。`:'需要附件时直接在工作台拖入并配置。';
    if(aReq){aReq.innerHTML=refs.length?refs.slice(0,3).map(ref=>`<span>${escapeHtml(ref)}</span>`).join('')+(refs.length>3?`<span>+${refs.length-3}</span>`:''):'';aReq.hidden=!refs.length;}
    if(aStatus)aStatus.textContent=aCount?`${aCount} 个文件${stats.issues?` · ${stats.issues} 项待处理`:' · 当前要求已覆盖'}`:aState==='skipped'?'本批次暂未添加':stats.issues?`${stats.issues} 项待补`:'尚未添加';
    if(aSkip){aSkip.hidden=!!aCount;aSkip.textContent=aState==='skipped'?'已跳过':'暂不添加';}

    renderAttachmentAssetViews();renderPreflightSourceRoles();
    const batchSummary=$('nmda-preflight-batch-summary');if(batchSummary){const currentTaskCount=(batch.tasks||[]).length;batchSummary.textContent=reviewCount?`${reviewCount} 个文件待确认`:currentTaskCount?'分类已确认，可以继续':'还没有识别到邮件，请调整文件用途';}
    if(visible&&!batch.sourceInspectName&&sourceDecisions.length&&window.matchMedia('(min-width: 821px)').matches){const first=sourceDecisions.find(item=>item.needsReview)||sourceDecisions[0];requestAnimationFrame(()=>{if(batch.supplementPreflightOpen&&!batch.sourceInspectName)inspectSourceInPreflight(first.sourceName);});}
  }

  function openSupplementPreflight(view = 'files') {
    if(!batch.dataset)return;
    batch.preflightView=view==='support'?'support':'files';
    batch.supplementPreflightOpen=true;
    renderSupplementPreflight();
  }

  function completeSupplementPreflight() {
    if(!batch.dataset)return;
    if(rosterContextState()==='pending')batch.rosterPromptChoice='skipped';
    batch.supplementPreflightDone=true;batch.supplementPreflightOpen=false;
    renderImportLifecycleState();scheduleBatchRender({aux:true,force:true});
    const mailPending=typeof reviewTasks==='function'?reviewTasks().length:0;
    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{issues:0};
    const hasTasks=!!(batch.tasks||[]).length;
    if(!hasTasks){setImportStatus('资料检查已完成，但当前仍没有可创建邮件。可继续调整资料用途或追加邮件资料。','warn');return;}
    if(stats.issues){
      batch.uiStep=1;renderProcessGuide();
      setImportStatus(`导入资料已整理；还有 ${stats.issues} 项附件要求待处理。附件在导入阶段统一完成。`,'warn');
      openAttachmentManager();
      return;
    }
    const duplicatePending=unresolvedDuplicateGroupCount();
    if(duplicatePending){
      batch.uiStep=1;renderProcessGuide();renderRosterAudit();
      setImportStatus(`文件分类已完成；发现 ${duplicatePending} 项查重待处理，请先完成批次版本取舍或历史筛选。`,'warn');
      requestAnimationFrame(()=>$('nmda-roster-audit-card')?.scrollIntoView?.({block:'nearest',behavior:'smooth'}));
      return;
    }
    batch.uiStep=1;
    renderProcessGuide();
    const missingCount=missingSubjectTasks().length;
    if(missingCount>=3)setImportStatus(`导入准备已完成。邮件审阅可用；其中 ${missingCount} 封缺少主题。`,'warn');
    else if(mailPending)setImportStatus('导入准备已完成。邮件审阅可用。','ok');
    else setImportStatus('导入准备已完成。后续阶段可查看；执行资格按当前状态判断。','ok');
    renderImportHandoff();
    scheduleReadyBatchAutoHandoff('导入准备已完成');
  }

  function renderRosterContextCue() {
    const cue=$('nmda-roster-context-cue');if(!cue)return;
    const state=rosterContextState();cue.dataset.state=state;
    const eyebrow=$('nmda-roster-context-eyebrow'),title=$('nmda-roster-context-title'),copy=$('nmda-roster-context-copy'),status=$('nmda-roster-source-status'),upload=$('nmda-roster-upload-action'),skip=$('nmda-roster-skip'),remove=$('nmda-roster-remove'),benefits=$('nmda-roster-context-benefits');
    const count=referenceRosterCount();
    if(status)status.hidden=true;
    if(benefits)benefits.hidden=true;
    if(upload){upload.classList.toggle('nmda-btn-primary',state==='pending'||state==='prepare');upload.classList.toggle('nmda-btn-quiet',state==='added'||state==='skipped');}
    if(state==='prepare'){
      if(eyebrow)eyebrow.textContent='可选 · 参考名单';
      if(title)title.textContent='有参考总名单？可以一起加入';
      if(copy)copy.textContent='加入后会自动与当前及后续导入邮件匹配；没有也可以继续。';
      if(upload)upload.textContent='上传参考总名单';
      if(skip)skip.hidden=true;if(remove)remove.hidden=true;
    }else if(state==='pending'){
      if(eyebrow)eyebrow.textContent='可选增强';
      if(title)title.textContent='参考总名单可减少重复联系';
      if(copy)copy.textContent='用于匹配导入邮件、补全联系人信息；没有可直接跳过。';
      if(upload)upload.textContent='上传总名单';
      if(skip){skip.hidden=false;skip.textContent='暂不添加';}if(remove)remove.hidden=true;
    }else if(state==='added'){
      if(eyebrow)eyebrow.textContent='已加入';
      if(title)title.textContent=`参考总名单 · ${count} 条`;
      if(copy)copy.textContent='已加入本批次。';
      if(upload)upload.textContent='补充名单';
      if(skip)skip.hidden=true;if(remove){remove.hidden=false;remove.textContent='移除';}
    }else{
      if(eyebrow)eyebrow.textContent='已跳过';
      if(title)title.textContent='未使用参考总名单';
      if(copy)copy.textContent='需要时可随时补充。';
      if(upload)upload.textContent='补充名单';
      if(skip)skip.hidden=true;if(remove)remove.hidden=true;
    }
  }

  function renderImportLifecycleState() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const active = !!batch.dataset || !!batch.importBusy || !!batch.roster?.entries?.length;
    if (resetImportEl) resetImportEl.hidden = !active;
    if (importBusyBadgeEl) importBusyBadgeEl.hidden = !batch.importBusy;
    const savedBadge=$('nmda-workspace-saved-badge');if(savedBadge)savedBadge.hidden=!batch.dataset;
    const sourceCard = $('nmda-import-card');
    if (sourceCard) {
      sourceCard.dataset.busy = batch.importBusy ? '1' : '0';
      sourceCard.dataset.loaded = batch.dataset ? '1' : '0';
      const title = $('nmda-import-card-title');
      const desc = $('nmda-import-card-desc');
      if (title) title.textContent = batch.dataset ? '邮件资料已导入' : '导入邮件资料';
      if (desc) desc.textContent = batch.dataset
        ? '邮件资料已加入，可继续添加或进入批次资料。'
        : '把本批次邮件资料放进来。';
      const fileAction=ui.querySelector('label.nmda-source-action[for="nmda-import-file"] strong');
      const dirAction=ui.querySelector('label.nmda-source-action[for="nmda-import-dir"] strong');
      const pasteAction=$('nmda-show-paste')?.querySelector('strong');
      if(fileAction)fileAction.textContent=batch.dataset?'添加文件':'选择文件';
      if(dirAction)dirAction.textContent=batch.dataset?'添加文件夹':'选择文件夹';
      if(pasteAction)pasteAction.textContent=batch.dataset?'粘贴补充':'粘贴内容';
    }
    const workbench = ui.querySelector('.nmda-bulk-workbench');
    if (workbench) {
      workbench.dataset.phase = !batch.dataset ? 'empty' : (batch.handoffComplete ? 'ready' : 'review');
      if(!batch.dataset)batch.uiStep=1;
    }
    const prepButton=$('nmda-open-supplement-preflight');if(prepButton)prepButton.hidden=!batch.dataset;
    renderRosterContextCue();
    renderBatchPrepStrip();
    renderSupplementPreflight();
    renderAttachmentAssetViews();
  }

  function beginImportSession(message) {
    const append=!!batch.dataset;
    batch.importAppendMode=append;
    if(append){
      // A new import is additive by default. Never erase the existing working set just
      // because the operator chooses another file five minutes later.
      batch.sessionId += 1;
      batch.importBusy = true;
    }else{
      // The reference roster is an independent master-data source. Starting the first
      // mail import may keep a roster that was loaded before the mail files.
      const previousRoster=rosterState();
      const keepRoster = previousRoster.manualEntries?.length ? emptyRosterState({
        dataset:previousRoster.dataset,datasets:[...(Array.isArray(previousRoster.datasets)&&previousRoster.datasets.length?previousRoster.datasets:(previousRoster.dataset?[previousRoster.dataset]:[]))],manualEntries:[...previousRoster.manualEntries],entries:[...previousRoster.manualEntries],manualWarnings:[...(previousRoster.manualWarnings||[])],warnings:[...(previousRoster.manualWarnings||[])],manualSourceNames:[...(previousRoster.manualSourceNames||[])],sourceNames:[...(previousRoster.manualSourceNames||[])],enabled:previousRoster.enabled!==false,autoSchool:previousRoster.autoSchool!==false,strict:!!previousRoster.strict
      }) : null;
      resetImportWorkspace({ keepStatus: true, invalidate: true });
      if (keepRoster) {
        batch.roster = keepRoster;
        batch.rosterPromptChoice='added';
        syncRosterParts();
        renderRosterAudit();
      }
      batch.importBusy = true;
    }
    const token = batch.sessionId;
    if(schedulerCardEl)schedulerCardEl.open=true;
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent='收起';
    renderImportLifecycleState();
    setImportStatus(append ? `正在追加：${message || '读取新来源…'}` : (message || '正在读取来源…'));
    return token;
  }

  function finishImportSession(token) {
    if (!isCurrentBatchSession(token)) return false;
    batch.importBusy = false;
    batch.importAppendMode = false;
    renderImportLifecycleState();
    scheduleWorkspacePersist();
    return true;
  }

  function recordSets() { return batch.dataset?.recordSets || batch.dataset?.sheets || []; }

  function currentCollection() { return recordSets()[batch.collectionIndex] || null; }

  function ensureCollectionConfig(index, { reset = false } = {}) {
    const collection = recordSets()[Number(index) || 0];
    if (!collection) return null;
    let config = batch.collectionConfigs.get(Number(index) || 0);
    if (!config || reset) {
      const detection = Importer.detectHeader(collection.rows || []);
      const classified=String(collection.meta?.sourcePurpose||'ambiguous');
      const purpose=['mail','roster','attachment','ignored'].includes(classified)?classified:'ignored';
      config = { purpose, enabled: purpose==='mail', detection, mapping: { ...detection.mapping } };
      batch.collectionConfigs.set(Number(index) || 0, config);
    }
    return config;
  }

  function taskEditKey(collectionIndex, rowIndex) { return `${collectionIndex}:${rowIndex}`; }

  function sourceFileName(file) {
    return String(file?.webkitRelativePath || file?._nmdaPath || file?.name || '未命名来源');
  }

  function humanFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function formatDisplayName(format) {
    const map = {
      'xlsx':'Excel / XLSX', 'ods':'OpenDocument / ODS', 'fods':'Flat ODS',
      'docx':'Word / DOCX', 'json':'JSON', 'ndjson':'JSONL / NDJSON',
      'delimited':'分隔文本', 'vertical-text':'字段式文本', 'html':'HTML 表格',
      'spreadsheetml':'Excel XML', 'mail-text':'邮件文本', 'mailbox-drafts':'网易草稿箱', 'attachment':'附件资料', 'nmda-zip':'ZIP 批次', 'multi':'混合来源'
    };
    return map[String(format || '').toLowerCase()] || String(format || '自动识别').toUpperCase();
  }

  function collectionKind(collection,overridePurpose='') {
    const meta = collection?.meta || {};
    const format = String(meta.format || batch.dataset?.format || '').toLowerCase();
    const purpose=String(overridePurpose||meta.sourcePurpose||'');
    if(purpose==='roster')return {label:'总名单',icon:'人',tone:'roster'};
    if(purpose==='attachment')return {label:'附件候选',icon:'⇧',tone:'attachment'};
    if(purpose==='ignored')return {label:'未使用资料',icon:'—',tone:'ignored'};
    if(purpose==='ambiguous')return {label:'待分类资料',icon:'?',tone:'ambiguous'};
    if (meta.mailboxDrafts) return { label:'草稿箱邮件', icon:'✉', tone:'mail' };
    if (meta.mailFrames) return { label:'邮件内容', icon:'✉', tone:'mail' };
    if(purpose==='mail')return {label:'邮件任务',icon:'✉',tone:'mail'};
    if (meta.word) {
      if (meta.merged) return { label:'Word 邮件批次', icon:'W', tone:'word' };
      if (meta.kind === 'table') return { label:'Word 表格', icon:'W', tone:'word' };
      if (meta.kind === 'records') return { label:'Word 字段记录', icon:'W', tone:'word' };
      if (meta.kind === 'document') return { label:'Word 文档邮件', icon:'W', tone:'word' };
      return { label:'Word 内容', icon:'W', tone:'word' };
    }
    if (format.includes('json')) return { label:'JSON 记录', icon:'{}', tone:'json' };
    if (format === 'vertical-text') return { label:'字段式文本', icon:'¶', tone:'text' };
    if (format === 'delimited') return { label:'文本记录', icon:'≡', tone:'text' };
    if (format === 'html') return { label:'HTML 表格', icon:'<>', tone:'web' };
    if (format === 'spreadsheetml') return { label:'XML 记录', icon:'XML', tone:'xml' };
    if (meta.package) return { label:'批次包内容', icon:'ZIP', tone:'package' };
    if (['xlsx','ods','fods'].includes(format)) return { label:'表格记录', icon:'▦', tone:'table' };
    return { label:'标准化记录', icon:'◇', tone:'default' };
  }

  function renderSourceInventory() {
    const box = $('nmda-source-inventory');
    if (!box) return;
    const dataset = batch.dataset;
    if (!dataset) { box.hidden = true; box.innerHTML = ''; return; }
    const sets = recordSets();
    const sources = [...(dataset.sourceFiles || [])];
    const containerFiles=[...(dataset.meta?.containerFiles||[])];
    const duplicateSourceCount=Number(dataset.meta?.duplicateSourceCount||0);
    const embeddedCount = (dataset.embeddedFiles || []).length;
    const warnings = dataset.warnings || [];
    const purposeLabel=purpose=>({mail:'邮件',roster:'参考名单',attachment:'附件',ignored:'未使用'}[purpose]||'未使用');
    const sourceRows = sources.length ? sources.map((file, index) => {
      const name = sourceFileName(file);
      const related = sets.map((rs,setIndex)=>({rs,setIndex})).filter(({rs}) => {
        const members=rs.meta?.sourceMembers||[];return String(rs.source||'')===String(file.name||'')||String(rs.source||'')===name||members.includes(file.name)||members.includes(name);
      });
      const purposes=[...new Set(related.map(({setIndex})=>ensureCollectionConfig(setIndex)?.purpose||'ignored'))];
      const formats = [...new Set(related.map(({rs}) => rs.meta?.format).filter(Boolean))];
      const format = formats.length ? formats.map(formatDisplayName).join(' + ') : formatDisplayName(dataset.format);
      const roleText=purposes.length?purposes.map(purposeLabel).join(' + '):'来源文件';
      const firstRelated=related.find(({rs})=>!rs.meta?.supplemental)||related[0];const kind=collectionKind(firstRelated?.rs,firstRelated?ensureCollectionConfig(firstRelated.setIndex)?.purpose:'ignored');
      const confidence=Number(firstRelated?.rs?.meta?.purposeConfidence||0),decision=confidence?` · ${roleConfidenceText(confidence)}`:'';
      return `<div class="nmda-source-item"><div class="nmda-source-item-icon">${escapeHtml(kind.icon)}</div><div class="nmda-source-item-main"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small>${escapeHtml(format)} · ${humanFileSize(file.size)}${escapeHtml(decision)}</small></div><span class="nmda-source-purpose" data-purpose="${escapeHtml(purposes[0]||'ignored')}">${escapeHtml(roleText)}</span><span class="nmda-source-item-index">${index + 1}</span></div>`;
    }).join('') : `<div class="nmda-source-item"><div class="nmda-source-item-icon">◇</div><div class="nmda-source-item-main"><strong>粘贴内容</strong><small>${escapeHtml(formatDisplayName(dataset.format))}</small></div></div>`;
    const fileCount=sources.length || (containerFiles.length?0:1);
    const taskCount=(batch.tasks||[]).length;
    const rosterCount=referenceRosterCount();
    const attachmentStats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
    const summaryParts=[containerFiles.length?`资料包 ${containerFiles.length} 个`:'',fileCount?`内容文件 ${fileCount} 个`:'',taskCount?`${taskCount} 封邮件`:''];
    if(rosterCount)summaryParts.push(`参考名单 ${rosterCount} 条`);
    if(duplicateSourceCount)summaryParts.push(`已忽略 ${duplicateSourceCount} 个重复副本`);
    if(attachmentStats.issues)summaryParts.push(`${attachmentStats.issues} 个附件待补`);
    const containerHtml=containerFiles.length?`<div class="nmda-source-container-note"><span>ZIP</span><div><strong>${escapeHtml(containerFiles.map(file=>file.name||'资料包').join('、'))}</strong><small>已自动展开；资料包只是容器，不参与“邮件 / 总名单 / 附件”用途选择。</small></div></div>`:'';
    const dedupeHtml=duplicateSourceCount?`<div class="nmda-source-detail-note is-dedupe">检测到 ${duplicateSourceCount} 个内容完全相同的重复来源，已在解析前自动合并，不会进入邮件查重。</div>`:'';
    const warningHtml = warnings.length ? `<details class="nmda-ingest-warnings"><summary>读取细节（${warnings.length}）</summary>${warnings.slice(0,20).map(w => `<div>${escapeHtml(w)}</div>`).join('')}${warnings.length > 20 ? `<div>另有 ${warnings.length - 20} 条未展开。</div>` : ''}</details>` : '';
    box.innerHTML = `<details class="nmda-source-inventory-details"><summary><span><strong>导入详情</strong><small>${summaryParts.filter(Boolean).join(' · ')}</small></span><span class="nmda-source-inventory-open">查看</span></summary>${containerHtml}<div class="nmda-source-list">${sourceRows}</div>${dedupeHtml}${embeddedCount?`<div class="nmda-source-detail-note">已从资料包中加入 ${embeddedCount} 个附件文件。</div>`:''}${warningHtml}</details>`;
    box.hidden = false;
  }

  function recipientLooksValid(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const direct=/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}(?![A-Z0-9.\-])/i.test(raw);
    if (direct) return true;
    const parsed = Operations?.parseRecipients?.(raw) || [];
    return parsed.some(item => /@/.test(String(item?.email || item || '')));
  }

  function isAutoResolvableReviewIssue(issue) {
    const text=String(issue||'');
    return /^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(text)
      || /未定位收件人|主题为空|正文过短/.test(text);
  }

  function effectiveImportConfidence(task) {
    let score=Number(task?.importConfidence||0);
    const issues=(task?.importIssues||[]).map(issue=>String(issue||''));
    if(String(task?.subject||'').trim() && issues.some(issue=>/主题为空|未找到 Subject/.test(issue))) score+=30;
    if(recipientLooksValid(task?.recipients||'') && issues.some(issue=>/未定位收件人|无收件人/.test(issue))) score+=15;
    if(String(task?.body||'').trim().length>=80 && issues.some(issue=>/正文过短/.test(issue))) score+=6;
    return Math.max(0,Math.min(100,score));
  }

  function isFollowUpReviewTask(task) {
    return task?.reviewKind === 'follow_up' || task?.sourceKind === 'follow-up-review';
  }

  function followUpSubjectValid(task, value = task?.subject) {
    if(!isFollowUpReviewTask(task) || task?.composeMode!=='new')return true;
    return !!String(value||'').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i,'').trim();
  }

  function followUpReviewAdapter(task) {
    if (!task || task.kind !== 'follow_up') return null;
    const parent=operationState.store?.outboundRecords?.[task.parentOutboundId] || null;
    const recipients=(task.recipients||[]).map(item=>item?.name?`${item.name} <${item.email}>`:item?.email).filter(Boolean).join('; ');
    const reviewed=!!task.reviewedAt && Number(task.confirmedVersion)===Number(task.contentVersion);
    return {
      reviewKind:'follow_up', sourceKind:'follow-up-review', derivedTaskId:task.id,
      editKey:`fu-review:${task.id}`, id:`Follow-up #${Math.max(1,Number(task.sequence||1))}`,
      collectionName:'Follow-up', recipients, subject:String(task.subject||parent?.subject||''), body:String(task.body||''), bodyHtml:String(task.bodyHtml||''), bodyIsHtml:task.bodyIsHtml===true,
      composeMode:task.composeMode||'forward', sequence:Number(task.sequence||1), reviewConfirmed:reviewed,
      reviewDecision:String(task.reviewDecision||''), reviewDraftPending:false, importExcluded:false, importConfidence:100, importIssues:[], rosterIssues:[], errors:[],
      policyBlocked:task.state==='blocked'||!!task.blocker, attachmentRefs:[], scheduleAt:String(task.dispatch?.scheduleAt||''), tags:['Follow-up'],
      sourceFile:'Follow-up 模板生成',
      generatedFromTemplateVersion:Number(task.generatedFromTemplateVersion||0), personalization:task.personalization||{},
      _derivedState:task.state, _dispatchQueued:task.dispatch?.queued===true, _rawDerivedTask:task,
      _searchStatic:[recipients,task.subject,task.body,`Follow-up ${task.sequence||''}`].join(' ').toLocaleLowerCase('zh-CN')
    };
  }

  function followUpReviewTasks() {
    if(!operationState.loaded || !operationState.store?.derivedTasks)return [];
    return Object.values(operationState.store.derivedTasks)
      .filter(task=>task?.kind==='follow_up' && !task.draftPreparedAt && !['sent','cancelled','blocked'].includes(task.state))
      .map(followUpReviewAdapter).filter(Boolean)
      .sort((a,b)=>String(a._rawDerivedTask?.createdAt||'').localeCompare(String(b._rawDerivedTask?.createdAt||'')));
  }

  function initialReviewGateReady() {
    if(!batch.dataset)return false;
    const duplicatePending=typeof unresolvedDuplicateGroupCount==='function'?Number(unresolvedDuplicateGroupCount()||0):0;
    const attachmentIssues=typeof importAttachmentStats==='function'?Number(importAttachmentStats().issues||0):0;
    const contextPending=typeof supplementPreflightNeedsDecision==='function'&&supplementPreflightNeedsDecision();
    return !duplicatePending&&!attachmentIssues&&!contextPending;
  }

  function allReviewTasks() {
    const initial=initialReviewGateReady()?(batch.tasks||[]).filter(task=>!task?.importExcluded):[];
    return [...initial,...followUpReviewTasks()];
  }

  function reviewTaskByKey(key) {
    return allReviewTasks().find(task=>String(task.editKey)===String(key)) || null;
  }

  function unresolvedImportIssues(task) {
    const out=[];
    if(isFollowUpReviewTask(task)){
      if(!String(task?.recipients||'').trim())out.push('缺少收件人');
      else if(!recipientLooksValid(task.recipients))out.push('收件人邮箱格式无效');
      if(task?.composeMode==='new' && !followUpSubjectValid(task))out.push('缺少主题');
      if(!String(task?.body||'').trim())out.push('缺少正文');
      if(task?.policyBlocked)out.push('Follow-up 已阻断');
      if(!task?.reviewConfirmed && !out.includes('请检查 Follow-up 内容'))out.push('请检查 Follow-up 内容');
      return out;
    }
    const effectiveConfidence=effectiveImportConfidence(task);
    if (!String(task?.recipients||'').trim()) out.push('缺少收件人');
    else if (!recipientLooksValid(task.recipients)) out.push('收件人邮箱格式无效');
    if (!String(task?.subject||'').trim()) out.push('缺少主题');
    if (!String(task?.body||'').trim()) out.push('缺少正文');
    // Human confirmation is scoped: deterministic missing fields disappear as soon as they are fixed.
    // Only ambiguous parsing / manual edits / roster conflicts require an explicit confirmation.
    if (!task?.reviewConfirmed) {
      if (effectiveConfidence && effectiveConfidence < 70) out.push('请检查邮件内容');
      for (const issue of task?.importIssues || []) {
        if (/未定位收件人/.test(issue) && task.recipients) continue;
        if (/主题为空|未找到 Subject/.test(issue) && task.subject) continue;
        if (/正文过短/.test(issue) && String(task.body||'').length>=40) continue;
        if (/置信度/.test(issue) && effectiveConfidence>=70) continue;
        if (/未找到邮件落款|未找到邮件称呼/.test(issue) && effectiveConfidence >= 80) continue;
        if (!out.includes(issue)) out.push(issue);
      }
    }
    if (task?.reviewDraftPending && !out.includes('修改待确认')) out.push('修改待确认');
    if (!task?.rosterConfirmed) for (const issue of task?.rosterIssues || []) if (!out.includes(issue)) out.push(issue);
    return out;
  }

  function taskIssueState(task) {
    const reviewIssues=unresolvedImportIssues(task);
    const content=reviewIssues.filter(isAutoResolvableReviewIssue);
    const review=reviewIssues.filter(issue=>!isAutoResolvableReviewIssue(issue));
    const attachment=[]; const schedule=[]; const policy=[]; const other=[];
    for(const error of task?.errors||[]){
      const text=String(error||'');
      if(/^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(text))continue;
      if(/^缺少附件：|^附件同名冲突：/.test(text)){attachment.push(text);continue;}
      if(/^定时时间无法识别：/.test(text)){schedule.push(text);continue;}
      if(/^联系策略：/.test(text)){policy.push(text);continue;}
      if((task?.rosterIssues||[]).includes(text))continue;
      other.push(text);
    }
    return {content,review,attachment,schedule,policy,other,reviewIssues};
  }

  function taskNeedsImportReview(task) { return !task?.importExcluded && unresolvedImportIssues(task).length > 0; }
  function taskCoreValid(task) { return recipientLooksValid(task?.recipients||'') && (isFollowUpReviewTask(task) ? followUpSubjectValid(task) : !!String(task?.subject||'').trim()) && !!String(task?.body||'').trim() && !task?.policyBlocked; }
  function directCorrectionFields(task) {
    if(!task || task?.importExcluded)return [];
    const issues=unresolvedImportIssues(task);
    const issueText=issues.join('；');
    const fields=[];
    if(!recipientLooksValid(task?.recipients||'') && /收件人|邮箱/.test(issueText))fields.push('recipients');
    if(!String(task?.subject||'').trim() && /主题|Subject/.test(issueText))fields.push('subject');
    if(!String(task?.body||'').trim() && /正文/.test(issueText))fields.push('body');
    return fields;
  }
  function taskNeedsDirectCorrection(task) { return directCorrectionFields(task).length>0; }
  function unresolvedDuplicateGroups(task) {
    if(!task)return [];
    const confirmed=new Set(task.duplicateConfirmedGroups||[]);
    const ids=new Set(task.duplicateGroupIds||[]);
    return (batch.duplicateAudit?.groups||[]).filter(group=>ids.has(group.id)&&!confirmed.has(group.id));
  }
  function taskNeedsExplicitConfirmation(task) {
    if(!task || task.importExcluded)return false;
    const issues=unresolvedImportIssues(task);
    return !!task.reviewDraftPending || issues.some(issue=>!isAutoResolvableReviewIssue(issue));
  }
  // Duplicate groups require an explicit group decision. They must never disappear through the
  // generic "confirm selected" path, otherwise users can accidentally keep every duplicate.
  function taskCanBatchConfirm(task) { return taskCoreValid(task) && taskNeedsExplicitConfirmation(task); }
  function taskHasBlockingIssue(task) {
    if(!task || task.importExcluded || task.policyBlocked)return false;
    const state=taskIssueState(task);
    return state.content.length>0 || state.review.length>0 || state.attachment.length>0 || state.schedule.length>0 || state.other.length>0;
  }
  function taskHasPrePlanningBlocker(task) {
    if(!task || task.importExcluded || task.policyBlocked)return false;
    const state=taskIssueState(task);
    return state.content.length>0 || state.review.length>0 || state.other.length>0;
  }

  function excludedImportCount() {
    let count=0;
    for (const edit of batch.taskEdits.values()) if (edit?.importExcluded) count++;
    return count;
  }


  function excludedImportItems() {
    const items=[];
    const sets=recordSets();
    for(const [editKey,edit] of batch.taskEdits.entries()){
      if(!edit?.importExcluded)continue;
      const match=String(editKey||'').match(/^(\d+):(\d+)$/);
      if(!match){items.push({editKey:String(editKey||''),id:String(edit?.id||''),recipients:String(edit?.recipients||''),subject:String(edit?.subject||''),sourceFile:''});continue;}
      const collectionIndex=Number(match[1]),rowIndex=Number(match[2]);
      const collection=sets[collectionIndex]||null;
      const config=collection?ensureCollectionConfig(collectionIndex):null;
      const row=collection?.rows?.[rowIndex]||[];
      const mapping=config?.mapping||{};
      const getValue=field=>mapping[field]==null?'':(row?.[mapping[field]]??'');
      const rowMeta=collection?.meta?.rowMeta?.[rowIndex]||null;
      const sourceFile=String(rowMeta?.sourceFile||(collection?.meta?.wordTaskRows?row?.[8]:'')||collection?.source||'').trim();
      const recipients=String(edit.recipients!=null?edit.recipients:getValue('recipients')).trim();
      const subject=String(edit.subject!=null?edit.subject:getValue('subject')).trim();
      const id=String(edit.id!=null?edit.id:getValue('id')).trim()||`${collectionIndex+1}-${rowIndex+1}`;
      items.push({editKey:String(editKey),id,recipients,subject,sourceFile});
    }
    return items.sort((a,b)=>String(a.subject||a.recipients||a.id).localeCompare(String(b.subject||b.recipients||b.id),'zh-CN'));
  }

  function renderReviewTrash() {
    const items=excludedImportItems();
    const details=$('nmda-review-trash');
    const countEl=$('nmda-review-trash-count');
    const listEl=$('nmda-review-trash-list');
    const emptyEl=$('nmda-review-trash-empty');
    const restoreAll=$('nmda-review-trash-restore-all');
    if(countEl){countEl.textContent=String(items.length);countEl.dataset.empty=items.length?'0':'1';}
    if(details)details.dataset.empty=items.length?'0':'1';
    if(restoreAll)restoreAll.disabled=!items.length;
    if(emptyEl)emptyEl.hidden=!!items.length;
    if(listEl){
      listEl.innerHTML=items.map(item=>{
        const primary=String(item.subject||item.recipients||item.id||'已排除邮件').trim();
        const secondary=[item.recipients&&item.recipients!==primary?item.recipients:'',item.sourceFile].filter(Boolean).join(' · ');
        return `<article class="nmda-review-trash-item" data-trash-key="${escapeHtml(item.editKey)}"><span class="nmda-review-trash-item-mark" aria-hidden="true">${iconSvg('mail')}</span><div><strong title="${escapeHtml(primary)}">${escapeHtml(primary)}</strong>${secondary?`<small title="${escapeHtml(secondary)}">${escapeHtml(secondary)}</small>`:''}</div><button class="nmda-btn nmda-btn-small nmda-btn-quiet" type="button" data-restore-excluded="${escapeHtml(item.editKey)}">恢复</button></article>`;
      }).join('');
      decorateUnifiedIcons(listEl);
    }
  }

  function restoreExcludedTask(editKey) {
    const key=String(editKey||'');
    const edit=batch.taskEdits.get(key);
    if(!edit?.importExcluded)return false;
    batch.handoffComplete=false;
    batch.taskEdits.set(key,{...edit,importExcluded:false});
    rebuildTasks();
    renderReviewTrash();
    setImportStatus('已从垃圾箱恢复 1 封邮件；已重新加入审阅与后续排期流程。','ok');
    return true;
  }

  function restoreAllExcludedTasks() {
    let restored=0;
    for(const [key,edit] of batch.taskEdits.entries()){
      if(!edit?.importExcluded)continue;
      batch.taskEdits.set(key,{...edit,importExcluded:false});restored++;
    }
    if(!restored)return 0;
    batch.handoffComplete=false;
    rebuildTasks();
    const details=$('nmda-review-trash');if(details)details.open=false;
    renderReviewTrash();
    setImportStatus(`已从垃圾箱恢复 ${restored} 封邮件；已重新加入审阅与后续排期流程。`,'ok');
    return restored;
  }

  function taskSourceMeta(task) {
    const collection=recordSets()[Number(task?.collectionIndex)||0];
    const rowMeta=collection?.meta?.rowMeta?.[task?.rowIndex] || null;
    const sourceBlocks=rowMeta?.sourceContext?.length ? rowMeta.sourceContext : (collection?.meta?.sourceBlocks || []);
    const contextOffset=rowMeta?.sourceContext?.length ? Number(rowMeta.sourceContextStart||0) : 0;
    return {collection,rowMeta,sourceBlocks,contextOffset};
  }

  function reviewTaskPriority(task) {
    const issues=unresolvedImportIssues(task);
    if(issues.some(issue=>/收件人|邮箱/.test(issue)))return 0;
    if(issues.some(issue=>/缺少主题|主题为空|Subject|缺少正文/.test(issue)))return 1;
    if(issues.some(issue=>/总名单|联系人|院校/.test(issue)))return 2;
    if(issues.some(issue=>/边界|称呼|落款|置信度|请检查/.test(issue)))return 3;
    return 4;
  }

  function reviewTasks() {
    return allReviewTasks().filter(taskNeedsImportReview).sort((a,b)=>reviewTaskPriority(a)-reviewTaskPriority(b) || String(a.editKey).localeCompare(String(b.editKey)));
  }

  function reviewVisibleTasks() {
    const tasks=allReviewTasks();
    const filter=String(batch.reviewFilter||'all');
    let scoped=tasks;
    if(filter!=='all'){
      scoped=tasks.filter(task=>{
        const visual=reviewVisualState(task);
        if(filter==='pending')return visual.key==='action';
        if(filter==='confirmed')return visual.key==='confirmed';
        if(filter==='auto')return visual.key==='auto';
        return true;
      });
    }
    if(filter==='pending'||filter==='decision')scoped.sort((a,b)=>reviewTaskPriority(a)-reviewTaskPriority(b) || String(a.editKey).localeCompare(String(b.editKey)));
    const query=String(batch.reviewSearch||'').trim().toLowerCase();
    if(!query)return scoped;
    return scoped.filter(task=>[task.id,task.collectionName,task.recipients,task.subject,task.sourceFile].some(value=>String(value||'').toLowerCase().includes(query)));
  }

  function selectedReviewTasks() {
    const selected=batch.reviewSelected instanceof Set ? batch.reviewSelected : new Set();
    return allReviewTasks().filter(task=>selected.has(task.editKey));
  }

  function pruneReviewSelection() {
    if(!(batch.reviewSelected instanceof Set)) batch.reviewSelected=new Set();
    const valid=new Set(allReviewTasks().map(task=>task.editKey));
    for(const key of [...batch.reviewSelected]) if(!valid.has(key)) batch.reviewSelected.delete(key);
  }

  function missingSubjectTasks({selectedOnly=false}={}) {
    const pool=selectedOnly ? selectedReviewTasks() : (batch.tasks||[]).filter(task=>!task?.importExcluded);
    return pool.filter(task=>!isFollowUpReviewTask(task) && !String(task?.subject||'').trim());
  }

  function suggestedBulkSubject() {
    const counts=new Map();
    for(const task of (batch.tasks||[])){
      if(task?.importExcluded||isFollowUpReviewTask(task))continue;
      const subject=String(task?.subject||'').trim();
      if(!subject)continue;
      counts.set(subject,(counts.get(subject)||0)+1);
    }
    const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
    const [subject,count]=ranked[0]||['',0];
    const filled=[...(batch.tasks||[])].filter(task=>!task?.importExcluded&&!isFollowUpReviewTask(task)&&String(task?.subject||'').trim()).length;
    return subject && filled>0 && (count/filled)>=0.7 ? subject : '';
  }


  let formatGovernancePreviewTimer=0;
  let formatGovernanceAnalysis=null;

  function batchFormatEligibleTasks(){
    return (batch.tasks||[]).filter(task=>task&&!task.importExcluded&&String(task.body||governanceTaskText(task)||'').trim());
  }

  function currentGovernanceRule(){
    const formats=[...ui.querySelectorAll('[data-governance-format][aria-pressed="true"]')].map(button=>button.dataset.governanceFormat).filter(key=>MAIL_GOVERNANCE_FORMATS[key]);
    return{phrase:normalizeGovernancePhrase(formatGovernancePhraseEl?.value||''),formats,caseSensitive:!!formatGovernanceCaseEl?.checked};
  }

  function normalizeGovernanceRule(rule){
    const phrase=normalizeGovernancePhrase(rule?.phrase);
    const formats=[...new Set((rule?.formats||[]).filter(key=>MAIL_GOVERNANCE_FORMATS[key]))].sort();
    return {phrase,formats,caseSensitive:rule?.caseSensitive!==false};
  }

  function governanceRuleKey(rule){
    const normalized=normalizeGovernanceRule(rule);
    return `${normalized.caseSensitive?'1':'0'}\u0000${normalized.phrase}\u0000${normalized.formats.join(',')}`;
  }

  function governanceRuleIsRunnable(rule){
    const normalized=normalizeGovernanceRule(rule);
    return normalized.phrase.length>=2&&!normalized.phrase.includes('\n')&&normalized.formats.length>0;
  }

  function queuedGovernanceRules(){
    const seen=new Set(),out=[];
    for(const raw of (batch.formatGovernanceDraftRules||[])){
      const rule=normalizeGovernanceRule(raw);if(!governanceRuleIsRunnable(rule))continue;
      const key=governanceRuleKey(rule);if(seen.has(key))continue;seen.add(key);out.push(rule);
    }
    return out;
  }

  function setQueuedGovernanceRules(rules,{persist=true}={}){
    const seen=new Set(),next=[];
    for(const raw of (rules||[])){
      const rule=normalizeGovernanceRule(raw);if(!governanceRuleIsRunnable(rule))continue;
      const key=governanceRuleKey(rule);if(seen.has(key))continue;seen.add(key);next.push(rule);
    }
    batch.formatGovernanceDraftRules=next;
    if(persist)scheduleWorkspacePersist();
  }

  function governanceRuleQueued(rule){
    const key=governanceRuleKey(rule);return queuedGovernanceRules().some(item=>governanceRuleKey(item)===key);
  }

  function addGovernanceRuleToQueue(rule){
    const normalized=normalizeGovernanceRule(rule);if(!governanceRuleIsRunnable(normalized))return false;
    if(governanceRuleQueued(normalized))return false;
    setQueuedGovernanceRules([...queuedGovernanceRules(),normalized]);return true;
  }

  function removeGovernanceRuleFromQueue(rule){
    const key=governanceRuleKey(rule),next=queuedGovernanceRules().filter(item=>governanceRuleKey(item)!==key);
    if(next.length===queuedGovernanceRules().length)return false;setQueuedGovernanceRules(next);return true;
  }

  function toggleGovernanceRuleInQueue(rule){
    return governanceRuleQueued(rule)?(removeGovernanceRuleFromQueue(rule),false):(addGovernanceRuleToQueue(rule),true);
  }

  function loadGovernanceRuleIntoEditor(rule){
    const normalized=normalizeGovernanceRule(rule);
    if(formatGovernancePhraseEl)formatGovernancePhraseEl.value=normalized.phrase;
    if(formatGovernanceCaseEl)formatGovernanceCaseEl.checked=normalized.caseSensitive;
    ui.querySelectorAll('[data-governance-format]').forEach(el=>{
      const active=normalized.formats.includes(el.dataset.governanceFormat);el.setAttribute('aria-pressed',active?'true':'false');el.classList.toggle('is-active',active);
    });
    scheduleFormatGovernancePreview();
  }

  function governanceContext(text,phrase,caseSensitive=true){
    const source=String(text||''),hay=caseSensitive?source:source.toLocaleLowerCase('en-US'),look=caseSensitive?phrase:phrase.toLocaleLowerCase('en-US'),index=hay.indexOf(look);
    if(index<0)return'';const start=Math.max(0,index-58),end=Math.min(source.length,index+phrase.length+70);
    return `${start?'…':''}${source.slice(start,end).replace(/\s+/g,' ')}${end<source.length?'…':''}`;
  }

  function analyzeGovernanceRule(rule){
    const tasks=batchFormatEligibleTasks(),records=[];let matches=0,compliant=0,skipped=0,changedOccurrences=0;
    for(const task of tasks){
      const plain=String(task.body||'').trim()||governanceTaskText(task);
      if(!governanceFindPositions(plain,rule.phrase,rule.caseSensitive).length)continue;
      const result=inspectGovernanceRuleHtml(taskRichBodyHtml(task),rule);if(!result.matches)continue;
      const needed=Math.max(0,result.matches-result.compliant-result.skipped);matches+=result.matches;compliant+=result.compliant;skipped+=result.skipped;changedOccurrences+=needed;
      records.push({task,matches:result.matches,compliant:result.compliant,skipped:result.skipped,needed,context:governanceContext(plain,rule.phrase,rule.caseSensitive)});
    }
    return{rule,totalTasks:tasks.length,records,matchedTasks:records.length,changeTasks:records.filter(row=>row.needed>0).length,matches,compliant,skipped,changedOccurrences,unmatchedTasks:Math.max(0,tasks.length-records.length)};
  }

  function collectFormatDriftSuggestions(){
    const tasks=batchFormatEligibleTasks();if(tasks.length<2)return[];
    // Parse each draft once. Suggestion discovery is intentionally approximate and cheap;
    // clicking a suggestion runs the exact occurrence-level governance preview before apply.
    const cache=tasks.map(task=>({task,text:String(task.body||'').trim()||governanceTaskText(task),html:taskRichBodyHtml(task)}));
    const candidates=new Map();
    for(const item of cache){
      const doc=new DOMParser().parseFromString(`<div id="nmda-drift-root">${item.html}</div>`,'text/html'),root=doc.getElementById('nmda-drift-root');if(!root)continue;
      for(const [key,meta] of Object.entries(MAIL_GOVERNANCE_FORMATS)){
        for(const el of root.querySelectorAll(meta.selectors)){
          const phrase=String(el.textContent||'').replace(/\s+/g,' ').trim();
          if(phrase.length<3||phrase.length>140||/^[-–—_.,;:!?()[\]{}]+$/.test(phrase))continue;
          const id=`${key}\u0000${phrase}`;if(!candidates.has(id))candidates.set(id,{format:key,phrase,formatted:new Set()});candidates.get(id).formatted.add(item.task.editKey);
        }
      }
    }
    const out=[];
    for(const candidate of candidates.values()){
      const containing=cache.filter(item=>item.text.includes(candidate.phrase));if(containing.length<2)continue;
      const missing=containing.filter(item=>!candidate.formatted.has(item.task.editKey));if(!missing.length)continue;
      out.push({...candidate,total:containing.length,missing:missing.length,coverage:candidate.formatted.size/containing.length});
    }
    return out.sort((a,b)=>b.missing-a.missing||b.total-a.total||b.coverage-a.coverage).slice(0,6);
  }

  function renderFormatGovernanceQueue(){
    if(!formatGovernanceQueueEl)return;
    const rules=queuedGovernanceRules();
    if(!rules.length){formatGovernanceQueueEl.hidden=true;formatGovernanceQueueEl.innerHTML='';return;}
    const analyses=rules.map(rule=>analyzeGovernanceRule(rule));
    const affected=new Set();for(const analysis of analyses)for(const row of analysis.records||[])if(row.needed>0)affected.add(row.task.editKey);
    formatGovernanceQueueEl.hidden=false;
    formatGovernanceQueueEl.innerHTML=`<div class="nmda-format-governance-queue-head"><span><strong>本次格式处理 ${rules.length} 条</strong><small>一次执行，不逐条等待；当前共影响 ${affected.size} 封邮件。</small></span><button type="button" data-governance-queue-clear>清空</button></div><div class="nmda-format-governance-queue-list">${rules.map((rule,index)=>{
      const analysis=analyses[index],labels=rule.formats.map(key=>MAIL_GOVERNANCE_FORMATS[key]?.label||key).join('+');
      const state=analysis.changeTasks?`${analysis.changeTasks} 封待统一`:(analysis.matchedTasks?'已一致':'未命中');
      return `<span class="nmda-format-governance-queued-rule" data-state="${analysis.changeTasks?'pending':'idle'}" data-governance-queue-rule="${index}" title="点击查看这条规则"><b>${escapeHtml(labels)}</b><i>${escapeHtml(rule.phrase)}</i><small>${escapeHtml(state)}</small><button type="button" data-governance-queue-remove="${index}" aria-label="移除此格式规则">×</button></span>`;
    }).join('')}</div>`;
  }

  function syncFormatGovernanceAddButton(analysis=formatGovernanceAnalysis){
    if(!formatGovernanceAddEl)return;
    const rule=currentGovernanceRule(),valid=governanceRuleIsRunnable(rule),queued=valid&&governanceRuleQueued(rule),hasChanges=!!(analysis&&analysis.changeTasks>0);
    formatGovernanceAddEl.disabled=!valid||queued||!hasChanges;
    formatGovernanceAddEl.textContent=queued?'已加入本次处理':(hasChanges?'加入本次处理':'无待处理漂移');
  }

  function renderFormatGovernanceHistory(){
    if(!formatGovernanceHistoryEl)return;const rules=(batch.formatGovernanceRules||[]).slice(0,4);
    formatGovernanceHistoryEl.innerHTML=rules.length?`<span>最近规则</span>${rules.map(rule=>`<button type="button" data-governance-history="${escapeHtml(rule.id)}" title="重新检查这条规则"><b>${escapeHtml((rule.formats||[]).map(key=>MAIL_GOVERNANCE_FORMATS[key]?.label||key).join('+'))}</b><i>${escapeHtml(rule.phrase)}</i><small>${Number(rule.changedTasks||0)} 封</small></button>`).join('')}`:'';
  }

  function batchSubjectGovernanceState(){
    const missing=missingSubjectTasks();
    const suggestion=suggestedBulkSubject();
    const value=String(batchStandardSubjectInputEl?.value||'').trim();
    return {missing,suggestion,value,ready:missing.length>0&&!!value};
  }

  function validFormatGovernanceAnalysis(){
    const rule=currentGovernanceRule();
    if(rule.phrase.length<2||rule.phrase.includes('\n')||!rule.formats.length)return null;
    const analysis=formatGovernanceAnalysis;
    if(analysis&&analysis.rule?.phrase===rule.phrase&&analysis.rule?.caseSensitive===rule.caseSensitive&&JSON.stringify(analysis.rule?.formats||[])===JSON.stringify(rule.formats))return analysis;
    return analyzeGovernanceRule(rule);
  }

  function validateFollowUpTemplateBody(value){
    const templateBody=String(value||'').replace(/\r\n?/g,'\n').trim();
    if(!templateBody)return{valid:true,empty:true,body:'',reason:''};
    const lines=templateBody.split('\n').map(line=>line.trim()).filter(Boolean);
    const first=lines[0]||'',last=lines[lines.length-1]||'';
    if(/^(?:dear\b|hi\b|hello\b|prof(?:essor)?\.?\b|dr\.?\b|尊敬的|您好)/i.test(first))return{valid:false,empty:false,body:templateBody,reason:'称呼由 Initial 自动继承；模板只填写中间正文。'};
    if(/^(?:best(?:\s+regards)?|kind\s+regards|warm\s+regards|regards|sincerely|yours\s+sincerely|best\s+wishes|many\s+thanks|thank\s+you|谢谢|此致|祝好)[,!，！。]?$/i.test(last))return{valid:false,empty:false,body:templateBody,reason:'署名由 Initial 自动继承；模板只填写中间正文。'};
    return{valid:true,empty:false,body:templateBody,reason:''};
  }

  function templateManagedPendingFollowUps(){
    if(!operationState.loaded||!operationState.store?.derivedTasks)return[];
    return Object.values(operationState.store.derivedTasks||{}).filter(task=>{
      if(!task||task.kind!=='follow_up'||['sent','cancelled','blocked','scheduled'].includes(task.state))return false;
      return task.templateManaged===true||(task.templateManaged===undefined&&Number(task.contentVersion||1)===1);
    });
  }

  function followUpBatchContext(){
    if(batch.followUpTemplateRequested===true)return true;
    if(!operationState.loaded||!operationState.store)return false;
    const derived=Object.values(operationState.store.derivedTasks||{});
    if(derived.some(task=>task?.kind==='follow_up'&&!['sent','cancelled'].includes(task.state)))return true;
    try{
      const groups=Operations?.monitoringRoots?.(operationState.store)||[];
      if(groups.some(group=>group?.eligibility?.eligible===true))return true;
    }catch(_){}
    return false;
  }

  function syncFollowUpBatchVisibility(){
    const visible=followUpBatchContext();
    if(batchFollowUpOverviewEl)batchFollowUpOverviewEl.hidden=!visible;
    if(batchFollowUpCardEl)batchFollowUpCardEl.hidden=!visible;
    if(batchStandardsEl)batchStandardsEl.dataset.followupContext=visible?'1':'0';
    if(batchStandardsDescEl)batchStandardsDescEl.textContent=visible
      ? '只显示当前真正需要处理的批量事项：补齐主题、处理检测到的格式偏移，并处理当前 Follow-up。'
      : '只显示当前真正需要处理的批量事项：补齐主题、处理检测到的格式偏移。';
    return visible;
  }

  function batchFollowUpTemplateState(){
    const policy=operationState.loaded?(operationState.store.followUpPolicies?.default||Operations.DEFAULT_FOLLOWUP_POLICY):Operations.DEFAULT_FOLLOWUP_POLICY;
    const saved=String(policy?.templateBody||'').replace(/\r\n?/g,'\n').trim();
    const initialized=batchFollowUpTemplateEl?.dataset.initialized==='1';
    const value=String(initialized?batchFollowUpTemplateEl?.value:saved).replace(/\r\n?/g,'\n').trim();
    const validation=validateFollowUpTemplateBody(value);
    const changed=value!==saved;
    const version=Math.max(0,Number(policy?.templateVersion||0));
    const syncable=templateManagedPendingFollowUps();
    const allDerived=operationState.loaded?Object.values(operationState.store?.derivedTasks||{}):[];
    const protectedCount=allDerived.filter(task=>task?.kind==='follow_up'&&!['sent','cancelled','blocked','scheduled'].includes(task.state)&&!(task.templateManaged===true||(task.templateManaged===undefined&&Number(task.contentVersion||1)===1))).length;
    const lockedCount=allDerived.filter(task=>task?.kind==='follow_up'&&task.state==='scheduled'&&(task.templateManaged===true||(task.templateManaged===undefined&&Number(task.contentVersion||1)===1))).length;
    return{policy,saved,value,validation,changed,version,nextVersion:changed?Math.max(1,version+1):version,syncable,protectedCount,lockedCount,syncEnabled:!!batchFollowUpSyncEl?.checked&&changed&&!!value&&syncable.length>0};
  }

  function renderBatchFollowUpTemplate(options={}){
    if(!batchFollowUpTemplateEl)return;
    const visible=syncFollowUpBatchVisibility();
    if(!visible)return;
    const policy=operationState.loaded?(operationState.store.followUpPolicies?.default||Operations.DEFAULT_FOLLOWUP_POLICY):Operations.DEFAULT_FOLLOWUP_POLICY;
    const saved=String(policy?.templateBody||'').replace(/\r\n?/g,'\n').trim();
    const version=Math.max(0,Number(policy?.templateVersion||0));
    const dirty=batchFollowUpTemplateEl.dataset.dirty==='1';
    if(!dirty&&document.activeElement!==batchFollowUpTemplateEl)batchFollowUpTemplateEl.value=saved;
    batchFollowUpTemplateEl.dataset.initialized='1';
    const state=batchFollowUpTemplateState();
    batchFollowUpTemplateEl.dataset.baseBody=saved;
    batchFollowUpTemplateEl.dataset.baseVersion=String(version);
    if(batchFollowUpCountEl)batchFollowUpCountEl.textContent=state.changed?'待更新':(saved?'已设置':'未设置');
    if(batchFollowUpSummaryEl)batchFollowUpSummaryEl.textContent=state.changed?(state.value?'有修改':'将清空'):(saved?'当前可用':'需要设置');
    if(batchFollowUpBadgeEl)batchFollowUpBadgeEl.textContent=state.changed?'待更新':(saved?'已设置':'未设置');
    if(batchFollowUpSyncCountEl)batchFollowUpSyncCountEl.textContent=state.syncable.length?`${state.syncable.length} 封可同步`:(state.protectedCount?`${state.protectedCount} 封人工正文受保护`:(state.lockedCount?`${state.lockedCount} 封已排期锁定`:'当前无待同步邮件'));
    if(batchFollowUpSyncEl){batchFollowUpSyncEl.disabled=!state.changed||!state.value||!state.syncable.length;if(batchFollowUpSyncEl.disabled&&state.syncable.length===0)batchFollowUpSyncEl.checked=true;}
    if(batchFollowUpResultEl){
      if(!state.validation.valid)batchFollowUpResultEl.innerHTML=`<strong>模板结构不规范</strong><span>${escapeHtml(state.validation.reason)}</span>`;
      else if(state.changed&&!state.value)batchFollowUpResultEl.innerHTML='<strong>将清空模板</strong><span>未来不会再自动生成模板正文；已经生成的 Follow-up 保留现状。</span>';
      else if(state.changed)batchFollowUpResultEl.innerHTML=`<strong>模板待保存</strong><span>未来派生任务使用新正文${state.syncable.length?`；${state.syncable.length} 封未发送模板派生邮件可同步刷新`:''}${state.protectedCount?`；${state.protectedCount} 封人工改写正文不会覆盖`:''}${state.lockedCount?`；${state.lockedCount} 封已排期邮件保持现状`:''}。</span>`;
      else if(saved)batchFollowUpResultEl.innerHTML='<strong>模板已生效</strong><span>到期后按此正文批量派生；称呼与署名继续从各自 Initial 继承。</span>';
      else batchFollowUpResultEl.innerHTML='<strong>当前 Follow-up 需要模板</strong><span>填写正文后，当前到期邮件和后续跟进才能按模板派生。</span>';
    }
    if(options.focus)requestAnimationFrame(()=>batchFollowUpTemplateEl?.focus?.({preventScroll:true}));
  }

  function currentBatchProcessingPlan(){
    const subjectState=batchSubjectGovernanceState();
    const formatAnalyses=queuedGovernanceRules().map(rule=>analyzeGovernanceRule(rule)).filter(analysis=>analysis.changeTasks>0);
    const formatEntries=formatAnalyses.flatMap(analysis=>(analysis.records||[]).filter(row=>row.needed>0).map(row=>({analysis,row})));
    const followUp=batchFollowUpTemplateState();
    const byKey=new Map();
    if(subjectState.ready){
      for(const task of subjectState.missing)byKey.set(task.editKey,{task,subject:true,formatEntries:[]});
    }
    for(const entry of formatEntries){
      const task=entry.row.task;
      const prior=byKey.get(task.editKey)||{task,subject:false,formatEntries:[]};
      prior.formatEntries.push(entry);byKey.set(task.editKey,prior);
    }
    const order=new Map((batch.tasks||[]).map((task,index)=>[task.editKey,index]));
    const rows=[...byKey.values()].sort((a,b)=>(order.get(a.task.editKey)??999999)-(order.get(b.task.editKey)??999999));
    const followUpVisible=followUpBatchContext();
    const followUpReady=followUpVisible&&followUp.changed&&followUp.validation.valid;
    const formatTaskKeys=new Set(formatEntries.map(entry=>entry.row.task.editKey));
    return {subject:subjectState.value,subjectRows:subjectState.ready?subjectState.missing:[],formatAnalyses,formatEntries,rows,subjectCount:subjectState.ready?subjectState.missing.length:0,formatCount:formatTaskKeys.size,formatRuleCount:formatAnalyses.length,followUp,followUpVisible,followUpReady,syncFollowUps:followUpReady&&followUp.syncEnabled};
  }

  function syncBatchProcessingApply(){
    if(!formatGovernanceApplyEl)return;
    const plan=currentBatchProcessingPlan(),total=plan.rows.length,hasWork=total>0||plan.followUpReady;
    formatGovernanceApplyEl.disabled=!hasWork;
    if(total&&plan.followUpReady)formatGovernanceApplyEl.textContent=`应用批量处理 · ${total} 封 + 模板`;
    else if(total)formatGovernanceApplyEl.textContent=`应用批量处理 · ${total} 封`;
    else if(plan.followUpReady)formatGovernanceApplyEl.textContent=plan.followUp.value?'保存 Follow-up 模板':'清空 Follow-up 模板';
    else formatGovernanceApplyEl.textContent='应用批量处理';
    if(batchStandardPlanSummaryEl){
      const parts=[];
      if(plan.subjectCount)parts.push(`补主题 ${plan.subjectCount} 封`);
      if(plan.formatCount)parts.push(`统一格式 ${plan.formatRuleCount} 条 / ${plan.formatCount} 封`);
      if(plan.followUpReady)parts.push(plan.followUp.value?'更新 Follow-up 模板':'清空 Follow-up 模板');
      if(plan.syncFollowUps)parts.push(`同步 ${plan.followUp.syncable.length} 封待发 Follow-up`);
      batchStandardPlanSummaryEl.textContent=parts.length?`${parts.join(' · ')}${total?` · 当前影响 ${total} 封`:''}`:'尚未配置可执行批量处理';
    }
  }

  function renderBatchSubjectGovernance(){
    const state=batchSubjectGovernanceState(),count=state.missing.length;
    if(batchStandardSubjectCountEl)batchStandardSubjectCountEl.textContent=String(count);
    if(batchStandardSubjectBadgeEl)batchStandardSubjectBadgeEl.textContent=count?`${count} 封`:'完整';
    if(batchStandardSubjectSuggestionEl){
      batchStandardSubjectSuggestionEl.hidden=!count||!state.suggestion;
      batchStandardSubjectSuggestionEl.textContent=state.suggestion?`使用参考主题 · ${state.suggestion}`:'';
      batchStandardSubjectSuggestionEl.title=state.suggestion||'';
    }
    if(batchStandardSubjectInputEl)batchStandardSubjectInputEl.disabled=!count;
    if(batchStandardSubjectResultEl){
      if(!count)batchStandardSubjectResultEl.innerHTML='<strong>主题完整</strong><span>当前所有 Initial 草稿均已有主题。</span>';
      else if(state.value)batchStandardSubjectResultEl.innerHTML=`<strong>待补齐 ${count} 封</strong><span>只写入空白主题，不覆盖已有主题。</span>`;
      else if(state.suggestion)batchStandardSubjectResultEl.innerHTML=`<strong>${count} 封缺少主题</strong><span>已从现有草稿中找到高一致度参考主题；采用后才会加入执行计划。</span>`;
      else batchStandardSubjectResultEl.innerHTML=`<strong>${count} 封缺少主题</strong><span>现有主题不够一致，请输入确认后的统一主题。</span>`;
    }
    syncBatchProcessingApply();
  }

  function syncFormatGovernancePreviewBadge(suggestions=[]){
    const formatCount=Array.isArray(suggestions)?suggestions.length:0,subjectCount=missingSubjectTasks().length;
    const followUp=batchFollowUpTemplateState(),followUpVisible=followUpBatchContext(),followUpNeeds=followUpVisible&&(followUp.changed||(!followUp.saved&&followUp.policy?.enabled!==false));
    const count=(subjectCount?1:0)+(formatCount?1:0)+(followUpNeeds?1:0);
    if(batchStandardFormatCountEl)batchStandardFormatCountEl.textContent=String(formatCount);
    if(batchStandardSubjectCountEl)batchStandardSubjectCountEl.textContent=String(subjectCount);
    if(formatGovernanceEntryCountEl){formatGovernanceEntryCountEl.hidden=!count;formatGovernanceEntryCountEl.textContent=String(count||0);}
    if(formatGovernanceEntryEl){
      formatGovernanceEntryEl.classList.toggle('has-drift',!!count);
      const details=[];if(subjectCount)details.push(`主题缺失 ${subjectCount} 封`);if(formatCount)details.push(`格式漂移 ${formatCount} 组`);if(followUpNeeds)details.push(followUp.changed?'Follow-up 模板待更新':'Follow-up 模板未设置');
      formatGovernanceEntryEl.title=count?`批量处理：${details.join(' · ')}`:'当前批次未发现待处理的确定性批量事项';
    }
  }

  function renderFormatDriftSuggestions(){
    if(!formatGovernanceSuggestionsEl)return;const suggestions=collectFormatDriftSuggestions();syncFormatGovernancePreviewBadge(suggestions);renderBatchSubjectGovernance();
    if(!suggestions.length){formatGovernanceSuggestionsEl.hidden=false;formatGovernanceSuggestionsEl.innerHTML='<div class="nmda-format-governance-recommendation-empty"><strong>未发现明确格式偏移</strong><span>当前邮件之间没有形成可可靠推荐的格式差异。</span></div>';formatGovernanceSuggestionsEl._nmdaSuggestions=[];renderFormatGovernanceQueue();syncBatchProcessingApply();return;}
    const queued=queuedGovernanceRules(),queuedKeys=new Set(queued.map(governanceRuleKey));
    const selectedCount=suggestions.reduce((count,item)=>count+(queuedKeys.has(governanceRuleKey({phrase:item.phrase,formats:[item.format],caseSensitive:true}))?1:0),0);
    formatGovernanceSuggestionsEl.hidden=false;
    formatGovernanceSuggestionsEl.innerHTML=`<div class="nmda-format-governance-suggestion-head"><span><strong>推荐修复 ${suggestions.length} 组格式偏移</strong><small>${selectedCount?`已加入 ${selectedCount} 组；可继续多选，最后一次执行。`:'点击需要处理的推荐，或一次加入全部。'}</small></span><span class="nmda-format-governance-suggestion-actions"><button type="button" data-governance-add-all ${selectedCount===suggestions.length?'disabled':''}>全部加入</button>${selectedCount?'<button type="button" data-governance-clear-suggestions>取消已选</button>':''}</span></div><div class="nmda-format-governance-suggestion-list">${suggestions.map((item,index)=>{const rule={phrase:item.phrase,formats:[item.format],caseSensitive:true},selected=queuedKeys.has(governanceRuleKey(rule));return `<button type="button" class="${selected?'is-selected':''}" data-governance-suggestion="${index}" aria-pressed="${selected?'true':'false'}"><i aria-hidden="true">${selected?'✓':'+'}</i><b>${escapeHtml(MAIL_GOVERNANCE_FORMATS[item.format]?.label||item.format)}</b><span>${escapeHtml(item.phrase)}</span><small>${item.missing} / ${item.total} 封偏移</small></button>`;}).join('')}</div>`;
    formatGovernanceSuggestionsEl._nmdaSuggestions=suggestions;renderFormatGovernanceQueue();syncBatchProcessingApply();
  }

  function renderFormatGovernanceAnalysis(){
    if(!formatGovernanceEl||formatGovernanceEl.hidden)return;const rule=currentGovernanceRule();renderFormatGovernanceHistory();
    if(rule.phrase.length<2){formatGovernanceAnalysis=null;if(formatGovernanceResultEl)formatGovernanceResultEl.textContent='输入至少 2 个字符的固定文本；系统只会修改实际命中的草稿。';if(formatGovernanceListEl){formatGovernanceListEl.hidden=true;formatGovernanceListEl.innerHTML='';}syncFormatGovernanceAddButton(null);syncBatchProcessingApply();return;}
    if(rule.phrase.includes('\n')){formatGovernanceAnalysis=null;if(formatGovernanceResultEl)formatGovernanceResultEl.textContent='自定义文本请使用单行内容；跨段落格式不做批量改写。';syncFormatGovernanceAddButton(null);syncBatchProcessingApply();return;}
    if(!rule.formats.length){formatGovernanceAnalysis=null;if(formatGovernanceResultEl)formatGovernanceResultEl.textContent='至少选择一种要统一的格式。';syncFormatGovernanceAddButton(null);syncBatchProcessingApply();return;}
    const analysis=analyzeGovernanceRule(rule);formatGovernanceAnalysis=analysis;
    const labels=rule.formats.map(key=>MAIL_GOVERNANCE_FORMATS[key]?.label||key).join(' + ');
    if(formatGovernanceResultEl){
      if(!analysis.matchedTasks)formatGovernanceResultEl.innerHTML=`<strong>未命中</strong><span>当前 ${analysis.totalTasks} 封草稿中没有找到“${escapeHtml(rule.phrase)}”。</span>`;
      else if(!analysis.changeTasks)formatGovernanceResultEl.innerHTML=`<strong>格式已一致</strong><span>${analysis.matchedTasks} 封 · ${analysis.matches} 处均已是${escapeHtml(labels)}，无需改动。</span>`;
      else formatGovernanceResultEl.innerHTML=`<strong>待统一 ${analysis.changeTasks} 封</strong><span>共命中 ${analysis.matchedTasks} / ${analysis.totalTasks} 封、${analysis.matches} 处；${analysis.changedOccurrences} 处需要补齐${escapeHtml(labels)}，${analysis.compliant} 处已经规范${analysis.skipped?`，${analysis.skipped} 处因跨段落结构跳过`:''}。</span>`;
    }
    if(formatGovernanceListEl){
      const rows=analysis.records.filter(row=>row.needed>0||row.skipped>0).slice(0,24);formatGovernanceListEl.hidden=!rows.length;
      formatGovernanceListEl.innerHTML=rows.map(row=>`<div class="nmda-format-governance-row" data-state="${row.needed?'repair':'skip'}" data-governance-row-key="${escapeHtml(row.task.editKey)}"><span><strong>${escapeHtml(row.task.subject||'（无主题）')}</strong><small>${escapeHtml(row.task.recipients||'')}</small></span><p>${escapeHtml(row.context||rule.phrase)}</p><b>${row.needed?`${row.needed} 处待修复`:'结构复杂 · 跳过'}</b></div>`).join('')+(analysis.records.length>rows.length?`<div class="nmda-format-governance-more">另有 ${analysis.records.length-rows.length} 封命中邮件未展开</div>`:'');
    }
    syncFormatGovernanceAddButton(analysis);
    syncBatchProcessingApply();
  }

  function scheduleFormatGovernancePreview(){
    if(formatGovernancePreviewTimer)clearTimeout(formatGovernancePreviewTimer);formatGovernancePreviewTimer=setTimeout(()=>{formatGovernancePreviewTimer=0;renderFormatGovernanceAnalysis();},120);
  }

  function openFormatGovernance(options={}){
    if(!formatGovernanceEl||batch.reviewSurface!=='preview')return;
    formatGovernanceEl.hidden=false;
    if(reviewInlineEl)reviewInlineEl.dataset.formatGovernanceOpen='1';
    if(formatGovernanceEntryEl){formatGovernanceEntryEl.setAttribute('aria-expanded','true');formatGovernanceEntryEl.classList.add('is-open');}
    renderBatchSubjectGovernance();renderFormatDriftSuggestions();renderFormatGovernanceHistory();renderFormatGovernanceAnalysis();renderBatchFollowUpTemplate();
    requestAnimationFrame(()=>{
      if(options.section==='followup'){batchFollowUpTemplateEl?.focus?.({preventScroll:true});batchFollowUpTemplateEl?.scrollIntoView?.({block:'center',behavior:'smooth'});return;}
      if(missingSubjectTasks().length){batchStandardSubjectInputEl?.focus?.({preventScroll:true});return;}const recommended=formatGovernanceSuggestionsEl?.querySelector?.('[data-governance-suggestion]');recommended?.focus?.({preventScroll:true});
    });
  }

  async function openBatchProcessingToFollowUp(){
    await ensureOperationStore();
    batch.followUpTemplateRequested=true;
    const opened=openReviewWorkspace({pendingOnly:false});if(opened===false){batch.followUpTemplateRequested=false;return;}
    const first=allReviewTasks()[0];
    if(batch.reviewSurface!=='preview'&&first)openReviewPreview(first.editKey);
    if(batch.reviewSurface!=='preview'){batch.followUpTemplateRequested=false;setMonitorNotice('当前没有可进入 Preview 的邮件；有需要处理的 Follow-up 后再进入模板设置。','warn');return;}
    openFormatGovernance({section:'followup'});
  }

  function closeFormatGovernance(){
    batch.followUpTemplateRequested=false;
    if(formatGovernanceEl)formatGovernanceEl.hidden=true;
    if(reviewInlineEl)delete reviewInlineEl.dataset.formatGovernanceOpen;
    if(formatGovernanceEntryEl){formatGovernanceEntryEl.setAttribute('aria-expanded','false');formatGovernanceEntryEl.classList.remove('is-open');}
    formatGovernanceAnalysis=null;
  }

  let batchGovernanceFeedbackTimer=0;

  function clearGovernancePreviewHighlight(){
    try{window.CSS?.highlights?.delete?.('nmda-governance-target');window.CSS?.highlights?.delete?.('nmda-governance-applied');}catch(_){}
  }

  function setGovernancePreviewHighlight(bodyEl,phrase,caseSensitive=true,name='nmda-governance-target'){
    clearGovernancePreviewHighlight();
    if(!bodyEl||!window.CSS?.highlights||typeof window.Highlight!=='function')return 0;
    try{
      const index=governanceTextIndex(bodyEl),positions=governanceFindPositions(index.text,String(phrase||''),caseSensitive),ranges=[];
      for(const position of positions){
        const refs=governanceOccurrenceRefs(index,position,bodyEl);if(!refs||refs.skipped)continue;
        const range=document.createRange();range.setStart(refs.first.node,refs.startOffset);range.setEnd(refs.last.node,refs.endOffset);ranges.push(range);
      }
      if(ranges.length)window.CSS.highlights.set(name,new window.Highlight(...ranges));
      return ranges.length;
    }catch(_){return 0;}
  }

  function setGovernancePreviewHighlights(bodyEl,rules=[],name='nmda-governance-applied'){
    clearGovernancePreviewHighlight();
    if(!bodyEl||!window.CSS?.highlights||typeof window.Highlight!=='function')return 0;
    try{
      const index=governanceTextIndex(bodyEl),ranges=[];
      for(const raw of (rules||[])){
        const rule=normalizeGovernanceRule(raw);if(!governanceRuleIsRunnable(rule))continue;
        for(const position of governanceFindPositions(index.text,rule.phrase,rule.caseSensitive)){
          const refs=governanceOccurrenceRefs(index,position,bodyEl);if(!refs||refs.skipped)continue;
          const range=document.createRange();range.setStart(refs.first.node,refs.startOffset);range.setEnd(refs.last.node,refs.endOffset);ranges.push(range);
        }
      }
      if(ranges.length)window.CSS.highlights.set(name,new window.Highlight(...ranges));
      return ranges.length;
    }catch(_){return 0;}
  }

  function governanceFeedbackElementsForKey(key){
    const escaped=CSS.escape(String(key||''));
    return{
      page:reviewQueueEl?.querySelector?.(`[data-review-row="${escaped}"]`)||null,
      rail:reviewPreviewRailListEl?.querySelector?.(`[data-review-rail-key="${escaped}"]`)||null
    };
  }

  function clearBatchGovernanceFeedback(){
    if(batchGovernanceFeedbackTimer){clearTimeout(batchGovernanceFeedbackTimer);batchGovernanceFeedbackTimer=0;}
    if(reviewInlineEl)delete reviewInlineEl.dataset.batchGovernanceFeedback;
    reviewQueueEl?.querySelectorAll?.('.is-batch-standard-feedback,.is-batch-format-feedback').forEach(el=>el.classList.remove('is-batch-standard-feedback','is-batch-format-feedback'));
    reviewPreviewRailListEl?.querySelectorAll?.('.is-batch-standard-feedback').forEach(el=>el.classList.remove('is-batch-standard-feedback'));
    reviewQueueEl?.querySelectorAll?.('[data-preview-subject].is-standard-subject-applied').forEach(el=>el.classList.remove('is-standard-subject-applied'));
    reviewInlineEl?.querySelector?.('.nmda-batch-standard-feedback-chip')?.remove?.();
    clearGovernancePreviewHighlight();
  }

  function showBatchGovernanceFeedback({changedKeys=[],subjectKeys=[],formatKeys=[],formatRules=[],summary=''}={}){
    clearBatchGovernanceFeedback();
    const changed=new Set(changedKeys),subjects=new Set(subjectKeys),formats=new Set(formatKeys);
    if(!changed.size&&!summary)return;
    if(reviewInlineEl)reviewInlineEl.dataset.batchGovernanceFeedback='1';
    for(const key of changed){
      const {page,rail}=governanceFeedbackElementsForKey(key);
      page?.classList.add('is-batch-standard-feedback');
      rail?.classList.add('is-batch-standard-feedback');
      if(formats.has(key))page?.classList.add('is-batch-format-feedback');
      if(subjects.has(key))page?.querySelectorAll?.('[data-preview-subject]').forEach(el=>el.classList.add('is-standard-subject-applied'));
    }
    const activeKey=String(batch.reviewEditingKey||batch.reviewPreviewKey||'');
    if(activeKey&&formats.has(activeKey)&&formatRules.length){
      const body=governanceFeedbackElementsForKey(activeKey).page?.querySelector?.('.nmda-review-preview-body');
      if(body)setGovernancePreviewHighlights(body,formatRules,'nmda-governance-applied');
    }
    if(reviewInlineEl){
      const chip=document.createElement('div');chip.className='nmda-batch-standard-feedback-chip';chip.setAttribute('role','status');
      const mark=document.createElement('span');mark.className='nmda-batch-standard-feedback-mark';mark.textContent='✓';
      const copy=document.createElement('span');copy.textContent=summary||`已校正 ${changed.size} 封`;
      chip.append(mark,copy);reviewInlineEl.append(chip);requestAnimationFrame(()=>chip.classList.add('is-visible'));
    }
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    batchGovernanceFeedbackTimer=setTimeout(()=>clearBatchGovernanceFeedback(),reduced?420:1500);
  }

  async function applyBatchProcessing(){
    const plan=currentBatchProcessingPlan();if(!plan.rows.length&&!plan.followUpReady)return;
    const previewContext=batch.reviewSurface==='preview'?{activeKey:String(batch.reviewEditingKey||batch.reviewPreviewKey||''),scrollTop:reviewQueueEl?.scrollTop||0,railScrollTop:reviewPreviewRailListEl?.scrollTop||0}:null;
    let changedTasks=0,subjectChanged=0,formatChangedTasks=0,formatChangedOccurrences=0,followUpSynced=0,followUpProtected=0,followUpTemplateVersion=0;
    const changedKeys=[],subjectChangedKeys=[],formatChangedKeys=[];
    const formatStats=new Map((plan.formatAnalyses||[]).map(analysis=>[governanceRuleKey(analysis.rule),{analysis,changedTaskKeys:new Set(),changedOccurrences:0}]));
    try{
      if(plan.followUpReady){
        await ensureOperationStore();
        const policyResult=Operations.setFollowUpPolicy(operationState.store,'',{templateBody:plan.followUp.value});
        let nextStore=policyResult.store;followUpTemplateVersion=Number(policyResult.policy?.templateVersion||0);
        if(plan.syncFollowUps&&plan.followUp.value&&typeof Operations.refreshTemplateManagedFollowUps==='function'){
          const refreshed=Operations.refreshTemplateManagedFollowUps(nextStore);nextStore=refreshed.store;followUpSynced=refreshed.refreshed?.length||0;
          followUpProtected=(refreshed.skipped||[]).filter(item=>item.reason==='manually-edited').length;
        }
        operationState.store=nextStore;writeFollowUpPrefs(Operations.policyForRoot(operationState.store,''));await commitRuntimeOperations();
        if(batchFollowUpTemplateEl){batchFollowUpTemplateEl.dataset.dirty='0';batchFollowUpTemplateEl.dataset.baseBody=plan.followUp.value;batchFollowUpTemplateEl.dataset.baseVersion=String(followUpTemplateVersion);}
      }
      for(const row of plan.rows){
        let rowChanged=false,formatRowChanged=false;
        const patch={reviewConfirmed:!!row.task.reviewConfirmed,reviewDraftPending:!!row.task.reviewDraftPending};
        if(row.subject&&plan.subject){
          patch.subject=plan.subject;
          subjectChanged++;rowChanged=true;subjectChangedKeys.push(row.task.editKey);
        }
        let workingHtml=taskRichBodyHtml(row.task);
        const orderedFormatEntries=[...(row.formatEntries||[])].sort((a,b)=>String(b.analysis?.rule?.phrase||'').length-String(a.analysis?.rule?.phrase||'').length);
        for(const entry of orderedFormatEntries){
          const result=inspectGovernanceRuleHtml(workingHtml,entry.analysis.rule,{apply:true});
          if(result.changed){
            workingHtml=result.html;formatChangedOccurrences+=result.changed;rowChanged=true;formatRowChanged=true;
            const stats=formatStats.get(governanceRuleKey(entry.analysis.rule));
            if(stats){stats.changedTaskKeys.add(row.task.editKey);stats.changedOccurrences+=result.changed;}
          }
        }
        if(formatRowChanged){patch.bodyHtml=workingHtml;patch.bodyIsHtml=true;formatChangedTasks++;formatChangedKeys.push(row.task.editKey);}
        if(rowChanged){setTaskEdit(row.task,patch);changedTasks++;changedKeys.push(row.task.editKey);}
      }
      if(changedTasks)batch.handoffComplete=false;
      const appliedFormatRules=[];
      for(const stats of formatStats.values()){
        if(!stats.changedTaskKeys.size)continue;
        appliedFormatRules.push({id:crypto.randomUUID(),phrase:stats.analysis.rule.phrase,formats:[...stats.analysis.rule.formats],caseSensitive:stats.analysis.rule.caseSensitive,appliedAt:new Date().toISOString(),changedTasks:stats.changedTaskKeys.size,changedOccurrences:stats.changedOccurrences,taskKeys:[...stats.changedTaskKeys]});
      }
      if(appliedFormatRules.length){
        batch.formatGovernanceRules=[...appliedFormatRules,...(batch.formatGovernanceRules||[])].slice(0,30);
        const appliedKeys=new Set((plan.formatAnalyses||[]).map(analysis=>governanceRuleKey(analysis.rule)));
        setQueuedGovernanceRules(queuedGovernanceRules().filter(rule=>!appliedKeys.has(governanceRuleKey(rule))),{persist:false});
      }
      if(changedTasks)rebuildTasks();
      if(changedTasks||appliedFormatRules.length)scheduleWorkspacePersist();
      renderReviewPageOverview();renderImportTaskPreview();renderFormatDriftSuggestions();renderFormatGovernanceAnalysis();renderBatchSubjectGovernance();renderBatchFollowUpTemplate();renderMonitoring();
      const parts=[];
      if(subjectChanged)parts.push(`补齐主题 ${subjectChanged} 封`);
      if(formatChangedTasks)parts.push(`统一格式 ${appliedFormatRules.length} 条 / ${formatChangedTasks} 封 / ${formatChangedOccurrences} 处`);
      if(plan.followUpReady)parts.push(plan.followUp.value?'Follow-up 模板已保存':'Follow-up 模板已清空');
      if(followUpSynced)parts.push(`同步 ${followUpSynced} 封待发 Follow-up`);
      if(followUpProtected)parts.push(`${followUpProtected} 封人工正文保留`);
      if(plan.followUpReady&&plan.followUp.lockedCount)parts.push(`${plan.followUp.lockedCount} 封已排期 Follow-up 未改`);
      const summary=parts.join(' · ')||'批量处理已完成';
      const reveal=()=>{
        if(batch.reviewSurface!=='preview')return;
        if(previewContext){
          if(reviewQueueEl)reviewQueueEl.scrollTop=Math.min(previewContext.scrollTop,Math.max(0,reviewQueueEl.scrollHeight-reviewQueueEl.clientHeight));
          if(reviewPreviewRailListEl)reviewPreviewRailListEl.scrollTop=Math.min(previewContext.railScrollTop,Math.max(0,reviewPreviewRailListEl.scrollHeight-reviewPreviewRailListEl.clientHeight));
          if(previewContext.activeKey)setReviewPreviewActiveKey(previewContext.activeKey,{revealRail:false});
        }
        showBatchGovernanceFeedback({changedKeys,subjectKeys:subjectChangedKeys,formatKeys:formatChangedKeys,formatRules:appliedFormatRules,summary});
      };
      requestAnimationFrame(()=>requestAnimationFrame(reveal));
      setImportStatus(`批量处理完成：${parts.join('；')||'无正文改动'}。`,'ok');
    }catch(error){
      console.error('[NMDA] batch processing failed',error);setImportStatus(`批量处理失败：${error?.message||error}`,'error');
    }finally{syncBatchProcessingApply();}
  }


  function renderReviewBatchActions() {
    pruneReviewSelection();
    const selected=selectedReviewTasks().filter(taskCanBatchConfirm);
    const batchMode=batch.reviewFilter==='pending' && reviewTasks().length>0;
    if(reviewBatchbarEl) reviewBatchbarEl.hidden=!batchMode||!selected.length;
    if(reviewSelectedCountEl) reviewSelectedCountEl.textContent=selected.length?`已选 ${selected.length} 封需确认邮件`:'已选 0 封';
  }

  function setReviewSurface(mode='board') {
    if(!reviewInlineEl)return;
    const next=mode==='preview'?'preview':'board';
    const previous=batch.reviewSurface==='preview'?'preview':'board';
    batch.reviewSurface=next;
    reviewInlineEl.dataset.reviewView=next;
    if(next==='preview'&&previous!=='preview'){
      reviewInlineEl.dataset.previewAnimate='1';
      window.setTimeout(()=>{if(reviewInlineEl?.dataset.reviewView==='preview')delete reviewInlineEl.dataset.previewAnimate;},420);
    }else if(next==='board'){delete reviewInlineEl.dataset.previewAnimate;batch.reviewEditingKey='';}
    if(reviewQueueEl){
      reviewQueueEl.classList.toggle('nmda-review-mail-grid',next==='board');
      reviewQueueEl.classList.toggle('nmda-review-continuous-preview',next==='preview');
    }
    const toolbar=$('nmda-review-preview-toolbar');
    if(toolbar)toolbar.hidden=next!=='preview';
    if(reviewPreviewRailEl)reviewPreviewRailEl.hidden=next!=='preview';
    if(next==='preview'&&previous!=='preview') renderFormatDriftSuggestions();
    else if(next!=='preview') closeFormatGovernance();
  }

  function reviewEditingTask(){
    const key=String(batch.reviewEditingKey||'');
    return key?reviewTaskByKey(key):null;
  }

  function previewEditPage(editKey=''){
    if(!reviewQueueEl)return null;
    const key=String(editKey||batch.reviewEditingKey||'');
    if(!key)return null;
    return reviewQueueEl.querySelector(`.nmda-review-preview-page[data-review-row="${CSS.escape(key)}"]`);
  }

  function setPreviewEditFeedback(editKey='',message='',tone='warn'){
    const page=previewEditPage(editKey);
    const feedback=page?.querySelector?.('[data-preview-edit-feedback]');
    if(!feedback)return;
    feedback.hidden=!message;
    feedback.dataset.tone=tone;
    feedback.textContent=message||'';
  }

  function previewEditorBodyPatch(page,task){
    const editor=page?.querySelector?.('[data-preview-edit-body]');
    const html=sanitizeEmailRichHtml(editor?.innerHTML||'');
    const body=mailRichHtmlToText(html).replace(/\r\n?/g,'\n').trimEnd();
    const keepRich=!!task?.bodyIsHtml||mailRichHasMeaningfulFormatting(html);
    return{body,bodyHtml:keepRich?html:'',bodyIsHtml:keepRich};
  }

  function previewEditorPatch(editKey=''){
    const task=reviewTaskByKey(editKey);const page=previewEditPage(editKey);
    if(!task||!page)return null;
    const bodyPatch=previewEditorBodyPatch(page,task);
    return{
      task,page,
      recipients:String(page.querySelector('[data-preview-edit-recipients]')?.value||'').trim(),
      subject:String(page.querySelector('[data-preview-edit-subject]')?.value||'').trim(),
      body:bodyPatch.body,bodyHtml:bodyPatch.bodyHtml,bodyIsHtml:bodyPatch.bodyIsHtml
    };
  }

  function focusPreviewEditField(editKey='',fields=[]){
    requestAnimationFrame(()=>{
      const page=previewEditPage(editKey);if(!page)return;
      const order=(fields?.length?fields:['recipients','subject','body']).map(key=>({
        recipients:'[data-preview-edit-recipients]',subject:'[data-preview-edit-subject]',body:'[data-preview-edit-body]'
      })[key]).filter(Boolean);
      const target=order.map(selector=>page.querySelector(selector)).find(Boolean)||page.querySelector('[data-preview-edit-body]');
      target?.focus?.({preventScroll:true});
    });
  }

  function beginPreviewEdit(editKey=''){
    const key=String(editKey||'');const task=reviewTaskByKey(key);if(!task)return false;
    if(batch.reviewEditingKey&&batch.reviewEditingKey!==key){setImportStatus('当前还有一封邮件处于编辑状态；请先保存或取消。','warn');return false;}
    setWorkbenchTab('review');
    if(reviewInlineEl)reviewInlineEl.hidden=false;
    if(batch.reviewSurface!=='preview')openReviewPreview(key);
    batch.reviewPreviewKey=key;batch.reviewEditingKey=key;
    closeFormatGovernance();
    renderReviewQueue(key,{preserveScroll:true});
    focusPreviewEditField(key,directCorrectionFields(task));
    return true;
  }

  function cancelPreviewEdit(editKey='',options={}){
    const key=String(editKey||batch.reviewEditingKey||'');
    if(!key||batch.reviewEditingKey!==key)return false;
    batch.reviewEditingKey='';
    renderReviewQueue(key,{preserveScroll:true});
    if(options.quiet!==true)setImportStatus('已取消编辑；未保存的修改已丢弃。','ok');
    return true;
  }

  async function savePreviewEdit(editKey=''){
    const key=String(editKey||batch.reviewEditingKey||'');
    const patch=previewEditorPatch(key);if(!patch)return false;
    const {task,recipients,subject,body,bodyHtml,bodyIsHtml}=patch;
    const subjectOk=isFollowUpReviewTask(task)?followUpSubjectValid(task,subject):!!subject;
    const missing=[];
    if(!recipientLooksValid(recipients))missing.push('有效收件人');
    if(!subjectOk)missing.push('主题');
    if(!String(body||'').trim())missing.push('正文');
    if(missing.length){setPreviewEditFeedback(key,`仍需补齐：${missing.join('、')}。`,'warn');return false;}
    if(isFollowUpReviewTask(task)){
      await ensureOperationStore();
      try{
        const updated=Operations.updateDerivedTaskContent(operationState.store,task.derivedTaskId,{recipients:Operations.parseRecipients(recipients),subject,body,bodyHtml,bodyIsHtml});
        operationState.store=updated.store;await commitRuntimeOperations();
      }catch(error){setPreviewEditFeedback(key,error?.message||String(error),'error');return false;}
      batch.reviewEditingKey='';
      renderReviewPageOverview();renderMonitoring();scheduleBatchRender({aux:false,force:true});
      setImportStatus('修改已保存；当前 Preview 已恢复只读，请确认这一版本后再进入排期。','warn');
      focusReviewTask(key,{behavior:'auto',block:'center'});
      return true;
    }
    batch.handoffComplete=false;
    setTaskEdit(task,{recipients,subject,body,bodyHtml,bodyIsHtml});
    rebuildTasks();
    batch.reviewEditingKey='';
    if(unresolvedDuplicateGroupCount()>0){
      hideReviewWorkspaceWithoutStash();setWorkbenchTab('batch');batch.uiStep=1;renderProcessGuide();renderRosterAudit();renderImportHandoff();
      history.replaceState(null,'','#batch');
      setImportStatus('邮件修改改变了查重结果；请先回到导入查重处理新的重复关系。','warn');
      requestAnimationFrame(()=>$('nmda-roster-audit-card')?.scrollIntoView?.({block:'nearest',behavior:'smooth'}));
      return true;
    }
    const current=reviewTaskByKey(key);
    renderReviewPageOverview();
    if(current){
      const stillPending=taskNeedsImportReview(current);
      setImportStatus(stillPending?'修改已保存；当前版本仍需在 Preview 中确认。':'修改已保存并通过确定性重新校验。',stillPending?'warn':'ok');
      focusReviewTask(key,{behavior:'auto',block:'center'});
    }
    if(!reviewTasks().length)await continueAfterReviewResolution('邮件审阅已完成');
    return true;
  }

  async function confirmPreviewTask(editKey='',options={advance:true}){
    const key=String(editKey||'');let task=reviewTaskByKey(key);if(!task)return false;
    if(batch.reviewEditingKey===key){setImportStatus('请先保存或取消当前编辑，再确认该版本。','warn');return false;}
    if(!taskCoreValid(task)){beginPreviewEdit(key);setPreviewEditFeedback(key,'当前版本仍有必填信息缺失，请先补齐。','warn');return false;}
    if(isFollowUpReviewTask(task)){
      await ensureOperationStore();
      try{const passed=Operations.passDerivedTaskReview(operationState.store,task.derivedTaskId);operationState.store=passed.store;await commitRuntimeOperations();}
      catch(error){setImportStatus(error?.message||String(error),'error');return false;}
      batch.reviewSelected?.delete?.(key);renderMonitoring();scheduleBatchRender({aux:false,force:true});
      setImportStatus(`Follow-up #${Math.max(1,Number(task.sequence||1))} 已确认，并进入选择与排期。`,'ok');
    }else{
      const previousEdit=batch.taskEdits.get(key)||{};
      setTaskEdit(task,{reviewConfirmed:true,rosterConfirmed:(task.rosterIssues||[]).length?true:!!previousEdit.rosterConfirmed,duplicateConfirmedGroups:[...(previousEdit.duplicateConfirmedGroups||[])]});
      rebuildTasks();task=reviewTaskByKey(key)||task;
      if(taskNeedsImportReview(task)){setImportStatus(`仍需处理：${unresolvedImportIssues(task).join('；')}`,'warn');renderReviewPageOverview();focusReviewTask(key,{behavior:'auto',block:'center'});return false;}
      setImportStatus('已确认当前邮件版本。','ok');
    }
    renderReviewPageOverview();
    const pending=reviewTasks();
    if(options.advance!==false&&pending.length){focusReviewTask(pending[0].editKey,{behavior:'smooth',block:'center'});return true;}
    if(!pending.length)await continueAfterReviewResolution('邮件审阅已完成');
    return true;
  }

  async function excludePreviewTask(editKey=''){
    const key=String(editKey||'');let task=reviewTaskByKey(key);if(!task)return false;
    if(batch.reviewEditingKey===key){setImportStatus('请先保存或取消当前编辑，再排除此封。','warn');return false;}
    const label=String(task.subject||task.recipients||task.id||'这封邮件').trim();
    batch.reviewSelected?.delete?.(key);
    if(isFollowUpReviewTask(task)){
      await ensureOperationStore();const result=Operations.setDerivedTaskState(operationState.store,task.derivedTaskId,'cancelled');operationState.store=result.store;await commitRuntimeOperations();
      setImportStatus(`已取消 Follow-up #${Math.max(1,Number(task.sequence||1))}。`,'ok');renderMonitoring();
    }else{
      batch.handoffComplete=false;setTaskEdit(task,{importExcluded:true});rebuildTasks();
      setImportStatus(`已将「${label}」移入垃圾箱；可随时恢复。`,'ok');
    }
    renderReviewPageOverview();renderReviewTrash();
    const next=reviewTasks()[0]||null;
    if(next)focusReviewTask(next.editKey,{behavior:'smooth',block:'center'});else await continueAfterReviewResolution('待处理邮件已完成');
    return true;
  }

  async function confirmSelectedReviewTasks() {
    const selected=selectedReviewTasks().filter(taskCanBatchConfirm);
    if(!selected.length)return;
    if(selected.some(task=>!isFollowUpReviewTask(task)))batch.handoffComplete=false;
    let confirmed=0,blocked=0,followUpConfirmed=0;
    await ensureOperationStore();
    for(const task of selected){
      const coreValid=taskCoreValid(task);
      if(!coreValid){blocked++;continue;}
      if(isFollowUpReviewTask(task)){
        try{
          const result=Operations.passDerivedTaskReview(operationState.store,task.derivedTaskId);
          operationState.store=result.store;
          confirmed++;followUpConfirmed++;
        }catch(_){blocked++;}
        continue;
      }
      const prev=batch.taskEdits.get(task.editKey)||{};
      batch.taskEdits.set(task.editKey,{...prev,reviewConfirmed:true,reviewDraftPending:false,rosterConfirmed:(task.rosterIssues||[]).length?true:!!prev.rosterConfirmed});
      confirmed++;
    }
    if(followUpConfirmed)await commitRuntimeOperations();
    batch.reviewSelected.clear();
    rebuildTasks();
    renderReviewPageOverview();
    renderMonitoring();
    scheduleBatchRender({aux:false,force:true});
    const message=blocked
      ? `已 Pass ${confirmed} 封；${blocked} 封仍有阻断或必填信息缺失。`
      : `已 Pass ${confirmed} 封邮件${followUpConfirmed?`，其中 Follow-up ${followUpConfirmed} 封已进入选择与排期`:''}。`;
    setImportStatus(message,blocked?'warn':'ok');
    if(!blocked)await continueAfterReviewResolution('所选邮件已通过审阅');
  }

  function selectVisibleReviewTasks() {
    if(!(batch.reviewSelected instanceof Set))batch.reviewSelected=new Set();
    const visible=reviewVisibleTasks().filter(taskCanBatchConfirm);
    const allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    if(allSelected) for(const task of visible)batch.reviewSelected.delete(task.editKey);
    else for(const task of visible)batch.reviewSelected.add(task.editKey);
    renderReviewQueue(batch.reviewEditingKey||'');
    renderReviewBatchActions();
    const button=$('nmda-review-select-filtered');if(button)button.textContent=allSelected?`批量确认 ${visible.length} 封…`:'取消批量选择';
  }


  function duplicateCandidateScore(task) {
    if(!task)return -9999;
    let score=0;
    if(recipientLooksValid(task.recipients||''))score+=22;
    if(String(task.subject||'').trim())score+=18;
    const bodyLength=String(task.body||'').trim().length;
    score+=Math.min(28,bodyLength/18);
    score+=Math.min(25,Math.max(0,Number(task.importConfidence||0))*.25);
    if(task.manuallyEdited)score+=3;
    score-=(task.errors||[]).length*16;
    score-=(task.attachmentDetails||[]).filter(item=>item.status!=='matched').length*10;
    return score;
  }

  function recommendedDuplicateTask(group) {
    return [...(group?.tasks||[])].sort((a,b)=>duplicateCandidateScore(b)-duplicateCandidateScore(a) || String(a.editKey).localeCompare(String(b.editKey)))[0]||null;
  }

  function duplicateCandidateMeta(task) {
    const bits=[];
    if(task.sourceFile)bits.push(`来源 ${task.sourceFile}`);
    const bodyLength=String(task.body||'').trim().length;
    bits.push(`正文 ${bodyLength} 字`);
    if(task.files?.length)bits.push(`附件 ${task.files.length}`);
    return bits.join(' · ');
  }

  function reviewIssueLabel(issue) {
    const text=String(issue||'');
    if(/收件人存在多个|多个相近候选/.test(text))return '收件人待核对';
    if(/未定位收件人|收件人邮箱|缺少收件人/.test(text))return '缺收件人';
    if(/主题为空|未找到 Subject|缺少主题/.test(text))return '缺主题';
    if(/缺少正文|正文过短/.test(text))return '正文缺失';
    if(/请检查 Follow-up 内容/.test(text))return 'Follow-up 需确认';
    if(/Follow-up 已阻断/.test(text))return 'Follow-up 已阻断';
    if(/邮件落款后|邮件边界|称呼|落款|置信度|请检查/.test(text))return '正文边界待核对';
    if(/总名单|联系人|院校/.test(text))return '联系人待核对';
    return text==='修改待确认'?'修改待确认':text;
  }

  function unresolvedDuplicateAuditGroups() {
    const seen=new Set(),groups=[];
    for(const task of (batch.tasks||[])){
      if(task?.importExcluded)continue;
      for(const group of unresolvedDuplicateGroups(task)){
        if(group?.id && !seen.has(group.id)){seen.add(group.id);groups.push(group);}
      }
    }
    return groups;
  }

  function renderDraftHistoryFilter() {
    if(!draftHistoryFilterEl||!draftHistoryListEl)return;
    const hits=unresolvedDraftHistoryHits();
    if(!hits.length){
      draftHistoryFilterEl.hidden=true;
      draftHistoryListEl.innerHTML='';
      return;
    }
    draftHistoryFilterEl.hidden=false;
    if(draftHistoryCountEl)draftHistoryCountEl.textContent=String(hits.length);
    draftHistoryListEl.innerHTML=hits.map(({task,history})=>{
      const recent=Operations.formatDisplayTime(history.lastDraftAt)||'时间未知';
      const subject=String(history.lastDraftSubject||'').trim();
      return `<label class="nmda-draft-history-filter-row"><input type="checkbox" data-draft-history-pick="${escapeHtml(task.editKey)}" checked><span><strong>${escapeHtml(task.recipients||task.id||'当前邮件')}</strong><small>已有草稿 ${history.draftCount} · 最近 ${escapeHtml(recent)}${subject?` · ${escapeHtml(subject)}`:''}</small></span><em>建议筛除</em></label>`;
    }).join('');
    if(draftHistoryExcludeEl)draftHistoryExcludeEl.textContent=`筛除所选（${hits.length}）`;
    if(draftHistoryKeepEl)draftHistoryKeepEl.textContent=`仍保留所选（${hits.length}）`;
    if(draftHistoryHintEl)draftHistoryHintEl.textContent='默认勾选全部命中项；这里仅按“邮箱中已存在 Draft”筛选，不比较正文版本。';
  }

  function renderDuplicateDecision() {
    if(!duplicateDecisionEl||!duplicateCandidatesEl)return;
    const groups=unresolvedDuplicateAuditGroups();
    const group=groups[0]||null;
    const draftHits=unresolvedDraftHistoryHits();
    const stateEl=$('nmda-import-dedupe-state');
    const syncAt=operationState.store?.mailboxSync?.lastDedupeAt||operationState.store?.mailboxSync?.lastFullAt||'';
    const checkable=(batch.tasks||[]).filter(task=>!task?.importExcluded&&taskNeedsDuplicateGate(task));
    const mailboxUnread=checkable.length>0&&!syncAt;
    const pendingCount=groups.length+draftHits.length;
    if(stateEl)stateEl.textContent=mailboxUnread?'邮箱历史自动读取中':pendingCount?`${pendingCount} 项待处理`:`查重完成 · 邮箱 ${Operations.formatDisplayTime(syncAt)}`;
    if(mailboxUnread){
      duplicateDecisionEl.hidden=false;delete duplicateDecisionEl.dataset.groupId;duplicateDecisionEl.dataset.scope='mailbox-read';
      if(duplicateDecisionKindEl){duplicateDecisionKindEl.textContent='前置核验';duplicateDecisionKindEl.dataset.tone='strong';}
      if(duplicateDecisionTitleEl)duplicateDecisionTitleEl.textContent='正在自动核验邮箱历史';
      if(duplicateDecisionCopyEl)duplicateDecisionCopyEl.textContent='新的 Initial Task 会自动核对网易邮箱里的已有草稿和已发送记录。核验完成后，这里会直接进入重复处理。';
      if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent='“读取草稿箱”导入属于接管现有草稿，不受此门控。';
      duplicateCandidatesEl.dataset.count='0';
      duplicateCandidatesEl.innerHTML='<article class="nmda-duplicate-candidate nmda-history-evidence is-auto-sync"><div class="nmda-duplicate-preview-head"><div class="nmda-duplicate-candidate-title"><strong>自动读取中</strong></div></div><div class="nmda-duplicate-preview-body"><pre>核验范围：已有草稿 · 已发送</pre></div></article>';
      if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.hidden=true;
      if(duplicateKeepAllEl)duplicateKeepAllEl.hidden=true;
      return;
    }
    if(!group){
      duplicateDecisionEl.hidden=true;delete duplicateDecisionEl.dataset.groupId;delete duplicateDecisionEl.dataset.scope;
      if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.hidden=false;
      if(duplicateKeepAllEl)duplicateKeepAllEl.hidden=false;
      return;
    }
    duplicateDecisionEl.hidden=false;duplicateDecisionEl.dataset.groupId=group.id;duplicateDecisionEl.dataset.scope=group.scope||'batch';
    if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.hidden=false;
    if(duplicateKeepAllEl)duplicateKeepAllEl.hidden=false;

    if(group.scope==='mailbox-history'){
      const task=group.task||group.tasks?.[0];
      const facts=[group.sentCount?`已发送 ${group.sentCount}`:'',group.draftCount?`另有草稿 ${group.draftCount}`:''].filter(Boolean).join(' · ');
      if(duplicateDecisionKindEl){duplicateDecisionKindEl.textContent='已发送';duplicateDecisionKindEl.dataset.tone='strong';}
      if(duplicateDecisionTitleEl)duplicateDecisionTitleEl.textContent=`${String(task?.recipients||'该收件人')} 已有发送历史`;
      if(duplicateDecisionCopyEl)duplicateDecisionCopyEl.textContent=`${facts}。已发送记录代表该联系人已经发生过外联；若这是继续联系，应从“邮件监测”创建 Follow-up。`;
      if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent=groups.length>1?`明确本封后继续处理剩余 ${groups.length-1} 组。`:'这是最后一组历史冲突；处理后即可进入邮件审阅。';
      if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.textContent='排除当前新邮件';
      if(duplicateKeepAllEl)duplicateKeepAllEl.textContent='仍保留本封';
      duplicateCandidatesEl.dataset.count='1';
      const currentBody=String(task?.body||'').trim();
      const current=`<article class="nmda-duplicate-candidate is-selected"><div class="nmda-duplicate-preview-head"><div class="nmda-duplicate-candidate-title"><strong>本次导入 · 新 Initial Task</strong><em>待决策</em></div><span class="nmda-duplicate-preview-recipient">${escapeHtml(task?.recipients||'')}</span></div><div class="nmda-duplicate-preview-body"><pre>${escapeHtml(currentBody||task?.subject||'正文为空')}</pre></div></article>`;
      const records=[...(group.sent||[]).slice(0,3).map(record=>({kind:'已发送',time:record.sentAt,subject:record.subject,id:record.providerMessageId||record.id}))];
      const history=records.map(record=>`<article class="nmda-duplicate-candidate nmda-history-evidence"><div class="nmda-duplicate-preview-head"><div class="nmda-duplicate-candidate-title"><strong>${escapeHtml(record.kind)}</strong></div><span class="nmda-duplicate-preview-recipient">${escapeHtml(Operations.formatDisplayTime(record.time)||'时间未知')}</span></div><div class="nmda-duplicate-preview-body"><pre>${escapeHtml(record.subject||'(无主题)')}${record.id?`\nID: ${escapeHtml(record.id)}`:''}</pre></div></article>`).join('');
      duplicateCandidatesEl.innerHTML=current+history;
      return;
    }

    const recommended=recommendedDuplicateTask(group);
    const validKeys=new Set((group.tasks||[]).filter(item=>!item?.importExcluded).map(item=>item.editKey));
    const savedRaw=batch.duplicateSelections?.get?.(group.id);
    const savedList=Array.isArray(savedRaw)?savedRaw:(savedRaw?[savedRaw]:[]);
    const selectedKeys=new Set(savedList.filter(key=>validKeys.has(key)));
    if(!selectedKeys.size){const fallback=recommended?.editKey||[...validKeys][0]||'';if(fallback)selectedKeys.add(fallback);}
    if(batch.duplicateSelections instanceof Map)batch.duplicateSelections.set(group.id,[...selectedKeys]);
    if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.textContent=`保留所选（${selectedKeys.size}）`;
    if(duplicateDecisionKindEl){duplicateDecisionKindEl.textContent=group.type==='exact-email'?'同一邮箱':'疑似同一联系人';duplicateDecisionKindEl.dataset.tone=group.type==='exact-email'?'strong':'soft';}
    if(duplicateKeepAllEl)duplicateKeepAllEl.textContent=group.type==='exact-email'?'明确全部保留':'不是同一联系人，全部保留';
    if(duplicateDecisionTitleEl)duplicateDecisionTitleEl.textContent=group.type==='exact-email'
      ? `同一收件人有 ${group.tasks?.length||0} 封邮件`
      : `可能是同一联系人：${group.tasks?.length||0} 封邮件`;
    if(duplicateDecisionCopyEl)duplicateDecisionCopyEl.textContent=group.type==='exact-email'
      ? `${group.email||group.label||'该收件人'}。导入阶段先决定哪些版本真正进入本批次。`
      : `${group.label||'姓名与院校相同'}。请根据收件人和正文确认是否属于同一联系人。`;
    if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent=groups.length>1
      ? `当前还有 ${groups.length} 组待处理；确认本组后自动显示下一组。`
      : '这是最后一组；确认后即可进入邮件审阅。';
    const compareTasks=(group.tasks||[]).filter(item=>!item?.importExcluded);
    duplicateCandidatesEl.dataset.count=String(compareTasks.length);
    duplicateCandidatesEl.innerHTML=compareTasks.map((candidate,index)=>{
      const isRecommended=candidate.editKey===recommended?.editKey;
      const isSelected=selectedKeys.has(candidate.editKey);
      const body=String(candidate.body||'').trim();
      const title=String(candidate.subject||candidate.id||`邮件 ${index+1}`).trim()||`邮件 ${index+1}`;
      const recipient=String(candidate.recipients||'').trim()||'未填写收件人';
      return `<article class="nmda-duplicate-candidate ${isSelected?'is-selected':''}" data-duplicate-row="${escapeHtml(candidate.editKey)}">
        <label class="nmda-duplicate-pick-line"><input type="checkbox" data-duplicate-pick="${escapeHtml(candidate.editKey)}" ${isSelected?'checked':''}><span><strong>保留此封</strong><small>${escapeHtml(duplicateCandidateMeta(candidate))}</small></span></label>
        <div class="nmda-duplicate-preview-head"><div class="nmda-duplicate-candidate-title"><strong>${escapeHtml(title)}</strong>${isRecommended?'<em>信息更完整</em>':''}</div><span class="nmda-duplicate-preview-recipient">${escapeHtml(recipient)}</span></div>
        <div class="nmda-duplicate-preview-body"><pre>${escapeHtml(body||'正文为空')}</pre></div>
      </article>`;
    }).join('');
  }

  function finishImportDuplicateDecision(summary='导入查重已更新') {
    batch.reviewSelected?.clear?.();
    rebuildTasks();
    renderImportTaskPreview();renderImportHandoff();renderRosterAudit();renderProcessGuide();
    const remaining=unresolvedDuplicateGroupCount();
    setImportStatus(remaining?`${summary}；还有 ${remaining} 项查重待处理。`:`${summary}；导入查重完成，可以进入邮件审阅。`,remaining?'warn':'ok');
  }

  async function keepSelectedDuplicateCandidate() {
    const groupId=duplicateDecisionEl?.dataset.groupId||'';if(!groupId)return;
    const group=(batch.duplicateAudit?.groups||[]).find(item=>item.id===groupId);
    if(!group){finishImportDuplicateDecision('重复信息已变化，已重新核验');return;}
    if(group.scope==='mailbox-history'){
      const task=group.task||group.tasks?.[0];
      if(task)setTaskEdit(task,{importExcluded:true});
      batch.duplicateSelections?.delete?.(groupId);
      finishImportDuplicateDecision('已排除命中邮箱历史的当前新邮件');
      return;
    }
    const selectedKeys=[...(duplicateCandidatesEl?.querySelectorAll('input[data-duplicate-pick]:checked')||[])].map(input=>input.dataset.duplicatePick).filter(Boolean);
    if(!selectedKeys.length){if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent='至少保留一封；如果本组都不需要，请回到来源分类中移除相应邮件。';return;}
    const selectedSet=new Set(selectedKeys),retained=(group.tasks||[]).filter(item=>selectedSet.has(item.editKey));
    for(const candidate of group.tasks||[]){
      if(selectedSet.has(candidate.editKey)){
        const prev=batch.taskEdits.get(candidate.editKey)||{};
        setTaskEdit(candidate,{duplicateConfirmedGroups:[...new Set([...(prev.duplicateConfirmedGroups||[]),groupId])],importExcluded:false});
      }else setTaskEdit(candidate,{importExcluded:true});
    }
    batch.duplicateSelections?.delete?.(groupId);
    const excluded=Math.max(0,(group.tasks?.length||0)-retained.length);
    finishImportDuplicateDecision(`已保留 ${retained.length} 封${excluded?`，排除 ${excluded} 封重复版本`:''}`);
  }

  async function keepAllDuplicateCandidates() {
    const groupId=duplicateDecisionEl?.dataset.groupId||'';if(!groupId)return;
    const group=(batch.duplicateAudit?.groups||[]).find(item=>item.id===groupId);
    if(!group){finishImportDuplicateDecision('重复信息已变化，已重新核验');return;}
    if(group.scope==='mailbox-history'){
      const task=group.task||group.tasks?.[0];
      if(task){const prev=batch.taskEdits.get(task.editKey)||{};setTaskEdit(task,{duplicateConfirmedGroups:[...new Set([...(prev.duplicateConfirmedGroups||[]),groupId])],importExcluded:false});}
      batch.duplicateSelections?.delete?.(groupId);
      finishImportDuplicateDecision('已明确保留该新邮件；邮箱历史冲突已记录为人工例外');
      return;
    }
    for(const candidate of group.tasks||[]){
      const prev=batch.taskEdits.get(candidate.editKey)||{};
      setTaskEdit(candidate,{duplicateConfirmedGroups:[...new Set([...(prev.duplicateConfirmedGroups||[]),groupId])],importExcluded:false});
    }
    batch.duplicateSelections?.delete?.(groupId);
    finishImportDuplicateDecision(`已明确保留该组 ${group.tasks?.length||0} 封邮件`);
  }

  function renderReviewPageOverview() {
    renderReviewTrash();
    const tasks=allReviewTasks();
    const initialCount=tasks.filter(task=>!isFollowUpReviewTask(task)).length;
    const followUpCount=tasks.filter(isFollowUpReviewTask).length;
    let checked=0,actionCount=0,autoPassed=0;
    for(const task of tasks){
      const visual=reviewVisualState(task);
      if(visual.key==='action')actionCount++;
      else if(visual.key==='confirmed')checked++;
      else autoPassed++;
    }
    const pendingCount=actionCount;
    if(reviewWorkspaceTitleEl)reviewWorkspaceTitleEl.textContent='邮件审阅';
    if(reviewWorkspaceDescEl)reviewWorkspaceDescEl.textContent=tasks.length?`${tasks.length} 封 · ${pendingCount} 需处理`:'';
    if(reviewInlineEl)reviewInlineEl.dataset.reviewState=tasks.length&&pendingCount===0?'complete':pendingCount?'pending':'empty';
    if(reviewNavCountEl){reviewNavCountEl.hidden=!pendingCount;reviewNavCountEl.textContent=String(pendingCount);}
    const reviewCounts={all:tasks.length,auto:autoPassed,pending:actionCount,confirmed:checked};
    ui.querySelectorAll('#nmda-review-filter [data-review-filter]').forEach(button=>{
      const key=button.dataset.reviewFilter||'all';
      const value=Number(reviewCounts[key]||0);
      const countEl=button.querySelector('strong');
      if(countEl)countEl.textContent=String(value);
    });
    if(reviewPageEmptyEl){reviewPageEmptyEl.hidden=!!tasks.length;reviewPageEmptyEl.textContent='导入 Initial 邮件，或在“邮件监测”生成 Follow-up 后，这里会统一显示自动通过与需处理邮件。';}
    if(!formatGovernanceEl?.hidden)renderBatchFollowUpTemplate();
    const nextPendingBtn=$('nmda-review-next-pending');
    if(nextPendingBtn){
      const pendingMails=reviewTasks();
      nextPendingBtn.hidden=!tasks.length;
      nextPendingBtn.dataset.mode=pendingMails.length?'next':'dispatch';
      nextPendingBtn.textContent=pendingMails.length?'下一个需处理':(batch.handoffComplete?'查看选择与排期 →':'正在同步到选择与排期…');
      nextPendingBtn.disabled=!pendingMails.length&&!batch.handoffComplete;
      nextPendingBtn.classList.toggle('nmda-btn-primary',!pendingMails.length&&batch.handoffComplete);
    }
    if(reviewFilterEl)reviewFilterEl.hidden=false;
    ui.querySelectorAll('[data-review-filter]').forEach(button=>button.classList.toggle('is-active',button.dataset.reviewFilter===batch.reviewFilter));
    if(reviewSearchEl && reviewSearchEl.value!==String(batch.reviewSearch||''))reviewSearchEl.value=String(batch.reviewSearch||'');
    if(!tasks.length){batch.reviewEditingKey='';setReviewSurface('board');renderReviewBatchActions();return;}
    renderReviewBatchActions();
    if(batch.reviewSurface==='preview'){renderBatchSubjectGovernance();renderFormatDriftSuggestions();}
    if(reviewInlineEl && !reviewInlineEl.hidden)renderReviewQueue(batch.reviewEditingKey||batch.reviewPreviewKey||'');
    scheduleReadyBatchAutoHandoff('邮件审阅已就绪');
  }

  function openReviewWorkspace(options = {}) {
    if(!batch.dataset){
      batch.reviewFilter=options.pendingOnly?'pending':'all';
      setWorkbenchTab('review');
      if(reviewInlineEl)reviewInlineEl.hidden=false;
      setReviewSurface(options.taskKey?'preview':'board');
      batch.reviewPreviewKey=options.taskKey||'';
      renderReviewPageOverview();
      if(options.taskKey)focusReviewTask(options.taskKey,{behavior:'smooth'});
      history.replaceState(null,'','#review');
      return true;
    }
    const duplicatePending=unresolvedDuplicateGroupCount();
    const attachmentIssues=typeof importAttachmentStats==='function'?Number(importAttachmentStats().issues||0):0;
    const contextPending=supplementPreflightNeedsDecision();
    if(duplicatePending||attachmentIssues||contextPending){
      const followUps=followUpReviewTasks();
      if(!followUps.length){
        setWorkbenchTab('batch');
        batch.uiStep=1;renderProcessGuide();renderRosterAudit();renderImportHandoff();
        const reasons=[];
        if(contextPending)reasons.push('导入准备未完成');
        if(attachmentIssues)reasons.push(`附件待处理 ${attachmentIssues} 项`);
        if(duplicatePending)reasons.push(`查重待处理 ${duplicatePending} 项`);
        setImportStatus(`${reasons.join('；')}。完成后再进入 Initial 邮件审阅。`,'warn');
        return false;
      }
      setImportStatus('当前 Initial 批次仍在导入阶段；邮件审阅暂时只显示 Follow-up。','warn');
    }
    batch.reviewReturnStep=1;
    batch.reviewFilter=options.pendingOnly?'pending':'all';
    viewPerf.reviewRenderLimit=REVIEW_RENDER_CHUNK;
    if(reviewQueueEl)reviewQueueEl.scrollTop=0;
    setWorkbenchTab('review');
    if(reviewInlineEl) reviewInlineEl.hidden=false;
    batch.reviewEditingKey='';
    batch.reviewPreviewKey=options.taskKey||'';
    setReviewSurface(options.taskKey?'preview':'board');
    renderReviewPageOverview();
    if(options.taskKey)focusReviewTask(options.taskKey,{behavior:'smooth'});
    history.replaceState(null,'','#review');
    syncModalState();
    return true;
  }


  function hideReviewWorkspaceWithoutStash() {
    if(reviewInlineEl)reviewInlineEl.hidden=false;
    batch.reviewEditingKey='';batch.reviewPreviewKey='';
    setReviewSurface('board');
  }

  let readyBatchAutoHandoffQueued=false;
  let readyBatchAutoHandoffRetryAt=0;
  function scheduleReadyBatchAutoHandoff(reason='邮件已准备好') {
    if(readyBatchAutoHandoffQueued||batch.running||batch.autoAdvancing||batch.handoffComplete)return;
    if(!batch.dataset||!(batch.tasks||[]).length||!initialReviewGateReady())return;
    if(reviewTasks().length)return;
    if((batch.tasks||[]).some(taskHasPrePlanningBlocker))return;
    readyBatchAutoHandoffQueued=true;
    queueMicrotask(()=>{
      readyBatchAutoHandoffQueued=false;
      void (async()=>{
        if(batch.running||batch.autoAdvancing||batch.handoffComplete||!batch.dataset||!(batch.tasks||[]).length)return;
        if(!initialReviewGateReady()||reviewTasks().length||(batch.tasks||[]).some(taskHasPrePlanningBlocker))return;
        if(!mailboxDedupeSnapshotAvailable()){
          const now=Date.now();
          if(now<readyBatchAutoHandoffRetryAt)return;
          readyBatchAutoHandoffRetryAt=now+8000;
          try{await requestAutoMailboxSync('history',{source:'ready-handoff'});}catch(_){return;}
          readyBatchAutoHandoffRetryAt=0;
          if(!mailboxDedupeSnapshotAvailable())return;
        }
        if(batch.handoffComplete||batch.running||batch.autoAdvancing||reviewTasks().length||(batch.tasks||[]).some(taskHasPrePlanningBlocker))return;
        const ready=await enterSelectionAndSchedule(reason);
        if(!ready)return;
        scheduleMailboxAutoSync('quick',{source:'ready-handoff'});
        renderReviewPageOverview();
        setImportStatus(`${reason}。已自动同步到“选择与排期”，可继续留在当前页面审阅，也可随时查看排期。`,'ok');
      })();
    });
  }

  async function enterSelectionAndSchedule(reason='检查完成') {
    if(batch.running || batch.autoAdvancing)return false;
    await ensureOperationStore();
    const pendingFollowUps=followUpReviewTasks().filter(taskNeedsImportReview);
    if(pendingFollowUps.length){setImportStatus(`还有 ${pendingFollowUps.length} 封 Follow-up 存在审阅异常。`,'warn');return false;}

    const initialReady=initialReviewGateReady() && !!batch.tasks?.length;
    if(initialReady){
      if((batch.tasks||[]).some(taskHasPrePlanningBlocker)){setBatchStatus('仍有 Initial 邮件内容或识别问题未通过审阅。','warn');return false;}
      const token=batch.sessionId;
      batch.autoAdvancing=true;
      try{
        await ensureCurrentBatchOperations(token);
        if(!isCurrentBatchSession(token)||(batch.tasks||[]).some(taskHasPrePlanningBlocker))return false;
        batch.handoffComplete=true;
        if(!batch.planningView)batch.planningView='rules';
      }finally{
        batch.autoAdvancing=false;
        renderImportHandoff();
      }
    }

    const followUpReady=Operations?.queuedDerivedTasks?.(operationState.store)?.length||0;
    if(!batch.handoffComplete && !followUpReady){
      setImportStatus('还没有通过邮件审阅并进入执行池的邮件。','warn');
      return false;
    }
    setBatchStatus(`${reason}。选择与排期已就绪。`,'ok');
    setImportStatus(`${reason}。已同步到“选择与排期”。`,'ok');
    scheduleBatchRender({aux:true,force:true});
    renderProcessGuide();
    return true;
  }

  async function continueAfterReviewResolution(reason='邮件检查完成') {
    const pending=reviewTasks();
    if(pending.length){
      renderReviewPageOverview();
      if(batch.reviewSurface==='preview'&&pending[0])focusReviewTask(pending[0].editKey,{behavior:'smooth',block:'center'});
      return false;
    }
    const other=initialReviewGateReady()?(batch.tasks||[]).filter(task=>taskHasPrePlanningBlocker(task)):[];
    if(other.length){
      hideReviewWorkspaceWithoutStash();
      setImportStatus(`邮件内容已处理完成；还有 ${other.length} 封存在其他问题。`,'warn');
      renderReviewPageOverview();
      return false;
    }
    const ready=await enterSelectionAndSchedule(reason);
    if(!ready)return false;
    batch.reviewEditingKey='';
    renderReviewPageOverview();
    setBatchStatus(`${reason}。已同步到“选择与排期”。`,'ok');
    return true;
  }

  function unresolvedDuplicateGroupCount(){
    const ids=new Set();
    const checkable=(batch.tasks||[]).filter(task=>!task?.importExcluded&&taskNeedsDuplicateGate(task));
    for(const task of checkable){
      for(const group of unresolvedDuplicateGroups(task))if(group?.id)ids.add(group.id);
    }
    // New Initial Tasks must be checked against mailbox Draft + Sent at least once.
    // This remains operator-triggered: the Import gate waits for a complete manual snapshot in the current app session.
    const mailboxUnread=checkable.length>0&&!mailboxDedupeSnapshotAvailable();
    const draftHits=mailboxUnread?0:unresolvedDraftHistoryHits(checkable).length;
    return ids.size+draftHits+(mailboxUnread?1:0);
  }


  function focusReviewTask(editKey,options={}){
    const key=String(editKey||''); if(!key||!reviewQueueEl)return false;
    const task=reviewTaskByKey(key); if(!task)return false;
    if(batch.reviewSurface==='preview')batch.reviewPreviewKey=key;
    const currentLimit=Math.max(REVIEW_RENDER_CHUNK,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
    const visible=reviewVisibleTasks();
    const index=visible.findIndex(item=>item.editKey===key);
    if(index>=currentLimit){viewPerf.reviewRenderLimit=Math.min(visible.length,index+REVIEW_RENDER_CHUNK);renderReviewQueue(key,{preserveScroll:true});}
    else renderReviewQueue(key,{preserveScroll:true});
    requestAnimationFrame(()=>{
      const row=reviewQueueEl.querySelector(`[data-review-row="${CSS.escape(key)}"]`);
      row?.scrollIntoView?.({block:options.block||'center',behavior:options.behavior||'smooth'});
      if(batch.reviewSurface==='preview')setReviewPreviewActiveKey(key,{revealRail:true,railBehavior:options.behavior||'smooth'});
      if(row){row.classList.add('is-jump-focus');window.setTimeout(()=>row.classList.remove('is-jump-focus'),1100);}
    });
    return true;
  }

  function openNextReviewTask(){
    if(!reviewQueueEl)return;
    const pending=reviewTasks();
    if(!pending.length){void continueAfterReviewResolution('邮件审阅已完成');return;}
    if(batch.reviewSurface!=='preview'){openReviewPreview(pending[0].editKey);return;}
    const pages=[...reviewQueueEl.querySelectorAll('[data-review-row]')];
    const viewportTop=reviewQueueEl.getBoundingClientRect().top;
    let currentKey='';
    for(const page of pages){if(page.getBoundingClientRect().top>=viewportTop+8){currentKey=page.dataset.reviewRow||'';break;}}
    let index=currentKey?pending.findIndex(task=>task.editKey===currentKey):-1;
    const next=pending[index>=0&&pending.length>1?(index+1)%pending.length:0]||pending[0];
    if(next)focusReviewTask(next.editKey,{behavior:'smooth',block:'center'});
  }

  function reviewCandidateEmails(task) {
    const {rowMeta,sourceBlocks,contextOffset=0}=taskSourceMeta(task);
    const candidates=[];
    const seen=new Set();
    const identityText=`${rowMeta?.heading||''} ${rowMeta?.salutation||''}`.toLowerCase();
    const identityTokens=identityText.replace(/[^a-z0-9\p{L}]+/gu,' ').split(/\s+/).filter(token=>token.length>=3&&!['dear','prof','professor','doctor','university','subject'].includes(token));
    const add=(email,index,score,reason,text='')=>{
      const key=String(email||'').toLowerCase();
      if(!key||seen.has(key))return;
      let adjusted=Number(score||0); const local=key.split('@')[0];
      if(identityTokens.some(token=>local.includes(token)))adjusted+=24;
      else if(Number.isFinite(index)&&rowMeta&&index>Number(rowMeta.endBlock??rowMeta.startBlock??0))adjusted-=36;
      if(reason==='当前邮件线索')adjusted+=20;
      if(adjusted<55)return;
      seen.add(key);
      candidates.push({email,index:Number.isFinite(index)?index:null,score:adjusted,reason,text});
    };
    for(const c of rowMeta?.recipientCandidates||[]) add(c.email,c.index,c.score,'原文附近',c.text||'');
    if(rowMeta?.recipientEvidence?.email) add(rowMeta.recipientEvidence.email,rowMeta.recipientEvidence.index,rowMeta.recipientEvidence.score,'当前邮件线索',rowMeta.recipientEvidence.text||'');
    if(sourceBlocks.length && rowMeta){
      const localStart=Math.max(0,Number(rowMeta.startBlock||0)-contextOffset-10), localEnd=Math.min(sourceBlocks.length-1,Number(rowMeta.endBlock ?? rowMeta.startBlock ?? 0)-contextOffset+10);
      // Reuse the recognizer's canonical recipient scoring instead of maintaining a second,
      // drifting email detector in the review UI. The UI may widen the evidence window for
      // manual recovery, but candidate semantics and penalties stay identical to parsing.
      const resolved=MailRecognizer?.resolveRecipientContext?.(sourceBlocks,localStart,localEnd,rowMeta?.salutation||'',{indexOffset:contextOffset});
      for(const c of resolved?.candidates||[]){
        const absolute=Number(c.index),reason=absolute<Number(rowMeta.startBlock||0)?'邮件前文附近':absolute>Number(rowMeta.endBlock??rowMeta.startBlock??0)?'邮件后文附近':'邮件正文范围';
        add(c.email,absolute,c.score,reason,c.text||'');
      }
    }
    if(task?.rosterEmailCandidate) add(task.rosterEmailCandidate,null,112,'总套磁名单唯一匹配',task?.rosterReference?.name||task?.rosterReference?.school||'总名单参考记录');
    return candidates.sort((a,b)=>b.score-a.score).slice(0,8);
  }

  function reviewVisualState(task) {
    const issues=unresolvedImportIssues(task);
    const direct=directCorrectionFields(task);
    if(direct.length)return {key:'action',label:'信息缺失',detail:'补齐后确认',icon:'!',issues,direct};
    if(issues.length)return isFollowUpReviewTask(task)
      ? {key:'action',label:'需处理',detail:'检查生成结果',icon:'!',issues,direct:[]}
      : {key:'action',label:'需核对',detail:'检查邮件内容',icon:'!',issues,direct:[]};
    if(isFollowUpReviewTask(task) && task.reviewConfirmed && task.reviewDecision==='auto')return {key:'auto',label:'自动通过',detail:'',icon:'✓',issues:[]};
    if(task.reviewConfirmed||task.rosterConfirmed)return {key:'confirmed',label:'已确认',detail:'',icon:'✓',issues:[]};
    return {key:'auto',label:'自动通过',detail:'',icon:'✓',issues:[]};
  }

  function reviewQueueItems(tasks=[]) { return (tasks||[]).map(task=>({kind:'mail',task})); }

  function renderReviewCardGrid(activeKey='',options={}) {
    const preserveScroll=!!options?.preserveScroll;
    const previousScrollTop=preserveScroll?reviewQueueEl.scrollTop:0;
    const visibleTasks=reviewVisibleTasks();
    const allItems=reviewQueueItems(visibleTasks);
    const renderLimit=Math.max(50,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
    const list=allItems.slice(0,renderLimit);
    const pendingCount=reviewTasks().length;
    const pendingUnits=reviewQueueItems(reviewTasks()).length;
    if(reviewProgressEl)reviewProgressEl.textContent=pendingUnits?`${pendingUnits} 待处理`:'0 待处理';
    reviewQueueEl.innerHTML=list.length?list.map((item,index)=>{
      const task=item.task;
      const visual=reviewVisualState(task);
      const pending=visual.issues.length>0;
      const confirmable=taskCanBatchConfirm(task);
      const checked=confirmable&&batch.reviewSelected?.has(task.editKey)?'checked':'';
      const recipient=String(task.recipients||'').trim()||'未识别收件人';
      const subject=String(task.subject||'').trim()||'未识别主题';
      const label=String(task.id||task.collectionName||recipient||`邮件 ${index+1}`);
      const cardTitle=reviewRailTitle(task,index);
      const issueLabels=[...new Set(visual.issues.map(issue=>reviewIssueLabel(issue)).filter(Boolean))];
      const issueChips=issueLabels.slice(0,2).map(issue=>`<span>${escapeHtml(issue)}</span>`).join('');
      const moreCount=Math.max(0,issueLabels.length-2);
      const selectHtml=confirmable?`<label class="nmda-mail-card-select" title="加入批量确认"><input type="checkbox" data-review-select="${escapeHtml(task.editKey)}" ${checked} aria-label="选择 ${escapeHtml(label)}"><span></span></label>`:'';
      const stateLine=pending
        ? `<span class="nmda-mail-card-issues">${issueChips}${moreCount?`<span>+${moreCount}</span>`:''}</span>`
        : '';
      const sourceBadge=isFollowUpReviewTask(task)?`<em class="nmda-review-source-badge is-followup">Follow-up #${Math.max(1,Number(task.sequence||1))}</em>`:'<em class="nmda-review-source-badge">Initial</em>';
      return `<article class="nmda-mail-review-card ${checked?'is-selected':''} ${task.editKey===activeKey?'is-active':''}" data-review-row="${escapeHtml(task.editKey)}" data-state="${escapeHtml(visual.key)}" data-review-kind="${isFollowUpReviewTask(task)?'follow_up':'initial'}">
        <div class="nmda-mail-card-status"><span class="nmda-mail-state-shape" aria-hidden="true">${visual.icon}</span><span><strong>${escapeHtml(visual.label)}</strong>${visual.detail?`<small>${escapeHtml(visual.detail)}</small>`:''}</span>${selectHtml}</div>
        <button class="nmda-mail-card-main" type="button" data-review-preview-key="${escapeHtml(task.editKey)}" aria-label="预览 ${escapeHtml(label)}">
          <span class="nmda-mail-card-index">${String(index+1).padStart(2,'0')}</span>
          <span class="nmda-mail-card-copy">${sourceBadge}<strong>${escapeHtml(cardTitle)}</strong><small>${escapeHtml(recipient)}</small><b>${escapeHtml(subject)}</b>${stateLine}</span>
          <span class="nmda-mail-card-open">Preview <i>→</i></span>
        </button>
      </article>`;
    }).join(''):`<div class="nmda-review-empty">${batch.reviewFilter==='pending'?'无待处理邮件':'暂无邮件'}</div>`;
    if(allItems.length>list.length)reviewQueueEl.insertAdjacentHTML('beforeend',`<button type="button" class="nmda-review-load-more" data-review-load-more><span>已显示 ${list.length} / ${allItems.length}</span><small>继续滚动自动加载</small></button>`);
    if(preserveScroll)requestAnimationFrame(()=>{reviewQueueEl.scrollTop=Math.min(previousScrollTop,Math.max(0,reviewQueueEl.scrollHeight-reviewQueueEl.clientHeight));});
    else if(activeKey)requestAnimationFrame(()=>reviewQueueEl.querySelector(`[data-review-row="${CSS.escape(activeKey)}"]`)?.scrollIntoView?.({block:'nearest'}));
    else requestAnimationFrame(()=>{reviewQueueEl.scrollTop=0;});
  }

  function reviewRailTitle(task,index=0) {
    const recipient=String(task?.recipients||'').trim();
    const angle=recipient.match(/^\s*([^<>;,]+?)\s*<[^>]+>/);
    if(angle?.[1] && !/@/.test(angle[1]))return angle[1].trim();
    const first=recipient.split(/[;,]/)[0]?.trim()||'';
    if(first)return first.length>34?`${first.slice(0,31)}…`:first;
    return String(task?.id||task?.collectionName||`邮件 ${index+1}`);
  }

  function renderReviewPreviewRail(tasks=[],activeKey='',totalCount=tasks.length) {
    if(!reviewPreviewRailEl||!reviewPreviewRailListEl)return;
    if(reviewPreviewRailCountEl)reviewPreviewRailCountEl.textContent=String(totalCount||0);
    reviewPreviewRailListEl.innerHTML=(tasks||[]).map((task,index)=>{
      const visual=reviewVisualState(task);
      const title=reviewRailTitle(task,index);
      const subject=String(task?.subject||'').trim()||'未识别主题';
      const kind=isFollowUpReviewTask(task)?`FU ${Math.max(1,Number(task.sequence||1))}`:'Initial';
      const active=task.editKey===activeKey;
      const editing=task.editKey===batch.reviewEditingKey;
      return `<button type="button" class="nmda-review-preview-rail-card ${active?'is-active':''} ${editing?'is-editing':''}" data-review-rail-key="${escapeHtml(task.editKey)}" data-state="${escapeHtml(visual.key)}" aria-current="${active?'true':'false'}" title="${escapeHtml(subject)}" style="--rail-delay:${Math.min(index,10)*18}ms">
        <span class="nmda-review-preview-rail-index">${String(index+1).padStart(2,'0')}</span>
        <span class="nmda-review-preview-rail-copy"><span><em>${escapeHtml(kind)}</em><i>${escapeHtml(editing?'编辑中':visual.label)}</i></span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subject)}</small></span>
      </button>`;
    }).join('') || '<div class="nmda-review-preview-rail-empty">当前没有邮件</div>';
    if(totalCount>tasks.length)reviewPreviewRailListEl.insertAdjacentHTML('beforeend',`<div class="nmda-review-preview-rail-more">${tasks.length} / ${totalCount}<small>继续下滚加载</small></div>`);
  }

  function setReviewPreviewActiveKey(editKey='',options={}) {
    if(batch.reviewSurface!=='preview')return;
    const key=String(editKey||'');if(!key)return;
    batch.reviewPreviewKey=key;
    reviewQueueEl?.querySelectorAll?.('.nmda-review-preview-page[data-review-row]').forEach(page=>page.classList.toggle('is-active',page.dataset.reviewRow===key));
    reviewPreviewRailListEl?.querySelectorAll?.('[data-review-rail-key]').forEach(card=>{
      const active=card.dataset.reviewRailKey===key;
      card.classList.toggle('is-active',active);
      card.setAttribute('aria-current',active?'true':'false');
    });
    const visible=reviewVisibleTasks();
    const index=visible.findIndex(task=>task.editKey===key);
    const previewMeta=$('nmda-review-preview-meta');
    if(previewMeta&&index>=0)previewMeta.textContent=`${index+1} / ${visible.length}`;
    const activeCard=reviewPreviewRailListEl?.querySelector?.(`[data-review-rail-key="${CSS.escape(key)}"]`);
    if(activeCard&&options.revealRail!==false)activeCard.scrollIntoView?.({block:'nearest',behavior:options.railBehavior||'auto'});
  }

  function syncReviewPreviewActiveFromScroll() {
    if(batch.reviewSurface!=='preview'||!reviewQueueEl)return;
    const pages=[...reviewQueueEl.querySelectorAll('.nmda-review-preview-page[data-review-row]')];
    if(!pages.length)return;
    const box=reviewQueueEl.getBoundingClientRect();
    const focusY=box.top+Math.min(190,Math.max(92,box.height*.23));
    let best=pages[0],bestDistance=Number.POSITIVE_INFINITY;
    for(const page of pages){
      const rect=page.getBoundingClientRect();
      if(rect.top<=focusY&&rect.bottom>=focusY){best=page;bestDistance=0;break;}
      const distance=Math.min(Math.abs(rect.top-focusY),Math.abs(rect.bottom-focusY));
      if(distance<bestDistance){bestDistance=distance;best=page;}
    }
    const key=best?.dataset?.reviewRow||'';
    if(batch.reviewEditingKey)return;
    if(key&&key!==batch.reviewPreviewKey)setReviewPreviewActiveKey(key,{revealRail:true,railBehavior:'smooth'});
  }

  function renderReviewContinuousPreview(activeKey='',options={}) {
    const preserveScroll=!!options?.preserveScroll;
    const previousScrollTop=preserveScroll?reviewQueueEl.scrollTop:0;
    const previousRailScrollTop=preserveScroll?(reviewPreviewRailListEl?.scrollTop||0):0;
    const visibleTasks=reviewVisibleTasks();
    const allItems=reviewQueueItems(visibleTasks);
    const renderLimit=Math.max(REVIEW_RENDER_CHUNK,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
    const list=allItems.slice(0,renderLimit);
    renderReviewPreviewRail(list.map(item=>item.task),activeKey,visibleTasks.length);
    const pendingUnits=reviewQueueItems(reviewTasks()).length;
    if(reviewProgressEl)reviewProgressEl.textContent=pendingUnits?`${pendingUnits} 待处理`:'0 待处理';
    const activeIndex=activeKey?visibleTasks.findIndex(task=>task.editKey===activeKey):-1;
    const previewMeta=$('nmda-review-preview-meta');
    if(previewMeta)previewMeta.textContent=activeIndex>=0?`${activeIndex+1} / ${visibleTasks.length}`:`${visibleTasks.length} 封`;
    reviewQueueEl.innerHTML=list.length?list.map((item,index)=>{
      const task=item.task;
      const visual=reviewVisualState(task);
      const pending=visual.issues.length>0;
      const editing=task.editKey===batch.reviewEditingKey;
      const recipient=String(task.recipients||'').trim()||'未识别收件人';
      const subject=String(task.subject||'').trim()||'未识别主题';
      const label=String(task.id||task.collectionName||recipient||`邮件 ${index+1}`);
      const issueLabels=[...new Set(visual.issues.map(issue=>reviewIssueLabel(issue)).filter(Boolean))];
      const issueChips=issueLabels.map(issue=>`<span>${escapeHtml(issue)}</span>`).join('');
      const sourceBadge=isFollowUpReviewTask(task)?`<em class="nmda-review-source-badge is-followup">Follow-up #${Math.max(1,Number(task.sequence||1))}</em>`:'<em class="nmda-review-source-badge">Initial</em>';
      const stateCopy=pending?`<div class="nmda-preview-issues">${issueChips}</div>`:`<span class="nmda-preview-pass-note">✓ ${visual.key==='confirmed'?'人工确认':'自动通过'}</span>`;
      const editLabel=visual.direct?.length?'补齐':'编辑';
      const confirmable=taskCanBatchConfirm(task);
      const menuLabel=isFollowUpReviewTask(task)?'取消跟进':'排除此封';
      const headActions=editing
        ? `<div class="nmda-review-preview-actions is-editing"><span class="nmda-preview-editing-cue"><i></i>编辑权限已开启</span><button class="nmda-preview-inline-cancel" type="button" data-preview-edit-cancel="${escapeHtml(task.editKey)}">取消</button><button class="nmda-preview-inline-save" type="button" data-preview-edit-save="${escapeHtml(task.editKey)}">保存修改</button></div>`
        : `<div class="nmda-review-preview-actions">${confirmable?`<button class="nmda-preview-inline-confirm" type="button" data-preview-confirm-key="${escapeHtml(task.editKey)}">确认无误</button>`:''}<button class="nmda-review-preview-edit" type="button" data-preview-edit-key="${escapeHtml(task.editKey)}">${editLabel}</button><details class="nmda-preview-more"><summary aria-label="更多操作">•••</summary><button type="button" data-preview-exclude-key="${escapeHtml(task.editKey)}">${menuLabel}</button></details></div>`;
      let sheet='';
      if(editing){
        const suggestions=!recipientLooksValid(task.recipients||'')?reviewCandidateEmails(task).slice(0,5):[];
        const suggestionHtml=suggestions.length?`<div class="nmda-preview-recipient-suggestions"><span>候选收件人</span>${suggestions.map(c=>`<button type="button" data-preview-recipient-suggestion="${escapeHtml(c.email)}" title="${escapeHtml(c.reason||'')}">${escapeHtml(c.email)}</button>`).join('')}</div>`:'';
        const rich=taskRichBodyHtml(task)||plainMailBodyToHtml(task?.body||'');
        sheet=`<section class="nmda-review-preview-sheet nmda-review-preview-sheet-edit" aria-label="${escapeHtml(label)} 编辑">
          <div class="nmda-preview-inline-fields">
            <label><span>To</span><input data-preview-edit-recipients type="text" value="${escapeHtml(String(task.recipients||''))}" placeholder="recipient@example.edu"></label>
            ${suggestionHtml}
            <label><span>Subject</span><input data-preview-edit-subject type="text" value="${escapeHtml(String(task.subject||''))}" placeholder="邮件主题"></label>
          </div>
          <div class="nmda-preview-inline-formatbar" aria-label="正文格式"><button type="button" data-preview-rich-command="bold" title="加粗（Ctrl+B）"><strong>B</strong></button><button type="button" data-preview-rich-command="italic" title="斜体（Ctrl+I）"><em>I</em></button><button type="button" data-preview-rich-command="underline" title="下划线（Ctrl+U）"><u>U</u></button><span>保持原邮件格式 · 保存后仍在同一 Preview 核对</span></div>
          <div class="nmda-review-preview-body nmda-preview-inline-body" data-preview-edit-body contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true">${rich}</div>
          <div class="nmda-preview-inline-feedback" data-preview-edit-feedback hidden></div>
        </section>`;
      }else{
        sheet=`<section class="nmda-review-preview-sheet" aria-label="${escapeHtml(label)} 完整邮件预览">
          <div class="nmda-review-preview-mailhead"><span>To</span><strong>${semanticHighlightHtml(recipient,task)}</strong><span>Subject</span><strong class="nmda-preview-subject-value" data-preview-subject>${semanticHighlightHtml(subject,task)}</strong></div>
          <div class="nmda-review-preview-body nmda-review-rich-body">${decorateReviewRichHtml(task)}</div>
        </section>`;
      }
      const footer=editing
        ? `<footer class="nmda-review-preview-foot is-editing"><div class="nmda-preview-edit-note">修改只生成新版本，不会沿用旧确认；保存后在当前 Preview 继续核对。</div></footer>`
        : (pending?`<footer class="nmda-review-preview-foot">${stateCopy}${confirmable?`<button class="nmda-preview-confirm-next" type="button" data-preview-confirm-key="${escapeHtml(task.editKey)}">确认并继续 →</button>`:''}</footer>`:'');
      return `<article class="nmda-review-preview-page ${task.editKey===activeKey?'is-active':''} ${editing?'is-editing':''}" data-review-row="${escapeHtml(task.editKey)}" data-state="${escapeHtml(visual.key)}" data-review-kind="${isFollowUpReviewTask(task)?'follow_up':'initial'}" style="--page-delay:${Math.min(index,10)*16}ms">
        <header class="nmda-review-preview-head">
          <div class="nmda-review-preview-index"><span>${String(index+1).padStart(2,'0')}</span>${sourceBadge}</div>
          <div class="nmda-review-preview-meta"><strong>${semanticHighlightHtml(recipient,task)}</strong><small class="nmda-preview-subject-value" data-preview-subject>${semanticHighlightHtml(subject,task)}</small></div>
          <div class="nmda-review-preview-state"><span class="nmda-mail-state-shape" aria-hidden="true">${editing?'✎':visual.icon}</span><span><strong>${editing?'编辑中':escapeHtml(visual.label)}</strong>${!editing&&visual.detail?`<small>${escapeHtml(visual.detail)}</small>`:''}</span></div>
          ${headActions}
        </header>
        ${sheet}
        ${footer}
      </article>`;
    }).join(''):`<div class="nmda-review-empty">${batch.reviewFilter==='pending'?'无待处理邮件':'暂无邮件'}</div>`;
    if(allItems.length>list.length)reviewQueueEl.insertAdjacentHTML('beforeend',`<button type="button" class="nmda-review-load-more" data-review-load-more><span>已显示 ${list.length} / ${allItems.length}</span><small>继续向下滚动自动加载</small></button>`);
    if(preserveScroll)requestAnimationFrame(()=>{
      reviewQueueEl.scrollTop=Math.min(previousScrollTop,Math.max(0,reviewQueueEl.scrollHeight-reviewQueueEl.clientHeight));
      if(reviewPreviewRailListEl)reviewPreviewRailListEl.scrollTop=Math.min(previousRailScrollTop,Math.max(0,reviewPreviewRailListEl.scrollHeight-reviewPreviewRailListEl.clientHeight));
      setReviewPreviewActiveKey(activeKey||batch.reviewPreviewKey,{revealRail:false});
    });
    else if(activeKey)requestAnimationFrame(()=>{
      reviewQueueEl.querySelector(`[data-review-row="${CSS.escape(activeKey)}"]`)?.scrollIntoView?.({block:'center'});
      setReviewPreviewActiveKey(activeKey,{revealRail:true,railBehavior:'smooth'});
    });
  }

  function renderReviewQueue(activeKey='',options={}) {
    if(!reviewQueueEl)return;
    pruneReviewSelection();
    const surface=batch.reviewSurface==='preview'?'preview':'board';
    setReviewSurface(surface);
    if(surface==='preview')renderReviewContinuousPreview(activeKey,options);
    else renderReviewCardGrid(activeKey,options);
    renderReviewBatchActions();
    const visible=reviewVisibleTasks().filter(taskCanBatchConfirm),allSelected=visible.length&&visible.every(task=>batch.reviewSelected.has(task.editKey));
    const selectButton=$('nmda-review-select-filtered');if(selectButton){const batchMode=batch.reviewFilter==='pending'&&reviewTasks().length>0;selectButton.hidden=surface==='preview'||!batchMode||visible.length<2;selectButton.textContent=allSelected?'取消批量选择':`批量确认 ${visible.length} 封…`;}
  }

  function openReviewPreview(editKey='') {
    const key=String(editKey||'');
    if(batch.reviewEditingKey&&batch.reviewEditingKey!==key){setImportStatus('请先保存或取消当前邮件的编辑，再切换邮件。','warn');return;}
    batch.reviewPreviewKey=key;
    viewPerf.reviewRenderLimit=REVIEW_RENDER_CHUNK;
    setReviewSurface('preview');
    if(reviewQueueEl)reviewQueueEl.scrollTop=0;
    renderReviewQueue(key);
    if(key)focusReviewTask(key,{behavior:'smooth',block:'center'});
  }

  function closeReviewPreview() {
    if(batch.reviewEditingKey){setImportStatus('请先保存或取消当前邮件的编辑，再返回卡片。','warn');return;}
    const key=String(batch.reviewPreviewKey||'');
    batch.reviewPreviewKey='';
    setReviewSurface('board');
    if(reviewQueueEl)reviewQueueEl.scrollTop=0;
    renderReviewQueue(key);
  }

  function escapeRegex(value) {
    return String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }

  function reviewSemanticModel(task) {
    const body=String(task?.body||'');
    const recipient=String(task?.recipients||'');
    const advisors=new Set(),students=new Set(),institutions=new Set();
    const angle=recipient.match(/^\s*([^<>;,]+?)\s*<[^>]+>/);
    if(angle?.[1] && !/@/.test(angle[1]))advisors.add(angle[1].trim());
    const greeting=body.match(/(?:^|\n)\s*(?:Dear|Hello|Hi)\s+(?:(?:Professor|Prof\.?|Dr\.?)\s+)?([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2})(?=\s*[,!:：\n])/m);
    if(greeting?.[1] && greeting[1].length<70)advisors.add(greeting[1].trim());
    const intro=body.match(/\bMy name is\s+([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})\b/);
    if(intro?.[1])students.add(intro[1].trim());
    const lines=body.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const signoffIndex=lines.findIndex(line=>/^(?:Best|Kind|Warm)?\s*Regards[,.!]?|^Sincerely[,.!]?|^Yours sincerely[,.!]?$/i.test(line));
    if(signoffIndex>=0){
      const candidate=lines[signoffIndex+1]||'';
      if(/^[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3}$/.test(candidate)&&candidate.length<70)students.add(candidate);
    }
    if(task?.school)institutions.add(String(task.school).trim());
    const instRe=/\b(?:at|from)\s+((?:[A-Z][A-Za-z&.'’()-]*\s+){1,8}(?:University|College|Institute|School))\b/g;
    for(const match of body.matchAll(instRe)){if(match[1]?.length<100)institutions.add(match[1].trim());}
    return {advisors:[...advisors].filter(Boolean),students:[...students].filter(Boolean),institutions:[...institutions].filter(Boolean)};
  }

  function reviewSemanticRanges(text,task) {
    const source=String(text||'');
    const model=reviewSemanticModel(task),ranges=[];
    const add=(start,end,type,label,priority=5)=>{if(start>=0&&end>start)ranges.push({start,end,type,label,priority});};
    const addExact=(value,type,label,priority=10)=>{
      const needle=String(value||'').trim();if(needle.length<2)return;
      const re=new RegExp(escapeRegex(needle),'gi');let m;
      while((m=re.exec(source))){add(m.index,m.index+m[0].length,type,label,priority);if(!m[0].length)re.lastIndex++;}
    };
    model.advisors.forEach(value=>addExact(value,'advisor','导师名',12));
    model.students.forEach(value=>addExact(value,'student','学生名',12));
    model.institutions.forEach(value=>addExact(value,'institution','学校 / 机构',11));
    const patterns=[
      {re:/\b(?:Dear|Hello|Hi)\b/gi,type:'anchor',label:'称呼'},
      {re:/\bMy name is\b/gi,type:'anchor',label:'身份介绍'},
      {re:/\b(?:I(?:'m| am) writing to|I would like to|I hope to)\b/gi,type:'anchor',label:'联系意图'},
      {re:/\b(?:Best Regards|Kind Regards|Warm Regards|Sincerely|Yours sincerely)\b/gi,type:'anchor',label:'落款'},
      {re:/\b(?:Ph\.?D\.?|MSc|M\.Sc\.?|Master(?:'s)?|Bachelor(?:'s)?|Fall\s+20\d{2}|Spring\s+20\d{2})\b/gi,type:'degree',label:'学位 / 时间'}
    ];
    for(const item of patterns){let m;while((m=item.re.exec(source))){add(m.index,m.index+m[0].length,item.type,item.label,4);if(!m[0].length)item.re.lastIndex++;}}
    ranges.sort((a,b)=>a.start-b.start||b.priority-a.priority||(b.end-b.start)-(a.end-a.start));
    const chosen=[];let cursor=-1;
    for(const range of ranges){if(range.start<cursor)continue;chosen.push(range);cursor=range.end;}
    return {model,ranges:chosen};
  }

  function semanticHighlightHtml(text,task) {
    const source=String(text??'');
    const doc=new DOMParser().parseFromString('<div id="nmda-review-plain-root"></div>','text/html'),root=doc.getElementById('nmda-review-plain-root');
    if(!root)return escapeHtml(source);root.textContent=source;
    const quoteRanges=mailQuotedAttentionRanges(source);
    if(quoteRanges.length){
      const frag=doc.createDocumentFragment();let cursor=0;
      for(const range of quoteRanges){
        if(range.start>cursor)frag.appendChild(doc.createTextNode(source.slice(cursor,range.start)));
        const span=doc.createElement('span');span.className='nmda-format-mark nmda-attention-mark';span.dataset.format='quote';span.title='引号强调';span.textContent=source.slice(range.start,range.end);frag.appendChild(span);cursor=range.end;
      }
      if(cursor<source.length)frag.appendChild(doc.createTextNode(source.slice(cursor)));root.replaceChildren(frag);
    }
    const walker=doc.createTreeWalker(root,4),nodes=[];let node;while((node=walker.nextNode()))if(String(node.nodeValue||'').trim())nodes.push(node);
    for(const textNode of nodes){
      const value=String(textNode.nodeValue||''),ranges=reviewSemanticRanges(value,task).ranges;if(!ranges.length)continue;
      const frag=doc.createDocumentFragment();let cursor=0;
      for(const range of ranges){
        if(range.start>cursor)frag.appendChild(doc.createTextNode(value.slice(cursor,range.start)));
        const mark=doc.createElement('mark');mark.className='nmda-semantic-mark';mark.dataset.semantic=range.type;mark.title=range.label;mark.textContent=value.slice(range.start,range.end);frag.appendChild(mark);cursor=range.end;
      }
      if(cursor<value.length)frag.appendChild(doc.createTextNode(value.slice(cursor)));textNode.replaceWith(frag);
    }
    return root.innerHTML;
  }

  function renderImportTaskPreview() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    renderReviewTrash();
  }

  async function ensureCurrentBatchOperations(sessionToken = batch.sessionId) {
    if (!Operations || !isCurrentBatchSession(sessionToken)) return false;
    try {
      // Only use mailbox facts already read in the current app session. Mailbox access is explicitly user-triggered
      // from the shared automatic mailbox sync layer (manual full reread remains available as recovery).
      await ensureOperationStore();
      return isCurrentBatchSession(sessionToken);
    } catch (error) {
      console.warn(`[${APP}] operations initialization failed`, error);
      return false;
    }
  }

  function parseTaskClassifications(value) {
    return Operations?.parseTags?.(value) || [];
  }


  function normalizedSearchText(value) {
    return String(value || '').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
  }

  function taskMatchesSearch(task) {
    const query = normalizedSearchText(batchSearchEl?.value || '');
    if (!query) return true;
    const dynamic = normalizedSearchText([taskBusinessTags(task).join(' '), statusLabel(task)].join(' '));
    const haystack = `${task._searchStatic || ''} ${dynamic}`;
    return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
  }

  function normalizedTagSet(tags) {
    return new Set((Operations?.parseTags?.(tags) || []).map(tag => tag.toLocaleLowerCase('zh-CN')));
  }

  function taskMatchesTagFilter(task) {
    if (!taskMatchesSearch(task)) return false;
    const include = Operations?.parseTags?.(batchTagIncludeEl?.value || '') || [];
    if (!include.length) return true;
    const own = normalizedTagSet(taskBusinessTags(task));
    const includeKeys = include.map(tag => tag.toLocaleLowerCase('zh-CN'));
    return includeKeys.every(tag => own.has(tag));
  }

  function filteredBatchTasks() {
    return dispatchTasks().filter(taskMatchesTagFilter);
  }

  function refreshTaskCoreValidation(task) {
    if(!task)return;
    const errors=(task.errors||[]).filter(error=>!/^(缺少收件人|收件人邮箱格式无效|缺少主题|缺少正文)$/.test(String(error||'')));
    if(!String(task.recipients||'').trim())errors.push('缺少收件人');
    else if(!recipientLooksValid(task.recipients))errors.push('收件人邮箱格式无效');
    if(!String(task.subject||'').trim())errors.push('缺少主题');
    if(!String(task.body||'').trim())errors.push('缺少正文');
    task.errors=[...new Set(errors)];
    task.warnings=(task.warnings||[]).filter(warning=>{
      const text=String(warning||'');
      if(/主题为空/.test(text)&&String(task.subject||'').trim())return false;
      if(/未定位收件人|无收件人/.test(text)&&recipientLooksValid(task.recipients))return false;
      if(/正文过短/.test(text)&&String(task.body||'').length>=40)return false;
      return true;
    });
    if(task.status==='ready'||task.status==='error')task.status=task.errors.length?'error':'ready';
  }

  function setTaskEdit(task, patch) {
    const prev = batch.taskEdits.get(task.editKey) || {};
    const beforeReviewIssues=unresolvedImportIssues(task);
    const bodyFormatChanged=(patch.bodyHtml!=null && String(patch.bodyHtml||'')!==String(task.bodyHtml||''))
      || (patch.bodyIsHtml!=null && !!patch.bodyIsHtml!==!!task.bodyIsHtml);
    const coreChanged=(patch.recipients!=null && String(patch.recipients||'').trim()!==String(task.recipients||'').trim())
      || (patch.subject!=null && String(patch.subject||'').trim()!==String(task.subject||'').trim())
      || (patch.body!=null && String(patch.body||'')!==String(task.body||''))
      || bodyFormatChanged;
    const next = { ...prev, ...patch };
    const duplicateIdentityChanged=(patch.recipients!=null && String(patch.recipients||'').trim()!==String(task.recipients||'').trim())
      || (patch.school!=null && String(patch.school||'').trim()!==String(task.school||'').trim());
    if(duplicateIdentityChanged && patch.duplicateConfirmedGroups==null)next.duplicateConfirmedGroups=[];
    if(duplicateIdentityChanged && patch.draftHistoryDecision==null){next.draftHistoryDecision='';next.draftHistoryDecisionKey='';}
    let deterministicRepairClearsAll=false;
    if(coreChanged && patch.reviewConfirmed==null && beforeReviewIssues.length){
      const hadDeterministicGap=beforeReviewIssues.some(isAutoResolvableReviewIssue)
        || !recipientLooksValid(task.recipients||'') || !String(task.subject||'').trim() || !String(task.body||'').trim();
      if(hadDeterministicGap){
        const prospective={...task,...patch,reviewConfirmed:false,reviewDraftPending:false};
        deterministicRepairClearsAll=unresolvedImportIssues(prospective).length===0;
      }
    }
    if(coreChanged && patch.reviewConfirmed==null){
      next.reviewConfirmed=false;
      // Missing-field repairs are evaluated against the resulting current facts. If the repair
      // removes every remaining review reason, no second confirmation is required. Editing a
      // previously clean mail or a genuinely ambiguous parse still needs explicit confirmation.
      next.reviewDraftPending=!deterministicRepairClearsAll;
    }
    if(patch.reviewConfirmed===true)next.reviewDraftPending=false;
    if (patch.tags != null) next.tags = parseTaskClassifications(patch.tags);
    batch.taskEdits.set(task.editKey, next);
    if (patch.enabled != null || patch.school != null || patch.scheduleAt != null) batch.schedulePlan = null;
    if (patch.enabled != null) task.enabled = !!patch.enabled;
    if(coreChanged && patch.reviewConfirmed==null){task.reviewConfirmed=false;task.reviewDraftPending=!deterministicRepairClearsAll;}
    if(patch.reviewConfirmed===true){task.reviewConfirmed=true;task.reviewDraftPending=false;}
    if(patch.duplicateConfirmedGroups!=null)task.duplicateConfirmedGroups=[...(patch.duplicateConfirmedGroups||[])];
    else if(duplicateIdentityChanged)task.duplicateConfirmedGroups=[];
    if (patch.recipients != null) task.recipients = String(patch.recipients || '').trim();
    if (patch.subject != null) task.subject = String(patch.subject || '').trim();
    if (patch.body != null) task.body = String(patch.body || '');
    if (patch.bodyHtml != null) task.bodyHtml = sanitizeEmailRichHtml(patch.bodyHtml || '');
    if (patch.bodyIsHtml != null) task.bodyIsHtml = !!patch.bodyIsHtml && !!String(task.bodyHtml||'').trim();
    if (patch.tags != null) task.tags = parseTaskClassifications(patch.tags);
    if (patch.school != null) task.school = String(patch.school || '').trim();
    if (patch.scheduleAt != null) task.scheduleAt = String(patch.scheduleAt || '');
    if (patch.scheduleSource != null) task.scheduleSource = String(patch.scheduleSource || '');
    if (patch.scheduleReason != null) task.scheduleReason = String(patch.scheduleReason || '');
    if (patch.recipients != null || patch.subject != null || patch.body != null) refreshTaskCoreValidation(task);
    if (patch.recipients != null || patch.subject != null || patch.body != null || patch.school != null || patch.scheduleAt != null || patch.tags != null) refreshTaskSearchStatic(task);
  }

  function configureCollection(index, useAuto = true) {
    batch.collectionIndex = Number(index) || 0;
    const collection = currentCollection();
    if (!collection) return;
    const config = ensureCollectionConfig(batch.collectionIndex, { reset: useAuto });
    batch.detection = config.detection;
    batch.mapping = config.mapping;
    rebuildTasks();
  }

  function allAttachmentFiles() {
    syncAttachmentPolicies();
    return uniqueFiles([...batch.directoryFiles, ...batch.taskFiles, ...batch.routedAttachmentFiles]);
  }

  function attachmentFileEligibleForTask(file,taskKey){
    const policy=attachmentPolicyForFile(file);
    if(policy.mode==='selected')return (policy.targets||[]).includes(taskKey);
    return true;
  }

  function attachmentPoolFiles(taskKey='') {
    return allAttachmentFiles().filter(file=>!taskKey||attachmentFileEligibleForTask(file,taskKey));
  }

  function attachmentExtraFilesForTask(taskKey){
    return allAttachmentFiles().filter(file=>{const policy=attachmentPolicyForFile(file);return policy.mode==='all'||(policy.mode==='selected'&&(policy.targets||[]).includes(taskKey));});
  }

  function clearStaleOverrides() {
    const valid = new Set(allAttachmentFiles().map(file => Importer.fileIdentity(file)));
    for (const [key, file] of batch.attachmentOverrides) if (!valid.has(Importer.fileIdentity(file))) batch.attachmentOverrides.delete(key);
  }

  function refreshFileIndex(resetOverrides = false) {
    if(batch.handoffComplete) batch.handoffComplete=false;
    if (resetOverrides) batch.attachmentOverrides.clear();
    clearStaleOverrides();
    const files = allAttachmentFiles();
    batch.fileIndex = Importer.buildFileIndex(files);
    const counts={smart:0,all:0,selected:0};for(const file of files){const mode=attachmentPolicyForFile(file).mode||'smart';counts[mode]=(counts[mode]||0)+1;}
    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const sizeText = totalBytes < 1024 * 1024 ? `${Math.round(totalBytes / 1024)} KB` : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
    const info=$('nmda-file-index-info');if(info)info.textContent=files.length?`已准备 ${files.length} 个附件（自动 ${counts.smart} / 全部 ${counts.all} / 指定 ${counts.selected}，共 ${sizeText}）。`:'尚未选择本地附件。';
    rebuildTasks();renderAttachmentAssetViews();
    if(batch.tasks.length&&batch.dataset&&!batch.importBusy)renderImportHandoff();
  }

  function mergeTaskFiles(resolvedFiles,taskKey) {
    return uniqueFiles([...(resolvedFiles || []), ...attachmentExtraFilesForTask(taskKey)]);
  }

  function resolveAttachmentRefs(refs,taskKey='') {
    const pool=attachmentPoolFiles(taskKey),index=Importer.buildFileIndex(pool);
    const resolved = Importer.resolveFiles(refs, index);
    const files = [],missing = [],ambiguous = [],details = [];
    for (const detail of resolved.details || []) {
      const key = Importer.normalizeFileKey(detail.ref),override = batch.attachmentOverrides.get(key);
      if (override && (!taskKey || attachmentFileEligibleForTask(override,taskKey))) {
        files.push(override);details.push({ ...detail, status: 'matched', file: override, method: 'manual' });
      } else if (detail.status === 'matched') { files.push(detail.file); details.push(detail); }
      else { details.push(detail); if (detail.status === 'missing') missing.push(detail.ref); else ambiguous.push(detail.ref); }
    }
    return { files: uniqueFiles(files), missing, ambiguous, details };
  }

  function actionableAttachmentRefs(refs) {
    const nonRequirements=/^(?:https?:\/\/|www\.|source|sources|reference|references|profile|homepage|website|link|url|来源|参考资料|导师主页|教授主页|学校主页|网页链接)$/iu;
    return (refs||[]).map(ref=>String(ref||'').trim()).filter(ref=>{
      if(!ref||nonRequirements.test(ref))return false;
      if(/^(?:https?:\/\/|www\.)/iu.test(ref)){
        const clean=ref.split(/[?#]/)[0];
        return /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)$/iu.test(clean);
      }
      return true;
    });
  }

  function emptyRosterState(overrides={}) {
    return {dataset:null,datasets:[],entries:[],manualEntries:[],routedEntries:[],audit:null,warnings:[],manualWarnings:[],routedWarnings:[],enabled:true,autoSchool:true,strict:false,sourceNames:[],manualSourceNames:[],routedSourceNames:[],...overrides};
  }

  function rosterState() {
    if (!batch.roster) batch.roster=emptyRosterState();
    const state=batch.roster;
    if(!Array.isArray(state.datasets))state.datasets=state.dataset?[state.dataset]:[];
    if(!Array.isArray(state.manualEntries))state.manualEntries=state.routedEntries?.length?[]:[...(state.entries||[])];
    if(!Array.isArray(state.routedEntries))state.routedEntries=[];
    if(!Array.isArray(state.manualSourceNames))state.manualSourceNames=state.routedSourceNames?.length?[]:[...(state.sourceNames||[])];
    if(!Array.isArray(state.routedSourceNames))state.routedSourceNames=[];
    if(!Array.isArray(state.manualWarnings))state.manualWarnings=state.routedWarnings?.length?[]:[...(state.warnings||[])];
    if(!Array.isArray(state.routedWarnings))state.routedWarnings=[];
    return state;
  }

  function mergeUniqueRosterEntries(entries){
    const out=[];
    const byEmail=new Map(),byNameSchool=new Map();
    const cleanText=value=>String(value||'').trim();
    const merge=(base,next)=>{
      const pick=(a,b)=>cleanText(a)||cleanText(b);
      const tags=[...new Set([...(base?.tags||[]),...(next?.tags||[])].map(cleanText).filter(Boolean))];
      const merged={...base,...next,
        email:pick(base?.email,next?.email).toLowerCase(),
        name:pick(base?.name,next?.name),school:pick(base?.school,next?.school),country:pick(base?.country,next?.country),
        batch:base?.batchExplicit===true?cleanText(base?.batch):(next?.batchExplicit===true?cleanText(next?.batch):''),
        batchRaw:base?.batchExplicit===true?pick(base?.batchRaw,base?.batch):(next?.batchExplicit===true?pick(next?.batchRaw,next?.batch):''),
        batchExplicit:base?.batchExplicit===true||next?.batchExplicit===true,
        batchSourceHeader:base?.batchExplicit===true?cleanText(base?.batchSourceHeader):cleanText(next?.batchSourceHeader),
        status:pick(base?.status,next?.status),priority:pick(base?.priority,next?.priority),
        scheduleRaw:base?.scheduleExplicit===true?cleanText(base?.scheduleRaw):(next?.scheduleExplicit===true?cleanText(next?.scheduleRaw):''),
        scheduleAt:base?.scheduleExplicit===true?cleanText(base?.scheduleAt):(next?.scheduleExplicit===true?cleanText(next?.scheduleAt):''),
        scheduleExplicit:base?.scheduleExplicit===true||next?.scheduleExplicit===true,
        notes:pick(base?.notes,next?.notes),tags,
        priorityOrder:base?.priorityOrder!=null?base.priorityOrder:next?.priorityOrder,
        source:[...new Set([...(String(base?.source||'').split(' · ')),...(String(next?.source||'').split(' · '))].map(cleanText).filter(Boolean))].join(' · '),
        sourceRow:base?.sourceRow||next?.sourceRow||0
      };
      merged.nameKey=Roster?.normalizeName?.(merged.name||'')||'';
      merged.nameKeys=Roster?.nameKeys?.(merged.name||'')||[];
      merged.schoolKey=Roster?.schoolKey?.(merged.school||'')||'';
      return merged;
    };
    for(const raw of entries||[]){
      if(!raw)continue;
      const entry={...raw};
      const email=cleanText(entry.email).toLowerCase();
      const nameKey=Roster?.normalizeName?.(entry.name||'')||'';
      const schoolKey=Roster?.schoolKey?.(entry.school||'')||'';
      const nameSchool=nameKey&&schoolKey?`${nameKey}|${schoolKey}`:'';
      let index=email&&byEmail.has(email)?byEmail.get(email):-1;
      if(index<0 && nameSchool && byNameSchool.has(nameSchool)){
        const candidateIndex=byNameSchool.get(nameSchool),candidate=out[candidateIndex];
        const candidateEmail=cleanText(candidate?.email).toLowerCase();
        // Name + institution may merge incomplete roster fragments, but never collapse
        // two explicitly different email identities into one person.
        if(!email||!candidateEmail||email===candidateEmail)index=candidateIndex;
      }
      if(index>=0){
        out[index]=merge(out[index],entry);
      }else{
        index=out.length;out.push(entry);
      }
      const current=out[index];
      const currentEmail=cleanText(current.email).toLowerCase();
      const currentName=Roster?.normalizeName?.(current.name||'')||'';
      const currentSchool=Roster?.schoolKey?.(current.school||'')||'';
      if(currentEmail)byEmail.set(currentEmail,index);
      if(currentName&&currentSchool)byNameSchool.set(`${currentName}|${currentSchool}`,index);
    }
    return out.map((entry,index)=>{
      const email=cleanText(entry.email).toLowerCase();
      const nameKey=Roster?.normalizeName?.(entry.name||'')||'';
      const schoolKey=Roster?.schoolKey?.(entry.school||'')||'';
      const identity=email||(nameKey||schoolKey?`${nameKey}|${schoolKey}`:`row-${index+1}`);
      return {...entry,key:`roster:${identity}`,email,nameKey,nameKeys:Roster?.nameKeys?.(entry.name||'')||[],schoolKey};
    });
  }

  function syncRosterParts(){
    const state=rosterState();
    state.entries=mergeUniqueRosterEntries([...(state.manualEntries||[]),...(state.routedEntries||[])]);
    state.sourceNames=[...new Set([...(state.manualSourceNames||[]),...(state.routedSourceNames||[])])];
    state.warnings=[...new Set([...(state.manualWarnings||[]),...(state.routedWarnings||[])])];
    state.audit=null;
    const status=$('nmda-roster-source-status');
    if(status)status.textContent=state.entries.length?`已添加 ${state.entries.length} 条参考名单${state.sourceNames.length?` · ${state.sourceNames.join('、')}`:''}`:'未添加总名单。';
    const remove=$('nmda-roster-remove');if(remove)remove.hidden=!state.entries.length;
  }

  function syncRoutedSources(){
    const sets=recordSets(),rosterSets=[],attachmentSources=new Set();
    for(let index=0;index<sets.length;index++){
      const collection=sets[index],config=ensureCollectionConfig(index);if(!collection||!config)continue;
      if(config.purpose==='roster')rosterSets.push(collection);
      if(config.purpose==='attachment')for(const source of (collection.meta?.sourceMembers?.length?collection.meta.sourceMembers:[collection.source]))attachmentSources.add(String(source||''));
    }
    const state=rosterState();
    if(Roster&&rosterSets.length){
      const parsed=Roster.parseDataset({recordSets:rosterSets,sheets:rosterSets});
      state.routedEntries=parsed.entries||[];state.routedWarnings=parsed.warnings||[];state.routedSourceNames=[...new Set(rosterSets.map(set=>String(set.source||set.name||'')).filter(Boolean))];
    }else{state.routedEntries=[];state.routedWarnings=[];state.routedSourceNames=[];}
    syncRosterParts();
    batch.routedAttachmentFiles=uniqueFiles((batch.dataset?.sourceFiles||[]).filter(file=>(attachmentSources.has(sourceFileName(file))||attachmentSources.has(String(file?.name||'')))&&!batch.ignoredAttachmentIdentities.has(Importer.fileIdentity(file))));
  }

  function taskNeedsDuplicateGate(task){
    return !!task && task.sourceKind !== 'mailbox-draft';
  }

  function mailboxDedupeSnapshotAvailable(){
    const sync=operationState.store?.mailboxSync||{};
    return !!(sync.lastDedupeAt||sync.lastFullAt);
  }

  function mailboxHistoryForTask(task){
    if(!Operations || !operationState.loaded || !taskNeedsDuplicateGate(task))return {sent:[],drafts:[],sentCount:0,draftCount:0,lastSentAt:'',lastDraftAt:'',lastSubject:'',lastDraftSubject:''};
    const raw=Operations.mailboxHistoryForRecipients(operationState.store,task?.recipients||'');
    const selfKey=String(task?.editKey||task?.id||'');
    const sent=(raw.sent||[]).filter(record=>String(record?.taskId||'')!==selfKey);
    const drafts=(raw.drafts||[]).filter(record=>String(record?.taskId||'')!==selfKey);
    return {
      sent,drafts,sentCount:sent.length,draftCount:drafts.length,
      lastSentAt:sent[0]?.sentAt||'',lastDraftAt:drafts[0]?.savedAt||'',
      lastSubject:sent[0]?.subject||'',lastDraftSubject:drafts[0]?.subject||''
    };
  }

  function draftHistoryHitKey(task,history){
    return [String(task?.recipients||'').trim().toLowerCase(),history?.draftCount||0,history?.lastDraftAt||'-',history?.lastDraftSubject||'-'].join('|');
  }

  function unresolvedDraftHistoryHits(tasks=batch.tasks||[]){
    if(!Operations || !operationState.loaded || !mailboxDedupeSnapshotAvailable())return [];
    const hits=[];
    for(const task of tasks||[]){
      if(!taskNeedsDuplicateGate(task) || task?.importExcluded)continue;
      const history=mailboxHistoryForTask(task);
      // Sent history is the stronger business fact. It stays in the explicit history gate;
      // Draft-only hits use the compact filtering gate below instead of version comparison.
      if(!history.draftCount || history.sentCount)continue;
      const key=draftHistoryHitKey(task,history);
      if(task.draftHistoryDecisionKey===key && ['keep','exclude'].includes(task.draftHistoryDecision))continue;
      hits.push({task,history,key});
    }
    return hits;
  }

  function mailboxHistoryDuplicateGroups(tasks){
    if(!Operations || !operationState.loaded)return [];
    const groups=[];
    for(const task of tasks||[]){
      if(!taskNeedsDuplicateGate(task) || task?.importExcluded)continue;
      const history=mailboxHistoryForTask(task);
      // Draft-only history is intentionally not a comparison group. It is handled by the
      // compact "已有草稿命中" filter so users do not compare two unrelated content versions.
      if(!history.sentCount)continue;
      const stamp=[history.sentCount,history.draftCount,history.lastSentAt||'-',history.lastDraftAt||'-'].join('|');
      const type=history.draftCount?'history-both':'history-sent';
      groups.push({
        id:`history:${task.editKey}:${stamp}`,scope:'mailbox-history',type,
        label:String(task.recipients||task.id||'当前邮件'),tasks:[task],task,
        sent:history.sent,drafts:history.drafts,sentCount:history.sentCount,draftCount:history.draftCount,
        lastSentAt:history.lastSentAt,lastDraftAt:history.lastDraftAt,lastSubject:history.lastSubject,lastDraftSubject:history.lastDraftSubject
      });
    }
    return groups;
  }

  function applyBatchDuplicateAudit(tasks){
    for(const task of tasks||[]){task.duplicateIssues=[];task.duplicateGroupIds=[];task.batchDuplicate=false;task.historyDuplicate=false;task.draftHistoryHit=false;task.duplicateBypass=task?.sourceKind==='mailbox-draft'?'mailbox-draft':'';}
    const checkable=(tasks||[]).filter(taskNeedsDuplicateGate);
    const batchAudit=Roster?.auditTaskDuplicates?.(checkable)||{groups:[],summary:{tasks:checkable.length,groups:0,exact:0,probable:0,affectedTasks:0}};
    const batchGroups=(batchAudit.groups||[]).map(group=>({...group,scope:'batch'}));
    const historyGroups=mailboxHistoryDuplicateGroups(checkable);
    const draftOnlyHits=checkable.filter(task=>{const history=mailboxHistoryForTask(task);return !!history.draftCount&&!history.sentCount;});
    for(const task of draftOnlyHits)task.draftHistoryHit=true;
    const groups=[...batchGroups,...historyGroups];
    for(const group of groups){
      const count=group.tasks?.length||0;
      let message='';
      if(group.scope==='mailbox-history'){
        const facts=[group.draftCount?`已有草稿 ${group.draftCount}`:'',group.sentCount?`已发送 ${group.sentCount}`:''].filter(Boolean).join(' · ');
        message=`邮箱历史冲突：${facts}，需明确是否仍创建新的初始邮件`;
      }else{
        message=group.type==='exact-email'
          ? `当前批次重复：${group.email||group.label||'同一收件人'} 有 ${count} 封邮件，需选择保留版本`
          : `当前批次疑似重复：${group.label||'同一联系人'} 有 ${count} 封邮件，需确认是否为同一联系人`;
      }
      for(const task of group.tasks||[]){
        if(!task)continue;
        if(group.scope==='mailbox-history')task.historyDuplicate=true;else task.batchDuplicate=true;
        if(!task.duplicateGroupIds.includes(group.id))task.duplicateGroupIds.push(group.id);
        if(!task.duplicateIssues.some(item=>item.id===group.id))task.duplicateIssues.push({id:group.id,message,type:group.type,scope:group.scope});
      }
    }
    const affected=new Set(groups.flatMap(group=>(group.tasks||[]).map(task=>task?.editKey).filter(Boolean)));
    batch.duplicateAudit={
      ...batchAudit,groups,
      summary:{...(batchAudit.summary||{}),tasks:checkable.length,groups:groups.length,batchGroups:batchGroups.length,historyGroups:historyGroups.length,affectedTasks:affected.size,
        historyDraftTasks:draftOnlyHits.length+historyGroups.filter(group=>group.draftCount).length,historySentTasks:historyGroups.filter(group=>group.sentCount).length,
        draftOnlyHits:draftOnlyHits.length,bypassedDraftImports:(tasks||[]).filter(task=>task?.sourceKind==='mailbox-draft').length}
    };
    return batch.duplicateAudit;
  }

  function applyRosterCrossCheck(tasks) {
    const state=rosterState();
    const allTasks=Array.isArray(tasks)?tasks:[];
    // Reference-roster reconciliation belongs only to locally imported Initial mail.
    // Mailbox drafts remain mailbox-history facts and never participate in roster mapping.
    const eligible=allTasks.filter(task=>task?.sourceKind==='import');
    for(const task of allTasks){
      task.rosterMatchStatus='';task.rosterMatchScore=0;task.rosterMatchBy='';task.rosterReference=null;
      task.rosterEmailCandidate='';task.rosterIssues=[];task.rosterDuplicate=false;task.rosterRecipientSupplemented=false;task.rosterSchoolSupplemented=false;
    }
    if(!Roster || !state.enabled || !state.entries.length || !eligible.length){state.audit=null;return null;}

    const audit=Roster.crossCheck(eligible,state.entries);
    const byKey=new Map(eligible.map(t=>[t.editKey,t]));
    let autoRecipientSupplements=0,schoolSupplements=0;
    const methodCounts={email:0,sourceFileName:0,nameSchool:0,nameDomain:0,uniqueName:0,surnameSalutation:0,emailName:0,other:0};

    for(const match of audit.matches){
      const task=match.task;if(!task)continue;
      const edit=batch.taskEdits.get(task.editKey)||{};
      task.rosterMatchStatus=match.status;
      task.rosterMatchScore=Number(match.score||0);
      task.rosterMatchBy=match.by||'';
      task.rosterReference=match.entry?{...match.entry}:null;
      task.rosterEmailCandidate=match.emailCandidate||'';
      task.rosterIssues=[];
      if(match.by==='email')methodCounts.email++;
      else if(match.by==='source-file-name')methodCounts.sourceFileName++;
      else if(match.by==='name+school')methodCounts.nameSchool++;
      else if(match.by==='name+domain')methodCounts.nameDomain++;
      else if(match.by==='unique-name')methodCounts.uniqueName++;
      else if(match.by==='unique-surname-salutation')methodCounts.surnameSalutation++;
      else if(match.by==='email-name')methodCounts.emailName++;
      else methodCounts.other++;

      // Silent recipient repair requires deterministic identity evidence. A source filename
      // that exactly identifies one roster contact (one-file-per-contact workflow) is as
      // strong as name+institution. Surname-only salutations remain review evidence only.
      const deterministicRecipientMethods=new Set(['name+school','source-file-name']);
      const canSupplementRecipient=match.status==='matched'
        && !recipientLooksValid(task.recipients||'')
        && !!match.entry?.email
        && deterministicRecipientMethods.has(match.by)
        && Number(match.score||0)>=(match.by==='source-file-name'?112:108);
      if(canSupplementRecipient){
        task.recipients=String(match.entry.email||'').trim();
        task.rosterEmailCandidate='';
        task.rosterRecipientSupplemented=true;
        task.rosterRecipientSource=match.by==='source-file-name'?'roster:source-file-name':'roster:name+school';
        autoRecipientSupplements++;
        refreshTaskCoreValidation(task);
        refreshTaskSearchStatic(task);
      }

      if(match.status==='conflict'&&match.entry?.school){
        task.scheduleGroupNotice=`院校信息不一致，排程已使用总名单中的“${match.entry.school}”`;
        if(state.autoSchool){task.school=match.entry.school;task.schoolSource='roster';refreshTaskSearchStatic(task);}
      }
      if(match.schoolSupplement && state.autoSchool && match.entry?.school && !task.school){
        task.school=match.entry.school;task.schoolSource='roster';task.rosterSchoolSupplemented=true;schoolSupplements++;refreshTaskSearchStatic(task);
      }
      if(!edit.rosterConfirmed){
        if(match.status==='ambiguous')task.rosterIssues.push('总名单中找到多条相似记录，请检查联系人');
        if(match.emailConflict)task.rosterIssues.push('导入邮件收件人邮箱与总名单记录不一致，请核对联系人');
        if(match.status==='off-roster' && state.strict)task.rosterIssues.push('当前导入邮件未在参考总名单中找到对应联系人');
      }
      if(match.entry){
        const plannerIntent=RosterPlanner?.intentForEntry?.(batch.rosterPlanner,match.entry)||null;
        const excelPriority=match.entry.priorityOrder!=null&&String(match.entry.priorityOrder).trim()!==''&&Number.isFinite(Number(match.entry.priorityOrder))?Number(match.entry.priorityOrder):null;
        const plannerPriority=plannerIntent?.priorityOrder!=null&&Number.isFinite(Number(plannerIntent.priorityOrder))?Number(plannerIntent.priorityOrder):null;
        const explicitExcelBatch=RosterPlanner?.explicitBatch?.(match.entry)||'';
        const effectiveExcelBatch=plannerIntent?.batchSuppressed?'':explicitExcelBatch;
        const excelRound=RosterPlanner?.parseRound?.(effectiveExcelBatch||'');
        const plannerRound=(plannerIntent?.priorityRoundIndex??plannerIntent?.roundIndex)!=null&&Number.isFinite(Number(plannerIntent?.priorityRoundIndex??plannerIntent?.roundIndex))?Number(plannerIntent?.priorityRoundIndex??plannerIntent?.roundIndex):null;
        const fixedAt=String(plannerIntent?.fixedAt||match.entry.scheduleAt||'').trim();
        const effectiveBatch=String(plannerIntent?.priorityRoundLabel||plannerIntent?.batch||effectiveExcelBatch||'').trim();
        const priorityRoundIndex=plannerRound!=null?plannerRound:(excelRound!=null?excelRound:null);
        task.rosterMeta={country:match.entry.country||'',
          priorityRoundLabel:effectiveBatch,priorityRoundIndex,priorityRoundRequired:false,
          // 3.8.x compatibility aliases; scheduler no longer treats these as calendar rounds.
          batch:effectiveBatch,batchRaw:match.entry.batch||'',plannerRound:priorityRoundIndex,batchRequired:false,
          status:match.entry.status||'',priority:plannerPriority!=null?String(plannerPriority):(match.entry.priority||''),priorityOrder:plannerPriority!=null?plannerPriority:excelPriority,fixedAt,fixedSource:plannerIntent?.fixedAt?'manual-selection':(match.entry.scheduleAt?'excel':''),label:plannerIntent?.label||'',tags:[...(match.entry.tags||[])],notes:match.entry.notes||''};
        if(fixedAt && !['manual','mailbox','imported'].includes(String(task.scheduleSource||''))){
          const parsedFixed=Importer?.parseDateValue?.(fixedAt);if(parsedFixed&&parsedFixed.getTime()>Date.now()+60*1000){task.scheduleAt=Importer.formatLocalDateTime(parsedFixed);task.scheduleSource='roster-fixed';task.scheduleReason=plannerIntent?.fixedAt?'名单规划 · 人工框选固定时间':'总名单 · Excel 固定时间';}
        }
      }
    }
    for(const dup of audit.duplicateMatches||[]){
      for(const m of dup.matches||[]){
        const task=byKey.get(m.task?.editKey);if(!task)continue;
        const edit=batch.taskEdits.get(task.editKey)||{};
        task.rosterDuplicate=true;
        if(taskNeedsDuplicateGate(task) && !task.batchDuplicate && !edit.rosterConfirmed && !task.rosterIssues.includes('总名单核验：同一联系人对应多封导入邮件'))task.rosterIssues.push('总名单核验：同一联系人对应多封导入邮件');
      }
    }
    for(const task of eligible){
      if(task.rosterMatchStatus==='off-roster' && !state.strict) task.warnings=[...new Set([...(task.warnings||[]),'总名单：当前导入邮件未匹配到参考名单（仅提示）'])];
      if((task.rosterIssues||[]).length){task.errors=[...new Set([...(task.errors||[]),...task.rosterIssues])];task.status='error';}
    }
    audit.summary={...(audit.summary||{}),tasks:eligible.length,autoRecipientSupplements,schoolSupplements,methodCounts};
    state.audit=audit;
    return audit;
  }

  function rosterEntryLabel(entry){
    if(!entry)return '未知记录';
    return [entry.name,entry.school,entry.email].filter(Boolean).join(' · ')||`第 ${entry.sourceRow||'?'} 行`;
  }

  function operationHistoryAudit(tasks){
    if(!Operations||!operationState.loaded)return {loaded:false,rows:[],affectedTasks:0,sentTasks:0,draftTasks:0,bypassed:0};
    const rows=[];const affected=new Set(),sentTasks=new Set(),draftTasks=new Set();let bypassed=0;
    for(const task of tasks||[]){
      if(!taskNeedsDuplicateGate(task)){bypassed++;continue;}
      const taskKey=String(task?.editKey||task?.id||'');
      const history=mailboxHistoryForTask(task);
      if(!history.sentCount&&!history.draftCount)continue;
      affected.add(taskKey);if(history.sentCount)sentTasks.add(taskKey);if(history.draftCount)draftTasks.add(taskKey);
      rows.push({task,email:String(task?.recipients||''),sentCount:history.sentCount,draftCount:history.draftCount,lastSentAt:history.lastSentAt,lastDraftAt:history.lastDraftAt,lastSubject:history.lastSubject,lastDraftSubject:history.lastDraftSubject});
    }
    return {loaded:true,rows,affectedTasks:affected.size,sentTasks:sentTasks.size,draftTasks:draftTasks.size,bypassed};
  }

  function renderRosterAudit(){
    const state=rosterState(),card=$('nmda-roster-audit-card'),summary=$('nmda-roster-audit-summary'),note=$('nmda-roster-audit-note'),details=$('nmda-roster-audit-details');
    const enabledEl=$('nmda-roster-enabled'),schoolEl=$('nmda-roster-auto-school'),strictEl=$('nmda-roster-strict');
    if(enabledEl)enabledEl.checked=state.enabled!==false;if(schoolEl)schoolEl.checked=state.autoSchool!==false;if(strictEl)strictEl.checked=!!state.strict;
    if(!card)return;
    const tasks=batch.tasks||[];
    const dedupeTasks=tasks.filter(taskNeedsDuplicateGate);
    card.hidden=!dedupeTasks.length&&!state.entries.length;
    if(card.hidden)return;

    const duplicateAudit=batch.duplicateAudit || Roster?.auditTaskDuplicates?.(tasks) || {groups:[],summary:{tasks:tasks.length,groups:0,exact:0,probable:0,affectedTasks:0}};
    const history=operationHistoryAudit(tasks);
    const rosterEligible=tasks.filter(task=>task?.sourceKind==='import');
    const rosterAudit=state.entries.length ? (state.audit || (Roster&&rosterEligible.length?Roster.crossCheck(rosterEligible,state.entries):null)) : null;
    const dx=duplicateAudit.summary||{},pendingDuplicates=unresolvedDuplicateGroupCount();
    const metrics=[];
    if(tasks.length)metrics.push(`<div class="nmda-import-metric"><strong>${tasks.length}</strong><span>当前邮件</span></div>`);
    if(dx.bypassedDraftImports)metrics.push(`<div class="nmda-import-metric"><strong>${dx.bypassedDraftImports}</strong><span>草稿接管 · 跳过查重</span></div>`);
    metrics.push(`<div class="nmda-import-metric ${pendingDuplicates?'is-warn':''}"><strong>${pendingDuplicates}</strong><span>待处理重复</span></div>`);
    if(history.loaded&&history.affectedTasks)metrics.push(`<div class="nmda-import-metric"><strong>${history.affectedTasks}</strong><span>已有记录</span></div>`);
    if(state.entries.length)metrics.push(`<div class="nmda-import-metric"><strong>${state.entries.length}</strong><span>参考名单</span></div>`);
    if(rosterAudit){
      const x=rosterAudit.summary||{};
      metrics.push(`<div class="nmda-import-metric"><strong>${x.matched||0}</strong><span>邮件↔名单</span></div>`);
      if(x.autoRecipientSupplements)metrics.push(`<div class="nmda-import-metric"><strong>${x.autoRecipientSupplements}</strong><span>名单补全邮箱</span></div>`);
      if(x.methodCounts?.sourceFileName)metrics.push(`<div class="nmda-import-metric"><strong>${x.methodCounts.sourceFileName}</strong><span>文件名识别</span></div>`);
      if(x.unwritten)metrics.push(`<div class="nmda-import-metric"><strong>${x.unwritten}</strong><span>尚未加入</span></div>`);
      if(x.emailConflicts)metrics.push(`<div class="nmda-import-metric is-warn"><strong>${x.emailConflicts}</strong><span>邮箱不一致</span></div>`);
      if(x.ambiguous||x.duplicates)metrics.push(`<div class="nmda-import-metric is-warn"><strong>${(x.ambiguous||0)+(x.duplicates||0)}</strong><span>名单待核对</span></div>`);
    }
    if(summary)summary.innerHTML=metrics.join('');

    if(note){
      const parts=[];
      const mailboxUnread=dedupeTasks.length>0&&!mailboxDedupeSnapshotAvailable();
      const decisionGroups=Math.max(0,pendingDuplicates-(mailboxUnread?1:0));
      if(mailboxUnread)parts.push('正在自动读取邮箱历史；新的 Initial Task 会先核对已有草稿和已发送记录');
      if(decisionGroups)parts.push(`发现 <strong>${decisionGroups}</strong> 项查重待处理，请先完成批次版本取舍、草稿筛选或发送历史决策`);
      else if(dx.groups&&!mailboxUnread)parts.push(`本次发现过 <strong>${dx.groups}</strong> 组查重冲突，当前已全部处理`);
      else if(tasks.length&&!mailboxUnread)parts.push('当前批次未发现重复任务');
      if(history.loaded&&history.affectedTasks)parts.push(`<strong>${history.affectedTasks}</strong> 封新邮件命中邮箱历史；已有草稿直接筛选，已发送记录单独确认`);
      if(dx.bypassedDraftImports)parts.push(`从网易草稿箱识别的 <strong>${dx.bypassedDraftImports}</strong> 封属于“接管现有草稿”，不参与新邮件查重`);
      if(rosterAudit){
        const x=rosterAudit.summary||{};
        const rosterParts=[];
        if(x.schoolSupplements)rosterParts.push(`补充 ${x.schoolSupplements} 条院校信息`);
        if(x.autoRecipientSupplements)rosterParts.push(`自动补全 ${x.autoRecipientSupplements} 个高置信邮箱`);
        if(x.methodCounts?.sourceFileName)rosterParts.push(`按源文件名识别 ${x.methodCounts.sourceFileName} 封`);
        const reviewEmailCandidates=Math.max(0,Number(x.emailCandidates||0)-Number(x.autoRecipientSupplements||0));
        if(reviewEmailCandidates)rosterParts.push(`找到 ${reviewEmailCandidates} 个邮箱候选待核对`);
        if(x.emailConflicts)rosterParts.push(`${x.emailConflicts} 封邮件邮箱与名单不一致`);
        if(x.unwritten)rosterParts.push(`${x.unwritten} 位名单联系人尚未加入本批次`);
        parts.push(`参考总名单已与导入邮件交叉匹配${rosterParts.length?`，并${rosterParts.join('、')}`:''}`);
      }else if(state.entries.length&&!tasks.length)parts.push('参考总名单已就绪；后续导入邮件会自动匹配，无需重新上传名单');
      note.innerHTML=parts.length?`${parts.join('；')}。`:'核验将在加入邮件后自动开始。';
    }

    if(details){
      const section=(title,items,render,more=0)=>`<div class="nmda-roster-diff-section"><strong>${escapeHtml(title)}</strong>${items.length?`<div>${items.map(render).join('')}</div>`:'<small>无</small>'}${more>items.length?`<small>另有 ${more-items.length} 条未展开</small>`:''}</div>`;
      let html='';
      const duplicateGroups=(duplicateAudit.groups||[]).filter(group=>group.scope!=='mailbox-history').slice(0,12);
      html+=section('当前批次查重',duplicateGroups,g=>{
        const ids=(g.tasks||[]).map(task=>task.id||task.recipients||'邮件').slice(0,4).join('、');
        const kind=g.type==='exact-email'?'同一邮箱':'同名同院校';
        return `<span>${escapeHtml(g.label||g.email||'联系人')} · ${escapeHtml(kind)} · ${g.tasks?.length||0} 封${ids?` · ${escapeHtml(ids)}`:''}</span>`;
      },(duplicateAudit.groups||[]).filter(group=>group.scope!=='mailbox-history').length);
      if(history.loaded){
        const historyRows=history.rows.slice(0,12);
        html+=section('邮箱历史查重',historyRows,row=>{
          const fact=[row.sentCount?`已发送 ${row.sentCount}`:'',row.draftCount?`已有草稿 ${row.draftCount}`:''].filter(Boolean).join(' · ');
          const subject=row.lastDraftSubject||row.lastSubject||'';
          return `<span>${escapeHtml(row.email)} · ${escapeHtml(fact)}${subject?` · ${escapeHtml(subject)}`:''}</span>`;
        },history.rows.length);
      }
      if(rosterAudit){
        const off=(rosterAudit.matches||[]).filter(m=>m.status==='off-roster').slice(0,12);
        const ambiguities=(rosterAudit.matches||[]).filter(m=>m.status==='ambiguous').slice(0,12);
        const scheduleDiffs=(rosterAudit.matches||[]).filter(m=>m.status==='conflict').slice(0,12);
        const emailDiffs=(rosterAudit.matches||[]).filter(m=>m.emailConflict).slice(0,12);
        const unwritten=(rosterAudit.unwritten||[]).slice(0,12);
        const rosterDups=(rosterAudit.duplicateMatches||[]).slice(0,8);
        html+=section('尚未加入本批次',unwritten,e=>`<span>${escapeHtml(rosterEntryLabel(e))}${e.batch?` · ${escapeHtml(e.batch)}`:''}</span>`,rosterAudit.unwritten?.length||0);
        html+=section('不在参考名单',off,m=>`<span>${escapeHtml(m.task?.id||m.task?.recipients||'邮件')} · ${escapeHtml(m.task?.recipients||'')}</span>`,(rosterAudit.matches||[]).filter(m=>m.status==='off-roster').length);
        html+=section('邮件 ↔ 名单待核对',ambiguities,m=>`<span>${escapeHtml(m.task?.id||'邮件')} → 多个参考名单候选</span>`,(rosterAudit.matches||[]).filter(m=>m.status==='ambiguous').length);
        html+=section('收件人邮箱不一致',emailDiffs,m=>`<span>${escapeHtml(m.task?.recipients||m.task?.id||'邮件')} → 名单：${escapeHtml(m.entry?.email||'')}</span>`,(rosterAudit.matches||[]).filter(m=>m.emailConflict).length);
        html+=section('排程参考（不影响邮件）',scheduleDiffs,m=>`<span>${escapeHtml(m.task?.id||'邮件')} → ${escapeHtml(rosterEntryLabel(m.entry))}</span>`,(rosterAudit.matches||[]).filter(m=>m.status==='conflict').length);
        html+=section('同一名单联系人对应多封导入邮件',rosterDups,d=>`<span>${escapeHtml(rosterEntryLabel(d.entry))} · ${d.matches?.length||0} 封邮件</span>`,rosterAudit.duplicateMatches?.length||0);
      }
      details.innerHTML=html;
    }
    renderDraftHistoryFilter();
    renderDuplicateDecision();
  }

  async function loadRosterFiles(files){
    const list=[...(files||[])].filter(Boolean);if(!list.length||!Importer||!Roster)return;
    const token=batch.sessionId;const status=$('nmda-roster-source-status');
    if(status)status.textContent=`正在读取总套磁名单（${list.length} 个文件）…`;
    try{
      const dataset=list.length===1?await Importer.parseFile(list[0]):await Importer.parseFiles(list,{ignoreUnsupported:true});
      if(!isCurrentBatchSession(token))return;
      const parsed=Roster.parseDataset(dataset);
      if(!parsed.entries.length)throw new Error('总名单中没有找到可用导师信息。请至少提供姓名、邮箱或学校中的一项。');
      for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
      batch.handoffComplete=false;
      const state=rosterState();
      state.dataset=dataset;
      state.datasets=[...(state.datasets||[]),dataset].slice(-8);
      state.manualEntries=mergeUniqueRosterEntries([...(state.manualEntries||[]),...(parsed.entries||[])]);
      state.manualWarnings=[...new Set([...(state.manualWarnings||[]),...(parsed.warnings||[])])];
      state.manualSourceNames=[...new Set([...(state.manualSourceNames||[]),...list.map(f=>f.name)])];
      syncRosterParts();
      batch.rosterPromptChoice='added';
      if(status)status.textContent=`已添加 ${state.entries.length} 条参考名单${parsed.stats.invalidEmails?` · ${parsed.stats.invalidEmails} 条邮箱待检查`:''}${parsed.stats.duplicates?` · ${parsed.stats.duplicates} 条重复`:''}`;
      if(batch.dataset){
        rebuildTasks();
        const x=state.audit?.summary||{};
        if(status)status.textContent=`参考名单 ${state.entries.length} 条 · 已匹配导入邮件 ${x.matched||0} 封${x.autoRecipientSupplements?` · 补全邮箱 ${x.autoRecipientSupplements}`:''}${x.ambiguous?` · 待核对 ${x.ambiguous}`:''}`;
      }else renderRosterAudit();
      renderImportLifecycleState();
      renderSupplementPreflight();
      if(batch.dataset&&batch.supplementPreflightDone)renderImportHandoff();
    }catch(error){console.error(`[${APP}] roster`,error);if(status)status.textContent=`总名单读取失败：${error.message}`;}
    finally{if(rosterFileEl)rosterFileEl.value='';}
  }

  function removeRoster(){
    batch.handoffComplete=false;
    for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
    for(const config of batch.collectionConfigs.values())if(config.purpose==='roster'){config.purpose='ignored';config.enabled=false;}
    batch.roster=emptyRosterState();
    batch.rosterPlanner=RosterPlanner?.createState?.()||{version:1,sourceKey:'',intents:{}};
    batch.rosterPromptChoice=batch.dataset&&batch.tasks?.length?'pending':'idle';
    const status=$('nmda-roster-source-status');if(status)status.textContent='未添加参考总名单。';
    const remove=$('nmda-roster-remove');if(remove)remove.hidden=true;
    if(batch.dataset){rebuildTasks();renderSourceInventory();}else renderRosterAudit();
    renderImportLifecycleState();
  }

  function mergedRowSourcePurpose(sourceFile) {
    const source=sourceIdentityKey(sourceFile),leaf=String(source).split('/').pop();
    const candidates=recordSets().map((collection,index)=>({collection,index})).filter(({collection})=>collection.meta?.taskShadow&&collectionDirectMatchesSource(collection,source,leaf));
    if(!candidates.length)return'mail';
    const config=ensureCollectionConfig(candidates[0].index);
    return config?.enabled===false?'ignored':String(config?.purpose||'ignored');
  }

  function importedScheduleEvidence(collection, detection, row, getValue) {
    const core=globalThis.NMDAImportCore;
    const headers=collection?.rows?.[detection?.index] || [];
    const normalize=value=>core?.normalizeHeader ? core.normalizeHeader(value) : String(value??'').trim().toLowerCase().replace(/\s+/g,'');
    const values=(row||[]).map(value=>String(value??'').trim());
    const mapped=String(getValue(row,'scheduleAt') ?? '').trim();
    let datePart='',timePart='',dateHeader='',timeHeader='';
    const dateRe=/^(?:发送|定时(?:发送)?|计划发送|预约发送|预定发送|排期|投递)?日期$|^(?:send|scheduled|schedule|delivery|planned(?:send|delivery)?)date$/i;
    const timeRe=/^(?:发送|定时(?:发送)?|计划发送|预约发送|预定发送|排期|投递)?(?:时刻|时间)$|^(?:send|scheduled|schedule|delivery|planned(?:send|delivery)?)(?:time|clock)$/i;
    const genericDateRe=/^日期$|^date$/i, genericTimeRe=/^(?:时间|时刻)$|^time$/i;
    for(let i=0;i<headers.length;i++){
      const h=normalize(headers[i]); if(!h)continue;
      const value=values[i]||''; if(!value)continue;
      if(!datePart && dateRe.test(h)){datePart=value;dateHeader=String(headers[i]||'');continue;}
      if(!timePart && timeRe.test(h)){timePart=value;timeHeader=String(headers[i]||'');continue;}
    }
    if(!datePart || !timePart){
      let genericDate='',genericTime='',genericDateHeader='',genericTimeHeader='';
      for(let i=0;i<headers.length;i++){
        const h=normalize(headers[i]),value=values[i]||'';if(!value)continue;
        if(!genericDate&&genericDateRe.test(h)){genericDate=value;genericDateHeader=String(headers[i]||'');}
        if(!genericTime&&genericTimeRe.test(h)){genericTime=value;genericTimeHeader=String(headers[i]||'');}
      }
      // Plain “日期 + 时间” is accepted only as a pair so an unrelated single
      // date column is never silently treated as a mail schedule.
      if(genericDate&&genericTime){
        if(!datePart){datePart=genericDate;dateHeader=genericDateHeader;}
        if(!timePart){timePart=genericTime;timeHeader=genericTimeHeader;}
      }
    }
    let raw=mapped;
    const dateOnly=value=>/^\s*\d{4}[年\/.\-]\d{1,2}(?:月|[\/.\-])\d{1,2}日?\s*$/.test(String(value||''));
    const timeOnly=value=>/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/.test(String(value||''));
    if(raw && dateOnly(raw) && timePart) raw=`${raw} ${timePart}`;
    else if(raw && timeOnly(raw) && datePart) raw=`${datePart} ${raw}`;
    else if(!raw && datePart) raw=timePart?`${datePart} ${timePart}`:datePart;
    return {raw, mapped, datePart, timePart, headers:[dateHeader,timeHeader].filter(Boolean)};
  }

  function rebuildTasks() {
    if (!batch.dataset) { batch.tasks = []; scheduleBatchRender({aux:true}); return; }
    const tasks = [];
    const sets = recordSets();
    for (let collectionIndex = 0; collectionIndex < sets.length; collectionIndex++) {
      const collection = sets[collectionIndex];
      const config = ensureCollectionConfig(collectionIndex);
      if (!collection || !config || config.purpose !== 'mail' || config.enabled === false || collection.meta?.taskShadow) continue;
      const detection = config.detection;
      const mapping = config.mapping || {};
      const start = detection.index + 1;
      const getValue = (row, field) => { const col = mapping[field]; return col == null ? '' : (row?.[col] ?? ''); };
      for (let rowIndex = start; rowIndex < collection.rows.length; rowIndex++) {
        const row = collection.rows[rowIndex] || [];
        const editKey = taskEditKey(collectionIndex, rowIndex);
        const edit = batch.taskEdits.get(editKey) || {};
        if (edit.importExcluded === true) continue;
        const rowMeta = collection.meta?.rowMeta?.[rowIndex] || null;
        const mailboxDraft = rowMeta?.mailboxDraft || null;
        const mailboxCc = String(mailboxDraft?.cc || '').trim();
        const mailboxBcc = String(mailboxDraft?.bcc || '').trim();
        const mailboxBodyHtml = String(mailboxDraft?.bodyHtml || '');
        const mailboxBodyIsHtml = mailboxDraft?.isHtml !== false && !!mailboxBodyHtml;
        const recognizedBodyHtml = String(rowMeta?.bodyHtml || '');
        const recognizedBodyIsHtml = rowMeta?.bodyIsHtml !== false && !!recognizedBodyHtml;
        const mailboxPriority = Number(mailboxDraft?.priority || 0) || 0;
        const mailboxReadReceipt = !!mailboxDraft?.requestReadReceipt;
        const rowSourceFile=String(rowMeta?.sourceFile||(collection.meta?.wordTaskRows?row?.[8]:'')||collection.source||'').trim();
        if(collection.meta?.merged&&rowSourceFile&&mergedRowSourcePurpose(rowSourceFile)!=='mail')continue;
        const sourceRecipients = String(getValue(row, 'recipients') ?? '').trim();
        const sourceSchoolRaw = String(getValue(row, 'school') ?? rowMeta?.school ?? '').trim();
        const sourceSubject = String(getValue(row, 'subject') ?? '').trim();
        const sourceBodyRaw = String(getValue(row, 'body') ?? '');
        const sourceBody = collection.meta?.mailFrames&&MailRecognizer?.sanitizeRecognizedBody
          ? MailRecognizer.sanitizeRecognizedBody(sourceBodyRaw).text
          : sourceBodyRaw;
        const sourceAttachmentRaw = getValue(row, 'attachments');
        const scheduleEvidence = importedScheduleEvidence(collection,detection,row,getValue);
        // Mailbox metadata is authoritative even if a future import-mapping change
        // fails to map the synthetic “定时时间” column.
        const sourceScheduleRaw = String(mailboxDraft?.scheduleAt || scheduleEvidence.raw || '').trim();
        const sourceTags = getValue(row, 'tags');
        const recipients = String(edit.recipients != null ? edit.recipients : sourceRecipients).trim();
        const schoolSource=edit.school!=null?'manual':(sourceSchoolRaw?(collection.meta?.mailFrames?'recognized':'imported'):'');
        const schoolRaw=String(edit.school != null ? edit.school : sourceSchoolRaw).trim();
        const schoolEvidence=Scheduler?.institutionEvidence?.(schoolRaw,recipients,schoolSource)||{valid:!!schoolRaw&&!/^[A-Z0-9]$/i.test(schoolRaw),value:schoolRaw};
        const school=schoolEvidence.valid?String(schoolEvidence.value||schoolRaw).trim():'';
        const subject = String(edit.subject != null ? edit.subject : sourceSubject).trim();
        const body = String(edit.body != null ? edit.body : sourceBody);
        const inheritedBodyHtml = mailboxDraft ? mailboxBodyHtml : recognizedBodyHtml;
        const inheritedBodyIsHtml = mailboxDraft ? mailboxBodyIsHtml : recognizedBodyIsHtml;
        const bodyHtml = edit.bodyHtml != null
          ? sanitizeEmailRichHtml(edit.bodyHtml || '')
          : (edit.body == null && inheritedBodyIsHtml ? sanitizeEmailRichHtml(inheritedBodyHtml) : '');
        const bodyIsHtml = edit.bodyIsHtml != null
          ? !!edit.bodyIsHtml && !!bodyHtml
          : !!bodyHtml;
        const attachmentRaw = edit.attachments != null ? edit.attachments : sourceAttachmentRaw;
        const rawAttachmentRefs = Importer.splitAttachments(attachmentRaw);
        const attachmentRefs = actionableAttachmentRefs(rawAttachmentRefs);
        const scheduleRaw = edit.scheduleAt != null ? edit.scheduleAt : sourceScheduleRaw;
        const originalScheduleSource = mailboxDraft && String(sourceScheduleRaw ?? '').trim() ? 'mailbox' : (String(sourceScheduleRaw ?? '').trim() ? 'imported' : '');
        const scheduleSource = String(edit.scheduleSource || originalScheduleSource).trim();
        const importedTags = parseTaskClassifications(edit.tags != null ? edit.tags : sourceTags);
        const id = String(edit.id != null ? edit.id : getValue(row, 'id') ?? '').trim() || `${collectionIndex + 1}-${rowIndex + 1}`;
        const meaningful = [recipients, subject, body, ...attachmentRefs, String(scheduleRaw ?? ''), ...importedTags].some(v => String(v).trim());
        if (!meaningful) continue;

        const errors = [], warnings = [];
        const importIssues = [...new Set(rowMeta?.issues || [])];
        const importConfidence = Number(rowMeta?.confidence || 0);
        if (!recipients) errors.push('缺少收件人');
        else if (!recipientLooksValid(recipients)) errors.push('收件人邮箱格式无效');
        if (!subject) errors.push('缺少主题');
        if (!String(body||'').trim()) errors.push('缺少正文');
        if (collection.meta?.mailFrames && importConfidence && importConfidence < 70) warnings.push('请检查邮件内容');
        for (const issue of importIssues) {
          if (/未定位收件人/.test(issue) && recipients) continue;
          if (/主题为空/.test(issue) && subject) continue;
          if (/正文过短/.test(issue) && body.length >= 40) continue;
          if (!errors.includes(issue) && !warnings.includes(issue)) warnings.push(issue);
        }
        let scheduleAt = '';
        if (String(scheduleRaw ?? '').trim()) {
          const parsed = Importer.parseDateValue(scheduleRaw);
          if (!parsed) warnings.push(`原定时时间无法识别：${scheduleRaw}；请在自动安排时间中重新选择`);
          else {
            scheduleAt = Importer.formatLocalDateTime(parsed);
            if (parsed.getTime() <= Date.now() + 60 * 1000) warnings.push('定时时间已过，建议手工修改或使用智能排程覆盖');
          }
        }

        const resolved = resolveAttachmentRefs(attachmentRefs, editKey);
        if (resolved.missing.length) errors.push(`缺少附件：${resolved.missing.join('、')}`);
        if (resolved.ambiguous.length) errors.push(`附件同名冲突：${resolved.ambiguous.join('、')}`);
        for (const detail of resolved.details) {
          if (detail.status === 'matched' && detail.method === 'relaxed-copy-suffix') warnings.push(`附件按下载副本名匹配：${detail.ref} → ${detail.file.name}`);
        }

        const gate = outreachPolicyGateForRecipients(recipients);
        if (gate.modes.includes('do-not-contact')) errors.push(`联系策略：不再联系（${gate.reasons.join('、')}）`);
        else if (gate.modes.includes('paused')) warnings.push(`联系策略：暂停（${gate.reasons.join('、')}）`);

        const policyBlocked = gate.blocked;
        const mergedFiles = mergeTaskFiles(resolved.files, editKey);
        const staticSearch = normalizedSearchText([
          id, rowIndex + 1, recipients, school, subject, body,
          mergedFiles.map(file => file.name).join(' '),
          scheduleAt ? scheduleAt.replace('T', ' ') : '',
          importedTags.join(' ')
        ].join(' '));
        tasks.push({
          id, rowIndex, collectionIndex, collectionName: collection.name || `内容 ${collectionIndex + 1}`, sourceFile: rowSourceFile,
          editKey, sourceRow: rowIndex + 1, recipients, cc:mailboxCc, bcc:mailboxBcc, school, schoolSource:school?schoolSource:'', ignoredSchool:schoolRaw&&!school?schoolRaw:'', subject, body,
          bodyHtml, bodyIsHtml, formatFeatures:mailRichFormatFeatures(bodyHtml),
          priority: mailboxPriority, requestReadReceipt: mailboxReadReceipt,
          attachmentRefs, ignoredAttachmentRefs:rawAttachmentRefs.filter(ref=>!attachmentRefs.includes(ref)),
          sourceKind:mailboxDraft?'mailbox-draft':'import', mailboxDraftId:String(mailboxDraft?.id||''), mailboxDraftSavedAt:String(mailboxDraft?.savedAt||''), remoteAttachments:[...(mailboxDraft?.attachments||[])],
          tags: importedTags,
          enabled: policyBlocked ? false : edit.enabled !== false,
          policyBlocked, policyReasons: gate.reasons,
          files: mergedFiles, tableFiles: resolved.files, attachmentDetails: resolved.details,
          scheduleAt, scheduleSource, scheduleReason:String(edit.scheduleReason||(scheduleSource==='mailbox'?'草稿箱原排期':scheduleSource==='imported'?'导入自带排期':'')), scheduleEvidenceHeaders:[...(scheduleEvidence.headers||[])], errors:[...new Set(errors)], warnings:[...new Set(warnings)], status: errors.length ? 'error' : 'ready', runtimeError: '', note: '',
          importConfidence, importEvidence:[...(rowMeta?.evidence || [])], importIssues, importHeading:rowMeta?.heading || '', importSalutation:rowMeta?.salutation || '', importRecipientEvidence:rowMeta?.recipientEvidence || null,
          reviewConfirmed: !!edit.reviewConfirmed, reviewDraftPending: !!edit.reviewDraftPending, rosterConfirmed: !!edit.rosterConfirmed,
          duplicateConfirmedGroups:Array.isArray(edit.duplicateConfirmedGroups)?[...edit.duplicateConfirmedGroups]:[], duplicateIssues:[], duplicateGroupIds:[], importExcluded:false,
          draftHistoryDecision:String(edit.draftHistoryDecision||''), draftHistoryDecisionKey:String(edit.draftHistoryDecisionKey||''),
          manuallyEdited: ['recipients','school','subject','body','bodyHtml','attachments','scheduleAt','tags'].some(key=>edit[key]!=null), _searchStatic: staticSearch
        });
      }
    }
    // Roster enrichment runs first so deterministic recipient/institution supplements
    // participate in duplicate detection and mailbox-history checks.
    applyRosterCrossCheck(tasks);
    applyBatchDuplicateAudit(tasks);
    batch.tasks = tasks;
    scheduleBatchRender({aux:true});
    scheduleReadyBatchAutoHandoff('邮件已准备好');
  }

  function statusLabel(task) {
    if (task.policyBlocked && task.status !== 'running' && task.status !== 'done') { const policies=task.policyReasons||[]; const label=(task.policyReasons||[]).some(x=>String(x).includes('不再联系'))?'已停止联系':'已暂停联系'; return `${label}：${policies.join('、')}`; }
    if (!task.enabled && task.status !== 'running' && task.status !== 'done') return '未选择';
    if (task.status === 'done') return '已完成';
    if (task.status === 'running') return '处理中';
    if(task.runtimeError)return `失败：${task.runtimeError}`;
    const state=taskIssueState(task);
    if(state.content.length){
      const labels=[];
      if(state.content.some(x=>/收件人|邮箱/.test(x)))labels.push('收件人');
      if(state.content.some(x=>/主题/.test(x)))labels.push('主题');
      if(state.content.some(x=>/正文/.test(x)))labels.push('正文');
      return `待补内容：${[...new Set(labels)].join('、')}`;
    }
    if(state.review.length)return `需要核对：${state.review[0].replace('修改待确认','修改内容')}`;
    if(state.attachment.length)return `待添加附件：${state.attachment[0].replace(/^缺少附件：|^附件同名冲突：/,'')}`;
    if(state.schedule.length)return '待调整时间';
    if(state.other.length)return `暂不可创建：${state.other[0]}`;
    if (task.status === 'error') return '暂不可创建';
    if (task.warnings.length) return `可创建（${task.warnings.join('；')}）`;
    return '可创建';
  }


  function renderTagChips() {
    const box = $('nmda-batch-tag-chips');
    if (!box || !Operations) return;
    const counts = new Map();
    for (const task of batch.tasks || []) {
      for (const tag of taskBusinessTags(task)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
    box.innerHTML = tags.length ? tags.slice(0, 50).map(([tag, count]) => `<button type="button" class="nmda-tag-chip" data-tag-chip="${escapeHtml(tag)}">${escapeHtml(tag)} <small>${count}</small></button>`).join('') : '<span class="nmda-hint">当前任务没有业务标记。运行状态和 Follow-up 状态不会混入标记。</span>';
    box.querySelectorAll('[data-tag-chip]').forEach(button => button.addEventListener('click', () => {
      const tagsNow = Operations.parseTags(batchTagIncludeEl.value);
      const clicked = button.dataset.tagChip;
      const key = clicked.toLocaleLowerCase('zh-CN');
      const exists = tagsNow.some(tag => tag.toLocaleLowerCase('zh-CN') === key);
      batchTagIncludeEl.value = exists ? tagsNow.filter(tag => tag.toLocaleLowerCase('zh-CN') !== key).join(';') : Operations.mergeTags(tagsNow, [clicked]).join(';');
      scheduleBatchRender({aux:false});
    }));
  }

  function importAttachmentStats() {
    const items=attachmentRequirementOverview();
    const matched=items.filter(item=>item.total>0&&item.matched>=item.total).length;
    return {total:items.length,matched,issues:Math.max(0,items.length-matched),files:attachmentPreparedFileCount()};
  }

  function renderImportHandoff() {
    const card=$('nmda-import-handoff-card');
    const summary=$('nmda-import-ready-summary');
    const button=$('nmda-go-batch');
    const hint=$('nmda-handoff-hint');
    if(!card||!summary||!button)return;
    const hasDataset=!!batch.dataset;
    const tasks=(batch.tasks||[]).filter(task=>!task?.importExcluded);
    if(!hasDataset||!tasks.length){card.hidden=true;return;}
    const contextPending=supplementPreflightNeedsDecision();
    const attachmentIssues=Number(importAttachmentStats().issues||0);
    const duplicatePending=Number(unresolvedDuplicateGroupCount()||0);
    const ready=!contextPending&&!attachmentIssues&&!duplicatePending;
    card.hidden=!ready;
    if(!ready)return;
    const pending=reviewTasks().length;
    const autoPassed=Math.max(0,tasks.length-pending);
    summary.innerHTML=`<div class="nmda-import-metric"><strong>${tasks.length}</strong><span>进入审阅</span></div><div class="nmda-import-metric"><strong>${pending}</strong><span>需处理</span></div><div class="nmda-import-metric"><strong>${autoPassed}</strong><span>当前通过</span></div>`;
    button.textContent='进入邮件审阅 →';
    button.disabled=false;
    if(hint)hint.textContent=pending?`导入事项已全部完成；还有 ${pending} 封邮件需要人工审阅。`:'导入事项已全部完成；邮件当前均自动通过，仍可进入审阅抽查。';
  }


  function scheduleSourceLabel(task) {
    const source=String(task?.scheduleSource||'');
    if(source==='auto')return '自动安排';
    if(source==='manual'||source==='manual-clear')return '手工调整';
    if(source==='mailbox')return '草稿原排期';
    if(source==='imported')return '导入排期';
    if(source==='roster-fixed')return '名单固定';
    return task?.scheduleAt?'已有排期':'未定时';
  }

  function scheduleValueForDisplay(value, rules=batch.scheduleRules||freshScheduleRules()) {
    if(!value)return'';const date=Scheduler?.parseLocalDateTime?.(value)||new Date(value);if(!date||Number.isNaN(date.getTime()))return String(value||'');
    return Scheduler?.formatInTimeZone?.(date,rules?.timeZone||'system')||String(value||'');
  }
  function scheduleValueFromDisplay(value, rules=batch.scheduleRules||freshScheduleRules()) {
    const raw=String(value||'').trim();if(!raw)return'';const match=raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);if(!match)return raw;
    const date=Scheduler?.zonedLocalToDate?.(match[1],match[2],rules?.timeZone||'system');return date?(Scheduler?.formatLocalDateTime?.(date)||raw):raw;
  }

  function planningDateMeta(value, rules=batch.scheduleRules||freshScheduleRules()) {
    if(!value) return { has:false, dateLabel:'未安排', timeLabel:'待安排', fullLabel:'尚未设置发送时间', minutePercent:0, dayKey:'', sortValue:Number.POSITIVE_INFINITY };
    const date = Scheduler?.parseLocalDateTime?.(value) || new Date(value);
    if(!date || Number.isNaN(date.getTime())) return { has:false, dateLabel:'未安排', timeLabel:'待安排', fullLabel:'尚未设置发送时间', minutePercent:0, dayKey:'', sortValue:Number.POSITIVE_INFINITY };
    const zone=rules?.timeZone||'system', parts=Scheduler?.datePartsInZone?.(date,zone);
    if(!parts) return { has:false, dateLabel:'未安排', timeLabel:'待安排', fullLabel:'尚未设置发送时间', minutePercent:0, dayKey:'', sortValue:Number.POSITIVE_INFINITY };
    const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
    const yyyy=parts.year, mm=String(parts.month).padStart(2,'0'), dd=String(parts.day).padStart(2,'0'), hh=String(parts.hour).padStart(2,'0'), mi=String(parts.minute).padStart(2,'0');
    const dayKey=`${yyyy}-${mm}-${dd}`,minutePercent=((parts.hour*60)+parts.minute)/1440*100;
    return {has:true,dateLabel:`${mm}/${dd} ${weekdays[parts.weekday]}`,timeLabel:`${hh}:${mi}`,fullLabel:`${yyyy}/${mm}/${dd} ${weekdays[parts.weekday]} ${hh}:${mi}`,minutePercent,dayKey,sortValue:date.getTime(),rangeValue:parts.hour*60+parts.minute,timeZone:zone};
  }

  function compactPlanningState(task) {
    if(task.policyBlocked) return {label:'停止联系', tone:'muted'};
    if(!task.enabled) return {label:'未纳入', tone:'muted'};
    const issues = taskIssueState(task);
    if(issues.content.length) return {label:'需补内容', tone:'warn'};
    if(issues.review.length) return {label:'需核对', tone:'warn'};
    if(issues.schedule.length) return {label:'需调时间', tone:'warn'};
    if(issues.other.length) return {label:'不可创建', tone:'warn'};
    if(task.status==='done') return {label:'已完成', tone:'ok'};
    if(task.status==='running') return {label:'执行中', tone:'info'};
    return {label:'可创建', tone:'ok'};
  }

  function derivePlanningGroups(tasks=[]) {
    const rules=batch.scheduleRules||freshScheduleRules();
    const visible=[...(tasks||[])].sort((a,b)=>{
      const aMeta=planningDateMeta(a.scheduleAt,rules), bMeta=planningDateMeta(b.scheduleAt,rules);
      if(aMeta.sortValue!==bMeta.sortValue) return aMeta.sortValue-bMeta.sortValue;
      return String(a.recipients||'').localeCompare(String(b.recipients||''),'zh-CN');
    });
    const selected=visible.filter(task=>task.enabled);
    const unscheduled=[];
    const dayMap=new Map();
    const schoolMap=new Map();
    for(const task of visible){
      const group=Scheduler?.groupForTask?.(task) || {key:String(task.school||task.recipients||task.editKey),label:String(task.school||task.recipients||'未识别学校')};
      if(!schoolMap.has(group.key)) schoolMap.set(group.key,{key:group.key,label:group.label,tasks:[],selectedCount:0,scheduledCount:0,unscheduled:[],cells:new Map(),rounds:new Set()});
      const schoolEntry=schoolMap.get(group.key);
      schoolEntry.tasks.push(task);
      if(task.enabled)schoolEntry.selectedCount++;
      const meta=planningDateMeta(task.scheduleAt,rules);
      if(!meta.has){
        unscheduled.push(task);
        schoolEntry.unscheduled.push(task);
        continue;
      }
      schoolEntry.scheduledCount++;
      if(!dayMap.has(meta.dayKey)) dayMap.set(meta.dayKey,{dayKey:meta.dayKey,meta,tasks:[],selectedCount:0,schools:new Map()});
      const round=dayMap.get(meta.dayKey);
      round.tasks.push(task);
      if(task.enabled)round.selectedCount++;
      if(!round.schools.has(group.key)) round.schools.set(group.key,{label:group.label,count:0,selectedCount:0});
      const roundSchool=round.schools.get(group.key);
      roundSchool.count++;
      if(task.enabled)roundSchool.selectedCount++;
      if(!schoolEntry.cells.has(meta.dayKey)) schoolEntry.cells.set(meta.dayKey,[]);
      schoolEntry.cells.get(meta.dayKey).push(task);
    }
    const rounds=[...dayMap.values()].sort((a,b)=>a.meta.sortValue-b.meta.sortValue).map((round,index)=>({
      ...round,
      roundIndex:index+1,
      anchor:`r${index+1}`,
      schoolCount:round.schools.size,
      duplicateSchools:[...round.schools.values()].filter(entry=>entry.count>(rules.maxPerGroupPerRound||1)),
      dateLabel:round.meta.dateLabel,
      primaryTime:round.meta.timeLabel
    }));
    const roundIndexByDayKey=new Map(rounds.map(round=>[round.dayKey,round.roundIndex]));
    const schoolRows=[...schoolMap.values()].map((entry,index)=>{
      const roundRefs=[...entry.cells.keys()].map(key=>roundIndexByDayKey.get(key)).filter(Boolean).sort((a,b)=>a-b);
      const overflowRounds=rounds.filter(round=>(entry.cells.get(round.dayKey)||[]).length>(rules.maxPerGroupPerRound||1)).map(round=>round.roundIndex);
      return {
        ...entry,
        anchor:`s${index+1}`,
        roundRefs,
        totalCount:entry.tasks.length,
        pendingCount:entry.unscheduled.length,
        overflowRounds,
        firstRound:roundRefs[0]||Number.POSITIVE_INFINITY
      };
    }).sort((a,b)=>a.firstRound-b.firstRound || b.totalCount-a.totalCount || String(a.label).localeCompare(String(b.label),'zh-CN'));
    const repeatSchools=schoolRows.filter(entry=>entry.totalCount>1 || entry.roundRefs.length>1);
    const enabledReady=selected.filter(task=>task.status==='ready');
    const audit=Scheduler?.audit?.(enabledReady,rules,{externalAnchors:rules.includeMailboxScheduled!==false?batch.existingScheduleAnchors:[]})||{conflicts:[],externalConflicts:[],timeConflicts:[],holidayConflicts:[]};
    return {rules, visible, selected, unscheduled, rounds, schoolRows, repeatSchools, audit};
  }

  function scheduleWeekdayText(rules) {
    const labels={1:'周一',2:'周二',3:'周三',4:'周四',5:'周五'};
    const days=(rules?.weekdays||[]).map(day=>labels[Number(day)]).filter(Boolean);
    return days.length?days.join(' / '):'未选择工作日';
  }
  function scheduleSkipText(rules) {
    let start=String(rules?.skipStart||''),end=String(rules?.skipEnd||'');
    if(start&&!end)end=start;if(end&&!start)start=end;if(!start)return'';if(start>end)[start,end]=[end,start];
    const short=value=>value?value.slice(5).replace('-','/'):' ';return start===end?`跳过 ${short(start)}`:`跳过 ${short(start)}–${short(end)}`;
  }
  function scheduleZoneText(rules) { return Scheduler?.timeZoneLabel?.(rules?.timeZone||'system') || String(rules?.timeZone||'本机时间'); }
  function scheduleRuleHumanText(rules) {
    const parts=[scheduleWeekdayText(rules),`${rules?.localTime||'07:30'} · ${scheduleZoneText(rules)} 当地时间`,`每校每个发送日 ${rules?.maxPerGroupPerRound||1} 位`];
    const skip=scheduleSkipText(rules);if(skip)parts.push(skip);if(rules?.skipHolidays!==false)parts.push('避开可识别的当地节假日');return parts.join(' · ');
  }

  function renderPlanningOverview(tasks, snapshot=batchSummarySnapshot(dispatchTasks())) {
    if(!planningOverviewEl) return;
    const data=derivePlanningGroups(tasks);
    const warnings=[];
    if(data.audit.conflicts?.length)warnings.push(`${data.audit.conflicts.length} 个同校冲突`);
    if(data.audit.holidayConflicts?.length)warnings.push(`${data.audit.holidayConflicts.length} 个日历规则问题`);
    const externalWarnings=(data.audit.externalConflicts?.length||0)+(data.audit.timeConflicts?.length||0);if(externalWarnings)warnings.push(`${externalWarnings} 个已有排期冲突`);
    const ruleSummary=scheduleRuleHumanText(data.rules);
    const unscheduled=data.unscheduled.length;
    const lockedCount=data.rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus==='ok'?batch.existingScheduleAnchors.length:null;
    const issueText=warnings.length?warnings.join(' · '):'规则正常';
    planningOverviewEl.innerHTML=`
      <section class="nmda-plan-commandbar">
        <div class="nmda-plan-command-main">
          <strong>排期矩阵</strong>
          <span>${escapeHtml(ruleSummary)}</span>
        </div>
        <div class="nmda-plan-command-stats">
          <span>学校 <strong>${data.schoolRows.length}</strong></span>
          <span>发送日 <strong>${data.rounds.length}</strong></span>
          <span>本次 <strong>${snapshot.selectedTotal}</strong></span>
          ${data.rules.includeMailboxScheduled!==false?`<span>已有排期 <strong>${lockedCount==null?'—':lockedCount}</strong></span>`:''}
          <span>可创建 <strong>${snapshot.selectedReady}</strong></span>
          <span data-tone="${warnings.length?'warn':'ok'}">${escapeHtml(issueText)}</span>
        </div>
      </section>
      ${unscheduled?`<section class="nmda-plan-exceptionbar"><div><strong>${unscheduled} 封尚未排期</strong><span>这些邮件没有发送日期，不应占用矩阵列；请先补排期。</span></div><button type="button" data-show-unscheduled>查看异常</button></section>`:''}
    `;
  }


  function renderScheduleCenter() {
    if (typeof renderProcessGuide === 'function') renderProcessGuide();
    const card=$('nmda-scheduler-card'); if(!card)return;
    const tasks=dispatchTasks(), hasTasks=tasks.length>0;
    card.hidden=!hasTasks; if(!hasTasks)return;
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent=card.open?'收起':'展开';
    if(!Scheduler){if(scheduleRulePreviewEl)scheduleRulePreviewEl.textContent='自动安排暂不可用。';if(scheduleApplyEl)scheduleApplyEl.disabled=true;return;}
    syncScheduleRuleControls();
    const selected=tasks.filter(t=>t.enabled&&t.status==='ready');
    const groups=new Map(); let fallback=0, auto=0, protectedCount=0, unscheduled=0;
    for(const task of selected){
      const group=Scheduler.groupForTask(task); groups.set(group.key,group);
      if(group.source==='domain'||group.source==='unknown')fallback++;
      if(task.scheduleSource==='auto'&&task.scheduleAt)auto++;
      else if(task.scheduleAt)protectedCount++;
      else unscheduled++;
    }
    const rules=batch.scheduleRules||freshScheduleRules();
    const externalAnchors=rules.includeMailboxScheduled!==false?batch.existingScheduleAnchors:[];
    const audit=Scheduler.audit?.(selected,rules,{externalAnchors})||{conflicts:[],externalConflicts:[],timeConflicts:[],holidayConflicts:[]};
    const conflictCount=audit.conflicts?.length||0, externalConflictCount=(audit.externalConflicts?.length||0)+(audit.timeConflicts?.length||0), holidayConflictCount=audit.holidayConflicts?.length||0;
    const mailboxInfo=rules.includeMailboxScheduled===false?'网易已有排期关闭':batch.existingScheduleStatus==='loading'?'正在读取网易已有排期':batch.existingScheduleStatus==='ok'?`网易锁定 ${externalAnchors.length}`:batch.existingScheduleStatus==='error'?'网易已有排期读取失败':'网易已有排期：应用时读取';
    if(scheduleSummaryEl)scheduleSummaryEl.innerHTML=`<strong>${selected.length}</strong> 已选 · 自动 ${auto} · 已有 ${protectedCount} · 待排 ${unscheduled}${rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus==='ok'?` · 锁定 ${externalAnchors.length}`:''}${externalConflictCount?` · <span class="nmda-danger">与已有排期冲突 ${externalConflictCount}</span>`:''}${conflictCount?` · <span class="nmda-danger">同校冲突 ${conflictCount}</span>`:''}${holidayConflictCount?` · <span class="nmda-danger">日历规则 ${holidayConflictCount}</span>`:''}`;
    const priorityTasks=selected.filter(task=>Scheduler.priorityRoundForTask?.(task)?.has);
    const prioritySchools=new Set(priorityTasks.map(task=>Scheduler.groupForTask(task).key)).size;
    const prioritySummary=$('nmda-schedule-priority-summary'),priorityButton=$('nmda-schedule-open-priority');
    const prioritySources=typeof rosterPlannerSources==='function'?rosterPlannerSources():[];
    if(prioritySummary)prioritySummary.textContent=priorityTasks.length?`${priorityTasks.length} 封已设置 R1/R2… · ${prioritySchools} 所学校；仅用于同校先后。`:(prioritySources.length?'未设置时按现有名单顺序排期；需要时再补 R1/R2…。':'未导入可编辑总名单；不设置优先级也可正常排期。');
    if(priorityButton){priorityButton.textContent=priorityTasks.length?'调整优先级':'设置优先级';priorityButton.disabled=!prioritySources.length;priorityButton.title=prioritySources.length?'可选：设置同一学校内联系人先后':'未导入可编辑 XLSX 总名单；这不会阻止时间规划';}
    if(scheduleRulePreviewEl){
      const conflictText=conflictCount?` · ${conflictCount} 个同校时间冲突`:'';const externalText=externalConflictCount?` · ${externalConflictCount} 个与网易已有排期冲突`:'';const holidayText=holidayConflictCount?` · ${holidayConflictCount} 个已有时间不符合当前日历规则`:'';
      scheduleRulePreviewEl.textContent=`${scheduleRuleHumanText(rules)} · ${mailboxInfo}${conflictText}${externalText}${holidayText}`;
    }
    const ruleChip=$('nmda-planning-rule-chip');
    if(ruleChip)ruleChip.textContent=`${scheduleWeekdayText(rules)} · ${rules.localTime||'07:30'} 当地时间 · 每校 ${rules.maxPerGroupPerRound||1} 位${scheduleSkipText(rules)?` · ${scheduleSkipText(rules)}`:''}${rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus==='ok'?` · 锁定 ${externalAnchors.length}`:''}${conflictCount+externalConflictCount?` · ${conflictCount+externalConflictCount} 个冲突`:''}`;
    const scheduleContextCopy=$('nmda-schedule-context-copy');
    if(scheduleContextCopy){
      const rosterCount=referenceRosterCount();
      const schoolKnown=selected.filter(task=>String(task.school||'').trim()).length;
      const priorityKnown=selected.filter(task=>Scheduler.priorityForTask?.(task)?.has).length;
      const contextText=rosterCount?`已加入 ${rosterCount} 条参考名单；${schoolKnown} 封已有院校信息${priorityKnown?`，其中 ${priorityKnown} 封有明确顺序`:''}。`:`${schoolKnown} / ${selected.length} 封已有院校信息。`;
      scheduleContextCopy.textContent=`${contextText} 选择地区、工作日与当地时间后应用。`;
    }
    if(scheduleApplyEl){scheduleApplyEl.disabled=batch.running||!selected.length;scheduleApplyEl.textContent=auto||unscheduled?'应用安排':'重新安排';}
    if(scheduleClearEl)scheduleClearEl.disabled=batch.running||!tasks.some(t=>t.scheduleSource==='auto'&&t.scheduleAt);
  }

  function captureSchedulePlanMotionState() {
    const wrap=previewBodyEl?.querySelector?.('.nmda-plan-matrix-wrap');
    const rects=new Map();
    previewBodyEl?.querySelectorAll?.('[data-plan-task-key]').forEach(el=>{
      const key=String(el.dataset.planTaskKey||'');
      if(!key)return;
      const rect=el.getBoundingClientRect();
      if(rect.width>0&&rect.height>0)rects.set(key,{left:rect.left,top:rect.top,width:rect.width,height:rect.height});
    });
    return {
      rects,
      scrollLeft:wrap?.scrollLeft||0,
      scrollTop:wrap?.scrollTop||0,
      capturedAt:performance.now()
    };
  }

  function schedulePlanMotionSummary(plan){
    const summary=plan?.summary||{};
    const parts=[];
    if(summary.auto)parts.push(`${summary.auto} 封落位`);
    if(summary.scheduleDays||summary.rounds)parts.push(`${summary.scheduleDays||summary.rounds} 个发送日`);
    if(summary.lockedTimeAdjusted)parts.push(`避让 ${summary.lockedTimeAdjusted}`);
    if(summary.holidayAdjusted)parts.push(`顺延 ${summary.holidayAdjusted}`);
    return parts.join(' · ')||'排期已应用';
  }

  function playSchedulePlanMotion(previous, plan){
    if(!previous||!previewBodyEl)return;
    const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const wrap=previewBodyEl.querySelector('.nmda-plan-matrix-wrap');
    if(wrap){wrap.scrollLeft=previous.scrollLeft||0;wrap.scrollTop=previous.scrollTop||0;}
    const card=$('nmda-preview-card');
    if(card){
      card.classList.remove('is-plan-settling');
      void card.offsetWidth;
      card.classList.add('is-plan-settling');
      window.setTimeout(()=>card.classList.remove('is-plan-settling'),900);
    }
    const toast=document.createElement('div');
    toast.className='nmda-plan-motion-toast';
    toast.innerHTML=`<span class="nmda-plan-motion-check" aria-hidden="true">✓</span><span><strong>Plan applied</strong><small>${escapeHtml(schedulePlanMotionSummary(plan))}</small></span>`;
    card?.appendChild(toast);
    window.setTimeout(()=>toast.remove(),1800);
    if(reduceMotion)return;

    const viewport=previewBodyEl.getBoundingClientRect();
    const candidates=[...previewBodyEl.querySelectorAll('[data-plan-task-key]')].filter(el=>{
      const rect=el.getBoundingClientRect();
      return rect.bottom>=viewport.top-80&&rect.top<=viewport.bottom+80&&rect.right>=viewport.left-80&&rect.left<=viewport.right+80;
    }).slice(0,90);
    let enterIndex=0;
    for(const el of candidates){
      const key=String(el.dataset.planTaskKey||'');
      const now=el.getBoundingClientRect();
      const before=previous.rects.get(key);
      if(before){
        const dx=before.left-now.left,dy=before.top-now.top;
        const moved=Math.abs(dx)>1||Math.abs(dy)>1;
        el.animate(moved?[
          {transform:`translate(${dx}px, ${dy}px) scale(.985)`,opacity:.78,boxShadow:'0 14px 34px rgba(37,99,235,.14)'},
          {transform:'translate(0, 0) scale(1)',opacity:1,boxShadow:'0 2px 8px rgba(15,23,42,.05)'}
        ]:[
          {transform:'scale(.985)',filter:'brightness(1.04)'},
          {transform:'scale(1)',filter:'brightness(1)'}
        ],{duration:moved?560:360,easing:moved?'cubic-bezier(.2,.82,.2,1)':'ease-out',fill:'both'});
      }else{
        const delay=Math.min(enterIndex++,10)*34;
        el.animate([
          {transform:'translateY(12px) scale(.965)',opacity:0},
          {transform:'translateY(-2px) scale(1.006)',opacity:1,offset:.78},
          {transform:'translateY(0) scale(1)',opacity:1}
        ],{duration:460,delay,easing:'cubic-bezier(.2,.78,.2,1)',fill:'both'});
      }
    }
    [...previewBodyEl.querySelectorAll('.nmda-plan-matrix-colhead')].slice(0,12).forEach((el,index)=>{
      el.animate([
        {transform:'translateY(-5px)',opacity:.72},
        {transform:'translateY(0)',opacity:1}
      ],{duration:330,delay:index*28,easing:'cubic-bezier(.2,.8,.2,1)'});
    });
  }

  function renderAppliedScheduleWithMotion(previous, plan){
    renderPreview({aux:false});
    requestAnimationFrame(()=>requestAnimationFrame(()=>playSchedulePlanMotion(previous,plan)));
  }

  async function applySmartSchedule() {
    if(!Scheduler){setBatchStatus('自动安排暂不可用。','error');return;}
    try{
      const rules=readScheduleRuleControls();
      const tasks=dispatchTasks();
      const externalAnchors=rules.includeMailboxScheduled!==false?await readExistingScheduleAnchors({required:true}):[];
      const plan=Scheduler.buildPlan(tasks,rules,new Date(),{externalAnchors});
      for(const assignment of plan.assignments){
        const task=tasks.find(item=>item.editKey===assignment.editKey);if(!task)continue;
        await updateDispatchTask(task,{scheduleAt:assignment.scheduleAt,scheduleSource:'auto',scheduleReason:assignment.reason});
      }
      batch.schedulePlan=plan;
      if(window.matchMedia('(max-width: 900px)').matches)setPlanningView('mails');
      const refreshed=dispatchTasks();
      const s=plan.summary, audit=Scheduler.audit?.(refreshed,rules,{externalAnchors:plan.externalAnchors||externalAnchors})||{conflicts:[],externalConflicts:[],timeConflicts:[],holidayConflicts:[]};
      const priority=s.priorityOrderedGroups?`；${s.priorityOrderedGroups} 所院校已按总名单顺序排列`:'';
      const holiday=s.holidayAdjusted?`；${s.holidayAdjusted} 封已避开当地节假日`:'';
      const skipped=s.skipAdjusted?`；${s.skipAdjusted} 封已跨过跳过时间段`:'';
      const externalConflictCount=(audit.externalConflicts?.length||0)+(audit.timeConflicts?.length||0);
      const conflicts=(audit.conflicts?.length||0)+(audit.holidayConflicts?.length||0)+externalConflictCount;
      const conflict=audit.conflicts?.length?`；保留的当前时间仍有 ${audit.conflicts.length} 个同校规则冲突，请手工调整或关闭“保留已有时间”后重排`:'';
      const externalConflict=externalConflictCount?`；仍有 ${externalConflictCount} 个时间与网易已有排期冲突，请手工调整`:'';
      const holidayConflict=audit.holidayConflicts?.length?`；${audit.holidayConflicts.length} 个保留时间不符合当前工作日/跳过区间/节假日规则`:'';
      const locked=s.externalAnchors?`；纳入网易已有定时草稿 ${s.externalAnchors} 封（只读）`:'';
      const avoided=s.lockedTimeAdjusted?`；${s.lockedTimeAdjusted} 封已避开已有时间槽`:'';
      setBatchStatus(`时间已安排：${s.selected} 封邮件，自动安排 ${s.auto} 封，保留当前已有 ${s.preserved} 封，共 ${s.scheduleDays||s.scheduleCycles||s.rounds} 个发送日${locked}${avoided}${priority}${holiday}${skipped}${conflict}${externalConflict}${holidayConflict}。`,conflicts?'warn':'ok');
      return true;
    }catch(error){setBatchStatus(`安排时间失败：${error.message}`,'error');return false;}
  }

  async function validateMailboxScheduleBeforeExecution(tasks){
    const rules=readScheduleRuleControls();
    if(rules.includeMailboxScheduled===false)return {ok:true,anchors:[]};
    try{
      const anchors=await readExistingScheduleAnchors({required:true});
      const audit=Scheduler?.audit?.(tasks,rules,{externalAnchors:anchors})||{conflicts:[],externalConflicts:[],timeConflicts:[],holidayConflicts:[]};
      const groupConflicts=(audit.conflicts?.length||0)+(audit.externalConflicts?.length||0),timeConflicts=audit.timeConflicts?.length||0,calendarConflicts=audit.holidayConflicts?.length||0;
      if(groupConflicts||timeConflicts||calendarConflicts){
        const parts=[];if(groupConflicts)parts.push(`${groupConflicts} 个同校发送日冲突`);if(timeConflicts)parts.push(`${timeConflicts} 个时间槽冲突`);if(calendarConflicts)parts.push(`${calendarConflicts} 个工作日 / 跳过时间段 / 节假日冲突`);
        return {ok:false,anchors,audit,reason:`当前排期与规则不一致：${parts.join('、')}。请重新应用排期或调整保留时间后再执行。`};
      }
      return {ok:true,anchors,audit};
    }catch(error){return {ok:false,anchors:[],reason:error?.message||String(error)};}
  }

  async function clearAutoSchedule() {
    let cleared=0;
    for(const task of dispatchTasks()){
      if(task.scheduleSource!=='auto')continue;
      await updateDispatchTask(task,{scheduleAt:'',scheduleSource:'',scheduleReason:''}); cleared++;
    }
    batch.schedulePlan=null;
    setBatchStatus(cleared?`已清除 ${cleared} 封任务的自动排程；手工或原有时间保持不变。`:'当前没有自动排程需要清除。',cleared?'ok':'warn');
    scheduleBatchRender({aux:false,force:true});
  }

  function batchSummarySnapshot(tasks = dispatchTasks()) {
    const snapshot={errors:0,done:0,selectedReady:0,selectedScheduled:0,selectedTotal:0,unselected:0};
    for(const task of tasks){
      if(task.status==='error')snapshot.errors++;
      if(task.status==='done')snapshot.done++;
      if(task.enabled && task.status!=='done')snapshot.selectedTotal++;
      if(!task.enabled)snapshot.unselected++;
      if(task.enabled && task.status==='ready'){
        snapshot.selectedReady++;
        if(task.scheduleAt)snapshot.selectedScheduled++;
      }
    }
    return snapshot;
  }

  function renderBatchSummaryControls(tasks = dispatchTasks(), snapshot = batchSummarySnapshot(tasks)) {
    const sources=Dispatch?.sourceCounts?.(tasks)||{initial:tasks.filter(t=>t.dispatchKind!=='follow_up').length,followUp:tasks.filter(t=>t.dispatchKind==='follow_up').length};
    const summaryParts=[`共 <strong>${tasks.length}</strong> 封`,`初始 <strong>${sources.initial}</strong>`,`Follow-up <strong>${sources.followUp}</strong>`,`本次 <strong>${snapshot.selectedTotal}</strong>`,`可创建 <strong>${snapshot.selectedReady}</strong>`];
    if(snapshot.selectedScheduled)summaryParts.push(`定时 ${snapshot.selectedScheduled}`);
    if(snapshot.errors)summaryParts.push(`<span class="nmda-danger">异常 ${snapshot.errors}</span>`);
    if(snapshot.done)summaryParts.push(`已完成 ${snapshot.done}`);
    batchSummaryEl.innerHTML=summaryParts.join(' · ');
    if(batchStartEl)batchStartEl.textContent=snapshot.selectedReady?`前往网易邮箱 · 创建 ${snapshot.selectedReady} 封`:'前往网易邮箱并创建所选草稿';
    const selectionChip=$('nmda-planning-selection-chip');
    if(selectionChip)selectionChip.textContent=snapshot.selectedReady?`本次已选择 ${snapshot.selectedReady} 封${snapshot.selectedScheduled?` · 已定时 ${snapshot.selectedScheduled} 封`:''}`:'尚未选择可创建邮件';
    const attachmentChip=$('nmda-planning-attachment-chip');
    if(attachmentChip){
      const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{issues:0};
      const localCount=attachmentPreparedFileCount();
      attachmentChip.textContent=stats.issues?`附件待处理 ${stats.issues} 项`:localCount?`初始邮件附件 ${localCount} 个`:'当前执行池无本地附件';
      attachmentChip.dataset.state=stats.issues?'warn':localCount?'ok':'idle';
    }

    batchStartEl.disabled=batch.running||!snapshot.selectedReady;
    const preflight=$('nmda-create-preflight');
    if(preflight){
      const selected=(tasks||[]).filter(task=>task.enabled&&task.status==='ready');
      const fileCount=selected.reduce((sum,task)=>sum+(task.files?.length||0),0);
      const attachmentlessCount=selected.filter(task=>!(task.files?.length||0)).length;
      const unscheduledCount=Math.max(0,snapshot.selectedReady-snapshot.selectedScheduled);
      const excluded=typeof excludedImportCount==='function'?excludedImportCount():0;
      const facts=[`本次 ${snapshot.selectedReady} 封`,snapshot.selectedScheduled?`定时 ${snapshot.selectedScheduled} 封`:'',fileCount?`附件 ${fileCount} 份`:'',excluded?`已排除 ${excluded} 封`:''].filter(Boolean);
      const alerts=[];
      if(unscheduledCount){
        alerts.push(`<div class="nmda-execution-alert" data-risk="schedule"><span class="nmda-execution-alert-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.25"/><path d="M10 6.4v4l2.9 1.8"/></svg></span><div><strong>${unscheduledCount} 封未定时</strong><small>将保存为普通草稿，不会按计划自动发送</small></div><b>${unscheduledCount===snapshot.selectedReady?'全部':'检查'}</b></div>`);
      }
      if(attachmentlessCount){
        alerts.push(`<div class="nmda-execution-alert" data-risk="attachment"><span class="nmda-execution-alert-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7.2 9.8 11 6a2.25 2.25 0 1 1 3.2 3.2l-5 5a3.25 3.25 0 0 1-4.6-4.6l5.25-5.25"/></svg></span><div><strong>${attachmentlessCount} 封无附件</strong><small>${attachmentlessCount===snapshot.selectedReady?'当前所选邮件均不带附件，请确认这是预期':'这些邮件未携带附件，执行前请确认'}</small></div><b>${attachmentlessCount===snapshot.selectedReady?'全部':'检查'}</b></div>`);
      }
      const safeCopy=alerts.length?'':'<span class="nmda-execution-safe"><i></i>执行检查通过</span>';
      preflight.innerHTML=`<div class="nmda-preflight-facts"><span>${facts.map(item=>`<em>${escapeHtml(item)}</em>`).join('')}</span><strong>执行时自动切到网易邮箱</strong>${safeCopy}</div>${alerts.length?`<div class="nmda-execution-alerts">${alerts.join('')}</div>`:''}`;
      const handoff=$('nmda-mail-handoff-bar');
      if(handoff)handoff.dataset.attention=alerts.length?'true':'false';
      const riskSignature=`${unscheduledCount}:${attachmentlessCount}:${snapshot.selectedReady}`;
      if(alerts.length&&preflight.dataset.riskSignature!==riskSignature){
        preflight.dataset.riskSignature=riskSignature;
        if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
          requestAnimationFrame(()=>preflight.querySelectorAll('.nmda-execution-alert').forEach((el,index)=>{
            el.animate([
              {opacity:0,transform:'translateY(7px) scale(.985)',backgroundPosition:'100% 0'},
              {opacity:1,transform:'translateY(-1px) scale(1.002)',backgroundPosition:'38% 0',offset:.72},
              {opacity:1,transform:'translateY(0) scale(1)',backgroundPosition:'0% 0'}
            ],{duration:420,delay:index*65,easing:'cubic-bezier(.2,.78,.2,1)'});
          }));
        }
      }else if(!alerts.length){
        preflight.dataset.riskSignature=riskSignature;
      }
    }
    return snapshot;
  }

  function refreshTaskSearchStatic(task){
    if(!task)return;
    task._searchStatic=normalizedSearchText([
      task.id,task.sourceRow,task.recipients,task.school,task.subject,task.body,
      task.files?.map(file=>file.name).join(' ')||'',
      task.scheduleAt?task.scheduleAt.replace('T',' '):'',
      parseTaskClassifications(task.tags||[]).join(' ')
    ].join(' '));
  }

  function renderPreview({ aux = true } = {}) {
    const tasks=dispatchTasks();
    const matched=filteredBatchTasks();
    const snapshot=renderBatchSummaryControls(tasks);
    const planning=derivePlanningGroups(matched);
    renderPlanningOverview(matched,snapshot);

    const templateColumns=`250px repeat(${Math.max(1,planning.rounds.length)}, minmax(210px, 1fr))`;
    const headers=[
      `<div class="nmda-plan-matrix-corner"><strong>学校</strong><small>每行一所学校；横向查看各轮分布</small></div>`,
      ...planning.rounds.map(round=>renderPlanningRoundHeader(round))
    ];
    const rows=planning.schoolRows.map(school=>renderPlanningSchoolRow(school,planning.rounds)).join('');
    const unscheduledHtml=planning.unscheduled.length?`<section class="nmda-plan-unscheduled" id="nmda-unscheduled-exceptions" hidden><header><div><strong>尚未排期</strong><small>${planning.unscheduled.length} 封邮件缺少发送日期</small></div></header><div class="nmda-plan-unscheduled-list">${planning.unscheduled.map(task=>renderPlanningLooseTask(task)).join('')}</div></section>`:'';

    if(!planning.schoolRows.length){
      previewBodyEl.innerHTML='<div class="nmda-plan-empty">没有匹配的邮件。调整搜索条件后再试。</div>';
    }else{
      previewBodyEl.innerHTML=`${unscheduledHtml}<div class="nmda-plan-matrix-wrap"><div class="nmda-plan-matrix" style="grid-template-columns:${templateColumns}">${headers.join('')}${rows}</div></div>`;
    }

    const hasTasks=tasks.length>0;
    const viewingPlanning=currentWorkbenchTab()==='dispatch';
    const emptyCard=$('nmda-batch-empty');
    if(emptyCard){
      let kicker='选择与排期',title='等待邮件任务',desc='Initial 与 Follow-up 都经邮件审阅规则通过后进入这里。';
      if(!tasks.length){kicker='执行池为空';title='还没有可安排的邮件';desc='先在“邮件审阅”完成 Initial / Follow-up 的 Pass。';}
      emptyCard.innerHTML=`<div class="nmda-card-kicker">${escapeHtml(kicker)}</div><div class="nmda-card-title">${escapeHtml(title)}</div><div class="nmda-card-desc">${escapeHtml(desc)}</div>`;
      emptyCard.hidden=!(viewingPlanning&&!hasTasks);
    }
    $('nmda-preview-card').hidden=!(viewingPlanning&&hasTasks);
    $('nmda-scheduler-card').hidden=!hasTasks;
    renderDispatchSourceSummary(tasks);
    renderScheduleCenter();
    setPlanningView('mails');
    if(currentWorkbenchTab()==='batch')syncStageSurfaceVisibility(batch.uiStep);
    if(aux){
      renderTagChips(); renderAttachmentCenter(); renderImportTaskPreview(); renderRosterAudit(); renderImportHandoff(); renderReviewPageOverview(); viewPerf.batchAuxDirty=false;
    }
    viewPerf.batchDirty=false;
    return {matched:matched.length,...snapshot};
  }

  function renderPlanningRoundHeader(round){
    const warn=round.duplicateSchools.length?`<span class="nmda-plan-matrix-colmeta is-warn">同校超额 ${round.duplicateSchools.length}</span>`:`<span class="nmda-plan-matrix-colmeta">正常</span>`;
    return `<div class="nmda-plan-matrix-colhead"><div class="nmda-plan-matrix-coltop"><em>发送日 ${round.roundIndex}</em><strong>${escapeHtml(round.dateLabel)}</strong></div><small>${round.selectedCount}/${round.tasks.length} 封 · ${round.schoolCount} 校</small>${warn}</div>`;
  }

  function renderPlanningSchoolRow(school, rounds){
    const badges=[];
    badges.push(`<span class="nmda-plan-schoolbadge">${school.totalCount} 封</span>`);
    if(school.roundRefs.length)badges.push(`<span class="nmda-plan-schoolbadge">发送日 ${school.roundRefs.join('/')}</span>`);
    if(school.overflowRounds.length)badges.push(`<span class="nmda-plan-schoolbadge is-warn">发送日超额 ${school.overflowRounds.join('/')}</span>`);
    const cells=[
      `<div class="nmda-plan-matrix-rowhead"><strong>${escapeHtml(school.label)}</strong><div class="nmda-plan-schoolbadges">${badges.join('')}</div></div>`,
      ...rounds.map(round=>{
        const cellTasks=school.cells.get(round.dayKey)||[];
        const overflow=cellTasks.length>(batch.scheduleRules?.maxPerGroupPerRound||1);
        return `<div class="nmda-plan-matrix-cell ${overflow?'is-overflow':''}">${renderPlanningTaskStack(cellTasks,{empty:'',roundIndex:round.roundIndex,roundDate:round.dateLabel,schoolHidden:true})}</div>`;
      })
    ];
    return cells.join('');
  }

  function renderPlanningTaskStack(tasks, context={}){
    if(!tasks?.length)return `<div class="nmda-plan-matrix-emptycell" aria-hidden="true"></div>`;
    return `<div class="nmda-plan-matrix-stack">${tasks.map(task=>renderPlanningMatrixTask(task,context)).join('')}</div>`;
  }

  function dispatchKindBadge(task){
    return task?.dispatchKind === 'follow_up'
      ? `<span class="nmda-plan-minibadge nmda-plan-source-followup">Follow-up #${Math.max(1,Number(task.sequence||1))}</span>`
      : '<span class="nmda-plan-minibadge nmda-plan-source-initial">初始邮件</span>';
  }

  function renderPlanningMatrixTask(task, context={}){
    const state=compactPlanningState(task), rules=batch.scheduleRules||freshScheduleRules();
    return `<article class="nmda-plan-matrix-task" data-plan-task-key="${escapeHtml(task.editKey)}" data-state-tone="${escapeHtml(state.tone)}" data-dispatch-kind="${escapeHtml(task.dispatchKind||'initial')}">
      <label class="nmda-plan-matrix-toggle"><input type="checkbox" data-task-enabled="${escapeHtml(task.editKey)}" ${task.enabled?'checked':''} ${batch.running||task.policyBlocked||task.status==='running'||task.status==='done'?'disabled':''}></label>
      <div class="nmda-plan-matrix-taskbody">
        <div class="nmda-plan-matrix-taskline"><strong>${escapeHtml(task.recipients||'—')}</strong><span class="nmda-inline-flag nmda-inline-flag-${escapeHtml(state.tone)}">${escapeHtml(state.label)}</span></div>
        <div class="nmda-plan-matrix-taskmeta">${dispatchKindBadge(task)}${task.scheduleSource==='mailbox'&&task.mailboxDraftId?'<span class="nmda-plan-minibadge">已有排期 · 锁定</span>':''}${task.files?.length?`<span class="nmda-plan-minibadge">附件 ${task.files.length}</span>`:''}</div>
        <div class="nmda-plan-matrix-taskedit"><input type="datetime-local" data-task-schedule="${escapeHtml(task.editKey)}" value="${escapeHtml(scheduleValueForDisplay(task.scheduleAt,rules))}" ${batch.running||(task.scheduleSource==='mailbox'&&task.mailboxDraftId)?'disabled':''} title="${task.scheduleSource==='mailbox'&&task.mailboxDraftId?`网易已有排期为只读 · ${scheduleZoneText(rules)} 当地时间`:`${scheduleZoneText(rules)} 当地时间`}"></div>
      </div>
    </article>`;
  }

  function renderPlanningLooseTask(task){
    const state=compactPlanningState(task), rules=batch.scheduleRules||freshScheduleRules();
    const school=Scheduler?.groupForTask?.(task)?.label||task.school||'未识别学校';
    return `<article class="nmda-plan-loose-task" data-plan-task-key="${escapeHtml(task.editKey)}" data-dispatch-kind="${escapeHtml(task.dispatchKind||'initial')}"><label><input type="checkbox" data-task-enabled="${escapeHtml(task.editKey)}" ${task.enabled?'checked':''}></label><div><strong>${escapeHtml(task.recipients||'—')}</strong><small>${dispatchKindBadge(task)} ${escapeHtml(school)}</small></div><span class="nmda-inline-flag nmda-inline-flag-${escapeHtml(state.tone)}">${escapeHtml(state.label)}</span><input type="datetime-local" data-task-schedule="${escapeHtml(task.editKey)}" value="${escapeHtml(scheduleValueForDisplay(task.scheduleAt,rules))}" ${task.scheduleSource==='mailbox'&&task.mailboxDraftId?`disabled title="网易已有排期为只读 · ${escapeHtml(scheduleZoneText(rules))} 当地时间"`:`title="${escapeHtml(scheduleZoneText(rules))} 当地时间"`}></article>`;
  }


  function renderAttachmentCenter() {
    const stats=importAttachmentStats(),count=attachmentPreparedFileCount(),card=$('nmda-attachments-card'),contextPending=typeof supplementPreflightNeedsDecision==='function'&&supplementPreflightNeedsDecision();
    if(card)card.hidden=contextPending||(!count&&!stats.total);
    if(card){const title=card.querySelector('summary strong'),hint=card.querySelector('summary small');if(title)title.textContent='附件工作台';if(hint)hint.textContent=stats.issues?`${stats.issues} 项待补 · 打开工作台处理`:count?`${count} 个附件 · ${stats.matched}/${stats.total} 项需求已覆盖`:'查看附件要求';card.dataset.issue=stats.issues?'1':'0';card.open=false;}
    const summary=$('nmda-attachment-summary');if(summary)summary.innerHTML=stats.total?`已准备 <strong>${count}</strong> 个附件；邮件中有 <strong>${stats.total}</strong> 项附件要求，已覆盖 <strong>${stats.matched}</strong> 项${stats.issues?`，还有 <strong class="nmda-danger">${stats.issues}</strong> 项待处理。`:'，当前已全部覆盖。'}`:count?`已准备 <strong>${count}</strong> 个附件。发送范围统一在附件工作台配置。`:'当前没有附件文件或邮件附件要求。';
    const box=$('nmda-attachment-resolution'),list=$('nmda-attachment-resolution-list');if(box)box.hidden=true;if(list)list.innerHTML='';
    renderAttachmentAssetViews();
  }

  function setImportStatus(message, kind = '') {
    if (!importStatusEl) return;
    importStatusEl.textContent = message;
    if (kind) importStatusEl.dataset.kind = kind; else delete importStatusEl.dataset.kind;
  }

  function setBatchStatus(message, kind = '') {
    batchStatusEl.textContent = message;
    if (kind) batchStatusEl.dataset.kind = kind; else delete batchStatusEl.dataset.kind;
  }


  function mailboxDraftDataset(result = {}) {
    const headers=['编号','收件人','学校 / 机构','主题','正文','附件','定时时间','任务标记'];
    const rows=[headers];
    const rowMeta=[null];
    const drafts=Array.isArray(result.drafts)?result.drafts:[];
    let complete=0,missingRecipients=0;
    const warnings=[];
    for(const draft of drafts){
      const summary=draft?.summary||{};
      const id=String(draft?.id||summary?.id||'').trim();
      const recipients=String(draft?.recipients||summary?.toRaw||'').trim();
      const subject=String(draft?.subject||summary?.subject||'').trim();
      const body=String(draft?.body||'');
      const bodyHtml=String(draft?.bodyHtml||'');
      const isHtml=draft?.isHtml!==false;
      const cc=String(draft?.cc||'').trim();
      const bcc=String(draft?.bcc||'').trim();
      const account=String(draft?.account||'').trim();
      const priority=Number(draft?.priority||0)||0;
      const requestReadReceipt=!!draft?.requestReadReceipt;
      const attachmentObjects=(Array.isArray(draft?.attachments)?draft.attachments:[]).filter(item=>!(item&&typeof item==='object'&&item.inlined));
      const attachments=attachmentObjects.map(item=>String(item?.name||item||'').trim()).filter(Boolean);
      const scheduleAt=String(draft?.scheduleAt||'').trim();
      const savedAt=String(draft?.savedAt||summary?.savedAt||'').trim();
      const issues=[];
      if(draft?.ok===false)issues.push(`草稿详情读取不完整：${draft.reason||'未知错误'}`);
      if(!recipients)missingRecipients++;
      if(recipients&&subject&&body.trim())complete++;
      const evidence=[
        '来源：网易草稿箱',
        id?`草稿 ID：${id}`:'',
        savedAt?`保存时间：${savedAt}`:'',
        scheduleAt?`检测到定时：${scheduleAt}`:'',
        scheduleAt&&draft?.scheduleEvidence?`排期来源：${draft.scheduleEvidence}`:'',
        cc?`抄送：${cc}`:'',
        bcc?`密送：${bcc}`:'',
        account?`发件账号：${account}`:'',
        priority===1?'优先级：紧急':'',
        requestReadReceipt?'已读回执：开启':'',
        attachments.length?`原草稿附件：${attachments.join('、')}`:'',
        draft?.detailSource?`详情读取：${draft.detailSource}`:''
      ].filter(Boolean);
      const confidence=draft?.ok===false?45:(body.trim()?98:72);
      rows.push([id,recipients,'',subject,body,attachments.join(';'),scheduleAt,'草稿箱']);
      rowMeta.push({
        sourceFile:'网易草稿箱', confidence, issues, evidence,
        mailboxDraft:{
          id, savedAt, scheduleAt, scheduleEvidence:String(draft?.scheduleEvidence||''), cc, bcc, account, priority, requestReadReceipt,
          bodyHtml, isHtml, attachments:[...attachmentObjects], detailReadOk:draft?.ok!==false,
          detailSource:String(draft?.detailSource||''), directSchema:!!draft?.directSchema
        }
      });
    }
    if(result.truncated)warnings.push(`草稿箱本次仅读取 ${result.read||drafts.length} / ${result.total||'?'} 封；可再次读取或调整上限。`);
    if(result.failures)warnings.push(`${result.failures} 封草稿详情读取不完整，已保留在邮件审阅中。`);
    const recordSet={
      name:'网易草稿箱', source:'网易草稿箱', rows,
      meta:{
        format:'mailbox-drafts', sourcePurpose:'mail', purposeConfidence:100, purposeReasons:['草稿箱来源已确定为邮件'], mailboxDrafts:true, rowMeta,
        mailScan:{records:drafts.length,complete,missingRecipients}
      }
    };
    return {
      recordSets:[recordSet], sheets:[recordSet], sourceFiles:[{name:'网易草稿箱',size:0,_nmdaPath:'网易草稿箱'}], embeddedFiles:[], warnings,
      format:'mailbox-drafts',
      meta:{ mailboxDraftImport:true, mailboxAccount:String(result.uid||''), mailboxDraftCoverage:{read:Number(result.read||drafts.length),total:Number(result.total||drafts.length),complete:!!result.complete,truncated:!!result.truncated} }
    };
  }

  async function importMailboxDrafts() {
    if(batch.running){setImportStatus('正在执行当前批次，暂时不能读取草稿箱。','warn');return;}
    if(draftImportEl)draftImportEl.disabled=true;
    let token=null;
    try{
      // Authenticate before replacing the current import workspace. A failed login check must never erase
      // a batch the user is already reviewing.
      const connection=await chrome.runtime.sendMessage({type:'NMDA_CONNECTION_STATUS'});
      if(!connection?.connected||!connection?.authenticated){
        await chrome.runtime.sendMessage({type:'NMDA_OPEN_MAIL',focus:true}).catch(()=>null);
        setImportStatus('请先在网易邮箱完成登录，然后返回工作台再次点击“读取草稿箱”。','warn');
        return;
      }
      token=beginImportSession('正在读取网易草稿箱…');
      setImportStatus('正在读取草稿列表与原生 Compose 数据；无需逐封打开页面，将获取正文、收件人、定时和附件信息。');
      const result=await chrome.runtime.sendMessage({type:'NMDA_IMPORT_DRAFTS',limit:300});
      if(!isCurrentBatchSession(token))return;
      if(!result?.ok)throw new Error(result?.reason||'草稿箱读取失败');
      const dataset=mailboxDraftDataset(result);
      await applyImportedDataset(dataset,'网易草稿箱',token);
      if(!isCurrentBatchSession(token))return;
      const coverage=result.complete?'已读取完整草稿箱':`已读取最近 ${result.read||0} 封草稿`;
      setImportStatus(`${coverage}；已识别正文、主题、收件人、定时与附件要求。原草稿附件不会被伪造复制，创建前需提供对应本地文件。`,result.failures?'warn':'ok');
    }catch(error){
      if(token!=null && isCurrentBatchSession(token))clearImportOnError(error,token);
      else setImportStatus(`草稿箱读取失败：${error.message}`,'error');
    }finally{
      if(token!=null)finishImportSession(token);
      if(draftImportEl)draftImportEl.disabled=false;
    }
  }

  async function applyImportedDataset(dataset, label = '数据', sessionToken = batch.sessionId, options = {}) {
    if (!isCurrentBatchSession(sessionToken)) return false;
    const append = options.append !== false && !!batch.dataset;
    const previousSetCount = recordSets().length;
    const previousTaskCount = (batch.tasks||[]).length;
    batch.dataset = append ? mergeImportedDatasets(batch.dataset,dataset) : dataset;
    const importedDataset = batch.dataset;
    batch.duplicateAudit = null;
    batch.handoffComplete = false;
    batch.importMeta = importedDataset?.meta || null;
    if(!append){
      batch.collectionConfigs.clear();
      batch.taskEdits.clear();
      batch.formatGovernanceRules=[];
      batch.formatGovernanceDraftRules=[];
      batch.reviewSelected?.clear?.();
      batch.duplicateSelections?.clear?.();
      batch.reviewFilter='all';
      batch.reviewSearch='';
      batch.directoryFiles=[]; batch.routedAttachmentFiles=[]; batch.attachmentOverrides.clear(); batch.attachmentPolicies=new Map(); batch.ignoredAttachmentIdentities=new Set();
    }
    batch.reviewSurface='board';batch.reviewPreviewKey='';batch.reviewEditingKey='';
    if(batchStandardSubjectInputEl)batchStandardSubjectInputEl.value='';
    batch.attachmentAttentionShown=false;
    batch.supplementPreflightDone=false;batch.supplementPreflightOpen=false;batch.attachmentPrepChoice='pending';batch.sourceInspectName='';batch.preflightFolderPath='';batch.preflightSearch='';batch.preflightReviewOnly=false;batch.preflightPurposeFilter='';
    batch.reviewEditingKey='';
    batch.taskFiles = uniqueFiles([...(append?batch.taskFiles:[]),...(dataset?.embeddedFiles || [])]); batch.attachmentTargetEditing=''; batch.attachmentTargetSearch=''; batch.attachmentManagerOpen=false;
    for(const file of batch.taskFiles)ensureAttachmentPolicy(file,'task',{source:'随资料导入',mode:'smart'});
    batch.fileIndex = Importer.buildFileIndex(batch.taskFiles);
    dirEl.value = ''; taskFilesEl.value = '';
    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    try{await ensureOperationStore();}catch(error){console.warn(`[${APP}] duplicate history store load failed`,error);}
    const sets = recordSets();
    sets.forEach((_, index) => { if(!append || index>=previousSetCount) ensureCollectionConfig(index, { reset: true }); else ensureCollectionConfig(index); });
    syncRoutedSources();
    batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());
    const mailIndexes=sets.map((_,index)=>index).filter(index=>ensureCollectionConfig(index)?.purpose==='mail');
    const bestIndex=(mailIndexes.map(index=>({index,score:Number(Importer.detectHeader(sets[index]?.rows||[]).score||0)})).sort((a,b)=>b.score-a.score)[0]?.index)??0;
    batch.collectionIndex = bestIndex;
    configureCollection(bestIndex, false);
    renderSourceInventory();
    clearStaleOverrides();
    batch.fileIndex=Importer.buildFileIndex(allAttachmentFiles());
    batch.rosterPromptChoice=referenceRosterCount()?'added':'pending';
    batch.attachmentPrepChoice=attachmentPreparedFileCount()?'added':'pending';
    batch.attachmentPromptDeferred=false;
    if (!isCurrentBatchSession(sessionToken)) return false;
    const routedCounts=[...batch.collectionConfigs.values()].reduce((acc,config)=>{acc[config.purpose]=(acc[config.purpose]||0)+1;return acc;},{mail:0,roster:0,attachment:0,ignored:0});
    const sourceCount=importedDataset.sourceFiles?.length || 0;
    const containerCount=importedDataset.meta?.containerFiles?.length||0;
    const duplicateSourceCount=Number(importedDataset.meta?.duplicateSourceCount||0);
    $('nmda-import-format-info').textContent = `${containerCount?`已展开 ${containerCount} 个资料包 · `:''}${sourceCount?`${sourceCount} 个内容文件 · `:''}${batch.tasks.length} 封邮件${referenceRosterCount()?` · 参考名单 ${referenceRosterCount()} 条`:''}${duplicateSourceCount?` · 已忽略 ${duplicateSourceCount} 个重复副本`:''}`;
    const addedTaskCount=Math.max(0,(batch.tasks||[]).length-previousTaskCount);
    setImportStatus(routedCounts.mail
      ? `${append?`已追加到当前工作集${addedTaskCount?` · 新增 ${addedTaskCount} 封邮件`:''}`:'邮件已加入本批次'}。${duplicateSourceCount?`系统已在解析前合并 ${duplicateSourceCount} 个完全相同的重复来源。`:''}${referenceRosterCount()?'参考总名单已自动匹配当前导入邮件，后续追加邮件也会继续匹配。':'有参考总名单可现在补充；没有可直接继续。'}`
      : `当前没有识别到可创建的邮件。已打开分类核验工作区，请先确认文件用途并直接修正。`,
      routedCounts.mail?'ok':'warn');
    renderImportLifecycleState();
    batch.supplementPreflightOpen=true;renderSupplementPreflight();
    if(!routedCounts.mail||!batch.tasks.length)setBatchStatus('当前没有生成邮件任务；非邮件资料不会占用任务数或阻塞后续流程。','warn');
    else setBatchStatus(`已准备 ${batch.tasks.length} 封邮件。${(batch.tasks||[]).some(taskHasBlockingIssue)?'请在邮件审阅阶段处理待办。':'后续阶段当前可执行。'}`, 'ok');
    if(batch.tasks.length){
      if(batch.supplementPreflightDone)renderImportHandoff();
      if(!dataset?.meta?.mailboxDraftImport) scheduleMailboxAutoSync('history',{source:'import',force:true});
      else scheduleMailboxAutoSync('quick',{source:'mailbox-draft-import'});
      scheduleReadyBatchAutoHandoff('导入与核验已完成');
    }
    scheduleWorkspacePersist();
    if(reviewQueueEl) reviewQueueEl.scrollTop=0;
    return true;
  }

  function resetImportWorkspace({ keepStatus = false, invalidate = true, message = '' } = {}) {
    if (invalidate) batch.sessionId += 1;
    if(!workspaceRestoring && chrome?.storage?.local) void chrome.storage.local.remove(WORKSPACE_STORAGE_KEY).catch(()=>{});
    batch.importBusy = false;
    batch.handoffComplete = false;
    batch.autoAdvancing = false;
    batch.dataset = null;
    batch.importMeta = null;
    batch.collectionIndex = 0;
    batch.collectionConfigs.clear();
    batch.detection = null;
    batch.mapping = {};
    batch.tasks = [];
    batch.duplicateAudit = null;
    batch.directoryFiles = [];
    batch.taskFiles = [];
    batch.routedAttachmentFiles = [];
    batch.ignoredAttachmentIdentities = new Set();
    batch.attachmentManagerOpen = false;
    batch.attachmentOverrides.clear();
    batch.attachmentPolicies = new Map();
    batch.attachmentTargetEditing = '';
    batch.attachmentTargetSearch = '';
    batch.taskEdits.clear();
    batch.formatGovernanceRules=[];
    batch.formatGovernanceDraftRules=[];
    batch.reviewSelected?.clear?.();
    batch.duplicateSelections?.clear?.();
    batch.reviewFilter='all';
    batch.reviewSearch='';
    batch.reviewSurface='board';batch.reviewPreviewKey='';batch.reviewEditingKey='';
    if(batchStandardSubjectInputEl)batchStandardSubjectInputEl.value='';
    batch.attachmentAttentionShown=false;
    batch.rosterPromptChoice='idle';
    batch.attachmentPromptDeferred=false;
    batch.attachmentPrepChoice='idle';
    batch.supplementPreflightDone=false;batch.supplementPreflightOpen=false;batch.preflightView='files';batch.planningView='rules';batch.sourceInspectName='';batch.preflightFolderPath='';batch.preflightSearch='';batch.preflightReviewOnly=false;batch.preflightPurposeFilter='';
    batch.fileIndex = Importer.buildFileIndex([]);
    batch.stopRequested = false;
    batch.schedulePlan = null;
    batch.existingScheduleAnchors=[];batch.existingScheduleReadAt='';batch.existingScheduleStatus='idle';batch.existingScheduleError='';
    batch.scheduleRules = freshScheduleRules();
    batch.roster = emptyRosterState();
    batch.rosterPlanner=RosterPlanner?.createState?.()||{version:1,sourceKey:'',intents:{}};
    clearRosterPlannerSelection();
    syncScheduleRuleControls();

    batch.reviewEditingKey='';
    [importFileEl, importDirEl, rosterFileEl, dirEl, taskFilesEl].forEach(el => { if (el) el.value = ''; });
    if (pasteSourceEl) pasteSourceEl.value = '';
    const pastePanel = $('nmda-paste-panel'); if (pastePanel) pastePanel.hidden = true;

    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    const bulkTag = $('nmda-bulk-tag-value'); if (bulkTag) bulkTag.value = '';

    ['nmda-roster-audit-card','nmda-import-handoff-card','nmda-preview-card','nmda-scheduler-card'].forEach(id => {
      const el = $(id); if (el) el.hidden = true;
    });
    const inventory = $('nmda-source-inventory'); if (inventory) { inventory.hidden = true; inventory.innerHTML = ''; }
    if (reviewQueueEl) reviewQueueEl.innerHTML = '';
    if (reviewProgressEl) reviewProgressEl.textContent = '';
    if (reviewNavCountEl) { reviewNavCountEl.hidden=true; reviewNavCountEl.textContent=''; }
    if (reviewPageEmptyEl) reviewPageEmptyEl.hidden=false;
    if (reviewBatchbarEl) reviewBatchbarEl.hidden=true;
    if(schedulerCardEl){schedulerCardEl.open=true;schedulerCardEl.hidden=true;}
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent='收起';
    const trashDetails = $('nmda-review-trash'); if (trashDetails) trashDetails.open = false;
    renderReviewTrash();
    const fileInfo = $('nmda-file-index-info'); if (fileInfo) fileInfo.textContent = '尚未选择本地附件。';
    const attachmentSummary = $('nmda-attachment-summary'); if (attachmentSummary) attachmentSummary.textContent = '尚未添加附件。';
    const attachmentResolution = $('nmda-attachment-resolution'); if (attachmentResolution) attachmentResolution.hidden = true;
    const attachmentResolutionList = $('nmda-attachment-resolution-list'); if (attachmentResolutionList) attachmentResolutionList.innerHTML = '';
    const readySummary = $('nmda-import-ready-summary'); if (readySummary) readySummary.textContent = '还没有准备好邮件。';

    $('nmda-batch-empty').hidden = false;
    $('nmda-import-format-info').textContent = '可直接加入常见文档、表格和文本。';
    const rosterStatus=$('nmda-roster-source-status'); if(rosterStatus)rosterStatus.textContent='尚未载入总套磁名单。';
    const rosterRemove=$('nmda-roster-remove'); if(rosterRemove)rosterRemove.hidden=true;
    const rosterSummary=$('nmda-roster-audit-summary'); if(rosterSummary)rosterSummary.innerHTML='';
    const rosterDetails=$('nmda-roster-audit-details'); if(rosterDetails)rosterDetails.innerHTML='';
    setBatchStatus('请先添加资料并检查解析结果。');
    renderImportLifecycleState();
    if (!keepStatus) setImportStatus(message || '还没有添加资料。');
    scheduleBatchRender({aux:true});
  }

  function clearImportOnError(error, sessionToken = batch.sessionId) {
    if (!isCurrentBatchSession(sessionToken)) return;
    console.error(`[${APP}] import`, error);
    if(!batch.importAppendMode) resetImportWorkspace({ keepStatus: true, invalidate: true });
    else {
      batch.importBusy=false;
      renderImportLifecycleState();
      scheduleBatchRender({aux:true,force:true});
    }
    setImportStatus(`${batch.importAppendMode?'追加失败，原工作集已保留':'读取失败'}：${error.message}`, 'error');
  }


  async function readDroppedEntry(entry, path = '') {
    if (!entry) return [];
    if (entry.isFile) {
      const file = await new Promise((resolve,reject)=>entry.file(resolve,reject));
      try { Object.defineProperty(file,'_nmdaPath',{value:`${path}${file.name}`,configurable:true}); } catch (_) { try { file._nmdaPath=`${path}${file.name}`; } catch (_) {} }
      return [file];
    }
    if (!entry.isDirectory) return [];
    const reader=entry.createReader(); const entries=[];
    while(true){
      const batchEntries=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
      if(!batchEntries.length)break; entries.push(...batchEntries);
    }
    const nested=[];
    for(const child of entries)nested.push(...await readDroppedEntry(child,`${path}${entry.name}/`));
    return nested;
  }

  async function filesFromDrop(dataTransfer) {
    const items=[...(dataTransfer?.items||[])]; const out=[];
    if(items.length){
      for(const item of items){
        const entry=item.webkitGetAsEntry?.();
        if(entry){ out.push(...await readDroppedEntry(entry,'')); continue; }
        const file=item.getAsFile?.(); if(file)out.push(file);
      }
    } else out.push(...[...(dataTransfer?.files||[])]);
    return uniqueFiles(out);
  }

  async function importDroppedFiles(files) {
    if(!files.length||!Importer)return;
    const hasFolders=files.some(file=>String(file?._nmdaPath||file?.webkitRelativePath||'').includes('/'));
    const token=beginImportSession(`正在读取拖入的 ${files.length} 个文件…`);
    try{
      const dataset=hasFolders?await Importer.parseDirectory(files):await Importer.parseFiles(files);
      if(!isCurrentBatchSession(token))return;
      await applyImportedDataset(dataset,hasFolders?`拖入文件夹（${files.length} 个文件）`:`拖入文件（${files.length} 个）`,token);
    }catch(error){clearImportOnError(error,token);}
    finally{finishImportSession(token);}
  }

  const importDropZone=$('nmda-import-drop-zone');
  importDropZone?.addEventListener('click',()=>{if(!batch.importBusy)importFileEl?.click();});
  importDropZone?.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!batch.importBusy){event.preventDefault();importFileEl?.click();}});
  importDropZone?.addEventListener('dragenter',event=>{event.preventDefault();importDropZone.classList.add('is-dragging');});
  importDropZone?.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';importDropZone.classList.add('is-dragging');});
  importDropZone?.addEventListener('dragleave',event=>{if(!importDropZone.contains(event.relatedTarget))importDropZone.classList.remove('is-dragging');});
  importDropZone?.addEventListener('drop',async event=>{event.preventDefault();importDropZone.classList.remove('is-dragging');if(batch.importBusy)return;const files=await filesFromDrop(event.dataTransfer);if(!files.length){setImportStatus('没有识别到可导入的文件。','warn');return;}await importDroppedFiles(files);});

  importFileEl.addEventListener('change', async () => {
    const files = [...(importFileEl.files || [])];
    if (!files.length || !Importer) return;
    const token = beginImportSession(`正在读取 ${files.length === 1 ? files[0].name : `${files.length} 个文件`}…`);
    try {
      const dataset = await Importer.parseFiles(files);
      if (!isCurrentBatchSession(token)) return;
      await applyImportedDataset(dataset, files.length === 1 ? files[0].name : `${files.length} 个文件`, token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); if (importFileEl) importFileEl.value = ''; }
  });

  importDirEl?.addEventListener('change', async () => {
    const files = [...(importDirEl.files || [])];
    if (!files.length || !Importer) return;
    const token = beginImportSession(`正在扫描文件夹（${files.length} 个文件）…`);
    try {
      const dataset = await Importer.parseDirectory(files);
      if (!isCurrentBatchSession(token)) return;
      await applyImportedDataset(dataset, `文件夹（${dataset.sourceFiles?.length || 0} 个可读取文件）`, token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); if (importDirEl) importDirEl.value = ''; }
  });


  rosterFileEl?.addEventListener('change', async () => {
    const files=[...(rosterFileEl.files||[])];
    if(files.length)await loadRosterFiles(files);
  });
  $('nmda-roster-remove')?.addEventListener('click', removeRoster);
  $('nmda-open-supplement-preflight')?.addEventListener('click',()=>openSupplementPreflight('files'));
  $('nmda-edit-batch-prep')?.addEventListener('click',()=>openSupplementPreflight('support'));
  $('nmda-close-supplement-preflight')?.addEventListener('click',()=>{batch.supplementPreflightOpen=false;renderSupplementPreflight();setImportStatus('已返回上传区。','ok');});
  $('nmda-preflight-source-search')?.addEventListener('input',event=>{batch.preflightSearch=String(event.target.value||'');renderPreflightSourceRoles();});
  $('nmda-source-inspector-close')?.addEventListener('click',()=>{batch.sourceInspectName='';renderPreflightSourceRoles();});
  ui.querySelectorAll('[data-preflight-view]').forEach(button=>button.addEventListener('click',()=>setPreflightView(button.dataset.preflightView)));
  ui.querySelectorAll('button[data-support-view]').forEach(button=>button.addEventListener('click',()=>setSupportView(button.dataset.supportView)));
  ui.querySelectorAll('[data-planning-view]').forEach(button=>button.addEventListener('click',()=>setPlanningView(button.dataset.planningView)));
  $('nmda-open-schedule-modal')?.addEventListener('click',openScheduleModal);
  $('nmda-schedule-open-priority')?.addEventListener('click',()=>openRosterPlannerView({returnToSchedule:true}));
  $('nmda-roster-planner-back')?.addEventListener('click',()=>closeRosterPlannerView());
  $('nmda-roster-planner-done')?.addEventListener('click',()=>closeRosterPlannerView());
  rosterPlannerSourceEl?.addEventListener('change',()=>{batch.rosterPlanner=RosterPlanner?.createState?.(batch.rosterPlanner)||batch.rosterPlanner;batch.rosterPlanner.sourceKey=String(rosterPlannerSourceEl.value||'');rosterPlannerSelection=null;rosterPlannerSelectedRows=null;rosterPlannerSelectionKind='';rosterPlannerSelectionMeta='';rosterPlannerFeatureKey='';rosterPlannerAnchor=null;scheduleWorkspacePersist();renderRosterPlanner();});
  rosterColumnToggleEl?.addEventListener('click',()=>{batch.rosterPlanner=RosterPlanner?.createState?.(batch.rosterPlanner)||batch.rosterPlanner;batch.rosterPlanner.showIrrelevantColumns=!batch.rosterPlanner.showIrrelevantColumns;rosterPlannerSelection=null;rosterPlannerSelectedRows=null;rosterPlannerSelectionKind='';rosterPlannerSelectionMeta='';rosterPlannerFeatureKey='';rosterPlannerAnchor=null;scheduleWorkspacePersist();renderRosterPlanner();});
  rosterVisualGroupsEl?.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-roster-feature-index]');if(!button)return;const current=rosterPlannerCurrentSource();if(!current)return;
    const entries=rosterPlannerEntriesForSet(current.set),groups=rosterPlannerFeatureGroups(current.set,entries),group=groups[Number(button.dataset.rosterFeatureIndex)];if(!group)return;
    rosterPlannerSelection=null;rosterPlannerAnchor=null;rosterPlannerDragging=false;rosterPlannerSelectedRows=new Set(group.rows||[]);rosterPlannerSelectionKind='feature';rosterPlannerSelectionMeta=`${group.label||'特征'}选择`;rosterPlannerFeatureKey=group.key||'';renderRosterPlanner();
    const first=group.rows?.[0];if(Number.isFinite(first))rosterSheetTableEl?.querySelector?.(`[data-row="${first}"]`)?.scrollIntoView?.({block:'nearest',inline:'nearest'});
  });
  rosterIntentSummaryEl?.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-roster-batch-focus]');if(!button)return;const current=rosterPlannerCurrentSource();if(!current)return;
    const value=String(button.dataset.rosterBatchFocus||''),entries=rosterPlannerEntriesForSet(current.set);
    const targets=value==='__unassigned__'?entries.filter(entry=>!rosterPlannerEffectiveBatch(entry)&&!String(entry?.scheduleAt||'').trim()):value==='__fixed__'?entries.filter(entry=>!rosterPlannerEffectiveBatch(entry)&&!!String(entry?.scheduleAt||'').trim()):entries.filter(entry=>rosterPlannerEffectiveBatch(entry)===value);
    if(value!=='__unassigned__'&&value!=='__fixed__'){const setRound=RosterPlanner?.setActivePriorityRound||RosterPlanner?.setActiveBatch;batch.rosterPlanner=setRound?.(batch.rosterPlanner,value)||batch.rosterPlanner;}
    rosterPlannerSelection=null;rosterPlannerAnchor=null;rosterPlannerDragging=false;rosterPlannerSelectedRows=new Set(targets.map(entry=>Math.max(0,Number(entry?.sourceRow||0)-1)));rosterPlannerSelectionKind=value==='__unassigned__'?'unassigned':value==='__fixed__'?'fixed':'batch';rosterPlannerSelectionMeta=value.startsWith('__')?'':value;rosterPlannerFeatureKey='';scheduleWorkspacePersist();renderRosterPlanner();
    const first=targets[0]&&Math.max(0,Number(targets[0]?.sourceRow||0)-1);if(Number.isFinite(first))rosterSheetTableEl?.querySelector?.(`[data-row="${first}"]`)?.scrollIntoView?.({block:'nearest',inline:'nearest'});
  });
  rosterBatchCreateEl?.addEventListener('click',createRosterPlannerBatch);
  rosterBatchAddEl?.addEventListener('click',()=>applyRosterPlannerBatch(rosterPlannerActiveBatch()));
  rosterBatchClearEl?.addEventListener('click',()=>applyRosterPlannerBatch('',{clear:true}));
  rosterSheetTableEl?.addEventListener('pointerdown',event=>{const cell=event.target.closest?.('[data-roster-cell]');if(!cell||event.button!==0)return;event.preventDefault();rosterPlannerSelectedRows=null;rosterPlannerSelectionKind='box';rosterPlannerSelectionMeta='';rosterPlannerFeatureKey='';const point={r:Number(cell.dataset.row),c:Number(cell.dataset.col)};if(event.shiftKey&&rosterPlannerAnchor){rosterPlannerSelection={r1:rosterPlannerAnchor.r,c1:rosterPlannerAnchor.c,r2:point.r,c2:point.c};}else{rosterPlannerAnchor=point;rosterPlannerSelection={r1:point.r,c1:point.c,r2:point.r,c2:point.c};}rosterPlannerDragging=true;paintRosterPlannerSelection();});
  rosterSheetTableEl?.addEventListener('pointerover',event=>{if(!rosterPlannerDragging||!rosterPlannerAnchor)return;const cell=event.target.closest?.('[data-roster-cell]');if(!cell)return;rosterPlannerSelection={r1:rosterPlannerAnchor.r,c1:rosterPlannerAnchor.c,r2:Number(cell.dataset.row),c2:Number(cell.dataset.col)};paintRosterPlannerSelection();});
  rosterSheetViewportEl?.addEventListener('pointermove',event=>{if(!rosterPlannerDragging||!rosterPlannerAnchor)return;const hit=document.elementFromPoint?.(event.clientX,event.clientY)?.closest?.('[data-roster-cell]');if(!hit||!rosterSheetTableEl?.contains(hit))return;rosterPlannerSelection={r1:rosterPlannerAnchor.r,c1:rosterPlannerAnchor.c,r2:Number(hit.dataset.row),c2:Number(hit.dataset.col)};paintRosterPlannerSelection();});
  document.addEventListener('pointerup',()=>{rosterPlannerDragging=false;});
  $('nmda-close-schedule-modal')?.addEventListener('click',()=>closeScheduleModal());
  $('nmda-cancel-schedule-modal')?.addEventListener('click',()=>closeScheduleModal());
  $('nmda-schedule-modal')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closeScheduleModal();});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!$('nmda-schedule-modal')?.hidden){event.preventDefault();closeScheduleModal();return;}
    if(batch?.rosterPlannerOpen){event.preventDefault();closeRosterPlannerView();}
  });

  $('nmda-source-next-review')?.addEventListener('click',event=>{const source=decodeURIComponent(event.currentTarget.dataset.nextSource||'');if(source)inspectSourceInPreflight(source);});
  $('nmda-preflight-dropzones')?.querySelectorAll('[data-drop-purpose]').forEach(zone=>{
    zone.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';zone.classList.add('is-over');});
    zone.addEventListener('dragleave',event=>{if(!zone.contains(event.relatedTarget))zone.classList.remove('is-over');});
    zone.addEventListener('drop',event=>{event.preventDefault();zone.classList.remove('is-over');document.querySelector('.nmda-classify-dialog')?.classList.remove('is-drag-classifying');const source=event.dataTransfer?.getData('text/plain')||batch.sourceInspectName;if(!source)return;const purpose=zone.dataset.dropPurpose||'';if(purpose==='review')setSourceNeedsReview(source);else setSourcePurpose(source,purpose);});
  });
  $('nmda-preflight-roster-skip')?.addEventListener('click',()=>{batch.rosterPromptChoice='skipped';renderImportLifecycleState();renderSupplementPreflight();});
  $('nmda-preflight-attachment-skip')?.addEventListener('click',()=>{batch.attachmentPrepChoice='skipped';renderImportLifecycleState();renderSupplementPreflight();});
  $('nmda-complete-supplement-preflight')?.addEventListener('click',completeSupplementPreflight);
  $('nmda-roster-skip')?.addEventListener('click',()=>{
    batch.rosterPromptChoice='skipped';
    renderImportLifecycleState();
    scheduleBatchRender({aux:true,force:true});
    setImportStatus('已跳过参考总名单。','ok');
    renderSupplementPreflight();
    if(batch.supplementPreflightDone)renderImportHandoff();
  });
  $('nmda-attachment-later')?.addEventListener('click',()=>{
    batch.attachmentPromptDeferred=true;
    setImportStatus('附件检查已保留；可先处理邮件内容。','ok');
  });
  $('nmda-roster-enabled')?.addEventListener('change', e => {
    rosterState().enabled=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });
  $('nmda-roster-auto-school')?.addEventListener('change', e => {
    rosterState().autoSchool=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });
  $('nmda-roster-strict')?.addEventListener('change', e => {
    rosterState().strict=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });

  $('nmda-show-paste')?.addEventListener('click', () => {
    const panel = $('nmda-paste-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) pasteSourceEl?.focus();
  });

  $('nmda-paste-import')?.addEventListener('click', async () => {
    const text = String(pasteSourceEl?.value || '').trim();
    if (!text) { setImportStatus('请先粘贴需要导入的内容。', 'warn'); return; }
    const token = beginImportSession('正在读取粘贴内容…');
    try {
      const file = new File([text], `pasted-${Date.now()}.txt`, { type:'text/plain;charset=utf-8', lastModified:Date.now() });
      const dataset = await Importer.parseFile(file);
      if (!isCurrentBatchSession(token)) return;
      dataset.meta = { ...(dataset.meta || {}), pasted:true };
      await applyImportedDataset(dataset, '粘贴内容', token);
    } catch (error) { clearImportOnError(error, token); }
    finally { finishImportSession(token); }
  });

  draftImportEl?.addEventListener('click',()=>void importMailboxDrafts());

  $('nmda-reset-import')?.addEventListener('click', () => {
    if (batch.running) { setImportStatus('正在创建草稿，暂时不能开始新批次。', 'warn'); return; }
    resetImportWorkspace({ message: '当前批次已彻底清空，可以载入新的来源。' });
  });


  $('nmda-go-batch')?.addEventListener('click',()=>void openReviewWorkspace({pendingOnly:false,fromImport:true}));
  $('nmda-review-go-dispatch')?.addEventListener('click',()=>void (async()=>{
    const ready=await enterSelectionAndSchedule('邮件审阅已完成');
    if(!ready)return;
    setWorkbenchTab('dispatch');history.replaceState(null,'','#dispatch');scheduleBatchRender({aux:false,force:true});
  })());
  $('nmda-review-next-pending')?.addEventListener('click',event=>{
    if(event.currentTarget?.dataset?.mode==='dispatch'){void (async()=>{const ready=await enterSelectionAndSchedule('邮件审阅已完成');if(!ready)return;setWorkbenchTab('dispatch');history.replaceState(null,'','#dispatch');scheduleBatchRender({aux:false,force:true});})();return;}
    openNextReviewTask();
  });
  $('nmda-review-preview-back')?.addEventListener('click',closeReviewPreview);
  ui.querySelectorAll('[data-review-filter]').forEach(button=>button.addEventListener('click',()=>{
    if(batch.reviewEditingKey){setImportStatus('请先保存或取消当前邮件的编辑，再切换筛选。','warn');return;}
    batch.reviewFilter=['all','auto','pending','confirmed'].includes(button.dataset.reviewFilter)?button.dataset.reviewFilter:'all';
    viewPerf.reviewRenderLimit=REVIEW_RENDER_CHUNK;
    if(reviewQueueEl)reviewQueueEl.scrollTop=0;
    setReviewSurface('board');batch.reviewPreviewKey='';
    renderReviewPageOverview();
  }));
  $('nmda-review-select-filtered')?.addEventListener('click',selectVisibleReviewTasks);
  batchStandardSubjectInputEl?.addEventListener('input',()=>{renderBatchSubjectGovernance();syncBatchProcessingApply();});
  batchStandardSubjectSuggestionEl?.addEventListener('click',()=>{const suggestion=suggestedBulkSubject();if(!suggestion)return;if(batchStandardSubjectInputEl)batchStandardSubjectInputEl.value=suggestion;renderBatchSubjectGovernance();batchStandardSubjectInputEl?.focus?.({preventScroll:true});});
  batchFollowUpTemplateEl?.addEventListener('input',()=>{
    const saved=String((operationState.store?.followUpPolicies?.default||Operations.DEFAULT_FOLLOWUP_POLICY)?.templateBody||'').replace(/\r\n?/g,'\n').trim();
    batchFollowUpTemplateEl.dataset.dirty=String(batchFollowUpTemplateEl.value||'').replace(/\r\n?/g,'\n').trim()===saved?'0':'1';
    renderBatchFollowUpTemplate();syncBatchProcessingApply();syncFormatGovernancePreviewBadge(formatGovernanceSuggestionsEl?._nmdaSuggestions||[]);
  });
  batchFollowUpSyncEl?.addEventListener('change',()=>{renderBatchFollowUpTemplate();syncBatchProcessingApply();});
  formatGovernanceEntryEl?.addEventListener('click',()=>{if(batch.reviewSurface!=='preview')return;if(batch.reviewEditingKey){setImportStatus('请先保存或取消当前邮件的编辑，再打开批量处理。','warn');return;}if(formatGovernanceEl?.hidden)openFormatGovernance();else closeFormatGovernance();});
  $('nmda-format-governance-close')?.addEventListener('click',closeFormatGovernance);
  formatGovernancePhraseEl?.addEventListener('input',scheduleFormatGovernancePreview);
  formatGovernanceCaseEl?.addEventListener('change',scheduleFormatGovernancePreview);
  ui.querySelectorAll('[data-governance-format]').forEach(button=>button.addEventListener('click',()=>{
    const active=button.getAttribute('aria-pressed')==='true';button.setAttribute('aria-pressed',active?'false':'true');button.classList.toggle('is-active',!active);scheduleFormatGovernancePreview();
  }));
  formatGovernanceAddEl?.addEventListener('click',()=>{
    const rule=currentGovernanceRule(),analysis=validFormatGovernanceAnalysis();if(!analysis?.changeTasks)return;
    if(addGovernanceRuleToQueue(rule)){
      renderFormatDriftSuggestions();renderFormatGovernanceQueue();syncFormatGovernanceAddButton(analysis);syncBatchProcessingApply();
    }
  });
  formatGovernanceSuggestionsEl?.addEventListener('click',event=>{
    const suggestions=formatGovernanceSuggestionsEl._nmdaSuggestions||[];
    if(event.target.closest?.('[data-governance-add-all]')){
      const next=[...queuedGovernanceRules()];for(const suggestion of suggestions){const rule={phrase:suggestion.phrase,formats:[suggestion.format],caseSensitive:true};if(!next.some(item=>governanceRuleKey(item)===governanceRuleKey(rule)))next.push(rule);}setQueuedGovernanceRules(next);renderFormatDriftSuggestions();renderFormatGovernanceQueue();syncFormatGovernanceAddButton(validFormatGovernanceAnalysis());syncBatchProcessingApply();return;
    }
    if(event.target.closest?.('[data-governance-clear-suggestions]')){
      const suggestionKeys=new Set(suggestions.map(item=>governanceRuleKey({phrase:item.phrase,formats:[item.format],caseSensitive:true})));
      setQueuedGovernanceRules(queuedGovernanceRules().filter(rule=>!suggestionKeys.has(governanceRuleKey(rule))));renderFormatDriftSuggestions();renderFormatGovernanceQueue();syncFormatGovernanceAddButton(validFormatGovernanceAnalysis());syncBatchProcessingApply();return;
    }
    const button=event.target.closest?.('[data-governance-suggestion]');if(!button)return;const suggestion=suggestions[Number(button.dataset.governanceSuggestion)];if(!suggestion)return;
    const rule={phrase:suggestion.phrase,formats:[suggestion.format],caseSensitive:true};toggleGovernanceRuleInQueue(rule);renderFormatDriftSuggestions();renderFormatGovernanceQueue();syncBatchProcessingApply();
  });
  formatGovernanceQueueEl?.addEventListener('click',event=>{
    if(event.target.closest?.('[data-governance-queue-clear]')){setQueuedGovernanceRules([]);renderFormatDriftSuggestions();renderFormatGovernanceQueue();syncFormatGovernanceAddButton(validFormatGovernanceAnalysis());syncBatchProcessingApply();return;}
    const remove=event.target.closest?.('[data-governance-queue-remove]');if(remove){const rules=queuedGovernanceRules(),index=Number(remove.dataset.governanceQueueRemove);if(Number.isInteger(index)&&rules[index]){rules.splice(index,1);setQueuedGovernanceRules(rules);renderFormatDriftSuggestions();renderFormatGovernanceQueue();syncFormatGovernanceAddButton(validFormatGovernanceAnalysis());syncBatchProcessingApply();}return;}
    const chip=event.target.closest?.('[data-governance-queue-rule]');if(!chip)return;const rule=queuedGovernanceRules()[Number(chip.dataset.governanceQueueRule)];if(!rule)return;const custom=$('nmda-format-governance-custom');if(custom)custom.open=true;loadGovernanceRuleIntoEditor(rule);
  });
  formatGovernanceHistoryEl?.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-governance-history]');if(!button)return;const rule=(batch.formatGovernanceRules||[]).find(item=>item.id===button.dataset.governanceHistory);if(!rule)return;
    const custom=$('nmda-format-governance-custom');if(custom)custom.open=true;loadGovernanceRuleIntoEditor(rule);syncBatchProcessingApply();
  });
  formatGovernanceApplyEl?.addEventListener('click',()=>{void applyBatchProcessing();});

  $('nmda-review-clear-selected')?.addEventListener('click',()=>{batch.reviewSelected.clear();renderReviewQueue(batch.reviewPreviewKey||'');renderReviewBatchActions();});
  $('nmda-review-confirm-selected')?.addEventListener('click',confirmSelectedReviewTasks);
  duplicateCandidatesEl?.addEventListener('change',event=>{
    const input=event.target?.closest?.('[data-duplicate-pick]');if(!input)return;
    const groupId=duplicateDecisionEl?.dataset.groupId||'';
    const selected=[...duplicateCandidatesEl.querySelectorAll('input[data-duplicate-pick]:checked')].map(item=>item.dataset.duplicatePick).filter(Boolean);
    if(groupId&&batch.duplicateSelections instanceof Map)batch.duplicateSelections.set(groupId,selected);
    duplicateCandidatesEl.querySelectorAll('[data-duplicate-row]').forEach(row=>row.classList.toggle('is-selected',selected.includes(row.dataset.duplicateRow)));
    if(duplicateKeepSelectedEl)duplicateKeepSelectedEl.textContent=`保留所选（${selected.length}）`;
    if(duplicateDecisionHintEl)duplicateDecisionHintEl.textContent=selected.length?'未勾选的邮件将在确认后排除。':'至少保留一封；当前尚未选择任何邮件。';
  });
  $('nmda-duplicate-keep-selected')?.addEventListener('click',()=>void keepSelectedDuplicateCandidate());
  $('nmda-duplicate-keep-all')?.addEventListener('click',()=>void keepAllDuplicateCandidates());
  draftHistoryListEl?.addEventListener('change',event=>{
    if(!event.target?.closest?.('[data-draft-history-pick]'))return;
    const selected=[...(draftHistoryListEl.querySelectorAll('input[data-draft-history-pick]:checked')||[])].length;
    if(draftHistoryExcludeEl)draftHistoryExcludeEl.textContent=`筛除所选（${selected}）`;
    if(draftHistoryKeepEl)draftHistoryKeepEl.textContent=`仍保留所选（${selected}）`;
    if(draftHistoryHintEl)draftHistoryHintEl.textContent=selected?'所选任务只按“已有 Draft”事实处理，不进行正文版本比较。':'至少选择一封需要处理的命中邮件。';
  });
  draftHistoryExcludeEl?.addEventListener('click',()=>{
    const selected=new Set([...(draftHistoryListEl?.querySelectorAll('input[data-draft-history-pick]:checked')||[])].map(input=>input.dataset.draftHistoryPick).filter(Boolean));
    if(!selected.size){if(draftHistoryHintEl)draftHistoryHintEl.textContent='至少选择一封需要筛除的邮件。';return;}
    const hits=unresolvedDraftHistoryHits();let changed=0;
    for(const hit of hits){
      if(!selected.has(hit.task.editKey))continue;
      setTaskEdit(hit.task,{importExcluded:true,draftHistoryDecision:'exclude',draftHistoryDecisionKey:hit.key});changed++;
    }
    finishImportDuplicateDecision(`已筛除 ${changed} 封命中已有草稿的新 Initial Task`);
  });
  draftHistoryKeepEl?.addEventListener('click',()=>{
    const selected=new Set([...(draftHistoryListEl?.querySelectorAll('input[data-draft-history-pick]:checked')||[])].map(input=>input.dataset.draftHistoryPick).filter(Boolean));
    if(!selected.size){if(draftHistoryHintEl)draftHistoryHintEl.textContent='至少选择一封需要保留的邮件。';return;}
    const hits=unresolvedDraftHistoryHits();let changed=0;
    for(const hit of hits){
      if(!selected.has(hit.task.editKey))continue;
      setTaskEdit(hit.task,{draftHistoryDecision:'keep',draftHistoryDecisionKey:hit.key,importExcluded:false});changed++;
    }
    finishImportDuplicateDecision(`已明确保留 ${changed} 封命中已有草稿的新邮件`);
  });
  $('nmda-dedupe-refresh-mailbox')?.addEventListener('click',()=>void (async()=>{
    const button=$('nmda-dedupe-refresh-mailbox');if(button)button.disabled=true;
    try{
      setImportStatus('正在重新核验邮箱历史，用于核对已有草稿和已发送记录…');
      const result=await requestAutoMailboxSync('history',{source:'manual-dedupe',force:true});
      renderRosterAudit();renderProcessGuide();
      const pending=unresolvedDuplicateGroupCount();
      setImportStatus(`邮箱历史已更新${result?`：已发送 ${result.outboundRead||0} · 草稿 ${result.draftsRead||0}`:''}${pending?`；还有 ${pending} 项查重待处理。`:'；当前查重已完成。'}`,pending?'warn':'ok');
    }catch(error){setImportStatus(`邮箱历史读取失败：${error.message}`,'error');}
    finally{if(button)button.disabled=false;}
  })());
  schedulerCardEl?.addEventListener('toggle',()=>{if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent=schedulerCardEl.open?'收起':'展开';});
  $('nmda-review-trash-list')?.addEventListener('click', event => {
    const button=event.target?.closest?.('[data-restore-excluded]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();
    restoreExcludedTask(button.dataset.restoreExcluded||'');
  });
  $('nmda-review-trash-restore-all')?.addEventListener('click', event => {
    event.preventDefault();event.stopPropagation();
    restoreAllExcludedTasks();
  });
  document.addEventListener('click', event => {
    const trash=$('nmda-review-trash');
    if(trash?.open && !trash.contains(event.target))trash.open=false;
  });
  document.addEventListener('keydown', event => {
    if(event.key!=='Escape')return;
    const trash=$('nmda-review-trash');
    if(trash?.open){trash.open=false;event.preventDefault();}
  });

  dirEl?.addEventListener('change', () => {
    const files=uniqueFiles([...(dirEl.files||[])]);for(const file of files)batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.directoryFiles=uniqueFiles([...(batch.directoryFiles||[]),...files]);for(const file of files)ensureAttachmentPolicy(file,'directory',{source:'选择文件夹',mode:'smart'});
    batch.attachmentPrepChoice='added';dirEl.value='';refreshFileIndex(false);renderSupplementPreflight();
  });
  preSendMatchFilesEl?.addEventListener('change',()=>{const files=[...(preSendMatchFilesEl.files||[])];preSendMatchFilesEl.value='';addAttachmentFiles(files,{source:'发送前添加',mode:'smart'});});
  preSendSharedFilesEl?.addEventListener('change',()=>{const files=[...(preSendSharedFilesEl.files||[])];preSendSharedFilesEl.value='';addAttachmentFiles(files,{source:'发送前添加'});});
  taskFilesEl?.addEventListener('change',()=>{const files=[...(taskFilesEl.files||[])];taskFilesEl.value='';const count=addAttachmentFiles(files,{source:'选择文件'});if(count)setBatchStatus(`已加入 ${count} 个附件；请在附件工作台确认适用范围。`,'ok');});

  const attachmentManagerDrop=$('nmda-attachment-manager-drop');
  attachmentManagerDrop?.addEventListener('click',()=>taskFilesEl?.click());
  attachmentManagerDrop?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();taskFilesEl?.click();}});
  attachmentManagerDrop?.addEventListener('dragenter',event=>{event.preventDefault();attachmentManagerDrop.classList.add('is-dragging');});
  attachmentManagerDrop?.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';attachmentManagerDrop.classList.add('is-dragging');});
  attachmentManagerDrop?.addEventListener('dragleave',event=>{if(!attachmentManagerDrop.contains(event.relatedTarget))attachmentManagerDrop.classList.remove('is-dragging');});
  attachmentManagerDrop?.addEventListener('drop',async event=>{
    event.preventDefault();attachmentManagerDrop.classList.remove('is-dragging');
    const files=await filesFromDrop(event.dataTransfer);if(!files.length)return;
    const folder=files.some(file=>String(file?._nmdaPath||file?.webkitRelativePath||'').includes('/'));
    const count=addAttachmentFiles(files,{source:folder?'拖入文件夹':'拖入文件',mode:folder?'smart':''});
    if(count)setBatchStatus(`已拖入 ${count} 个附件；发送范围已按业务场景给出默认配置，可在工作台逐项调整。`,'ok');
  });

  $('nmda-manager-clear-attachments')?.addEventListener('click',clearAttachmentAssets);
  $('nmda-close-attachment-manager')?.addEventListener('click',closeAttachmentManager);
  $('nmda-attachment-manager-done')?.addEventListener('click',closeAttachmentManager);
  $('nmda-manage-attachments-strip')?.addEventListener('click',openAttachmentManager);
  $('nmda-manage-attachments-todo')?.addEventListener('click',openAttachmentManager);
  $('nmda-manage-attachments-workflow')?.addEventListener('click',openAttachmentManager);
  $('nmda-attachment-target-close')?.addEventListener('click',()=>{batch.attachmentTargetEditing='';batch.attachmentTargetSearch='';renderAttachmentAssetViews();});
  $('nmda-attachment-target-search')?.addEventListener('input',event=>{batch.attachmentTargetSearch=event.target.value||'';renderAttachmentTargetEditor();});
  $('nmda-attachment-target-all')?.addEventListener('click',()=>{
    const id=batch.attachmentTargetEditing,file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===id);if(!file)return;
    const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));const q=normalizedSearchText(batch.attachmentTargetSearch||'');
    const targets=new Set(policy.targets||[]);for(const task of batch.tasks||[])if(!q||normalizedSearchText([task.recipients,task.subject,task.school].join(' ')).includes(q))targets.add(task.editKey);
    policy.mode='selected';policy.targets=[...targets];batch.attachmentPolicies.set(id,policy);rebuildTasks();renderAttachmentAssetViews();
  });
  $('nmda-attachment-target-clear')?.addEventListener('click',()=>{
    const id=batch.attachmentTargetEditing,file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===id);if(!file)return;
    const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));policy.mode='selected';policy.targets=[];batch.attachmentPolicies.set(id,policy);rebuildTasks();renderAttachmentAssetViews();
  });
  $('nmda-attachment-manager-overlay')?.addEventListener('click',event=>{if(event.target===$('nmda-attachment-manager-overlay'))closeAttachmentManager();});
  ui.addEventListener('click',event=>{
    const remove=event.target.closest?.('[data-attachment-remove]');if(remove){removeAttachmentAsset(decodeURIComponent(remove.dataset.attachmentRemove||''));return;}
    if(event.target.closest?.('[data-open-attachment-manager]'))openAttachmentManager();
  });

  $('nmda-template').addEventListener('click', () => {
    const csv = '\ufeff编号,收件人,学校,主题,正文,附件,定时时间,任务标记\r\n001,professor@example.edu,示例大学,示例主题,这是示例正文,该封材料.pdf,2026-08-25 09:30,第一批;重点\r\n002,professor2@example.edu,示例大学,示例主题2,这是示例正文2,,,第二批\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  scheduleApplyEl?.addEventListener('click', () => {
    void (async()=>{
      const motionState=captureSchedulePlanMotionState();
      const ok=await applySmartSchedule();
      if(!ok)return;
      closeScheduleModal({restoreFocus:false});
      if(batch.rosterPlannerOpen)closeRosterPlannerView({restoreFocus:false});
      renderAppliedScheduleWithMotion(motionState,batch.schedulePlan);
      requestAnimationFrame(()=>$('nmda-open-schedule-modal')?.focus?.({preventScroll:true}));
    })();
  });
  scheduleClearEl?.addEventListener('click',()=>void clearAutoSchedule());
  [scheduleStartDateEl,scheduleLocalTimeEl,scheduleTimeZoneEl,scheduleSkipStartEl,scheduleSkipEndEl,scheduleMaxSchoolEl,schedulePreserveEl,scheduleMailboxExistingEl,scheduleHolidayEl,...scheduleWeekdayEls].forEach(el=>el?.addEventListener('change',()=>{readScheduleRuleControls();batch.schedulePlan=null;renderScheduleCenter();}));
  syncScheduleRuleControls();

  const renderBatchFilterDebounced=debounce(()=>scheduleBatchRender({aux:false}),100);
  [batchSearchEl,batchTagIncludeEl].forEach(el=>el?.addEventListener('input',renderBatchFilterDebounced));

  async function bulkEditFiltered(kind) {
    const targets = filteredBatchTasks().filter(task => task.status !== 'running' && task.status !== 'done');
    if (!targets.length) { setBatchStatus('当前检索/筛选结果没有可编辑任务。', 'warn'); return; }
    const tagValue = $('nmda-bulk-tag-value').value;
    const parsed = parseTaskClassifications(tagValue);
    if ((kind === 'addTag' || kind === 'removeTag') && !parsed.length) {
      setBatchStatus('请输入有效的任务标记。系统状态和 Follow-up 状态不能作为任务标记。', 'warn'); return;
    }
    let affected = 0, blockedSkipped = 0, followUpTagSkipped = 0;
    for (const task of targets) {
      if (kind === 'enable') {
        if (task.policyBlocked) { blockedSkipped++; continue; }
        await updateDispatchTask(task, { enabled: true }); affected++;
      }
      else if (kind === 'disable') { await updateDispatchTask(task, { enabled: false }); affected++; }
      else if (task.dispatchKind === 'follow_up') { followUpTagSkipped++; }
      else if (kind === 'addTag') { setTaskEdit(task, { tags: Operations.mergeTags(task.tags || [], parsed) }); affected++; }
      else if (kind === 'removeTag') {
        const remove = new Set(parsed.map(tag => tag.toLocaleLowerCase('zh-CN')));
        setTaskEdit(task, { tags: parseTaskClassifications(task.tags || []).filter(tag => !remove.has(tag.toLocaleLowerCase('zh-CN'))) }); affected++;
      }
    }
    const actionText = { enable: '纳入筛选结果', disable: '排除筛选结果', addTag: `添加标记“${tagsText(parsed)}”`, removeTag: `移除标记“${tagsText(parsed)}”` }[kind];
    const skippedText = [blockedSkipped ? `${blockedSkipped} 封受联系保护规则拦截` : '', followUpTagSkipped ? `${followUpTagSkipped} 条 Follow-up 不使用批次标记` : ''].filter(Boolean);
    setBatchStatus(`已对 ${affected} 封任务执行：${actionText}${skippedText.length ? `；跳过 ${skippedText.join('、')}` : ''}。`, skippedText.length ? 'warn' : 'ok');
    scheduleBatchRender({aux:false,force:true});
  }

  $('nmda-bulk-add-tag').addEventListener('click', () => { void bulkEditFiltered('addTag'); });
  $('nmda-bulk-remove-tag').addEventListener('click', () => { void bulkEditFiltered('removeTag'); });
  $('nmda-bulk-enable').addEventListener('click', () => { void bulkEditFiltered('enable'); });
  $('nmda-bulk-disable').addEventListener('click', () => { void bulkEditFiltered('disable'); });
  $('nmda-clear-selection').addEventListener('click', () => { void (async()=>{
    let affected = 0;
    for (const task of dispatchTasks()) {
      if (task.status === 'running' || task.status === 'done' || !task.enabled) continue;
      await updateDispatchTask(task, { enabled: false }); affected++;
    }
    setBatchStatus(`已排除 ${affected} 封任务；可逐封重新纳入，或使用“纳入筛选结果”。`, 'ok');
    scheduleBatchRender({aux:false,force:true});
  })(); });
  $('nmda-clear-tag-filter').addEventListener('click', () => {
    if (batchSearchEl) batchSearchEl.value = '';
    if(batchTagIncludeEl)batchTagIncludeEl.value = '';
    scheduleBatchRender({aux:false});
  });

  async function requestAutoMailboxSync(kind='quick',{force=false,source='auto'}={}){
    if(!Operations)return null;
    const normalizedKind=['quick','history','full'].includes(kind)?kind:'quick';
    const now=Date.now();
    const ttl=normalizedKind==='quick'?30000:normalizedKind==='history'?5*60*1000:10*60*1000;
    const last=normalizedKind==='quick'?mailboxAutoSyncState.lastQuickAt:normalizedKind==='history'?mailboxAutoSyncState.lastHistoryAt:mailboxAutoSyncState.lastFullAt;
    if(!force && last && now-last<ttl)return null;

    if(mailboxAutoSyncState.running){
      if(mailboxSyncKindPriority(normalizedKind)<=mailboxSyncKindPriority(mailboxAutoSyncState.runningKind||'quick'))return mailboxAutoSyncState.running;
      try{await mailboxAutoSyncState.running;}catch(_){ }
      return requestAutoMailboxSync(normalizedKind,{force:true,source});
    }

    const runGeneration=++mailboxAutoSyncState.generation;
    mailboxAutoSyncState.runningKind=normalizedKind;
    mailboxAutoSyncState.running=(async()=>{
      let connection=null;
      try{connection=await chrome.runtime.sendMessage({type:'NMDA_CONNECTION_STATUS'});}catch(_){connection=null;}
      if(!connection?.connected||!connection?.authenticated){
        setMailboxAutoSyncCue('waiting',connection?.connected?'完成登录后自动读取':'连接网易邮箱后自动读取');
        return null;
      }
      const sourceLabel=source==='import'?'导入后核验历史':source==='ready-handoff'?'任务就绪自动同步':source?.startsWith?.('tab:')?'页面切换刷新':source==='connection'?'邮箱连接完成':'自动刷新';
      const detail=normalizedKind==='history'?`${sourceLabel} · 已发送 + 草稿`:normalizedKind==='full'?`${sourceLabel} · 完整邮箱`:`${sourceLabel} · 已发送 + 草稿 + 收件`;
      setMailboxAutoSyncCue('syncing',detail);
      try{
        const result=normalizedKind==='history'?await syncMailboxDedupeHistory():await syncMailboxOperations(normalizedKind==='full'?'full':'quick');
        const finished=Date.now();
        if(normalizedKind==='quick')mailboxAutoSyncState.lastQuickAt=finished;
        if(normalizedKind==='history')mailboxAutoSyncState.lastHistoryAt=finished;
        if(normalizedKind==='full'){mailboxAutoSyncState.lastFullAt=finished;mailboxAutoSyncState.lastQuickAt=finished;}
        if(batch?.dataset){renderDuplicateDecision();renderRosterAudit();renderProcessGuide();}
        renderMonitoring();
        renderReviewPageOverview();
        const inferred=result?.historicalFollowUpsRecognized?` · 历史 Follow-up ${result.historicalFollowUpsRecognized}`:'';
        const historyMonths=readMailboxHistoryMonths();
        const historyScope=historyMonths?`最近 ${historyMonths} 个月 · `:'';
        const facts=normalizedKind==='history'
          ? `${historyScope}历史核验完成${result?.outboundRead!=null?` · 已发送 ${result.outboundRead}`:''}${result?.draftsRead!=null?` · 草稿 ${result.draftsRead}`:''}${inferred}`
          : `${historyScope}已发送 ${result?.outboundRead||0} · 草稿 ${result?.draftsRead||0} · 收件 ${result?.inboxRead||0}${inferred}`;
        setMailboxAutoSyncCue('success',facts);
        setTimeout(()=>{if(mailboxAutoSyncState.generation===runGeneration && !mailboxAutoSyncState.running)setMailboxAutoSyncCue('idle','后台按需保持最新');},2200);
        return result;
      }catch(error){
        setMailboxAutoSyncCue('error',error?.message||String(error));
        setTimeout(()=>{if(mailboxAutoSyncState.generation===runGeneration && !mailboxAutoSyncState.running)setMailboxAutoSyncCue('idle','稍后自动重试');},4200);
        throw error;
      }
    })();
    try{return await mailboxAutoSyncState.running;}
    finally{
      mailboxAutoSyncState.running=null;
      mailboxAutoSyncState.runningKind='';
    }
  }

  async function syncMailboxDedupeHistory(){
    if(!Operations)return null;
    await ensureOperationStore();
    const result=await chrome.runtime.sendMessage({type:'NMDA_READ_DEDUPE_HISTORY',historyMonths:readMailboxHistoryMonths()});
    if(!result?.ok)throw new Error(`${result?.phase?`${result.phase}：`:''}${result?.reason||'邮箱历史读取失败'}`);
    if(!result.complete||!result.sent?.complete||!result.drafts?.complete)throw new Error('已发送或草稿箱未完整读取，拒绝将不完整结果用于导入查重。');
    const applied=Operations.ingestMailboxDedupeSnapshot(operationState.store,result.sent.messages||[],result.drafts.messages||[],{
      complete:true,
      historyMonths:Number(result.historyMonths ?? readMailboxHistoryMonths())||0, historyCutoffAt:String(result.cutoffAt||''),
      sentCoverage:result.coverage?.sent||{read:result.sent.messages?.length||0,total:result.sent.total||0,complete:true,pages:result.sent.pages||0},
      draftCoverage:result.coverage?.drafts||{read:result.drafts.messages?.length||0,total:result.drafts.total||0,complete:true,pages:result.drafts.pages||0}
    });
    operationState.store=applied.store;
    await commitRuntimeOperations();
    if(batch.dataset)rebuildTasks();
    invalidateBatchView(true);
    return applied;
  }

  async function syncMailboxOperations(mode = 'quick') {
    if (!Operations) return null;
    const full = mode === 'full';
    await ensureOperationStore();
    const result = await chrome.runtime.sendMessage({ type: 'NMDA_READ_MAILBOX_STATE', mode: full ? 'full' : 'quick', historyMonths: readMailboxHistoryMonths() });
    if (!result?.ok) throw new Error(`${result?.phase ? `${result.phase}：` : ''}${result?.reason || '邮箱读取失败'}`);
    const sent = result.sent || {}, drafts = result.drafts || {}, inbox = result.inbox || {};
    if (full && (!sent.complete || !drafts.complete || !inbox.complete)) throw new Error('完整邮箱快照未完成，拒绝覆盖 operation store。');
    const applied = Operations.ingestMailboxSnapshot(operationState.store, sent.messages || [], drafts.messages || [], inbox.messages || [], {
      mode: full ? 'full' : 'quick', complete: full,
      historyMonths:Number(result.historyMonths ?? readMailboxHistoryMonths())||0, historyCutoffAt:String(result.cutoffAt||''),
      sentCoverage: result.coverage?.sent || { read: sent.messages?.length || 0, total: sent.total || 0, complete: !!sent.complete, pages: sent.pages || 0 },
      draftCoverage: result.coverage?.drafts || { read: drafts.messages?.length || 0, total: drafts.total || 0, complete: !!drafts.complete, pages: drafts.pages || 0 },
      inboxCoverage: result.coverage?.inbox || { read: inbox.messages?.length || 0, total: inbox.total || 0, complete: !!inbox.complete, pages: inbox.pages || 0 }
    });
    operationState.store = applied.store;
    await commitRuntimeOperations();
    if(batch.dataset)rebuildTasks();
    invalidateBatchView(true);
    return applied;
  }

  batchStopEl?.addEventListener('click', () => {
    batch.stopRequested = true;
    batchStopEl.disabled = true;
    setBatchStatus('已请求停止：当前这一封完成后不会继续下一封。', 'warn');
  });

  function setBatchPlanningLocked(locked) {
    [batchSearchEl, batchTagIncludeEl].forEach(el => { if (el) el.disabled = !!locked; });
    ['nmda-clear-tag-filter','nmda-bulk-add-tag','nmda-bulk-remove-tag','nmda-bulk-enable','nmda-bulk-disable','nmda-clear-selection','nmda-rule-time-zone','nmda-rule-start-date','nmda-rule-local-time','nmda-rule-skip-start','nmda-rule-skip-end','nmda-rule-max-school','nmda-rule-preserve-existing','nmda-rule-include-mailbox-scheduled','nmda-rule-skip-holidays','nmda-apply-schedule','nmda-clear-auto-schedule'].forEach(id => {
      const el = $(id); if (el) el.disabled = !!locked;
    });
    scheduleWeekdayEls.forEach(el=>{el.disabled=!!locked;});
  }

  batchPauseEveryTimeEl?.addEventListener('change', () => {
    if (batch.running) { batchPauseEveryTimeEl.checked = !!batch.pauseEveryTime; return; }
    batch.pauseEveryTime = !!batchPauseEveryTimeEl.checked;
  });

  batchStartEl.addEventListener('click', async () => {
    if (batch.running) return;
    await ensureOperationStore();
    const queue = dispatchTasks();
    const selectedBlocked=queue.filter(task=>task.enabled&&task.status==='error');
    if(selectedBlocked.length){
      const attachmentOnly=selectedBlocked.filter(task=>{const state=taskIssueState(task);return state.attachment.length&&state.content.length===0&&state.review.length===0&&state.schedule.length===0&&state.other.length===0;});
      if(attachmentOnly.length===selectedBlocked.length){setBatchStatus(`还有 ${selectedBlocked.length} 封已选择邮件缺少附件。请先补齐文件、调整发送范围，或取消选择这些邮件。`,'error');}
      else setBatchStatus(`还有 ${selectedBlocked.length} 封已选择邮件存在未解决问题。请先处理或取消选择。`,'error');
      return;
    }
    const executable = queue.filter(task => task.enabled && task.status === 'ready');
    if (!executable.length) { setBatchStatus('没有已选择且可创建的任务。请先在执行池中选择需要创建的草稿。', 'error'); return; }
    const staleScheduled=executable.filter(task=>task.scheduleAt && (Scheduler?.parseLocalDateTime?.(task.scheduleAt)?.getTime()||0) <= Date.now()+60*1000);
    if(staleScheduled.length){setBatchStatus(`有 ${staleScheduled.length} 封邮件的定时时间已过。请先在“时间规划”中更新或清空。`,'error');return;}
    const executableKeys = new Set(executable.map(task => task.editKey)); // freeze this dispatch run
    const mailTarget=await chrome.runtime.sendMessage({type:'NMDA_OPEN_MAIL',focus:true});
    if(!mailTarget?.ok){setBatchStatus('无法打开网易邮箱页面，请先完成登录。','error');return;}
    const mailboxReady=await waitForMailboxExecutionReady();
    if(!mailboxReady?.connected || !mailboxReady?.authenticated){
      setBatchStatus('网易邮箱已打开，但尚未检测到已登录账号。请在网易邮箱完成登录后返回工作台再次开始。','error');
      return;
    }
    const scheduleValidation=await validateMailboxScheduleBeforeExecution(executable);
    if(!scheduleValidation.ok){setBatchStatus(scheduleValidation.reason||'无法核对网易已有排期。','error');return;}
    batch.running = true; batch.stopRequested = false; batch.pauseEveryTime = !!batchPauseEveryTimeEl?.checked; batchStartEl.disabled = true; batchStopEl.disabled = false;
    if (batchPauseEveryTimeEl) batchPauseEveryTimeEl.disabled = true;
    await updateMailboxBatchMonitor({action:'start',total:executable.length,succeeded:0,failed:0,remaining:executable.length,items:executable.map((task,index)=>({key:task.editKey,id:task.id,index:index+1,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||'',scheduleAt:task.scheduleAt||'',status:'queued'}))});
    importFileEl.disabled = true; if (importDirEl) importDirEl.disabled = true; if (rosterFileEl) rosterFileEl.disabled = true; dirEl.disabled = true; taskFilesEl.disabled = true; if(preSendMatchFilesEl)preSendMatchFilesEl.disabled=true;if(preSendSharedFilesEl)preSendSharedFilesEl.disabled=true;if(draftImportEl)draftImportEl.disabled=true; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=true; });
    setBatchPlanningLocked(true);
    let succeeded = 0, failed = 0;
    let cleanupStopReason = '';
    try {
      for (const frozenTask of executable) {
        if (!executableKeys.has(frozenTask.editKey)) continue;
        if (batch.stopRequested) break;
        const task = dispatchTaskByKey(frozenTask.editKey) || frozenTask;
        if (task.status !== 'ready' || !task.enabled) continue;
        setDispatchRuntime(task,{status:'running',runtimeError:''});
        scheduleBatchRender({aux:false,force:true});
        const runIndex=succeeded+failed+1;
        const kindLabel=task.dispatchKind==='follow_up'?`Follow-up #${Math.max(1,Number(task.sequence||1))}`:'初始邮件';
        setBatchStatus(`正在处理 ${runIndex}/${executable.length} · ${kindLabel} · ${task.subject || '(无主题)'}${task.scheduleAt ? ` · 定时 ${scheduleValueForDisplay(task.scheduleAt,batch.scheduleRules||freshScheduleRules()).replace('T',' ')} · ${scheduleZoneText(batch.scheduleRules||freshScheduleRules())} 当地时间` : ' · 未定时'}`);
        await updateMailboxBatchMonitor({action:'task-start',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-runIndex+1),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||'',scheduleAt:task.scheduleAt||''}});
        try {
          const outcome = await executeDraftRemotely(task, {
            fresh: true,
            pauseEveryTime: batch.pauseEveryTime,
            onProgress: progress => {
              setBatchStatus(`${kindLabel}：${progress.message || '正在创建草稿…'}`);
              void updateMailboxBatchMonitor({action:'task-progress',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-runIndex),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||''},executionId:String(progress.executionId||''),phase:progress.phase||'',message:progress.message||'正在创建草稿…'});
            }
          });
          const notes=[];
          const upload = outcome.attachment || {};
          if (upload.verified === false && upload.missingNames?.length) notes.push(`附件已提交上传，但页面未确认：${upload.missingNames.join('、')}`);
          if (task.scheduleAt && outcome.actualMinute !== null && outcome.actualMinute !== undefined) {
            const requestedMinute = new Date(task.scheduleAt).getMinutes();
            if (Number(outcome.actualMinute) !== requestedMinute) notes.push(`分钟由 ${requestedMinute} 调整为 ${outcome.actualMinute}`);
          }
          notes.push(`草稿已确认保存（${outcome.saveOutcome?.kind || 'remote'}）`);
          if (outcome.cleanup?.ok === false) notes.push(`写信标签清理失败：${outcome.cleanup.reason || '未知原因'}`);
          let draftRecord=null;
          if (Operations) {
            const recorded = Operations.recordPreparedDraft(operationState.store, task, outcome);
            operationState.store = recorded.store;
            draftRecord=recorded.record;
            if(task.dispatchKind==='follow_up'){
              const sourceId=task._sourceTaskId||task.id;
              const current=operationState.store.derivedTasks?.[sourceId];
              if(!current)throw new Error('Follow-up 执行成功，但无法回写 derived task。');
              const targetState=task.scheduleAt?'scheduled':'confirmed';
              const stateResult=Operations.setDerivedTaskState(operationState.store,sourceId,targetState,{
                draftPreparedAt:new Date().toISOString(),
                draftRecordId:draftRecord?.id||'',
                scheduledAt:task.scheduleAt||'',
                runtimeError:''
              });
              operationState.store=stateResult.store;
              const dequeued=Operations.updateDerivedTaskDispatch(operationState.store,sourceId,{queued:false,dequeuedReason:'draft-prepared'});
              operationState.store=dequeued.store;
            }
            await commitRuntimeOperations();
          }
          setDispatchRuntime(task,{status:'done',runtimeError:'',note:notes.join('；')});
          if(task.dispatchKind==='follow_up') clearDispatchRuntime(task);
          succeeded++;
          const cleanupFailed = outcome.cleanup?.ok === false;
          await updateMailboxBatchMonitor({action:'task-done',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-succeeded-failed),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||''},message:cleanupFailed?'草稿已保存，但写信标签未关闭':'草稿已确认保存'});
          scheduleBatchRender({aux:false,force:true});
          if (cleanupFailed) {
            cleanupStopReason = `当前草稿已保存，但网易写信标签未能安全关闭：${outcome.cleanup.reason || '未知原因'}。为避免继续累积或误操作标签，批处理已停止。`;
            batch.stopRequested = true;
            setBatchStatus(cleanupStopReason, 'warn');
            break;
          }
          await sleep(300);
        } catch (error) {
          console.error(`[${APP}] dispatch ${task.editKey}`, error);
          const message=error.message || String(error);
          setDispatchRuntime(task,{status:'ready',runtimeError:message});
          if(task.dispatchKind==='follow_up' && Operations){
            try{
              const sourceId=task._sourceTaskId||task.id;
              const current=operationState.store.derivedTasks?.[sourceId];
              if(current){
                const updated=Operations.setDerivedTaskState(operationState.store,sourceId,current.state,{runtimeError:message});
                operationState.store=updated.store;
                await commitRuntimeOperations();
              }
            }catch(persistError){console.warn(`[${APP}] persist follow-up execution error failed`,persistError);}
          }
          failed++; scheduleBatchRender({aux:false,force:true});
          await updateMailboxBatchMonitor({action:'task-error',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-succeeded-failed),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||''},message});
          setBatchStatus(`${kindLabel} 创建失败，已自动停止：${message}。为避免页面状态异常导致串稿，不继续执行后续任务。`, 'error');
          break;
        }
      }
      const remaining = Math.max(0,executable.length-succeeded-failed);
      if (cleanupStopReason) setBatchStatus(cleanupStopReason, 'warn');
      else if (batch.stopRequested) setBatchStatus(`已停止。成功 ${succeeded}，失败 ${failed}，剩余 ${remaining}。`, 'warn');
      else if (failed) setBatchStatus(`执行结束：成功 ${succeeded}，失败 ${failed}，剩余 ${remaining}。请处理失败任务后再重试。`, 'warn');
      else setBatchStatus(`执行完成：成功创建并保存 ${succeeded} 封草稿。`, 'ok');
      await updateMailboxBatchMonitor({action:'finish',total:executable.length,succeeded,failed,remaining,status:batch.stopRequested?'stopped':failed?'error':'done',message:cleanupStopReason|| (batch.stopRequested?`已停止 · 成功 ${succeeded} · 剩余 ${remaining}`:failed?`执行结束 · 成功 ${succeeded} · 失败 ${failed}`:`全部完成 · ${succeeded} 封草稿已保存`)});
    } finally {
      batch.running = false; batchStopEl.disabled = true;
      if (batchPauseEveryTimeEl) batchPauseEveryTimeEl.disabled = false;
      importFileEl.disabled = false; if (importDirEl) importDirEl.disabled = false; if (rosterFileEl) rosterFileEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; if(preSendMatchFilesEl)preSendMatchFilesEl.disabled=false;if(preSendSharedFilesEl)preSendSharedFilesEl.disabled=false;if(draftImportEl)draftImportEl.disabled=false; ['nmda-paste-import','nmda-reset-import','nmda-show-paste'].forEach(id => { const el=$(id); if(el) el.disabled=false; });
      setBatchPlanningLocked(false);
      scheduleBatchRender({aux:false,force:true});
    }
  });

  function applyDeepLink() {
    const raw = String(location.hash || '').replace(/^#/, '');
    const match=raw.match(/^(batch|review|dispatch|monitor)$/);
    if(!match)return;
    const tab=match[1];
    if(tab==='review'){requestAnimationFrame(()=>void openReviewWorkspace({pendingOnly:false,fromDeepLink:true}));return;}
    setWorkbenchTab(tab);
  }

  window.addEventListener('hashchange', applyDeepLink);
  window.addEventListener('pagehide',()=>{ void persistWorkspaceNow(); });
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') void persistWorkspaceNow(); });
  void (async()=>{
    await restoreWorkspaceFromStorage();
    invalidateBatchView(true);
    await ensureOperationStore(true).catch(error=>console.warn(`[${APP}] operations init failed`,error));
    applyDeepLink();
    scheduleBatchRender({aux:true,force:true});
  })();
})();
