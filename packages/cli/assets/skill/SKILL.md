---
name: workboard
description: >-
  Coordinate shared-repo work via workboard CLI. Use before coding, when
  claiming files/tasks, checking overlaps, heartbeating, or releasing when done.
---

# Workboard

Team owns the board; repos are linked to a team; CLI picks team from `git remote`. Membership gates access (not GitHub alone).

## Flow (required)

1. `workboard status` — also shows the team's **Planned** queue; prefer picking one up (`workboard start <id>`) over inventing overlapping work
2. Claim before editing: `workboard claim -t "title" -f path/one -f path/two`
3. Longer sessions: `workboard heartbeat --note "…"` (also revives your own STALE claim)
4. **Always release when finished, blocked, or switching:** `workboard release current --result <PR-URL-or-commit-SHA>` — the result link tells the team where the work landed

## Planned claims (roadmap queue)

- Queue future work with context: `workboard plan -t "title" -f path/one --desc "why + approach" [--roadmap REF]` — no TTL, never blocks anyone
- Any team member (or their agent) activates it with `workboard start <id>`; the claim is reassigned to whoever starts it and gets a normal TTL
- Claiming files you had planned auto-consumes your own planned entry

## Soft hold

After ~2h without heartbeat a claim becomes **STALE** (still held ~24h). Others cannot take the same files unless they pass `--steal`. Prefer telling the user; only `--steal` when they confirm.

## Rules

- Overlap on same files/task → tell the user; don't silently continue. `--strict` only if asked.
- Soft-hold conflict → explain STALE / possible local WIP; use `--steal` only with user OK.
- Not linked (status exit 2) → `workboard link-repo` once.
- Multi-team ambiguity → `--org <slug>` (non-interactive).
- Not logged in → `workboard login` (WorkOS device auth + JWT). Install: `npm install -g https://github.com/Eightsheet/bagsy/releases/download/v0.1.10/workboard-cli-0.1.10.tgz`
- Wire skills: `workboard init --all` (optional `--docs`). Override API: `WORKBOARD_API_URL`.
