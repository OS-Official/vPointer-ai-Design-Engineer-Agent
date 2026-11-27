---
name: northwind-brand
description: How to apply the Northwind example brand on screen (pages, components, email). Load it for any Northwind work, even when the task only says "on brand". Copy this standard as the starting point for your own brand's standard.
brand: northwind
---
# Applying the Northwind brand

The brand pack (`get_brand`) holds the facts: tokens, components and docs. This standard covers how to use them consistently. Replace Northwind with your own brand by copying this folder, renaming it (e.g. `standards/acme-brand/`), and setting `brand: acme` above.

## 1. Where values come from
- Tokens come from `brand_css` (CSS, Tailwind v4 or v3, to match the project). Use only those: `brand_lint` must pass.
- Layout values (page margin, gutter, section spacing, 4/8/12 columns, component sizes) are in `brand.json → web.layout` and are emitted by `brand_css`: `px-page-margin`, `gap-gutter`, `py-section`, `max-w-page`, `max-w-measure`.
- A value that isn't in the pack is a **brand gap**: ask, don't invent.

## 2. The rules that carry the brand
1. Square and flat: `rounded-none`, no shadows except `lift` on open menus and dialogs.
2. Space Grotesk for display, Source Sans 3 for text, weights 400/500/700 only.
3. Colour roles: `ink` text on light, `paper` on dark and photos, `fjord` for actions.
4. `amber` is the one accent and never text on a light ground.
5. Body text left aligned, never justified; figures and units in Medium.
6. Tabular figures in columns; unknown values are "—".
7. Unselected tabs stay full strength; `inactive` opacity is for disabled controls only.
8. Reuse a component from `components.md` before inventing one.

## 3. Components on screen
Read `references/patterns.md` for code. Button, key figure, product card, spec table and tabs each have one web form: keep their anatomy and colour roles.

## 4. Before you call it done
- `brand_lint` on changed files, `icon_lint` on SVGs, `contrast_check` for any pair not in the README's table.
- Walk the eight rules against your output, one line each.
- Report any brand gap you hit.
