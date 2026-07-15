# Verqury hooks — remote decision relay

Canonical, version-controlled copies of the Claude Code hook scripts Verqury
installs into `~/.claude/hooks/`. See `docs/adr/0011-remote-decision-relay.md`
and `verqury-build-plan.md` §8.

## `verqury-notify.cjs` — Phase A (outbound notify)

A **non-blocking** Claude Code `Notification` hook. When Verqury is set to
**Away** and notifications are enabled, it forwards Claude Code notifications
(needs-permission / waiting / done) to Telegram so you can see a pending build
decision from your phone. It never influences the agent and always exits 0.

- Reads `presence` + `telegram.chatId` from `<data-root>/config.json`
  (default `~/FlawedWorks/verqury/config.json`, or `$VERQURY_DATA_ROOT`).
- Reads the bot token from `~/.claude/.env` key `VERQURY_TELEGRAM_BOT_TOKEN`
  (or `$VERQURY_ENV_FILE`). The token is never logged.
- Zero dependencies (node builtins only); works even when the Verqury app is closed.

### Install

```sh
cp hooks/verqury-notify.cjs ~/.claude/hooks/verqury-notify.cjs
```

Then register it as a `Notification` hook in `~/.claude/settings.json`
(alongside any existing Notification hooks — do not replace them):

```json
{
  "hooks": {
    "Notification": [
      { "hooks": [{ "type": "command", "command": "node /home/USER/.claude/hooks/verqury-notify.cjs" }] }
    ]
  }
}
```

### One-time Telegram setup (in Verqury → Settings → Notifications)

1. In Telegram, message **@BotFather** → `/newbot` → copy the **bot token**.
2. Message your new bot once (say "hi") so it can DM you.
3. Get your **chat_id**: open `https://api.telegram.org/bot<token>/getUpdates`
   and read `result[].message.chat.id`.
4. Paste both into Verqury's Notifications settings (token is saved to
   `~/.claude/.env`, chat_id to `config.json`), tick **Enable**, flip to **Away**.

### Dry-run (no network, for testing)

```sh
echo '{"message":"Claude needs your permission to run Bash","cwd":"/x/proj","session_id":"abcd1234"}' \
  | VERQURY_NOTIFY_DRYRUN=1 VERQURY_DATA_ROOT=/path/to/root node hooks/verqury-notify.cjs
```

## `verqury-permission.cjs` — Phase B (interactive approve-by-tap gate)

A **blocking** Claude Code `PermissionRequest` hook. When Verqury is set to **Away**
and notifications are enabled, it files the permission request into the Approval inbox
(`<data-root>/approvals/`) and blocks until you tap **✅ Approve / ⛔ Deny** on your phone —
then returns that verdict to the build. If nobody answers within ~9 minutes it emits **no
decision**, so Claude Code's normal desktop prompt takes over (it never auto-answers). When
you are **Here** (or the relay isn't configured) it emits nothing immediately — zero interference.

- Same config/secret sources as the notify hook (`config.json` + `~/.claude/.env`); the token
  is never logged. Zero dependencies. The **Verqury app must be running** to relay the tap (it
  owns the single Telegram long-poll); if it isn't, the request simply falls back to the desk.
- Self-expires at 9 min — safely under Claude Code's 600 s blocking-hook timeout, which
  **fails open** (a naive waiting hook would auto-approve).

### Install

```sh
cp hooks/verqury-permission.cjs ~/.claude/hooks/verqury-permission.cjs
```

Register it as a `PermissionRequest` hook in `~/.claude/settings.json` (alongside any existing ones):

```json
{
  "hooks": {
    "PermissionRequest": [
      { "hooks": [{ "type": "command", "command": "node /home/USER/.claude/hooks/verqury-permission.cjs", "timeout": 600 }] }
    ]
  }
}
```

### Dry-run (gate + file the record, no blocking; for testing)

```sh
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m wip"},"cwd":"/x/proj","session_id":"abcd1234"}' \
  | VERQURY_PERMISSION_DRYRUN=1 VERQURY_DATA_ROOT=/path/to/root node hooks/verqury-permission.cjs
```

`VERQURY_PERMISSION_EXPIRE_MS` / `VERQURY_PERMISSION_POLL_MS` shrink the timers to exercise the
real blocking poll loop (answer / expire) in a test.
