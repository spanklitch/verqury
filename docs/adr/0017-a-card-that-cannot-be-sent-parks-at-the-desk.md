# 0017. A card that cannot be sent parks at the desk immediately

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The interactive gate blocks a Claude Code build for up to nine minutes waiting for a tap, then
emits nothing so the prompt falls back to the desktop dialog. v0.6.3 added a fail-fast check
before that wait: if the app is not running, there is no Telegram consumer, so relaying would
stall for nine minutes with nothing on the phone to answer. That check asks **"can we send?"**

It never asked **"did we send?"**

Between 2026-08-06 and 2026-08-13 the bot token in `~/.claude/.env` was a placeholder —
eighteen characters where a real token is about forty-six. Every Telegram call returned
`401 Unauthorized`. Nothing anywhere said so:

- The hook's `tokenPresent()` only tests that the key exists with a non-whitespace value, so a
  placeholder passes and the gate reports itself armed.
- `api()` in `app/src/telegram.js` resolves with the parsed body regardless of HTTP status, so
  a 401 is a *fulfilled* promise, not an error. No caller checks `res.ok` or `res.description`.
- `reconcileApprovals` read `res?.result?.message_id`, got null, and did
  `relayCards.delete(a.id); // send failed — retry next reconcile`. It retried every sweep,
  forever, silently.

So every permission request filed a record, waited the full nine minutes, expired, and parked
at the desk — correct-but-useless behaviour, repeated roughly 56 times over the week, while
the email channel (a different credential) kept working and made the relay look alive. This is
the same asymmetry the project already knew about — a working outbound leg is not evidence of
a working inbound one — with a third variant: a *configured* leg is not evidence of a
*functioning* one.

A shorter expiry window was considered as the fix and rejected. Away mode exists precisely
because the owner is not at the desk; a window short enough to make a broken relay cheap is
also short enough to miss nearly every working card. That trades a loud failure for a useless
feature. The problem was never the length of the wait. It was that the wait was entered
blind and left no trace.

## Decision

We will treat an unsendable card as a terminal outcome, recorded and acted on at once.

- `markUndeliverable(root, id, reason)` sets `status: undeliverable` and stores Telegram's own
  `description` in an `error` field. It refuses to overwrite a record that is already
  `answered` — a tap that beat the failed send is the real outcome.
- `reconcileApprovals` calls it whenever a send returns no `message_id`, instead of scheduling
  a silent retry.
- The hook checks for `undeliverable` before `answered` on every poll and, on seeing it,
  returns immediately and emits nothing — parking the prompt at the desk in about two seconds
  instead of nine minutes.

The nine-minute window is unchanged. It now applies only to cards that genuinely reached the
phone and went unanswered, which is what it was always meant to measure.

## Consequences

- **A broken relay costs seconds, not nine minutes** — and says why, on the record, in the
  Decision Inbox, where a human will eventually read it.
- **Silent failure becomes visible failure.** The `error` field is surfaced through
  `listApprovals`, so the reason a card never arrived is data, not something to be rediscovered
  by probing the Telegram API by hand.
- **A transient network failure now parks at the desk instead of retrying.** Accepted
  deliberately: the fallback is a desktop prompt, never an auto-approval, and Gary's stated
  position is that a missed relay should close out and let him re-engage at the terminal. This
  is not critical-path automation.
- **`undeliverable` is a new terminal status** that consumers must handle alongside `expired`.
  `APPROVAL_STATUSES` grows; the expiry sweep ignores non-pending records, so it is unaffected.
- **The gate still cannot validate a token before waiting.** `tokenPresent()` remains a
  presence check by design — the hook must never read the secret's value. Validity is now
  established by the send attempt itself, which is the only place it can honestly be known.

## Alternatives considered

- **Shorten or expose the expiry window.** Rejected above: it makes the working case worse to
  make the broken case cheaper.
- **Validate the token shape in the hook.** A length/format check would have caught this exact
  outage. Rejected as a narrow guard against one cause — a revoked token, a blocked bot, or a
  Telegram outage all present identically and all pass a shape check. Checking the *outcome*
  covers every cause, including the ones not yet met.
- **Distinguish permanent (401/403) from transient (network) failures and retry only the
  latter.** Genuinely better behaviour, and rejected for now on simplicity grounds: it adds a
  classification table to buy back a case whose fallback — a desk prompt — is already safe and
  already what the owner asked for.
