import { escapeHtml, layout } from "../html.js";

export function devicePickOrgPage(opts: {
  userCode: string;
  orgs: Array<{ id: string; name: string }>;
}): string {
  return layout(
    "Authorize CLI",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Authorize CLI</h1>
        <p class="meta">Choose a default team for this login</p>
      </header>
      <p class="lede">Day to day, <code>workboard</code> picks the team from your git remote when a repo is linked. This is only the fallback if a remote isn’t linked yet.</p>
      <ul class="list">
        ${opts.orgs
          .map(
            (o) => `
          <li>
            <form method="post" action="/device" style="width:100%">
              <input type="hidden" name="user_code" value="${escapeHtml(opts.userCode)}" />
              <input type="hidden" name="org_id" value="${escapeHtml(o.id)}" />
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

export function deviceNoOrgPage(): string {
  return layout(
    "Authorize CLI",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>No team yet</h1>
        <p class="meta">Create one in Workboard first</p>
      </header>
      <p class="lede">Open the site, create a team (and optionally invite a teammate), then retry <code>workboard login</code>.</p>
      <p style="margin-top:14px"><a class="btn" href="/">Open Workboard</a></p>
    </section>
  `,
    { narrow: true },
  );
}

export function deviceApprovedPage(opts: {
  email?: string | null;
  orgName?: string | null;
}): string {
  const who = opts.email ? escapeHtml(opts.email) : "your account";
  const org = opts.orgName ? ` · default team <strong>${escapeHtml(opts.orgName)}</strong>` : "";
  return layout(
    "Approved",
    `
    <section class="focus-card">
      <div class="success-mark" aria-hidden="true">✓</div>
      <header class="page-header">
        <h1>CLI approved</h1>
        <p class="meta">Signed in as ${who}${org}</p>
      </header>
      <p class="lede">You can close this tab. For each repo, the CLI follows <code>git remote</code> to the team that linked it.</p>
    </section>
  `,
    { narrow: true },
  );
}

export function deviceApprovePage(opts: {
  email?: string | null;
  orgName?: string | null;
  userCode: string;
}): string {
  const who = opts.email ? escapeHtml(opts.email) : "signed in";
  const org = opts.orgName ? ` · <strong>${escapeHtml(opts.orgName)}</strong>` : "";
  return layout(
    "Authorize CLI",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>Authorize CLI</h1>
        <p class="meta">${who}${org}</p>
      </header>
      <p class="lede">Approve this terminal login. After that, <code>workboard</code> picks the team from your git remote whenever the repo is linked.</p>
      <form method="post" action="/device" class="stack" style="margin-top:16px">
        <input type="hidden" name="user_code" value="${escapeHtml(opts.userCode)}" />
        <button type="submit">Approve terminal login</button>
      </form>
    </section>
  `,
    { narrow: true },
  );
}

export function deviceMissingOrgPage(opts: { userCode: string }): string {
  return layout(
    "Authorize CLI",
    `
    <section class="focus-card">
      <p class="lede warn">No team selected.</p>
      <p style="margin-top:14px"><a class="btn" href="/device?user_code=${encodeURIComponent(opts.userCode)}">Retry</a></p>
    </section>
  `,
    { narrow: true },
  );
}
