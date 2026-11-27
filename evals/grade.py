#!/usr/bin/env python3
"""Grade every run in an iteration folder: writes grading.json next to each outputs/ folder.

Usage: python3 evals/grade.py <iteration-folder>
The folder holds <case>/<config>/outputs/ (configs: with_skill, without_skill), as the skill-creator workflow lays it out.
"""
import json, re, subprocess, sys, pathlib
ITER = pathlib.Path(sys.argv[1])
HERE = pathlib.Path(__file__).resolve().parent
REPO = str(HERE.parent)                 # the agent repo: its tools grade the output
TOOL = str(HERE / 'dea-tool.mjs')

def tool(out, name, args, brand='northwind'):
    r = subprocess.run(['node', TOOL, REPO, name, json.dumps(args)], cwd=out, capture_output=True, text=True, env={'PATH': '/usr/bin:/usr/local/bin:/bin', 'DEA_BRAND': brand})
    try: return json.loads(r.stdout)
    except Exception: return {'error': (r.stdout + r.stderr)[:300], 'findings': [], 'scannedFiles': 0}

def files(out, exts):
    return [p for p in out.rglob('*') if p.is_file() and p.suffix in exts and 'node_modules' not in p.parts]

def text_of(out, exts):
    return '\n'.join(p.read_text(errors='ignore') for p in files(out, exts))

def ev(text, passed, evidence): return {'text': text, 'passed': bool(passed), 'evidence': evidence}

def lint_checks(out, brand=True, target='.'):
    L = tool(out, 'layout_lint', {'target': target})
    fs = L.get('findings', [])
    errs = [f for f in fs if f['severity'] == 'error']
    bad_warn = [f for f in fs if f['rule'] in ('desktop-first', 'physical', 'viewport-height')]
    res = [
        ev('No layout_lint errors (zoom, focus, alt, viewport)', L.get('scannedFiles', 0) > 0 and not errs,
           f"{L.get('scannedFiles')} files; errors: " + ('; '.join(f"{f['rule']} {f['file']}:{f['line']}" for f in errs[:6]) or 'none')),
        ev('No desktop-first, physical left/right or 100vh warnings (mobile-first, RTL-safe)', not bad_warn,
           '; '.join(f"{f['rule']} {f['file']}:{f['line']} {f['found'][:40]}" for f in bad_warn[:6]) or 'none'),
    ]
    if brand:
        B = tool(out, 'brand_lint', {'target': target})
        bf = B.get('findings', [])
        res.append(ev('No brand_lint findings (brand tokens only: colours, fonts, weights, radius, shadows)', B.get('scannedFiles', 0) > 0 and not bf,
                      f"{B.get('scannedFiles')} files; " + ('; '.join(f"{f['rule']} {f['file']}:{f['line']} {f['found'][:40]}" for f in bf[:6]) or 'none')))
    return res, L

def arabic_fix(out):
    res, L = lint_checks(out, brand=False)
    html = (out / 'index.html').read_text(errors='ignore') if (out / 'index.html').exists() else ''
    css = text_of(out, {'.css'})
    res.append(ev('Document is Arabic and right-to-left (lang="ar" dir="rtl" on <html>)', re.search(r'<html[^>]*lang="ar"[^>]*dir="rtl"|<html[^>]*dir="rtl"[^>]*lang="ar"', html), re.search(r'<html[^>]*>', html).group(0) if re.search(r'<html[^>]*>', html) else 'no <html>'))
    vp = re.search(r'<meta[^>]*name="viewport"[^>]*>', html)
    res.append(ev('Zoom is allowed (no maximum-scale / user-scalable=no)', vp and not re.search(r'maximum-scale|user-scalable', vp.group(0)), vp.group(0) if vp else 'missing'))
    divclick = re.findall(r'<div[^>]*onclick', html, re.I)
    res.append(ev('Navigation and actions are real links and buttons (no clickable divs)', not divclick, f'{len(divclick)} div onclick'))
    inputs = len(re.findall(r'<input\b', html)); labels = len(re.findall(r'<label\b', html)) + len(re.findall(r'<input[^>]*aria-label', html))
    res.append(ev('Every form input has a label', inputs and labels >= inputs, f'{inputs} inputs, {labels} labels/aria-labels'))
    res.append(ev('Visible keyboard focus style (:focus-visible) and no outline removal', ':focus-visible' in css and not re.search(r'outline\s*:\s*none\s*!important', css), 'focus-visible found' if ':focus-visible' in css else 'no :focus-visible'))
    m = re.search(r'input[^{]*\{[^}]*font-size\s*:\s*([^;}]+)', css)
    val = m.group(1).strip() if m else ''
    for _ in range(3):  # resolve var(--x) through the stylesheet's custom properties
        v = re.match(r'var\((--[\w-]+)', val)
        if not v: break
        d = re.search(re.escape(v.group(1)) + r'\s*:\s*([^;}]+)', css)
        val = d.group(1).strip() if d else val
    ok = (not m) or re.match(r'(1(\.\d+)?rem|1[6-9]px|[2-9]\dpx|max\(1rem|clamp\(1rem|inherit|100%)', val)
    res.append(ev('Form inputs are at least 16px so iOS does not zoom', ok, m.group(0)[-60:] if m else 'no input font-size rule (inherits body)'))
    rv = (out / 'review.md').read_text(errors='ignore').lower() if (out / 'review.md').exists() else ''
    res.append(ev('review.md explains the zoom, focus and phone-layout problems', rv and all(any(w in rv for w in ws) for ws in (['zoom'], ['focus'], ['mobile', 'phone', 'small screen']) ), f'review.md {len(rv)} chars'))
    leak = re.search(r'Space Grotesk|#0B6E8A|fjord', html + css, re.I)
    res.append(ev('No example-brand (Northwind) styling leaks into an unbranded project', not leak, leak.group(0) if leak else 'none'))
    return res

# Add your own cases here: folder name → grading function.
CASES = {'arabic-page-fix': arabic_fix}
for case, fn in CASES.items():
    meta_p = ITER / case / 'eval_metadata.json'
    for cfg in ('with_skill', 'without_skill'):
        run = ITER / case / cfg
        out = run / 'outputs'
        if not out.exists(): continue
        exps = fn(out)
        passed = sum(e['passed'] for e in exps)
        json.dump({'expectations': exps, 'summary': {'passed': passed, 'failed': len(exps) - passed, 'total': len(exps), 'pass_rate': round(passed / len(exps), 3)}}, open(run / 'grading.json', 'w'), indent=2, ensure_ascii=False)
        print(f'{case:28} {cfg:14} {passed}/{len(exps)}')
        meta = json.load(open(meta_p)); meta['assertions'] = [e['text'] for e in exps]; json.dump(meta, open(meta_p, 'w'), indent=2, ensure_ascii=False)
