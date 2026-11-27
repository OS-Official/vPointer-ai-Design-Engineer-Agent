import fs from 'node:fs/promises';
import path from 'node:path';
import { BRANDS_DIR, PROJECTS_DIR } from '../config.js';

/*
 * Brand packs live in context/brands/<slug>/:
 *   tokens.json   the design system's tokens (verbatim)        required
 *   brand.json    source, icon rules, web sizes, extra rules   required
 *   README.md, components.md, production.md, changelog.md, assets.md   optional, verbatim docs
 * A project brief links to a brand with a line:  **Brand:** northwind
 */

export const BRAND_DOCS = ['README.md', 'components.md', 'production.md', 'changelog.md', 'assets.md'];

export async function listBrands(dir = BRANDS_DIR) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort();
}

export async function loadBrand(slug, dir = BRANDS_DIR) {
  if (!/^[a-z0-9-]+$/.test(slug ?? '')) throw new Error(`Brand slug must be lowercase letters, digits and hyphens (got "${slug}")`);
  const base = path.join(dir, slug);
  let tokens, meta;
  try { tokens = JSON.parse(await fs.readFile(path.join(base, 'tokens.json'), 'utf8')); }
  catch (e) { throw new Error(`brands/${slug}/tokens.json: ${e.code === 'ENOENT' ? 'missing' : e.message}`); }
  try { meta = JSON.parse(await fs.readFile(path.join(base, 'brand.json'), 'utf8')); }
  catch (e) { throw new Error(`brands/${slug}/brand.json: ${e.code === 'ENOENT' ? 'missing' : e.message}`); }
  const docs = {};
  for (const f of BRAND_DOCS) {
    const text = await fs.readFile(path.join(base, f), 'utf8').catch(() => null);
    if (text) docs[f] = text;
  }
  return { slug, meta, tokens, docs };
}

/** Problems that would make the brand tools give wrong answers. */
export function validateBrand(brand) {
  const errors = [];
  const where = `brands/${brand.slug}`;
  const colours = brand.tokens?.color?.tokens;
  if (!Array.isArray(colours) || !colours.length) errors.push(`${where}/tokens.json: no color.tokens`);
  else for (const c of colours) if (!/^#[0-9a-f]{6}$/i.test(c.value ?? '')) errors.push(`${where}/tokens.json: colour "${c.name}" is not a #RRGGBB value`);
  if (!brand.tokens?.type?.families) errors.push(`${where}/tokens.json: no type.families`);
  if (!brand.meta?.name) errors.push(`${where}/brand.json: name is missing`);
  if (brand.meta?.tokensVersion !== undefined && brand.meta.tokensVersion !== brand.tokens?.version) {
    errors.push(`${where}: brand.json says tokens v${brand.meta.tokensVersion} but tokens.json is v${brand.tokens?.version}; re-import or update brand.json`);
  }
  return errors;
}

/** Reads "**Brand:** <slug>" from a project brief. Returns null when there is none. */
export function brandFromBrief(text) {
  return text.match(/^\*\*Brand:\*\*\s*([a-z0-9-]+)\s*$/im)?.[1] ?? null;
}

export async function brandOfProject(project, dir = PROJECTS_DIR) {
  if (!project || !/^[a-z0-9-]+$/.test(project)) return null;
  const text = await fs.readFile(path.join(dir, `${project}.md`), 'utf8').catch(() => '');
  return brandFromBrief(text);
}

/** A section of a Markdown doc, from its "## Heading" to the next heading of the same level. */
export function mdSection(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.replace(/^#+\s*/, '').trim().toLowerCase() === heading.toLowerCase() && /^##\s/.test(l));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n').trim();
}

/** Compact brand summary for small context windows: principles + every exact token name and value. */
export function brandEssentials(brand) {
  const { tokens, meta } = brand;
  const readme = brand.docs['README.md'] ?? '';
  const weights = [...new Set(tokens.type.groups.flatMap((g) => g.styles.map((s) => s.fontWeight)))].sort();
  const parts = [
    mdSection(readme, 'Principles'),
    '## Colour tokens (only these)',
    tokens.color.tokens.map((c) => `${c.name} ${c.value}`).join(' · '),
    '## Type',
    ...Object.entries(tokens.type.families).map(([k, v]) => `- ${k}: ${v}`),
    `- weights: ${weights.join(', ')} only`,
    `- radius: ${(tokens.radius?.tokens ?? []).map((t) => `${t.name} ${t.value}`).join(', ') || 'not set'}`,
    `- opacity steps: ${(tokens.opacity?.tokens ?? []).map((t) => t.value).join(', ')}`,
    `- shadows: ${(tokens.shadow?.tokens ?? []).map((t) => `${t.name} (${t.usage?.split('.')[0] ?? ''})`).join('; ') || 'none'}`,
    meta.icon ? `- icons: ${meta.icon.grid} grid, stroke ${meta.icon.strokeWidth}, ${meta.icon.linecap} caps, ${meta.icon.linejoin} joins, fill ${meta.icon.fill}` : '',
    'Everything else (colour roles, type styles, grid, components, templates, preflight): call get_brand.',
  ];
  return parts.filter(Boolean).join('\n');
}
