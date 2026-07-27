# Workboard

Agent coordination service: claim what you're working on in a shared repo so other agents/humans don't duplicate work.

## Model

- **Team** (WorkOS organization) = people who share a claim board. Membership is the access gate.
- **Repos belong to a team** — link once to put a remote on that team’s board.
- **CLI follows `git remote`** — `status` / `claim` pick the team that has this remote linked. If it’s linked in more than one of your teams, the CLI asks (or use `--org slug`).

## Install CLI

```bash
npm install -g workboard
# or without installing:
npx workboard --help
```

From a GitHub Release tarball (no npm publish required):

```bash
npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.0/workboard-0.1.0.tgz
```

Default API: `https://repo-org-production.up.railway.app`  
Override with `WORKBOARD_API_URL`.

For agents / `AGENTS.md` / Cursor skill: see [AGENTS.md](./AGENTS.md) and [.cursor/skills/workboard/SKILL.md](./.cursor/skills/workboard/SKILL.md).

## Stack

- **API + Web:** Hono on Railway (`apps/api`)
- **CLI:** `workboard` (`packages/cli`) — published as npm package `workboard`
- **Auth:** WorkOS AuthKit + API tokens for CLI/agents
- **Tenancy:** Org-gated boards; repo as key within a team; optional GitHub verify

## Quick start (local API)

```bash
pnpm install
pnpm --filter @repo-org/shared build

# Postgres required
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/repo_org
export WORKOS_API_KEY=…
export WORKOS_CLIENT_ID=…
export APP_URL=http://localhost:3000

pnpm --filter @repo-org/api db:generate
pnpm --filter @repo-org/api db:migrate
pnpm --filter @repo-org/api dev
```

CLI against local API:

```bash
pnpm --filter workboard build
WORKBOARD_API_URL=http://localhost:3000 node packages/cli/dist/workboard.js login
```

1. `workboard login` → browser WorkOS AuthKit  
2. `workboard link-repo` (once per team board)  
3. `workboard status` / `workboard claim -t "…" -f src/x.ts`

Create a team or invite a teammate from the web UI — Workboard creates the WorkOS org and makes you admin.

WorkOS redirect URIs:

- Local: `http://localhost:3000/auth/callback`
- Prod: `https://repo-org-production.up.railway.app/auth/callback`

## CLI

```bash
workboard login
workboard status [--org slug]
workboard claim -t "Title" -f path/a [--strict] [--org slug]
workboard heartbeat --note "…"
workboard release current
workboard link-repo [--org slug]
workboard whoami
```

Config: `~/.config/repo-org/config.json`

## Releases

- Tag `vX.Y.Z` → GitHub Actions builds the CLI, attaches `workboard-X.Y.Z.tgz` to the Release, and publishes to npm when `NPM_TOKEN` is set.
- `main` is protected: PRs required, no force-push, no branch deletion.

## Security

See [SECURITY.md](./SECURITY.md). Making the repo public does **not** open the hosted API — auth + team membership still required.

## Env (Railway)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres (Railway plugin) |
| `APP_URL` | Public URL |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | AuthKit (required) |
| `SKIP_GITHUB_VERIFY=1` | Soft-skip GitHub repo verify |
| `GITHUB_VERIFY_TOKEN` | Optional PAT for verify |

## API

- `GET /v1/me`
- `GET /v1/repos/:owner/:repo/context`
- `GET|POST /v1/repos/:owner/:repo/claims` — header `X-Workboard-Org: slug`
- `POST /v1/claims/:id/heartbeat|release`
- `POST /v1/repos` — link repo
