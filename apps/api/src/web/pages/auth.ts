import { escapeHtml, layout } from "../html.js";

export function landingPage(): string {
  return layout(
    "Workboard",
    `
    <section class="hero">
      <header class="page-header">
        <p class="brand-mark animate">Workboard</p>
        <p class="meta">Setup &amp; settings · claims stay in the CLI</p>
      </header>
      <p class="lede animate"><strong>Coordinate agents without double-ups.</strong> Sign in here to wire org and repos. Day-to-day claiming happens in the terminal.</p>
      <div class="hero-actions">
        <a class="btn" href="/login">Sign in</a>
        <a class="btn btn-secondary" href="#setup">Install CLI</a>
      </div>
    </section>

    <section class="below-fold" id="setup">
      <h2>Get set up</h2>
      <p class="panel-desc">Same board whether you link a repo here or from the CLI.</p>
      <ol class="steps">
        <li>
          <strong>Install &amp; sign in</strong>
          <span class="muted">Authenticate your machine against this Workboard.</span>
          <code class="cmd">workboard login</code>
        </li>
        <li>
          <strong>Link a repository</strong>
          <span class="muted">Do it under Settings after sign-in, or from the repo:</span>
          <code class="cmd">workboard link-repo owner/name</code>
        </li>
        <li>
          <strong>Claim from your agent</strong>
          <span class="muted">Coordination stays in the terminal — not on this site.</span>
          <code class="cmd">workboard claim -t "…" -f path/a</code>
        </li>
      </ol>
    </section>
  `,
  );
}

export function loginPage(opts: { workosUrl: string | null }): string {
  if (!opts.workosUrl) {
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

  return layout(
    "Sign in",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Sign in</h1>
        <p class="meta">Workboard · WorkOS AuthKit</p>
      </header>
      <p class="lede">Continue with WorkOS. Your organizations sync automatically.</p>
      <p style="margin-top:16px"><a class="btn" href="${escapeHtml(opts.workosUrl)}">Continue with WorkOS</a></p>
    </section>
  `,
    { narrow: true },
  );
}

export function chooseOrgPage(opts: {
  orgs: Array<{ id: string; name: string }>;
  pendingToken: string;
  state: string;
}): string {
  return layout(
    "Choose organization",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Choose organization</h1>
        <p class="meta">You belong to more than one WorkOS org</p>
      </header>
      <ul class="list" style="margin-top:8px">
        ${opts.orgs
          .map(
            (o) => `
          <li>
            <form method="post" action="/auth/select-org" style="width:100%">
              <input type="hidden" name="organization_id" value="${escapeHtml(o.id)}" />
              <input type="hidden" name="pending_token" value="${escapeHtml(opts.pendingToken)}" />
              <input type="hidden" name="state" value="${escapeHtml(opts.state)}" />
              <button type="submit" style="width:100%">${escapeHtml(o.name)}</button>
            </form>
          </li>`,
          )
          .join("")}
      </ul>
    </section>
  `,
    { narrow: true },
  );
}

export function noOrgPage(opts?: { defaultOrgName?: string }): string {
  const defaultName = opts?.defaultOrgName ?? "My team's team";
  return layout(
    "Create organization",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Create your organization</h1>
        <p class="meta">No WorkOS Dashboard needed</p>
      </header>
      <p class="lede">Name a team and optionally invite someone. Workboard creates the WorkOS org and makes you admin.</p>
      <form method="post" action="/orgs/create" class="stack" style="margin-top:14px">
        <label>
          Organization name
          <input name="name" placeholder="${escapeHtml(defaultName)}" value="${escapeHtml(defaultName)}" />
        </label>
        <label>
          Invite email <span class="muted">(optional)</span>
          <input name="invite_email" type="email" placeholder="teammate@company.com" />
        </label>
        <div class="row">
          <button type="submit">Create organization</button>
          <a class="btn btn-secondary" href="/">Skip for now</a>
        </div>
      </form>
    </section>
  `,
    { narrow: true },
  );
}
