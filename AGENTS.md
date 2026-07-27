# AGENTS.md

## Workboard coordination

Before meaningful coding in a shared repo that uses Workboard:

```bash
npm install -g workboard-cli
# or: npx workboard-cli …
export WORKBOARD_API_URL=https://repo-org-production.up.railway.app   # optional; default in published CLI
workboard login
workboard status
workboard claim -t "Short title" -f path/one.ts
```

Skill: `.cursor/skills/workboard/SKILL.md`

## Model

- **Team** = WorkOS org (people with access)
- **Repos** are linked to a team
- CLI picks the team from `git remote` when linked; if linked in multiple of your teams, pass `--org <slug>`

## Repo conventions

- TypeScript monorepo (`apps/api`, `packages/cli`, `packages/shared`)
- Do not commit `.env` or secrets
- Prefer PRs into `main` (branch protection enabled)
