# 0007. Packets are global reusable templates, not per-project files

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The build plan's data-layout sketch (§3) nested packet templates under each
project (`projects/<slug>/packets/`). But the Phase 5 feature is a session
*bootstrapper*: pick a project, pick a packet, render the packet **against** that
project via `{{project.*}}` variables. The plan also calls for three *starter*
packets (chat-ideation, terminal-build, browser-task) shipped with the product.
A packet nested inside one project can't be a reusable, project-agnostic template,
and shipping starters into every project would duplicate them N times.

## Decision

Packets live at the top level of the data root, `<root>/packets/<slug>.md`, as
global reusable templates (a sibling of the global `guidance/` library). The project
is a render-time parameter. `init` seeds the three starter packets into every data
root. Rendering resolves `{{project.*}}`, `{{includes}}` (from frontmatter `includes`
globs, with `{{project.slug}}` substituted), and `{{log:N}}` against the chosen
project.

## Consequences

- One packet renders for any project — matches "pick project → pick packet → render".
- Starter packets ship once and apply everywhere.
- The `includes` globs can still reach project-scoped guidance
  (`projects/{{project.slug}}/guidance/*.md`), so per-project selection is preserved
  through globbing rather than through location.
- Deviates from the §3 tree sketch; §3 stays as the original intent, this ADR records
  the corrected layout.
- If per-project *private* packets are ever wanted, they can be added later as a
  scoped variant (like guidance scopes) without moving the global ones.

## Alternatives considered

- **Per-project packets (as §3 sketched)** — rejected: breaks reusability and the
  `{{project.*}}` parameterization, and duplicates the starters.
