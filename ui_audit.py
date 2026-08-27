#!/usr/bin/env python3
"""Automated UI smoke/audit runner for NetEase Mail Draft Assistant.

Runs the *production* content scripts and stylesheet in a controlled Chromium page,
then drives the real import flow with generated fixtures. No production business
logic or manifest permissions are changed.

Outputs:
  qa/screenshots/*.png
  qa/reports/ui-audit.json
  qa/reports/ui-audit.md

Optional visual comparison:
  python3 qa/ui_audit.py --baseline /path/to/old/screenshots
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "qa"
FIXTURES = QA / "fixtures"
SHOTS = QA / "screenshots"
REPORTS = QA / "reports"
SCRIPTS = [
    "import-core.js", "mail-recognizer.js", "import-adapters.js", "importer.js",
    "contacts.js", "scheduler.js", "roster.js", "content.js",
]
VIEWPORTS = [
    (1440, 900, "desktop-wide"),
    (1280, 800, "desktop"),
    (1100, 760, "compact"),
    (920, 720, "narrow"),
    (820, 700, "minimum"),
]


def ensure_dirs() -> None:
    for p in (FIXTURES, SHOTS, REPORTS):
        p.mkdir(parents=True, exist_ok=True)


def run_static_checks() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for name in ["background.js", *SCRIPTS]:
        proc = subprocess.run(["node", "--check", str(ROOT / name)], capture_output=True, text=True)
        checks.append({"name": f"node --check {name}", "ok": proc.returncode == 0, "output": (proc.stderr or proc.stdout).strip()})
    proc = subprocess.run(["node", str(ROOT / "tests/source-role-regression.js")], cwd=ROOT, capture_output=True, text=True)
    checks.append({"name": "source-role regression", "ok": proc.returncode == 0, "output": (proc.stdout + proc.stderr).strip()})
    return {"checks": checks, "ok": all(x["ok"] for x in checks)}


def qa_chrome_stub() -> str:
    return r"""
    (() => {
      const store = {};
      globalThis.chrome = {
        runtime: {
          sendMessage: async () => ({ok:false, reason:'qa-controlled-host'}),
          onMessage: { addListener: () => {} }
        },
        storage: {
          local: {
            get: async (k) => {
              if (typeof k === 'string') return {[k]: store[k]};
              if (Array.isArray(k)) return Object.fromEntries(k.map(x => [x, store[x]]));
              return {...store};
            },
            set: async (obj) => { Object.assign(store, obj || {}); }
          }
        },
        scripting: { executeScript: async () => [] }
      };
    })();
    """


def audit_dom(page) -> dict[str, Any]:
    return page.evaluate(r"""
    () => {
      const V = {w: innerWidth, h: innerHeight};
      const visible = el => {
        if (!el) return false;
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0 && r.width > 0 && r.height > 0;
      };
      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1)};
      };
      const name = el => {
        if (!el) return '';
        const id = el.id ? `#${el.id}` : '';
        const cls = [...el.classList].slice(0,3).map(c=>`.`+c).join('');
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };
      const outsideViewport = el => {
        const r=el.getBoundingClientRect();
        return r.left < -1 || r.top < -1 || r.right > V.w+1 || r.bottom > V.h+1;
      };
      const overlay = document.querySelector('#nmda-supplement-preflight');
      const dialog = document.querySelector('.nmda-classify-dialog');
      const panel = document.querySelector('#nmda-panel');
      const footer = document.querySelector('.nmda-classify-foot');
      const chips = document.querySelector('#nmda-preflight-routing-chips');
      const main = document.querySelector('.nmda-classify-main');
      const list = document.querySelector('.nmda-classify-file-list');
      const inspector = document.querySelector('.nmda-classify-inspector-pane');
      const sidebar = document.querySelector('.nmda-classify-sidebar');

      const key = {};
      for (const [k,el] of Object.entries({panel,overlay,dialog,footer,chips,main,list,inspector,sidebar})) {
        key[k] = el ? {
          visible: visible(el), rect: rect(el), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth,
          scrollHeight:el.scrollHeight, clientHeight:el.clientHeight,
          overflowX:getComputedStyle(el).overflowX, overflowY:getComputedStyle(el).overflowY,
          outside: visible(el) && outsideViewport(el)
        } : null;
      }

      const scrollOwners = dialog ? [...dialog.querySelectorAll('*')].filter(el => {
        if (!visible(el)) return false;
        const s=getComputedStyle(el);
        return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 3;
      }).map(el=>({name:name(el),rect:rect(el),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight})) : [];

      const nestedScroll = [];
      if (dialog) {
        const owners=[...dialog.querySelectorAll('*')].filter(el=>visible(el) && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight>el.clientHeight+3);
        for(let i=0;i<owners.length;i++) for(let j=0;j<owners.length;j++) if(i!==j && owners[i].contains(owners[j])) {
          nestedScroll.push({outer:name(owners[i]),inner:name(owners[j])});
        }
      }

      const controls = dialog ? [...dialog.querySelectorAll('button,input,select,textarea,label.nmda-btn')].filter(visible) : [];
      const outsideControls = controls.filter(outsideViewport).map(el=>({name:name(el),text:(el.innerText||el.value||'').trim().slice(0,60),rect:rect(el)}));
      const overlaps=[];
      for(let i=0;i<controls.length;i++) for(let j=i+1;j<controls.length;j++) {
        const a=controls[i],b=controls[j];
        if(a.contains(b)||b.contains(a)) continue;
        const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
        const iw=Math.max(0,Math.min(ar.right,br.right)-Math.max(ar.left,br.left));
        const ih=Math.max(0,Math.min(ar.bottom,br.bottom)-Math.max(ar.top,br.top));
        const area=iw*ih;
        if(area>18 && area/Math.min(ar.width*ar.height,br.width*br.height)>.18) overlaps.push({a:name(a),b:name(b),area:+area.toFixed(1)});
      }

      const suspiciousClip = dialog ? [...dialog.querySelectorAll('*')].filter(el=>{
        if(!visible(el) || el.classList.contains('sr-only') || !((el.childNodes?.length||0)>0)) return false;
        const s=getComputedStyle(el);
        const horizontal=el.scrollWidth>el.clientWidth+4;
        if(!horizontal) return false;
        if(/(auto|scroll)/.test(s.overflowX)) return false;
        if(s.textOverflow==='ellipsis') return false;
        if(el.querySelector('input,select,textarea')) return false;
        return /(hidden|clip)/.test(s.overflowX);
      }).slice(0,40).map(el=>({name:name(el),text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,90),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth})) : [];

      const directText = dialog ? [...dialog.querySelectorAll('*')].filter(el=>visible(el) && [...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim())) : [];
      const smallText = directText.map(el=>({el,px:parseFloat(getComputedStyle(el).fontSize)||0})).filter(x=>x.px>0&&x.px<9).map(x=>({name:name(x.el),px:+x.px.toFixed(1),text:(x.el.textContent||'').trim().slice(0,55)}));
      const tinyTargets = controls.map(el=>({el,r:el.getBoundingClientRect()})).filter(x=>x.r.width<28||x.r.height<26).map(x=>({name:name(x.el),rect:rect(x.el),text:(x.el.innerText||x.el.value||'').trim().slice(0,40)}));

      const chipOverflow = chips ? chips.scrollWidth > chips.clientWidth + 2 : false;
      const listHorizontalOverflow = list ? list.scrollWidth > list.clientWidth + 2 : false;
      const dialogOutside = dialog ? outsideViewport(dialog) : false;
      const overlayRect = overlay ? overlay.getBoundingClientRect() : null;
      const overlayNotViewport = overlay && getComputedStyle(overlay).position==='fixed' && (Math.abs(overlayRect.left)>2 || Math.abs(overlayRect.top)>2 || Math.abs(overlayRect.width-V.w)>3 || Math.abs(overlayRect.height-V.h)>3);
      const dialogWiderThanBackdrop = overlay && dialog && dialog.clientWidth > overlay.clientWidth + 3;
      const containingAncestors=[];
      if(overlay){ for(let a=overlay.parentElement;a;a=a.parentElement){ const s=getComputedStyle(a); const c=s.contain||'none'; if(c!=='none'||s.transform!=='none'||s.filter!=='none'||s.perspective!=='none') containingAncestors.push({name:name(a),contain:c,transform:s.transform,filter:s.filter,perspective:s.perspective}); } }
      const layoutContainingAncestor = containingAncestors.find(x=>/(layout|paint|strict|content)/.test(x.contain));
      const footerOutside = footer ? outsideViewport(footer) : false;

      const issues=[];
      if(overlayNotViewport) issues.push({severity:'P0',code:'fixed-modal-contained-by-layout',message:`fixed 遮罩没有以视口为包含块；祖先布局隔离使其被限制在工作区内${layoutContainingAncestor?`（${layoutContainingAncestor.name} contain=${layoutContainingAncestor.contain}）`:''}。`});
      if(dialogWiderThanBackdrop) issues.push({severity:'P0',code:'dialog-wider-than-backdrop',message:`分类弹窗宽度 ${dialog.clientWidth}px 大于遮罩可用宽度 ${overlay.clientWidth}px。`});
      if(dialogOutside) issues.push({severity:'P0',code:'dialog-outside-viewport',message:'分类弹窗超出视口。'});
      if(footerOutside) issues.push({severity:'P0',code:'footer-outside-viewport',message:'分类弹窗底部操作区超出视口。'});
      if(chipOverflow) issues.push({severity:'P1',code:'summary-chip-overflow',message:'顶部分类统计超出可用宽度，存在裁切风险。'});
      if(listHorizontalOverflow) issues.push({severity:'P1',code:'file-list-horizontal-overflow',message:'文件列表出现横向溢出。'});
      if(outsideControls.length) issues.push({severity:'P0',code:'control-outside-viewport',message:`${outsideControls.length} 个可交互控件超出视口。`});
      if(overlaps.length) issues.push({severity:'P0',code:'interactive-overlap',message:`检测到 ${overlaps.length} 组可交互控件重叠。`});
      if(nestedScroll.length) issues.push({severity:'P1',code:'nested-scroll',message:`检测到 ${nestedScroll.length} 组同支路嵌套纵向滚动容器。`});
      if(suspiciousClip.length) issues.push({severity:'P1',code:'non-ellipsis-clipping',message:`检测到 ${suspiciousClip.length} 处非省略号式横向裁切。`});
      if(smallText.length>8) issues.push({severity:'P2',code:'dense-small-text',message:`当前弹窗有 ${smallText.length} 处小于 9px 的直接文本，阅读密度偏高。`});
      if(tinyTargets.length) issues.push({severity:'P2',code:'small-hit-target',message:`当前弹窗有 ${tinyTargets.length} 个交互目标小于 28×26px。`});

      return {viewport:V,key,overlayNotViewport,dialogWiderThanBackdrop,containingAncestors,issues,scrollOwners,nestedScroll,outsideControls,overlaps,suspiciousClip,smallTextCount:smallText.length,smallText:smallText.slice(0,30),tinyTargets};
    }
    """)


def compare_images(current: Path, baseline: Path, diff_path: Path) -> dict[str, Any] | None:
    if not baseline.exists() or not current.exists():
        return None
    try:
        from PIL import Image, ImageChops, ImageStat
        a=Image.open(current).convert('RGB')
        b=Image.open(baseline).convert('RGB')
        if a.size != b.size:
            return {"comparable": False, "reason": f"size changed {b.size} -> {a.size}"}
        d=ImageChops.difference(a,b)
        stat=ImageStat.Stat(d)
        mean=sum(stat.mean)/3
        bbox=d.getbbox()
        if bbox:
            diff_path.parent.mkdir(parents=True,exist_ok=True)
            d.save(diff_path)
        return {"comparable": True, "mean_abs_diff": round(mean,3), "changed": bool(bbox), "bbox": bbox}
    except Exception as e:
        return {"comparable": False, "reason": str(e)}


def render_markdown(report: dict[str, Any]) -> str:
    lines=[
        "# NetEase Mail Draft Assistant · Automated UI QA",
        "",
        f"- Version: `{report['version']}`",
        f"- Static checks: **{'PASS' if report['static']['ok'] else 'FAIL'}**",
        f"- Runtime import: **{'PASS' if report['runtime']['import_ok'] else 'FAIL'}**",
        f"- Imported routing: {report['runtime'].get('routing_summary','')}",
        "",
        "## Viewport results",
        "",
        "| Viewport | P0 | P1 | P2 | Small text <9px | Nested scroll | Screenshot |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for item in report['viewports']:
        counts={s:sum(1 for x in item['audit']['issues'] if x['severity']==s) for s in ['P0','P1','P2']}
        lines.append(f"| {item['label']} {item['width']}×{item['height']} | {counts['P0']} | {counts['P1']} | {counts['P2']} | {item['audit']['smallTextCount']} | {len(item['audit']['nestedScroll'])} | `{item['screenshot']}` |")
    lines += ["", "## Findings", ""]
    any_issue=False
    for item in report['viewports']:
        for issue in item['audit']['issues']:
            any_issue=True
            lines.append(f"- **{issue['severity']} · {item['label']}** `{issue['code']}` — {issue['message']}")
    if not any_issue: lines.append("- No automated layout warnings detected.")
    lines += [
        "",
        "## What this harness verifies",
        "",
        "- Executes the production `content.js` / import stack and `content.css` in Chromium.",
        "- Drives the real multi-file import path into the classification dialog.",
        "- Captures responsive screenshots at five viewport sizes.",
        "- Flags viewport escape, footer loss, header/list overflow, overlapping controls, nested vertical scroll contexts, suspicious clipping, very small text, and undersized hit targets.",
        "- Does not change production parsing, scheduling, contacts, or draft-creation logic.",
        "",
        "## Re-run",
        "",
        "```bash\npython3 qa/ui_audit.py\n```",
        "",
        "For before/after visual diffs, preserve an older screenshot folder and run:",
        "",
        "```bash\npython3 qa/ui_audit.py --baseline /path/to/old/qa/screenshots\n```",
    ]
    return "\n".join(lines)+"\n"


def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, default=None, help='old screenshot directory for pixel diff')
    args=parser.parse_args()
    ensure_dirs()
    for p in SHOTS.glob('*.png'): p.unlink()
    static=run_static_checks()
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    report: dict[str, Any] = {"version":manifest.get('version','unknown'),"static":static,"runtime":{},"viewports":[],"visual_diffs":[]}

    console_errors=[]
    page_errors=[]
    fixture_paths=[
        FIXTURES/'北京航空航天大学 - 裴纬.docx',
        FIXTURES/'北京985211补充名单.xlsx',
        FIXTURES/'Test Student-CV.pdf',
    ]
    missing=[str(p) for p in fixture_paths if not p.exists()]
    if missing:
        raise SystemExit('Missing QA fixtures: '+', '.join(missing))

    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={"width":1440,"height":900})
        page.on('console',lambda msg: console_errors.append(msg.text) if msg.type=='error' else None)
        page.on('pageerror',lambda err: page_errors.append(str(err)))
        page.set_content('<!doctype html><html><head><meta charset="utf-8"><title>NMDA QA Host</title></head><body><div id="dvNavTop"><button role="button">写信</button></div><main><h1>NetEase QA Host</h1></main></body></html>')
        page.add_script_tag(content=qa_chrome_stub())
        page.add_style_tag(path=str(ROOT/'content.css'))
        for name in SCRIPTS: page.add_script_tag(path=str(ROOT/name))
        page.wait_for_selector('#nmda-root',state='attached',timeout=5000)
        page.click('#nmda-launcher')
        page.wait_for_selector('#nmda-panel:not([hidden])',timeout=5000)
        empty_path=SHOTS/'00-empty-workbench-1440x900.png'
        page.screenshot(path=str(empty_path))

        page.locator('#nmda-import-file').set_input_files([str(x) for x in fixture_paths])
        try:
            page.wait_for_selector('#nmda-supplement-preflight:not([hidden])',timeout=15000)
            import_ok=True
        except Exception:
            import_ok=False
        rows=page.locator('.nmda-classify-file-row').count()
        routing=(page.locator('#nmda-preflight-routing-chips').inner_text(timeout=1000).replace('\n',' · ') if page.locator('#nmda-preflight-routing-chips').count() else '')
        report['runtime']={"import_ok":import_ok,"file_rows":rows,"routing_summary":routing,"console_errors":console_errors,"page_errors":page_errors}

        if import_ok:
            for width,height,label in VIEWPORTS:
                page.set_viewport_size({"width":width,"height":height})
                page.wait_for_timeout(180)
                shot=SHOTS/f"10-preflight-{label}-{width}x{height}.png"
                page.screenshot(path=str(shot))
                audit=audit_dom(page)
                report['viewports'].append({"label":label,"width":width,"height":height,"screenshot":shot.name,"audit":audit})
                if args.baseline:
                    comp=compare_images(shot,args.baseline/shot.name,REPORTS/'diffs'/shot.name)
                    report['visual_diffs'].append({"screenshot":shot.name,"result":comp})

            page.set_viewport_size({"width":1440,"height":900})
            for tone,idx in [('mail',20),('roster',21),('attachment',22)]:
                loc=page.locator(f'.nmda-classify-file-row[data-tone="{tone}"]').first
                if loc.count():
                    loc.click()
                    page.wait_for_timeout(120)
                    page.screenshot(path=str(SHOTS/f'{idx}-inspector-{tone}-1440x900.png'))
        browser.close()

    (REPORTS/'ui-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (REPORTS/'ui-audit.md').write_text(render_markdown(report),encoding='utf-8')
    print((REPORTS/'ui-audit.md').read_text(encoding='utf-8'))
    p0=sum(1 for v in report['viewports'] for i in v['audit']['issues'] if i['severity']=='P0')
    return 2 if not static['ok'] or not report['runtime'].get('import_ok') or p0 else 0


if __name__ == '__main__':
    raise SystemExit(main())
