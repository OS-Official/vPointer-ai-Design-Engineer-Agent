---
name: preflight
description: Deployment checklist for Vercel, Cloudflare, Webflow, or WordPress. Prepares configs and never deploys by itself
usage: /preflight [host, e.g. vercel]
---
Prepare this project for deployment to {{input|its current host}}.

1. Delegate to security-reviewer for a secrets scan and header audit.
2. Delegate to deploy-ops for the pre-flight checklist: build passes, env vars set in the host (not in code), domain + SSL Full (strict), www/apex and http→https redirects, 404 page, rollback plan. For DNS, show the exact record table.
3. Prepare any missing config (vercel.json headers, _headers, redirects) and show the diff.

Mark each checklist item ✅ / ❌ / ⚠️. Do NOT run any deploy command: give me the exact command to run when I'm ready.
