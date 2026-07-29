import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html";

export type SetupMember = {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
};

export type SetupPendingInvite = {
  id: string;
  email: string;
  state: string;
};

export function setupPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  repos: Array<{ repo: string; verifiedAt: string | null }>;
  members?: SetupMember[];
  pendingInvites?: SetupPendingInvite[];
  canManage?: boolean;
  flash?: string | null;
  error?: string | null;
  defaultOrgName: string;
}): string {
  const {
    user,
    org,
    orgs,
    repos,
    members = [],
    pendingInvites = [],
    canManage = false,
    flash,
    error,
    defaultOrgName,
  } = opts;

  const notices = `
    ${flash ? `<p class="ok">${escapeHtml(flash)}</p>` : ""}
    ${error ? `<p class="warn">${escapeHtml(error)}</p>` : ""}
  `;

  const membersBlock = org
    ? `
    <div class="members-block" style="margin-top:14px">
      <h3 style="margin:0 0 8px;font:inherit;font-weight:600">Members</h3>
      ${
        members.length
          ? `<ul class="list">
              ${members
                .map((m) => {
                  const label = m.name?.trim() || m.email || m.userId;
                  const isSelf = m.userId === user.id;
                  const you = isSelf ? ' <span class="muted">(you)</span>' : "";
                  const isAdmin = m.role === "admin";
                  // Admins manage everyone but themselves here; self-actions live
                  // in the danger zone (Leave team) to avoid an accidental click.
                  const actions =
                    canManage && !isSelf
                      ? `<span class="member-actions" style="display:inline-flex;gap:6px">
                           <form method="post" action="/orgs/members/role" style="display:inline">
                             <input type="hidden" name="user_id" value="${escapeHtml(m.userId)}" />
                             <input type="hidden" name="role" value="${isAdmin ? "member" : "admin"}" />
                             <button type="submit" class="link-btn">${isAdmin ? "Make member" : "Make admin"}</button>
                           </form>
                           <form method="post" action="/orgs/members/remove" style="display:inline"
                                 onsubmit="return confirm('Remove this member from the team?')">
                             <input type="hidden" name="user_id" value="${escapeHtml(m.userId)}" />
                             <button type="submit" class="link-btn danger">Remove</button>
                           </form>
                         </span>`
                      : "";
                  return `
                <li>
                  <span>
                    <strong>${escapeHtml(label)}</strong>${you}
                    ${m.email && m.name ? `<span class="muted" style="display:block;font-size:0.85rem">${escapeHtml(m.email)}</span>` : ""}
                  </span>
                  <span style="display:inline-flex;align-items:center;gap:10px">
                    ${actions}
                    <span class="badge">${escapeHtml(m.role)}</span>
                  </span>
                </li>`;
                })
                .join("")}
            </ul>`
          : `<p class="empty">No members synced yet. Invite someone, or hit Refresh after they accept.</p>`
      }
      ${
        pendingInvites.length
          ? `<p class="muted" style="margin:10px 0 6px;font-size:0.85rem">Pending invites</p>
             <ul class="list">
               ${pendingInvites
                 .map(
                   (inv) => `
                <li>
                  <code>${escapeHtml(inv.email)}</code>
                  <span style="display:inline-flex;align-items:center;gap:10px">
                    ${
                      canManage
                        ? `<form method="post" action="/orgs/invites/revoke" style="display:inline"
                                 onsubmit="return confirm('Revoke this pending invite?')">
                             <input type="hidden" name="invitation_id" value="${escapeHtml(inv.id)}" />
                             <button type="submit" class="link-btn danger">Revoke</button>
                           </form>`
                        : ""
                    }
                    <span class="badge">Pending</span>
                  </span>
                </li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
    </div>`
    : "";

  const inviteForm = canManage
    ? `
    <form method="post" action="/orgs/invite" class="stack" style="margin-top:14px">
      <h3 style="margin:0;font:inherit;font-weight:600">Invite to ${escapeHtml(org?.name ?? "")}</h3>
      <p class="muted">People join this team. Only members see its board and can claim. Admins can manage members and invite.</p>
      <label>
        Email
        <input name="email" type="email" required placeholder="teammate@company.com" autocomplete="email" />
      </label>
      <label>
        Role
        <select name="role">
          <option value="member" selected>Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <div class="row">
        <button type="submit">Send invite</button>
      </div>
    </form>`
    : `<p class="muted" style="margin-top:14px">Only team admins can invite members. Ask an admin, or create your own team below.</p>`;

  const inviteExisting = org
    ? `
    ${inviteForm}

    <details class="quiet-details">
      <summary>Create another team</summary>
      <form method="post" action="/orgs/create" class="stack" style="margin-top:12px">
        <label>
          Name
          <input name="name" placeholder="${escapeHtml(defaultOrgName)}" />
        </label>
        <label>
          Invite email <span class="muted">(optional)</span>
          <input name="invite_email" type="email" placeholder="teammate@company.com" />
        </label>
        <div class="row">
          <button type="submit" class="ghost">Create team</button>
        </div>
      </form>
    </details>
  `
    : "";

  const noActiveButHasOrgs =
    !org && orgs.length > 0
      ? `<p class="warn">Pick a team in the header to invite people into it.</p>
         <details class="quiet-details">
           <summary>Or create another team</summary>
           <form method="post" action="/orgs/create" class="stack" style="margin-top:12px">
             <label>
               Name
               <input name="name" placeholder="${escapeHtml(defaultOrgName)}" value="${escapeHtml(defaultOrgName)}" />
             </label>
             <div class="row">
               <button type="submit" class="ghost">Create team</button>
             </div>
           </form>
         </details>`
      : "";

  const firstOrg =
    !org && orgs.length === 0
      ? `
    <form method="post" action="/orgs/create" class="stack" style="margin-top:14px">
      <h3 style="margin:0;font:inherit;font-weight:600">Create your team</h3>
      <p class="muted">Name the group you coordinate with, then invite people. You’re admin automatically.</p>
      <label>
        Name
        <input name="name" placeholder="${escapeHtml(defaultOrgName)}" value="${escapeHtml(defaultOrgName)}" />
      </label>
      <label>
        Invite email <span class="muted">(optional)</span>
        <input name="invite_email" type="email" placeholder="teammate@company.com" />
      </label>
      <div class="row">
        <button type="submit">Create team</button>
      </div>
    </form>
  `
      : "";

  const orgPanel = `
    <section class="panel">
      <div class="panel-head">
        <h2>Your team</h2>
        <form method="post" action="/orgs/sync" class="inline-form">
          <button type="submit" class="ghost">Refresh from WorkOS</button>
        </form>
      </div>
      <p class="panel-desc">A team is the people who share a claim board. Switch teams in the header anytime — no re-login. Invites go to the active team.</p>
      ${
        org
          ? `<p>Active: <strong>${escapeHtml(org.name)}</strong> <span class="mono muted">${escapeHtml(org.slug)}</span></p>`
          : ""
      }
      ${membersBlock}
      ${inviteExisting}
      ${noActiveButHasOrgs}
      ${firstOrg}
    </section>
  `;

  const howItWorks = `
    <section class="panel how-it-works">
      <h2>How it works</h2>
      <ol class="steps model-steps">
        <li>
          <strong>Team</strong>
          <span>People you invite. Membership is the access gate — not GitHub alone.</span>
        </li>
        <li>
          <strong>Repos belong to a team</strong>
          <span>Link a repo once to put it on that team’s board.</span>
        </li>
        <li>
          <strong>CLI follows git remote</strong>
          <span><code>bagsy status</code> / <code>claim</code> pick the team that has this remote linked. If it’s linked in more than one of your teams, the CLI asks which board.</span>
        </li>
      </ol>
    </section>
  `;

  const reposPanel = org
    ? `
    <section class="panel">
      <h2>Repos on this team</h2>
      <p class="panel-desc">Linked here for <strong>${escapeHtml(org.name)}</strong>. Agents on this team claim against these remotes. The same GitHub repo can be linked on another team you belong to — each team has its own board.</p>
      ${
        repos.length
          ? `<ul class="list">
              ${repos
                .map(
                  (r) => `
                <li>
                  <code>${escapeHtml(r.repo)}</code>
                </li>`,
                )
                .join("")}
            </ul>`
          : `<p class="empty">No repos yet. Link one below, or run <code>bagsy link-repo</code> from a clone.</p>`
      }
      <form method="post" action="/repos" class="stack" style="margin-top:12px">
        <label>
          Repository
          <input name="repo" required placeholder="owner/name" autocomplete="off" />
        </label>
        <div class="row">
          <button type="submit">Link to ${escapeHtml(org.name)}</button>
        </div>
      </form>
    </section>
  `
    : "";

  const cliPanel = `
    <section class="panel">
      <h2>CLI</h2>
      <p class="panel-desc">Day-to-day coordination stays in the terminal. Team is usually inferred from <code>git remote</code>.</p>
      <ol class="steps">
        <li>
          <strong>Install the CLI</strong>
          <code class="cmd">npm install -g @bagsy/cli</code>
        </li>
        <li>
          <strong>Sign in on this machine</strong>
          <code class="cmd">bagsy login</code>
        </li>
        <li>
          <strong>Link the current repo to a team</strong>
          <code class="cmd">bagsy link-repo</code>
          <span class="muted" style="display:block;margin-top:6px">Once per team board. If you have several teams, the CLI asks which one.</span>
        </li>
        <li>
          <strong>Claim work</strong>
          <code class="cmd">bagsy claim -t "Title" -f path/file.ts</code>
          <span class="muted" style="display:block;margin-top:6px">Uses the team that already has this remote linked.</span>
        </li>
      </ol>
    </section>
  `;

  const deleteTeamForm = org
    ? `
      <details class="quiet-details">
        <summary>Delete team “${escapeHtml(org.name)}”</summary>
        <p class="muted" style="margin:10px 0 6px">Admins only. Removes the WorkOS organization, all memberships, linked repos, and every claim on this board — for everyone. This cannot be undone.</p>
        <form method="post" action="/orgs/delete" class="stack" style="margin-top:8px">
          <label>
            Type the team slug <code>${escapeHtml(org.slug)}</code> to confirm
            <input name="confirm" required autocomplete="off" placeholder="${escapeHtml(org.slug)}" />
          </label>
          <div class="row">
            <button type="submit" class="ghost">Delete this team permanently</button>
          </div>
        </form>
      </details>`
    : "";

  const leaveTeamForm = org
    ? `
      <details class="quiet-details">
        <summary>Leave team “${escapeHtml(org.name)}”</summary>
        <p class="muted" style="margin:10px 0 6px">Removes you from this team’s board. You keep your account and other teams. If you are the team’s only admin, promote someone else first.</p>
        <form method="post" action="/orgs/members/leave" class="stack" style="margin-top:8px"
              onsubmit="return confirm('Leave this team?')">
          <div class="row">
            <button type="submit" class="ghost">Leave this team</button>
          </div>
        </form>
      </details>`
    : "";

  const accountConfirm = user.email ?? "delete my account";
  const dangerPanel = `
    <section class="panel danger">
      <h2>Danger zone</h2>
      ${leaveTeamForm}
      ${deleteTeamForm}
      <details class="quiet-details">
        <summary>Delete my account</summary>
        <p class="muted" style="margin:10px 0 6px">Deletes your WorkOS login, memberships, API tokens, and your claims. Teams where you are the only member are deleted too; teams with other members need another admin first. This cannot be undone.</p>
        <form method="post" action="/account/delete" class="stack" style="margin-top:8px">
          <label>
            Type <code>${escapeHtml(accountConfirm)}</code> to confirm
            <input name="confirm" required autocomplete="off" placeholder="${escapeHtml(accountConfirm)}" />
          </label>
          <div class="row">
            <button type="submit" class="ghost">Delete my account permanently</button>
          </div>
        </form>
      </details>
    </section>
  `;

  return layout(
    "Setup",
    `
    ${topbar({ user, org, orgs })}
    <p class="lede"><strong>Setup.</strong> Teams, invites, and which repos sit on whose board. Agent work stays in the CLI.</p>
    ${notices}
    ${howItWorks}
    ${orgPanel}
    ${reposPanel}
    ${cliPanel}
    ${dangerPanel}
  `,
  );
}
