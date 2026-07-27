import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html.js";

export function setupPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  repos: Array<{ repo: string; verifiedAt: Date | null }>;
  flash?: string | null;
  error?: string | null;
  defaultOrgName: string;
}): string {
  const { user, org, orgs, repos, flash, error, defaultOrgName } = opts;

  const notices = `
    ${flash ? `<p class="ok">${escapeHtml(flash)}</p>` : ""}
    ${error ? `<p class="warn">${escapeHtml(error)}</p>` : ""}
  `;

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
          <code class="cmd">npm install -g workboard-cli</code>
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
  `,
  );
}
