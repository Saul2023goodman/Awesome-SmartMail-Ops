const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=__dirname;
vm.runInThisContext(fs.readFileSync(path.join(root,'import-core.js'),'utf8'),{filename:'import-core.js'});
globalThis.NMDAImportAdapters={
  FormatDetector:class{},
  registry:{find(){return null;}},
  candidateDataFile(file){return /\.(?:csv|docx|xlsx|txt|zip)$/i.test(String(file?.name||''));},
  extOf(name){return String(name||'').toLowerCase().match(/\.([^.\\/]+)$/)?.[1]||'';},
  SUPPORTED_EXT:new Set(),
  makeVirtualFile(name){return{name};}
};
vm.runInThisContext(fs.readFileSync(path.join(root,'importer.js'),'utf8'),{filename:'importer.js'});

const Core=globalThis.NMDAImportCore,Importer=globalThis.NMDAImporter;
const rs=(name,rows,meta={},source=name)=>new Core.NormalizedRecordSet({name,rows,source,meta});

{
  const result=Importer.classifyRecordSet(rs('recognized mail',[['编号','收件人','主题','正文'],['1','a@example.edu','Hello','Body']],{mailFrames:true,mailScan:{averageConfidence:87}}));
  assert.equal(result.purpose,'mail');
  assert(result.confidence>=92);
}

{
  const result=Importer.classifyRecordSet(rs('mail table',[['收件人','主题','正文'],['a@example.edu','PhD inquiry','Dear Professor...']]));
  assert.equal(result.purpose,'mail','explicit mail headers must qualify as mail');
}

{
  const roster=rs('faculty roster',[['导师姓名','学校','邮箱','批次','状态'],['Ada Smith','Example University','ada@example.edu','第一批','未联系']]);
  const result=Importer.classifyRecordSet(roster);
  assert.equal(result.purpose,'roster','roster headers must not be inferred as mail fields');
}

{
  const cv=rs('Word文档任务',[['编号','收件人','学校 / 机构','主题','正文'],['Alice-CV','','','','Curriculum Vitae\nEducation\nResearch Experience\nPublications']],{word:true,wordTaskRows:true,oneFileTask:true},'Alice_CV.docx');
  const result=Importer.classifyRecordSet(cv);
  assert.equal(result.purpose,'attachment','CV should enter the attachment candidate pool');
}

{
  const notes=rs('Word文档任务',[['编号','收件人','学校 / 机构','主题','正文'],['meeting-notes','','','','Discussion notes without an email frame.']],{word:true,wordTaskRows:true,oneFileTask:true},'meeting-notes.docx');
  const result=Importer.classifyRecordSet(notes);
  assert.equal(result.purpose,'ambiguous','unstructured documents must not silently become mail');
}

{
  const mail1=rs('mail 1',[['编号','收件人','学校 / 机构','主题','正文'],['1','a@example.edu','','A','Body A']],{word:true,wordTaskRows:true,sourcePurpose:'mail'},'mail-a.docx');
  const mail2=rs('mail 2',[['编号','收件人','学校 / 机构','主题','正文'],['2','b@example.edu','','B','Body B']],{word:true,wordTaskRows:true,sourcePurpose:'mail'},'mail-b.docx');
  const cv=rs('cv',[['编号','收件人','学校 / 机构','主题','正文'],['cv','','','','Education']],{word:true,wordTaskRows:true,oneFileTask:true,sourcePurpose:'attachment'},'cv.docx');
  const sets=[mail1,cv,mail2];
  assert.equal(Importer.mergeWordTaskRecordSets(sets),true);
  assert.equal(sets.length,2,'only the two mail sets should be merged');
  assert.equal(sets[0].meta.sourcePurpose,'mail');
  assert.equal(sets[0].rows.length,3);
  assert.equal(sets[1].meta.sourcePurpose,'attachment');
}

(async()=>{
  const engine=new Importer.UniversalImportEngine();
  engine.parseFile=async file=>new Core.NormalizedDataset({format:'csv',sourceFiles:[file],recordSets:[rs(file.name,[['收件人','主题','正文'],['a@example.edu','Hello','Body']],{},file.name)]});
  const mail={name:'tasks.csv',size:20,lastModified:1};
  const pdf={name:'Alice_CV.pdf',size:200,lastModified:1};
  const mixed=await engine.parseFiles([mail,pdf]);
  const purposes=mixed.recordSets.map(set=>set.meta.sourcePurpose).sort();
  assert.deepEqual(purposes,['attachment','mail']);
  assert.equal(mixed.routedFiles.attachments[0],pdf);

  const onlyPdf=await engine.parseFiles([pdf]);
  assert.equal(onlyPdf.recordSets.length,1);
  assert.equal(onlyPdf.recordSets[0].meta.sourcePurpose,'attachment');

  const resilientEngine=new Importer.UniversalImportEngine();
  resilientEngine.parseFile=async file=>{
    if(file.name.endsWith('.doc'))throw new Error('legacy binary Word');
    return new Core.NormalizedDataset({format:'csv',sourceFiles:[file],recordSets:[rs(file.name,[['收件人','主题','正文'],['a@example.edu','Hello','Body']],{},file.name)]});
  };
  const resilient=await resilientEngine.parseFiles([mail,{name:'notes.doc',size:30,lastModified:1}]);
  assert.deepEqual(resilient.recordSets.map(set=>set.meta.sourcePurpose).sort(),['ignored','mail'],'one unreadable source must not fail or contaminate the rest of a mixed batch');
  assert(resilient.warnings.some(w=>w.includes('不影响其他来源')));

  const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
  assert(!/bestConfig\s*=.*enabled\s*=\s*true/.test(content),'no-mail input must not force-enable a guessed collection');
  assert(content.includes("config.purpose !== 'mail'"),'task generation must be purpose-gated');
  assert(content.includes('未找到可确认的邮件资料'),'no-mail state must stop with a source-level explanation');
  console.log('source routing tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
