# 0004. Adapters are launch/handoff config, not API integrations

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The AI tool landscape (terminal agents, editor agents, browser agents, chat
interfaces) changes faster than any integration code could track. Verqury's
requirement is to route work to the best surface for each task and remain durable as
surfaces change. Direct API integrations would couple the product to providers,
require key management, and drift constantly.

## Decision

We will define an AI surface ("adapter") purely in configuration: a slug, a label, a
launch command (e.g. open a terminal at the project repo running an agent), a handoff
packet template, and notes. Verqury's MVP performs no model API calls — handoff is via
rendered context packets (clipboard or file), and results return through artifact
capture and completion reports.

## Consequences

- Adding or swapping an AI tool never requires a code change — provider-churn
  insurance by design.
- No API keys, SDKs, or streaming code in the MVP; smaller attack and maintenance
  surface.
- Harder: no automated round-trips — a human (or the agent itself, via files) closes
  the loop. Accepted: Verqury is a routing and record layer, not an orchestrator.
- Direct API adapters remain a post-0.1 candidate if a stable, high-value case
  emerges.

## Alternatives considered

- **Provider SDK integrations** — rejected for MVP: constant drift, key management,
  and it pulls Verqury toward becoming another chat interface (an explicit anti-goal).
