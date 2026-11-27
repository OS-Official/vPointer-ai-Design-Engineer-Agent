import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isInside, isSecretPath } from '../../security/guard.js';
import { walkFiles, isCompiled } from '../lib.js';
import { loadBrand } from '../../brands/load.js';
import { compileRules, lintText } from '../../brands/lint.js';

const LINTABLE = /\.(css|scss|sass|less|html?|jsx?|tsx?|mjs|cjs|vue|svelte|svg)$/i;

export default {
  name: 'brand_lint',
  description: 'Check code against the brand pack: off-brand colours (with the nearest token), fonts, font weights, corner radius, shadows, opacity steps and justified text, in CSS, HTML, JSX/TSX, Tailwind classes and SVG. Run it before reporting any front-end work as done, and fix every finding.',
  input: {
    target: z.string().default('.').describe('File or folder inside the project'),
    brand: z.string().regex(/^[a-z0-9-]+$/).optional().describe('Brand slug; defaults to the brand of the current --project'),
  },
  readOnly: true,
  async run({ target, brand }, ctx) {
    const slug = brand ?? ctx.brand;
    if (!slug) throw new Error('No brand given and the current project has none.');
    if (!isInside(target, ctx.roots)) throw new Error('Target is outside the project folder.');
    const rules = compileRules(await loadBrand(slug));
    const abs = path.resolve(ctx.roots[0], target);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) throw new Error(`Not found: ${target}`);
    const files = (stat.isDirectory() ? await walkFiles(abs) : [abs]).filter((f) => LINTABLE.test(f) && !isSecretPath(f) && !/\.min\.(js|css)$/.test(f));

    const findings = [];
    const skipped = []; // build output (compiled Tailwind, minified bundles): lint the source instead
    for (const f of files) {
      if ((await fs.stat(f)).size > 500_000) continue;
      const text = await fs.readFile(f, 'utf8');
      if (isCompiled(text)) { skipped.push(path.relative(ctx.roots[0], f)); continue; }
      findings.push(...lintText(text, path.relative(ctx.roots[0], f), rules));
    }
    const byRule = findings.reduce((acc, f) => ({ ...acc, [f.rule]: (acc[f.rule] ?? 0) + 1 }), {});
    return {
      brand: rules.brand,
      scannedFiles: files.length - skipped.length,
      ...(skipped.length ? { skippedBuildOutput: skipped } : {}),
      verdict: findings.length ? `${findings.length} off-brand value(s)` : 'on brand',
      byRule,
      findings: findings.slice(0, 150),
      ...(findings.length > 150 ? { note: `Showing 150 of ${findings.length}; lint a smaller folder for the rest.` } : {}),
    };
  },
};
