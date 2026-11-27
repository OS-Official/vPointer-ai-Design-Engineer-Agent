#!/usr/bin/env node
/*
 * npm run check — validates everything you can edit, without calling the API.
 * Run it after changing anything in agents/, tasks/, src/tools/defs/ or context/projects/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_ROOT, settings } from './config.js';
import { loadEverything } from './bootstrap.js';
import { prepareOllama } from './providers.js';
import { probeServer } from './mcp/probe.js';
import { loadProviders, listModels } from './engine/models.js';

const envFile = path.join(AGENT_ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const cfg = settings({ local: process.argv.includes('--local') });
const r = await loadEverything({ local: cfg.provider === 'ollama' });

console.log('\nDesign Engineer Agent — configuration check\n');
console.log(`Lead agent     ${r.lead ? green('✔ agents/lead.md') : red('✘ missing')}`);
console.log(`Specialists    ${Object.keys(r.specialists).length} enabled${r.disabled.length ? dim(` · disabled: ${r.disabled.join(', ')}`) : ''}`);
for (const [n, needs] of Object.entries(r.waiting)) console.log(dim(`  • ${n.padEnd(20)} waiting for ${needs.join(', ')} (enable it in mcp.json)`));
for (const [name, def] of Object.entries(r.specialists)) {
  const tools = def.tools.map((t) => t.replace('mcp__design__', 'design:').replace('mcp__figma__', 'figma:'));
  console.log(dim(`  • ${name.padEnd(20)} ${def.model.padEnd(8)} ${tools.join(', ')}`));
}
console.log(`Custom tools   ${r.tools.length}`);
for (const t of r.tools) console.log(dim(`  • ${t.name.padEnd(24)} ${t.readOnly ? 'runs freely' : 'asks first'}`));
console.log(`Standards      ${Object.keys(r.standards).length}`);
for (const st of Object.values(r.standards)) {
  const users = Object.entries(r.specialists).filter(([, d]) => d.standards?.includes(st.name)).map(([n]) => n);
  console.log(dim(`  • ${st.name.padEnd(20)} ${st.brand ? `brand ${st.brand} · ` : ''}${st.references.length} reference file(s) · built into: ${users.join(', ') || 'none (the lead loads it with get_standard)'}`));
}
console.log(`Tasks          ${Object.keys(r.tasks).length}`);
for (const t of Object.values(r.tasks)) console.log(dim(`  • /${t.name.padEnd(14)} ${t.description}`));
console.log(`Projects       ${r.projects.length}  ${dim(r.projects.join(', '))}`);
console.log(`Brand packs    ${Object.keys(r.brands).length}`);
for (const [slug, b] of Object.entries(r.brands)) console.log(dim(`  • ${slug.padEnd(20)} ${b.name} tokens v${b.version} · used by ${b.projects.join(', ') || 'no project yet'}`));
// Model providers (providers.json): which are ready, and what Ollama has installed.
const prov = loadProviders();
console.log(`Models         default: ${prov.default.provider} / ${prov.default.model ?? 'none'} · budget $${cfg.maxBudgetUsd}/session on Claude`);
for (const p of Object.values(prov.providers)) {
  if (p.type === 'ollama') {
    try {
      const o = await prepareOllama({ url: p.url, model: p.defaultModel });
      const fits = o.contextTokens >= 100_000 ? 'full mode' : 'lite mode';
      console.log(`  ${green('✔')} ${p.id.padEnd(18)} ${o.model} on Ollama ${o.version} · context ${o.contextTokens.toLocaleString('en-US')} tokens → ${fits}${o.contextKnown ? '' : yellow(' (no num_ctx set: Ollama default)')}`);
      if (o.remote) console.log(yellow(`    ⚠ ${o.url} is not this computer: prompts and files would be sent there.`));
      const listed = await listModels(p);
      if (listed.models.length > 1) console.log(dim(`    also installed: ${listed.models.map((m) => m.id).filter((m) => m !== o.model).join(', ')}`));
    } catch (e) {
      console.log(`  ${dim('–')} ${p.id.padEnd(18)} ${e.message.split('\n')[0]}`);
    }
  } else {
    console.log(`  ${p.available ? green('✔') : yellow('–')} ${p.id.padEnd(18)} ${p.label}: ${p.models.map((m) => m.id).join(', ')}${p.available ? '' : yellow(` (${p.reason})`)}${p.type === 'anthropic-compatible' ? dim(` · sends data to ${p.host}`) : ''}`);
  }
}
for (const e of prov.errors) r.errors.push(e);
for (const w of prov.warnings) r.warnings.push(w);
console.log(`Window         npm run ui opens the same agents in your browser (http://127.0.0.1:${process.env.DEA_UI_PORT ?? 4317})`);

console.log(`Apps (MCP)     ${Object.keys(r.mcp.servers).length} on${Object.keys(r.mcp.skipped).length ? dim(` · ${Object.keys(r.mcp.skipped).length} off`) : ''}`);
for (const [n, s] of Object.entries(r.mcp.servers)) {
  console.log(dim(`  • ${n.padEnd(20)} ${s.config.type === 'stdio' ? s.config.command : s.config.url} · runs freely: ${s.dea.allow.join(', ') || 'nothing'}${s.dea.deny.length ? ` · blocked: ${s.dea.deny.join(', ')}` : ''}`));
}
for (const [n, why] of Object.entries(r.mcp.skipped)) console.log(dim(`  • ${n.padEnd(20)} off: ${why}`));

const notAnswering = [];
if (process.argv.includes('--mcp')) {
  console.log(`\nConnecting to each app (npm run check -- --mcp):`);
  for (const [n, s] of Object.entries(r.mcp.servers)) {
    const p = await probeServer(n, s);
    if (!p.ok) { notAnswering.push(n); console.log(red(`  ✘ ${n}: ${p.error}`)); continue; }
    const tokens = Math.round(p.tools.reduce((a, t) => a + t.chars, 0) / 4);
    console.log(green(`  ✔ ${n}`) + ` ${p.server ? `${p.server.name} ${p.server.version} · ` : ''}${p.tools.length} tools · ~${tokens.toLocaleString('en-US')} tokens of tool definitions${tokens > 3000 ? yellow(' (large for --local: consider dea.local: false)') : ''}`);
    for (const t of p.tools) {
      const flag = t.decision === 'runs freely' && !t.readOnlyHint && (t.destructiveHint || /delete|remove|destroy|drop/i.test(t.name)) ? yellow('  ⚠ looks like it changes things: check your allow list') : '';
      console.log(dim(`      ${t.name.padEnd(30)} ${t.decision}${t.readOnlyHint ? ' · read-only' : ''}`) + flag);
    }
  }
  if (!Object.keys(r.mcp.servers).length) console.log(dim('  No apps are on. Enable one in mcp.json, or run: npm run mcp:import'));
}

if (r.warnings.length) {
  console.log(yellow(`\n${r.warnings.length} warning(s):`));
  for (const w of r.warnings) console.log(yellow(`  ⚠ ${w}`));
}
if (r.errors.length) {
  console.log(red(`\n${r.errors.length} error(s) — dea will not start until these are fixed:`));
  for (const e of r.errors) console.log(red(`  ✘ ${e}`));
  process.exit(1);
}
if (notAnswering.length) {
  // The setup is valid; an app that isn't open isn't a setup error, and dea still starts without it.
  console.log(yellow(`\n✔ Setup is fine. Not answering right now: ${notAnswering.join(', ')} (dea works without it; open it and run this again).\n`));
} else {
  console.log(green('\n✔ All good.\n'));
}
