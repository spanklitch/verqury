# 0012. Free + open source, with a standalone verqury.com web companion

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

Verqury reached feature-complete (v0.6.0) as a **private** repo. Two questions came due at
once: how to *release* it, and whether a local-first desktop app should have any web presence.

- The paying market for a **local-first, Linux-only, Electron dev tool** is tiny. Charging
  would add real business overhead (support obligation, taxes, download gating, unenforceable
  licensing on a local app) for near-zero revenue.
- The codebase's value is as a **portfolio**: readable ADRs, CHANGELOG, engineering notes — the
  reasoning trail is the product for a reviewer or acquirer.
- A no-account / no-telemetry app still benefits from a way to *tell users about new versions*
  and *hear feature ideas* — without compromising that stance.

## Decision

We will release Verqury **free and open source under MIT**, positioned as a self-promotion /
portfolio piece, and give it a **standalone showcase site at verqury.com on Cloudflare Pages**
(the domain already lives on Cloudflare for email).

- The site is **badged as part of the FlawedWorks family** but is its own front door — **not** a
  page nested under flawedworks.com.
- The app treats the site as a **web companion**: it links out, in the user's browser, to
  `verqury.com/whats-new/` ("Check for updates") and `verqury.com/ideas/` ("Share an idea") —
  closing an app↔web loop. These two URLs are a **stable contract** the app depends on.
- Updates stay **manual** (no telemetry, no auto-update). The ideas board **ships light**
  (GitHub Discussions) and can grow into a Cloudflare-native owned loop (Pages Functions + KV)
  later.
- Monetization stays a **later, additive** option (sponsor / donate), never gating the core.

## Consequences

- **Easier:** maximal portfolio signal (public reasoning trail); zero business overhead; a real
  front door + release channel; a coherent "layer, not IDE" story that now extends to the web.
- **Harder / accepted:** the repo must stay scrubbed for going-public — secrets *and* PII,
  including **pixel-PII baked into screenshots** (see engineering-notes §9); the app now depends
  on two public URLs as a contract; a web presence adds a small maintenance surface (a static
  site plus a light feedback backend).
- **Anti-goal intact:** the site is a **showcase, not a storefront**; the app stays local-first,
  single-user, no telemetry.

## Alternatives considered

- **Paid product** — rejected: tiny addressable market, high overhead, unenforceable licensing
  on a local app.
- **A page under flawedworks.com** — rejected: Verqury warrants its own brand + domain; owning
  the `.com` strengthens name ownership (first-to-market, ™ not ®; see `/notice`).
- **Netlify (the flawedworks precedent) vs. Cloudflare Pages** — chose Cloudflare: the domain +
  email already live there, and Pages Functions/KV back the future owned ideas loop.
- **No web presence (GitHub README only)** — rejected: loses the update channel and the two-way
  idea dialog, and undersells the marketing capability the site is meant to demonstrate.

Full working context, sitemap, theme, and IP posture: `docs/website.md`.
