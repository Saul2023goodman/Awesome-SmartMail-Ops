const fs=require('fs'),vm=require('vm'),{performance}=require('perf_hooks');
const source=fs.readFileSync('content.js','utf8');
const css=fs.readFileSync('content.css','utf8');
const assertions=[
  ['tab switch uses dirty render scheduling',/if \(name === 'batch' && viewPerf\.batchDirty\) scheduleBatchRender\(\)/.test(source)&&/if \(name === 'contacts' && viewPerf\.contactsDirty\) scheduleContactsRender\(\)/.test(source)],
  ['form persistence is debounced',/queueFormStateSave/.test(source)&&/setTimeout\(\(\) => \{[\s\S]{0,140}saveFormState\(\);[\s\S]{0,40}\}, 500\)/.test(source)],
  ['batch search is debounced',/renderBatchFilterDebounced=debounce\([^\n]+,100\)/.test(source)],
  ['contacts search is debounced',/renderContactFilterDebounced=debounce\([^\n]+,100\)/.test(source)],
  ['batch rows use one delegated change handler',/previewBodyEl\?\.addEventListener\('change'/.test(source)&&!/previewBodyEl\.querySelectorAll\('\[data-task-enabled\]'\)/.test(source)],
  ['contacts rows use delegated handlers',/\$\('nmda-contact-body'\)\?\.addEventListener\('change'/.test(source)&&!/body\.querySelectorAll\('select\[data-contact-stage\]'\)/.test(source)],
  ['contacts render progressively',/contactRenderLimit: 250/.test(source)&&/data-contact-load-more/.test(source)],
  ['offscreen work is isolated',/content-visibility:\s*auto/.test(css)&&/contain:\s*layout style/.test(css)],
  ['sticky blur disabled',/backdrop-filter:\s*none !important/.test(css)],
  ['task/contact derived data is cached',/function taskContactSnapshot\(task\)/.test(source)],
  ['contact edits coalesce whole-book persistence',/queueContactsPersist\(\);/.test(source)&&/contactPersistTimer/.test(source)],
  ['attachment evidence uses one DOM scan per poll',/function attachmentEvidenceText\(root\)/.test(source)&&/const evidence = attachmentEvidenceText\(root\)/.test(source)],
  ['deep scheduled-success scan is throttled',/const deep = poll % 8 === 7/.test(source)]
];
for(const [name,ok] of assertions){if(!ok)throw new Error('performance contract failed: '+name);}
const ctx={console};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('roster.js','utf8'),ctx);
const N=2500;
const entries=Array.from({length:N},(_,i)=>({key:`r${i}`,email:`p${i}@u${i%50}.edu`,name:`Professor ${i}`,school:`University ${i%50}`,nameKey:`professor${i}`,schoolKey:`university${i%50}`}));
const tasks=Array.from({length:N},(_,i)=>({editKey:`t${i}`,id:`Professor ${i}`,recipients:`p${i}@u${i%50}.edu`,school:`University ${i%50}`}));
const t0=performance.now();const audit=ctx.NMDARoster.crossCheck(tasks,entries);const elapsed=performance.now()-t0;
if(audit.summary.matched!==N)throw new Error(`roster correctness regression: ${audit.summary.matched}/${N}`);
console.log(`performance contract OK; indexed roster ${N}x${N}: ${elapsed.toFixed(1)} ms`);

