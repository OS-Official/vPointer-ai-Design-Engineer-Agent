/*
 * Minimal, dependency-free frontmatter parser for the agent and task files.
 *
 *   ---
 *   name: ui-engineer
 *   description: Builds frontend code
 *   tools: Read, Write, design:contrast_check
 *   enabled: true
 *   ---
 *   Body text (the prompt) …
 *
 * Supported values: text, true/false, numbers, comma-separated lists, and
 * "quoted text" (use quotes if a value contains a colon or comma you want kept).
 */
export function parseFrontmatter(source, file = 'file') {
  const text = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: must start with a --- frontmatter block --- (see the _template file)`);

  const data = {};
  m[1].split('\n').forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) throw new Error(`${file}: line ${i + 2} is not "key: value" → ${line.trim()}`);
    data[kv[1]] = parseValue(kv[2].trim());
  });
  return { data, body: m[2].trim() };
}

function parseValue(raw) {
  if (/^".*"$/.test(raw) || /^'.*'$/.test(raw)) return raw.slice(1, -1);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/** "Read, Write , Glob" → ['Read','Write','Glob']; arrays pass through. */
export function toList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}
