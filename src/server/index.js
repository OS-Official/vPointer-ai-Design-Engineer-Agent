#!/usr/bin/env node
/*
 * npm run ui   → your agents in a browser window, on this computer only.
 *
 *   --port <n>     default 4317 (or DEA_UI_PORT)
 *   --no-open      don't open the browser
 *   --new-key      make a new access key (old links stop working)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { AGENT_ROOT, LOGS_DIR } from '../config.js';
import { createApp } from './app.js';

const envFile = path.join(AGENT_ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const portArg = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : Number(process.env.DEA_UI_PORT ?? 4317);
const port = Number.isInteger(portArg) && portArg > 1023 && portArg < 65536 ? portArg : 4317;

// The access key lives in a private file, so a bookmarked link keeps working across restarts.
const keyFile = path.join(LOGS_DIR, 'ui', '.access-key');
fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
let token = !flag('--new-key') && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
  token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(keyFile, token, { mode: 0o600 });
}

const app = createApp({ token, port, threadsDir: path.join(LOGS_DIR, 'ui', 'threads'), memoryDir: path.join(LOGS_DIR, 'ui', 'memory') });
app.server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy: is the agent already open? Or start on another port: npm run ui -- --port ${port + 1}` : e.message);
  process.exit(1);
});
app.server.listen(port, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${port}/#key=${token}`;
  console.log('\n  \x1b[1mvPointer ai\x1b[0m (Design engineer agent) is open in your browser.');
  console.log(`  \x1b[2mIf it didn't open, use this link (it holds your private access key, so don't share it):\x1b[0m\n  ${link}\n`);
  console.log('  \x1b[2mKeep this window open while you work. Ctrl+C to quit.\x1b[0m\n');
  if (!flag('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    try { spawn(opener, [link], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* print-only is fine */ }
  }
});

let stopping = false;
async function stop() {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('\n  closing… (Ctrl+C again to force)');
  await app.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
