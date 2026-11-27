import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR } from '../../config.js';

export default {
  name: 'list_projects',
  description: "List the user's client/brand projects with a one-line summary each. Call before any project-specific work.",
  input: {},
  readOnly: true,
  async run() {
    const files = (await fs.readdir(PROJECTS_DIR)).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    if (!files.length) return 'No project briefs yet. Add one in context/projects/.';
    const rows = await Promise.all(files.map(async (f) => {
      const text = await fs.readFile(path.join(PROJECTS_DIR, f), 'utf8');
      const title = text.match(/^#\s+(.+)$/m)?.[1] ?? f;
      const type = text.match(/\*\*Type:\*\*\s*(.+)$/m)?.[1] ?? '';
      return `- ${f.replace(/\.md$/, '')}: ${title}${type ? ` (${type})` : ''}`;
    }));
    return rows.join('\n');
  },
};
