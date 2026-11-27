import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENT_ROOT } from '../config.js';

/*
 * External apps over MCP (Figma, Playwright, GitHub, Supabase, anything else), configured in mcp.json.
 *
 * mcp.json uses the same "mcpServers" format as Claude Desktop, so an entry can be copied
 * across as is. Our own settings live in a separate "dea" block inside each entry:
 *
 *   "figma": {
 *     "type": "http", "url": "http://127.0.0.1:3845/mcp",       // or "command" + "args" (+ "env") for a local program
 *     "dea": {
 *       "enabled": true,
 *       "description": "Figma desktop app",
 *       "allow": ["get_*", "search_*"],    // run without asking
 *       "deny":  ["delete_*"],             // always blocked
 *                                          // everything else asks you first
 *       "local": true,                     // also connect in --local sessions
 *       "alwaysLoad": false                // Claude mode: send all tool definitions up front
 *     }
 *   }
 *
 * ${NAME} anywhere in command, args, env, url or headers is replaced from .env / your shell,
 * so secrets never sit in mcp.json.
 */

export const MCP_FILE = process.env.DEA_MCP_FILE ? path.resolve(process.env.DEA_MCP_FILE) : path.join(AGENT_ROOT, 'mcp.json');
export const RESERVED_SERVERS = ['design']; // the agent's own built-in tools
export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*(?:_[a-zA-Z0-9-]+)*$/; // no "__": tool names are mcp__<server>__<tool>
const TRANSPORT_KEYS = ['type', 'command', 'args', 'env', 'url', 'headers', 'timeout'];

/** Replace ${VAR} from env. Returns { value, missing: [names] }. */
export function substitute(value, env) {
  const missing = [];
  const walk = (v) => {
    if (typeof v === 'string') return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => (env[k] !== undefined && env[k] !== '' ? env[k] : (missing.push(k), '')));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), missing: [...new Set(missing)] };
}

/** "get_*" matches "get_page". Patterns are matched against the tool name without its mcp__server__ prefix. */
export function matchesAny(tool, patterns = []) {
  return patterns.some((p) => new RegExp(`^${String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(tool));
}

/** "mcp__figma__get_metadata" → { server: 'figma', tool: 'get_metadata' } */
export function splitToolName(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name ?? '');
  return m ? { server: m[1], tool: m[2] } : null;
}

export async function readMcpFile(file = MCP_FILE) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { mcpServers: {} };
    throw e;
  }
  try { return JSON.parse(text); } catch (e) { throw new Error(`mcp.json is not valid JSON: ${e.message}`); }
}

/**
 * Load, validate and resolve mcp.json.
 * Returns { servers: { name: { config, dea } }, skipped: { name: reason }, errors, warnings }.
 *   config = what the SDK receives (Claude Desktop fields only, ${VARS} resolved)
 *   dea    = our settings (permissions, description, …) with defaults
 */
export async function loadMcp({ file = MCP_FILE, env = process.env, local = false } = {}) {
  const servers = {};
  const skipped = {};
  const errors = [];
  const warnings = [];
  let raw;
  try { raw = await readMcpFile(file); } catch (e) { return { servers, skipped, errors: [e.message], warnings }; }
  const entries = raw?.mcpServers;
  if (entries === undefined) return { servers, skipped, errors, warnings };
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { servers, skipped, errors: ['mcp.json: "mcpServers" must be an object'], warnings };

  for (const [name, entry] of Object.entries(entries)) {
    const where = `mcp.json → ${name}`;
    if (!NAME_RE.test(name)) { errors.push(`${where}: names use letters, digits, "-" and single "_" only`); continue; }
    if (RESERVED_SERVERS.includes(name.toLowerCase())) { errors.push(`${where}: "${name}" is reserved for the agent's built-in tools; pick another name`); continue; }
    if (!entry || typeof entry !== 'object') { errors.push(`${where}: must be an object`); continue; }

    const dea = {
      enabled: true, description: '', allow: [], deny: [], local: true, alwaysLoad: false,
      ...(entry.dea && typeof entry.dea === 'object' ? entry.dea : {}),
    };
    for (const k of ['allow', 'deny']) {
      if (!Array.isArray(dea[k]) || dea[k].some((p) => typeof p !== 'string' || !p)) { errors.push(`${where}: dea.${k} must be a list of tool-name patterns like "get_*"`); dea[k] = []; }
    }
    if (dea.enabled === false) { skipped[name] = 'disabled in mcp.json'; continue; }
    if (local && dea.local === false) { skipped[name] = 'not used in --local sessions (dea.local: false)'; continue; }

    const transport = Object.fromEntries(Object.entries(entry).filter(([k]) => TRANSPORT_KEYS.includes(k)));
    const type = transport.type ?? (transport.url ? 'http' : 'stdio');
    if (!['stdio', 'http', 'sse'].includes(type)) { errors.push(`${where}: type must be stdio, http or sse`); continue; }
    if (type === 'stdio' && (typeof transport.command !== 'string' || !transport.command)) { errors.push(`${where}: needs a "command" (or a "url" for an http server)`); continue; }
    if (type !== 'stdio' && (typeof transport.url !== 'string' || !/^https?:\/\//.test(transport.url))) { errors.push(`${where}: needs an http(s) "url"`); continue; }
    if (transport.args !== undefined && !Array.isArray(transport.args)) { errors.push(`${where}: "args" must be a list`); continue; }
    if (/REPLACE|<.+>/.test(JSON.stringify([transport.command, transport.url, transport.args]))) {
      errors.push(`${where}: still has a placeholder; run  npm run mcp:import -- ${name}  or paste the entry from Claude Desktop`);
      continue;
    }

    const { value, missing } = substitute(transport, env);
    if (missing.length) {
      warnings.push(`${where}: skipped, set ${missing.join(', ')} in .env`);
      skipped[name] = `missing ${missing.join(', ')} in .env`;
      continue;
    }
    if (type !== 'stdio') {
      const host = new URL(value.url).hostname;
      if (value.url.startsWith('http://') && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
        warnings.push(`${where}: ${value.url} is plain http to another computer; prefer https`);
      }
    }
    const config = { ...value, type };
    if (dea.alwaysLoad === true) config.alwaysLoad = true;
    servers[name] = { config, dea };
  }
  return { servers, skipped, errors, warnings };
}

/** Per-server permission patterns for the security guard. */
export function mcpPolicy(servers) {
  return Object.fromEntries(Object.entries(servers).map(([name, s]) => [name, { allow: s.dea.allow, deny: s.dea.deny }]));
}

/** The SDK's mcpServers option for external servers. */
export function sdkServers(servers) {
  return Object.fromEntries(Object.entries(servers).map(([name, s]) => [name, s.config]));
}
