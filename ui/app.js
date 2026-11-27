/*
 * vPointer ai (Design engineer agent) — the window.
 * Plain JavaScript modules, no build step. The server (src/server) runs the agents; this page only
 * shows the conversation and sends what you type, approve or change.
 *
 *   state S  →  render*() functions draw from it  →  events from the server update S and redraw
 */
import { renderMarkdown } from './markdown.js';

// ---------- tiny DOM helpers (text is always set as text, never parsed as HTML) ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
// Agent replies are Markdown. renderMarkdown escapes every character before adding its own tags.
function markdown(text, cls = 'reply') {
  const node = el('div', { class: cls });
  node.innerHTML = renderMarkdown(text); // layout-lint-ignore: output of the escaping renderer in markdown.js
  for (const pre of node.querySelectorAll('pre.code')) {
    const wrap = el('div', { class: 'code-block' });
    pre.replaceWith(wrap);
    wrap.append(pre, copyButton(() => pre.textContent, 'Copy', 'Copy code'));
  }
  return node;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = el('textarea', { class: 'sr-only', 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
function copyButton(getText, label = 'Copy', ariaLabel = label) {
  const text = el('span', { text: label });
  const btn = el('button', { type: 'button', class: 'copy-btn', 'aria-label': ariaLabel }, svg(GLYPH.copy, 13), text);
  btn.addEventListener('click', async () => {
    const ok = await copyText(getText());
    text.textContent = ok ? 'Copied' : 'Couldn’t copy';
    announce(ok ? 'Copied.' : 'Couldn’t copy.');
    setTimeout(() => { text.textContent = label; }, 1500);
  });
  return btn;
}
const svg = (d, size = 14) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  for (const part of d) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (part.startsWith('!')) { p.setAttribute('d', part.slice(1)); p.setAttribute('fill', 'currentColor'); s.append(p); continue; } // "!" = a filled shape
    p.setAttribute('d', part); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', d === GLYPH.more ? '2.25' : '1.5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
  }
  return s;
};
const GLYPH = {
  tool: ['M3 3h10v10H3z'],
  agent: ['M8 2.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z', 'M3 13.5c.6-2.4 2.6-3.8 5-3.8s4.4 1.4 5 3.8'],
  blocked: ['M8 2l5 2v4c0 3-2.2 5-5 6c-2.8-1-5-3-5-6V4z', 'M6 6l4 4M10 6l-4 4'],
  allowed: ['M3.5 8.5l3 3l6-7'],
  declined: ['M4 4l8 8M12 4l-8 8'],
  folder: ['M2 4.5h4l1.5 1.5H14v6.5H2z'],
  chevron: ['M6 4l4 4l-4 4'],
  up: ['M8 13V3M4 7l4-4l4 4'],
  trash: ['M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5'],
  more: ['M3.5 8h.01M8 8h.01M12.5 8h.01'],
  down: ['M4.5 6.5L8 10l3.5-3.5'],
  check: ['M3.5 8.5l3 3l6-7'],
  pin: ['M6 2.5h4M7 2.5v4l-2.5 3h7L9 6.5v-4M8 9.5V14'],
  pencil: ['M10.5 3l2.5 2.5L6 12.5 3 13l.5-3z'],
  shield: ['M8 2l5 2v4c0 3-2.2 5-5 6c-2.8-1-5-3-5-6V4z'],
  copy: ['M5.5 5.5h7v7h-7z', 'M3.5 10.5v-7h7'],
  plug: ['M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z', 'M8 11.5v2'],
  // appearance: Auto (half light, half dark), Light (the sun), Dark (the moon)
  auto: ['M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11z', '!M8 2.5a5.5 5.5 0 0 0 0 11z'],
  sun: ['M8 5.25a2.75 2.75 0 1 1 0 5.5a2.75 2.75 0 0 1 0-5.5z', 'M8 1.25v1.25M8 13.5v1.25M1.25 8H2.5M13.5 8h1.25M3.23 3.23l.88.88M11.89 11.89l.88.88M3.23 12.77l.88-.88M11.89 4.11l.88-.88'],
  moon: ['M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z'],
};
// Key names as Apple writes them on a Mac (Return, Shift-Return, Control-C), and the usual names elsewhere.
const MAC = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const KEYS = MAC
  ? { enter: 'Return', newline: 'Shift-Return', interrupt: 'Control-C', sidebar: 'Control-Command-S' } // Show/Hide Sidebar, as in Mac apps
  : { enter: 'Enter', newline: 'Shift-Enter', interrupt: 'Ctrl+C', sidebar: 'Ctrl+Alt+S' };
const base = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? p;
const fmtCost = (n) => (n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? '<$0.01' : '$0');
const fmtTime = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.max(1, Math.round(ms / 1000))} s`);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};

// ---------- access key: from the link the terminal printed, then kept in this browser ----------
function readKey() {
  const m = location.hash.match(/key=([A-Za-z0-9_-]{32,})/);
  if (m) {
    store.set('dea-key', m[1]);
    history.replaceState(null, '', location.pathname); // keep the key out of the address bar
    return m[1];
  }
  return store.get('dea-key');
}
let KEY = readKey();

// ---------- state ----------
// Motion: every animation moves only transform and opacity, and none runs with Reduce Motion on.
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const DOCKED = window.matchMedia('(min-width: 48rem)'); // the sidebar is a column (below this it's a drawer)
const WIDE = window.matchMedia('(min-width: 64rem)');   // the right-hand window is a column (below this it's a sheet)

// ---------- shell motion: one movement for every side window ----------
// Showing or hiding the sidebar or the right-hand window changes the page's columns. The columns change at once;
// then everything that moved glides from where it was drawn to where it now belongs (transform only, so nothing is
// laid out again per frame), in the same time and on the same curve as the side window's own slide. The top bar's
// buttons travel exactly as far as the window's edge, so they ride it; the centred conversation and message box
// travel half as far, which reads as the space opening up. Interrupt it (click again mid-way) and it turns around
// from wherever it is on screen.
const SHELL_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // --ease in styles.css
const shellMs = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-dur')) || 400;
const isRtl = () => getComputedStyle(document.documentElement).direction === 'rtl';
const shellAnims = (n) => n.getAnimations().filter((a) => a.id === 'shell');
// Every glide starts on the current frame (not the next one), so pieces started together stay locked together and
// a turn-around never pauses.
function shellAnimation(node, keyframes, options) {
  const a = node.animate(keyframes, { easing: SHELL_EASE, ...options });
  a.id = 'shell';
  if (document.timeline.currentTime !== null) a.startTime = document.timeline.currentTime;
  return a;
}
const glide = (node, from, to, { fill = 'none' } = {}) =>
  shellAnimation(node, [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: shellMs(), fill });
function reflow(change) {
  if (REDUCED_MOTION.matches) { change(); return; }
  const rtl = isRtl();
  // the top bar's items keep their start edge (the title is start-aligned); the rest are centred
  const pieces = [...$$('.topbar > *').map((n) => [n, 'start']), [$('#conversation'), 'centre'], ...$$('.composer > *').map((n) => [n, 'centre'])];
  const xOf = (r, how) => (how === 'centre' ? r.left + r.width / 2 : rtl ? r.right : r.left);
  const was = pieces.map(([n, how]) => { const r = n.getBoundingClientRect(); return r.width || r.height ? xOf(r, how) : null; }); // includes a glide in flight
  for (const [n] of pieces) for (const a of shellAnims(n)) a.cancel();
  change();
  pieces.forEach(([n, how], i) => {
    if (was[i] === null || !n.isConnected) return;
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const dx = was[i] - xOf(r, how);
    if (Math.abs(dx) >= 0.5) glide(n, dx, 0);
  });
}
// Slide a side window its own width (the sidebar also clears its outer margin), starting from wherever it is now.
function slideWindow(node, entering) {
  if (REDUCED_MOTION.matches) return null;
  const cs = getComputedStyle(node);
  const start = node.id === 'sidebar';
  const away = (start ? -1 : 1) * (isRtl() ? -1 : 1) * (node.getBoundingClientRect().width + (start ? parseFloat(cs.marginInlineStart) || 0 : 0));
  let from = entering ? away : 0;
  const running = shellAnims(node);
  if (running.length) { from = new DOMMatrixReadOnly(cs.transform).m41; for (const a of running) a.cancel(); }
  return glide(node, from, entering ? 0 : away, { fill: entering ? 'none' : 'forwards' });
}
// The right-hand window swapping (Agents & tools ↔ Live view): the column stays, so the newcomer only settles in.
function settleIn(node) {
  if (REDUCED_MOTION.matches) return;
  for (const a of shellAnims(node)) a.cancel();
  shellAnimation(node, [{ opacity: 0, transform: `translateX(${isRtl() ? -24 : 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 340 });
}

const S = {
  snap: null,
  threads: [],
  current: null,
  busy: new Set(),
  approvals: new Map(),
  sessionInfo: {},
  apps: {},
  memory: {},           // per chat: notes new chats in its folder start with (fetched when the panel shows them)
  stream: { threadId: null, text: '' },
  draft: { cwd: null, project: null, provider: null, model: null, careful: false, ...store.get('dea-last', {}) },
  panelOpen: store.get('dea-panel', false),
  liveOpen: store.get('dea-live', false) && !store.get('dea-panel', false), // the right column holds one window at a time
  live: {},              // per chat: { calls, frames } (Live view; in memory only, like on the server)
  liveFrame: {},         // per chat: the frame picked in the filmstrip (none = follow the latest)
  liveDismissed: new Set(), // chats where Live view was closed by hand: don't open it again by itself
  lastSeq: 0,
  suggest: { items: [], index: 0 },
};

// ---------- server calls ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'x-dea-token': KEY ?? '', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLocked(); throw new Error('Not signed in.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

async function listen() {
  let delay = 1000;
  for (;;) {
    try {
      const res = await fetch(`/api/events?since=${S.lastSeq}`, { headers: { 'x-dea-token': KEY ?? '' } });
      if (res.status === 401) return showLocked();
      if (!res.ok || !res.body) throw new Error('no stream');
      delay = 1000;
      if (S.lastSeq) await refreshAll(); // reconnected: catch up
      setOffline(false);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data) { try { dispatch(JSON.parse(data)); } catch (e) { console.error(e); } }
        }
      }
    } catch { /* server closed or restarting */ }
    setOffline(true);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 10_000);
  }
}

function dispatch(ev) {
  if (ev.seq) S.lastSeq = Math.max(S.lastSeq, ev.seq);
  const mine = S.current && ev.threadId === S.current.id;
  switch (ev.type) {
    case 'item':
      if (mine) {
        S.current.items.push(ev.item);
        if (ev.item.kind === 'assistant' || ev.item.kind === 'result') S.stream.text = '';
        renderConversation();
        if (ev.item.kind === 'result') announce(ev.item.ok ? 'Reply finished.' : 'The reply stopped early.');
      }
      break;
    case 'delta':
      if (mine) {
        if (ev.start && S.stream.text) S.stream.text += '\n\n';
        S.stream.threadId = ev.threadId;
        S.stream.text += ev.text;
        scheduleStream();
      }
      break;
    case 'status':
      if (ev.busy) S.busy.add(ev.threadId); else S.busy.delete(ev.threadId);
      if (!ev.busy && mine) S.stream.text = '';
      renderSidebar();
      if (mine) { renderConversation(); renderComposer(); renderLive(); } // Live view's Stop button follows the run
      if (!ev.busy) { // that chat's notes were just rewritten: they belong to its folder, so any chat there shows the change
        S.memory = {};
        const done = S.threads.find((x) => x.id === ev.threadId);
        if (S.panelOpen && S.current && (mine || done?.cwd === S.current.cwd)) renderPanel();
      }
      break;
    case 'thread': {
      const i = S.threads.findIndex((t) => t.id === ev.thread.id);
      if (i >= 0) S.threads[i] = { ...S.threads[i], ...ev.thread }; else S.threads.unshift(ev.thread);
      S.threads.sort((a, b) => (b.pinned - a.pinned) || b.updated.localeCompare(a.updated));
      if (mine) { Object.assign(S.current, ev.thread, ev.usage ? { usage: ev.usage } : {}); renderTopbar(); renderComposer(); }
      renderSidebar();
      break;
    }
    case 'live-call': {
      const lv = liveOf(ev.threadId);
      lv.calls.push(ev.call);
      if (lv.calls.length > 40) lv.calls.splice(0, lv.calls.length - 40);
      // Open by itself when an agent starts using an app here, on a wide screen, unless closed by hand in this chat
      // or the Agents panel is in use.
      if (mine && !S.liveOpen && !S.panelOpen && !S.liveDismissed.has(ev.threadId) && WIDE.matches) toggleLive(true);
      else if (mine) renderLive();
      break;
    }
    case 'live-result': {
      const lv = liveOf(ev.threadId);
      const i = lv.calls.findIndex((c) => c.id === ev.call.id);
      if (i >= 0) lv.calls[i] = ev.call;
      if (ev.frame) { lv.frames.push(ev.frame); if (lv.frames.length > 8) lv.frames.splice(0, lv.frames.length - 8); }
      if (mine) renderLive();
      break;
    }
    case 'thread-deleted':
      delete S.live[ev.threadId];
      delete S.memory[ev.threadId];
      S.threads = S.threads.filter((t) => t.id !== ev.threadId);
      if (mine) openStart();
      renderSidebar();
      break;
    case 'approval-request':
      S.approvals.set(ev.approvalId, ev);
      renderApprovals(); renderSidebar();
      if (mine) renderLive();
      if (mine) announce(`Approval needed. ${approvalTitle(ev)}`);
      break;
    case 'approval-resolved':
      S.approvals.delete(ev.approvalId);
      renderApprovals(); renderSidebar();
      if (mine) renderLive();
      break;
    case 'session':
      S.sessionInfo[ev.threadId] = ev.info;
      if (mine) { renderTopbar(); renderComposer(); }
      break;
    case 'apps':
      S.apps[ev.threadId] = ev.apps;
      if (mine && S.panelOpen) renderPanel();
      break;
    case 'apps-changed':
      S.apps = {};
      refreshState().then(() => { renderAll(); S.appsSheet?.render(); }).catch(() => {});
      break;
    default: break;
  }
}

let streamTimer = null;
function scheduleStream() {
  if (streamTimer) return;
  streamTimer = setTimeout(() => { streamTimer = null; renderStream(); }, 60);
}

// ---------- loading ----------
async function refreshState({ settle = true } = {}) {
  S.snap = await api('/api/state');
  for (const a of S.snap.approvals ?? []) S.approvals.set(a.approvalId, a);
  if (!S.draft.provider) { S.draft.provider = S.snap.defaults.provider; S.draft.model = S.snap.defaults.model; }
  if (settle) settleDraftModel();
}
async function refreshThreads() {
  const { threads } = await api('/api/threads');
  S.threads = threads;
  S.busy = new Set(threads.filter((t) => t.busy).map((t) => t.id));
}
async function refreshAll() {
  await Promise.all([refreshState(), refreshThreads()]);
  if (S.current) await openThread(S.current.id, { quiet: true }).catch(() => openStart());
  renderAll();
}

async function openThread(id, { quiet = false } = {}) {
  const { thread, approvals, live } = await api(`/api/threads/${id}`);
  S.current = thread;
  S.live[id] = live ?? { calls: [], frames: [] };
  for (const a of approvals) S.approvals.set(a.approvalId, a);
  if (thread.busy) S.busy.add(id); else S.busy.delete(id);
  S.stream = { threadId: id, text: '' };
  store.set('dea-open', id);
  if (!quiet) { closeSidebar(); renderAll(); scrollToEnd(); $('#composer-input').focus(); }
}
function openStart() {
  S.current = null;
  S.stream = { threadId: null, text: '' };
  store.set('dea-open', null);
  closeSidebar();
  renderAll();
  $('#composer-input').focus();
}

// ---------- rendering ----------
function renderAll() { renderSidebar(); renderTopbar(); renderConversation(); renderComposer(); renderApprovals(); renderPanel(); renderLive(); }

function providerOf(id) { return S.snap?.providers.find((p) => p.id === id); }
function modelLabel(providerId, modelId) {
  const p = providerOf(providerId);
  return p?.models.find((m) => m.id === modelId)?.label ?? modelId ?? 'Choose a model';
}
function reach(p) { return !p ? 'cloud' : !p.available ? 'off' : p.type === 'anthropic' ? 'cloud' : p.local ? 'local' : 'third'; }

function renderSidebar() {
  const list = $('#thread-list');
  list.replaceChildren();
  if (!S.threads.length) { list.append(el('p', { class: 'empty-list', text: 'Your chats appear here.' })); }
  const today = new Date().toDateString();
  let group = null;
  for (const t of S.threads) {
    const g = t.pinned ? 'Pinned' : new Date(t.updated).toDateString() === today ? 'Today' : 'Earlier';
    if (g !== group) { group = g; list.append(el('p', { class: 'thread-group', text: g })); }
    const waiting = [...S.approvals.values()].some((a) => a.threadId === t.id);
    const more = el('button', { type: 'button', class: 'icon-btn thread-more', 'aria-label': `More for ${t.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'More' }, svg(GLYPH.more, 16));
    more.addEventListener('click', (e) => { e.stopPropagation(); chatMenu(more, t); });
    list.append(el('div', { class: 'thread-row' },
      el('button', { type: 'button', class: 'thread', 'aria-current': S.current?.id === t.id ? 'page' : null, onclick: () => openThread(t.id) },
        el('span', { class: 'thread-text' }, el('span', { class: 'thread-title', text: t.title }), el('span', { class: 'thread-meta', text: `${base(t.cwd)}${t.project ? `, ${t.project}` : ''}` })),
        waiting ? el('span', { class: 'thread-busy is-waiting', title: 'Waiting for your approval' }, el('span', { class: 'sr-only', text: 'waiting for your approval' }))
          : S.busy.has(t.id) ? el('span', { class: 'thread-busy', title: 'Working' }, el('span', { class: 'sr-only', text: 'working' })) : null),
      more));
  }
  const foot = $('#sidebar-foot');
  foot.replaceChildren(el('p', { class: 'foot-label', id: 'appearance-label', text: 'Appearance' }), appearanceControl());
  if (S.snap?.errors.length) foot.append(el('p', { class: 'status-warn', text: `${S.snap.errors.length} setup problem(s): open Agents & tools` }));
}

// Appearance: Auto follows the computer; Light and Dark stay as chosen (theme.js applies it before paint).
function appearanceControl() {
  const now = window.deaTheme?.get() ?? 'auto';
  // icons, each with its name for screen readers and as a tooltip
  const options = [['auto', 'Auto', GLYPH.auto, 'Auto: follow this computer'], ['light', 'Light', GLYPH.sun, 'Light'], ['dark', 'Dark', GLYPH.moon, 'Dark']];
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'appearance-label' });
  const buttons = options.map(([value, label, glyph, tip]) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(now === value), tabindex: now === value ? '0' : '-1',
    'aria-label': label, title: tip,
    onclick: (e) => choose(value, e.currentTarget),
  }, svg(glyph, 12)));
  // The selection is one shape that slides to the chosen icon (--i), and the colours cross-fade to the new theme.
  // The control is updated in place rather than redrawn, so the slide can play.
  function choose(value, button) {
    const i = options.findIndex(([v]) => v === value);
    buttons.forEach((b, j) => { b.setAttribute('aria-checked', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
    group.style.setProperty('--i', String(i));
    button.focus();
    const apply = () => window.deaTheme?.set(value);
    if (document.startViewTransition && !REDUCED_MOTION.matches) document.startViewTransition(apply); else apply();
  }
  group.style.setProperty('--i', String(Math.max(0, options.findIndex(([v]) => v === now))));
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    buttons[(i + step + buttons.length) % buttons.length].click();
  });
  group.append(...buttons);
  return group;
}

function renderTopbar() {
  const wrap = $('#title-wrap');
  wrap.replaceChildren();
  const t = S.current;
  if (!t) { wrap.append(el('span', { class: 'thread-name', text: 'New chat' })); return; }
  const name = el('button', { type: 'button', class: 'thread-name', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Rename, pin, or delete this chat' },
    el('span', { text: t.title }), svg(GLYPH.down, 14));
  name.addEventListener('click', () => chatMenu(name, t));
  const info = S.sessionInfo[t.id];
  const where = [base(t.cwd), t.project ? `brief ${t.project}` : null, info?.brand ? `${info.brand.name} brand` : null].filter(Boolean).join(', ');
  wrap.append(name, el('span', { class: 'thread-where', title: t.cwd, text: where }));
}

// One menu for a chat, from its title or its row in the list.
function chatMenu(anchor, t) {
  if (anchor.getAttribute('aria-expanded') === 'true') return closeMenus(); // a second click closes it
  const items = [];
  const menu = el('div', { class: 'menu is-narrow', role: 'menu', 'aria-label': `Chat: ${t.title}` });
  const item = (label, glyph, onclick, cls = '') => {
    const b = el('button', { type: 'button', class: `menu-item ${cls}`, role: 'menuitem', onclick: () => { closeMenus(); onclick(); } },
      el('span', { class: 'check is-icon' }, svg(glyph, 14)), el('span', { class: 'name', text: label }));
    items.push(b);
    return b;
  };
  menu.append(
    item('Rename', GLYPH.pencil, async () => { if (S.current?.id !== t.id) await openThread(t.id); startRename(); }),
    item(t.pinned ? 'Unpin' : 'Pin to top', GLYPH.pin, () => pinThread(t)),
    el('div', { class: 'menu-sep', role: 'separator' }),
    item('Delete chat…', GLYPH.trash, () => confirmDelete(t), 'destructive'),
  );
  popover(anchor, menu, items);
}
async function pinThread(t) {
  try {
    const { thread } = await api(`/api/threads/${t.id}`, { method: 'PATCH', body: { pinned: !t.pinned } });
    if (S.current?.id === t.id) Object.assign(S.current, thread);
    announce(thread.pinned ? 'Pinned.' : 'Unpinned.');
  } catch (e) { toast(e.message); }
}
function startRename() {
  const btn = $('#title-wrap button.thread-name');
  if (btn) renameThread(btn);
}

function renameThread(btn) {
  const t = S.current;
  const input = el('input', { class: 'thread-name', value: t.title, 'aria-label': 'Chat name', maxlength: '80' });
  input.addEventListener('focus', () => input.select());
  let finished = false;
  const done = async (save) => {
    if (finished) return; // Enter or Escape, then the blur that follows: act once
    finished = true;
    if (save && input.value.trim() && input.value.trim() !== t.title) {
      try { await api(`/api/threads/${t.id}`, { method: 'PATCH', body: { title: input.value } }); } catch (e) { toast(e.message); }
    }
    renderTopbar();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  input.addEventListener('blur', () => done(true));
  btn.replaceWith(input);
  input.focus();
}

// Group a thread's items into turns: your message, then the work (as a layer tree), replies and the result.
function turnsOf(items) {
  const turns = [];
  let turn = null;
  for (const it of items) {
    if (it.kind === 'user' || !turn) { turn = { user: it.kind === 'user' ? it : null, parts: [], result: null }; turns.push(turn); if (it.kind === 'user') continue; }
    if (it.kind === 'assistant') turn.parts.push({ type: 'reply', item: it });
    else if (it.kind === 'result') turn.result = it;
    else if (it.kind === 'notice' || it.kind === 'error') turn.parts.push({ type: 'notice', item: it });
    else {
      const last = turn.parts.at(-1);
      if (last?.type === 'trace') last.items.push(it); else turn.parts.push({ type: 'trace', items: [it] });
    }
  }
  return turns;
}

function layer(kind, name, detail, cls = '') {
  return el('li', { class: `layer ${cls}` }, el('div', { class: 'layer-row' }, el('span', { class: 'layer-glyph' }, svg(GLYPH[kind] ?? GLYPH.tool)), el('span', { class: 'layer-name' }, name, detail ? el('span', { class: 'layer-detail', text: detail }) : null)));
}

function renderTrace(items, live) {
  const root = el('ul', { class: 'layers' });
  const groups = new Map();
  let steps = 0;
  const who = new Set();
  for (const it of items) {
    const parent = it.agent && groups.get(it.agent) ? groups.get(it.agent) : root;
    if (it.kind === 'delegate') {
      who.add(it.agent);
      const li = layer('agent', el('b', { text: it.agent }), it.description, 'layer-group');
      const ul = el('ul', { class: 'layers' });
      li.append(ul);
      groups.set(it.agent, ul);
      root.append(li);
    } else if (it.kind === 'tool') {
      steps++;
      parent.append(layer('tool', it.label, it.summary));
    } else if (it.kind === 'agent-text') {
      const box = el('details', { class: 'layer-report' }, el('summary', { text: `${it.agent}'s report` }), markdown(it.text));
      parent.append(el('li', { class: 'layer' }, box));
    } else if (it.kind === 'blocked') {
      steps++;
      root.append(layer('blocked', `Blocked: ${it.label}`, it.reason, 'is-blocked'));
    } else if (it.kind === 'approval') {
      root.append(layer(it.decision === 'allowed' ? 'allowed' : 'declined', `${it.decision === 'allowed' ? 'You allowed' : 'You declined'}: ${it.label}`, it.summary, `is-${it.decision}`));
    }
  }
  const label = who.size ? `Worked with ${[...who].join(', ')}` : live ? 'Working' : 'Steps';
  return el('details', { class: 'trace', ...(live ? { open: true } : {}) },
    el('summary', {}, live ? el('span', { class: 'trace-live', 'aria-hidden': 'true' }) : null, el('span', { text: label }), el('span', { class: 'trace-count', text: `${steps} step${steps === 1 ? '' : 's'}` })),
    root);
}

function resultLine(r) {
  const bits = [];
  if (!r.ok) bits.push(r.subtype === 'error_max_budget_usd' ? `Stopped: the $${r.budgetUsd} budget for this session is used up` : r.subtype === 'error_during_execution' ? 'Stopped' : `Stopped (${r.subtype})`);
  if (r.durationMs) bits.push(fmtTime(r.durationMs));
  if (r.costUsd !== null && r.costUsd !== undefined) bits.push(fmtCost(r.costUsd));
  if (r.contextTokens) bits.push(`context ${Math.round((r.contextUsed / r.contextTokens) * 100)}% full`);
  return el('p', { class: `result-line${r.ok ? '' : ' is-error'}`, text: bits.join(', ') });
}

let streamNode = null;
function renderConversation() {
  const box = $('#conversation');
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  box.replaceChildren();
  streamNode = null;
  const col = el('div', { class: 'column' });
  box.append(col);
  const t = S.current;
  $('#main').classList.toggle('is-start', !t || !t.items.length);
  if (!t || !t.items.length) { col.append(renderStart()); box.scrollTop = 0; return; }

  const busy = S.busy.has(t.id);
  const turns = turnsOf(t.items);
  turns.forEach((turn, i) => {
    const lastTurn = i === turns.length - 1;
    if (turn.user) {
      col.append(el('div', { class: 'turn-you' },
        el('span', { class: 'sr-only', text: 'You said:' }),
        el('div', { class: 'bubble' }, turn.user.task ? el('span', { class: 'task-tag', text: `task: ${turn.user.task}` }) : null, turn.user.task ? el('br') : null, turn.user.text)));
    }
    let resultShown = false;
    turn.parts.forEach((p, j) => {
      const live = busy && lastTurn && j === turn.parts.length - 1;
      if (p.type === 'reply') {
        col.append(markdown(p.item.text));
        if (!(busy && lastTurn)) {
          // one quiet row under the reply: time and cost, then Copy
          const row = el('div', { class: `reply-actions${lastTurn ? ' is-latest' : ''}` });
          if (j === turn.parts.length - 1 && turn.result) { row.append(resultLine(turn.result)); resultShown = true; }
          row.append(copyButton(() => p.item.text, 'Copy', 'Copy reply'));
          col.append(row);
        }
      }
      else if (p.type === 'trace') col.append(renderTrace(p.items, live));
      else if (p.type === 'notice') {
        const n = p.item;
        col.append(el('div', { class: `notice${n.kind === 'error' ? ' error' : n.tone === 'warn' ? ' warn' : n.tone === 'system' ? ' system' : ''}`, role: n.kind === 'error' ? 'alert' : null },
          n.kind === 'error' ? el('span', { text: n.text }) : markdown(n.text), n.hint ? el('code', { class: 'hint', text: n.hint }) : null));
      }
    });
    if (lastTurn && busy && !turn.parts.some((p) => p.type === 'trace') && !S.stream.text) col.append(renderTrace([], true));
    if (turn.result && !resultShown) col.append(resultLine(turn.result));
  });
  if (busy) { streamNode = el('div', { class: 'reply streaming', 'aria-busy': 'true' }); col.append(streamNode); renderStream(); }
  if (stick) scrollToEnd();
}

function renderStream() {
  if (!streamNode) return;
  const box = $('#conversation');
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const before = streamNode.childElementCount;
  const prevLen = Number(streamNode.dataset.len || 0);
  streamNode.innerHTML = renderMarkdown(S.stream.text); // layout-lint-ignore: escaping renderer
  streamNode.hidden = !S.stream.text; // the live layer tree already shows that work is happening
  const len = streamNode.textContent.length;
  streamNode.dataset.len = String(len);
  if (!REDUCED_MOTION.matches) revealNew(streamNode, before, len - prevLen);
  if (stick) scrollToEnd();
}
// The reply is redrawn as it streams, so only what is new animates: whole new paragraphs, lists or code blocks
// rise in; otherwise the words just added to the last block fade in ("ink"). Cheap: it walks the last block only.
function revealNew(node, before, added) {
  const blocks = node.children;
  if (blocks.length > before) {
    for (let i = before; i < blocks.length; i += 1) blocks[i].classList.add('is-new');
    return;
  }
  const last = blocks[blocks.length - 1];
  if (!last || added <= 0 || added > 600) return;
  const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (let k = texts.length - 1; k >= 0 && added > 0; k -= 1) {
    const t = texts[k];
    if (!t.data.length) continue;
    const start = Math.max(0, t.data.length - added);
    added -= t.data.length - start;
    const tail = start ? t.splitText(start) : t;
    const ink = document.createElement('span');
    ink.className = 'ink';
    tail.replaceWith(ink);
    ink.append(tail);
  }
}
function scrollToEnd() {
  const box = $('#conversation');
  // the start screen reads from the top; a chat follows its latest message
  box.scrollTop = S.current?.items?.length ? box.scrollHeight : 0;
}

// ---------- start screen: where are we working? ----------
function renderStart() {
  const d = S.current ?? S.draft;
  const snap = S.snap;
  const wrap = el('div', { class: 'start' });
  wrap.append(
    el('h1', { text: 'What should we build today?' }),
    el('p', { class: 'lead', text: 'Choose a project folder and its brief. The agents work only inside that folder, and follow the brief’s brand.' }),
  );
  if (!snap) return wrap;

  const folderRow = el('div', { class: 'setup-row' }, el('span', { class: 'label', text: 'Folder' }),
    el('div', { class: 'value' }, d.cwd ? el('code', { title: d.cwd, text: d.cwd }) : el('span', { class: 'help', text: 'None yet' }),
      el('button', { type: 'button', class: 'btn', onclick: () => chooseFolder(d.cwd) }, svg(GLYPH.folder, 16), d.cwd ? 'Change…' : 'Choose folder')));

  const brief = el('select', { id: 'brief-select', 'aria-label': 'Project brief', onchange: (e) => setSetting({ project: e.target.value || null }) },
    el('option', { value: '', text: 'No brief' }),
    snap.projects.map((p) => el('option', { value: p.slug, selected: d.project === p.slug ? 'selected' : null, text: p.brand ? `${p.slug} (${p.brand} brand)` : p.slug })));
  const briefRow = el('div', { class: 'setup-row' }, el('label', { class: 'label', for: 'brief-select', text: 'Brief' }), el('div', { class: 'value' }, brief));

  const p = providerOf(d.provider);
  const notReady = p && !p.available;
  wrap.append(el('div', { class: 'setup' }, folderRow, briefRow));
  const recent = (snap.recentFolders ?? []).filter((f) => f !== d.cwd).slice(0, 5);
  if (recent.length) {
    wrap.append(el('div', { class: 'recent' }, el('span', { class: 'recent-label', text: 'Recent' }),
      recent.map((f) => el('button', { type: 'button', class: 'chip', title: f, onclick: () => setSetting({ cwd: f }) }, svg(GLYPH.folder, 14), base(f)))));
  }
  if (notReady) wrap.append(setupHelp(p));

  if (snap.tasks.length) {
    const title = (n) => { const t = n.replace(/-/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }; // sentence-style, like the rest of the window
    wrap.append(el('div', { class: 'starters' }, el('h2', { class: 'group-title', text: 'Start with a task' }),
      snap.tasks.slice(0, 8).map((t) => el('button', { type: 'button', class: 'starter', onclick: () => insertCommand(`/${t.name} `) },
        el('span', { class: 'starter-head' }, el('span', { class: 'name', text: title(t.name) }), el('span', { class: 'cmd', text: `/${t.name}` })),
        el('span', { class: 'desc', text: t.description })))));
  }
  if (snap.errors.length) {
    wrap.append(el('div', { class: 'notice error config-problems', role: 'alert' }, el('strong', { text: 'Setup problems. Fix these, then reload:' }), el('ul', {}, snap.errors.map((e) => el('li', { text: e })))));
  }
  return wrap;
}

// What to do when the chosen model can't run yet: plain steps, then "Check again".
function setupHelp(p) {
  const code = (t) => el('code', { text: t });
  const steps = p.type === 'ollama'
    ? [
      el('li', {}, 'Open the Ollama app, or run ', code('ollama serve'), ' in a terminal.'),
      el('li', {}, 'Download a model once, for example ', code('ollama pull qwen2.5-coder:7b'), '.'),
      el('li', {}, 'Press Check again.'),
    ]
    : [
      el('li', {}, 'In the vPointer ai folder, copy ', code('.env.example'), ' to a new file named ', code('.env'), '.'),
      el('li', {}, 'Paste your key after ', code(`${p.apiKeyEnv ?? 'ANTHROPIC_API_KEY'}=`), p.type === 'anthropic' ? ' (you can create one at console.anthropic.com).' : '.'),
      el('li', {}, `Restart the window: press ${KEYS.interrupt} in the terminal, then run `, code('npm run ui'), '.'),
    ];
  const check = el('button', { type: 'button', class: 'btn', text: 'Check again' });
  check.addEventListener('click', async () => {
    check.disabled = true;
    try { await refreshState(); } catch (e) { toast(e.message); }
    renderAll();
    const now = providerOf(S.draft.provider);
    toast(now?.available ? `${now.label} is ready.` : `Still not ready: ${now?.reason ?? 'unknown reason'}`);
  });
  return el('section', { class: 'setup-help', 'aria-labelledby': 'setup-help-title' },
    el('h2', { id: 'setup-help-title', text: `Set up ${p.label} to start` }),
    el('p', { class: 'why', text: p.reason }),
    el('ol', {}, steps),
    p.type === 'anthropic' ? el('p', { class: 'alt', text: 'Prefer a free model that runs on this computer? Install Ollama from ollama.com, then pick it from the model menu in the message box.' }) : null,
    el('div', { class: 'actions' }, check));
}

// A new chat uses a model that can run: if the chosen one isn't ready but another is, switch to it.
function settleDraftModel() {
  if (!S.snap) return;
  const d = S.draft;
  let p = providerOf(d.provider);
  if (!p) { d.provider = S.snap.defaults.provider; d.model = S.snap.defaults.model; p = providerOf(d.provider); }
  if (p && !p.available) {
    const ready = S.snap.providers.find((x) => x.available && x.models.length);
    if (ready) {
      d.provider = ready.id;
      d.model = ready.id === S.snap.defaults.provider ? S.snap.defaults.model : ready.models.some((m) => m.id === ready.defaultModel) ? ready.defaultModel : ready.models[0].id;
      p = ready;
    }
  }
  if (p?.models.length && !p.models.some((m) => m.id === d.model)) d.model = p.models[0].id;
}

async function setSetting(patch) {
  if (S.current) {
    try {
      const { thread } = await api(`/api/threads/${S.current.id}`, { method: 'PATCH', body: patch });
      Object.assign(S.current, thread);
    } catch (e) { toast(e.message); }
  } else {
    Object.assign(S.draft, patch);
    if ('cwd' in patch && !S.draft.project) {
      const guess = S.snap?.projects.find((p) => base(patch.cwd).toLowerCase().includes(p.slug.split('-')[0]));
      if (guess) S.draft.project = guess.slug;
    }
    store.set('dea-last', { cwd: S.draft.cwd, project: S.draft.project, provider: S.draft.provider, model: S.draft.model, careful: S.draft.careful, apps: S.draft.apps ?? null });
  }
  renderAll();
}

// ---------- apps: the Apps window (turn on, off, test) and each chat's Apps menu ----------
// App names come from mcp.json, so a name like "constructor" must never pick up an object's built-ins: own keys only.
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const APP_NAMES = { github: 'GitHub', figma: 'Figma', playwright: 'Playwright', supabase: 'Supabase' };
const appName = (n) => own(APP_NAMES, n) ?? n.charAt(0).toUpperCase() + n.slice(1);
// Official app logos (ui/logos; sources and licences in NOTICE). Full-colour marks are images; GitHub's mark is
// one colour by GitHub's rules, so it is drawn as a mask that follows the text colour in light and dark.
// Any other app gets the first letter of its name.
const APP_LOGOS = { figma: 'color', playwright: 'color', supabase: 'color', github: 'mono' };
function appMark(name) {
  const kind = own(APP_LOGOS, name);
  if (kind === 'color') return el('img', { class: `app-logo logo-${name}`, src: `/logos/${name}.svg`, alt: '', draggable: 'false' });
  if (kind === 'mono') return el('span', { class: `app-logo is-mono logo-${name}`, 'aria-hidden': 'true' });
  return el('span', { class: 'app-logo is-letter', 'aria-hidden': 'true', text: appName(name).charAt(0) });
}
const appsOn = () => (S.snap?.appList ?? []).filter((a) => a.enabled);
// A draft's saved list may name apps that were removed since: keep only real ones (null = all apps that are on).
function draftApps() {
  const known = (S.snap?.appList ?? []).map((a) => a.name);
  return Array.isArray(S.draft.apps) ? S.draft.apps.filter((n) => known.includes(n)) : null;
}
function chatApps(d) { return Array.isArray(d.apps) ? d.apps : appsOn().map((a) => a.name); }

function appsChip(d) {
  const on = appsOn();
  if (!on.length) return null;
  const chosen = chatApps(d);
  const n = on.filter((a) => chosen.includes(a.name)).length;
  const label = n === on.length ? (on.length === 1 ? appName(on[0].name) : 'All apps') : n === 0 ? 'No apps' : `${n} of ${on.length} apps`;
  const btn = el('button', { type: 'button', class: 'chip', id: 'apps-chip', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Apps this chat can use' },
    svg(GLYPH.plug, 14), el('span', { class: 'chip-label only-wide', text: label }), el('span', { class: 'chip-label only-narrow', text: String(n) }), el('span', { class: 'sr-only', text: ` apps: ${label}` }));
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-expanded') === 'true') return closeMenus();
    openAppsMenu(btn, S.current ?? S.draft);
  });
  return btn;
}

function openAppsMenu(anchor, d) {
  const on = appsOn();
  const chosen = chatApps(d);
  const items = [];
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Apps in this chat' });
  menu.append(el('div', { class: 'menu-section' }, el('span', { text: 'Apps in this chat' })));
  for (const a of on) {
    const checked = chosen.includes(a.name);
    const note = a.state === 'on' ? (a.local ? 'On this computer' : `Connects to ${a.host ?? a.where}`) : a.reason;
    const item = el('button', { type: 'button', class: 'menu-item', role: 'menuitemcheckbox', 'aria-checked': String(checked),
      onclick: () => {
        closeMenus();
        const next = checked ? chosen.filter((x) => x !== a.name) : [...chosen, a.name];
        const all = on.every((x) => next.includes(x.name));
        setSetting({ apps: all ? null : on.map((x) => x.name).filter((x) => next.includes(x)) });
        announce(`${appName(a.name)} ${checked ? 'off' : 'on'} for this chat.`);
      } },
      el('span', { class: 'check' }, svg(GLYPH.check, 14)), appMark(a.name), el('span', {}, el('span', { class: 'name', text: appName(a.name) }), note ? el('span', { class: 'note', text: note }) : null));
    item.classList.add('has-logo');
    items.push(item);
    menu.append(item);
  }
  menu.append(el('p', { class: 'menu-note', text: 'Applies from your next message.' }));
  const manage = el('button', { type: 'button', class: 'menu-item', role: 'menuitem', onclick: () => { closeMenus(); openAppsSheet(); } }, el('span', { class: 'check' }), el('span', { class: 'name', text: 'Manage apps…' }));
  items.push(manage);
  menu.append(el('div', { class: 'menu-sep', role: 'separator' }), manage);
  popover(anchor, menu, items);
}

function openAppsSheet() {
  if (S.appsSheet) return;
  const list = el('div', { class: 'app-list' });
  const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, svg(GLYPH.declined, 16));
  const dialog = el('dialog', { class: 'sheet apps-sheet', 'aria-labelledby': 'apps-title', 'aria-describedby': 'apps-sub' },
    el('div', { class: 'sheet-head' }, el('div', {}, el('h2', { id: 'apps-title', text: 'Apps' }),
      el('p', { class: 'sheet-sub', id: 'apps-sub', text: 'Turn apps on or off and test them. To add an app, or change its address or tokens, edit mcp.json and .env.' })), close),
    el('div', { class: 'sheet-body' }, list));
  const render = () => {
    const apps = S.snap?.appList ?? [];
    list.replaceChildren(...(apps.length ? apps.map(appRow) : [el('p', { class: 'help', text: 'No apps in mcp.json yet. Add one there, or run: npm run mcp:import' })]));
  };
  S.appsSheet = { dialog, render };
  dialog.addEventListener('close', () => { S.appsSheet = null; dialog.remove(); });
  render();
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

function appStatusLine(a) {
  const test = own(S.snap?.appTests, a.name);
  const live = S.current ? own(S.apps[S.current.id], a.name) : null;
  if (!a.enabled) return { tone: '', text: 'Off' };
  if (a.state !== 'on') return { tone: 'warn', text: a.reason ?? 'Not set up.' };
  if (test?.ok) return { tone: 'ok', text: `Connected, ${test.tools.length} tools` };
  if (test && !test.ok) return { tone: 'warn', text: test.error };
  if (live?.status === 'connected') return { tone: 'ok', text: `Connected, ${live.tools} tools` };
  if (live?.status === 'failed') return { tone: 'warn', text: 'Not answering: is the app open?' };
  if (live?.status === 'needs-auth') return { tone: 'warn', text: 'Needs a browser sign-in, which vPointer ai can’t open.' };
  return { tone: '', text: 'On. Test it to see its tools.' };
}

function appRow(a) {
  const st = appStatusLine(a);
  const test = own(S.snap?.appTests, a.name);
  const sw = el('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: a.enabled ? 'checked' : null, 'aria-label': `${appName(a.name)}, on or off` });
  sw.addEventListener('change', () => toggleApp(a, sw));
  const testBtn = el('button', { type: 'button', class: 'btn', text: 'Test connection', disabled: a.enabled && a.state === 'on' ? null : 'disabled',
    title: a.enabled ? '' : 'Turn it on to test it' });
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    try {
      const r = await api(`/api/apps/${a.name}/test`, { method: 'POST' });
      S.snap.appTests = { ...(S.snap.appTests ?? {}), [a.name]: r };
      announce(r.ok ? `${appName(a.name)} connected, ${r.tools.length} tools.` : `${appName(a.name)}: ${r.error}`);
    } catch (e) { toast(e.message); }
    S.appsSheet?.render();
  });
  const policy = [
    a.allow.length ? `Runs freely: ${a.allow.join(', ')}` : null,
    'Asks first: everything else',
    a.deny.length ? `Blocked: ${a.deny.join(', ')}` : null,
  ].filter(Boolean);
  const DECISION = { 'runs freely': 'Runs freely', 'asks first': 'Asks first', blocked: 'Blocked' };
  const tools = test?.ok
    ? el('details', { class: 'app-tools' }, el('summary', { text: `Tools (${test.tools.length})` }),
      el('ul', {}, test.tools.map((t) => el('li', {}, el('code', { text: t.name }), el('span', { class: `tag ${t.decision === 'runs freely' ? 'is-ok' : t.decision === 'blocked' ? 'is-block' : 'is-warn'}`, text: DECISION[t.decision] ?? t.decision })))))
    : el('details', { class: 'app-tools' }, el('summary', { text: 'What it may do' }), el('ul', {}, policy.map((p) => el('li', { text: p }))));
  // The tip shows when it adds something: for an app that is off, or one that isn't answering.
  const help = !a.enabled || (test && !test.ok) || (a.state === 'needs-setup' && !a.missing.length) ? a.setup : null;
  return el('section', { class: `app-row${a.enabled ? ' is-on' : ''}`, 'aria-labelledby': `app-${a.name}` },
    el('span', { class: 'app-tile', 'aria-hidden': 'true' }, appMark(a.name)),
    el('div', { class: 'app-main' },
      el('h3', { id: `app-${a.name}`, text: appName(a.name) }),
      el('p', { class: 'app-desc', text: a.description }),
      el('p', { class: `app-status${st.tone ? ` is-${st.tone}` : ''}`, text: st.text }),
      el('p', { class: 'app-where', text: a.local ? `Runs on this computer: ${a.where}` : `Connects to ${a.host ?? a.where}` }),
      help ? el('p', { class: 'app-help', text: help }) : null,
      el('div', { class: 'app-actions' }, testBtn, tools)),
    el('label', { class: 'app-switch' }, sw));
}

async function toggleApp(a, sw) {
  const on = sw.checked;
  if (on && !(await confirmEnable(a))) { sw.checked = false; return; }
  sw.disabled = true;
  try {
    await api(`/api/apps/${a.name}`, { method: 'PATCH', body: { enabled: on } });
    await refreshState();
    renderAll();
    toast(on ? `${appName(a.name)} is on. Your next message can use it.` : `${appName(a.name)} is off. Chats stop using it from their next message.`);
  } catch (e) { sw.checked = !on; toast(e.message); }
  S.appsSheet?.render();
}

// Turning an app on: say plainly what it can do before it's on.
function confirmEnable(a) {
  return new Promise((resolve) => {
    let answer = false;
    const lines = [
      a.allow.length ? `Runs without asking: ${a.allow.join(', ')}.` : 'Nothing runs without asking.',
      'Everything else asks you first.',
      a.deny.length ? `Always blocked: ${a.deny.join(', ')}.` : null,
      a.local ? `Runs on this computer (${a.where}).` : `Sends requests to ${a.host ?? a.where}.`,
      a.missing.length ? `It also needs ${a.missing.join(' and ')} in .env, then a restart of the window.` : null,
    ].filter(Boolean);
    const dialog = el('dialog', { class: 'sheet is-small', 'aria-labelledby': 'enable-title' },
      el('div', { class: 'sheet-head' }, el('h2', { id: 'enable-title', text: `Turn on ${appName(a.name)}?` })),
      el('div', { class: 'sheet-body' }, el('p', { text: a.description }), el('ul', { class: 'plain-list' }, lines.map((l) => el('li', { text: l })))),
      el('div', { class: 'sheet-foot' },
        el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => dialog.close() }),
        el('button', { type: 'button', class: 'btn primary', text: 'Turn on', onclick: () => { answer = true; dialog.close(); } })));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('.sheet-foot .btn').focus();
  });
}

// ---------- model menu ----------
function modelChip(d) {
  const p = providerOf(d.provider);
  const btn = el('button', { type: 'button', class: 'chip', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: p ? `${p.label}${p.local ? ', on this computer' : `, sends data to ${p.host}`}` : '' },
    el('span', { class: `dot ${reach(p)}`, 'aria-hidden': 'true' }), el('span', { class: 'chip-label', text: modelLabel(d.provider, d.model) }), svg(['M4 6l4 4l4-4'], 12));
  btn.addEventListener('click', async () => {
    if (btn.getAttribute('aria-expanded') === 'true') return closeMenus(); // a second click closes it
    // Re-check what's available first (Ollama may have been opened since), but never wait long.
    btn.setAttribute('aria-busy', 'true');
    await Promise.race([refreshState({ settle: false }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    btn.removeAttribute('aria-busy');
    if (btn.isConnected) openModelMenu(btn, S.current ?? S.draft);
  });
  return btn;
}

function openModelMenu(anchor, d) {
  const items = [];
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Choose a model' });
  for (const p of S.snap.providers) {
    menu.append(el('div', { class: 'menu-section', role: 'presentation' }, el('span', { text: p.label }), el('span', { class: 'where', text: p.type === 'anthropic' ? 'Anthropic' : p.local ? 'on this computer' : p.host })));
    if (!p.available && p.reason) menu.append(el('p', { class: 'menu-reason', text: p.reason }));
    for (const m of p.models) {
      const checked = d.provider === p.id && d.model === m.id;
      const item = el('button', { type: 'button', class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(checked), disabled: !p.available ? 'disabled' : null, onclick: () => { closeMenus(); setSetting({ provider: p.id, model: m.id }); } },
        el('span', { class: 'check' }, svg(GLYPH.check, 14)), el('span', {}, el('span', { class: 'name', text: m.label }), m.note ? el('span', { class: 'note', text: m.note }) : null));
      items.push(item);
      menu.append(item);
    }
    if (p.type === 'ollama' && !p.models.length && p.available) menu.append(el('p', { class: 'menu-reason', text: 'No models yet. Run: ollama pull <model>' }));
  }
  const refresh = el('button', { type: 'button', class: 'menu-item', role: 'menuitem', onclick: async () => { closeMenus(); await refreshState(); renderAll(); toast('Model list refreshed.'); } }, el('span', { class: 'check' }), el('span', { class: 'name', text: 'Refresh the model list' }));
  items.push(refresh);
  menu.append(el('div', { class: 'menu-sep', role: 'separator' }), refresh);
  popover(anchor, menu, items);
}

let menuCleanup = null;
function popover(anchor, menu, items) {
  closeMenus();
  $('#menu-layer').append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  menu.style.left = `${left}px`; // layout-lint-ignore: computed popover position (left on purpose: getBoundingClientRect is physical)
  const below = r.bottom + 6 + menu.offsetHeight < innerHeight;
  if (below) menu.style.top = `${r.bottom + 6}px`; else menu.style.bottom = `${innerHeight - r.top + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const focusables = items.filter((i) => !i.disabled);
  (focusables.find((i) => i.getAttribute('aria-checked') === 'true') ?? focusables[0])?.focus();
  // Each listener only ever acts for its own menu, so a menu that closed quickly can't close the next one.
  const mine = () => menuCleanup === cleanup;
  const onKey = (e) => {
    if (!mine()) return;
    if (e.key === 'Escape') { closeMenus(); if (anchor.isConnected) anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = focusables.indexOf(document.activeElement);
      focusables[(i + (e.key === 'ArrowDown' ? 1 : -1) + focusables.length) % focusables.length]?.focus();
    }
  };
  const onDown = (e) => { if (mine() && !menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenus(); };
  // Added right away: the click that opened this menu has already had its pointerdown.
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  const cleanup = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); anchor.setAttribute('aria-expanded', 'false'); menu.remove(); };
  menuCleanup = cleanup;
}
function closeMenus() { menuCleanup?.(); menuCleanup = null; }

// ---------- folder picker ----------
async function chooseFolder(start, { keepMessage = false } = {}) {
  const dialog = el('dialog', { class: 'sheet', 'aria-labelledby': 'folder-title' });
  const body = el('div', { class: 'sheet-body' });
  const useBtn = el('button', { type: 'button', class: 'btn primary', text: 'Use this folder' });
  dialog.append(
    el('div', { class: 'sheet-head' }, el('h2', { id: 'folder-title', text: 'Choose the project folder' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, svg(GLYPH.declined, 16))),
    body,
    el('div', { class: 'sheet-foot' }, el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => dialog.close() }), useBtn),
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  let here = null;
  async function go(path) {
    try {
      here = await api(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`);
    } catch (e) { toast(e.message); if (!here) here = await api('/api/folders'); }
    const nav = [
      here.parent ? el('button', { type: 'button', class: 'chip', onclick: () => go(here.parent) }, svg(GLYPH.up, 14), 'Up one level') : null,
      here.isProject ? el('span', { class: 'tag is-ok', text: 'Looks like a project' }) : null,
    ].filter(Boolean);
    body.replaceChildren(...[
      keepMessage ? el('p', { class: 'help', text: 'Your message is kept. Choose a folder, then press Enter to send it.' }) : null,
      el('p', { class: 'crumbs', text: here.path }),
      nav.length ? el('div', { class: 'recent' }, nav) : null,
      here.canUse ? null : el('p', { class: 'help', text: 'Open the folder of the project you’ll work on. Your home folder itself can’t be used, so the agents can never write all over it.' }),
      here.dirs.length
        ? el('ul', { class: 'dir-list', 'aria-label': 'Folders' }, here.dirs.map((d) => el('li', {}, el('button', { type: 'button', onclick: () => go(`${here.path}/${d}`) }, svg(GLYPH.folder, 16), d))))
        : el('p', { class: 'help', text: 'No folders inside this one.' }),
      el('div', { class: 'field' }, el('label', { for: 'folder-path', text: 'Or paste a path' }),
        el('input', { id: 'folder-path', value: here.path, spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.target.value); } } })),
    ].filter(Boolean));
    useBtn.disabled = !here.canUse;
    useBtn.title = here.canUse ? '' : 'Choose a project folder inside your home folder, not the home folder itself.';
  }
  useBtn.addEventListener('click', async () => { dialog.close(); await setSetting({ cwd: here.path }); $('#composer-input').focus(); });
  dialog.showModal();
  await go(start);
}

// ---------- composer ----------
function renderComposer() {
  const t = S.current;
  const d = t ?? S.draft;
  const busy = t && S.busy.has(t.id);
  const bar = $('#composer-left');
  bar.replaceChildren();
  bar.append(...[modelChip(d), appsChip(d)].filter(Boolean));
  const careful = el('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: d.careful ? 'checked' : null, onchange: (e) => setSetting({ careful: e.target.checked }) });
  bar.append(el('label', { class: 'toggle', title: 'Ask before every file change, not only risky ones' }, careful, el('span', { class: 'only-wide', text: 'Ask before edits' }), el('span', { class: 'only-narrow', text: 'Ask first' })));
  // Under the box: how to use it on a new chat; what this chat has used so far once it's going.
  const bits = [];
  if (t?.usage?.costUsd) bits.push(`${fmtCost(t.usage.costUsd)} so far`);
  if (t?.usage?.contextTokens) bits.push(`context ${Math.round((t.usage.contextUsed / t.usage.contextTokens) * 100)}% full`);
  $('#composer-hint').replaceChildren(...(t?.items?.length
    ? [el('span', { class: 'meter', text: bits.length ? `This chat: ${bits.join(', ')}` : 'Type / for a task.' })]
    : [`Type / for a task. ${KEYS.enter} sends, ${KEYS.newline} adds a line`, el('span', { class: 'only-wide', text: '. Risky actions always ask you first' }), '.']));
  const send = $('#send');
  send.classList.toggle('stop', Boolean(busy));
  send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  send.title = busy ? 'Stop the agents' : 'Send';
  send.replaceChildren(busy ? svg(['M5.5 5.5h5v5h-5z'], 16) : svg(['M8 13V3M3.5 7.5L8 3l4.5 4.5'], 16));
  updateSendState();
}
function updateSendState() {
  const busy = S.current && S.busy.has(S.current.id);
  $('#send').disabled = !busy && !$('#composer-input').value.trim();
}

const BUILTIN_HINTS = [{ name: 'tasks', description: 'List your tasks' }, { name: 'mcp', description: 'Connected apps and their status' }];
function updateSuggest() {
  const input = $('#composer-input');
  const list = $('#suggest');
  const v = input.value;
  const m = v.match(/^\/([\w-]*)$/);
  if (!m || !S.snap) { list.hidden = true; input.removeAttribute('aria-activedescendant'); return; }
  const q = m[1].toLowerCase();
  S.suggest.items = [...S.snap.tasks, ...BUILTIN_HINTS].filter((t) => t.name.startsWith(q) || t.name.includes(q)).slice(0, 12);
  S.suggest.index = Math.min(S.suggest.index, Math.max(0, S.suggest.items.length - 1));
  list.replaceChildren(...S.suggest.items.map((t, i) => el('li', { id: `sg-${i}`, role: 'option', 'aria-selected': String(i === S.suggest.index), onmousedown: (e) => { e.preventDefault(); pickSuggest(i); } },
    el('span', { class: 'cmd', text: t.usage ?? `/${t.name}` }), el('span', { class: 'desc', text: t.description }))));
  list.hidden = !S.suggest.items.length;
  if (!list.hidden) input.setAttribute('aria-activedescendant', `sg-${S.suggest.index}`);
}
function pickSuggest(i) {
  const t = S.suggest.items[i];
  if (!t) return;
  insertCommand(`/${t.name} `);
}
function insertCommand(text) {
  const input = $('#composer-input');
  input.value = text;
  updateSendState();
  $('#suggest').hidden = true;
  autosize();
  input.focus();
  input.setSelectionRange(text.length, text.length);
}
function autosize() {
  const input = $('#composer-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, innerHeight * 0.4)}px`;
}

let sending = false;
async function submit({ fromKeyboard = false } = {}) {
  const input = $('#composer-input');
  const text = input.value.trim();
  if (S.current && S.busy.has(S.current.id)) {
    // Only the Stop button stops a run. Enter keeps what you typed for when the reply is done.
    if (fromKeyboard) { if (text) toast('Still working on your last message. Your text is kept: send it when the reply is done, or press Stop.'); return; }
    await api(`/api/threads/${S.current.id}/stop`, { method: 'POST' }).catch((e) => toast(e.message));
    return;
  }
  if (!text || sending) return;
  sending = true;
  try {
    if (!S.current) {
      if (!S.draft.cwd) { chooseFolder(null, { keepMessage: true }); return; }
      if (!providerOf(S.draft.provider)?.available) {
        await refreshState().catch(() => {});
        const p = providerOf(S.draft.provider);
        if (!p?.available) { renderAll(); toast(`${p?.label ?? 'The model'} isn’t set up yet. Follow the steps on this screen, then send again.`); return; }
      }
      const { thread } = await api('/api/threads', { method: 'POST', body: { cwd: S.draft.cwd, project: S.draft.project, provider: S.draft.provider, model: S.draft.model, careful: S.draft.careful, apps: draftApps() } });
      S.threads.unshift(thread);
      S.current = thread;
      store.set('dea-open', thread.id);
    }
    input.value = '';
    autosize();
    $('#suggest').hidden = true;
    S.busy.add(S.current.id);
    await api(`/api/threads/${S.current.id}/messages`, { method: 'POST', body: { text } });
  } catch (e) {
    if (S.current) S.busy.delete(S.current.id);
    if (!input.value) input.value = text;
    toast(e.message);
  } finally {
    sending = false;
  }
  renderAll();
}

// ---------- approvals ----------
// "use figma → use_figma" adds nothing to the label, so it becomes "Allow figma → use_figma?"
function approvalTitle(a) {
  const reason = String(a.reason ?? '').replace(/\.$/, '');
  return !reason || reason.toLowerCase() === `use ${a.label}`.toLowerCase() ? `Allow ${a.label}?` : `Allow ${a.label} to ${reason}?`;
}
function renderApprovals() {
  const box = $('#approvals');
  box.replaceChildren();
  if (!S.current) return;
  for (const a of S.approvals.values()) {
    if (a.threadId !== S.current.id) continue;
    const answer = async (allow) => {
      try { await api(`/api/approvals/${encodeURIComponent(a.approvalId)}`, { method: 'POST', body: { allow } }); } catch (e) { toast(e.message); }
      S.approvals.delete(a.approvalId);
      renderApprovals();
    };
    box.append(el('section', { class: 'approval', 'aria-label': `Approval for ${a.label}` },
      el('span', { class: 'approval-icon', 'aria-hidden': 'true' }, svg(GLYPH.shield, 16)),
      el('h3', { text: approvalTitle(a) }),
      el('pre', { text: a.summary }),
      el('div', { class: 'approval-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Don’t allow', onclick: () => answer(false) }),
        el('button', { type: 'button', class: 'btn primary', text: 'Allow once', onclick: () => answer(true) }))));
  }
}

// ---------- Agents & tools panel ----------
async function renderPanel() {
  const panel = $('#panel');
  const app = $('#app');
  const toggle = $('[data-action="toggle-panel"]');
  panel.hidden = !S.panelOpen && !panel.classList.contains('is-closing'); // a redraw mid-slide lets the slide finish
  if (S.panelOpen) panel.classList.remove('is-closing');
  app.classList.toggle('has-panel', S.panelOpen || S.liveOpen);
  toggle.setAttribute('aria-expanded', String(S.panelOpen));
  if (!S.panelOpen || !S.snap) return;
  const s = S.snap;
  const appStatus = S.current ? S.apps[S.current.id] : null;
  panel.replaceChildren(...[
    el('div', { class: 'panel-head' }, el('div', {}, el('h2', { text: 'Agents & tools' }), el('p', { class: 'panel-sub', text: `${s.specialists.length} specialists, ${s.tasks.length} tasks, ${s.standards.length} standards` })),
      el('button', { type: 'button', class: 'icon-btn close-panel', 'aria-label': 'Close panel', onclick: togglePanel }, svg(GLYPH.declined, 16))),
    s.errors.length ? el('div', { class: 'notice error', role: 'alert' }, el('strong', { text: 'Setup problems' }), el('ul', {}, s.errors.map((e) => el('li', { text: e })))) : null,
    s.warnings.length ? el('div', { class: 'notice warn' }, el('ul', {}, s.warnings.map((w) => el('li', { text: w })))) : null,
    el('h3', { text: 'Specialists' }),
    el('ul', {}, s.specialists.map((a) => el('li', {}, el('span', { class: 'name', text: a.name }), el('span', { class: 'desc', text: a.description }),
      a.standards.length ? el('span', { class: 'tags' }, a.standards.map((st) => el('span', { class: 'tag', text: st }))) : null))),
    Object.keys(s.waiting).length ? el('p', { class: 'desc', text: `Waiting for an app: ${Object.entries(s.waiting).map(([n, a]) => `${n} (${a.join(', ')})`).join('; ')}` }) : null,
    el('h3', { text: 'Tasks' }),
    el('ul', {}, s.tasks.map((t) => el('li', {}, el('button', { type: 'button', class: 'task', onclick: () => { insertCommand(`/${t.name} `); if (!WIDE.matches) togglePanel(); } }, el('span', { class: 'name', text: `/${t.name}` }), el('span', { class: 'desc', text: t.description }))))),
    el('div', { class: 'panel-section-head' }, el('h3', { text: 'Apps' }), el('button', { type: 'button', class: 'btn', text: 'Manage apps', onclick: () => openAppsSheet() })),
    s.apps.length || Object.keys(s.skippedApps).length
      ? el('ul', {}, s.apps.map((a) => {
        const st = own(appStatus, a.name);
        const state = { connected: `connected, ${st?.tools} tools`, 'needs-auth': 'needs a browser sign-in, which vPointer ai can’t open (see the README)', failed: 'not answering: is the app open?', pending: 'connecting…', disabled: 'off' }[st?.status] ?? st?.status;
        return el('li', {}, el('span', { class: 'app-line' }, appMark(a.name), el('span', { class: 'name', text: a.name })), ' ', st ? el('span', { class: st.status === 'connected' ? 'status-ok' : 'status-warn', text: state, title: st.error ?? '' }) : el('span', { class: 'desc', text: 'connects when a chat starts' }),
          el('span', { class: 'desc', text: `Runs freely: ${a.allow.join(', ') || 'nothing'}. Blocked: ${a.deny.join(', ') || 'nothing'}. Everything else asks.` }));
      }), Object.entries(s.skippedApps).map(([n, why]) => el('li', {}, el('span', { class: 'app-line' }, appMark(n), el('span', { class: 'name', text: n })), el('span', { class: 'desc', text: `Off: ${why}` }))))
      : el('p', { class: 'desc', text: 'No apps yet. Add one in mcp.json, or run: npm run mcp:import' }),
    ...memorySection(),
    el('h3', { text: 'Standards' }),
    el('ul', {}, s.standards.map((st) => el('li', {}, el('span', { class: 'name', text: st.name }), st.brand ? el('span', { class: 'tag', text: `${st.brand} only` }) : null, el('span', { class: 'desc', text: st.description })))),
    el('h3', { text: 'Brands' }),
    el('ul', {}, s.brands.map((b) => el('li', {}, el('span', { class: 'name', text: b.slug }), el('span', { class: 'desc', text: `${b.name}, tokens v${b.version}` })))),
  ].filter(Boolean)); // replaceChildren would print "null" for an empty slot
  if (S.current && !appStatus && S.sessionInfo[S.current.id]) {
    api(`/api/threads/${S.current.id}/apps`).then(({ apps }) => { if (apps) { S.apps[S.current.id] = apps; renderPanel(); } }).catch(() => {});
  }
  if (S.current && !Object.hasOwn(S.memory, S.current.id)) {
    const id = S.current.id;
    S.memory[id] = null; // asked once until the next reply
    api(`/api/threads/${id}/memory`).then(({ memory }) => { S.memory[id] = memory; if (S.current?.id === id && S.panelOpen) renderPanel(); }).catch(() => { delete S.memory[id]; });
  }
}

// ---------- memory: notes new chats in this folder start with ----------
function memorySection() {
  const m = S.current ? S.memory[S.current.id] : null;
  if (!m) return [];
  const lines = !m.on
    ? 'Memory is off (DEA_MEMORY=off in .env), so new chats in this folder start without notes from earlier ones.'
    : m.chats
      ? `New chats in this folder start with short notes from ${m.chats === 1 ? '1 chat' : `${m.chats} chats`}: what was asked, which files changed, your decisions and how each ended. They stay on this computer.`
      : 'After each reply, short notes about this chat are kept so new chats in this folder can pick up where you left off. Nothing is noted yet.';
  return [
    el('div', { class: 'panel-section-head' }, el('h3', { text: 'Memory' }),
      m.on && m.chats ? el('button', { type: 'button', class: 'btn', text: 'View notes', onclick: () => openMemorySheet(S.current) }) : null),
    el('p', { class: 'desc', text: lines }),
  ];
}
function openMemorySheet(t) {
  const m = S.memory[t.id];
  if (!m) return;
  const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, svg(GLYPH.declined, 16));
  const forget = el('button', { type: 'button', class: 'btn destructive', text: 'Forget these notes', onclick: async () => {
    forget.disabled = true;
    try {
      const { memory } = await api(`/api/threads/${t.id}/memory`, { method: 'DELETE' });
      S.memory[t.id] = memory;
      dialog.close();
      announce('Notes forgotten. New chats in this folder start fresh.');
      renderPanel();
    } catch (e) { forget.disabled = false; toast(e.message); }
  } });
  const dialog = el('dialog', { class: 'sheet memory-sheet', 'aria-labelledby': 'memory-title', 'aria-describedby': 'memory-sub' },
    el('div', { class: 'sheet-head' }, el('div', {}, el('h2', { id: 'memory-title', text: 'Notes for new chats' }),
      el('p', { class: 'sheet-sub', id: 'memory-sub', text: `New chats in ${base(t.cwd)} start with these. They’re rewritten after each reply and kept only on this computer, in ${m.file}. Edit that file to change them.` })), close),
    el('div', { class: 'sheet-body' }, markdown(m.notes, 'reply memory-notes')),
    el('div', { class: 'sheet-foot' }, el('button', { type: 'button', class: 'btn', text: 'Done', onclick: () => dialog.close() }), forget));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  dialog.querySelector('.sheet-foot .btn').focus(); // Done first: forgetting takes a deliberate click
}
// The right-hand column holds one window at a time: Agents & tools, or Live view.
// Wide screens: opening adds the column and the window slides in its full width while the main area glides over
// (the top bar's buttons ride its edge); closing removes the column at once and the window slides off the same way.
// Swapping one window for the other keeps the column, so the newcomer just settles in. Phones: a sheet that rises
// and sinks (CSS).
const RIGHT = { panel: () => $('#panel'), live: () => $('#live') };
function renderRight() { renderPanel(); renderLive(); }
function setRight(next) { // 'panel' | 'live' | null
  const was = S.panelOpen ? 'panel' : S.liveOpen ? 'live' : null;
  if (next === was) return;
  S.panelOpen = next === 'panel';
  S.liveOpen = next === 'live';
  store.set('dea-panel', S.panelOpen);
  store.set('dea-live', S.liveOpen);
  if (was && next) { renderRight(); if (WIDE.matches) settleIn(RIGHT[next]()); return; }
  if (next) {
    if (!WIDE.matches) { renderRight(); return; }
    reflow(renderRight);
    slideWindow(RIGHT[next](), true);
    return;
  }
  closeWindow(RIGHT[was](), $(`[data-action="toggle-${was}"]`), was === 'panel' ? renderPanel : renderLive);
}
// `render` redraws the window once it's gone (it hides it, as its state is now closed). A slide that's turned
// around mid-way never gets here: opening again cancels it.
function closeWindow(node, toggle, render) {
  if (node.hidden || REDUCED_MOTION.matches) { node.classList.remove('is-closing'); render(); return; }
  toggle.setAttribute('aria-expanded', 'false');
  if (WIDE.matches) {
    reflow(() => { node.classList.add('is-closing'); $('#app').classList.toggle('has-panel', S.panelOpen || S.liveOpen); });
    const a = slideWindow(node, false);
    // done: remove the window, then drop the slide's hold on its position
    a.onfinish = () => { node.classList.remove('is-closing'); render(); a.cancel(); };
    return;
  }
  node.classList.add('is-closing');
  // Only the sheet's own animation counts: a child's animation (a new image fading in) also reports "animationend".
  const onEnd = (e) => { if (e.target === node) done(); };
  const done = () => { clearTimeout(timer); node.removeEventListener('animationend', onEnd); node.classList.remove('is-closing'); render(); };
  const timer = setTimeout(done, 400); // in case the animation never reports its end
  node.addEventListener('animationend', onEnd);
}
function togglePanel() { setRight(S.panelOpen ? null : 'panel'); }
function toggleLive(open = !S.liveOpen) {
  if (open) { setRight('live'); return; }
  if (!S.liveOpen) return;
  if (S.current) S.liveDismissed.add(S.current.id); // closed by hand: don't open again by itself in this chat
  setRight(null);
}

// ---------- Live view: what agents see and do in your apps ----------
const liveOf = (id) => (S.live[id] ??= { calls: [], frames: [] });
const liveRowsSeen = new Set(); // rows already shown once: only new ones rise in
const frameImgs = new Map();    // frame id → <img>, so a redraw never re-decodes an image
const frameShown = new Set();   // frames already shown large: only a new one fades in
const clockOf = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function frameImg(f, alt) {
  let img = frameImgs.get(f.id);
  if (!img) {
    // The server only lets PNG, JPEG, WebP and GIF through (never SVG), as base64; checked again here.
    const safe = /^image\/(png|jpeg|webp|gif)$/.test(f.mediaType) && /^[A-Za-z0-9+/]+={0,2}$/.test(f.data);
    img = el('img', { src: safe ? `data:${f.mediaType};base64,${f.data}` : '', alt, decoding: 'async', draggable: 'false' });
    frameImgs.set(f.id, img);
  }
  return img;
}
function liveSummary(lv, busy) {
  const now = [...lv.calls].reverse().find((c) => c.state === 'running');
  if (now) return `${appName(now.app)}: ${now.label.toLowerCase()}${now.agent ? `, by ${now.agent}` : ''}`;
  const last = lv.calls.at(-1);
  if (last) return `Last action at ${clockOf(last.at)}`;
  return busy ? 'Waiting for an agent to use an app' : 'Nothing yet in this chat';
}
function renderLive() {
  const box = $('#live');
  const toggle = $('[data-action="toggle-live"]');
  const lv = S.current ? liveOf(S.current.id) : { calls: [], frames: [] };
  toggle.classList.toggle('is-live', lv.calls.some((c) => c.state === 'running'));
  box.hidden = !S.liveOpen && !box.classList.contains('is-closing'); // a redraw mid-slide lets the slide finish
  if (S.liveOpen) box.classList.remove('is-closing');
  $('#app').classList.toggle('has-panel', S.panelOpen || S.liveOpen);
  toggle.setAttribute('aria-expanded', String(S.liveOpen));
  if (!S.liveOpen) return;
  const busy = S.current && S.busy.has(S.current.id);
  const pending = [...S.approvals.values()].filter((a) => S.current && a.threadId === S.current.id);
  // which frame is large: the one picked in the filmstrip, or the latest
  const picked = S.current ? S.liveFrame[S.current.id] : null;
  const frame = lv.frames.find((f) => f.id === picked) ?? lv.frames.at(-1) ?? null;
  // drop cached images that left the buffer
  for (const id of frameImgs.keys()) if (!Object.values(S.live).some((v) => v.frames.some((f) => f.id === id))) frameImgs.delete(id);

  const head = el('div', { class: 'panel-head' },
    el('div', {}, el('h2', { text: 'Live view' }), el('p', { class: 'panel-sub', text: S.current ? liveSummary(lv, busy) : 'Open a chat to see its apps at work' })),
    el('div', { class: 'live-head-actions' },
      busy ? el('button', { type: 'button', class: 'btn', text: 'Stop', onclick: () => api(`/api/threads/${S.current.id}/stop`, { method: 'POST' }).catch((e) => toast(e.message)) }) : null,
      el('button', { type: 'button', class: 'icon-btn close-panel', 'aria-label': 'Close Live view', onclick: () => toggleLive(false) }, svg(GLYPH.declined, 16))));
  if (!lv.calls.length) {
    box.replaceChildren(head, el('p', { class: 'live-empty', text: 'When an agent uses one of your apps, such as Figma or a browser, what it sees and does shows up here: each action as it happens, and the images it gets back.' }));
    return;
  }
  const parts = [head];
  if (frame) {
    const alt = `What ${frame.agent ?? 'the agent'} saw: ${frame.label} in ${appName(frame.app)}, ${clockOf(frame.at)}`;
    const img = frameImg(frame, alt);
    const big = img.cloneNode(); // the filmstrip keeps the cached one; the large view gets its own copy
    if (!frameShown.has(frame.id)) { big.classList.add('is-new'); frameShown.add(frame.id); }
    parts.push(el('figure', { class: 'live-frame' },
      el('button', { type: 'button', 'aria-label': `Enlarge: ${alt}`, onclick: () => zoomFrame(frame, alt) }, big),
      el('figcaption', {}, appMark(frame.app), el('span', { text: `${frame.label}, ${clockOf(frame.at)}` }))));
    if (lv.frames.length > 1) {
      parts.push(el('div', { class: 'live-strip', role: 'group', 'aria-label': 'Earlier images' }, lv.frames.map((f) => el('button', {
        type: 'button', 'aria-pressed': String(f.id === frame.id), 'aria-label': `${f.label}, ${clockOf(f.at)}`, title: `${f.label}, ${clockOf(f.at)}`,
        onclick: () => { S.liveFrame[S.current.id] = f.id === lv.frames.at(-1).id ? null : f.id; renderLive(); },
      }, frameImg(f, '').cloneNode()))));
    }
  }
  parts.push(el('h3', { text: 'Actions' }));
  parts.push(el('ul', { class: 'live-list' }, [...lv.calls].reverse().map((c) => {
    const waiting = c.state === 'running' && pending.some((a) => a.name === c.name);
    const isNew = !liveRowsSeen.has(c.id);
    liveRowsSeen.add(c.id);
    const icon = c.state === 'done' ? svg(GLYPH.check, 14) : c.state === 'failed' ? svg(GLYPH.declined, 14)
      : c.state === 'cancelled' ? svg(GLYPH.more, 14) : waiting ? svg(GLYPH.shield, 14) : el('span', { class: 'dot', 'aria-hidden': 'true' });
    const note = waiting ? 'Waiting for you: answer below the chat'
      : c.state === 'failed' ? `Didn’t work${c.text ? `: ${c.text}` : ''}` : c.state === 'cancelled' ? 'Stopped before the app answered'
      : c.decision === 'asks' ? 'Asks first' : c.decision === 'blocked' ? 'Blocked' : null;
    return el('li', { class: [waiting ? 'is-waiting' : '', isNew ? 'is-new' : ''].filter(Boolean).join(' ') || null },
      el('span', { class: `live-state is-${c.state}`, role: 'img', 'aria-label': waiting ? 'Waiting for you' : { running: 'Working', done: 'Done', failed: 'Didn’t work', cancelled: 'Stopped' }[c.state] ?? c.state }, icon),
      el('span', {}, el('span', { class: 'what' }, `${appName(c.app)}: ${c.label}`), c.detail && c.detail !== '{}' ? el('span', { class: 'detail', text: c.detail, title: c.detail }) : null,
        note ? el('span', { class: 'note', text: note }) : null),
      el('span', { class: 'meta', text: [c.agent, c.ms != null ? `${c.ms < 1000 ? `${c.ms} ms` : `${(c.ms / 1000).toFixed(1)} s`}` : null].filter(Boolean).join(', ') }));
  })));
  box.replaceChildren(...parts);
}
function zoomFrame(frame, alt) {
  const dialog = el('dialog', { class: 'sheet live-zoom', 'aria-label': alt },
    el('div', { class: 'sheet-head' }, el('h2', { text: `${appName(frame.app)}: ${frame.label}` }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, svg(GLYPH.declined, 16))),
    el('div', { class: 'sheet-body' }, frameImg(frame, alt).cloneNode(), el('p', { class: 'panel-sub', text: `${frame.agent ? `${frame.agent}, ` : ''}${clockOf(frame.at)}` })));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// ---------- dialogs, toasts, offline ----------
function confirmDelete(t) {
  const dialog = el('dialog', { class: 'sheet is-small', 'aria-labelledby': 'del-title' },
    el('div', { class: 'sheet-head' }, el('h2', { id: 'del-title', text: 'Delete this chat?' })),
    el('div', { class: 'sheet-body' }, el('p', { text: `"${t.title}" will be removed from your chats, with its notes for new chats. Your project files aren’t touched, and the session log in logs/ stays.` })),
    el('div', { class: 'sheet-foot' },
      el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => dialog.close() }),
      el('button', { type: 'button', class: 'btn destructive', text: 'Delete chat', onclick: async () => { dialog.close(); try { await api(`/api/threads/${t.id}`, { method: 'DELETE' }); announce('Chat deleted.'); } catch (e) { toast(e.message); } } })));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  dialog.querySelector('.sheet-foot .btn').focus(); // Cancel first: deleting takes a deliberate click
}

let toastTimer = null;
function toast(text) {
  let node = $('#toast');
  if (!node) { node = el('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(node); }
  node.textContent = text;
  node.hidden = false;
  node.style.animation = 'none'; void node.offsetWidth; node.style.animation = ''; // replay the entrance for a new message
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 5000);
}
function announce(text) { $('#announcer').textContent = text; }
function setOffline(off) {
  const was = document.body.classList.contains('offline');
  document.body.classList.toggle('offline', off);
  if (off && !was) toast('Lost the connection to the agent. Is the terminal window with "npm run ui" still open? Reconnecting…');
  if (!off && was) toast('Connected again.');
}

function showLocked() {
  document.body.replaceChildren(el('main', { class: 'locked' }, el('div', {},
    el('h1', { text: 'Open the agent from its link' }),
    el('p', { text: 'For your safety this page only works with the private link printed in the terminal when the agent starts. Run this in the vPointer ai folder, then open the link it prints:' }),
    el('code', { text: 'npm run ui' }))));
}

// ---------- sidebar (mobile) ----------
function openSidebar() {
  $('#app').dataset.sidebar = 'open';
  $('.scrim').hidden = false;
  $('[data-action="open-sidebar"]').setAttribute('aria-expanded', 'true');
  $('#sidebar .new-chat').focus();
}
function closeSidebar() {
  $('#app').dataset.sidebar = 'closed';
  $('.scrim').hidden = true;
  $('[data-action="open-sidebar"]')?.setAttribute('aria-expanded', 'false');
}

// ---------- sidebar (docked): hide and show ----------
// The button sits at the start of the top bar, so it rides the sidebar's edge as it slides, and ends at the window's
// edge when the sidebar is hidden. Remembered in this browser (theme.js restores it before the first paint).
const sideHidden = () => document.documentElement.dataset.side === 'hidden';
function syncSideToggle() {
  const t = $('[data-action="toggle-sidebar"]');
  const hidden = sideHidden();
  t.setAttribute('aria-expanded', String(!hidden));
  t.title = `${hidden ? 'Show' : 'Hide'} sidebar (${KEYS.sidebar})`;
}
function toggleSidebar() {
  const side = $('#sidebar');
  if (!side) return; // the sign-in screen
  if (!DOCKED.matches) { if ($('#app').dataset.sidebar === 'open') closeSidebar(); else openSidebar(); return; } // a drawer here
  const hide = !sideHidden();
  store.set('dea-side-hidden', hide);
  const flip = () => { if (hide) document.documentElement.dataset.side = 'hidden'; else delete document.documentElement.dataset.side; };
  if (hide) {
    if (side.contains(document.activeElement)) $('[data-action="toggle-sidebar"]').focus(); // keep focus somewhere visible
    side.inert = true;
    reflow(() => { side.classList.add('is-leaving'); flip(); });
    const a = slideWindow(side, false);
    const done = () => { side.classList.remove('is-leaving'); side.inert = false; a?.cancel(); };
    if (a) a.onfinish = done; else done();
  } else {
    side.inert = false;
    reflow(() => { side.classList.remove('is-leaving'); flip(); });
    slideWindow(side, true);
  }
  syncSideToggle();
}
syncSideToggle();

// ---------- wiring ----------
document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'new-chat') openStart();
  else if (action === 'open-apps') { closeSidebar(); openAppsSheet(); }
  else if (action === 'open-sidebar') openSidebar();
  else if (action === 'close-sidebar') closeSidebar();
  else if (action === 'toggle-panel') togglePanel();
  else if (action === 'toggle-live') toggleLive();
  else if (action === 'toggle-sidebar') toggleSidebar();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#app').dataset.sidebar === 'open') closeSidebar();
  // Show/Hide sidebar: Control-Command-S on a Mac, Ctrl+Alt+S elsewhere (never AltGr+S, which types a letter)
  const combo = MAC ? e.ctrlKey && e.metaKey && !e.altKey : e.ctrlKey && e.altKey && !e.metaKey && !e.getModifierState?.('AltGraph');
  if (combo && !e.shiftKey && (MAC ? e.key.toLowerCase() === 's' : e.code === 'KeyS') && !e.repeat) { e.preventDefault(); toggleSidebar(); }
});
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
// The message box floats over the conversation as glass. Its height (it grows with the text and with
// approval cards) becomes --composer-h, the conversation's bottom padding, so the last message stays clear of it.
// A chat that was following its latest message keeps following it when the box grows.
new ResizeObserver(() => {
  const box = $('#conversation');
  const h = Math.ceil($('#composer').getBoundingClientRect().height);
  if ($('#main').style.getPropertyValue('--composer-h') === `${h}px`) return;
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  $('#main').style.setProperty('--composer-h', `${h}px`);
  if (stick && S.current?.items?.length) scrollToEnd();
}).observe($('#composer'));
$('#conversation').addEventListener('scroll', (e) => {
  $('#main').classList.toggle('is-scrolled', e.target.scrollTop > 4);
  $('#main').classList.toggle('is-past-title', e.target.scrollTop > 72); // the start screen's large title has scrolled away
}, { passive: true });
// "/" anywhere (outside a text field) jumps to the message box, ready for a task
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
  e.preventDefault();
  insertCommand('/');
  updateSuggest();
});
const input = $('#composer-input');
input.addEventListener('input', () => { autosize(); S.suggest.index = 0; updateSuggest(); updateSendState(); });
input.addEventListener('keydown', (e) => {
  const open = !$('#suggest').hidden;
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    S.suggest.index = (S.suggest.index + (e.key === 'ArrowDown' ? 1 : -1) + S.suggest.items.length) % S.suggest.items.length;
    updateSuggest();
  } else if (open && (e.key === 'Tab' || e.key === 'Enter')) {
    e.preventDefault(); pickSuggest(S.suggest.index);
  } else if (open && e.key === 'Escape') {
    $('#suggest').hidden = true;
  } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault(); submit({ fromKeyboard: true });
  }
});

async function boot() {
  if (!KEY) return showLocked();
  try {
    await Promise.all([refreshState(), refreshThreads()]);
  } catch (e) {
    if (e.message !== 'Not signed in.') toast(e.message);
    return;
  }
  const last = store.get('dea-open');
  if (last && S.threads.some((t) => t.id === last)) await openThread(last, { quiet: true });
  renderAll();
  scrollToEnd();
  input.focus();
  listen();
}
boot();
