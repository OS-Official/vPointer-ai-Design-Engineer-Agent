import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { matchesAny, splitToolName } from '../mcp/config.js';
import { AGENT_ROOT } from '../config.js';

/*
 * Security guard: three outcomes for every tool call.
 *   deny  → never allowed, no prompt (destructive or secret-leaking)
 *   ask   → shown to you for a yes/no (deploys, pushes, installs, deletes)
 *   allow → runs without interrupting you
 *
 * These are pure functions so they can be unit-tested (see test/guard.test.js).
 */

// Files whose contents must never be read into the model's context.
const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(\..+)?$/i,           // .env, .env.local, .env.production
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.config\/gcloud\//i,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /(^|\/)credentials(\.json)?$/i,
  /service[-_]?account[^/]*\.json$/i,
  /(^|\/)wp-config\.php$/i,
  /(^|\/)\.vercel\/.*\.json$/i,
  /(^|\/)supabase\/\.temp\//i,
  /(^|\/)\.access-key$/i, // the window's private key (logs/ui/.access-key)
];
const SECRET_FILE_ALLOW = [/\.env\.example$/i, /\.env\.sample$/i, /\.env\.template$/i];

export function isSecretPath(p) {
  if (!p || typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/');
  if (SECRET_FILE_ALLOW.some((re) => re.test(norm))) return false;
  return SECRET_FILE_PATTERNS.some((re) => re.test(norm));
}

/**
 * Resolve symlinks in the part of `p` that exists, keeping the rest as written.
 * So project/link-to-home/new-file.txt resolves to the real place it would land.
 */
export function realPath(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/** True when `target` is inside one of `roots` (after resolving ~, .. and symlinks). */
export function isInside(target, roots) {
  if (!target || typeof target !== 'string') return false;
  const expanded = target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : target;
  const abs = realPath(path.resolve(roots[0], expanded));
  return roots.some((root) => {
    const rel = path.relative(realPath(root), abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/*
 * vPointer ai's own engine. When a chat's project folder is this folder (or contains it), an agent still never
 * changes the engine, the window, the tests, the logs or the two permission files without asking: otherwise it
 * could rewrite this guard or widen an app's allow list for itself. What people edit to build agents (agents/,
 * tasks/, standards/, context/, src/tools/defs/, docs/) follows the normal rules.
 */
const AGENT_CORE = new Set(['src', 'ui', 'test', 'evals', 'logs', 'node_modules', '.git', '.github', '.vscode',
  'package.json', 'package-lock.json', 'mcp.json', 'providers.json', 'LICENSE', 'NOTICE', 'SECURITY.md']);
const AGENT_CORE_OPEN = [['src', 'tools', 'defs']]; // inside the core, but meant to be edited (your checking tools)

/** The path relative to vPointer ai's folder when `p` is part of its engine, else null. */
export function agentCorePart(p, root = AGENT_ROOT) {
  if (!p || typeof p !== 'string') return null;
  const rel = path.relative(realPath(root), realPath(p));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (!AGENT_CORE.has(parts[0])) return null;
  if (AGENT_CORE_OPEN.some((open) => open.every((seg, i) => parts[i] === seg) && parts.length > open.length)) return null;
  return parts.join('/');
}

/** For a shell command run with `roots` as its project: the first engine path it names, if any. */
export function bashTouchesAgentCore(command, roots, root = AGENT_ROOT) {
  if (!roots?.length || !isInside(root, roots)) return null; // only when the project folder holds vPointer ai itself
  const tokens = String(command).split(/[\s;|&<>()'"`=]+/).filter((t) => t && !t.startsWith('-'));
  for (const t of tokens) {
    const tok = t.replace(/^~(?=$|\/)/, os.homedir());
    for (const base of path.isAbsolute(tok) ? [''] : roots) {
      const hit = agentCorePart(base ? path.resolve(base, tok) : tok, root);
      if (hit) return hit;
    }
  }
  return null;
}

// Bash commands that are never acceptable from an agent.
const BASH_DENY = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\*|\.\s*$|\.\.)/i, why: 'recursive force-delete of a root, home or parent folder' },
  { re: /\bsudo\b/i, why: 'sudo / privilege escalation' },
  { re: /\b(mkfs|dd\s+if=|diskutil\s+erase|format\s+[a-z]:)/i, why: 'disk-level operation' },
  { re: /(curl|wget|iwr|Invoke-WebRequest)[^|;&]*\|\s*(ba|z)?sh\b|\|\s*iex\b/i, why: 'piping a download straight into a shell' },
  { re: /\bchmod\s+(-R\s+)?0?777\b/i, why: 'world-writable permissions' },
  { re: /\bgit\s+push\b[^;&|]*(--force\b|-f\b|--force-with-lease\b)/i, why: 'force-push rewrites shared history' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i, why: 'discards work irreversibly' },
  { re: /\bnpm\s+publish\b|\bnpm\s+unpublish\b/i, why: 'publishing packages' },
  { re: /\b(printenv|env)\s*($|[|>;&])/i, why: 'dumps environment variables (may include secrets)' },
  { re: /\becho\s+["']?\$\{?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)/i, why: 'prints a secret variable' },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, why: 'fork bomb' },
  { re: /\bsupabase\s+db\s+reset\b(?![^;&|]*--local)/i, why: 'resets a remote database' },
  { re: /\bwp\s+db\s+(drop|reset)\b/i, why: 'drops a WordPress database' },
];

// Bash commands that are fine, but only after you say yes.
const BASH_ASK = [
  { re: /\bgit\s+push\b/i, why: 'pushes to a remote' },
  { re: /\bgit\s+commit\b/i, why: 'creates a commit' },
  { re: /\b(vercel|vc)\b[^;&|]*(--prod|deploy|\bpromote\b|\balias\b|\benv\b)/i, why: 'Vercel deploy or env change' },
  { re: /\bvercel\s*$/i, why: 'Vercel deploy' },
  { re: /\bwrangler\s+(deploy|publish|secret|pages\s+deploy)\b/i, why: 'Cloudflare deploy or secret change' },
  { re: /\bsupabase\s+(db\s+push|functions\s+deploy|secrets|link|migration\s+repair)\b/i, why: 'changes a Supabase project' },
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b\s+\S/i, why: 'adds a dependency' },
  { re: /\bnpx\s+\S/i, why: 'downloads and runs a package' },
  { re: /\bpip3?\s+install\b/i, why: 'installs a Python package' },
  { re: /\b(rm|rmdir|unlink|del|Remove-Item)\b/i, why: 'deletes files' },
  { re: /\bmv\b/i, why: 'moves or renames files' },
  { re: /\b(curl|wget)\b[^|]*\s(-X\s*(POST|PUT|PATCH|DELETE)|-d\b|--data|-T\b|--upload-file|-F\b|--form|--post-(data|file))/i, why: 'sends data to a server' },
  { re: /\bgh\s+(pr\s+(create|merge)|release|repo\s+(create|delete))\b/i, why: 'changes GitHub' },
  { re: /\bwp\s+(plugin|theme|user|option)\s+(install|delete|update|create|set)\b/i, why: 'changes a WordPress site' },
];

/** Returns { decision: 'deny'|'ask'|'allow', reason } for a shell command. */
export function classifyBash(command = '') {
  for (const { re, why } of BASH_DENY) if (re.test(command)) return { decision: 'deny', reason: `Blocked: ${why}.` };
  // Reading a secret file via the shell (cat .env, less id_rsa, etc.)
  const tokens = command.split(/[\s;|&<>()'"`]+/).filter(Boolean);
  const secret = tokens.find((t) => isSecretPath(t));
  if (secret) return { decision: 'deny', reason: `Blocked: command touches a secrets file (${secret}).` };
  for (const { re, why } of BASH_ASK) if (re.test(command)) return { decision: 'ask', reason: why };
  return { decision: 'allow', reason: 'routine command' };
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Grep searches file *contents* recursively, so a search for "API_KEY" would return lines
// from .env. When the model gives no file filter, we add one that excludes secret files.
const GREP_SECRET_EXCLUDE = '!{**/.env*,**/*.pem,**/*.key,**/*.p12,**/id_rsa*,**/id_ed25519*,**/wp-config.php,**/credentials*}';
// A filter like "*.js" or "*.{css,html}" only matches those extensions, so it is safe.
const NARROW_GLOB = /\*\.(\{[a-z0-9,]+\}|[a-z0-9]+)$/i;

// Documentation sites the agent may read without asking. Anything else asks first,
// because a fetched URL can carry data out (?q=...) and pages can contain prompt injection.
export const TRUSTED_FETCH_DOMAINS = [
  'developer.mozilla.org', 'tailwindcss.com', 'react.dev', 'nextjs.org', 'redux.js.org', 'redux-toolkit.js.org',
  'web.dev', 'w3.org', 'vercel.com', 'supabase.com', 'developers.cloudflare.com', 'webflow.com', 'university.webflow.com',
  'wordpress.org', 'elementor.com', 'figma.com', 'fonts.google.com', 'github.com', 'npmjs.com',
  'docs.claude.com', 'docs.anthropic.com', 'code.claude.com', 'next-intl.dev', 'next-intl-docs.vercel.app', 'plasmic.app', 'docs.plasmic.app',
];

export function isTrustedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TRUSTED_FETCH_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch { return false; }
}

/**
 * Central policy. `roots` = the project folder(s): the agent reads and writes freely
 * inside them and must ask to read anywhere else. `careful` asks before every write.
 * `toolPolicy` = { 'mcp__design__<name>': { readOnly } } from the tool registry.
 * `mcpPolicy`  = { '<server>': { allow: [patterns], deny: [patterns] } } from mcp.json.
 * Returns { decision, reason, updatedInput? }.
 */
export function evaluateToolCall(toolName, input = {}, { roots, careful = false, toolPolicy = {}, mcpPolicy = {} } = {}) {
  input = input && typeof input === 'object' ? input : {};
  const filePath = input.file_path || input.notebook_path || input.path || '';

  if (READ_TOOLS.has(toolName)) {
    // A glob like ".env*" or "**/{.env,*.pem}" targets secrets even though it isn't a real path.
    const secretGlob = (g) => typeof g === 'string' && !g.startsWith('!') &&
      (isSecretPath(g) || /(^|[\/{,])(\.env(?!\.(example|sample|template))|id_rsa|id_ed25519|wp-config|\*\.(pem|key|p12))/i.test(g));
    if (isSecretPath(filePath) || secretGlob(input.pattern) || secretGlob(input.glob)) {
      return { decision: 'deny', reason: `Secrets files are off-limits (${filePath || input.pattern || input.glob}). Use .env.example for structure.` };
    }
    // Outside the project (e.g. ~/.zshrc, ~/.config/gh) can hold tokens: ask first.
    if (filePath && !isInside(filePath, roots)) {
      return { decision: 'ask', reason: `read outside the project folder (${filePath})` };
    }
    // A Glob pattern can itself be a path ("/Users/me/**/*", "~/Documents/*", "../other/**").
    if (toolName === 'Glob' && !filePath && typeof input.pattern === 'string') {
      const fixed = input.pattern.split(/[*?[{]/)[0];
      if (/^([/\\~]|[a-z]:|\.\.)/i.test(fixed) && !isInside(fixed || '.', roots)) {
        return { decision: 'ask', reason: `list files outside the project folder (${input.pattern})` };
      }
    }
    if (toolName === 'Grep' && !(input.glob && NARROW_GLOB.test(input.glob)) && !input.type) {
      if (input.glob) return { decision: 'ask', reason: `search file contents with a broad filter (${input.glob}) that could include secret files` };
      return { decision: 'allow', reason: 'content search (secret files excluded)', updatedInput: { ...input, glob: GREP_SECRET_EXCLUDE } };
    }
    return { decision: 'allow', reason: 'read inside project' };
  }

  if (WRITE_TOOLS.has(toolName)) {
    if (isSecretPath(filePath)) return { decision: 'deny', reason: 'Writing to a secrets file is not allowed. Ask the user to edit it themselves.' };
    if (!isInside(filePath, roots)) return { decision: 'deny', reason: `Write outside the project folder (${filePath}) is not allowed.` };
    const core = agentCorePart(filePath);
    if (core) return { decision: 'ask', reason: `change vPointer ai’s own engine (${core})` };
    return careful ? { decision: 'ask', reason: `write ${path.basename(filePath)}` } : { decision: 'allow', reason: 'write inside project' };
  }

  if (toolName === 'Bash') {
    const command = String(input.command ?? '');
    const verdict = classifyBash(command);
    if (verdict.decision !== 'allow') return verdict;
    const core = bashTouchesAgentCore(command, roots);
    return core ? { decision: 'ask', reason: `run a command on vPointer ai’s own engine (${core})` } : verdict;
  }

  if (toolName === 'WebFetch') {
    const url = String(input.url ?? '');
    if (!/^https:\/\//i.test(url)) return { decision: 'deny', reason: 'Only https URLs may be fetched.' };
    return isTrustedUrl(url)
      ? { decision: 'allow', reason: 'trusted documentation site' }
      : { decision: 'ask', reason: `fetch a page from ${(() => { try { return new URL(url).hostname; } catch { return url; } })()}` };
  }

  // Custom tools: read-only ones run freely; any tool not marked readOnly: true asks first.
  if (toolName.startsWith('mcp__design__')) {
    const meta = Object.hasOwn(toolPolicy, toolName) ? toolPolicy[toolName] : null;
    if (!meta) return { decision: 'ask', reason: `unregistered custom tool ${toolName}` };
    return meta.readOnly
      ? { decision: 'allow', reason: 'read-only custom tool' }
      : { decision: 'ask', reason: `custom tool ${toolName.replace('mcp__design__', '')} is not read-only` };
  }

  // External apps (mcp.json): deny patterns block, allow patterns run freely, everything else asks.
  const ext = splitToolName(toolName);
  if (ext) {
    const policy = Object.hasOwn(mcpPolicy, ext.server) ? mcpPolicy[ext.server] : null;
    if (!policy) return { decision: 'ask', reason: `${ext.tool} from unconfigured app "${ext.server}"` };
    if (matchesAny(ext.tool, policy.deny)) return { decision: 'deny', reason: `${ext.server}: "${ext.tool}" is blocked in mcp.json (dea.deny)` };
    if (matchesAny(ext.tool, policy.allow)) return { decision: 'allow', reason: `${ext.server}: allowed in mcp.json` };
    return { decision: 'ask', reason: `use ${ext.server} → ${ext.tool}` };
  }

  if (['Agent', 'TodoWrite', 'WebSearch', 'ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].includes(toolName)) {
    return { decision: 'allow', reason: 'orchestration' };
  }

  // Anything unknown: ask rather than assume.
  return { decision: 'ask', reason: `unrecognised tool ${toolName}` };
}
