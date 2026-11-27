import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMcp, substitute, matchesAny, splitToolName, mcpPolicy, sdkServers } from '../src/mcp/config.js';
import { importEntries, extractSecrets, upsertEnv, desktopConfigPath, READ_PATTERNS } from '../src/mcp/import.js';
import { evaluateToolCall } from '../src/security/guard.js';
import { loadAgents, resolveTools } from '../src/loaders/agents.js';

const tmpFile = (obj) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dea-mcp-')), 'mcp.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
};

test('patterns, names and ${VAR} substitution', () => {
  assert.equal(matchesAny('get_page', ['get_*']), true);
  assert.equal(matchesAny('forget_page', ['get_*']), false);
  assert.equal(matchesAny('anything', ['*']), true);
  assert.equal(matchesAny('a.b', ['a.b']), true);
  assert.equal(matchesAny('axb', ['a.b']), false); // dots are literal
  assert.deepEqual(splitToolName('mcp__sketchpad__get_page'), { server: 'sketchpad', tool: 'get_page' });
  assert.deepEqual(splitToolName('mcp__my-app__do__thing'), { server: 'my-app', tool: 'do__thing' });
  assert.equal(splitToolName('Read'), null);
  assert.deepEqual(substitute({ a: 'Bearer ${T}', b: ['${X}', 'y'] }, { T: 'tok', X: 'x' }), { value: { a: 'Bearer tok', b: ['x', 'y'] }, missing: [] });
  assert.deepEqual(substitute('${NOPE}', {}).missing, ['NOPE']);
});

test('mcp.json: valid apps load, problems are explained, nothing crashes', async () => {
  const file = tmpFile({ mcpServers: {
    sketchpad: { command: 'sketchpad-cli', args: ['mcp'], env: { TOKEN: '${FC}' }, dea: { allow: ['get_*'], deny: ['delete_*'] } },
    figma: { type: 'http', url: 'http://127.0.0.1:3845/mcp', dea: { enabled: false } },
    notion: { type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer ${NOTION_KEY}' } },
    design: { command: 'x' },
    'bad__name': { command: 'x' },
    nocmd: { args: [] },
    placeholder: { command: 'REPLACE me' },
    offline: { command: 'thing', dea: { local: false } },
  } });
  const r = await loadMcp({ file, env: { FC: 'secret' } });
  assert.deepEqual(Object.keys(r.servers).sort(), ['offline', 'sketchpad']);
  assert.deepEqual(r.servers.sketchpad.config, { command: 'sketchpad-cli', args: ['mcp'], env: { TOKEN: 'secret' }, type: 'stdio' });
  assert.ok(!('dea' in r.servers.sketchpad.config)); // our settings never reach the SDK
  assert.equal(r.skipped.figma, 'disabled in mcp.json');
  assert.match(r.skipped.notion, /NOTION_KEY/);
  const errors = r.errors.join('\n');
  for (const re of [/design: "design" is reserved/, /bad__name: names use/, /nocmd: needs a "command"/, /placeholder: still has a placeholder/]) assert.match(errors, re);

  const local = await loadMcp({ file, env: { FC: 'secret' }, local: true });
  assert.ok(!local.servers.offline && local.skipped.offline.includes('--local'));
  assert.deepEqual(sdkServers(r.servers).sketchpad.type, 'stdio');
  assert.deepEqual((await loadMcp({ file: tmpFile('{ not json' ) })).errors[0].slice(0, 26), 'mcp.json is not valid JSON');
  assert.deepEqual((await loadMcp({ file: path.join(os.tmpdir(), 'missing-dea-mcp.json') })).servers, {});
});

test('guard: per-app allow, deny, ask; unknown apps ask; built-ins unaffected', () => {
  const opts = { roots: ['/work/site'], mcpPolicy: mcpPolicy({ sketchpad: { dea: { allow: ['get_*', 'list_*'], deny: ['delete_*'] } } }) };
  const d = (t) => evaluateToolCall(t, {}, opts).decision;
  assert.equal(d('mcp__sketchpad__get_page'), 'allow');
  assert.equal(d('mcp__sketchpad__delete_node'), 'deny');
  assert.equal(d('mcp__sketchpad__create_frame'), 'ask');
  assert.equal(d('mcp__notion__search'), 'ask');
  assert.equal(d('mcp__design__unregistered'), 'ask'); // built-in tools keep their own policy
  assert.equal(evaluateToolCall('Read', { file_path: '/work/site/a.md' }, opts).decision, 'allow');
});

test('specialists: <app>:* maps to the app, requires: holds a specialist until the app is on', async () => {
  const ctx = { designTools: ['get_brand'], apps: ['sketchpad'], knownApps: ['sketchpad', 'figma'] };
  assert.deepEqual(resolveTools(['Read', 'sketchpad:*', 'sketchpad:get_page'], ctx, 'a.md').tools, ['Read', 'mcp__sketchpad__*', 'mcp__sketchpad__get_page']);
  assert.deepEqual(resolveTools(['figma:get_screenshot'], ctx, 'a.md'), { tools: [], errors: [], warnings: [] }); // configured but off: quiet
  assert.match(resolveTools(['sketchpda:*'], ctx, 'a.md').warnings[0], /no app "sketchpda" in mcp.json/); // typo: warned
  assert.match(resolveTools(['sketchpad:'], ctx, 'a.md').errors[0], /needs a tool name/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dea-agents-'));
  fs.writeFileSync(path.join(dir, 'lead.md'), '---\nname: lead\n---\nLead.');
  fs.writeFileSync(path.join(dir, 'fc.md'), '---\nname: fc\ndescription: Works inside the Sketchpad app for tests\ntools: Read, sketchpad:*\nrequires: sketchpad\n---\nDo it.');
  const off = await loadAgents({ dir, apps: [] });
  assert.deepEqual(off.waiting, { fc: ['sketchpad'] });
  assert.ok(!off.warnings.some((w) => w.includes('sketchpad'))); // waiting is not a warning
  const on = await loadAgents({ dir, apps: ['sketchpad'] });
  assert.deepEqual(on.specialists.fc.tools, ['Read', 'mcp__sketchpad__*']);
  fs.rmSync(dir, { recursive: true });
});

test('import from Claude Desktop: secrets move to .env, settings are kept', () => {
  const desktop = {
    sketchpad: { command: 'sketchpad-cli', args: ['mcp', '--api-key', 'abc123', '--token=xyz'], env: { SKETCHPAD_TOKEN: 'tok', LOG_LEVEL: 'info' } },
    notion: { type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer n1' } },
  };
  const current = { sketchpad: { command: 'REPLACE me', dea: { enabled: false, description: 'mine', allow: ['get_*'], deny: ['delete_*'] } }, keep: { command: 'x' } };
  const r = importEntries(desktop, current, { names: ['sketchpad', 'notion', 'missing'] });
  assert.deepEqual(r.added, ['sketchpad', 'notion']);
  assert.match(r.skipped[0], /missing: not in the Claude Desktop config/);
  const fc = r.servers.sketchpad;
  assert.deepEqual(fc.args, ['mcp', '--api-key', '${DEA_MCP_SKETCHPAD_API_KEY}', '--token=${DEA_MCP_SKETCHPAD_TOKEN}']);
  assert.deepEqual(fc.env, { SKETCHPAD_TOKEN: '${DEA_MCP_SKETCHPAD_SKETCHPAD_TOKEN}', LOG_LEVEL: 'info' });
  assert.deepEqual(fc.dea, { enabled: true, description: 'mine', allow: ['get_*'], deny: ['delete_*'] }); // placeholder's settings kept
  assert.deepEqual(r.servers.notion.dea.allow, READ_PATTERNS);
  assert.equal(r.servers.notion.headers.Authorization, '${DEA_MCP_NOTION_AUTHORIZATION}');
  assert.ok(r.servers.keep);
  assert.deepEqual(r.secrets, { DEA_MCP_SKETCHPAD_API_KEY: 'abc123', DEA_MCP_SKETCHPAD_TOKEN: 'xyz', DEA_MCP_SKETCHPAD_SKETCHPAD_TOKEN: 'tok', DEA_MCP_NOTION_AUTHORIZATION: 'Bearer n1' });
  assert.ok(!JSON.stringify(r.servers).includes('abc123'));
  assert.match(importEntries(desktop, r.servers, { names: ['sketchpad'] }).skipped[0], /already in mcp.json/);
  assert.deepEqual(importEntries(desktop, { design: {} }, { names: ['design'] }).added, []);
  assert.deepEqual(extractSecrets('x', { args: ['--port', '7979'] }).secrets, {}); // ordinary args untouched
});

test('.env upsert and Claude Desktop config locations', () => {
  assert.equal(upsertEnv('A=1\nB=2', { B: '3', C: 'has space' }), 'A=1\nB=3\nC="has space"\n');
  assert.equal(upsertEnv('', { T: 'x' }), 'T=x\n'); // new .env: no blank first line
  assert.match(desktopConfigPath('darwin', {}, '/Users/me'), /Library\/Application Support\/Claude\/claude_desktop_config\.json$/);
  assert.match(desktopConfigPath('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me'), /Claude.claude_desktop_config\.json$/);
});

test('shipped mcp.json: Figma desktop on, other apps off, rules match the real tool names', async () => {
  const shipped = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'mcp.json');
  const r = await loadMcp({ file: shipped, env: {} });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(Object.keys(r.servers), ['figma']);
  assert.deepEqual(r.servers.figma.config, { type: 'http', url: 'http://127.0.0.1:3845/mcp' });
  for (const n of ['playwright', 'github', 'supabase']) assert.equal(r.skipped[n], 'disabled in mcp.json');

  // turn everything on, as a person would, to check the rules and the secrets handling
  const raw = JSON.parse(fs.readFileSync(shipped, 'utf8'));
  for (const e of Object.values(raw.mcpServers)) e.dea.enabled = true;
  const all = await loadMcp({ file: tmpFile(raw), env: { DEA_MCP_GITHUB_TOKEN: 'ghp_x', DEA_MCP_SUPABASE_TOKEN: 'sbp_x', DEA_MCP_SUPABASE_PROJECT_REF: 'abcd' } });
  assert.deepEqual(all.errors, []);
  assert.equal(all.servers.github.config.headers.Authorization, 'Bearer ghp_x');
  assert.deepEqual(all.servers.supabase.config.args.slice(-2), ['--read-only', '--project-ref=abcd']);
  assert.equal(all.servers.supabase.config.env.SUPABASE_ACCESS_TOKEN, 'sbp_x');
  const noKeys = await loadMcp({ file: tmpFile(raw), env: {} });
  assert.match(noKeys.skipped.github, /DEA_MCP_GITHUB_TOKEN/); // never sent without its token
  assert.match(noKeys.skipped.supabase, /DEA_MCP_SUPABASE/);

  const opts = { roots: ['/work/site'], mcpPolicy: mcpPolicy(all.servers) };
  const d = (t) => evaluateToolCall(t, {}, opts).decision;
  const expect = {
    allow: ['mcp__figma__get_design_context', 'mcp__figma__get_metadata', 'mcp__figma__get_screenshot', 'mcp__figma__get_variable_defs', 'mcp__figma__whoami', 'mcp__figma__create_session',
      'mcp__playwright__browser_snapshot', 'mcp__playwright__browser_take_screenshot', 'mcp__playwright__browser_resize', 'mcp__playwright__browser_console_messages',
      'mcp__github__get_file_contents', 'mcp__github__list_pull_requests', 'mcp__github__search_code',
      'mcp__supabase__list_tables', 'mcp__supabase__get_advisors', 'mcp__supabase__search_docs'],
    ask: ['mcp__figma__use_figma', 'mcp__figma__add_code_connect_map', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_click', 'mcp__playwright__browser_type', 'mcp__playwright__browser_evaluate',
      'mcp__github__create_pull_request', 'mcp__github__merge_pull_request', 'mcp__github__push_files', 'mcp__supabase__execute_sql', 'mcp__supabase__apply_migration', 'mcp__supabase__deploy_edge_function'],
    deny: ['mcp__playwright__browser_run_code_unsafe', 'mcp__playwright__browser_file_upload', 'mcp__github__delete_file', 'mcp__supabase__delete_branch', 'mcp__supabase__pause_project', 'mcp__supabase__reset_branch'],
  };
  for (const [want, tools] of Object.entries(expect)) for (const t of tools) assert.equal(d(t), want, t);
});
