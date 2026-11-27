import { openSession, prepareSession, sessionOnDisk } from '../engine/session.js';
import { expandInput, listTasks } from '../engine/commands.js';
import { createLiveStore } from './live.js';
import { NOTES_CHARS, chatDigest, earlierRequests } from './memory.js';

/*
 * Runs the agent engine for each chat thread of the web UI.
 *   - one engine session per thread, opened on the first message and closed after IDLE_MS
 *   - every engine event is saved to the thread (what the chat shows) and broadcast to the browser
 *   - approvals wait for the person's click (or are declined after APPROVAL_TIMEOUT_MS)
 *   - changing model on the same provider resumes the conversation; changing provider starts a
 *     fresh session that gets a short summary of the chat so far (histories don't move between APIs)
 *   - a chat whose history Claude Code has cleared (after 30 days by default) also continues from that summary,
 *     instead of failing on every message
 *   - after each reply the chat's notes are rewritten in its folder's memory, which new chats there start with
 */
const IDLE_MS = 20 * 60_000;
const APPROVAL_TIMEOUT_MS = 15 * 60_000;
const HANDOVER_CHARS = 6000;

/** "/build Northwind hero: product grid…" → "Build: Northwind hero: product grid…", cut at a word. */
export function titleFrom(line, task) {
  let text = line.replace(/\s+/g, ' ').trim();
  if (task) {
    const rest = text.replace(/^\/\S+\s*/, '');
    text = `${task[0].toUpperCase()}${task.slice(1)}${rest ? `: ${rest}` : ''}`;
  }
  if (text.length <= 56) return text;
  const cut = text.slice(0, 56);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 56).replace(/[\s,.:;]+$/, '')}…`;
}

export function createRuntime({ store, broadcast, env = process.env, open = openSession, prepare = prepareSession, sessionExists = sessionOnDisk, memory = null }) {
  const live = new Map(); // threadId → { session, key, idle, provider }
  const approvals = new Map(); // `${threadId}:${id}` → { resolve, timer, request }
  const liveView = createLiveStore(); // Live view: app actions and images, in memory only
  const busy = new Set();

  let appsVersion = 0; // bumped when an app is turned on or off, so each chat reconnects with the new set
  const keyOf = (t) => JSON.stringify([t.cwd, t.project, t.provider, t.model, Boolean(t.careful), t.apps ?? null, appsVersion]);

  function event(threadId, type, data = {}) { broadcast({ threadId, type, ...data }); }
  function addItem(threadId, item) {
    const saved = store.addItem(threadId, item);
    if (saved) event(threadId, 'item', { item: saved });
    return saved;
  }
  function setBusy(threadId, on) {
    if (on) busy.add(threadId); else busy.delete(threadId);
    event(threadId, 'status', { busy: on });
  }

  function touch(threadId) {
    const l = live.get(threadId);
    if (!l) return;
    clearTimeout(l.idle);
    l.idle = setTimeout(() => closeThread(threadId), IDLE_MS);
    l.idle.unref?.(); // never keeps the process alive on its own
  }

  async function closeThread(threadId) {
    const l = live.get(threadId);
    live.delete(threadId);
    for (const [k, a] of approvals) if (k.startsWith(`${threadId}:`)) a.resolve(false);
    if (l) { clearTimeout(l.idle); await l.session.close().catch(() => {}); }
  }

  function requestApproval(threadId, request) {
    return new Promise((resolve) => {
      const key = `${threadId}:${request.id}`;
      const done = (allowed) => {
        const a = approvals.get(key);
        if (!a) return;
        clearTimeout(a.timer);
        approvals.delete(key);
        event(threadId, 'approval-resolved', { approvalId: key, decision: allowed ? 'allowed' : 'declined' });
        resolve(allowed);
      };
      const timer = setTimeout(() => done(false), APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      approvals.set(key, { resolve: done, request, timer });
      event(threadId, 'approval-request', { approvalId: key, ...request });
    });
  }

  function onEngineEvent(threadId, e) {
    switch (e.type) {
      case 'delta': event(threadId, 'delta', { text: e.text, start: Boolean(e.start) }); break;
      case 'text': addItem(threadId, e.agent ? { kind: 'agent-text', agent: e.agent, text: e.text } : { kind: 'assistant', text: e.text }); break;
      case 'delegate': addItem(threadId, { kind: 'delegate', agent: e.agent, description: e.description }); break;
      case 'tool': addItem(threadId, { kind: 'tool', name: e.name, label: e.label, agent: e.agent, summary: e.summary }); break;
      case 'blocked': addItem(threadId, { kind: 'blocked', label: e.label, reason: e.reason }); break;
      case 'approval': addItem(threadId, { kind: 'approval', label: e.label, reason: e.reason, summary: e.summary, decision: e.decision }); break;
      case 'warning': addItem(threadId, { kind: 'error', text: e.text }); break;
      case 'apps': event(threadId, 'apps', { apps: e.apps }); break;
      case 'app-call': event(threadId, 'live-call', { call: liveView.call(threadId, e) }); break;
      case 'app-result': { const r = liveView.result(threadId, e); if (r) event(threadId, 'live-result', r); break; }
      // saved as soon as the conversation starts, so quitting during the first reply can still resume it
      case 'session-id': if (e.sessionId) store.update(threadId, { sessionId: e.sessionId }); break;
      case 'result': {
        const t = store.get(threadId);
        const costUsd = (t?.usage?.costUsd ?? 0) + (e.costUsd ?? 0);
        store.update(threadId, { sessionId: e.sessionId, usage: { costUsd, contextUsed: e.contextUsed, contextTokens: e.contextTokens } });
        addItem(threadId, { kind: 'result', ok: e.ok, subtype: e.subtype, turns: e.turns, costUsd: e.costUsd, contextUsed: e.contextUsed, contextTokens: e.contextTokens, durationMs: e.durationMs, budgetUsd: e.budgetUsd });
        event(threadId, 'thread', { thread: store.summary(store.get(threadId)), usage: store.get(threadId).usage });
        memory?.remember(store.get(threadId)); // never throws
        break;
      }
      default: break;
    }
  }

  // Why a fresh session continues from a summary, as the person reads it in the chat.
  const SUMMARY_NOTICE = {
    provider: (model) => `Now on ${model}. It continues from a summary of this chat, because conversation history doesn’t move between providers.`,
    expired: () => 'This chat’s earlier history is no longer on this computer (Claude Code keeps it for 30 days by default), so it continues from a summary of what was said and done.',
    new: () => 'This chat starts a new session that continues from a summary of what was said and done so far.',
  };

  async function ensureSession(t) {
    const existing = live.get(t.id);
    if (existing && existing.key === keyOf(t) && !existing.session.closed) { touch(t.id); return { session: existing.session, fresh: false }; }
    if (existing) await closeThread(t.id);

    const prepared = await prepare({ cwd: t.cwd, project: t.project, provider: t.provider, model: t.model, careful: t.careful, onlyApps: t.apps ?? null, env });
    // History lives with the provider that wrote it, on this computer: resume only on the same provider, and only
    // while Claude Code still has it (it clears old conversations).
    let resume;
    let reason = 'new';
    if (t.sessionId && t.sessionProvider === prepared.info.provider) {
      if ((await sessionExists(t.sessionId)) === false) reason = 'expired';
      else resume = t.sessionId;
    } else if (t.sessionId) reason = 'provider';
    const notes = memory?.notesFor(t.cwd, { except: t.id, limit: prepared.info.lite ? NOTES_CHARS.lite : NOTES_CHARS.full }) ?? '';
    const session = await open({ prepared, resume, memory: notes }, {
      onEvent: (e) => onEngineEvent(t.id, e),
      approve: (req) => requestApproval(t.id, req),
    });
    live.set(t.id, { session, key: keyOf(t), idle: null });
    touch(t.id);
    store.update(t.id, { sessionProvider: prepared.info.provider, ...(resume ? {} : { sessionId: null }) });
    event(t.id, 'session', { info: session.info });
    return { session, fresh: !resume, reason, info: session.info };
  }

  /** One turn: open (or reuse) the chat's session; a fresh one gets a summary of the chat first. */
  async function runTurn(threadId, action, { reason: forced } = {}) {
    const { session, fresh, reason } = await ensureSession(store.get(threadId));
    let message = action.text;
    const t = store.get(threadId);
    if (fresh && earlierRequests(t) > 0) {
      const why = forced ?? reason;
      const digest = chatDigest(t, { limit: session.info.lite ? 2500 : HANDOVER_CHARS });
      message = `${why === 'provider' ? 'Earlier in this chat, on another model:' : 'Earlier in this chat (its full history couldn’t be reloaded, so this is a summary):'}\n\n${digest}\n\n---\nContinue from there. The person now says:\n\n${action.text}`;
      addItem(threadId, { kind: 'notice', tone: 'system', text: SUMMARY_NOTICE[why]?.(session.info.modelLabel) ?? SUMMARY_NOTICE.new() });
    }
    await session.send(message, { label: action.label });
  }

  return {
    busy: (id) => busy.has(id),
    /** Live view state for a chat (recent app actions and images), for a page that (re)loads it. */
    liveView(threadId) { return liveView.snapshot(threadId); },
    forgetLive(threadId) { liveView.forget(threadId); },
    pendingApprovals(threadId) {
      return [...approvals.entries()].filter(([k]) => !threadId || k.startsWith(`${threadId}:`)).map(([k, a]) => ({ approvalId: k, threadId: k.split(':')[0], ...a.request }));
    },

    /** Handle one message from the person. Returns quickly; progress arrives as events. */
    async send(threadId, text) {
      const t = store.get(threadId);
      if (!t) throw Object.assign(new Error('No such chat.'), { status: 404 });
      if (busy.has(threadId)) throw Object.assign(new Error('Still working on the previous message. Stop it first, or wait.'), { status: 409 });
      const line = String(text ?? '').trim();
      if (!line) throw Object.assign(new Error('Type a message first.'), { status: 400 });
      if (line.length > 100_000) throw Object.assign(new Error('That message is too long (100,000 characters at most).'), { status: 413 });

      // Claim the chat before anything async, so a double Enter can't start two runs.
      busy.add(threadId);
      let action;
      try {
        action = await expandInput(line, { project: t.project, waiting: live.get(threadId)?.session.loaded.waiting ?? {}, skipped: live.get(threadId)?.session.loaded.mcp?.skipped ?? {} });
      } catch (err) { busy.delete(threadId); throw err; }
      addItem(threadId, { kind: 'user', text: line, ...(action.task ? { task: action.task } : {}) });
      if (t.title === 'New chat') store.update(threadId, { title: titleFrom(line, action.task) });
      event(threadId, 'thread', { thread: store.summary(store.get(threadId)) });

      if (action.kind === 'error') { busy.delete(threadId); addItem(threadId, { kind: 'notice', tone: 'warn', text: action.message, hint: action.hint }); return { ok: false }; }
      if (action.kind === 'builtin') {
        try { addItem(threadId, { kind: 'notice', text: await builtinText(action.name, threadId) }); } finally { busy.delete(threadId); }
        return { ok: true };
      }

      setBusy(threadId, true);
      (async () => {
        try {
          try {
            await runTurn(threadId, action);
          } catch (err) {
            if (err?.code !== 'RESUME_FAILED') throw err;
            // Its history was cleared after all: forget it, and carry on from a summary (once).
            store.update(threadId, { sessionId: null });
            await closeThread(threadId);
            await runTurn(threadId, action, { reason: 'expired' });
          }
        } catch (err) {
          addItem(threadId, { kind: 'error', text: err.message });
        } finally {
          setBusy(threadId, false);
        }
      })();
      return { ok: true };
    },

    async interrupt(threadId) {
      for (const [k, a] of approvals) if (k.startsWith(`${threadId}:`)) a.resolve(false);
      await live.get(threadId)?.session.interrupt();
    },

    answer(approvalId, allowed) {
      const a = approvals.get(approvalId);
      if (!a) return false;
      a.resolve(allowed === true);
      return true;
    },

    /** Settings changed: the next message opens a session with them. */
    async settingsChanged(threadId) {
      if (busy.has(threadId)) return;
      const l = live.get(threadId);
      const t = store.get(threadId);
      if (l && t && l.key !== keyOf(t)) await closeThread(threadId);
    },

    /**
     * An app was turned on or off. Chats that are idle drop their connections now; a chat that is
     * working keeps its apps until its message is done, and reconnects with the new set on the next one.
     */
    async appsChanged() {
      appsVersion += 1;
      await Promise.all([...live.keys()].filter((id) => !busy.has(id)).map(closeThread));
    },

    async appStatus(threadId) { return live.get(threadId)?.session.appStatus() ?? null; },
    /** Notes for new chats in this chat's folder: whether memory is on, how many chats are noted, and the notes. */
    memoryInfo(threadId) {
      const t = store.get(threadId);
      return memory && t ? memory.info(t.cwd) : { on: false, chats: 0, file: null, notes: '' };
    },
    /** Forget every note for this chat's folder (new chats there start without them). */
    forgetMemory(threadId) {
      const t = store.get(threadId);
      if (memory && t) memory.forget(t.cwd);
    },
    /** A chat is being deleted: its notes go with it. */
    forgetChat(threadId) {
      const t = store.get(threadId);
      if (memory && t) memory.forgetChat(t);
    },
    closeThread,
    async shutdown() { await Promise.all([...live.keys()].map(closeThread)); },
  };

  async function builtinText(name, threadId) {
    if (name === 'tasks') return (await listTasks()).map((t) => `**/${t.name}**: ${t.description}\n\`${t.usage}\``).join('\n\n');
    if (name === 'mcp') {
      const st = live.get(threadId) ? await live.get(threadId).session.appStatus() : null;
      if (!st) return 'Apps connect when the chat starts. Send a message first, then ask again.';
      return Object.entries(st).map(([n, s]) => `**${n}**: ${s.status}${s.tools ? ` · ${s.tools} tools` : ''}${s.error ? ` (${s.error})` : ''}`).join('\n') || 'No apps are on. Add one in mcp.json.';
    }
    if (name === 'exit' || name === 'quit') return 'There is nothing to exit here: close the tab, or start a new chat.';
    return `/${name} lives in the side panel here: open **Agents & tools** at the top right.`;
  }
}
