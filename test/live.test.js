import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appOf, decisionFor, actionLabel, actionDetail, parseToolResult, MAX_IMAGE_B64 } from '../src/engine/live.js';
import { createLiveStore } from '../src/server/live.js';
import { createThreadStore } from '../src/server/threads.js';
import { createRuntime } from '../src/server/runtime.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const img = (media_type, data = PNG, type = 'base64') => ({ type: 'image', source: { type, media_type, data } });

test('only connected apps count as app activity', () => {
  assert.deepEqual(appOf('mcp__figma__get_screenshot'), { app: 'figma', tool: 'get_screenshot' });
  assert.equal(appOf('mcp__design__layout_lint'), null);
  assert.equal(appOf('Read'), null);
  assert.equal(actionLabel('browser_take_screenshot'), 'Browser take screenshot');
  assert.equal(actionDetail({ fileKey: 'abc', nodeId: '1:2' }), 'node 1:2');
  assert.equal(actionDetail({ url: 'http://localhost:3000/' }), 'http://localhost:3000/');
  assert.equal(actionDetail({ fileKey: 'abc', code: 'tidy\n  the hero' }), 'tidy the hero');
  assert.equal(actionDetail({ fileKey: 'abc', width: 1440 }), 'width: 1440');
  assert.equal(actionDetail(null), '');
  const policy = { figma: { allow: ['get_*'], deny: ['delete_*'] } };
  assert.equal(decisionFor(policy, 'figma', 'get_screenshot'), 'free');
  assert.equal(decisionFor(policy, 'figma', 'use_figma'), 'asks');
  assert.equal(decisionFor(policy, 'figma', 'delete_node'), 'blocked');
  assert.equal(decisionFor(policy, 'constructor', 'x'), 'asks');
});

test('images reach the window only as a known raster type, real base64 and under the size cap', () => {
  const ok = parseToolResult({ content: [{ type: 'text', text: 'Frame  "Hero"\n 1440x720' }, img('image/png')] });
  assert.deepEqual(ok.image, { mediaType: 'image/png', data: PNG });
  assert.equal(ok.text, 'Frame "Hero" 1440x720');
  assert.equal(ok.ok, true);
  assert.equal(parseToolResult({ content: [img('image/svg+xml')] }).image, null, 'SVG can carry script');
  assert.equal(parseToolResult({ content: [img('image/svg+xml')] }).imageSkipped, 'type');
  assert.equal(parseToolResult({ content: [img('text/html')] }).image, null);
  assert.equal(parseToolResult({ content: [img('image/png', 'not base64 <script>')] }).imageSkipped, 'data');
  assert.equal(parseToolResult({ content: [img('image/png', 'A'.repeat(MAX_IMAGE_B64 + 4))] }).imageSkipped, 'size');
  assert.equal(parseToolResult({ content: [img('image/png', PNG, 'url')] }).image, null, 'no remote images');
  assert.equal(parseToolResult({ content: 'plain answer', is_error: true }).ok, false);
  assert.equal(parseToolResult({ content: [{ type: 'text', text: 'x'.repeat(1000) }] }).text.length, 240);
  assert.equal(parseToolResult(null).ok, true);
});

test('the live store stays small: 40 actions and 8 images per chat, 6 chats', () => {
  const s = createLiveStore();
  for (let i = 0; i < 50; i += 1) {
    s.call('t1', { id: `c${i}`, app: 'figma', tool: 'get_screenshot', label: 'Get screenshot', decision: 'free' });
    s.result('t1', { id: `c${i}`, ok: true, ms: 5, text: '', image: { mediaType: 'image/png', data: PNG } });
  }
  const snap = s.snapshot('t1');
  assert.equal(snap.calls.length, 40);
  assert.equal(snap.frames.length, 8);
  assert.equal(snap.calls.at(-1).state, 'done');
  assert.equal(s.result('t1', { id: 'unknown', ok: true }), null);
  for (let i = 2; i <= 7; i += 1) s.call(`t${i}`, { id: 'a', app: 'figma', tool: 'x' });
  assert.equal(s.snapshot('t1').calls.length, 0, 'the least recently used chat is dropped');
  s.forget('t7');
  assert.equal(s.snapshot('t7').calls.length, 0);
});

test('runtime streams app actions and images to the window and keeps them for a reload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const store = createThreadStore(dir);
  const events = [];
  const open = async ({ prepared }, { onEvent }) => ({
    info: prepared.info, loaded: { waiting: {} }, closed: false,
    async send() {
      onEvent({ type: 'app-call', id: 'tu1', name: 'mcp__figma__get_screenshot', app: 'figma', tool: 'get_screenshot', label: 'Get screenshot', detail: '{"nodeId":"1:2"}', agent: 'figma-designer', decision: 'free', at: Date.now() });
      onEvent({ type: 'app-result', id: 'tu1', ms: 12, ok: true, text: 'Hero', image: { mediaType: 'image/png', data: PNG } });
      onEvent({ type: 'result', ok: true, subtype: 'success', turns: 1, costUsd: 0, sessionId: 's', contextUsed: null, contextTokens: null });
      return {};
    },
    async interrupt() {}, async appStatus() { return {}; }, async close() {},
  });
  const prepare = async (o) => ({ info: { provider: o.provider, modelLabel: o.model, lite: false } });
  const rt = createRuntime({ store, broadcast: (e) => events.push(e), open, prepare });
  const t = store.create({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'p-')), provider: 'anthropic', model: 'opus' });
  await rt.send(t.id, 'Look at the hero');
  const end = Date.now() + 2000;
  while (rt.busy(t.id) && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  const call = events.find((e) => e.type === 'live-call');
  const res = events.find((e) => e.type === 'live-result');
  assert.equal(call.call.state, 'running');
  assert.equal(res.call.state, 'done');
  assert.equal(res.frame.mediaType, 'image/png');
  assert.equal(rt.liveView(t.id).frames.length, 1);
  assert.equal(store.get(t.id).items.some((i) => JSON.stringify(i).includes(PNG)), false, 'images are never saved in the chat file');
  rt.forgetLive(t.id);
  assert.equal(rt.liveView(t.id).calls.length, 0);
});
