#!/usr/bin/env node
/*
 * npm run new -- agent <name>   → agents/<name>.md
 * npm run new -- task  <name>   → tasks/<name>.md
 * npm run new -- tool  <name>   → src/tools/defs/<name>.js
 * npm run new -- standard <name> → standards/<name>/SKILL.md (+ an empty references/ folder)
 * Copies the matching _template file and fills in the name. Never overwrites.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS_DIR, TASKS_DIR, STANDARDS_DIR } from './config.js';
import { DEFS_DIR } from './tools/registry.js';
import { RESERVED_COMMANDS } from './loaders/tasks.js';

const KINDS = {
  agent: { dir: AGENTS_DIR, ext: '.md', re: /^[a-z][a-z0-9-]*$/, rule: 'lowercase-with-hyphens, e.g. seo-specialist' },
  task: { dir: TASKS_DIR, ext: '.md', re: /^[a-z][a-z0-9-]*$/, rule: 'lowercase-with-hyphens, e.g. social-post' },
  tool: { dir: DEFS_DIR, ext: '.js', re: /^[a-z][a-z0-9_]*$/, rule: 'lowercase_with_underscores, e.g. word_count' },
  standard: { dir: STANDARDS_DIR, ext: '/SKILL.md', re: /^[a-z][a-z0-9-]*$/, rule: 'lowercase-with-hyphens, e.g. email-design' },
};

const [kind, name] = process.argv.slice(2);
const spec = KINDS[kind];
const stop = (msg) => { console.error(`\x1b[31m${msg}\x1b[0m`); process.exit(1); };

if (!spec || !name) stop('Usage: npm run new -- agent|task|tool|standard <name>');
if (!spec.re.test(name)) stop(`"${name}" is not a valid ${kind} name: use ${spec.rule}`);
if (kind === 'agent' && name === 'lead') stop('"lead" already exists: edit agents/lead.md instead.');
if (kind === 'task' && RESERVED_COMMANDS.includes(name)) stop(`"/${name}" is a built-in command; pick another name.`);

const target = path.join(spec.dir, name + spec.ext);
if (fs.existsSync(target)) stop(`${path.relative(process.cwd(), target)} already exists; edit it instead.`);
if (kind === 'standard') fs.mkdirSync(path.join(spec.dir, name, 'references'), { recursive: true });

const template = fs.readFileSync(path.join(spec.dir, '_template' + spec.ext), 'utf8');
let content = template.replaceAll('__NAME__', name);
// Drop the template's own instruction comments from the new file.
if (spec.ext.endsWith('.md')) content = content.replace(/^---\n(?:#.*\n)+/, '---\n');
fs.writeFileSync(target, content);

console.log(`\x1b[32m✔ Created ${path.relative(process.cwd(), target)}\x1b[0m`);
console.log(`Next: open it, fill in the description and instructions, then run  npm run check`);
if (kind === 'standard') console.log('Give it to a specialist with  standards: ' + name + '  in agents/<name>.md.');
console.log(kind === 'task' ? 'Tasks apply immediately in a running dea session.' : 'Restart dea to load it.');
