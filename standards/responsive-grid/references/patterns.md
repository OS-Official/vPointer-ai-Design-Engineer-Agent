# Responsive patterns with code

Each pattern is mobile first: the unprefixed classes are the phone layout. Tokens such as `px-page-margin`, `gap-gutter` and `max-w-page` come from `brand_css` when the project has a brand. Without one, define them once in CSS (`@theme` or `:root`).

## Contents
1. Page shell and 4/8/12 grid
2. Intrinsic card grid
3. Container-query card
4. Data table: label/value and comparison
5. Mobile navigation (disclosure)
6. Responsive image
7. Full-height hero
8. Plain CSS equivalents

## 1. Page shell and 4/8/12 grid

```html
<main class="mx-auto w-full max-w-page px-page-margin">
  <section class="grid grid-cols-4 gap-gutter py-section md:grid-cols-8 lg:grid-cols-12">
    <h2 class="col-span-4 md:col-span-8 lg:col-span-12">…</h2>
    <p class="col-span-4 max-w-measure md:col-span-6 lg:col-span-6">…</p>
    <figure class="col-span-4 md:col-span-8 lg:col-span-6">…</figure>
  </section>
</main>
```
Why: one grid for the whole section, so everything aligns to the same columns. Each child says how many columns it spans at each size, and on mobile everything spans all 4, which means it stacks.

## 2. Intrinsic card grid (no breakpoints needed)

```html
<ul class="grid gap-gutter [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]" role="list">
  <li class="min-w-0">…card…</li>
</ul>
```
Why: `auto-fit` + `minmax` makes as many columns as fit at 18rem or wider. `min(100%, 18rem)` stops overflow on a 320 px screen. `min-w-0` lets long words wrap.

## 3. Container-query card (Tailwind v4)

```html
<article class="@container">
  <div class="grid gap-4 @md:grid-cols-[auto_1fr] @md:items-start">
    <span class="size-icon-tile …">…</span>
    <div class="min-w-0">…</div>
  </div>
</article>
```
Why: the card switches to icon-beside-text when *its own* width reaches `@md` (28rem), wherever it's placed.

## 4. Data tables

Label/value (one model), which fits on mobile as it is:
```html
<table class="w-full border-collapse tabular-nums">
  <caption class="sr-only">Trail Pack 30 technical data</caption>
  <tbody>
    <tr class="odd:bg-white even:bg-mist">
      <th scope="row" class="py-3 ps-4 text-start font-normal">Capacity</th>
      <td class="py-3 pe-4 text-end font-medium">30 L</td>
    </tr>
  </tbody>
</table>
```

Comparison (several columns), which scrolls with a sticky first column on mobile:
```html
<div role="region" aria-label="Model comparison" tabindex="0" class="overflow-x-auto focus-visible:outline-2">
  <table class="min-w-[40rem] w-full border-collapse tabular-nums">
    <thead><tr><th scope="col" class="sticky start-0 bg-mist text-start">Field</th><th scope="col">Trail Pack 20</th>…</tr></thead>
    <tbody><tr><th scope="row" class="sticky start-0 bg-white text-start font-normal">Capacity</th><td class="text-end">20 L</td>…</tr></tbody>
  </table>
</div>
```
Why: the table stays a table, so screen readers can announce rows and columns. The region is focusable so keyboard users can scroll it. `sticky start-0` keeps the row labels visible, on the correct side in both LTR and RTL. Blank values are "—".

## 5. Mobile navigation (disclosure)

```jsx
function SiteNav({ links }) {
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Main">
      <button type="button" className="min-h-11 min-w-11 md:hidden" aria-expanded={open} aria-controls="main-menu" onClick={() => setOpen((v) => !v)}>
        <span className="sr-only">Menu</span>{/* icon aria-hidden */}
      </button>
      <ul id="main-menu" className={`${open ? 'flex' : 'hidden'} flex-col gap-2 md:flex md:flex-row md:gap-6`}>
        {links.map((l) => <li key={l.href}><a href={l.href} className="inline-flex min-h-11 items-center">{l.label}</a></li>)}
      </ul>
    </nav>
  );
}
```
Why: the button exposes its state with `aria-expanded`, and targets are 44 px (`min-h-11`). On desktop the menu is simply shown, so there's no hamburger when there's room. Keys are the stable `href`, not the array index.

## 6. Responsive image

```html
<img src="/img/pack-800.webp"
     srcset="/img/pack-480.webp 480w, /img/pack-800.webp 800w, /img/pack-1600.webp 1600w"
     sizes="(min-width: 64rem) 50vw, 100vw"
     width="1600" height="1000" alt="Trail Pack 30 on a mountain trail"
     loading="lazy" decoding="async" class="h-auto w-full object-cover">
```
For the hero image, drop `loading="lazy"` and add `fetchpriority="high"`. In Next.js use `<Image>` with `sizes`, and `priority` on the hero.

## 7. Full-height hero

```html
<section class="grid min-h-dvh content-end px-page-margin pb-section">…</section>
```
Why: `dvh` follows the visible viewport on mobile, while `100vh` hides content behind the browser bar.

## 8. Plain CSS equivalents

```css
.page { width: 100%; max-width: var(--container-max); margin-inline: auto; padding-inline: var(--page-margin); }
.grid { display: grid; gap: var(--gutter); grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (min-width: 48rem) { .grid { grid-template-columns: repeat(8, minmax(0, 1fr)); } }
@media (min-width: 64rem) { .grid { grid-template-columns: repeat(12, minmax(0, 1fr)); } }
@media (hover: hover) { .link:hover { text-decoration: underline; } }
:focus-visible { outline: 2px solid var(--color-fjord); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
```
The reduced-motion reset is the one accepted use of `!important`, because it must beat every component's own animation. `layout_lint` allows it inside a `prefers-reduced-motion` block.
