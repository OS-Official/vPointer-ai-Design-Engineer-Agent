---
name: brand-check
description: Check a page, component, or folder against the brand pack and list every off-brand detail with its fix
usage: /brand-check [file or folder]
---
Check {{input|the whole project}} against the brand of project {{project}}.

1. Run brand_lint on it, and icon_lint on any SVG icons in it.
2. Delegate to design-critic for what a linter can't see: colour roles, the accent's single meaning, which weight does which job, templates and components used as the brand pack specifies.
3. Merge everything into one table: Severity · Where · What's off-brand · Brand rule · Fix.

Don't change any files. End with one line: on brand, or what must change first.
