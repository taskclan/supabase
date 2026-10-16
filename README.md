# Taskclan Cloud

The console for **[Taskclan Cloud](https://cloud.taskclan.com)** — ship a repository to a URL, run it in a container, and get a managed Postgres database, a SQL editor, and deploy history in one place.

This repository is the Taskclan Cloud dashboard. It is a fork of [Supabase Studio](https://github.com/supabase/supabase), reskinned and rewired as the Taskclan control panel.

**[cloud.taskclan.com](https://cloud.taskclan.com)** · **[taskclan.com](https://taskclan.com)**

## What you can do in it

- **Ship from a repo.** Push a branch or press Deploy. Builds run on Taskclan's runners, roll the container, and keep the full history of what shipped and when — with rollbacks.
- **A database per app.** Each app gets a managed Postgres database, with the Table editor, SQL editor, schema browser, and policies — the Studio surfaces, pointed at the app's own database.
- **Kin, the assistant.** The in-product AI teammate. Ask about your data, write SQL, or explore a project. Kin runs on Taskclan Intelligence.
- **One control plane.** Organizations, members, billing, connection details, and deploy settings for every app.

## How it's built

- **`apps/studio`** is the app that ships. The rest of the monorepo is the upstream Supabase packages it builds on (`packages/ui`, `packages/pg-meta`, and so on).
- It deploys as a **Cloudflare Worker** named `taskclan-cloud-console`, served at **cloud.taskclan.com**.
- It runs in **non-platform** mode (`IS_PLATFORM=false`): the Supabase-hosted-platform surfaces are off, and it talks to Taskclan's control plane and to Taskclan Intelligence instead of Supabase's backend.
- **Per-app isolation.** Every database query resolves the app's own scoped Postgres connection from the app `ref` and the signed-in caller, so one app's editor never reaches another app's — or the control plane's — database.
- **Sign-in** is GitHub, Google, or a magic link.
- **Design** matches [taskclan.com](https://taskclan.com): the Sitterly system (cream and violet) with the Geist typeface.

## Deploying

- The deploy branch is **`taskclan/sitterly-theme`**. Merging a PR into it (or pushing to it) **auto-deploys** to Cloudflare through [`.github/workflows/deploy-console.yml`](./.github/workflows/deploy-console.yml). There is no manual deploy step.
- `master` is kept in sync from `taskclan/sitterly-theme`.
- Non-app changes (like this README) don't trigger a deploy — the workflow is path-filtered to `apps/studio/**`, `packages/**`, and the Worker config.

## Development

Requires **Node >= 22.13** and **pnpm 11**.

```bash
pnpm install
pnpm dev:studio      # the console → http://localhost:8082
```

Checks:

```bash
pnpm --filter studio run typecheck   # next typegen + tsc for the console
pnpm test:studio                     # Studio unit tests (vitest)
pnpm typecheck                       # every package
```

For the full monorepo setup see [`DEVELOPERS.md`](./DEVELOPERS.md); for Studio conventions see [`apps/studio/AGENTS.md`](./apps/studio/AGENTS.md).

## Relationship to Supabase

Taskclan Cloud's console is a fork of [Supabase Studio](https://github.com/supabase/supabase), an open-source Postgres dashboard. The data surfaces — Table editor, SQL editor, schema, policies, API docs — are Studio's. Taskclan adds the deploy and control-plane console, Kin, per-app connection isolation, the Taskclan sign-in and billing flows, and the Sitterly theme. Upstream documentation is at [supabase.com/docs](https://supabase.com/docs).

## License

[Apache 2.0](./LICENSE), unchanged from upstream Supabase.
