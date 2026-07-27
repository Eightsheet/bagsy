# Security Policy

## Reporting a vulnerability

Please report security issues privately to the repository owner via GitHub Security Advisories:
https://github.com/Eightsheet/repo-org/security/advisories/new

Do not open a public issue for credential leaks, auth bypasses, or RCE.

## What is in scope

- Auth / session / API token handling
- Org / team tenancy isolation (claims, linked repos, memberships)
- Secrets handling in the hosted API (Railway)

## What is out of scope / by design

- The Workboard **hosted API** is a shared service. Making this **git repo** public does not grant API access — you still need WorkOS login + team membership.
- GitHub repo access alone does not grant claim-board access.
- `SKIP_GITHUB_VERIFY` soft-skips GitHub verification when set on the server; treat it as a deployment choice, not client-controlled.

## Hardening already in place

- API routes require Bearer tokens; claim heartbeat/release are owner-scoped
- Team override via `X-Workboard-Org` requires membership
- Session cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production
- In-memory rate limits on device login, invites/org create, API calls, and `GET /v1/cli/update` (per IP / user)
- No secrets committed (`.env` gitignored); use Railway / local env only
- `main` requires pull requests (branch protection); force-push and deletion disabled

## Hosted instance

The public CLI defaults to the Railway deployment:

`https://repo-org-production.up.railway.app`

Override only when running your own API (`WORKBOARD_API_URL`).

`GET /v1/cli/update` is public (version + channel only) so the CLI can auto-update. Channel is controlled by `WORKBOARD_CLI_UPDATE_CHANNEL` (`stable` = 48h delay, `dev` = immediate).

## Operator checklist (hosted instance)

- Keep `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `DATABASE_URL` only in Railway (or equivalent)
- Prefer leaving `SKIP_GITHUB_VERIFY` unset once GitHub verify is wired
- Rotate API tokens / revoke via DB if a laptop token leaks (`api_tokens.revoked_at`)
- Set `WORKBOARD_CLI_UPDATE_CHANNEL=dev` only if you want CLIs to pick up releases immediately
