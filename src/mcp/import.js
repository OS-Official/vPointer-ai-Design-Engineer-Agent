#!/usr/bin/env node
/*
 * npm run mcp:import                      list the apps in your Claude Desktop config
 * npm run mcp:import -- notion            copy one (or several) into mcp.json
 * npm run mcp:import -- --all             copy all of them
 * Options: --from <path to a claude_desktop_config.json>   --force (replace an entry already in mcp.json)
 *
 * Secrets in the copied entries (env values, headers and --token style args) are moved to .env
 * and replaced with ${VAR} references, so mcp.json never holds a secret.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_ROOT } from '../config.js';
import { MCP_FILE, RESERVED_SERVERS } from './config.js';

export const READ_PATTERNS = ['get_*', 'list_*', 'read_*', 'search_*', 'find_*', 'describe_*', 'inspect_*'];
const SECRET_KEY = /(key|token|secret|password|passwd|auth|credential|cookie|session)/i;

export function desktopConfigPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

const varName = (server, key) => `DEA_MCP_${server}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
const isRef = (v) => /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v);

/** Moves secret values out of one entry. Returns { entry, secrets }. */
export function extractSecrets(server, entry) {
  const secrets = {};
  const out = structuredClone(entry);
  const take = (key, value) => {
    if (typeof value !== 'string' || !value || isRef(value)) return value;
    const name = varName(server, key);
    secrets[name] = value;
    return `\${${name}}`;
  };
  if (out.env) for (const [k, v] of Object.entries(out.env)) if (SECRET_KEY.test(k)) out.env[k] = take(k, v);
  if (out.headers) for (const [k, v] of Object.entries(out.headers)) if (SECRET_KEY.test(k)) out.headers[k] = take(k.replace(/-/g, '_'), v);
  if (Array.isArray(out.args)) {
    for (let i = 0; i < out.args.length; i++) {
      const a = out.args[i];
      const inline = /^(--?[\w-]*(?:key|token|secret|password)[\w-]*)=(.+)$/i.exec(a);
      if (inline) { out.args[i] = `${inline[1]}=${take(inline[1].replace(/^-+/, ''), inline[2])}`; continue; }
      if (/^--?[\w-]*(?:key|token|secret|password)[\w-]*$/i.test(a) && typeof out.args[i + 1] === 'string' && !out.args[i + 1].startsWith('-')) {
        out.args[i + 1] = take(a.replace(/^-+/, ''), out.args[i + 1]);
        i++;
      }
    }
  }
  return { entry: out, secrets };
}

/**
 * Merge Claude Desktop entries into mcp.json's servers.
 * Keeps your existing dea settings when an entry is replaced with --force.
 */
export function importEntries(desktopServers, currentServers, { names, force = false } = {}) {
  const servers = structuredClone(currentServers ?? {});
  const added = [];
  const skipped = [];
  const secrets = {};
  for (const name of names) {
    const src = desktopServers && Object.hasOwn(desktopServers, name) ? desktopServers[name] : null;
    if (!src) { skipped.push(`${name}: not in the Claude Desktop config`); continue; }
    if (RESERVED_SERVERS.includes(name.toLowerCase())) { skipped.push(`${name}: reserved name, rename it in mcp.json by hand`); continue; }
    const existing = Object.hasOwn(servers, name) ? servers[name] : null;
    const isPlaceholder = existing && /REPLACE/.test(JSON.stringify([existing.command, existing.url]));
    if (existing && !force && !isPlaceholder) { skipped.push(`${name}: already in mcp.json (use --force to replace it)`); continue; }
    const { dea: _ignored, ...transport } = src;
    const { entry, secrets: s } = extractSecrets(name, transport);
    Object.assign(secrets, s);
    const dea = existing?.dea
      ? { ...existing.dea, enabled: true }
      : { enabled: true, description: `${name} (imported from Claude Desktop)`, allow: READ_PATTERNS, deny: [], local: true, alwaysLoad: false };
    servers[name] = { ...entry, dea };
    added.push(name);
  }
  return { servers, added, skipped, secrets };
}

/** Set or replace VAR=value lines in .env text. */
export function upsertEnv(text, vars) {
  let out = text.trim() ? text.replace(/\s*$/, '\n') : '';
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${/^[\w@%+=:,./-]*$/.test(v) ? v : JSON.stringify(v)}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    out = re.test(out) ? out.replace(re, line) : `${out}${line}\n`;
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const from = argv.includes('--from') ? argv[argv.indexOf('--from') + 1] : desktopConfigPath();
  const force = argv.includes('--force');
  const all = argv.includes('--all');
  const wanted = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--from');

  let desktop;
  try { desktop = JSON.parse(fs.readFileSync(from, 'utf8')).mcpServers ?? {}; } catch (e) {
    console.error(`\x1b[31mCan't read ${from}: ${e.code === 'ENOENT' ? 'file not found' : e.message}\x1b[0m\nPass the file with --from <path>, or copy the entry into mcp.json by hand.`);
    process.exit(1);
  }
  const available = Object.keys(desktop);
  if (!wanted.length && !all) {
    console.log(`Apps in ${from}:\n${available.map((n) => `  • ${n}`).join('\n') || '  (none)'}\n\nImport with:  npm run mcp:import -- <name>   (or --all)`);
    return;
  }
  const current = fs.existsSync(MCP_FILE) ? JSON.parse(fs.readFileSync(MCP_FILE, 'utf8')) : { mcpServers: {} };
  const result = importEntries(desktop, current.mcpServers ?? {}, { names: all ? available : wanted, force });
  fs.writeFileSync(MCP_FILE, `${JSON.stringify({ ...current, mcpServers: result.servers }, null, 2)}\n`);

  const envFile = path.join(AGENT_ROOT, '.env');
  if (Object.keys(result.secrets).length) {
    const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    fs.writeFileSync(envFile, upsertEnv(before, result.secrets), { mode: 0o600 });
  }
  for (const n of result.added) console.log(`\x1b[32m✔ Imported ${n}\x1b[0m`);
  for (const s of result.skipped) console.log(`\x1b[33m– ${s}\x1b[0m`);
  if (Object.keys(result.secrets).length) console.log(`Moved ${Object.keys(result.secrets).length} secret(s) to .env: ${Object.keys(result.secrets).join(', ')}`);
  if (result.added.length) {
    console.log(`\nNew apps run read-style tools (${READ_PATTERNS.join(', ')}) freely and ask before anything else.`);
    console.log('Change that per app in mcp.json → "dea" → "allow" / "deny". Then test the connection:  npm run check -- --mcp');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
