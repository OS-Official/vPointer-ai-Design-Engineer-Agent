---
# TEMPLATE for a new standard. Folders starting with "_" are ignored.
# Easiest way: run   npm run new -- standard my-standard
#
# name:        lowercase-with-hyphens, same as the folder name
# description: WHAT it covers and WHEN it applies (the lead reads this to decide when to load it)
# brand:       optional brand slug (e.g. northwind): the standard then only applies to that brand's projects
#
# Give a specialist this standard with   standards: my-standard   in its agents/<name>.md.
# Longer material (code patterns, checklists) goes in references/<file>.md and is read on demand
# with design:get_standard. Keep this file short: it is added to every specialist that uses it.
name: __NAME__
description: Describe what this standard covers and when the agents should follow it.
---
# Title

Why this matters, in one or two sentences: the agents follow rules better when they know the reason.

## Rules
1. …
2. …

## Before you call it done
- …
