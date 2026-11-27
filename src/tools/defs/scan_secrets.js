import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isInside, isSecretPath } from '../../security/guard.js';
import { scanText, walkFiles, TEXT_EXT } from '../lib.js';

export default {
  name: 'scan_secrets',
  description: 'Scan a folder or file inside the project for leaked API keys, private keys, Supabase service_role keys and hard-coded passwords. Values are masked. Skips .env files (expected to hold secrets) and checks that .env is git-ignored.',
  input: { target: z.string().default('.') },
  readOnly: true,
  async run({ target }, { roots }) {
    if (!isInside(target, roots)) throw new Error('Target is outside the project folder.');
    const abs = path.resolve(roots[0], target);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) throw new Error(`Not found: ${target}`);

    const files = stat.isDirectory() ? await walkFiles(abs) : [abs];
    const findings = [];
    let scanned = 0;
    for (const f of files) {
      if (isSecretPath(f) || !TEXT_EXT.test(f)) continue;
      const s = await fs.stat(f);
      if (s.size > 1_000_000) continue;
      scanned++;
      findings.push(...scanText(await fs.readFile(f, 'utf8'), path.relative(roots[0], f)));
    }

    const notes = [];
    const gitignore = await fs.readFile(path.join(roots[0], '.gitignore'), 'utf8').catch(() => null);
    const hasEnv = files.some((f) => /(^|[\\/])\.env(\.[a-z]+)?$/i.test(f) && !/\.(example|sample|template)$/i.test(f));
    if (hasEnv && (!gitignore || !/^\.env/m.test(gitignore))) notes.push('A .env file exists but .gitignore does not exclude .env*. Add it before the next commit.');
    if (files.length >= 3000) notes.push('Stopped after 3000 files; scan a sub-folder for full coverage.');
    return { scannedFiles: scanned, findings, notes, verdict: findings.length ? 'ACTION NEEDED' : 'clean' };
  },
};
