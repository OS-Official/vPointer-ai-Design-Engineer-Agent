---
# TEMPLATE for a new task (slash command). Files starting with "_" are ignored.
# Easiest way: run   npm run new -- task my-task
#
# name:        the command you type in the chat → /my-task
# description: one line shown in /tasks
# usage:       how to call it, shown in /tasks
#
# In the body you can use:
#   {{input}}               what you typed after the command
#   {{input|default text}}  same, with a fallback if you typed nothing
#   {{project}}             the project you started dea with (--project), or "none"
# Mention specialists by name (ui-engineer, design-critic …) to have the lead delegate.
# Edits take effect immediately: no restart needed.
name: __NAME__
description: What this task does, in one line
usage: /__NAME__ <what to give it>
---
Do this: {{input}}

Project: {{project}}.

1. …
2. …

Finish with: …
