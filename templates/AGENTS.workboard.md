## Workboard (required before coding)

This project uses **Workboard** so agents/humans do not duplicate work on the same files or tasks.

Before any meaningful implementation (editing code, starting a roadmap item, multi-file changes):

1. Install the CLI from the latest GitHub Release tarball (not on npm yet), e.g.  
   `npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.7/workboard-cli-0.1.7.tgz`
2. `workboard status` — if not logged in, `workboard login` first
3. If the repo is not linked (`status` exit 2): `workboard link-repo`
4. Claim before you start: `workboard claim -t "short title" -f path/one -f path/two`
5. On longer sessions: `workboard heartbeat --note "…"`
6. When done or switching: `workboard release current`

If `status` shows an overlap on the same files/task, do **not** silently continue — tell the user and pick a different slice or wait.

Install agent wiring in this repo: `workboard init` (Claude Code, Codex, and/or Cursor).
