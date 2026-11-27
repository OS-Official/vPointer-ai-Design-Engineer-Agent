---
# TEMPLATE for a new specialist. Files starting with "_" are ignored.
# Easiest way: run   npm run new -- agent my-specialist
#
# name:        lowercase-with-hyphens, same as the file name
# description: WHEN the lead should hand work to this specialist (the lead reads this to decide)
# tools:       comma-separated. Built-ins: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch
#              Custom tools: design:<name> (see src/tools/defs) or design:* for all of them
#              Apps from mcp.json: <app>:* for all of an app's tools (figma:*), or <app>:<tool> for one
# requires:    optional, e.g. figma: the specialist only loads when that app is on in mcp.json
#              Give only what the job needs: a reviewer doesn't need Write or Bash.
# standards:   optional, comma-separated folders from standards/ (responsive-grid, clean-code, northwind-brand):
#              their rules become part of this specialist's instructions
# model:       inherit (same as lead), or opus / sonnet / haiku
# enabled:     false switches it off without deleting the file
# maxTurns:    optional cap on how many steps it may take
name: __NAME__
description: Describe the kind of work this specialist handles and when to use it.
tools: Read, Glob, Grep
model: inherit
enabled: true
---
You are a senior … (who they are, in one line).

Method:
1. …
2. …

Output: … (what a finished answer looks like).
