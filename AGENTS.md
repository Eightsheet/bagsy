# AGENTS.md

## Workboard coordination

Before meaningful coding in a shared repo that uses Workboard:

```bash
npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.5/workboard-cli-0.1.5.tgz
workboard init --all      # skills only (Claude Code / Codex / Cursor)
# optional: workboard init --docs   # also append CLAUDE.md / AGENTS.md
workboard login
workboard status
workboard claim -t "Short title" -f path/one.ts
```

Or paste [templates/CLAUDE.workboard.md](./templates/CLAUDE.workboard.md) / [templates/AGENTS.workboard.md](./templates/AGENTS.workboard.md).

## Model

- **Team** = WorkOS org (people with access)
- **Repos** are linked to a team
- CLI picks the team from `git remote` when linked; if linked in multiple of your teams, pass `--org <slug>`

## Repo conventions

- TypeScript monorepo (`apps/api`, `packages/cli`, `packages/shared`)
- Do not commit `.env` or secrets
- Prefer PRs into `main` (branch protection enabled)
- Do not add `Co-authored-by: Cursor` (or similar AI co-author trailers) to commits
