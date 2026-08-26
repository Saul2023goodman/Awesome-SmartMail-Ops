#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'vm'/'journey-after'; OUT.mkdir(parents=True,exist_ok=True)
TEXT=(ROOT/'vm'/'fixtures'/'complex-batch.txt').read_text()
html=(ROOT/'vm-preview.html').read_text(encoding='utf-8')
html=re.sub(r'<link\s+rel="stylesheet"\s+href="content\.css"\s*/?>','',html)
html=re.sub(r'\s*<script\s+src="[^"]+"></script>','',html)
scripts=[ROOT/'vm'/'chrome-shim.js',ROOT/'import-core.js',ROOT/'mail-recognizer.js',ROOT/'import-adapters.js',ROOT/'importer.js',ROOT/'contacts.js',ROOT/'scheduler.js',ROOT/'roster.js',ROOT/'content.js']
log=[]
def state(page,label):
    d=page.evaluate('''label=>{const pane=document.querySelector('.nmda-tabpane[data-pane="batch"]');const active=document.querySelector('.nmda-process-guide [data-state="active"]');const ready=[...document.querySelectorAll('.nmda-process-guide [data-state="ready"]')].map(x=>x.innerText.replace(/\s+/g,' ').trim());const primary=[...document.querySelectorAll('.nmda-btn-primary')].filter(el=>!el.hidden&&el.offsetParent!==null).map(el=>({text:el.textContent.trim(),visible:(()=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()}));return{label,scrollTop:pane?.scrollTop||0,scrollHeight:pane?.scrollHeight||0,clientHeight:pane?.clientHeight||0,activeStep:active?.innerText.replace(/\s+/g,' ').trim()||'',readySteps:ready,primary,reviewSummary:document.querySelector('#nmda-review-page-summary')?.innerText.replace(/\s+/g,' ').trim()||'',attachmentSummary:document.querySelector('#nmda-attachment-summary')?.innerText.replace(/\s+/g,' ').trim()||'',batchSummary:document.querySelector('#nmda-batch-summary')?.innerText.replace(/\s+/g,' ').trim()||''};}''',label)
    log.append(d); print(json.dumps(d,ensure_ascii=False)); return d
def snap(page,name): page.screenshot(path=str(OUT/f'{name}.png'),full_page=True); state(page,name)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1366,'height':768},device_scale_factor=1)
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load'); page.add_style_tag(content=(ROOT/'content.css').read_text())
    page.evaluate("window.NMDA_VM_CONFIG={tab:'batch',maximize:true,sample:false,view:'base'}")
    for path in scripts: page.add_script_tag(content=path.read_text())
    page.click('#nmda-launcher'); page.click('#nmda-expand');
    page.click('#nmda-show-paste'); page.fill('#nmda-paste-source',TEXT); page.click('#nmda-paste-import'); page.wait_for_timeout(1000)
    snap(page,'01-imported')
    if page.locator('#nmda-roster-skip').is_visible():
        page.click('#nmda-roster-skip'); page.wait_for_timeout(450)
    page.click('#nmda-review-import-issues'); page.wait_for_timeout(300); snap(page,'02-todos-start')

    # Resolve the mail todo queue like a normal user: fix required fields, then make explicit judgments.
    for turn in range(30):
        if not page.locator('#nmda-inline-review').is_visible(): break
        if page.locator('#nmda-duplicate-decision').is_visible():
            snap(page,f'03-duplicate-decision-{turn:02d}') if not any(x.name.startswith('03-duplicate') for x in OUT.glob('*.png')) else None
            page.click('#nmda-duplicate-keep-selected'); page.wait_for_timeout(260); continue
        if not page.locator('#nmda-import-editor-overlay').is_visible():
            if page.locator('#nmda-review-next-pending').is_visible(): page.click('#nmda-review-next-pending'); page.wait_for_timeout(160); continue
            break
        recipient_issue=page.locator('#nmda-review-field-recipients').get_attribute('data-issue')=='1'
        subject_issue=page.locator('#nmda-review-field-subject').get_attribute('data-issue')=='1'
        body_issue=page.locator('#nmda-review-field-body').get_attribute('data-issue')=='1'
        if recipient_issue:
            assist=page.locator('#nmda-recipient-assist button')
            current=page.input_value('#nmda-import-edit-recipients').strip()
            if assist.count():
                assist.first.click(); page.wait_for_timeout(280); continue
            if not current:
                title=page.input_value('#nmda-import-edit-subject')
                fallback='david.kim@example.edu' if 'PhD inquiry' in title else 'resolved@example.edu'
                page.fill('#nmda-import-edit-recipients',fallback); page.dispatch_event('#nmda-import-edit-recipients','change'); page.wait_for_timeout(280); continue
            # Recipient is present but still flagged: this is a judgment call, not another edit.
            if page.locator('#nmda-import-editor-next').is_visible(): page.click('#nmda-import-editor-next'); page.wait_for_timeout(260); continue
        if subject_issue:
            current=page.input_value('#nmda-import-edit-subject').strip()
            if not current:
                page.fill('#nmda-import-edit-subject','Prospective PhD inquiry'); page.dispatch_event('#nmda-import-edit-subject','change'); page.wait_for_timeout(800)
                if page.locator('#nmda-subject-assist').is_visible(): page.click('#nmda-subject-assist-dismiss'); page.wait_for_timeout(220)
                continue
            if page.locator('#nmda-import-editor-next').is_visible(): page.click('#nmda-import-editor-next'); page.wait_for_timeout(260); continue
        if body_issue:
            current=page.input_value('#nmda-import-edit-body').strip()
            if len(current)<40:
                page.fill('#nmda-import-edit-body','Dear Professor,\n\nI am writing to inquire about doctoral opportunities and would welcome the opportunity to discuss research fit.\n\nBest regards,\nYohan'); page.dispatch_event('#nmda-import-edit-body','change'); page.wait_for_timeout(260); continue
            # A populated body marked for review means the user must judge/confirm it, not rewrite it repeatedly.
            if page.locator('#nmda-import-editor-next').is_visible(): page.click('#nmda-import-editor-next'); page.wait_for_timeout(260); continue
        if page.locator('#nmda-import-editor-next').is_visible(): page.click('#nmda-import-editor-next'); page.wait_for_timeout(260); continue
        if page.locator('#nmda-import-editor-save').is_visible(): page.click('#nmda-import-editor-save'); page.wait_for_timeout(260); continue
        if page.locator('#nmda-review-next-pending').is_visible(): page.click('#nmda-review-next-pending'); page.wait_for_timeout(220); continue
        break

    snap(page,'04-mail-todos-resolved')
    # Attachment stage should now become the only todo and open itself.
    if page.locator('#nmda-attachments-card').is_visible():
        if not page.locator('#nmda-attachments-card').evaluate('el=>el.open'): page.locator('#nmda-attachments-card summary').click()
        page.locator('#nmda-attachment-files').set_input_files([str(ROOT/'vm'/'fixtures'/'CV-Alice.pdf'),str(ROOT/'vm'/'fixtures'/'CV-Erin.pdf'),str(ROOT/'vm'/'fixtures'/'Transcript-Erin.pdf')])
        page.wait_for_timeout(900)
    snap(page,'05-attachments-resolved-selection')

    # Selection stage: apply schedule, then verify create stays visible while table is scrolled.
    if page.locator('#nmda-preview-card').is_visible():
        page.fill('#nmda-rule-start-at','2026-09-03T07:30'); page.click('#nmda-apply-schedule'); page.wait_for_timeout(350); snap(page,'06-selection-scheduled')
        page.locator('.nmda-batch-table-wrap').evaluate('el=>el.scrollTop=el.scrollHeight'); page.wait_for_timeout(120); snap(page,'07-selection-table-bottom')
    Path(OUT/'journey-log.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
    print('page_errors',errors)
    if errors: raise SystemExit(2)
    browser.close()
