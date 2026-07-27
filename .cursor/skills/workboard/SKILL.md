---
name: workboard
description: >-
  Coordinate agent work across a shared repository via the workboard CLI.
  Use before starting meaningful coding work, when claiming files/tasks,
  checking if someone else is already working on the same thing, heartbeating
  progress, or releasing a claim when done.
---

# Workboard

Before doing meaningful implementation work in a shared repo, coordinate through `workboard` so other agents/humans do not duplicate effort.

**Model:** A team owns the board. Repos are linked to a team. The CLI picks the team from `git remote` when that remote is linked. Access is membership — not GitHub alone.

## Required flow

1. **Check** — `workboard status`
2. **Claim** — if you will change files or implement a roadmap item:
   ```bash
   workboard claim -t "Short task title" -f path/one -f path/two --roadmap optional-ref
   ```
3. **Heartbeat** — on longer sessions, occasionally:
   ```bash
   workboard heartbeat --note "what you're doing now"
   ```
4. **Release** — when finished, blocked, or switching tasks:
   ```bash
   workboard release current
   ```

## Rules

- Run `workboard status` near the start of a session that will edit code.
- If status shows an overlap on the same files/task, do not silently proceed on the same work. Tell the user and either pick a different slice or wait.
- Prefer `--strict` only when the user asks to hard-block overlaps.
- If the repo is not linked (`status` exit 2), run `workboard link-repo` once (CLI asks which team if you have several).
- If the repo is linked in more than one of your teams and there is no remembered choice, pass `--org <slug>` (agents are non-interactive).
- If not logged in, run `workboard login` (opens browser → WorkOS). Install with `npm i -g workboard` if needed.

## Notes

- Install: `npm i -g workboard` or `npx workboard …` (default API is production).
- Repo is auto-detected from `git remote origin`; team is resolved from which of your teams linked that remote.
- Config lives in `~/.config/repo-org/config.json` (includes remembered `repoTeams` mappings).
- API URL override: `WORKBOARD_API_URL`.
