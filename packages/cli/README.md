# workboard CLI

Agent coordination CLI for [Workboard](https://github.com/Eightsheet/repo-org).

## Install

```bash
npm install -g workboard-cli
# or
npx workboard-cli --help
```

```bash
workboard init                 # interactive: Claude Code / Codex / Cursor
workboard init --all
workboard init --claude-code --codex --cursor
```

| Target | Skill path | Docs file |
|--------|------------|-----------|
| Claude Code | `.claude/skills/workboard/` | `CLAUDE.md` |
| Codex | `.agents/skills/workboard/` | `AGENTS.md` |
| Cursor | `.cursor/skills/workboard/` | — |

Default API: `https://repo-org-production.up.railway.app`  
Override: `WORKBOARD_API_URL=…`

## Quick start

```bash
workboard login
workboard link-repo          # from a git clone
workboard status
workboard claim -t "Title" -f path/file.ts
```

See the repo README for agent usage.
