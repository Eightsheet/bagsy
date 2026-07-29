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
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #ffffff;
  --ink: #111111;
  --muted: #555555;
  --accent: #111111;
  --border: #111111;
  --line: #dddddd;
  --code-bg: #f0f0f0;
  --highlight: #ffe34d;
  --highlight-strong: #fff176;
  /* Ink printed ON the yellow. Stays dark in both schemes. */
  --on-highlight: #111111;
  --danger: #c62828;
  --danger-wash: #fdecea;
  --danger-line: #e0a0a0;
  --radius: 0px;
  --font: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}

/* Same poster, printed on black paper. */
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0f10;
    --surface: #141416;
    --ink: #ededea;
    --muted: #a8a49c;
    --accent: #ededea;
    --border: #ededea;
    --line: #35353a;
    --code-bg: #1c1c1f;
    --highlight: #f2d13c;
    --highlight-strong: #ffe34d;
    --on-highlight: #111111;
    --danger: #ff7b72;
    --danger-wash: #2a1614;
    --danger-line: #5c2b28;
  }
}

*, *::before, *::after { box-sizing: border-box; }

/* No overflow-x here: 'hidden' on html or body makes it a scroll container, which
   silently kills position:sticky on every descendant — including the board's
   sticky table head. 'clip' still prevents sideways page scroll without
   creating a scrollport. */
html { scroll-behavior: smooth; }

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  overflow-x: clip;
  font: 15px/1.4 var(--font);
  color: var(--ink);
  background: var(--bg);
}

a { color: var(--ink); text-decoration: underline; text-underline-offset: 0.12em; }
a:hover { background: var(--highlight); color: var(--on-highlight); }

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

/* The audit surface only. Reading widths stay at 760px — a fold you read as
   prose must not stretch just because a table elsewhere needs the room. */
.site-main.wide, .site-footer.wide { width: min(1180px, calc(100% - 32px)); }

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

.topbar-brand:hover { background: var(--highlight); color: var(--on-highlight); }

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

/* Fills the bottom of the deliberate 1rem–1.45rem gap between .lede and h1
   rather than inventing a new step in the scale. */
h3 {
  font-size: 1rem;
  line-height: 1.3;
  font-weight: 700;
  margin: 0 0 4px;
}

.lede {
  font-size: 1rem;
  line-height: 1.45;
  margin: 0 0 14px;
  padding: 10px 12px;
  background: var(--highlight);
  max-width: none;
  color: var(--on-highlight);
}

.lede.animate {
  animation: rise-in 520ms var(--ease) 60ms both;
}

.dict {
  margin: 0 0 14px;
  font-size: 0.92rem;
  line-height: 1.45;
  border-left: 3px solid var(--ink);
  padding-left: 12px;
}

.panel.danger h2 {
  color: var(--danger);
  border-top-color: var(--danger);
}

.panel.danger .quiet-details summary { color: var(--danger); }
.panel.danger .quiet-details summary:hover { background: var(--danger-wash); color: var(--danger); }

.panel.danger button {
  background: transparent;
  border-color: var(--danger);
  color: var(--danger);
}

.panel.danger button:hover { background: var(--danger-wash); color: var(--danger); }

.site-footer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto;
  padding: 14px 0 22px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.82rem;
  letter-spacing: 0.02em;
}

.dict.animate {
  animation: rise-in 520ms var(--ease) 30ms both;
}

.muted { color: var(--muted); }
.warn { color: var(--on-highlight); background: var(--highlight); padding: 2px 4px; }
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
.quiet-details summary:hover { background: var(--highlight); color: var(--on-highlight); }

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

.model-steps li {
  display: grid;
  gap: 4px;
}
.model-steps li span {
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.45;
}
.how-it-works .steps {
  margin-top: 4px;
}

.btn, button {
  appearance: none;
  border: 1.5px solid var(--ink);
  background: var(--highlight);
  color: var(--on-highlight);
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
  background: var(--highlight-strong);
  color: var(--on-highlight);
  text-decoration: none;
}

.btn:active, button:active {
  transform: scale(0.98);
}

/* summary was missing and this surface is built out of disclosures. */
.btn:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible,
select:focus-visible, summary:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

/* Hidden from sight, not from assistive tech — unlike display:none. */
.vh {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.skip-link { position: absolute; left: -9999px; }
.skip-link:focus {
  position: static;
  display: inline-block;
  background: var(--highlight);
  color: var(--on-highlight);
  padding: 6px 10px;
}

.btn-ghost, button.ghost {
  background: transparent;
  color: var(--ink);
}

.btn-ghost:hover, button.ghost:hover {
  background: var(--highlight);
  color: var(--on-highlight);
}

/* Inline, text-sized actions inside lists (member/invite rows). */
button.link-btn {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  padding: 3px 8px;
  font-size: 0.8rem;
  border-radius: 6px;
  width: auto;
}
button.link-btn:hover {
  background: var(--highlight);
  color: var(--on-highlight);
  transform: none;
}
button.link-btn.danger { color: var(--danger); border-color: var(--danger-line, var(--line)); }
button.link-btn.danger:hover { background: var(--danger-wash); color: var(--danger); }

/* Per-row "Manage" disclosure: opening it is the are-you-sure step, so the
   actions inside spell out exactly what they do instead of a browser confirm. */
.row-manage { position: relative; }
.row-manage summary {
  cursor: pointer;
  list-style: none;
  color: var(--muted);
  font-size: 0.8rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px 8px;
}
.row-manage summary::-webkit-details-marker { display: none; }
.row-manage summary::after { content: " ▾"; }
.row-manage[open] summary::after { content: " ▴"; }
.row-manage summary:hover,
.row-manage[open] summary {
  background: var(--highlight);
  color: var(--on-highlight);
  border-color: var(--ink);
}
.row-manage-actions {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 10;
  min-width: 240px;
  background: var(--surface);
  border: 1px solid var(--ink);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row-manage-actions form { margin: 0; }
.row-manage-actions button.link-btn {
  width: 100%;
  text-align: left;
  border-color: transparent;
}
.row-manage-actions button.link-btn:hover { border-color: var(--ink); transform: none; }

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

.badge.ok { background: var(--highlight); color: var(--on-highlight); border-color: var(--ink); }

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
  cursor: pointer;
  position: relative;
}

.cmd:hover { border-color: var(--ink); }
.cmd:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.cmd.copied { background: var(--highlight); color: var(--on-highlight); border-color: var(--ink); }
.cmd::after {
  content: "click to copy";
  float: right;
  margin-left: 12px;
  font-family: var(--font);
  font-size: 0.72rem;
  color: var(--muted);
  white-space: nowrap;
}
.cmd.copied::after { content: "copied"; color: var(--on-highlight); font-weight: 700; }

/* A board page carries dozens of copy targets; sixty permanent "click to copy"
   labels is noise. The affordance stays for hover and for keyboard focus. */
.cmd.quiet::after { opacity: 0; transition: opacity 120ms ease; }
.cmd.quiet:hover::after, .cmd.quiet:focus-visible::after { opacity: 1; }

.focus-card { margin-top: 24px; }

.success-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1.5px solid var(--ink);
  background: var(--highlight);
  color: var(--on-highlight);
  font-weight: 700;
  margin-bottom: 12px;
  animation: pop-in 360ms var(--ease) both;
}

/* ---------------------------------------------------------------------------
   Board. Everything below is the claim board; nothing above it changed shape.
   No new colours and no new motion — the status scale is carried by the border
   weights the system already uses (2px section / 1.5px chrome / 1px divider),
   because yellow is spoken for as emphasis-and-hover and cannot also mean a
   state.
   --------------------------------------------------------------------------- */

.topbar-nav { display: flex; gap: 16px; font-size: 0.9rem; }
.topbar-nav a { text-decoration: none; padding-bottom: 2px; }
.topbar-nav a[aria-current="page"] { font-weight: 700; border-bottom: 2px solid var(--ink); }

/* The fold: at most five things that need a person, ranked. Its length is a
   function of how many decisions exist, never of how many claims exist. */
.fold { list-style: none; margin: 0 0 8px; padding: 0; border-top: 1px solid var(--ink); }
.finding { padding: 14px 0; border-bottom: 1px solid var(--line); }
.finding:last-child { border-bottom: 0; }
/* Borrows .dict's 3px rule to mark the lead story. Only the first one gets it. */
.finding.lead { border-left: 3px solid var(--ink); padding-left: 12px; }
.finding-kind { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin: 0 0 6px; }
.finding h3 { margin: 0 0 4px; }
.finding-facts { margin: 0 0 6px; color: var(--muted); font-size: 0.86rem; }
.finding-consequence { margin: 0 0 6px; }
.finding-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; }
.finding .quiet-details { margin-top: 10px; }

/* Two claims, side by side, so the comparison is spatial instead of narrated.
   A hairline between them is the print answer and needs no alt text. */
.versus { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0; }
.versus > :nth-child(2) { border-left: 1px solid var(--line); padding-left: 16px; }
.versus h4 { margin: 0 0 2px; font-size: 0.9rem; font-weight: 700; }
.versus p { margin: 0; font-size: 0.82rem; color: var(--muted); }

/* Soft-hold meter. Server-computed integer width; never user text, never
   animated. Exactly one per finding — 200 of these would be ink noise, which
   is why the table uses an aligned duration column instead. */
.pressure {
  display: inline-block;
  width: 120px;
  height: 10px;
  border: 1.5px solid var(--ink);
  vertical-align: -1px;
}
.pressure > i { display: block; height: 100%; background: var(--ink); }

/* The agate: every live claim, dense. A claims board with columns is a table,
   so it is a table — div soup with ARIA is strictly worse here.
   Deliberately NOT wrapped in an overflow-x scroller: overflow-x:auto computes
   overflow-y to auto too, which would make the wrapper the sticky thead's
   scrollport and stop it sticking to the viewport at all. table-layout:fixed
   plus the column drops below mean it never needs to scroll sideways. */
.agate { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 0.82rem; }
.agate th {
  text-align: left;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 6px 10px 6px 0;
  border-bottom: 2px solid var(--ink);
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg);
}
.agate th a { color: inherit; text-decoration: none; }
.agate th a:hover { background: var(--highlight); color: var(--on-highlight); }
.agate td, .agate tbody th {
  padding: 5px 10px 5px 0;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
  text-align: left;
  position: static;
  background: transparent;
  border-top: 0;
  text-transform: none;
  letter-spacing: normal;
  font-size: inherit;
  color: inherit;
}
/* Rows hover --code-bg, not yellow: a 1180px band of #ffe34d is a different
   object from a text-sized hover target. Yellow still fires on the link inside.
   No transition — a 120ms fade swept across 200 rows reads as a strobe. */
.arow:hover td, .arow:hover th,
.arow:focus-within td, .arow:focus-within th { background: var(--code-bg); }
.agate-group th {
  border-top: 2px solid var(--ink);
  border-bottom: 0;
  padding-top: 14px;
  color: var(--ink);
  font-family: var(--mono);
  text-transform: none;
  letter-spacing: 0;
  position: static;
  background: transparent;
}
.c-status { width: 7.5rem; }
.c-clock { width: 5rem; text-align: right; }
.c-files { width: 4.5rem; text-align: right; }
.c-who { width: 8rem; }
.c-agent { width: 9rem; }
.c-repo { width: 12rem; }
.c-title { width: auto; }
.agate .mono, .agate .c-clock, .agate .c-files, .agate .c-repo {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.f-delta { font-weight: 700; }
/* Columns are hidden, never restacked, so table semantics survive. */
@media (max-width: 900px) { .c-agent, .c-repo, .c-files { display: none; } }
@media (max-width: 640px) { .c-who { display: none; } }

/* Per-repo standings. Zeros print as a muted middot so only real numbers
   carry ink across 12 x 4 cells. */
.standings { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.standings th {
  text-align: left;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 2px solid var(--ink);
  padding: 6px 10px 6px 0;
}
.standings td { padding: 4px 10px 4px 0; border-bottom: 1px solid var(--line); }
.standings td + td, .standings th + th {
  text-align: right;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.standings tfoot td { border-top: 2px solid var(--ink); border-bottom: 0; font-weight: 700; }

.timeline { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--ink); }
.timeline li {
  display: grid;
  grid-template-columns: 7rem 6.5rem minmax(0, 1fr);
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.timeline time { font-family: var(--mono); font-size: 0.78rem; color: var(--muted); }
.timeline .kind {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.timeline .msg { min-width: 0; overflow-wrap: anywhere; }
/* An agent's own words get the pull-quote rule; system events do not. */
.timeline li.note .msg { border-left: 3px solid var(--ink); padding-left: 10px; }
@media (max-width: 560px) { .timeline li { grid-template-columns: 1fr; gap: 2px; } }

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.filters label { gap: 4px; }
.filters input, .filters select { width: auto; min-width: 8rem; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
/* Shares button.link-btn's shape so the two read as one family. */
a.chip {
  display: inline-block;
  font-size: 0.8rem;
  color: var(--muted);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px 8px;
}
a.chip:hover { background: var(--highlight); color: var(--on-highlight); }
a.chip[aria-current="true"] { border: 1.5px solid var(--ink); color: var(--ink); font-weight: 700; }

/* Announces that the board moved. Never applies the change. */
.stale-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 2px solid var(--ink);
  padding: 6px 0;
  font-size: 0.82rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

/* Not a badge (would collide with the status weights) and not yellow (spent). */
.new-mark {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-bottom: 1.5px solid var(--ink);
}

/* Status scale by border weight, since there is no status palette and there
   should not be one. */
.badge.mark { border-width: 2px; }
.badge.quiet { border: 1px solid var(--line); color: var(--muted); }

.files { list-style: none; margin: 0; padding: 0; font-family: var(--mono); font-size: 0.82rem; }
.files li { padding: 3px 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.files li.shared::before { content: "‡ "; font-weight: 700; }

.crumb { font-size: 0.82rem; color: var(--muted); margin: 0 0 10px; font-family: var(--mono); }

.tail { margin: 10px 0 0; color: var(--muted); font-size: 0.86rem; }

@keyframes rise-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pop-in {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
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
  .cmd.quiet::after { transition: none; }
}

@media (max-width: 560px) {
  .site-main, .site-main.narrow, .site-main.wide,
  .site-footer, .site-footer.wide { width: min(100% - 24px, 760px); }
  .site-main, .site-main.narrow, .site-main.wide { padding: 20px 0 40px; }
  .hero { min-height: calc(100dvh - 40px); }
  .org-select select { max-width: 10rem; }
  .versus { grid-template-columns: 1fr; }
  .versus > :nth-child(2) { border-left: 0; border-top: 1px solid var(--line); padding: 10px 0 0; }
}
`;

export function layout(
  title: string,
  body: string,
  opts?: {
    narrow?: boolean;
    wide?: boolean;
    skipTo?: { id: string; label: string };
    /** Extra progressive-enhancement script. The page must be complete without it. */
    islands?: string;
  },
): string {
  const pageTitle = title === "Bagsy" ? "Bagsy" : `${title} · Bagsy`;
  const width = opts?.narrow ? " narrow" : opts?.wide ? " wide" : "";
  const mainClass = `site-main${width}`;
  const skip = opts?.skipTo
    ? `<a class="skip-link" href="#${escapeHtml(opts.skipTo.id)}">${escapeHtml(opts.skipTo.label)}</a>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <style>${css}</style>
</head>
<body>
  <div class="site">
    ${skip}
    <main class="${mainClass}">${body}</main>
    <footer class="site-footer${width}">
      <a href="https://github.com/Eightsheet/bagsy">GitHub</a> · <a href="https://github.com/Eightsheet/bagsy/issues">Support</a> · <a href="/privacy">Privacy</a>
    </footer>
  </div>
  <script>
  (function () {
    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
        } catch (err) {
          reject(err);
        } finally {
          document.body.removeChild(ta);
        }
      });
    }
    // One delegated pair of listeners rather than two per element: a board page
    // carries dozens of copy targets, and they can be added after first paint.
    function copyFrom(el) {
      var text = (el.textContent || "").trim();
      if (!text) return;
      copyText(text).then(function () {
        el.classList.add("copied");
        window.setTimeout(function () { el.classList.remove("copied"); }, 1200);
      }).catch(function () { /* ignore */ });
    }
    function markCopyable(root) {
      (root || document).querySelectorAll("code.cmd:not([role])").forEach(function (el) {
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("title", "Click to copy");
      });
    }
    markCopyable(document);
    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("code.cmd") : null;
      if (el) copyFrom(el);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el = e.target && e.target.closest ? e.target.closest("code.cmd") : null;
      if (!el) return;
      e.preventDefault();
      copyFrom(el);
    });

    // The team switcher auto-submits on change, so its explicit Switch button
    // is only needed when scripting is off. Removing it here is the smallest
    // honest way to keep both paths working.
    document.querySelectorAll("[data-nojs]").forEach(function (el) { el.remove(); });
  })();
  </script>
  ${opts?.islands ?? ""}
</body>
</html>`;
}

/** Which top-level surface is being rendered, for `aria-current` in the nav. */
export type TopbarSection = "board" | "queue" | "setup" | null;

const NAV: Array<{ href: string; label: string; key: Exclude<TopbarSection, null> }> = [
  { href: "/", label: "Board", key: "board" },
  { href: "/queue", label: "Follow-ups", key: "queue" },
  { href: "/setup", label: "Setup", key: "setup" },
];

export function topbar(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  section?: TopbarSection;
}): string {
  const label = opts.user.email ?? opts.user.name ?? opts.user.id;
  const orgControl =
    opts.orgs.length > 0
      ? `<form class="org-select" method="post" action="/orgs/use">
          <label class="vh" for="org-slug">Team</label>
          <select id="org-slug" name="slug" onchange="this.form.submit()" title="Active team">
            ${opts.orgs
              .map(
                (o) =>
                  `<option value="${escapeHtml(o.slug)}"${opts.org?.id === o.id ? " selected" : ""}>${escapeHtml(o.name)}</option>`,
              )
              .join("")}
          </select>
          <button type="submit" class="link-btn" data-nojs>Switch</button>
        </form>`
      : `<span class="muted">No team</span>`;

  const nav = `
        <nav class="topbar-nav" aria-label="Sections">
          ${NAV.map(
            (item) =>
              `<a href="${item.href}"${opts.section === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`,
          ).join("")}
        </nav>`;

  return `
    <header class="topbar">
      <a class="topbar-brand" href="/">Bagsy</a>
      ${nav}
      <div class="topbar-meta">
        ${orgControl}
        <span class="topbar-user">${escapeHtml(label)}</span>
        <form method="post" action="/logout"><button type="submit" class="ghost">Log out</button></form>
      </div>
    </header>
  `;
}
