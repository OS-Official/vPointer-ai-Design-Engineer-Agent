import fs from 'node:fs';
import path from 'node:path';
import { AGENT_ROOT } from '../config.js';
import { prepareOllama, ollamaEnv, LITE_CONTEXT_LIMIT } from '../providers.js';

/*
 * Model providers: which API runs the agents. Shared by the terminal (dea) and the web UI.
 *
 * providers.json (optional; built-in defaults below when it's missing):
 *   {
 *     "default": { "provider": "anthropic", "model": "opus" },
 *     "providers": {
 *       "anthropic": { "type": "anthropic", "models": [{ "id": "opus", "label": "Claude Opus 5.5" }] },
 *       "ollama":    { "type": "ollama" },
 *       "my-api":    { "type": "anthropic-compatible", "baseUrl": "https://…", "apiKeyEnv": "DEA_PROVIDER_MY_API_KEY",
 *                      "models": [{ "id": "model-name" }] }
 *     }
 *   }
 *
 * Types:
 *   anthropic             Claude through ANTHROPIC_API_KEY. Full tool set, web search, budget cap.
 *   ollama                A model on Ollama (models are discovered). Nothing leaves the machine
 *                         unless the URL points elsewhere. Credentials are removed from the environment.
 *   anthropic-compatible  Any other API that speaks the Anthropic Messages format. Its key comes from
 *                         .env (apiKeyEnv), your Anthropic key is never sent there, and the UI warns
 *                         that prompts and files go to that host.
 * Secrets never appear in providers.json: only the NAME of the variable that holds them.
 */

export const PROVIDERS_FILE = process.env.DEA_PROVIDERS_FILE || path.join(AGENT_ROOT, 'providers.json');
const ID = /^[a-z][a-z0-9-]*$/;
const TYPES = ['anthropic', 'ollama', 'anthropic-compatible'];

const ANTHROPIC_MODELS = [
  { id: 'opus', label: 'Claude Opus 5.5', note: 'best for complex work' },
  { id: 'sonnet', label: 'Claude Sonnet 5.5', note: 'fast, lower cost' },
  { id: 'haiku', label: 'Claude Haiku 5.5', note: 'fastest, lowest cost' },
];

export function builtinProviders(env = process.env) {
  return {
    default: { provider: (env.DEA_PROVIDER || 'anthropic').toLowerCase(), model: null },
    providers: {
      anthropic: { type: 'anthropic', label: 'Claude (Anthropic API)', apiKeyEnv: 'ANTHROPIC_API_KEY', models: ANTHROPIC_MODELS },
      ollama: { type: 'ollama', label: 'Ollama (local)' },
    },
  };
}

/** Read and validate providers.json. Returns { providers, default, errors, warnings }. */
export function loadProviders({ file = PROVIDERS_FILE, env = process.env } = {}) {
  const errors = [];
  const warnings = [];
  let raw = builtinProviders(env);
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return { ...normalise(builtinProviders(env), env, warnings), errors: [`providers.json: not valid JSON (${e.message})`], warnings };
    }
  }
  if (!raw || typeof raw.providers !== 'object') return { ...normalise(builtinProviders(env), env, warnings), errors: ['providers.json: needs a "providers" object'], warnings };

  for (const [id, p] of Object.entries(raw.providers)) {
    const where = `providers.json → ${id}`;
    if (!ID.test(id)) errors.push(`${where}: name must be lowercase-with-hyphens`);
    if (!TYPES.includes(p?.type)) errors.push(`${where}: type must be one of ${TYPES.join(', ')}`);
    if (p?.type === 'anthropic-compatible') {
      if (p.enabled !== false) {
        if (!/^https?:\/\//.test(p.baseUrl ?? '') || /REPLACE|example\./.test(p.baseUrl)) errors.push(`${where}: baseUrl must be the API's https address (still a placeholder?)`);
        if (!/^[A-Z][A-Z0-9_]*$/.test(p.apiKeyEnv ?? '')) errors.push(`${where}: apiKeyEnv must name a variable in .env, e.g. DEA_PROVIDER_${id.toUpperCase().replace(/-/g, '_')}_KEY`);
        if (!Array.isArray(p.models) || !p.models.length) errors.push(`${where}: list at least one model: "models": [{ "id": "…" }]`);
      }
    }
    if (p?.models !== undefined && (!Array.isArray(p.models) || p.models.some((m) => typeof m?.id !== 'string' || !m.id))) errors.push(`${where}: each model needs an "id"`);
  }
  return { ...normalise(raw, env, warnings), errors, warnings };
}

function normalise(raw, env, warnings) {
  const providers = {};
  for (const [id, p] of Object.entries(raw.providers ?? {})) {
    if (!p || !TYPES.includes(p.type) || p.enabled === false) continue;
    const base = { id, type: p.type, label: p.label || id };
    if (p.type === 'anthropic') {
      const keyEnv = p.apiKeyEnv || 'ANTHROPIC_API_KEY';
      providers[id] = { ...base, apiKeyEnv: keyEnv, available: Boolean(env[keyEnv]), reason: env[keyEnv] ? null : `${keyEnv} is not set in .env`, models: (p.models?.length ? p.models : ANTHROPIC_MODELS).map(model), local: false, host: 'api.anthropic.com' };
    } else if (p.type === 'ollama') {
      let url = String(env.DEA_OLLAMA_URL || p.url || 'http://localhost:11434').trim().replace(/\/+$/, ''); // .env wins, as in earlier versions
      if (!/^https?:\/\//i.test(url)) url = `http://${url}`; // "localhost:11434" → "http://localhost:11434"
      let host = url;
      try { host = new URL(url).host; } catch { warnings.push(`Ollama address "${url}" isn't a valid URL. Use e.g. DEA_OLLAMA_URL=http://localhost:11434`); }
      const maxOut = Number(env.DEA_OLLAMA_MAX_OUTPUT ?? p.maxOutputTokens ?? 4096);
      providers[id] = { ...base, url, maxOutputTokens: Number.isFinite(maxOut) && maxOut >= 512 ? maxOut : 4096, defaultModel: env.DEA_OLLAMA_MODEL || p.defaultModel || 'qwen3-coder-32k:latest', models: (p.models ?? []).map(model), available: null, local: isLocalUrl(url), host };
    } else {
      const key = env[p.apiKeyEnv];
      let host = '';
      try { host = new URL(p.baseUrl).host; } catch { /* reported by validation */ }
      providers[id] = { ...base, baseUrl: String(p.baseUrl ?? '').replace(/\/+$/, ''), apiKeyEnv: p.apiKeyEnv, auth: p.auth === 'bearer' ? 'bearer' : 'x-api-key', maxOutputTokens: Number(p.maxOutputTokens) || 8192, contextTokens: Number(p.contextTokens) || null, available: Boolean(key), reason: key ? null : `${p.apiKeyEnv} is not set in .env`, models: (p.models ?? []).map(model), local: false, host };
      if (!key) warnings.push(`providers.json → ${id}: ${p.apiKeyEnv} is not set in .env, so ${base.label} is unavailable`);
    }
  }
  const envProvider = env.DEA_PROVIDER?.toLowerCase();
  const def = { provider: envProvider || raw.default?.provider || 'anthropic', model: null };
  if (!providers[def.provider]) def.provider = Object.keys(providers)[0] ?? 'anthropic';
  const dp = providers[def.provider];
  const fileModel = raw.default?.provider === def.provider ? raw.default?.model : null; // only for the provider it was written for
  if (dp?.type === 'anthropic') def.model = env.DEA_MODEL || fileModel || dp.models[0]?.id || 'opus';
  else if (dp?.type === 'ollama') def.model = dp.defaultModel || fileModel;
  else def.model = fileModel || dp?.models[0]?.id || null;
  return { providers, default: def };
}

const model = (m) => ({ id: m.id, label: m.label || m.id, ...(m.note ? { note: m.note } : {}) });

export function isLocalUrl(url) {
  try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname); } catch { return false; }
}

/** Live model list for Ollama providers; other providers list their configured models. */
export async function listModels(provider) {
  if (provider.type !== 'ollama') return { ...provider };
  try {
    const res = await fetchJson(`${provider.url}/api/tags`, 2500);
    const models = (res.models ?? []).map((m) => ({ id: m.name, label: m.name, note: m.details?.parameter_size ? `${m.details.parameter_size}${m.details.quantization_level ? ` · ${m.details.quantization_level}` : ''}` : undefined }));
    return { ...provider, available: models.length > 0, reason: models.length ? null : 'Ollama is running but has no models (ollama pull …)', models };
  } catch {
    return { ...provider, available: false, reason: `Ollama isn't answering at ${provider.url}. Open the Ollama app.`, models: provider.models };
  }
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/**
 * Everything a session needs to run on one provider + model:
 *   { providerId, type, label, model, env(base), local, host, lite, contextTokens, tools, thinkingOff, budgetUsd, costKnown, notes[] }
 * Throws a readable Error when the provider can't be used (no key, Ollama off, unknown model).
 */
export async function prepareModel({ provider: providerId, model: modelId } = {}, { providers, defaults, env = process.env, maxBudgetUsd = 5 } = {}) {
  const pid = providerId || defaults?.provider;
  const p = providers[pid];
  if (!p) throw new Error(`Unknown provider "${pid}". Providers: ${Object.keys(providers).join(', ') || 'none'} (providers.json)`);

  if (p.type === 'anthropic') {
    if (!env[p.apiKeyEnv]) throw new Error(`${p.apiKeyEnv} is not set. Add it to .env, or pick a local model.`);
    const mid = modelId || (defaults?.provider === pid ? defaults.model : null) || p.models[0]?.id;
    return {
      providerId: pid, type: p.type, label: p.label, model: mid, modelLabel: p.models.find((m) => m.id === mid)?.label ?? mid,
      env: (base) => withoutOtherSecrets({ ...base, ANTHROPIC_API_KEY: env[p.apiKeyEnv] }), local: false, host: p.host, lite: null, contextTokens: null,
      fullTools: true, thinkingOff: false, budgetUsd: maxBudgetUsd, costKnown: true, notes: [],
    };
  }

  if (p.type === 'ollama') {
    const wanted = modelId || (defaults?.provider === pid ? defaults.model : null) || p.defaultModel;
    const o = await prepareOllama({ url: p.url, model: wanted });
    const lite = o.contextTokens < LITE_CONTEXT_LIMIT ? { contextTokens: o.contextTokens } : null;
    const notes = [];
    if (o.remote) notes.push(`${o.url} is not this computer: prompts and project files are sent there.`);
    if (!o.contextKnown) notes.push('The model sets no num_ctx, so Ollama uses its small default context. Create a build with PARAMETER num_ctx (see the guide).');
    if (lite) notes.push(`Small context (${o.contextTokens.toLocaleString('en-US')} tokens): start a fresh chat for each new task.`);
    return {
      providerId: pid, type: p.type, label: p.label, model: o.model, modelLabel: o.model, version: o.version,
      env: (base) => withoutOtherSecrets(ollamaEnv(base, o, { maxOutputTokens: p.maxOutputTokens })), local: !o.remote, host: p.host,
      lite, contextTokens: o.contextTokens, fullTools: false, thinkingOff: true, budgetUsd: null, costKnown: false, notes,
    };
  }

  // anthropic-compatible
  const key = env[p.apiKeyEnv];
  if (!key) throw new Error(`${p.apiKeyEnv} is not set. Add it to .env to use ${p.label}.`);
  const mid = modelId || (defaults?.provider === pid ? defaults.model : null) || p.models[0]?.id;
  if (!p.models.some((m) => m.id === mid)) throw new Error(`${p.label} has no model "${mid}" in providers.json. Models: ${p.models.map((m) => m.id).join(', ')}`);
  const lite = p.contextTokens && p.contextTokens < LITE_CONTEXT_LIMIT ? { contextTokens: p.contextTokens } : null;
  return {
    providerId: pid, type: p.type, label: p.label, model: mid, modelLabel: p.models.find((m) => m.id === mid)?.label ?? mid,
    env: (base) => compatibleEnv(base, p, mid, key), local: false, host: p.host,
    lite, contextTokens: p.contextTokens, fullTools: false, thinkingOff: true, budgetUsd: null, costKnown: false,
    notes: [`Prompts, project files and brand context are sent to ${p.host}.`],
  };
}

/** The agent process never needs other providers' keys or app secrets (apps get theirs from mcp.json). */
function withoutOtherSecrets(env) {
  for (const k of Object.keys(env)) if (/^DEA_(PROVIDER|MCP)_/.test(k)) delete env[k];
  return env;
}

/** Environment for an Anthropic-compatible API: its own key, never yours, and no Claude-only extras. */
export function compatibleEnv(base, p, model, key) {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  // Never hand a third party the secrets of other providers or apps.
  for (const k of Object.keys(env)) if (/^DEA_(PROVIDER|MCP)_/.test(k)) delete env[k];
  return {
    ...env,
    ANTHROPIC_BASE_URL: p.baseUrl,
    ...(p.auth === 'bearer' ? { ANTHROPIC_AUTH_TOKEN: key } : { ANTHROPIC_API_KEY: key }),
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(p.maxOutputTokens),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  };
}
