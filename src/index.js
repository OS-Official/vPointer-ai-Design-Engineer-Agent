#!/usr/bin/env node
/*
 * dea: the terminal front end. The agent itself lives in src/engine/ and is shared with the web UI
 * (npm run ui), so both follow exactly the same agents, standards, security rules and approvals.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { AGENT_ROOT, parseArgs } from './config.js';
import { prepareSession, openSession, toolLabel } from './engine/session.js';
import { expandInput, listTasks } from './engine/commands.js';
import { loadProviders } from './engine/models.js';

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m` };

const HELP = `
Design Engineer Agent

  dea [--cwd <project folder>] [--project <slug>] [--local] [--provider <id>] [--model <name>] [--careful] [--resume <session id>]

  --cwd       folder to work in (default: the current folder). The agent writes only inside it.
  --project   preload a brief from context/projects (e.g. northwind-site)
  --local     run on your local Ollama model (DEA_OLLAMA_MODEL); nothing leaves your computer
  --provider  a provider from providers.json (anthropic, ollama, or one you added)
  --model     a model of that provider (opus, sonnet, haiku, an Ollama model name…)
  --careful   ask before every file write too
  --resume    continue an earlier session (the id is printed after every answer)

Prefer a window? Run  npm run ui  for the same agents in your browser.

In the chat:
  /tasks            list your reusable tasks      /agents    list specialists
  /<task> <input>   run a task, e.g. /audit src   /tools     list custom tools
  /projects         list project briefs           /brands    list brand packs
  /mcp              connected apps and their permissions
  /help             this help
  /exit             quit
  Ctrl+C once stops the current task · Ctrl+C at the prompt (or twice) quits.
`;

// Load the agent's own .env from wherever the command is run (npm start, npm link → dea).
// loadEnvFile never overwrites variables already set in your shell.
const envFile = path.join(AGENT_ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const args = parseArgs();
if (args.help) { console.log(HELP); process.exit(0); }
function fail(msg) { console.error(c.red(msg)); process.exit(1); }

// --local means "the Ollama provider"; --provider picks any provider from providers.json.
const providersConfig = loadProviders();
let provider = args.provider ?? null;
if (args.local) provider = Object.values(providersConfig.providers).find((p) => p.type === 'ollama')?.id ?? 'ollama';
const DEA_PROVIDER = process.env.DEA_PROVIDER?.toLowerCase();
if (!provider && DEA_PROVIDER && !providersConfig.providers[DEA_PROVIDER]) fail(`DEA_PROVIDER must be one of ${Object.keys(providersConfig.providers).join(', ')} (got "${DEA_PROVIDER}").`);

let prep;
try {
  prep = await prepareSession({ cwd: args.cwd, project: args.project, provider, model: args.model, careful: args.careful });
} catch (e) {
  const msg = /ANTHROPIC_API_KEY is not set/.test(e.message) ? 'ANTHROPIC_API_KEY is not set. Add it to .env, or run on your local model with: dea --local' : e.message;
  fail(msg);
}
const { info, loaded } = prep;
const local = info.type !== 'anthropic';
for (const w of info.warnings) console.log(c.yellow(`⚠ ${w}`));

const rl = readline.createInterface({ input: stdin, output: stdout });
// readline rejects a pending question with AbortError on Ctrl+C; treat that as "no answer".
async function ask(promptText) {
  try { return await rl.question(promptText); } catch { return null; }
}

// Specialists can ask in parallel, but readline holds one question at a time: approvals wait in a queue.
let approvalQueue = Promise.resolve();
function approve({ label, reason, summary }) {
  const run = async () => {
    console.log(c.yellow(`\n  ⚠️  ${label} wants to: ${reason}`));
    console.log(c.yellow(`     ${summary}`));
    const answer = ((await ask(c.yellow('     Allow? [y/N] '))) ?? '').trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  };
  const result = approvalQueue.then(run, run);
  approvalQueue = result.catch(() => {});
  return result;
}

let appStatus = {};
let contextWarned = 0;
function onEvent(e) {
  if (e.type === 'apps') {
    appStatus = e.apps;
    const line = Object.entries(appStatus).map(([n, st]) => (st.status === 'connected' ? `${n} ✔` : `${n} ✘ ${st.status}`)).join(' · ');
    if (line) console.log(c.dim(`  apps: ${line}`) + (Object.values(appStatus).some((st) => st.status !== 'connected') ? c.yellow('  (/mcp for details)') : ''));
  } else if (e.type === 'text') {
    if (!e.agent) console.log('\n' + e.text);
  } else if (e.type === 'delegate') {
    console.log(c.cyan(`  → ${e.agent}: ${e.description}`));
  } else if (e.type === 'tool') {
    console.log(c.dim(`  ${e.agent ? `  ↳ [${e.agent}] ` : '· '}${e.label}`));
  } else if (e.type === 'blocked') {
    console.log(c.red(`  🛡️  blocked ${e.label}: ${e.reason}`));
  } else if (e.type === 'warning') {
    console.log(c.red(`  ${e.text}`));
  } else if (e.type === 'result') {
    if (!e.ok) console.log(c.red(`\n  stopped: ${e.subtype}${e.subtype === 'error_max_budget_usd' ? ` (budget $${e.budgetUsd} reached)` : ''}`));
    console.log(c.dim(e.contextTokens
      ? `\n  ${e.turns} turns · ${local ? 'local' : info.host} · context ${e.contextUsed.toLocaleString('en-US')}/${e.contextTokens.toLocaleString('en-US')} · session ${e.sessionId}`
      : `\n  ${e.turns} turns · ${e.costUsd === null ? info.host : `$${(e.costUsd ?? 0).toFixed(3)}`} · session ${e.sessionId}`));
    // Small context windows can't be auto-compacted: warn before the oldest part (with the brand rules) is dropped.
    if (e.contextTokens && e.contextUsed) {
      const share = e.contextUsed / e.contextTokens;
      const level = share >= 1 ? 2 : share >= 0.75 ? 1 : 0;
      if (level > contextWarned) {
        contextWarned = level;
        console.log(c.yellow(level === 2
          ? `  ⚠ Context full (${e.contextUsed.toLocaleString('en-US')} of ${e.contextTokens.toLocaleString('en-US')} tokens): the model is now dropping the oldest part of this conversation. Type /exit and start a fresh session.`
          : `  ⚠ Context ${Math.round(share * 100)}% full (${e.contextUsed.toLocaleString('en-US')} of ${e.contextTokens.toLocaleString('en-US')} tokens). Finish this task, then start a fresh session.`));
      }
    }
  }
}

console.log(c.bold('Design Engineer Agent') + c.dim(`  · working in ${info.cwd}${info.project ? ` · project: ${info.project}` : ''}${info.brand ? ` · brand: ${info.brand.name} v${info.brand.version}` : ''}${info.careful ? ' · careful mode' : ''}`));
console.log(c.dim(`  ${info.specialists.length} specialists · ${loaded.tools.length} tools · /tasks for shortcuts · /help · /exit`));
if (info.type === 'ollama') {
  console.log(c.cyan(`  model: ${info.model} on ${info.providerLabel} (${info.local ? 'local' : info.host}) · context ${info.contextTokens.toLocaleString('en-US')} tokens${info.lite ? ' · lite mode' : ''}`));
  for (const n of info.notes) console.log(c.yellow(`  ⚠ ${n}`));
  if (info.lite && info.apps.length) console.log(c.dim(`  Apps (${info.apps.join(', ')}) add their tool definitions to every request here; see their size with: npm run check -- --mcp`));
} else if (info.type === 'anthropic-compatible') {
  console.log(c.cyan(`  model: ${info.modelLabel} on ${info.providerLabel}`));
  for (const n of info.notes) console.log(c.yellow(`  ⚠ ${n}`));
} else {
  console.log(c.dim(`  model: ${info.model} (Anthropic API) · budget $${info.budgetUsd}`));
}

let session;
try {
  session = await openSession({ prepared: prep, resume: args.resume }, { onEvent, approve });
} catch (e) { fail(e.message); }
console.log(c.dim(`  log: ${session.info.log}`));

// ---------- Local chat commands (never sent to the model) ----------
async function builtin(name) {
  if (name === 'help') console.log(HELP);
  else if (name === 'agents') {
    for (const [n, d] of Object.entries(session.specialists)) console.log(`  ${c.cyan(n.padEnd(20))} ${c.dim(d.description)}`);
    if (loaded.disabled.length) console.log(c.dim(`  disabled: ${loaded.disabled.join(', ')}`));
    for (const [n, needs] of Object.entries(loaded.waiting)) console.log(c.dim(`  ${n}: waiting for ${needs.join(', ')} in mcp.json`));
  } else if (name === 'mcp') {
    const live = await session.appStatus();
    const names = Object.keys(loaded.mcp.servers);
    for (const n of names) {
      const st = live[n];
      const p = loaded.mcp.servers[n].dea;
      const state = !st ? c.dim('starting…') : st.status === 'connected' ? `✔ connected${st.tools ? ` · ${st.tools} tools` : ''}` : c.yellow(`${st.status}${st.error ? `: ${st.error}` : ''}`);
      console.log(`  ${c.cyan(n.padEnd(14))} ${state}`);
      console.log(c.dim(`  ${''.padEnd(14)} runs freely: ${p.allow.join(', ') || 'nothing'} · blocked: ${p.deny.join(', ') || 'nothing'} · everything else asks`));
    }
    for (const [n, why] of Object.entries(loaded.mcp.skipped)) console.log(c.dim(`  ${n.padEnd(14)} off: ${why}`));
    if (!names.length && !Object.keys(loaded.mcp.skipped).length) console.log(c.dim('  No apps yet. Add one to mcp.json, or run: npm run mcp:import'));
  } else if (name === 'tools') {
    for (const t of loaded.tools) console.log(`  ${c.cyan(t.name.padEnd(24))} ${c.dim(t.readOnly ? 'runs freely' : 'asks first')}`);
  } else if (name === 'projects') {
    console.log(`  ${loaded.projects.map((p) => c.cyan(p)).join('  ')}`);
  } else if (name === 'brands') {
    for (const [slug, b] of Object.entries(loaded.brands)) console.log(`  ${c.cyan(slug.padEnd(16))} ${b.name} tokens v${b.version} ${c.dim(`· ${b.projects.join(', ') || 'no project'}`)}`);
    if (!Object.keys(loaded.brands).length) console.log(c.dim('  No brand packs yet (context/brands/).'));
  } else if (name === 'tasks') {
    for (const t of await listTasks()) console.log(`  ${c.cyan(('/' + t.name).padEnd(14))} ${t.description}\n  ${' '.repeat(14)} ${c.dim(t.usage)}`);
  }
}

// Ctrl+C: readline captures it (the process-level SIGINT never fires while readline owns the terminal).
let lastCtrlC = 0;
rl.on('SIGINT', async () => {
  const now = Date.now();
  if (session.busy && now - lastCtrlC > 1500) {
    lastCtrlC = now;
    console.log(c.dim('\n  stopping the current task… (Ctrl+C again to quit)'));
    await session.interrupt();
    return;
  }
  console.log(c.dim('\n  bye'));
  rl.close();
  await session.close(); // stops the session and any app (MCP) processes it started
  process.exit(130);
});

async function main() {
  while (true) {
    const answer = await ask(c.bold('\nyou › '));
    if (answer === null) return; // Ctrl+C at the prompt
    const line = answer.trim();
    if (!line) continue;
    const action = await expandInput(line, { project: info.project, waiting: loaded.waiting });
    for (const w of action.warnings ?? []) console.log(c.yellow(`  ⚠ ${w}`));
    if (action.kind === 'builtin') {
      if (action.name === 'exit' || action.name === 'quit') return;
      await builtin(action.name);
      continue;
    }
    if (action.kind === 'error') {
      console.log(c.yellow(`  ${action.message}`));
      if (action.hint) console.log(c.dim(`  ${action.hint}`));
      continue;
    }
    if (action.task) console.log(c.dim(`  running task: ${action.task}`));
    if (session.closed) return;
    await session.send(action.text, { label: action.label }).catch((e) => console.log(c.red(`  ${e.message}`)));
  }
}

main()
  .catch((err) => {
    console.error(c.red(`\nError: ${err.message}`));
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await session?.close();
    console.log(c.dim(`\nSession log saved to ${session?.info.log}`));
    process.exit(process.exitCode ?? 0);
  });
