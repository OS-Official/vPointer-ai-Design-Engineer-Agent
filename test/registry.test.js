import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTools, validateToolDef, toolPolicy, createDesignServer } from '../src/tools/registry.js';


test('shipped tools load with unique names; only record_decision writes', async () => {
  const { tools, errors } = await loadTools();
  assert.deepEqual(errors, []);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  assert.deepEqual(tools.filter((t) => !t.readOnly).map((t) => t.name), ['record_decision']);
});

test('tool validation explains problems', () => {
  assert.match(validateToolDef({ name: 'Bad-Name', description: 'x', run: 1 }, 't.js').join('\n'), /lowercase_with_underscores[\s\S]*too short[\s\S]*run\(args, ctx\)/);
  assert.match(validateToolDef({ name: 'ok', description: 'long enough text', input: { a: 'nope' }, run() {} }, 't.js').join(), /zod fields/);
});

test('a new tool dropped into a folder is picked up; non-read-only tools ask', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dea-tools-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}'); // same as the real project
  // Imports resolve from the agent's own node_modules via absolute paths.
  const zod = path.resolve('node_modules/zod/index.js');
  fs.writeFileSync(path.join(dir, 'word_count.js'), `import { z } from '${zod.replace(/\\/g, '/')}';
export default { name: 'word_count', description: 'Count words in a text', input: { text: z.string() }, readOnly: true,
  async run({ text }) { return { words: text.trim().split(/\\s+/).length }; } };`);
  fs.writeFileSync(path.join(dir, 'post_social.js'), `export default { name: 'post_social', description: 'Publishes a post (writes)', input: {}, async run() { throw new Error('boom'); } };`);
  fs.writeFileSync(path.join(dir, '_template.js'), 'this is ignored');
  fs.writeFileSync(path.join(dir, 'broken.js'), 'export default {');
  const { tools, errors } = await loadTools(dir);
  assert.deepEqual(tools.map((t) => t.name), ['post_social', 'word_count']);
  assert.match(errors.join(), /broken\.js: failed to load/);
  assert.deepEqual(toolPolicy(tools), { mcp__design__post_social: { readOnly: false }, mcp__design__word_count: { readOnly: true } });
  assert.equal(await tools.find((t) => t.name === 'word_count').run({ text: 'one two three' }).then((r) => r.words), 3);
  assert.equal(createDesignServer(tools, { roots: [dir] }).type, 'sdk');
  fs.rmSync(dir, { recursive: true });
});
