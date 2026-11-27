# Security

## Reporting a problem

If you find a security issue, please don't open a public issue. Use GitHub's private reporting instead: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you did, what happened, and the version (`package.json`) you ran.

## How dea is meant to run

- On your own computer. The web window listens on `127.0.0.1` only and needs the private access key in `logs/ui/.access-key`. Don't expose it to a network or put it behind a public tunnel.
- With your keys in `.env`, which is git-ignored. Never commit `.env`, `logs/` or the access key. If a key leaks, revoke it with the provider and run `npm run ui -- --new-key` for a new access key.
- With apps added by you. The window's Apps screen can only switch an app on or off (the `"enabled"` value in `mcp.json`) and test one that is on. It can't add apps or change commands, addresses, headers, tokens or allow/deny lists, and it never shows token values. Read an app's entry before you turn it on: a command app runs on your computer with your permissions.
- With its own engine protected. If you choose vPointer ai's own folder as a chat's project, agents still ask before changing the engine (`src/` except `src/tools/defs/`, `ui/`, `test/`, `logs/`), `mcp.json` or `providers.json`, and can never read the window's access key. In VS Code-based editors the engine is hidden and read-only (`.vscode/settings.json`).
- With Live view images kept in memory only. Images apps send back are shown only as PNG, JPEG, WebP or GIF (never SVG), as checked base64 under 1.5 MB, and are never written into chat files.
- With memory kept on your computer. Notes for new chats (`logs/ui/memory/`, git-ignored, readable only by you) hold what you asked, the files changed, your approvals and a short line on how each chat ended. They're built from the chat file without another model call, can't forge structure, and reach the agents as background records that never override your request or these rules. Deleting a chat removes its notes; **Forget these notes** or `DEA_MEMORY=off` removes or stops them.
- With risky actions asking first. Writes, shell commands, deploys and app tools that change things wait for your Allow. The rules live in `src/security/` and are covered by tests; see "Security model" in the README.

The agents can read and write files in the folder you choose for a chat, so choose a project folder. dea refuses your home folder or a whole drive.
