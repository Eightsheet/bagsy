## Bagsy (required before coding)

This project uses **Bagsy** so agents/humans do not duplicate work on the same files or tasks.

Before any meaningful implementation (editing code, starting a roadmap item, multi-file changes):

1. Install the CLI: `npm install -g @bagsy/cli`
2. `bagsy status` — if not logged in, `bagsy login` first
3. If the repo is not linked (`status` exit 2): `bagsy link-repo`
4. Claim before you start: `bagsy claim -t "short title" -f path/one -f path/two`
5. After each completed step: `bagsy heartbeat --note "what you just finished"` — this appends to the claim's timeline and widens the claim to the files you have actually touched
6. When done or switching: `bagsy release current --result <PR-URL-or-commit-SHA>`

Read a claim's full history with `bagsy log <claim-id>` — especially before taking over a STALE claim.

If `status` shows an overlap on the same files/task — or a heartbeat warns that your changes grew into someone else's claim — do **not** silently continue: tell the user and pick a different slice or wait.

Install agent wiring in this repo: `bagsy init` (Claude Code, Codex, and/or Cursor).
