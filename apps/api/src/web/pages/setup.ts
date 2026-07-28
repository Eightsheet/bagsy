import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html.js";

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
  repos: Array<{ repo: string; verifiedAt: Date | null }>;
  members?: SetupMember[];
  pendingInvites?: SetupPendingInvite[];
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
                  const you = m.userId === user.id ? ' <span class="muted">(you)</span>' : "";
                  return `
                <li>
                  <span>
                    <strong>${escapeHtml(label)}</strong>${you}
                    ${m.email && m.name ? `<span class="muted" style="display:block;font-size:0.85rem">${escapeHtml(m.email)}</span>` : ""}
                  </span>
                  <span class="badge">${escapeHtml(m.role)}</span>
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
                  <span class="badge">Pending</span>
                </li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
    </div>`
    : "";

  const inviteExisting = org
    ? `
    <form method="post" action="/orgs/invite" class="stack" style="margin-top:14px">
      <h3 style="margin:0;font:inherit;font-weight:600">Invite to ${escapeHtml(org.name)}</h3>
      <p class="muted">People join this team. Only members see its board and can claim.</p>
      <label>
        Email
        <input name="email" type="email" required placeholder="teammate@company.com" autocomplete="email" />
      </label>
      <div class="row">
        <button type="submit">Send invite</button>
      </div>
    </form>

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
          <span><code>workboard status</code> / <code>claim</code> pick the team that has this remote linked. If it’s linked in more than one of your teams, the CLI asks which board.</span>
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
                  <span class="badge${r.verifiedAt ? " ok" : ""}">${r.verifiedAt ? "Verified" : "Unverified"}</span>
                </li>`,
                )
                .join("")}
            </ul>`
          : `<p class="empty">No repos yet. Link one below, or run <code>workboard link-repo</code> from a clone.</p>`
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
          <code class="cmd">npm install -g https://github.com/Eightsheet/repo-org/releases/download/v0.1.9/workboard-cli-0.1.9.tgz</code>
        </li>
        <li>
          <strong>Sign in on this machine</strong>
          <code class="cmd">workboard login</code>
        </li>
        <li>
          <strong>Link the current repo to a team</strong>
          <code class="cmd">workboard link-repo</code>
          <span class="muted" style="display:block;margin-top:6px">Once per team board. If you have several teams, the CLI asks which one.</span>
        </li>
        <li>
          <strong>Claim work</strong>
          <code class="cmd">workboard claim -t "Title" -f path/file.ts</code>
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

  const accountConfirm = user.email ?? "delete my account";
  const dangerPanel = `
    <section class="panel">
      <h2>Danger zone</h2>
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
