# 0014. Lines of code and real cost come from OpenTelemetry, pushed to a local receiver

- **Status:** Proposed
- **Date:** 2026-08-09

## Context

[ADR-0013](0013-session-metrics-harvested-from-transcripts.md) answered two of the three metric
ideas by harvesting Claude Code's transcripts: the project meter now reads build time, token
totals and a session count, and it **backfilled every past session** because the transcripts were
already on disk. The third idea — a **Lines of Code Counter** — was left in the `todo` lane,
because the transcripts do not record diff sizes. Nothing in a transcript says how much code a
session actually wrote.

Git is the obvious-looking substitute and is a trap. `git log --numstat` counts commits, and
commits do not align to session boundaries: one session may produce three commits, or none, and
work still in the working tree is invisible. A meter built on it would report zero for the most
productive session of the week.

That leaves Claude Code's own telemetry, which is the *documented* interface. Verified against
the current docs on 2026-08-09 (not from memory — this surface moves):

- `claude_code.lines_of_code.count`, with attributes `type: added | removed` and `model`
- `claude_code.cost.usage`, **in USD** — the honest answer to a question raw token counts cannot
  answer, since cache reads dwarf output tokens and are the cheapest of the four counters
- `claude_code.active_time.total`, an official cross-check against the meter's own active-time
  arithmetic
- exporters `otlp | prometheus | console | none`, selected by `OTEL_METRICS_EXPORTER`, with
  telemetry gated behind `CLAUDE_CODE_ENABLE_TELEMETRY=1` per session

ADR-0013 weighed OTel and rejected it on three objections. Two still stand. **One was wrong, and
correcting it is what makes this decision possible:** that record says "the local exporter binds a
fixed port … several Claude Code processes cannot share one port," and treats that as
disqualifying against [ADR-0010](0010-multi-session-terminal.md)'s concurrent sessions. That is
true of the **Prometheus** exporter specifically, which is *pull*-based — each process must stand
up its own scrape endpoint on `localhost:9464`, and the second one loses. The **OTLP** exporter is
*push*-based: every session posts to one endpoint. Twenty concurrent sessions push into one
listener with no contention at all. The collision was an artifact of exporter choice, not a
property of OpenTelemetry.

The two surviving objections are real and are accepted below: OTel is **prospective only** (no
history, ever) and it requires **per-session opt-in**.

## Decision

We will adopt OpenTelemetry as a **second, complementary** metrics source. Specifically:

1. **ADR-0013 is not superseded.** Transcripts remain authoritative for build time, tokens and
   session history — they are the only source with a past. OTel supplies only what transcripts
   cannot: lines of code and real cost.
2. **Transport is OTLP over HTTP with JSON**, pushed by each session to a receiver Verqury runs on
   loopback. Not Prometheus (pull, fixed port, collides with concurrent sessions).
3. **The receiver is a plain `node:http` listener in the Electron main process** — no collector
   binary, no new heavy dependency. It parses the POST, extracts the handful of metrics we care
   about, and discards the rest. Same shape as the Telegram long-poll already running there.
4. **The receiver is optional and off by default**, binds **loopback only**, and its port is
   configurable in `config.json`. Verqury must behave identically with it switched off. Binding
   OTLP's conventional 4318 unconditionally would collide with any real collector on the machine.
5. **Enablement is Verqury-only.** Adapters and bootstrap packets export
   `CLAUDE_CODE_ENABLE_TELEMETRY=1` and the OTLP endpoint for sessions **Verqury launches**. A
   session started in a plain terminal is not counted. This is a deliberate limit on blast radius,
   not an oversight — see Alternatives.
6. **Storage joins on `session.id` into the existing `projects/<slug>/sessions/<session-id>.md`
   record** (ADR-0001: files are the database). One record per session, two sources feeding it.
   The join rests on `session.id` equalling the transcript's basename; that must be **verified on
   live data before the join is relied upon**, not assumed.
7. **The meter labels the LOC figure by start date** — "since Aug 2026" — and never shows a bare
   zero. A mature project reading `20.6h · 2.0M out · 9 sessions · 0 lines` looks broken rather
   than newly instrumented.
8. **Identity attributes are dropped at the source** via the metrics cardinality controls. The
   standard attribute set includes `user.email`; nothing identifying is written into a record.
   This repo is public and has already needed two PII purges.

## Consequences

**What gets better.** The meter finally answers all three original ideas. Cost stops being a
guess: `cost.usage` is denominated in USD by the vendor that does the billing, which no amount of
token arithmetic on our side can reproduce. `active_time.total` gives an independent check on the
15-minute-idle-gap heuristic ADR-0013 invented — if the two disagree badly, the heuristic is
wrong and we will know.

**What we accept.**

- **No backfill, ever.** LOC starts at zero on the day telemetry is switched on. The build-time
  meter opened with real history; this number will not. Decision 7 is the mitigation, and it is a
  label, not a fix.
- **The LOC figure is a floor, not a total.** Sessions run outside Verqury are invisible, and
  *nothing announces that they were missed*. The number under-reports silently by design. It must
  never be presented as a complete account of a project's code.
- **A new always-on moving part.** Everything Verqury does today is files plus a poll loop. A
  listener has a port, a lifecycle, and failure modes none of the existing code has — including
  starting while a stale instance still holds the port. Decision 4 keeps it optional so a failure
  degrades the meter rather than the app.
- **An open local port accepting POSTs**, however narrow. Loopback-only binding is load-bearing,
  not a nicety.
- **A second undocumented-contract risk**, of a different shape than ADR-0013's. There the risk
  was transcript *contents*; here it is that the metric names, attributes and the `session.id`
  join are a published interface that can still change under us. Containment is the same: one
  module parses it, and a parse failure degrades to a missing number rather than an exception.

**What we are explicitly not doing.** Not enabling telemetry globally. Not running a collector.
Not migrating time or tokens off transcripts — that would trade a source with history for one
without.

## Alternatives considered

- **`git log --numstat`.** Rejected: commits do not align to session boundaries and uncommitted
  work is invisible. It measures the repository, not the build.
- **The Prometheus exporter.** Rejected: pull-based, one fixed port per process, head-on collision
  with ADR-0010's concurrent sessions. This is the objection ADR-0013 recorded against OTel as a
  whole; it belongs to this exporter alone.
- **The OpenTelemetry Collector binary.** Rejected: a second daemon to install, version and
  supervise, for a job a few dozen lines of `node:http` do. Verqury ships as one AppImage.
- **Enabling telemetry globally in `~/.bashrc`.** Rejected, and this was the live question. It
  would make the numbers complete, including sessions Verqury never launched. It would also switch
  telemetry on for **every** Claude Code session on the machine, work-adjacent ones included. The
  data stays on loopback either way, so this is a blast-radius call rather than a privacy one —
  and a personal tool's build meter does not justify instrumenting everything on the box. We take
  the under-count instead, and label it honestly (decision 7, and the "floor, not a total"
  consequence above).
- **Waiting for an official historical export.** Rejected as indefinite. Nothing published
  suggests one is coming, and the meter is useful now.
