/*
 * Layout and code-quality lint for the responsive-grid and clean-code standards.
 * Pure functions (no file access), so they are easy to test.
 *
 *   errors   → break users: zoom blocked, focus removed, images without alt, missing viewport
 *   warnings → break layouts or habits: desktop-first queries, physical left/right, 100vh,
 *              fixed px widths, px font sizes, !important, index keys, console.log, raw HTML
 *
 * Add "layout-lint-ignore" in a comment on a line to accept that line on purpose.
 */

const CODE = /\.(jsx?|tsx?|mjs|cjs|vue|svelte)$/i;
const CSS = /\.(css|scss|sass|less)$/i;
const MARKUP = /\.(html?|jsx|tsx|vue|svelte)$/i;
const CLASS_CONTEXT = /\b(class|className|clsx|cn|cva|twMerge)\b|@apply/;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const attr = (tag, name) => new RegExp(`\\s${name}\\s*=`, 'i').test(tag);

// left/right utilities always carry a value (left-0, right-4); a bare "left" is a word or a variable.
const PHYSICAL_TW = /(?<![\w:[.-])-?(?:(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|border-[lr]|rounded-(?:[lr]|tl|tr|bl|br)|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))(?:-[\w./[\]%-]+)?|(?:left|right)-[\w./[\]%-]+)(?![\w-])/g;
const LOGICAL_FIX = {
  ml: 'ms-', mr: 'me-', pl: 'ps-', pr: 'pe-', 'scroll-ml': 'scroll-ms-', 'scroll-mr': 'scroll-me-', 'scroll-pl': 'scroll-ps-', 'scroll-pr': 'scroll-pe-',
  'border-l': 'border-s', 'border-r': 'border-e', 'rounded-l': 'rounded-s', 'rounded-r': 'rounded-e',
  'rounded-tl': 'rounded-ss', 'rounded-tr': 'rounded-se', 'rounded-bl': 'rounded-es', 'rounded-br': 'rounded-ee',
  'text-left': 'text-start', 'text-right': 'text-end', 'float-left': 'float-start', 'float-right': 'float-end',
  'clear-left': 'clear-start', 'clear-right': 'clear-end', left: 'start-', right: 'end-',
};

export function lintLayout(text, file) {
  const findings = [];
  const add = (rule, severity, line, found, fix) => findings.push({ rule, severity, file, line, found: String(found).trim().slice(0, 120), fix });
  const lines = text.split('\n');
  const ignored = (n) => /layout-lint-ignore/.test(lines[n - 1] ?? '');
  const isCss = CSS.test(file);
  const isCode = CODE.test(file);
  const isHtml = /\.html?$/i.test(file);

  // ---------- whole-file checks on tags (they can span lines) ----------
  if (MARKUP.test(file)) {
    for (const m of text.matchAll(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/gis)) {
      const n = lineOf(text, m.index);
      if (!ignored(n) && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(m[0])) {
        add('zoom-blocked', 'error', n, m[0], 'remove maximum-scale / user-scalable=no: people must be able to zoom (WCAG 1.4.4)');
      }
    }
    if (isHtml && /<head[\s>]/i.test(text) && !/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(text)) {
      add('viewport-missing', 'error', lineOf(text, text.search(/<head[\s>]/i)), '<head> without a viewport meta', 'add <meta name="viewport" content="width=device-width, initial-scale=1">');
    }
    for (const m of text.matchAll(/<(img|Image)\b(?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*>/g)) {
      const n = lineOf(text, m.index);
      if (ignored(n)) continue;
      const tag = m[0];
      if (!attr(tag, 'alt')) add('img-alt', 'error', n, tag, 'add alt="…" describing the image, or alt="" if it is decorative');
      const sized = (attr(tag, 'width') && attr(tag, 'height')) || /\bfill\b/.test(tag) || /aspect-|aspect-ratio/.test(tag);
      if (!sized) add('img-size', 'warning', n, tag, 'give width and height (or an aspect ratio) so the page does not jump while it loads');
    }
    for (const m of text.matchAll(/<a\b(?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*>/g)) {
      const n = lineOf(text, m.index);
      if (!ignored(n) && /target\s*=\s*["'{]?_blank/.test(m[0]) && !/rel\s*=\s*["'{][^"'}]*noopener/.test(m[0])) {
        add('target-blank', 'warning', n, m[0], 'add rel="noopener noreferrer"');
      }
    }
  }

  // ---------- line checks ----------
  const hasFocusVisible = /focus-visible/.test(text);
  let inStyle = false;
  let depth = 0;
  let reducedMotionDepth = -1;

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || ignored(n) || /^(\/\/|\/\*|\*|<!--)/.test(line)) return;

    if (!isCss && /<style[\s>]/i.test(raw)) inStyle = true;
    const cssLike = isCss || inStyle;
    if (!isCss && /<\/style>/i.test(raw)) inStyle = false;

    if (cssLike) {
      if (/@media[^{]*prefers-reduced-motion/.test(raw)) reducedMotionDepth = depth;
      if (/@media[^{]*\bmax-width\b/.test(raw) && !/\bmin-width\b/.test(raw)) {
        add('desktop-first', 'warning', n, line, 'write the base styles for small screens and add min-width queries upward');
      }
      // Media and container query conditions ("(min-width: 768px)") are not declarations.
      const decl = raw.replace(/@(media|container)[^{]*/g, ' ');
      {
        for (const m of decl.matchAll(/(?<![\w-])(margin|padding|border)-(left|right)(-[a-z]+)?\s*:/g)) {
          add('physical', 'warning', n, m[0], `use ${m[1]}-inline-${m[2] === 'left' ? 'start' : 'end'}${m[3] ?? ''} so RTL works`);
        }
        for (const m of decl.matchAll(/(?<![\w-])(left|right)\s*:\s*([^;}\n]+)/g)) {
          if (!/^(0|50%|auto)\b/.test(m[2].trim())) add('physical', 'warning', n, m[0], `use inset-inline-${m[1] === 'left' ? 'start' : 'end'}`);
        }
        for (const m of decl.matchAll(/(text-align|float|clear)\s*:\s*(left|right)\b/g)) {
          add('physical', 'warning', n, m[0], `use ${m[1]}: ${m[2] === 'left' ? 'start' : 'end'}`);
        }
        for (const m of decl.matchAll(/(?<![\w-])(min-|max-)?(height|min-height)\s*:\s*100vh/g)) {
          add('viewport-height', 'warning', n, m[0], 'use 100dvh (or 100svh): vh ignores the mobile browser bars');
        }
        for (const m of decl.matchAll(/(?<![\w-])(min-)?width\s*:\s*(\d+)px/g)) {
          if (Number(m[2]) >= 480) add('fixed-width', 'warning', n, m[0], 'use width: 100% with a max-width token, so it shrinks on phones');
        }
        for (const m of decl.matchAll(/font-size\s*:\s*[\d.]+px/g)) add('font-px', 'warning', n, m[0], 'use rem (or a token / clamp) so text follows the user\'s size setting');
        if (/!important/.test(decl) && reducedMotionDepth < 0) add('important', 'warning', n, line, 'lower the specificity instead (classes, no IDs); !important is only for the reduced-motion reset');
        for (const m of decl.matchAll(/outline\s*:\s*(none|0)\b/g)) {
          if (!hasFocusVisible) add('focus-removed', 'error', n, m[0], 'keep a visible focus style: add a :focus-visible outline');
        }
      }
      for (const ch of raw) {
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth <= reducedMotionDepth) reducedMotionDepth = -1; }
      }
    }

    if (CLASS_CONTEXT.test(raw)) {
      for (const m of raw.matchAll(/(?<![\w:-])max-(sm|md|lg|xl|2xl):/g)) {
        add('desktop-first', 'warning', n, m[0], `start from mobile: put the small-screen value unprefixed and use ${m[1]}: for larger screens`);
      }
      for (const m of raw.matchAll(PHYSICAL_TW)) {
        const token = m[0].replace(/^-/, '');
        if (/^(left|right)-1\/2$/.test(token)) continue; // centring with left-1/2 is direction-neutral
        const key = Object.keys(LOGICAL_FIX).sort((a, b) => b.length - a.length).find((k) => token === k || token.startsWith(`${k}-`));
        if (key) add('physical', 'warning', n, m[0], `use ${m[0].startsWith('-') ? '-' : ''}${LOGICAL_FIX[key].replace(/-$/, '')}${token.slice(key.length)} so RTL works`);
      }
      for (const m of raw.matchAll(/(?<![\w-])(min-h|h|max-h)-screen(?![\w-])/g)) {
        add('viewport-height', 'warning', n, m[0], `use ${m[1]}-dvh (or ${m[1]}-svh): screen means 100vh`);
      }
      for (const m of raw.matchAll(/(?<![\w-])(min-w|w)-\[(\d+)px\]/g)) {
        if (Number(m[2]) >= 480) add('fixed-width', 'warning', n, m[0], 'use w-full with a max-w token');
      }
      for (const m of raw.matchAll(/(?<![\w-])text-\[[\d.]+px\]/g)) add('font-px', 'warning', n, m[0], 'use a type token (text-body, text-title…) or rem');
      if (/(?<![\w:-])outline-(none|hidden)(?![\w-])/.test(raw) && !/focus(-visible)?:(outline|ring)/.test(raw)) {
        add('focus-removed', 'error', n, 'outline-none', 'add a visible focus style on the same element, e.g. focus-visible:outline-2');
      }
    }

    if (isCode || (isHtml && !cssLike)) {
      for (const m of raw.matchAll(/\bkey\s*=\s*\{\s*(index|idx|i)\s*\}/g)) add('index-key', 'warning', n, m[0], 'use a stable id from the data (id, slug); index keys break when the list reorders or filters');
      if (/\bconsole\.(log|debug)\(|^\s*debugger\s*;?/.test(raw)) add('console', 'warning', n, line, 'remove debugging output before handover');
      if (/dangerouslySetInnerHTML|\.innerHTML\s*=(?!=)/.test(raw)) add('raw-html', 'warning', n, line, 'render text with JSX / textContent; if HTML must render, sanitise it (DOMPurify) and say why');
    }
  });
  return findings;
}

export const LAYOUT_LINTABLE = /\.(css|scss|sass|less|html?|jsx?|tsx?|mjs|cjs|vue|svelte)$/i;
