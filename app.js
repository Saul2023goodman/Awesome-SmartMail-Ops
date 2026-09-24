(() => {
  'use strict';

  if (window.top !== window || document.getElementById('nmda-root')) return;

  const APP = 'NetEase Mail Draft Assistant';
  const Importer = globalThis.NMDAImporter;
  const ImportDomain = globalThis.NMDAImportDomain;
  const { uniqueFiles, mergeImportedDatasets, importedScheduleEvidence, mailboxDraftDataset } = ImportDomain;
  const MailRecognizer = globalThis.NMDAMailRecognizer;
  const Operations = globalThis.NMDAOperations;
  const Scheduler = globalThis.NMDAScheduler;
  const Dispatch = globalThis.NMDADispatch;
  const Roster = globalThis.NMDARoster;
  const RosterPlanner = globalThis.NMDARosterPlanner;
  const Persistence = globalThis.NMDAWorkspacePersistence;
  const Runtime = globalThis.NMDAWorkspaceRuntime;
  const Navigation = globalThis.NMDAWorkspaceNavigation;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


  const Execution = globalThis.NMDAWorkspaceExecution;
  const { prepareRuntimeFileRefs, releaseRuntimeFileRefs, executeDraftRemotely, updateMailboxBatchMonitor, waitForMailboxExecutionReady } = Execution;

  const MailContent = globalThis.NMDAMailContent;
  const { escapeHtml, sanitizeEmailRichHtml, plainMailBodyToHtml, mailQuotedAttentionRanges, mailRichFormatFeatures, mailRichHasMeaningfulFormatting, mailRichHtmlToText, taskRichBodyHtml, normalizeGovernancePhrase, governanceTaskText, governanceFindPositions, governanceTextIndex, governanceOccurrenceRefs, inspectGovernanceRuleHtml } = MailContent;

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


  const View = globalThis.NMDAWorkspaceView;
  const { iconSvg, decorateUnifiedIcons } = View;
  const ui = View.buildUI();


  // v3.8.82 · Global SmartMail data reset. Kept outside any single workflow page so a
  // stuck batch can be abandoned from Review / Dispatch / Monitoring without excluding
  // tasks one by one. This only clears SmartMail-owned local state; it never deletes
  // messages or drafts in the real 163 mailbox.
  {
    const resetDialog=document.createElement('div');
    resetDialog.id='nmda-reset-all-overlay';
    resetDialog.className='nmda-workflow-modal-overlay nmda-reset-all-overlay';
    resetDialog.hidden=true;
    resetDialog.innerHTML=`
      <section class="nmda-workflow-dialog nmda-reset-all-dialog" role="dialog" aria-modal="true" aria-labelledby="nmda-reset-all-title">
        <header class="nmda-workflow-dialog-head">
          <div><span class="nmda-dialog-eyebrow">重新开始</span><h3 id="nmda-reset-all-title">清除当前工作内容？</h3><p>清除后可以重新准备邮件并开始新一批邮件。</p></div>
          <button class="nmda-dialog-close" id="nmda-reset-all-close" type="button" aria-label="关闭">×</button>
        </header>
        <div class="nmda-reset-all-body">
          <div class="nmda-reset-all-warning"><strong>将清除</strong><span>已准备邮件、审阅邮件结果、附件设置、发送安排，以及当前跟进设置。</span></div>
          <div class="nmda-reset-all-safe"><strong>网易邮箱不受影响</strong><span>已发送邮件、收件、草稿和定时邮件都会保留。</span></div>
          <label class="nmda-reset-all-confirm"><input id="nmda-reset-all-confirm" type="checkbox"><span>我确认清除当前工作内容并重新开始</span></label>
          <div class="nmda-reset-all-status" id="nmda-reset-all-status" hidden></div>
        </div>
        <footer class="nmda-workflow-dialog-foot"><button class="nmda-btn nmda-btn-quiet" id="nmda-reset-all-cancel" type="button">取消</button><div class="nmda-dialog-foot-spacer"></div><button class="nmda-btn nmda-btn-danger" id="nmda-reset-all-confirm-button" type="button" disabled>清除并重新开始</button></footer>
      </section>`;
    ui.querySelector('#nmda-panel')?.appendChild(resetDialog);
  }

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
  const $ = id => ui.querySelector(`#${id}`);
  const launcher = $('nmda-launcher'), panel = $('nmda-panel');
  const attachmentUiState=()=>globalThis.NMDAWorkspaceImportUi.getSnapshot().attachments;
  const patchAttachmentUi=patch=>globalThis.NMDAWorkspaceImportUi.publishPatch({attachments:{...attachmentUiState(),...patch}});
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
    const modalOpen=[$('nmda-supplement-preflight'),$('nmda-schedule-modal'),$('nmda-reset-all-overlay')].some(el=>el&&!el.hidden);
    panel.classList.toggle('has-modal',modalOpen);
  }
  function setPanelOpen(open){panel.hidden=!open;setHostScrollLocked(open);if(open)syncModalState();}

  // v3.8.80 · Smart Time Field
  // Keep native date/time inputs for reliability, but add one compact quick-set surface
  // everywhere a user has to choose a date, local time, datetime, or waiting interval.
  let smartTemporalTarget=null, smartTemporalTrigger=null, smartTemporalPopover=null;
  const smartPad=n=>String(n).padStart(2,'0');
  function smartDateAdd(dayKey,days){
    const m=String(dayKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return'';
    const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+Number(days||0)));
    return `${d.getUTCFullYear()}-${smartPad(d.getUTCMonth()+1)}-${smartPad(d.getUTCDate())}`;
  }
  function smartDateWeekday(dayKey){
    const m=String(dayKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return NaN;
    return new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).getUTCDay();
  }
  function smartTodayKey(){
    const zone=$('nmda-rule-time-zone')?.value||'system';
    return Scheduler?.defaultStartDate?.(new Date(),zone)||new Date().toISOString().slice(0,10);
  }
  function smartRuleTime(){return $('nmda-rule-local-time')?.value||batch?.scheduleRules?.localTime||'07:30';}
  function smartSelectedWeekdays(){
    const chosen=[...ui.querySelectorAll('[data-schedule-weekday]:checked')].map(el=>Number(el.value)).filter(n=>n>=1&&n<=5);
    return chosen.length?chosen:[4];
  }
  function smartNextSendDate(fromKey,strict=true){
    let key=String(fromKey||smartTodayKey()),guard=0;const allowed=new Set(smartSelectedWeekdays());
    if(strict)key=smartDateAdd(key,1);
    while(key&&guard++<14){if(allowed.has(smartDateWeekday(key)))return key;key=smartDateAdd(key,1);}
    return key||fromKey;
  }
  function smartTemporalTitle(input){
    return ({
      'schedule-start':'开始日期','schedule-time':'当地发送时间','skip-start':'跳过区间 · 开始','skip-end':'跳过区间 · 结束',
      'task-schedule':'单封发送时间','followup-delay':'跟进等待间隔'
    })[input?.dataset?.smartRole]||'快速设置时间';
  }
  function smartTemporalPresets(input){
    const mode=input?.dataset?.smartTemporal||input?.type||'',role=input?.dataset?.smartRole||'',today=smartTodayKey(),ruleTime=smartRuleTime();
    if(mode==='duration-days')return [
      {label:'3 天',value:'3'},{label:'5 天',value:'5'},{label:'7 天',value:'7',accent:true},{label:'10 天',value:'10'},{label:'14 天',value:'14'}
    ];
    if(mode==='time')return [
      {label:'07:30',value:'07:30',accent:ruleTime==='07:30'},{label:'08:00',value:'08:00'},{label:'09:00',value:'09:00'},{label:'10:00',value:'10:00'},{label:'13:30',value:'13:30'}
    ];
    if(mode==='date'){
      if(role==='skip-end'){
        const start=$('nmda-rule-skip-start')?.value||today;
        return [{label:'与开始同日',value:start},{label:'开始 + 7 天',value:smartDateAdd(start,7),accent:true},{label:'开始 + 14 天',value:smartDateAdd(start,14)},{label:'清除',value:'',clear:true}];
      }
      if(role==='skip-start')return [{label:'今天',value:today},{label:'明天',value:smartDateAdd(today,1)},{label:'+ 7 天',value:smartDateAdd(today,7)},{label:'+ 14 天',value:smartDateAdd(today,14)},{label:'清除',value:'',clear:true}];
      return [{label:'今天',value:today},{label:'明天',value:smartDateAdd(today,1)},{label:'下个发送日',value:smartNextSendDate(today,true),accent:true},{label:'+ 1 周',value:smartDateAdd(today,7)}];
    }
    if(mode==='datetime'){
      const raw=String(input.value||''),m=raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/),baseDate=m?.[1]||($('nmda-rule-start-date')?.value||today),baseTime=m?.[2]||ruleTime;
      const presets=m?
        [{label:'后移 1 天',value:`${smartDateAdd(baseDate,1)}T${baseTime}`},{label:'下个发送日',value:`${smartNextSendDate(baseDate,true)}T${baseTime}`,accent:true},{label:'后移 1 周',value:`${smartDateAdd(baseDate,7)}T${baseTime}`},{label:`改为 ${ruleTime}`,value:`${baseDate}T${ruleTime}`},{label:'清除',value:'',clear:true}]:
        [{label:`今天 · ${ruleTime}`,value:`${today}T${ruleTime}`},{label:`明天 · ${ruleTime}`,value:`${smartDateAdd(today,1)}T${ruleTime}`},{label:'下个发送日',value:`${smartNextSendDate(today,true)}T${ruleTime}`,accent:true},{label:'+ 1 周',value:`${smartDateAdd(today,7)}T${ruleTime}`},{label:'清除',value:'',clear:true}];
      return presets;
    }
    return [];
  }
  function ensureSmartTemporalPopover(){
    if(smartTemporalPopover)return smartTemporalPopover;
    const pop=document.createElement('div');pop.id='nmda-smart-temporal-popover';pop.className='nmda-smart-temporal-popover';pop.hidden=true;
    pop.innerHTML='<div class="nmda-smart-temporal-pophead"><div><small>快捷时间</small><strong data-smart-temporal-title>快速设置时间</strong></div><button type="button" data-smart-temporal-close aria-label="关闭">×</button></div><div class="nmda-smart-temporal-presets" data-smart-temporal-presets></div><div class="nmda-smart-temporal-popfoot"><span>可直接输入，也可打开日期时间选择器</span><button type="button" data-smart-temporal-native>打开选择器</button></div>';
    ui.appendChild(pop);smartTemporalPopover=pop;
    return pop;
  }
  function closeSmartTemporal(){if(smartTemporalPopover)smartTemporalPopover.hidden=true;smartTemporalTarget=null;smartTemporalTrigger=null;}
  function positionSmartTemporal(){
    if(!smartTemporalPopover||smartTemporalPopover.hidden||!smartTemporalTrigger)return;
    const r=smartTemporalTrigger.getBoundingClientRect(),w=Math.min(330,window.innerWidth-24),h=smartTemporalPopover.offsetHeight||180;
    let left=Math.min(Math.max(12,r.right-w),window.innerWidth-w-12),top=r.bottom+7;
    if(top+h>window.innerHeight-12)top=Math.max(12,r.top-h-7);
    smartTemporalPopover.style.width=`${w}px`;smartTemporalPopover.style.left=`${left}px`;smartTemporalPopover.style.top=`${top}px`;
  }
  function openSmartTemporal(input,trigger){
    if(!input||input.disabled||input.readOnly)return;const pop=ensureSmartTemporalPopover();smartTemporalTarget=input;smartTemporalTrigger=trigger;
    pop.querySelector('[data-smart-temporal-title]').textContent=smartTemporalTitle(input);
    const list=pop.querySelector('[data-smart-temporal-presets]');list.innerHTML='';
    for(const preset of smartTemporalPresets(input)){
      const btn=document.createElement('button');btn.type='button';btn.dataset.smartTemporalValue=preset.value;btn.textContent=preset.label;if(preset.accent)btn.classList.add('is-accent');if(preset.clear)btn.classList.add('is-clear');list.appendChild(btn);
    }
    const native=pop.querySelector('[data-smart-temporal-native]');native.hidden=input.dataset.smartTemporal==='duration-days';
    pop.hidden=false;requestAnimationFrame(positionSmartTemporal);
  }
  function applySmartTemporalValue(value){
    const input=smartTemporalTarget;if(!input)return;input.value=String(value??'');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));closeSmartTemporal();input.focus({preventScroll:true});
  }
  ui.addEventListener('click',event=>{
    const opener=event.target.closest?.('[data-smart-temporal-open]');
    if(opener){event.preventDefault();event.stopPropagation();const host=opener.closest('.nmda-smart-temporal,.nmda-smart-duration')||opener.parentElement;const input=host?.querySelector?.('[data-smart-temporal]');if(smartTemporalTarget===input&&!ensureSmartTemporalPopover().hidden)closeSmartTemporal();else openSmartTemporal(input,opener);return;}
    const preset=event.target.closest?.('[data-smart-temporal-value]');if(preset&&smartTemporalPopover?.contains(preset)){event.preventDefault();applySmartTemporalValue(preset.dataset.smartTemporalValue);return;}
    if(event.target.closest?.('[data-smart-temporal-close]')){event.preventDefault();closeSmartTemporal();return;}
    const native=event.target.closest?.('[data-smart-temporal-native]');if(native&&smartTemporalTarget){event.preventDefault();const input=smartTemporalTarget;closeSmartTemporal();requestAnimationFrame(()=>{try{input.showPicker?.();}catch(_){input.focus();}});return;}
  });
  document.addEventListener('pointerdown',event=>{if(smartTemporalPopover&&!smartTemporalPopover.hidden&&!smartTemporalPopover.contains(event.target)&&!event.target.closest?.('[data-smart-temporal-open]'))closeSmartTemporal();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&smartTemporalPopover&&!smartTemporalPopover.hidden)closeSmartTemporal();});
  window.addEventListener('resize',()=>{if(smartTemporalPopover&&!smartTemporalPopover.hidden)positionSmartTemporal();},{passive:true});
  panel.addEventListener('scroll',()=>{if(smartTemporalPopover&&!smartTemporalPopover.hidden)closeSmartTemporal();},{passive:true,capture:true});

  const MailboxSync = globalThis.NMDAWorkspaceMailboxSync;
  MailboxSync.onApplied(() => {
    if (batch.dataset) { rebuildTasks(); invalidateBatchView(true); renderDuplicateDecision(); renderRosterAudit(); syncStageSurfaceVisibility(); }
    State.changed();
    renderReviewPageOverview();
  });
  MailboxSync.start();
  Runtime.subscribe('NMDA_DRAFT_ATTACHMENT_CANCEL_BROADCAST',message=>{
    if(draftAttachmentTool?.running){
      const executionId=String(message.executionId||'');
      if(!executionId||executionId===String(draftAttachmentTool.executionId||'')){
        draftAttachmentTool.cancelRequested=true;
        draftAttachmentTool.stopping=true;
        setDraftAttachmentProgress('正在停止：当前步骤完成后停止，后续草稿不会继续更新…','warn');
        notifyDraftAttachmentCancelled(String(draftAttachmentTool.executionId||executionId));
        renderDraftAttachmentTool();
      }
    }
  });
  Runtime.subscribe('NMDA_BATCH_STOP_BROADCAST',()=>{
    if(batch?.running){
      batch.stopRequested=true;
      if(batchStopEl)batchStopEl.disabled=true;
      setBatchStatus('网易邮箱已请求停止：当前这一封完成后不会继续下一封。','warn');
    }
  });

  const readMailboxHistoryMonths = Persistence.readHistoryMonths;
  const writeMailboxHistoryMonths = Persistence.writeHistoryMonths;
  const writeFollowUpPrefs = Persistence.writeFollowUpPrefs;
  const State = globalThis.NMDAWorkspaceState;
  const operationState = State.operations;
  const MonitorDomain = globalThis.NMDAMonitorDomain;
  const { monitorGroupState, monitorDecisionPath, monitorCreatable, monitorContactIdentity, monitorContactMetrics, monitorSummary, monitorQueueFor, monitorMatchesQueue, monitorMatchesSubfilter, monitorMatchesAttempts, monitorDisplayReplySubject, monitorContactStatusLabel, dashboardHumanReplies, dashboardSnapshot } = MonitorDomain;

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

  function scheduleBatchRender({ aux = false, force = false, persist = true } = {}) {
    invalidateBatchView(aux);
    if (currentWorkbenchTab() === 'dashboard') State.changed();
    // Runtime execution state is intentionally ephemeral. Persisting the whole workspace
    // for every running/done transition serializes the complete imported dataset and, on
    // large batches, blocks the main thread exactly between two mails. During execution
    // all editable planning controls are locked, so there is nothing durable to save.
    // The batch-final render runs after batch.running becomes false and persists once.
    if (persist && !batch.running) State.schedulePersist();
    if (!force && !batchPaneVisible()) return;
    if (viewPerf.batchFrame) cancelAnimationFrame(viewPerf.batchFrame);
    viewPerf.batchFrame = requestAnimationFrame(() => {
      viewPerf.batchFrame = 0;
      if (!force && !batchPaneVisible()) return;
      renderPreview({ aux: viewPerf.batchAuxDirty });
    });
  }

  const dispatchRuntime = new Map();
  State.onAccountChange(() => dispatchRuntime.clear());

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

  function original163MailRef(task) {
    if (!task || !operationState.loaded || !operationState.store) return { messageId:'', fid:3 };
    const store=operationState.store;
    const directId=String(task.parentMessageId||task.providerMessageId||task.mailboxProviderMessageId||'').trim();
    if(directId)return {messageId:directId,fid:Number(task.parentFid||task.fid||3)||3};
    const raw=task._rawDerivedTask||null;
    const parentOutboundId=String(task.parentOutboundId||raw?.parentOutboundId||'').trim();
    if(parentOutboundId){
      const parent=store.outboundRecords?.[parentOutboundId];
      if(parent?.providerMessageId)return {messageId:String(parent.providerMessageId),fid:3};
    }
    const derivedId=String(task.derivedTaskId||task._sourceTaskId||'').trim();
    const derived=derivedId?store.derivedTasks?.[derivedId]:null;
    if(derived?.parentOutboundId){
      const parent=store.outboundRecords?.[derived.parentOutboundId];
      if(parent?.providerMessageId)return {messageId:String(parent.providerMessageId),fid:3};
    }
    const keys=new Set([
      String(task.rootTaskId||raw?.rootTaskId||derived?.rootTaskId||'').trim(),
      String(task.editKey||'').replace(/^fu-review:/,'').trim(),
      String(task.id||'').trim()
    ].filter(Boolean));
    const candidates=Object.values(store.outboundRecords||{}).filter(record=>record?.status==='sent'&&(
      keys.has(String(record.taskId||''))||keys.has(String(record.rootTaskId||''))||keys.has(String(record.id||''))
    )).sort((a,b)=>new Date(a.sentAt||0)-new Date(b.sentAt||0));
    const record=candidates[0]||null;
    if(record?.providerMessageId)return {messageId:String(record.providerMessageId).trim(),fid:3};
    // Imported Initial tasks may predate the mailbox link. Use a unique exact
    // recipient + thread-subject match only; ambiguity deliberately stays disabled.
    const recipientSet=new Set((Operations?.parseRecipients?.(task.recipients||'')||[]).map(item=>String(item?.email||'').toLowerCase()).filter(Boolean));
    const subjectKey=Operations?.subjectThreadKey?.(task.subject||'')||'';
    if(recipientSet.size&&subjectKey){
      const exact=Object.values(store.outboundRecords||{}).filter(outbound=>{
        if(outbound?.status!=='sent'||!outbound?.providerMessageId)return false;
        if((Operations?.subjectThreadKey?.(outbound.subject||'')||'')!==subjectKey)return false;
        return (outbound.recipients||[]).some(item=>recipientSet.has(String(item?.email||'').toLowerCase()));
      });
      if(exact.length===1)return {messageId:String(exact[0].providerMessageId),fid:3};
    }
    return {messageId:'',fid:3};
  }

  function original163TaskButton(task,{compact=false,label='163 原信件'}={}) {
    const ref=original163MailRef(task);
    const base=`nmda-open-original-mail${compact?' is-compact':''}`;
    if(!ref.messageId)return `<button class="${base} is-unavailable" type="button" disabled title="该任务尚未在 163 中形成或匹配到原信件">${escapeHtml(label)}</button>`;
    return `<button class="${base}" type="button" data-open-original-mail="${escapeHtml(ref.messageId)}" data-open-original-fid="${ref.fid}" title="在 163 邮箱打开此任务对应的原信件">${escapeHtml(label)}</button>`;
  }

  async function openOriginal163Message(messageId,fid=3) {
    const id=String(messageId||'').trim();
    if(!id)return {ok:false,reason:'original-message-unavailable'};
    try{return await Runtime.openMessage(id,Number(fid||3)||3);}
    catch(error){return {ok:false,reason:error?.message||String(error)};}
  }

  async function updateDispatchTask(task, patch = {}) {
    if (!task) return null;
    if (task.dispatchKind === 'follow_up') {
      await State.ensureOperations();
      const result = Operations.updateDerivedTaskDispatch(operationState.store, task._sourceTaskId || task.id, patch);
      State.setStore(result.store);

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

  function reportMonitorNotice(text, tone = '') {
    window.dispatchEvent(new CustomEvent('nmda:monitor-notice', { detail:{ text, tone } }));
  }

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
    return Navigation.getSnapshot().tab;
  }

  let activeUtilityView = 'home';
  const draftAttachmentTool = {
    drafts: [], groups: [], selectedKey: '', selectedDraftIds: new Set(), replacementFile: null,
    loading: false, running: false, stopping: false, cancelRequested: false, executionId: '',
    scanned: false
  };
  const draftAttachmentCancelListeners = new Map();

  function draftAttachmentCancelledError(message='已停止本次附件更新。') {
    const error = new Error(message);
    error.code = 'NMDA_DRAFT_ATTACHMENT_CANCELLED';
    return error;
  }

  function notifyDraftAttachmentCancelled(executionId) {
    const id = String(executionId || '');
    const listeners = draftAttachmentCancelListeners.get(id);
    if (!listeners) return;
    for (const listener of [...listeners]) { try { listener(); } catch (_) {} }
  }

  function awaitDraftAttachmentStep(promise, executionId, timeoutMs, label='当前步骤') {
    const id = String(executionId || '');
    return new Promise((resolve,reject) => {
      let settled = false;
      const listeners = draftAttachmentCancelListeners.get(id) || new Set();
      draftAttachmentCancelListeners.set(id, listeners);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        listeners.delete(onCancel);
        if (!listeners.size) draftAttachmentCancelListeners.delete(id);
        fn(value);
      };
      const onCancel = () => finish(reject, draftAttachmentCancelledError());
      listeners.add(onCancel);
      const timer = setTimeout(() => finish(reject, new Error(`${label}长时间没有返回，已停止等待并请求安全中断。`)), Math.max(1000, Number(timeoutMs || 0)));
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }

  function throwIfDraftAttachmentCancelled() {
    if (draftAttachmentTool.cancelRequested) throw draftAttachmentCancelledError();
  }

  async function cancelDraftAttachmentReplacement() {
    if (!draftAttachmentTool.running || draftAttachmentTool.cancelRequested) return;
    const executionId = String(draftAttachmentTool.executionId || '');
    draftAttachmentTool.cancelRequested = true;
    draftAttachmentTool.stopping = true;
    setDraftAttachmentProgress('正在停止：当前步骤完成后停止，后续草稿不会继续更新…','warn');
    setDraftAttachmentMotion({phase:'error',message:'已请求停止，正在结束当前安全步骤。'});
    renderDraftAttachmentTool();
    notifyDraftAttachmentCancelled(executionId);
    try {
      await Promise.race([
        Runtime.cancelAttachment(executionId),
        new Promise(resolve => setTimeout(() => resolve({ok:false,reason:'cancel-timeout'}), 5000))
      ]);
    } catch (_) {}
  }

  function setUtilityView(view='home', options={}) {
    const normalized=['home','monitor','draft-attachments'].includes(view)?view:'home';
    activeUtilityView=normalized;
    const pane=ui.querySelector('[data-pane="utilities"]');
    if(pane)pane.dataset.utilityView=normalized;
    const monitor=ui.querySelector('[data-utility-workspace="monitor"]');if(monitor)monitor.hidden=normalized!=='monitor';
    globalThis.NMDAWorkspaceUtilityUi.publishPatch({activeView:normalized});
    if(normalized==='monitor')requestAnimationFrame(()=>{window.dispatchEvent(new Event('nmda:monitor-open')); });
    if(normalized==='draft-attachments')requestAnimationFrame(()=>{ if(!draftAttachmentTool.scanned&&!draftAttachmentTool.loading) void scanDraftAttachmentTool(); else renderDraftAttachmentTool(); });
    if(options.syncHash!==false){
      const target=normalized==='home'?'#utilities':`#utilities/${normalized}`;
      if(location.hash!==target)history.replaceState(null,'',target);
    }
  }

  function openUtilityView(view='home') {
    setWorkbenchTab('utilities');
    setUtilityView(view);
  }
  window.addEventListener('nmda:open-utility', event => openUtilityView(event.detail || 'home'));

  window.addEventListener('nmda:monitor-navigate', event => {
    const { action, id } = event.detail || {};
    if (action === 'dispatch') {
      setWorkbenchTab('dispatch');
      history.replaceState(null, '', '#dispatch');
      scheduleBatchRender({aux:false,force:true});
    } else if (action === 'review') {
      void openReviewWorkspace({pendingOnly:false,taskKey:`fu-review:${id}`});
    }
  });
  window.addEventListener('nmda:followup-updated', () => {
    renderReviewPageOverview();
    scheduleBatchRender({aux:true});
  });

  function syncStageSurfaceVisibility(step=batch.uiStep) {
    const n=Math.min(2,Math.max(1,Number(step||1)));
    const workbench=ui.querySelector('.nmda-bulk-workbench');
    const ingest=ui.querySelector('.nmda-ingest-workspace-v2');
    if(workbench)workbench.dataset.viewStep=String(n);
    if(ingest)ingest.hidden=false;
  }

  function setWorkbenchTab(name) {
    const current = currentWorkbenchTab();
    if(name!=='dispatch'&&rosterPlannerIsOpen())closeRosterPlannerView({restoreFocus:false});
    if (current !== name) Navigation.setTab(name);
    if (name === 'batch' && viewPerf.batchDirty) scheduleBatchRender();
    if (name === 'review') requestAnimationFrame(() => { if(reviewInlineEl)reviewInlineEl.hidden=false; void (async()=>{ await State.ensureOperations(); renderReviewPageOverview(); })(); });
    if (name === 'dispatch') requestAnimationFrame(() => { void (async()=>{ await State.ensureOperations(); scheduleBatchRender({aux:false,force:true}); })(); });
    if (name === 'dashboard') requestAnimationFrame(() => { void (async()=>{ await State.ensureOperations(); State.changed(); })(); });
    if (name === 'utilities') requestAnimationFrame(() => { renderUtilityHubSummary(); if(activeUtilityView==='monitor')window.dispatchEvent(new Event('nmda:monitor-open'));  else if(activeUtilityView==='draft-attachments'){ if(!draftAttachmentTool.scanned&&!draftAttachmentTool.loading) void scanDraftAttachmentTool(); else renderDraftAttachmentTool(); } });
    if(name==='batch' && batch?.dataset && !mailboxDedupeSnapshotAvailable()) MailboxSync.schedule('history',{source:'batch'});
    else MailboxSync.schedule('quick',{source:`tab:${name}`});
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
  window.addEventListener('nmda:tab-click', event => {
    const name=event.detail;
    if(name==='review'){void openReviewWorkspace({pendingOnly:false,fromStageNav:true});return;}
    if(name==='utilities'){setWorkbenchTab('utilities');setUtilityView('home');return;}
    setWorkbenchTab(name);
    history.replaceState(null,'',`#${name}`);
  });
  const batch = State.batch;


  async function restoreWorkspaceFromStorage() {
    try {
      if (!await State.restoreBatch()) return false;
      const sets = batch.dataset.recordSets;
      syncRosterParts();
      sets.forEach((_,index)=>{ if(!batch.collectionConfigs.has(index)) ensureCollectionConfig(index,{reset:true}); });
      configureCollection(batch.collectionIndex,false);
      renderSourceInventory();
      renderImportLifecycleState();
      publishAttachmentWorkspace();
      renderSupplementPreflight();
      syncScheduleRuleControls();
      setImportStatus(`已恢复上次处理的 ${batch.tasks.length} 封邮件。可继续添加文件、文件夹、名单或附件。`,'ok');
      if ((batch.tasks||[]).some(task => (task.attachmentRefs||[]).length)) {
        setBatchStatus('已恢复邮件与审阅状态；本地附件文件不会永久存储，请在执行前重新选择附件。','warn');
      }
      if(reviewQueueEl) reviewQueueEl.scrollTop=0;
      return true;
    } catch (error) {
      console.warn(`[${APP}] workspace restore failed`, error);
      return false;
    } finally {
      State.finishRestore();
    }
  }


  const importFileEl = $('nmda-import-file'), importDirEl = $('nmda-import-dir'), rosterFileEl = $('nmda-roster-file');
  const reviewQueueEl = $('nmda-review-queue'), reviewBoardHost=ui.querySelector('[data-workspace-mount="review-board"]'), reviewPreviewPagesEl=$('nmda-review-preview-pages'), reviewPreviewRailEl=$('nmda-review-preview-rail'), reviewPreviewRailListEl=$('nmda-review-preview-rail-list'), reviewPreviewRailCountEl=$('nmda-review-preview-rail-count'), reviewProgressEl = $('nmda-review-progress');
  const activeReviewList=()=>batch.reviewSurface==='preview'?reviewPreviewPagesEl:reviewBoardHost;
  const reviewInlineEl=$('nmda-inline-review');
  const formatGovernanceEntryEl=$('nmda-review-format-governance'), formatGovernanceEntryCountEl=$('nmda-preview-format-drift-count'), formatGovernanceEl=$('nmda-format-governance'), formatGovernancePhraseEl=$('nmda-format-governance-phrase'), formatGovernanceCaseEl=$('nmda-format-governance-case'), formatGovernanceResultEl=$('nmda-format-governance-result'), formatGovernanceListEl=$('nmda-format-governance-list'), formatGovernanceApplyEl=$('nmda-format-governance-apply'), formatGovernanceSuggestionsEl=$('nmda-format-governance-suggestions'), formatGovernanceQueueEl=$('nmda-format-governance-queue'), formatGovernanceAddEl=$('nmda-format-governance-add'), formatGovernanceHistoryEl=$('nmda-format-governance-history');
  const batchStandardSubjectCountEl=$('nmda-batch-standard-subject-count'), batchStandardFormatCountEl=$('nmda-batch-standard-format-count'), batchStandardSubjectBadgeEl=$('nmda-batch-standard-subject-badge'), batchStandardSubjectInputEl=$('nmda-batch-standard-subject-input'), batchStandardSubjectSuggestionEl=$('nmda-batch-standard-subject-suggestion'), batchStandardSubjectResultEl=$('nmda-batch-standard-subject-result'), batchStandardPlanSummaryEl=$('nmda-batch-standard-plan-summary');
  const batchStandardsEl=$('nmda-format-governance'), batchStandardsDescEl=$('nmda-batch-standards-desc');
  const dirEl = $('nmda-attachment-dir'), taskFilesEl = $('nmda-attachment-files');
  const preSendMatchFilesEl = $('nmda-pre-send-match-files'), preSendSharedFilesEl = $('nmda-pre-send-shared-files');
  const previewBodyEl = $('nmda-preview-body'), batchStatusEl = $('nmda-batch-status');
  const batchStartEl = $('nmda-batch-start'), batchStopEl = $('nmda-batch-stop'), batchPauseEveryTimeEl = $('nmda-pause-every-time'), batchParagraphSpacingEl = $('nmda-compose-paragraph-spacing'), batchFastComposeEl = $('nmda-fast-compose');
  const scheduleStartDateEl = $('nmda-rule-start-date'), scheduleLocalTimeEl = $('nmda-rule-local-time'), scheduleTimeZoneEl = $('nmda-rule-time-zone'), scheduleWeekdayEls = [...ui.querySelectorAll('[data-schedule-weekday]')], scheduleSkipStartEl = $('nmda-rule-skip-start'), scheduleSkipEndEl = $('nmda-rule-skip-end'), scheduleMaxSchoolEl = $('nmda-rule-max-school'), scheduleSchoolIntervalEl = $('nmda-rule-school-interval'), schedulePreserveEl = $('nmda-rule-preserve-existing'), scheduleMailboxExistingEl = $('nmda-rule-include-mailbox-scheduled'), scheduleHolidayEl = $('nmda-rule-skip-holidays');
  const scheduleApplyEl = $('nmda-apply-schedule'), scheduleApplyHintEl=$('nmda-apply-schedule-hint'), scheduleClearEl = $('nmda-clear-auto-schedule'), scheduleSummaryEl = $('nmda-schedule-summary'), scheduleOutcomeEl=$('nmda-schedule-outcome'), scheduleGuideEl=$('nmda-schedule-guide'), scheduleRulePreviewEl = $('nmda-schedule-rule-preview'), schedulerCardEl = $('nmda-scheduler-card'), schedulerToggleLabelEl = $('nmda-scheduler-toggle-label');
  const batchSearchEl = $('nmda-batch-search');
  const batchTagIncludeEl = $('nmda-batch-tag-include');
  function isCurrentBatchSession(token) { return Number(token) === Number(batch.sessionId); }

  batch.composeParagraphSpacing = Persistence.readParagraphSpacing();
  if (batchParagraphSpacingEl) batchParagraphSpacingEl.checked = batch.composeParagraphSpacing;

  batch.fastCompose = Persistence.readFastCompose();
  if (batchFastComposeEl) batchFastComposeEl.checked = batch.fastCompose;

  const saveScheduleRulePrefs = Persistence.writeScheduleRules;
  function syncScheduleRuleControls() {
    if(!batch.scheduleRules) batch.scheduleRules=State.freshScheduleRules();
    const rules=Scheduler?.normalizeRules?.(batch.scheduleRules)||batch.scheduleRules;
    batch.scheduleRules=rules;
    if(scheduleStartDateEl && document.activeElement!==scheduleStartDateEl) scheduleStartDateEl.value=rules.startDate||'';
    if(scheduleLocalTimeEl && document.activeElement!==scheduleLocalTimeEl) scheduleLocalTimeEl.value=rules.localTime||'07:30';
    if(scheduleTimeZoneEl && document.activeElement!==scheduleTimeZoneEl) scheduleTimeZoneEl.value=rules.timeZone||'system';
    if(scheduleMaxSchoolEl && document.activeElement!==scheduleMaxSchoolEl) scheduleMaxSchoolEl.value=String(rules.maxPerGroupPerRound||1);
    if(scheduleSchoolIntervalEl && document.activeElement!==scheduleSchoolIntervalEl) scheduleSchoolIntervalEl.value=String(rules.sameGroupIntervalDays??7);
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
      sameGroupIntervalDays:scheduleSchoolIntervalEl?.value??batch.scheduleRules?.sameGroupIntervalDays??7,
      preserveExisting:schedulePreserveEl?.checked!==false,
      includeMailboxScheduled:scheduleMailboxExistingEl?.checked!==false,
      intraRoundMinutes:0,
      skipHolidays:scheduleHolidayEl?.checked!==false
    }) || {startDate:scheduleStartDateEl?.value||'',localTime:scheduleLocalTimeEl?.value||'07:30',timeZone:scheduleTimeZoneEl?.value||'system',weekdays,skipStart:scheduleSkipStartEl?.value||'',skipEnd:scheduleSkipEndEl?.value||'',maxPerGroupPerRound:Number(scheduleMaxSchoolEl?.value||1),sameGroupIntervalDays:Number(scheduleSchoolIntervalEl?.value??7),preserveExisting:schedulePreserveEl?.checked!==false,includeMailboxScheduled:scheduleMailboxExistingEl?.checked!==false,skipHolidays:scheduleHolidayEl?.checked!==false};
    batch.scheduleRules=rules; saveScheduleRulePrefs(rules); return rules;
  }
  batch.scheduleRules = State.freshScheduleRules();

  function rosterPlannerSources(){
    if(!RosterPlanner)return[];
    const out=[],seen=new Set(),pushSet=(set,origin)=>{
      if(!set?.rows?.length||!set?.meta?.excelVisual)return;
      const key=RosterPlanner.sourceKey(set);if(seen.has(key))return;seen.add(key);out.push({key,set,origin});
    };
    const state=State.rosterState();
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
  function rosterPlannerSelectionEntries(){
    const current=rosterPlannerCurrentSource();if(!current)return[];
    const entries=rosterPlannerEntriesForSet(current.set);
    const selection=globalThis.NMDAWorkspacePlanningUi.getSnapshot().rosterPlanner.selection;
    return globalThis.NMDAWorkspaceRosterPlannerModel.selectedEntries(entries,current.set,selection);
  }
  function rosterPlannerActiveBatch(){return String(batch.rosterPlanner?.activePriorityRound||batch.rosterPlanner?.activeBatch||'').trim();}
  function rosterPlannerIsOpen(){return !!globalThis.NMDAWorkspacePlanningUi.getSnapshot().rosterPlanner.visible;}
  function publishRosterPlannerSelection(selection){
    const snapshot=globalThis.NMDAWorkspacePlanningUi.getSnapshot(),view=snapshot.rosterPlanner;
    const current=rosterPlannerCurrentSource(),entries=current?rosterPlannerEntriesForSet(current.set):[];
    const selectionView=globalThis.NMDAWorkspaceRosterPlannerModel.buildSelectionView(entries,current?.set||null,batch.rosterPlanner,selection,rosterPlannerActiveBatch());
    globalThis.NMDAWorkspacePlanningUi.publishPatch({rosterPlanner:{...view,selection,selectionView}});
  }
  function renderRosterPlanner(){
    if(!RosterPlanner)return;
    batch.rosterPlanner=RosterPlanner.createState(batch.rosterPlanner);
    const sources=rosterPlannerSources();
    const existing=globalThis.NMDAWorkspacePlanningUi.getSnapshot().rosterPlanner;
    const view=globalThis.NMDAWorkspaceRosterPlannerModel.build({sources,state:batch.rosterPlanner,selection:existing.selection,visible:!!existing.visible,returnToSchedule:!!existing.returnToSchedule});
    batch.rosterPlanner.sourceKey=view.selectedSourceKey||'';
    globalThis.NMDAWorkspacePlanningUi.publishPatch({rosterPlanner:view});
  }
  function openRosterPlannerView({returnToSchedule=false}={}){
    if(!dispatchTasks().length){setBatchStatus('暂无待发送邮件；请先在“审阅邮件”确认邮件已就绪。','warn');return;}
    closeScheduleModal({restoreFocus:false});
    if(dispatchPaneHost)dispatchPaneHost.classList.add('is-roster-planning');
    const snapshot=globalThis.NMDAWorkspacePlanningUi.getSnapshot();
    globalThis.NMDAWorkspacePlanningUi.publishPatch({rosterPlanner:{...snapshot.rosterPlanner,visible:true,returnToSchedule:!!returnToSchedule}});
    renderRosterPlanner();
    requestAnimationFrame(()=>ui.querySelector('#nmda-roster-sheet-viewport')?.focus?.({preventScroll:true}));
  }
  function closeRosterPlannerView({restoreFocus=true}={}){
    const snapshot=globalThis.NMDAWorkspacePlanningUi.getSnapshot();
    const returnToSchedule=!!snapshot.rosterPlanner.returnToSchedule;
    if(dispatchPaneHost)dispatchPaneHost.classList.remove('is-roster-planning');
    globalThis.NMDAWorkspacePlanningUi.publishPatch({rosterPlanner:{...snapshot.rosterPlanner,visible:false,returnToSchedule:false}});
    if(returnToSchedule){openScheduleModal();return;}
    if(restoreFocus)requestAnimationFrame(()=>$('nmda-open-schedule-modal')?.focus?.({preventScroll:true}));
  }
  function clearRosterPlannerSelection(){
    publishRosterPlannerSelection(null);renderRosterPlanner();
  }
  function createRosterPlannerBatch(){
    const current=rosterPlannerCurrentSource();if(!current||!RosterPlanner)return;
    const entries=rosterPlannerEntriesForSet(current.set),created=RosterPlanner.createPriorityRound(batch.rosterPlanner,entries);if(!created)return;
    batch.rosterPlanner=created.state;batch.handoffComplete=false;batch.schedulePlan=null;State.schedulePersist();renderRosterPlanner();
    setBatchStatus(`已新建同校优先级 ${created.label}。现在按行主导颜色 / 格式选择，或框选联系人后加入该优先级。`,'ok');
  }
  function applyRosterPlannerBatch(label,{clear=false}={}){
    const current=rosterPlannerCurrentSource();if(!current||!RosterPlanner)return;
    const targets=rosterPlannerSelectionEntries();if(!targets.length){setBatchStatus('请先按行主导颜色 / 格式选择，或在名单上框选联系人。','warn');return;}
    const targetLabel=clear?'':String(label||rosterPlannerActiveBatch()||'').trim();if(!clear&&!targetLabel){setBatchStatus('请先新建一个同校优先级。','warn');return;}
    const selection=globalThis.NMDAWorkspacePlanningUi.getSnapshot().rosterPlanner.selection;
    const source=selection?.kind==='feature'?'feature-selection':selection?.kind==='batch'||selection?.kind==='unassigned'?'batch-review':'box-selection';
    const result=RosterPlanner.applyPriorityRoundToEntries(batch.rosterPlanner,targets,current.set,{batch:targetLabel,clear,evidenceSource:source});
    if(result.warning){setBatchStatus(result.warning,'warn');return;}
    batch.rosterPlanner=result.state;batch.handoffComplete=false;batch.schedulePlan=null;
    if(selection?.kind==='batch'||selection?.kind==='unassigned')publishRosterPlannerSelection({...selection,kind:clear?'unassigned':'batch',meta:clear?'':targetLabel});
    State.schedulePersist();
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
    try{result=await Runtime.readScheduledDrafts(readMailboxHistoryMonths());}
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

  // Every operational task can jump back to its source message in 163 when a provider id is known.
  ui?.addEventListener('click',event=>{
    const trigger=event.target.closest?.('[data-open-original-mail]');if(!trigger)return;
    event.preventDefault();event.stopPropagation();
    void (async()=>{
      const result=await openOriginal163Message(trigger.dataset.openOriginalMail,trigger.dataset.openOriginalFid||3);
      if(!result?.ok){
        const message=result?.reason==='original-message-unavailable'?'该任务尚未匹配到 163 原信件。':`无法打开 163 原信件：${result?.reason||'未知错误'}`;
        if(currentWorkbenchTab()==='utilities'&&activeUtilityView==='monitor')reportMonitorNotice(message,'error');else setImportStatus(message,'warn');
      }
    })();
  });

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
      const displayValue=input.value||'',value=scheduleValueFromDisplay(displayValue,batch.scheduleRules||State.freshScheduleRules());
      void (async()=>{await updateDispatchTask(task,{scheduleAt:value,scheduleSource:value?'manual':'manual-clear',scheduleReason:value?`手工调整 · ${scheduleZoneText(batch.scheduleRules||State.freshScheduleRules())} 当地时间`:''});renderBatchSummaryControls(dispatchTasks());renderScheduleCenter();scheduleBatchRender({aux:false,force:true});})();
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

  window.addEventListener('nmda:review-board-select',event=>{
    const key=String(event.detail?.key||'');if(!key)return;
    if(event.detail.checked)batch.reviewSelected.add(key);else batch.reviewSelected.delete(key);
    renderReviewQueue(batch.reviewPreviewKey||'',{preserveScroll:true});
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
      const total=reviewVisibleTasks().length;
      const current=Math.max(REVIEW_RENDER_CHUNK,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
      if(current>=total)return;
      viewPerf.reviewRenderLimit=Math.min(total,current+REVIEW_RENDER_CHUNK);
      renderReviewQueue(batch.reviewEditingKey||batch.reviewPreviewKey||'',{preserveScroll:true});
    });
  },{passive:true});


  function setReviewSearch(value){
    if(batch.reviewEditingKey){globalThis.NMDAWorkspaceReviewBoard.publishControls({search:String(batch.reviewSearch||'')});setImportStatus('请先保存或取消当前邮件的编辑，再搜索。','warn');return;}
    batch.reviewSearch=String(value||'');
    globalThis.NMDAWorkspaceReviewBoard.publishControls({search:batch.reviewSearch});
    viewPerf.reviewRenderLimit=REVIEW_RENDER_CHUNK;
    if(reviewQueueEl)reviewQueueEl.scrollTop=0;
    const currentKey=batch.reviewPreviewKey||'';
    renderReviewQueue(currentKey);
    const visible=reviewVisibleTasks();
    if(currentKey && !visible.some(task=>task.editKey===currentKey)){batch.reviewPreviewKey='';if(batch.reviewSurface==='preview'&&visible[0])focusReviewTask(visible[0].editKey,{behavior:'auto'});}
  }
  window.addEventListener('nmda:planning-open-schedule-guide',openScheduleModal);

  function referenceRosterCount() {
    return Number(State.rosterState()?.entries?.length || 0);
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

  function attachmentDefaultMode(kind='task'){ return 'all'; }

  function ensureAttachmentPolicy(file,kind='task',options={}){
    const identity=Importer.fileIdentity(file);if(!identity)return {mode:'all',targets:[],source:''};
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
    policy.mode=['smart','all','selected'].includes(mode)?mode:'all';
    if(policy.mode!=='selected')patchAttachmentUi({targetIdentity:''});
    batch.attachmentPolicies.set(identity,policy);batch.handoffComplete=false;
    rebuildTasks();publishAttachmentWorkspace();
  }

  function setAttachmentTarget(identity,taskKey,checked){
    const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===identity);if(!file)return;
    const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));policy.mode='selected';
    const targets=new Set(policy.targets||[]);checked?targets.add(taskKey):targets.delete(taskKey);policy.targets=[...targets];
    batch.attachmentPolicies.set(identity,policy);batch.handoffComplete=false;rebuildTasks();publishAttachmentWorkspace();
  }

  function addAttachmentFiles(files,{source='手动添加',mode=''}={}){
    files=uniqueFiles(files||[]);if(!files.length)return 0;
    for(const file of files)batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.taskFiles=uniqueFiles([...(batch.taskFiles||[]),...files]);
    const inferred=mode||'all';
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
    renderSourceInventory();renderPreflightSourceRoles();publishAttachmentWorkspace();renderSupplementPreflight();
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
    renderSourceInventory();renderPreflightSourceRoles();publishAttachmentWorkspace();renderSupplementPreflight();
    setImportStatus(`已将 ${resolvedFileName||sourceName} 标记为待确认。`,'ok');
  }

  function sourceRosterPreview(decision) {
    const first=sourcePrimaryCollection(decision);
    if(!first)return{type:'empty',message:'已识别为名单资料，暂无适合快速预览的表格内容。'};
    const collection=first.collection,config=ensureCollectionConfig(first.index),rosterDetection=typeof Importer.detectRosterHeader==='function'?Importer.detectRosterHeader(collection):null,detection=config?.detection||Importer.detectHeader(collection.rows||[]),headerIndex=rosterDetection&&Number(rosterDetection.index)>=0?Number(rosterDetection.index):Math.max(0,Number(detection.index||0));
    const headers=(collection.rows?.[headerIndex]||detection.headers||[]).slice(0,4).map(value=>String(value||'').trim()||'字段');
    const rows=(collection.rows||[]).slice(headerIndex+1,headerIndex+4).map(row=>headers.map((_,i)=>String(row?.[i]??'').trim()));
    if(!headers.length||!rows.length)return{type:'empty',message:'已识别为名单资料，暂无适合快速预览的表格内容。'};
    return{type:'table',title:'内容预览',subtitle:`约 ${Math.max(0,(collection.rows||[]).length-headerIndex-1)} 条`,header:true,cols:headers.length,rows:[headers,...rows]};
  }

  function sourceGenericPreview(decision) {
    const item=sourcePrimaryCollection(decision),collection=item?.collection,rows=(collection?.rows||[]).filter(row=>(row||[]).some(value=>String(value??'').trim()));
    if(!rows.length)return{type:'empty',message:'暂时没有可展示的内容预览。'};
    const subtitle=sourceFileTypeLabel(decision.file?.name||decision.sourceName);
    if(collection?.meta?.oneFileTask&&rows[1]){
      const body=String(rows[1]?.[4]??'').trim(),subject=String(rows[1]?.[3]??'').trim();
      const text=(body||subject).replace(/\s+/g,' ').trim();
      return{type:'text',title:'文件内容',subtitle,text:text?`${text.slice(0,420)}${text.length>420?'…':''}`:'暂时没有可展示的正文'};
    }
    const width=Math.max(0,...rows.slice(0,5).map(row=>(row||[]).filter(value=>String(value??'').trim()).length));
    if(width>=2){
      const previewRows=rows.slice(0,4),cols=Math.min(4,Math.max(2,width));
      return{type:'table',title:'文件内容',subtitle:`前 ${previewRows.length} 行`,header:true,cols,rows:previewRows.map(row=>Array.from({length:cols},(_,i)=>{const value=String(row?.[i]??'').trim()||'—';return value.length>34?`${value.slice(0,34)}…`:value;}))};
    }
    const text=rows.slice(0,8).flat().map(value=>String(value??'').trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    return{type:'text',title:'文件内容',subtitle,text:text?`${text.slice(0,420)}${text.length>420?'…':''}`:'暂时没有可展示的内容'};
  }

  function sourceInspectorPreview(decision) {
    const tasks=sourceTasksForDecision(decision);
    if(decision.purpose==='mail'&&!decision.needsReview&&tasks.length){
      const task=tasks[0],body=String(task.body||'').replace(/\s+/g,' ').trim();
      return{type:'mail',title:'邮件内容',subtitle:tasks.length>1?`共 ${tasks.length} 封`:'1 封邮件',recipients:task.recipients||'尚未读取',subject:task.subject||'尚未读取',body:body?`${body.slice(0,520)}${body.length>520?'…':''}`:'尚未读取'};
    }
    if(decision.purpose==='roster'&&!decision.needsReview)return sourceRosterPreview(decision);
    return sourceGenericPreview(decision);
  }

  function renderSourceInspector(decision) {
    if(!decision){globalThis.NMDAWorkspaceImportUi.publishPatch({inspector:null});return;}
    const visual=sourceRoleVisual(decision.purpose,decision.needsReview),fileName=String(decision.sourceName||'').replace(/\\/g,'/').split('/').pop()||decision.sourceName;
    const pending=uniqueFiles(batch.dataset?.sourceFiles||[]).map(sourcePurposeDecision).filter(item=>item.needsReview&&item.sourceName!==decision.sourceName);
    globalThis.NMDAWorkspaceImportUi.publishPatch({inspector:{source:decision.sourceName,fileName,fileVisual:sourceFileVisual(fileName),path:sourceDirectoryPath(decision.sourceName)||'根目录',size:humanFileSize(decision.file?.size),needsReview:decision.needsReview,reason:sourceFriendlyReason(decision),purpose:decision.purpose,tone:visual.tone,icon:visual.icon,label:visual.label,preview:sourceInspectorPreview(decision),nextSource:pending[0]?.sourceName||'',remaining:pending.length}});
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
    const details=$('nmda-preflight-source-routing');
    const files=uniqueFiles(batch.dataset?.sourceFiles||[]),decisions=files.map(sourcePurposeDecision);
    batch.preflightReviewOnly=false;
    const counts={mail:0,roster:0,attachment:0,ignored:0,review:0};
    for(const decision of decisions){if(decision.needsReview)counts.review++;else counts[decision.purpose]=(counts[decision.purpose]||0)+1;}
    const visible=sourceVisibleDecisions(decisions),folder=batch.preflightFolderPath||'',folderName=folder?folder.split('/').pop():'全部文件';
    const folderTree=buildSourceFolderTree(decisions);
    const folders=(node,depth=0)=>[...node.folders.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(item=>({name:item.name,path:item.path,count:item.count,depth,children:folders(item,depth+1)}));
    const rows=visible.map(decision=>{
      const visual=sourceRoleVisual(decision.purpose,decision.needsReview),fileName=String(decision.sourceName||'').replace(/\\/g,'/').split('/').pop()||'未命名来源';
      const path=sourceDirectoryPath(decision.sourceName);
      return {source:decision.sourceName,fileName,fileVisual:sourceFileVisual(fileName),meta:[path||'根目录',humanFileSize(decision.file?.size)].filter(Boolean).join(' · '),tone:visual.tone,icon:visual.icon,label:visual.label,needsReview:decision.needsReview,selected:batch.sourceInspectName===decision.sourceName};
    });
    globalThis.NMDAWorkspaceImportUi.publishPatch({sourceUi:{counts,filter:batch.preflightPurposeFilter||'',folder,folderName,visibleCount:visible.length,search:batch.preflightSearch||'',total:decisions.length,folders:folders(folderTree),rows}});
    if(details)details.hidden=!decisions.length;
    const selected=decisions.find(item=>item.sourceName===batch.sourceInspectName);renderSourceInspector(selected||null);
  }

  window.addEventListener('nmda:preflight-source-action',event=>{
    const {action,value,source}=event.detail||{};
    if(action==='filter'){batch.preflightPurposeFilter=batch.preflightPurposeFilter===value?'':value;renderPreflightSourceRoles();}
    else if(action==='folder'){batch.preflightFolderPath=String(value||'');renderPreflightSourceRoles();}
    else if(action==='search'){batch.preflightSearch=String(value||'');renderPreflightSourceRoles();}
    else if(action==='inspect')inspectSourceInPreflight(source);
    else if(action==='purpose'){if(value==='review')setSourceNeedsReview(source);else setSourcePurpose(source,value);}
    else if(action==='drop-purpose'){
      document.querySelector('.nmda-classify-dialog')?.classList.remove('is-drag-classifying');
      const selectedSource=source||batch.sourceInspectName;
      if(selectedSource){if(value==='review')setSourceNeedsReview(selectedSource);else setSourcePurpose(selectedSource,value);}
    }
    else if(action==='close-inspector'){batch.sourceInspectName='';renderPreflightSourceRoles();}
    else if(action==='drag-start'){batch.sourceInspectName=source;document.querySelector('.nmda-classify-dialog')?.classList.add('is-drag-classifying');}
    else if(action==='drag-end')document.querySelector('.nmda-classify-dialog')?.classList.remove('is-drag-classifying');
  });

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

  function publishAttachmentWorkspace() {
    const entries=attachmentAssetEntries(),count=entries.length;
    const snapshot=globalThis.NMDAWorkspaceImportUi.getSnapshot();
    const support=snapshot.support;
    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,matched:0,issues:0};
    const modes={smart:0,all:0,selected:0};for(const entry of entries)modes[entry.policy?.mode||'smart']=(modes[entry.policy?.mode||'smart']||0)+1;
    const totalTasks=(batch.tasks||[]).filter(task=>task.enabled&&!task.policyBlocked).length;
    const uiState=attachmentUiState(),targetIdentity=uiState.targetIdentity||'';
    const targetEntry=entries.find(entry=>entry.identity===targetIdentity);
    const targetPolicy=targetEntry?ensureAttachmentPolicy(targetEntry.file,targetEntry.kind):null;
    const target=targetEntry&&targetPolicy?.mode==='selected'?{
      identity:targetIdentity,title:`${targetEntry.file.name} · 指定邮件`,
      tasks:(batch.tasks||[]).map(task=>({key:task.editKey,recipient:task.recipients||'',subject:task.subject||'',school:task.school||'',selected:(targetPolicy.targets||[]).includes(task.editKey)}))
    }:null;
    const pool=allAttachmentFiles();
    const requirements=attachmentRequirementOverview().map(item=>{
      const complete=item.matched>=item.total;
      return {key:item.key,ref:item.ref,tone:complete?'ok':item.ambiguous?'warn':'danger',status:complete?`已覆盖 ${item.matched}/${item.total}`:`未匹配 ${item.total-item.matched}/${item.total} · 不阻断`,files:[...item.files],choices:!complete&&pool.length?pool.map(file=>({identity:Importer.fileIdentity(file),label:file.webkitRelativePath||file._nmdaPath||file.name})):[]};
    });
    const attachmentPatch={
      summary:{count,matched:stats.matched||0,total:stats.total||0,issues:stats.issues||0,smart:modes.smart,all:modes.all,selected:modes.selected},
      entries:entries.map(entry=>{
        const policy=entry.policy||ensureAttachmentPolicy(entry.file,entry.kind),mode=policy.mode||'smart';
        return {identity:entry.identity,name:entry.file.name||'附件',size:formatAttachmentSize(entry.file),source:entry.source||'附件',mode,used:entry.used,tone:mode==='smart'&&!entry.used?'warn':'ok',scope:mode==='all'?`全部 ${totalTasks} 封`:mode==='selected'?`指定 ${(policy.targets||[]).length} 封`:entry.used?`自动匹配 ${entry.used} 封`:'自动匹配 · 尚未命中'};
      }),
      requirements,target
    };
    globalThis.NMDAWorkspaceImportUi.publishPatch({
      support:{...support,attachment:{...support.attachment,count}},
      attachments:{...snapshot.attachments,...attachmentPatch}
    });
    renderBatchPrepStrip();
    syncStageSurfaceVisibility();
    syncModalState();
  }

  function draftAttachmentGroupKey(attachment){
    const name=String(attachment?.name||'').trim().toLowerCase();
    const size=Number(attachment?.size||0)||0;
    return `${name}|${size}`;
  }

  function rebuildDraftAttachmentGroups(){
    const groups=new Map();
    for(const draft of draftAttachmentTool.drafts||[]){
      if(!draft?.ok)continue;
      for(const attachment of draft.attachments||[]){
        if(!attachment||attachment.kind!=='attachment'||attachment.inlined)continue;
        const name=String(attachment.name||'').trim();
        const id=String(attachment.id||'').trim();
        if(!name||!id)continue;
        const key=draftAttachmentGroupKey(attachment);
        if(!groups.has(key))groups.set(key,{key,name,size:Number(attachment.size||0)||0,entries:[],draftIds:new Set(),scheduled:0});
        const group=groups.get(key);
        group.entries.push({draft,attachment});
        if(!group.draftIds.has(String(draft.id||''))){group.draftIds.add(String(draft.id||''));if(draft.scheduleAt)group.scheduled++;}
      }
    }
    draftAttachmentTool.groups=[...groups.values()].sort((a,b)=>b.draftIds.size-a.draftIds.size||a.name.localeCompare(b.name,'zh-CN'));
    if(draftAttachmentTool.selectedKey&&!draftAttachmentTool.groups.some(group=>group.key===draftAttachmentTool.selectedKey)){
      draftAttachmentTool.selectedKey='';draftAttachmentTool.selectedDraftIds.clear();draftAttachmentTool.replacementFile=null;
    }
  }

  function selectedDraftAttachmentGroup(){return draftAttachmentTool.groups.find(group=>group.key===draftAttachmentTool.selectedKey)||null;}

  function draftAttachmentTargets(group=selectedDraftAttachmentGroup()){
    if(!group)return[];
    const byDraft=new Map();
    for(const entry of group.entries){
      const draft=entry.draft,id=String(draft?.id||'');if(!id)continue;
      if(!byDraft.has(id))byDraft.set(id,{draft,attachments:[]});
      byDraft.get(id).attachments.push(entry.attachment);
    }
    return [...byDraft.values()];
  }

  function setDraftAttachmentUtilityResult(message,tone='ok'){
    const snapshot=globalThis.NMDAWorkspaceUtilityUi.getSnapshot();
    globalThis.NMDAWorkspaceUtilityUi.publishPatch({draftAttachment:{...snapshot.draftAttachment,result:{message:String(message||''),tone}}});
  }

  function setDraftAttachmentProgress(message,tone=''){
    const snapshot=globalThis.NMDAWorkspaceUtilityUi.getSnapshot();
    globalThis.NMDAWorkspaceUtilityUi.publishPatch({draftAttachment:{...snapshot.draftAttachment,progress:{message:String(message||''),tone}}});
  }

  const DRAFT_ATTACHMENT_MOTION_ORDER=['read','clone','attachments','verify','swap'];
  const DRAFT_ATTACHMENT_MOTION_LABELS={seed:'准备新版附件',read:'读取原草稿',clone:'创建新草稿',attachments:'更新附件',verify:'核对邮件内容',swap:'完成替换',done:'附件更新完成',stopped:'已停止更新',error:'附件更新异常'};

  function normalizeDraftAttachmentMotionPhase(phase=''){
    const raw=String(phase||'');
    if(raw==='attachment-seed'||raw==='seed')return 'seed';
    if(raw==='restore'||raw==='baseline'||raw==='read')return 'read';
    if(raw==='build'||raw==='clone'||raw==='clone-commit'||raw==='clone-discovery')return 'clone';
    if(raw==='attachments'||raw==='clone-attachments'||raw==='copy-attachments')return 'attachments';
    if(raw==='verify'||raw==='clone-verify')return 'verify';
    if(raw==='swap'||raw==='swap-delete-original'||raw==='swap-verify')return 'swap';
    if(raw==='done'||raw==='finish')return 'done';
    if(raw==='stopped'||raw==='cancelled'||raw==='canceled')return 'stopped';
    if(raw==='error'||raw.includes('error')||raw.includes('rollback'))return 'error';
    return raw||'read';
  }

  function setDraftAttachmentMotion(payload={}){
    const snapshot=globalThis.NMDAWorkspaceUtilityUi.getSnapshot(),current=snapshot.draftAttachment.motion;
    const phase=normalizeDraftAttachmentMotionPhase(payload.phase||'read');
    const stageLabels={read:'读取原稿',clone:'创建新稿',attachments:'更新附件',verify:'核对内容',swap:'完成替换'};
    const stagePhase=phase==='seed'?'read':phase==='done'?'swap':phase;
    const activeIndex=DRAFT_ATTACHMENT_MOTION_ORDER.indexOf(stagePhase);
    const count=payload.current!=null||payload.total!=null?`${Math.max(0,Number(payload.current||0))} / ${Math.max(0,Number(payload.total||0))}`:current.count;
    const motion={
      visible:payload.hidden!==true,
      phase,
      title:DRAFT_ATTACHMENT_MOTION_LABELS[phase]||'附件更新',
      count,
      oldName:payload.oldName!=null?(payload.oldName||'旧附件'):current.oldName,
      newName:payload.newName!=null?(payload.newName||'新版附件'):current.newName,
      subject:payload.subject!=null?(payload.subject||'当前草稿'):current.subject,
      message:payload.message!=null?(payload.message||''):current.message,
      stages:DRAFT_ATTACHMENT_MOTION_ORDER.map((key,index)=>({
        key,label:stageLabels[key],
        active:phase!=='done'&&phase!=='error'&&index===activeIndex,
        complete:phase==='done'||index<activeIndex,
        error:phase==='error'&&index===Math.max(0,activeIndex)
      }))
    };
    globalThis.NMDAWorkspaceUtilityUi.publishPatch({draftAttachment:{...snapshot.draftAttachment,motion}});
  }

  function renderUtilityHubSummary(){
    const summary=draftAttachmentTool.loading?'正在读取草稿箱':draftAttachmentTool.scanned?`${draftAttachmentTool.drafts.length} 封草稿 · ${draftAttachmentTool.groups.length} 组附件`:'读取草稿箱';
    globalThis.NMDAWorkspaceUtilityUi.publishPatch({draftAttachmentSummary:summary});
  }

  async function scanDraftAttachmentTool(options={}){
    if(draftAttachmentTool.loading||(draftAttachmentTool.running&&!options.allowDuringRun))return false;
    draftAttachmentTool.loading=true;draftAttachmentTool.scanned=true;
    setDraftAttachmentUtilityResult('');setDraftAttachmentProgress('正在读取网易草稿箱与附件明细…');
    renderDraftAttachmentTool();
    try{
      const result=await Runtime.scanDraftAttachments();
      if(!result?.ok)throw new Error(result?.reason||'读取草稿箱失败');
      draftAttachmentTool.drafts=(result.drafts||[]).filter(Boolean);
      rebuildDraftAttachmentGroups();
      setDraftAttachmentProgress('');
      if(result.failures)setDraftAttachmentUtilityResult(`已读取 ${result.read||draftAttachmentTool.drafts.length} 封草稿；其中 ${result.failures} 封详情读取失败，未纳入附件替换。`,'warn');
    }catch(error){
      draftAttachmentTool.drafts=[];draftAttachmentTool.groups=[];
      setDraftAttachmentProgress('');setDraftAttachmentUtilityResult(error?.message||String(error),'error');
    }finally{draftAttachmentTool.loading=false;renderDraftAttachmentTool();}
    return true;
  }

  function renderDraftAttachmentTool(){
    rebuildDraftAttachmentGroups();
    const groups=draftAttachmentTool.groups||[];
    const withAttachments=new Set(groups.flatMap(group=>[...group.draftIds])).size;
    const selected=selectedDraftAttachmentGroup();
    const targets=draftAttachmentTargets(selected);
    const selectedCount=targets.filter(item=>draftAttachmentTool.selectedDraftIds.has(String(item.draft.id||''))).length;
    const previous=globalThis.NMDAWorkspaceUtilityUi.getSnapshot().draftAttachment;
    const file=draftAttachmentTool.replacementFile;
    const groupsForUi=groups.map(group=>({key:group.key,name:group.name,sizeLabel:formatAttachmentSize({size:group.size}),draftCount:group.draftIds.size,scheduled:group.scheduled}));
    const targetsForUi=targets.map(item=>{
      const draft=item.draft,id=String(draft.id||'');
      return {id,subject:draft.subject||'(无主题)',recipient:String(draft.recipients||draft.toRaw||'').trim()||'未识别收件人',scheduleAt:draft.scheduleAt?String(draft.scheduleAt).replace('T',' '):'',attachmentCount:item.attachments.length,selected:draftAttachmentTool.selectedDraftIds.has(id)};
    });
    globalThis.NMDAWorkspaceUtilityUi.publishPatch({draftAttachment:{
      draftsCount:draftAttachmentTool.drafts.length,
      withAttachments,
      versionCount:groups.length,
      selectedCount,
      groups:groupsForUi,
      selectedKey:selected?.key||'',
      selectedName:selected?.name||'',
      selectedCopy:selected?`${selected.draftIds.size} 封草稿包含这个版本${selected.scheduled?`，其中 ${selected.scheduled} 封已定时；排期会保持不变。`: '。'}`:'系统会列出所有包含该旧附件的草稿。',
      targets:targetsForUi,
      replacementName:file?file.name:'选择新版附件',
      replacementMeta:file?`${formatAttachmentSize(file)} · 只需选择一次；每封都会先核对新草稿，再替换旧草稿。`:'只需选择一次；每封都会先核对新草稿，再替换旧草稿。',
      replacementSelected:!!file,
      loading:draftAttachmentTool.loading,
      running:draftAttachmentTool.running,
      stopping:draftAttachmentTool.stopping,
      cancelRequested:draftAttachmentTool.cancelRequested,
      runLabel:draftAttachmentTool.running?(draftAttachmentTool.stopping?'正在停止…':'正在更新草稿…'):`更新 ${selectedCount||0} 封草稿`,
      result:previous.result,
      progress:previous.progress,
      motion:previous.motion
    }});
    renderUtilityHubSummary();
  }

  async function runDraftAttachmentReplacement(){
    if(draftAttachmentTool.running)return;
    const group=selectedDraftAttachmentGroup(),file=draftAttachmentTool.replacementFile;
    if(!group||!file)return;
    if(group.name===file.name && Number(group.size||0)===Number(file.size||0)){
      return setDraftAttachmentUtilityResult('新版附件与旧版同名且大小完全相同，网易侧无法可靠区分两个版本。请临时改名后再替换。','warn');
    }
    const targets=draftAttachmentTargets(group).filter(item=>draftAttachmentTool.selectedDraftIds.has(String(item.draft.id||'')));
    if(!targets.length)return;

    const executionId=crypto.randomUUID();
    draftAttachmentTool.running=true;
    draftAttachmentTool.stopping=false;
    draftAttachmentTool.cancelRequested=false;
    draftAttachmentTool.executionId=executionId;
    renderDraftAttachmentTool();
    setDraftAttachmentUtilityResult('');

    let refs=[],seedDraftId='',seedIdentity=null,seedCleanupWarning='';
    let done=0,failed=0;
    const failures=[];
    const doneIds=new Set();
    setDraftAttachmentMotion({phase:'seed',current:0,total:targets.length,oldName:group.name,newName:file.name,subject:'准备批量附件更新',message:'正在确认网易邮箱连接…'});
    const stopProgress = Execution.onProgress(executionId,message=>{
      if(draftAttachmentTool.cancelRequested)return;
      setDraftAttachmentProgress(message?.message||'');
      setDraftAttachmentMotion({phase:message?.phase||'read',current:message?.current,total:message?.total,oldName:group.name,newName:file.name,subject:message?.subject||message?.detail?.subject,message:message?.message||''});
    });

    const stopRemote=async()=>{
      try{
        await Promise.race([
          Runtime.cancelAttachment(executionId),
          new Promise(resolve=>setTimeout(()=>resolve(null),5000))
        ]);
      }catch(_){}
    };

    try{
      const connection=await awaitDraftAttachmentStep(Runtime.connectionStatus(),executionId,8000,'连接网易邮箱');
      throwIfDraftAttachmentCancelled();
      if(!connection?.connected)throw new Error('没有检测到已打开的网易邮箱。请先打开并登录 163 邮箱后再执行附件更新。');
      if(!connection?.authenticated)throw new Error('网易邮箱已打开，但尚未检测到登录账号。请完成登录后再执行附件更新。');

      setDraftAttachmentMotion({phase:'seed',current:0,total:targets.length,oldName:group.name,newName:file.name,subject:'准备批量附件更新',message:'正在切换到 163 邮箱并建立新版附件源…'});
      await awaitDraftAttachmentStep(Runtime.monitorAttachment({focus:true,payload:{action:'start',executionId,total:targets.length,current:0,oldName:group.name,newName:file.name,message:'正在建立新版附件源…'}}),executionId,15000,'打开邮箱执行视图');
      throwIfDraftAttachmentCancelled();

      refs=await prepareRuntimeFileRefs([file]);
      if(!refs[0])throw new Error('新版附件未准备好，请重新选择文件。');
      setDraftAttachmentProgress('正在上传新版附件；如果网易上传队列停止响应，系统会自动退出而不是无限等待…');
      const seed=await awaitDraftAttachmentStep(
        Runtime.seedAttachment(executionId,refs[0]),
        executionId,120000,'上传新版附件'
      );
      throwIfDraftAttachmentCancelled();
      if(!seed?.ok||!seed?.source)throw new Error(seed?.reason||'新版附件源建立失败');
      seedDraftId=String(seed.seedDraftId||'');
      seedIdentity=seed.seedIdentity||null;
      const source={...seed.source,name:file.name,size:file.size};
      let cursor=0;
      const integrityBaseline=new Map(targets.map(item=>[String(item.draft.id||''),{subject:String(item.draft.subject||''),recipients:String(item.draft.recipients||''),cc:String(item.draft.cc||''),bcc:String(item.draft.bcc||''),bodyHtml:String(item.draft.bodyHtml||''),scheduleAt:String(item.draft.scheduleAt||''),oldAttachments:item.attachments.map(att=>({name:String(att.name||''),size:Number(att.size||0)||0}))}]));

      // Clone-and-swap deliberately keeps a single transaction in flight. Stopping therefore
      // means: finish/rollback the current safe transaction, then do not start another draft.
      async function worker(){
        while(cursor<targets.length){
          throwIfDraftAttachmentCancelled();
          const item=targets[cursor++],draft=item.draft,draftId=String(draft.id||'');
          const deleteAttachments=item.attachments.map(att=>({id:String(att.id||''),name:String(att.name||''),size:Number(att.size||0)||0,partId:String(att.partId||'')}));
          const targetAttachmentIds=new Set(deleteAttachments.map(att=>att.id).filter(Boolean));
          try{
            const existing=(draft.attachments||[]).some(att=>!targetAttachmentIds.has(String(att.id||''))&&String(att.name||'')===file.name&&(!Number(att.size||0)||Math.abs(Number(att.size||0)-file.size)<100));
            const currentIndex=done+failed+1;
            setDraftAttachmentProgress(`正在安全重建并替换附件 ${currentIndex}/${targets.length} · ${draft.subject||draftId}`);
            const mutated=await awaitDraftAttachmentStep(Runtime.mutateAttachment({
              executionId,current:currentIndex,total:targets.length,
              draftId,
              deleteAttachments,
              source:existing?null:source,
              summary:{id:draftId,scheduleAt:draft.scheduleAt||'',savedAt:draft.savedAt||'',subject:draft.subject||'',flags:draft.flags||{},scheduledDraft:!!draft.scheduledDraft}
            }),executionId,90000,`更新草稿 ${currentIndex}/${targets.length}`);
            throwIfDraftAttachmentCancelled();
            if(mutated?.cancelled)throw draftAttachmentCancelledError();
            if(!mutated?.ok||mutated.verified!==true)throw new Error(mutated?.reason||'草稿附件更新后核对失败');
            const committedId=String(mutated.draftId||draftId);
            if(committedId!==draftId){
              const before=integrityBaseline.get(draftId);
              if(before){integrityBaseline.set(committedId,before);integrityBaseline.delete(draftId);}
            }
            done++;doneIds.add(committedId);
          }catch(error){
            if(error?.code==='NMDA_DRAFT_ATTACHMENT_CANCELLED')throw error;
            failed++;failures.push(`${draft.subject||draftId}：${error?.message||String(error)}`);
            setDraftAttachmentMotion({phase:'error',current:done+failed,total:targets.length,oldName:group.name,newName:file.name,subject:draft.subject||draftId,message:error?.message||String(error)});
            await Promise.race([
              Runtime.monitorAttachment({focus:false,payload:{action:'progress',executionId,phase:'error',current:done+failed,total:targets.length,subject:draft.subject||draftId,oldName:group.name,newName:file.name,message:error?.message||String(error)}}).catch(()=>null),
              new Promise(resolve=>setTimeout(resolve,5000))
            ]);
          }
          setDraftAttachmentProgress(`草稿附件更新 ${done+failed}/${targets.length} · 成功 ${done}${failed?` · 失败 ${failed}`:''}`,failed?'warn':'');
        }
      }
      await worker();
      throwIfDraftAttachmentCancelled();

      if(seedIdentity||seedDraftId){
        setDraftAttachmentProgress('草稿已替换，正在删除一次性附件源并确认草稿箱中不再残留…');
        for(let attempt=0;attempt<2&&(seedIdentity||seedDraftId);attempt++){
          if(attempt)await new Promise(resolve=>setTimeout(resolve,180*(attempt+1)));
          throwIfDraftAttachmentCancelled();
          const cleanup=await awaitDraftAttachmentStep(
            Runtime.cleanupAttachmentSeed(executionId,seedIdentity||{},seedDraftId).catch(error=>({ok:false,reason:error?.message||String(error)})),
            executionId,45000,'清理并核验临时附件源'
          );
          if(cleanup?.ok&&cleanup?.verified!==false){seedIdentity=null;seedDraftId='';}
          else if(attempt===1)seedCleanupWarning=`临时附件源未能确认删除（${cleanup?.reason||'unknown'}），请在草稿箱核对。`;
        }
      }
      throwIfDraftAttachmentCancelled();

      setDraftAttachmentProgress('更新已完成，正在核对草稿箱…');
      await awaitDraftAttachmentStep(scanDraftAttachmentTool({allowDuringRun:true}),executionId,60000,'核对草稿箱');
      throwIfDraftAttachmentCancelled();

      const sameMinute=(a,b)=>{const left=String(a||'').trim(),right=String(b||'').trim();if(!left&&!right)return true;if(!left||!right)return false;const la=Date.parse(left),rb=Date.parse(right);return Number.isFinite(la)&&Number.isFinite(rb)?Math.abs(la-rb)<60000:left===right;};
      const integrityFailures=[];
      for(const draftId of doneIds){
        const before=integrityBaseline.get(draftId),after=(draftAttachmentTool.drafts||[]).find(item=>String(item?.id||'')===draftId);
        if(!before||!after?.ok){integrityFailures.push(`${before?.subject||draftId}：更新后无法重新读取草稿`);continue;}
        const changed=[];
        if(String(after.subject||'')!==before.subject)changed.push('主题');
        if(String(after.recipients||'')!==before.recipients)changed.push('收件人');
        if(String(after.cc||'')!==before.cc)changed.push('抄送');
        if(String(after.bcc||'')!==before.bcc)changed.push('密送');
        if(String(after.bodyHtml||'')!==before.bodyHtml)changed.push('正文');
        if(!sameMinute(after.scheduleAt,before.scheduleAt))changed.push('排期');
        const afterAttachments=Array.isArray(after.attachments)?after.attachments:[];
        const oldStillPresent=(before.oldAttachments||[]).some(old=>afterAttachments.some(att=>{
          const sameName=String(att?.name||'')===String(old?.name||'');
          const a=Number(att?.size||0),b=Number(old?.size||0);
          return sameName&&(!a||!b||Math.abs(a-b)<100);
        }));
        if(oldStillPresent)changed.push('旧附件仍存在');
        const replacementPresent=afterAttachments.some(att=>String(att?.name||'')===file.name&&(!Number(att?.size||0)||Math.abs(Number(att?.size||0)-file.size)<100));
        if(!replacementPresent)changed.push('新版附件缺失');
        if(changed.length)integrityFailures.push(`${before.subject||draftId}：${changed.join('、')}${changed.some(label=>label.includes('附件'))?'':'发生变化'}`);
      }

      if(integrityFailures.length){
        setDraftAttachmentMotion({phase:'error',current:done+failed,total:targets.length,oldName:group.name,newName:file.name,subject:'完整性核验异常',message:`发现 ${integrityFailures.length} 封草稿需要核对。`});
        await Promise.race([Runtime.monitorAttachment({focus:false,payload:{action:'finish',executionId,status:'error',total:targets.length,current:done+failed,succeeded:done,failed,message:`完整性异常 ${integrityFailures.length} 封`}}).catch(()=>null),new Promise(resolve=>setTimeout(resolve,5000))]);
        setDraftAttachmentUtilityResult(`附件更新已执行，但发现 ${integrityFailures.length} 封草稿存在完整性异常，请立即核对：${integrityFailures.slice(0,3).join('；')}${integrityFailures.length>3?'…':''}${seedCleanupWarning?`；${seedCleanupWarning}`:''}`,'error');
      }else if(failed){
        setDraftAttachmentMotion({phase:'error',current:done+failed,total:targets.length,oldName:group.name,newName:file.name,subject:'部分草稿未完成',message:`成功 ${done} · 失败 ${failed}`});
        await Promise.race([Runtime.monitorAttachment({focus:false,payload:{action:'finish',executionId,status:'error',total:targets.length,current:done+failed,succeeded:done,failed,message:`成功 ${done} · 失败 ${failed}`}}).catch(()=>null),new Promise(resolve=>setTimeout(resolve,5000))]);
        setDraftAttachmentUtilityResult(`已更新 ${done} 封，${failed} 封未完成。失败草稿会保留原草稿；${failures.slice(0,3).join('；')}${failures.length>3?'…':''}${seedCleanupWarning?`；${seedCleanupWarning}`:''}`,'warn');
      }else{
        setDraftAttachmentMotion({phase:'done',current:done,total:targets.length,oldName:group.name,newName:file.name,subject:'全部草稿已安全切换',message:seedCleanupWarning?'附件更新完成；临时源需要人工清理。':'新版附件已接管，旧草稿已在验证后安全移除。'});
        await Promise.race([Runtime.monitorAttachment({focus:false,payload:{action:'finish',executionId,status:'done',total:targets.length,current:done,succeeded:done,failed:0,message:'附件更新完成'}}).catch(()=>null),new Promise(resolve=>setTimeout(resolve,5000))]);
        if(seedCleanupWarning)setDraftAttachmentUtilityResult(`已完成 ${done} 封草稿的附件更新并通过完整性核验；${seedCleanupWarning}`,'warn');
        else setDraftAttachmentUtilityResult(`已完成 ${done} 封草稿的附件更新，并确认正文、收件人、主题与原发送时间保持不变。`,'ok');
      }
    }catch(error){
      const cancelled=error?.code==='NMDA_DRAFT_ATTACHMENT_CANCELLED'||draftAttachmentTool.cancelRequested;
      if(!cancelled)await stopRemote();
      if(cancelled){
        setDraftAttachmentMotion({phase:'stopped',current:done+failed,total:targets.length,oldName:group.name,newName:file.name,subject:'本次更新已停止',message:done?`已完成 ${done} 封；后续草稿未继续执行。`:'没有继续执行后续草稿。'});
        await Promise.race([Runtime.monitorAttachment({focus:false,payload:{action:'finish',executionId,status:'stopped',total:targets.length,current:done+failed,succeeded:done,failed,message:'用户已停止本次附件更新'}}).catch(()=>null),new Promise(resolve=>setTimeout(resolve,3500))]);
        setDraftAttachmentUtilityResult(done?`已停止。本次已安全完成 ${done} 封，剩余草稿没有继续执行。`:'已停止本次附件更新，未继续处理后续草稿。','warn');
      }else{
        setDraftAttachmentMotion({phase:'error',current:done+failed,total:targets.length,oldName:group.name,newName:file.name,subject:'执行中断',message:error?.message||String(error)});
        await Promise.race([Runtime.monitorAttachment({focus:false,payload:{action:'finish',executionId,status:'error',total:targets.length,current:done+failed,succeeded:done,failed:Math.max(failed,targets.length-done),message:error?.message||String(error)}}).catch(()=>null),new Promise(resolve=>setTimeout(resolve,3500))]);
        setDraftAttachmentUtilityResult(`${error?.message||String(error)} 已请求停止后台执行；可以重新检查草稿状态后再试。`,'error');
      }
    }finally{
      if(seedIdentity||seedDraftId){
        // Final safety cleanup is intentionally allowed to outlive the visible run. The
        // provider can acknowledge cancellation before the Draft MID disappears, so give
        // the verified cleanup transaction enough time to restore/delete/recheck once more.
        await Promise.race([
          Runtime.cleanupAttachmentSeed(executionId,seedIdentity||{},seedDraftId).catch(()=>null),
          new Promise(resolve=>setTimeout(()=>resolve(null),30000))
        ]);
      }
      stopProgress();
      releaseRuntimeFileRefs(refs);
      draftAttachmentCancelListeners.delete(executionId);
      draftAttachmentTool.running=false;
      draftAttachmentTool.stopping=false;
      draftAttachmentTool.cancelRequested=false;
      draftAttachmentTool.executionId='';
      setDraftAttachmentProgress('');
      renderDraftAttachmentTool();
    }
  }

  function openAttachmentManager() {
    if(!batch.dataset)return;
    setWorkbenchTab('batch');
    if(location.hash!=='#batch')history.replaceState(null,'','#batch');
    hideReviewWorkspaceWithoutStash();
    batch.supplementPreflightOpen=false;
    batch.uiStep=1;
    patchAttachmentUi({visible:true});
    renderSupplementPreflight();
    publishAttachmentWorkspace();
    requestAnimationFrame(()=>$('nmda-attachment-manager-overlay')?.scrollIntoView?.({behavior:'smooth',block:'nearest'}));
  }
  function closeAttachmentManager() { patchAttachmentUi({visible:false,targetIdentity:''});publishAttachmentWorkspace(); }

  function removeAttachmentAsset(identity) {
    if(!identity)return;
    const keep=file=>Importer.fileIdentity(file)!==identity;
    batch.ignoredAttachmentIdentities.add(identity);
    batch.directoryFiles=(batch.directoryFiles||[]).filter(keep);batch.taskFiles=(batch.taskFiles||[]).filter(keep);batch.routedAttachmentFiles=(batch.routedAttachmentFiles||[]).filter(keep);
    batch.attachmentPolicies?.delete(identity);if(attachmentUiState().targetIdentity===identity)patchAttachmentUi({targetIdentity:''});
    batch.attachmentPrepChoice=attachmentPreparedFileCount()?'added':(batch.supplementPreflightDone?'skipped':'pending');
    refreshFileIndex(false);renderSupplementPreflight();publishAttachmentWorkspace();
  }

  function clearAttachmentAssets() {
    for(const file of batch.routedAttachmentFiles||[])batch.ignoredAttachmentIdentities.add(Importer.fileIdentity(file));
    if(dirEl)dirEl.value='';if(taskFilesEl)taskFilesEl.value='';if(preSendMatchFilesEl)preSendMatchFilesEl.value='';if(preSendSharedFilesEl)preSendSharedFilesEl.value='';
    batch.directoryFiles=[];batch.taskFiles=[];batch.routedAttachmentFiles=[];batch.attachmentOverrides.clear();batch.attachmentPolicies=new Map();patchAttachmentUi({targetIdentity:''});
    batch.attachmentPrepChoice=batch.supplementPreflightDone?'skipped':'pending';refreshFileIndex(true);renderSupplementPreflight();publishAttachmentWorkspace();
  }

  function renderBatchPrepStrip() {
    const hasBatch=!!batch.dataset&&!!(batch.tasks||[]).length;
    if(!hasBatch){globalThis.NMDAWorkspaceImportUi.publishPatch({prep:{visible:false}});return;}
    const rState=rosterContextState(),aState=attachmentPreflightState(),rCount=referenceRosterCount(),aCount=attachmentPreparedFileCount(),stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
    globalThis.NMDAWorkspaceImportUi.publishPatch({prep:{visible:true,rosterState:rState,rosterText:rState==='added'?`${rCount} 条已加入`:rState==='skipped'?'未添加':'待确认',attachmentState:aState,attachmentText:aCount?`${aCount} 个附件${stats.issues?` · ${stats.issues} 项提醒`:''}`:stats.issues?`${stats.issues} 项提示`:aState==='skipped'?'暂未添加':'待确认',manageText:aCount?'查看 / 修改':'准备附件',buttonText:supplementPreflightNeedsDecision()?'继续准备':'补充资料'}});
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
      setBatchStatus('暂无待发送邮件；请先在“审阅邮件”确认邮件已就绪。','warn');
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
      const target=rosterPlannerIsOpen()?$('nmda-roster-planner-done'):$('nmda-open-schedule-modal');
      target?.focus?.({preventScroll:true});
    });
  }

  function setPreflightView(view = 'files') {
    const next=view==='support'?'support':'files';
    batch.preflightView=next;
    globalThis.NMDAWorkspaceImportUi.publishPatch({preflight:{...globalThis.NMDAWorkspaceImportUi.getSnapshot().preflight,view:next}});
    const workspace=$('nmda-supplement-preflight')?.querySelector('.nmda-classify-workspace');
    if(workspace)workspace.dataset.preflightView=next;
    ui.querySelectorAll('[data-preflight-panel]').forEach(panel=>{
      panel.hidden=panel.dataset.preflightPanel!==next;
    });
  }

  function setSupportView(view = 'roster') {
    const next=view==='attachment'?'attachment':'roster';
    batch.supportView=next;
    const supportUi=globalThis.NMDAWorkspaceImportUi.getSnapshot().support;
    globalThis.NMDAWorkspaceImportUi.publishPatch({support:{...supportUi,view:next}});
    const support=$('nmda-supplement-preflight')?.querySelector('.nmda-classify-support-view');
    if(support)support.dataset.supportView=next;
  }

  function renderSupplementPreflight() {
    const overlay=$('nmda-supplement-preflight');if(!overlay)return;
    const hasBatch=!!batch.dataset,visible=hasBatch&&!!batch.supplementPreflightOpen;
    overlay.hidden=!visible;overlay.setAttribute('aria-hidden',visible?'false':'true');syncModalState();
    renderBatchPrepStrip();
    if(!hasBatch)return;
    const sourceDecisions=uniqueFiles(batch.dataset?.sourceFiles||[]).map(sourcePurposeDecision),reviewCount=sourceDecisions.filter(item=>item.needsReview).length,taskCount=(batch.tasks||[]).length;
    globalThis.NMDAWorkspaceImportUi.publishPatch({preflight:{...globalThis.NMDAWorkspaceImportUi.getSnapshot().preflight,reviewCount,taskCount}});
    setPreflightView(batch.preflightView||'files');
    setSupportView('roster');
    const stats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,matched:0,issues:0};
    const supportUi=globalThis.NMDAWorkspaceImportUi.getSnapshot().support;
    globalThis.NMDAWorkspaceImportUi.publishPatch({support:{...supportUi,roster:{state:rosterContextState(),count:referenceRosterCount()},attachment:{state:attachmentPreflightState(),total:stats.total||0,issues:stats.issues||0,count:attachmentPreparedFileCount(),requirements:attachmentRequirementRefs()}}});

    publishAttachmentWorkspace();renderPreflightSourceRoles();
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
    if(!attachmentPreparedFileCount() && batch.attachmentPrepChoice==='pending')batch.attachmentPrepChoice='skipped';
    if(stats.issues)setImportStatus(`准备邮件已整理；有 ${stats.issues} 项附件提示未匹配，但不会阻断后续审阅或排期。`,'warn');
    const duplicatePending=unresolvedDuplicateGroupCount();
    if(duplicatePending){
      batch.uiStep=1;syncStageSurfaceVisibility();renderRosterAudit();
      setImportStatus(`文件分类已完成；发现 ${duplicatePending} 项查重待处理，请先完成批次版本取舍或历史筛选。`,'warn');
      requestAnimationFrame(()=>$('nmda-roster-audit-card')?.scrollIntoView?.({block:'nearest',behavior:'smooth'}));
      return;
    }
    batch.uiStep=1;
    syncStageSurfaceVisibility();
    const missingCount=missingSubjectTasks().length;
    const attachmentNote=stats.issues?`；${stats.issues} 项附件提示未匹配（不阻断）`:'';
    if(missingCount>=3)setImportStatus(`导入准备已完成。审阅邮件可用；其中 ${missingCount} 封缺少主题${attachmentNote}。`,'warn');
    else if(mailPending)setImportStatus(`导入准备已完成。审阅邮件可用${attachmentNote}。`,stats.issues?'warn':'ok');
    else setImportStatus(`导入准备已完成。后续阶段可查看；执行资格按当前状态判断${attachmentNote}。`,stats.issues?'warn':'ok');
    renderImportHandoff();
    scheduleReadyBatchAutoHandoff('导入准备已完成');
  }

  function renderImportLifecycleState() {
    syncStageSurfaceVisibility();
    const active = !!batch.dataset || !!batch.importBusy || !!batch.roster?.entries?.length;
    globalThis.NMDAWorkspaceImportUi.publishPatch({ active, loaded:!!batch.dataset, busy:!!batch.importBusy });
    const sourceCard = $('nmda-import-card');
    if (sourceCard) {
      sourceCard.dataset.busy = batch.importBusy ? '1' : '0';
      sourceCard.dataset.loaded = batch.dataset ? '1' : '0';
    }
    const workbench = ui.querySelector('.nmda-bulk-workbench');
    if (workbench) {
      workbench.dataset.phase = !batch.dataset ? 'empty' : (batch.handoffComplete ? 'ready' : 'review');
      if(!batch.dataset)batch.uiStep=1;
    }
    renderBatchPrepStrip();
    renderSupplementPreflight();
    publishAttachmentWorkspace();
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
      const previousRoster=State.rosterState();
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
    State.schedulePersist();
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
    const dataset = batch.dataset;
    if (!dataset) { globalThis.NMDAWorkspaceImportUi.publishPatch({inventory:{visible:false}}); return; }
    const sets = recordSets();
    const sources = [...(dataset.sourceFiles || [])];
    const containerFiles=[...(dataset.meta?.containerFiles||[])];
    const duplicateSourceCount=Number(dataset.meta?.duplicateSourceCount||0);
    const embeddedCount = (dataset.embeddedFiles || []).length;
    const warnings = dataset.warnings || [];
    const purposeLabel=purpose=>({mail:'邮件',roster:'参考名单',attachment:'附件',ignored:'未使用'}[purpose]||'未使用');
    const rows = sources.map(file => {
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
      return {name,format,size:humanFileSize(file.size),decision,icon:kind.icon,purpose:purposes[0]||'ignored',roleText};
    });
    const fileCount=sources.length || (containerFiles.length?0:1);
    const taskCount=(batch.tasks||[]).length;
    const rosterCount=referenceRosterCount();
    const attachmentStats=typeof importAttachmentStats==='function'?importAttachmentStats():{total:0,issues:0};
    const summaryParts=[containerFiles.length?`资料包 ${containerFiles.length} 个`:'',fileCount?`内容文件 ${fileCount} 个`:'',taskCount?`${taskCount} 封邮件`:''];
    if(rosterCount)summaryParts.push(`参考名单 ${rosterCount} 条`);
    if(duplicateSourceCount)summaryParts.push(`已忽略 ${duplicateSourceCount} 个重复副本`);
    if(attachmentStats.issues)summaryParts.push(`${attachmentStats.issues} 个附件提示未匹配`);
    globalThis.NMDAWorkspaceImportUi.publishPatch({inventory:{visible:true,summary:summaryParts.filter(Boolean).join(' · '),rows,fallbackFormat:formatDisplayName(dataset.format),containerNames:containerFiles.map(file=>file.name||'资料包').join('、'),duplicateCount:duplicateSourceCount,embeddedCount,warnings}});
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

  // Mail-boundary signals are parser diagnostics, not operator decisions.
  // Keep them on source metadata for traceability, but never block Review when
  // recipient / subject / body are already usable.
  function isNonBlockingBoundaryDiagnostic(issue) {
    const text=String(issue||'');
    return /邮件边界识别置信度较低|未找到邮件称呼|未找到邮件落款|未找到标准邮件落款|邮件落款后存在未归类内容/.test(text);
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
      editKey:`fu-review:${task.id}`, id:`跟进邮件 #${Math.max(1,Number(task.sequence||1))}`,
      collectionName:'跟进邮件', recipients, subject:String(task.subject||parent?.subject||''), body:String(task.body||''), bodyHtml:String(task.bodyHtml||''), bodyIsHtml:task.bodyIsHtml===true,
      composeMode:task.composeMode||'forward', sequence:Number(task.sequence||1), reviewConfirmed:reviewed,
      rootTaskId:String(task.rootTaskId||''), parentOutboundId:String(task.parentOutboundId||''), parentMessageId:String(parent?.providerMessageId||''), parentFid:3,
      reviewDecision:String(task.reviewDecision||''), reviewDraftPending:false, importExcluded:false, importConfidence:100, importIssues:[], rosterIssues:[], errors:[],
      policyBlocked:task.state==='blocked'||!!task.blocker, attachmentRefs:[], scheduleAt:String(task.dispatch?.scheduleAt||''), tags:[],
      sourceFile:'跟进邮件模板生成',
      generatedFromTemplateVersion:Number(task.generatedFromTemplateVersion||0), personalization:task.personalization||{},
      _derivedState:task.state, _dispatchQueued:task.dispatch?.queued===true, _rawDerivedTask:task,
      _searchStatic:[recipients,task.subject,task.body,`跟进邮件 ${task.sequence||''}`].join(' ').toLocaleLowerCase('zh-CN')
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
    const contextPending=typeof supplementPreflightNeedsDecision==='function'&&supplementPreflightNeedsDecision();
    return !duplicatePending&&!contextPending;
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
      if(task?.policyBlocked)out.push('跟进邮件已阻断');
      if(!task?.reviewConfirmed && !out.includes('请检查跟进邮件内容'))out.push('请检查跟进邮件内容');
      return out;
    }
    if (!String(task?.recipients||'').trim()) out.push('缺少收件人');
    else if (!recipientLooksValid(task.recipients)) out.push('收件人邮箱格式无效');
    if (!String(task?.subject||'').trim()) out.push('缺少主题');
    if (!String(task?.body||'').trim()) out.push('缺少正文');
    // Human confirmation is scoped to actionable ambiguity. Missing fields disappear
    // as soon as they are fixed. Parser-only body-boundary diagnostics stay in source
    // metadata but never create a manual Review gate by themselves.
    if (!task?.reviewConfirmed) {
      for (const issue of task?.importIssues || []) {
        if (isNonBlockingBoundaryDiagnostic(issue)) continue;
        if (/未定位收件人/.test(issue) && task.recipients) continue;
        if (/主题为空|未找到 Subject/.test(issue) && task.subject) continue;
        if (/正文过短/.test(issue) && String(task.body||'').length>=40) continue;
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
    return state.content.length>0 || state.review.length>0 || state.schedule.length>0 || state.other.length>0;
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
    globalThis.NMDAWorkspaceReviewBoard.publishControls({trash:excludedImportItems()});
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
    if(persist)State.schedulePersist();
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

  function currentBatchProcessingPlan(){
    const subjectState=batchSubjectGovernanceState();
    const formatAnalyses=queuedGovernanceRules().map(rule=>analyzeGovernanceRule(rule)).filter(analysis=>analysis.changeTasks>0);
    const formatEntries=formatAnalyses.flatMap(analysis=>(analysis.records||[]).filter(row=>row.needed>0).map(row=>({analysis,row})));
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
    const formatTaskKeys=new Set(formatEntries.map(entry=>entry.row.task.editKey));
    return {subject:subjectState.value,subjectRows:subjectState.ready?subjectState.missing:[],formatAnalyses,formatEntries,rows,subjectCount:subjectState.ready?subjectState.missing.length:0,formatCount:formatTaskKeys.size,formatRuleCount:formatAnalyses.length};
  }

  function syncBatchProcessingApply(){
    if(!formatGovernanceApplyEl)return;
    if(batchProcessingBusy){
      formatGovernanceApplyEl.disabled=true;
      formatGovernanceApplyEl.setAttribute('aria-busy','true');
      formatGovernanceApplyEl.textContent='正在应用…';
      return;
    }
    formatGovernanceApplyEl.removeAttribute('aria-busy');
    const plan=currentBatchProcessingPlan(),total=plan.rows.length;
    formatGovernanceApplyEl.disabled=!total;
    formatGovernanceApplyEl.textContent=total?`应用批量处理 · ${total} 封`:'应用批量处理';
    if(batchStandardPlanSummaryEl){
      const parts=[];
      if(plan.subjectCount)parts.push(`补主题 ${plan.subjectCount} 封`);
      if(plan.formatCount)parts.push(`统一格式 ${plan.formatRuleCount} 条 / ${plan.formatCount} 封`);
      batchStandardPlanSummaryEl.textContent=parts.length?`${parts.join(' · ')} · 当前影响 ${total} 封`:'尚未配置可执行批量处理';
    }
  }

  function syncReviewBatchLaunch(){
    const tasks=allReviewTasks().filter(task=>!task?.importExcluded);
    const subjectCount=missingSubjectTasks().length,queuedCount=queuedGovernanceRules().length;
    globalThis.NMDAWorkspaceReviewBoard.publishControls({batchLaunch:{
      empty:!tasks.length,subjectCount,queuedCount,
      meta:!tasks.length?'导入邮件后可用':subjectCount?`${subjectCount} 封缺主题 · 点击批量补齐`:queuedCount?`已选 ${queuedCount} 条格式处理 · 继续`:'查看格式偏移推荐',
      title:!tasks.length?'准备好邮件后可使用批量处理':subjectCount?`有 ${subjectCount} 封初始邮件缺少主题；点击批量补齐`:'查看格式偏移建议与批量处理'
    }});
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
      if(!count)batchStandardSubjectResultEl.innerHTML='<strong>主题完整</strong><span>当前所有初始邮件均已有主题。</span>';
      else if(state.value)batchStandardSubjectResultEl.innerHTML=`<strong>待补齐 ${count} 封</strong><span>只写入空白主题，不覆盖已有主题。</span>`;
      else if(state.suggestion)batchStandardSubjectResultEl.innerHTML=`<strong>${count} 封缺少主题</strong><span>已从现有草稿中找到高一致度参考主题；采用后才会应用到本次处理。</span>`;
      else batchStandardSubjectResultEl.innerHTML=`<strong>${count} 封缺少主题</strong><span>现有主题不够一致，请输入确认后的统一主题。</span>`;
    }
    syncBatchProcessingApply();
    syncReviewBatchLaunch();
  }

  function syncFormatGovernancePreviewBadge(suggestions=[]){
    const formatCount=Array.isArray(suggestions)?suggestions.length:0,subjectCount=missingSubjectTasks().length;
    const count=(subjectCount?1:0)+(formatCount?1:0);
    if(batchStandardFormatCountEl)batchStandardFormatCountEl.textContent=String(formatCount);
    if(batchStandardSubjectCountEl)batchStandardSubjectCountEl.textContent=String(subjectCount);
    if(formatGovernanceEntryCountEl){formatGovernanceEntryCountEl.hidden=!count;formatGovernanceEntryCountEl.textContent=String(count||0);}
    if(formatGovernanceEntryEl){
      formatGovernanceEntryEl.classList.toggle('has-drift',!!count);
      const details=[];if(subjectCount)details.push(`主题缺失 ${subjectCount} 封`);if(formatCount)details.push(`格式漂移 ${formatCount} 组`);
      formatGovernanceEntryEl.title=count?`批量处理：${details.join(' · ')}`:'当前批次未发现待处理的确定性批量事项';
    }
    syncReviewBatchLaunch();
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
    renderBatchSubjectGovernance();renderFormatDriftSuggestions();renderFormatGovernanceHistory();renderFormatGovernanceAnalysis();
    requestAnimationFrame(()=>{
      if(missingSubjectTasks().length){batchStandardSubjectInputEl?.focus?.({preventScroll:true});return;}const recommended=formatGovernanceSuggestionsEl?.querySelector?.('[data-governance-suggestion]');recommended?.focus?.({preventScroll:true});
    });
  }

  function closeFormatGovernance(){
    if(formatGovernanceEl)formatGovernanceEl.hidden=true;
    if(reviewInlineEl)delete reviewInlineEl.dataset.formatGovernanceOpen;
    if(formatGovernanceEntryEl){formatGovernanceEntryEl.setAttribute('aria-expanded','false');formatGovernanceEntryEl.classList.remove('is-open');}
    formatGovernanceAnalysis=null;
  }

  let batchGovernanceFeedbackTimer=0;
  let batchProcessingBusy=false;
  let batchGovernanceRefreshTimer=0;

  function yieldBrowserPaint(){
    return new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  }

  function scheduleBatchGovernanceRefresh(){
    if(batchGovernanceRefreshTimer)clearTimeout(batchGovernanceRefreshTimer);
    batchGovernanceRefreshTimer=setTimeout(()=>{
      batchGovernanceRefreshTimer=0;
      if(batchProcessingBusy||batch.reviewSurface!=='preview')return;
      renderFormatDriftSuggestions();
      if(!formatGovernanceEl?.hidden)renderFormatGovernanceAnalysis();
    },40);
  }

  function clearGovernancePreviewHighlight(){
    try{window.CSS?.highlights?.delete?.('nmda-governance-target');window.CSS?.highlights?.delete?.('nmda-governance-applied');}catch(_){}
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
      page:activeReviewList()?.querySelector?.(`[data-review-row="${escaped}"]`)||null,
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
    if(batchProcessingBusy)return;
    batchProcessingBusy=true;
    syncBatchProcessingApply();
    // Let the busy state paint before any whole-batch analysis starts. Previously the
    // click entered several synchronous scans immediately, so the UI looked frozen.
    await yieldBrowserPaint();
    let shouldRefreshGovernance=false;
    try{
      const plan=currentBatchProcessingPlan();if(!plan.rows.length)return;
      const previewContext=batch.reviewSurface==='preview'?{activeKey:String(batch.reviewEditingKey||batch.reviewPreviewKey||''),scrollTop:reviewQueueEl?.scrollTop||0,railScrollTop:reviewPreviewRailListEl?.scrollTop||0}:null;
      let changedTasks=0,subjectChanged=0,formatChangedTasks=0,formatChangedOccurrences=0;
      const changedKeys=[],subjectChangedKeys=[],formatChangedKeys=[];
      const formatStats=new Map((plan.formatAnalyses||[]).map(analysis=>[governanceRuleKey(analysis.rule),{analysis,changedTaskKeys:new Set(),changedOccurrences:0}]));
      for(const row of plan.rows){
        let rowChanged=false,formatRowChanged=false;
        // Batch normalization is deterministic. Preserve the task's existing review state so a
        // format/empty-subject repair neither invents a new confirmation nor clears a real one.
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

      const parts=[];
      if(subjectChanged)parts.push(`补齐主题 ${subjectChanged} 封`);
      if(formatChangedTasks)parts.push(`统一格式 ${appliedFormatRules.length} 条 / ${formatChangedTasks} 封 / ${formatChangedOccurrences} 处`);
      const summary=parts.join(' · ')||'批量处理已完成';

      // Commit the already-mutated task objects to the visible Preview first. Do not wait for
      // rebuildTasks(), duplicate audit, drift rescans, or monitoring UI that the operator cannot
      // currently see. This is the user-visible "apply now" boundary.
      if(changedTasks&&batch.reviewSurface==='preview'&&reviewInlineEl&&!reviewInlineEl.hidden){
        renderReviewQueue(previewContext?.activeKey||'',{preserveScroll:true});
        showBatchGovernanceFeedback({changedKeys,subjectKeys:subjectChangedKeys,formatKeys:formatChangedKeys,formatRules:appliedFormatRules,summary});
      }
      setImportStatus(`批量处理完成：${parts.join('；')||'无正文改动'}。`,'ok');
      if(changedTasks||appliedFormatRules.length)State.schedulePersist();

      // Give the browser a real paint opportunity before running the expensive consistency pass.
      // requestAnimationFrame alone is insufficient because promise continuations run before paint.
      await yieldBrowserPaint();

      if(changedTasks)rebuildTasks();
      // Rebuild header/count state without immediately repeating the expensive whole-batch drift
      // scan. That scan is coalesced below and runs after the apply interaction has completed.
      renderReviewPageOverview({skipGovernanceRefresh:true,skipReviewQueue:true});
      shouldRefreshGovernance=true;
    }catch(error){
      console.error('[NMDA] batch processing failed',error);setImportStatus(`批量处理失败：${error?.message||error}`,'error');
    }finally{
      batchProcessingBusy=false;
      syncBatchProcessingApply();
      if(shouldRefreshGovernance)scheduleBatchGovernanceRefresh();
    }
  }


  function renderReviewBatchActions() {
    pruneReviewSelection();
    const selected=selectedReviewTasks().filter(taskCanBatchConfirm);
    const batchMode=batch.reviewFilter==='pending' && reviewTasks().length>0;
    globalThis.NMDAWorkspaceReviewBoard.publishControls({selectedCount:selected.length,batchbarVisible:!!(batchMode&&selected.length)});
  }

  function setReviewSurface(mode='board') {
    if(!reviewInlineEl)return;
    const next=mode==='preview'?'preview':'board';
    const previous=batch.reviewSurface==='preview'?'preview':'board';
    batch.reviewSurface=next;
    reviewInlineEl.dataset.reviewView=next;
    globalThis.NMDAWorkspaceReviewBoard.publishControls({surface:next});
    if(next==='preview'&&previous!=='preview'){
      reviewInlineEl.dataset.previewAnimate='1';
      window.setTimeout(()=>{if(reviewInlineEl?.dataset.reviewView==='preview')delete reviewInlineEl.dataset.previewAnimate;},420);
    }else if(next==='board'){delete reviewInlineEl.dataset.previewAnimate;batch.reviewEditingKey='';}
    if(reviewQueueEl){
      reviewQueueEl.classList.toggle('nmda-review-mail-grid',next==='board');
      reviewQueueEl.classList.toggle('nmda-review-continuous-preview',next==='preview');
    }
    if(reviewBoardHost)reviewBoardHost.hidden=next!=='board';
    if(reviewPreviewPagesEl)reviewPreviewPagesEl.hidden=next!=='preview';
    if(reviewPreviewRailEl)reviewPreviewRailEl.hidden=next!=='preview';
    if(next==='preview'&&previous!=='preview') renderFormatDriftSuggestions();
    else if(next!=='preview') closeFormatGovernance();
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
      await State.ensureOperations();
      try{
        const updated=Operations.updateDerivedTaskContent(operationState.store,task.derivedTaskId,{recipients:Operations.parseRecipients(recipients),subject,body,bodyHtml,bodyIsHtml});
        State.setStore(updated.store);
      }catch(error){setPreviewEditFeedback(key,error?.message||String(error),'error');return false;}
      batch.reviewEditingKey='';
      renderReviewPageOverview();State.changed();scheduleBatchRender({aux:false,force:true});
      setImportStatus('修改已保存；请核对当前版本后再安排发送。','warn');
      focusReviewTask(key,{behavior:'auto',block:'center'});
      return true;
    }
    batch.handoffComplete=false;
    setTaskEdit(task,{recipients,subject,body,bodyHtml,bodyIsHtml});
    rebuildTasks();
    batch.reviewEditingKey='';
    if(unresolvedDuplicateGroupCount()>0){
      hideReviewWorkspaceWithoutStash();setWorkbenchTab('batch');batch.uiStep=1;syncStageSurfaceVisibility();renderRosterAudit();renderImportHandoff();
      history.replaceState(null,'','#batch');
      setImportStatus('邮件修改改变了查重结果；请先回到导入查重处理新的重复关系。','warn');
      requestAnimationFrame(()=>$('nmda-roster-audit-card')?.scrollIntoView?.({block:'nearest',behavior:'smooth'}));
      return true;
    }
    const current=reviewTaskByKey(key);
    renderReviewPageOverview();
    if(current){
      const stillPending=taskNeedsImportReview(current);
      setImportStatus(stillPending?'修改已保存；当前版本仍需核对。':'修改已保存并通过确定性重新校验。',stillPending?'warn':'ok');
      focusReviewTask(key,{behavior:'auto',block:'center'});
    }
    if(!reviewTasks().length)await continueAfterReviewResolution('邮件已审阅');
    return true;
  }

  async function confirmPreviewTask(editKey='',options={advance:true}){
    const key=String(editKey||'');let task=reviewTaskByKey(key);if(!task)return false;
    if(batch.reviewEditingKey===key){setImportStatus('请先保存或取消当前编辑，再确认该版本。','warn');return false;}
    if(!taskCoreValid(task)){beginPreviewEdit(key);setPreviewEditFeedback(key,'当前版本仍有必填信息缺失，请先补齐。','warn');return false;}
    if(isFollowUpReviewTask(task)){
      await State.ensureOperations();
      try{const passed=Operations.passDerivedTaskReview(operationState.store,task.derivedTaskId);State.setStore(passed.store);}
      catch(error){setImportStatus(error?.message||String(error),'error');return false;}
      batch.reviewSelected?.delete?.(key);State.changed();scheduleBatchRender({aux:false,force:true});
      setImportStatus(`跟进邮件 #${Math.max(1,Number(task.sequence||1))} 已确认，并进入安排发送。`,'ok');
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
    if(!pending.length)await continueAfterReviewResolution('邮件已审阅');
    return true;
  }

  async function excludePreviewTask(editKey=''){
    const key=String(editKey||'');let task=reviewTaskByKey(key);if(!task)return false;
    if(batch.reviewEditingKey===key){setImportStatus('请先保存或取消当前编辑，再排除此封。','warn');return false;}
    const label=String(task.subject||task.recipients||task.id||'这封邮件').trim();
    batch.reviewSelected?.delete?.(key);
    if(isFollowUpReviewTask(task)){
      await State.ensureOperations();const result=Operations.setDerivedTaskState(operationState.store,task.derivedTaskId,'cancelled');State.setStore(result.store);
      setImportStatus(`已取消跟进邮件 #${Math.max(1,Number(task.sequence||1))}。`,'ok');State.changed();
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
    await State.ensureOperations();
    for(const task of selected){
      const coreValid=taskCoreValid(task);
      if(!coreValid){blocked++;continue;}
      if(isFollowUpReviewTask(task)){
        try{
          const result=Operations.passDerivedTaskReview(operationState.store,task.derivedTaskId);
          State.setStore(result.store);
          confirmed++;followUpConfirmed++;
        }catch(_){blocked++;}
        continue;
      }
      const prev=batch.taskEdits.get(task.editKey)||{};
      batch.taskEdits.set(task.editKey,{...prev,reviewConfirmed:true,reviewDraftPending:false,rosterConfirmed:(task.rosterIssues||[]).length?true:!!prev.rosterConfirmed});
      confirmed++;
    }
    if(followUpConfirmed)
    batch.reviewSelected.clear();
    rebuildTasks();
    renderReviewPageOverview();
    State.changed();
    scheduleBatchRender({aux:false,force:true});
    const message=blocked
      ? `已通过 ${confirmed} 封；${blocked} 封仍有阻断或必填信息缺失。`
      : `已通过 ${confirmed} 封邮件${followUpConfirmed?`，其中 ${followUpConfirmed} 封跟进邮件已进入安排发送`:''}。`;
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
    if(/请检查跟进邮件内容/.test(text))return '跟进邮件需确认';
    if(/跟进邮件已阻断/.test(text))return '跟进邮件已阻断';
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
    const hits=unresolvedDraftHistoryHits();
    const current=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit;
    globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,draftHistory:{visible:!!hits.length,hits:hits.map(({task,history})=>({key:task.editKey,recipient:task.recipients||task.id||'当前邮件',description:`已有草稿 ${history.draftCount} · 最近 ${Operations.formatDisplayTime(history.lastDraftAt)||'时间未知'}${String(history.lastDraftSubject||'').trim()?` · ${String(history.lastDraftSubject||'').trim()}`:''}`}))}}});
  }

  function renderDuplicateDecision() {
    const groups=unresolvedDuplicateAuditGroups(),group=groups[0]||null,draftHits=unresolvedDraftHistoryHits();
    const syncAt=operationState.store?.mailboxSync?.lastDedupeAt||operationState.store?.mailboxSync?.lastFullAt||'';
    const checkable=(batch.tasks||[]).filter(task=>!task?.importExcluded&&taskNeedsDuplicateGate(task));
    const mailboxUnread=checkable.length>0&&!syncAt,pendingCount=groups.length+draftHits.length;
    const dedupeStatus=mailboxUnread?'邮箱历史自动读取中':pendingCount?`${pendingCount} 项待处理`:`查重完成 · 邮箱 ${Operations.formatDisplayTime(syncAt)}`;
    const current=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit;
    if(mailboxUnread){
      globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,dedupeStatus,duplicate:{visible:true,scope:'mailbox-read',kind:'历史检查',tone:'strong',title:'正在检查是否已联系过',copy:'新导入的初始邮件会先对照网易邮箱中的草稿和已发送记录，避免重复联系。',hint:'从草稿箱导入的邮件会直接沿用现有草稿。',showSelected:false,showAll:false,candidates:[{key:'mailbox-read',title:'自动读取中',body:'检查范围：已有草稿 · 已发送',history:true}]}});
      return;
    }
    if(!group){
      globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,dedupeStatus,duplicate:{visible:false}}});
      return;
    }
    if(group.scope==='mailbox-history'){
      const task=group.task||group.tasks?.[0];
      const facts=[group.sentCount?`已发送 ${group.sentCount}`:'',group.draftCount?`另有草稿 ${group.draftCount}`:''].filter(Boolean).join(' · ');
      const candidates=[{key:`new:${task?.editKey||group.id}`,title:'本次导入 · 新初始邮件',badge:'待决策',recipient:task?.recipients||'',body:String(task?.body||'').trim()||task?.subject||'正文为空',selected:true}];
      candidates.push(...(group.sent||[]).slice(0,3).map((record,index)=>({key:`sent:${record.providerMessageId||record.id||index}`,title:'已发送',recipient:Operations.formatDisplayTime(record.sentAt)||'时间未知',body:record.subject||'(无主题)',history:true})));
      globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,dedupeStatus,duplicate:{visible:true,groupId:group.id,scope:group.scope||'mailbox-history',kind:'已发送',tone:'strong',title:`${String(task?.recipients||'该收件人')} 已有发送历史`,copy:`${facts}。已发送记录代表该联系人已经发生过外联；若这是继续联系，应从“邮件监测”创建跟进邮件。`,hint:groups.length>1?`明确本封后继续处理剩余 ${groups.length-1} 组。`:'这是最后一组历史冲突；处理后即可进入审阅邮件。',keepSelectedLabel:'排除当前新邮件',keepAllLabel:'仍保留本封',showSelected:true,showAll:true,candidates}});
      return;
    }
    const recommended=recommendedDuplicateTask(group),validKeys=new Set((group.tasks||[]).filter(item=>!item?.importExcluded).map(item=>item.editKey));
    const savedRaw=batch.duplicateSelections?.get?.(group.id),savedList=Array.isArray(savedRaw)?savedRaw:(savedRaw?[savedRaw]:[]),selectedKeys=new Set(savedList.filter(key=>validKeys.has(key)));
    if(!selectedKeys.size){const fallback=recommended?.editKey||[...validKeys][0]||'';if(fallback)selectedKeys.add(fallback);}
    if(batch.duplicateSelections instanceof Map)batch.duplicateSelections.set(group.id,[...selectedKeys]);
    const compareTasks=(group.tasks||[]).filter(item=>!item?.importExcluded);
    const candidates=compareTasks.map((candidate,index)=>({key:candidate.editKey,selectable:true,selected:selectedKeys.has(candidate.editKey),title:String(candidate.subject||candidate.id||`邮件 ${index+1}`).trim()||`邮件 ${index+1}`,recipient:String(candidate.recipients||'').trim()||'未填写收件人',body:String(candidate.body||'').trim()||'正文为空',meta:duplicateCandidateMeta(candidate),badge:candidate.editKey===recommended?.editKey?'信息更完整':''}));
    const exact=group.type==='exact-email';
    globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,dedupeStatus,duplicate:{visible:true,groupId:group.id,scope:group.scope||'batch',kind:exact?'同一邮箱':'疑似同一联系人',tone:exact?'strong':'soft',title:exact?`同一收件人有 ${group.tasks?.length||0} 封邮件`:`可能是同一联系人：${group.tasks?.length||0} 封邮件`,copy:exact?`${group.email||group.label||'该收件人'}。导入阶段先决定哪些版本真正进入本批次。`:`${group.label||'姓名与院校相同'}。请根据收件人和正文确认是否属于同一联系人。`,hint:selectedKeys.size?'未勾选的邮件将在确认后排除。':'至少保留一封；当前尚未选择任何邮件。',keepSelectedLabel:`保留所选（${selectedKeys.size}）`,keepAllLabel:exact?'明确全部保留':'不是同一联系人，全部保留',showSelected:true,showAll:true,selectedKeys:[...selectedKeys],candidates}});
  }
  function finishImportDuplicateDecision(summary='导入查重已更新') {
    batch.reviewSelected?.clear?.();
    rebuildTasks();
    renderImportTaskPreview();renderImportHandoff();renderRosterAudit();syncStageSurfaceVisibility();
    const remaining=unresolvedDuplicateGroupCount();
    setImportStatus(remaining?`${summary}；还有 ${remaining} 项查重待处理。`:`${summary}；导入查重完成，可以进入审阅邮件。`,remaining?'warn':'ok');
  }

  async function keepSelectedDuplicateCandidate(selectedKeysFromUi=[]) {
    const groupId=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit.duplicate.groupId||'';if(!groupId)return;
    const group=(batch.duplicateAudit?.groups||[]).find(item=>item.id===groupId);
    if(!group){finishImportDuplicateDecision('重复信息已变化，已重新核验');return;}
    if(group.scope==='mailbox-history'){
      const task=group.task||group.tasks?.[0];
      if(task)setTaskEdit(task,{importExcluded:true});
      batch.duplicateSelections?.delete?.(groupId);
      finishImportDuplicateDecision('已排除命中邮箱历史的当前新邮件');
      return;
    }
    const selectedKeys=[...(selectedKeysFromUi||[])].filter(Boolean);
    if(!selectedKeys.length)return;
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
    const groupId=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit.duplicate.groupId||'';if(!groupId)return;
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

  function renderReviewPageOverview(options={}) {
    renderReviewTrash();
    const tasks=allReviewTasks();
    let checked=0,actionCount=0,autoPassed=0;
    for(const task of tasks){
      const visual=reviewVisualState(task);
      if(visual.key==='action')actionCount++;
      else if(visual.key==='confirmed')checked++;
      else autoPassed++;
    }
    const pendingCount=actionCount;
    if(reviewInlineEl)reviewInlineEl.dataset.reviewState=tasks.length&&pendingCount===0?'complete':pendingCount?'pending':'empty';
    Navigation.setReviewCount(pendingCount);
    const reviewCounts={all:tasks.length,auto:autoPassed,pending:actionCount,confirmed:checked};
    if(!formatGovernanceEl?.hidden)renderBatchFollowUpTemplate();
    const pendingMails=reviewTasks();
    globalThis.NMDAWorkspaceReviewBoard.publishControls({
      count:tasks.length,pending:pendingCount,counts:reviewCounts,filter:batch.reviewFilter,search:String(batch.reviewSearch||''),
      emptyHint:batch.dataset?'当前还没有可审阅邮件。可以返回“准备邮件”继续补充，或到邮件监测查看跟进邮件。':'准备初始邮件，或从邮件监测生成跟进邮件后，会出现在这里。',
      nextMode:pendingMails.length?'next':'dispatch',
      nextLabel:pendingMails.length?'下一个需处理':batch.handoffComplete?'查看安排发送 →':'正在同步到安排发送…',
      nextDisabled:!pendingMails.length&&!batch.handoffComplete
    });
    syncReviewBatchLaunch();
    if(!tasks.length){batch.reviewEditingKey='';setReviewSurface('board');renderReviewBatchActions();return;}
    renderReviewBatchActions();
    if(batch.reviewSurface==='preview'){
      renderBatchSubjectGovernance();
      if(!options.skipGovernanceRefresh)renderFormatDriftSuggestions();
    }
    if(reviewInlineEl && !reviewInlineEl.hidden && !options.skipReviewQueue)renderReviewQueue(batch.reviewEditingKey||batch.reviewPreviewKey||'');
    scheduleReadyBatchAutoHandoff('审阅邮件已就绪');
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
    if(duplicatePending||contextPending){
      const followUps=followUpReviewTasks();
      if(!followUps.length){
        setWorkbenchTab('batch');
        batch.uiStep=1;syncStageSurfaceVisibility();renderRosterAudit();renderImportHandoff();
        const reasons=[];
        if(contextPending)reasons.push('导入准备未完成');
        if(duplicatePending)reasons.push(`查重待处理 ${duplicatePending} 项`);
        setImportStatus(`${reasons.join('；')}。完成后再进入初始审阅邮件。`,'warn');
        return false;
      }
      setImportStatus('当前初始邮件仍在准备阶段；审阅页暂时只显示跟进邮件。','warn');
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
          try{await MailboxSync.request('history',{source:'ready-handoff'});}catch(_){return;}
          readyBatchAutoHandoffRetryAt=0;
          if(!mailboxDedupeSnapshotAvailable())return;
        }
        if(batch.handoffComplete||batch.running||batch.autoAdvancing||reviewTasks().length||(batch.tasks||[]).some(taskHasPrePlanningBlocker))return;
        const ready=await enterSelectionAndSchedule(reason);
        if(!ready)return;
        MailboxSync.schedule('quick',{source:'ready-handoff'});
        renderReviewPageOverview();
        setImportStatus(`${reason}。已自动同步到“安排发送”，可继续留在当前页面审阅，也可随时查看排期。`,'ok');
      })();
    });
  }

  async function enterSelectionAndSchedule(reason='检查完成') {
    if(batch.running || batch.autoAdvancing)return false;
    await State.ensureOperations();
    const pendingFollowUps=followUpReviewTasks().filter(taskNeedsImportReview);
    if(pendingFollowUps.length){setImportStatus(`还有 ${pendingFollowUps.length} 封跟进邮件需要处理。`,'warn');return false;}

    const initialReady=initialReviewGateReady() && !!batch.tasks?.length;
    if(initialReady){
      if((batch.tasks||[]).some(taskHasPrePlanningBlocker)){setBatchStatus('仍有初始邮件内容或识别问题需要处理。','warn');return false;}
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
      setImportStatus('还没有审阅完成、可安排发送的邮件。','warn');
      return false;
    }
    setBatchStatus(`${reason}。安排发送已就绪。`,'ok');
    setImportStatus(`${reason}。已同步到“安排发送”。`,'ok');
    scheduleBatchRender({aux:true,force:true});
    syncStageSurfaceVisibility();
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
    setBatchStatus(`${reason}。已同步到“安排发送”。`,'ok');
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
      const row=activeReviewList()?.querySelector(`[data-review-row="${CSS.escape(key)}"]`);
      row?.scrollIntoView?.({block:options.block||'center',behavior:options.behavior||'smooth'});
      if(batch.reviewSurface==='preview')setReviewPreviewActiveKey(key,{revealRail:true,railBehavior:options.behavior||'smooth'});
      if(row){row.classList.add('is-jump-focus');window.setTimeout(()=>row.classList.remove('is-jump-focus'),1100);}
    });
    return true;
  }

  function openNextReviewTask(){
    if(!reviewQueueEl)return;
    const pending=reviewTasks();
    if(!pending.length){void continueAfterReviewResolution('邮件已审阅');return;}
    if(batch.reviewSurface!=='preview'){openReviewPreview(pending[0].editKey);return;}
    const pages=[...(activeReviewList()?.querySelectorAll('[data-review-row]')||[])];
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
    if(isFollowUpReviewTask(task) && task.reviewConfirmed && task.reviewDecision==='auto')return {key:'auto',label:'已就绪',detail:'',icon:'✓',issues:[]};
    if(task.reviewConfirmed||task.rosterConfirmed)return {key:'confirmed',label:'已确认',detail:'',icon:'✓',issues:[]};
    return {key:'auto',label:'已就绪',detail:'',icon:'✓',issues:[]};
  }

  function renderReviewCardGrid(activeKey='',options={}) {
    const visible=reviewVisibleTasks();
    const limit=Math.max(50,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
    const items=visible.slice(0,limit).map((task,index)=>{
      const visual=reviewVisualState(task);
      return {
        task,visual,
        confirmable:taskCanBatchConfirm(task),
        checked:batch.reviewSelected?.has(task.editKey)||false,
        issueLabels:[...new Set(visual.issues.map(reviewIssueLabel).filter(Boolean))],
        origin:original163MailRef(task),
        title:reviewRailTitle(task,index),
        followUp:isFollowUpReviewTask(task)
      };
    });
    if(reviewProgressEl)reviewProgressEl.textContent=`${reviewTasks().length} 待处理`;
    globalThis.NMDAWorkspaceReviewBoard.publish({
      items,total:visible.length,filter:batch.reviewFilter,
      activeKey,preserveScroll:!!options?.preserveScroll,limit
    });
  }
  function reviewRailTitle(task,index=0) {
    const recipient=String(task?.recipients||'').trim();
    const angle=recipient.match(/^\s*([^<>;,]+?)\s*<[^>]+>/);
    if(angle?.[1] && !/@/.test(angle[1]))return angle[1].trim();
    const first=recipient.split(/[;,]/)[0]?.trim()||'';
    if(first)return first.length>34?`${first.slice(0,31)}…`:first;
    return String(task?.id||task?.collectionName||`邮件 ${index+1}`);
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
    if(index>=0)globalThis.NMDAWorkspaceReviewBoard.publishControls({previewMeta:`${index+1} / ${visible.length}`});
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
    const visible=reviewVisibleTasks();
    const limit=Math.max(REVIEW_RENDER_CHUNK,viewPerf.reviewRenderLimit||REVIEW_RENDER_CHUNK);
    const tasks=visible.slice(0,limit);
    if(reviewPreviewRailCountEl)reviewPreviewRailCountEl.textContent=String(visible.length);
    if(reviewProgressEl)reviewProgressEl.textContent=`${reviewTasks().length} 待处理`;
    const activeIndex=activeKey?visible.findIndex(task=>task.editKey===activeKey):-1;
    globalThis.NMDAWorkspaceReviewBoard.publishControls({previewMeta:activeIndex>=0?`${activeIndex+1} / ${visible.length}`:`${visible.length} 封`});
    const items=tasks.map(task=>{
      const visual=reviewVisualState(task);
      const editing=task.editKey===batch.reviewEditingKey;
      const recipient=String(task.recipients||'').trim()||'未识别收件人';
      const subject=String(task.subject||'').trim()||'未识别主题';
      return {
        task,visual,editing,followUp:isFollowUpReviewTask(task),title:reviewRailTitle(task),
        issueLabels:[...new Set(visual.issues.map(reviewIssueLabel).filter(Boolean))],
        confirmable:taskCanBatchConfirm(task),origin:original163MailRef(task),
        suggestions:editing&&!recipientLooksValid(task.recipients||'')?reviewCandidateEmails(task).slice(0,5):[],
        richBody:editing?(taskRichBodyHtml(task)||plainMailBodyToHtml(task?.body||'')):'',
        highlightedRecipient:semanticHighlightHtml(recipient,task),
        highlightedSubject:semanticHighlightHtml(subject,task),
        decoratedBody:editing?'':decorateReviewRichHtml(task)
      };
    });
    globalThis.NMDAWorkspaceReviewBoard.publishPreview({
      items,total:visible.length,filter:batch.reviewFilter,activeKey,preserveScroll,
      scrollTop:previousScrollTop,railScrollTop:previousRailScrollTop
    });
    requestAnimationFrame(()=>setReviewPreviewActiveKey(activeKey||batch.reviewPreviewKey,{revealRail:!preserveScroll,railBehavior:preserveScroll?'auto':'smooth'}));
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
    const batchMode=batch.reviewFilter==='pending'&&reviewTasks().length>0;
    globalThis.NMDAWorkspaceReviewBoard.publishControls({selectVisibleCount:visible.length,selectVisibleHidden:surface==='preview'||!batchMode||visible.length<2,allVisibleSelected:!!allSelected});
  }

  function openReviewBatchProcessing(){
    if(batch.reviewEditingKey){setImportStatus('请先保存或取消当前邮件的编辑，再打开批量处理。','warn');return;}
    const tasks=allReviewTasks().filter(task=>!task?.importExcluded);
    if(!tasks.length){setImportStatus('当前没有可批量处理的邮件。','warn');return;}
    if(batch.reviewSurface!=='preview'){
      // 批量处理作用于整批邮件；进入时切回完整视图，避免筛选状态造成范围误解。
      batch.reviewFilter='all';
      batch.reviewSearch='';
      globalThis.NMDAWorkspaceReviewBoard.publishControls({filter:'all',search:''});
      const target=missingSubjectTasks()[0]||tasks[0];
      openReviewPreview(target?.editKey||'');
      requestAnimationFrame(()=>openFormatGovernance({fromBoard:true}));
      return;
    }
    if(formatGovernanceEl?.hidden)openFormatGovernance();else closeFormatGovernance();
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
    syncStageSurfaceVisibility();
    renderReviewTrash();
  }

  async function ensureCurrentBatchOperations(sessionToken = batch.sessionId) {
    if (!Operations || !isCurrentBatchSession(sessionToken)) return false;
    try {
      // Only use mailbox facts already read in the current app session. Mailbox access is explicitly user-triggered
      // from the shared automatic mailbox sync layer (manual full reread remains available as recovery).
      await State.ensureOperations();
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
    patchAttachmentUi({fileIndexInfo:files.length?`已准备 ${files.length} 个附件（自动 ${counts.smart} / 全部 ${counts.all} / 指定 ${counts.selected}，共 ${sizeText}）。`:'尚未选择本地附件。'});
    rebuildTasks();publishAttachmentWorkspace();
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

  const emptyRosterState = State.emptyRosterState;

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
    const state=State.rosterState();
    state.entries=mergeUniqueRosterEntries([...(state.manualEntries||[]),...(state.routedEntries||[])]);
    state.sourceNames=[...new Set([...(state.manualSourceNames||[]),...(state.routedSourceNames||[])])];
    state.warnings=[...new Set([...(state.manualWarnings||[]),...(state.routedWarnings||[])])];
    state.audit=null;
  }

  function syncRoutedSources(){
    const sets=recordSets(),rosterSets=[],attachmentSources=new Set();
    for(let index=0;index<sets.length;index++){
      const collection=sets[index],config=ensureCollectionConfig(index);if(!collection||!config)continue;
      if(config.purpose==='roster')rosterSets.push(collection);
      if(config.purpose==='attachment')for(const source of (collection.meta?.sourceMembers?.length?collection.meta.sourceMembers:[collection.source]))attachmentSources.add(String(source||''));
    }
    const state=State.rosterState();
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
    const state=State.rosterState();
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
    const state=State.rosterState();
    const enabledEl=$('nmda-roster-enabled'),schoolEl=$('nmda-roster-auto-school'),strictEl=$('nmda-roster-strict');
    if(enabledEl)enabledEl.checked=state.enabled!==false;if(schoolEl)schoolEl.checked=state.autoSchool!==false;if(strictEl)strictEl.checked=!!state.strict;
    const tasks=batch.tasks||[],dedupeTasks=tasks.filter(taskNeedsDuplicateGate);
    const duplicateAudit=batch.duplicateAudit||Roster?.auditTaskDuplicates?.(tasks)||{groups:[],summary:{tasks:tasks.length,groups:0,exact:0,probable:0,affectedTasks:0}};
    const history=operationHistoryAudit(tasks),rosterEligible=tasks.filter(task=>task?.sourceKind==='import');
    const rosterAudit=state.entries.length?(state.audit||(Roster&&rosterEligible.length?Roster.crossCheck(rosterEligible,state.entries):null)):null;
    const dx=duplicateAudit.summary||{},pendingDuplicates=unresolvedDuplicateGroupCount(),metrics=[];
    if(tasks.length)metrics.push({value:tasks.length,label:'当前邮件'});
    if(dx.bypassedDraftImports)metrics.push({value:dx.bypassedDraftImports,label:'草稿接管 · 跳过查重'});
    metrics.push({value:pendingDuplicates,label:'待处理重复',tone:pendingDuplicates?'warn':''});
    if(history.loaded&&history.affectedTasks)metrics.push({value:history.affectedTasks,label:'已有记录'});
    if(state.entries.length)metrics.push({value:state.entries.length,label:'参考名单'});
    if(rosterAudit){
      const x=rosterAudit.summary||{};
      metrics.push({value:x.matched||0,label:'邮件↔名单'});
      if(x.autoRecipientSupplements)metrics.push({value:x.autoRecipientSupplements,label:'名单补全邮箱'});
      if(x.methodCounts?.sourceFileName)metrics.push({value:x.methodCounts.sourceFileName,label:'文件名识别'});
      if(x.unwritten)metrics.push({value:x.unwritten,label:'尚未加入'});
      if(x.emailConflicts)metrics.push({value:x.emailConflicts,label:'邮箱不一致',tone:'warn'});
      if(x.ambiguous||x.duplicates)metrics.push({value:(x.ambiguous||0)+(x.duplicates||0),label:'名单待核对',tone:'warn'});
    }
    const note=[];
    const mailboxUnread=dedupeTasks.length>0&&!mailboxDedupeSnapshotAvailable(),decisionGroups=Math.max(0,pendingDuplicates-(mailboxUnread?1:0));
    if(mailboxUnread)note.push('正在读取邮箱记录；新导入的初始邮件会先检查已有草稿和已发送记录');
    if(decisionGroups)note.push(`发现 ${decisionGroups} 项查重待处理，请先完成批次版本取舍、草稿筛选或发送历史决策`);
    else if(dx.groups&&!mailboxUnread)note.push(`本次发现过 ${dx.groups} 组查重冲突，当前已全部处理`);
    else if(tasks.length&&!mailboxUnread)note.push('当前批次未发现重复任务');
    if(history.loaded&&history.affectedTasks)note.push(`${history.affectedTasks} 封新邮件命中邮箱历史；已有草稿直接筛选，已发送记录单独确认`);
    if(dx.bypassedDraftImports)note.push(`从网易草稿箱识别的 ${dx.bypassedDraftImports} 封属于“接管现有草稿”，不参与新邮件查重`);
    if(rosterAudit){
      const x=rosterAudit.summary||{},rosterParts=[];
      if(x.schoolSupplements)rosterParts.push(`补充 ${x.schoolSupplements} 条院校信息`);
      if(x.autoRecipientSupplements)rosterParts.push(`自动补全 ${x.autoRecipientSupplements} 个高置信邮箱`);
      if(x.methodCounts?.sourceFileName)rosterParts.push(`按源文件名识别 ${x.methodCounts.sourceFileName} 封`);
      const reviewEmailCandidates=Math.max(0,Number(x.emailCandidates||0)-Number(x.autoRecipientSupplements||0));
      if(reviewEmailCandidates)rosterParts.push(`找到 ${reviewEmailCandidates} 个邮箱候选待核对`);
      if(x.emailConflicts)rosterParts.push(`${x.emailConflicts} 封邮件邮箱与名单不一致`);
      if(x.unwritten)rosterParts.push(`${x.unwritten} 位名单联系人尚未加入本批次`);
      note.push(`参考总名单已与导入邮件交叉匹配${rosterParts.length?`，并${rosterParts.join('、')}`:''}`);
    }else if(state.entries.length&&!tasks.length)note.push('参考总名单已就绪；后续导入邮件会自动匹配，无需重新上传名单');

    const sections=[];
    const addSection=(title,items,more=items.length)=>sections.push({title,items:items.slice(0,12),more:Math.max(0,more-items.length)});
    const batchGroups=(duplicateAudit.groups||[]).filter(group=>group.scope!=='mailbox-history');
    addSection('当前批次查重',batchGroups.map(group=>{
      const ids=(group.tasks||[]).map(task=>task.id||task.recipients||'邮件').slice(0,4).join('、');
      return `${group.label||group.email||'联系人'} · ${group.type==='exact-email'?'同一邮箱':'同名同院校'} · ${group.tasks?.length||0} 封${ids?` · ${ids}`:''}`;
    }),batchGroups.length);
    if(history.loaded){
      addSection('邮箱历史查重',history.rows.slice(0,12).map(row=>{
        const fact=[row.sentCount?`已发送 ${row.sentCount}`:'',row.draftCount?`已有草稿 ${row.draftCount}`:''].filter(Boolean).join(' · '),subject=row.lastDraftSubject||row.lastSubject||'';
        return `${row.email} · ${fact}${subject?` · ${subject}`:''}`;
      }),history.rows.length);
    }
    if(rosterAudit){
      const matches=rosterAudit.matches||[],off=matches.filter(match=>match.status==='off-roster'),ambiguities=matches.filter(match=>match.status==='ambiguous'),scheduleDiffs=matches.filter(match=>match.status==='conflict'),emailDiffs=matches.filter(match=>match.emailConflict),unwritten=rosterAudit.unwritten||[],rosterDups=rosterAudit.duplicateMatches||[];
      addSection('尚未加入本批次',unwritten.map(entry=>`${rosterEntryLabel(entry)}${entry.batch?` · ${entry.batch}`:''}`),unwritten.length);
      addSection('不在参考名单',off.map(match=>`${match.task?.id||match.task?.recipients||'邮件'} · ${match.task?.recipients||''}`),off.length);
      addSection('邮件 ↔ 名单待核对',ambiguities.map(match=>`${match.task?.id||'邮件'} → 多个参考名单候选`),ambiguities.length);
      addSection('收件人邮箱不一致',emailDiffs.map(match=>`${match.task?.recipients||match.task?.id||'邮件'} → 名单：${match.entry?.email||''}`),emailDiffs.length);
      addSection('排程参考（不影响邮件）',scheduleDiffs.map(match=>`${match.task?.id||'邮件'} → ${rosterEntryLabel(match.entry)}`),scheduleDiffs.length);
      addSection('同一名单联系人对应多封导入邮件',rosterDups.slice(0,8).map(item=>`${rosterEntryLabel(item.entry)} · ${item.matches?.length||0} 封`),rosterDups.length);
    }
    const current=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit;
    globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,roster:{visible:!!dedupeTasks.length||!!state.entries.length,metrics,note:note.length?`${note.join('；')}。`:'核验将在加入邮件后自动开始。',sections}}});
    renderDraftHistoryFilter();
    renderDuplicateDecision();
  }
  async function loadRosterFiles(files){
    const list=[...(files||[])].filter(Boolean);if(!list.length||!Importer||!Roster)return;
    const token=batch.sessionId;
    setImportStatus(`正在读取总套磁名单（${list.length} 个文件）…`);
    try{
      const dataset=list.length===1?await Importer.parseFile(list[0]):await Importer.parseFiles(list,{ignoreUnsupported:true});
      if(!isCurrentBatchSession(token))return;
      const parsed=Roster.parseDataset(dataset);
      if(!parsed.entries.length)throw new Error('总名单中没有找到可用导师信息。请至少提供姓名、邮箱或学校中的一项。');
      for(const [key,edit] of batch.taskEdits.entries()){if(edit?.rosterConfirmed){const next={...edit};delete next.rosterConfirmed;batch.taskEdits.set(key,next);}}
      batch.handoffComplete=false;
      const state=State.rosterState();
      state.dataset=dataset;
      state.datasets=[...(state.datasets||[]),dataset].slice(-8);
      state.manualEntries=mergeUniqueRosterEntries([...(state.manualEntries||[]),...(parsed.entries||[])]);
      state.manualWarnings=[...new Set([...(state.manualWarnings||[]),...(parsed.warnings||[])])];
      state.manualSourceNames=[...new Set([...(state.manualSourceNames||[]),...list.map(f=>f.name)])];
      syncRosterParts();
      batch.rosterPromptChoice='added';
      if(batch.dataset){
        rebuildTasks();
        const x=state.audit?.summary||{};
        setImportStatus(`参考名单 ${state.entries.length} 条 · 已匹配导入邮件 ${x.matched||0} 封${x.autoRecipientSupplements?` · 补全邮箱 ${x.autoRecipientSupplements}`:''}${x.ambiguous?` · 待核对 ${x.ambiguous}`:''}`,'ok');
      }else renderRosterAudit();
      if(!batch.dataset)setImportStatus(`已添加 ${state.entries.length} 条参考名单${parsed.stats.invalidEmails?` · ${parsed.stats.invalidEmails} 条邮箱待检查`:''}${parsed.stats.duplicates?` · ${parsed.stats.duplicates} 条重复`:''}`,'ok');
      renderImportLifecycleState();
      renderSupplementPreflight();
      if(batch.dataset&&batch.supplementPreflightDone)renderImportHandoff();
    }catch(error){console.error(`[${APP}] roster`,error);setImportStatus(`总名单读取失败：${error.message}`,'error');}
    finally{if(rosterFileEl)rosterFileEl.value='';}
  }

  function mergedRowSourcePurpose(sourceFile) {
    const source=sourceIdentityKey(sourceFile),leaf=String(source).split('/').pop();
    const candidates=recordSets().map((collection,index)=>({collection,index})).filter(({collection})=>collection.meta?.taskShadow&&collectionDirectMatchesSource(collection,source,leaf));
    if(!candidates.length)return'mail';
    const config=ensureCollectionConfig(candidates[0].index);
    return config?.enabled===false?'ignored':String(config?.purpose||'ignored');
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
        for (const issue of importIssues) {
          if (isNonBlockingBoundaryDiagnostic(issue)) continue;
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
        if (resolved.missing.length) warnings.push(`附件提示未匹配：${resolved.missing.join('、')}`);
        if (resolved.ambiguous.length) warnings.push(`附件提示存在同名候选：${resolved.ambiguous.join('、')}`);
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
    box.innerHTML = tags.length ? tags.slice(0, 50).map(([tag, count]) => `<button type="button" class="nmda-tag-chip" data-tag-chip="${escapeHtml(tag)}">${escapeHtml(tag)} <small>${count}</small></button>`).join('') : '<span class="nmda-hint">当前任务没有业务标记。运行状态和跟进状态不会混入标记。</span>';
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
    const hasDataset=!!batch.dataset;
    const tasks=(batch.tasks||[]).filter(task=>!task?.importExcluded);
    if(!hasDataset||!tasks.length){globalThis.NMDAWorkspaceImportUi.publishPatch({handoff:{visible:false,metrics:[],hint:''}});return;}
    const contextPending=supplementPreflightNeedsDecision();
    const attachmentIssues=Number(importAttachmentStats().issues||0);
    const duplicatePending=Number(unresolvedDuplicateGroupCount()||0);
    const ready=!contextPending&&!duplicatePending;
    if(!ready){globalThis.NMDAWorkspaceImportUi.publishPatch({handoff:{visible:false,metrics:[],hint:''}});return;}
    const pending=reviewTasks().length;
    const autoPassed=Math.max(0,tasks.length-pending);
    const attachmentNote=attachmentIssues?`；另有 ${attachmentIssues} 项附件提示未匹配（不阻断）`:'';
    const hint=(pending?`导入事项已全部完成；还有 ${pending} 封邮件需要人工审阅。`:'导入事项已全部完成；当前邮件均已就绪，仍可进入审阅抽查。')+attachmentNote;
    globalThis.NMDAWorkspaceImportUi.publishPatch({handoff:{visible:true,metrics:[{value:tasks.length,label:'进入审阅'},{value:pending,label:'需处理'},{value:autoPassed,label:'已就绪'}],hint}});
  }


  function scheduleValueForDisplay(value, rules=batch.scheduleRules||State.freshScheduleRules()) {
    if(!value)return'';const date=Scheduler?.parseLocalDateTime?.(value)||new Date(value);if(!date||Number.isNaN(date.getTime()))return String(value||'');
    return Scheduler?.formatInTimeZone?.(date,rules?.timeZone||'system')||String(value||'');
  }
  function scheduleValueFromDisplay(value, rules=batch.scheduleRules||State.freshScheduleRules()) {
    const raw=String(value||'').trim();if(!raw)return'';const match=raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);if(!match)return raw;
    const date=Scheduler?.zonedLocalToDate?.(match[1],match[2],rules?.timeZone||'system');return date?(Scheduler?.formatLocalDateTime?.(date)||raw):raw;
  }

  function planningDateMeta(value, rules=batch.scheduleRules||State.freshScheduleRules()) {
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

  function patchPlanningTaskRuntime(task) {
    const key=String(task?.editKey||'');
    if(!key||!previewBodyEl)return;
    const state=compactPlanningState(task);
    for(const row of previewBodyEl.querySelectorAll('[data-plan-task-key]')){
      if(String(row.dataset.planTaskKey||'')!==key)continue;
      row.dataset.stateTone=state.tone;
      const flag=row.querySelector('.nmda-inline-flag');
      if(flag){
        for(const cls of [...flag.classList])if(cls.startsWith('nmda-inline-flag-'))flag.classList.remove(cls);
        flag.classList.add(`nmda-inline-flag-${state.tone}`);
        flag.textContent=state.label;
      }
      const enabled=row.querySelector('[data-task-enabled]');
      if(enabled)enabled.disabled=!!batch.running||!!task.policyBlocked||task.status==='running'||task.status==='done';
      for(const control of row.querySelectorAll('[data-task-schedule],[data-smart-temporal-open]'))control.disabled=!!batch.running||!!(task.scheduleSource==='mailbox'&&task.mailboxDraftId);
    }
  }

  function derivePlanningGroups(tasks=[]) {
    const rules=batch.scheduleRules||State.freshScheduleRules();
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
    const audit=Scheduler?.audit?.(enabledReady,rules,{externalAnchors:rules.includeMailboxScheduled!==false?batch.existingScheduleAnchors:[]})||{conflicts:[],externalConflicts:[],intervalConflicts:[],timeConflicts:[],holidayConflicts:[]};
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
    const parts=[scheduleWeekdayText(rules),`${rules?.localTime||'07:30'} · ${scheduleZoneText(rules)} 当地时间`,`同校至少间隔 ${rules?.sameGroupIntervalDays??7} 天`,`每校每个发送日 ${rules?.maxPerGroupPerRound||1} 位`];
    const skip=scheduleSkipText(rules);if(skip)parts.push(skip);if(rules?.skipHolidays!==false)parts.push('避开可识别的当地节假日');return parts.join(' · ');
  }

  function planningOverviewModel(data,snapshot){
    const warnings=[];
    if(data.audit.conflicts?.length)warnings.push(`${data.audit.conflicts.length} 个同校当日限额冲突`);
    if(data.audit.intervalConflicts?.length)warnings.push(`${data.audit.intervalConflicts.length} 个同校间隔冲突`);
    if(data.audit.holidayConflicts?.length)warnings.push(`${data.audit.holidayConflicts.length} 个日历规则问题`);
    const externalWarnings=(data.audit.externalConflicts?.length||0)+(data.audit.timeConflicts?.length||0);
    if(externalWarnings)warnings.push(`${externalWarnings} 个已有排期冲突`);
    return {
      schools:data.schoolRows.length,rounds:data.rounds.length,selected:snapshot.selectedTotal,ready:snapshot.selectedReady,
      unscheduled:data.unscheduled.length,showMailbox:data.rules.includeMailboxScheduled!==false,
      lockedCount:data.rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus==='ok'?batch.existingScheduleAnchors.length:null,
      ruleSummary:scheduleRuleHumanText(data.rules),warnings
    };
  }


  function schedulePreviewRange(plan,rules){
    const local=(plan?.assignments||[]).map(item=>String(item?.localScheduleAt||'')).filter(Boolean).sort();
    if(!local.length)return '';
    const compact=value=>{const d=String(value||'').slice(0,10);return d?d.slice(5).replace('-','/'):' ';};
    const first=compact(local[0]),last=compact(local[local.length-1]);
    return first===last?first:`${first} → ${last}`;
  }
  function paintScheduleGuide({ready=true,previewPlan=null,error='' }={}){
    if(!scheduleGuideEl)return;
    const steps=[...scheduleGuideEl.querySelectorAll('[data-schedule-guide-step]')];
    steps.forEach(step=>step.classList.remove('is-done','is-active','is-warning'));
    if(steps[0])steps[0].classList.add(ready?'is-done':'is-warning');
    if(steps[1])steps[1].classList.add(ready?'is-done':'');
    if(steps[2])steps[2].classList.add(error?'is-warning':'is-active');
  }

  function renderScheduleCenter() {
    syncStageSurfaceVisibility();
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
    const rules=batch.scheduleRules||State.freshScheduleRules();
    const externalAnchors=rules.includeMailboxScheduled!==false?batch.existingScheduleAnchors:[];
    const audit=Scheduler.audit?.(selected,rules,{externalAnchors})||{conflicts:[],externalConflicts:[],intervalConflicts:[],timeConflicts:[],holidayConflicts:[]};
    const conflictCount=audit.conflicts?.length||0, intervalConflictCount=audit.intervalConflicts?.length||0, externalConflictCount=audit.externalConflicts?.length||0, holidayConflictCount=audit.holidayConflicts?.length||0;
    const mailboxInfo=rules.includeMailboxScheduled===false?'网易已有排期关闭':batch.existingScheduleStatus==='loading'?'正在读取网易已有排期':batch.existingScheduleStatus==='ok'?`网易锁定 ${externalAnchors.length}`:batch.existingScheduleStatus==='error'?'网易已有排期读取失败':'网易已有排期：应用时读取';
    if(scheduleSummaryEl)scheduleSummaryEl.innerHTML=`<strong>${selected.length} 封</strong>参与本次安排 · <span>${unscheduled} 封待生成时间</span> · <span>${protectedCount} 封已有时间</span>${rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus==='ok'?` · <span>网易已有排期 ${externalAnchors.length} 封</span>`:''}${externalConflictCount?` · <span class="nmda-danger">已有排期冲突 ${externalConflictCount}</span>`:''}${conflictCount?` · <span class="nmda-danger">同校当日限额 ${conflictCount}</span>`:''}${intervalConflictCount?` · <span class="nmda-danger">同校间隔 ${intervalConflictCount}</span>`:''}${holidayConflictCount?` · <span class="nmda-danger">日历规则 ${holidayConflictCount}</span>`:''}`;
    let previewPlan=null,previewError='';
    const basicsReady=!!(rules.startDate&&rules.localTime&&(rules.weekdays||[]).length&&rules.timeZone);
    if(basicsReady&&selected.length){
      try{previewPlan=Scheduler.buildPlan(selected,rules,new Date(),{externalAnchors});}
      catch(error){previewError=String(error?.message||error||'无法生成预览');}
    }
    paintScheduleGuide({ready:basicsReady,previewPlan,error:previewError});
    if(scheduleOutcomeEl){
      if(previewError){
        scheduleOutcomeEl.dataset.tone='warn';
        scheduleOutcomeEl.innerHTML=`<div class="nmda-schedule-outcome-mark">!</div><div><span>当前设置还不能生成完整排期</span><strong>${escapeHtml(previewError)}</strong><small>调整上方关键时间项后，这里会立即重新预览；不会修改任何邮件。</small></div>`;
      }else if(previewPlan){
        const ps=previewPlan.summary||{},range=schedulePreviewRange(previewPlan,rules),mailboxPending=rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus!=='ok';
        scheduleOutcomeEl.dataset.tone='ok';
        scheduleOutcomeEl.innerHTML=`<div class="nmda-schedule-outcome-mark">✓</div><div><span>按当前设置，点击“生成本批时间”后</span><strong>${ps.auto?`将自动安排 ${ps.auto} 封邮件`:'不需要新增自动时间'}${ps.preserved?`，保留 ${ps.preserved} 封已有时间`:''}</strong><small>${ps.scheduleDays?`预计使用 ${ps.scheduleDays} 个发送日${range?` · ${range}`:''}`:'当前邮件已有可用时间'}${mailboxPending?'；正式应用时会先读取网易已有排期，再做最终避让。':'。'} </small></div>`;
      }else{
        scheduleOutcomeEl.dataset.tone='neutral';
        scheduleOutcomeEl.innerHTML=`<div class="nmda-schedule-outcome-mark">→</div><div><span>先完成发送窗口</span><strong>地区、开始日期、工作日和当地时间</strong><small>完成后这里会直接告诉你将安排多少封、覆盖多少个发送日。</small></div>`;
      }
    }
    const priorityTasks=selected.filter(task=>Scheduler.priorityRoundForTask?.(task)?.has);
    const prioritySchools=new Set(priorityTasks.map(task=>Scheduler.groupForTask(task).key)).size;
    const prioritySummary=$('nmda-schedule-priority-summary'),priorityButton=$('nmda-schedule-open-priority');
    const prioritySources=typeof rosterPlannerSources==='function'?rosterPlannerSources():[];
    if(prioritySummary)prioritySummary.textContent=priorityTasks.length?`${priorityTasks.length} 封已设置 R1/R2… · ${prioritySchools} 所学校；仅用于同校先后。`:(prioritySources.length?'未设置时按现有名单顺序排期；需要时再补 R1/R2…。':'未导入可编辑总名单；不设置优先级也可正常排期。');
    if(priorityButton){priorityButton.textContent=priorityTasks.length?'调整优先级':'设置优先级';priorityButton.disabled=!prioritySources.length;priorityButton.title=prioritySources.length?'可选：设置同一学校内联系人先后':'未导入可编辑 XLSX 总名单；这不会阻止时间安排';}
    if(scheduleRulePreviewEl){
      const conflictText=conflictCount?` · ${conflictCount} 个同校当日限额冲突`:'';const intervalText=intervalConflictCount?` · ${intervalConflictCount} 个同校间隔冲突`:'';const externalText=externalConflictCount?` · ${externalConflictCount} 个与网易已有排期同校冲突`:'';const holidayText=holidayConflictCount?` · ${holidayConflictCount} 个已有时间不符合当前日历规则`:'';
      scheduleRulePreviewEl.textContent=`${scheduleRuleHumanText(rules)} · ${mailboxInfo}${conflictText}${intervalText}${externalText}${holidayText}`;
    }
    const ruleChip=$('nmda-planning-rule-chip');
    if(ruleChip)ruleChip.textContent=`${scheduleWeekdayText(rules)} · ${rules.localTime||'07:30'} 当地时间 · 同校间隔 ${rules.sameGroupIntervalDays??7} 天 · 每校 ${rules.maxPerGroupPerRound||1} 位${scheduleSkipText(rules)?` · ${scheduleSkipText(rules)}`:''}${rules.includeMailboxScheduled!==false&&batch.existingScheduleStatus==='ok'?` · 锁定 ${externalAnchors.length}`:''}${conflictCount+intervalConflictCount+externalConflictCount?` · ${conflictCount+intervalConflictCount+externalConflictCount} 个冲突`:''}`;
    const scheduleContextCopy=$('nmda-schedule-context-copy');
    if(scheduleContextCopy){
      const rosterCount=referenceRosterCount();
      const schoolKnown=selected.filter(task=>String(task.school||'').trim()).length;
      const priorityKnown=selected.filter(task=>Scheduler.priorityForTask?.(task)?.has).length;
      const contextText=rosterCount?`已加入 ${rosterCount} 条参考名单；${schoolKnown} 封已有院校信息${priorityKnown?`，其中 ${priorityKnown} 封有明确顺序`:''}。`:`${schoolKnown} / ${selected.length} 封已有院校信息。`;
      scheduleContextCopy.textContent=`${contextText} 选择地区、工作日与当地时间后应用。`;
    }
    if(scheduleApplyEl){
      scheduleApplyEl.disabled=batch.running||!selected.length||!!previewError;
      const main=scheduleApplyEl.querySelector('span');
      if(main)main.textContent=previewPlan?.summary?.auto?`生成 ${previewPlan.summary.auto} 封邮件时间`:(auto||unscheduled?'生成本批时间':'重新计算时间');
      if(scheduleApplyHintEl)scheduleApplyHintEl.textContent=previewError?'请先修正上方时间设置':previewPlan?`${previewPlan.summary.preserved?`保留 ${previewPlan.summary.preserved} 封 · `:''}${previewPlan.summary.scheduleDays||0} 个发送日`:'按上方规则自动安排';
    }
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
    if(summary.intervalAdjusted)parts.push(`同校间隔调整 ${summary.intervalAdjusted}`);
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
      const s=plan.summary, audit=Scheduler.audit?.(refreshed,rules,{externalAnchors:plan.externalAnchors||externalAnchors})||{conflicts:[],externalConflicts:[],intervalConflicts:[],timeConflicts:[],holidayConflicts:[]};
      const priority=s.priorityOrderedGroups?`；${s.priorityOrderedGroups} 所院校已按总名单顺序排列`:'';
      const holiday=s.holidayAdjusted?`；${s.holidayAdjusted} 封已避开当地节假日`:'';
      const skipped=s.skipAdjusted?`；${s.skipAdjusted} 封已跨过跳过时间段`:'';
      const externalConflictCount=audit.externalConflicts?.length||0,intervalConflictCount=audit.intervalConflicts?.length||0;
      const conflicts=(audit.conflicts?.length||0)+intervalConflictCount+(audit.holidayConflicts?.length||0)+externalConflictCount;
      const conflict=audit.conflicts?.length?`；保留的当前时间仍有 ${audit.conflicts.length} 个同校当日限额冲突，请手工调整或关闭“保留已有时间”后重排`:'';
      const intervalConflict=intervalConflictCount?`；仍有 ${intervalConflictCount} 个同校间隔冲突，请调整已有时间或同校间隔后重排`:'';
      const externalConflict=externalConflictCount?`；仍有 ${externalConflictCount} 个与网易已有排期的同校日期冲突，请手工调整`:'';
      const holidayConflict=audit.holidayConflicts?.length?`；${audit.holidayConflicts.length} 个保留时间不符合当前工作日/跳过区间/节假日规则`:'';
      const locked=s.externalAnchors?`；纳入网易已有定时草稿 ${s.externalAnchors} 封（只读）`:'';
      const intervalAdjusted=s.intervalAdjusted?`；${s.intervalAdjusted} 封已按同校至少 ${rules.sameGroupIntervalDays??7} 天间隔顺延日期`:'';
      setBatchStatus(`时间已安排：${s.selected} 封邮件，自动安排 ${s.auto} 封，保留当前已有 ${s.preserved} 封，共 ${s.scheduleDays||s.scheduleCycles||s.rounds} 个发送日${locked}${intervalAdjusted}${priority}${holiday}${skipped}${conflict}${intervalConflict}${externalConflict}${holidayConflict}。`,conflicts?'warn':'ok');
      return true;
    }catch(error){setBatchStatus(`安排时间失败：${error.message}`,'error');return false;}
  }

  async function validateMailboxScheduleBeforeExecution(tasks){
    const rules=readScheduleRuleControls();
    if(rules.includeMailboxScheduled===false)return {ok:true,anchors:[]};
    try{
      const anchors=await readExistingScheduleAnchors({required:true});
      const audit=Scheduler?.audit?.(tasks,rules,{externalAnchors:anchors})||{conflicts:[],externalConflicts:[],intervalConflicts:[],timeConflicts:[],holidayConflicts:[]};
      const groupConflicts=(audit.conflicts?.length||0)+(audit.externalConflicts?.length||0),intervalConflicts=audit.intervalConflicts?.length||0,calendarConflicts=audit.holidayConflicts?.length||0;
      if(groupConflicts||intervalConflicts||calendarConflicts){
        const parts=[];if(groupConflicts)parts.push(`${groupConflicts} 个同校发送日限额冲突`);if(intervalConflicts)parts.push(`${intervalConflicts} 个同校间隔冲突`);if(calendarConflicts)parts.push(`${calendarConflicts} 个工作日 / 跳过时间段 / 节假日冲突`);
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
    const selected=(tasks||[]).filter(task=>task.enabled&&task.status==='ready');
    const fileCount=selected.reduce((sum,task)=>sum+(task.files?.length||0),0);
    const attachmentlessCount=selected.filter(task=>!(task.files?.length||0)).length;
    const unscheduledCount=Math.max(0,snapshot.selectedReady-snapshot.selectedScheduled);
    const excluded=excludedImportCount();
    const facts=[`本次 ${snapshot.selectedReady} 封`,snapshot.selectedScheduled?`定时 ${snapshot.selectedScheduled} 封`:'',fileCount?`附件 ${fileCount} 份`:'',excluded?`已排除 ${excluded} 封`:''].filter(Boolean);
    globalThis.NMDAWorkspacePlanningUi.publishPatch({
      summary:{total:tasks.length,initial:sources.initial,followUp:sources.followUp,selectedTotal:snapshot.selectedTotal,ready:snapshot.selectedReady,scheduled:snapshot.selectedScheduled,errors:snapshot.errors,done:snapshot.done},
      preflight:{facts,unscheduled:unscheduledCount,attachmentless:attachmentlessCount,ready:snapshot.selectedReady}
    });
    if(batchStartEl){
      batchStartEl.textContent=snapshot.selectedReady?`前往网易邮箱 · 创建 ${snapshot.selectedReady} 封`:'前往网易邮箱并创建所选草稿';
      batchStartEl.disabled=batch.running||!snapshot.selectedReady;
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

    const rules=batch.scheduleRules||State.freshScheduleRules();
    const zoneText=scheduleZoneText(rules);
    const taskViews=new Map(matched.map(task=>[task.editKey,{
      state:compactPlanningState(task),
      scheduleDisplay:scheduleValueForDisplay(task.scheduleAt,rules),
      zoneText,
      school:Scheduler?.groupForTask?.(task)?.label||task.school||'未识别学校',
      origin:original163MailRef(task)
    }]));
    globalThis.NMDAWorkspacePlanningUi.publishPatch({
      planning,taskViews,running:!!batch.running,maxPerGroupPerRound:rules.maxPerGroupPerRound||1,
      overview:planningOverviewModel(planning,snapshot)
    });

    const hasTasks=tasks.length>0;
    const viewingPlanning=currentWorkbenchTab()==='dispatch';
    const emptyCard=$('nmda-batch-empty');
    if(emptyCard){
      let kicker='安排发送',title='等待邮件',desc='审阅完成的初始邮件和跟进邮件会出现在这里。';
      if(!tasks.length){kicker='安排发送';title='还没有可安排的邮件';desc='先在“审阅邮件”确认邮件已就绪。';}
      emptyCard.innerHTML=`<div class="nmda-card-kicker">${escapeHtml(kicker)}</div><div class="nmda-card-title">${escapeHtml(title)}</div><div class="nmda-card-desc">${escapeHtml(desc)}</div>`;
      emptyCard.hidden=!(viewingPlanning&&!hasTasks);
    }
    $('nmda-preview-card').hidden=!(viewingPlanning&&hasTasks);
    $('nmda-scheduler-card').hidden=!hasTasks;
    renderScheduleCenter();
    setPlanningView('mails');
    if(currentWorkbenchTab()==='batch')syncStageSurfaceVisibility(batch.uiStep);
    if(aux){
      renderTagChips(); publishAttachmentWorkspace(); renderImportTaskPreview(); renderRosterAudit(); renderImportHandoff(); renderReviewPageOverview(); viewPerf.batchAuxDirty=false;
    }
    viewPerf.batchDirty=false;
    return {matched:matched.length,...snapshot};
  }



  function setImportStatus(message, kind = '') {
    globalThis.NMDAWorkspaceImportUi.publishPatch({status:{message,kind}});
  }

  function setBatchStatus(message, kind = '') {
    batchStatusEl.textContent = message;
    if (kind) batchStatusEl.dataset.kind = kind; else delete batchStatusEl.dataset.kind;
  }


  async function importMailboxDrafts() {
    if(batch.running){setImportStatus('正在执行当前批次，暂时不能读取草稿箱。','warn');return;}
    globalThis.NMDAWorkspaceImportUi.publishPatch({draftBusy:true});
    let token=null;
    try{
      // Authenticate before replacing the current import workspace. A failed login check must never erase
      // a batch the user is already reviewing.
      const connection=await Runtime.connectionStatus();
      if(!connection?.connected||!connection?.authenticated){
        await Runtime.openMail(true).catch(()=>null);
        setImportStatus('请先在网易邮箱完成登录，然后返回工作台再次点击“读取草稿箱”。','warn');
        return;
      }
      token=beginImportSession('正在读取网易草稿箱…');
      setImportStatus('正在读取草稿箱中的正文、收件人、发送时间与附件信息，无需逐封打开邮件。');
      const result=await Runtime.importDrafts(300);
      if(!isCurrentBatchSession(token))return;
      if(!result?.ok)throw new Error(result?.reason||'草稿箱读取失败');
      const dataset=mailboxDraftDataset(result);
      await applyImportedDataset(dataset,'网易草稿箱',token);
      if(!isCurrentBatchSession(token))return;
      const coverage=result.complete?'已读取完整草稿箱':`已读取最近 ${result.read||0} 封草稿`;
      setImportStatus(`${coverage}；已识别正文、主题、收件人、发送时间与附件提示。草稿中的附件仅用于识别；需要随邮件发送时请补充对应本地文件。`,result.failures?'warn':'ok');
    }catch(error){
      if(token!=null && isCurrentBatchSession(token))clearImportOnError(error,token);
      else setImportStatus(`草稿箱读取失败：${error.message}`,'error');
    }finally{
      if(token!=null)finishImportSession(token);
      globalThis.NMDAWorkspaceImportUi.publishPatch({draftBusy:false});
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
    batch.taskFiles = uniqueFiles([...(append?batch.taskFiles:[]),...(dataset?.embeddedFiles || [])]); patchAttachmentUi({targetIdentity:'',visible:false});
    for(const file of batch.taskFiles)ensureAttachmentPolicy(file,'task',{source:'随资料导入',mode:'all'});
    batch.fileIndex = Importer.buildFileIndex(batch.taskFiles);
    dirEl.value = ''; taskFilesEl.value = '';
    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    try{await State.ensureOperations();}catch(error){console.warn(`[${APP}] duplicate history store load failed`,error);}
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
    globalThis.NMDAWorkspaceImportUi.publishPatch({formatInfo:`${containerCount?`已展开 ${containerCount} 个资料包 · `:''}${sourceCount?`${sourceCount} 个内容文件 · `:''}${batch.tasks.length} 封邮件${referenceRosterCount()?` · 参考名单 ${referenceRosterCount()} 条`:''}${duplicateSourceCount?` · 已忽略 ${duplicateSourceCount} 个重复副本`:''}`});
    const addedTaskCount=Math.max(0,(batch.tasks||[]).length-previousTaskCount);
    setImportStatus(routedCounts.mail
      ? `${append?`已加入当前批次${addedTaskCount?` · 新增 ${addedTaskCount} 封邮件`:''}`:'邮件已加入本批次'}。${duplicateSourceCount?`已忽略 ${duplicateSourceCount} 个完全相同的重复来源。`:''}${referenceRosterCount()?'参考总名单已匹配当前邮件，后续新增邮件也会继续匹配。':'有参考总名单可现在补充；没有可直接继续。'}`
      : `当前没有识别到可准备的邮件。请先确认这些文件的用途。`,
      routedCounts.mail?'ok':'warn');
    renderImportLifecycleState();
    batch.supplementPreflightOpen=true;renderSupplementPreflight();
    if(!routedCounts.mail||!batch.tasks.length)setBatchStatus('当前没有识别到可准备的邮件；其他资料已保留，不影响继续处理。','warn');
    else setBatchStatus(`已准备 ${batch.tasks.length} 封邮件。${(batch.tasks||[]).some(taskHasBlockingIssue)?'请在审阅邮件中处理待办。':'当前邮件已可进入发送安排。'}`, 'ok');
    if(batch.tasks.length){
      if(batch.supplementPreflightDone)renderImportHandoff();
      if(!dataset?.meta?.mailboxDraftImport) MailboxSync.schedule('history',{source:'import',force:true});
      else MailboxSync.schedule('quick',{source:'mailbox-draft-import'});
      scheduleReadyBatchAutoHandoff('导入与核验已完成');
    }
    State.schedulePersist();
    if(reviewQueueEl) reviewQueueEl.scrollTop=0;
    return true;
  }

  function resetImportWorkspace({ keepStatus = false, invalidate = true, clearStored = true, message = '' } = {}) {
    if (invalidate) batch.sessionId += 1;
    if(clearStored) void State.clearWorkspace().catch(error=>console.warn(`[${APP}] workspace clear failed`,error));
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
    patchAttachmentUi({visible:false,targetIdentity:''});
    batch.attachmentOverrides.clear();
    batch.attachmentPolicies = new Map();
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
    batch.scheduleRules = State.freshScheduleRules();
    batch.roster = emptyRosterState();
    batch.rosterPlanner=RosterPlanner?.createState?.()||{version:1,sourceKey:'',intents:{}};
    clearRosterPlannerSelection();
    syncScheduleRuleControls();

    batch.reviewEditingKey='';
    [importFileEl, importDirEl, rosterFileEl, dirEl, taskFilesEl].forEach(el => { if (el) el.value = ''; });
    const importUiSnapshot=globalThis.NMDAWorkspaceImportUi.getSnapshot();
    globalThis.NMDAWorkspaceImportUi.publishPatch({clearVersion:importUiSnapshot.clearVersion+1});

    if (batchSearchEl) batchSearchEl.value = '';
    if (batchTagIncludeEl) batchTagIncludeEl.value = '';
    const bulkTag = $('nmda-bulk-tag-value'); if (bulkTag) bulkTag.value = '';

    ['nmda-preview-card','nmda-scheduler-card'].forEach(id => {
      const el = $(id); if (el) el.hidden = true;
    });
    globalThis.NMDAWorkspaceImportUi.publishPatch({handoff:{visible:false,metrics:[],hint:''}});
    globalThis.NMDAWorkspaceImportUi.publishPatch({inventory:{visible:false}});
    globalThis.NMDAWorkspaceReviewBoard.publishPreview({items:[],total:0,filter:'all',activeKey:'',preserveScroll:false});
    globalThis.NMDAWorkspaceReviewBoard.publish({items:[],total:0,filter:'all',activeKey:'',limit:0,preserveScroll:false});
    globalThis.NMDAWorkspaceReviewBoard.publishControls({count:0,pending:0,counts:{all:0,auto:0,pending:0,confirmed:0},filter:'all',search:'',selectedCount:0,batchbarVisible:false,selectVisibleCount:0,selectVisibleHidden:true,allVisibleSelected:false});
    if (reviewProgressEl) reviewProgressEl.textContent = '';
    Navigation.setReviewCount(0);
    if(schedulerCardEl){schedulerCardEl.open=true;schedulerCardEl.hidden=true;}
    if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent='收起';
    const trashDetails = $('nmda-review-trash'); if (trashDetails) trashDetails.open = false;
    renderReviewTrash();
    patchAttachmentUi({fileIndexInfo:'尚未选择本地附件。'});

    $('nmda-batch-empty').hidden = false;
    globalThis.NMDAWorkspaceImportUi.publishPatch({formatInfo:'可直接加入常见文档、表格和文本。'});
    setBatchStatus('请先添加资料并检查解析结果。');
    renderImportLifecycleState();
    renderRosterAudit();
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
    setImportStatus(`${batch.importAppendMode?'添加失败，当前批次已保留':'读取失败'}：${error.message}`, 'error');
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

  window.addEventListener('nmda:import-action', event => {
    const {action, text, dataTransfer}=event.detail||{};
    if(action==='drop'){
      if(batch.importBusy||batch.running)return;
      void (async()=>{const files=await filesFromDrop(dataTransfer);if(!files.length){setImportStatus('没有识别到可导入的文件。','warn');return;}await importDroppedFiles(files);})();
    }else if(action==='paste'){
      void importPastedText(text);
    }else if(action==='drafts'){
      void importMailboxDrafts();
    }else if(action==='reset'){
      if(batch.running){setImportStatus('正在创建草稿，暂时不能开始新批次。','warn');return;}
      resetImportWorkspace({ message:'当前批次已彻底清空，可以载入新的来源。' });
    }else if(action==='supplement'){
      openSupplementPreflight('files');
    }else if(action==='batch-prep'){
      openSupplementPreflight('support');
    }else if(action==='attachments'){
      openAttachmentManager();
    }else if(action==='template'){
      downloadImportTemplate();
    }
  });

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
  window.addEventListener('nmda:preflight-action', event=>{
    const {action,view}=typeof event.detail==='string'?{action:event.detail}:event.detail||{};
    if(action==='files'||action==='support')setPreflightView(action);
    else if(action==='back'){batch.supplementPreflightOpen=false;renderSupplementPreflight();setImportStatus('已返回上传区。','ok');}
    else if(action==='complete')completeSupplementPreflight();
    else if(action==='support-view')setSupportView(view);
    else if(action==='attachments')openAttachmentManager();
  });
  ui.querySelectorAll('[data-planning-view]').forEach(button=>button.addEventListener('click',()=>setPlanningView(button.dataset.planningView)));
  $('nmda-open-schedule-modal')?.addEventListener('click',openScheduleModal);
  $('nmda-schedule-open-priority')?.addEventListener('click',()=>openRosterPlannerView({returnToSchedule:true}));
  function scrollRosterPlannerRow(row){if(!Number.isFinite(row))return;requestAnimationFrame(()=>ui.querySelector(`#nmda-roster-sheet-table [data-row="${row}"]`)?.scrollIntoView?.({block:'nearest',inline:'nearest'}));}
  window.addEventListener('nmda:roster-planner-action',event=>{
    const {action,...detail}=event.detail||{};
    if(action==='close'){closeRosterPlannerView();return;}
    if(action==='source'){
      batch.rosterPlanner=RosterPlanner?.createState?.(batch.rosterPlanner)||batch.rosterPlanner;
      batch.rosterPlanner.sourceKey=String(detail.key||'');publishRosterPlannerSelection(null);State.schedulePersist();renderRosterPlanner();return;
    }
    if(action==='toggle-columns'){
      batch.rosterPlanner=RosterPlanner?.createState?.(batch.rosterPlanner)||batch.rosterPlanner;
      batch.rosterPlanner.showIrrelevantColumns=!batch.rosterPlanner.showIrrelevantColumns;publishRosterPlannerSelection(null);State.schedulePersist();renderRosterPlanner();return;
    }
    if(action==='feature'){
      const current=rosterPlannerCurrentSource();if(!current)return;
      const feature=globalThis.NMDAWorkspacePlanningUi.getSnapshot().rosterPlanner.features.find(item=>item.key===detail.key);if(!feature)return;
      publishRosterPlannerSelection({range:null,rows:[...feature.rows],kind:'feature',meta:`${feature.label||'特征'}选择`,featureKey:feature.key,anchor:null});
      scrollRosterPlannerRow(feature.rows?.[0]);return;
    }
    if(action==='batch-focus'){
      const current=rosterPlannerCurrentSource();if(!current)return;
      const value=String(detail.value||''),entries=rosterPlannerEntriesForSet(current.set),model=globalThis.NMDAWorkspaceRosterPlannerModel;
      const targets=value==='__unassigned__'?entries.filter(entry=>!model.effectiveBatch(batch.rosterPlanner,entry)&&!String(entry?.scheduleAt||'').trim()):value==='__fixed__'?entries.filter(entry=>!model.effectiveBatch(batch.rosterPlanner,entry)&&!!String(entry?.scheduleAt||'').trim()):entries.filter(entry=>model.effectiveBatch(batch.rosterPlanner,entry)===value);
      if(value!=='__unassigned__'&&value!=='__fixed__')batch.rosterPlanner=RosterPlanner.setActivePriorityRound(batch.rosterPlanner,value);
      publishRosterPlannerSelection({range:null,rows:targets.map(entry=>Math.max(0,Number(entry?.sourceRow||0)-1)),kind:value==='__unassigned__'?'unassigned':value==='__fixed__'?'fixed':'batch',meta:value.startsWith('__')?'':value,featureKey:'',anchor:null});
      State.schedulePersist();renderRosterPlanner();
      const first=targets[0]&&Math.max(0,Number(targets[0]?.sourceRow||0)-1);scrollRosterPlannerRow(first);return;
    }
    if(action==='create-batch'){createRosterPlannerBatch();return;}
    if(action==='add-batch'){applyRosterPlannerBatch(rosterPlannerActiveBatch());return;}
    if(action==='clear-batch'){applyRosterPlannerBatch('',{clear:true});return;}
    if(action==='select-start'){
      const point=detail.point,anchor=detail.anchor||point;if(!point||!anchor)return;
      publishRosterPlannerSelection({range:{r1:anchor.row,c1:anchor.col,r2:point.row,c2:point.col},rows:[],kind:'box',meta:'',featureKey:'',anchor});return;
    }
    if(action==='select-move'){
      const selection=globalThis.NMDAWorkspacePlanningUi.getSnapshot().rosterPlanner.selection,point=detail.point,anchor=selection?.anchor;if(!point||!anchor)return;
      publishRosterPlannerSelection({...selection,range:{r1:anchor.row,c1:anchor.col,r2:point.row,c2:point.col}});
    }
  });
  $('nmda-close-schedule-modal')?.addEventListener('click',()=>closeScheduleModal());
  $('nmda-cancel-schedule-modal')?.addEventListener('click',()=>closeScheduleModal());
  $('nmda-schedule-modal')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closeScheduleModal();});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!$('nmda-schedule-modal')?.hidden){event.preventDefault();closeScheduleModal();return;}
    if(rosterPlannerIsOpen()){event.preventDefault();closeRosterPlannerView();}
  });

  $('nmda-attachment-later')?.addEventListener('click',()=>{
    batch.attachmentPromptDeferred=true;
    setImportStatus('附件检查已保留；可先处理邮件内容。','ok');
  });
  $('nmda-roster-enabled')?.addEventListener('change', e => {
    State.rosterState().enabled=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });
  $('nmda-roster-auto-school')?.addEventListener('change', e => {
    State.rosterState().autoSchool=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });
  $('nmda-roster-strict')?.addEventListener('change', e => {
    State.rosterState().strict=!!e.target.checked;
    batch.handoffComplete=false;
    if(batch.dataset)rebuildTasks();else renderRosterAudit();
  });

  async function importPastedText(value) {
    const text = String(value || '').trim();
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
  }

  function setResetAllDialog(open){
    const overlay=$('nmda-reset-all-overlay'),confirm=$('nmda-reset-all-confirm'),action=$('nmda-reset-all-confirm-button'),status=$('nmda-reset-all-status');
    if(!overlay)return;
    overlay.hidden=!open;
    if(open){
      if(confirm)confirm.checked=false;
      if(action){action.disabled=true;action.textContent='清空全部数据';}
      if(status){status.hidden=true;status.textContent='';delete status.dataset.tone;}
    }
    syncModalState();
  }

  async function resetAllSmartMailData(){
    if(batch.running){
      const status=$('nmda-reset-all-status');if(status){status.hidden=false;status.dataset.tone='warn';status.textContent='正在创建草稿，不能在执行过程中重置。请先停止当前执行。';}
      return false;
    }
    const action=$('nmda-reset-all-confirm-button'),status=$('nmda-reset-all-status');
    if(action){action.disabled=true;action.textContent='正在清空…';}
    if(status){status.hidden=false;status.dataset.tone='';status.textContent='正在清空 SmartMail 本地数据…';}
    try{
      // Let any in-flight mailbox read finish first, then discard its result. This avoids
      // a late async response repopulating the freshly reset operation store.
      await MailboxSync.reset();
      await State.clearWorkspace();
      Persistence.clearPreferences();

      dispatchRuntime?.clear?.();
      window.dispatchEvent(new Event('nmda:monitor-reset'));

      State.resetOperations(operationState.account || await State.detectAccount());
      resetImportWorkspace({clearStored:false,message:'SmartMail 已完全重置。可直接导入新的资料重新开始。'});
      syncScheduleRuleControls();
      State.changed();
      renderReviewPageOverview();
      setWorkbenchTab('batch');history.replaceState(null,'','#batch');
      if(status){status.dataset.tone='ok';status.textContent='已清空全部 SmartMail 本地数据。';}
      setTimeout(()=>setResetAllDialog(false),350);
      return true;
    }catch(error){
      console.error(`[${APP}] reset all data`,error);
      if(status){status.hidden=false;status.dataset.tone='error';status.textContent=`清空失败：${error?.message||String(error)}`;}
      if(action){action.disabled=false;action.textContent='重新尝试清空';}
      return false;
    }
  }

  $('nmda-reset-all-data')?.addEventListener('click',()=>{
    if(batch.running){setBatchStatus('正在创建草稿，请先停止执行后再重置 SmartMail。','warn');return;}
    setResetAllDialog(true);
  });
  $('nmda-reset-all-close')?.addEventListener('click',()=>setResetAllDialog(false));
  $('nmda-reset-all-cancel')?.addEventListener('click',()=>setResetAllDialog(false));
  $('nmda-reset-all-overlay')?.addEventListener('click',event=>{if(event.target===event.currentTarget)setResetAllDialog(false);});
  $('nmda-reset-all-confirm')?.addEventListener('change',event=>{const action=$('nmda-reset-all-confirm-button');if(action)action.disabled=!event.currentTarget.checked;});
  $('nmda-reset-all-confirm-button')?.addEventListener('click',()=>{if($('nmda-reset-all-confirm')?.checked)void resetAllSmartMailData();});


  window.addEventListener('nmda:import-handoff-action',event=>{
    if(event.detail?.action==='open-review')void openReviewWorkspace({pendingOnly:false,fromImport:true});
  });
  window.addEventListener('nmda:review-action',event=>{
    const {action,key,filter,value}=event.detail||{};
    if(action==='next'){
      if(reviewTasks().length){openNextReviewTask();return;}
      void (async()=>{const ready=await enterSelectionAndSchedule('邮件已审阅');if(!ready)return;setWorkbenchTab('dispatch');history.replaceState(null,'','#dispatch');scheduleBatchRender({aux:false,force:true});})();
      return;
    }
    if(action==='prepare'){setWorkbenchTab('batch');batch.uiStep=1;syncStageSurfaceVisibility();renderRosterAudit();renderImportHandoff();history.replaceState(null,'','#batch');return;}
    if(action==='monitor'){openUtilityView('monitor');return;}
    if(action==='back'){closeReviewPreview();return;}
    if(action==='filter'){
      if(batch.reviewEditingKey){setImportStatus('请先保存或取消当前邮件的编辑，再切换筛选。','warn');return;}
      batch.reviewFilter=['all','auto','pending','confirmed'].includes(filter)?filter:'all';
      viewPerf.reviewRenderLimit=REVIEW_RENDER_CHUNK;
      if(reviewQueueEl)reviewQueueEl.scrollTop=0;
      setReviewSurface('board');batch.reviewPreviewKey='';
      renderReviewPageOverview();
      return;
    }
    if(action==='search'){setReviewSearch(value);return;}
    if(action==='select-visible'){selectVisibleReviewTasks();return;}
    if(action==='clear-selected'){batch.reviewSelected.clear();renderReviewQueue(batch.reviewPreviewKey||'');return;}
    if(action==='confirm-selected'){void confirmSelectedReviewTasks();return;}
    if(action==='restore'){restoreExcludedTask(key);return;}
    if(action==='restore-all'){restoreAllExcludedTasks();return;}
    if(action==='batch'){openReviewBatchProcessing();}
  });
  batchStandardSubjectInputEl?.addEventListener('input',()=>{renderBatchSubjectGovernance();syncBatchProcessingApply();});
  batchStandardSubjectSuggestionEl?.addEventListener('click',()=>{const suggestion=suggestedBulkSubject();if(!suggestion)return;if(batchStandardSubjectInputEl)batchStandardSubjectInputEl.value=suggestion;renderBatchSubjectGovernance();batchStandardSubjectInputEl?.focus?.({preventScroll:true});});
  formatGovernanceEntryEl?.addEventListener('click',openReviewBatchProcessing);
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

  window.addEventListener('nmda:import-audit-action',event=>{
    const {action,keys,key,checked}=event.detail||{};
    if(action==='selection'){
      const duplicate=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit.duplicate,groupId=duplicate.groupId||'';
      if(!groupId)return;
      const selected=new Set(batch.duplicateSelections?.get?.(groupId)||duplicate.selectedKeys||[]);
      checked?selected.add(key):selected.delete(key);
      if(batch.duplicateSelections instanceof Map)batch.duplicateSelections.set(groupId,[...selected]);
      renderDuplicateDecision();
    }else if(action==='keep-selected'){
      void keepSelectedDuplicateCandidate(keys||[]);
    }else if(action==='keep-all'){
      void keepAllDuplicateCandidates();
    }else if(action==='exclude-draft-history'||action==='keep-draft-history'){
      const selected=new Set(keys||[]);if(!selected.size)return;
      const hits=unresolvedDraftHistoryHits();let changed=0;
      for(const hit of hits){
        if(!selected.has(hit.task.editKey))continue;
        if(action==='exclude-draft-history')setTaskEdit(hit.task,{importExcluded:true,draftHistoryDecision:'exclude',draftHistoryDecisionKey:hit.key});
        else setTaskEdit(hit.task,{draftHistoryDecision:'keep',draftHistoryDecisionKey:hit.key,importExcluded:false});
        changed++;
      }
      finishImportDuplicateDecision(action==='exclude-draft-history'?`已排除 ${changed} 封与现有草稿重复的新邮件`:`已明确保留 ${changed} 封命中已有草稿的新邮件`);
    }else if(action==='refresh-mailbox'){
      void refreshMailboxDedupe();
    }
  });
  async function refreshMailboxDedupe(){
    const audit=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit;
    globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...audit,refreshing:true}});
    try{
      setImportStatus('正在重新核验邮箱历史，用于核对已有草稿和已发送记录…');
      const result=await MailboxSync.request('history',{source:'manual-dedupe',force:true});
      renderRosterAudit();syncStageSurfaceVisibility();
      const pending=unresolvedDuplicateGroupCount();
      setImportStatus(`邮箱历史已更新${result?`：已发送 ${result.outboundRead||0} · 草稿 ${result.draftsRead||0}`:''}${pending?`；还有 ${pending} 项查重待处理。`:'；当前查重已完成。'}`,pending?'warn':'ok');
    }catch(error){setImportStatus(`邮箱历史读取失败：${error.message}`,'error');}
    finally{const current=globalThis.NMDAWorkspaceImportUi.getSnapshot().audit;globalThis.NMDAWorkspaceImportUi.publishPatch({audit:{...current,refreshing:false}});}
  }
  schedulerCardEl?.addEventListener('toggle',()=>{if(schedulerToggleLabelEl)schedulerToggleLabelEl.textContent=schedulerCardEl.open?'收起':'展开';});

  dirEl?.addEventListener('change', () => {
    const files=uniqueFiles([...(dirEl.files||[])]);for(const file of files)batch.ignoredAttachmentIdentities.delete(Importer.fileIdentity(file));
    batch.directoryFiles=uniqueFiles([...(batch.directoryFiles||[]),...files]);for(const file of files)ensureAttachmentPolicy(file,'directory',{source:'选择文件夹',mode:'all'});
    batch.attachmentPrepChoice='added';dirEl.value='';refreshFileIndex(false);renderSupplementPreflight();
  });
  preSendMatchFilesEl?.addEventListener('change',()=>{const files=[...(preSendMatchFilesEl.files||[])];preSendMatchFilesEl.value='';addAttachmentFiles(files,{source:'发送前添加',mode:'all'});});
  preSendSharedFilesEl?.addEventListener('change',()=>{const files=[...(preSendSharedFilesEl.files||[])];preSendSharedFilesEl.value='';addAttachmentFiles(files,{source:'发送前添加'});});
  taskFilesEl?.addEventListener('change',()=>{const files=[...(taskFilesEl.files||[])];taskFilesEl.value='';const count=addAttachmentFiles(files,{source:'选择文件'});if(count)setBatchStatus(`已加入 ${count} 个附件；默认适用于全部邮件，可在附件工作台调整范围。`,'ok');});

  window.addEventListener('nmda:attachment-workspace-action',event=>{
    const {action,identity,mode,taskKey,checked,key,dataTransfer,taskKeys=[]}=event.detail||{};
    if(action==='choose-files')taskFilesEl?.click();
    else if(action==='choose-directory')dirEl?.click();
    else if(action==='close')closeAttachmentManager();
    else if(action==='clear')clearAttachmentAssets();
    else if(action==='remove')removeAttachmentAsset(identity);
    else if(action==='policy'){
      if(mode==='selected')patchAttachmentUi({targetIdentity:identity});
      setAttachmentPolicy(identity,mode);
    }else if(action==='target-open'){
      patchAttachmentUi({targetIdentity:identity});publishAttachmentWorkspace();
    }else if(action==='target-close'){
      patchAttachmentUi({targetIdentity:''});publishAttachmentWorkspace();
    }else if(action==='target-check'){
      setAttachmentTarget(identity,taskKey,!!checked);
    }else if(action==='target-all'){
      const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===identity);if(!file)return;
      const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file)),targets=new Set(policy.targets||[]);
      for(const targetKey of taskKeys)targets.add(targetKey);
      policy.mode='selected';policy.targets=[...targets];batch.attachmentPolicies.set(identity,policy);rebuildTasks();publishAttachmentWorkspace();
    }else if(action==='target-clear'){
      const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===identity);if(!file)return;
      const policy=ensureAttachmentPolicy(file,attachmentKindForFile(file));policy.mode='selected';policy.targets=[];batch.attachmentPolicies.set(identity,policy);rebuildTasks();publishAttachmentWorkspace();
    }else if(action==='requirement-match'){
      const file=allAttachmentFiles().find(item=>Importer.fileIdentity(item)===event.detail?.identity);
      if(file)batch.attachmentOverrides.set(key,file);else batch.attachmentOverrides.delete(key);
      rebuildTasks();publishAttachmentWorkspace();
    }else if(action==='drop'){
      void (async()=>{
        const files=await filesFromDrop(dataTransfer);if(!files.length)return;
        const folder=files.some(file=>String(file?._nmdaPath||file?.webkitRelativePath||'').includes('/'));
        const count=addAttachmentFiles(files,{source:folder?'拖入文件夹':'拖入文件',mode:'all'});
        if(count)setBatchStatus(`已拖入 ${count} 个附件；默认适用于全部邮件，可在工作台逐项调整。`,'ok');
      })();
    }
  });

  $('nmda-manage-attachments-todo')?.addEventListener('click',openAttachmentManager);
  $('nmda-manage-attachments-workflow')?.addEventListener('click',openAttachmentManager);
  ui.addEventListener('click',event=>{
    if(event.target.closest?.('[data-open-attachment-manager]'))openAttachmentManager();
  });

  function downloadImportTemplate() {
    const csv = '\ufeff编号,收件人,学校,主题,正文,附件,定时时间,任务标记\r\n001,professor@example.edu,示例大学,示例主题,这是示例正文,该封材料.pdf,2026-08-25 09:30,第一批;重点\r\n002,professor2@example.edu,示例大学,示例主题2,这是示例正文2,,,第二批\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'netease-mail-batch-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  scheduleApplyEl?.addEventListener('click', () => {
    void (async()=>{
      const motionState=captureSchedulePlanMotionState();
      const ok=await applySmartSchedule();
      if(!ok)return;
      closeScheduleModal({restoreFocus:false});
      if(rosterPlannerIsOpen())closeRosterPlannerView({restoreFocus:false});
      renderAppliedScheduleWithMotion(motionState,batch.schedulePlan);
      requestAnimationFrame(()=>$('nmda-open-schedule-modal')?.focus?.({preventScroll:true}));
    })();
  });
  scheduleClearEl?.addEventListener('click',()=>void clearAutoSchedule());
  [scheduleStartDateEl,scheduleLocalTimeEl,scheduleTimeZoneEl,scheduleSkipStartEl,scheduleSkipEndEl,scheduleMaxSchoolEl,scheduleSchoolIntervalEl,schedulePreserveEl,scheduleMailboxExistingEl,scheduleHolidayEl,...scheduleWeekdayEls].forEach(el=>el?.addEventListener('change',()=>{readScheduleRuleControls();batch.schedulePlan=null;renderScheduleCenter();}));
  syncScheduleRuleControls();

  const renderBatchFilterDebounced=debounce(()=>scheduleBatchRender({aux:false}),100);
  [batchSearchEl,batchTagIncludeEl].forEach(el=>el?.addEventListener('input',renderBatchFilterDebounced));

  async function bulkEditFiltered(kind) {
    const targets = filteredBatchTasks().filter(task => task.status !== 'running' && task.status !== 'done');
    if (!targets.length) { setBatchStatus('当前检索/筛选结果没有可编辑任务。', 'warn'); return; }
    const tagValue = $('nmda-bulk-tag-value').value;
    const parsed = parseTaskClassifications(tagValue);
    if ((kind === 'addTag' || kind === 'removeTag') && !parsed.length) {
      setBatchStatus('请输入有效的业务标记。发送状态和跟进状态不能作为业务标记。', 'warn'); return;
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
    const skippedText = [blockedSkipped ? `${blockedSkipped} 封受联系保护规则拦截` : '', followUpTagSkipped ? `${followUpTagSkipped} 封跟进邮件不使用批次标记` : ''].filter(Boolean);
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
    ['nmda-rule-start-date','nmda-rule-local-time','nmda-rule-skip-start','nmda-rule-skip-end'].forEach(id=>{const input=$(id),trigger=input?.closest('.nmda-smart-temporal')?.querySelector('[data-smart-temporal-open]');if(trigger)trigger.disabled=!!locked;});
    if(locked){
      closeSmartTemporal();
      // Do not force a complete planning-matrix rebuild just to lock runtime controls.
      // Full renders are expensive with hundreds of tasks; patch the existing DOM instead.
      previewBodyEl?.querySelectorAll?.('[data-task-enabled],[data-task-schedule],[data-smart-temporal-open]')?.forEach?.(el=>{el.disabled=true;});
    }
  }

  batchPauseEveryTimeEl?.addEventListener('change', () => {
    if (batch.running) { batchPauseEveryTimeEl.checked = !!batch.pauseEveryTime; return; }
    batch.pauseEveryTime = !!batchPauseEveryTimeEl.checked;
  });

  batchParagraphSpacingEl?.addEventListener('change', () => {
    if (batch.running) { batchParagraphSpacingEl.checked = batch.composeParagraphSpacing !== false; return; }
    batch.composeParagraphSpacing = batchParagraphSpacingEl.checked !== false;
    Persistence.writeParagraphSpacing(batch.composeParagraphSpacing);
  });

  batchFastComposeEl?.addEventListener('change', () => {
    if (batch.running) { batchFastComposeEl.checked = !!batch.fastCompose; return; }
    batch.fastCompose = !!batchFastComposeEl.checked;
    Persistence.writeFastCompose(batch.fastCompose);
    setBatchStatus(batch.fastCompose
      ? '快速创建已开启：创建新邮件时优先使用快速模式；遇到不兼容情况会自动切换为标准模式。'
      : '快速创建已关闭：使用标准模式创建邮件。', 'ok');
  });
  ui.querySelectorAll('[data-utility-back]').forEach(entry=>entry.addEventListener('click',()=>setUtilityView('home')));
  window.addEventListener('nmda:draft-attachment-action',event=>{
    const {action,...detail}=event.detail||{};
    if(action==='refresh'){void scanDraftAttachmentTool();return;}
    if(action==='select-group'){
      const group=draftAttachmentTool.groups.find(item=>item.key===String(detail.key||''));if(!group)return;
      draftAttachmentTool.selectedKey=group.key;draftAttachmentTool.replacementFile=null;
      draftAttachmentTool.selectedDraftIds=new Set(draftAttachmentTargets(group).map(item=>String(item.draft.id||'')));
      setDraftAttachmentUtilityResult('');setDraftAttachmentMotion({hidden:true});renderDraftAttachmentTool();return;
    }
    if(action==='select-all'){
      const targets=draftAttachmentTargets();
      draftAttachmentTool.selectedDraftIds=new Set(detail.checked?targets.map(item=>String(item.draft.id||'')):[]);
      renderDraftAttachmentTool();return;
    }
    if(action==='target-check'){
      const id=String(detail.id||'');if(!id)return;
      if(detail.checked)draftAttachmentTool.selectedDraftIds.add(id);else draftAttachmentTool.selectedDraftIds.delete(id);
      renderDraftAttachmentTool();return;
    }
    if(action==='select-file'){
      draftAttachmentTool.replacementFile=detail.file||null;
      setDraftAttachmentUtilityResult('');setDraftAttachmentMotion({hidden:true});renderDraftAttachmentTool();return;
    }
    if(action==='run'){void runDraftAttachmentReplacement();return;}
    if(action==='cancel')void cancelDraftAttachmentReplacement();
  });

  batchStartEl.addEventListener('click', async () => {
    if (batch.running) return;
    await State.ensureOperations();
    const queue = dispatchTasks();
    const selectedBlocked=queue.filter(task=>task.enabled&&task.status==='error');
    if(selectedBlocked.length){
      const attachmentOnly=selectedBlocked.filter(task=>{const state=taskIssueState(task);return state.attachment.length&&state.content.length===0&&state.review.length===0&&state.schedule.length===0&&state.other.length===0;});
      for(const task of attachmentOnly){task.errors=(task.errors||[]).filter(error=>!/^缺少附件：|^附件同名冲突：/.test(String(error||'')));task.warnings=[...new Set([...(task.warnings||[]),'附件要求未匹配（不阻断发送）'])];task.status=task.errors.length?'error':'ready';}
      const stillBlocked=queue.filter(task=>task.enabled&&task.status==='error');
      if(stillBlocked.length){setBatchStatus(`还有 ${stillBlocked.length} 封已选择邮件存在未解决问题。请先处理或取消选择。`,'error');return;}
    }
    const executable = queue.filter(task => task.enabled && task.status === 'ready');
    if (!executable.length) { setBatchStatus('没有可创建的邮件。请先选择本次需要创建的草稿。', 'error'); return; }
    const staleScheduled=executable.filter(task=>task.scheduleAt && (Scheduler?.parseLocalDateTime?.(task.scheduleAt)?.getTime()||0) <= Date.now()+60*1000);
    if(staleScheduled.length){setBatchStatus(`有 ${staleScheduled.length} 封邮件的定时时间已过。请先在“时间安排”中更新或清空。`,'error');return;}
    const executableKeys = new Set(executable.map(task => task.editKey)); // freeze this dispatch run
    const mailTarget=await Runtime.openMail(true);
    if(!mailTarget?.ok){setBatchStatus('无法打开网易邮箱页面，请先完成登录。','error');return;}
    const mailboxReady=await waitForMailboxExecutionReady();
    if(!mailboxReady?.connected || !mailboxReady?.authenticated){
      setBatchStatus('网易邮箱已打开，但尚未检测到已登录账号。请在网易邮箱完成登录后返回工作台再次开始。','error');
      return;
    }
    const scheduleValidation=await validateMailboxScheduleBeforeExecution(executable);
    if(!scheduleValidation.ok){setBatchStatus(scheduleValidation.reason||'无法核对网易已有排期。','error');return;}
    batch.running = true; batch.stopRequested = false; batch.pauseEveryTime = !!batchPauseEveryTimeEl?.checked; batch.composeParagraphSpacing = batchParagraphSpacingEl?.checked !== false; batch.fastCompose = !!batchFastComposeEl?.checked; batchStartEl.disabled = true; batchStopEl.disabled = false;
    if (batchPauseEveryTimeEl) batchPauseEveryTimeEl.disabled = true;
    if (batchParagraphSpacingEl) batchParagraphSpacingEl.disabled = true;
    if (batchFastComposeEl) batchFastComposeEl.disabled = true;
    await updateMailboxBatchMonitor({action:'start',total:executable.length,succeeded:0,failed:0,remaining:executable.length,items:executable.map((task,index)=>({key:task.editKey,id:task.id,index:index+1,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||'',scheduleAt:task.scheduleAt||'',status:'queued'}))});
    importFileEl.disabled = true; if (importDirEl) importDirEl.disabled = true; if (rosterFileEl) rosterFileEl.disabled = true; dirEl.disabled = true; taskFilesEl.disabled = true; if(preSendMatchFilesEl)preSendMatchFilesEl.disabled=true;if(preSendSharedFilesEl)preSendSharedFilesEl.disabled=true;globalThis.NMDAWorkspaceImportUi.publishPatch({locked:true});
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
        patchPlanningTaskRuntime({...task,status:'running',runtimeError:''});
        const runIndex=succeeded+failed+1;
        const kindLabel=task.dispatchKind==='follow_up'?`跟进邮件 #${Math.max(1,Number(task.sequence||1))}`:'初始邮件';
        setBatchStatus(`正在处理 ${runIndex}/${executable.length} · ${kindLabel} · ${task.subject || '(无主题)'}${task.scheduleAt ? ` · 定时 ${scheduleValueForDisplay(task.scheduleAt,batch.scheduleRules||State.freshScheduleRules()).replace('T',' ')} · ${scheduleZoneText(batch.scheduleRules||State.freshScheduleRules())} 当地时间` : ' · 未定时'}`);
        await updateMailboxBatchMonitor({action:'task-start',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-runIndex+1),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||'',scheduleAt:task.scheduleAt||''}});
        try {
          const outcome = await executeDraftRemotely(task, {
            fresh: true,
            pauseEveryTime: batch.pauseEveryTime,
            ensureParagraphSpacing: batch.composeParagraphSpacing !== false,
            fastCompose: !!batch.fastCompose,
            scheduleDisplayAt: task.scheduleAt ? scheduleValueForDisplay(task.scheduleAt,batch.scheduleRules||State.freshScheduleRules()) : '',
            scheduleTimeZoneLabel: scheduleZoneText(batch.scheduleRules||State.freshScheduleRules()),
            onProgress: progress => {
              setBatchStatus(`${kindLabel}：${progress.message || '正在创建草稿…'}`);
              void updateMailboxBatchMonitor({action:'task-progress',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-runIndex),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||''},executionId:String(progress.executionId||''),phase:progress.phase||'',message:progress.message||'正在创建草稿…'});
            }
          });
          const notes=[];
          if (outcome.fastCompose?.active) notes.push('快速创建');
          else if (outcome.fastCompose?.requested) notes.push('已切换标准创建模式');
          const upload = outcome.attachment || {};
          if (upload.verified === false && upload.missingNames?.length) notes.push(`附件已提交上传，但页面未确认：${upload.missingNames.join('、')}`);
          if (task.scheduleAt && outcome.actualMinute !== null && outcome.actualMinute !== undefined) {
            const requestedMinute = new Date(task.scheduleAt).getMinutes();
            if (Number(outcome.actualMinute) !== requestedMinute) notes.push(`分钟由 ${requestedMinute} 调整为 ${outcome.actualMinute}`);
          }
          notes.push('草稿已确认保存');
          if (outcome.cleanup?.ok === false) notes.push(`写信标签清理失败：${outcome.cleanup.reason || '未知原因'}`);
          let draftRecord=null;
          if (Operations) {
            const recorded = Operations.recordPreparedDraft(operationState.store, task, outcome);
            State.setStore(recorded.store);
            draftRecord=recorded.record;
            if(task.dispatchKind==='follow_up'){
              const sourceId=task._sourceTaskId||task.id;
              const current=operationState.store.derivedTasks?.[sourceId];
              if(!current)throw new Error('跟进邮件已创建，但状态未能更新。请刷新后核对该联系人。');
              const targetState=task.scheduleAt?'scheduled':'confirmed';
              const stateResult=Operations.setDerivedTaskState(operationState.store,sourceId,targetState,{
                draftPreparedAt:new Date().toISOString(),
                draftRecordId:draftRecord?.id||'',
                scheduledAt:task.scheduleAt||'',
                runtimeError:''
              });
              State.setStore(stateResult.store);
              const dequeued=Operations.updateDerivedTaskDispatch(operationState.store,sourceId,{queued:false,dequeuedReason:'draft-prepared'});
              State.setStore(dequeued.store);
            }

          }
          setDispatchRuntime(task,{status:'done',runtimeError:'',note:notes.join('；')});
          if(task.dispatchKind==='follow_up') clearDispatchRuntime(task);
          succeeded++;
          const cleanupFailed = outcome.cleanup?.ok === false;
          await updateMailboxBatchMonitor({action:'task-done',current:runIndex,total:executable.length,succeeded,failed,remaining:Math.max(0,executable.length-succeeded-failed),task:{key:task.editKey,id:task.id,kind:task.dispatchKind||'initial',recipient:task.recipients||'',subject:task.subject||''},message:cleanupFailed?'草稿已保存，但写信标签未关闭':'草稿已确认保存'});
          patchPlanningTaskRuntime({...task,status:'done',runtimeError:'',note:notes.join('；')});
          if (cleanupFailed) {
            cleanupStopReason = `当前草稿已保存，但网易写信标签未能安全关闭：${outcome.cleanup.reason || '未知原因'}。为避免继续累积或误操作标签，批处理已停止。`;
            batch.stopRequested = true;
            setBatchStatus(cleanupStopReason, 'warn');
            break;
          }
          // Exact Compose cleanup is already the synchronization boundary. A long fixed
          // post-mail sleep only creates visible dead time; yield briefly and let the next
          // openFreshCompose() perform the provider readiness check.
          await sleep(24);
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
                State.setStore(updated.store);

              }
            }catch(persistError){console.warn(`[${APP}] persist follow-up execution error failed`,persistError);}
          }
          failed++; patchPlanningTaskRuntime({...task,status:'ready',runtimeError:message});
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
      if (batchParagraphSpacingEl) batchParagraphSpacingEl.disabled = false;
      if (batchFastComposeEl) batchFastComposeEl.disabled = false;
      importFileEl.disabled = false; if (importDirEl) importDirEl.disabled = false; if (rosterFileEl) rosterFileEl.disabled = false; dirEl.disabled = false; taskFilesEl.disabled = false; if(preSendMatchFilesEl)preSendMatchFilesEl.disabled=false;if(preSendSharedFilesEl)preSendSharedFilesEl.disabled=false;globalThis.NMDAWorkspaceImportUi.publishPatch({locked:false});
      setBatchPlanningLocked(false);
      scheduleBatchRender({aux:false,force:true});
    }
  });

  function applyDeepLink() {
    const raw = String(location.hash || '').replace(/^#/, '');
    if(raw==='monitor'){setWorkbenchTab('utilities');setUtilityView('monitor',{syncHash:false});return;}
    const utility=raw.match(/^utilities(?:\/(monitor|draft-attachments))?$/);
    if(utility){setWorkbenchTab('utilities');setUtilityView(utility[1]||'home',{syncHash:false});return;}
    const match=raw.match(/^(batch|review|dispatch|dashboard)$/);
    if(!match)return;
    const tab=match[1];
    if(tab==='review'){requestAnimationFrame(()=>void openReviewWorkspace({pendingOnly:false,fromDeepLink:true}));return;}
    setWorkbenchTab(tab);
  }

  window.addEventListener('hashchange', applyDeepLink);
  window.addEventListener('pagehide',()=>{ void State.persistNow(); });
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') void State.persistNow(); });
  void (async()=>{
    await restoreWorkspaceFromStorage();
    invalidateBatchView(true);
    await State.ensureOperations(true).catch(error=>console.warn(`[${APP}] operations init failed`,error));
    applyDeepLink();
    scheduleBatchRender({aux:true,force:true});
  })();
})();
