import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html.js";

export function setupPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  repos: Array<{ repo: string; verifiedAt: Date | null }>;
}): string {
  const { user, org, orgs, repos } = opts;

  const orgPanel = `
    <section class="panel">
      <div class="panel-head">
        <h2>Organization</h2>
        <form method="post" action="/orgs/sync" class="inline-form">
          <button type="submit" class="ghost">Refresh from WorkOS</button>
        </form>
      </div>
      <p class="panel-desc">WorkOS is the source of truth. Switch org from the header anytime.</p>
      ${
        org
          ? `<p>Active: <strong>${escapeHtml(org.name)}</strong> <span class="mono muted">${escapeHtml(org.slug)}</span></p>`
          : `<p class="warn">${orgs.length ? "Pick an organization in the header." : "No WorkOS organizations on your account yet."}</p>`
      }
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
    <p class="lede"><strong>Setup &amp; settings.</strong> Agent work stays in the CLI — this page is for org, repos, and connecting your machine.</p>
    ${orgPanel}
    ${reposPanel}
    ${cliPanel}
  `,
  );
}
