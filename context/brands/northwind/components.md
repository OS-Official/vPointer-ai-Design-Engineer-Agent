# Northwind components (example)

| Component | Anatomy | Rules |
| --- | --- | --- |
| Button | label (Source Sans 3 Medium 16), 48px min height, 24px inline padding | `fjord` ground, `white` label, `fjord-deep` on hover, square, 2px focus outline offset 2px. Full width on mobile, hugs its label from `sm`. |
| Key figure | 2px `fjord` rule on top, caption label, value in `title` | `<dl>` grid: 1 column on mobile, 2 from `sm`, 3 from `lg`. Unknown value: "—". |
| Product card | image (4:3), title, one-line benefit, price | white ground, flat, square. Grid of 1 / 2 / 3 / 4 columns as space allows. |
| Spec table | caption, `mist` header row, zebra rows, values end-aligned | `<table>` with `tabular-nums`. Wide comparisons scroll in a focusable region with a sticky first column. |
| Tabs | underline tabs, 2px `fjord` rule on the active one | Unselected tabs full-strength `ink`. Never boxes or pills. |
| Photo with text | photo, `night` panel at 0.5 on the fill, `paper` text | Scrim: `linear-gradient(to top, rgb(18 24 30 / .72), rgb(18 24 30 / 0))`. |
