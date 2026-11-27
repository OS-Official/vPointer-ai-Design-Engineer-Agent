/**
 * Live view: what agents see and do in connected apps (Figma, a browser, GitHub…), as events for the window.
 *
 * For every call to an app's tool the engine reports the action (app-call) and, when the app answers, the outcome
 * (app-result) with the first image the agent got back, if any. Only apps from mcp.json count; vPointer ai's own
 * checking tools ("design") are not app activity.
 *
 * Images come from an outside program, so they are checked before they reach the window: a known raster type only
 * (no SVG, which can carry script), real base64, and a size cap. They are kept in memory, never written to disk.
 */
import { matchesAny, splitToolName } from '../mcp/config.js';

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_IMAGE_B64 = 2_000_000; // about 1.5 MB of image
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TEXT_LIMIT = 240;

/** { app, tool } for a connected app's tool, else null (vPointer ai's own tools and built-ins are not apps). */
export function appOf(toolName) {
  const t = splitToolName(toolName);
  return t && t.server !== 'design' ? { app: t.server, tool: t.tool } : null;
}

/** How the guard treats this tool: 'blocked' (deny list), 'free' (allow list) or 'asks' (everything else). */
export function decisionFor(policy, app, tool) {
  const p = policy && Object.hasOwn(policy, app) ? policy[app] : null;
  if (p && matchesAny(tool, p.deny)) return 'blocked';
  if (p && matchesAny(tool, p.allow)) return 'free';
  return 'asks';
}

/** A tool name in words: "get_screenshot" → "Get screenshot", "browser_take_screenshot" → "Browser take screenshot". */
export function actionLabel(tool) {
  const words = String(tool).replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Action';
}

// The input fields that say what an app action is about, in the order they are most telling.
const DETAIL_FIELDS = [['url', ''], ['nodeId', 'node '], ['node_id', 'node '], ['element', ''], ['selector', ''], ['query', ''], ['name', ''], ['path', ''], ['text', ''], ['code', '']];
/** What an app action is about, in a few words: "node 1:2", "https://…", the code it runs. Never the raw JSON. */
export function actionDetail(input) {
  if (!input || typeof input !== 'object') return '';
  for (const [key, prefix] of DETAIL_FIELDS) {
    if (typeof input[key] === 'string' && input[key].trim()) return `${prefix}${input[key].replace(/\s+/g, ' ').trim()}`.slice(0, 160);
  }
  return Object.entries(input).filter(([k, v]) => k !== 'fileKey' && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`).join(', ').slice(0, 160);
}

/** The useful part of a tool's answer: whether it worked, a short text, and the first safe image. */
export function parseToolResult(block) {
  const items = typeof block?.content === 'string' ? [{ type: 'text', text: block.content }] : Array.isArray(block?.content) ? block.content : [];
  let image = null;
  let skipped = null;
  for (const it of items) {
    if (it?.type !== 'image' || image) continue;
    const src = it.source ?? {};
    const mediaType = String(src.media_type ?? '').toLowerCase();
    const data = typeof src.data === 'string' ? src.data : '';
    if (src.type !== 'base64' || !IMAGE_TYPES.has(mediaType)) { skipped = 'type'; continue; }
    if (data.length > MAX_IMAGE_B64) { skipped = 'size'; continue; }
    if (!data || !BASE64.test(data)) { skipped = 'data'; continue; }
    image = { mediaType, data };
  }
  const text = items.filter((it) => it?.type === 'text' && typeof it.text === 'string').map((it) => it.text).join(' ')
    .replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);
  return { ok: !block?.is_error, text, image, ...(skipped && !image ? { imageSkipped: skipped } : {}) };
}
