# AGENTS.md

## Workboard coordination

Before meaningful coding in a shared repo that uses Workboard:

```bash
npm install -g workboard-cli
workboard init --claude   # Cursor skill + CLAUDE.md snippet in this repo
workboard login
workboard status
workboard claim -t "Short title" -f path/one.ts
```

Or paste [templates/CLAUDE.workboard.md](./templates/CLAUDE.workboard.md) into the project's `CLAUDE.md`.

Skill: `.cursor/skills/workboard/SKILL.md`

## Model

- **Team** = WorkOS org (people with access)
- **Repos** are linked to a team
- CLI picks the team from `git remote` when linked; if linked in multiple of your teams, pass `--org <slug>`

## Repo conventions

- TypeScript monorepo (`apps/api`, `packages/cli`, `packages/shared`)
- Do not commit `.env` or secrets
- Prefer PRs into `main` (branch protection enabled)
