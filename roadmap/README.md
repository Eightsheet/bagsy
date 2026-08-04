# Workboard Roadmap

**27 Jul 2026** · Product decisions

**Decision:** Keep normal login as-is. When a user invites someone into their org, Workboard auto-creates a WorkOS organization (user-named), makes the inviter admin, and sends the invite — no Dashboard detour.

**Decision (Variant 3):** Team = org. Repos belong to a team. CLI picks team from `git remote` when linked; if linked in more than one of your teams → ask (option A). Membership is the access gate.

Shareframe: [Workboard Roadmap — Org create & invite](https://shareframe-worker.p-5f3.workers.dev/a/workboard-roadmap-org-create-invite/TY8DJsxHCkfevIA1w90XSA/)

## Current vs target

| Area | Today | Target |
|------|--------|--------|
| Login | WorkOS AuthKit; orgs sync from existing WorkOS memberships | Same — normal login unchanged |
| Org creation | App creates WorkOS org from UI | Done (R1) |
| Invite | Invite from Workboard → WorkOS invitation email | Done (R1) |
| Team ↔ repo | Link under active org; CLI uses token’s fixed org | CLI resolves team from git remote; ask if ambiguous |
| Claim scope | Claims live on one repo; no cross-repo visibility | Done (R4) — repo groups: one project spans repos, claims + status follow |
| Roles | Creator is auto-admin of the new WorkOS org | Same |

## Items

### R1 — Invite creates WorkOS org

Status: **Done** · Claim ref: `roadmap:R1-org-invite`

Product behavior (happy path):

1. User signs in normally via AuthKit (personal / existing memberships).
2. In Workboard they name an organization (or confirm a default) and invite a teammate by email.
3. App calls WorkOS to **create the organization** with that name.
4. Inviter is added as **admin** (organization membership + admin role).
5. App sends a WorkOS **invitation** to the invitee for that org.
6. Local `organizations` / `memberships` rows sync as they do today after WorkOS is the source of truth.

**Why this shape:** Solo use stays frictionless; multiplayer is the moment an org actually needs to exist. Naming belongs in-product so nobody opens the WorkOS Dashboard for day-one setup.

#### Acceptance criteria

- [x] User can set org display name before or during the first invite.
- [x] Creating the invite without an existing WorkOS org creates one; inviter ends as admin.
- [x] Invitee receives WorkOS invite email and can join; subsequent logins sync the membership.
- [x] If user already has a WorkOS org selected, invite adds to that org (no duplicate create) unless they explicitly create another.
- [x] README / “no org → go to Dashboard” dead-end is replaced by this create+invite path.

#### Resolved defaults

- Explicit **Create organization** control **and** invite-can-create when no org / “create new” checked.
- Empty name → `"{name|email}'s team"`.
- Solo without org still allowed; UI offers create+invite instead of Dashboard dead-end.

### R2 — CLI team from git remote (Variant 3)

Status: **Done** · Claim ref: `roadmap:R2-cli-team-remote`

1. `GET /v1/repos/:owner/:repo/context` lists which of the caller’s teams have the repo linked.
2. API accepts `X-Workboard-Org: slug` to act as that team (must be a member).
3. CLI auto-picks the sole linked team; if several → interactive prompt once (remembered in `repoTeams`) or `--org`.
4. Web copy explains team → linked repos → CLI follows remote.

### R3 — Partial-file claims (ranges within a file)

Status: **Done** · Claim ref: `roadmap:R3-partial-file-claims`

Today a claim holds whole file paths. For large files (schema, routes, one big `index.ts`) that serializes work that could run in parallel. Let a claim optionally scope down to **regions of a file**, so two agents can work in the same file without stepping on each other.

Shipped shape:

1. `bagsy claim -f path/big.ts:120-240` claims only those lines (also `:120` single line, `:120-240,300-360` multi-range); a bare path still claims the whole file.
2. Overlap check compares ranges on the same path: disjoint ranges → no conflict; whole-file vs. any range → conflict. Across different paths (globs, dir prefixes) ranges are ignored.
3. Heartbeat file-sync sends the touched diff hunks (`git diff -U0`); a range claim widens to cover edits outside its region, with the same overlap warning as today. Files not claimed with ranges keep whole-file semantics.

Resolved defaults:

- Line numbers, not symbol anchors — cheap and good enough because heartbeat sync continuously re-widens to reality; anchors can come later if drift hurts in practice.
- New files that sync into a claim join whole-file; ranges exist only where explicitly claimed.
- Untracked, deleted, or heavily rewritten files (>20 hunks) sync as whole paths.

#### Acceptance criteria

- [x] Two claims on disjoint regions of the same file coexist without overlap warnings.
- [x] A range claim vs. a whole-file claim on the same path is reported as a conflict.
- [x] `bagsy status` shows the claimed region, not just the path.
- [x] Heartbeat sync widens a range claim when edits land outside the claimed region.

### R4 — Repo groups (one project across multiple repos)

Status: **Done** · Claim ref: `roadmap:R4-repo-groups`

Today the unit of coordination is a single repo: claims live on `(org, repo)`, `bagsy status` shows one repo, and the overlap check never looks across repos. Real projects often span repos — app + infra, API + SDK, extracted shared lib — so agents working on the same product from different checkouts are invisible to each other. Let a team group linked repos into a **project**, so coordination follows the project, not the checkout.

Shipped shape:

1. A project is an org-level named group of linked repos: `bagsy project create NAME --repo owner/a --repo owner/b`, `bagsy project add-repo NAME owner/c` (schema: `projects` table plus nullable `project_id` on `linked_repos` — a repo belongs to at most one project per org; ungrouped repos behave exactly as today).
2. `bagsy status` run inside any repo of a project shows the whole project's claims, each labeled with its repo. `--repo owner/name` still targets one checkout.
3. Claims can span repos in the same project: `-f owner/other-repo:src/foo.ts` prefixes a path with its repo; unprefixed paths keep current-repo semantics (composes with R3 ranges: `owner/repo:src/big.ts:120-240`). Overlap check compares per `(repo, path)` across all active claims in the project; a cross-repo entry targeting a repo outside the project is rejected.
4. Heartbeat file-sync stays checkout-local: the CLI reports which repo it runs in, and syncing from any sibling checkout updates that repo's slice of the claim's file set (same widening semantics as today). From an unrelated repo, files are skipped (`repo_mismatch`) instead of smearing the claim — the TTL still refreshes.
5. Roadmap refs are already org-scoped strings, so one `roadmap:...` ref naturally ties claims across the project's repos together in `bagsy log`.

Resolved defaults:

- One project per repo (per org) — no nesting, no overlapping groups; keeps the "which project am I in" resolution as unambiguous as R2's team resolution.
- Cross-repo claims require the target repo to be in the same project — no ad-hoc cross-repo claims between ungrouped repos, so today's per-repo isolation stays the default.
- Grouping is purely a coordination scope; it does not change access (membership in the org is still the gate) and does not touch git — one claim, N checkouts.

#### Acceptance criteria

- [x] `bagsy status` from any checkout of a project repo lists active claims across all repos in the project.
- [x] A claim with files in two repos conflicts with any claim overlapping either repo's paths; disjoint paths across repos coexist.
- [x] Unprefixed `-f` paths keep exact current behavior; orgs/repos without projects see no change at all.
- [x] Heartbeat sync from any checkout in the project widens the correct repo's slice of the claim.
- [x] `bagsy project list` / `show` make the grouping inspectable; `remove-repo` returns a repo to standalone semantics without breaking its active claims.

## Out of scope (for now)

- Billing / seats
- Custom SSO / directory sync UI beyond what WorkOS already provides
- Transferring org ownership
- Hard global uniqueness of a GitHub repo to one team forever
- Web UI for managing projects (CLI + API first; the board API already returns project context)
