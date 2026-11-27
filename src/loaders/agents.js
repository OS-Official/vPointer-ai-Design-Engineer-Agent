import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENTS_DIR } from '../config.js';
import { parseFrontmatter, toList } from './frontmatter.js';

/*
 * Loads agents/*.md:
 *   lead.md           → the lead agent's role and workflow (required)
 *   <specialist>.md   → one specialist each
 *   _anything.md      → ignored (templates, drafts)
 *
 * Tool names in the `tools:` line:
 *   Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch           built-in
 *   design:<name>  or  design:*                                       custom tools (src/tools/defs)
 *   <app>:<tool>   or  <app>:*                                        an app from mcp.json (figma:*, figma:get_screenshot …)
 * Optional `requires: figma` (comma list): the specialist only loads when those apps are on in mcp.json.
 * Optional `standards: responsive-grid, clean-code` (comma list): standards/<name>/SKILL.md is added to its instructions.
 */

export const BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'];
const MODELS = /^(inherit|opus|sonnet|haiku|fable|claude-[a-z0-9.-]+)$/;

export function resolveTools(list, { designTools, apps = [], knownApps = apps }, file) {
  const out = [];
  const errors = [];
  const warnings = [];
  for (const raw of list) {
    if (raw === 'design:*') { out.push(...designTools.map((n) => `mcp__design__${n}`)); continue; }
    const [prefix, name] = raw.includes(':') ? raw.split(':') : [null, raw];
    if (prefix === 'design') {
      if (designTools.includes(name)) out.push(`mcp__design__${name}`);
      else errors.push(`${file}: unknown custom tool "${raw}". Available: ${designTools.map((n) => `design:${n}`).join(', ')}`);
    } else if (prefix) {
      if (!name) errors.push(`${file}: "${raw}" needs a tool name or * after the colon`);
      else if (apps.includes(prefix)) out.push(`mcp__${prefix}__${name}`);
      else if (!knownApps.includes(prefix)) warnings.push(`${file}: "${raw}" skipped: no app "${prefix}" in mcp.json${apps.length ? ` (apps: ${apps.join(', ')})` : ''}`);
      // configured but switched off for this session: skip quietly, mcp.json already says why
    } else if (raw === 'Agent') {
      errors.push(`${file}: specialists cannot call other specialists (remove "Agent")`);
    } else if (BUILTIN_TOOLS.includes(raw)) {
      out.push(raw);
    } else {
      const near = BUILTIN_TOOLS.find((b) => b.toLowerCase() === raw.toLowerCase());
      errors.push(`${file}: unknown tool "${raw}"${near ? ` (did you mean "${near}"?)` : ''}. Built-ins: ${BUILTIN_TOOLS.join(', ')}`);
    }
  }
  return { tools: [...new Set(out)], errors, warnings };
}

/**
 * Returns { lead, specialists, disabled, errors, warnings }.
 * `specialists` is ready to pass as the SDK's `agents` option.
 */
export async function loadAgents({ dir = AGENTS_DIR, designTools = [], apps = [], knownApps = apps, knownStandards = null } = {}) {
  const errors = [];
  const warnings = [];
  const specialists = {};
  const disabled = [];
  const waiting = {}; // name → apps it needs that aren't connected
  let lead = null;

  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  } catch {
    return { lead, specialists, disabled, waiting: {}, errors: [`agents folder not found: ${dir}`], warnings };
  }

  for (const file of files) {
    let parsed;
    try {
      parsed = parseFrontmatter(await fs.readFile(path.join(dir, file), 'utf8'), file);
    } catch (e) { errors.push(e.message); continue; }
    const { data, body } = parsed;
    const name = String(data.name ?? '');

    if (name === 'lead') {
      if (!body) errors.push(`${file}: the lead agent needs instructions below the --- block`);
      lead = { body, file };
      continue;
    }

    const problems = [];
    if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`${file}: name must be lowercase-with-hyphens (got "${name}")`);
    if (Object.hasOwn(specialists, name)) problems.push(`${file}: duplicate agent name "${name}"`);
    if (typeof data.description !== 'string' || data.description.length < 20) problems.push(`${file}: description is missing or too short; the lead uses it to decide when to delegate`);
    if (!body) problems.push(`${file}: no instructions below the --- block`);
    if (data.model !== undefined && !MODELS.test(String(data.model))) problems.push(`${file}: model "${data.model}" not recognised (inherit, opus, sonnet, haiku, fable or a full model ID)`);
    if (data.maxTurns !== undefined && !(Number.isInteger(data.maxTurns) && data.maxTurns > 0)) problems.push(`${file}: maxTurns must be a whole number`);
    if (data.tools === undefined || toList(data.tools).length === 0) problems.push(`${file}: list the tools it may use (tools: Read, Glob, design:contrast_check …)`);
    if (name && file.replace(/\.md$/, '') !== name) warnings.push(`${file}: file name and name "${name}" differ; keep them the same to avoid confusion`);

    const needs = toList(data.requires);
    const missingApps = needs.filter((a) => !apps.includes(a));
    const resolved = resolveTools(toList(data.tools), { designTools, apps, knownApps: [...knownApps, ...needs] }, file);
    problems.push(...resolved.errors);
    if (!missingApps.length) warnings.push(...resolved.warnings);
    const standards = toList(data.standards);
    if (knownStandards) {
      for (const st of standards) if (!knownStandards.includes(st)) problems.push(`${file}: unknown standard "${st}". Standards: ${knownStandards.join(', ') || 'none (add one in standards/)'}`);
    }
    if (problems.length) { errors.push(...problems); continue; }

    if (data.enabled === false) { disabled.push(name); continue; }
    if (missingApps.length) { waiting[name] = missingApps; continue; }

    specialists[name] = {
      description: data.description,
      prompt: body,
      tools: resolved.tools,
      model: data.model ? String(data.model) : 'inherit',
      ...(standards.length ? { standards } : {}),
      ...(data.maxTurns ? { maxTurns: data.maxTurns } : {}),
    };
  }

  if (!lead) errors.push('agents/lead.md is missing: it defines how the lead agent works');
  if (!Object.keys(specialists).length) warnings.push('No specialists enabled; the lead will do everything itself.');
  return { lead, specialists, disabled, waiting, errors, warnings };
}
