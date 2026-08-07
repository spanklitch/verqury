# 0013. Session metrics are harvested from Claude Code transcripts into per-session files

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Three ideas were filed into the `idea` lane on 2026-08-07 — a **Time Tracker** ("how much
build time is in a system"), a **Token Tracker** ("harvest token usage per session"), and a
**Lines of Code Counter**. They read as three features but they are one question: *what did
this project actually cost to build?* Answering it needs a per-session record, which Verqury
has never had. Sessions are currently invisible: a project's history is its memory log, its
tasks, and its artifacts — all things a human or agent wrote deliberately. Nothing measures
the build itself.

Verqury cannot instrument what it does not run. It is a *layer*, not an IDE (plan §1) — the
build happens in Claude Code, in a terminal Verqury may only be hosting. So the metrics have
to come from something Claude Code leaves behind. Two sources exist, and choosing between
them is the actual decision:

1. **The transcript JSONL.** Claude Code writes one file per session to
   `~/.claude/projects/<slugified-cwd>/<session-id>.jsonl`. Every assistant record carries a
   `usage` block (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`, `model`), and every record carries a `timestamp` and a `cwd`.
   The hooks documentation documents the *path* (`transcript_path`) but pointedly does not
   document the *contents* as a stable interface — it steers hooks needing conversation text
   toward `last_assistant_message` on `Stop` instead.
2. **OpenTelemetry.** Claude Code exports `claude_code.token.usage`,
   `claude_code.cost.usage` (in USD), `claude_code.lines_of_code.count`,
   `claude_code.session.count`, and `claude_code.commit.count` as documented, supported
   metrics. This is the official interface, and on paper it answers all three ideas —
   including cost, which raw token counts cannot.

OTel is the better-specified source and was seriously weighed. It loses on three points that
are decisive *here*:

- **It is prospective only.** Metrics exist from the moment telemetry is switched on. The
  transcripts on this machine already hold **9 sessions, 96.5 h wall-clock and ~234 M
  cache-read tokens** for this project alone. OTel starts every project at zero.
- **The local exporter binds a fixed port.** The collector-free setup has Claude Code serve
  Prometheus metrics on `localhost:9464`. Verqury deliberately runs *concurrent* sessions
  (ADR-0010, tabs one per project/build); several Claude Code processes cannot share one
  port. Transcripts are one file per session and have no such contention.
- **It requires per-session opt-in.** `CLAUDE_CODE_ENABLE_TELEMETRY=1` must be set for every
  session. Any session started without it is invisible forever, and Verqury cannot go back
  and fill the hole.

Where the metrics *land* is settled by ADR-0001: truth is markdown, SQLite is a rebuildable
index. A metric that lives only in the index is wrong by construction.

A last question is what "build time" means. Naively it is the span from a session's first
record to its last. Measured across this project's own transcripts, that reads **96.5 h** —
against **20.6 h** when idle gaps longer than 15 minutes are excluded. The wall-clock figure
is mostly a laptop left open overnight. It is not a smaller version of the truth; it is a
different and misleading claim.

## Decision

We will **harvest** session metrics from the Claude Code transcript JSONL, post-hoc, and
write one markdown record per session to **`projects/<slug>/sessions/<id>.md`** — a fourth
file-backed collection beside `artifacts/`, `tasks/`, and `memory/`, per ADR-0001.

- **The join is `cwd`, not the directory slug.** A project's existing `repo` frontmatter
  field is matched against the `cwd` recorded inside each transcript (a prefix match, so a
  session run from a subdirectory still counts). The slugified-path directory name is used
  only as a *fast path* to locate candidate files. No new project schema field is added.
- **Both time figures are recorded, one is displayed.** `activeSeconds` (summing inter-record
  gaps, each capped at a 15-minute idle threshold) and `wallSeconds` (first record to last)
  both go in the frontmatter. The UI shows active time.
- **Harvest is idempotent and retroactive.** Re-running it re-reads transcripts and updates
  records in place; the first run backfills all history that exists on disk.
- **Parsing is defensive.** Unreadable lines, absent `usage` blocks, and unknown fields are
  skipped rather than fatal. A malformed transcript yields a partial record, never an error.

OpenTelemetry is **not** adopted now, and is recorded here as the intended upgrade path for
**cost** and **lines of code**, where it is plainly better than anything we can derive.

## Consequences

- **History is free on day one.** The first harvest backfills every session already on disk,
  so the meter opens with a real number instead of a zero that has to earn its way up.
- **Harvested numbers become ours.** Once written, a session record is file-backed truth. If
  Claude Code changes its transcript format, *future* harvesting breaks and past history
  survives untouched — the failure is visible and bounded rather than silently destructive.
- **We are reading an undocumented internal format on purpose.** This is the central risk and
  it is accepted knowingly, mitigated by defensive parsing and by the durability above. It
  must not spread: nothing outside the harvester may read the transcript.
- **No new global hook, no resident scraper, no port.** Harvesting is a pull over files that
  already exist. Nothing has to be running while a build happens, which keeps the relay's
  hard-won property (outbound needs no app) from being undermined by a metrics daemon.
- **The current session reads slightly stale.** The docs note the transcript is written
  asynchronously and lags the live conversation, so an in-progress session under-reports
  until it settles. Acceptable for a build-time meter; it would not be for anything billing.
- **Token counts are not cost.** Four raw counters are recorded, not dollars. Cache reads
  dominate the totals by two orders of magnitude and are the cheapest tokens, so presenting
  a single summed "tokens" number would badly mislead. Cost waits for OTel.
- **`activeSeconds` is a defensible estimate, not a stopwatch.** The 15-minute threshold is a
  judgement call: a genuine 20-minute think at the keyboard is scored as idle. It is recorded
  alongside `wallSeconds` so the raw span is never lost and the rule can be re-tuned by
  re-harvesting.
- **Lines of code stays unbuilt.** It is the one idea of the three that this substrate does
  not answer, and the git-based alternative (`git log --numstat` inside a session window)
  is approximate by construction — commits do not align to session boundaries and
  uncommitted work is invisible. OTel's counter is the better answer; the task stays filed.

## Alternatives considered

- **OpenTelemetry / Prometheus exporter** — rejected *for now*, per the three points above:
  no retroactive history, a single fixed port against ADR-0010's concurrent sessions, and
  per-session opt-in. Revisit when cost or LOC becomes the priority, or if the transcript
  format breaks; it is the documented interface and the intended successor.
- **A `SessionStart`/`SessionEnd` hook writing records live** — rejected: adds a third global
  hook to `~/.claude/settings.json` for every Claude Code session on the machine, yields
  nothing retroactive, and would have to reconstruct token totals from the same transcript
  anyway. The blast radius of a buggy global hook is the whole machine.
- **Storing metrics only in the SQLite index** — rejected outright by ADR-0001.
- **Wall-clock as the headline time** — rejected: overstates by ~5× on real data.
