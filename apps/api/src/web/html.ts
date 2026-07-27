export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type ShellUser = {
  email?: string | null;
  name?: string | null;
  id: string;
};

export type ShellOrg = {
  id: string;
  slug: string;
  name: string;
};

const css = `
:root {
  --bg: #ffffff;
  --surface: #ffffff;
  --ink: #111111;
  --muted: #555555;
  --accent: #111111;
  --border: #111111;
  --line: #dddddd;
  --code-bg: #f0f0f0;
  --highlight: #ffe34d;
  --radius: 0px;
  --font: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}

*, *::before, *::after { box-sizing: border-box; }

html { overflow-x: hidden; scroll-behavior: smooth; }

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  overflow-x: hidden;
  font: 15px/1.4 var(--font);
  color: var(--ink);
  background: var(--bg);
}

a { color: var(--ink); text-decoration: underline; text-underline-offset: 0.12em; }
a:hover { background: var(--highlight); }

.site {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.site-main {
  flex: 1;
  width: min(760px, calc(100% - 32px));
  margin: 0 auto;
  padding: 28px 0 56px;
}

.site-main.narrow { width: min(520px, calc(100% - 32px)); }

.topbar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  border-bottom: 2px solid var(--ink);
  padding-bottom: 14px;
  margin-bottom: 22px;
}

.topbar-brand {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--ink);
  text-decoration: none;
  letter-spacing: -0.01em;
}

.topbar-brand:hover { background: var(--highlight); }

.topbar-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.topbar-user {
  color: var(--muted);
  font-size: 0.82rem;
}

.page-header {
  border-bottom: 2px solid var(--ink);
  padding-bottom: 14px;
  margin-bottom: 22px;
}

.brand-mark {
  margin: 0 0 4px;
  font-size: clamp(1.8rem, 6vw, 2.6rem);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.brand-mark.animate {
  animation: rise-in 520ms var(--ease) both;
}

.meta {
  color: var(--muted);
  font-size: 0.82rem;
  margin: 0;
  letter-spacing: 0.02em;
}

h1 {
  font-size: 1.45rem;
  line-height: 1.2;
  margin: 0 0 8px;
  font-weight: 700;
}

h2 {
  font-size: 0.78rem;
  margin: 28px 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-top: 2px solid var(--ink);
  padding-top: 10px;
  font-weight: 700;
}

.panel:first-of-type h2,
.below-fold > h2:first-child {
  margin-top: 0;
}

.lede {
  font-size: 1rem;
  line-height: 1.45;
  margin: 0 0 14px;
  padding: 10px 12px;
  background: var(--highlight);
  max-width: none;
  color: var(--ink);
}

.lede.animate {
  animation: rise-in 520ms var(--ease) 60ms both;
}

.muted { color: var(--muted); }
.warn { color: var(--ink); background: var(--highlight); padding: 2px 4px; }
.ok { color: var(--ink); border: 1px solid var(--ink); padding: 8px 10px; margin: 0 0 14px; }
.split {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: 1fr;
}
@media (min-width: 640px) {
  .split { grid-template-columns: 1fr 1fr; gap: 1.5rem; }
}
.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}
.check input { width: auto; margin: 0; }

.quiet-details {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.quiet-details summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.88rem;
  list-style: none;
}
.quiet-details summary::-webkit-details-marker { display: none; }
.quiet-details summary::before {
  content: "+ ";
  font-weight: 600;
}
.quiet-details[open] summary::before { content: "– "; }
.quiet-details summary:hover { background: var(--highlight); color: var(--ink); }

.hero {
  min-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8px 0 48px;
  gap: 0;
}

.hero .page-header { margin-bottom: 18px; }

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 18px;
  animation: rise-in 520ms var(--ease) 100ms both;
}

.below-fold {
  padding-top: 8px;
}

.panel { margin: 0; padding: 0; }

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.panel-head h2 { flex: 1; }

.panel-desc {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.45;
}

.btn, button {
  appearance: none;
  border: 1.5px solid var(--ink);
  background: var(--highlight);
  color: var(--ink);
  padding: 8px 14px;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  transition: transform 100ms var(--ease), background 120ms ease;
}

.btn:hover, button:hover {
  background: #fff176;
  color: var(--ink);
  text-decoration: none;
}

.btn:active, button:active {
  transform: scale(0.98);
}

.btn:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

.btn-ghost, button.ghost {
  background: transparent;
  color: var(--ink);
}

.btn-ghost:hover, button.ghost:hover {
  background: var(--highlight);
}

.btn-secondary, a.btn-secondary {
  background: var(--bg);
  color: var(--ink);
}

.btn-secondary:hover, a.btn-secondary:hover {
  background: var(--code-bg);
}

label {
  display: grid;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

input, select {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius);
  border: 1.5px solid var(--ink);
  background: var(--bg);
  color: var(--ink);
  font: inherit;
  font-size: 0.95rem;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
}

.stack { display: grid; gap: 12px; max-width: 26rem; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.inline-form { display: inline; }

.org-select {
  display: flex;
  align-items: center;
  gap: 6px;
}

.org-select select {
  width: auto;
  min-width: 9rem;
  max-width: 14rem;
  padding: 5px 8px;
  font-size: 0.85rem;
}

.list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  border-top: 1px solid var(--ink);
  border-bottom: 1px solid var(--ink);
}

.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  margin: 0;
}

.list li:last-child { border-bottom: 0; }

.badge {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 6px;
  border: 1.5px solid var(--ink);
  white-space: nowrap;
}

.badge.ok { background: var(--highlight); }

.empty {
  padding: 8px 0 12px;
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.45;
}

.steps {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  counter-reset: step;
}

.steps li {
  counter-increment: step;
  position: relative;
  padding: 8px 10px 8px 42px;
  border-bottom: 1px solid var(--line);
  margin: 0;
}

.steps li::before {
  content: counter(step);
  position: absolute;
  left: 8px;
  top: 8px;
  width: 22px;
  height: 22px;
  border: 1.5px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
  background: var(--bg);
}

.steps strong { display: block; margin-bottom: 2px; font-weight: 700; }

code, .mono {
  font-family: var(--mono);
  font-size: 0.86em;
  background: var(--code-bg);
  padding: 1px 4px;
}

.cmd {
  display: block;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--code-bg);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: 0.84rem;
  overflow-x: auto;
  white-space: nowrap;
}

.focus-card { margin-top: 24px; }

.success-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1.5px solid var(--ink);
  background: var(--highlight);
  font-weight: 700;
  margin-bottom: 12px;
  animation: pop-in 360ms var(--ease) both;
}

@keyframes rise-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pop-in {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111111;
    --surface: #111111;
    --ink: #f0f0f0;
    --muted: #a0a0a0;
    --accent: #f0f0f0;
    --border: #f0f0f0;
    --line: #333333;
    --code-bg: #2a2a2a;
    --highlight: #5c4a00;
  }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .brand-mark.animate,
  .lede.animate,
  .hero-actions,
  .success-mark {
    animation: none !important;
  }
  .btn:active, button:active { transform: none; }
}

@media (max-width: 560px) {
  .site-main, .site-main.narrow { width: min(100% - 24px, 760px); padding: 20px 0 40px; }
  .hero { min-height: calc(100dvh - 40px); }
  .org-select select { max-width: 10rem; }
}
`;

export function layout(
  title: string,
  body: string,
  opts?: { narrow?: boolean },
): string {
  const pageTitle = title === "Workboard" ? "Workboard" : `${title} · Workboard`;
  const mainClass = opts?.narrow ? "site-main narrow" : "site-main";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="site">
    <main class="${mainClass}">${body}</main>
  </div>
</body>
</html>`;
}

export function topbar(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
}): string {
  const label = opts.user.email ?? opts.user.name ?? opts.user.id;
  const orgControl =
    opts.orgs.length > 0
      ? `<form class="org-select" method="post" action="/orgs/use">
          <label class="muted" for="org-slug" style="display:none">Organization</label>
          <select id="org-slug" name="slug" onchange="this.form.submit()">
            ${opts.orgs
              .map(
                (o) =>
                  `<option value="${escapeHtml(o.slug)}"${opts.org?.id === o.id ? " selected" : ""}>${escapeHtml(o.name)}</option>`,
              )
              .join("")}
          </select>
        </form>`
      : `<span class="muted">No organization</span>`;

  return `
    <header class="topbar">
      <a class="topbar-brand" href="/">Workboard</a>
      <div class="topbar-meta">
        ${orgControl}
        <span class="topbar-user">${escapeHtml(label)}</span>
        <form method="post" action="/logout"><button type="submit" class="ghost">Log out</button></form>
      </div>
    </header>
  `;
}
