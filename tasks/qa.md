---
name: qa
description: Quality pass on front-end code: responsive and mobile-first layout, clean code, accessibility, and brand, with the fixes
usage: /qa <file or folder, default: the whole project>
---
Run a quality pass on: {{input|.}}

Project: {{project}}. Load its brief first if it isn't "none".

1. Run layout_lint on the target and, if the project has a brand, brand_lint (and icon_lint on SVGs).
2. Have design-critic review the same files against the responsive-grid and clean-code standards (and the brand standard, if there is one). Ask it to check what the linters can't see: is the base layout built for mobile, is there horizontal scroll at 320 px, is there a mobile plan for tables, nav and tabs, are the loading, error and empty states present, and are focus and keyboard order right?
3. Show one table: Severity (Blocker / Major / Minor) · Where · Problem · Fix. Lint errors are at least Major.
4. Ask before fixing. If I say yes, delegate the fixes to ui-engineer, then run the linters again and show what's left.
