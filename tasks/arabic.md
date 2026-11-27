---
name: arabic
description: Write or adapt professional MSA Arabic copy (no diacritics), checked against house style
usage: /arabic <English text, brief, or file to adapt>
---
Arabic copy task: {{input}}

Project: {{project}}.

Delegate to arabic-copywriter:
- If the input is English text or a file, adapt it into Arabic (don't translate word-for-word).
- If it's a brief, write the copy from scratch.
- Run arabic_msa_check and fix every issue before delivering.

Return: the final Arabic text, then a short English back-translation, then any terms you chose that I should confirm.
