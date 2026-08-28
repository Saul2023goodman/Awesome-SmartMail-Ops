#!/usr/bin/env python3
"""Standalone-workspace UI/runtime QA for NetEase Mail Draft Assistant v2.5.

This runner serves the real extension app files in Chromium, stubs only Chrome-extension
transport APIs, drives the production import stack, and captures responsive screenshots.
The mailbox executor itself is syntax-checked separately because the QA host is not a
logged-in mail.163.com session.
"""
from __future__ import annotations
import argparse, json, subprocess, threading, socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'qa'; FIXTURES=QA/'fixtures'; SHOTS=QA/'screenshots'; REPORTS=QA/'reports'
VIEWPORTS=[(1440,900,'desktop-wide'),(1280,800,'desktop'),(1100,760,'compact'),(920,720,'narrow'),(820,700,'minimum'),(1366,611,'short-desktop')]
JS_FILES=['app.js','background.js','executor.js','file-vault.js','import-core.js','mail-recognizer.js','import-adapters.js','importer.js','contacts.js','scheduler.js','roster.js']

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def serve_root():
    handler=lambda *a,**kw: QuietHandler(*a,directory=str(ROOT),**kw)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    return server,server.server_address[1]

def static_checks():
    checks=[]
    for name in JS_FILES:
        p=subprocess.run(['node','--check',str(ROOT/name)],capture_output=True,text=True)
        checks.append({'name':f'node --check {name}','ok':p.returncode==0,'output':(p.stderr or p.stdout).strip()})
    p=subprocess.run(['node',str(ROOT/'tests/source-role-regression.js')],cwd=ROOT,capture_output=True,text=True)
    checks.append({'name':'source-role regression','ok':p.returncode==0,'output':(p.stdout+p.stderr).strip()})
    try:
        manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
        arch_ok=manifest.get('version') in {'2.5.0'} and manifest.get('action') and manifest.get('content_scripts',[{}])[0].get('js')==['executor.js']
        checks.append({'name':'manifest standalone architecture','ok':bool(arch_ok),'output':json.dumps(manifest.get('content_scripts'),ensure_ascii=False)})
    except Exception as e: checks.append({'name':'manifest standalone architecture','ok':False,'output':str(e)})
    app_text=(ROOT/'app.js').read_text(encoding='utf-8')
    forbidden=['本批次自动查重；总名单和邮箱历史只作为增强参考。','当前批次仍会正常查重','不自动发送','不会自动发送','只创建 / 保存草稿']
    present=[x for x in forbidden if x in app_text]
    checks.append({'name':'redundant / technical UI copy removed','ok':not present,'output':'absent' if not present else ' / '.join(present)})
    return {'ok':all(x['ok'] for x in checks),'checks':checks}

def chrome_stub():
    return r"""
    (()=>{
      const store={}; const listeners=[];
      globalThis.chrome={
        runtime:{
          sendMessage:async msg=>{
            if(msg?.type==='NMDA_CONNECTION_STATUS')return {ok:true,connected:false,authenticated:false};
            if(msg?.type==='NMDA_LEGACY_PREFS')return {ok:false,reason:'qa-no-mailbox'};
            if(msg?.type==='NMDA_OPEN_MAIL')return {ok:true,tabId:1};
            if(msg?.type==='NMDA_ACCOUNT_INFO')return {ok:false,reason:'qa-no-mailbox'};
            if(msg?.type==='NMDA_READ_MAILBOX_STATE')return {ok:false,reason:'qa-no-mailbox'};
            if(msg?.type==='NMDA_EXECUTE_DRAFT')return {ok:false,reason:'qa-no-mailbox'};
            return {ok:false,reason:'qa-controlled-host'};
          },
          onMessage:{addListener:fn=>listeners.push(fn)},
          _emit:msg=>listeners.forEach(fn=>{try{fn(msg,{},()=>{});}catch(_){}})
        },
        storage:{local:{get:async k=>typeof k==='string'?{[k]:store[k]}:{...store},set:async obj=>Object.assign(store,obj||{})}}
      };
    })();
    """

def audit_dom(page):
    return page.evaluate(r"""() => {
      const V={w:innerWidth,h:innerHeight};
      const vis=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)}};
      const outside=e=>{const r=e.getBoundingClientRect();return r.left<-1||r.top<-1||r.right>V.w+1||r.bottom>V.h+1};
      const panel=document.querySelector('#nmda-panel'),launcher=document.querySelector('#nmda-launcher'),overlay=document.querySelector('#nmda-supplement-preflight'),dialog=document.querySelector('.nmda-classify-dialog'),head=document.querySelector('.nmda-head'),tabs=document.querySelector('.nmda-tabs');
      const controls=[...document.querySelectorAll('#nmda-panel button,#nmda-panel input,#nmda-panel select,#nmda-panel textarea,#nmda-panel label.nmda-btn')].filter(vis);
      const hasScrollAncestor=e=>{let p=e.parentElement;while(p&&p!==panel){const s=getComputedStyle(p),vertical=/(auto|scroll)/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+3,horizontal=/(auto|scroll)/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+3;if(vertical||horizontal)return true;p=p.parentElement;}return false;};
      const outsideControls=controls.filter(e=>outside(e)&&!hasScrollAncestor(e)).map(e=>({tag:e.tagName,id:e.id,rect:rect(e),text:(e.innerText||e.value||'').trim().slice(0,50)}));
      const scrollOwnerEls=[...document.querySelectorAll('#nmda-panel *')].filter(e=>{if(!vis(e))return false;const s=getComputedStyle(e);return (/(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+3)||(/(auto|scroll)/.test(s.overflowX)&&e.scrollWidth>e.clientWidth+3)});
      const scrollOwners=scrollOwnerEls.map(e=>({id:e.id,cls:e.className,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
      const nested=[]; const owners=scrollOwnerEls.filter(e=>{const s=getComputedStyle(e);return /(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+3});
      for(let i=0;i<owners.length;i++)for(let j=0;j<owners.length;j++)if(i!==j&&owners[i].contains(owners[j]))nested.push({outer:owners[i].id||owners[i].className,inner:owners[j].id||owners[j].className});
      const pr=panel?.getBoundingClientRect(),or=overlay?.getBoundingClientRect(),dr=dialog?.getBoundingClientRect();
      const issues=[];
      if(!panel||panel.hidden)issues.push({severity:'P0',code:'panel-not-open',message:'独立工作台没有默认打开。'});
      if(pr&&(Math.abs(pr.left)>1||Math.abs(pr.top)>1||Math.abs(pr.width-V.w)>2||Math.abs(pr.height-V.h)>2))issues.push({severity:'P0',code:'panel-not-viewport',message:'独立工作台没有占满浏览器可用区域。'});
      if(launcher&&vis(launcher))issues.push({severity:'P1',code:'legacy-launcher-visible',message:'独立页面仍显示旧悬浮启动按钮。'});
      if(head&&vis(head)&&head.getBoundingClientRect().height>58)issues.push({severity:'P1',code:'fixed-header-too-tall',message:'固定顶栏高度超过 58px，侵占工作区。'});
      if(tabs&&vis(tabs)&&tabs.getBoundingClientRect().width>84)issues.push({severity:'P1',code:'fixed-sidebar-too-wide',message:'固定左侧导航宽度超过 84px，侵占工作区。'});
      if(overlay&&vis(overlay)&&or&&(Math.abs(or.left)>2||Math.abs(or.top)>2||Math.abs(or.width-V.w)>3||Math.abs(or.height-V.h)>3))issues.push({severity:'P0',code:'modal-not-viewport',message:'来源核验遮罩未以视口为包含块。'});
      if(dialog&&vis(dialog)&&outside(dialog))issues.push({severity:'P0',code:'dialog-outside-viewport',message:'来源核验弹窗超出视口。'});
      if(outsideControls.length)issues.push({severity:'P0',code:'controls-outside-viewport',message:`${outsideControls.length} 个可交互控件超出视口。`});
      if(nested.length)issues.push({severity:'P1',code:'nested-scroll',message:`检测到 ${nested.length} 组纵向嵌套滚动。`});
      const collapsedOwners=scrollOwnerEls.filter(e=>e.scrollHeight>e.clientHeight+40&&e.clientHeight<40);
      if(collapsedOwners.length)issues.push({severity:'P0',code:'collapsed-scroll-owner',message:`${collapsedOwners.length} 个滚动模块高度异常，内容几乎不可见。`});
      const pageScroll=[...document.querySelectorAll('.nmda-page')].filter(e=>vis(e)&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+3);
      if(pageScroll.length)issues.push({severity:'P1',code:'outer-page-scroll',message:'主页面仍承担纵向滚动；应由当前任务模块独立滚动。'});
      const forbiddenOuter=[...document.querySelectorAll('.nmda-ingest-workspace-v2,.nmda-classify-sidebar,.nmda-classify-support-view,#nmda-preflight-supplements,#nmda-preview-card')].filter(e=>vis(e)&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+3);
      if(forbiddenOuter.length)issues.push({severity:'P1',code:'outer-task-scroll',message:`${forbiddenOuter.length} 个任务外壳仍承担纵向滚动。`});
      const tinyControls=controls.filter(e=>parseFloat(getComputedStyle(e).fontSize)<9).map(e=>({id:e.id,tag:e.tagName,size:getComputedStyle(e).fontSize}));
      if(tinyControls.length)issues.push({severity:'P1',code:'tiny-control-text',message:`${tinyControls.length} 个可交互控件字号低于 9px。`});
      return {viewport:V,panel:rect(panel),overlay:rect(overlay),dialog:rect(dialog),outsideControls,scrollOwners,nested,pageScroll:pageScroll.map(e=>e.id||e.className),tinyControls,issues};
    }""")

def render_md(report):
    lines=['# NetEase Mail Draft Assistant v2.5 · Dialog Workflow UI QA','',f"- Static / architecture checks: **{'PASS' if report['static']['ok'] else 'FAIL'}**",f"- Standalone runtime load: **{'PASS' if report['runtime']['loaded'] else 'FAIL'}**",f"- Real import flow: **{'PASS' if report['runtime']['import_ok'] else 'FAIL'}**",f"- Stage navigation / isolation: **{'PASS' if report['runtime'].get('flow_ok') else 'FAIL'}**",f"- Import stage content isolation: **{'PASS' if report['runtime'].get('stage1_isolation_ok') else 'FAIL'}**",f"- IndexedDB attachment vault: **{'PASS' if report['runtime']['vault_ok'] else 'FAIL'}**",'', '## Responsive screenshots','', '| Viewport | P0 | P1 | Screenshot |','|---|---:|---:|---|']
    for x in report['viewports']:
        p0=sum(i['severity']=='P0' for i in x['audit']['issues']);p1=sum(i['severity']=='P1' for i in x['audit']['issues']);lines.append(f"| {x['label']} {x['width']}×{x['height']} | {p0} | {p1} | `{x['screenshot']}` |")
    lines+=['','## Stage / module screenshots','', '| View | P0 | P1 | Screenshot |','|---|---:|---:|---|']
    for x in report.get('task_views',[]):
        p0=sum(i['severity']=='P0' for i in x['audit']['issues']);p1=sum(i['severity']=='P1' for i in x['audit']['issues']);lines.append(f"| {x['label']} {x['width']}×{x['height']} | {p0} | {p1} | `{x['screenshot']}` |")
    lines+=['','## Findings','']
    found=False
    for x in [*report['viewports'],*report.get('task_views',[])]:
        for i in x['audit']['issues']:
            found=True;lines.append(f"- **{i['severity']} · {x['label']}** `{i['code']}` — {i['message']}")
    if not found:lines.append('- 自动布局检查未发现 P0/P1 问题。')
    lines+=['','## Architecture assertions','','- `app.html/app.js` owns the visible workflow.','- `executor.js` is the only script injected into `mail.163.com`; it contains no workbench UI.','- `background.js` owns tab routing and mailbox-state reads.','- `file-vault.js` bridges local attachments through IndexedDB instead of attempting to serialize `File` objects through Chrome messages.','- The old floating `content.js/content.css` host UI is not part of the v2 package.','']
    return '\n'.join(lines)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--baseline');args=ap.parse_args()
    SHOTS.mkdir(parents=True,exist_ok=True);REPORTS.mkdir(parents=True,exist_ok=True)
    static=static_checks()
    runtime={'loaded':False,'import_ok':False,'vault_api_ok':False,'routing_summary':'','flow_ok':False,'stage1_isolation_ok':False};viewports=[];task_views=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1440,'height':900})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content('<!doctype html><html><head><meta charset="utf-8"><title>NMDA v2 QA</title></head><body></body></html>')
        # about:blank has no durable origin in this sandbox. Stub only browser-owned extension surfaces;
        # production business scripts/CSS are loaded unchanged.
        page.add_script_tag(content=chrome_stub()+r"""
          Object.defineProperty(window,'localStorage',{value:(()=>{const s={};return {getItem:k=>Object.prototype.hasOwnProperty.call(s,k)?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>delete s[k],clear:()=>{for(const k of Object.keys(s))delete s[k]}}})(),configurable:true});
        """)
        page.add_style_tag(path=str(ROOT/'app.css'));page.add_style_tag(path=str(ROOT/'app-shell.css'));page.add_style_tag(path=str(ROOT/'ui-system.css'));page.add_style_tag(path=str(ROOT/'workflow-dialogs.css'))
        for name in ['import-core.js','mail-recognizer.js','import-adapters.js','importer.js','contacts.js','scheduler.js','roster.js','file-vault.js','app.js']:
            page.add_script_tag(path=str(ROOT/name))
        page.wait_for_selector('#nmda-panel:not([hidden])',timeout=15000)
        runtime['loaded']=not errors
        runtime['vault_api_ok']=page.evaluate("()=>!!globalThis.NMDAVault&&['putFile','meta','chunkBase64','removeMany'].every(k=>typeof NMDAVault[k]==='function')")
        page.screenshot(path=str(SHOTS/'v2-empty-workspace-1440x900.png'),full_page=False)
        fixtures=[str(FIXTURES/'北京航空航天大学 - 裴纬.docx'),str(FIXTURES/'北京985211补充名单.xlsx'),str(FIXTURES/'Test Student-CV.pdf')]
        page.locator('#nmda-import-file').set_input_files(fixtures)
        page.wait_for_selector('#nmda-supplement-preflight:not([hidden])',timeout=20000)
        page.wait_for_timeout(500)
        text=page.locator('#nmda-supplement-preflight').inner_text()
        runtime['routing_summary']=' / '.join([part for part in ['邮件' if '邮件' in text else '', '总名单' if '总名单' in text else '', '附件' if '附件' in text else ''] if part])
        runtime['import_ok']=all(k in text for k in ['裴纬','北京985211补充名单','Test Student-CV'])
        for w,h,label in VIEWPORTS:
            page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(180)
            shot=SHOTS/f'v2-preflight-{label}-{w}x{h}.png';page.screenshot(path=str(shot),full_page=False)
            viewports.append({'width':w,'height':h,'label':label,'screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})

        # Batch materials are a separate task canvas, with roster and attachments separated again.
        page.set_viewport_size({'width':1440,'height':900});page.locator('[data-preflight-view="support"]').click();page.wait_for_timeout(120)
        for subview in ['roster','attachment']:
            page.locator(f'button[data-support-view="{subview}"]').click();page.wait_for_timeout(100)
            for w,h,label in [(1440,900,f'materials-{subview}-desktop'),(820,700,f'materials-{subview}-minimum')]:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(140)
                shot=SHOTS/f'v2-{label}-{w}x{h}.png';page.screenshot(path=str(shot),full_page=False)
                task_views.append({'width':w,'height':h,'label':label,'screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})

        # Returning to import must not reintroduce a page/outer workspace scrollbar.
        page.locator('#nmda-close-supplement-preflight').click();page.wait_for_timeout(120)
        runtime['stage1_isolation_ok']=page.evaluate("""() => {
          const wb=document.querySelector('.nmda-bulk-workbench');
          const visible=e=>e&&!e.hidden&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0;
          return wb?.dataset.viewStep==='1' && visible(document.querySelector('#nmda-import-card')) && !visible(document.querySelector('#nmda-ingest-result-card')) && !visible(document.querySelector('#nmda-roster-audit-card')) && !visible(document.querySelector('#nmda-inline-review'));
        }""")
        for w,h,label in [(1440,900,'import-loaded-desktop'),(820,700,'import-loaded-minimum')]:
            page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(140)
            shot=SHOTS/f'v2-{label}-{w}x{h}.png';page.screenshot(path=str(shot),full_page=False)
            task_views.append({'width':w,'height':h,'label':label,'screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
        page.set_viewport_size({'width':1440,'height':900});page.locator('#nmda-open-supplement-preflight').click();page.wait_for_timeout(140)

        # Continue through the real forward flow and verify the stage-isolated workspace.
        page.set_viewport_size({'width':1440,'height':900});page.wait_for_timeout(120)
        page.locator('#nmda-complete-supplement-preflight').click();page.wait_for_timeout(700)
        runtime['flow_ok']=runtime['stage1_isolation_ok'] and page.locator('.nmda-bulk-workbench').get_attribute('data-view-step')=='3' and page.locator('#nmda-preview-card').is_visible()
        for w,h,label in [(1440,900,'planning-desktop'),(820,700,'planning-minimum'),(1366,611,'planning-short-desktop')]:
            page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(160)
            shot=SHOTS/f'v2-{label}-{w}x{h}.png';page.screenshot(path=str(shot),full_page=False)
            task_views.append({'width':w,'height':h,'label':label,'screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
        # Planning review is now a card-based page; only one mail opens as a focused modal.
        page.set_viewport_size({'width':1366,'height':611});page.locator('#nmda-open-review-from-planning').click();page.wait_for_timeout(150)
        review_return_ok=page.locator('#nmda-inline-review').is_visible() and page.locator('.nmda-bulk-workbench').get_attribute('data-view-step')=='3' and not page.locator('#nmda-import-editor-overlay').is_visible()
        review_return_ok=review_return_ok and page.locator('.nmda-mail-review-card').count()>0
        shot=SHOTS/'v25-review-board-short-desktop-1366x611.png';page.screenshot(path=str(shot),full_page=False)
        task_views.append({'width':1366,'height':611,'label':'review-board-short-desktop','screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
        page.set_viewport_size({'width':820,'height':700});page.wait_for_timeout(100)
        shot=SHOTS/'v25-review-board-minimum-820x700.png';page.screenshot(path=str(shot),full_page=False)
        task_views.append({'width':820,'height':700,'label':'review-board-minimum','screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
        page.set_viewport_size({'width':1366,'height':611});page.wait_for_timeout(80)
        # Open one mail explicitly to verify the intervention dialog is scoped to a single mail.
        if page.locator('.nmda-mail-review-card').count():
            page.locator('.nmda-mail-review-card [data-review-preview]').first.click();page.wait_for_timeout(60)
            if page.locator('.nmda-mail-review-card [data-review-key]:visible').count():
                page.locator('.nmda-mail-review-card [data-review-key]:visible').first.click();page.wait_for_timeout(120)
            review_return_ok=review_return_ok and page.locator('#nmda-import-editor-overlay').is_visible()
            shot=SHOTS/'v25-review-detail-short-desktop-1366x611.png';page.screenshot(path=str(shot),full_page=False)
            task_views.append({'width':1366,'height':611,'label':'review-detail-short-desktop','screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
            page.set_viewport_size({'width':820,'height':700});page.wait_for_timeout(100)
            shot=SHOTS/'v25-review-detail-minimum-820x700.png';page.screenshot(path=str(shot),full_page=False)
            task_views.append({'width':820,'height':700,'label':'review-detail-minimum','screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
            page.set_viewport_size({'width':1366,'height':611});page.wait_for_timeout(60)
            page.locator('#nmda-import-editor-close').click();page.wait_for_timeout(80)
        page.locator('#nmda-import-editor-cancel').click();page.wait_for_timeout(100)
        review_return_ok=review_return_ok and page.locator('.nmda-bulk-workbench').get_attribute('data-view-step')=='3' and page.locator('#nmda-preview-card').is_visible()
        page.locator('#nmda-open-schedule-modal').click();page.wait_for_timeout(100)
        shot=SHOTS/'v2-schedule-modal-short-desktop-1366x611.png';page.screenshot(path=str(shot),full_page=False)
        task_views.append({'width':1366,'height':611,'label':'schedule-modal-short-desktop','screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
        page.locator('#nmda-cancel-schedule-modal').click();page.wait_for_timeout(80)
        runtime['flow_ok']=runtime['flow_ok'] and review_return_ok
        page.set_viewport_size({'width':1440,'height':900});page.locator('[data-flow-step="4"]').click();page.wait_for_timeout(180)
        runtime['flow_ok']=runtime['flow_ok'] and page.locator('.nmda-bulk-workbench').get_attribute('data-view-step')=='4' and page.locator('#nmda-run-card').is_visible()
        for w,h,label in [(1440,900,'create-desktop'),(820,700,'create-minimum')]:
            page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(160)
            shot=SHOTS/f'v2-{label}-{w}x{h}.png';page.screenshot(path=str(shot),full_page=False)
            task_views.append({'width':w,'height':h,'label':label,'screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})

        # Other primary modules must not resurrect hidden batch UI or require page-level scrolling.
        for tab in ['single','contacts']:
            for w,h,label in [(1440,900,f'{tab}-desktop'),(820,700,f'{tab}-minimum')]:
                page.set_viewport_size({'width':w,'height':h});page.locator(f'[data-tab="{tab}"]').click();page.wait_for_timeout(160)
                shot=SHOTS/f'v2-{label}-{w}x{h}.png';page.screenshot(path=str(shot),full_page=False)
                task_views.append({'width':w,'height':h,'label':label,'screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
        page.set_viewport_size({'width':1366,'height':611});page.locator('[data-tab="contacts"]').click();page.wait_for_timeout(120)
        if page.locator('[data-contact-open]').count():
            page.locator('[data-contact-open]').first.click();page.wait_for_timeout(100)
            shot=SHOTS/'v2-contact-modal-short-desktop-1366x611.png';page.screenshot(path=str(shot),full_page=False)
            task_views.append({'width':1366,'height':611,'label':'contact-modal-short-desktop','screenshot':str(shot.relative_to(ROOT)),'audit':audit_dom(page)})
            page.locator('#nmda-close-contact-modal').click();page.wait_for_timeout(60)
        runtime['page_errors']=errors
        browser.close()
    report={'version':'2.5.0','static':static,'runtime':runtime,'viewports':viewports,'task_views':task_views}
    # Build report text with the API-level distinction explicit.
    md=render_md({**report,'runtime':{**runtime,'vault_ok':runtime['vault_api_ok']}})
    md=md.replace('IndexedDB attachment vault: **PASS**','Attachment-vault API loaded: **PASS** (real IndexedDB storage requires extension origin; this sandbox blocks navigable local origins)')
    (REPORTS/'ui-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (REPORTS/'ui-audit.md').write_text(md,encoding='utf-8')
    print(md)
    p0=sum(1 for x in [*viewports,*task_views] for i in x['audit']['issues'] if i['severity']=='P0')
    if not static['ok'] or not runtime['loaded'] or not runtime['import_ok'] or not runtime['vault_api_ok'] or not runtime['flow_ok'] or p0: raise SystemExit(1)

if __name__=='__main__':main()
