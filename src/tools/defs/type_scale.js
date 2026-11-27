import { z } from 'zod';
import { typeScale } from '../lib.js';

export default {
  name: 'type_scale',
  description: 'Generate a modular type scale (px + rem + Tailwind step names). Common ratios: 1.125 minor second, 1.2 minor third, 1.25 major third, 1.333 perfect fourth, 1.5 perfect fifth.',
  input: {
    basePx: z.number().positive().default(16),
    ratio: z.number().min(1.01).max(2).default(1.25),
    stepsUp: z.number().int().min(0).max(8).default(6),
    stepsDown: z.number().int().min(0).max(2).default(2),
  },
  readOnly: true,
  async run(args) {
    return typeScale(args);
  },
};
