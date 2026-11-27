import { z } from 'zod';
import { fluidClamp } from '../lib.js';

export default {
  name: 'fluid_clamp',
  description: 'Exact CSS clamp() for fluid type or spacing between two viewport widths.',
  input: {
    minPx: z.number(),
    maxPx: z.number(),
    minViewportPx: z.number().positive().default(375),
    maxViewportPx: z.number().positive().default(1440),
  },
  readOnly: true,
  async run(args) {
    return fluidClamp(args);
  },
};
