import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isInside } from '../../security/guard.js';
import { walkFiles } from '../lib.js';
import { loadBrand } from '../../brands/load.js';
import { compileRules, lintIcon } from '../../brands/lint.js';

export default {
  name: 'icon_lint',
  description: "Check SVG icons against the brand's icon rules (grid/viewBox, stroke width, square caps, mitred joins, no fills, icon colours). Pass one .svg, a folder of icons, or raw SVG markup. Run it on every icon you draw or edit before showing it.",
  input: {
    target: z.string().optional().describe('An .svg file or folder inside the project'),
    svg: z.string().max(200000).optional().describe('Raw SVG markup to check instead of a file'),
    brand: z.string().regex(/^[a-z0-9-]+$/).optional(),
  },
  readOnly: true,
  async run({ target, svg, brand }, ctx) {
    const slug = brand ?? ctx.brand;
    if (!slug) throw new Error('No brand given and the current project has none.');
    const b = await loadBrand(slug);
    if (!b.meta.icon) throw new Error(`brands/${slug}/brand.json has no "icon" rules`);
    const { palette } = compileRules(b);

    const inputs = [];
    if (svg) inputs.push(['(markup)', svg]);
    if (target) {
      if (!isInside(target, ctx.roots)) throw new Error('Target is outside the project folder.');
      const abs = path.resolve(ctx.roots[0], target);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) throw new Error(`Not found: ${target}`);
      for (const f of (stat.isDirectory() ? await walkFiles(abs) : [abs]).filter((x) => /\.svg$/i.test(x)).slice(0, 300)) {
        inputs.push([path.relative(ctx.roots[0], f), await fs.readFile(f, 'utf8')]);
      }
    }
    if (!inputs.length) throw new Error('Give an .svg target or svg markup.');

    const results = inputs.map(([file, text]) => ({ file, ...lintIcon(text, file, b.meta.icon, palette) }));
    const failing = results.filter((r) => r.findings.length);
    return {
      rules: b.meta.icon,
      checked: results.length,
      verdict: failing.length ? `${failing.length} of ${results.length} icon(s) off the brand grid` : 'all icons match',
      results: failing.length ? failing : results.map((r) => ({ file: r.file, shapes: r.shapes })),
    };
  },
};
