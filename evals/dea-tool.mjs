#!/usr/bin/env node
// Usage: node dea-tool.mjs <agent-repo> <tool_name> '<json args>'
// Runs one of the agent's design tools with the current folder as the project folder and the brand from DEA_BRAND (default: northwind).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, name, json = '{}'] = process.argv.slice(2);
const def = (await import(pathToFileURL(path.join(repo, 'src/tools/defs', `${name}.js`)).href)).default;
const out = await def.run(JSON.parse(json), { roots: [process.cwd()], brand: process.env.DEA_BRAND ?? 'northwind', project: null });
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
