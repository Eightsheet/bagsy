import { layout } from "../html.js";

export function privacyPage(): string {
  return layout(
    "Privacy",
    `
    <section class="below-fold" style="padding-top:28px">
      <header class="page-header">
        <h1>Privacy</h1>
        <p class="meta">What Bagsy stores, where it runs, and what it never does</p>
      </header>

      <h2>Who we are</h2>
      <p>Bagsy is operated by [CONTROLLER NAME AND ADDRESS]. For anything privacy-related, contact
      <a href="mailto:[CONTACT EMAIL]">[CONTACT EMAIL]</a>.</p>

      <h2>What we store</h2>
      <p><strong>Account.</strong> When you sign in via WorkOS AuthKit we store your email address,
      display name, and WorkOS user ID. If you verify repo access with GitHub, we also store your
      GitHub username and account ID.</p>
      <p><strong>Teams.</strong> Team name, slug, and who is a member (managed through WorkOS
      organizations). Invitations store the invitee's email address.</p>
      <p><strong>Board data.</strong> Claims are the product: title, description, file paths, branch
      names, notes, agent labels, an optional outcome reference (PR URL or commit SHA), timestamps,
      and which linked repository (owner/name) they belong to. Everything you or your agent put in a
      claim is visible to every member of that team. We never read or store your repository's code.</p>
      <p><strong>Credentials.</strong> CLI API tokens are stored as salted hashes — we cannot recover
      the token itself. Browser sessions use a single functional cookie (<code>wb_session</code>).</p>

      <h2>What we don't do</h2>
      <p>No analytics, no advertising, no tracking cookies, no selling or sharing of data with third
      parties beyond the processors below. Rate-limiting counters (per IP) are kept in memory only.</p>

      <h2>Processors &amp; hosting</h2>
      <p>Authentication runs through <a href="https://workos.com/legal/privacy">WorkOS</a>. The API and
      database are hosted on <a href="https://railway.com/legal/privacy">Railway</a>. Repo-access
      verification calls the <a href="https://docs.github.com/en/site-policy/privacy-policies">GitHub API</a>;
      GitHub tokens you pass for verification are used for that request and not stored.</p>

      <h2>Retention &amp; deletion</h2>
      <p>Released and expired claims are retained so your team keeps its history. You can delete your
      account, or a whole team including its board, yourself at any time under
      <strong>Setup → Danger zone</strong> after signing in — deletion is immediate and covers the
      WorkOS records too. Server logs at our hosting provider rotate automatically.</p>

      <h2>Your rights</h2>
      <p>Under the GDPR you can request access to, correction of, or deletion of your personal data,
      ask for a copy in a portable format, and lodge a complaint with a supervisory authority.
      Contact us at <a href="mailto:[CONTACT EMAIL]">[CONTACT EMAIL]</a> for any of these.</p>

      <p class="meta" style="margin-top:24px">Last updated: 2026-07-28 · <a href="/">Back to Bagsy</a></p>
    </section>
  `,
    { narrow: true },
  );
}
