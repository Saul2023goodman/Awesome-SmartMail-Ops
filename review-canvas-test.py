#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'vm-preview.html').read_text(encoding='utf-8')
html = re.sub(r'<link\s+rel="stylesheet"\s+href="content\.css"\s*/?>', '', html)
html = re.sub(r'\s*<script\s+src="[^"]+"></script>', '', html)
scripts = [
    ROOT / 'vm' / 'chrome-shim.js', ROOT / 'import-core.js', ROOT / 'mail-recognizer.js',
    ROOT / 'import-adapters.js', ROOT / 'importer.js', ROOT / 'contacts.js', ROOT / 'scheduler.js',
    ROOT / 'roster.js', ROOT / 'content.js', ROOT / 'vm' / 'preview-controller.js',
]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1366, 'height': 612})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html, wait_until='load')
    page.add_style_tag(content=(ROOT / 'content.css').read_text(encoding='utf-8'))
    page.evaluate("window.NMDA_VM_CONFIG={tab:'batch',sample:true,maximize:true,view:'browse53'}")
    for path in scripts:
        page.add_script_tag(content=path.read_text(encoding='utf-8'))
    page.wait_for_function("document.documentElement.dataset.nmdaVmReady === 'true'", timeout=20000)
    page.wait_for_timeout(500)

    def text(sel):
        return page.locator(sel).inner_text().strip()

    initial_position = text('#nmda-review-position')
    page.locator('#nmda-review-next').click()
    page.wait_for_timeout(80)
    next_position = text('#nmda-review-position')

    search = page.locator('#nmda-review-search')
    search.fill('Candidate 25')
    page.wait_for_timeout(120)
    queue_rows = page.locator('[data-review-row]').count()
    subject = page.locator('#nmda-import-edit-subject').input_value()

    search.fill('')
    page.wait_for_timeout(80)
    metrics = page.evaluate('''() => {
      const rect = sel => { const e=document.querySelector(sel); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
      const queue=document.querySelector('.nmda-review-queue');
      const body=document.querySelector('#nmda-import-edit-body');
      const actions=document.querySelector('#nmda-review-actions');
      const pageHead=document.querySelector('[data-page-head="batch"]');
      const more=document.querySelector('#nmda-review-more-menu');
      return {
        queueClientHeight:queue?.clientHeight||0,
        queueScrollHeight:queue?.scrollHeight||0,
        bodyRect:rect('#nmda-import-edit-body'),
        persistentActionVisible:!!actions && getComputedStyle(actions).display!=='none',
        pageHeadVisible:!!pageHead && getComputedStyle(pageHead).display!=='none',
        moreMenuOpen:!!more?.open,
        flowTitle:document.querySelector('.nmda-process-guide-title strong')?.textContent||'',
        workspaceTitle:document.querySelector('#nmda-review-workspace-title')?.textContent||'',
      };
    }''')
    metrics.update({
        'initialPosition': initial_position,
        'nextPosition': next_position,
        'searchRows': queue_rows,
        'searchSubject': subject,
        'pageErrors': errors,
    })

    assert initial_position == '1 / 53', metrics
    assert next_position == '2 / 53', metrics
    assert queue_rows == 1 and 'Candidate 25' in subject, metrics
    assert metrics['queueScrollHeight'] > metrics['queueClientHeight'], metrics
    assert metrics['bodyRect'] and metrics['bodyRect']['h'] >= 200, metrics
    assert not metrics['persistentActionVisible'], metrics
    assert not metrics['pageHeadVisible'], metrics
    assert metrics['flowTitle'] == '流程 3 / 4', metrics
    assert metrics['workspaceTitle'] == '查看邮件', metrics
    assert not errors, metrics

    out = ROOT / 'vm' / 'review-canvas-metrics.json'
    out.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')
    print('review canvas runtime OK')
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    browser.close()
