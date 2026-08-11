# Architecture Decision Records

This directory records the significant decisions behind Verqury — the *why*, not just the
*what*. Each record is a short, immutable note: the context at the time, the decision taken,
and the consequences accepted. When a decision is reversed, we don't edit the old record — we
add a new one that supersedes it, so the reasoning trail stays intact.

Format follows [Michael Nygard's ADR pattern](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
New records start from [`0000-template.md`](0000-template.md) and take the next number.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-files-are-the-database.md) | Files are the database; SQLite is a rebuildable index | Accepted |
| [0002](0002-core-library-plus-cli-electron-shell.md) | Core logic is a plain Node library + CLI; Electron is a shell | Accepted |
| [0003](0003-electron-for-desktop-shell.md) | Electron for the desktop shell | Accepted |
| [0004](0004-adapters-are-launch-handoff-config.md) | Adapters are launch/handoff config, not API integrations | Accepted |
| [0005](0005-vanilla-frontend.md) | Vanilla-leaning frontend, no framework | Accepted |
| [0006](0006-search-runs-out-of-process.md) | Search runs out-of-process; Electron never loads better-sqlite3 | Accepted |
| [0007](0007-packets-are-global-templates.md) | Packets are global reusable templates, not per-project files | Accepted |
| [0008](0008-packaged-search-uses-electron-node.md) | Packaged search runs the CLI under Electron's embedded node | Accepted |
| [0009](0009-embedded-terminal.md) | Embed a terminal — Verqury becomes an agent workbench | Accepted |
| [0010](0010-multi-session-terminal.md) | Multi-session terminal — tabs, one per project/build | Accepted |
| [0011](0011-remote-decision-relay.md) | Remote decision relay — approve builds from the phone via Here/Away + hooks | Accepted |
| [0012](0012-open-source-and-web-companion.md) | Free + open source, with a standalone verqury.com web companion | Accepted |
| [0013](0013-session-metrics-harvested-from-transcripts.md) | Session metrics are harvested from Claude Code transcripts into per-session files | Accepted |
| [0014](0014-lines-of-code-and-cost-via-a-local-otlp-receiver.md) | Lines of code and real cost come from OpenTelemetry, pushed to a local receiver | Accepted |
| [0015](0015-one-app-per-data-root.md) | One app per data root, and runtime state belongs to the instance that wrote it | Accepted |
