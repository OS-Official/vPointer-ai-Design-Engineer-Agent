import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseNumCtx, sameModel, ollamaEnv, prepareOllama, LITE_CONTEXT_LIMIT } from '../src/providers.js';
import { settings, parseArgs } from '../src/config.js';
import { loadBrand, brandEssentials, mdSection } from '../src/brands/load.js';
import { buildSystemAppend } from '../src/prompts/system.js';
import { loadEverything } from '../src/bootstrap.js';

test('reads num_ctx and matches model names with or without :latest', () => {
  assert.equal(parseNumCtx('num_ctx                        32768\nstop "<|im_end|>"'), 32768);
  assert.equal(parseNumCtx('temperature 0.7'), null);
  assert.equal(sameModel('qwen3-coder-32k', 'qwen3-coder-32k:latest'), true);
  assert.equal(sameModel('qwen3-coder:30b', 'qwen3-coder-32k:latest'), false);
  assert.ok(32768 < LITE_CONTEXT_LIMIT);
});

test('provider selection: --local wins, env sets the default', () => {
  const saved = process.env.DEA_PROVIDER;
  delete process.env.DEA_PROVIDER;
  assert.equal(settings({}).provider, 'anthropic');
  assert.equal(settings({ local: true }).provider, 'ollama');
  process.env.DEA_PROVIDER = 'Ollama';
  assert.equal(settings({}).provider, 'ollama');
  if (saved === undefined) delete process.env.DEA_PROVIDER; else process.env.DEA_PROVIDER = saved;
  assert.equal(parseArgs(['--local', '--project', 'x']).local, true);
  assert.equal(settings({ local: true }).ollama.model, process.env.DEA_OLLAMA_MODEL || 'qwen3-coder-32k:latest');
});

test('the Ollama environment never carries Anthropic credentials', () => {
  const env = ollamaEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-secret', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret' },
    { url: 'http://localhost:11434', model: 'qwen3-coder-32k:latest' }, { maxOutputTokens: 4096 });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.ok(!JSON.stringify(env).includes('secret'));
  assert.equal(env.PATH, '/bin');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://localhost:11434');
  for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.equal(env[k], 'qwen3-coder-32k:latest', k);
  }
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '4096');
  assert.equal(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
});

function fakeOllama(handlers) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const h = handlers[`${req.method} ${req.url}`];
      if (!h) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(h));
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('prepareOllama: running, missing model, not running', async () => {
  const server = await fakeOllama({
    'GET /api/tags': { models: [{ name: 'qwen3-coder-32k:latest' }, { name: 'llama3:8b' }] },
    'GET /api/version': { version: '0.14.2' },
    'POST /api/show': { parameters: 'num_ctx 32768' },
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const o = await prepareOllama({ url, model: 'qwen3-coder-32k' });
    assert.deepEqual(o, { url, model: 'qwen3-coder-32k:latest', version: '0.14.2', contextTokens: 32768, contextKnown: true, remote: false });
    await assert.rejects(prepareOllama({ url, model: 'qwen3-coder:30b' }), /no model "qwen3-coder:30b"\. Installed: qwen3-coder-32k:latest, llama3:8b/);
  } finally { server.close(); }
  await assert.rejects(prepareOllama({ url: 'http://127.0.0.1:9', model: 'x' }), /isn't answering/);
});

test('lite prompt keeps every brand value but is far smaller', async () => {
  const brand = await loadBrand('northwind');
  const essentials = brandEssentials(brand);
  for (const c of brand.tokens.color.tokens) assert.ok(essentials.includes(`${c.name} ${c.value}`), c.name);
  assert.match(essentials, /One accent, one meaning/);
  assert.match(essentials, /weights: 400, 500, 700 only/);
  assert.equal(mdSection('## A\nx\n## B\ny', 'B'), '## B\ny');

  const r = await loadEverything();
  const full = await buildSystemAppend({ lead: r.lead, specialists: r.specialists, project: 'northwind-site', brand });
  const lite = await buildSystemAppend({ lead: r.lead, specialists: r.specialists, project: 'northwind-site', brand, lite: { contextTokens: 32768 } });
  assert.ok(lite.length < full.length, `lite ${lite.length} vs full ${full.length}`);
  assert.ok(full.includes('Accessible pairs') && !lite.includes('Accessible pairs'), 'lite keeps the essentials, not the whole brand README');
  assert.match(lite, /32,768-token context/);
  assert.match(lite, /Unknown specs stay/); // brief rules stay
  assert.match(lite, /Never deploy, push, publish, delete/); // non-negotiables stay
  assert.ok(!full.includes('32,768-token'));
});
