#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import re, json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'vm'/'screenshots'; OUT.mkdir(parents=True,exist_ok=True)
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
    page.locator('#nmda-import-file').set_input_files(str(ROOT/'vm'/'fixtures'/'clean-batch.csv'))
    page.wait_for_timeout(1100)
    active=page.locator('.nmda-process-guide [data-state="active"]').inner_text()
    assert '添加资料' in active,active
    assert page.locator('#nmda-supplement-preflight').is_visible()
    assert page.locator('#nmda-preflight-roster-box').is_visible()
    assert page.locator('#nmda-preflight-attachment-box').is_visible()
    assert not page.locator('#nmda-review-import-issues').is_visible()
    page.screenshot(path=str(OUT/'context-import-clean-v1.33.png'),full_page=True)

    page.click('#nmda-complete-supplement-preflight'); page.wait_for_timeout(1200)
    assert page.locator('#nmda-preview-card').is_visible(), 'selection did not open after explicit skip'
    active=page.locator('.nmda-process-guide [data-state="active"]').inner_text()
    assert '选择与安排' in active,active
    schedule_copy=page.locator('#nmda-schedule-context-copy').inner_text()
    create_copy=page.locator('#nmda-create-preflight').inner_text()
    assert '3 封' in schedule_copy,schedule_copy
    assert '已选 3 封' in create_copy,create_copy
    assert '不自动发送' in create_copy,create_copy
    page.screenshot(path=str(OUT/'context-selection-clean-v1.33.png'),full_page=True)

    page.fill('#nmda-rule-start-at','2026-09-03T07:30'); page.click('#nmda-apply-schedule'); page.wait_for_timeout(450)
    assert '定时 3 封' in page.locator('#nmda-create-preflight').inner_text()
    page.screenshot(path=str(OUT/'context-selection-scheduled-v1.33.png'),full_page=True)

    # New batch: verify uploading the recommended roster resolves the decision without making it mandatory.
    page.click('#nmda-reset-import'); page.wait_for_timeout(250)
    page.locator('#nmda-import-file').set_input_files(str(ROOT/'vm'/'fixtures'/'clean-batch.csv'))
    page.wait_for_timeout(950)
    assert page.locator('#nmda-supplement-preflight').is_visible()
    page.locator('#nmda-roster-file').set_input_files(str(ROOT/'vm'/'fixtures'/'reference-roster.csv'))
    page.wait_for_timeout(1300)
    assert page.locator('#nmda-preflight-roster-box').get_attribute('data-state')=='added'
    assert '4 条' in page.locator('#nmda-preflight-roster-title').inner_text()
    page.click('#nmda-complete-supplement-preflight'); page.wait_for_timeout(700)
    print(json.dumps({'rosterPrompt':'dialog pending->skipped/added','scheduleCopy':schedule_copy,'createPreflight':create_copy,'pageErrors':errors},ensure_ascii=False))
    if errors: raise SystemExit(2)
    browser.close()
