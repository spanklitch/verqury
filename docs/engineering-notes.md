# Engineering Notes & Runbook

Operational knowledge for building, shipping, and debugging Verqury — written so someone
other than the original author can run it. These are hard-won gotchas; most cost a build cycle
(or several) to diagnose the first time. Organized by area, mostly as *symptom → cause → fix*.

The architecture *why* lives in [`adr/`](adr/); this file is the *how* and the *what bit us*.

---

## 1. Build & CI

- Node 20 workspace: `core/` (verqury-core library + CLI) and `app/` (Electron shell).
- `npm test` runs workspace tests via `node --test` — no test framework dependency.
- Version is hand-set in package.json until packaging lands (Phase 8).

## 2. Data layer & index

**The index is derived, never authoritative (ADR-0001).** `core/src/search.js`
scans the markdown tree and mirrors it into SQLite FTS5. Delete `index.sqlite` and
`verqury index rebuild` (or any mutation, which refreshes) reconstructs it. No code
path may read state that exists *only* in SQLite.

**FTS5 has no UPDATE.** Row changes are done as delete-then-insert keyed on `path`.
`refreshIndex` compares each file's `mtime` (stored `UNINDEXED`) to the indexed value:
unchanged → skip, changed → delete+insert, missing-on-disk → delete. This is why
`documents` stores `path`/`type`/`project`/`mtime` as `UNINDEXED` columns — retrievable
and filterable, but not tokenized into the full-text terms.

**Separation of concerns:** core domain functions (`projects`, `guidance`, `memory`)
do pure file I/O and never touch the DB. The CLI refreshes the index after a mutation;
the Phase 2 Electron watcher will own refresh its own way. Keep it that way — it keeps
the "files are truth" boundary clean.

**WAL side files:** the index opens in WAL mode, so `index.sqlite-wal` / `-shm` appear
next to it. `.gitignore` uses `*.sqlite*` to cover them (the data root is outside the
repo anyway; this is defensive).

## 3. Electron shell & OS integration

**No electron-rebuild — by design.** We sidestepped the native-module ABI problem
entirely: Electron never loads `better-sqlite3`. See [ADR-0006](adr/0006-search-runs-out-of-process.md).
Search shells out to the system `node` running the CLI. If you ever move sqlite
in-process, *that* is when the `@electron/rebuild` dance returns.

**Search subprocess must spawn the system `node`, not `process.execPath`.** Under
Electron, `process.execPath` is the Electron binary; running it (even with
`ELECTRON_RUN_AS_NODE=1`) uses Electron's Node ABI, which does not match the installed
`better-sqlite3`. `app/src/api.js` spawns `node` (overridable via `$VERQURY_NODE`) so
the ABI matches. This is the whole point of ADR-0006 — don't "optimize" it to execPath.

**ESM main + CommonJS preload.** `main.js` is ESM (Electron ≥28 supports it) so it can
import the ESM `verqury-core`. The preload is `preload.cjs` (CommonJS) — the well-worn,
sandbox-compatible path — and only touches `contextBridge`/`ipcRenderer`, never core.
`contextIsolation: true`, `nodeIntegration: false`, sandbox on.

**chokidar v5 on Linux** uses `fs.watch` (no native module) and watches directories
recursively; we filter events to `*.md`. No glob patterns (dropped in v4).

**capturePage() can return a 0-byte PNG** right after load on a software-rendered/
headless GPU (expect `MESA`/`VAAPI` warnings in the log). Waiting for a paint (our
verify harness does other async work first) yields a real capture. Functional
verification via `webContents.executeJavaScript` DOM queries is the reliable signal;
the screenshot is a bonus. The `VERQURY_VERIFY=<dir>` env runs this harness headlessly
and writes `verify.json` (+ `shot.png`).

**Tray needs a real image on Linux** or it warns/no-shows; we load the generated
`renderer/assets/icon.png` and wrap tray creation in try/catch (non-fatal — the window
is the deliverable).

**Global hotkey + clipboard capture (Ctrl+Alt+C, X11).** `globalShortcut.register`
returns `false` if the accelerator is already claimed by another app — we log and carry
on rather than crash (capture is still reachable from the UI button / `capture:now`
IPC). `globalShortcut.unregisterAll()` runs on `will-quit`. Clipboard is read with
Electron's `clipboard.readText()` (X11 CLIPBOARD selection). The capture *logic* lives in
`api.captureClipboard(root, readClipboard)` with the clipboard read **injected**, so it is
unit-tested under plain Node without Electron; main passes `() => clipboard.readText()`.
The harness can't synthesize an OS key event, so it verifies the hotkey two ways:
`globalShortcut.isRegistered(...)` (registration) and calling the same
`captureFromClipboard()` the shortcut binds to (the handler). Wayland would need a
portal-based shortcut — deferred (X11 only per ADR-0003).

**Notifications** use Electron's `Notification`; wrapped in try/catch since libnotify may
be absent on minimal Linux setups (capture still succeeds silently).

**Artifact bodies are stored verbatim, not fenced.** The plan said "fenced if code," but
raw storage makes copy-back round-trip exactly and keeps the file clean for agents; the
frontmatter `kind` carries the code/not-code signal. The inbox shows bodies in a `<pre>`,
not through the markdown renderer.

**Adapter launch spawns detached; config.json is not watched.** `adapter:launch` renders
the adapter's handoff packet to the clipboard, then `spawn(command, { shell: true,
detached: true, stdio: 'ignore' })` + `unref()` so the launched app outlives Verqury
(ADR-0004). The file watcher covers `projects/` and `guidance/` only — **not** `config.json`
— so adapter add/edit/remove does not fire `data:changed`. That's fine because the settings
UI refreshes its own list after each mutation (`refreshAdapters`); just don't expect an
out-of-band `config.json` edit to appear live without a reopen. Commands are the user's own
config (a launcher), so `shell: true` is acceptable here.

**Renderer is an ES module.** `index.html` loads `renderer.js` with `type="module"` so
it can `import` the tested `app/src/markdown.js`. Cross-directory file:// module imports
work under the `default-src 'self'` CSP. The markdown renderer is intentionally minimal
(ADR-0005) and HTML-escapes all input, so guidance/narrative content can't inject markup;
rendered links are routed through `shell.openExternal` (http/https only) via the preload
bridge rather than navigating the window. Clipboard writes also go through the bridge
(Electron `clipboard`), not renderer `navigator.clipboard` — reliable under sandbox.

## 4. Packaging & distribution

electron-builder config lives in `app/package.json` `build`; `npm run dist -w app`
produces an AppImage + `.deb` in `app/dist/`, `npm run pack -w app` an unpacked dir.

**Pin `electronVersion` in the monorepo.** electron and electron-builder are hoisted to
the workspace-root `node_modules`, so electron-builder run from `app/` cannot infer the
electron version and errors ("Cannot compute electron version…"). The fix is
`build.electronVersion` set explicitly (it fetches the matching dist by version).

**Native module in the package.** `better-sqlite3` is `asarUnpack`ed and rebuilt for
Electron's ABI at package time (`npmRebuild: true`). The packaged app runs the search
CLI under Electron's embedded node (`ELECTRON_RUN_AS_NODE`, `app.isPackaged` →
`api.configureNode`), so that unpacked binary is the one it loads. See
[ADR-0008](adr/0008-packaged-search-uses-electron-node.md). **Smoke-test the packaged
build**, not just `electron .` — the `ELECTRON_RUN_AS_NODE` search path only exercises
in a real package.

**Build on a real host.** electron-builder downloads platform binaries (`app-builder-bin`,
`7zip-bin`) and rebuilds native modules; a restricted sandbox can silently drop those
during electron-builder's internal `npm install` step (symptom: `spawn …/app-builder
ENOENT` even after the binary was installed). Run packaging on a normal Linux machine.

**Autostart-to-tray** (`main.js`): the tray "Start on login" checkbox writes/removes
`~/.config/autostart/verqury.desktop` (Electron's `setLoginItemSettings` is unreliable on
Linux). Its `Exec` uses `$APPIMAGE || process.execPath` with `--hidden`, and `--hidden`
makes `createWindow(false)` start the app in the tray without showing a window.

## 5. Credentials & secrets

- Verqury MVP holds no credentials: no API keys, no tokens, no accounts (ADR-0004).
- The user data root (`~/FlawedWorks/verqury/` by default) lives outside the repo and
  is never committed; `.sqlite` and `.env` are gitignored defensively.
