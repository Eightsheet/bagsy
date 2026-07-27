# Workboard

Agent coordination service: claim what you're working on in a shared repo so other agents/humans don't duplicate work.

## Stack

- **API + Web:** Hono on Railway (`apps/api`)
- **CLI:** `workboard` (`packages/cli`)
- **Auth:** WorkOS AuthKit (orgs) + API tokens; `DEV_AUTH=1` for bootstrap
- **Tenancy:** Hybrid C — org-gated boards, repo as key, optional GitHub verify

## Quick start (local)

```bash
pnpm install
pnpm --filter @repo-org/shared build

# Postgres required
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/repo_org
export DEV_AUTH=1
export SKIP_GITHUB_VERIFY=1
export APP_URL=http://localhost:3000

pnpm --filter @repo-org/api db:generate
pnpm --filter @repo-org/api db:migrate
pnpm --filter @repo-org/api dev
```

In another shell:

```bash
pnpm --filter @repo-org/cli build
pnpm --filter @repo-org/cli exec node dist/index.js --help
```

1. Open http://localhost:3000 → Dev sign-in → create org → link repo → create API token  
2. `workboard login --token wb_…`  
3. `workboard status` / `workboard claim -t "…" -f src/x.ts`

## CLI

```bash
workboard login                 # device flow in browser
workboard login --token TOKEN
workboard status
workboard claim -t "Title" -f path/a -f path/b [--roadmap REF] [--strict]
workboard heartbeat --note "…"
workboard release current
workboard link-repo owner/name
```

Config: `~/.config/repo-org/config.json`  
Env: `WORKBOARD_API_URL`, `WORKBOARD_TOKEN`

## Agent skill

See [.cursor/skills/workboard/SKILL.md](.cursor/skills/workboard/SKILL.md).

## Env (Railway)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres (Railway plugin) |
| `APP_URL` | Public URL |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | AuthKit |
| `DEV_AUTH=1` | Email/dev login (bootstrap only) |
| `SKIP_GITHUB_VERIFY=1` | Soft-skip GitHub repo verify |
| `GITHUB_VERIFY_TOKEN` | Optional PAT for verify |

## API

- `GET /v1/me`
- `GET /v1/repos/:owner/:repo/claims`
- `POST /v1/repos/:owner/:repo/claims`
- `POST /v1/claims/:id/heartbeat`
- `POST /v1/claims/:id/release`
- `POST /v1/repos` — link repo
