# 0016. Closing the window quits

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Design principle #4 said Verqury stays resident when you close its window: a quiet companion
in the tray, exited deliberately via tray → Quit. That principle rested on an assumption that
turned out to be false — that the tray icon is always there to go back to.

`setupTray()` catches its own error and carries on, because a missing tray was judged
non-fatal ("the window is the deliverable"). The combination is what actually shipped: close
the window on a launch where the tray failed, and Verqury is alive with no window, no icon,
and no way back except finding its PID. We logged that as transient in August 2026; it was
not. It happened again, and this time the resident instance was not idle — it had been
spinning the Telegram long-poll for over fifteen hours (see ADR-0017 for why that loop never
backed off), burning ~20 minutes of CPU while appearing, to its owner, to be closed.

ADR-0015 removed the *multiplication* of these ghosts by enforcing one app per data root. It
did not make the single remaining instance reachable.

The counter-argument is real and load-bearing: the away-mode relay only works while the app
is running (ADR-0011, and the liveness gate of v0.6.3). If closing the window quits, then
closing the window disarms remote approvals. Two mechanisms were considered for keeping both:
quit only when presence is `here`, or keep residency and make tray failure loud.

Gary's ruling, 2026-08-14: **X always quits.** A close button that does not close is a bug
regardless of what it buys, and a conditional close — sometimes it quits, sometimes it hides,
depending on a setting in another tab — is harder to reason about than either honest option.

## Decision

We will quit the app when its last window closes. `window-all-closed` calls `app.quit()`
unconditionally; the window no longer carries a `close` listener, and the one-time "still
running in the tray" notification is deleted along with the behaviour it explained.

The tray survives for autostart-to-tray (`--hidden`), where no window is ever closed, and
keeps its Quit item. It is no longer the only way out.

## Consequences

- **The close button closes.** No unreachable instance, no PID hunt, no invisible process
  holding a socket open. `before-quit` already clears the heartbeat, so the permission gate
  correctly reports the app as gone from the next prompt on.
- **Away-mode relay now depends on leaving the window open.** This is the accepted cost. It
  is at least *legible*: an app you can see is running is a better predictor of a working
  relay than an app you were told is in a tray you cannot find. The gate already fails fast
  when the app is absent (v0.6.3), so the failure mode is a desk prompt, never a stall.
- **Design principle #4 is reversed**, and the README/plan wording that describes tray
  residency as a principle no longer matches the app. Autostart-to-tray remains as a
  deliberate, opt-in way to get the old behaviour.
- **The harness check changed shape.** `closeHintOnce` tested a notification that no longer
  exists; it is replaced by `closeQuitsApp`, a wiring assertion (no `close` listener keeping
  the window alive, `window-all-closed` wired). Firing the real thing would end the harness
  run, so end-to-end close-to-exit is proven by a probe against the packaged binary at
  release time — the same pattern ADR-0015 used for second-launch refusal.

## Alternatives considered

- **Quit only when presence is `here`.** Preserves the relay for away sessions and still
  gives a real close at the desk. Rejected as too clever: the same gesture doing two
  different things, keyed off a setting in another tab, is exactly the kind of invisible
  state that produced this bug in the first place.
- **Keep residency, make tray failure loud.** Fixes reachability without touching the
  principle — if the tray fails, refuse to hide the window. Rejected because it defends the
  principle rather than the user's expectation, and it leaves "closed but running" as the
  normal case, which is what nobody wanted.
