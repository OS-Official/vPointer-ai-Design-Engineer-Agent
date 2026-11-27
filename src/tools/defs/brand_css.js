import { z } from 'zod';
import { loadBrand } from '../../brands/load.js';
import { brandCss } from '../../brands/lint.js';

export default {
  name: 'brand_css',
  description: "Generate the brand's tokens as code: plain CSS custom properties, a Tailwind v4 @theme block (removes Tailwind's default colours, weights, radii and shadows so only brand values exist), or a Tailwind v3 config. Use this instead of typing token values by hand; then write the result into the project.",
  input: {
    format: z.enum(['css', 'tailwind-v4', 'tailwind-v3']).default('css'),
    brand: z.string().regex(/^[a-z0-9-]+$/).optional(),
  },
  readOnly: true,
  async run({ format, brand }, ctx) {
    const slug = brand ?? ctx.brand;
    if (!slug) throw new Error('No brand given and the current project has none.');
    return brandCss(await loadBrand(slug), format);
  },
};
