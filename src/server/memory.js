import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/*
 * Memory for the chats in the window, built only from what a chat file already holds: no extra model call, so it
 * costs nothing and can't make things up.
 *
 *   chatDigest(thread)   a structured summary a new session continues from when the chat's full history can't be
 *                        reloaded (another provider, history Claude Code has cleared, a first reply that never started)
 *   createMemory(dir)    project notes: a few lines per chat (what was asked, files changed, decisions on risky
 *                        actions, how it ended), one Markdown file per project folder in logs/ui/memory/ (git-ignored).
 *                        Rewritten from the chat after every reply, so it is always current and survives a crash.
 *                        A new chat in the same folder starts with them; deleting a chat removes its notes.
 *
 * Notes are background, not instructions: the system prompt says so, and the agents can't change them without asking
 * (logs/ is part of the agent's own engine for the security guard).
 */

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// what follows a request the agents took on (or tried to: an error); a built-in or a refused command gets a notice instead
const ANSWERED = new Set(['assistant', 'agent-text', 'tool', 'delegate', 'approval', 'blocked', 'result', 'error']);
const CHAT_MARK = /^<!-- chat:(t_[a-z0-9]{12}) -->$/;
const MAX_CHATS = 12;          // per folder, newest kept
const MAX_FILE_CHARS = 16_000; // per folder
export const NOTES_CHARS = { full: 6000, lite: 1500 }; // how much of them a new session reads

/** One line of plain text: no line breaks, Markdown headings or comment markers (they'd break the notes file). */
export function oneLine(text, max = 200) {
  let s = String(text ?? '').replace(/<!--|-->/g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[#>\s]+/, '').trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const cut = s.lastIndexOf(' ');
  return `${(cut > max * 0.6 ? s.slice(0, cut) : s).replace(/[\s,.:;]+$/, '')}…`;
}

const relTo = (cwd, p) => {
  if (!cwd || !p) return p;
  const r = path.relative(cwd, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
};

/** The requests in a chat that the agents worked on or tried to (not built-ins such as /tasks, nor refused commands). */
function requests(items) {
  const out = [];
  let cur = null; // the latest message from the person, and what has followed it
  const close = () => {
    if (!cur) return;
    // a message counts once the agents took it on; the newest one counts while it waits for them
    if (cur.answered || (cur.last && !cur.notice)) out.push(cur);
  };
  items.forEach((it, i) => {
    if (it.kind === 'user') { close(); cur = { text: it.text, index: i, finished: false, answered: false, notice: false, last: false }; return; }
    if (!cur) return;
    if (ANSWERED.has(it.kind)) cur.answered = true;
    // a summary notice means the runtime took the message on; any other notice answers a built-in or refuses it
    if (it.kind === 'notice') { if (it.tone === 'system') cur.answered = true; else cur.notice = true; }
    if (it.kind === 'result' && it.ok) cur.finished = true;
  });
  if (cur) { cur.last = true; close(); }
  return out;
}

/** What a chat holds, in plain facts. */
export function chatFacts(t) {
  const items = Array.isArray(t?.items) ? t.items : [];
  const asks = requests(items);
  const files = [];
  for (const it of items) {
    if (it.kind !== 'tool' || !EDIT_TOOLS.has(it.name) || !it.summary) continue;
    const f = oneLine(relTo(t.cwd, it.summary), 120);
    const at = files.indexOf(f);
    if (at >= 0) files.splice(at, 1);
    files.push(f); // last changed last
  }
  const decisions = items.filter((i) => i.kind === 'approval')
    .map((i) => `${i.decision === 'allowed' ? 'Allowed' : 'Declined'}: ${oneLine(i.label, 60)}${i.summary ? ` (${oneLine(i.summary, 90)})` : ''}`);
  const specialists = [...new Set(items.filter((i) => i.kind === 'delegate' && i.agent).map((i) => i.agent))];
  const replies = items.filter((i) => i.kind === 'assistant' && i.text?.trim()).map((i) => i.text);
  const latest = asks.at(-1) ?? null;
  return { asks, files, decisions, specialists, replies, latest, finished: latest ? latest.finished : true };
}

/** Requests before the newest message (that one is being answered now). */
export function earlierRequests(t) {
  const { asks } = chatFacts(t);
  return asks.length && asks.at(-1).last ? asks.length - 1 : asks.length;
}

const list = (arr, max, fmt = (x) => x) => (arr.length > max ? [...arr.slice(-max).map(fmt), `(and ${arr.length - max} earlier)`] : arr.map(fmt));

/**
 * A summary a fresh session can continue from: the facts first (always kept), then as much of the recent
 * conversation as fits. `limit` is in characters; the newest message itself is left out (it's sent after this).
 */
export function chatDigest(t, { limit = 6000 } = {}) {
  const items = Array.isArray(t?.items) ? t.items : [];
  const f = chatFacts(t);
  const earlier = f.asks.filter((a) => !a.last);
  const head = [];
  if (earlier.length) {
    head.push(`What this chat is about: ${oneLine(earlier[0].text, 300)}`);
    if (earlier.length > 1) head.push(`Requests so far, oldest first:\n${list(earlier.slice(1).map((a) => a.text), 6, (x) => `- ${oneLine(x, 160)}`).join('\n')}`);
  }
  if (f.files.length) head.push(`Files changed: ${list(f.files, 15).join(', ')}`);
  if (f.specialists.length) head.push(`Specialists involved: ${f.specialists.join(', ')}`);
  if (f.decisions.length) head.push(`Your decisions on risky actions:\n${list(f.decisions, 8, (x) => `- ${x}`).join('\n')}`);
  const before = earlier.at(-1);
  if (before && !before.finished) head.push(`The previous request didn’t finish: “${oneLine(before.text, 200)}”. Check what was done before carrying on.`);
  let text = head.join('\n\n');
  if (text.length > limit * 0.6) text = `${text.slice(0, Math.floor(limit * 0.6))}…`;

  // the conversation, newest last, as much as fits
  const lastUser = items.findLastIndex((i) => i.kind === 'user');
  const convo = [];
  for (const it of items.slice(0, lastUser < 0 ? items.length : lastUser)) {
    if (it.kind === 'user') convo.push(`Person: ${it.text}`);
    else if (it.kind === 'assistant') convo.push(`You: ${it.text}`);
  }
  let tail = convo.join('\n\n');
  const room = Math.max(0, limit - text.length - 40);
  if (tail.length > room) tail = room > 200 ? `…${tail.slice(-room)}` : '';
  return [text, tail ? `Recent conversation:\n${tail}` : ''].filter(Boolean).join('\n\n');
}

/** The notes kept for one chat in its folder's notes file, or null when there's nothing worth keeping. */
export function chatNote(t) {
  const f = chatFacts(t);
  if (!f.asks.length) return null;
  const date = String(t.updated ?? t.created ?? '').slice(0, 10);
  const first = f.asks[0];
  const lines = [`## ${oneLine(t.title || 'Chat', 80)}${date ? ` (${date})` : ''}`];
  lines.push(`- Asked: ${oneLine(first.text, 180)}${f.latest && f.latest !== first ? `; latest: ${oneLine(f.latest.text, 160)}` : ''}`);
  if (f.files.length) lines.push(`- Files changed: ${list(f.files, 8).join(', ')}`);
  if (f.decisions.length) lines.push(`- Decisions: ${list(f.decisions, 4).join('; ')}`);
  if (!f.finished) lines.push(`- Unfinished: the latest request didn’t finish.`);
  else if (f.replies.length) lines.push(`- Outcome: ${oneLine(f.replies.at(-1), 260)}`);
  return lines.join('\n');
}

export function createMemory(dir, { enabled = true, shownAs = 'logs/ui/memory' } = {}) {
  const folderOf = (cwd) => { try { return fs.realpathSync(path.resolve(cwd)); } catch { return path.resolve(cwd); } };
  const fileOf = (cwd) => path.join(dir, `${crypto.createHash('sha256').update(folderOf(cwd)).digest('hex').slice(0, 16)}.md`);
  const intro = (cwd) => `# Notes from chats in ${folderOf(cwd)}\n\nWritten by vPointer ai after each reply, so new chats in this folder know what was done. Newest first. You can edit or delete this file; a chat's notes are rewritten when it gets a new reply. For lasting project rules, use the folder's CLAUDE.md or the project brief instead.\n`;

  function read(cwd) {
    let raw = '';
    try { raw = fs.readFileSync(fileOf(cwd), 'utf8'); } catch { /* none yet */ }
    const sections = [];
    let header = '';
    let cur = null;
    for (const line of raw.split('\n')) {
      const m = line.match(CHAT_MARK);
      if (m) { cur = { id: m[1], lines: [] }; sections.push(cur); continue; }
      if (cur) cur.lines.push(line); else header += `${line}\n`;
    }
    return { header: header.trim() ? `${header.trimEnd()}\n` : '', sections: sections.map((s) => ({ id: s.id, text: s.lines.join('\n').trim() })).filter((s) => s.text) };
  }
  function write(cwd, { header, sections }) {
    const file = fileOf(cwd);
    if (!sections.length) { fs.rmSync(file, { force: true }); return; }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = `${header || intro(cwd)}\n${sections.map((s) => `<!-- chat:${s.id} -->\n${s.text}`).join('\n\n')}\n`;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file); // atomic: a crash never leaves half a file
  }

  return {
    enabled,
    /** Rewrite this chat's notes from the chat itself (after each reply). Never throws. */
    remember(t) {
      if (!enabled || !t?.cwd || !/^t_[a-z0-9]{12}$/.test(t.id ?? '')) return false;
      try {
        const doc = read(t.cwd);
        const note = chatNote(t);
        let sections = doc.sections.filter((s) => s.id !== t.id);
        if (note) sections.unshift({ id: t.id, text: note });
        sections = sections.slice(0, MAX_CHATS);
        while (sections.length > 1 && sections.reduce((n, s) => n + s.text.length + 30, doc.header.length) > MAX_FILE_CHARS) sections.pop();
        write(t.cwd, { header: doc.header, sections });
        return true;
      } catch { return false; }
    },
    /** The notes a new session in this folder starts with: whole chats, newest first, within `limit` characters. */
    notesFor(cwd, { except = null, limit = NOTES_CHARS.full } = {}) {
      if (!enabled || !cwd) return '';
      const out = [];
      let used = 0;
      for (const s of read(cwd).sections) {
        if (s.id === except) continue;
        if (used + s.text.length + 2 > limit) break;
        out.push(s.text);
        used += s.text.length + 2;
      }
      return out.join('\n\n');
    },
    /** For the window: is memory on, how many chats are noted in this folder, and the notes themselves. */
    info(cwd) {
      const { sections } = enabled && cwd ? read(cwd) : { sections: [] };
      return { on: enabled, chats: sections.length, file: enabled && cwd ? `${shownAs}/${path.basename(fileOf(cwd))}` : null, notes: sections.map((s) => s.text).join('\n\n') };
    },
    /** Remove one chat's notes (the chat was deleted). */
    forgetChat(t) {
      if (!t?.cwd) return;
      try { const doc = read(t.cwd); write(t.cwd, { header: doc.header, sections: doc.sections.filter((s) => s.id !== t.id) }); } catch { /* best effort */ }
    },
    /** Remove every note for this folder. */
    forget(cwd) { if (cwd) fs.rmSync(fileOf(cwd), { force: true }); },
    fileOf,
  };
}
