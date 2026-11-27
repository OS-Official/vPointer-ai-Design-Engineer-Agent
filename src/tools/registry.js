import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

/*
 * Tool registry. Every file in src/tools/defs/ (except ones starting with "_") is a tool:
 *
 *   export default {
 *     name: 'contrast_check',            // lowercase_with_underscores
 *     description: 'What it does and when to use it',
 *     input: { fg: z.string() },         // zod fields
 *     readOnly: true,                    // true = runs freely; false/missing = asks you first
 *     async run(args, ctx) { return { … } },  // return data, or throw an Error
 *   };
 *
 * The model sees each tool as mcp__design__<name>; in agent files you write design:<name>.
 */

export const SERVER = 'design';
export const DEFS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'defs');
export const toolId = (name) => `mcp__${SERVER}__${name}`;

const isZodShape = (shape) =>
  shape && typeof shape === 'object' && Object.values(shape).every((v) => v && typeof v.safeParse === 'function');

export function validateToolDef(def, file) {
  const errors = [];
  if (!def || typeof def !== 'object') return [`${file}: must "export default { … }"`];
  if (!/^[a-z][a-z0-9_]*$/.test(def.name ?? '')) errors.push(`${file}: name must be lowercase_with_underscores`);
  if (typeof def.description !== 'string' || def.description.length < 10) errors.push(`${file}: description is missing or too short`);
  if (!isZodShape(def.input ?? {})) errors.push(`${file}: input must be an object of zod fields, e.g. { text: z.string() }`);
  if (typeof def.run !== 'function') errors.push(`${file}: run(args, ctx) function is missing`);
  if (def.readOnly !== undefined && typeof def.readOnly !== 'boolean') errors.push(`${file}: readOnly must be true or false`);
  return errors;
}

/** Load and validate every tool file. Returns { tools, errors }. */
export async function loadTools(dir = DEFS_DIR) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort();
  const tools = [];
  const errors = [];
  const seen = new Set();
  for (const file of files) {
    let def;
    try {
      // pathToFileURL keeps dynamic import working on Windows paths (C:\…).
      def = (await import(pathToFileURL(path.join(dir, file)).href)).default;
    } catch (e) {
      errors.push(`${file}: failed to load → ${e.message}`);
      continue;
    }
    const problems = validateToolDef(def, file);
    if (!problems.length && seen.has(def.name)) problems.push(`${file}: duplicate tool name "${def.name}"`);
    if (problems.length) { errors.push(...problems); continue; }
    seen.add(def.name);
    tools.push({ ...def, readOnly: def.readOnly === true, file });
  }
  return { tools, errors };
}

/** Map of mcp__design__<name> → { readOnly } for the security guard. */
export function toolPolicy(tools) {
  return Object.fromEntries(tools.map((t) => [toolId(t.name), { readOnly: t.readOnly }]));
}

/** Build the in-process MCP server the SDK talks to. ctx is passed to every run(). */
export function createDesignServer(tools, ctx) {
  return createSdkMcpServer({
    name: SERVER,
    version: '2.0.0',
    tools: tools.map((t) =>
      tool(
        t.name,
        t.description,
        t.input ?? {},
        async (args) => {
          try {
            const data = await t.run(args, ctx);
            return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
          } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
          }
        },
        t.readOnly ? { annotations: { readOnlyHint: true } } : undefined,
      ),
    ),
  });
}
