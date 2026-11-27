# The window (`npm run ui`): system design

## What it is for
A desktop-style window for the same agents the terminal runs. Chat threads stay in a sidebar, replies stream in, each reply shows its work as a layer tree, risky actions ask with Allow / Deny buttons, and every chat can use a different model: Claude, a local Ollama model, or any Anthropic-compatible API.

## Requirements
| Kind | Requirement |
| --- | --- |
| Functional | Chat with the lead and its specialists. Pick a folder, brief and model per chat. Switch models mid-chat. Approve or deny risky actions. Run `/tasks`. Keep chats between restarts |
| Safety | Same guard and approvals as the terminal. Reachable only from this computer, and only with your key. API keys never reach the page. Warn when data leaves the machine |
| Non-functional | One person, one computer. No new dependencies, no build step, starts in under a second, works offline with Ollama |
| Constraints | Node ≥ 20.12, the Claude Agent SDK, vanilla JS so the code stays readable while you learn |

## Architecture
```
Browser  http://127.0.0.1:4317 (key in the link)
  │  GET  /, /app.js, /styles.css, /markdown.js          static files, strict CSP
  │  GET  /api/events          server-sent events (fetch stream, key in header)
  │  REST /api/state, /api/threads…, /api/approvals/:id
  │  REST /api/apps (GET), /api/apps/:name (PATCH {enabled}), /api/apps/:name/test (POST)
  │  REST /api/threads/:id/memory (GET notes for its folder, DELETE to forget them)
  ▼
src/server/app.js       node:http · host, origin and key checks · JSON API
src/server/runtime.js   one engine session per chat · approvals · provider hand-over
src/server/threads.js   logs/ui/threads/<id>.json (atomic writes, git-ignored)
src/server/memory.js    chat summaries for a fresh session · project notes in logs/ui/memory/<folder>.md
src/mcp/manage.js       Apps window: list (no secrets), switch on/off, test
src/engine/live.js      Live view: app actions, results and safe images from the engine
src/server/live.js      Live view memory: 40 actions and 8 images per chat, 6 chats, in memory only
  ▼
src/engine/session.js   THE agent: lead + specialists + standards + apps + guard
src/engine/models.js    providers.json → Claude | Ollama | Anthropic-compatible
src/engine/commands.js  /tasks expansion, shared with the terminal
  ▲
src/index.js            the terminal front end (dea): the same engine
```
The terminal and the window are two front ends on one engine. A change to agents, standards, tools, the guard or apps applies to both, and they can't drift apart.

## Data flow for one message
1. `POST /api/threads/:id/messages` → the runtime expands `/tasks`, saves the item and answers 202.
2. The runtime opens (or reuses) the chat's engine session. On the same provider it resumes the SDK session. On a different one it starts fresh, with a summary of the chat so far, because histories don't move between APIs.
3. Engine events (`delta`, `text`, `delegate`, `tool`, `blocked`, `approval`, `result`) are saved to the thread and broadcast over `/api/events`.
4. A risky tool call pauses in `canUseTool`. The runtime broadcasts `approval-request`, and the page posts `/api/approvals/:id`. With no answer within 15 minutes it is declined.

## Decisions and trade-offs
| Decision | Why | Cost |
| --- | --- | --- |
| Local server + browser page, not Electron | No new dependencies, and nothing to sign or install | It runs in a browser tab, not a dock app |
| Server-sent events over `fetch` | One-way streaming is all the UI needs, with no WebSocket library. `fetch` lets the key travel in a header | Reconnects are handled by hand (backlog of 1,000 events) |
| One engine session per chat, closed after 20 idle minutes | Each chat keeps its own context and model | Several busy chats each run a Claude Code process |
| Provider switch → fresh session + summary | Claude and Ollama histories aren't interchangeable (thinking blocks, context sizes) | The new model sees a summary, not every tool step |
| Folder and brief fixed once a chat starts | Approvals and guard roots stay tied to one folder | Start a new chat for another project |
| Apps window changes only `"enabled"`, saved to `mcp.json` | One source of truth for the terminal and the window; a toggle is a one-line diff | Adding apps or tokens still means editing `mcp.json` and `.env` |
| App changes apply from the next message; busy chats keep their apps | A reply never loses tools halfway through | A switch takes effect one message later in a busy chat |
| Per-chat app list can only narrow | A chat can't turn on an app that is off globally | To use an app that is off, switch it on in the Apps window first |
| Message box floats over the conversation as glass (`--composer-h` from a ResizeObserver) | The chat scrolls beneath the box and the top bar, like Apple's apps, and the last message still stops above the box | Solid fallbacks for "Reduce transparency" and browsers without backdrop blur |
| Type follows Apple's San Francisco text styles: one size scale (11 to 40 px), each size with its own tracking and leading; window copy follows the Apple Style Guide (sentence-style labels, curly apostrophes, serial commas, Return and Shift-Return on a Mac) | The window reads like a native Apple app, and every size is chosen from one scale | New text should use the size tokens (`--text-*` with `--track-*`) rather than raw sizes |
| Side windows change the columns at once, then everything that moved glides back from where it was drawn (FLIP: transform only, Web Animations), in the same time and on the same curve as the window's own full-width slide | No layout per frame, so it stays smooth with a long chat; the top bar's buttons ride the window's edge; a second click turns it around from where it is | A closing window is briefly lifted out of the grid (`position: fixed`, same place and size); text rewraps once at the start, not while it moves |
| Sidebar hidden state is restored by `theme.js` before the first paint (`data-side` on `<html>`) | No flash of a sidebar that then slides away | Kept in this browser only, like the appearance |
| Resume only what Claude Code still has (`getSessionInfo` before resuming; a failed resume is retried once from a summary) | A chat older than Claude Code's 30-day history no longer fails on every message | A cleared chat continues from a summary, not its full history |
| Session id saved when the conversation starts, not when the reply ends | Quitting during the first reply can still resume it | One extra write per new session |
| Summaries and project notes are built from the chat file, not by a model | Free, instant, can't invent facts, testable | Notes are factual lines (requests, files, decisions, outcome), not prose insight |
| Project notes keyed by the folder's real path, one Markdown file per folder, rewritten per chat after each reply (newest first, 12 chats, 16,000 characters) | Always current, survives a crash, readable and editable, bounded | A chat's own section is rewritten when it gets a new reply, so edits there don't stick; edits at the top of the file do |
| Notes go into the system prompt framed as background records | New chats know what happened before; the guard and approvals still decide what runs | A reply line that reads like an instruction is still only a record |
| Live view keeps app images in memory, not in chat files | Chats stay small and screenshots of private work never land on disk | Images are gone after a server restart; the actions list is too |
| Vanilla JS + escaping Markdown renderer | Readable, no build, nothing from a CDN, and CSP `script-src 'self'` | Fewer Markdown features than a library |

## Security
- Binds to `127.0.0.1` only.
- Every `/api` call needs the 256-bit key from `logs/ui/.access-key` (mode 600), checked in constant time. `npm run ui -- --new-key` rotates it.
- **DNS rebinding:** the Host header must be `127.0.0.1:<port>` or `localhost:<port>`.
- **CSRF:** cross-site `Origin` and `Sec-Fetch-Site` are refused, and every API call needs a custom header.
- **Headers:** CSP `default-src 'none'` with `'self'` for scripts, styles and connections. `frame-ancestors 'none'`, `nosniff`, `no-referrer`, and a Permissions-Policy denying camera, microphone and location.
- **Secrets:** the page only learns whether a provider is available. Anthropic-compatible providers get their own key, and the agent process never gets other providers' keys or app secrets.
- **Apps window:** `PATCH /api/apps/:name` accepts exactly `{ "enabled": true | false }` for an app already in `mcp.json`; anything else is refused and the file is left alone. Writes are atomic (temp file + rename) and one at a time. The list sends a command's name and package, a URL's origin and path (no query), and the names of `${VAR}` placeholders, never their values, headers or arguments. Only apps that are on can be tested, one test per app at a time. A chat's app list must name existing apps and can only narrow what is on.
- **Folder picker:** directory names only, inside your home folder. The work folder can't be the home folder or a drive root.
- **Agent replies:** escaped before any formatting, and links must be `http(s)`.

## What to revisit as it grows
- **More than one person, or another device:** this design is single-user. Before that, it would need real sign-in, HTTPS and per-user folders.
- **Attachments** (drag a Figma export or a PDF into the chat): an upload route that writes into the project folder, through the guard.
- **Very long chats:** the page redraws the whole conversation per event (fine below about 2,000 items). Switch to incremental rendering if chats grow beyond that.
- **Cost view across chats:** usage is stored per chat. A small summary page could total it.
