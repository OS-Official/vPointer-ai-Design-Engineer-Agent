import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isInside } from '../../security/guard.js';
import { headerReport } from '../lib.js';

export default {
  name: 'audit_security_headers',
  description: 'Audit security headers in vercel.json, a Cloudflare/Netlify `_headers` file, or an HTML file. Returns missing headers and a ready-to-merge vercel.json snippet.',
  input: { file: z.string() },
  readOnly: true,
  async run({ file }, { roots }) {
    if (!isInside(file, roots)) throw new Error('File is outside the project folder.');
    let text;
    try {
      text = await fs.readFile(path.resolve(roots[0], file), 'utf8');
    } catch (e) {
      throw new Error(`Could not read ${file}: ${e.message}`);
    }
    try {
      return headerReport(path.basename(file), text);
    } catch (e) {
      throw new Error(`${file} could not be parsed: ${e.message}`);
    }
  },
};
