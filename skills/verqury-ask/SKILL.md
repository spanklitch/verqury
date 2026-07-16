---
name: verqury-ask
description: Ask the owner a clarifying question and wait for the answer, relayed to their phone via Verqury. Use when you are running a build and hit a decision only the owner can make — a design choice, an ambiguous requirement, which of several approaches to take — and they may be away from the desk. Files the question in Verqury's Decision Inbox, notifies their phone (Telegram card + email for long context), blocks until they answer by tap or reply, and returns their answer. Not for tool-permission yes/no prompts (those are handled automatically by the PermissionRequest gate).
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/ask.cjs *)
---

# verqury-ask — relay a clarifying question to the owner

Use this when you need a **decision from the owner** mid-build and they may not be at
the desk. Verqury carries the question to their phone and brings back their answer.
**You surface the question; the owner decides — never answer on their behalf.**

## When to use
- A genuine fork only the owner can resolve: a design/UX choice, an ambiguous spec, a
  naming/scope call, "approach A or B?".
- Prefer discrete `--options` when the choice is between a few known answers; leave them
  off for an open question (the owner replies with free text).

## When NOT to use
- **Tool-permission prompts** (run this command? write this file?) — those fire Claude
  Code's `PermissionRequest` gate automatically; do not wrap them in a question.
- Trivia you can answer yourself, or anything you'd normally just decide. Asking has a
  real cost (it interrupts the owner), so ask only when it genuinely matters.

## How to ask

Run the bundled runner. It **blocks** until the owner answers, then prints their answer
as its output — read that and continue.

```
node ${CLAUDE_SKILL_DIR}/scripts/ask.cjs \
  --summary "One-line question shown on the phone" \
  --options "Option A|Option B|Option C" \
  --project <verqury-project-slug>
```

For a long or context-heavy decision, put the full explanation in a file and pass
`--body-file` with `--needs-context` — Verqury then also **emails** the full context
(the phone card degrades to "context in email #code, respond here"):

```
node ${CLAUDE_SKILL_DIR}/scripts/ask.cjs \
  --summary "Short version of the question" \
  --options "Yes|No" \
  --body-file /tmp/decision-context.md \
  --needs-context \
  --project <verqury-project-slug>
```

Flags: `--summary` (required, one line) · `--options "a|b|c"` (optional, pipe-separated)
· `--body "<text>"` or `--body-file <path>` (long context) · `--needs-context` (also send
the email) · `--project <slug>` (echoes the answer into that project's timeline).

## What comes back
- The owner's answer, printed on stdout (a tapped option, or their typed reply). Act on it.
- If **no answer arrives** within the window (~20 min), the runner prints a short "ask at
  the desk" note instead. That is not an answer — do not invent one; surface it to the
  owner directly, or make the smallest safe assumption and flag it for review.

## How it works (so you can reason about failures)
The runner writes a markdown record to Verqury's Decision Inbox (`<data-root>/approvals/`)
and polls it. The Verqury app is what sends the Telegram card / email and writes the
owner's answer back into the record. If the app is closed the question still files (answer
it in the desktop Approvals tab) but no phone notification is sent — it will simply time
out to the desk fallback. Everything is file-mediated; no keystrokes are injected.
