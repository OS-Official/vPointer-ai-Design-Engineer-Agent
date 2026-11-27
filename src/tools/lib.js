import fs from 'node:fs/promises';
import path from 'node:path';

/*
 * Pure helper functions behind the custom design tools.
 * Deterministic maths and checks, so the agent never "eyeballs" a number.
 */

// ---------- Colour / WCAG ----------
export function parseHex(hex) {
  const m = String(hex).trim().replace(/^#/, '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** WCAG 2.2 large text = ≥24px regular or ≥18.66px (14pt) bold. */
export function wcagReport(fg, bg, fontSizePx = 16, bold = false) {
  const ratio = contrastRatio(fg, bg);
  const large = fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
  const r = Math.floor(ratio * 100) / 100; // floor so 4.499 never reads as 4.5
  return {
    foreground: fg,
    background: bg,
    ratio: r,
    textSize: large ? 'large' : 'normal',
    AA_text: ratio >= (large ? 3 : 4.5),
    AAA_text: ratio >= (large ? 4.5 : 7),
    AA_ui_components: ratio >= 3,
  };
}

// ---------- Typography ----------
export function typeScale({ basePx = 16, ratio = 1.25, stepsUp = 6, stepsDown = 2, rootPx = 16 }) {
  const names = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'];
  const baseIndex = 2;
  const out = [];
  for (let s = -stepsDown; s <= stepsUp; s++) {
    const px = basePx * ratio ** s;
    out.push({
      step: s,
      tailwindName: names[baseIndex + s] ?? `step${s}`,
      px: Math.round(px * 100) / 100,
      rem: Math.round((px / rootPx) * 10000) / 10000,
    });
  }
  return out;
}

/** CSS clamp() that scales linearly between two viewport widths. */
export function fluidClamp({ minPx, maxPx, minViewportPx = 375, maxViewportPx = 1440, rootPx = 16 }) {
  if (maxViewportPx <= minViewportPx) throw new Error('maxViewportPx must be larger than minViewportPx');
  const slope = (maxPx - minPx) / (maxViewportPx - minViewportPx);
  const interceptPx = minPx - slope * minViewportPx;
  const r = (n) => Math.round(n * 10000) / 10000;
  const lo = Math.min(minPx, maxPx), hi = Math.max(minPx, maxPx);
  return `clamp(${r(lo / rootPx)}rem, ${r(interceptPx / rootPx)}rem + ${r(slope * 100)}vw, ${r(hi / rootPx)}rem)`;
}

// ---------- Arabic MSA ----------
// Harakat, tanween, shadda, sukun (064B–0652), superscript alef (0670) and Quranic marks.
// U+0653–0655 (maddah, hamza above/below) are deliberately NOT here: in decomposed text
// they are part of the letter (آ أ إ), and stripping them would change the spelling.
const DIACRITICS = /[ً-ْٖ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const LATIN_DIGITS = /[0-9]/;
const ARABIC_INDIC_DIGITS = /[٠-٩]/;
const LATIN_PUNCT_IN_ARABIC = /[؀-ۿ]\s*[,;?](?=\s|$)/g;

export function arabicCheck(input) {
  const text = String(input).normalize('NFC'); // recombine decomposed letters (ا + ٔ → أ)
  const diacritics = (text.match(DIACRITICS) || []).length;
  const tatweel = (text.match(TATWEEL) || []).length;
  const latinPunct = (text.match(LATIN_PUNCT_IN_ARABIC) || []).length;
  const mixedDigits = LATIN_DIGITS.test(text) && ARABIC_INDIC_DIGITS.test(text);
  const issues = [];
  if (diacritics) issues.push(`${diacritics} diacritic mark(s): house style is no diacritics.`);
  if (tatweel) issues.push(`${tatweel} tatweel (ـ) character(s): remove, use letter-spacing in CSS if needed.`);
  if (latinPunct) issues.push(`${latinPunct} Latin punctuation mark(s) after Arabic text: use ، ؛ ؟ instead of , ; ?`);
  if (mixedDigits) issues.push('Mixes Western (0-9) and Arabic-Indic (٠-٩) digits: pick one per document.');
  const cleaned = text
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/([؀-ۿ])\s*,(?=\s|$)/g, '$1،')
    .replace(/([؀-ۿ])\s*;(?=\s|$)/g, '$1؛')
    .replace(/([؀-ۿ])\s*\?(?=\s|$)/g, '$1؟');
  return { ok: issues.length === 0, issues, cleaned, words: text.trim().split(/\s+/).filter(Boolean).length };
}

// ---------- Security: secrets ----------
export const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI-style key', re: /\bsk-(proj-)?[A-Za-z0-9]{20,}/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'Stripe live key', re: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/g },
  { name: 'JWT (check: Supabase service_role?)', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'Hard-coded password', re: /\b(password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{6,}["']/gi },
];

export function mask(s) {
  return s.length <= 10 ? '****' : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/** Scan a text blob; returns findings with masked values (never the raw secret). */
export function scanText(text, file = '') {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        let kind = name;
        if (name.startsWith('JWT')) {
          try {
            const payload = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString());
            if (payload.role === 'service_role') kind = 'Supabase SERVICE_ROLE key (must never ship to the browser)';
            else if (payload.role === 'anon') continue; // anon key is public by design
            else kind = 'JWT';
          } catch { kind = 'JWT'; }
        }
        findings.push({ file, line: i + 1, kind, value: mask(m[0]) });
      }
    }
  });
  return findings;
}

// ---------- Security: headers ----------
export const RECOMMENDED_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/** Extract header names from vercel.json, a Netlify/Cloudflare `_headers` file, or HTML meta tags. */
export function extractHeaders(fileName, text) {
  const found = new Set();
  if (/vercel\.json$/i.test(fileName)) {
    const cfg = JSON.parse(text);
    for (const block of cfg.headers ?? []) for (const h of block.headers ?? []) found.add(h.key.toLowerCase());
  } else if (/_headers$/i.test(fileName)) {
    for (const line of text.split('\n')) {
      const m = line.match(/^\s+([A-Za-z-]+)\s*:/);
      if (m) found.add(m[1].toLowerCase());
    }
  } else if (/\.html?$/i.test(fileName)) {
    for (const m of text.matchAll(/<meta[^>]+http-equiv=["']([^"']+)["']/gi)) found.add(m[1].toLowerCase());
  }
  return found;
}

export function headerReport(fileName, text) {
  const found = extractHeaders(fileName, text);
  const missing = Object.keys(RECOMMENDED_HEADERS).filter((h) => {
    if (h === 'X-Frame-Options' && found.has('content-security-policy')) return false; // frame-ancestors covers it
    return !found.has(h.toLowerCase());
  });
  const vercelSnippet = {
    headers: [{ source: '/(.*)', headers: missing.map((key) => ({ key, value: RECOMMENDED_HEADERS[key] })) }],
  };
  return { file: fileName, present: [...found], missing, vercelSnippet: missing.length ? vercelSnippet : null };
}

// ---------- Files ----------
export const TEXT_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|json|html?|css|scss|md|ya?ml|toml|example|php|py|txt|svg)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.vercel', '.cache', 'vendor']);

/**
 * List files under `dir` (max depth 8, max 3000 files). Symlinks are skipped so a
 * link inside the project can never lead the scan to files outside it.
 */
/** Build output that linters should not judge (the source it was built from is linted instead). */
export function isCompiled(text) {
  const head = text.slice(0, 300);
  return /\/\*! tailwindcss v\d/.test(head) || /^\/\*!? ?(For license information|webpack|esbuild)/m.test(head) || (text.length > 2000 && !text.slice(0, 2000).includes('\n'));
}

export async function walkFiles(dir, files = [], depth = 0) {
  if (depth > 8 || files.length >= 3000) return files;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (files.length >= 3000) break;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkFiles(full, files, depth + 1);
    } else if (entry.isFile()) files.push(full);
  }
  return files;
}

// ---------- Project decisions ----------
/**
 * Add "- YYYY-MM-DD: decision — why" at the end of the brief's "## Decisions" section
 * (created at the end of the file if missing). Returns the new file text.
 */
export function addDecision(brief, { decision, why, date = new Date().toISOString().slice(0, 10) }) {
  const entry = `- ${date}: ${decision.trim().replace(/\s+/g, ' ')}${why ? ` (${why.trim().replace(/\s+/g, ' ')})` : ''}`;
  const lines = brief.replace(/\s+$/, '').split('\n');
  const start = lines.findIndex((l) => /^##\s+Decisions\s*$/i.test(l));
  if (start === -1) return `${lines.join('\n')}\n\n## Decisions\n${entry}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  let insertAt = end;
  while (insertAt > start + 1 && !lines[insertAt - 1].trim()) insertAt--;
  lines.splice(insertAt, 0, entry);
  return `${lines.join('\n')}\n`;
}
