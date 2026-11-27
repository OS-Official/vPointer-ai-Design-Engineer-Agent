import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadStandards, activeStandards, applyStandards, readStandard } from '../src/loaders/standards.js';
import { loadAgents } from '../src/loaders/agents.js';
import { lintLayout } from '../src/lint/layout.js';
import { loadBrand } from '../src/brands/load.js';
import { brandCss } from '../src/brands/lint.js';

async function tmpStandards(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'std-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
  return dir;
}

test('shipped standards load, link their references and scope brand rules', async () => {
  const { standards, errors, warnings } = await loadStandards();
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(standards['northwind-brand'].brand, 'northwind');
  assert.deepEqual(standards['northwind-brand'].references, ['patterns.md']);
  assert.deepEqual(Object.keys(activeStandards(standards, 'acme')).sort(), ['clean-code', 'responsive-grid']);
  assert.ok(activeStandards(standards, 'northwind')['northwind-brand']);
  assert.match(await readStandard('responsive-grid'), /Mobile first, in code[\s\S]*patterns\.md/);
  assert.match(await readStandard('northwind-brand', 'patterns'), /Unselected tabs stay full-strength/);
  await assert.rejects(readStandard('responsive-grid', 'nope'), /no reference "nope.md"/);
  await assert.rejects(readStandard('../etc'), /lowercase/);
});

test('standard validation explains mistakes', async () => {
  const dir = await tmpStandards({
    'good/SKILL.md': '---\nname: good\ndescription: A standard that is long enough to explain itself\n---\nRules. See references/missing.md',
    'bad-name/SKILL.md': '---\nname: other\ndescription: short\n---\n',
    'nofile/README.md': 'x',
    '_template/SKILL.md': '---\nname: __NAME__\n---\n',
  });
  const r = await loadStandards(dir);
  assert.deepEqual(Object.keys(r.standards), ['good']);
  assert.ok(r.errors.some((e) => /name must match the folder/.test(e)));
  assert.ok(r.errors.some((e) => /description is missing or too short/.test(e)));
  assert.ok(r.errors.some((e) => /nofile: SKILL.md is missing/.test(e)));
  assert.ok(r.warnings.some((w) => /references\/missing.md/.test(w)));
});

test('specialists get their standards; other brands stay out; unknown names are errors', async () => {
  const { standards } = await loadStandards();
  const specs = { 'ui-engineer': { description: 'x', prompt: 'Base prompt.', tools: [], standards: ['responsive-grid', 'northwind-brand'] }, other: { description: 'y', prompt: 'P', tools: [] } };
  const forBrand = applyStandards(specs, standards, { brand: 'northwind' });
  assert.match(forBrand['ui-engineer'].prompt, /^Base prompt\.[\s\S]*# Standard: responsive-grid[\s\S]*# Standard: northwind-brand/);
  assert.equal(forBrand.other.prompt, 'P');
  const forNone = applyStandards(specs, standards, { brand: null });
  assert.doesNotMatch(forNone['ui-engineer'].prompt, /northwind-brand/);
  assert.match(forNone['ui-engineer'].prompt, /# Standard: responsive-grid/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
  await fs.writeFile(path.join(dir, 'lead.md'), '---\nname: lead\n---\nLead body');
  await fs.writeFile(path.join(dir, 'dev.md'), '---\nname: dev\ndescription: Builds things from designs, carefully\ntools: Read\nstandards: responsive-grid, responsive-grids\n---\nDo it.');
  const r = await loadAgents({ dir, knownStandards: Object.keys(standards) });
  assert.ok(r.errors.some((e) => /unknown standard "responsive-grids"/.test(e)));
});

test('layout_lint flags what breaks phones, RTL and focus, and nothing in clean code', () => {
  const bad = `<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head>
<body><img src="a.jpg">
<div class="ml-4 text-left h-screen w-[1200px] max-md:hidden outline-none"></div>
<a href="https://x.dev" target="_blank">x</a></body></html>`;
  const rules = lintLayout(bad, 'index.html').map((f) => `${f.severity}:${f.rule}`);
  for (const r of ['error:zoom-blocked', 'error:img-alt', 'warning:img-size', 'warning:physical', 'warning:viewport-height', 'warning:fixed-width', 'warning:desktop-first', 'error:focus-removed', 'warning:target-blank']) {
    assert.ok(rules.includes(r), `expected ${r}`);
  }
  assert.ok(lintLayout('<html><head><title>x</title></head></html>', 'a.html').some((f) => f.rule === 'viewport-missing'));

  const css = `.a { margin-left: 1rem; height: 100vh; font-size: 14px; }
@media (max-width: 40rem) { .b { color: red } }
@media (min-width: 40rem) and (max-width: 64rem) { .c { display: grid } }
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; }
}
.d { color: red !important; }`;
  const c = lintLayout(css, 'a.css');
  assert.deepEqual(c.map((f) => `${f.line}:${f.rule}`), ['1:physical', '1:viewport-height', '1:font-px', '2:desktop-first', '7:important']);
  assert.match(c[0].fix, /margin-inline-start/);

  const jsx = 'items.map((x, i) => <li key={i}>{x}</li>); console.log(items); <div dangerouslySetInnerHTML={{ __html: h }} />';
  assert.deepEqual(lintLayout(jsx, 'L.jsx').map((f) => f.rule).sort(), ['console', 'index-key', 'raw-html']);

  const good = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main class="mx-auto w-full max-w-page px-page">
<img src="a.webp" alt="Plant" width="800" height="500" loading="lazy">
<a href="https://x.dev" target="_blank" rel="noopener noreferrer">x</a>
<div class="ms-4 ps-2 text-start min-h-dvh left-1/2 inset-x-0 md:max-lg:grid outline-none focus-visible:outline-2"></div>
<!-- layout-lint-ignore --><div class="w-[1200px]"></div>
</main></body></html>`;
  const g = lintLayout(good, 'index.html');
  assert.deepEqual(g, [], 'clean, mobile-first, logical code passes (the ignore comment accepts its line)');
  assert.equal(lintLayout('<div class="w-[1200px]"></div>\n<!-- layout-lint-ignore -->', 'a.html').length, 1, 'the ignore comment only covers its own line');
  assert.deepEqual(lintLayout("const left = x; left.append(el('label', { class: 'toggle' }));", 'a.js'), [], 'a variable named left is not a Tailwind class');
  assert.equal(lintLayout('<div class="left-0 text-right"></div>', 'a.html').length, 2);
  assert.match(lintLayout('<div class="-mr-3 rounded-tl-lg border-l-2"></div>', 'a.html').map((f) => f.fix).join(' | '), /-me-3.*rounded-ss-lg.*border-s-2/);
});

test('linters skip compiled build output and accept the brand\'s own shadow token', async () => {
  const { isCompiled } = await import('../src/tools/lib.js');
  assert.ok(isCompiled('/*! tailwindcss v4.3.3 | MIT License */\n.a{color:red}'));
  assert.ok(!isCompiled('.a { color: red; }'));
  const b = await loadBrand('northwind');
  const { compileRules, lintText } = await import('../src/brands/lint.js');
  const rules = compileRules(b);
  assert.deepEqual(lintText(brandCss(b, 'tailwind-v4'), 'tokens.css', rules), []);
  assert.deepEqual(lintText(brandCss(b, 'css'), 'tokens.css', rules), []);
  assert.equal(lintText('.x { --shadow-fake: 0 9px 9px rgba(0,0,0,.5); }', 'a.css', rules).length > 0, true);
});

test('brand_css emits the brand\'s web layout tokens', async () => {
  const b = await loadBrand('northwind');
  const v4 = brandCss(b, 'tailwind-v4');
  assert.match(v4, /Web layout: columns 4 \/ md 8 \/ lg 12/);
  assert.match(v4, /--spacing-page-margin: clamp\(1\.25rem, [-\d.]+rem \+ [\d.]+vw, 5rem\);/);
  // Tailwind resolves max-w-<name> from --spacing-<name> first, so a name may not be in both namespaces.
  const spacing = new Set([...v4.matchAll(/--spacing-([\w-]+):/g)].map((m) => m[1]));
  const containers = [...v4.matchAll(/--container-([\w-]+):/g)].map((m) => m[1]);
  assert.deepEqual(containers.filter((c) => spacing.has(c)), []);
  assert.match(v4, /--container-page: 80rem;/);
  assert.match(v4, /--text-hero: clamp\(3\.5rem/);
  assert.doesNotMatch(v4, /--spacing-key-rule/); // 2px strokes are border widths, not spacing
  const css = brandCss(b, 'css');
  assert.match(css, /--page-margin: clamp/);
  assert.match(css, /--size-key-rule: 2px;/);
  const v3 = brandCss(b, 'tailwind-v3');
  assert.match(v3, /"maxWidth": \{\s*"page": "80rem"/);
});
