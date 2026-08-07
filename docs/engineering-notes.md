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

## 8. Remote decision relay — questions & email (Phase C, ADR-0011)

- **One inbox, two `kind`s.** The `approvals/` records now carry `kind` ∈ `permission` (Phase B)
  | `question` (Phase C). A **missing** `kind` reads as `permission` — Phase B records predate the
  field, so never assume it's present. `answerApproval` and `answerQuestion` each **guard their
  lane** (answering a question via the permission path, or vice-versa, throws); a lane-cross bug
  is easy to write and a unit test pins both directions.
- **Question answer is FREE text, not a vocabulary.** A permission's `decision` is allow/deny; a
  question's `answer` is whatever the owner tapped (an option label) or typed (a reply). They live
  in different fields (`decision` vs `answer`) so the record shape stays uniform and unambiguous.
- **The `verqury-ask` skill returns via stdout.** A Claude Code skill is `SKILL.md` (instructions)
  + a bundled script the model runs; the script's **stdout is the return channel** to the model
  (verified against code.claude.com/docs/en/skills, not memory). So `scripts/ask.cjs` files a
  question, polls it (same `Atomics.wait` sync-sleep as the Phase-B hook), and **prints the answer**
  — the model reads it as the Bash result. Reference the script as `${CLAUDE_SKILL_DIR}/scripts/ask.cjs`
  so it resolves regardless of cwd, and scope `allowed-tools` to that exact command so the ask itself
  never trips a permission prompt (which, when Away, would recursively relay).
- **Skill cross-reader (skill ⇄ core), incl. arrays/booleans.** `ask.cjs` hand-writes the question
  record with a flat serializer where **arrays are JSON flow sequences** (`options: ["A","B"]` — valid
  YAML) and booleans are bare (`needsContext: true`). gray-matter parses both back; a unit test asserts
  core reads a skill-shaped question, and `ask.cjs` reads a core-written `answer` with a quote-tolerant
  regex. Same lock-step discipline as the Phase-B hook.
- **Email lives in `app/`, never in `core`/hooks/skills.** SMTP correctness (implicit TLS on 465 vs
  STARTTLS on 587, AUTH, encoding) is a vetted-library job, so `nodemailer` (MIT-0, **zero runtime
  deps** — verified via `npm view`) is an `app/` dependency. The transport is **injected** into
  `sendContextEmail` so it's unit-tested with a fake (no real creds). Gmail needs a 16-char **App
  Password** (not the login; Google removed plain-password SMTP in May 2025) → `~/.claude/.env` as
  `VERQURY_SMTP_PASSWORD` (never returned to the renderer).
- **Email is powerless + once.** It carries context only (no link), is sent only for `needsContext`
  or long questions, and is guarded by `emailedAt` so a reconcile sweep or app restart can't re-send.
  The `#code` (short id) in the subject/body correlates it to the Telegram card; the answer always
  returns via Telegram (tap or reply), never via email.
- **Typed replies extend the single-consumer poll.** `getUpdates` now requests
  `allowed_updates: ['callback_query', 'message']`. A typed reply maps to its question by
  `reply_to_message.message_id` (matched against the card's stored `messageId`), falling back to a
  `#code` in the text. Only messages from the configured `chat_id` are honoured. The nodemailer
  `high severity` audit lines come from the pre-existing `node-gyp`/`make-fetch-happen` native-build
  toolchain (node-pty, better-sqlite3), **not** nodemailer — it added no subdependencies.

### Phase C go-live — operational gotchas (caught during live phone verification, 2026-07-15)

- **Run exactly ONE current Verqury, and confirm the binary is the fresh build.** During go-live
  a stale **0.5.1** AppImage was still running from earlier in the day. Being pre-Phase-C, it
  treated a `question` record as a permission and wrote `decision: allow` onto it (no question
  path); worse, a second (new) instance was also polling, so **two processes long-polled Telegram
  at once** — the single-consumer violation ADR-0011 warns about — and updates were split between
  them. Symptoms: answers that don't map, `decision: allow` on a question. Fix: `pkill -f
  Verqury.AppImage` (all of them), launch one, and verify it's the intended build — compare the
  process start time to the AppImage mtime, and `cmp -s ~/Applications/Verqury.AppImage
  app/dist/Verqury-<ver>.AppImage`. (Electron's single-instance lock does NOT protect you here
  because the stale one already held it.)
- **Testing the relay from a Claude Code session while Away relays THAT session's own prompts.**
  The gate fires for every Claude Code session, so running the live test from one (Away) means
  this session's own permission-gated Bash calls buzz the phone as Approve/Deny cards, interleaved
  with the test question cards (~24 stray permission records accrued in one sitting). Mitigations:
  after filing a test question, run NO further tool calls until the background runner returns (so
  the only new card is the test); prefer the **`#code` plain-message** answer path (independent of
  reply-linking, unambiguous when the chat is busy); flip **Here** as soon as testing ends; and
  delete the session-test inbox records afterward.
- **Powerless email + card wording.** The context email is intentionally a dead-end (no inbound).
  A card that says "check your EMAIL, then REPLY here" tempts the owner to reply to the *email* —
  keep the card's answer instruction Telegram-only ("reply to this message" / "send `#code` …").
- **Gmail self-send can lag / filter.** `emailedAt` is stamped only after Gmail's SMTP accepts the
  message, so a stamped record + no error = sent; if the inbox seems empty it's Gmail delivery
  latency or a filtered tab (Updates/Promotions/Spam), not a send failure. The card is the
  actionable channel regardless — the owner never needs to wait for the email to answer.

## 9. Web companion & going-public (verqury.com, ADR-0012)

- **Cloudflare Pages keeps a file you *deleted* between deploys.**
  *Symptom:* after removing an asset from the site repo and pushing, the old URL still returns 200
  — even with a cache-bust query, and even after a dashboard "Purge by URL" (`cf-cache-status:
  MISS` → 200, i.e. served fresh from origin). *Cause:* Pages incremental deploys upload
  new/changed files but **do not prune removed ones**; a cache purge can't fix an origin that
  still has the file, and a no-op redeploy doesn't prune it either. *Fix:* **overwrite, don't
  delete** — Pages *does* update *changed* files, so replace the path with a harmless file (a 1×1
  transparent PNG) and push; the URL then serves benign content.

- **A grep security pass is blind to PII baked into image pixels.**
  *Symptom:* the go-public secret/PII scan was clean, yet the public README hero showed a real
  project with a `repo:` line exposing a home-dir path + private project name, and a terminal
  screenshot showed the machine hostname (`user@host`). *Cause:* text scans can't read text
  rendered into PNGs.
  *Fix:* **every repo going public gets a visual image pass** (eyeball screenshots for hostnames,
  home paths, real project/data) in addition to the text grep. Capture app screenshots against a
  **curated demo data root** (`VERQURY_DATA_ROOT=<temp>` + the `VERQURY_CAPTURE` hook), never the
  real one. The embedded terminal shows the real shell prompt (PS1) regardless of data root — so
  exclude terminal shots from public assets.

- **`git filter-repo` misses branches that exist only on the remote.**
  *Symptom:* after purging blobs and force-pushing `main` + tags, a fresh mirror still contained
  the stripped blobs. *Cause:* filter-repo rewrote only local refs; stale **remote-only feature
  branches** still referenced the old blobs. *Fix:* enumerate `git ls-remote --heads`, delete
  stale merged branches (`git push origin --delete <b>`), then verify with a fresh `git clone
  --mirror` that the blob hashes are absent from every ref. (Same gotcha bit the email purge.)
  GitHub may still serve an unreachable blob by SHA until GC — low residual risk for non-secret PII.

## 10. Terminal tabs: focus, drops, and colors (2026-08-06)

- **A repaint on the bell silently killed the keyboard.** *Symptom:* typing in one terminal
  tab, another tab finishes and rings BEL — and from that moment keystrokes go nowhere until
  you click back into the terminal. It looked like the bell was "stealing" focus or switching
  tabs. *Cause:* neither. `onBell` called the terminal's full `render()`, which does
  `host.replaceChildren(tabStrip(), toolbar, active.wrap)`. **Detaching a DOM node moves focus
  out of anything inside it** — here, the active session's xterm helper textarea — and
  `render()` never re-focuses (only `setActive` does). The active tab never changed; only
  focus was lost, which is why clicking the *current* tab appeared to "fix" it. *Fix:* a bell
  repaints **only the tab strip** (`repaintTabs()` swaps the `.term-tabs` node), never the
  active session's container. *Rule of thumb:* any repaint that can run while the user is
  typing must not touch the subtree holding focus. Guarded by VERQURY_VERIFY **block 15**
  (`bellKeepsFocus`), which was confirmed to go **false** against the old code before the fix
  was kept — a regression guard nobody has watched fail is not a guard.

- **`stopPropagation` in a child can strand global drag state.** *Symptom:* dragging a file
  onto the embedded terminal left the dashed "Drop to capture into the active project"
  overlay on screen permanently — everything else kept working, but only a restart cleared
  it. *Cause:* the overlay is toggled by document-level `dragenter`/`dragleave`/`drop`
  listeners on the **bubble** phase, and the terminal's own `drop` handler calls
  `e.stopPropagation()` — so the document handler that resets the counter and removes the
  class never ran. *Fix:* register the cleanup in the **capture** phase
  (`addEventListener('drop', endDrag, true)`), which fires top-down before any child can
  swallow the event, plus a `dragend` listener for a drag abandoned outside the window. The
  overlay also no longer claims the terminal area (`closest('.term-host')`), because a drop
  there means something different. *Rule of thumb:* global UI state cleared by a bubble-phase
  listener is one `stopPropagation` away from being stuck forever.

- **Electron 41 removed `File.path`.** A dropped file's real path must come from
  `webUtils.getPathForFile(file)`, exposed through the preload bridge (`pathForFile`). Checked
  against the installed `electron.d.ts`, not memory — `File.path` is gone, and reading it just
  yields `undefined`, so a file drop silently does nothing. Drop sources are tried in order:
  real files → `text/uri-list` (`file://` decoded) → `text/plain`; paths are shell-quoted so
  spaces survive.

- **Tab colors are claimed, not positional.** A tab keeps its color for its whole life and a
  closed tab's color returns to the pool (`claimColor()` picks the lowest unused). Positional
  coloring would re-color surviving tabs whenever a neighbour closed, which defeats the point
  — the color exists to build muscle memory for "the build is in the purple one".

## 11. Relaying an agent's question (2026-08-06)

- **The email channel had never fired — no input existed.** *Symptom:* Phase C's escalating
  email was fully configured (to/from/host/port + app password) and never sent a single mail.
  *Cause:* `maybeEmailQuestion` requires `kind === 'question'`, and only the `verqury-ask`
  skill creates those records. Across **347** approval records there were **zero** — no agent
  had ever invoked the skill. The feature wasn't broken; it had no trigger. *Lesson:* before
  debugging a feature that "doesn't work", check whether its input has ever existed — count
  the records.

- **`AskUserQuestion` was already arriving, disguised as a permission.** Claude Code's
  multiple-choice question comes through the `PermissionRequest` gate as an ordinary
  permission record whose **body is the tool's JSON payload** — every question, every option,
  every description already on disk. It was relayed as a bare "Approve this?" card, so the
  phone couldn't say what was being asked and you had to walk back to the terminal. *Fix:*
  `app/src/ask-card.js` parses the payload and builds a readable card (question text + option
  labels) plus a long-form email (options **with** descriptions).

- **Hard limit — the gate cannot carry an answer.** `PermissionRequest` returns
  `decision.behavior` **allow/deny only** (§7); there is no channel to hand a chosen option
  back to the tool. So a tapped option *cannot* answer an `AskUserQuestion` — approving only
  means "let the question render at my desk". Reading on the phone is the achievable win;
  true answer-from-phone is exactly what the file-mediated, blocking `verqury-ask` skill
  exists for. Don't try to make the gate do it.

- **Telegram's text cap needs measuring, not estimating.** Cards are capped at 3500 chars
  (real limit 4096) and truncated by measuring the **assembled** string, not by summing its
  fixed parts — the `join('\n')` separators are trivial to miscount, and a first attempt
  overshot by exactly one character. Over the cap, the send fails and the card is lost.

## 12. Session metrics: harvesting Claude Code transcripts (2026-08-07, ADR-0013)

- **We read an internal format on purpose, and it is contained.** `transcript_path` is a
  documented hook field, but the **contents** of the JSONL are not a supported interface —
  the docs steer hooks toward `last_assistant_message` on `Stop` instead. Parsing lives in
  `core/src/sessions.js` and nowhere else, tolerates unparseable lines (the file is appended
  to live, so a truncated final line is normal), and degrades to a partial record rather than
  throwing. Once harvested, the numbers are file-backed truth; an upstream format change
  breaks *future* harvests and leaves history intact.

- **The directory slug is a shortcut; `cwd` is the contract.** Claude Code names a transcript
  directory after the cwd with non-alphanumerics flattened to `-`
  (`/home/dev/proj` → `-home-dev-proj`). Do **not** join on that name. Match the `cwd` field
  recorded inside the file against the project's `repo` (a path-boundary prefix test), and use
  the slug only to narrow which directories to open.

- **Narrow by slug *prefix*, or you silently lose subdirectory sessions.** A session started
  in `<repo>/app` lands in its own directory (`-home-dev-proj-app`), not the repo's. An
  exact-match fast path drops those sessions with no error — a unit test caught it. Prefix
  matching over-selects (`/repo/mine-other` also matches `-repo-mine`), which is harmless
  because the `cwd` check rejects the impostor.

- **Wall-clock time is not build time — it overstates by ~5×.** Measured on this project's
  own 9 transcripts: **96.5 h** first-record-to-last versus **20.6 h** once gaps over 15
  minutes are capped. The gap is a laptop left open overnight. Both figures are recorded
  (`wallSeconds`, `activeSeconds`) so the threshold can be re-tuned by re-harvesting, but
  active is the only honest headline.

- **Never sum the four token counters into one number.** Cache reads dominate by two orders
  of magnitude (~235 M read vs ~2 M output here) and are the cheapest tokens. A single
  "tokens" figure would be dominated by the cheapest component and read as alarming. Actual
  cost needs `claude_code.cost.usage` over OpenTelemetry.

- **Why not OpenTelemetry, given it is the official interface?** It exports exactly what we
  want (`token.usage`, `cost.usage`, `lines_of_code.count`) — but it is **prospective only**
  (no history to backfill), needs `CLAUDE_CODE_ENABLE_TELEMETRY=1` on every session, and its
  collector-free Prometheus exporter **binds a single fixed port (9464)**, which collides
  head-on with Verqury's concurrent sessions (ADR-0010). It is the intended successor for
  cost and LOC, not a drop-in today.

- **Harness gotcha (seeding, not code).** `captureFiledArtifact` asserts the inbox holds
  **exactly one** artifact, so a seed root must file **none**; `markdownRendered` needs a
  guidance body with an actual `#` heading. Both fail as false regressions otherwise — the
  same literal-fixture trap as `packetHasContext` (§ v0.6.1 notes).

- **`hotkeyRegistered` fails whenever Verqury is already running.** The installed AppImage is
  tray-resident and holds the global `Control+Alt+C`; a second instance cannot register it,
  so the harness reports false. Not a regression — confirm by checking that
  `captureFiledArtifact`/`captureRoundTrips` still pass, since they exercise the same capture
  path without the OS shortcut.
