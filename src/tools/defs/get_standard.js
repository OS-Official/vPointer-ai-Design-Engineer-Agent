import { z } from 'zod';
import { activeStandards, loadStandards, readStandard } from '../../loaders/standards.js';

export default {
  name: 'get_standard',
  description: 'Read one of the working standards (skill-style rule packs in standards/): its rules, or one of its reference files with code patterns and checklists. With no name, lists the standards that apply to this session. Load the matching standard before building, changing or reviewing work it covers (layout, code, brand application).',
  input: {
    name: z.string().regex(/^[a-z][a-z0-9-]*$/).optional().describe('Standard name, e.g. responsive-grid; omit to list them'),
    reference: z.string().regex(/^[a-z0-9][a-z0-9-]*(\.md)?$/).optional().describe('A reference file of that standard, e.g. patterns'),
  },
  readOnly: true,
  async run({ name, reference }, ctx) {
    if (!name) {
      const { standards } = await loadStandards();
      const active = activeStandards(standards, ctx.brand ?? null);
      return Object.values(active).map((s) => ({ name: s.name, description: s.description, references: s.references }));
    }
    return readStandard(name, reference);
  },
};
