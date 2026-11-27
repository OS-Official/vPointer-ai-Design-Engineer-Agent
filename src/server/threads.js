import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/*
 * Chat threads for the web UI, one JSON file each in logs/ui/threads/ (git-ignored, like all logs).
 * A thread keeps its settings (folder, brief, provider, model) and the items shown in the chat.
 * Nothing secret is stored: no keys, no file contents beyond what the agent wrote in its replies.
 */
const ID = /^t_[a-z0-9]{12}$/;
const MAX_ITEMS = 2000;

export function createThreadStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cache = new Map();
  const timers = new Map();
  const file = (id) => path.join(dir, `${id}.json`);

  function read(id) {
    if (!ID.test(id ?? '')) return null;
    if (cache.has(id)) return cache.get(id);
    try {
      const t = JSON.parse(fs.readFileSync(file(id), 'utf8'));
      cache.set(id, t);
      return t;
    } catch { return null; }
  }

  function flush(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const t = cache.get(id);
    if (!t) return;
    const tmp = `${file(id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(t), { mode: 0o600 });
    fs.renameSync(tmp, file(id)); // atomic: a crash never leaves half a file
  }
  const save = (id) => {
    clearTimeout(timers.get(id));
    const tm = setTimeout(() => flush(id), 250);
    tm.unref?.();
    timers.set(id, tm);
  };
  const summary = (t) => ({ id: t.id, title: t.title, created: t.created, updated: t.updated, cwd: t.cwd, project: t.project, provider: t.provider, model: t.model, careful: t.careful, apps: t.apps ?? null, pinned: Boolean(t.pinned) });

  return {
    list() {
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        const m = f.match(/^(t_[a-z0-9]{12})\.json$/);
        if (m) { const t = read(m[1]); if (t) out.push(summary(t)); }
      }
      return out.sort((a, b) => (b.pinned - a.pinned) || b.updated.localeCompare(a.updated));
    },
    get: read,
    summary,
    create({ cwd, project = null, provider, model, careful = false, apps = null, title = 'New chat' }) {
      const now = new Date().toISOString();
      const t = { id: `t_${crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}`, title, created: now, updated: now, cwd, project, provider, model, careful, apps, sessionId: null, sessionProvider: null, items: [], usage: { costUsd: 0 } };
      cache.set(t.id, t);
      flush(t.id);
      return t;
    },
    update(id, patch) {
      const t = read(id);
      if (!t) return null;
      Object.assign(t, patch, { updated: new Date().toISOString() });
      save(id);
      return t;
    },
    addItem(id, item) {
      const t = read(id);
      if (!t) return null;
      t.nextItem = (t.nextItem ?? t.items.length) + 1;
      const full = { id: `i${t.nextItem}_${Date.now().toString(36)}`, at: new Date().toISOString(), ...item };
      t.items.push(full);
      if (t.items.length > MAX_ITEMS) t.items.splice(0, t.items.length - MAX_ITEMS);
      t.updated = full.at;
      save(id);
      return full;
    },
    updateItem(id, itemId, patch) {
      const t = read(id);
      const it = t?.items.find((i) => i.id === itemId);
      if (!it) return null;
      Object.assign(it, patch);
      save(id);
      return it;
    },
    remove(id) {
      if (!read(id)) return false;
      clearTimeout(timers.get(id));
      timers.delete(id);
      cache.delete(id);
      fs.rmSync(file(id), { force: true });
      return true;
    },
    flushAll() { for (const id of [...timers.keys()]) flush(id); },
  };
}
