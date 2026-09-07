/* Visual workspace. No mailbox operations or parser state are owned by this module. */
(() => {
  'use strict';
  let api=null,frame=0,view='list',timelineLimit=100,returnFocus=null,activeModal=null;
  const inerted=new Set();
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons={mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',check:'<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>',alert:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'};
  const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.mail}</svg>`;
  const dayLabel=value=>value==='unscheduled'?'未设置时间':new Date(value+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'});
  const tasksForDate=(tasks,date)=>tasks.filter(t=>(t.scheduleAt?t.scheduleAt.slice(0,10):'unscheduled')===date);
  function refresh(){if(!api||frame)return;frame=requestAnimationFrame(()=>{frame=0;render();});}
  function render(){
    const s=api.snapshot(),tasks=s.tasks.filter(t=>!t.importExcluded),total=tasks.length;
    const needs=tasks.filter(t=>s.issue(t)||s.reviewState(t).key==='decision').length;
    const ready=tasks.filter(t=>t.enabled&&t.status==='ready').length;
    const scheduled=tasks.filter(t=>t.enabled&&!!t.scheduleAt).length;
    const done=tasks.filter(t=>t.status==='done').length;
    const percent=total?Math.round((total-needs)/total*100):0;
    const metrics=[['mail','本批次邮件',total,'all','查看全部邮件','neutral'],['check','可创建草稿',ready,'ready','内容与附件已就绪','green'],['alert','需要处理',needs,'issues',needs?'核对内容或补充资料':'当前没有待处理事项','amber'],['clock','已安排时间',scheduled,'schedule','查看本次排期','blue']];
    const html=metrics.map(([ico,label,count,action,copy,tone])=>`<button class="v4-metric" type="button" data-v4-metric="${action}" data-tone="${tone}" ${!total||s.running?'disabled':''}><span class="v4-metric-icon">${icon(ico)}</span><span class="v4-metric-label">${label}</span><strong>${count}<small>封</small></strong><span class="v4-metric-note">${copy}${icon('arrow')}</span></button>`).join('');
    if($('v4-overview').innerHTML!==html)$('v4-overview').innerHTML=html;
    $('v4-rail-count').textContent=total?`${done?done+' 封已创建':percent+'% 核验就绪'}`:'尚未导入';
    $('v4-rail-progress').style.width=percent+'%';
    $('v4-rail-progress').parentElement.setAttribute('aria-label',`核验就绪 ${percent}%`);
    $('v4-date-filter').hidden=!s.date;$('v4-date-label').textContent=s.date?dayLabel(s.date):'';
    $('nmda-batch-stop').hidden=!s.running;
    api.root.classList.toggle('v4-is-running',s.running);
    $('nmda-import-card').setAttribute('aria-busy',String(s.busy));
    if(!s.hasSource&&s.date)api.setDate('');
    renderTimeline(s);syncView();
    if(!$('nmda-schedule-modal').hidden)renderForecast();
  }
  function renderTimeline(s){
    if(view!=='timeline')return;
    const groups=new Map();
    for(const t of s.visible){const day=t.scheduleAt?t.scheduleAt.slice(0,10):'unscheduled';if(!groups.has(day))groups.set(day,[]);groups.get(day).push(t);}
    let dates=[...groups.keys()].sort((a,b)=>a==='unscheduled'?1:b==='unscheduled'?-1:a.localeCompare(b));
    if(s.date)dates=dates.filter(d=>d===s.date);
    const max=Math.max(1,...dates.map(d=>groups.get(d).length));
    const chart=dates.slice(0,14).map(d=>`<button type="button" class="v4-day-bar" data-v4-date="${esc(d)}" title="筛选 ${esc(dayLabel(d))}，${groups.get(d).length} 封"><span>${d==='unscheduled'?'未定时':d.slice(5).replace('-','/')}</span><i><b style="width:${Math.max(3,groups.get(d).length/max*100)}%"></b></i><strong>${groups.get(d).length}</strong></button>`).join('');
    let budget=timelineLimit;
    const content=dates.map(d=>{
      const all=groups.get(d).sort((a,b)=>String(a.scheduleAt).localeCompare(String(b.scheduleAt))),list=all.slice(0,Math.max(0,budget));budget-=list.length;if(!list.length)return '';
      return `<section class="v4-day"><header><span class="v4-day-dot"></span><h3>${esc(dayLabel(d))}</h3><span>${all.length} 封</span></header><div class="v4-day-mails">${list.map(t=>`<button class="v4-timeline-mail" type="button" data-v4-review="${esc(t.editKey)}" ${s.running?'disabled':''}><time>${t.scheduleAt?esc(t.scheduleAt.slice(11,16)):'—'}</time><span class="v4-avatar">${esc((t.recipients||'?')[0].toUpperCase())}</span><span class="v4-timeline-copy"><strong>${esc(t.recipients||'收件人待补')}</strong><small>${esc(t.subject||'主题待补')}</small></span><span class="v4-timeline-school">${esc(t.school||'未指定院校')}</span><span class="v4-pill" data-tone="${t.enabled?'green':'neutral'}">${t.status==='done'?'已创建':t.enabled?'已选择':'未选择'}</span></button>`).join('')}</div></section>`;
    }).join('');
    $('v4-timeline').innerHTML=dates.length?`<aside class="v4-distribution"><h3>日期分布</h3><p>点击日期筛选邮件</p>${chart}${dates.length>14?`<small>其余 ${dates.length-14} 个日期见时间轴</small>`:''}</aside><div class="v4-timeline-days">${content}${budget<=0&&dates.reduce((n,d)=>n+groups.get(d).length,0)>timelineLimit?'<button type="button" class="nmda-btn" id="v4-timeline-more">继续显示</button>':''}</div>`:'<div class="v4-empty">没有符合筛选条件的邮件。</div>';
  }
  function syncView(){
    $('nmda-preview-card').dataset.visualView=view;
    const list=document.querySelector('.nmda-batch-table-wrap');if(list)list.hidden=view!=='list';
    $('v4-timeline').hidden=view!=='timeline';
    document.querySelectorAll('[data-v4-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v4View===view)));
    if(view==='timeline')$('v4-load-more').hidden=true;
  }
  function renderForecast(){
    const box=$('v4-schedule-preview');
    try{
      const plan=api.forecast();const dates=new Map();
      for(const a of plan.assignments||[]){const d=a.scheduleAt.slice(0,10);dates.set(d,(dates.get(d)||0)+1);}
      box.innerHTML=`<div class="v4-forecast-head"><strong>安排预览</strong><span>应用后生效</span></div><div class="v4-forecast-days">${[...dates].slice(0,6).map(([d,n])=>`<span><small>${esc(d.slice(5).replace('-','/'))}</small><b>${n}<em>封</em></b></span>`).join('')||'<p>当前选择的邮件无需新增自动时间。</p>'}</div>${dates.size>6?`<small>共 ${dates.size} 个日期，应用后可在时间轴查看全部。</small>`:''}`;
    }catch(e){box.innerHTML=`<span class="nmda-danger">${esc(e.message||'请检查排期设置')}</span>`;}
  }
  function openCommand(help=false){
    returnFocus=document.activeElement;
    const modal=$('v4-command');modal.hidden=false;modal.querySelector('h3').textContent=help?'快捷操作与键盘':'你想做什么？';
    $('v4-command-search').value='';filterCommands('');$('v4-command-search').focus();
  }
  function closeCommand(){const el=$('v4-command');if(el.hidden)return;el.hidden=true;if(returnFocus?.isConnected)returnFocus.focus();}
  const commands=[['import','导入邮件文件','选择本地文件，加入批次','I'],['paste','粘贴邮件内容','从文字或表格开始',''],['review','审阅邮件','查看识别结果与待处理项','R'],['attachments','配置附件','匹配文件与适用邮件','A'],['schedule','安排发送时间','设置规则并预览','S'],['contacts','查看联系人','状态与跟进记录',''],['single','创建单封草稿','填写一封邮件','']];
  function filterCommands(q){const s=api.snapshot();$('v4-command-list').innerHTML=commands.filter(c=>c.join(' ').toLowerCase().includes(q.toLowerCase())).map(([id,title,desc,key])=>`<button type="button" data-v4-command="${id}" ${s.running||(['review'].includes(id)&&!s.hasSource)||(id==='schedule'&&!s.handed)?'disabled':''}><span>${icon(id==='schedule'?'clock':'mail')}</span><span><strong>${title}</strong><small>${desc}</small></span>${key?`<kbd>Alt ${key}</kbd>`:''}</button>`).join('')||'<p class="v4-empty">没有找到操作。</p>';}
  function runCommand(id){closeCommand();if(api.snapshot().running)return;switch(id){case'import':api.step(1);$('nmda-import-file').click();break;case'paste':api.step(1);if($('nmda-paste-panel').hidden)$('nmda-show-paste').click();$('nmda-paste-source').focus();break;case'review':api.review();break;case'attachments':api.attachments();break;case'schedule':api.schedule();break;case'contacts':api.tab('contacts');break;case'single':api.tab('single');break;}}
  function focusable(el){return [...el.querySelectorAll('button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]'));}
  function topModal(){return [$('v4-command'),$('nmda-attachment-manager-overlay'),$('nmda-import-editor-overlay'),$('nmda-schedule-modal'),$('nmda-contact-modal'),$('nmda-supplement-preflight')].find(e=>e&&!e.hidden);}
  function syncFocusScope(modal){
    for(const el of inerted)el.inert=false;
    inerted.clear();
    if(modal){
      let branch=modal;
      while(branch && branch!==api.root){
        const parent=branch.parentElement;if(!parent)break;
        for(const sibling of parent.children){if(sibling!==branch&&!sibling.inert){sibling.inert=true;inerted.add(sibling);}}
        branch=parent;
      }
    }else if(!$('nmda-inline-review').hidden){
      const main=api.root.querySelector('.nmda-main');if(main){main.inert=true;inerted.add(main);}
    }
  }
  function mount(options){
    api=options;
    $('v4-today').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
    const dialog=document.createElement('div');dialog.id='v4-command';dialog.className='v4-command-overlay';dialog.hidden=true;
    dialog.innerHTML='<section class="v4-command-dialog" role="dialog" aria-modal="true" aria-labelledby="v4-command-title"><header><h3 id="v4-command-title">你想做什么？</h3><button type="button" id="v4-command-close" aria-label="关闭快捷操作">×</button></header><input id="v4-command-search" type="search" placeholder="搜索操作…" aria-label="搜索操作" autocomplete="off"><div id="v4-command-list"></div><footer><kbd>↑ ↓</kbd> 选择　<kbd>Enter</kbd> 打开　<kbd>Esc</kbd> 返回</footer></section>';
    api.root.appendChild(dialog);
    $('v4-command-open').addEventListener('click',()=>openCommand());$('v4-help').addEventListener('click',()=>openCommand(true));$('v4-command-close').addEventListener('click',closeCommand);
    dialog.addEventListener('click',e=>{if(e.target===dialog)closeCommand();});$('v4-command-search').addEventListener('input',e=>filterCommands(e.target.value));
    api.root.addEventListener('click',e=>{
      const zone=e.target.closest('[data-drop-purpose]');if(zone){api.root.querySelector('[data-preflight-filter="'+zone.dataset.dropPurpose+'"]')?.click();return;}
      const c=e.target.closest('[data-v4-command]');if(c){runCommand(c.dataset.v4Command);return;}
      const b=e.target.closest('[data-v4-view]');if(b){view=b.dataset.v4View;timelineLimit=100;api.render();refresh();return;}
      const d=e.target.closest('[data-v4-date]');if(d){api.setDate(d.dataset.v4Date);refresh();return;}
      const r=e.target.closest('[data-v4-review]');if(r){api.review('all',r.dataset.v4Review);return;}
      const m=e.target.closest('[data-v4-metric]');if(m){const k=m.dataset.v4Metric;if(k==='schedule')api.schedule();else if(k==='issues'){const s=api.snapshot();if(!s.tasks.some(t=>s.reviewState(t).issues.length)&&s.attachmentIssues)api.attachments();else api.review('attention');}else if(k==='ready')api.step(3);else api.review();}
      if(e.target.closest('#v4-timeline-more')){timelineLimit+=100;refresh();}
    });
    $('v4-clear-date').addEventListener('click',()=>api.setDate(''));
    $('v4-more-mails').addEventListener('click',()=>api.more());
    document.querySelectorAll('#nmda-scheduler-card input').forEach(el=>el.addEventListener('input',renderForecast));
    new MutationObserver(()=>{
      const modal=topModal();syncFocusScope(modal);if(modal!==activeModal){
        if(modal){modal._v4PreviousFocus=document.activeElement;requestAnimationFrame(()=>{if(modal===topModal()&&!modal.contains(document.activeElement))focusable(modal)[0]?.focus({preventScroll:true});});}
        else if(activeModal?._v4PreviousFocus?.isConnected)activeModal._v4PreviousFocus.focus({preventScroll:true});
        activeModal=modal;
      }
      if(!$('nmda-schedule-modal').hidden)renderForecast();
    }).observe(api.root,{subtree:true,attributes:true,attributeFilter:['hidden']});
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();e.stopImmediatePropagation();openCommand();return;}
      const modal=topModal();
      if(e.key==='Escape'&&modal){e.preventDefault();e.stopImmediatePropagation();if(modal===dialog)closeCommand();else api.closeTop();return;}
      if(e.key==='Tab'&&modal){const list=focusable(modal);const first=list[0],last=list.at(-1);if(!first)return;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
      if(!dialog.hidden&&['ArrowDown','ArrowUp','Enter'].includes(e.key)){const items=[...$('v4-command-list').querySelectorAll('button:not(:disabled)')];if(!items.length)return;const index=items.indexOf(document.activeElement);if(e.key==='Enter'&&index<0){e.preventDefault();items[0].click();}else if(e.key!=='Enter'){e.preventDefault();items[(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}return;}
      if(e.altKey&&!e.ctrlKey&&!e.metaKey&&!modal){const key={i:'import',r:'review',a:'attachments',s:'schedule'}[e.key.toLowerCase()];if(key){e.preventDefault();runCommand(key);}}
    },true);
    for(const id of ['nmda-status','nmda-import-status','nmda-batch-status']){$(id)?.setAttribute('role','status');$(id)?.setAttribute('aria-live','polite');}
    const labels={'nmda-batch-search':'搜索本批次邮件','nmda-contact-search':'搜索联系人','nmda-contact-class-filter':'筛选联系状态与标记','nmda-review-search':'搜索待审阅邮件'};
    for(const [id,label] of Object.entries(labels))$(id)?.setAttribute('aria-label',label);
    refresh();
  }
  globalThis.NMDAWorkspace={mount,refresh};
})();
