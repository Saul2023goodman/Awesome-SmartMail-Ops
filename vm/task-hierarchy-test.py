#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import re,json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'vm'/'screenshots'; OUT.mkdir(parents=True,exist_ok=True)
TEXT=(ROOT/'vm'/'fixtures'/'complex-batch.txt').read_text()
html=(ROOT/'vm-preview.html').read_text(encoding='utf-8')
html=re.sub(r'<link\s+rel="stylesheet"\s+href="content\.css"\s*/?>','',html)
html=re.sub(r'\s*<script\s+src="[^"]+"></script>','',html)
scripts=[ROOT/'vm'/'chrome-shim.js',ROOT/'import-core.js',ROOT/'mail-recognizer.js',ROOT/'import-adapters.js',ROOT/'importer.js',ROOT/'contacts.js',ROOT/'scheduler.js',ROOT/'roster.js',ROOT/'content.js']
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1366,'height':768},device_scale_factor=1)
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load'); page.add_style_tag(content=(ROOT/'content.css').read_text())
    page.evaluate("window.NMDA_VM_CONFIG={tab:'batch',maximize:true,sample:false,view:'base'}")
    for path in scripts: page.add_script_tag(content=path.read_text())
    page.click('#nmda-launcher'); page.click('#nmda-expand')
    page.click('#nmda-show-paste'); page.fill('#nmda-paste-source',TEXT); page.click('#nmda-paste-import'); page.wait_for_timeout(900)
    # Step 1: optional roster preflight should be lightweight.
    page.screenshot(path=str(OUT/'task-hierarchy-roster-v1.32.png'),full_page=True)
    if page.locator('#nmda-roster-skip').is_visible():
        page.click('#nmda-roster-skip'); page.wait_for_timeout(500)
    # Step 2: actual blockers should become the visual priority.
    page.screenshot(path=str(OUT/'task-hierarchy-todos-v1.32.png'),full_page=True)
    metrics=page.evaluate('''()=>({
      active:document.querySelector('.nmda-process-guide [data-state="active"]')?.innerText.replace(/\s+/g,' ').trim(),
      sourceOpen:document.querySelector('.nmda-source-inventory-details')?.open||false,
      rosterState:document.querySelector('#nmda-roster-context-cue')?.dataset.state,
      attachmentVisible:!!(document.querySelector('#nmda-attachment-context-cue')?.offsetParent),
      attachmentTitle:document.querySelector('#nmda-attachment-context-title')?.textContent,
      attachmentLaterHidden:document.querySelector('#nmda-attachment-later')?.hidden,
      importText:document.querySelector('#nmda-import-format-info')?.textContent,
      statusText:document.querySelector('#nmda-import-status')?.textContent,
      pageErrors:%s
    })''' % json.dumps(errors))
    print(json.dumps(metrics,ensure_ascii=False,indent=2))
    if errors: raise SystemExit(2)
    if metrics['sourceOpen']: raise SystemExit('import detail must default closed')
    if not metrics['attachmentVisible']: raise SystemExit('attachment blocker should be visible in step 2')
    if '附件待补' not in metrics['attachmentTitle']: raise SystemExit('attachment blocker title should be task-oriented')
    browser.close()
