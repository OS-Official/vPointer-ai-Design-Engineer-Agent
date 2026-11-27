import fs from 'node:fs/promises';
import path from 'node:path';
import { TASKS_DIR } from '../config.js';
import { parseFrontmatter } from './frontmatter.js';

/*
 * Tasks are reusable playbooks you run in the chat as slash commands:
 *   /audit src        → runs tasks/audit.md with "src" as {{input}}
 *
 * Placeholders in the task body:
 *   {{input}}               what you typed after the command
 *   {{input|default text}}  same, with a fallback when you typed nothing
 *   {{project}}             the --project you started with (or "none")
 *
 * Tasks are re-read every time you run one, so edits apply immediately (no restart).
 */

export const RESERVED_COMMANDS = ['help', 'exit', 'quit', 'tasks', 'agents', 'tools', 'projects', 'brands', 'mcp'];

export async function loadTasks(dir = TASKS_DIR) {
  const tasks = {};
  const errors = [];
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  } catch {
    return { tasks, errors: [] }; // tasks are optional
  }
  for (const file of files) {
    try {
      const { data, body } = parseFrontmatter(await fs.readFile(path.join(dir, file), 'utf8'), file);
      const name = String(data.name ?? '');
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${file}: name must be lowercase-with-hyphens (got "${name}")`);
      if (RESERVED_COMMANDS.includes(name)) throw new Error(`${file}: "/${name}" is a built-in command; pick another name`);
      if (Object.hasOwn(tasks, name)) throw new Error(`${file}: duplicate task name "${name}"`);
      if (typeof data.description !== 'string' || !data.description) throw new Error(`${file}: description is missing`);
      if (!body) throw new Error(`${file}: no instructions below the --- block`);
      tasks[name] = { name, description: data.description, usage: data.usage ? String(data.usage) : `/${name}`, body, file };
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { tasks, errors };
}

export function renderTask(task, { input = '', project = null } = {}) {
  const typed = input.trim();
  let used = false;
  let text = task.body.replace(/\{\{\s*input\s*(?:\|([^}]*))?\}\}/g, (_, fallback) => {
    used = true;
    return typed || (fallback ?? '').trim() || '(nothing specified)';
  });
  text = text.replace(/\{\{\s*project\s*\}\}/g, project || 'none');
  if (!used && typed) text += `\n\nInput: ${typed}`;
  return text;
}

/** "/audit src/app" → { name: 'audit', input: 'src/app' }; non-commands → null. */
export function parseCommand(line) {
  const m = line.match(/^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/);
  return m ? { name: m[1], input: m[2] ?? '' } : null;
}
