# Northwind design system (example)

Northwind Outfitters is a **fictional** outdoor-gear brand that ships with the Design Engineer Agent, so you can see how a brand pack works. Replace it with your own brand, or copy its shape: `tokens.json` (values), `brand.json` (icon rules, web sizes, extra rules) and these docs.

## Character
Calm, durable, honest. Square edges, generous space, one accent. Copy is plain and specific: real numbers and units, no superlatives.

## Principles
1. **Square and flat.** `radius-none` everywhere. The only shadow is `lift`, for open menus and dialogs.
2. **Two families, clear jobs.** Space Grotesk for display (hero, title, subtitle), Source Sans 3 for text. Weights 400, 500 and 700 only.
3. **Colour roles, not colours.** Text is `ink` on light grounds and `paper` on dark grounds and photos. `fjord` is the primary action colour.
4. **One accent, one meaning.** `amber` marks sale badges and the active rule on dark grounds. It is never text on a light ground.
5. **Body text** is left aligned, never justified, 16/26, with figures and units in Medium.
6. **Numbers in columns** use tabular figures. Unknown values are "—", never a guess.
7. **Unselected tabs stay full strength.** Only disabled controls use the `inactive` opacity, because 60% fails contrast for text.
8. **Reuse before you invent.** Use a component from `components.md` before designing a new one.

## Accessible pairs
| Text | Ground | Ratio |
| --- | --- | --- |
| ink | white | 14.6:1 |
| ink | mist | 13.1:1 |
| white | fjord | 5.8:1 |
| paper | night | 17.1:1 |
| fjord | white | 5.8:1 |
| white | fjord-deep | 7.7:1 |

Check any other pair with `contrast_check` before using it.

## Icon set
24-unit grid, 2 stroke, round caps and joins, no fills. `fjord` or `ink` on light grounds, `paper` on dark. Check with `icon_lint`.

## Web and email
Use `brand_css` for tokens (CSS, Tailwind v4 or v3). Email: Arial body inline, headings as text in `ink`.
