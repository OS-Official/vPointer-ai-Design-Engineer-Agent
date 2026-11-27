import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PROJECTS_DIR } from '../../config.js';
import { addDecision } from '../lib.js';

export default {
  name: 'record_decision',
  description: "Save a decision the user has approved (a tagline, a layout choice, a colour use, a page order) to the project brief's Decisions list, so every future session knows it. Only record what the user actually approved, in their words; never your own suggestion. The user is asked before each save.",
  input: {
    decision: z.string().min(5).max(300).describe('The approved decision, in one sentence'),
    why: z.string().max(200).optional().describe('Short reason, if the user gave one'),
    project: z.string().regex(/^[a-z0-9-]+$/).optional().describe('Project slug; defaults to the current --project'),
  },
  readOnly: false,
  async run({ decision, why, project }, ctx) {
    const slug = project ?? ctx.project;
    if (!slug) throw new Error('No project given and dea was started without --project.');
    const file = path.join(PROJECTS_DIR, `${slug}.md`);
    const brief = await fs.readFile(file, 'utf8').catch(() => null);
    if (brief === null) throw new Error(`No brief named "${slug}".`);
    await fs.writeFile(file, addDecision(brief, { decision, why }));
    return `Saved to context/projects/${slug}.md under Decisions.`;
  },
};
