#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'vm-preview.html').read_text(encoding='utf-8')
html=re.sub(r'<link\s+rel="stylesheet"\s+href="content\.css"\s*/?>','',html)
html=re.sub(r'\s*<script\s+src="[^"]+"></script>','',html)
scripts=[ROOT/'vm'/'chrome-shim.js',ROOT/'import-core.js',ROOT/'mail-recognizer.js',ROOT/'import-adapters.js',ROOT/'importer.js',ROOT/'contacts.js',ROOT/'scheduler.js',ROOT/'roster.js',ROOT/'content.js',ROOT/'vm'/'preview-controller.js']
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1366,'height':768},device_scale_factor=1)
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load'); page.add_style_tag(content=(ROOT/'content.css').read_text(encoding='utf-8'))
    page.evaluate("window.NMDA_VM_CONFIG={tab:'batch',sample:true,maximize:true,view:'duplicate'}")
    for path in scripts: page.add_script_tag(content=path.read_text(encoding='utf-8'))
    page.wait_for_function("document.documentElement.dataset.nmdaVmReady === 'true'",timeout=20000); page.wait_for_timeout(500)

    cards=page.locator('.nmda-duplicate-candidate')
    assert cards.count()>=3, cards.count()
    assert page.locator('.nmda-duplicate-preview-body').count()==cards.count()
    assert page.locator('#nmda-review-evidence-details').count()==0
    assert page.locator('#nmda-review-more-menu').count()==0
    assert page.locator('#nmda-review-exclude').is_visible()
    assert page.locator('#nmda-review-exclude').inner_text().strip()=='排除此封'

    checks=page.locator('input[data-duplicate-pick]')
    assert checks.count()==cards.count()
    initially=sum(1 for i in range(checks.count()) if checks.nth(i).is_checked())
    assert initially==1, initially
    checks.nth(1).check(); page.wait_for_timeout(80)
    assert page.locator('#nmda-duplicate-keep-selected').inner_text().strip()=='保留所选（2）'
    page.locator('[data-duplicate-open]').nth(1).click(); page.wait_for_timeout(180)
    checks=page.locator('input[data-duplicate-pick]')
    after_edit=sum(1 for i in range(checks.count()) if checks.nth(i).is_checked())
    assert after_edit==2, after_edit
    assert cards.count()>=3
    page.locator('#nmda-duplicate-keep-selected').click(); page.wait_for_timeout(350)
    restore=page.locator('#nmda-restore-excluded').inner_text().strip()
    assert '1' in restore, restore
    assert not errors, errors
    metrics={'candidateCount':cards.count(),'initialSelected':initially,'selectedAfterEdit':after_edit,'restoreText':restore,'pageErrors':errors}
    (ROOT/'vm'/'decision-canvas-metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
    print('decision canvas runtime OK')
    print(json.dumps(metrics,ensure_ascii=False,indent=2))
    browser.close()
