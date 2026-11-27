---
name: build
description: Build a page, section, or component from a description or Figma link, RTL-ready and token-based
usage: /build <what to build, Figma link, or file to change>
---
Build this: {{input}}

Project: {{project}}. Load its brief first if it isn't "none".

If a Figma link is given and the Figma specialist is available, have it read the frame first and hand ui-engineer a token-mapped spec. If Figma isn't connected, say so in one line and build from the description.

Delegate the implementation to ui-engineer with these requirements:
- Match the project's existing stack and file structure (read before writing).
- Mobile first: the base layout is the phone layout, and breakpoints add columns (responsive-grid standard).
- Tokens for every colour, size and space; use type_scale / fluid_clamp / contrast_check rather than guessing.
- Logical CSS properties so it works in both LTR and RTL.
- Semantic HTML, keyboard reachable, visible focus; loading, error and empty states for any data (clean-code standard).

Then run layout_lint and, if the project has a brand, brand_lint on the changed files, and have design-critic review the result. Fix every lint finding, Blocker and Major before reporting.
Finish with the files changed and a short "Why" for the key technique used.
