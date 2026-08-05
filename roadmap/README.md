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

### R6 — Server sleep (idle spin-down)

Status: **In progress** · Claim ref: `roadmap:R6-server-sleep`

(R4/R5 live on other branches.) The API idles most of the day — heartbeats only flow while a session is active — yet the full server (Hono + Drizzle + WorkOS + pg client) sits in RAM around the clock, and Railway bills by RAM-minutes. Instead of paying for an idle process: a tiny dependency-free listener holds `$PORT`; on the first incoming request it spawns the real server on an internal port and proxies to it; after 10 minutes without traffic it sends SIGTERM and goes back to holding the port near-zero. Node cold-boots the app in well under a second, so the wake penalty on the first heartbeat is negligible.

Shape:

1. `apps/api/src/sleeper.ts` — plain `node:http` + `node:child_process`, no app imports, no dependencies. States: stopped → starting → running → stopping; concurrent wake requests share one spawn; a request that races the shutdown waits for the exit and respawns.
2. Wake: spawn `dist/index.js` with `PORT=<internal>`, poll `/health` until ready (15 s cap), then stream-proxy request and response. One retry on a refused connection if the child died between requests.
3. Sleep: a 30 s sweep sends SIGTERM once there are no in-flight requests and the last activity is older than `SLEEP_IDLE_MS` (default 10 min). `SLEEP_DISABLED=1` keeps the child alive permanently (eager spawn, no sweep).
4. `/health` while asleep is answered by the listener itself (200, `{ok, asleep:true}`) so deploy healthchecks and uptime probes don't keep the app awake; while awake it's proxied. The child is spawned eagerly at boot so the deploy healthcheck still verifies the real app once.
5. Migrations stay a container-start concern (`migrate.js` before the listener), so wakes don't re-run them.

Resolved defaults:

- In-container sleep, not Railway's native app sleeping: scale-to-zero would save the listener's RAM too, but wake latency becomes a full container cold start and the sleep trigger also counts outbound traffic (DB keepalives can hold it awake). The listener keeps wake cost at "node boots one process".
- SIGTERM without grace period: the sweep only fires with zero in-flight requests, and the client-side race (request lands mid-shutdown) is covered by the proxy retry.
- No warm-up state persistence: the app is stateless between requests (rate-limit map is per-boot, acceptable to lose on sleep).

#### Rollback

Designed to be thrown out the moment real users make always-on worth paying for:

- **Instant, no code:** set `SLEEP_DISABLED=1` on the Railway service → behaves exactly like today (eager boot, never sleeps); the supervisor stays as a neutral pass-through proxy.
- **Full removal:** revert is one deleted file (`sleeper.ts`) plus two one-line changes (Dockerfile CMD and the api `start` script back to `dist/index.js`). Nothing else references the sleeper; the app itself is untouched.

#### Acceptance criteria

- [ ] First request after idle spins the server up and completes normally (one-time ~1 s latency, no client error).
- [ ] Ten minutes without requests drops RSS to listener-only; a later request wakes it again.
- [ ] Deploy healthcheck passes and verifies a real app boot; subsequent `/health` probes don't prevent sleep.
- [ ] `SLEEP_DISABLED=1` restores today's always-on behavior exactly.

## Out of scope (for now)

- Billing / seats
- Custom SSO / directory sync UI beyond what WorkOS already provides
- Transferring org ownership
- Hard global uniqueness of a GitHub repo to one team forever
