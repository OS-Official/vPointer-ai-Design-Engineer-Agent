<img width="64" height="64" alt="Group 40" src="https://github.com/user-attachments/assets/42d75d38-0af6-4aa0-ae46-dddab0487840" />




## vPointer ai, Design Engineer Agent (Beta)

**Your design-engineering team, on your own computer.** AI specialists that know your brand, build mobile first, and check their own work, in a chat window or the terminal, on Claude or a free local model for maximum security.

One lead agent and eight specialists cover brand systems, Figma, front-end code, Arabic MSA copy, accessibility, security and deployment. It follows your brand packs exactly, connects to apps over MCP, and checks every action before it runs. 


Runs on macOS, Linux and Windows (Windows untested so far; it needs [Git for Windows](https://git-scm.com/download/win)).

## Installation

```bash
git clone https://github.com/OS-Official/vPointer-ai-Design-Engineer-Agent.git
cd vPointer-ai-Design-Engineer-Agent
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# in .env: ANTHROPIC_API_KEY=…  or  DEA_PROVIDER=ollama for your local model
npm test                    # should end with: fail 0
npm run check               # validates agents, tasks, tools, brands, apps
npm link                    # creates the global `dea` command
```

Requires Node 20.12 or newer (tested on 20 and 22).

## Use

```bash
cd ~/Sites/my-project
dea --project northwind-site                 # Claude, with the example brief and brand
dea --local                                  # your local Ollama model
npm run ui                                   # the same agents in a browser window
```

**Make it yours:** describe yourself in `context/principles.md` and `context/tools.md`, add a brief per project in `context/projects/` (see `northwind-site.md`), and add your brand as a pack in `context/brands/<name>/` (copy the `northwind` example).

Chat commands: `/tasks` `/agents` `/mcp` `/tools` `/projects` `/brands` `/help` `/exit`.
Tasks: `/build` `/brand-check` `/audit` `/arabic` `/tokens` `/icon` `/figma` `/review` `/preflight` `/handover`.
Ctrl+C once stops the current task; again (or at the prompt) quits. Every session is logged in `logs/`.

## The window (npm run ui)

```
npm run ui
```
This opens your agents in the browser, like a desktop chat app: chats in a sidebar, replies that stream in, each reply's work shown as a layer tree, Allow / Deny buttons for risky actions, `/tasks` with autocomplete, and a model picker for each chat. It uses the same engine as `dea`, so every agent, standard, app and security rule is the same.

- **Access:** it only listens on this computer. The link printed in the terminal carries your private key: bookmark it, and don't share it. Make a new key with `npm run ui -- --new-key`.
- **Models:** pick Claude (Opus, Sonnet, Haiku), any model installed in Ollama (found automatically), or another Anthropic-compatible API you add to `providers.json`. Switching provider mid-chat continues from a summary of the chat.
- **First run:** if no model is ready yet, the start screen shows the exact steps (add your key to `.env`, or open Ollama) and a **Check again** button. A new chat picks a model that can run.
- **Appearance:** Auto (follows your computer), Light or Dark: the half-circle, sun and moon at the bottom of the chat list. The sidebar, top bar and message box are glass; the chat scrolls beneath them. With "Reduce transparency" turned on in your system settings they turn solid.
- **Chat menu:** click a chat's title, or the … next to it in the list, to rename, pin or delete it.
- **Hide the sidebar:** the sidebar button at the left of the top bar (or Control-Command-S on a Mac, Ctrl+Alt+S elsewhere) hides the chat list so the conversation has the whole window, and shows it again. The window remembers your choice.
- **Motion:** the sidebar and the right-hand window slide in and out, and the top bar's buttons ride their edge while the conversation glides to its new place. Click again mid-way and it turns around. With "Reduce motion" turned on in your system settings, everything changes at once.
- **Apps:** the **Apps** button in the sidebar lists every app in `mcp.json`, with its official logo and its status, an on/off switch and a **Test connection** button. The plug button next to the message box picks which of those apps this chat may use. See "Apps window" below.
- **Live view:** the play button in the top bar shows what agents see and do in your apps while they work: each action as it happens (and whether it runs freely, asks first or is waiting for you), and the images they get back, such as a Figma screenshot. It opens by itself on a wide window when an agent starts using an app, shares the right-hand column with Agents and tools, and keeps the last 40 actions and 8 images of each chat in memory only (never saved to disk).
- **While it works:** Enter never stops the agents; only the Stop button does. What you type is kept for when the reply is done. Replies and code blocks have a Copy button.
- **Coming back to a chat:** every chat is saved as you go, so quitting and reopening the window brings it back. Your next message resumes the full conversation, steps included, from the history Claude Code keeps on your computer (for 30 days by default). If that history is gone, or you switched provider, the chat continues from a summary built from the chat itself: what it's about, every request, the files changed, your decisions on risky actions and whether the last request finished.
- **Memory between chats:** after each reply, a few lines about the chat (what was asked, files changed, decisions, how it ended) go into the notes for its project folder. A new chat in that folder starts with the notes from up to 12 earlier chats, as background rather than instructions. **Agents & tools → Memory → View notes** shows them and can forget them. Deleting a chat removes its notes, and `DEA_MEMORY=off` in `.env` turns memory off. For lasting rules, use the project brief or the folder's `CLAUDE.md`.
- **Where chats live:** `logs/ui/threads/`, with the notes in `logs/ui/memory/` (neither is in git). Design notes are in `docs/web-ui.md`.

## Models (providers.json)

`providers.json` lists the APIs the agents can run on. `.env` still sets the defaults (`DEA_PROVIDER`, `DEA_MODEL`, `DEA_OLLAMA_*`).

| Type | Use it for | Notes |
| --- | --- | --- |
| `anthropic` | Claude, with `ANTHROPIC_API_KEY` | Full tools, web search, budget cap |
| `ollama` | Models on Ollama (local) | Models are discovered automatically; nothing leaves your computer |
| `anthropic-compatible` | Any other API that speaks the Anthropic Messages format | Set `baseUrl`, `apiKeyEnv` (a variable in `.env`) and `models`. Your Anthropic key is never sent there, and the window shows where data goes |

In the terminal: `dea --provider ollama --model qwen3-coder-32k:latest`, or `dea --local`.

## Customise (no code changes needed)

| Change | Where | Create with | Applies |
|---|---|---|---|
| A specialist | `agents/<name>.md` | `npm run new -- agent <name>` | next session |
| A task (`/command`) | `tasks/<name>.md` | `npm run new -- task <name>` | immediately |
| A checking tool | `src/tools/defs/<name>.js` | `npm run new -- tool <name>` | next session |
| A working standard | `standards/<name>/SKILL.md` | `npm run new -- standard <name>` | next session |
| How the lead works | `agents/lead.md` | (edit) | next session |
| Your standards | `context/principles.md`, `context/tools.md` | (edit) | next session |
| A client brief | `context/projects/<name>.md` | copy an existing one | next `--project` |
| A brand pack | `context/brands/<name>/` | import a design system | next session |
| An app (MCP) | `mcp.json` | `npm run mcp:import -- <app>` | next session |
| A model provider | `providers.json` | copy the example entry | next chat |

Run `npm run check` after every change: `dea` refuses to start while there are errors, and each error names the file and the fix.

## Apps over MCP (Figma and others)

`mcp.json` lists the apps the agents can use. It ships with four; only Figma is on.

| App | What the agents can do | Runs freely | Asks first | Blocked | Needs |
| --- | --- | --- | --- | --- | --- |
| `figma` (on) | Read frames, layer structure, variables, styles and screenshots from a Figma link or your selection | every `get_*`, `search_*` | anything that changes the file (e.g. `use_figma`) | — | The Figma desktop app with its MCP server turned on |
| `playwright` | Check pages in a real browser: screenshots and accessibility snapshots at any screen size, console, network | screenshots, snapshots, resize, console, network | opening a URL, clicking, typing, running page scripts | running code outside the page, uploading files | Nothing (downloads with npx) |
| `github` | Read repos, files, issues and pull requests | `get_*`, `list_*`, `search_*` | anything that changes GitHub | `delete_*` | `DEA_MCP_GITHUB_TOKEN` in `.env` |
| `supabase` | Read one project: tables, migrations, logs, advisors, docs (read-only mode) | `list_*`, `get_*`, docs | SQL, migrations, deploys | deleting, pausing, restoring, resetting | `DEA_MCP_SUPABASE_TOKEN` and `DEA_MCP_SUPABASE_PROJECT_REF` in `.env` |

### Connect Figma

1. Open the Figma desktop app and turn on its MCP server. Figma's guide calls it the desktop (or Dev Mode) MCP server; it listens on `http://127.0.0.1:3845/mcp`. Figma may require a paid seat for it: check Figma's guide.
2. Run `npm run check -- --mcp`. You should see `✔ figma` and its tools, each marked *runs freely* or *asks first*.
3. Use it: `/figma <link> spec the hero for a build`, or `/build` with a Figma link. Copy a link to a frame in Figma (right-click, Copy link to selection) so the agents get the exact frame.

If Figma is closed, dea still starts; the Figma tools are just missing, and `figma-designer` says how to fix it. Figma's remote server (`https://mcp.figma.com/mcp`) signs in through the browser, which dea can't open, so use the desktop server.

### Apps window

In the window (`npm run ui`), **Apps** in the sidebar shows every app in `mcp.json`:

- **Status:** *Connected, N tools*, *Not answering* (with the reason in plain words), *Not configured* (names the `.env` variable it needs) or *Off*.
- **Switch:** turns the app on or off. Turning one on asks you to confirm, because its tools then reach the agents. The change is saved to `mcp.json` as `"enabled"` and applies from each chat's next message; a chat that is busy keeps its apps until its reply is done.
- **Test connection:** connects once and lists the app's tools, each marked *runs freely*, *asks first* or *blocked* by your `allow` / `deny` lists. Only apps that are on can be tested, because a test starts the app.
- **Help:** each app shows its setup step from the `setup` line in its `dea` block.

**Apps in this chat:** the plug button next to the message box picks which of the apps that are on this chat may use (All apps, some, or none). It can only narrow the list: an app that is off stays off.

What the window can't do, on purpose: add or remove apps, or change an app's command, address, headers, tokens, `allow` / `deny` lists or anything other than `"enabled"`. Those stay in `mcp.json` and `.env`, which you edit yourself. Token values are never sent to the page; it only learns a variable's name and whether it is set.

### Turn on another app

Switch it on in the Apps window, or set `"enabled": true` in the app's `dea` block. Add any token it needs to `.env` (restart `npm run ui` after changing `.env`), then test it in the window or with `npm run check -- --mcp`. Each entry looks like this:

```json
"github": {
  "type": "http", "url": "https://api.githubcopilot.com/mcp/",
  "headers": { "Authorization": "Bearer ${DEA_MCP_GITHUB_TOKEN}" },
  "dea": { "enabled": false, "description": "GitHub: read repositories…",
           "setup": "Create a GitHub token, add DEA_MCP_GITHUB_TOKEN=... to .env, then restart the window.",
           "allow": ["get_*", "list_*", "search_*"], "deny": ["delete_*"], "local": false, "alwaysLoad": false }
}
```

- The format is Claude Desktop's `mcpServers`, plus the `dea` block. `npm run mcp:import -- <name>` copies an app from your Claude Desktop config and moves its secrets into `.env` as `${…}` references.
- `allow` / `deny` are tool-name patterns; anything not listed asks you first. Unknown apps always ask.
- Give a specialist an app with `<app>:*` (or `<app>:<tool>`) in its `tools:` line; `requires: <app>` keeps it switched off until the app is on (as `figma-designer` does). Apps that are off add nothing.
- Which specialists use which app: `figma-designer` (all Figma tools), `ui-engineer` and `design-critic` (Figma read tools, Playwright), `deploy-ops` (GitHub, Supabase).
- Tools are namespaced per app (`mcp__<app>__<tool>`) and `design` is reserved for the agent's own tools, so apps can't clash. An app with a missing token or a bad entry is skipped with a message.
- With Claude, app tools load on demand through ToolSearch; in local mode they are sent directly (keep big apps at `"local": false`). App processes don't receive your Anthropic key.
- Apps that only allow a browser sign-in (OAuth), like some hosted servers, can't connect yet; `npm run check -- --mcp` says so.

## Local model (Ollama)

`dea --local` (or `DEA_PROVIDER=ollama`) runs every request on `DEA_OLLAMA_MODEL` (default `qwen3-coder-32k:latest`) through Ollama's Anthropic-compatible API. Anthropic credentials are removed from the environment, web tools and thinking are off, and replies are capped at `DEA_OLLAMA_MAX_OUTPUT` tokens. Below a 100k context the agent runs in lite mode (brand essentials, short descriptions) and warns at 75% and 100% full. Check with `npm run check -- --local`.

## Brand packs

A brief with a `**Brand:** <name>` line uses `context/brands/<name>/`: the design system's `tokens.json` and docs, copied unchanged, plus a small `brand.json` (source, icon rules, screen type sizes). Tools: `get_brand`, `brand_css` (CSS variables, Tailwind v4 `@theme`, Tailwind v3 config), `brand_lint`, `icon_lint` and `record_decision` (saves approved decisions to the brief; asks first). Included: **Northwind**, a fictional example brand. Copy its folder for your own brand. Change the design system first, then re-import; `npm run check` errors if versions disagree.

## Standards (how the agents work)

`standards/` holds skill-style rule packs. Each is a short `SKILL.md`, plus `references/` with code patterns and checklists that are read only when needed.

| Standard | Covers | Built into |
| --- | --- | --- |
| `responsive-grid` | Mobile first, the 4/8/12 grid, fluid type and spacing, container queries, images, tables, nav, touch targets, RTL, viewport checks | ui-engineer, design-critic, figma-designer |
| `clean-code` | Structure, naming, React state and effects, Redux Toolkit, the four data states, browser security, definition of done | ui-engineer, design-critic |
| `northwind-brand` | Example brand standard: the rules that carry the Northwind brand and its components in code. Copy it for your own brand | ui-engineer, design-critic, figma-designer, brand-strategist, icon-designer, arabic-copywriter (Northwind projects only) |

To give a specialist a standard, add `standards: <name>, …` to its file. The lead sees the list and loads a standard with `get_standard` when it does the work itself. A standard with `brand: <slug>` only applies to that brand's projects.

`layout_lint` checks the responsive and clean-code rules a script can see:
- Errors: zoom blocked, viewport missing, images without alt, focus outline removed.
- Warnings: `max-width` queries, `left`/`right` instead of logical properties, `100vh`/`h-screen`, fixed px widths, px font sizes, `!important`, index keys, `console.log`, raw HTML, `target=_blank` without `rel`.

Add `layout-lint-ignore` in a comment to accept a line on purpose. Use `/qa` for a full quality pass. `evals/` has a graded test task (and a grader you can extend) for checking that a change to a standard really helps.

A brand's screen layout values (page margin, gutter, section spacing, 4/8/12 columns, component sizes) live in `brand.json → web.layout`; mark them `"status": "proposed"` until they're signed off. `brand_css` emits them as tokens: `px-page-margin`, `gap-gutter`, `py-section`, `max-w-page`, `max-w-measure`, `size-icon-tile`.

## Security model

Every tool call, from the lead or a specialist, passes a `PreToolUse` hook (runs for every tool, including read-only ones) and `canUseTool` (asks you). Specialists run in the foreground, so approvals arrive one at a time and a task is finished when the prompt returns.

| Always blocked | Asks you first | Runs freely |
|---|---|---|
| Reading/writing `.env`, keys, `wp-config.php`, `~/.ssh` | Reading files outside the project | Reading and searching inside the project (searches skip secret files) |
| Writing outside the project, incl. through symlinks | `git commit`, `git push`, deploys | Writing inside the project (`--careful` asks) |
| `sudo`, `rm -rf` on root/home, `curl … \| sh` | Installing packages, `npx`, deleting or moving | `npm run build`, `npm test`, `git status` |
| Force-push, `git reset --hard`, `npm publish` | Other websites, `curl` uploads | Trusted docs sites (MDN, Tailwind, React, Vercel, Supabase…) |
| Printing env vars or secrets | Custom tools not marked `readOnly: true` | Custom tools marked `readOnly: true` |
| App tools on that app's `deny` list | Every other app tool | App tools on that app's `allow` list |
| The window's access key (`logs/ui/.access-key`) | In vPointer ai's own folder: changes to its engine (`src/` except `src/tools/defs/`, `ui/`, `test/`, `logs/`), `mcp.json` and `providers.json` | Editing agents, tasks, standards and briefs |

Project `.claude/settings.json` files are never loaded; a project's `CLAUDE.md` is read as notes only. Claude sessions have a spending cap (`DEA_MAX_BUDGET_USD`).

**Know the limit:** shell rules are pattern checks. They stop accidents and obvious misuse, not a determined script. Keep secrets in your hosts' settings, not in project folders, and run the agent on projects you trust.

## Editing in VS Code or Cursor

`.vscode/settings.json` hides the engine from the file tree and from search, and makes it read-only: most of `src/`, plus `ui/`, `test/`, `evals/`, `logs/` and `node_modules/`. What you edit to build agents stays visible and editable: `agents/`, `tasks/`, `standards/`, `context/`, `src/tools/defs/`, `docs/`, `mcp.json`, `providers.json` and `.env`. It works in VS Code and editors built on it (Cursor, Windsurf, VSCodium). It prevents slips; it isn't access control.

**Editing the engine:** delete the `files.exclude` and `files.readonlyInclude` blocks in `.vscode/settings.json` (or set one entry to `false`). For a single file, run **File: Toggle Active Editor Read-only in Session** from the Command Palette. `npm test` checks that these settings cover every engine folder, so add a new folder under `src/` to both blocks.

To protect the engine on GitHub as well, turn on branch protection for `main` and require a review from you for changes under `src/`, `ui/` and the two permission files (a `CODEOWNERS` file).

## Layout

```
agents/            lead + specialists (Markdown)
tasks/             slash-command playbooks (Markdown)
context/           principles, tools, project briefs, brand packs
standards/         working standards (SKILL.md + references/), built into specialists
evals/             graded test tasks for the standards
mcp.json           apps over MCP (Claude Desktop format + "dea" settings)
src/index.js       the terminal front end (dea)
src/engine/        the agent engine shared by the terminal and the window; model providers
src/server/        the window's local server: API, chats, approvals
ui/                the window itself (HTML, CSS, plain JS; no build step)
providers.json     which APIs and models the agents can run on
docs/web-ui.md     design notes for the window
src/bootstrap.js   one loader shared by `dea` and `npm run check`
src/security/      the security guard (code + tests, change deliberately)
src/mcp/           mcp.json loader, Claude Desktop importer, live connection check
src/brands/        brand loader and brand_lint / icon_lint / brand_css logic
src/tools/defs/    the agent's own tools, one file each
src/loaders/       reads and validates agents/, tasks/ and standards/
src/lint/          layout_lint rules (responsive, RTL, clean code)
test/              node --test suites
ui/logos/          official app logos for the Apps list (sources and licences in NOTICE)
.vscode/           hides the engine and makes it read-only in VS Code-based editors
```

## Contributing

Issues and pull requests are welcome. Please run `npm test` (it should end with `fail 0`) and `npm run check` before opening a pull request, and keep changes to `src/security/` small and covered by tests. To report a security problem privately, see [SECURITY.md](SECURITY.md).
