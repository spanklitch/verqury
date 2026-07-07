# 0001. Files are the database; SQLite is a rebuildable index

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

Velora's core promise is durable project memory that survives rapid churn in AI tools.
Terminal coding agents (Claude Code, Cursor-based agents) work directly on local files;
chat and browser surfaces work on pasted text. If Velora stored its truth in an
application database, every current and future agent would need an adapter to read or
write project memory, and the operating record would die with the app.

## Decision

We will store all durable data — project narratives, decisions, logs, guidance,
artifacts, tasks, packet templates — as markdown files with YAML frontmatter in a
conventional directory tree under a user-owned data root. SQLite (FTS5) exists only as
a search index that can be deleted at any time and fully rebuilt by rescanning the
files. No feature may store truth only in SQLite.

## Consequences

- Any terminal agent gets native read/write access to project memory — the
  model-agnosticism requirement is satisfied structurally, not via integrations.
- The record is git-versionable, greppable, and fully usable if Velora disappears.
- Harder: concurrent writes (app + agent editing the same file) must be handled with
  a file watcher and last-write-wins semantics rather than transactions.
- Harder: schema evolution is convention-based (frontmatter keys), not migrations.
- We explicitly accept slower structured queries than a real database would give;
  the FTS index covers the search cases that matter.

## Alternatives considered

- **SQLite as source of truth with export** — rejected: exports go stale, agents
  would need an API, and lock-in contradicts the adaptability requirement.
- **Plain files with no index** — rejected: cross-project search over thousands of
  artifacts needs FTS to stay low-friction.
