import {
  DEFAULT_TTL_SECONDS,
  SOFT_HOLD_SECONDS,
  collisionClusters,
  computeCollisions,
  type BoardAgent,
  type BoardClaim,
  type BoardRepoSummary,
  type ClaimEvent,
  type ClaimStatus,
  type OrgBoard,
} from "@bagsy/shared";

/**
 * A synthetic team board, so the UI can be judged at sizes no test team will
 * ever reach. Deterministic for a given seed: the same URL is the same board,
 * which is what makes a screenshot in a PR review mean anything.
 *
 * This is a review aid, not a product surface — the route that serves it is
 * clearly labelled and reads nothing from the API or the database.
 */

/** mulberry32 — small, seedable, and good enough that the board does not look striped. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REPOS = [
  "eightsheet/bagsy",
  "eightsheet/console",
  "eightsheet/ingest-pipeline",
  "eightsheet/billing",
  "eightsheet/design-system",
  "eightsheet/docs",
  "eightsheet/terraform-infra",
  "eightsheet/mobile-app",
  "eightsheet/search-index",
  "eightsheet/notifications",
  "eightsheet/data-warehouse",
  "eightsheet/edge-proxy",
];

const AREAS = [
  "auth",
  "billing",
  "search",
  "ingest",
  "webhooks",
  "settings",
  "onboarding",
  "exports",
  "audit-log",
  "rate-limit",
  "migrations",
  "telemetry",
];

const VERBS = [
  "Migrate",
  "Refactor",
  "Fix flaky tests in",
  "Add pagination to",
  "Harden",
  "Instrument",
  "Backfill",
  "Delete dead code in",
  "Split",
  "Cache",
  "Rate-limit",
  "Document",
];

const AGENT_KINDS = ["claude", "codex", "cursor", "devin", "aider"];

const HUMANS = [
  { name: "Philipp Schorn", email: "philipp@eightsheet.dev" },
  { name: "Rae Lindqvist", email: "rae@eightsheet.dev" },
  { name: "Tomás Bergman", email: "tomas@eightsheet.dev" },
  { name: "Nour Haddad", email: "nour@eightsheet.dev" },
  { name: "Kit Alvarez", email: "kit@eightsheet.dev" },
];

const NOTES = [
  "Schema migration written, running it against a branch DB now",
  "Green locally; CI is still chewing on the integration suite",
  "Hit an unexpected FK constraint, backing out the last commit",
  "Refactor done, extracting the shared helper next",
  "Waiting on review before touching the callers",
  "Found the leak — an unbounded Map in the request path",
  "Rewrote the query, p99 down from 1.8s to 210ms",
  "Blocked: needs the new env var on staging first",
  "Tests split into three files, last one still red",
  "Reverted; the approach does not survive concurrent writes",
];

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

const MODULES = [
  "session",
  "tokens",
  "invoice",
  "ledger",
  "query",
  "indexer",
  "queue",
  "consumer",
  "retry",
  "policy",
  "sink",
  "adapter",
  "resolver",
  "store",
  "codec",
  "sweeper",
];

/**
 * Paths need enough spread that a natural collision is the exception — a
 * generator whose every claim overlaps would flatter any design that leads with
 * collisions. The interesting ones get forced in deliberately, further down.
 */
function filesFor(r: () => number, area: string, count: number): string[] {
  const roots = ["apps/api/src", "apps/web/src", "packages/core/src", "services/worker/src"];
  const root = pick(r, roots);
  const mod = pick(r, MODULES);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const leaf = pick(r, [
      "index.ts",
      "handler.ts",
      "client.ts",
      "schema.ts",
      "routes.ts",
      "types.ts",
      "helpers.ts",
      "worker.ts",
    ]);
    out.push(`${root}/${area}/${mod}/${leaf}`);
  }
  return [...new Set(out)];
}

function eventsFor(
  r: () => number,
  claimId: string,
  status: ClaimStatus,
  actor: string,
  startedAt: number,
  files: string[],
): ClaimEvent[] {
  const out: ClaimEvent[] = [];
  let at = startedAt;
  const push = (kind: ClaimEvent["kind"], message: string | null) => {
    out.push({
      id: `evt_${claimId}_${out.length}`,
      claimId,
      kind,
      message,
      actorName: actor,
      meta: null,
      createdAt: new Date(at).toISOString(),
    });
    at += Math.floor(r() * 25 * 60 * 1000) + 4 * 60 * 1000;
  };

  push(status === "planned" ? "planned" : "claimed", null);
  if (status === "planned") return out;

  const beats = Math.floor(r() * 4);
  for (let i = 0; i < beats; i += 1) {
    if (r() < 0.25 && files.length) {
      push("files_synced", `Now also touching 1 file: ${pick(r, files)}`);
    } else {
      push("note", pick(r, NOTES));
    }
  }
  if (status === "stale") {
    push("stale", "No heartbeat within TTL — soft hold, may still have local WIP");
  }
  return out.slice(-3);
}

export interface DemoOptions {
  /** How many live claims to synthesize. */
  claims: number;
  /** How many linked repos to spread them over. */
  repos: number;
  seed: number;
}

export function demoBoard(opts: DemoOptions): OrgBoard {
  const r = rng(opts.seed);
  const now = Date.now();
  const repoNames = REPOS.slice(0, Math.max(1, Math.min(opts.repos, REPOS.length)));

  const claims: BoardClaim[] = [];

  for (let i = 0; i < opts.claims; i += 1) {
    const roll = r();
    // Most agents are fine; a minority need a decision. That ratio is the whole
    // design problem, so it has to be honest rather than flattering.
    const status: ClaimStatus = roll < 0.7 ? "active" : roll < 0.84 ? "stale" : "planned";
    const repo = pick(r, repoNames);
    const area = pick(r, AREAS);
    const human = pick(r, HUMANS);
    const useAgent = r() < 0.82;
    const agentLabel = useAgent ? `${pick(r, AGENT_KINDS)}-${String(i % 97).padStart(2, "0")}` : null;

    const ttlMs = DEFAULT_TTL_SECONDS * 1000;
    const idleMs =
      status === "active"
        ? Math.floor(r() * ttlMs * 0.95)
        : status === "stale"
          ? ttlMs + Math.floor(r() * SOFT_HOLD_SECONDS * 1000 * 0.8)
          : Math.floor(r() * 6 * 24 * 60 * 60 * 1000);
    const updatedAt = now - idleMs;
    const startedAt = updatedAt - Math.floor(r() * 4 * 60 * 60 * 1000) - 10 * 60 * 1000;
    const expiresAt =
      status === "planned" ? now + 365 * 24 * 60 * 60 * 1000 : updatedAt + ttlMs;

    const id = `clm_${(opts.seed * 7919 + i).toString(36)}`;
    const files = filesFor(r, area, 1 + Math.floor(r() * 4));
    // Three dimensions, not two: real claim titles name the thing, so exact
    // duplicates are rare. A generator with 144 possible titles manufactures
    // "two agents are doing the same work" on every board over ~40 claims.
    const title = `${pick(r, VERBS)} ${area} ${pick(r, MODULES)}`;
    const actor = agentLabel ?? human.name;

    claims.push({
      id,
      orgId: "org_demo",
      orgSlug: "demo-team",
      repo,
      branch: status === "planned" ? null : `${area}/${pick(r, ["fix", "rework", "spike"])}-${i % 40}`,
      title,
      description:
        r() < 0.3 ? `Follow-up from the ${area} review — see the thread on the roadmap item.` : null,
      files,
      // Specific, like a real roadmap item — not one of six buckets, which
      // would put a third of the board into a handful of giant "same work"
      // components that no real team would ever produce.
      roadmapRef:
        r() < 0.1
          ? `roadmap:R${1 + Math.floor(r() * 9)}-${pick(r, AREAS)}-${pick(r, MODULES)}`
          : null,
      agentLabel,
      note: status === "planned" ? null : pick(r, NOTES),
      userId: `usr_${HUMANS.indexOf(human)}`,
      userEmail: human.email,
      userName: human.name,
      status,
      resolvedRef: null,
      startedAt: new Date(startedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
      recentEvents: eventsFor(r, id, status, actor, startedAt, files),
      eventCount: 1 + Math.floor(r() * 9),
      idleMs,
      expiresInMs: status === "planned" ? null : expiresAt - now,
      softHoldLeftMs: status === "stale" ? expiresAt + SOFT_HOLD_SECONDS * 1000 - now : null,
    });
  }

  // Agents grow into each other's files mid-flight — that is the interesting
  // failure, and random paths almost never produce it. Force a realistic few.
  const collisionCount = Math.max(1, Math.round(claims.length * 0.06));
  for (let i = 0; i < collisionCount && claims.length > 1; i += 1) {
    const victim = claims[Math.floor(r() * claims.length)]!;
    const intruder = claims[Math.floor(r() * claims.length)]!;
    if (victim.id === intruder.id || !victim.files.length) continue;
    intruder.repo = victim.repo;
    intruder.files = [...new Set([...intruder.files, victim.files[0]!])];
  }

  const { edges, truncated } = computeCollisions(claims);
  const contended = new Set<string>();
  for (const edge of edges) {
    contended.add(edge.a);
    contended.add(edge.b);
  }

  const repoMap = new Map<string, BoardRepoSummary>(
    repoNames.map((repo) => [repo, { repo, active: 0, stale: 0, planned: 0, contended: 0 }]),
  );
  const agentMap = new Map<string, BoardAgent>();

  for (const claim of claims) {
    const repo = repoMap.get(claim.repo)!;
    const label = claim.agentLabel ?? claim.userName ?? claim.userId;
    const agent = agentMap.get(label) ?? {
      label,
      userId: claim.userId,
      active: 0,
      stale: 0,
      planned: 0,
    };
    agentMap.set(label, agent);
    if (claim.status === "active") {
      repo.active += 1;
      agent.active += 1;
    } else if (claim.status === "stale") {
      repo.stale += 1;
      agent.stale += 1;
    } else {
      repo.planned += 1;
      agent.planned += 1;
    }
    if (contended.has(claim.id)) repo.contended += 1;
  }

  return {
    claims,
    repos: [...repoMap.values()].sort((a, b) => a.repo.localeCompare(b.repo)),
    agents: [...agentMap.values()].sort(
      (a, b) => b.active + b.stale - (a.active + a.stale) || a.label.localeCompare(b.label),
    ),
    collisions: edges,
    clusters: collisionClusters(edges),
    collisionsTruncated: truncated,
    counts: {
      active: claims.filter((c) => c.status === "active").length,
      stale: claims.filter((c) => c.status === "stale").length,
      planned: claims.filter((c) => c.status === "planned").length,
      total: claims.length,
    },
    generatedAt: new Date(now).toISOString(),
  };
}
