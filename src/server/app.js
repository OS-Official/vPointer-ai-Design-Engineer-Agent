import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

import { AGENT_ROOT } from '../config.js';
import { loadEverything } from '../bootstrap.js';
import { loadProviders, listModels } from '../engine/models.js';
import { checkWorkFolder } from '../engine/session.js';
import { listTasks } from '../engine/commands.js';
import { listApps, setAppEnabled, testApp, appNames } from '../mcp/manage.js';
import { createThreadStore } from './threads.js';
import { createRuntime } from './runtime.js';
import { createMemory } from './memory.js';

/*
 * The web UI's local server. Plain node:http, no framework, no new dependencies.
 *
 * Safety (the server can run the agent, so only you may reach it):
 *   - listens on 127.0.0.1 only: nothing on your network can connect
 *   - every /api call needs the secret token from the link printed at start-up (x-dea-token header)
 *   - Host must be 127.0.0.1/localhost:<port> (stops DNS-rebinding pages) and cross-site Origins are refused
 *   - strict Content-Security-Policy: the page runs only its own scripts, connects only to this server
 *   - API keys stay in .env on the server; the browser only learns whether a provider is available
 */
export const UI_DIR = path.join(AGENT_ROOT, 'ui');
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/markdown.js': 'markdown.js', '/styles.css': 'styles.css', '/theme.js': 'theme.js', '/icon.svg': 'icon.svg', '/icon-light.svg': 'icon-light.svg',
  // official app logos for the Apps window (sources and licences: NOTICE)
  '/logos/figma.svg': 'logos/figma.svg', '/logos/github.svg': 'logos/github.svg', '/logos/playwright.svg': 'logos/playwright.svg', '/logos/supabase.svg': 'logos/supabase.svg' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export function createApp({ token, port, threadsDir, memoryDir = path.join(threadsDir, 'memory'), env = process.env, uiDir = UI_DIR, runtimeFactory = createRuntime }) {
  const store = createThreadStore(threadsDir);
  // Notes for new chats in the same folder (logs/ui/memory, git-ignored). DEA_MEMORY=off in .env turns them off.
  const memory = createMemory(memoryDir, { enabled: !/^(off|0|false|no)$/i.test(String(env.DEA_MEMORY ?? '').trim()) });
  const clients = new Set();
  const backlog = [];
  let seq = 0;
  const broadcast = (e) => {
    const ev = { seq: ++seq, ...e };
    backlog.push(ev);
    if (backlog.length > 1000) backlog.shift();
    const chunk = `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(chunk);
  };
  const runtime = runtimeFactory({ store, broadcast, env, memory });
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const tokenBuf = Buffer.from(token);

  // ---------- helpers ----------
  const send = (res, status, body, headers = {}) => {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };
  const fail = (res, status, message) => send(res, status, { error: message });
  const tokenOk = (req) => {
    const got = Buffer.from(String(req.headers['x-dea-token'] ?? ''));
    return got.length === tokenBuf.length && crypto.timingSafeEqual(got, tokenBuf);
  };
  async function body(req, limit = 256 * 1024) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
      chunks.push(c);
    }
    if (!size) return {};
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error('Send JSON.'), { status: 415 });
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }

  // ---------- configuration snapshot (re-read at most every 3s, so edits apply without a restart) ----------
  let snapCache = null;
  const appTests = {}; // last connection test per app (shown in the Apps window)
  async function snapshot() {
    if (snapCache && Date.now() - snapCache.at < 3000) return snapCache.data;
    const providersConfig = loadProviders({ env });
    const providers = await Promise.all(Object.values(providersConfig.providers).map((p) => listModels(p)));
    const loaded = await loadEverything({ local: false, env });
    const defaults = { ...providersConfig.default };
    const dp = providers.find((p) => p.id === defaults.provider);
    if (dp?.type === 'ollama' && dp.models?.length && !dp.models.some((m) => m.id === defaults.model)) defaults.model = dp.models[0].id;
    const data = {
      providers: providers.map(({ id, type, label, available, reason, models, local, host, defaultModel, apiKeyEnv }) => ({ id, type, label, available: available !== false, reason, models, local, host, defaultModel: defaultModel ?? null, apiKeyEnv: apiKeyEnv ?? null })),
      defaults,
      projects: loaded.projects.map((slug) => ({ slug, brand: Object.entries(loaded.brands).find(([, b]) => b.projects.includes(slug))?.[0] ?? null })),
      brands: Object.entries(loaded.brands).map(([slug, b]) => ({ slug, name: b.name, version: b.version })),
      specialists: Object.entries(loaded.specialists).map(([name, d]) => ({ name, description: d.description, standards: d.standards ?? [], tools: d.tools.length })),
      waiting: loaded.waiting,
      disabled: loaded.disabled,
      standards: Object.values(loaded.standards).map((s) => ({ name: s.name, description: s.description, brand: s.brand })),
      tools: loaded.tools.map((t) => ({ name: t.name, readOnly: t.readOnly })),
      apps: Object.entries(loaded.mcp.servers).map(([name, s]) => ({ name, description: s.dea.description, allow: s.dea.allow, deny: s.dea.deny })),
      skippedApps: loaded.mcp.skipped,
      appList: await listApps({ env }).catch(() => []),
      appTests,
      tasks: await listTasks(),
      errors: [...providersConfig.errors, ...loaded.errors],
      warnings: [...providersConfig.warnings, ...loaded.warnings],
      home: os.homedir(),
      platform: process.platform,
    };
    snapCache = { at: Date.now(), data };
    return data;
  }

  function recentFolders() {
    const seen = [];
    for (const t of store.list()) if (t.cwd && !seen.includes(t.cwd)) seen.push(t.cwd);
    return seen.slice(0, 8);
  }

  // Folder picker: directory names only (never file contents), and only inside your home folder.
  function folders(p) {
    const home = fs.realpathSync(os.homedir());
    let abs;
    try { abs = fs.realpathSync(path.resolve((p || home).replace(/^~(?=$|\/)/, home))); } catch { throw Object.assign(new Error(`There's no folder at ${p}.`), { status: 404 }); }
    if (!fs.statSync(abs).isDirectory()) throw Object.assign(new Error(`${abs} is a file, not a folder.`), { status: 400 });
    if (abs !== home && !abs.startsWith(home + path.sep)) throw Object.assign(new Error('Only folders inside your home folder can be browsed.'), { status: 403 });
    const dirs = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !['node_modules', 'Library', 'Applications'].includes(d.name))
      .map((d) => d.name).sort((a, b) => a.localeCompare(b)).slice(0, 500);
    const marker = ['package.json', '.git', 'index.html', 'CLAUDE.md'].find((m) => fs.existsSync(path.join(abs, m)));
    return { path: abs, parent: abs === home ? null : path.dirname(abs), dirs, isProject: Boolean(marker), canUse: abs !== home };
  }

  function threadInput(b, t = {}) {
    const out = {};
    if ('cwd' in b) {
      try { out.cwd = checkWorkFolder(String(b.cwd)); } catch (e) { throw Object.assign(e, { status: 400 }); }
    }
    if ('project' in b) out.project = b.project ? String(b.project) : null;
    if ('provider' in b) out.provider = String(b.provider);
    if ('model' in b) out.model = b.model ? String(b.model) : null;
    if ('careful' in b) out.careful = b.careful === true;
    if ('title' in b) out.title = String(b.title).replace(/\s+/g, ' ').trim().slice(0, 80) || t.title || 'New chat';
    if ('pinned' in b) out.pinned = b.pinned === true;
    if ('apps' in b) {
      // A chat's own app list can only narrow the apps that are on; null means "all apps that are on".
      if (b.apps === null) out.apps = null;
      else {
        if (!Array.isArray(b.apps) || b.apps.length > 64 || b.apps.some((n) => typeof n !== 'string')) throw Object.assign(new Error('"apps" must be a list of app names, or null for every app that is on.'), { status: 400 });
        const known = appNames();
        const unknown = b.apps.filter((n) => !known.includes(n));
        if (unknown.length) throw Object.assign(new Error(`No app ${unknown.join(', ')} in mcp.json.`), { status: 400 });
        out.apps = [...new Set(b.apps)];
      }
    }
    return out;
  }

  // ---------- apps (mcp.json): list, turn on or off, test. Nothing else can be changed from here. ----------
  const ONLY_ON_OFF = 'Only on and off can be changed here. To add an app, or change its command, address or tokens, edit mcp.json (and .env).';
  async function appsRoute(req, res, url) {
    if (url.pathname === '/api/apps') {
      if (req.method === 'GET') return send(res, 200, { apps: await listApps({ env }), tests: appTests });
      return fail(res, 405, ONLY_ON_OFF);
    }
    let r;
    if ((r = url.pathname.match(/^\/api\/apps\/([A-Za-z0-9_-]{1,64})$/))) {
      const name = r[1];
      if (req.method !== 'PATCH') return fail(res, 405, ONLY_ON_OFF);
      const b = await body(req, 1024);
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).join() !== 'enabled' || typeof b.enabled !== 'boolean') return fail(res, 400, ONLY_ON_OFF);
      await setAppEnabled(name, b.enabled);
      snapCache = null;
      delete appTests[name];
      await runtime.appsChanged();
      broadcast({ type: 'apps-changed' });
      return send(res, 200, { app: (await listApps({ env })).find((a) => a.name === name) });
    }
    if ((r = url.pathname.match(/^\/api\/apps\/([A-Za-z0-9_-]{1,64})\/test$/))) {
      if (req.method !== 'POST') return fail(res, 405, 'Use POST to test an app.');
      const result = await testApp(r[1], { env });
      appTests[r[1]] = result;
      broadcast({ type: 'apps-changed' });
      return send(res, 200, result);
    }
    return fail(res, 404, 'Not found.');
  }

  // ---------- routes ----------
  async function api(req, res, url) {
    const m = (re) => url.pathname.match(re);
    let r;

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const since = Number(url.searchParams.get('since') ?? 0);
      if (since) for (const ev of backlog) if (ev.seq > since) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
      res.write(`data: ${JSON.stringify({ seq, type: 'hello' })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (url.pathname === '/api/apps' || url.pathname.startsWith('/api/apps/')) return appsRoute(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, { ...(await snapshot()), recentFolders: recentFolders(), approvals: runtime.pendingApprovals() });
    if (req.method === 'GET' && url.pathname === '/api/folders') return send(res, 200, folders(url.searchParams.get('path')));
    if (req.method === 'GET' && url.pathname === '/api/threads') return send(res, 200, { threads: store.list().map((t) => ({ ...t, busy: runtime.busy(t.id) })) });
    if (req.method === 'POST' && url.pathname === '/api/threads') {
      const b = await body(req);
      const snap = await snapshot();
      const input = threadInput({ ...b, provider: b.provider || snap.defaults.provider, model: b.provider ? b.model : snap.defaults.model });
      if (!input.cwd) return fail(res, 400, 'Choose a project folder to work in.');
      if (input.project && !snap.projects.some((p) => p.slug === input.project)) return fail(res, 400, `No project brief "${input.project}".`);
      const t = store.create(input);
      return send(res, 201, { thread: t });
    }
    if ((r = m(/^\/api\/threads\/(t_[a-z0-9]{12})$/))) {
      const id = r[1];
      const t = store.get(id);
      if (!t) return fail(res, 404, 'No such chat.');
      if (req.method === 'GET') return send(res, 200, { thread: { ...t, busy: runtime.busy(id) }, approvals: runtime.pendingApprovals(id), live: runtime.liveView?.(id) ?? { calls: [], frames: [] } });
      if (req.method === 'PATCH') {
        const b = await body(req);
        if (runtime.busy(id) && ['cwd', 'project', 'provider', 'model', 'careful', 'apps'].some((k) => k in b)) return fail(res, 409, 'Wait for the current message to finish, or stop it, before changing settings.');
        if (('cwd' in b || 'project' in b) && t.items.some((i) => i.kind === 'user')) return fail(res, 409, 'The folder and brief are fixed once a chat has started. Start a new chat for another project.');
        const input = threadInput(b, t);
        if (input.project && !(await snapshot()).projects.some((p) => p.slug === input.project)) return fail(res, 400, `No project brief "${input.project}".`);
        const updated = store.update(id, input);
        await runtime.settingsChanged(id);
        broadcast({ threadId: id, type: 'thread', thread: store.summary(updated) });
        return send(res, 200, { thread: updated });
      }
      if (req.method === 'DELETE') {
        await runtime.closeThread(id);
        runtime.forgetLive?.(id);
        runtime.forgetChat?.(id); // its notes for new chats go too
        store.remove(id);
        broadcast({ threadId: id, type: 'thread-deleted' });
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'POST' && (r = m(/^\/api\/threads\/(t_[a-z0-9]{12})\/messages$/))) {
      const b = await body(req, 512 * 1024);
      return send(res, 202, await runtime.send(r[1], b.text));
    }
    if (req.method === 'POST' && (r = m(/^\/api\/threads\/(t_[a-z0-9]{12})\/stop$/))) {
      await runtime.interrupt(r[1]);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && (r = m(/^\/api\/threads\/(t_[a-z0-9]{12})\/apps$/))) return send(res, 200, { apps: await runtime.appStatus(r[1]) });
    // Memory: the notes new chats in this chat's folder start with. Read them, or forget them all.
    if ((r = m(/^\/api\/threads\/(t_[a-z0-9]{12})\/memory$/)) && ['GET', 'DELETE'].includes(req.method)) {
      if (!store.get(r[1])) return fail(res, 404, 'No such chat.');
      if (req.method === 'DELETE') runtime.forgetMemory?.(r[1]);
      return send(res, 200, { memory: runtime.memoryInfo?.(r[1]) ?? { on: false, chats: 0, file: null, notes: '' } });
    }
    if (req.method === 'POST' && (r = m(/^\/api\/approvals\/([^/]+)$/))) {
      const id = decodeURIComponent(r[1]);
      if (!/^t_[a-z0-9]{12}:ap\d+$/.test(id)) return fail(res, 404, 'No such approval.');
      const b = await body(req);
      return runtime.answer(id, b.allow === true) ? send(res, 200, { ok: true }) : fail(res, 404, 'That approval was already answered or has expired.');
    }
    return fail(res, 404, 'Not found.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      // DNS rebinding: a hostile page can point its own domain at 127.0.0.1, but it can't fake the Host header.
      if (!allowedHosts.has(String(req.headers.host ?? ''))) return fail(res, 421, 'Open the agent at http://127.0.0.1:' + port);
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.has(origin)) return fail(res, 403, 'Cross-site request refused.');
        if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return fail(res, 403, 'Cross-site request refused.');
        if (!tokenOk(req)) return fail(res, 401, 'Open the link printed in the terminal (it carries your access key).');
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed.');
      const file = STATIC[url.pathname];
      if (!file) return fail(res, 404, 'Not found.');
      const content = await fs.promises.readFile(path.join(uiDir, file));
      return send(res, 200, content, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch (err) {
      if (!res.headersSent) fail(res, err.status ?? 500, err.status ? err.message : `Server error: ${err.message}`);
      else res.end();
    }
  });

  return {
    server,
    store,
    runtime,
    async close() {
      for (const c of clients) c.end();
      await runtime.shutdown();
      store.flushAll();
      await new Promise((r) => server.close(() => r()));
    },
  };
}
