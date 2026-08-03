# Shareframe Roadmap — Artifact quality

**04 Aug 2026** · Product + skill decisions

**Decision:** Quality control moves from the per-agent skill into the Shareframe product. The CLI becomes the control point (scaffold → check → preview → publish gate); the skill shrinks to routing and judgment. No agent-in-the-CLI generation unless evals prove skill-guided authoring insufficient (S7).

Design references: [Røde — Designing better artifacts for Dia](https://www.linkedin.com/pulse/designing-better-artifacts-dia-browser-christine-r%C3%B8de-z0ame) (consistent · subtly varied · rooted in convention; constraints as the quality signal), [Dia — Meet Reports](https://www.diabrowser.com/release-notes/1-39-1-reports) (aggregation-first, sources cited, "finishing touches are yours").

Note: S1–S3 and S7 are implemented in the Shareframe repo; S4–S6 in the installed skill (`~/.claude/skills/shareframe-publish`, upstreamed to the skill source). Tracked here because the design system originates from Workboard's house style.

## Items

### S1 — `shareframe check` + publish gate

Status: **Planned**

Port the skill's `check_html_artifact.py` into the CLI and extend it: slop markers (violet/indigo hexes, gradient text, emoji-prefixed headings, `backdrop-filter`), unmodified-template dark block, missing print styles, missing `:focus-visible`, WCAG contrast on `:root` token pairs, plus the existing structural/secret/asset checks. `shareframe publish` and `update` run it automatically and refuse on ERROR (`--force` to override, always prints what it skipped).

Acceptance criteria:

- [ ] `shareframe check <file|dir>` reports ERROR/WARN with the same or stricter coverage than the skill's Python checker.
- [ ] Publishing an artifact with ERRORs fails without `--force`; an agent with no skill installed still cannot publish slop.
- [ ] Checker version ships with the CLI; the skill's local script is deleted once this lands.

### S2 — `shareframe new --direction <name>`

Status: **Planned**

Scaffold an artifact file with a design direction baked in as code: direction tokens, "same poster, printed on black paper" dark block, `color-scheme: light dark`, protective overflow CSS, CSS-only interaction furniture (`+`/`–` details markers, numbered steps, ink-rule lists), optional rise-in motion with `prefers-reduced-motion` fallback, print block, and an `<svg><defs>` block (arrowhead markers, hatch/dot patterns, plate frame) for illustrations. Directions: the six from the skill, with Xerox Brief upgraded to Workboard's house execution (highlighter system, `--on-highlight`, rule-above section labels). `--list` prints directions with one-line moods.

Acceptance criteria:

- [ ] `shareframe new plan.html --direction xerox` produces a file that passes `shareframe check` untouched.
- [ ] Dark mode preserves each direction's character (or the scaffold states `stays paper`); no generic dark palette.
- [ ] Directions are versioned with the CLI; skill references them by name instead of embedding token blocks.

### S3 — `shareframe preview --shots`

Status: **Planned**

Headless renders of an artifact to PNGs: 360/768/1280 widths, dark scheme, and print emulation; prints the file paths so the authoring agent can look at its own work before publishing. Uses an installed Chrome/Chromium via CDP; degrades with a clear message when none is found.

Acceptance criteria:

- [ ] One command yields all five shots for a single-file or directory artifact.
- [ ] Overflow, mismatched dark tokens, and broken layout are visible in the shots (no CSS injected, no viewport lies).
- [ ] Runs offline, no auth, no model calls.

### S4 — Skill slimmed to routing + judgment

Status: **Planned**

With S1–S3 the skill stops carrying enforcement and scaffolding: Fast Path becomes scaffold (`new`) → author → `check` → `preview` shots reviewed → `publish`/`update`. Merge `html-use-cases.md` into the decision tree, fold `html-quality.md` remnants into SKILL.md/template, keep the six directions' *moods and signature moves* as the creative guidance, drop what the checker now gates. Series rule per Dia: same audience/series → same direction, vary paper tint and dateline; new content type → new direction.

Acceptance criteria:

- [ ] SKILL.md ≤ 120 lines; always-read set (SKILL + directions) shrinks below today's ~500 lines.
- [ ] No rule exists in prose that the checker enforces mechanically.
- [ ] Screenshot review is a firm Fast Path step, not a suggestion.

### S5 — Illustrations guide

Status: **Planned**

Compact reference (~80 lines) for information-carrying inline SVG: flows, timelines, architecture, comparisons, annotated states — never decorative clip-art. Core rules: fixed viewBox on an 8px grid; `currentColor` and `var(--ink)`/`var(--accent)` so illustrations inherit the direction palette and dark mode for free; text ≥12px rendered, `font-family: inherit`; boxes sized to measured label length; arrows edge-to-edge with `marker-end`, never through text; series distinguished by hatch/dot patterns from the scaffold defs, not extra hues; figures framed as numbered plates where the direction calls for it. Any artifact containing an illustration requires the S3 preview review — overlapping labels and disconnected arrows are the canonical generated-SVG failures.

Acceptance criteria:

- [ ] Guide fits in one reference file; scaffold defs (S2) cover its patterns.
- [ ] A generated flow diagram with 6+ nodes passes visual review without manual fixes in the common case.

### S6 — Eval gallery

Status: **Planned**

Five representative tasks (implementation plan, research report, metrics dashboard, clickable prototype, doc conversion) rendered per direction, screenshotted via S3, reviewed blind. Findings feed back into directions, template, and checker. Rerun after S1–S5 land; the S6 verdict is the decision gate for S7.

### S7 — `shareframe compose` (deferred)

Status: **Deferred — decision gated on S6**

Delegated generation: markdown + brief in, CLI generates the artifact via the Agent SDK (explicit `--model`, explicit auth story, opt-in only). Only built if S6 shows skill-guided authoring with the S1–S3 toolbench still produces clearly worse artifacts in blind comparison. Known costs: lost conversation context in the handoff, auth/env fragility (logins, aliases, key routing), doubled latency, unattributable failures.

## Out of scope (for now)

- External web fonts or remote assets in artifacts (CSP stays script-free, self-contained)
- Raster/photographic illustration pipelines (paintings à la Dia's Morning Brief)
- Artifact-side JavaScript, even progressive enhancement
