# Workboard

Agent coordination service: claim what you're working on in a shared repo so other agents/humans don't duplicate work.

## Stack

- **API + Web:** Hono on Railway (`apps/api`)
- **CLI:** `workboard` (`packages/cli`)
- **Auth:** WorkOS AuthKit + API tokens for CLI/agents
- **Tenancy:** Hybrid C — org-gated boards, repo as key, optional GitHub verify

## Quick start (local)

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

In another shell:

```bash
pnpm --filter @repo-org/cli build
pnpm --filter @repo-org/cli exec node dist/index.js --help
```

1. `workboard login` → browser WorkOS AuthKit (orgs sync from WorkOS)  
2. `workboard link-repo` (once per repo)  
3. `workboard status` / `workboard claim -t "…" -f src/x.ts`

WorkOS organizations are the source of truth — no separate “create org” step in Workboard.

Add this redirect URI in the WorkOS Dashboard → Redirects:

- Local: `http://localhost:3000/auth/callback`
- Prod: `https://repo-org-production.up.railway.app/auth/callback`

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
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | AuthKit (required) |
| `SKIP_GITHUB_VERIFY=1` | Soft-skip GitHub repo verify |
| `GITHUB_VERIFY_TOKEN` | Optional PAT for verify |

## API

- `GET /v1/me`
- `GET /v1/repos/:owner/:repo/claims`
- `POST /v1/repos/:owner/:repo/claims`
- `POST /v1/claims/:id/heartbeat`
- `POST /v1/claims/:id/release`
- `POST /v1/repos` — link repo
