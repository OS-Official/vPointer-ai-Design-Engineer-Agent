---
name: responsive-grid
description: Mobile-first responsive layout and grid rules for HTML, CSS, Tailwind and React. Covers breakpoints, column grids, fluid type and spacing, container queries, images, tables, navigation, touch targets and RTL. Load it before building, fixing or reviewing any page, section or component that appears on screen, even when the task doesn't say "responsive".
---
# Responsive layout and grid, mobile first

Most visitors to a small business's site arrive on a phone, often on a slow connection, and judge the brand in the first screen. Design and build for the smallest screen first, then let space add columns. Desktop-first code fails in the opposite direction: small screens inherit layouts they can't fit, and the result is horizontal scrolling, cramped text and tap targets that are too small.

## 1. Mobile first, in code

- Base styles are for the smallest screen (320–375 px). Larger screens are enhancements: `min-width` media queries, or Tailwind's `sm: md: lg: xl:` prefixes, in increasing order.
- Don't write `max-width` media queries or Tailwind `max-*:` variants to undo desktop styles. If you need one, the base style is wrong. The rare exception is a range fix such as `md:max-lg:`, with a comment saying why.
- Use Tailwind's default breakpoints (40, 48, 64, 80 and 96rem) unless the project defines its own. Add a breakpoint where the *content* breaks, not at a device width.
- The viewport meta tag is `<meta name="viewport" content="width=device-width, initial-scale=1">`. Never use `maximum-scale` or `user-scalable=no`, because they block zoom (WCAG 1.4.4).

## 2. The grid

- Use **4 columns on mobile, 8 from `md` and 12 from `lg`**, with one gutter token between columns and one page-margin token outside. A brand pack can redefine the values (see the example brand's standard), but the structure stays.
- Use CSS Grid for two-dimensional layout and Flexbox for one-dimensional rows of things. Don't build grids out of percentage-width floats or flex with fixed widths.
- Grid children that hold text need `min-width: 0` (`min-w-0`), or `minmax(0, 1fr)` columns, so long words can't push the grid wider than the screen.
- **Intrinsic grids** for repeated cards: `grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr))`. These reflow without breakpoints and never overflow, because of the `min(100%, …)`.
- **Container queries** (`@container`, Tailwind v4 `@container` with `@md:`) for a component that lives in places of different widths, such as a card in a sidebar and in a main column. The component responds to its own space, not the window's.
- Content width is a `max-width` token with `width: 100%` and `margin-inline: auto`. Never give a page container a fixed pixel width.
- Body text is limited to about 60–75 characters per line (`max-width: 68ch`), because longer lines are hard to track.

## 3. Spacing and type scale

- Spacing comes from one scale (Tailwind's 4 px steps, or the brand's tokens). The same relationship always gets the same step: heading to text, card to card, section to section. Arbitrary values (`mt-[13px]`) are a smell; if one is needed, it belongs in a token.
- Fluid values that grow with the screen use `clamp()` from the `fluid_clamp` tool, for example title sizes, page margins and section spacing. Clamps use `rem + vw`, so browser zoom still works.
- Font sizes are in `rem`, never `px`, so they respect the user's text-size setting. Body is at least 16 px. Form inputs are at least 16 px, because iOS zooms into anything smaller.
- Line height is unitless (1.5–1.65 for body, 1.1–1.25 for display).

## 4. Heights, overflow and safe areas

- Don't set fixed heights on anything that holds text, because translated or zoomed text will overflow. Use `min-height` and let content grow.
- For full-screen sections use `min-h-dvh` / `min-height: 100dvh`, or `svh`, not `100vh` or `h-screen`. On mobile `vh` ignores the browser bars and cuts content off.
- Nothing may scroll horizontally at 320 px. Long URLs and part numbers get `overflow-wrap: anywhere`, and media gets `max-width: 100%`.
- Fixed or sticky bars respect `env(safe-area-inset-*)` on notched phones.

## 5. Touch and input

- Interactive targets are at least 44 × 44 px (WCAG 2.2's minimum is 24 px; aim for 44). Pad the hit area, not just the icon.
- Hover is an enhancement: put it inside `@media (hover: hover)` (Tailwind v4 does this for `hover:` by default), and never let hover be the only way to reveal information or controls.
- Keyboard: everything clickable is a `<button>` or `<a href>`, so it's focusable for free. Focus stays visible (`:focus-visible`); never use `outline: none` without a replacement.
- Respect `prefers-reduced-motion`: big movements become fades or nothing.

## 6. Media

- Every `<img>` has `width` and `height` (or `aspect-ratio`) so the page doesn't jump while loading, a real `alt` (`alt=""` if decorative), `srcset` and `sizes` for anything wider than about 400 px, `loading="lazy"` below the fold, and `fetchpriority="high"` on the hero image only.
- Use `<picture>` for art direction, such as a tighter crop on mobile. Use `object-fit: cover` inside an aspect-ratio box.
- Put SVG icons inline or in a sprite, sized with tokens, using `currentColor`. Decorative icons get `aria-hidden="true"`.

## 7. Patterns that need a mobile plan

`references/patterns.md` has code for each of these.
- **Tables:** keep a real `<table>`. On mobile, a label/value table usually fits. A wide comparison table goes in a focusable scroll region (`role="region"`, `aria-label`, `tabindex="0"`, `overflow-x: auto`) with a sticky first column. Only stack rows into cards when nobody needs to compare across columns.
- **Navigation:** on mobile, a disclosure button with `aria-expanded` and `aria-controls` that opens the menu. On desktop, show links inline when they fit.
- **Tabs and segmented controls:** they fit at 320 px or they scroll horizontally. Never let them wrap into two ragged rows.
- **Forms:** one column on mobile, with labels above fields, the right `type` and `inputmode`, and `autocomplete`.

## 8. RTL from the start

- Use logical properties everywhere: `margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`, or Tailwind's `ms- me- ps- pe- start- end- text-start text-end`. Physical `left/right` utilities break in Arabic.
- Set `dir` on `<html>`, not on scattered elements. Mirror direction-bearing icons with `rtl:` variants. Never mirror logos or photos.

## 9. Verify before you call it done

1. Run `layout_lint` on the changed files and fix every *error* finding. For each *warning* finding, fix it or say why it stays.
2. Walk the layout at **320, 375, 768, 1024, 1280 and 1440 px**, and at 200% zoom. When you can't render, check the CSS for each width and say which widths you reasoned about.
3. Confirm there's no horizontal scroll at 320, text lines stay within the measure, targets are at least 44 px, focus is visible, and RTL holds if the project is bilingual.
4. In the report, name the base (mobile) layout and what each breakpoint adds, one line each.
