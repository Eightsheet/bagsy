# Workboard Roadmap

**27 Jul 2026** · Product decisions

**Decision:** Keep normal login as-is. When a user invites someone into their org, Workboard auto-creates a WorkOS organization (user-named), makes the inviter admin, and sends the invite — no Dashboard detour.

Shareframe: [Workboard Roadmap — Org create & invite](https://shareframe-worker.p-5f3.workers.dev/a/workboard-roadmap-org-create-invite/TY8DJsxHCkfevIA1w90XSA/)

## Current vs target

| Area | Today | Target |
|------|--------|--------|
| Login | WorkOS AuthKit; orgs sync from existing WorkOS memberships | Same — normal login unchanged |
| Org creation | Manual in WorkOS Dashboard; app blocks with “no org” | App creates WorkOS org when the user starts an invite / names an org |
| Invite | Not in product | Invite from Workboard → WorkOS invitation email |
| Roles | Membership synced; no first-class admin UX | Creator is auto-admin of the new WorkOS org |
| Naming | WorkOS Dashboard name only | User sets org name in Workboard at create/invite time |

## Items

### R1 — Invite creates WorkOS org

Status: **Planned** · Claim ref: `roadmap:R1-org-invite`

Product behavior (happy path):

1. User signs in normally via AuthKit (personal / existing memberships).
2. In Workboard they name an organization (or confirm a default) and invite a teammate by email.
3. App calls WorkOS to **create the organization** with that name.
4. Inviter is added as **admin** (organization membership + admin role).
5. App sends a WorkOS **invitation** to the invitee for that org.
6. Local `organizations` / `memberships` rows sync as they do today after WorkOS is the source of truth.

**Why this shape:** Solo use stays frictionless; multiplayer is the moment an org actually needs to exist. Naming belongs in-product so nobody opens the WorkOS Dashboard for day-one setup.

#### Acceptance criteria

- User can set org display name before or during the first invite.
- Creating the invite without an existing WorkOS org creates one; inviter ends as admin.
- Invitee receives WorkOS invite email and can join; subsequent logins sync the membership.
- If user already has a WorkOS org selected, invite adds to that org (no duplicate create) unless they explicitly create another.
- README / “no org → go to Dashboard” dead-end is replaced by this create+invite path.

#### Open questions

- Create org lazily on first invite only, or also via an explicit “Create organization” control?
- Default name when user skips naming (e.g. “{user}’s org”) — allowed or required field?
- Personal solo boards without a WorkOS org: keep soft-allow, or force org after this ships?
- WorkOS invitation vs magic-link invite UX details in AuthKit.

## Out of scope (for now)

- Billing / seats
- Custom SSO / directory sync UI beyond what WorkOS already provides
- Transferring org ownership
