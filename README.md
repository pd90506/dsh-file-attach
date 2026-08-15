# dsh-file-attach

A DSH web plugin that attaches **any file type** in the composer — PDF, DOCX, ZIP, code files, whatever. DSH's native attachment channel only accepts images (PNG/JPEG/WebP/GIF); this plugin fills the gap for everything else.

## How it works

- **Client**: a 📎 paperclip button at the left end of the composer tool row (`conversation.input.left`). Pick one or more files — or **Cmd/Ctrl+V paste** a file from Finder/Explorer (image pastes stay on the native DSH image path). Each uploaded file appends a marker line to the draft:
  `📎 .dsh-uploads/<sessionId>/report.pdf`
  A chips rail above the composer (`conversation.input.dock`) lists the attached files; remove one via its × (which also deletes the marker line), or edit the draft text directly — the draft is the single source of truth.
- **Host**: a `POST /dsh-file-attach/upload` route writes the file into the **current session's workspace** under `.dsh-uploads/<sessionId>/` — inside the workspace, so the agent's own `read`/`glob`/`bash` tools can open it. A system-prompt section teaches the model the convention: when the user references an attached file, read it from the marker path rather than asking for its content.

The marker line (one token, no delimiters that could clash with file names) plus the prompt section mean the model sees the path and fetches the file on demand — no token cost for the file's content, no context bloat.

## Structure

```
├── package.json          dsh.client manifest (platform: web, inject edges)
├── src/index.js          host half: upload route + filename sanitization + prompt section
├── client/client.js      browser bundle (hand-written ModuleLoader format, no build step)
└── test/                 smoke.mjs (host half) + bundle-render.mjs (client half, real dsh-client-ui-primitives)
```

All APIs used here are verified against DSH 0.1.0-rc.6 source: cordis `name`/`inject`/`apply`, `ctx.webServer.register`, `ctx.systemPrompt.section`, `ctx.sessions.get(...).header.cwd`, `ctx.slots.inject`/`register` on the real `conversation.input.left` / `conversation.input.dock` seats, `ctx.locale.register`.

## Install (web profile)

```bash
# 1. Link the package into the profile (mirrors the dsh.profile.bundles link pattern)
#    add to ~/.dsh/profiles/web/package.json dependencies:
#      "@pd90506/dsh-file-attach": "link:/path/to/file-attach-plugin"
#    then run pnpm install inside the profile directory.

# 2. Append a loader row to ~/.dsh/profiles/web/cordis.patch.yml:
#    - insert:
#        - id: file-attach
#          name: '@pd90506/dsh-file-attach'
#          config: {}

# 3. Restart dsh web — the client plugin graph is composed at startup.
```

## Usage

1. Click 📎 (or paste a file into the composer — non-image files only).
2. After upload, the marker line is appended to the draft; chips appear above the composer.
3. Send the message — the model sees the marker and reads the file with its file tools.
4. Remove: click the chip's ×, or edit/delete the marker line directly.

Note: files appear as marker lines + chips, not as rendered message cards.

## Limitations

- Single file ≤ 24 MB (request body cap 32 MB; base64 overhead).
- Files land in `<workspace>/.dsh-uploads/<sessionId>/`; same-name uploads overwrite.
- Upload status (in-flight/failed) is browser-memory only — it vanishes on refresh; attached file bodies persist.
- `.dsh-uploads/` grows unboundedly across sessions — no cleanup yet (fine for personal use; revisit if it bites).
- Images still ride the native DSH attachment channel; the plugin also works for images as plain files if you insist.

## Test

```bash
node test/smoke.mjs          # host half: pure helpers + route handler via fake ctx
node test/bundle-render.mjs  # client half: renders the bundle through react-dom/server with real primitives
```
