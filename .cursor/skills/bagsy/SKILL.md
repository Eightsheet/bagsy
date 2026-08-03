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
   - Big file, small change? Claim only the region: `-f src/big.ts:120-240` (also `:120` or `:120-240,300-360`). Disjoint ranges of the same file don't conflict, so two agents can share one file. A plain path claims the whole file and blocks range claims on it.
3. After each completed step: `bagsy heartbeat --note "…"` (also revives your own STALE claim)
4. **Always release when finished, blocked, or switching:** `bagsy release current --result <PR-URL-or-commit-SHA>` — the result link tells the team where the work landed

## Progress log

Every claim has a timeline. The API records state changes itself (claimed, started, went stale, stolen, released); your `--note` is what turns it into a real account of the work.

- Heartbeat **once per completed step** — "migration written", "auth path done, tests red" — not per file read. An unchanged note is not recorded again.
- `bagsy status` shows the last few entries per claim; `bagsy log <id>` shows the full timeline.
- Before `--steal` on a STALE claim, run `bagsy log <id>` and tell the user how far the other agent got.

## Files sync themselves

`bagsy heartbeat` sends the paths your working tree actually touched (uncommitted, untracked, and committed-on-this-branch) and widens the claim to match — the file list you guessed at claim time is never the final scope.

- If the widened claim now overlaps someone else's, the heartbeat prints a warning: **stop and tell the user**, do not keep editing those files.
- Range claims widen too: edits outside your claimed region grow the range to the touched diff hunks (with the same overlap warning).
- `--no-sync-files` opts out for one call.

## Planned claims (roadmap queue)

- Queue future work with context: `bagsy plan -t "title" -f path/one --desc "why + approach" [--roadmap REF] [--plan-url URL]` — no TTL, never blocks anyone; `--plan-url` links a published plan document (e.g. a Shareframe artifact) so others can read the full plan (also works on `bagsy claim`)
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
