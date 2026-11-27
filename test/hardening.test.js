import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_ROOT } from '../src/config.js';
import { evaluateToolCall, agentCorePart, bashTouchesAgentCore, isSecretPath } from '../src/security/guard.js';
import { expandInput } from '../src/engine/commands.js';

const at = (...p) => path.join(AGENT_ROOT, ...p);

test('names that match an object built-in ("constructor", "toString") are never mistaken for a task or an app', async () => {
  const r = await expandInput('/constructor');
  assert.equal(r.kind, 'error');
  assert.match(r.message, /Unknown command \/constructor/);
  for (const server of ['constructor', 'toString', 'hasOwnProperty']) {
    const v = evaluateToolCall(`mcp__${server}__x`, {}, { roots: [os.tmpdir()], mcpPolicy: {} });
    assert.equal(v.decision, 'ask');
    assert.match(v.reason, /unconfigured app/);
  }
  assert.equal(evaluateToolCall('mcp__design__constructor', {}, { roots: [os.tmpdir()], toolPolicy: {} }).decision, 'ask');
});

test("the engine is recognised; what people edit to build agents is not", () => {
  assert.equal(agentCorePart(at('src', 'security', 'guard.js')), 'src/security/guard.js');
  for (const p of [['ui', 'app.js'], ['test', 'x.test.js'], ['mcp.json'], ['providers.json'], ['package.json'], ['logs', 'ui', 'threads', 'a.json'], ['.vscode', 'settings.json']]) {
    assert.ok(agentCorePart(at(...p)), p.join('/'));
  }
  for (const p of [['agents', 'ui-engineer.md'], ['tasks', 'build.md'], ['standards', 'clean-code', 'SKILL.md'], ['context', 'projects', 'a.md'], ['src', 'tools', 'defs', 'my_tool.js'], ['docs', 'web-ui.md'], ['README.md']]) {
    assert.equal(agentCorePart(at(...p)), null, p.join('/'));
  }
  assert.equal(agentCorePart(path.join(os.tmpdir(), 'site', 'src', 'index.js')), null);
  assert.equal(agentCorePart(at('src', 'tools', 'defs')), 'src/tools/defs'); // the folder itself stays put; its files are open
});

test('in its own folder, an agent asks before changing the engine or the permission files, and works freely on agents', () => {
  const roots = [AGENT_ROOT];
  for (const p of [['src', 'security', 'guard.js'], ['mcp.json'], ['providers.json'], ['ui', 'styles.css']]) {
    const v = evaluateToolCall('Edit', { file_path: at(...p) }, { roots });
    assert.equal(v.decision, 'ask', p.join('/'));
    assert.match(v.reason, /vPointer ai’s own engine/);
  }
  assert.equal(evaluateToolCall('Write', { file_path: at('agents', 'new-agent.md') }, { roots }).decision, 'allow');
  assert.equal(evaluateToolCall('Write', { file_path: at('src', 'tools', 'defs', 'my_tool.js') }, { roots }).decision, 'allow');
  // the same holds when the project folder is a parent that contains vPointer ai
  assert.equal(evaluateToolCall('Write', { file_path: at('src', 'index.js') }, { roots: [path.dirname(AGENT_ROOT)] }).decision, 'ask');
});

test('shell commands that touch the engine ask, only when the project holds vPointer ai itself', () => {
  const roots = [AGENT_ROOT];
  assert.equal(evaluateToolCall('Bash', { command: "sed -i 's/ask/allow/' src/security/guard.js" }, { roots }).decision, 'ask');
  assert.equal(evaluateToolCall('Bash', { command: `cp /tmp/x ${at('mcp.json')}` }, { roots }).decision, 'ask');
  assert.equal(evaluateToolCall('Bash', { command: 'cd src && echo hi > note.txt' }, { roots }).decision, 'ask');
  assert.equal(evaluateToolCall('Bash', { command: 'ls agents tasks' }, { roots }).decision, 'allow');
  assert.ok(bashTouchesAgentCore(`cat ${path.basename(AGENT_ROOT)}/src/index.js`, [path.dirname(AGENT_ROOT)]));
  // an ordinary project with its own src/ folder is unaffected
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.mkdirSync(path.join(site, 'src'));
  assert.equal(evaluateToolCall('Bash', { command: "sed -i 's/a/b/' src/index.js" }, { roots: [site] }).decision, 'allow');
  assert.equal(evaluateToolCall('Write', { file_path: path.join(site, 'src', 'index.js') }, { roots: [site] }).decision, 'allow');
});

test("the window's access key is a secrets file", () => {
  assert.ok(isSecretPath(at('logs', 'ui', '.access-key')));
  assert.equal(evaluateToolCall('Read', { file_path: at('logs', 'ui', '.access-key') }, { roots: [AGENT_ROOT] }).decision, 'deny');
  assert.equal(evaluateToolCall('Bash', { command: 'cat logs/ui/.access-key' }, { roots: [AGENT_ROOT] }).decision, 'deny');
});
