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
        <p class="meta">Pick the organization for this terminal session</p>
      </header>
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
        <h1>No organization</h1>
        <p class="meta">WorkOS membership required</p>
      </header>
      <p class="lede warn">Join or create an org in WorkOS, then retry <code>workboard login</code>.</p>
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
  const org = opts.orgName ? ` · <strong>${escapeHtml(opts.orgName)}</strong>` : "";
  return layout(
    "Approved",
    `
    <section class="focus-card">
      <div class="success-mark" aria-hidden="true">✓</div>
      <header class="page-header">
        <h1>CLI approved</h1>
        <p class="meta">Signed in as ${who}${org}</p>
      </header>
      <p class="lede">You can close this tab and return to the terminal.</p>
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
      <p class="lede">Approve this terminal login to connect <code>workboard</code> on this machine.</p>
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
      <p class="lede warn">No organization selected.</p>
      <p style="margin-top:14px"><a class="btn" href="/device?user_code=${encodeURIComponent(opts.userCode)}">Retry</a></p>
    </section>
  `,
    { narrow: true },
  );
}
