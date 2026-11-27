import { z } from 'zod';
import { listBrands, loadBrand } from '../../brands/load.js';

const SECTIONS = ['overview', 'tokens', 'components', 'production', 'changelog', 'assets'];
const FILE = { overview: 'README.md', components: 'components.md', production: 'production.md', changelog: 'changelog.md', assets: 'assets.md' };

function tokenSummary({ tokens, meta, slug }) {
  const out = [`# ${meta.name} tokens v${tokens.version} (context/brands/${slug}/tokens.json)`, ''];
  out.push('## Colours', '| token | hex | usage |', '| --- | --- | --- |');
  for (const c of tokens.color.tokens) out.push(`| ${c.name} | ${c.value} | ${c.usage ?? ''} |`);
  out.push('', '## Type families');
  for (const [k, v] of Object.entries(tokens.type.families)) out.push(`- ${k}: ${v}`);
  out.push('', '## Type styles', '| group | style | size / line | weight | extra | usage |', '| --- | --- | --- | --- | --- | --- |');
  for (const g of tokens.type.groups) for (const s of g.styles) {
    out.push(`| ${g.name} | ${s.name} | ${s.fontSize}${s.lineHeight ? ` / ${s.lineHeight}` : ''} | ${s.fontWeight} | ${s.letterSpacing ? `tracking ${s.letterSpacing}` : ''} | ${s.usage ?? ''} |`);
  }
  for (const group of ['spacing', 'radius', 'opacity', 'shadow', 'format']) {
    const list = tokens[group]?.tokens;
    if (!list) continue;
    out.push('', `## ${group[0].toUpperCase()}${group.slice(1)}`);
    for (const t of list) out.push(`- ${t.name}: ${t.value}${t.usage ? ` (${t.usage})` : ''}`);
  }
  if (meta.icon) out.push('', '## Icon rules (brand.json)', `- grid ${meta.icon.grid}, stroke ${meta.icon.strokeWidth}, caps ${meta.icon.linecap}, joins ${meta.icon.linejoin}, fill ${meta.icon.fill}, colours ${meta.icon.colours?.join(', ')}`);
  if (meta.web?.typeScale) {
    out.push('', '## Screen type sizes (brand.json → web)');
    for (const [k, s] of Object.entries(meta.web.typeScale)) out.push(`- ${k}: ${s.px ? `${s.px}px` : `${s.minPx}–${s.maxPx}px`}${s.lineHeightPx ? `/${s.lineHeightPx}` : ''}, weight ${s.weight}${s.uppercase ? ', caps' : ''}`);
    if (meta.web.notes) out.push(`- ${meta.web.notes}`);
  }
  const lay = meta.web?.layout;
  if (lay) {
    out.push('', `## Screen layout (brand.json → web.layout${lay.status === 'proposed' ? ', PROPOSED: derived from print, say so and record_decision once approved' : ''})`);
    if (lay.columns) out.push(`- columns: ${lay.columns.base} (base) / ${lay.columns.md} (md) / ${lay.columns.lg} (lg); Tailwind default breakpoints`);
    for (const [k, label] of [['pageMargin', 'page margin'], ['gutter', 'gutter'], ['sectionSpace', 'section spacing']]) if (lay[k]) out.push(`- ${label}: ${lay[k].minPx} → ${lay[k].maxPx}px fluid`);
    if (lay.containerMaxPx) out.push(`- content width: ${lay.containerMaxPx}px max; text measure ${lay.measureCh ?? 68}ch`);
    if (lay.spacing) out.push(`- spacing: ${Object.entries(lay.spacing).map(([k, v]) => `${k} ${v}px`).join(', ')}`);
    if (lay.sizes) out.push(`- sizes: ${Object.entries(lay.sizes).map(([k, v]) => `${k} ${v}px`).join(', ')}`);
    if (lay.notes) out.push(`- ${lay.notes}`);
    out.push('- Exact CSS / Tailwind tokens: brand_css.');
  }
  return out.join('\n');
}

export default {
  name: 'get_brand',
  description: "Read a brand pack (the brand's design system, source of truth): overview (principles, colour roles, typography rules, grid, templates, logos, icons, accessibility), tokens (every exact value), components, production (preflight, export, open items), changelog, assets. Call before any design, layout, copy-styling or code work for a project that has a brand. Never restyle what the brand defines.",
  input: {
    section: z.enum(SECTIONS).default('overview'),
    brand: z.string().regex(/^[a-z0-9-]+$/).optional().describe('Brand slug; defaults to the brand of the current --project'),
  },
  readOnly: true,
  async run({ section, brand }, ctx) {
    const slug = brand ?? ctx.brand;
    if (!slug) throw new Error(`No brand given and the current project has none. Brands: ${(await listBrands()).join(', ') || 'none'}`);
    const b = await loadBrand(slug);
    if (section === 'tokens') return tokenSummary(b);
    const text = b.docs[FILE[section]];
    if (!text) throw new Error(`brands/${slug} has no ${FILE[section]}`);
    return `<!-- ${b.meta.name} design system, ${FILE[section]}, tokens v${b.tokens.version} -->\n${text}`;
  },
};
