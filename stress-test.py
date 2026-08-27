#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re, time

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'vm'/'stress-after'
OUT.mkdir(parents=True, exist_ok=True)

STRESS_TEXT='''Professor Alice Chen — alice.chen@example.edu
University Alpha
Subject: PhD inquiry — reliable AI

Dear Professor Chen,
I am writing to inquire about doctoral opportunities. My recent work focuses on reliable clinical AI and robust evaluation across complex datasets. I would welcome the opportunity to discuss fit with your group.

Best regards,
Yohan

Professor Alice Chen — alice.chen@example.edu
University Alpha
Subject: Follow-up materials

Dear Professor Chen,
I am sending an updated version of my research inquiry with additional project details. This is intentionally a second email candidate to test duplicate handling and content comparison in the workflow.

Best regards,
Yohan
Attachments: CV-Alice.pdf

Professor Bob Li — bob.li@example.edu
University Beta

Dear Professor Li,
I am writing to inquire about potential doctoral opportunities in your group. My background includes quantitative research and I hope to explore related projects under your supervision.

Best regards,
Yohan

Professor Carol Wu
carol.wu@example.edu
carol.lab@example.edu
University Gamma
Subject: Prospective doctoral inquiry

Dear Professor Wu,
I am writing to inquire about doctoral opportunities in your group. This message intentionally has two plausible recipient addresses nearby so that the review flow must help the user select the correct one.

Best regards,
Yohan

Professor David Kim — david.kim@example.edu
University Alpha
Subject: PhD inquiry

Dear Professor Kim,
I am writing to inquire about doctoral opportunities in your group. This email intentionally includes an invalid imported schedule after the signature so the workflow can defer timing to scheduling instead of blocking content review.

Best regards,
Yohan
Scheduled time: next Thursday morning

Professor Erin Zhao — erin.zhao@example.edu
University Delta
Subject: PhD inquiry

Dear Professor Zhao,
Please find attached my CV and transcript. I am writing to inquire about doctoral opportunities and would appreciate the opportunity to discuss how my background may fit your current projects.

Best regards,
Yohan
Attachments: CV-Erin.pdf; Transcript-Erin.pdf'''

html=(ROOT/'vm-preview.html').read_text(encoding='utf-8')
html=re.sub(r'<link\s+rel="stylesheet"\s+href="content\.css"\s*/?>','',html)
html=re.sub(r'\s*<script\s+src="[^"]+"></script>','',html)
scripts=[ROOT/'vm'/'chrome-shim.js',ROOT/'import-core.js',ROOT/'mail-recognizer.js',ROOT/'import-adapters.js',ROOT/'importer.js',ROOT/'contacts.js',ROOT/'scheduler.js',ROOT/'roster.js',ROOT/'content.js']

def metrics(page,label):
    data=page.evaluate('''label=>{
      const main=document.querySelector('.nmda-tabpane[data-pane="batch"]');
      const guide=document.querySelector('.nmda-process-guide');
      const active=document.querySelector('.nmda-process-guide [data-state="active"]');
      const primary=[...document.querySelectorAll('.nmda-btn-primary')].filter(el=>!el.hidden && el.offsetParent!==null).map(el=>({text:el.textContent.trim(),top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}));
      const viewH=innerHeight;
      const visiblePrimary=primary.filter(x=>x.top>=0&&x.bottom<=viewH).map(x=>x.text);
      const cards=[...document.querySelectorAll('.nmda-card')].filter(el=>!el.hidden&&el.offsetParent!==null).length;
      const pending=document.querySelector('#nmda-review-page-summary')?.innerText||'';
      return {label,scrollTop:main?.scrollTop||0,scrollHeight:main?.scrollHeight||0,clientHeight:main?.clientHeight||0,activeStep:active?.innerText?.replace(/\s+/g,' ').trim()||'',visiblePrimary,allPrimary:primary.map(x=>x.text),cards,pending,bodyHeight:document.body.scrollHeight};
    }''',label)
    print(json.dumps(data,ensure_ascii=False))
    return data

def snap(page,name):
    page.screenshot(path=str(OUT/f'{name}.png'),full_page=True)
    metrics(page,name)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1366,'height':768},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load')
    page.add_style_tag(content=(ROOT/'content.css').read_text(encoding='utf-8'))
    page.evaluate("window.NMDA_VM_CONFIG={tab:'batch',maximize:true,sample:false,view:'base'}")
    for path in scripts: page.add_script_tag(content=path.read_text(encoding='utf-8'))
    page.wait_for_selector('#nmda-launcher')
    page.click('#nmda-launcher')
    if not page.locator('#nmda-panel').evaluate("el=>el.classList.contains('is-maximized')"):
        page.click('#nmda-expand')
    snap(page,'00-empty')

    page.click('#nmda-show-paste')
    page.fill('#nmda-paste-source',STRESS_TEXT)
    page.click('#nmda-paste-import')
    page.wait_for_timeout(1200)
    snap(page,'01-complex-import')

    # Open review and inspect the initial workload.
    if page.locator('#nmda-review-import-issues').is_visible(): page.click('#nmda-review-import-issues')
    page.wait_for_timeout(500)
    snap(page,'02-review-start')

    # Create an exact duplicate by assigning the second mail to Alice if it is the empty recipient row.
    rows=page.locator('[data-review-key]')
    for i in range(min(rows.count(),8)):
        rows.nth(i).click(); page.wait_for_timeout(120)
        subj=page.input_value('#nmda-import-edit-subject')
        recipient=page.input_value('#nmda-import-edit-recipients')
        body=page.input_value('#nmda-import-edit-body')
        if subj=='Follow-up materials' and not recipient:
            page.fill('#nmda-import-edit-recipients','alice.chen@example.edu')
            page.dispatch_event('#nmda-import-edit-recipients','change')
            page.wait_for_timeout(500)
            break
    snap(page,'03-duplicate-emerges')

    # Deliberately navigate around without resolving to expose scroll/context issues.
    rows=page.locator('[data-review-key]')
    if rows.count()>2:
        rows.nth(min(2,rows.count()-1)).click(); page.wait_for_timeout(200)
    snap(page,'04-switch-issue')

    # Scroll deep in body to see whether decision/action context is lost.
    page.evaluate('document.querySelector(\'.nmda-tabpane[data-pane="batch"]\').scrollTop=document.querySelector(\'.nmda-tabpane[data-pane="batch"]\').scrollHeight')
    page.wait_for_timeout(200)
    snap(page,'05-review-bottom')

    # Return to top and capture current issue/action landscape.
    page.evaluate('document.querySelector(\'.nmda-tabpane[data-pane="batch"]\').scrollTop=0')
    page.wait_for_timeout(200)
    snap(page,'06-review-top-return')

    print('page_errors',errors)
    browser.close()
