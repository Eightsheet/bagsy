# workboard CLI

Agent coordination CLI for [Workboard](https://github.com/Eightsheet/repo-org).

## Install

```bash
npm install -g workboard-cli
# or
npx workboard-cli --help
```

```bash
workboard init           # Cursor skill → .cursor/skills/workboard/SKILL.md
workboard init --claude  # also create/append CLAUDE.md instructions
```

Default API: `https://repo-org-production.up.railway.app`  
Override: `WORKBOARD_API_URL=…`

## Quick start

```bash
workboard login
workboard link-repo          # from a git clone
workboard status
workboard claim -t "Title" -f path/file.ts
```

See the repo README and `.cursor/skills/workboard/SKILL.md` for agent usage.
