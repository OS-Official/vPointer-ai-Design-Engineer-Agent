import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { loadBrand, validateBrand, brandFromBrief, brandOfProject } from '../src/brands/load.js';
import { compileRules, lintText, lintIcon, brandCss } from '../src/brands/lint.js';
import { addDecision } from '../src/tools/lib.js';
import { loadTools } from '../src/tools/registry.js';

const brand = await loadBrand('northwind');
const rules = compileRules(brand);
const rulesOf = (findings) => findings.map((f) => `${f.line}:${f.rule}`);

test('the example brand pack is valid and linked to its project', async () => {
  assert.deepEqual(validateBrand(brand), []);
  assert.equal(brand.tokens.version, 1);
  assert.equal(rules.palette.get('0B6E8A'), 'fjord');
  assert.deepEqual([...rules.weights].sort(), [400, 500, 700]);
  assert.equal(await brandOfProject('northwind-site'), 'northwind');
  assert.equal(await brandOfProject('example-arabic-site'), null);
  assert.equal(brandFromBrief('# X\n**Brand:** acme-co\n'), 'acme-co');
});

test('brand validation catches broken packs', () => {
  const bad = structuredClone(brand);
  bad.tokens.color.tokens[0].value = 'fjord';
  bad.meta.tokensVersion = 2;
  const errors = validateBrand(bad).join('\n');
  assert.match(errors, /not a #RRGGBB value/);
  assert.match(errors, /brand\.json says tokens v2 but tokens\.json is v1/);
});

test('on-brand code passes cleanly', () => {
  const css = `.hero { color: #1F2A33; background: #0B6E8A; font-family: "Space Grotesk", Arial, sans-serif; font-weight: 700; border-radius: 0; }
.menu { box-shadow: 0 4px 8px rgba(0,0,0,0.2); padding: 10.5px; }
.scrim { background: rgba(18, 24, 30, 0.72); opacity: 0.6; }
#cafe:hover { color: var(--color-fjord); }
code { font-family: "JetBrains Mono", monospace; }`;
  assert.deepEqual(lintText(css, 'ok.css', rules), []);
  const jsx = `<a href="#bead" className="bg-fjord text-paper rounded-none font-medium bg-night/50 opacity-60" style={{ borderRadius: 0, color: '#FAFAF7' }}>x</a>`;
  assert.deepEqual(lintText(jsx, 'Ok.jsx', rules), []);
});

test('off-brand CSS is caught with the nearest token', () => {
  const css = `.a { color: #333; border-radius: 8px; font-weight: 600; }
.b { box-shadow: 0 2px 6px rgba(0,0,0,.1); text-align: justify; opacity: .8; }
.c { font-family: Poppins, sans-serif; border: 1px solid black; }`;
  const f = lintText(css, 'a.css', rules);
  assert.deepEqual(rulesOf(f).sort(), ['1:colour', '1:radius', '1:weight', '2:justify', '2:opacity', '2:shadow', '3:colour', '3:font'].sort());
  assert.match(f.find((x) => x.found === '#333').fix, /nearest: ink #1F2A33/);
});

test('off-brand JSX, Tailwind and HTML are caught', () => {
  const jsx = `<section className="rounded-lg shadow-md font-semibold text-blue-500 opacity-75 text-justify">
  <h1 style={{ fontFamily: 'Inter, sans-serif', color: '#ff0000', borderRadius: 0 }}>Hi</h1>
</section>`;
  assert.deepEqual(rulesOf(lintText(jsx, 'H.jsx', rules)).sort(), ['1:colour', '1:justify', '1:opacity', '1:radius', '1:shadow', '1:weight', '2:colour', '2:font'].sort());
  const html = `<div style="color: #C98B2B; border-radius: 4px">x</div>\n<style>\n  p { color: #4E7D5B; font-weight: 300 }\n</style>\n<p>#cafe is not a colour here</p>`;
  assert.deepEqual(rulesOf(lintText(html, 'i.html', rules)), ['1:radius', '3:weight']);
});

test('icons: on-grid passes, off-grid explains every problem', () => {
  const good = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><rect x="6" y="4" width="12" height="12"/></svg>`;
  assert.deepEqual(lintIcon(good, 'g.svg', brand.meta.icon, rules.palette), { findings: [], shapes: 2 });
  const bad = `<svg viewBox="0 0 48 48"><g stroke="#ff8800" stroke-width="3" stroke-linecap="square" stroke-linejoin="round"><path d="M2 2h40"/></g></svg>`;
  const r = lintIcon(bad, 'b.svg', brand.meta.icon, rules.palette);
  assert.deepEqual(r.findings.map((x) => x.rule), ['viewBox', 'fill', 'colour', 'stroke-width', 'linecap']);
  assert.match(r.findings.find((x) => x.rule === 'stroke-width').fix, /"4"/); // 2 scaled to a 48 grid
});

test('brand_css: every format carries the exact tokens', () => {
  const css = brandCss(brand, 'css');
  assert.match(css, /--color-fjord: #0B6E8A;/);
  assert.match(css, /--font-arabic: "Noto Kufi Arabic"/);
  assert.match(css, /--radius-none: 0;/);
  const v4 = brandCss(brand, 'tailwind-v4');
  for (const line of ['--color-*: initial;', '--font-weight-*: initial;', '--shadow-*: initial;', '--color-amber: #C98B2B;', '--text-body--line-height: 1.625;', '--font-weight-medium: 500;']) assert.ok(v4.includes(line), line);
  assert.ok(!/--font-weight-(light|semibold)/.test(v4));
  const v3 = brandCss(brand, 'tailwind-v3');
  const sandbox = { module: {} };
  vm.runInNewContext(v3, sandbox); // it must be valid JavaScript
  assert.equal(sandbox.module.exports.theme.colors.fjord, '#0B6E8A');
  assert.deepEqual(Object.keys(sandbox.module.exports.theme.fontWeight), ['normal', 'medium', 'bold']);
});

test('decisions land at the end of the Decisions section', () => {
  const brief = '# X\n\n## Decisions\n- 2026-11-01: old\n\n## Notes\nkeep\n';
  const out = addDecision(brief, { decision: 'Use Built to last', why: 'client approved', date: '2026-11-22' });
  assert.equal(out, '# X\n\n## Decisions\n- 2026-11-01: old\n- 2026-11-22: Use Built to last (client approved)\n\n## Notes\nkeep\n');
  assert.equal(addDecision('# Y\nbody\n', { decision: 'First one', date: '2026-11-22' }), '# Y\nbody\n\n## Decisions\n- 2026-11-22: First one\n');
});

test('brand tools run end to end through the registry', async () => {
  const { tools } = await loadTools();
  const tool = (n) => tools.find((t) => t.name === n);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dea-brand-'));
  fs.writeFileSync(path.join(project, 'site.css'), '.a { color: #0B6E8A; border-radius: 12px; }\n');
  fs.mkdirSync(path.join(project, 'icons'));
  fs.writeFileSync(path.join(project, 'icons', 'pack.svg'), '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16"/></svg>');
  const ctx = { roots: [project], brand: 'northwind', project: 'northwind-site' };
  try {
    assert.match(await tool('get_brand').run({ section: 'tokens' }, ctx), /\| fjord \| #0B6E8A \|/);
    assert.match(await tool('get_brand').run({ section: 'overview' }, ctx), /One accent, one meaning/);
    const lint = await tool('brand_lint').run({ target: '.' }, ctx);
    assert.equal(lint.verdict, '1 off-brand value(s)');
    assert.equal(lint.findings[0].rule, 'radius');
    assert.equal((await tool('icon_lint').run({ target: 'icons' }, ctx)).verdict, 'all icons match');
    await assert.rejects(tool('brand_lint').run({ target: '/etc' }, ctx), /outside the project/);
    await assert.rejects(tool('get_brand').run({ section: 'tokens' }, { roots: [project] }), /No brand given/);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});
