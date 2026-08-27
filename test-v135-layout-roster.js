const fs=require('fs');
const js=fs.readFileSync('content.js','utf8');
const css=fs.readFileSync('content.css','utf8');
const adapter=fs.readFileSync('import-adapters.js','utf8');
const scheduler=fs.readFileSync('scheduler.js','utf8');
const finalCss=css.slice(css.lastIndexOf('v1.35'));

if(!/nmda-process-guide[\s\S]*?nmda-rail-create-card[\s\S]*?id="nmda-run-card"/.test(js))throw new Error('create command is not nested in the right workflow rail');
if(!/\.nmda-batch-table-wrap\s*\{[\s\S]*?max-height:none\s*!important[\s\S]*?overflow:visible\s*!important/.test(finalCss))throw new Error('batch table still owns a vertical scrollbar');
if(!/#nmda-panel\.has-modal \.nmda-page\s*\{\s*overflow:hidden\s*!important/.test(finalCss))throw new Error('background page scroll is not suspended while a dialog is open');
if(!/\.nmda-supplement-preflight,[\s\S]*?overflow:auto\s*!important/.test(finalCss))throw new Error('dialog backdrop is not the single scroll owner');
if(!js.includes("style.setProperty('overflow','hidden','important')")||!js.includes('setHostScrollLocked(open)'))throw new Error('host page scroll lock lifecycle missing');
if(!adapter.includes("for(const merge of els(doc,'mergeCell'))")||!adapter.includes('if(c1!==c2||r2<=r1)continue'))throw new Error('vertical XLSX merge expansion missing');
if(!/if\(school\) return \{ key:`school:/.test(scheduler))throw new Error('institution must outrank domain scheduling fallback');
console.log('v1.35 contract OK: right create command, single-scroll surfaces, merged-cell roster expansion, institution-first scheduling');
