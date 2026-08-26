(() => {
  'use strict';

  const EMAIL_RE = /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/ig;
  const SUBJECT_RE = /(?:^|[\s>*#\-])(?:\*{0,2})\s*(?:subject|主题|邮件主题|邮件标题)\s*[:：]\s*/i;
  const SALUTATION_RE = /(?:\b(?:dear|hello|hi)\s+(?:(?:prof(?:essor)?|dr|mr|mrs|ms)\.?\s+)?[^,\n]{1,90},?|(?:尊敬的|敬爱的)[^，,：:\n]{1,60}[，,：:]|[\p{L}·•]{1,30}(?:教授|老师|博士)[，,]?\s*您好[！!，,]?|^\s*您好[！!，,：:])/iu;
  const CLOSE_RE = /(?:\b(?:yours\s+sincerely|sincerely|best\s+regards|kind\s+regards|warm\s+regards|regards|best\s+wishes|respectfully|many\s+thanks)\b\s*[,，]?|此致\s*敬礼|祝好|顺颂(?:时祺|商祺)|敬祝[^\n]{0,20})/iu;
  const HARD_NOISE_RE = /^\s*(?:[-—_]{3,}|#{1,6}\s+|\*{0,2}(?:完整套磁信|改写点标注|改写说明|契合点|备注|说明)\s*[:：]?|✏️|📝|📌|(?:剩下的发|好的，我来|第一部分|第二部分|发送计划))/i;
  const NUMBER_ONLY_RE = /^\s*(?:\d{1,4}|[一二三四五六七八九十百]+)[\.、)）:]?\s*$/;
  const POSTSCRIPT_RE = /^\s*(?:p\.?\s*s\.?|postscript|附言|又及)\s*[:：.]/iu;
  const RECORD_HEADING_RE = /^(?:\d+[.、)）:]\s*)?[^\n]{2,100}?\s+[—–-]\s+[^\n]{0,160}(?:university|college|school|institute|academy|polytechnic|大学|学院|学校|研究院|科学院|@[A-Z0-9.-]+)[^\n]*$/iu;
  const METADATA_FIELDS = [
    {field:'source',label:'来源',re:/^(?:research\s+sources?|information\s+sources?|data\s+sources?|source(?:s|\s+links?)?|references?|reference\s+links?|citations?|research\s+(?:basis|evidence)|(?:professor|supervisor|advisor|faculty|official)\s+profiles?|profile\s+links?|official\s+(?:page|profile)|资料来源|研究来源|信息来源|数据来源|来源链接|来源|参考资料|参考文献|引用来源|导师主页|教授主页|官方主页|网页链接)/iu},
    {field:'attachments',label:'附件',re:/^(?:required\s+attachments?|attached\s+files?|attachment(?:s|\s+list)?|enclosures?|附件(?:清单|列表|要求)?|随附文件|所需材料)/iu},
    {field:'scheduleAt',label:'定时',re:/^(?:scheduled?\s+(?:send(?:ing)?\s+)?(?:time|date)|send(?:ing)?\s+(?:time|date)|delivery\s+(?:time|date)|定时(?:发送)?时间|计划发送时间|发送时间|预约发送时间)/iu},
    {field:'recipient',label:'收件人',re:/^(?:recipient(?:\s+email)?|to\s+address|professor\s+email|supervisor\s+email|advisor\s+email|收件人(?:邮箱)?|导师邮箱|教授邮箱)/iu},
    {field:'notes',label:'说明',re:/^(?:internal\s+notes?|editor(?:ial)?\s+notes?|drafting\s+notes?|instructions?|rewrite\s+notes?|matching\s+points?|rationale|analysis|备注|内部说明|操作说明|写作说明|改写说明|改写点|契合点|匹配点|发送说明|研究说明)/iu}
  ];

  function textOfBlock(block) {
    if (block == null) return '';
    if (typeof block === 'string') return block;
    return String(block.text ?? block.value ?? '');
  }

  function cleanBlockText(value) {
    return String(value ?? '')
      .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function cleanInlineMarkup(value) {
    return cleanBlockText(value)
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*>\s*/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/^\*{1,3}|\*{1,3}$/g, '')
      .replace(/\*\*/g, '')
      .trim();
  }

  function collapseSubject(value) {
    return cleanInlineMarkup(value)
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[-—–:：\s]+|[-—–\s]+$/g, '')
      .trim();
  }

  function extractEmails(value) {
    const source = String(value ?? '');
    const matches = source.match(EMAIL_RE) || [];
    const seen = new Set(), out = [];
    for (const raw of matches) {
      const email = raw.replace(/[)>\],.;:，；。]+$/g, '').trim();
      const key = email.toLowerCase();
      if (email && !seen.has(key)) { seen.add(key); out.push(email); }
    }
    return out;
  }

  function isNoiseBlock(value) {
    const text = cleanBlockText(value);
    if (!text) return true;
    if (HARD_NOISE_RE.test(text)) return true;
    if (/^\s*(?:📧\s*)?[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\s*$/i.test(text)) return true;
    if (NUMBER_ONLY_RE.test(text)) return true;
    return false;
  }

  function subjectAnchor(text) {
    const t = cleanBlockText(text);
    const m = SUBJECT_RE.exec(t);
    return m ? { index:m.index + m[0].length, markerStart:m.index, marker:m[0] } : null;
  }

  function salutationAnchor(text) {
    const t = cleanBlockText(text);
    const m = SALUTATION_RE.exec(t);
    return m ? { index:m.index, end:m.index + m[0].length, text:m[0] } : null;
  }

  function closeAnchor(text) {
    const t = cleanBlockText(text);
    const m = CLOSE_RE.exec(t);
    return m ? { index:m.index, end:m.index + m[0].length, text:m[0] } : null;
  }

  function stripListPrefix(value) {
    return cleanBlockText(value)
      .replace(/^\s*(?:[-*•▪◦]+|(?:✏️|📝|📌|🔗|📎|⏰|📧))\s*/u,'')
      .trim();
  }

  function metadataAnchor(value) {
    const text=stripListPrefix(value);
    for(const def of METADATA_FIELDS){
      const m=text.match(new RegExp(`${def.re.source}\\s*[:：]\\s*(.*)$`,def.re.flags));
      if(m)return{field:def.field,label:def.label,value:String(m[1]||'').trim(),text};
    }
    if(/^📧\s*[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\s*$/iu.test(cleanBlockText(value))){
      return{field:'recipient',label:'收件人',value:extractEmails(value)[0]||'',text};
    }
    return null;
  }

  function isLikelySignatureLine(value) {
    const text=cleanInlineMarkup(value);
    if(!text||text.length>180||metadataAnchor(text)||subjectAnchor(text)||salutationAnchor(text)||closeAnchor(text)||HARD_NOISE_RE.test(text)||NUMBER_ONLY_RE.test(text))return false;
    if(POSTSCRIPT_RE.test(text))return false;
    if(/^(?:[\p{L}][\p{L}'’.-]*)(?:\s+[\p{L}][\p{L}'’.-]*){0,5}$/u.test(text))return true;
    if(/^[\p{Script=Han}·•]{2,12}$/u.test(text))return true;
    if(/\b(?:ph\.?d\.?|doctoral|master'?s?|student|candidate|researcher|assistant|associate|professor|lecturer|department|faculty|school|college|university|institute|laboratory|lab|中心|实验室|研究院|学院|大学|博士|硕士|学生|研究员|教授|讲师)\b/iu.test(text))return true;
    if(/^(?:e-?mail|email|tel|telephone|phone|mobile|wechat|微信|电话|手机|网址|website)\s*[:：]/iu.test(text))return true;
    if(/^(?:https?:\/\/|www\.)\S+$/iu.test(text))return true;
    if(/^\+?[\d()\s.-]{7,24}$/.test(text))return true;
    return false;
  }

  function classifyBoundaryBlock(value,{phase='body'}={}) {
    const text=cleanBlockText(value);
    if(!text)return{role:'empty',hard:false,label:'空行'};
    const metadata=metadataAnchor(text);
    if(metadata)return{role:'metadata',hard:true,label:metadata.label,metadata};
    if(subjectAnchor(text))return{role:'subject',hard:true,label:'下一主题'};
    if(HARD_NOISE_RE.test(text))return{role:'annotation',hard:true,label:'说明'};
    if(NUMBER_ONLY_RE.test(text))return{role:'record-marker',hard:true,label:'下一记录'};
    if(phase!=='body'&&RECORD_HEADING_RE.test(cleanInlineMarkup(text)))return{role:'record-heading',hard:true,label:'下一记录'};
    if(salutationAnchor(text))return{role:'salutation',hard:phase!=='body',label:'称呼'};
    if(closeAnchor(text))return{role:'closing',hard:false,label:'落款'};
    if(POSTSCRIPT_RE.test(text))return{role:'postscript',hard:false,label:'附言'};
    if(phase==='post-close'&&isLikelySignatureLine(text))return{role:'signature',hard:false,label:'签名'};
    return{role:'body',hard:false,label:'正文'};
  }

  function excludedBlock(block,index,classification) {
    return {index,text:cleanBlockText(textOfBlock(block)),role:classification.role,label:classification.label,field:classification.metadata?.field||'',value:classification.metadata?.value||''};
  }

  function sidecarFromExcluded(items) {
    const attachments=[],sources=[];let scheduleAt='';
    for(const item of items||[]){
      if(item.field==='attachments'&&item.value)attachments.push(item.value);
      else if(item.field==='source'&&item.value)sources.push(item.value);
      else if(item.field==='scheduleAt'&&item.value&&!scheduleAt)scheduleAt=item.value;
    }
    return{attachments:[...new Set(attachments)].join('; '),scheduleAt,sources};
  }

  function nearestRecipientContext(blocks, start, end, salutationText='') {
    const candidates = [];
    const surname = String(salutationText || '').replace(/[,，]/g,'').trim().split(/\s+/).pop()?.toLowerCase() || '';
    for (let i=Math.max(0,start); i<=Math.min(end,blocks.length-1); i++) {
      const text = cleanBlockText(textOfBlock(blocks[i]));
      const metadata=metadataAnchor(text);
      const emails = extractEmails(text);
      for (const email of emails) {
        let score = 100 - Math.min(70, Math.max(0,end-i)*8);
        if (/📧/.test(text)) score += 18;
        if (/[-—–]\s*[^\n]*@/.test(text) || /@[^\s]+\s*$/.test(text)) score += 10;
        if (surname && text.toLowerCase().includes(surname)) score += 14;
        if (/\b(?:from|my email|sender)\b/i.test(text)) score -= 30;
        if(metadata&&metadata.field!=='recipient')score-=80;
        else if(metadata?.field==='recipient')score+=18;
        candidates.push({email,index:i,score,text});
      }
    }
    candidates.sort((a,b)=>b.score-a.score || b.index-a.index);
    return { selected:candidates.find(candidate=>candidate.score>=55) || null, candidates };
  }

  function headingContext(blocks, contextStart, subjectBlock) {
    const from=Math.max(contextStart,subjectBlock-8);
    // Strong identity heading first: "### 12. Name — email/university/...". Markdown is presentation, not semantics.
    for (let i=subjectBlock-1; i>=from; i--) {
      const raw=cleanBlockText(textOfBlock(blocks[i])); if(!raw)continue;
      if (SUBJECT_RE.test(raw) || SALUTATION_RE.test(raw) || CLOSE_RE.test(raw) || metadataAnchor(raw)) continue;
      const clean=cleanInlineMarkup(raw);
      if (/^(?:\d+[.、)）:]\s*)?[^\n]{2,100}?\s+[—–-]\s+[^\n]{2,180}$/i.test(clean)) return {index:i,text:clean};
    }
    for (let i=subjectBlock-1; i>=from; i--) {
      const raw = cleanBlockText(textOfBlock(blocks[i]));
      if (!raw || HARD_NOISE_RE.test(raw) || NUMBER_ONLY_RE.test(raw) || metadataAnchor(raw)) continue;
      if (/^\s*(?:📧\s*)?[A-Z0-9._%+\-]+@/i.test(raw)) continue;
      if (SUBJECT_RE.test(raw) || SALUTATION_RE.test(raw) || CLOSE_RE.test(raw)) continue;
      const text = cleanInlineMarkup(raw);
      if (text.length > 180 || /^(?:突出|强调|契合点|改写)/.test(text)) continue;
      return {index:i,text};
    }
    return null;
  }


  function institutionFromHeading(headingText) {
    const clean=cleanInlineMarkup(headingText||'').replace(/^\s*\d+[\.、)）:]\s*/,'').trim();
    if(!clean)return '';
    const parts=clean.split(/\s+[—–-]\s+/).map(x=>x.trim()).filter(Boolean);
    if(parts.length<2)return '';
    const candidates=parts.slice(1).filter(part=>!extractEmails(part).length && !/^(?:邮箱|email)(?:待确认|pending)?$/i.test(part));
    const strong=candidates.find(part=>/(university|college|school|institute|academy|polytechnic|conservatoire|大学|学院|学校|研究院|科学院|理工|师范|商学院)/i.test(part));
    return (strong||'').replace(/[（(](?:邮箱待确认|email pending)[）)]/ig,'').trim().slice(0,160);
  }

  function deriveId(heading, ordinal) {
    if (!heading?.text) return String(ordinal);
    const t = heading.text.replace(/^\s*\d+[\.、)）:]\s*/, '').trim();
    const m = t.match(/^(.{1,100}?)(?:\s+[—–-]\s+|\s+—\s+)/);
    return (m?.[1] || t).replace(/\s*[-—–]\s*\(?\s*(?:邮箱|email).*/i,'').trim().slice(0,100) || String(ordinal);
  }

  function subjectText(blocks, subjectBlock, salutBlock, subjectInfo, salutInfo) {
    const parts = [];
    for (let i=subjectBlock; i<=salutBlock; i++) {
      let text = cleanBlockText(textOfBlock(blocks[i]));
      if (!text) continue;
      if (i===subjectBlock) text = text.slice(subjectInfo.index);
      if (i===salutBlock) {
        const localSal = i===subjectBlock ? salutationAnchor(cleanBlockText(textOfBlock(blocks[i]))) : salutInfo;
        if (localSal) {
          const cut = i===subjectBlock ? Math.max(0, localSal.index - subjectInfo.index) : localSal.index;
          text = text.slice(0,cut);
        }
      }
      if (text.trim()) parts.push(text);
    }
    return collapseSubject(parts.join('\n'));
  }

  function appendPostClose(blocks,parts,closeBlock,nextSubjectBlock,closeInfo=null) {
    let endBlock=closeBlock,inPostscript=false,signatureLines=0;
    const excludedBlocks=[];
    const candidates=[];
    const closeRaw=cleanBlockText(textOfBlock(blocks[closeBlock]));
    const inlineTail=closeInfo?closeRaw.slice(closeInfo.end).trim():'';
    for(const text of inlineTail.split(/\n+/).map(x=>x.trim()).filter(Boolean))candidates.push({text,index:closeBlock,inline:true});
    for(let i=closeBlock+1;i<Math.min(nextSubjectBlock,closeBlock+10,blocks.length);i++){
      for(const text of cleanBlockText(textOfBlock(blocks[i])).split(/\n+/).map(x=>x.trim()).filter(Boolean))candidates.push({text,index:i,inline:false});
    }
    for(const candidate of candidates){
      const raw=candidate.text,i=candidate.index;
      if(!raw)continue;
      const classification=classifyBoundaryBlock(raw,{phase:'post-close'});
      if(classification.hard){excludedBlocks.push(excludedBlock(candidate,i,classification));break;}
      if(classification.role==='postscript')inPostscript=true;
      if(inPostscript){
        if(classification.role==='subject'||classification.role==='salutation')break;
        parts.push(cleanInlineMarkup(raw));endBlock=i;continue;
      }
      if(classification.role==='signature'&&signatureLines<6){
        parts.push(cleanInlineMarkup(raw));endBlock=i;signatureLines++;continue;
      }
      // An unclassified paragraph after a completed closing is not silently promoted to the email.
      excludedBlocks.push(excludedBlock(candidate,i,{role:'ambiguous-tail',label:'未归类尾部'}));
      break;
    }
    return{endBlock,excludedBlocks};
  }

  function bodyText(blocks, salutationBlock, closeBlock, nextSubjectBlock, salutInfo, closeInfo) {
    const parts=[];
    for (let i=salutationBlock; i<=closeBlock; i++) {
      let text=cleanBlockText(textOfBlock(blocks[i]));
      if (!text) continue;
      const start=i===salutationBlock&&salutInfo?salutInfo.index:0;
      const end=i===closeBlock&&closeInfo?closeInfo.end:text.length;
      text=text.slice(start,end);
      parts.push(cleanInlineMarkup(text));
    }
    const tail=appendPostClose(blocks,parts,closeBlock,nextSubjectBlock,closeInfo);
    return { text:parts.filter(Boolean).join('\n\n').replace(/\n{3,}/g,'\n\n').trim(), endBlock:tail.endBlock, excludedBlocks:tail.excludedBlocks };
  }


  function bodyTextOpenEnded(blocks, startBlock, nextSubjectBlock, startInfo=null) {
    const parts=[]; let endBlock=startBlock;const excludedBlocks=[];
    scanBlocks:for(let i=startBlock;i<Math.min(nextSubjectBlock,blocks.length);i++){
      let raw=cleanBlockText(textOfBlock(blocks[i]));
      if(!raw)continue;
      if(i===startBlock && startInfo) raw=raw.slice(startInfo.index);
      const local=[];
      for(const segment of raw.split(/\n+/).map(x=>x.trim()).filter(Boolean)){
        if((i>startBlock||local.length)&&parts.length+local.length>=2){
          const classification=classifyBoundaryBlock(segment,{phase:'open-ended'});
          if(classification.hard){excludedBlocks.push(excludedBlock({text:segment},i,classification));break scanBlocks;}
        }
        const clean=cleanInlineMarkup(segment);if(clean)local.push(clean);
      }
      if(local.length){parts.push(local.join('\n'));endBlock=i;}
    }
    // Trim presentation / commentary debris from the tail.
    while(parts.length && (HARD_NOISE_RE.test(parts[parts.length-1]) || NUMBER_ONLY_RE.test(parts[parts.length-1])))parts.pop();
    return {text:parts.join('\n\n').replace(/\n{3,}/g,'\n\n').trim(),endBlock,excludedBlocks};
  }

  function bodyTextUntilClose(blocks, startBlock, closeBlock, nextSubjectBlock, closeInfo) {
    const parts=[];
    for(let i=startBlock;i<=closeBlock;i++){
      let raw=cleanBlockText(textOfBlock(blocks[i]));
      if(i===closeBlock&&closeInfo)raw=raw.slice(0,closeInfo.end);
      if(raw)parts.push(cleanInlineMarkup(raw));
    }
    const tail=appendPostClose(blocks,parts,closeBlock,nextSubjectBlock,closeInfo);
    return {text:parts.filter(Boolean).join('\n\n').replace(/\n{3,}/g,'\n\n').trim(),endBlock:tail.endBlock,excludedBlocks:tail.excludedBlocks};
  }

  function sanitizeRecognizedBody(value) {
    const raw=String(value??'').replace(/\r\n?/g,'\n').trim();
    if(!raw)return{text:'',excludedBlocks:[]};
    const blocks=raw.split(/\n{2,}/).map((text,index)=>({text,index}));
    let closeBlock=-1;
    let closeInfo=null;
    for(let i=0;i<blocks.length;i++){const found=closeAnchor(blocks[i].text);if(found){closeBlock=i;closeInfo=found;break;}}
    if(closeBlock>=0){
      const parts=blocks.slice(0,closeBlock).map(block=>cleanInlineMarkup(block.text)).filter(Boolean);
      const closeText=cleanBlockText(blocks[closeBlock].text).slice(0,closeInfo.end);
      if(closeText)parts.push(cleanInlineMarkup(closeText));
      const tail=appendPostClose(blocks,parts,closeBlock,blocks.length,closeInfo);
      return{text:parts.join('\n\n').replace(/\n{3,}/g,'\n\n').trim(),excludedBlocks:tail.excludedBlocks};
    }
    const kept=[];const excludedBlocks=[];
    for(let i=0;i<blocks.length;i++){
      const classification=classifyBoundaryBlock(blocks[i].text,{phase:'open-ended'});
      if(i>=2&&classification.hard){excludedBlocks.push(excludedBlock(blocks[i],i,classification));break;}
      kept.push(cleanInlineMarkup(blocks[i].text));
    }
    return{text:kept.filter(Boolean).join('\n\n').replace(/\n{3,}/g,'\n\n').trim(),excludedBlocks};
  }

  function scoreFrame(frame) {
    let score=0;
    if (frame.subject) score+=30;
    if (frame.salutation) score+=24;
    if (frame.closing) score+=20;
    if (frame.body && frame.body.length>=80) score+=11;
    else if (frame.body) score+=5;
    if (frame.recipients) score+=15;
    return Math.min(100,score);
  }

  function recognizeMailFrames(inputBlocks,{sourceFile='',minConfidence=55,includeWeak=true}={}) {
    const blocks=(inputBlocks||[]).map((b,index)=>({
      index,
      type: typeof b==='object' && b ? (b.type||'block') : 'block',
      style: typeof b==='object' && b ? (b.style||'') : '',
      text: cleanBlockText(textOfBlock(b))
    })).filter(b=>b.text);
    if (!blocks.length) return {records:[],stats:{blocks:0,subjects:0,salutations:0,closings:0,emails:0},blocks:[]};

    const subjectBlocks=[];
    for(let i=0;i<blocks.length;i++) if(subjectAnchor(blocks[i].text)) subjectBlocks.push(i);
    const records=[]; const usedSalutations=new Set(); let previousEnd=-1;

    const buildFrame=(subjectBlock,nextSubjectBlock,ordinal)=>{
      const subjectInfo=subjectAnchor(blocks[subjectBlock].text);
      let salutationBlock=-1,salutInfo=null;
      for(let i=subjectBlock;i<Math.min(nextSubjectBlock,subjectBlock+10);i++){
        const a=salutationAnchor(blocks[i].text); if(a){salutationBlock=i;salutInfo=a;break;}
      }
      let closeBlock=-1,closeInfo=null;
      const closeSearchStart=salutationBlock>=0?salutationBlock:subjectBlock;
      let semanticBoundary=nextSubjectBlock;
      if(salutationBlock>=0){
        for(let i=salutationBlock+1;i<nextSubjectBlock;i++){if(salutationAnchor(blocks[i].text)){semanticBoundary=i;break;}}
      }
      for(let i=closeSearchStart;i<semanticBoundary;i++){
        const a=closeAnchor(blocks[i].text); if(a){closeBlock=i;closeInfo=a;break;}
      }

      let subject='',body={text:'',endBlock:subjectBlock};
      const issues=[];
      if(salutationBlock>=0){
        subject=subjectText(blocks,subjectBlock,salutationBlock,subjectInfo,salutInfo);
        if(closeBlock>=0)body=bodyText(blocks,salutationBlock,closeBlock,nextSubjectBlock,salutInfo,closeInfo);
        else { body=bodyTextOpenEnded(blocks,salutationBlock,semanticBoundary,salutInfo); issues.push('未找到邮件落款'); }
      }else{
        // Degraded frame: Subject is still a strong start anchor. Keep the candidate instead of dropping it.
        subject=collapseSubject(cleanBlockText(blocks[subjectBlock].text).slice(subjectInfo.index));
        if(closeBlock>=0){ body=bodyTextUntilClose(blocks,subjectBlock+1,closeBlock,nextSubjectBlock,closeInfo); issues.push('未找到邮件称呼'); }
        else { body=bodyTextOpenEnded(blocks,subjectBlock+1,nextSubjectBlock,null); issues.push('未找到邮件称呼','未找到邮件落款'); }
      }
      if((body.excludedBlocks||[]).some(item=>item.role==='ambiguous-tail'))issues.push('邮件落款后存在未归类内容，已从正文隔离');
      const contextStart=Math.max(0,previousEnd+1);
      const recipientContext=nearestRecipientContext(blocks,contextStart,Math.max(subjectBlock,salutationBlock>=0?salutationBlock:subjectBlock),salutInfo?.text||'');
      const heading=headingContext(blocks,contextStart,subjectBlock);
      const recipients=recipientContext.selected?.email||'';
      const sidecar=sidecarFromExcluded(body.excludedBlocks||[]);
      const frame={
        id:deriveId(heading,ordinal), recipients, school:institutionFromHeading(heading?.text||''), subject, body:body.text,
        attachments:sidecar.attachments, scheduleAt:sidecar.scheduleAt, tags:'', sourceFile,
        salutation:salutInfo?.text||'', closing:closeInfo?.text||'',
        startBlock:subjectBlock, endBlock:body.endBlock, heading:heading?.text||'',
        excludedBlocks:[...(body.excludedBlocks||[])], sourceReferences:[...sidecar.sources],
        recipientEvidence:recipientContext.selected||null,
        recipientCandidates:(recipientContext.candidates||[]).slice(0,8).map(c=>({email:c.email,index:c.index,score:c.score,text:c.text})),
        evidence:['subject',...(salutInfo?['salutation']:[]),...(closeInfo?['closing']:[]),...(body.text.length>=80?['body']:[]),...(recipients?['recipient-email']:[]),...((body.excludedBlocks||[]).length?['tail-boundary']:[])],
        issues
      };
      frame.confidence=scoreFrame(frame);
      if(!recipients)frame.issues.push('未定位收件人邮箱');
      if(!subject)frame.issues.push('主题为空');
      if(frame.body.length<40)frame.issues.push('正文过短');
      if(frame.confidence<70)frame.issues.push('邮件边界识别置信度较低');
      if(salutationBlock>=0)usedSalutations.add(salutationBlock);
      // A lone Subject with no usable body is not enough evidence to call something a mail.
      if(!salutInfo&&!closeInfo&&frame.body.length<80&&!recipients)return null;
      return frame;
    };

    for(let s=0;s<subjectBlocks.length;s++){
      const subjectBlock=subjectBlocks[s], nextSubjectBlock=subjectBlocks[s+1] ?? blocks.length;
      const frame=buildFrame(subjectBlock,nextSubjectBlock,records.length+1);
      if(frame && (includeWeak || frame.confidence>=minConfidence)){
        records.push(frame); previousEnd=frame.endBlock;
      }
    }

    // Fallback for sources where Subject is missing: Dear + closing still defines a mail body.
    for(let i=0;i<blocks.length;i++){
      if(usedSalutations.has(i))continue;
      const salut=salutationAnchor(blocks[i].text); if(!salut)continue;
      const nextSubject=subjectBlocks.find(x=>x>i) ?? blocks.length;
      let closeBlock=-1,close=null;
      let fallbackBoundary=Math.min(nextSubject,i+80);
      for(let j=i+1;j<fallbackBoundary;j++){if(salutationAnchor(blocks[j].text)){fallbackBoundary=j;break;}}
      for(let j=i;j<fallbackBoundary;j++){const c=closeAnchor(blocks[j].text);if(c){closeBlock=j;close=c;break;}}
      if(closeBlock<0)continue;
      const body=bodyText(blocks,i,closeBlock,nextSubject,salut,close);
      const prevEnd=records.filter(r=>r.endBlock<i).sort((a,b)=>b.endBlock-a.endBlock)[0]?.endBlock ?? -1;
      const rc=nearestRecipientContext(blocks,prevEnd+1,i,salut.text);
      const heading=headingContext(blocks,prevEnd+1,i);
      const sidecar=sidecarFromExcluded(body.excludedBlocks||[]);
      const frame={id:deriveId(heading,records.length+1),recipients:rc.selected?.email||'',school:institutionFromHeading(heading?.text||''),subject:'',body:body.text,attachments:sidecar.attachments,scheduleAt:sidecar.scheduleAt,tags:'',sourceFile,
        salutation:salut.text,closing:close.text,startBlock:i,endBlock:body.endBlock,heading:heading?.text||'',recipientEvidence:rc.selected||null,recipientCandidates:(rc.candidates||[]).slice(0,8).map(c=>({email:c.email,index:c.index,score:c.score,text:c.text})),
        excludedBlocks:[...(body.excludedBlocks||[])],sourceReferences:[...sidecar.sources],
        evidence:['salutation','closing',...(body.text.length>=80?['body']:[]),...(rc.selected?['recipient-email']:[]),...((body.excludedBlocks||[]).length?['tail-boundary']:[])],issues:['未找到 Subject 标记',...((body.excludedBlocks||[]).some(item=>item.role==='ambiguous-tail')?['邮件落款后存在未归类内容，已从正文隔离']:[])]};
      frame.confidence=scoreFrame(frame);
      if(!frame.recipients)frame.issues.push('未定位收件人邮箱');
      if(frame.confidence<70)frame.issues.push('邮件边界识别置信度较低');
      if(includeWeak || frame.confidence>=minConfidence)records.push(frame);
    }

    records.sort((a,b)=>a.startBlock-b.startBlock);
    records.forEach((r,i)=>{ if(!r.id)r.id=String(i+1); r.ordinal=i+1; });
    const stats={
      blocks:blocks.length,
      subjects:subjectBlocks.length,
      salutations:blocks.filter(b=>salutationAnchor(b.text)).length,
      closings:blocks.filter(b=>closeAnchor(b.text)).length,
      emails:blocks.reduce((n,b)=>n+extractEmails(b.text).length,0),
      records:records.length,
      complete:records.filter(r=>r.recipients&&r.subject&&r.body).length,
      missingRecipients:records.filter(r=>!r.recipients).length,
      averageConfidence:records.length?Math.round(records.reduce((a,r)=>a+r.confidence,0)/records.length):0,
      excludedTailBlocks:records.reduce((count,record)=>count+(record.excludedBlocks||[]).length,0)
    };
    return {records,stats,blocks};
  }

  function recognizeMailText(text,options={}) {
    const blocks=String(text??'').replace(/\r\n?/g,'\n').split(/\n+/).map(t=>({type:'text-line',text:t}));
    return recognizeMailFrames(blocks,options);
  }

  function recordsToRows(records) {
    const headers=['编号','收件人','学校 / 机构','主题','正文','附件','定时时间','任务分类','来源文件'];
    return [headers,...(records||[]).map(r=>[r.id||'',r.recipients||'',r.school||'',r.subject||'',r.body||'',r.attachments||'',r.scheduleAt||'',r.tags||'',r.sourceFile||''])];
  }

  function rowMetaFromRecords(records) {
    const meta={};
    (records||[]).forEach((r,i)=>{meta[i+1]={
      confidence:r.confidence||0,
      evidence:[...(r.evidence||[])],
      issues:[...(r.issues||[])],
      heading:r.heading||'',
      school:r.school||'',
      sourceFile:r.sourceFile||'',
      salutation:r.salutation||'',
      closing:r.closing||'',
      startBlock:r.startBlock,
      endBlock:r.endBlock,
      recipientEvidence:r.recipientEvidence?{email:r.recipientEvidence.email,index:r.recipientEvidence.index,score:r.recipientEvidence.score,text:r.recipientEvidence.text||''}:null,
      recipientCandidates:(r.recipientCandidates||[]).map(c=>({email:c.email,index:c.index,score:c.score,text:c.text||''})),
      excludedBlocks:(r.excludedBlocks||[]).map(item=>({...item})),
      sourceReferences:[...(r.sourceReferences||[])]
    };});
    return meta;
  }

  globalThis.NMDAMailRecognizer={
    EMAIL_RE, extractEmails, isNoiseBlock, subjectAnchor, salutationAnchor, closeAnchor, metadataAnchor,
    classifyBoundaryBlock, sanitizeRecognizedBody, recognizeMailFrames, recognizeMailText, recordsToRows, rowMetaFromRecords, cleanInlineMarkup, institutionFromHeading
  };
})();
