import fs from 'node:fs/promises';
import path from 'node:path';
import { STANDARDS_DIR } from '../config.js';
import { parseFrontmatter } from './frontmatter.js';

/*
 * Standards are skill-style knowledge packs the agents follow:
 *
 *   standards/<name>/SKILL.md          frontmatter (name, description, optional brand) + the rules
 *   standards/<name>/references/*.md   longer material, read on demand with design:get_standard
 *
 * A specialist lists the standards it follows in its own frontmatter (`standards: responsive-grid, clean-code`):
 * their SKILL.md is added to its instructions. The lead sees the list and loads one with get_standard
 * when a task needs it. A standard with `brand: northwind` only applies when the session's project uses that brand.
 * Folders starting with "_" are ignored (templates, drafts).
 */

const NAME = /^[a-z][a-z0-9-]*$/;
const REF = /^[a-z0-9][a-z0-9-]*\.md$/;

export async function loadStandards(dir = STANDARDS_DIR) {
  const standards = {};
  const errors = [];
  const warnings = [];
  let entries = [];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort();
  } catch {
    return { standards, errors, warnings }; // no standards folder: nothing to follow, not an error
  }

  for (const folder of entries) {
    const rel = `standards/${folder}/SKILL.md`;
    let parsed;
    try {
      parsed = parseFrontmatter(await fs.readFile(path.join(dir, folder, 'SKILL.md'), 'utf8'), rel);
    } catch (e) {
      errors.push(e.code === 'ENOENT' ? `standards/${folder}: SKILL.md is missing` : e.message);
      continue;
    }
    const { data, body } = parsed;
    const problems = [];
    if (!NAME.test(folder)) problems.push(`standards/${folder}: folder name must be lowercase-with-hyphens`);
    if (data.name !== folder) problems.push(`${rel}: name must match the folder ("${folder}")`);
    if (typeof data.description !== 'string' || data.description.length < 20) problems.push(`${rel}: description is missing or too short; it says when the standard applies`);
    if (!body) problems.push(`${rel}: no rules below the --- block`);
    if (data.brand !== undefined && !NAME.test(String(data.brand))) problems.push(`${rel}: brand must be a brand slug, e.g. northwind`);
    if (problems.length) { errors.push(...problems); continue; }

    const refDir = path.join(dir, folder, 'references');
    const references = (await fs.readdir(refDir).catch(() => [])).filter((f) => REF.test(f)).sort();
    for (const m of body.matchAll(/references\/([a-z0-9-]+\.md)/g)) {
      if (!references.includes(m[1])) warnings.push(`${rel}: mentions references/${m[1]}, which doesn't exist`);
    }
    standards[folder] = { name: folder, description: data.description, brand: data.brand ? String(data.brand) : null, body, references, dir: path.join(dir, folder) };
  }
  return { standards, errors, warnings };
}

/** Standards that apply in this session: general ones, plus those for the active brand. */
export function activeStandards(standards, brand) {
  return Object.fromEntries(Object.entries(standards).filter(([, s]) => !s.brand || s.brand === brand));
}

/** Read one standard (SKILL.md) or one of its reference files. */
export async function readStandard(name, reference, dir = STANDARDS_DIR) {
  if (!NAME.test(name ?? '')) throw new Error('Standard names are lowercase-with-hyphens.');
  const { standards } = await loadStandards(dir);
  const s = Object.hasOwn(standards, name) ? standards[name] : null;
  if (!s) throw new Error(`No standard "${name}". Standards: ${Object.keys(standards).join(', ') || 'none'}`);
  if (!reference) {
    const refs = s.references.length ? `\n\n---\nReference files (get_standard with reference): ${s.references.join(', ')}` : '';
    return `<!-- standard: ${name}${s.brand ? ` (brand ${s.brand})` : ''} -->\n${s.body}${refs}`;
  }
  const file = reference.endsWith('.md') ? reference : `${reference}.md`;
  if (!s.references.includes(file)) throw new Error(`standards/${name} has no reference "${file}". References: ${s.references.join(', ') || 'none'}`);
  return `<!-- standard: ${name}, references/${file} -->\n${await fs.readFile(path.join(s.dir, 'references', file), 'utf8')}`;
}

/**
 * Add each specialist's standards to its instructions. Brand standards for another brand are
 * left out (and noted), so one brand's rules never leak into another brand's session.
 */
export function applyStandards(specialists, standards, { brand = null } = {}) {
  const active = activeStandards(standards, brand);
  return Object.fromEntries(Object.entries(specialists).map(([name, def]) => {
    const own = (def.standards ?? []).filter((s) => active[s]);
    if (!own.length) return [name, def];
    const sections = own.map((s) => {
      const st = active[s];
      const refs = st.references.length ? `\n\n(More detail: get_standard name "${s}", reference ${st.references.map((r) => `"${r.replace(/\.md$/, '')}"`).join(' or ')}.)` : '';
      return `\n\n# Standard: ${s}\n${st.body}${refs}`;
    });
    return [name, { ...def, prompt: `${def.prompt}\n\n# Standards you follow\nThese are part of your instructions. When one says to run a tool before reporting done, run it.${sections.join('')}` }];
  }));
}
