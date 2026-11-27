/*
 * Model providers. "anthropic" (default) uses ANTHROPIC_API_KEY.
 * "ollama" runs every request on a local Ollama model through its Anthropic-compatible API:
 * nothing leaves your machine, and your Anthropic key is never sent to Ollama.
 */

export const LITE_CONTEXT_LIMIT = 100_000; // below this, the SDK can't auto-compact: use lite mode

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function getJson(url, init = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** "num_ctx  32768\nstop ..." → 32768 */
export function parseNumCtx(parameters = '') {
  const m = String(parameters).match(/^\s*num_ctx\s+(\d+)/m);
  return m ? Number(m[1]) : null;
}

/** Same model name, with or without the ":latest" tag. */
export function sameModel(a, b) {
  const norm = (s) => (s.includes(':') ? s : `${s}:latest`);
  return norm(a) === norm(b);
}

/**
 * Checks Ollama is running and has the model, and reads the model's real context size.
 * Returns { url, model, version, contextTokens, remote } or throws a readable Error.
 */
export async function prepareOllama({ url, model }) {
  const host = new URL(url).hostname;
  let tags;
  try {
    tags = await getJson(`${url}/api/tags`);
  } catch {
    throw new Error(`Ollama isn't answering at ${url}.\nOpen the Ollama app (or run: ollama serve), then try again.`);
  }
  const installed = (tags.models ?? []).map((m) => m.name);
  const match = installed.find((n) => sameModel(n, model));
  if (!match) {
    throw new Error(`Ollama has no model "${model}". Installed: ${installed.join(', ') || 'none'}.\nSet DEA_OLLAMA_MODEL in .env to one of these.`);
  }
  const version = await getJson(`${url}/api/version`).then((v) => v.version).catch(() => 'unknown');
  const show = await getJson(`${url}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: match }) }).catch(() => ({}));
  // num_ctx is what Ollama actually allocates; the model's trained maximum is only a fallback hint.
  const numCtx = parseNumCtx(show.parameters);
  return {
    url, model: match, version,
    contextTokens: numCtx ?? 4096, // when the model sets no num_ctx, Ollama uses its own (small) default
    contextKnown: numCtx !== null,
    remote: !LOCAL_HOSTS.has(host),
  };
}

/**
 * Environment for the SDK's Claude Code process when running on Ollama.
 * Removes Anthropic credentials so they can never be sent to another host.
 */
export function ollamaEnv(base, { url, model }, { maxOutputTokens }) {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return {
    ...env,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_MODEL: model,
    // Any alias (opus, sonnet, haiku) or background call resolves to the local model.
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    // Leave out Claude-only request features a local server may not accept.
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
    // No update checks, telemetry or error reports to Anthropic while running locally.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  };
}
