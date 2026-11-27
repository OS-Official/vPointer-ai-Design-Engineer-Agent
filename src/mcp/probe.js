import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { matchesAny } from './config.js';

/*
 * Live connection test for one app from mcp.json (used by `npm run check -- --mcp`).
 * Connects, lists the tools, and says what each tool would do under your permissions.
 */
/** Plain-language reason for a failed connection, with the technical message kept at the end. */
export function explain(e, config = {}) {
  const raw = String(e?.message ?? e);
  const cause = e?.cause?.code ?? e?.code;
  if (cause === 'ECONNREFUSED' || /fetch failed|ECONNREFUSED/.test(raw)) {
    return `nothing is answering at ${config.url ?? 'that address'}. Is the app open, with its MCP server turned on?`;
  }
  if (cause === 401 || cause === 403 || /\b40[13]\b|unauthori[sz]ed|forbidden/i.test(raw) || e?.name === 'UnauthorizedError') {
    return `the app wants a sign-in or a token (${raw}). Check the token in .env. Apps that only allow a browser sign-in can’t connect yet.`;
  }
  if (cause === 'ENOENT') return `the command "${config.command}" wasn’t found. Is it installed?`;
  return raw;
}

export async function probeServer(name, { config, dea }, { timeoutMs = 20000 } = {}) {
  const started = Date.now();
  const client = new Client({ name: 'dea-check', version: '1.0.0' });
  let transport;
  if (config.type === 'stdio') {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      stderr: 'pipe',
    });
  } else if (config.type === 'sse') {
    transport = new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
  } else {
    transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
  }

  let stderr = '';
  transport.stderr?.on?.('data', (d) => { stderr = (stderr + d).slice(-2000); });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer after ${timeoutMs / 1000}s`)), timeoutMs));
  try {
    await Promise.race([client.connect(transport), timeout]);
    const { tools = [] } = await Promise.race([client.listTools(), timeout]);
    const rows = tools.map((t) => ({
      name: t.name,
      readOnlyHint: t.annotations?.readOnlyHint === true,
      destructiveHint: t.annotations?.destructiveHint === true,
      decision: matchesAny(t.name, dea.deny) ? 'blocked' : matchesAny(t.name, dea.allow) ? 'runs freely' : 'asks first',
      chars: JSON.stringify(t).length,
    }));
    return { ok: true, server: client.getServerVersion?.() ?? null, tools: rows, ms: Date.now() - started };
  } catch (e) {
    const hint = stderr.trim().split('\n').slice(-3).join(' | ');
    return { ok: false, error: `${explain(e, config)}${hint ? ` (${hint})` : ''}`, ms: Date.now() - started };
  } finally {
    await client.close().catch(() => {});
  }
}
