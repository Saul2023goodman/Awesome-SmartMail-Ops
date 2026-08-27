#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse, json, re

ROOT = Path(__file__).resolve().parents[1]

parser = argparse.ArgumentParser(description='Capture deterministic NMDA VM UI screenshots.')
parser.add_argument('--tab', choices=['batch','single','contacts'], default='batch')
parser.add_argument('--sample', action='store_true', help='Import a deterministic pasted-email sample on the batch tab.')
parser.add_argument('--view', choices=['base','review','selection','duplicate','browse53'], default='base', help='Batch UI state to capture after sample import.')
parser.add_argument('--no-max', action='store_true', help='Keep the panel in floating mode instead of maximized mode.')
parser.add_argument('--width', type=int, default=1600)
parser.add_argument('--height', type=int, default=1100)
parser.add_argument('--output', default=str(ROOT / 'vm' / 'screenshots' / 'batch.png'))
args = parser.parse_args()

out = Path(args.output).resolve()
out.parent.mkdir(parents=True, exist_ok=True)

# The execution environment may block navigation to localhost/file:// URLs.
# Build the page through set_content and inject the exact production sources
# in dependency order. This keeps the screenshot deterministic and still runs
# the same UI/business code as the extension.
html = (ROOT / 'vm-preview.html').read_text(encoding='utf-8')
html = re.sub(r'<link\s+rel="stylesheet"\s+href="content\.css"\s*/?>', '', html)
html = re.sub(r'\s*<script\s+src="[^"]+"></script>', '', html)

scripts = [
    ROOT / 'vm' / 'chrome-shim.js',
    ROOT / 'import-core.js',
    ROOT / 'mail-recognizer.js',
    ROOT / 'import-adapters.js',
    ROOT / 'importer.js',
    ROOT / 'contacts.js',
    ROOT / 'scheduler.js',
    ROOT / 'roster.js',
    ROOT / 'content.js',
    ROOT / 'vm' / 'preview-controller.js',
]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': args.width, 'height': args.height}, device_scale_factor=1)
    page_errors = []
    console_errors = []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
    page.set_content(html, wait_until='load')
    page.add_style_tag(content=(ROOT / 'content.css').read_text(encoding='utf-8'))
    page.evaluate("cfg => window.NMDA_VM_CONFIG = cfg", {
        'tab': args.tab,
        'sample': args.sample,
        'maximize': not args.no_max,
        'view': args.view,
    })
    for path in scripts:
        page.add_script_tag(content=path.read_text(encoding='utf-8'))
    page.wait_for_function("document.documentElement.dataset.nmdaVmReady === 'true'", timeout=20000)
    page.wait_for_timeout(1400 if args.sample else 700)
    page.screenshot(path=str(out), full_page=True)
    print(f'captured: {out}')
    print(f'viewport: {args.width}x{args.height}; tab={args.tab}; sample={args.sample}; view={args.view}; maximized={not args.no_max}')
    if page_errors or console_errors:
        if page_errors:
            print('page errors:')
            for error in page_errors: print(' -', error)
        if console_errors:
            print('console errors:')
            for error in console_errors: print(' -', error)
        raise SystemExit(2)
    browser.close()
