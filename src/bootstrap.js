import fs from 'node:fs/promises';
import { PROJECTS_DIR } from './config.js';
import { loadTools } from './tools/registry.js';
import { loadAgents } from './loaders/agents.js';
import { loadTasks } from './loaders/tasks.js';
import { listBrands, loadBrand, validateBrand, brandOfProject } from './brands/load.js';
import { loadMcp } from './mcp/config.js';
import { loadStandards } from './loaders/standards.js';

/**
 * Loads and validates everything you can edit: tools, standards, agents, tasks, projects.
 * Used by both `dea` (startup) and `npm run check`, so they always agree.
 */
export async function loadEverything({ local = false, env = process.env, onlyApps = null } = {}) {
  const { tools, errors: toolErrors } = await loadTools();
  const mcp = await loadMcp({ local, env });
  // Apps a chat has switched off for itself: treated like apps that are off (never the other way round).
  if (Array.isArray(onlyApps)) {
    for (const n of Object.keys(mcp.servers)) if (!onlyApps.includes(n)) { delete mcp.servers[n]; mcp.skipped[n] = 'off for this chat'; }
  }
  const apps = Object.keys(mcp.servers);
  const knownApps = [...apps, ...Object.keys(mcp.skipped)];
  const standardsResult = await loadStandards();
  const agentResult = await loadAgents({ designTools: tools.map((t) => t.name), apps, knownApps, knownStandards: Object.keys(standardsResult.standards) });
  const { tasks, errors: taskErrors } = await loadTasks();
  const projects = (await fs.readdir(PROJECTS_DIR).catch(() => []))
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => f.replace(/\.md$/, ''));

  const warnings = [...agentResult.warnings, ...mcp.warnings, ...standardsResult.warnings];
  const brandErrors = [];
  const brands = {};
  for (const slug of await listBrands()) {
    try {
      const b = await loadBrand(slug);
      const problems = validateBrand(b);
      if (problems.length) brandErrors.push(...problems);
      else brands[slug] = { name: b.meta.name, version: b.tokens.version, projects: [] };
    } catch (e) { brandErrors.push(e.message); }
  }
  for (const s of Object.values(standardsResult.standards)) {
    if (s.brand && !(await listBrands()).includes(s.brand)) warnings.push(`standards/${s.name}: brand "${s.brand}" has no brand pack in context/brands/`);
  }
  for (const p of projects) {
    const slug = await brandOfProject(p);
    if (!slug) continue;
    if (brands[slug]) brands[slug].projects.push(p);
    else brandErrors.push(`context/projects/${p}.md: **Brand:** ${slug} but context/brands/${slug} is missing or invalid`);
  }
  // A task that names a switched-off specialist won't be able to delegate to it.
  for (const task of Object.values(tasks)) {
    for (const off of agentResult.disabled) {
      if (new RegExp(`\\b${off}\\b`).test(task.body)) warnings.push(`tasks/${task.file}: mentions "${off}", which is disabled`);
    }
  }

  // Files created with `npm run new` that still contain the template's placeholder text.
  const unfinished = (text) => /^(Describe |What this task does)/.test(text ?? '');
  // Template placeholder lines: "1. …" on their own, or the template's role line.
  const placeholderBody = (text) => /^\s*\d+\.\s*…\s*$/m.test(text) || text.includes('(who they are, in one line)');
  for (const [name, def] of Object.entries(agentResult.specialists)) {
    if (unfinished(def.description) || placeholderBody(def.prompt)) warnings.push(`agents/${name}.md: still has template text; fill in the description and instructions`);
  }
  for (const t of Object.values(tasks)) {
    if (unfinished(t.description) || placeholderBody(t.body)) warnings.push(`tasks/${t.file}: still has template text`);
  }
  for (const st of Object.values(standardsResult.standards)) {
    if (unfinished(st.description) || placeholderBody(st.body)) warnings.push(`standards/${st.name}/SKILL.md: still has template text`);
  }
  for (const t of tools) {
    if (unfinished(t.description)) warnings.push(`src/tools/defs/${t.file}: still has template text`);
  }

  return {
    tools,
    lead: agentResult.lead,
    specialists: agentResult.specialists,
    disabled: agentResult.disabled,
    waiting: agentResult.waiting,
    mcp,
    standards: standardsResult.standards,
    tasks,
    projects,
    brands,
    errors: [...toolErrors, ...standardsResult.errors, ...agentResult.errors, ...taskErrors, ...brandErrors, ...mcp.errors],
    warnings,
  };
}
