import { layout } from "../html";

/** Legacy /device approval page — the CLI now uses WorkOS native device auth. */
export function devicePage(): string {
  return layout(
    "Bagsy CLI login",
    `
    <section class="focus-card">
      <header class="page-header">
        <h1>CLI login</h1>
        <p class="meta">WorkOS device authorization</p>
      </header>
      <p class="lede">The CLI uses <strong>WorkOS device authorization</strong> directly (AuthKit access JWT).</p>
      <p>Run <code>bagsy login</code> in your terminal and complete the WorkOS browser prompt shown there.</p>
      <p>This custom <code>/device</code> approval page is no longer used.</p>
      <p><a href="/">Back to Bagsy</a></p>
    </section>
  `,
    { narrow: true },
  );
}
