---
name: icon
description: Draw new brand icons, or bring existing ones onto the brand's icon grid, checked with icon_lint
usage: /icon <concept, e.g. bitumen tank>  or  /icon fix <folder>
---
Icon work for project {{project}}: {{input}}

Delegate to icon-designer:
- For a new concept: draw it on the brand's icon grid, matching the existing set, then run icon_lint.
- For "fix <folder>": run icon_lint on the folder and correct every finding without changing what each icon depicts.

Show each file path with its icon_lint result. If a rule in the brand pack seems to contradict itself, stop and ask me which value is right instead of choosing.
