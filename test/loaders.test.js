import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter, toList } from '../src/loaders/frontmatter.js';
import { loadAgents, resolveTools } from '../src/loaders/agents.js';
import { loadTasks, renderTask, parseCommand } from '../src/loaders/tasks.js';
import { loadEverything } from '../src/bootstrap.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dea-'));
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const LEAD = '---\nname: lead\n---\nYou lead.';

test('frontmatter: values, comments, lists, errors', () => {
  const { data, body } = parseFrontmatter('---\n# comment\nname: x\ndescription: a, b: c\nenabled: false\nmaxTurns: 5\nquoted: "1, 2"\n---\nBody', 'f.md');
  assert.deepEqual(data, { name: 'x', description: 'a, b: c', enabled: false, maxTurns: 5, quoted: '1, 2' });
  assert.equal(body, 'Body');
  assert.deepEqual(toList(' Read , Write,, Glob '), ['Read', 'Write', 'Glob']);
  assert.throws(() => parseFrontmatter('no frontmatter', 'f.md'), /must start with/);
  assert.throws(() => parseFrontmatter('---\njust words\n---\n', 'f.md'), /not "key: value"/);
  assert.equal(parseFrontmatter('﻿---\r\nname: x\r\n---\r\nB', 'f.md').data.name, 'x'); // Windows line endings + BOM
});

test('the shipped agents, tasks and tools load with no errors', async () => {
  const r = await loadEverything();
  assert.deepEqual(r.errors, []);
  assert.ok(r.lead?.body.length > 50);
  assert.deepEqual(Object.keys(r.specialists).sort(), ['arabic-copywriter', 'brand-strategist', 'deploy-ops', 'design-critic', 'figma-designer', 'icon-designer', 'security-reviewer', 'ui-engineer']);
  assert.deepEqual(r.waiting, {}); // shipped mcp.json has Figma's desktop server on
  assert.ok(r.specialists['figma-designer'].tools.includes('mcp__figma__*'));
  assert.ok(r.specialists['ui-engineer'].tools.includes('mcp__figma__get_design_context')); // /build can read a Figma link
  assert.ok(!r.specialists['ui-engineer'].tools.some((t) => t.startsWith('mcp__playwright__'))); // apps that are off add nothing
  assert.equal(r.tools.length, 15);
  assert.deepEqual(Object.keys(r.standards).sort(), ['clean-code', 'northwind-brand', 'responsive-grid']);
  assert.deepEqual(r.specialists['ui-engineer'].standards, ['responsive-grid', 'clean-code', 'northwind-brand']);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.brands.northwind.projects, ['northwind-site']);
  assert.ok(r.tasks.audit && r.tasks.build && r.tasks.arabic);
  // reviewers stay read-only
  for (const name of ['design-critic', 'security-reviewer', 'brand-strategist']) {
    for (const t of ['Write', 'Edit', 'Bash']) assert.ok(!r.specialists[name].tools.includes(t), `${name} must not have ${t}`);
  }
});

test('tool names resolve, typos are explained', () => {
  const ctx = { designTools: ['contrast_check', 'type_scale'], apps: [], knownApps: ['figma'] };
  const ok = resolveTools(['Read', 'design:*', 'design:contrast_check'], ctx, 'a.md');
  assert.deepEqual(ok.tools, ['Read', 'mcp__design__contrast_check', 'mcp__design__type_scale']);
  assert.match(resolveTools(['read'], ctx, 'a.md').errors[0], /did you mean "Read"/);
  assert.match(resolveTools(['design:nope'], ctx, 'a.md').errors[0], /unknown custom tool/);
  assert.match(resolveTools(['Agent'], ctx, 'a.md').errors[0], /cannot call other specialists/);
  const figmaOff = resolveTools(['figma:get_screenshot'], ctx, 'a.md');
  assert.deepEqual(figmaOff, { tools: [], errors: [], warnings: [] }); // in mcp.json but off: skipped quietly
  assert.deepEqual(resolveTools(['figma:get_screenshot'], { ...ctx, apps: ['figma'] }, 'a.md').tools, ['mcp__figma__get_screenshot']);
});

test('agent validation catches common mistakes', async () => {
  const dir = tmp();
  write(dir, 'lead.md', LEAD);
  write(dir, 'good.md', '---\nname: good\ndescription: Handles the good kind of work for testing\ntools: Read, design:*\n---\nBe good.');
  write(dir, 'off.md', '---\nname: off\ndescription: Switched off specialist used for testing\ntools: Read\nenabled: false\n---\nOff.');
  write(dir, 'bad.md', '---\nname: Bad Name\ndescription: short\ntools: Raed\nmodel: gpt-4\n---\n');
  write(dir, '_template.md', 'ignored, not even valid');
  const r = await loadAgents({ dir, designTools: ['contrast_check'] });
  assert.deepEqual(Object.keys(r.specialists), ['good']);
  assert.deepEqual(r.specialists.good.tools, ['Read', 'mcp__design__contrast_check']);
  assert.deepEqual(r.disabled, ['off']);
  const all = r.errors.join('\n');
  for (const expected of [/name must be lowercase/, /description is missing or too short/, /unknown tool "Raed"/, /model "gpt-4"/, /no instructions/]) assert.match(all, expected);
  fs.rmSync(dir, { recursive: true });

  const empty = tmp();
  assert.match((await loadAgents({ dir: empty })).errors.join(), /lead\.md is missing/);
  fs.rmSync(empty, { recursive: true });
});

test('tasks: loading, reserved names, placeholders, commands', async () => {
  const dir = tmp();
  write(dir, 'ok.md', '---\nname: ok\ndescription: Test task\n---\nCheck {{input|everything}} for {{project}}.');
  write(dir, 'plain.md', '---\nname: plain\ndescription: No placeholder\n---\nDo the thing.');
  write(dir, 'help.md', '---\nname: help\ndescription: clashes\n---\nx');
  const { tasks, errors } = await loadTasks(dir);
  assert.deepEqual(Object.keys(tasks).sort(), ['ok', 'plain']);
  assert.match(errors[0], /built-in command/);
  assert.equal(renderTask(tasks.ok, { input: 'src', project: 'northwind-site' }), 'Check src for northwind-site.');
  assert.equal(renderTask(tasks.ok, {}), 'Check everything for none.');
  assert.equal(renderTask(tasks.plain, { input: 'index.html' }), 'Do the thing.\n\nInput: index.html');
  fs.rmSync(dir, { recursive: true });

  assert.deepEqual(parseCommand('/audit src/app'), { name: 'audit', input: 'src/app' });
  assert.deepEqual(parseCommand('/tasks'), { name: 'tasks', input: '' });
  assert.equal(parseCommand('/Users/me/site/index.html fix this'), null); // a path, not a command
  assert.equal(parseCommand('/tmp/file.css'), null);
  assert.equal(parseCommand('make it blue'), null);
});
