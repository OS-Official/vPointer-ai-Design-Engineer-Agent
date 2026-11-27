import { loadTasks, renderTask, parseCommand } from '../loaders/tasks.js';

/*
 * Turns what the person typed into what the agent receives. Shared by the terminal and the web UI.
 *   plain text         → { kind: 'send', text }
 *   /audit src         → { kind: 'send', text: <rendered task>, label: '/audit src', task: 'audit' }
 *   /help, /agents …   → { kind: 'builtin', name, input }   (each front end shows these its own way)
 *   unknown / blocked  → { kind: 'error', message, hint? }
 * Tasks are re-read every time, so edits to tasks/*.md apply without a restart.
 */
export const BUILTINS = ['help', 'exit', 'quit', 'tasks', 'agents', 'tools', 'projects', 'brands', 'mcp'];

export async function expandInput(line, { project = null, waiting = {}, skipped = {} } = {}) {
  const cmd = parseCommand(line);
  if (!cmd) return { kind: 'send', text: line };
  const { name, input } = cmd;
  if (BUILTINS.includes(name)) return { kind: 'builtin', name, input };
  const { tasks, errors } = await loadTasks();
  const task = Object.hasOwn(tasks, name) ? tasks[name] : null; // own keys only: "/constructor" is not a task
  if (!task) return { kind: 'error', message: `Unknown command /${name}.`, hint: 'Type /tasks to see your tasks.', warnings: errors };
  // A task that relies on a specialist whose app isn't connected would fail half-way: say so now.
  const blocked = Object.entries(waiting).filter(([n]) => new RegExp(`\\b${n}\\b`).test(task.body));
  if (blocked.length) {
    const needs = [...new Set(blocked.flatMap(([, a]) => a))];
    const forThisChat = needs.every((a) => skipped[a] === 'off for this chat');
    return forThisChat
      ? { kind: 'error', message: `/${name} needs ${needs.join(', ')}, which is off for this chat.`, hint: 'Turn it on in the Apps menu next to the message box.' }
      : { kind: 'error', message: `/${name} needs ${needs.join(', ')}, which is off.`, hint: 'Turn it on in the Apps window (sidebar), or set "enabled": true in mcp.json. Check it with: npm run check -- --mcp' };
  }
  return { kind: 'send', text: renderTask(task, { input, project }), label: line, task: name, warnings: errors };
}

/** Task list for menus and autocomplete. */
export async function listTasks() {
  const { tasks } = await loadTasks();
  return Object.values(tasks).map((t) => ({ name: t.name, description: t.description, usage: t.usage }));
}
