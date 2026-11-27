---
name: figma
description: Work from a Figma design: turn a frame into a token-mapped build spec, check a build against it, or edit the file when your Figma connection allows it
usage: /figma <Figma link and what to do, e.g. "https://figma.com/design/…?node-id=1-2 spec the hero for a build">
---
Figma task for project {{project}}: {{input}}

Delegate to figma-designer:
1. Find the frame: from the Figma link (file key and node ID), or the frame selected in the Figma desktop app. Confirm it by name before going further.
2. Read it: structure (get_metadata), design context, screenshot and variables.
3. Do the job asked. For a build: write a spec with every value mapped to the brand's tokens and every gap listed, then hand it to ui-engineer. For a check: compare the build with the screenshot and list the differences. For an edit: show the plan first; every change asks me.

Finish with: the frames used (name and node ID), what was done, and anything for me to review in Figma.
