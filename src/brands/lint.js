import { fluidClamp } from '../tools/lib.js';

/*
 * Brand enforcement, derived entirely from a brand pack (tokens.json + brand.json):
 *   compileRules → lintText   colours, fonts, weights, radius, shadows, opacity, justified text
 *   lintIcon                   icon grid, stroke, caps, joins, fills, colours
 *   brandCss                   tokens as CSS variables / Tailwind v4 @theme / Tailwind v3 config
 * Pure functions: no file access here, so they are easy to test.
 */

// ---------- helpers ----------
const hex6 = (h) => {
  const s = h.replace('#', '');
  return (s.length <= 4 ? s.slice(0, 3).split('').map((c) => c + c).join('') : s.slice(0, 6)).toUpperCase();
};
const hexAlpha = (h) => {
  const s = h.replace('#', '');
  if (s.length === 4) return parseInt(s[3] + s[3], 16) / 255;
  if (s.length === 8) return parseInt(s.slice(6, 8), 16) / 255;
  return 1;
};
const rgbOf = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (r, g, b) => [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('').toUpperCase();
const round2 = (n) => Math.round(n * 100) / 100;
const kebab = (p) => p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
const clean = (v) => v.trim().replace(/,$/, '').trim().replace(/^(['"`])([\s\S]*)\1$/, '$2').trim();

export function splitStack(stack) {
  return String(stack).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

// ---------- rules ----------
export function compileRules(brand) {
  const { tokens, meta = {} } = brand;
  const palette = new Map(tokens.color.tokens.map((c) => [hex6(c.value), c.name]));
  const opacity = (tokens.opacity?.tokens ?? []).map((t) => Number(t.value));
  const alphas = new Set([1, ...opacity, ...(meta.rules?.extraAlphas ?? [])].map(round2));
  const families = Object.fromEntries(Object.entries(tokens.type?.families ?? {}).map(([k, v]) => [k, splitStack(v)]));
  const primaryFonts = new Set(Object.values(families).map((f) => f[0]?.toLowerCase()).filter(Boolean));
  const weights = new Set((tokens.type?.groups ?? []).flatMap((g) => g.styles.map((s) => Number(s.fontWeight))).filter(Boolean));
  const radiusTokens = tokens.radius?.tokens;
  const radii = radiusTokens ? new Set(radiusTokens.map((t) => String(t.value).replace(/px$/, '').trim())) : null;
  const shadows = new Set(['none', ...(tokens.shadow?.tokens ?? []).map((t) => normShadow(t.value))]);
  return {
    brand: meta.name ?? brand.slug,
    palette, alphas, families, primaryFonts, weights, radii, shadows,
    forbidJustify: meta.rules?.forbidJustify === true,
  };
}

const normShadow = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/(?<!\d)0\.(\d)/g, '.$1').trim();

function nearestToken(hex, palette) {
  const [r, g, b] = rgbOf(hex);
  let best = null;
  for (const [h, name] of palette) {
    const [r2, g2, b2] = rgbOf(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (!best || d < best.d) best = { d, h, name };
  }
  return best ? `${best.name} #${best.h}` : 'a brand colour';
}

// Colours inside a string: #hex, rgb()/rgba(), hsl()/hsla().
function findColours(str) {
  const out = [];
  for (const m of str.matchAll(/(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
    const before = str.slice(Math.max(0, m.index - 14), m.index);
    if (/(href|xlink:href|id|for|to)\s*=\s*\{?\s*["'`]?$|url\(\s*["']?$/i.test(before)) continue; // anchors, ids, url(#id)
    out.push({ raw: m[0], hex: hex6(m[0]), alpha: hexAlpha(m[0]) });
  }
  for (const m of str.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi)) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    out.push({ raw: m[0], hex: toHex(+m[1], +m[2], +m[3]), alpha: a });
  }
  for (const m of str.matchAll(/hsla?\([^)]*\)/gi)) out.push({ raw: m[0], hex: null, alpha: 1 });
  return out;
}

const COLOUR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left|block|inline)?-?color|border-(top|right|bottom|left)|outline|outline-color|fill|stroke|stop-color|caret-color|accent-color|text-decoration-color|column-rule-color)$/;
const NAMED = /\b(black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|gold)\b/i;
const TW_PALETTE = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/\d+)?(?![\w-])/g;
const TW_WEIGHTS = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const CLASS_CONTEXT = /\b(class|className|clsx|cn|cva|twMerge)\b|@apply/;

/** Lint one text file. Returns [{ rule, line, found, fix }]. */
export function lintText(text, file, rules) {
  const findings = [];
  const add = (rule, line, found, fix) => findings.push({ rule, file, line, found: String(found).slice(0, 120), fix });
  const isCss = /\.(css|scss|sass|less)$/i.test(file);
  const colourFix = (c) => (c.hex ? `use a token, nearest: ${nearestToken(c.hex, rules.palette)}` : 'use a brand colour token');
  const checkColour = (c, n) => {
    if (!c.hex) return add('colour', n, c.raw, colourFix(c));
    if (!rules.palette.has(c.hex)) return add('colour', n, c.raw, colourFix(c));
    if (!rules.alphas.has(round2(c.alpha))) add('opacity', n, c.raw, `alpha ${round2(c.alpha)} is not a brand step (${[...rules.alphas].sort().join(', ')})`);
  };

  let inStyle = false;
  text.split('\n').forEach((rawLine, i) => {
    const n = i + 1;
    const line = rawLine.trim();
    if (!line || /^(\/\/|\/\*|\*|<!--)/.test(line)) return;
    let scan = rawLine;

    if (!isCss && /<style[\s>]/i.test(rawLine)) inStyle = true;
    const cssLike = isCss || inStyle;
    if (!isCss && /<\/style>/i.test(rawLine)) inStyle = false;

    // Declarations: CSS syntax in stylesheets, <style> blocks and style="" attributes;
    // JS object syntax (quoted or numeric values) for inline JSX styles and configs.
    const sources = cssLike
      ? [rawLine]
      : [...[...rawLine.matchAll(/style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/g)].map((x) => x[1] ?? x[2])];
    const decls = [
      ...sources.flatMap((src) => [...src.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}\n"]+)/g)]),
      ...(cssLike ? [] : [...rawLine.matchAll(/([a-zA-Z][\w-]*)\s*:\s*('[^']*'|"[^"]*"|`[^`]*`|-?[\d.]+(?:px|rem|em|%)?)(?=\s*[,}\n]|\s*$)/g)]),
    ];
    for (const m of decls) {
      const prop = kebab(m[1]);
      const value = clean(m[2]);
      const lower = value.toLowerCase();
      if (/^var\(/.test(lower)) continue;

      if (prop === 'box-shadow' || prop === 'text-shadow' || (/^--shadow/.test(prop) && rules.shadows.has(normShadow(value)))) {
        if (!rules.shadows.has(normShadow(value))) add('shadow', n, `${prop}: ${value}`, `allowed: ${[...rules.shadows].join(' | ')}`);
        scan = scan.replace(m[0], ' '); // don't re-check the colour inside an allowed shadow
        continue;
      }
      if (prop === 'font-family') {
        const first = splitStack(value)[0]?.toLowerCase();
        if (first && !/^var\(/.test(first) && !['inherit', 'initial', 'unset'].includes(first) && !rules.primaryFonts.has(first)) {
          add('font', n, `font-family: ${value}`, `use the brand stacks: ${Object.entries(rules.families).map(([k, v]) => `${k} → ${v[0]}`).join(', ')}`);
        }
      } else if (prop === 'font-weight') {
        const w = lower === 'bold' ? 700 : lower === 'normal' ? 400 : Number(lower);
        if (Number.isFinite(w) && rules.weights.size && !rules.weights.has(w)) add('weight', n, `font-weight: ${value}`, `brand weights: ${[...rules.weights].sort().join(', ')}`);
      } else if (/(^|-)radius$/.test(prop) && rules.radii) {
        const parts = lower.split(/[\s/]+/).map((p) => p.replace(/px$|rem$|em$|%$/, ''));
        if (parts.some((p) => p && !rules.radii.has(p) && !(rules.radii.has('0') && p === '0'))) add('radius', n, `${prop}: ${value}`, `brand radius: ${[...rules.radii].join(', ')}`);
      } else if (prop === 'opacity') {
        const v = lower.endsWith('%') ? parseFloat(lower) / 100 : Number(lower);
        if (Number.isFinite(v) && v !== 0 && !rules.alphas.has(round2(v))) add('opacity', n, `opacity: ${value}`, `brand steps: ${[...rules.alphas].sort().join(', ')}`);
      } else if (prop === 'text-align' && rules.forbidJustify && lower === 'justify') {
        add('justify', n, 'text-align: justify', 'left-align body text (never justified)');
      } else if (COLOUR_PROPS.test(prop) && NAMED.test(lower) && !/\bwhite\b/.test(lower)) {
        add('colour', n, `${prop}: ${value}`, 'named colour: use a brand token');
      }
      if (cssLike) for (const c of findColours(value)) checkColour(c, n);
    }

    if (!cssLike) {
      // Visible text between tags (">#cafe news<") and plain prose lines can hold hashtags,
      // not colours: only code (attributes, strings, classes, calls) is scanned.
      const code = scan.replace(/>[^<>{}]*</g, '><');
      if (/[=:'"`(\[]/.test(code)) for (const c of findColours(code)) checkColour(c, n);
    }

    // Tailwind utilities, only where classes are written.
    if (CLASS_CONTEXT.test(rawLine)) {
      for (const m of rawLine.matchAll(TW_PALETTE)) add('colour', n, m[0], 'Tailwind default palette: use brand colours (generate them with brand_css)');
      for (const m of rawLine.matchAll(/(?<![\w-])(?:bg|text|border|ring|fill|stroke)-black(?![\w-])/g)) add('colour', n, m[0], 'black is not a brand colour');
      if (rules.radii && [...rules.radii].every((r) => r === '0')) {
        for (const m of rawLine.matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)*(?:-\[[^\]]+\])?(?![\w-])/g)) {
          if (!/-(none|0|\[0(px)?\])$/.test(m[0])) add('radius', n, m[0], 'brand is square-cornered: rounded-none');
        }
      }
      for (const m of rawLine.matchAll(/(?<![\w-])(?:drop-)?shadow(?:-(?:sm|md|lg|xl|2xl|inner))?(?![\w-])/g)) {
        add('shadow', n, m[0], 'Tailwind shadow utility: the brand allows only its shadow tokens');
      }
      for (const m of rawLine.matchAll(/(?<![\w-])font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/g)) {
        if (rules.weights.size && !rules.weights.has(TW_WEIGHTS[m[1]])) add('weight', n, m[0], `brand weights: ${[...rules.weights].sort().join(', ')}`);
      }
      for (const m of rawLine.matchAll(/(?<![\w-])(?:opacity|bg-opacity|text-opacity)-(\d{1,3})(?![\w-])|(?<![\w-])(?:bg|text|border|fill|stroke)-[a-z][\w-]*\/(\d{1,3})(?![\w-])/g)) {
        const v = Number(m[1] ?? m[2]) / 100;
        if (v !== 0 && !rules.alphas.has(round2(v))) add('opacity', n, m[0], `brand steps: ${[...rules.alphas].sort().join(', ')}`);
      }
      if (rules.forbidJustify && /(?<![\w-])text-justify(?![\w-])/.test(rawLine)) add('justify', n, 'text-justify', 'left-align body text (never justified)');
    }
  });
  return findings;
}

// ---------- icons ----------
function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  if (out.style) for (const d of out.style.split(';')) {
    const [k, ...v] = d.split(':');
    if (k && v.length) out[k.trim().toLowerCase()] = v.join(':').trim();
  }
  return out;
}

const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);

/** Check one SVG against the brand's icon rules. Returns { findings, shapes }. */
export function lintIcon(svg, file, iconRules, palette) {
  const findings = [];
  const add = (rule, found, fix) => findings.push({ rule, file, found, fix });
  const { grid, strokeWidth, linecap, linejoin, fill, colours = [] } = iconRules;
  const allowedStroke = new Set(colours.map((name) => [...palette].find(([, n]) => n === name)?.[0]).filter(Boolean));

  const stack = [];
  let scale = 1;
  let shapes = 0;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tagRaw, rest, selfClose] = m;
    const tag = tagRaw.toLowerCase();
    if (closing) { if (tag === 'g' || tag === 'svg') stack.pop(); continue; }
    const a = attrs(rest);
    if (tag === 'svg') {
      const vb = (a.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
      if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) add('viewBox', a.viewbox ?? '(none)', `use viewBox="0 0 ${grid} ${grid}"`);
      else {
        if (vb[2] !== vb[3]) add('viewBox', a.viewbox, 'icons are square');
        if (vb[2] !== grid) add('viewBox', a.viewbox, `brand grid is ${grid}: use viewBox="0 0 ${grid} ${grid}"`);
        scale = vb[2] / grid;
      }
    }
    if (tag === 'svg' || tag === 'g') { if (!selfClose) stack.push(a); continue; }
    if (!SHAPES.has(tag)) continue;
    shapes++;
    const eff = Object.assign({}, ...stack, a);
    const label = `<${tag}${eff.id ? ` id="${eff.id}"` : ''}> #${shapes}`;
    const f = (eff.fill ?? '').toLowerCase();
    if (f !== fill) add('fill', `${label} fill=${eff.fill ?? '(not set: SVG fills black by default)'}`, `fill="${fill}"`);
    const stroke = (eff.stroke ?? '').trim();
    if (!stroke || stroke === 'none') add('stroke', `${label} has no stroke`, 'line icons are drawn with a stroke');
    else if (/^#/.test(stroke) && allowedStroke.size && !allowedStroke.has(hex6(stroke))) {
      add('colour', `${label} stroke=${stroke}`, `icon colours: ${colours.join(', ')} (or currentColor)`);
    }
    const want = Math.round(strokeWidth * scale * 1000) / 1000;
    const sw = eff['stroke-width'] === undefined ? 1 : parseFloat(eff['stroke-width']);
    if (Math.abs(sw - want) > 0.01) add('stroke-width', `${label} stroke-width=${eff['stroke-width'] ?? '(not set = 1)'}`, `stroke-width="${want}"`);
    if ((eff['stroke-linecap'] ?? 'butt') !== linecap) add('linecap', `${label} stroke-linecap=${eff['stroke-linecap'] ?? '(not set = butt)'}`, `stroke-linecap="${linecap}"`);
    if ((eff['stroke-linejoin'] ?? 'miter') !== linejoin) add('linejoin', `${label} stroke-linejoin=${eff['stroke-linejoin']}`, `stroke-linejoin="${linejoin}"`);
  }
  if (!shapes) add('shapes', 'no drawable shapes found', 'is this an SVG icon?');
  return { findings, shapes };
}

// ---------- CSS export ----------
export function brandCss(brand, format = 'css') {
  const { tokens, meta = {} } = brand;
  const fams = tokens.type?.families ?? {};
  const weights = [...new Set((tokens.type?.groups ?? []).flatMap((g) => g.styles.map((s) => Number(s.fontWeight))))].sort();
  const wName = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
  const scale = meta.web?.typeScale ?? {};
  const size = (s) => (s.px ? `${s.px / 16}rem` : fluidClamp({ minPx: s.minPx, maxPx: s.maxPx }));
  const header = `Generated from context/brands/${brand.slug}/tokens.json (v${tokens.version}). Don't edit by hand: regenerate with brand_css.`;
  const colours = tokens.color.tokens;
  const opac = tokens.opacity?.tokens ?? [];
  const shadows = tokens.shadow?.tokens ?? [];
  const radii = tokens.radius?.tokens ?? [];
  // Web layout (brand.json → web.layout): fluid margins and gutters, content widths, spacing steps and
  // component sizes. Strokes thinner than 8px stay as border widths (border-2, border), not spacing.
  const layout = meta.web?.layout ?? null;
  const fluid = (v) => (v ? fluidClamp({ minPx: v.minPx, maxPx: v.maxPx }) : null);
  const rem = (px) => `${px / 16}rem`;
  const lay = layout ? {
    status: layout.status === 'proposed' ? 'PROPOSED web layout (derived from print, awaiting approval): ' : 'Web layout: ',
    fluid: [['page-margin', fluid(layout.pageMargin)], ['gutter', fluid(layout.gutter)], ['section', fluid(layout.sectionSpace)]].filter(([, v]) => v),
    widths: [['page', layout.containerMaxPx ? rem(layout.containerMaxPx) : null], ['measure', layout.measureCh ? `${layout.measureCh}ch` : null]].filter(([, v]) => v),
    spacing: Object.entries(layout.spacing ?? {}),
    sizes: Object.entries(layout.sizes ?? {}),
    columns: layout.columns,
  } : null;
  const layoutComment = lay ? `${lay.status}columns ${lay.columns ? `${lay.columns.base} / md ${lay.columns.md} / lg ${lay.columns.lg}` : 'n/a'}; Tailwind default breakpoints.` : '';

  if (format === 'tailwind-v3') {
    const obj = {
      colors: Object.fromEntries([['transparent', 'transparent'], ['current', 'currentColor'], ...colours.map((c) => [c.name, c.value])]),
      fontFamily: Object.fromEntries([['sans', splitStack(fams.text ?? fams.display ?? '')], ...Object.entries(fams).map(([k, v]) => [k, splitStack(v)])]),
      fontWeight: Object.fromEntries(weights.map((w) => [wName[w] ?? String(w), String(w)])),
      borderRadius: Object.fromEntries(radii.map((r) => [r.name.replace(/^radius-/, ''), String(r.value) === '0' ? '0' : r.value])),
      boxShadow: Object.fromEntries([['none', 'none'], ...shadows.map((s) => [s.name, s.value])]),
      extend: {
        opacity: Object.fromEntries(opac.map((o) => [o.name, o.value])),
        fontSize: Object.fromEntries(Object.entries(scale).map(([k, s]) => [k, [size(s), { ...(s.lineHeightPx ? { lineHeight: `${s.lineHeightPx / 16}rem` } : {}), ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}), fontWeight: String(s.weight) }]])),
        ...(lay ? {
          spacing: Object.fromEntries([...lay.fluid, ...lay.spacing.map(([k, px]) => [k, rem(px)]), ...lay.sizes.filter(([, px]) => px >= 8).map(([k, px]) => [k, rem(px)])]),
          maxWidth: Object.fromEntries(lay.widths),
        } : {}),
      },
    };
    return `// ${header}\n${lay ? `// ${layoutComment}\n` : ''}// Paste into tailwind.config.js. colors, fontWeight, borderRadius and boxShadow REPLACE Tailwind's defaults,\n// so off-brand values (bg-blue-500, rounded-lg, font-light, shadow-md) stop existing.\nmodule.exports = {\n  theme: ${JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ')},\n};\n`;
  }

  if (format === 'tailwind-v4') {
    const lines = [
      `/* ${header} */`,
      '/* Paste into your main CSS after @import "tailwindcss". Each "initial" line removes Tailwind\'s',
      '   defaults for that group, so only brand values exist (no bg-blue-500, font-light, shadow-md…). */',
      '@theme {',
      '  --color-*: initial;',
      ...colours.map((c) => `  --color-${c.name}: ${c.value};`),
      '',
      '  --font-*: initial;',
      `  --font-sans: ${fams.text ?? fams.display};`,
      ...Object.entries(fams).map(([k, v]) => `  --font-${k}: ${v};`),
      '',
      '  --font-weight-*: initial;',
      ...weights.map((w) => `  --font-weight-${wName[w] ?? w}: ${w};`),
      '',
      '  --radius-*: initial;',
      ...radii.map((r) => `  --${r.name}: ${String(r.value) === '0' ? '0' : r.value};`),
      '',
      '  --shadow-*: initial;',
      ...shadows.map((s) => `  --shadow-${s.name}: ${s.value};`),
      '',
      ...Object.entries(scale).flatMap(([k, s]) => [
        `  --text-${k}: ${size(s)};`,
        ...(s.lineHeightPx ? [`  --text-${k}--line-height: ${Math.round((s.lineHeightPx / (s.px ?? s.maxPx)) * 1000) / 1000};`] : []),
        ...(s.letterSpacing ? [`  --text-${k}--letter-spacing: ${s.letterSpacing};`] : []),
        `  --text-${k}--font-weight: ${s.weight};`,
      ]),
      ...(lay ? [
        '',
        `  /* ${layoutComment} */`,
        `  /* px-page-margin, gap-gutter, py-section; p-space-1…; size-icon-tile; max-w-page, max-w-measure.
     Spacing and container names never repeat: Tailwind would let the spacing one win in max-w-*. */`,
        '  /* Strokes and rules (key rule 2px, row line 1px) are border widths: border-t-2, border-b. */',
        ...lay.fluid.map(([k, v]) => `  --spacing-${k}: ${v};`),
        ...lay.spacing.map(([k, px]) => `  --spacing-${k}: ${rem(px)};`),
        ...lay.sizes.filter(([, px]) => px >= 8).map(([k, px]) => `  --spacing-${k}: ${rem(px)};`),
        ...lay.widths.map(([k, v]) => `  --container-${k}: ${v};`),
      ] : []),
      '}',
      '',
      ':root {',
      ...opac.map((o) => `  --opacity-${o.name}: ${o.value};`),
      '}',
      '',
      '/* Numbers in tables and columns: add class "tabular-nums". */',
    ];
    return lines.join('\n') + '\n';
  }

  // Plain CSS custom properties.
  const lines = [
    `/* ${header} */`,
    ...(meta.web?.notes ? [`/* ${meta.web.notes.replace(/\*\//g, '')} */`] : []),
    ':root {',
    ...colours.map((c) => `  --color-${c.name}: ${c.value};`),
    '',
    ...Object.entries(fams).map(([k, v]) => `  --font-${k}: ${v};`),
    ...weights.map((w) => `  --font-weight-${wName[w] ?? w}: ${w};`),
    '',
    ...radii.map((r) => `  --${r.name}: ${String(r.value) === '0' ? '0' : r.value};`),
    ...opac.map((o) => `  --opacity-${o.name}: ${o.value};`),
    ...shadows.map((s) => `  --shadow-${s.name}: ${s.value};`),
    '',
    ...Object.entries(scale).flatMap(([k, s]) => [
      `  --text-${k}-size: ${size(s)};`,
      ...(s.lineHeightPx ? [`  --text-${k}-line-height: ${s.lineHeightPx / 16}rem;`] : []),
      `  --text-${k}-weight: ${s.weight};`,
    ]),
    ...(lay ? [
      '',
      `  /* ${layoutComment} */`,
      ...lay.fluid.map(([k, v]) => `  --${{ 'page-margin': 'page-margin', gutter: 'gutter', section: 'section-space' }[k]}: ${v};`),
      ...lay.widths.map(([k, v]) => `  --${k === 'page' ? 'container-max' : k}: ${v};`),
      ...lay.spacing.map(([k, px]) => `  --${k}: ${rem(px)};`),
      ...lay.sizes.map(([k, px]) => `  --size-${k}: ${px >= 8 ? rem(px) : `${px}px`};`),
    ] : []),
    '}',
    '',
    '/* Numbers in tables and columns line up: */',
    'table, .tabular { font-variant-numeric: tabular-nums; }',
  ];
  return lines.join('\n') + '\n';
}
