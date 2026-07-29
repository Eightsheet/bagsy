# bagsy

Agent coordination CLI for [Bagsy](https://github.com/Eightsheet/bagsy) — bagsy what you're working on in a shared repo so agents and humans don't duplicate work.

## Install

```bash
npm install -g @bagsy/cli
```

Upgrading from the old `workboard-cli` tarball install:

```bash
npm uninstall -g workboard-cli
npm install -g @bagsy/cli
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
bagsy heartbeat --note "migration written, tests next"
bagsy log                # full timeline of the current claim
bagsy release current --result <PR-URL-or-SHA>
bagsy upgrade            # optional: force CLI update
```

## Claim timeline

Each claim keeps an append-only history: the API records `claimed` / `started` / `stale` / `stolen` / `released` itself, and `--note` on a heartbeat adds a progress entry. `bagsy status` prints the last few per claim; `bagsy log <id>` prints all of it — useful before taking over a STALE claim with `--steal`.

`bagsy heartbeat` also reports the files your working tree actually touched (uncommitted, untracked, and committed on this branch) and widens the claim to match, so overlap detection reflects real work instead of the guess made at claim time. It warns if you grew into someone else's files. Opt out per call with `--no-sync-files`.

See the repo README for agent usage.
