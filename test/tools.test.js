import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, wcagReport, typeScale, fluidClamp, arabicCheck, scanText, headerReport } from '../src/tools/lib.js';

test('contrast matches WCAG reference values', () => {
  assert.equal(Math.round(contrastRatio('#000', '#fff') * 100) / 100, 21);
  assert.equal(Math.round(contrastRatio('#777777', '#ffffff') * 100) / 100, 4.48);
  const r = wcagReport('#777777', '#ffffff', 16);
  assert.equal(r.AA_text, false); // 4.48 < 4.5 — must not round up to a pass
  assert.equal(wcagReport('#777777', '#ffffff', 24).AA_text, true); // large text needs 3:1
});

test('type scale and clamp', () => {
  const s = typeScale({ basePx: 16, ratio: 1.25, stepsUp: 2, stepsDown: 1 });
  assert.deepEqual(s.map((x) => x.px), [12.8, 16, 20, 25]);
  assert.equal(s[1].tailwindName, 'base');
  assert.equal(fluidClamp({ minPx: 16, maxPx: 24, minViewportPx: 320, maxViewportPx: 1280 }), 'clamp(1rem, 0.8333rem + 0.8333vw, 1.5rem)');
});

test('arabic MSA check strips diacritics and fixes punctuation', () => {
  const r = arabicCheck('نَحْنُ شركة رائدة, نبني المستقبل?');
  assert.equal(r.ok, false);
  assert.equal(r.cleaned, 'نحن شركة رائدة، نبني المستقبل؟');
  assert.equal(arabicCheck('نحن شركة رائدة، نبني المستقبل').ok, true);
});

test('secret scan masks values and ignores Supabase anon key', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${b64({ role, iss: 'supabase-demo' })}.abcdefghijklmnopqrstu`;
  const fakeKey = ['sk', 'ant', 'api03', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].join('-'); // assembled so repo scanners don't flag a fake key
  const text = `const a = "${fakeKey}";\nconst anon = "${jwt('anon')}";\nconst srv = "${jwt('service_role')}";`;
  const f = scanText(text, 'x.js');
  assert.equal(f.length, 2);
  assert.match(f[0].kind, /Anthropic/);
  assert.ok(!f[0].value.includes('KLMNOP'));
  assert.match(f[1].kind, /SERVICE_ROLE/);
});

test('header audit finds missing headers', () => {
  const vercel = JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] }] });
  const r = headerReport('vercel.json', vercel);
  assert.ok(r.missing.includes('Content-Security-Policy'));
  assert.ok(!r.missing.includes('X-Content-Type-Options'));
  assert.ok(r.vercelSnippet.headers[0].headers.length === r.missing.length);
});

test('arabic check keeps hamza and madda in decomposed text', () => {
  for (const word of ['أحمد', 'إنشاء', 'آلات']) {
    const r = arabicCheck(word.normalize('NFD'));
    assert.equal(r.cleaned, word, word);
    assert.equal(r.ok, true, word);
  }
});
