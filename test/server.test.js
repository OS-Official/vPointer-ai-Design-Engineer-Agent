import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProviders, compatibleEnv, prepareModel } from '../src/engine/models.js';
import { createApp } from '../src/server/app.js';
import { createRuntime, titleFrom } from '../src/server/runtime.js';
import { createThreadStore } from '../src/server/threads.js';
import { expandInput } from '../src/engine/commands.js';
import { checkWorkFolder } from '../src/engine/session.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (dir, name, obj) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('providers: defaults, env overrides, validation and per-provider default models', () => {
  const none = loadProviders({ file: '/nonexistent/providers.json', env: { ANTHROPIC_API_KEY: 'k' } });
  assert.deepEqual(Object.keys(none.providers), ['anthropic', 'ollama']);
  assert.deepEqual(none.default, { provider: 'anthropic', model: 'opus' });

  const shipped = loadProviders({ env: { DEA_PROVIDER: 'ollama', DEA_OLLAMA_URL: 'http://127.0.0.1:9', DEA_OLLAMA_MODEL: 'mine:latest' } });
  assert.deepEqual(shipped.errors, []);
  assert.equal(shipped.providers.ollama.url, 'http://127.0.0.1:9', '.env wins over providers.json');
  assert.deepEqual(shipped.default, { provider: 'ollama', model: 'mine:latest' });
  assert.equal(shipped.providers['other-api'], undefined, 'disabled example stays off');
  assert.equal(shipped.providers.anthropic.available, false);

  const dir = tmp('prov-');
  const bad = loadProviders({ file: write(dir, 'p.json', { providers: { 'my-api': { type: 'anthropic-compatible', baseUrl: 'https://REPLACE', apiKeyEnv: 'lower', models: [] }, Bad: { type: 'nope' } } }), env: {} });
  assert.ok(bad.errors.some((e) => /baseUrl/.test(e)));
  assert.ok(bad.errors.some((e) => /apiKeyEnv/.test(e)));
  assert.ok(bad.errors.some((e) => /at least one model/.test(e)));
  assert.ok(bad.errors.some((e) => /Bad: name must be/.test(e)));

  const ok = loadProviders({ file: write(dir, 'q.json', { providers: { 'my-api': { type: 'anthropic-compatible', baseUrl: 'https://api.example-ai.dev/anthropic', apiKeyEnv: 'DEA_PROVIDER_MY_API_KEY', models: [{ id: 'm1' }] } } }), env: {} });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.providers['my-api'].available, false);
  assert.ok(ok.warnings.some((w) => /DEA_PROVIDER_MY_API_KEY is not set/.test(w)));
});

test('a third-party API never receives your Anthropic key or other secrets', async () => {
  const p = { baseUrl: 'https://api.example-ai.dev/anthropic', apiKeyEnv: 'DEA_PROVIDER_X_KEY', auth: 'x-api-key', maxOutputTokens: 8192 };
  const env = compatibleEnv({ ANTHROPIC_API_KEY: 'sk-ant-mine', CLAUDE_CODE_OAUTH_TOKEN: 'o', DEA_MCP_GITHUB_TOKEN: 's', DEA_PROVIDER_OTHER_KEY: 'z', PATH: '/bin' }, p, 'm1', 'third-party-key');
  assert.equal(env.ANTHROPIC_API_KEY, 'third-party-key');
  assert.equal(env.ANTHROPIC_BASE_URL, p.baseUrl);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(env.DEA_MCP_GITHUB_TOKEN, undefined);
  assert.equal(env.DEA_PROVIDER_OTHER_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'm1');
  const bearer = compatibleEnv({}, { ...p, auth: 'bearer' }, 'm1', 'k');
  assert.equal(bearer.ANTHROPIC_AUTH_TOKEN, 'k');
  assert.equal(bearer.ANTHROPIC_API_KEY, undefined);

  const providers = { x: { id: 'x', type: 'anthropic-compatible', label: 'X', ...p, models: [{ id: 'm1', label: 'M1' }], contextTokens: 64000, host: 'api.example-ai.dev' } };
  const run = await prepareModel({ provider: 'x' }, { providers, env: { DEA_PROVIDER_X_KEY: 'k' } });
  assert.equal(run.fullTools, false);
  assert.equal(run.costKnown, false);
  assert.deepEqual(run.lite, { contextTokens: 64000 });
  assert.match(run.notes[0], /sent to api\.example-ai\.dev/);
  await assert.rejects(prepareModel({ provider: 'x' }, { providers, env: {} }), /DEA_PROVIDER_X_KEY is not set/);
  await assert.rejects(prepareModel({ provider: 'x', model: 'm9' }, { providers, env: { DEA_PROVIDER_X_KEY: 'k' } }), /no model "m9"/);
});

test('chat titles read well: task name first, cut at a word', () => {
  assert.equal(titleFrom('Build the hero'), 'Build the hero');
  assert.equal(titleFrom('/build Northwind Trail Pack 30 hero: size tabs, title block, key figures', 'build'), 'Build: Northwind Trail Pack 30 hero: size tabs, title…');
  assert.equal(titleFrom('/audit', 'audit'), 'Audit');
});

test('work folders: never the home folder or a drive root', () => {
  assert.throws(() => checkWorkFolder(os.homedir()), /Refusing to work/);
  assert.throws(() => checkWorkFolder('/'), /Refusing to work/);
  assert.throws(() => checkWorkFolder('/no/such/folder'), /Not a folder/);
  const d = tmp('proj-');
  assert.equal(checkWorkFolder(d), fs.realpathSync(d));
});

test('commands: tasks expand, built-ins stay local, unknown ones explain', async () => {
  assert.deepEqual(await expandInput('hello'), { kind: 'send', text: 'hello' });
  assert.equal((await expandInput('/mcp')).kind, 'builtin');
  const audit = await expandInput('/audit src', { project: 'northwind-site' });
  assert.equal(audit.kind, 'send');
  assert.equal(audit.task, 'audit');
  assert.match(audit.text, /src/);
  assert.match((await expandInput('/nope')).message, /Unknown command/);
  const blocked = await expandInput('/figma spec the hero', { waiting: { 'figma-designer': ['figma'] } });
  assert.equal(blocked.kind, 'error');
  assert.match(blocked.message, /\/figma needs figma, which is off/);
  assert.match(blocked.hint, /mcp\.json[\s\S]*npm run check -- --mcp/);
  const build = await expandInput('/build the hero from https://figma.com/design/x', { waiting: { 'figma-designer': ['figma'] } });
  assert.equal(build.kind, 'send', '/build still works when Figma is off');
});

// A stand-in engine: records what it was asked, answers with scripted events.
function fakeEngine() {
  const calls = { prepared: [], opened: [], sent: [] };
  const onDisk = new Set(); // conversations this stand-in "saved", as Claude Code would on disk
  const sessionExists = async (id) => onDisk.has(id);
  const prepare = async (o) => { calls.prepared.push(o); return { info: { provider: o.provider, modelLabel: o.model, lite: false } }; };
  const open = async ({ prepared, resume }, { onEvent, approve }) => {
    calls.opened.push({ provider: prepared.info.provider, resume });
    let closed = false;
    return {
      info: prepared.info, loaded: { waiting: {} }, get closed() { return closed; },
      async send(text) {
        calls.sent.push(text);
        onEvent({ type: 'delta', text: 'Hi', start: true });
        if (/^please approve/.test(text)) {
          const ok = await approve({ id: 'ap1', name: 'Bash', label: 'Bash', reason: 'run a command', summary: 'npm i' });
          onEvent({ type: 'approval', label: 'Bash', reason: 'run a command', summary: 'npm i', decision: ok ? 'allowed' : 'declined' });
        }
        onEvent({ type: 'tool', name: 'Read', label: 'Read', agent: null, summary: 'a.css' });
        onEvent({ type: 'text', text: 'Hi there', agent: null });
        onDisk.add(`s-${prepared.info.provider}`);
        onEvent({ type: 'result', ok: true, subtype: 'success', turns: 1, costUsd: 0.01, sessionId: `s-${prepared.info.provider}`, contextUsed: null, contextTokens: null });
        return {};
      },
      async interrupt() {}, async appStatus() { return {}; }, async close() { closed = true; },
    };
  };
  return { calls, prepare, open, sessionExists, onDisk };
}
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };

test('runtime: messages, approvals, busy guard and provider hand-over', async () => {
  const store = createThreadStore(tmp('threads-'));
  const events = [];
  const eng = fakeEngine();
  const rt = createRuntime({ store, broadcast: (e) => events.push(e), open: eng.open, prepare: eng.prepare, sessionExists: eng.sessionExists });
  const t = store.create({ cwd: tmp('p-'), provider: 'anthropic', model: 'opus' });

  await rt.send(t.id, 'Build the hero');
  assert.ok(await until(() => !rt.busy(t.id)));
  const kinds = store.get(t.id).items.map((i) => i.kind);
  assert.deepEqual(kinds, ['user', 'tool', 'assistant', 'result']);
  assert.equal(store.get(t.id).title, 'Build the hero');
  assert.equal(store.get(t.id).sessionId, 's-anthropic');
  assert.ok(events.some((e) => e.type === 'delta' && e.text === 'Hi'));

  // approval: the engine waits until the person answers
  await rt.send(t.id, 'please approve this');
  assert.ok(await until(() => rt.pendingApprovals(t.id).length === 1));
  await assert.rejects(rt.send(t.id, 'another'), /Still working/);
  const [pending] = rt.pendingApprovals(t.id);
  assert.equal(pending.approvalId, `${t.id}:ap1`);
  assert.equal(rt.answer(pending.approvalId, true), true);
  assert.ok(await until(() => !rt.busy(t.id)));
  assert.equal(store.get(t.id).items.find((i) => i.kind === 'approval').decision, 'allowed');
  assert.equal(rt.answer(pending.approvalId, true), false, 'an approval can only be answered once');

  // same provider, other model: resumes; other provider: fresh session with a summary
  store.update(t.id, { model: 'sonnet' });
  await rt.settingsChanged(t.id);
  await rt.send(t.id, 'next');
  assert.ok(await until(() => !rt.busy(t.id)));
  assert.equal(eng.calls.opened.at(-1).resume, 's-anthropic');
  store.update(t.id, { provider: 'ollama', model: 'qwen' });
  await rt.settingsChanged(t.id);
  await rt.send(t.id, 'continue locally');
  assert.ok(await until(() => !rt.busy(t.id)));
  assert.equal(eng.calls.opened.at(-1).resume, undefined);
  assert.match(eng.calls.sent.at(-1), /^Earlier in this chat, on another model:[\s\S]*Person: Build the hero[\s\S]*You: Hi there[\s\S]*continue locally$/);
  assert.ok(store.get(t.id).items.some((i) => i.kind === 'notice' && /continues from a summary/.test(i.text)));

  // built-ins and unknown tasks never reach the model
  const before = eng.calls.sent.length;
  await rt.send(t.id, '/tasks');
  await rt.send(t.id, '/nope');
  assert.equal(eng.calls.sent.length, before);
  assert.match(store.get(t.id).items.at(-1).text, /Unknown command/);
  assert.equal(rt.busy(t.id), false, 'built-ins and errors never leave the chat busy');

  // a double Enter: the second message is refused, only one run starts
  const opened = eng.calls.sent.length;
  const [first, second] = await Promise.allSettled([rt.send(t.id, 'one'), rt.send(t.id, 'two')]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.match(second.reason.message, /Still working/);
  assert.ok(await until(() => !rt.busy(t.id)));
  assert.equal(eng.calls.sent.length, opened + 1);
  await rt.shutdown();
});

test('thread items keep unique ids, even after old items are trimmed', () => {
  const store = createThreadStore(tmp('ids-'));
  const t = store.create({ cwd: '/x', provider: 'anthropic', model: 'opus' });
  for (let i = 0; i < 2005; i++) store.addItem(t.id, { kind: 'tool', label: String(i) });
  const ids = store.get(t.id).items.map((i) => i.id);
  assert.equal(ids.length, 2000);
  assert.equal(new Set(ids).size, ids.length);
  store.flushAll();
});

test('server: only this computer, only with the key, strict headers', async () => {
  const token = 'k'.repeat(43);
  const eng = fakeEngine();
  const app = createApp({ token, port: 0, threadsDir: tmp('srv-'), runtimeFactory: (o) => createRuntime({ ...o, open: eng.open, prepare: eng.prepare, sessionExists: eng.sessionExists }) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  // the app checks Host against the port it was created with; recreate with the real port
  await app.close();
  const app2 = createApp({ token, port, threadsDir: tmp('srv-'), runtimeFactory: (o) => createRuntime({ ...o, open: eng.open, prepare: eng.prepare, sessionExists: eng.sessionExists }) });
  await new Promise((r) => app2.server.listen(port, '127.0.0.1', r));
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const H = { 'x-dea-token': token, 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(url('/api/threads'))).status, 401);
    assert.equal((await fetch(url('/api/threads'), { headers: { 'x-dea-token': 'wrong' } })).status, 401);
    assert.equal((await fetch(url('/api/threads'), { headers: { ...H, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url('/api/threads'), { headers: { ...H, 'sec-fetch-site': 'cross-site' } })).status, 403);
    const page = await fetch(url('/'));
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await fetch(url('/../package.json'))).status, 404);
    assert.equal((await fetch(url('/app.js'))).headers.get('content-type'), 'text/javascript; charset=utf-8');

    // threads
    assert.equal((await fetch(url('/api/threads'), { method: 'POST', headers: H, body: JSON.stringify({ cwd: os.homedir() }) })).status, 400, 'the home folder is refused with a clear message');
    const proj = tmp('site-');
    const created = await (await fetch(url('/api/threads'), { method: 'POST', headers: H, body: JSON.stringify({ cwd: proj, provider: 'anthropic', model: 'opus' }) })).json();
    const id = created.thread.id;
    assert.match(id, /^t_[a-z0-9]{12}$/);
    assert.equal((await fetch(url(`/api/threads/${id}/messages`), { method: 'POST', headers: H, body: JSON.stringify({ text: 'hello' }) })).status, 202);
    assert.ok(await until(() => !app2.runtime.busy(id)));
    const patchFolder = await fetch(url(`/api/threads/${id}`), { method: 'PATCH', headers: H, body: JSON.stringify({ cwd: tmp('other-') }) });
    assert.equal(patchFolder.status, 409, 'the folder is fixed once the chat has started');
    const renamed = await (await fetch(url(`/api/threads/${id}`), { method: 'PATCH', headers: H, body: JSON.stringify({ title: '  Hero  ' }) })).json();
    assert.equal(renamed.thread.title, 'Hero');
    assert.equal((await fetch(url('/api/approvals/t_aaaaaaaaaaaa%3Aap9'), { method: 'POST', headers: H, body: '{"allow":true}' })).status, 404);
    assert.equal((await fetch(url('/api/approvals/..%2F..'), { method: 'POST', headers: H, body: '{}' })).status, 404);
    assert.equal((await fetch(url('/api/folders?path=/etc'), { headers: H })).status, 403);
    const missing = await fetch(url(`/api/folders?path=${encodeURIComponent(path.join(os.homedir(), 'no-such-folder-dea'))}`), { headers: H });
    assert.equal(missing.status, 404, 'a missing folder is a clear 404, not a server error');
    assert.match((await missing.json()).error, /There's no folder at/);
    assert.equal((await fetch(url(`/api/threads/${id}`), { method: 'DELETE', headers: H })).status, 200);
    assert.equal((await fetch(url(`/api/threads/${id}`), { headers: H })).status, 404);
  } finally {
    await app2.close();
  }
});
