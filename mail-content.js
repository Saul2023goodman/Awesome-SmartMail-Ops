(() => {
  'use strict';

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
  globalThis.NMDAMailContent = Object.freeze({ escapeHtml, sanitizeEmailRichHtml, plainMailBodyToHtml, mailQuotedAttentionRanges, mailRichFormatFeatures, mailRichHasMeaningfulFormatting, mailRichHtmlToText, taskRichBodyHtml, normalizeGovernancePhrase, governanceTaskText, governanceFindPositions, governanceTextIndex, governanceOccurrenceRefs, inspectGovernanceRuleHtml });
})();
