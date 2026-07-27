# workboard CLI

Agent coordination CLI for [Workboard](https://github.com/Eightsheet/repo-org).

## Install

Not on the npm registry yet. Install from a [GitHub Release](https://github.com/Eightsheet/repo-org/releases/latest) tarball:

```bash
npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.6/workboard-cli-0.1.6.tgz
```

```bash
workboard init                 # interactive: Claude Code / Codex / Cursor (skills only)
workboard init --all
workboard init --claude-code --codex --cursor
workboard init --docs          # opt-in: also CLAUDE.md / AGENTS.md
```

| Target | Skill path | Docs file (`--docs` only) |
|--------|------------|---------------------------|
| Claude Code | `.claude/skills/workboard/` | `CLAUDE.md` |
| Codex | `.agents/skills/workboard/` | `AGENTS.md` |
| Cursor | `.cursor/skills/workboard/` | — |

Default API (hosted): `https://repo-org-production.up.railway.app`  
Override only for a self-hosted API: `WORKBOARD_API_URL=…`

## Quick start

```bash
workboard login
workboard link-repo          # from a git clone
workboard status
workboard claim -t "Title" -f path/file.ts
```

See the repo README for agent usage.
