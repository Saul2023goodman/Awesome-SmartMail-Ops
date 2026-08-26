(() => {
  'use strict';
  const Core=globalThis.NMDAImportCore, A=globalThis.NMDAImportAdapters;
  if(!Core||!A)throw new Error('Universal Import Engine 初始化失败：核心模块未加载。');

  const PROFILE_KEY='nmda.import.profiles.v1';
  const detector=new A.FormatDetector();

  function formatLocalDateTime(date){if(!(date instanceof Date)||Number.isNaN(date.getTime()))return'';const p=n=>String(n).padStart(2,'0');return`${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;}
  function parseDateValue(value){return Core.parseDateLoose(value);}


  function mergeWordTaskRecordSets(recordSets,{namePrefix='Word文档批次',source='multi-word',packageMode=false}={}){
    const candidates=(recordSets||[]).filter(rs=>rs.meta?.wordTaskRows && !rs.meta?.supplemental);
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
    recordSets.unshift(new Core.NormalizedRecordSet({name:`${namePrefix}（${rows.length-1} 条）`,rows,source,meta:{word:true,merged:true,wordTaskRows:true,preferred:true,package:packageMode,mailFrames:mailFrameCount>0,rowMeta,...(mailScan?{mailScan}: {})}}));
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
      return result;
    }

    async parseFiles(files,{ignoreUnsupported=false}={}){
      const list=[...(files||[])].filter(Boolean);if(!list.length)throw new Error('没有选择数据文件。');
      const recordSets=[],sourceFiles=[],embeddedFiles=[],warnings=[],formats=[];
      for(const file of list){
        try{
          const ds=await this.parseFile(file); formats.push(ds.format); sourceFiles.push(...(ds.sourceFiles||[file])); embeddedFiles.push(...(ds.embeddedFiles||[])); warnings.push(...(ds.warnings||[]));
          for(const rs of ds.sheets||[]){const prefix=list.length>1?`${file.name} · `:'';recordSets.push(new Core.NormalizedRecordSet({name:`${prefix}${rs.name}`,rows:rs.rows,source:file.name,meta:{...(rs.meta||{}),format:ds.format}}));}
        }catch(error){if(ignoreUnsupported){warnings.push(`${file.name}: ${error.message}`);continue;}throw error;}
      }
      // 多个“一文件一封”/字段式 Word/邮件原语集合自动合并，并保留逐条识别证据。
      if(list.length>1)mergeWordTaskRecordSets(recordSets,{source:'multi-word'});
      if(!recordSets.length)throw new Error(warnings.length?`没有成功读取的数据文件。${warnings[0]}`:'没有可读取的数据。');
      return new Core.NormalizedDataset({format:[...new Set(formats)].join('+')||'multi',recordSets,sourceFiles,embeddedFiles,warnings,meta:{multiFile:list.length>1}});
    }

    async parseDirectory(files){
      const candidates=[...(files||[])].filter(A.candidateDataFile);if(!candidates.length)throw new Error('所选目录中没有支持的数据文件。');
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
      return new Core.NormalizedDataset({format:'nmda-zip',recordSets,sourceFiles:[zipFile,...sourceFiles],embeddedFiles,warnings,meta:{manifest,package:true}});
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
    version:'1.11.0', engine, UniversalImportEngine,
    FIELD_DEFS:Core.FIELD_DEFS, normalizeHeader:Core.normalizeHeader, mappingForHeaders:Core.mappingForHeaders,
    detectHeader:Core.detectHeader, detectBestSheet:Core.detectBestSheet, detectBestRecordSet:Core.detectBestRecordSet, parseFile, parseFiles, parseDirectory,
    parseDateValue,formatLocalDateTime,createProfile,loadProfiles,saveProfile,deleteProfile,suggestProfile,
    splitAttachments,normalizeFileKey,relaxedFileName,fileIdentity,buildFileIndex,resolveOneFile,suggestFiles,resolveFiles,
    supportedFormats:['XLSX','ODS','FODS','DOCX/DOCM/DOTX','CSV','TSV','PSV','TXT','JSON','JSONL/NDJSON','HTML table','Excel 2003 XML','ZIP batch'],
    candidateDataFile:A.candidateDataFile
  };
})();
