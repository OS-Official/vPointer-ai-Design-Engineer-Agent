import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PROJECTS_DIR } from '../../config.js';

export default {
  name: 'get_project_brief',
  description: 'Load the full brief for one project (brand rules, colours, fonts, stack, status). Use the slug from list_projects.',
  input: { slug: z.string().regex(/^[a-z0-9-]+$/, 'slug: lowercase letters, digits, hyphens') },
  readOnly: true,
  async run({ slug }) {
    try {
      return await fs.readFile(path.join(PROJECTS_DIR, `${slug}.md`), 'utf8');
    } catch {
      throw new Error(`No brief named "${slug}". Call list_projects first.`);
    }
  },
};
