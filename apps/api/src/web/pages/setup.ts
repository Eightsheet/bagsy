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
      <p class="muted">Teammates join your current organization.</p>
      <label>
        Email
        <input name="email" type="email" required placeholder="teammate@company.com" autocomplete="email" />
      </label>
      <div class="row">
        <button type="submit">Send invite</button>
      </div>
    </form>

    <details class="quiet-details">
      <summary>Create a new organization</summary>
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
          <button type="submit" class="ghost">Create organization</button>
        </div>
      </form>
    </details>
  `
    : "";

  const noActiveButHasOrgs =
    !org && orgs.length > 0
      ? `<p class="warn">Pick an organization in the header to invite people into it.</p>
         <details class="quiet-details">
           <summary>Or create a new organization</summary>
           <form method="post" action="/orgs/create" class="stack" style="margin-top:12px">
             <label>
               Name
               <input name="name" placeholder="${escapeHtml(defaultOrgName)}" value="${escapeHtml(defaultOrgName)}" />
             </label>
             <div class="row">
               <button type="submit" class="ghost">Create organization</button>
             </div>
           </form>
         </details>`
      : "";

  const firstOrg =
    !org && orgs.length === 0
      ? `
    <form method="post" action="/orgs/create" class="stack" style="margin-top:14px">
      <h3 style="margin:0;font:inherit;font-weight:600">Create your organization</h3>
      <p class="muted">Name a team, then invite people. You’re admin automatically.</p>
      <label>
        Name
        <input name="name" placeholder="${escapeHtml(defaultOrgName)}" value="${escapeHtml(defaultOrgName)}" />
      </label>
      <label>
        Invite email <span class="muted">(optional)</span>
        <input name="invite_email" type="email" placeholder="teammate@company.com" />
      </label>
      <div class="row">
        <button type="submit">Create organization</button>
      </div>
    </form>
  `
      : "";

  const orgPanel = `
    <section class="panel">
      <div class="panel-head">
        <h2>Organization</h2>
        <form method="post" action="/orgs/sync" class="inline-form">
          <button type="submit" class="ghost">Refresh from WorkOS</button>
        </form>
      </div>
      <p class="panel-desc">Switch orgs anytime from the header — no re-login. Invites go to your active org by default.</p>
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

  const reposPanel = org
    ? `
    <section class="panel">
      <h2>Linked repositories</h2>
      <p class="panel-desc">Repos your agents can claim against. Linking here or via CLI is the same board.</p>
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
          : `<p class="empty">No repos yet. Link one below, or run <code>workboard link-repo</code>.</p>`
      }
      <form method="post" action="/repos" class="stack" style="margin-top:12px">
        <label>
          Repository
          <input name="repo" required placeholder="owner/name" autocomplete="off" />
        </label>
        <div class="row">
          <button type="submit">Link repo</button>
        </div>
      </form>
    </section>
  `
    : "";

  const cliPanel = `
    <section class="panel">
      <h2>CLI</h2>
      <p class="panel-desc">Claims and day-to-day coordination stay in the terminal. Use this site for org and repo setup.</p>
      <ol class="steps">
        <li>
          <strong>Sign in on this machine</strong>
          <code class="cmd">workboard login</code>
        </li>
        <li>
          <strong>Link the current repo</strong>
          <code class="cmd">workboard link-repo</code>
        </li>
        <li>
          <strong>Claim work from your agent</strong>
          <code class="cmd">workboard claim -t "Title" -f path/file.ts</code>
        </li>
      </ol>
    </section>
  `;

  return layout(
    "Setup",
    `
    ${topbar({ user, org, orgs })}
    <p class="lede"><strong>Setup &amp; settings.</strong> Agent work stays in the CLI — this page is for org, invites, and repos.</p>
    ${notices}
    ${orgPanel}
    ${reposPanel}
    ${cliPanel}
  `,
  );
}
