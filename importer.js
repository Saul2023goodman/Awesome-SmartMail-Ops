(() => {
  'use strict';
  const Core=globalThis.NMDAImportCore, A=globalThis.NMDAImportAdapters;
  if(!Core||!A)throw new Error('Universal Import Engine 初始化失败：核心模块未加载。');

  const PROFILE_KEY='nmda.import.profiles.v1';
  const detector=new A.FormatDetector();
  const DIRECT_ATTACHMENT_EXT=new Set(['pdf','ppt','pptx','rtf','png','jpg','jpeg','gif','webp','svg','zip','rar','7z']);

  const SOURCE_PURPOSES={mail:'mail',roster:'roster',attachment:'attachment',ignored:'ignored',ambiguous:'ambiguous'};
  const ROSTER_HEADER_PATTERNS={
    email:/^(?:邮箱|邮箱地址|导师邮箱|教授邮箱|联系邮箱|email|emailaddress|mail|contactemail)$/i,
    name:/^(?:导师|导师姓名|教授|教授姓名|姓名|老师|联系人|supervisor|professor|faculty|name|contactname)$/i,
    school:/^(?:学校|院校|大学|高校|所属学校|所属院校|机构|单位|university|school|institution|organisation|organization|affiliation)$/i,
    workflow:/^(?:批次|轮次|第几批|联系批次|发送批次|状态|联系状态|套磁状态|申请状态|优先级|排序|等级|分类|标签|分组|方向|备注|batch|round|wave|status|contactstatus|priority|rank|tier|tag|tags|category|group|notes?|remarks?)$/i
  };
  const MATERIAL_NAME_RE=/(?:^|[^a-z])(?:cv|resume)(?:[^a-z]|$)|curriculum\s+vitae|transcript|research\s+proposal|research\s+statement|teaching\s+statement|writing\s+sample|personal\s+statement|statement\s+of\s+purpose|letter\s+of\s+recommendation|recommendation\s+letter|cover\s+letter|简历|履历|成绩单|研究计划|研究陈述|教学陈述|个人陈述|目的陈述|推荐信|写作样本/i;
  const MAIL_NAME_RE=/(?:邮件|套磁(?:信|邮件)?|联系邮件|联系信|导师联系|教授联系|outreach\s*(?:mail|email)?|cold\s*email|email\s*draft|mail\s*draft)/i;
  const MATERIAL_TEXT_CUES=[/curriculum\s+vitae|\bresume\b|个人简历|学术简历/i,/education|academic\s+background|教育经历|教育背景/i,/work\s+experience|employment|工作经历/i,/research\s+experience|科研经历/i,/publications?|论文发表|代表性论文/i,/skills?|awards?|honou?rs?|技能|获奖/i,/transcript|成绩单/i,/research\s+proposal|研究计划/i];
  const MATERIAL_SECTION_CUES=[
    /^(?:个人信息|基本信息|联系方式|contact\s+information|personal\s+information)$/i,
    /^(?:教育背景|教育经历|学历背景|学历|education|academic\s+background)$/i,
    /^(?:工作经历|任职经历|employment|work\s+experience|professional\s+experience)$/i,
    /^(?:科研经历|研究经历|研究项目|项目经历|research\s+experience|research\s+projects?|projects?)$/i,
    /^(?:论文发表|发表论文|代表性论文|论文|出版物|publications?|selected\s+publications?)$/i,
    /^(?:技能|专业技能|语言技能|skills?|technical\s+skills?|languages?)$/i,
    /^(?:获奖|获奖经历|荣誉|荣誉奖项|奖项|awards?|honou?rs?)$/i,
    /^(?:研究计划|研究目标|研究问题|研究方法|预期成果|参考文献|research\s+proposal|research\s+objectives?|methodology|expected\s+outcomes?|references?)$/i,
    /^(?:个人陈述|目的陈述|研究陈述|教学陈述|推荐信|写作样本|personal\s+statement|statement\s+of\s+purpose|research\s+statement|teaching\s+statement|letter\s+of\s+recommendation|recommendation\s+letter|writing\s+sample)$/i
  ];
  const MAIL_SALUTATION_RE=/(?:^|\n)\s*(?:(?:尊敬的|敬爱的)\s*[^\n，,：:]{0,60}(?:教授|老师|博士|先生|女士)?\s*[，,：:]?|(?:[\p{L}·•]{1,30})?(?:教授|老师|博士|先生|女士)\s*[，,：:]?\s*(?:您好|好)[！!，,：:]?|您好[！!，,：:]?|(?:dear|hello|hi)\b)/iu;
  const MAIL_DIRECTED_CUES=[
    /(?:冒昧|特此)?(?:来信|写信|致信|联系您|给您写信)|向您(?:咨询|申请)|希望(?:申请|加入|攻读|有机会加入|有机会在)|申请(?:博士|硕士|研究生|ph\.?d)|在您(?:的)?指导下|对您(?:的)?(?:研究|课题|方向|工作)|您的(?:研究|课题|论文|团队)|贵(?:课题组|团队|实验室|院系|校)/iu,
    /(?:感谢您(?:的)?(?:时间|阅读|考虑|回复)|期待(?:您的回复|与您交流|有机会|进一步交流)|盼复|敬候佳音|祝(?:您)?(?:工作顺利|一切顺利|身体健康))/iu,
    /\b(?:i\s+am\s+writing|i['’]?m\s+writing|writing\s+to\s+(?:express|ask|inquire)|interested\s+in\s+(?:pursuing|joining|working)|under\s+your\s+supervision|your\s+(?:research|work|group|lab)|thank\s+you\s+for\s+your|look(?:ing)?\s+forward\s+to)\b/iu
  ];

  function formatLocalDateTime(date){if(!(date instanceof Date)||Number.isNaN(date.getTime()))return'';const p=n=>String(n).padStart(2,'0');return`${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;}
  function parseDateValue(value){return Core.parseDateLoose(value);}

  function validPurpose(value){return Object.values(SOURCE_PURPOSES).includes(String(value||''))?String(value):'';}
  function recordSetText(recordSet,limit=24000){return (recordSet?.rows||[]).slice(0,160).flatMap(row=>row||[]).map(v=>String(v??'')).join('\n').slice(0,limit);}
  function containsEmail(value){return /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i.test(String(value??''));}
  function detectMailHeader(recordSet){
    const rows=recordSet?.rows||[];let best={index:-1,fields:new Set(),mapping:{},score:0};
    for(let index=0;index<Math.min(rows.length,50);index++){
      const fields=new Set(),mapping={};
      for(let column=0;column<(rows[index]||[]).length;column++){
        const match=Core.matchHeader(rows[index][column]);
        if(!match||(match.reason!=='header-exact'&&Number(match.score||0)<92)||mapping[match.field]!=null)continue;
        fields.add(match.field);mapping[match.field]=column;
      }
      const coreCount=['recipients','subject','body'].filter(key=>fields.has(key)).length;
      const score=coreCount*150+fields.size*8-index*2;
      if(score>best.score)best={index,fields,mapping,score};
    }
    return best;
  }
  function rosterHeaderEvidence(headers){
    const found=new Set();
    for(const raw of headers||[]){const header=Core.normalizeHeader(raw);for(const [field,re] of Object.entries(ROSTER_HEADER_PATTERNS))if(re.test(header))found.add(field);}
    return found;
  }
  function detectRosterHeader(recordSet){
    const rows=recordSet?.rows||[];let best={index:-1,fields:new Set(),score:0};
    for(let index=0;index<Math.min(rows.length,50);index++){
      const fields=rosterHeaderEvidence(rows[index]||[]),identityCount=['email','name','school'].filter(key=>fields.has(key)).length;
      const score=identityCount*120+Number(fields.has('workflow'))*35+fields.size*5-index*2;
      if(score>best.score)best={index,fields,score};
    }
    return best;
  }
  function recordSetShape(recordSet,detection){
    const rows=(recordSet?.rows||[]).slice(Math.max(0,Number(detection?.index||0)+1),Math.max(0,Number(detection?.index||0)+1)+160).filter(row=>(row||[]).some(v=>String(v??'').trim()));
    const emailRows=rows.filter(row=>(row||[]).some(containsEmail)).length;
    return{rows:rows.length,emailRows,emailRatio:rows.length?emailRows/rows.length:0};
  }
  function mappedFieldHasValue(recordSet,detection,field,predicate=value=>String(value??'').trim()!==''){
    const column=detection?.mapping?.[field];if(column==null)return false;
    const start=Math.max(0,Number(detection?.index||0)+1);
    return (recordSet?.rows||[]).slice(start,start+160).some(row=>predicate(row?.[column]));
  }
  function mappedFieldText(recordSet,detection,field,limit=24000){
    const column=detection?.mapping?.[field];if(column==null)return'';
    const start=Math.max(0,Number(detection?.index||0)+1);
    return (recordSet?.rows||[]).slice(start,start+160).map(row=>String(row?.[column]??'').trim()).filter(Boolean).join('\n\n').slice(0,limit);
  }
  function normalizedSemanticLines(text){
    return String(text||'').replace(/\r\n?/g,'\n').split(/\n+/).map(line=>line.trim().replace(/^#{1,6}\s*/,'').replace(/^[>*•▪◦-]\s*/u,'').replace(/^\s*(?:[一二三四五六七八九十]+[、.．]|\d{1,2}[、.．)）])\s*/u,'').replace(/[:：]$/u,'').trim()).filter(Boolean);
  }
  function analyzeMaterialStructure(text){
    const lines=normalizedSemanticLines(text),matched=new Set();
    for(const line of lines){
      if(line.length>48)continue;
      for(let i=0;i<MATERIAL_SECTION_CUES.length;i++)if(MATERIAL_SECTION_CUES[i].test(line)){matched.add(line.toLowerCase());break;}
    }
    return{sectionCount:matched.size,sections:[...matched]};
  }
  function analyzeMailDiscourse(text){
    const body=String(text||'').trim();
    if(!body)return{score:0,strong:false,moderate:false,salutation:false,directed:0,courtesy:false,recipientMentions:0};
    const salutation=MAIL_SALUTATION_RE.test(body),directed=MAIL_DIRECTED_CUES.filter(re=>re.test(body)).length;
    const recipientMentions=(body.match(/您|贵(?:课题组|团队|实验室|院系|校)|\byou(?:r)?\b/giu)||[]).length;
    const selfIntro=/(?:^|[。！？!?.\n])\s*(?:我(?:叫|是|目前|现为|本科|硕士|博士)|本人)|\bmy\s+name\s+is\b|\bi\s+am\s+(?:a|an|currently)\b/iu.test(body);
    const courtesy=/(?:感谢您|谢谢您|期待|盼复|敬候佳音|祝(?:您)?|thank\s+you|look(?:ing)?\s+forward)/iu.test(body);
    const paragraphs=body.split(/\n\s*\n|(?<=[。！？!?])\s*\n/).map(x=>x.trim()).filter(Boolean).length;
    let score=0;
    if(salutation)score+=3;
    score+=Math.min(4,directed*2);
    if(recipientMentions>=2)score+=2;else if(recipientMentions===1)score+=1;
    if(selfIntro)score+=1;
    if(courtesy)score+=1;
    if(body.length>=100)score+=1;
    if(paragraphs>=2)score+=1;
    const strong=score>=8&&body.length>=80&&(salutation||recipientMentions>=2)&&directed>=1;
    const moderate=score>=6&&body.length>=60&&(salutation||recipientMentions>=1)&&directed>=1;
    return{score,strong,moderate,salutation,directed,courtesy,recipientMentions,selfIntro,paragraphs,length:body.length};
  }
  function sourceRoleCandidates(recordSet,detection){
    const meta=recordSet?.meta||{},mailHeader=detectMailHeader(recordSet),mailFields=mailHeader.fields,headers=detection?.headers||[],rosterHeader=detectRosterHeader(recordSet),generatedEnvelope=!!meta.wordTaskRows&&!meta.mailFrames;
    let hasRecipient=mailFields.has('recipients'),hasSubject=mailFields.has('subject'),hasBody=mailFields.has('body');
    if(generatedEnvelope){
      hasRecipient=hasRecipient&&mappedFieldHasValue(recordSet,mailHeader,'recipients',containsEmail);
      hasSubject=hasSubject&&mappedFieldHasValue(recordSet,mailHeader,'subject');
      hasBody=hasBody&&mappedFieldHasValue(recordSet,mailHeader,'body',value=>String(value??'').trim().length>=20);
    }
    const sourceName=`${recordSet?.source||''} ${recordSet?.name||''}`,text=recordSetText(recordSet);
    const bodyText=mappedFieldText(recordSet,mailHeader,'body')||text;
    const materialName=MATERIAL_NAME_RE.test(sourceName),mailName=MAIL_NAME_RE.test(sourceName),materialCues=MATERIAL_TEXT_CUES.filter(re=>re.test(bodyText)).length;
    const materialStructure=analyzeMaterialStructure(bodyText),mailDiscourse=analyzeMailDiscourse(bodyText);
    const rosterFields=rosterHeader.fields.size?rosterHeader.fields:rosterHeaderEvidence(headers),identityCount=['email','name','school'].filter(key=>rosterFields.has(key)).length;
    const shape=recordSetShape(recordSet,identityCount>=2&&rosterHeader.index>=0?{index:rosterHeader.index}:detection);
    const scan=meta.mailScan||{},frameSignals=['subjects','salutations','closings','emails'].filter(key=>Number(scan[key]||0)>0).length;
    const frameConfidence=Number(scan.averageConfidence||0),verifiedFrames=!!meta.mailFrames&&Number(scan.records||0)>0&&frameSignals>=2&&frameConfidence>=55;
    const candidates={
      mail:{score:0,reasons:[]},roster:{score:0,reasons:[]},attachment:{score:0,reasons:[]},ignored:{score:0,reasons:[]}
    };
    const add=(purpose,score,reason)=>{if(score>candidates[purpose].score)candidates[purpose].score=score;if(reason&&!candidates[purpose].reasons.includes(reason))candidates[purpose].reasons.push(reason);};

    // Mail intent must be demonstrated by message structure or source-authored mail
    // columns. Text such as “education” or “publications” inside a real outreach mail
    // is content, not evidence that the whole document is an attachment.
    if(verifiedFrames){
      add('mail',Math.min(100,86+Math.round(frameConfidence*.12)+(Number(scan.complete||0)>0?4:0)),`识别到 ${scan.records} 封具有主题/称呼/落款边界的邮件`);
    }
    // oneFileTask uses adapter-generated standard columns as a neutral envelope;
    // those column names were not present in the user's document and prove nothing.
    if(!meta.oneFileTask&&(!generatedEnvelope||hasSubject)){
      if(hasRecipient&&hasSubject&&hasBody)add('mail',100,'表头明确包含收件人、主题和正文');
      else if(hasRecipient&&(hasSubject||hasBody))add('mail',96,`表头明确包含收件人和${hasSubject?'主题':'正文'}`);
      else if(hasSubject&&hasBody)add('mail',92,'表头明确包含主题和正文');
    }
    // Free-form Word mail often has no literal Subject/Recipient labels, especially in Chinese.
    // Classify by communicative intent (salutation + recipient-directed request + courtesy),
    // not by academic vocabulary that can legitimately appear inside the mail body.
    if(meta.oneFileTask&&(!materialName||mailName)){
      if(mailDiscourse.strong)add('mail',mailName?97:94,`正文具有明确邮件交际结构（称呼、面向收件人的联系意图与礼貌收束）`);
      else if(mailDiscourse.moderate)add('mail',mailName?92:84,'正文具有较强的收件人导向邮件语篇特征');
    }

    // A roster is a repeated identity table. Email density and long research notes do
    // not turn it into a mail batch when subject/body columns are absent.
    if(identityCount>=3)add('roster',98,`表头包含姓名、邮箱和院校，形成联系人表`);
    else if(identityCount===2)add('roster',94,`表头包含 ${[rosterFields.has('name')?'姓名':'',rosterFields.has('email')?'邮箱':'',rosterFields.has('school')?'院校':''].filter(Boolean).join('、')}`);
    else if(identityCount===1&&rosterFields.has('workflow'))add('roster',74,'包含联系人身份字段和批次/状态字段');
    if(identityCount>=2&&shape.rows>=2){add('roster',Math.min(100,candidates.roster.score+2),`包含 ${shape.rows} 条重复联系人记录`);}
    if(identityCount>=2&&shape.emailRatio>=.5){add('roster',Math.min(100,candidates.roster.score+1),'多数记录包含联系人邮箱');}
    if(hasSubject||hasBody)candidates.roster.score=Math.max(0,candidates.roster.score-(hasSubject&&hasBody?38:22));

    // Attachments are deliverables, not every readable Word document. Filename and
    // CV/proposal content cues become decisive only when no strong mail frame/columns
    // exist; this prevents a mail mentioning the sender's CV from being swallowed.
    if(materialName&&materialStructure.sectionCount>=1)add('attachment',99,'文件名与材料章节结构共同表明这是需发送的文档资产');
    else if(materialName)add('attachment',94,'文件名明确指向简历、成绩单、研究计划等材料');
    else if(meta.oneFileTask&&materialStructure.sectionCount>=3)add('attachment',96,`识别到 ${materialStructure.sectionCount} 类独立材料章节`);
    else if(meta.oneFileTask&&materialStructure.sectionCount>=2)add('attachment',88,`识别到 ${materialStructure.sectionCount} 类材料章节结构`);
    else if(meta.wordTaskRows&&meta.kind==='records'&&materialStructure.sectionCount>=3)add('attachment',86,`字段文档包含 ${materialStructure.sectionCount} 类材料章节`);
    else if(meta.oneFileTask&&materialCues>=4)add('attachment',66,`正文提到 ${materialCues} 类申请材料概念，但缺少材料章节结构，仅作为弱线索`);
    else if(meta.oneFileTask&&materialCues>=2)add('attachment',52,`正文提到 ${materialCues} 类申请材料概念，仅作为弱线索`);
    if(candidates.mail.score>=92&&(!materialName||mailName))candidates.attachment.score=Math.min(candidates.attachment.score,72);

    if(meta.supplemental)add('ignored',100,'已有更可靠的邮件识别结果，原始结构仅作解析依据');
    else if(meta.oneFileTask&&!candidates.mail.score&&!candidates.attachment.score)add('ignored',45,'普通文档缺少可验证的邮件、名单或附件结构');
    return{candidates,mailFields,mailHeader,hasRecipient,hasSubject,hasBody,generatedEnvelope,rosterFields,rosterHeader,identityCount,materialName,mailName,materialCues,materialStructure,mailDiscourse,verifiedFrames,shape};
  }
  function classifyRecordSet(recordSet,{forcedPurpose=''}={}){
    const meta=recordSet?.meta||{},forced=validPurpose(forcedPurpose||meta.purposeOverride);
    if(forced)return{purpose:forced,confidence:100,reasons:['来源已明确指定用途']};
    const detection=Core.detectHeader(recordSet?.rows||[]),evidence=sourceRoleCandidates(recordSet,detection),ranked=Object.entries(evidence.candidates).map(([purpose,value])=>({purpose,...value})).sort((a,b)=>b.score-a.score);
    const top=ranked[0],runner=ranked[1],gap=Number(top?.score||0)-Number(runner?.score||0);

    // Explicit mail fields and complete identity tables are deterministic business
    // contracts. Otherwise require both a usable score and separation from the next
    // candidate; uncertain documents stay out of every automatic pipeline.
    const explicitMail=!meta.oneFileTask&&(evidence.generatedEnvelope
      ? evidence.hasSubject&&(evidence.hasRecipient||evidence.hasBody)
      : evidence.hasRecipient&&(evidence.hasSubject||evidence.hasBody));
    const explicitRoster=evidence.identityCount>=2&&!evidence.hasSubject&&!evidence.hasBody;
    const explicitAttachment=evidence.materialName&&!evidence.mailName&&!explicitMail;
    let selected=top;
    if(meta.supplemental)selected={purpose:SOURCE_PURPOSES.ignored,...evidence.candidates.ignored};
    else if(explicitMail)selected={purpose:SOURCE_PURPOSES.mail,...evidence.candidates.mail};
    else if(explicitAttachment)selected={purpose:SOURCE_PURPOSES.attachment,...evidence.candidates.attachment};
    else if(explicitRoster&&!evidence.verifiedFrames)selected={purpose:SOURCE_PURPOSES.roster,...evidence.candidates.roster};
    else if(!top||top.score<70||gap<8)return{purpose:SOURCE_PURPOSES.ambiguous,confidence:Math.max(35,Number(top?.score||0)),reasons:['邮件、总名单和附件证据不足或互相冲突，已停止自动分流'],candidates:ranked};
    return{purpose:selected.purpose,confidence:Math.max(0,Math.min(100,Number(selected.score||0))),reasons:selected.reasons?.length?selected.reasons:['已按来源结构完成用途判断'],candidates:ranked};
  }

  function annotateRecordSet(recordSet,options={}){
    const result=classifyRecordSet(recordSet,options);
    recordSet.meta={...(recordSet.meta||{}),sourcePurpose:result.purpose,purposeConfidence:result.confidence,purposeReasons:result.reasons};
    return result;
  }
  function recordSetSources(recordSet){const members=recordSet?.meta?.sourceMembers;return members?.length?[...members]:[recordSet?.source||recordSet?.name||'未命名来源'];}
  function summarizeSourceRouting(recordSets,sourceFiles=[]){
    const bySource=new Map();
    const touch=name=>{const key=String(name||'未命名来源');if(!bySource.has(key))bySource.set(key,{source:key,purposes:{mail:0,roster:0,attachment:0,ignored:0,ambiguous:0},recordSets:0,reasons:[]});return bySource.get(key);};
    for(const file of sourceFiles||[])touch(file?._nmdaPath||file?.webkitRelativePath||file?.name);
    for(const rs of recordSets||[])for(const source of recordSetSources(rs)){const item=touch(source),purpose=validPurpose(rs.meta?.sourcePurpose)||SOURCE_PURPOSES.ambiguous;item.purposes[purpose]++;item.recordSets++;item.reasons.push(...(rs.meta?.purposeReasons||[]));}
    return[...bySource.values()].map(item=>({...item,reasons:[...new Set(item.reasons)].slice(0,4)}));
  }
  function prepareDataset(dataset){
    const sets=dataset?.recordSets||dataset?.sheets||[];
    for(const rs of sets)annotateRecordSet(rs);
    const routing=summarizeSourceRouting(sets,dataset?.sourceFiles||[]),attachmentSources=new Set(routing.filter(item=>item.purposes.attachment>0&&!item.purposes.mail&&!item.purposes.roster).map(item=>item.source));
    const routedAttachments=(dataset?.sourceFiles||[]).filter(file=>attachmentSources.has(String(file?._nmdaPath||file?.webkitRelativePath||file?.name||'')));
    dataset.meta={...(dataset.meta||{}),sourceRouting:routing};
    dataset.routedFiles={...(dataset.routedFiles||{}),attachments:routedAttachments};
    return dataset;
  }
  function directAttachmentFile(file){return DIRECT_ATTACHMENT_EXT.has(A.extOf(file?.name))&&A.extOf(file?.name)!=='zip';}
  function attachmentRecordSet(file){return new Core.NormalizedRecordSet({name:`附件候选 · ${file?.name||'未命名文件'}`,rows:[['文件名','用途'],[file?.name||'','附件候选']],source:file?.name||'',meta:{kind:'asset',purposeOverride:SOURCE_PURPOSES.attachment}});}
  function unreadableRecordSet(file,error){return new Core.NormalizedRecordSet({name:`暂不使用 · ${file?.name||'未命名文件'}`,rows:[['文件名','读取结果'],[file?.name||'',error?.message||'无法读取']],source:file?.name||'',meta:{kind:'unreadable',purposeOverride:SOURCE_PURPOSES.ignored}});}


  function mergeWordTaskRecordSets(recordSets,{namePrefix='Word文档批次',source='multi-word',packageMode=false}={}){
    const candidates=(recordSets||[]).filter(rs=>rs.meta?.wordTaskRows && rs.meta?.sourcePurpose===SOURCE_PURPOSES.mail && !rs.meta?.supplemental);
    if(candidates.length<2)return false;
    const header=['编号','收件人','学校 / 机构','主题','正文','附件','定时时间','任务标记','来源文件'],rows=[header],rowMeta={};
    let mailFrameCount=0, confidenceTotal=0, confidenceCount=0, scanBlocks=0, scanSubjects=0, scanSalutations=0, scanClosings=0, scanEmails=0;
    for(const rs of candidates){
      const d=Core.detectHeader(rs.rows||[]);
      for(let rowIndex=d.index+1;rowIndex<(rs.rows||[]).length;rowIndex++){
        const row=rs.rows[rowIndex]; if(!row?.some(v=>String(v??'').trim()))continue;
        rows.push(header.map((_,i)=>row[i]??''));
        const meta=rs.meta?.rowMeta?.[rowIndex]; if(meta)rowMeta[rows.length-1]={...meta};
      }
      if(rs.meta?.mailFrames){
        mailFrameCount++;
        const scan=rs.meta?.mailScan||{};scanBlocks+=Number(scan.blocks||0);scanSubjects+=Number(scan.subjects||0);scanSalutations+=Number(scan.salutations||0);scanClosings+=Number(scan.closings||0);scanEmails+=Number(scan.emails||0);
        for(const meta of Object.values(rs.meta?.rowMeta||{})){if(Number(meta?.confidence)>0){confidenceTotal+=Number(meta.confidence);confidenceCount++;}}
      }
    }
    for(let i=recordSets.length-1;i>=0;i--)if(candidates.includes(recordSets[i]))recordSets.splice(i,1);
    const dataRows=rows.slice(1), mailScan=mailFrameCount?{blocks:scanBlocks,subjects:scanSubjects,salutations:scanSalutations,closings:scanClosings,emails:scanEmails,records:dataRows.length,complete:dataRows.filter(r=>String(r[1]||'').trim()&&String(r[2]||'').trim()&&String(r[3]||'').trim()).length,missingRecipients:dataRows.filter(r=>!String(r[1]||'').trim()).length,averageConfidence:confidenceCount?Math.round(confidenceTotal/confidenceCount):0}:null;
    recordSets.unshift(new Core.NormalizedRecordSet({name:`${namePrefix}（${rows.length-1} 条）`,rows,source,meta:{word:true,merged:true,wordTaskRows:true,preferred:true,package:packageMode,mailFrames:mailFrameCount>0,rowMeta,sourcePurpose:SOURCE_PURPOSES.mail,purposeConfidence:96,purposeReasons:['仅合并已确认为邮件的 Word 来源'],sourceMembers:[...new Set(candidates.flatMap(recordSetSources))],...(mailScan?{mailScan}: {})}}));
    return true;
  }

  class UniversalImportEngine{
    constructor({registry=A.registry, detectorInstance=detector}={}){this.registry=registry;this.detector=detectorInstance;}

    async parseFile(file,{allowZipBatch=true}={}){
      if(!file)throw new Error('没有选择导入文件。');
      const buffer=await file.arrayBuffer(), detection=await this.detector.detect(file,buffer);
      if(detection.format==='xls')throw new Error('已识别为旧版 Excel .xls（OLE/BIFF）。当前通用引擎尚未启用二进制 XLS Adapter；请另存为 XLSX/ODS/CSV。');
      if(detection.format==='doc')throw new Error('已识别为旧版 Word .doc（二进制 OLE）。WordAdapter 当前支持 DOCX/DOCM/DOTX；请在 Word/WPS 中另存为 .docx 后批量导入。');
      if(detection.format==='zip'){
        if(!allowZipBatch)throw new Error('ZIP 内再次嵌套 ZIP 暂不支持。');
        return this.parseZipBatch(file,buffer,detection.entries||await A.unzip(buffer));
      }
      const adapter=this.registry.find(detection.format) || this.registry.find(detection.container==='text'?'text':detection.format);
      if(!adapter)throw new Error(`已识别格式“${detection.format}”，但当前没有对应 Adapter。`);
      const result=await adapter.parse({file,buffer,detection,engine:this});
      result.meta={...(result.meta||{}), detection, adapter:adapter.name};
      return prepareDataset(result);
    }

    async parseFiles(files,{ignoreUnsupported=false}={}){
      const list=[...(files||[])].filter(Boolean);if(!list.length)throw new Error('没有选择数据文件。');
      const recordSets=[],sourceFiles=[],embeddedFiles=[],warnings=[],formats=[];
      for(const file of list){
        if(directAttachmentFile(file)){sourceFiles.push(file);formats.push('attachment');recordSets.push(attachmentRecordSet(file));continue;}
        try{
          const ds=await this.parseFile(file); formats.push(ds.format); sourceFiles.push(...(ds.sourceFiles||[file])); embeddedFiles.push(...(ds.embeddedFiles||[])); warnings.push(...(ds.warnings||[]));
          for(const rs of ds.sheets||[]){const prefix=list.length>1?`${file.name} · `:'';recordSets.push(new Core.NormalizedRecordSet({name:`${prefix}${rs.name}`,rows:rs.rows,source:file.name,meta:{...(rs.meta||{}),format:ds.format}}));}
        }catch(error){
          if(MATERIAL_NAME_RE.test(String(file?.name||''))){sourceFiles.push(file);formats.push('attachment');recordSets.push(attachmentRecordSet(file));warnings.push(`${file.name}: 无法解析文档内容，已保守放入附件候选（${error.message}）`);continue;}
          if(ignoreUnsupported||list.length>1){sourceFiles.push(file);formats.push('unreadable');recordSets.push(unreadableRecordSet(file,error));warnings.push(`${file.name}: 读取失败，已隔离为“暂不使用”，不影响其他来源（${error.message}）`);continue;}throw error;
        }
      }
      // 多个“一文件一封”/字段式 Word/邮件原语集合自动合并，并保留逐条识别证据。
      if(list.length>1)mergeWordTaskRecordSets(recordSets,{source:'multi-word'});
      if(!recordSets.length)throw new Error(warnings.length?`没有成功读取的数据文件。${warnings[0]}`:'没有可读取的数据。');
      return prepareDataset(new Core.NormalizedDataset({format:[...new Set(formats)].join('+')||'multi',recordSets,sourceFiles,embeddedFiles,warnings,meta:{multiFile:list.length>1}}));
    }

    async parseDirectory(files){
      const candidates=[...(files||[])].filter(file=>A.candidateDataFile(file)||directAttachmentFile(file));if(!candidates.length)throw new Error('所选目录中没有支持的邮件资料或附件。');
      return this.parseFiles(candidates,{ignoreUnsupported:true});
    }

    async parseZipBatch(zipFile,buffer,entries){
      const warnings=[],embeddedFiles=[];let manifest=null;
      const manifestBytes=entries.get('manifest.json')||entries.get('nmda-manifest.json');
      if(manifestBytes){try{manifest=JSON.parse(A.decodeText(manifestBytes));}catch(e){throw new Error(`ZIP manifest.json 无法解析：${e.message}`);}}
      const names=[...entries.keys()].filter(n=>n&&!n.endsWith('/')&&!n.startsWith('__MACOSX/'));
      let taskNames=[];
      if(manifest?.taskFile){const exact=String(manifest.taskFile).replace(/^\.\//,'');if(!entries.has(exact))throw new Error(`ZIP manifest 指定的任务文件不存在：${exact}`);taskNames=[exact];}
      else taskNames=names.filter(n=>A.SUPPORTED_EXT.has(A.extOf(n))&&A.extOf(n)!=='zip'&&!/^manifest\.json$/i.test(n));
      if(!taskNames.length)throw new Error('ZIP 中没有找到任务数据文件。建议包含 manifest.json + tasks.xlsx/csv/json/docx。');
      const recordSets=[],sourceFiles=[];
      for(const name of taskNames){const bytes=entries.get(name),vf=A.makeVirtualFile(name,bytes);try{const ds=await this.parseFile(vf,{allowZipBatch:false});sourceFiles.push(vf);for(const rs of ds.sheets)recordSets.push(new Core.NormalizedRecordSet({name:`${name} · ${rs.name}`,rows:rs.rows,source:name,meta:{...(rs.meta||{}),package:true,format:ds.format}}));}catch(e){warnings.push(`${name}: ${e.message}`);}}
      mergeWordTaskRecordSets(recordSets,{source:zipFile.name,packageMode:true});
      const taskSet=new Set(taskNames);
      const attachmentRoot=String(manifest?.attachmentRoot||'').replace(/^\.\//,'').replace(/\/+$/,'');
      for(const name of names){if(taskSet.has(name)||/^manifest\.json$/i.test(name))continue;if(attachmentRoot&&!(name===attachmentRoot||name.startsWith(`${attachmentRoot}/`)))continue;embeddedFiles.push(A.makeVirtualFile(name,entries.get(name)));}
      if(!recordSets.length)throw new Error(`ZIP 中的任务文件均解析失败：${warnings[0]||'未知原因'}`);
      return prepareDataset(new Core.NormalizedDataset({format:'nmda-zip',recordSets,sourceFiles:[zipFile,...sourceFiles],embeddedFiles,warnings,meta:{manifest,package:true}}));
    }
  }

  const engine=new UniversalImportEngine();

  async function parseFile(file){return engine.parseFile(file);}
  async function parseFiles(files){return engine.parseFiles(files);}
  async function parseDirectory(files){return engine.parseDirectory(files);}

  function createProfile({name='',format='',collectionName='',sheetName='',headers=[],mapping={},confidence={}}={}){
    const sourceCollection = collectionName || sheetName || '';
    return {id:`profile_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,name:name||`导入模板 ${new Date().toLocaleDateString()}`,format,collectionName:sourceCollection,sheetName:sourceCollection,headers:[...headers],normalizedHeaders:headers.map(Core.normalizeHeader),mapping:{...mapping},confidence:{...confidence},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  }
  function loadProfiles(){try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'[]').filter(x=>x&&x.id);}catch(_){return[];}}
  function saveProfile(profile){const all=loadProfiles(),i=all.findIndex(x=>x.id===profile.id),next={...profile,updatedAt:new Date().toISOString()};if(i>=0)all[i]=next;else all.push(next);localStorage.setItem(PROFILE_KEY,JSON.stringify(all.slice(-50)));return next;}
  function deleteProfile(id){const all=loadProfiles().filter(x=>x.id!==id);localStorage.setItem(PROFILE_KEY,JSON.stringify(all));}
  function suggestProfile({format='',headers=[]}={}){const target={format,headers};return loadProfiles().map(p=>({profile:p,score:Core.profileSimilarity(p,target)})).sort((a,b)=>b.score-a.score)[0]||null;}

  function splitAttachments(value){return String(value??'').split(/[;；|\n]+/).map(v=>v.trim()).filter(Boolean);}
  function normalizeFileKey(value){return String(value??'').normalize('NFKC').trim().replace(/\\/g,'/').replace(/^\.\//,'').replace(/^\/+/, '').replace(/\/{2,}/g,'/').toLowerCase();}
  function baseName(value){const key=normalizeFileKey(value);return key.split('/').filter(Boolean).pop()||'';}
  function relaxedFileName(value){const name=baseName(value),dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';return`${stem.replace(/\s*[（(]\d+[）)]\s*$/,'').trim()}${ext}`;}
  function filePath(file){return file?.webkitRelativePath||file?._nmdaPath||file?.name||'';}
  function fileIdentity(file){return`${normalizeFileKey(filePath(file))}|${Number(file?.size||0)}|${Number(file?.lastModified||0)}`;}
  function addIndex(map,key,file){if(!key)return;if(!map.has(key))map.set(key,[]);const list=map.get(key);if(!list.some(x=>fileIdentity(x)===fileIdentity(file)))list.push(file);}
  function buildFileIndex(files){const exact=new Map(),byName=new Map(),relaxedByName=new Map(),unique=new Map();for(const file of files||[]){if(!file)continue;unique.set(fileIdentity(file),file);const relative=normalizeFileKey(filePath(file)),withoutRoot=relative.includes('/')?relative.split('/').slice(1).join('/'):'';for(const path of [file.name,relative,withoutRoot].filter(Boolean).map(normalizeFileKey))addIndex(exact,path,file);const name=baseName(file.name);addIndex(byName,name,file);addIndex(relaxedByName,relaxedFileName(name),file);}return{exact,byName,relaxedByName,files:[...unique.values()]};}
  function resolveOneFile(ref,index){const key=normalizeFileKey(ref);if(!key)return{ref,status:'missing',candidates:[],method:'empty'};let matches=index?.exact?.get(key)||[];if(matches.length===1)return{ref,status:'matched',file:matches[0],candidates:matches,method:'exact'};if(matches.length>1)return{ref,status:'ambiguous',candidates:matches,method:'exact'};const basename=baseName(key);matches=index?.byName?.get(basename)||[];if(matches.length===1)return{ref,status:'matched',file:matches[0],candidates:matches,method:'basename'};if(matches.length>1)return{ref,status:'ambiguous',candidates:matches,method:'basename'};const relaxed=relaxedFileName(basename);matches=index?.relaxedByName?.get(relaxed)||[];if(matches.length===1)return{ref,status:'matched',file:matches[0],candidates:matches,method:'relaxed-copy-suffix'};if(matches.length>1)return{ref,status:'ambiguous',candidates:matches,method:'relaxed-copy-suffix'};return{ref,status:'missing',candidates:[],method:'none'};}
  function candidateScore(ref,file){const w=baseName(ref),a=baseName(file?.name);if(!w||!a)return 0;if(w===a)return 100;if(relaxedFileName(w)===relaxedFileName(a))return 90;const ws=w.replace(/\.[^.]+$/,''),as=a.replace(/\.[^.]+$/,'');if(ws&&as&&(ws.includes(as)||as.includes(ws)))return 65;const t=new Set(ws.split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>1)),o=new Set(as.split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>1));let overlap=0;for(const x of t)if(o.has(x))overlap++;return overlap?30+Math.min(30,overlap*10):0;}
  function suggestFiles(ref,index,limit=12){return[...(index?.files||[])].map(file=>({file,score:candidateScore(ref,file)})).sort((a,b)=>b.score-a.score||String(a.file.name).localeCompare(String(b.file.name))).slice(0,Math.max(1,limit));}
  function resolveFiles(refs,index){const files=[],missing=[],ambiguous=[],details=[];for(const ref of refs||[]){const d=resolveOneFile(ref,index||buildFileIndex([]));details.push(d);if(d.status==='matched')files.push(d.file);else if(d.status==='missing')missing.push(ref);else ambiguous.push(ref);}return{files,missing,ambiguous,details};}

  globalThis.NMDAImporter={
    version:'1.40.0', engine, UniversalImportEngine,
    FIELD_DEFS:Core.FIELD_DEFS, normalizeHeader:Core.normalizeHeader, mappingForHeaders:Core.mappingForHeaders,
    detectHeader:Core.detectHeader, detectBestSheet:Core.detectBestSheet, detectBestRecordSet:Core.detectBestRecordSet, parseFile, parseFiles, parseDirectory,
    parseDateValue,formatLocalDateTime,createProfile,loadProfiles,saveProfile,deleteProfile,suggestProfile,
    splitAttachments,normalizeFileKey,relaxedFileName,fileIdentity,buildFileIndex,resolveOneFile,suggestFiles,resolveFiles,
    supportedFormats:['XLSX','ODS','FODS','DOCX/DOCM/DOTX','CSV','TSV','PSV','TXT','JSON','JSONL/NDJSON','HTML table','Excel 2003 XML','ZIP batch'],
    candidateDataFile:A.candidateDataFile,directAttachmentFile,
    SOURCE_PURPOSES,sourceRoleCandidates,detectMailHeader,detectRosterHeader,analyzeMailDiscourse,analyzeMaterialStructure,classifyRecordSet,annotateRecordSet,summarizeSourceRouting,prepareDataset,mergeWordTaskRecordSets
  };
})();
