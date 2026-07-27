---
name: workboard
description: >-
  Coordinate shared-repo work via workboard CLI. Use before coding, when
  claiming files/tasks, checking overlaps, heartbeating, or releasing when done.
---

# Workboard

Team owns the board; repos are linked to a team; CLI picks team from `git remote`. Membership gates access (not GitHub alone).

## Flow (required)

1. `workboard status`
2. Claim before editing: `workboard claim -t "title" -f path/one -f path/two`
3. Longer sessions: `workboard heartbeat --note "…"`
4. **Always release when finished, blocked, or switching:** `workboard release current`

## Rules

- Overlap on same files/task → tell the user; don't silently continue. `--strict` only if asked.
- Not linked (status exit 2) → `workboard link-repo` once.
- Multi-team ambiguity → `--org <slug>` (non-interactive).
- Not logged in → `workboard login` (WorkOS device auth + JWT). Install: `npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.8/workboard-cli-0.1.8.tgz`
- Wire skills: `workboard init --all` (optional `--docs`). Override API: `WORKBOARD_API_URL`.
