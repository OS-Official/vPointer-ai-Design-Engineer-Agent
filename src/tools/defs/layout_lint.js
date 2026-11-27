import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isInside, isSecretPath } from '../../security/guard.js';
import { walkFiles, isCompiled } from '../lib.js';
import { lintLayout, LAYOUT_LINTABLE } from '../../lint/layout.js';

export default {
  name: 'layout_lint',
  description: 'Check front-end code against the responsive-grid and clean-code standards: zoom blocked, missing viewport, images without alt or size, removed focus outlines (errors); desktop-first max-width queries, physical left/right instead of logical properties (RTL), 100vh / h-screen, fixed px widths, px font sizes, !important, index keys, console.log, raw HTML, target=_blank without rel (warnings). Works on CSS, HTML, JSX/TSX and Tailwind classes. Run it before reporting front-end work done; fix every error.',
  input: {
    target: z.string().default('.').describe('File or folder inside the project'),
  },
  readOnly: true,
  async run({ target }, ctx) {
    if (!isInside(target, ctx.roots)) throw new Error('Target is outside the project folder.');
    const abs = path.resolve(ctx.roots[0], target);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) throw new Error(`Not found: ${target}`);
    const files = (stat.isDirectory() ? await walkFiles(abs) : [abs])
      .filter((f) => LAYOUT_LINTABLE.test(f) && !isSecretPath(f) && !/\.min\.(js|css)$/.test(f) && !/(^|[/\\])(dist|build|\.next|out|coverage)[/\\]/.test(path.relative(ctx.roots[0], f)));

    const findings = [];
    const skipped = []; // build output (compiled Tailwind, minified bundles): lint the source instead
    for (const f of files) {
      if ((await fs.stat(f)).size > 500_000) continue;
      const text = await fs.readFile(f, 'utf8');
      if (isCompiled(text)) { skipped.push(path.relative(ctx.roots[0], f)); continue; }
      findings.push(...lintLayout(text, path.relative(ctx.roots[0], f)));
    }
    const errors = findings.filter((f) => f.severity === 'error').length;
    const byRule = findings.reduce((acc, f) => ({ ...acc, [f.rule]: (acc[f.rule] ?? 0) + 1 }), {});
    return {
      scannedFiles: files.length - skipped.length,
      ...(skipped.length ? { skippedBuildOutput: skipped } : {}),
      verdict: !findings.length ? 'clean' : `${errors} error(s), ${findings.length - errors} warning(s)`,
      byRule,
      findings: findings.slice(0, 150),
      ...(findings.length > 150 ? { note: `Showing 150 of ${findings.length}; lint a smaller folder for the rest.` } : {}),
    };
  },
};
