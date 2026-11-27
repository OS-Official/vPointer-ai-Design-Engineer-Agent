import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of this agent's own repo (where context/ and logs/ live). */
export const AGENT_ROOT = path.resolve(here, '..');
export const CONTEXT_DIR = path.join(AGENT_ROOT, 'context');
export const PROJECTS_DIR = path.join(CONTEXT_DIR, 'projects');
export const LOGS_DIR = path.join(AGENT_ROOT, 'logs');
export const AGENTS_DIR = path.join(AGENT_ROOT, 'agents');
export const BRANDS_DIR = path.join(CONTEXT_DIR, 'brands');
export const TASKS_DIR = path.join(AGENT_ROOT, 'tasks');
export const STANDARDS_DIR = path.join(AGENT_ROOT, 'standards');

/**
 * Parse CLI flags. Kept dependency-free on purpose.
 *   --cwd <dir>      folder the agent works in (default: current folder)
 *   --project <slug> preload one project brief from context/projects
 *   --careful        ask before every file write, not only risky actions
 *   --resume <id>    continue an earlier session
 *   --provider <id>  a provider from providers.json; --model <name> one of its models
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { cwd: process.cwd(), project: null, careful: false, resume: null, local: false, provider: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') args.cwd = path.resolve(argv[++i] ?? '.');
    else if (a === '--project') args.project = argv[++i] ?? null;
    else if (a === '--careful') args.careful = true;
    else if (a === '--local') args.local = true;
    else if (a === '--resume') args.resume = argv[++i] ?? null;
    else if (a === '--provider') args.provider = (argv[++i] ?? '').toLowerCase() || null;
    else if (a === '--model') args.model = argv[++i] ?? null;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

export function settings(args = {}) {
  const budget = Number(process.env.DEA_MAX_BUDGET_USD ?? 5);
  const maxOut = Number(process.env.DEA_OLLAMA_MAX_OUTPUT ?? 4096);
  const provider = args.local ? 'ollama' : (process.env.DEA_PROVIDER || 'anthropic').toLowerCase();
  return {
    provider,
    model: process.env.DEA_MODEL || 'opus',
    maxBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 5,
    ollama: {
      url: (process.env.DEA_OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
      model: process.env.DEA_OLLAMA_MODEL || 'qwen3-coder-32k:latest',
      maxOutputTokens: Number.isFinite(maxOut) && maxOut >= 512 ? maxOut : 4096,
    },
  };
}
