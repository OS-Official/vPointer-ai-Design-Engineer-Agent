/**
 * Live view memory: for each chat, the latest app actions and the images agents got back from apps.
 *
 * In memory only, never written to disk. Small on purpose: the last 40 actions and 8 images per chat, for the
 * 6 chats used most recently, so a long day of screenshots can't fill memory. A page that reloads asks for it again.
 */
export function createLiveStore({ calls = 40, frames = 8, chats = 6 } = {}) {
  const byChat = new Map(); // insertion order: least recently used first

  function touch(threadId, create) {
    let v = byChat.get(threadId);
    if (v) { byChat.delete(threadId); byChat.set(threadId, v); return v; }
    if (!create) return null;
    v = { calls: [], frames: [] };
    byChat.set(threadId, v);
    while (byChat.size > chats) byChat.delete(byChat.keys().next().value);
    return v;
  }

  return {
    /** An agent called an app's tool. */
    call(threadId, c) {
      const v = touch(threadId, true);
      const entry = { id: c.id, name: c.name, app: c.app, tool: c.tool, label: c.label, detail: c.detail ?? '', agent: c.agent ?? null, decision: c.decision, at: c.at ?? Date.now(), state: 'running' };
      v.calls.push(entry);
      if (v.calls.length > calls) v.calls.splice(0, v.calls.length - calls);
      return { ...entry };
    },
    /** The app answered (or the run ended first). Returns the updated action and the new image, if any. */
    result(threadId, r) {
      const v = touch(threadId, false);
      const c = v?.calls.find((x) => x.id === r.id);
      if (!c) return null;
      Object.assign(c, { state: r.cancelled ? 'cancelled' : r.ok ? 'done' : 'failed', ms: r.ms ?? null, text: r.text ?? '' });
      let frame = null;
      if (r.image) {
        frame = { id: `f_${r.id}`, callId: r.id, app: c.app, tool: c.tool, label: c.label, agent: c.agent, at: Date.now(), mediaType: r.image.mediaType, data: r.image.data };
        v.frames.push(frame);
        if (v.frames.length > frames) v.frames.splice(0, v.frames.length - frames);
        c.frameId = frame.id;
      }
      return { call: { ...c }, frame };
    },
    snapshot(threadId) {
      const v = byChat.get(threadId);
      return { calls: v ? v.calls.map((c) => ({ ...c })) : [], frames: v ? v.frames.slice() : [] };
    },
    forget(threadId) { byChat.delete(threadId); },
  };
}
