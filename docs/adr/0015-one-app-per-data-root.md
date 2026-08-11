# 0015. One app per data root, and runtime state belongs to the instance that wrote it

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Verqury is designed as a single quiet companion that lives in the tray (design principle #4:
closing the window does not quit; only tray → Quit exits). Nothing enforced that. Every launch —
desktop icon, application menu, autostart entry — built a **complete second instance**, and the
two knew nothing about each other.

The symptom Gary reported was "I exit the program and it's still running somewhere on this box".
Investigation confirmed the shape of it: two instances on one machine, each ~168 MB, each
tray-resident, each independent. Quit ends only the instance whose tray icon you clicked. It is
made materially worse by an already-known intermittent bug — `setupTray()` catches its own error
and carries on, so an instance can end up with **no window and no tray icon at all**, leaving a
process with no user-reachable way to quit it.

The wasted memory is the least of it. Two consequences are correctness bugs:

1. **Telegram `getUpdates` must have exactly one consumer** ([ADR-0011](0011-remote-decision-relay.md)).
   Two long-pollers race for the same update, so an approval tap can be consumed by the instance
   that is *not* the one you are watching — and simply vanish.
2. **The heartbeat is a single file per data root.** Whichever instance quits first runs
   `clearHeartbeat`, deleting the liveness marker while a perfectly good app is still running.
   The `PermissionRequest` gate then reads "no app" and sends every prompt to the desk instead of
   the phone.

A third is milder but real: the OTLP receiver ([ADR-0014](0014-lines-of-code-and-cost-via-a-local-otlp-receiver.md))
binds a fixed port, so the second instance silently gets no receiver, and sessions launched from
it are never measured.

## Decision

**One running app per data root**, enforced by Electron's single-instance lock, and **runtime
state is cleared only by the instance that owns it.**

1. `app.requestSingleInstanceLock()` at startup. A second launch quits immediately, and the
   primary receives `second-instance` and **shows and focuses its existing window** — because
   "launch it again" almost always means "show me the app", and a second click that appeared to
   do nothing would be worse than the bug.
2. The lock is scoped **per data root, not per machine**. Electron keys the lock on the userData
   directory, so when an explicit `VERQURY_DATA_ROOT` is set, Verqury gives that root its own
   userData directory. The installed app's userData path is untouched.
3. `clearHeartbeat(root, { pid })` refuses to delete a beat that demonstrably belongs to a
   *different, still-live* process. A beat that is pid-less, unreadable, or owned by a dead pid is
   cleared by anyone — a stale file must never become permanently unclearable, since that would
   disable the relay for good.

## Alternatives considered

- **A lock file of our own, in the data root.** Closer to ADR-0001 (files are the database) and
  naturally per-root. Rejected: correct lock files are harder than they look — stale-lock
  recovery after a `kill -9`, and no atomic way to hand the "show the window" request to the
  holder. Electron's lock already solves both, including the IPC that `second-instance` rides on.
- **A machine-wide lock (the default, no userData scoping).** Simplest, and wrong here: the
  release procedure launches the packaged AppImage against a throwaway data root while the
  installed app may be running, and every harness run would exit instantly. The per-root rule is
  also just more honest about what an instance actually owns.
- **Making the second instance take over.** Rejected as strictly worse: it would kill an app that
  may be mid-relay, and the failure mode of "the thing you were using vanished" is nastier than
  "the thing you asked for came to the front".
- **Leaving the heartbeat alone and relying on the lock.** Insufficient. The lock stops the
  *common* case, but two roots can still point at one directory by explicit configuration, and
  ownership is the property we actually want. It is also four lines and removes a whole class of
  liveness bug.

## Consequences

- Launching Verqury when it is already running now surfaces the existing window instead of
  building a rival. Quit means quit, because there is only ever one to quit.
- The Telegram single-consumer invariant is structurally enforced rather than assumed.
- A dev or harness run against `VERQURY_DATA_ROOT` still coexists with the installed app — and
  now gets its own Electron cache, so throwaway runs stop sharing the installed app's userData.
- **What this does NOT fix:** work *started from* the embedded terminal that has detached itself
  from its shell. `before-quit` kills each PTY, which takes down foreground and ordinary
  background jobs, but a child started with `disown`, `setsid` or `nohup` survives by design and
  is reparented. Those processes are the *work Verqury launched*, not Verqury — but to a user
  looking at a process list they are indistinguishable. See engineering-notes §16; a quit-time
  "live work is still running" prompt is the open follow-up.
