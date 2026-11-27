# Northwind components in code (Tailwind v4, tokens from brand_css)

## Button
```html
<a href="/shop" class="inline-flex min-h-12 w-full items-center justify-center bg-fjord px-6 font-medium text-white hover:bg-fjord-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fjord sm:w-auto">Shop the packs</a>
```

## Key figures
```html
<dl class="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
  <div class="border-t-2 border-fjord pt-6">
    <dt class="text-caption font-medium text-ink">Capacity</dt>
    <dd class="font-display text-title font-bold tabular-nums text-ink">30 L</dd>
  </div>
  <!-- unknown value: <dd …>—</dd> -->
</dl>
```

## Tabs (one per product size)
```html
<nav aria-label="Sizes" class="flex border-b border-mist">
  <a href="/packs/20" class="min-h-11 flex-1 px-4 py-3 text-center text-ink">20 L</a>
  <a href="/packs/30" aria-current="page" class="min-h-11 flex-1 border-b-2 border-fjord px-4 py-3 text-center font-medium text-fjord">30 L</a>
</nav>
```
Unselected tabs stay full-strength `ink`: 60% opacity would fail contrast.
