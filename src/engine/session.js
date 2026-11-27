import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSessionInfo, query } from '@anthropic-ai/claude-agent-sdk';

import { loadEverything } from '../bootstrap.js';
import { buildSystemAppend } from '../prompts/system.js';
import { createDesignServer, toolPolicy as buildToolPolicy } from '../tools/registry.js';
import { BUILTIN_TOOLS } from '../loaders/agents.js';
import { evaluateToolCall } from '../security/guard.js';
import { brandOfProject, loadBrand } from '../brands/load.js';
import { createSessionLog } from '../logging/session-log.js';
import { mcpPolicy, sdkServers } from '../mcp/config.js';
import { activeStandards, applyStandards } from '../loaders/standards.js';
import { actionDetail, actionLabel, appOf, decisionFor, parseToolResult } from './live.js';
import { loadProviders, prepareModel } from './models.js';

/*
 * The agent engine: one conversation with the lead agent and its specialists.
 * The terminal (src/index.js) and the web UI (src/server) both drive it, so they
 * share every rule: the same agents, standards, apps, security guard and approvals.
 *
 *   const s = await openSession({ cwd, project, provider, model, careful, resume, memory }, { onEvent, approve });
 *   await s.send('build the hero');   // resolves when the turn is finished
 *   await s.interrupt();  await s.close();
 *
 * Events passed to onEvent (plain objects, safe to send to a browser):
 *   ready     { info }                         session prepared (model, project, brand, specialists…)
 *   session-id { sessionId }                   the conversation's id, as soon as it starts (save it to resume later)
 *   apps      { apps: { name: { status, error, tools } } }
 *   delta     { text }                         streamed text from the lead (Claude only; optional to show)
 *   text      { text, agent|null }             a finished text block (agent = specialist name, or null for the lead)
 *   delegate  { id, agent, description }       the lead handed work to a specialist
 *   tool      { id, name, label, agent|null, summary }
 *   blocked   { name, label, reason }          the guard refused a tool call
 *   approval  { name, label, reason, summary, decision }   after the user answered
 *   result    { ok, subtype, turns, costUsd|null, sessionId, contextUsed|null, contextTokens|null, durationMs }
 *   warning   { text }
 * approve({ id, name, label, reason, summary }) → Promise<boolean> asks the person.
 *
 * Resuming: if the conversation to resume is no longer on this computer (Claude Code clears old ones, after 30 days
 * by default), send() rejects with an Error whose code is 'RESUME_FAILED', and nothing else is reported for it.
 */

/**
 * Is this conversation's history still on this computer? true / false, or null when it can't be told
 * (then try to resume, and rely on RESUME_FAILED).
 */
export async function sessionOnDisk(sessionId) {
  if (!sessionId) return false;
  try { return Boolean(await getSessionInfo(sessionId)); } catch { return null; }
}

export const toolLabel = (name) => name.replace(/^mcp__design__/, '').replace(/^mcp__(.+?)__(.+)$/, '$1 → $2');

export function summariseInput(name, input = {}) {
  if (name === 'Bash') return String(input.command ?? '').slice(0, 300);
  if (name === 'Agent') return String(input.description ?? '');
  return String(input.file_path || input.path || input.url || input.pattern || input.query || JSON.stringify(input)).slice(0, 200);
}

/** The folder a session may work in: must exist, and not be the home folder or a drive root. */
export function checkWorkFolder(dir) {
  if (!dir) throw new Error('Choose a project folder to work in.');
  const abs = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  const real = fs.realpathSync(abs);
  if (real === fs.realpathSync(os.homedir()) || real === path.parse(real).root) {
    throw new Error(`Refusing to work in ${real}: that would let the agent write anywhere in it. Choose a project folder.`);
  }
  return real;
}

/** Everything that can be prepared before a conversation starts; throws readable Errors. */
export async function prepareSession({ cwd, project = null, provider, model, careful = false, onlyApps = null, env = process.env } = {}) {
  const cwdReal = checkWorkFolder(cwd);
  const providersConfig = loadProviders({ env });
  if (providersConfig.errors.length) throw new Error(`providers.json has errors:\n${providersConfig.errors.map((e) => `  ✘ ${e}`).join('\n')}`);
  const maxBudgetUsd = Number(env.DEA_MAX_BUDGET_USD ?? 5) > 0 ? Number(env.DEA_MAX_BUDGET_USD ?? 5) : 5;
  const run = await prepareModel({ provider, model }, { providers: providersConfig.providers, defaults: providersConfig.default, env, maxBudgetUsd });
  const small = run.type === 'ollama'; // small local models: fewer apps (mcp.json dea.local), tools sent inline

  const loaded = await loadEverything({ local: small, env, onlyApps });
  if (loaded.errors.length) throw new Error(`Your configuration has ${loaded.errors.length} error(s):\n${loaded.errors.map((e) => `  ✘ ${e}`).join('\n')}\n\nFix them, then run: npm run check`);
  if (project && !loaded.projects.includes(project)) throw new Error(`No project brief "${project}". Available: ${loaded.projects.join(', ') || 'none'} (context/projects/)`);

  const brandSlug = await brandOfProject(project);
  const brand = brandSlug ? await loadBrand(brandSlug) : null;
  const standards = activeStandards(loaded.standards, brandSlug);
  const withStandards = applyStandards(loaded.specialists, loaded.standards, { brand: brandSlug });
  // Compact specialist descriptions on a small context (they're repeated inside the Agent tool's definition).
  const specialists = Object.fromEntries(Object.entries(withStandards).map(([n, { standards: _s, ...d }]) => [n, run.lite
    ? { ...d, description: (d.description.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? d.description).slice(0, 160) }
    : d]));
  const apps = Object.fromEntries(Object.entries(loaded.mcp.servers).map(([n, s]) => [n, s.dea.description]));

  return {
    cwd: cwdReal, project, careful, run, loaded, brandSlug, brand, standards, specialists, apps,
    info: {
      cwd: cwdReal, project, careful,
      brand: brand ? { slug: brandSlug, name: brand.meta.name, version: brand.tokens.version } : null,
      provider: run.providerId, providerLabel: run.label, type: run.type, model: run.model, modelLabel: run.modelLabel,
      local: run.local, host: run.host, lite: Boolean(run.lite), contextTokens: run.contextTokens, budgetUsd: run.budgetUsd,
      notes: run.notes, warnings: loaded.warnings,
      specialists: Object.keys(specialists), waiting: loaded.waiting, apps: Object.keys(apps), skippedApps: loaded.mcp.skipped,
      standards: Object.keys(standards),
    },
  };
}

export async function openSession(opts, { onEvent = () => {}, approve = async () => false } = {}) {
  const prep = opts.prepared ?? (await prepareSession(opts));
  const { cwd, run, loaded, specialists, apps, brand, standards, project } = prep;
  const emit = (type, data = {}) => { try { onEvent({ type, ...data }); } catch { /* a broken listener must not stop the agent */ } };

  const roots = [cwd];
  const guardOptions = { roots, careful: prep.careful, toolPolicy: buildToolPolicy(loaded.tools), mcpPolicy: mcpPolicy(loaded.mcp.servers) };
  const log = createSessionLog();
  let approvalSeq = 0;

  // Security layer 1: hook (runs for EVERY tool call, incl. specialists and read-only tools).
  const securityHook = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const { decision, reason, updatedInput } = evaluateToolCall(input.tool_name, input.tool_input ?? {}, guardOptions);
    if (decision === 'deny') {
      log.security(input.tool_name, 'deny', reason);
      emit('blocked', { name: input.tool_name, label: toolLabel(input.tool_name), reason });
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
    }
    if (decision === 'ask') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } };
    // Read-only tools (e.g. Grep) can skip canUseTool, so input rewrites ("skip secret files") happen here.
    if (updatedInput) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason, updatedInput } };
    return {};
  };

  // Security layer 2: the person decides.
  const canUseTool = async (toolName, input) => {
    const { decision, reason, updatedInput } = evaluateToolCall(toolName, input, guardOptions);
    if (decision === 'deny') return { behavior: 'deny', message: reason };
    if (decision === 'allow') return { behavior: 'allow', updatedInput: updatedInput ?? input };
    const request = { id: `ap${++approvalSeq}`, name: toolName, label: toolLabel(toolName), reason, summary: summariseInput(toolName, input) };
    let allowed = false;
    try { allowed = (await approve(request)) === true; } catch { allowed = false; }
    log.security(toolName, allowed ? 'approved' : 'refused', `${reason} — ${request.summary}`);
    emit('approval', { ...request, decision: allowed ? 'allowed' : 'declined' });
    return allowed
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user declined this action. Do not retry it; explain the manual step instead.' };
  };

  const mcpServers = { design: createDesignServer(loaded.tools, { roots, project, brand: prep.brandSlug }), ...sdkServers(loaded.mcp.servers) };

  // ---------- Streaming input: messages wait in a queue; each send() resolves at its result ----------
  const queue = [];
  let wake = null;
  let closed = false;
  let current = null; // { resolve, reject }
  let sessionId = opts.resume ?? '';
  async function* input() {
    while (!closed) {
      if (!queue.length) { await new Promise((r) => { wake = r; }); continue; }
      const { text } = queue.shift();
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: sessionId };
    }
  }

  const fullTools = run.fullTools;
  const q = query({
    prompt: input(),
    options: {
      cwd,
      model: run.model,
      resume: opts.resume || undefined,
      includePartialMessages: true,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: await buildSystemAppend({ lead: loaded.lead, specialists, project, cwd, brand, lite: run.lite, apps, toolSearch: fullTools, standards, notes: opts.memory ?? '' }),
      },
      // Specialists run in the foreground: the lead waits for each report, so a turn is finished
      // (and every approval answered) before it ends.
      env: { ...run.env(process.env), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
      ...(run.thinkingOff ? { thinking: { type: 'disabled' } } : {}),
      // Load NO settings files: a project's .claude/settings.json could define hooks that run shell
      // commands, or rules that skip approval. The project's CLAUDE.md is read as plain text instead.
      settingSources: [],
      agents: specialists,
      mcpServers,
      // Claude: app tools load on demand through ToolSearch; web search runs on Anthropic's servers.
      // Other models: no ToolSearch, app tools sent directly, no web tools.
      tools: fullTools ? [...BUILTIN_TOOLS, 'Agent', 'ToolSearch'] : [...BUILTIN_TOOLS.filter((t) => !['WebSearch', 'WebFetch'].includes(t)), 'Agent'],
      permissionMode: 'default',
      canUseTool,
      hooks: { PreToolUse: [{ hooks: [securityHook], onFailure: 'block' }] },
      ...(run.budgetUsd ? { maxBudgetUsd: run.budgetUsd } : {}),
    },
  });

  const appStatus = {};
  const subagentByToolId = new Map();
  const appCalls = new Map(); // tool_use id → { at } for app calls still waiting for their answer (Live view)
  let contextUsed = 0;
  let started = false;      // the conversation began (its "init" arrived): a resume worked
  let resumeFailed = false;
  let ready;
  const readyPromise = new Promise((r) => { ready = r; });

  const pump = (async () => {
    try {
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          started = true;
          if (msg.session_id && msg.session_id !== sessionId) emit('session-id', { sessionId: msg.session_id });
          sessionId = msg.session_id;
          for (const s of msg.mcp_servers ?? []) {
            if (s.name === 'design') continue;
            appStatus[s.name] = { status: s.status, error: s.error, tools: (msg.tools ?? []).filter((t) => t.startsWith(`mcp__${s.name}__`)).length };
          }
          emit('apps', { apps: { ...appStatus } });
          ready();
          continue;
        }
        if (msg.type === 'stream_event') {
          if (msg.parent_tool_use_id) continue;
          const ev = msg.event;
          if (ev?.type === 'content_block_start' && ev.content_block?.type === 'text') emit('delta', { text: '', start: true });
          else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') emit('delta', { text: ev.delta.text });
          continue;
        }
        if (msg.type === 'assistant') {
          const agent = msg.parent_tool_use_id ? subagentByToolId.get(msg.parent_tool_use_id) ?? 'specialist' : null;
          if (!agent && run.contextTokens) {
            const u = msg.message?.usage;
            if (u) contextUsed = Math.max(contextUsed, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0));
          }
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text.trim()) {
              log.text(block.text, agent);
              emit('text', { text: block.text, agent });
            } else if (block.type === 'tool_use') {
              log.toolCall(block.name, block.input, agent);
              if (block.name === 'Agent') {
                const who = block.input?.subagent_type ?? 'specialist';
                subagentByToolId.set(block.id, who);
                emit('delegate', { id: block.id, agent: who, description: block.input?.description ?? '' });
              } else {
                emit('tool', { id: block.id, name: block.name, label: toolLabel(block.name), agent, summary: summariseInput(block.name, block.input) });
                const app = appOf(block.name);
                if (app) {
                  appCalls.set(block.id, { at: Date.now() });
                  emit('app-call', { id: block.id, name: block.name, app: app.app, tool: app.tool, label: actionLabel(app.tool), detail: actionDetail(block.input), agent, decision: decisionFor(guardOptions.mcpPolicy, app.app, app.tool), at: Date.now() });
                }
              }
            }
          }
          continue;
        }
        // Answers to tool calls: report those from apps to the Live view (what the agent got back).
        if (msg.type === 'user') {
          const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
          for (const block of content) {
            if (block?.type !== 'tool_result' || !appCalls.has(block.tool_use_id)) continue;
            const { at } = appCalls.get(block.tool_use_id);
            appCalls.delete(block.tool_use_id);
            emit('app-result', { id: block.tool_use_id, ms: Date.now() - at, ...parseToolResult(block) });
          }
          continue;
        }
        if (msg.type === 'result') {
          log.result(msg);
          // The conversation to resume isn't on this computer: Claude Code says so ("No conversation found"); an
          // older one that gives no reason shows it by failing at once, before the conversation ever started.
          const errors = Array.isArray(msg.errors) ? msg.errors.join(' ') : '';
          const gone = errors ? /no conversation found/i.test(errors) : !started && msg.is_error && (msg.num_turns ?? 0) === 0;
          if (opts.resume && !started && gone) {
            resumeFailed = true;
            const c = current; current = null;
            c?.reject(Object.assign(new Error(`The earlier conversation ${opts.resume} is no longer on this computer (Claude Code keeps conversations for 30 days by default).`), { code: 'RESUME_FAILED' }));
            continue;
          }
          for (const id of appCalls.keys()) emit('app-result', { id, ok: false, cancelled: true, text: '', image: null });
          appCalls.clear();
          sessionId = msg.session_id;
          subagentByToolId.clear();
          const result = {
            ok: msg.subtype === 'success' && !msg.is_error, subtype: msg.subtype, turns: msg.num_turns, sessionId: msg.session_id,
            costUsd: run.costKnown ? msg.total_cost_usd ?? 0 : null, durationMs: msg.duration_ms ?? null,
            contextUsed: run.contextTokens ? contextUsed : null, contextTokens: run.contextTokens ?? null,
            budgetUsd: run.budgetUsd,
          };
          emit('result', result);
          const c = current; current = null;
          c?.resolve(result);
        }
      }
    } catch (err) {
      if (!resumeFailed) emit('warning', { text: `The session stopped: ${err.message}` });
      current?.reject(err); current = null;
    } finally {
      closed = true;
      ready();
      current?.reject(new Error('The session closed.')); current = null;
    }
  })();

  emit('ready', { info: { ...prep.info, log: log.file } });

  return {
    info: { ...prep.info, log: log.file },
    get sessionId() { return sessionId; },
    get busy() { return Boolean(current); },
    get closed() { return closed; },
    loaded,
    specialists,
    ready: readyPromise,
    /** Send one message; resolves with the result event when the whole turn is done. */
    send(text, { label } = {}) {
      if (closed) return Promise.reject(new Error('This session is closed.'));
      if (current) return Promise.reject(new Error('Still working on the previous message. Stop it first, or wait.'));
      log.prompt(label ? `${label}\n\n${text}` : text);
      const p = new Promise((resolve, reject) => { current = { resolve, reject }; });
      queue.push({ text });
      wake?.(); wake = null;
      return p;
    },
    async interrupt() { if (current) await q.interrupt().catch(() => {}); },
    /** Live app status (apps connect in the background after start-up). */
    async appStatus() {
      const live = await q.mcpServerStatus().catch(() => []);
      for (const s of live) if (s.name !== 'design') appStatus[s.name] = { status: s.status, error: s.error, tools: s.tools?.length ?? appStatus[s.name]?.tools ?? 0 };
      return { ...appStatus };
    },
    async close() {
      if (closed && !current) { try { q.close(); } catch { /* already closed */ } return; }
      closed = true;
      wake?.();
      try { q.close(); } catch { /* already closed */ } // also stops the app (MCP) processes it started
      await pump.catch(() => {});
    },
  };
}
