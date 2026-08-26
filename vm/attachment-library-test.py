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
fixtures=[ROOT/'vm'/'fixtures'/'CV-Alice.pdf',ROOT/'vm'/'fixtures'/'CV-Erin.pdf',ROOT/'vm'/'fixtures'/'Transcript-Erin.pdf']
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1366,'height':768},device_scale_factor=1)
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load'); page.add_style_tag(content=(ROOT/'content.css').read_text())
    page.evaluate("window.NMDA_VM_CONFIG={tab:'batch',maximize:true,sample:false,view:'base'}")
    for path in scripts: page.add_script_tag(content=path.read_text())
    page.click('#nmda-launcher'); page.click('#nmda-expand')
    page.locator('#nmda-import-file').set_input_files(str(ROOT/'vm'/'fixtures'/'complex-batch.txt'))
    page.wait_for_timeout(1200)
    assert page.locator('#nmda-supplement-preflight').is_visible()
    page.locator('#nmda-attachment-files').set_input_files([str(x) for x in fixtures])
    page.wait_for_timeout(900)
    assert page.locator('#nmda-preflight-attachment-assets').is_visible()
    text=page.locator('#nmda-preflight-attachment-assets-list').inner_text()
    for name in ['CV-Alice.pdf','CV-Erin.pdf','Transcript-Erin.pdf']:
        assert name in text,text
    page.screenshot(path=str(OUT/'attachment-library-preflight-v1.34.png'),full_page=True)

    # Remove one file directly from the preflight list; the common asset source must update.
    row=page.locator('.nmda-attachment-asset-row',has_text='CV-Alice.pdf').first
    row.locator('[data-attachment-remove]').click(); page.wait_for_timeout(700)
    assert 'CV-Alice.pdf' not in page.locator('#nmda-preflight-attachment-assets-list').inner_text()
    assert '2 个' in page.locator('#nmda-preflight-attachment-assets-count').inner_text()
    # Add it back and complete preparation.
    page.locator('#nmda-attachment-files').set_input_files(str(fixtures[0])); page.wait_for_timeout(650)
    assert '3 个' in page.locator('#nmda-preflight-attachment-assets-count').inner_text()
    page.click('#nmda-complete-supplement-preflight'); page.wait_for_timeout(850)

    # The upload page keeps a direct management entry and opens the same underlying asset library.
    strip=page.locator('#nmda-prep-attachment-state')
    assert '3 个附件' in strip.inner_text(),strip.inner_text()
    page.screenshot(path=str(OUT/'attachment-library-persistent-v1.34.png'),full_page=True)
    page.click('#nmda-manage-attachments-strip'); page.wait_for_timeout(250)
    assert page.locator('#nmda-attachment-manager-overlay').is_visible()
    manager_text=page.locator('#nmda-attachment-manager-list').inner_text()
    for name in ['CV-Alice.pdf','CV-Erin.pdf','Transcript-Erin.pdf']:
        assert name in manager_text,manager_text
    page.screenshot(path=str(OUT/'attachment-library-manager-v1.34.png'),full_page=True)
    page.click('#nmda-attachment-manager-done')
    assert not page.locator('#nmda-attachment-manager-overlay').is_visible()
    print(json.dumps({'attachments':3,'preflightVisible':True,'persistentManager':True,'pageErrors':errors},ensure_ascii=False))
    if errors: raise SystemExit(2)
    browser.close()
