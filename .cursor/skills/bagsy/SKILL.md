---
name: bagsy
description: >-
  Coordinate shared-repo work via bagsy CLI. Use before coding, when
  claiming files/tasks, checking overlaps, heartbeating, or releasing when done.
---

# Bagsy

Team owns the board; repos are linked to a team; CLI picks team from `git remote`. Membership gates access (not GitHub alone).

## Flow (required)

1. `bagsy status` — also shows the team's **Planned** queue; prefer picking one up (`bagsy start <id>`) over inventing overlapping work
2. Claim before editing: `bagsy claim -t "title" -f path/one -f path/two`
3. Longer sessions: `bagsy heartbeat --note "…"` (also revives your own STALE claim)
4. **Always release when finished, blocked, or switching:** `bagsy release current --result <PR-URL-or-commit-SHA>` — the result link tells the team where the work landed

## Planned claims (roadmap queue)

- Queue future work with context: `bagsy plan -t "title" -f path/one --desc "why + approach" [--roadmap REF]` — no TTL, never blocks anyone
- Any team member (or their agent) activates it with `bagsy start <id>`; the claim is reassigned to whoever starts it and gets a normal TTL
- Claiming files you had planned auto-consumes your own planned entry

## Soft hold

After ~2h without heartbeat a claim becomes **STALE** (still held ~24h). Others cannot take the same files unless they pass `--steal`. Prefer telling the user; only `--steal` when they confirm.

## Rules

- Overlap on same files/task → tell the user; don't silently continue. `--strict` only if asked.
- Soft-hold conflict → explain STALE / possible local WIP; use `--steal` only with user OK.
- Not linked (status exit 2) → `bagsy link-repo` once.
- Multi-team ambiguity → `--org <slug>` (non-interactive).
- Not logged in → `bagsy login` (WorkOS device auth + JWT). Install: `npm install -g @bagsy/cli`
- Wire skills: `bagsy init --all` (optional `--docs`). Override API: `BAGSY_API_URL`.
