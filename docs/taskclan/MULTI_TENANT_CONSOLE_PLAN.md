# Make cloud.taskclan.com the real multi-tenant Cloud console

Goal: turn `cloud.taskclan.com` (the Supabase-Studio fork, `apps/studio`) into the
full multi-tenant Taskclan Cloud console, and retire the engine's embedded
console at `engine.taskclan.com/cloud`.

## Where we are today (2026-10-10)

- `cloud.taskclan.com` is this fork, deployed as its own Cloudflare Worker.
- It runs in **self-hosted mode** (`NEXT_PUBLIC_IS_PLATFORM` is unset), so the
  browser calls the local `pages/api/platform/*` routes.
- Those routes reach the engine through `lib/taskclan/*` using **one
  `sk_cloud_*` API key**, which resolves to **exactly one Cloud org** — the key
  *is* the scope. So the console shows a single org (currently Aiya). The
  `/org/[slug]` slug is cosmetic (derived from the org's name), not a lookup.
- Auth is its **own** Supabase project (`xguihxuzqibwxjnimxev`), separate from
  the engine's user base (`ydpfystsgydquencpfyy`).
- No server-side membership/role enforcement runs on the org routes.
- Only `projects` and a stubbed `billing/subscription` are engine-backed today;
  team/members, domains, etc. are not wired up here.

The engine already has the hard part built: `/api/cloud/v1/*` endpoints that
authenticate a **user** (bearer token), scope to an org via the
`x-taskclan-org` header (id or slug, only if the user is a member), and enforce
RBAC. The engine's old `/cloud` console drove exactly these. We should reuse
them rather than reinvent org scoping in the console.

## The crux: the auth + org bridge

A console user must act as **their own Cloud identity across their own orgs**,
not as one fixed key. Two ways:

### Recommended — unify on the engine's identity, forward the user token
- The console authenticates users against the **engine's** Supabase auth
  (`ydpfystsgydquencpfyy`), so a console user *is* an engine Cloud user.
  (daniel@taskclan.com already exists there and owns Aiya.)
- The console's data layer calls the engine `/api/cloud/v1/*` directly with the
  **user's** bearer token plus `x-taskclan-org: <slug|id>`. The engine then does
  org resolution + RBAC exactly as it already does.
- The single `sk_cloud_*` key is kept only for infra reads that are genuinely
  app-wide, not for user actions.
- Pros: least new surface; reuses the engine's tested RBAC; multi-tenant falls
  out for free. Cons: existing `xguihxuzqibwxjnimxev` logins change (acceptable
  for a WIP console); CORS/token plumbing between the two origins.

### Alternative — impersonation via a privileged key
- Keep the console's own auth; give the console a privileged engine key and a
  new engine auth mode that trusts the console to assert "act as user X on org
  Y". More engine work, a new trust boundary, and a second RBAC implementation
  to keep in sync. Not recommended.

## Phases

1. **Auth + multi-org foundation** (the enabler)
   - Console auth → engine identity (unify, per above).
   - Data layer: call engine `/api/cloud/v1/*` with the user token + org header.
   - List the signed-in user's **real** orgs; an org switcher; `/org/[slug]`
     resolves to the real org and gates on the user's role.
   - Deliverable that proves it end to end: sign in as daniel@taskclan.com and
     see *his* orgs (not a fixed one), switch between them.

2. **Port core org pages on real data**: overview/apps, team & members, billing
   (confirm the card flow writes to the engine's Stripe customer), usage.

3. **Port the two features** (trivial once Phase 1 exists — the engine APIs are
   already shipped): **Buy a domain** (`/api/cloud/v1/domains/*`) and **Transfer
   ownership** (`/api/cloud/v1/orgs/[id]/transfer`). Transfer ownership only
   makes sense after real per-user identity exists.

4. **Retire `engine.taskclan.com/cloud`**: once parity is reached, redirect it
   to `cloud.taskclan.com` (keep the pages in the tree as the rollback).

## Risks / notes

- Auth migration changes existing console sessions — fine while it's WIP, but
  do it deliberately.
- This fork is mid-migration to TanStack Start; new `pages/**` need a `routes/**`
  wrapper (see `TANSTACK_MIGRATION.md`).
- Cross-origin token forwarding (console origin → engine origin) needs CORS +
  careful token handling (never expose a service key to the browser).
- Billing: confirm the Studio billing card UI and the engine share one Stripe
  customer per org (verified for Aiya today: the card added in the console is
  the default on the engine's live Stripe customer).

## First step

Phase 1 is the whole game. Everything in phases 2–4 is mechanical once a console
user can act as themselves across their orgs through the engine API.
