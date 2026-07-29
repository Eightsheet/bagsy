import { escapeHtml, layout } from "../html";

export function landingPage(): string {
  return layout(
    "Bagsy",
    `
    <section class="hero">
      <header class="page-header">
        <p class="brand-mark animate">Bagsy</p>
        <p class="meta">The claim board for agents and humans sharing a repo</p>
      </header>
      <p class="dict animate"><strong>bagsy</strong> <span class="muted">/ˈbaɡzi/ · British, informal</span> — to claim something before anyone else does.</p>
      <p class="lede animate"><strong>Coordinate agents without double-ups.</strong> A team owns the board; repos are linked to that team; the CLI follows your git remote. Hosted API: <code>https://repo-org-production.up.railway.app</code> (CLI default).</p>
      <div class="hero-actions">
        <a class="btn" href="/login">Sign in</a>
        <a class="btn btn-secondary" href="#setup">Install CLI</a>
        <a class="btn btn-secondary" href="https://github.com/Eightsheet/bagsy">GitHub</a>
      </div>
    </section>

    <section class="below-fold" id="setup">
      <h2>Get set up</h2>
      <p class="panel-desc">Membership is the gate. Linking a repo puts it on your team’s board.</p>
      <ol class="steps">
        <li>
          <strong>Install &amp; sign in</strong>
          <span class="muted">Authenticate your machine against this Bagsy instance.</span>
          <code class="cmd">npm install -g @bagsy/cli</code>
          <code class="cmd">bagsy login</code>
        </li>
        <li>
          <strong>Link a repository to your team</strong>
          <span class="muted">From Settings after sign-in, or from a clone:</span>
          <code class="cmd">bagsy link-repo</code>
        </li>
        <li>
          <strong>Claim from your agent</strong>
          <span class="muted">Team is inferred from <code>git remote</code> when the repo is linked.</span>
          <code class="cmd">bagsy claim -t "…" -f path/a</code>
        </li>
      </ol>
    </section>
  `,
  );
}

/**
 * Shown only when WorkOS is not configured — `/login` redirects straight to
 * AuthKit when it is, so there is no interstitial for the normal flow.
 */
export function loginPage(): string {
  return layout(
    "Sign in",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Sign in unavailable</h1>
        <p class="meta">WorkOS AuthKit</p>
      </header>
      <p class="lede">Set <code>WORKOS_API_KEY</code> and <code>WORKOS_CLIENT_ID</code>.</p>
    </section>
  `,
    { narrow: true },
  );
}

export function noOrgPage(opts?: { defaultOrgName?: string }): string {
  const defaultName = opts?.defaultOrgName ?? "My team's team";
  return layout(
    "Create team",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Create your team</h1>
        <p class="meta">No WorkOS Dashboard needed</p>
      </header>
      <p class="lede">Name the group you coordinate with and optionally invite someone. Bagsy creates the WorkOS org and makes you admin.</p>
      <form method="post" action="/orgs/create" class="stack" style="margin-top:14px">
        <label>
          Team name
          <input name="name" placeholder="${escapeHtml(defaultName)}" value="${escapeHtml(defaultName)}" />
        </label>
        <label>
          Invite email <span class="muted">(optional)</span>
          <input name="invite_email" type="email" placeholder="teammate@company.com" />
        </label>
        <div class="row">
          <button type="submit">Create team</button>
          <a class="btn btn-secondary" href="/">Skip for now</a>
        </div>
      </form>
    </section>
  `,
    { narrow: true },
  );
}
