# Workboard

Agent coordination service: claim what you're working on in a shared repo so other agents/humans don't duplicate work.

## Try it (hosted, free)

A public instance runs on Railway — no self-hosting needed to try:

**https://repo-org-production.up.railway.app**

1. Install the CLI (below)
2. `workboard login` — opens AuthKit in the browser
3. Create a team, invite people, link a repo, then `workboard claim …`

The CLI talks to that URL by default. Override only if you run your own API: `WORKBOARD_API_URL=…`

## Model

- **Team** (WorkOS organization) = people who share a claim board. Membership is the access gate.
- **Repos belong to a team** — link once to put a remote on that team’s board.
- **CLI follows `git remote`** — `status` / `claim` pick the team that has this remote linked. If it’s linked in more than one of your teams, the CLI asks (or use `--org slug`).

## Install CLI

Install from the [GitHub Release](https://github.com/Eightsheet/repo-org/releases/latest) tarball (not on the npm registry yet):

```bash
npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.6/workboard-cli-0.1.6.tgz
```

Then:

```bash
workboard init                 # interactive picker (skills)
workboard init --all           # skills for Claude Code + Codex + Cursor
workboard init --claude-code --codex
workboard init --docs          # opt-in: also create/append CLAUDE.md / AGENTS.md
```

`CLAUDE.md` / `AGENTS.md` are **not** auto-appended unless you pass `--docs` (or say yes in the interactive prompt).

What gets written:

| Target | Skill | Instructions (only with `--docs`) |
|--------|--------|-----------------------------------|
| Claude Code | `.claude/skills/workboard/SKILL.md` | `CLAUDE.md` |
| Codex | `.agents/skills/workboard/SKILL.md` | `AGENTS.md` |
| Cursor | `.cursor/skills/workboard/SKILL.md` | — |

For agents: see [AGENTS.md](./AGENTS.md), [templates/CLAUDE.workboard.md](./templates/CLAUDE.workboard.md), [templates/AGENTS.workboard.md](./templates/AGENTS.workboard.md).

## WorkOS AuthKit

Auth is already wired in the app (`provider: "authkit"`) and production has `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` on Railway.

Enable / verify in the [WorkOS Dashboard](https://dashboard.workos.com):

1. **Authentication → AuthKit** — AuthKit enabled for the environment
2. **Applications** → your app → **Redirects** — register exactly:
   - `https://repo-org-production.up.railway.app/auth/callback`
   - (local) `http://localhost:3000/auth/callback`
3. Use the **same** Application’s Client ID + API key that Railway has (mismatch → `invalid_client`)

Optional: email/password or social connections under AuthKit as you prefer — Workboard only needs the AuthKit redirect flow.

## Stack

- **API + Web:** Hono on Railway (`apps/api`)
- **CLI:** `workboard` (`packages/cli`) — distributed via GitHub Releases as `workboard-cli-*.tgz`
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
pnpm --filter workboard-cli build
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
workboard init [--all|--claude-code|--codex|--cursor] [--docs]
workboard whoami
```

Config: `~/.config/repo-org/config.json`

## Releases

- Tag `vX.Y.Z` → GitHub Actions builds the CLI and attaches `workboard-cli-X.Y.Z.tgz` to the Release.
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
