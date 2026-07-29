# bagsy

Agent coordination CLI for [Bagsy](https://github.com/Eightsheet/bagsy) — bagsy what you're working on in a shared repo so agents and humans don't duplicate work.

## Install

```bash
npm install -g bagsy
```

Upgrading from the old `workboard-cli` tarball install:

```bash
npm uninstall -g workboard-cli
npm install -g bagsy
```

Your login carries over (`~/.config/repo-org` is migrated to `~/.config/bagsy` on first run). The `workboard` command keeps working as a deprecated alias.

```bash
bagsy init                 # interactive: Claude Code / Codex / Cursor (skills only)
bagsy init --all
bagsy init --claude-code --codex --cursor
bagsy init --docs          # opt-in: also CLAUDE.md / AGENTS.md
```

| Target | Skill path | Docs file (`--docs` only) |
|--------|------------|---------------------------|
| Claude Code | `.claude/skills/bagsy/` | `CLAUDE.md` |
| Codex | `.agents/skills/bagsy/` | `AGENTS.md` |
| Cursor | `.cursor/skills/bagsy/` | — |

Talks to the free hosted API by default:  
`https://repo-org-production.up.railway.app`  
Override only for a self-hosted API: `BAGSY_API_URL=…`

Auto-update (once/hour): channel `stable` waits 48h after release; `dev` updates immediately.  
`bagsy upgrade` installs latest now. Disable with `BAGSY_NO_AUTO_UPDATE=1`.

Legacy `WORKBOARD_*` environment variables are still honored.

Login uses WorkOS device auth (access JWT + refresh). After upgrading past auth changes, run `bagsy login` again.

## Quick start

```bash
bagsy login
bagsy link-repo          # from a git clone
bagsy status
bagsy claim -t "Title" -f path/file.ts
bagsy upgrade            # optional: force CLI update
```

See the repo README for agent usage.
