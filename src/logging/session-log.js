import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from '../config.js';

/**
 * "Teaching layer": a readable Markdown log of every session — your prompts,
 * which specialist did what, every tool call and every security decision —
 * so you can review how the work was done afterwards.
 * Tool inputs are truncated and never include file contents from secret paths.
 */
export function createSessionLog() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(LOGS_DIR, `session-${stamp}.md`);
  const write = (s) => fs.appendFileSync(file, s + '\n');
  write(`# Session ${stamp}\n`);

  const short = (v, n = 300) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  return {
    file,
    prompt: (text) => write(`\n## You\n${text}\n`),
    toolCall: (name, input, agent) =>
      write(`- 🔧 ${agent ? `[${agent}] ` : ''}**${name}** \`${short(input, 200).replace(/`/g, "'")}\``),
    security: (name, decision, reason) => write(`- 🛡️ **${decision.toUpperCase()}** ${name}: ${reason}`),
    text: (text, agent) => write(`\n${agent ? `**[${agent}]** ` : ''}${text}\n`),
    result: (r) =>
      write(`\n---\n_${r.subtype} · ${r.num_turns ?? '?'} turns · $${(r.total_cost_usd ?? 0).toFixed(4)} · ${Math.round((r.duration_ms ?? 0) / 1000)}s · session ${r.session_id}_\n`),
  };
}
