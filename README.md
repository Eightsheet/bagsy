# Bagsy

Agent coordination service: bagsy (claim) what you're working on in a shared repo so other agents/humans don't duplicate work.

## Try it (hosted, free)

A public instance runs on Railway — no self-hosting needed to try:

**https://repo-org-production.up.railway.app**

1. Install the CLI (below)
2. `bagsy login` — opens AuthKit in the browser
3. Create a team, invite people, link a repo, then `bagsy claim …`

The CLI talks to that URL by default. Override only if you run your own API: `BAGSY_API_URL=…`

## Model

- **Team** (WorkOS organization) = people who share a claim board. Membership is the access gate.
- **Repos belong to a team** — link once to put a remote on that team’s board.
- **CLI follows `git remote`** — `status` / `claim` pick the team that has this remote linked. If it’s linked in more than one of your teams, the CLI asks (or use `--org slug`).

## Install CLI

```bash
npm install -g @bagsy/cli
```

Upgrading from the old `workboard-cli` tarball install: `npm uninstall -g workboard-cli && npm install -g @bagsy/cli`. Your login carries over; `workboard` keeps working as a deprecated alias.

Then:

```bash
bagsy init                 # interactive picker (skills)
bagsy init --all           # skills for Claude Code + Codex + Cursor
bagsy init --claude-code --codex
bagsy init --docs          # opt-in: also create/append CLAUDE.md / AGENTS.md
```

`CLAUDE.md` / `AGENTS.md` are **not** auto-appended unless you pass `--docs` (or say yes in the interactive prompt).

What gets written:

| Target | Skill | Instructions (only with `--docs`) |
|--------|--------|-----------------------------------|
| Claude Code | `.claude/skills/bagsy/SKILL.md` | `CLAUDE.md` |
| Codex | `.agents/skills/bagsy/SKILL.md` | `AGENTS.md` |
| Cursor | `.cursor/skills/bagsy/SKILL.md` | — |

### Auth (WorkOS JWT)

CLI login uses **WorkOS device authorization** and stores an AuthKit access JWT (+ refresh) in `~/.config/bagsy/config.json` (mode `0600`). A pre-rename `~/.config/repo-org/config.json` is migrated automatically on first run.

API `/v1/*` validates the Bearer token via WorkOS JWKS (`client_id` app binding; flexible `iss` for multi-app).

```bash
bagsy login          # WorkOS device flow
bagsy upgrade        # then re-login after auth migrations
```

Old opaque CLI tokens no longer work — run `bagsy login` again after upgrading.

### Updates

The CLI checks the hosted API about once an hour and may auto-install a newer release:

- **Channel `stable` (default):** auto-update only **48 hours** after the GitHub Release is published
- **Channel `dev`:** auto-update as soon as a newer release exists (hosted instance uses this)

Manual upgrade (always immediate):

```bash
bagsy upgrade   # alias: bagsy update
bagsy version
```

Disable background checks: `BAGSY_NO_AUTO_UPDATE=1`. Legacy `WORKBOARD_*` env vars are still honored.

API operators set the channel with `WORKBOARD_CLI_UPDATE_CHANNEL=stable|dev`.

For agents: see [AGENTS.md](./AGENTS.md), [templates/CLAUDE.bagsy.md](./templates/CLAUDE.bagsy.md), [templates/AGENTS.bagsy.md](./templates/AGENTS.bagsy.md).

## WorkOS AuthKit

Auth is already wired in the app (`provider: "authkit"`) and production has `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` on Railway.

Enable / verify in the [WorkOS Dashboard](https://dashboard.workos.com):

1. **Authentication → AuthKit** — AuthKit enabled for the environment
2. **Applications** → your app → **Redirects** — register exactly:
   - `https://repo-org-production.up.railway.app/auth/callback`
   - (local) `http://localhost:3000/auth/callback`
3. Use the **same** Application’s Client ID + API key that Railway has (mismatch → `invalid_client`)

Optional: email/password or social connections under AuthKit as you prefer — Bagsy only needs the AuthKit redirect flow.

## Stack

- **API + Web:** Hono on Railway (`apps/api`)
- **CLI:** `bagsy` (`packages/cli`) — published to npm via trusted publishing (OIDC); GitHub Releases carry the same tarball
- **Auth:** WorkOS AuthKit + API tokens for CLI/agents
- **Tenancy:** Org-gated boards; repo as key within a team; optional GitHub verify

## Quick start (local API)

```bash
pnpm install
pnpm --filter @bagsy/shared build

# Postgres required
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/repo_org
export WORKOS_API_KEY=…
export WORKOS_CLIENT_ID=…
export APP_URL=http://localhost:3000

pnpm --filter @bagsy/api db:generate
pnpm --filter @bagsy/api db:migrate
pnpm --filter @bagsy/api dev
```

CLI against local API:

```bash
pnpm --filter @bagsy/cli build
BAGSY_API_URL=http://localhost:3000 node packages/cli/dist/bagsy.js login
```

1. `bagsy login` → browser WorkOS AuthKit  
2. `bagsy link-repo` (once per team board)  
3. `bagsy status` / `bagsy claim -t "…" -f src/x.ts`

Create a team or invite a teammate from the web UI — Bagsy creates the WorkOS org and makes you admin.

WorkOS redirect URIs:

- Local: `http://localhost:3000/auth/callback`
- Prod: `https://repo-org-production.up.railway.app/auth/callback`

## CLI

```bash
bagsy login
bagsy status [--org slug]
bagsy claim -t "Title" -f path/a [--strict] [--org slug]
bagsy heartbeat --note "…"
bagsy release current
bagsy link-repo [--org slug]
bagsy init [--all|--claude-code|--codex|--cursor] [--docs]
bagsy whoami
```

Config: `~/.config/bagsy/config.json`

## Releases

- Tag `vX.Y.Z` → GitHub Actions builds the CLI, attaches `bagsy-cli-X.Y.Z.tgz` (plus a legacy-named copy for old auto-updaters) to the Release, and publishes to npm via trusted publishing.
- `main` is protected: PRs required, no force-push, no branch deletion.

## Security

See [SECURITY.md](./SECURITY.md). Making the repo public does **not** open the hosted API — auth + team membership still required.

## Env (Railway)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres (Railway plugin) |
| `APP_URL` | Public URL |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | AuthKit (required) |
| `WORKBOARD_CLI_UPDATE_CHANNEL` | `stable` (48h delay) or `dev` (immediate); default `stable` |
| `SKIP_GITHUB_VERIFY=1` | Soft-skip GitHub repo verify |
| `GITHUB_VERIFY_TOKEN` | Optional PAT for verify |

## API

- `GET /v1/auth/config` — public; WorkOS client id for CLI device login
- `POST /v1/auth/refresh` — public; refresh WorkOS access token
- `GET /v1/cli/update` — public; latest CLI version + channel
- `GET /v1/me`
- `GET /v1/repos/:owner/:repo/context`
- `GET|POST /v1/repos/:owner/:repo/claims` — header `X-Workboard-Org: slug` (the CLI also sends `X-Bagsy-Org`)
- `POST /v1/claims/:id/heartbeat|release`
- `POST /v1/repos` — link repo
