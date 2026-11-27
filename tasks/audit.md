---
name: audit
description: Full prelaunch audit of security, accessibility, and performance, with a prioritized list of fixes
usage: /audit [folder or file]
---
Run a full pre-launch audit of {{input|the whole project}}.

1. Delegate to security-reviewer: secrets scan, security headers, Supabase/WordPress checks.
2. Delegate to design-critic: WCAG 2.2 AA accessibility and consistency with the project brief ({{project}}).
3. Check performance yourself: image sizes and formats, render-blocking CSS/JS, font loading (font-display, preload), unused dependencies.

Merge everything into ONE table sorted by severity: Severity · Area · Where · Problem · Fix.
Do not change any files. End with the three fixes that matter most.
