import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_ROOT } from '../src/config.js';

// .vscode/settings.json hides the engine and makes it read-only in VS Code-based editors.
// These checks keep it in step with the code: a new engine folder must be covered,
// and nothing people edit to build agents may be hidden or locked.
// When the protection is switched off (no settings file, or no entry set to true), there is nothing to check.
const file = path.join(AGENT_ROOT, '.vscode', 'settings.json');
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')) : {}; // JSONC: whole-line comments only
const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
const on = (map) => Object.entries(map).filter(([, v]) => v === true).map(([k]) => k);
const hidden = (p) => on(settings['files.exclude'] ?? {}).some((pat) => p === pat || p.startsWith(`${pat}/`) || glob(pat).test(p));
const locked = (p) => on(settings['files.readonlyInclude'] ?? {}).some((pat) => glob(pat).test(p));
const off = !on(settings['files.exclude'] ?? {}).length && !on(settings['files.readonlyInclude'] ?? {}).length
  ? 'editor protection is switched off in .vscode/settings.json' : false;

test('every engine file under src/ is hidden and read-only, except the checking tools people add', { skip: off }, () => {
  for (const entry of fs.readdirSync(path.join(AGENT_ROOT, 'src'), { withFileTypes: true })) {
    if (entry.name === 'tools') continue;
    const p = `src/${entry.name}`;
    const sample = entry.isDirectory() ? `${p}/x.js` : p;
    assert.ok(hidden(p), `${p} should be hidden`);
    assert.ok(locked(sample), `${sample} should be read-only`);
  }
  for (const entry of fs.readdirSync(path.join(AGENT_ROOT, 'src', 'tools'))) {
    if (entry === 'defs') continue;
    assert.ok(hidden(`src/tools/${entry}`) && locked(`src/tools/${entry}`), `src/tools/${entry}`);
  }
  for (const p of ['ui/app.js', 'test/x.test.js', 'evals/dea-tool.mjs', 'logs/ui/.access-key', 'node_modules/a/index.js', 'package-lock.json']) {
    assert.ok(hidden(p) && locked(p), p);
  }
});

test('what people edit to build agents stays visible and editable', { skip: off }, () => {
  for (const p of ['agents/ui-engineer.md', 'tasks/build.md', 'standards/clean-code/SKILL.md', 'context/projects/a.md',
    'context/brands/northwind/brand.json', 'src/tools/defs/my_tool.js', 'mcp.json', 'providers.json', '.env', '.env.example',
    'docs/web-ui.md', 'README.md', '.vscode/settings.json']) {
    assert.ok(!hidden(p), `${p} should be visible`);
    assert.ok(!locked(p), `${p} should be editable`);
  }
});
