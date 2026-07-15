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

**Resume reminders reuse Tasks — no parallel concept.** A "where you left off" reminder is
just a task with `resume: true` in frontmatter, not a new data type. `listResumeReminders`
returns open (`status ∉ {done,dropped}`) resume tasks, active project first. The trigger is
*opening the window*, not a clock: `win.on('show')` sends an `app:shown` IPC and the renderer
re-fetches the strip (it also fetches once on boot, since the first `show` can precede the
renderer subscribing). Snooze is deliberately session-only (an in-memory `Set` of task ids) —
no persisted "snoozed until" state to keep truth in the file, not the UI; the reminder simply
returns next open. This keeps the whole feature inside ADR-0001 and away from the scheduler/
cron/external-integration path we explicitly did not want in the core loop.

**Resume-in-tool launch reuses the adapter registry — no new orchestration.** A reminder can
carry a second optional field, `resumeAdapter` (an adapter slug), so the strip card shows a
**▶ Resume in <tool>** button. The button calls the *existing* `adapter:launch` path
(`launchAdapter(slug, project)` in main.js): render the handoff packet → clipboard, `cd` to the
repo, boot the command in the embedded terminal. Nothing new is spawned or driven — Verqury
*launches* the tool and steps back; it does not orchestrate an agent (anti-goal, plan §1). The
label is resolved in the renderer from the already-loaded `state.adapters`, falling back to the
raw slug if that adapter was deleted. Scope is per-reminder (the field lives on the task .md),
not per-project, so different reminders in the same repo can point at different tools.

**Multi-tab terminal: the launch is renderer-driven to dodge an output race.** When the
terminal went multi-session (ADR-0010), the tempting shape was to have main `ptyStart` the
tab and write the command, then tell the renderer to show it. That races: main can emit the
command's first output before the renderer has created the xterm and attached its `pty:data`
listener, so the first line is lost. Fix: `launchAdapter` returns a `{id,label,cwd}` pin and
does *not* touch a PTY; the renderer creates the session (attaching the listener) and *then*
writes the command. Concretely the renderer `await`s the `ptyStart` invoke promise
(`session.ready`) before `ptyInput`, because `ptyStart` is an async `invoke` while `ptyInput`
is a fire-and-forget `send` — write too early and main's `ptys.get(id)` is still empty and
drops it. Tab identity is the pin (`proj:<slug>`), which is what makes "one tab per project"
fall out for free: relaunch resolves to the same id, so it focuses instead of duplicating.

**Bell attention rides the terminal BEL, not output-scraping.** "Tell me when the agent is
done" is detected the standard way: the CLI writes BEL (`\x07`), xterm surfaces it via
`term.onBell`, and we beep (a synthesized Web Audio blip — no asset in the repo), glow the
originating tab if it isn't active, and ask main to raise a desktop notification *only when
the window is unfocused* (`win.isFocused()` gate). We deliberately do **not** try to infer
"awaiting input" by pattern-matching prompts — that's fragile and per-tool. The reliability
therefore depends on the CLI actually ringing the bell: **Claude Code** fires an `idle_prompt`
notification when done and a `permission_prompt` when it needs approval, but by default only
desktop-notifies in Ghostty/Kitty/iTerm2. Note that `preferredNotifChannel: terminal_bell`
alone is **not** enough in our embedded xterm: that channel's bell is gated (it appears
focus-dependent) and our tab doesn't report terminal focus, so it stayed silent even with the
setting on — verified against a live session. The reliable fix is a `Notification` hook that
emits BEL unconditionally, written straight to the controlling tty so it isn't swallowed by
hook-stdout capture: `printf '\a' > /dev/tty 2>/dev/null` in `~/.claude/settings.json`. Plain
shells also bell on other events (e.g. completion ambiguity), so the signal is "something
wants attention," not strictly "task done."

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
- **Telegram bot token (remote relay, Phase A)** is the first secret Verqury handles.
  It lives in `~/.claude/.env` under `VERQURY_TELEGRAM_BOT_TOKEN` — reachable by both the
  Electron app and the standalone hook, outside the repo (ADR-0011). The app writes it via
  `saveEnvVar` (0600, key updated in place) and **never returns the value to the renderer** —
  only a `tokenSet` boolean. Non-secrets (presence, `chat_id`, enable) go in the data-root
  `config.json`. `VERQURY_ENV_FILE` overrides the path so tests/harness never touch the real
  `~/.claude/.env`.

## 6. Remote decision relay hook (Phase A, ADR-0011)

- **The hook is `.cjs`, not `.js`.** It installs to `~/.claude/hooks/` where there is no
  `package.json`; an ESM `.js` there triggers Node's `MODULE_TYPELESS_PACKAGE_JSON` warning
  on stderr and a reparse on **every** notification. CommonJS (`.cjs`) is unambiguous and
  silent. It is also **dependency-free** (node builtins only) and does **not** import
  verqury-core — so it stays fast, and works even when the app is closed. It reads
  `config.json` + `.env` straight off disk.
- **Non-blocking contract.** The `Notification` hook is side-effects only. The script wraps
  everything in try/catch, swallows network errors, and always exits 0 — a broken relay must
  never break the agent. The pending HTTPS request keeps the event loop alive until it
  completes (8 s timeout); no `process.exit`.
- **Completion is fuzzy.** Per the current hooks docs, `Notification` reliably means "Claude
  wants you" (permission/idle prompts fire it); task *completion* is not a guaranteed
  top-level event (`agent_completed` is documented as "likely for subagents"; the real
  turn-end signal is the separate, far noisier `Stop` hook). So the "done" ping rides the
  same catch-all Notification hook and is classified by a message-text heuristic
  (`/complet|finished|done/i`); its top-level reliability needs a live session to confirm.
- **`VERQURY_NOTIFY_DRYRUN`** makes the hook print its send decision (token as a boolean
  only) instead of hitting the network — this is how the harness (block 11) proves the whole
  chain: UI → `config.json` + isolated `.env` → hook sends when Away / gates when Here, with
  the secret never appearing in config or dry-run output.
- **Enriched IPC returns.** `notify:setPresence` / `notify:update` return the *enriched*
  state (`tokenSet`/`hookInstalled`), not the bare core config, so the renderer's
  `state.notify` never loses that status when toggling; `showNotifyPanel` also refetches on
  open (token/hook status can change out from under it).
- **The app never rewrites `~/.claude/settings.json`.** Registration is a one-time install
  (see `hooks/README.md`); the app only *reads* whether the hook is installed, to show status.
- **The `Notification` hook is FOCUS-GATED (verified live 2026-07-14).** It is a *separate*
  event from the permission dialog — a tool approval fires `PermissionRequest`; the
  `Notification` hook fires only when Claude Code decides to *surface* a notification, and it
  does that only when the **terminal is unfocused** (`idle_prompt` re-fires ~60 s while
  backgrounded and waiting; permission notifications surface when you're not looking).
  Consequence: you **cannot** test Phase A by sitting focused on a fresh terminal and approving
  quickly — Claude Code stays silent by design, and the ping never fires. The real away-scenario
  (terminal backgrounded because you left the desk) *does* fire it. Confirmed by triggering a
  real approval in an unfocused terminal → the phone buzzed "Claude Code needs your permission ·
  <cwd> · #<sid>", with the captured payload `message: "Claude needs your permission"`. The
  deterministic, focus-independent per-prompt catch is Phase B's blocking `PermissionRequest`
  hook — this is *why* the plan splits them. (Refs: code.claude.com/docs/en/hooks-guide;
  anthropics/claude-code issues #8320, #12048.)
- **Optional live diagnostic:** set `VERQURY_NOTIFY_DEBUG=1` on the hook command in
  `settings.json` to append each invocation (raw payload, gate state, decision — never the
  token) to `~/.claude/verqury-notify.log`. Off by default; how we captured the payload above.

## 7. Remote decision relay — the interactive gate (Phase B, ADR-0011)

- **`PermissionRequest` output ≠ `PreToolUse` output (verified against current docs, not
  memory).** `PreToolUse` returns `hookSpecificOutput.permissionDecision` ∈ allow/deny/ask/defer;
  `PermissionRequest` returns `hookSpecificOutput.decision.behavior` ∈ **allow/deny only**. We use
  `PermissionRequest` because it fires only when a prompt would actually appear (not on every tool
  call). The "ask"/desk fallback is **emit nothing** (exit 0, no JSON) → the native dialog proceeds.
- **The 600 s blocking-hook timeout FAILS OPEN** (timeout ⇒ proceed/allow). A naive waiting hook
  would silently auto-approve while you're away. So the gate **self-times at 9 min** (60 s margin)
  and emits nothing → parks at the desk. This is load-bearing; do not raise the expire past ~9 min.
- **Synchronous sleep in the hook** uses `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),
  0, 0, ms)` — a real, non-busy blocking sleep. `PermissionRequest` hooks are *meant* to block, so
  the hook stays a simple sequential poll loop rather than an async runtime.
- **Telegram `getUpdates` is single-consumer.** Two pollers steal each other's updates, so exactly
  ONE process may long-poll: the **app** owns it and routes callbacks to records by `#id`; the hook
  only writes/polls files. (Sending — `sendMessage` — is fine from anywhere, which is why Phase A's
  fire-and-forget notify can POST straight from the hook.) `getUpdates` uses `allowed_updates:
  ['callback_query']` and an in-memory offset; stale callbacks after a restart are ignored (the
  approval is gone or no longer pending).
- **chokidar won't watch a directory that doesn't exist yet.** The first pending approval was
  written but never fired `data:changed` until we made `init()` create `<root>/approvals/` up front
  (like `projects/` and `guidance/`). Watch the dir from the start, not on first write.
- **Cross-reader contract (hook ⇄ core).** The dependency-free hook hand-writes the record with a
  flat, JSON-quoted-scalar YAML frontmatter that gray-matter (core) parses back identically; core
  answers it by rewriting via gray-matter, which the hook reads with a quote-tolerant regex
  (`/^decision:\s*"?(allow|deny)"?/m`). A unit test writes a hook-shaped file and asserts core reads
  it, so the two serializers can't drift. Answers are written **atomically** (temp + rename) because
  the hook is polling the file concurrently.
- **The relay is skipped under `VERQURY_VERIFY`** (no network in the headless harness): the harness
  proves the file-mediated spine (hook files → inbox card → tab badge → desktop verdict → cleared →
  gates when Here) via a real hook subprocess; the live Telegram round-trip is the phone test.
