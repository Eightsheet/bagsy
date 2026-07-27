export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · Workboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0f1c18;
      --bg2: #173028;
      --ink: #e8f2ec;
      --muted: #9bb5a8;
      --accent: #7dffa3;
      --warn: #ffc978;
      --line: rgba(232,242,236,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #245243 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1a3a4a 0%, transparent 50%),
        linear-gradient(160deg, var(--bg), var(--bg2));
    }
    main { max-width: 820px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    .brand { font-family: Fraunces, Georgia, serif; letter-spacing: 0.02em; color: var(--accent); margin: 0 0 0.35rem; }
    h1, h2 { font-family: Fraunces, Georgia, serif; font-weight: 700; letter-spacing: -0.02em; }
    h1 { font-size: clamp(2rem, 5vw, 3rem); margin: 0.2rem 0 0.6rem; }
    h2 { font-size: 1.35rem; margin: 0 0 0.75rem; }
    .lede { color: var(--muted); max-width: 36rem; line-height: 1.5; }
    .muted { color: var(--muted); }
    .warn { color: var(--warn); }
    section {
      margin: 1.75rem 0;
      padding: 1.25rem 0;
      border-top: 1px solid var(--line);
    }
    .hero { border: 0; padding-top: 3rem; }
    .top { display: flex; justify-content: space-between; gap: 1rem; align-items: start; }
    a { color: var(--accent); }
    .btn, button {
      appearance: none;
      border: 1px solid var(--accent);
      background: color-mix(in oklab, var(--accent) 18%, transparent);
      color: var(--ink);
      padding: 0.55rem 0.95rem;
      border-radius: 0.4rem;
      font: inherit;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .btn:hover, button:hover { background: color-mix(in oklab, var(--accent) 28%, transparent); }
    input {
      width: 100%;
      margin-top: 0.35rem;
      padding: 0.55rem 0.7rem;
      border-radius: 0.35rem;
      border: 1px solid var(--line);
      background: rgba(0,0,0,0.25);
      color: var(--ink);
      font: inherit;
    }
    .stack { display: grid; gap: 0.75rem; max-width: 24rem; }
    .inline { display: inline; margin-left: 0.5rem; }
    ul { padding-left: 1.1rem; }
    li { margin: 0.45rem 0; }
    code, pre.token {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.92em;
    }
    pre.token {
      padding: 1rem;
      overflow-x: auto;
      background: rgba(0,0,0,0.35);
      border: 1px solid var(--line);
      border-radius: 0.5rem;
    }
    hr { border: 0; border-top: 1px solid var(--line); margin: 1.5rem 0; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}
