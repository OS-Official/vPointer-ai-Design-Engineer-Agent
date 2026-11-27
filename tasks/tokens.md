---
name: tokens
description: Generate design tokens (type scale, fluid sizes, and color pairs with contrast) and write them to Tailwind or CSS
usage: /tokens [base size, ratio, colours or notes]
---
Create a design-token set for project {{project}}. Extra notes: {{input|use the brief's colours and fonts}}.

1. Load the brief. If the project has a brand pack, don't design tokens: generate them with brand_css in the format the project uses (Tailwind v4, v3 or plain CSS), show them, and go to step 5. Otherwise use the brief's colours and fonts; don't invent brand colours.
2. type_scale for the text sizes; fluid_clamp for the hero/display sizes (375px → 1440px).
3. contrast_check every text/background pair you plan to use; drop or adjust any that fail AA.
4. Show the token table first and wait for my OK before writing any file.
5. After my OK, write them where the project expects them (tailwind.config.js theme.extend, or :root custom properties in CSS).
