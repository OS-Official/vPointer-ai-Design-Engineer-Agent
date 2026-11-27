import { z } from 'zod';
import { wcagReport } from '../lib.js';

export default {
  name: 'contrast_check',
  description: 'Exact WCAG 2.2 contrast ratio between colours. Pass pairs of hex colours. Never estimate contrast; always use this.',
  input: {
    pairs: z.array(z.object({
      foreground: z.string(),
      background: z.string(),
      fontSizePx: z.number().positive().optional(),
      bold: z.boolean().optional(),
    })).min(1).max(50),
  },
  readOnly: true,
  async run({ pairs }) {
    return pairs.map((p) => wcagReport(p.foreground, p.background, p.fontSizePx ?? 16, p.bold ?? false));
  },
};
