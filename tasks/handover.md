---
name: handover
description: Client handover pack: access levels, an ownership transfer checklist, and a plain-language guide for the client
usage: /handover [client or platform, e.g. webflow, wordpress]
---
Prepare a client handover for {{input|this project}} (project brief: {{project}}).

Include:
1. Access table: every account (domain, DNS, hosting, CMS, email, analytics) · who owns it now · who should own it after handover · access level (least privilege, e.g. Webflow Editor not Designer).
2. Ownership-transfer checklist (domain, hosting, admin users, backups, plugin/licence keys) — for WordPress subscription clients, follow the 6-month transfer rule in the brief.
3. Security steps at handover: rotate passwords, remove my admin access if agreed, enable 2FA.
4. A one-page plain-language guide for the client (how to edit content safely). If the client works in Arabic, delegate the guide to arabic-copywriter.

Write it as a Markdown file in the project's docs/ folder and tell me the path.
