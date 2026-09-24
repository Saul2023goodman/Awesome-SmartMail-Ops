(() => {
  'use strict';

  const Importer = globalThis.NMDAImporter;

function uniqueFiles(files) {
    const map = new Map();
    for (const file of files || []) {
      if (!file) continue;
      const key = Importer.fileIdentity(file);
      if (!map.has(key)) map.set(key, file);
    }
    return [...map.values()];
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
    const oldSets=[...(existing.recordSets||[])];
    const seen=new Set(oldSets.map(recordSetImportKey));
    const added=[];
    for(const set of (incoming.recordSets||[])){
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

function importedScheduleEvidence(collection, detection, row, getValue) {
    const core=globalThis.NMDAImportCore;
    const headers=collection?.rows?.[detection?.index] || [];
    const normalize=value=>core.normalizeHeader(value);
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
    if(result.failures)warnings.push(`${result.failures} 封草稿详情读取不完整，已保留在审阅邮件中。`);
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

  globalThis.NMDAImportDomain = Object.freeze({ uniqueFiles, mergeImportedDatasets, importedScheduleEvidence, mailboxDraftDataset });
})();
