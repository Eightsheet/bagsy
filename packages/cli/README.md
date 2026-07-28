# workboard CLI

Agent coordination CLI for [Workboard](https://github.com/Eightsheet/bagsy).

## Install

Not on the npm registry yet. Install from a [GitHub Release](https://github.com/Eightsheet/bagsy/releases/latest) tarball:

```bash
npm install -g https://github.com/Eightsheet/bagsy/releases/download/v0.1.10/workboard-cli-0.1.10.tgz
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

Talks to the free hosted API by default:  
`https://repo-org-production.up.railway.app`  
Override only for a self-hosted API: `WORKBOARD_API_URL=…`

Auto-update (once/hour): channel `stable` waits 48h after release; `dev` updates immediately.  
`workboard upgrade` installs latest now. Disable with `WORKBOARD_NO_AUTO_UPDATE=1`.

Login uses WorkOS device auth (access JWT + refresh). After upgrading past auth changes, run `workboard login` again.

## Quick start

```bash
workboard login
workboard link-repo          # from a git clone
workboard status
workboard claim -t "Title" -f path/file.ts
workboard upgrade            # optional: force CLI update
```

See the repo README for agent usage.
