# 0011. Remote decision relay — approve builds from the phone via Here/Away + hooks

- **Status:** Accepted (Phase A built 2026-07-14; **Phase B built 2026-07-15**; Phase C planned)
- **Date:** 2026-07-14 (amended 2026-07-15)

## Amendment (2026-07-15) — Phase B as built

Building the interactive gate surfaced one **correction to the contract this ADR assumed**,
verified against the current hook docs (code.claude.com/docs/en/hooks) rather than memory:

- The `PermissionRequest` hook returns `hookSpecificOutput.decision.behavior`, and the ONLY
  accepted values are **`allow`** / **`deny`** — there is **no `ask`**. The "expire → ask"
  fallback this ADR describes is therefore implemented by the hook **emitting no decision
  (exit 0, no JSON)**, which lets Claude Code's normal desktop permission dialog proceed and
  wait. This is cleaner than a literal `ask` and preserves the ruling exactly. Confirmed:
  default timeout is **600 s and it FAILS OPEN** (timeout ⇒ proceed), so the hook self-expires
  at 9 min and emits nothing — a missed prompt parks at the desk, never auto-approves.
- **Naming:** the "Decision Inbox" ships as the **`approvals`** module/dir
  (`core/src/approvals.js`, `<root>/approvals/`) to avoid colliding with the existing
  per-project architecture-decision log (`memory/decisions`). Stored **globally** (like
  packets) so the dependency-free hook writes one without resolving a project.
- **Telegram ownership:** `getUpdates` is a **single-consumer** long-poll, so the **app** owns
  it (one loop, routes callbacks to records by `#id`); the hook only writes/polls files. Phase
  B's tap therefore needs the app running (it always is — the build runs in its terminal), and
  the hook's file-based self-expire degrades safely to the desk even if the app is down.

## Context

The embedded, multi-tab terminal (ADR-0009, ADR-0010) turned Verqury into the place where
agent CLIs (Claude Code today; Grok and others later) run real builds. Those builds are
**interactive**: the agent pauses to ask "may I run this command / make this commit?" (the
bulk case — a simple yes/no) or, less often, "I need your input on this design decision"
(a richer question). Today answering means standing at the desk. The owner wants to trigger
a multi-step build in the morning and keep it moving from his day job — *and* keep making the
approvals himself, because reviewing them is how he is learning. So the goal is explicitly
**"not chained to the desk," not "fully unattended."** Verqury must stay a **relay**: the
agent raises its hand, the human decides, Verqury carries the message both ways. It must
never answer on the human's behalf — that would cross the §1 "no agent orchestration"
anti-goal. This is the same "Layer, not IDE" posture as everywhere else.

Two forces made this a real decision rather than an obvious one:

1. **How does Verqury even know a decision is pending, without screen-scraping the terminal?**
   Parsing pty output to detect "a prompt appeared, here are its options" is fragile and
   agent-specific — the exact thing we want to avoid.
2. **How does an answer get back into a paused CLI without injecting keystrokes into the pty?**
   Keystroke injection is brittle and couples us to terminal internals.

## Decision

**We will relay decisions through a Here/Away toggle plus Claude Code's own cooperative hook
and skill mechanisms — not terminal scraping, not keystroke injection — and carry the
round-trip over Telegram (fast, bidirectional) with email as an optional long-form read
channel.**

- **Here/Away toggle** (desktop; state in a file). `HERE` = local bell + light the tab (the
  ADR-0010 attention path). `AWAY` = notify the phone. It is a router, and the channel behind
  it is *pluggable* — the same shape as the Phase-7 adapter registry, pointed outward.
- **Detection uses structured Claude Code events, verified against the current hooks docs
  (code.claude.com/docs/en/hooks), not stale memory:**
  - **`Notification` hook** (non-blocking, side-effects only) fires on `agent_needs_input`
    and `agent_completed` → send Telegram/email. Covers "come look" and "task complete."
  - **`PermissionRequest` hook** (blocking; returns `permissionDecision` `allow`/`deny`/`ask`)
    is the interactive gate: notify → poll for the remote tap → return the decision. No
    keystroke injection. Preferred over `PreToolUse`, which fires on *every* tool call.
  - **A `verqury-ask` Skill** owns the agent's *own* clarifying questions: write a Decision
    Inbox record → poll for the answer → return it to the model.
- **Everything is file-mediated.** Here/Away state and each pending decision are files under
  the data root; Verqury's existing chokidar watcher is the consumer. The **Decision Inbox**
  is a third file-backed inbox beside artifacts (Phase 4) and tasks (Phase 6), and answers
  auto-log into the project timeline (as Phase-6 reports do). This keeps ADR-0001 intact:
  truth is markdown; Telegram/email/SQLite hold none of it.
- **Channels:** **Telegram** is the fast write channel — a BotFather bot with inline
  `[Approve][Deny]` buttons and free-text replies; Verqury **long-polls**, so no inbound port
  is ever exposed. **Email** is an optional long-form *read* channel for complex decisions
  (unlimited length, pushed, needs no endpoint); the response still returns via Telegram,
  joined to the email by a correlation id (`#a7`). Email is deliberately **powerless** — it
  carries context only, never an actionable link — so all authority lives in the one authed
  Telegram `chat_id`.
- **Credentials** follow the global convention: secrets (bot token; later Gmail app-password)
  live in `~/.claude/.env` — reachable by both the Electron app and the hook scripts —
  non-secrets (chat_id, SMTP host/port, from-address, toggles, Here/Away state) in the
  data-root `config.json`. Never in the repo, never logged.

**Timing (the load-bearing detail).** The blocking hook's default timeout is **600 s (10 min)**,
and — critically — **on timeout the tool AUTO-PROCEEDS** (non-blocking). A naive waiting hook
would therefore silently approve an action while the owner is away. So the hook **self-times**
inside that ceiling: `T=0` notify → `T=7min` "expiring in 2 min" reminder → `T=9min` expire.
The 1-minute margin (9 vs 10) guarantees *we* decide the outcome before the harness's dangerous
default. **On expire we return `ask`**, not `deny`: an unanswered remote decision falls back to
the normal desktop permission prompt, which simply waits until the owner is home — reverting to
exactly the behavior as if remote control had never been engaged, rather than telling the agent
"no" and risking a derailed build.

## Consequences

- **The fragile parts disappear.** No terminal screen-scraping (the agent/harness declares the
  decision) and no keystroke injection (the hook returns the verdict directly). Detection and
  response are both structured and in-band.
- **Per-decision ceiling ≈10 min.** This is a feature, not a bug, given the "stay in the loop"
  goal: answer within the window and the build flows; miss it (in a meeting) and that one
  decision parks safely at the desk. Truly all-day-unattended builds are explicitly out of scope.
- **Claude Code only, at first.** Hooks and Skills are Claude Code features; Grok and other CLIs
  honor neither. They join when they expose equivalents; until then the ADR-0010 bell/pty path
  is the universal floor beneath this premium layer.
- **Soft vs. deterministic.** Skill invocation is the model's *choice* (it may just print the
  question); hooks *always* fire. So the deterministic hook is the backstop for "never miss a
  decision while away"; the Skill is the richer path when the model cooperates.
- **Anti-goal stays clear.** The agent raises its hand, the human decides, Verqury relays. No
  auto-answering, no queuing of unattended work — relay, not orchestrator.
- **Native iOS companion app is shelved,** not rejected — see Alternatives.

## Alternatives considered

- **Native iOS companion app (tier 4).** Attractive — the owner already owns the FlawedWorks
  iOS ship pipeline (App Store Connect, Codemagic, `.p8` keys, TestFlight), and native APNs
  gives lock-screen approve/deny actions. But it's a *second product with its own release
  train*, and — decisively — the desktop-side bridge (hooks + Telegram + Decision Inbox) is
  required *regardless* of client. So the app is the penthouse, not the entrance. **Shelved**
  until button-plus-text over Telegram proves insufficient.
- **Terminal screen-scraping to detect prompts.** Rejected: fragile, agent-specific, and
  exactly the coupling the hook mechanism lets us avoid.
- **Keystroke injection into the pty to answer.** Rejected for the blocking-gate case: the
  hook returns `allow`/`deny`/`ask` directly, which is cleaner and terminal-agnostic. (Remains
  the fallback for non-Claude CLIs that lack hooks.)
- **SMS (Twilio).** Bidirectional but metered, paid, no buttons, and needs an inbound webhook.
  Telegram dominates it on every axis except "installs nothing."
- **ntfy / Pushover push.** Great notify-side and ntfy is self-hostable (cloud-clean), but the
  button→response path needs a reachable endpoint, whereas Telegram's long-poll needs none.
  A viable swap-in later given the pluggable-channel design; Telegram is the first plug-in.
- **Web push to a PWA.** iOS web-push is flaky and requires an installed home-screen PWA;
  Telegram delivers lock-screen buttons today with no app to build.
