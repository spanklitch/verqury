# Verqury skills — remote decision relay

Canonical, version-controlled copies of the Claude Code skills Verqury installs
into `~/.claude/skills/`. See `docs/adr/0011-remote-decision-relay.md` and
`verqury-build-plan.md` §8.

## `verqury-ask` — Phase C (the agent's own clarifying question)

The relay's outbound path is automatic (the `Notification` + `PermissionRequest`
hooks). `verqury-ask` is the **cooperative** path: when a build hits a decision only
you can make — a design choice, an ambiguous spec, "approach A or B?" — the model runs
this skill. It files a **question** into Verqury's Decision Inbox (`<data-root>/approvals/`,
shared with permissions by `kind`), relays it to your phone, and **blocks until you
answer** by tapping an option or replying with text, then returns your answer to the
model. Verqury stays a relay — it surfaces the question; you decide.

- `scripts/ask.cjs` is **dependency-free** (node builtins only): it writes the record and
  polls it, printing your answer to stdout (a skill's stdout is its result to the model).
  It never sends Telegram/email itself — the running Verqury app does that (single Telegram
  consumer; long/`needs-context` questions also get the context email).
- For the phone notification you need the same Telegram setup as the hooks, plus (for the
  email context channel) a Gmail **App Password** in Verqury → Settings → Notifications → Email.

### Install

```sh
cp -r skills/verqury-ask ~/.claude/skills/verqury-ask
```

Skill directories under `~/.claude/skills/` are hot-loaded — no Claude Code restart needed
(a brand-new top-level `~/.claude/skills/` dir would need one, but it already exists). Invoke
with `/verqury-ask`, or let the model load it automatically when a build needs a decision.

### Dry-run / test (no blocking, no network)

```sh
# File a question and report it (skip the poll):
VERQURY_ASK_DRYRUN=1 VERQURY_DATA_ROOT=/path/to/root \
  node skills/verqury-ask/scripts/ask.cjs --summary "Approach A or B?" --options "A|B" --needs-context

# Poll an existing (already-answered) record and print the answer:
VERQURY_ASK_ID=<id> VERQURY_ASK_POLL_MS=100 VERQURY_DATA_ROOT=/path/to/root \
  node skills/verqury-ask/scripts/ask.cjs
```

`VERQURY_ASK_TIMEOUT_MS` / `VERQURY_ASK_POLL_MS` shrink the timers to exercise the real
blocking poll (answer / desk-fallback) in a test.
