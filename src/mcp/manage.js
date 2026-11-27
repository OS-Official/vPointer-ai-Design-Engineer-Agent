/**
 * The Apps window's view of mcp.json: list the apps, turn them on or off, test them.
 *
 * What the window may do, enforced here and in the routes (not only in the page):
 *   • Change one thing: an app's "enabled" flag. It can't add or remove apps, or change a command,
 *     arguments, address, headers, env or token. Those stay in mcp.json and .env, edited by you.
 *   • See what an app is, never its secrets: no header or env values, no command arguments
 *     (only a package name), no URL query. ${VAR} names are shown so you know what to put in .env.
 *   • Test only apps that are on, because a test starts the app's program.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MCP_FILE, NAME_RE, loadMcp } from './config.js';
import { probeServer } from './probe.js';

const err = (status, message) => Object.assign(new Error(message), { status });

/**
 * JSON written so a one-flag change is a one-line diff: lists of plain values and small flat
 * objects stay on one line, everything else is indented. The shipped mcp.json uses this format.
 */
export function formatJson(value, indent = '') {
  const plain = (v) => v === null || typeof v !== 'object';
  if (plain(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every(plain)) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  if (keys.length <= 2 && keys.every((k) => plain(value[k]))) {
    const one = `{ ${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(value[k])}`).join(', ')} }`;
    if (one.length <= 72) return one;
  }
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${formatJson(value[k], inner)}`).join(',\n')}\n${indent}}`;
}

function readRaw(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw err(404, 'There is no mcp.json yet. Create one, or run: npm run mcp:import'); }
  try { return JSON.parse(text); } catch (e) { throw err(422, `mcp.json isn’t valid JSON (${e.message}). Fix it in a text editor first.`); }
}

/** Where an app runs, in words, without anything that could hold a secret. */
function whereOf(entry) {
  const type = entry.type ?? (entry.url ? 'http' : 'stdio');
  if (type === 'stdio') {
    const cmd = path.basename(String(entry.command ?? ''));
    const pkg = (Array.isArray(entry.args) ? entry.args : []).find((a) => typeof a === 'string' && /^@?[\w.-]+(\/[\w.-]+)?(@[\w.-]+)?$/.test(a) && !a.startsWith('-') && !a.includes('${'));
    return { type, local: true, where: pkg ? `${cmd} ${pkg}` : cmd || 'a program' };
  }
  try {
    const u = new URL(String(entry.url ?? '').replace(/\$\{[^}]*\}/g, 'x'));
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    return { type, local, where: `${u.origin}${u.pathname}`, host: u.host };
  } catch { return { type, local: false, where: 'the address in mcp.json' }; }
}

/** Every app in mcp.json, as safe to show in the window. */
export async function listApps({ file = MCP_FILE, env = process.env } = {}) {
  const raw = readRaw(file);
  const entries = raw?.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : {};
  const loaded = await loadMcp({ file, env });
  return Object.entries(entries).filter(([name, e]) => NAME_RE.test(name) && e && typeof e === 'object').map(([name, e]) => {
    const dea = e.dea && typeof e.dea === 'object' ? e.dea : {};
    const { dea: _dea, ...transport } = e;
    const needs = [...new Set([...JSON.stringify(transport).matchAll(/\$\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))];
    const missing = needs.filter((v) => !env[v]);
    const enabled = dea.enabled !== false;
    const problem = loaded.errors.find((x) => x.startsWith(`mcp.json → ${name}:`));
    const state = !enabled ? 'off' : problem ? 'error' : missing.length ? 'needs-setup' : Object.hasOwn(loaded.servers, name) ? 'on' : 'needs-setup';
    const reason = state === 'error' ? problem.replace(`mcp.json → ${name}: `, '')
      : state === 'needs-setup' && missing.length ? `Add ${missing.join(' and ')} to .env, then restart the window (npm run ui).`
        : state === 'needs-setup' ? ((Object.hasOwn(loaded.skipped, name) ? loaded.skipped[name] : null) ?? 'Not set up.') : null;
    return {
      name,
      description: typeof dea.description === 'string' ? dea.description : '',
      setup: typeof dea.setup === 'string' ? dea.setup : null,
      enabled, state, reason,
      ...whereOf(e),
      needs, missing,
      allow: Array.isArray(dea.allow) ? dea.allow.filter((p) => typeof p === 'string') : [],
      deny: Array.isArray(dea.deny) ? dea.deny.filter((p) => typeof p === 'string') : [],
      localModels: dea.local !== false,
    };
  });
}

/** All app names in mcp.json (on or off). */
export function appNames({ file = MCP_FILE } = {}) {
  try { return Object.keys(readRaw(file)?.mcpServers ?? {}).filter((n) => NAME_RE.test(n)); } catch { return []; }
}

let writing = Promise.resolve();
/** Turn one app on or off: the only change the window can make to mcp.json. Atomic, one at a time. */
export function setAppEnabled(name, enabled, { file = MCP_FILE } = {}) {
  if (typeof enabled !== 'boolean') return Promise.reject(err(400, '"enabled" must be true or false.'));
  const job = writing.then(() => {
    const raw = readRaw(file);
    const entries = raw?.mcpServers;
    if (!NAME_RE.test(String(name)) || !entries || typeof entries !== 'object' || !Object.hasOwn(entries, name) || !entries[name] || typeof entries[name] !== 'object') {
      throw err(404, `No app "${name}" in mcp.json.`);
    }
    const entry = entries[name];
    if (entry.dea && typeof entry.dea === 'object') entry.dea.enabled = enabled; // keeps the key order
    else entry.dea = { enabled };
    const tmp = path.join(path.dirname(file), `.mcp.json.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, `${formatJson(raw)}\n`);
    fs.renameSync(tmp, file);
    return { name, enabled };
  });
  writing = job.catch(() => {});
  return job;
}

const testing = new Map(); // name → promise, so a double click runs one test
/** Connect to an app that is on and list its tools with what each may do. */
export async function testApp(name, { file = MCP_FILE, env = process.env, timeoutMs = 20000 } = {}) {
  if (testing.has(name)) return testing.get(name);
  const job = (async () => {
    const loaded = await loadMcp({ file, env });
    const server = Object.hasOwn(loaded.servers, name) ? loaded.servers[name] : null;
    if (!server) {
      const apps = await listApps({ file, env });
      const a = apps.find((x) => x.name === name);
      if (!a) throw err(404, `No app "${name}" in mcp.json.`);
      if (!a.enabled) throw err(409, `${name} is off. Turn it on to test it.`);
      throw err(409, a.reason ?? `${name} isn’t ready.`);
    }
    const p = await probeServer(name, server, { timeoutMs });
    const at = new Date().toISOString();
    if (!p.ok) return { name, ok: false, error: p.error, at };
    return { name, ok: true, at, server: p.server ? { name: String(p.server.name ?? '').slice(0, 80), version: String(p.server.version ?? '').slice(0, 40) } : null,
      tools: p.tools.map((t) => ({ name: t.name, decision: t.decision, readOnly: Boolean(t.readOnlyHint) })) };
  })();
  testing.set(name, job);
  try { return await job; } finally { testing.delete(name); }
}
