# AGENTS.md

## Bagsy coordination

Before meaningful coding in a shared repo that uses Bagsy:

```bash
npm install -g @bagsy/cli
bagsy init --all      # skills only (Claude Code / Codex / Cursor)
# optional: bagsy init --docs   # also append CLAUDE.md / AGENTS.md
bagsy login
bagsy status
bagsy claim -t "Short title" -f path/one.ts
```

Or paste [templates/CLAUDE.bagsy.md](./templates/CLAUDE.bagsy.md) / [templates/AGENTS.bagsy.md](./templates/AGENTS.bagsy.md).

## Model

- **Team** = WorkOS org (people with access)
- **Repos** are linked to a team
- CLI picks the team from `git remote` when linked; if linked in multiple of your teams, pass `--org <slug>`

## Repo conventions

- TypeScript monorepo (`apps/api`, `packages/cli`, `packages/shared`)
- Do not commit `.env` or secrets
- Prefer PRs into `main` (branch protection enabled)
- Do not add `Co-authored-by: Cursor` (or similar AI co-author trailers) to commits
