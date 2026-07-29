import {
  SOFT_HOLD_SECONDS,
  normalizeFilePath,
  type BoardClaim,
  type CollisionEdge,
  type OrgBoard,
} from "@bagsy/shared";

/**
 * What turns a board of 200 claims into a short list of decisions.
 *
 * The whole design rests on one property: the length of this list is a function
 * of how many things need a person, never of how many claims exist. Everything
 * here exists to demote — a stale claim nobody is waiting on is not a finding,
 * a blocked queue item is not starving, and a file that forty agents touch is
 * one fact rather than 780 pairwise collisions.
 */

export type FindingKind =
  | "same_work"
  | "soft_hold"
  | "contested"
  | "your_agent_stopped"
  | "starving"
  | "hot_path"
  | "title_echo";

/** Lower tier decides first. The order is "how soon does this become irreversible". */
export const TIER: Record<FindingKind, number> = {
  same_work: 0,
  soft_hold: 1,
  contested: 2,
  your_agent_stopped: 3,
  starving: 4,
  hot_path: 5,
  title_echo: 6,
};

export const FINDING_LABEL: Record<FindingKind, string> = {
  same_work: "Same work",
  soft_hold: "Soft hold",
  contested: "Contested",
  your_agent_stopped: "Your agent stopped",
  starving: "Starving follow-up",
  hot_path: "Hot path",
  title_echo: "Repeated titles",
};

export interface HotPath {
  path: string;
  holders: number;
  repos: string[];
  claims: BoardClaim[];
}

export interface Finding {
  kind: FindingKind;
  tier: number;
  isNew: boolean;
  /** The claims this finding is about. Two for a pair, more for a collapsed cluster. */
  claims: BoardClaim[];
  /** Paths that implicate each other — both sides of a prefix match, never just one. */
  sharedFiles: string[];
  /** Live claims waiting on a soft hold. Empty for every other kind. */
  blockers: BoardClaim[];
  rarity: number;
  hotPath: HotPath | null;
  /** Extra cluster members beyond `claims`, when a cluster was collapsed. */
  extraMembers: number;
  sortKey: number[];
}

export interface FoldResult {
  findings: Finding[];
  /** Findings past the cap, counted by kind so the tail sentence can name them. */
  dropped: Array<{ kind: FindingKind; count: number }>;
  total: number;
  shown: number;
  newCount: number;
  hotPaths: HotPath[];
  /** Live claims that need nothing from anyone — the number the fold reports as healthy. */
  healthy: number;
}

/** Findings shown on the fold. Past this the tail sentence names what was dropped. */
export const FOLD_CAP = 5;

/** A shared path held by this many claims or more is a hot path, not a collision. */
export const HOT_PATH_HOLDERS = 4;

/** A queued item nobody could have started for this long is starving. */
export const STARVING_MS = 7 * 24 * 60 * 60 * 1000;

/** Above this many members a cluster is described, not enumerated side by side. */
export const CLUSTER_ENUMERATE_MAX = 4;

function isLive(claim: BoardClaim): boolean {
  return claim.status === "active" || claim.status === "stale";
}

/** How many live claims hold each declared path. The anti-wolf-crying input. */
export function pathHolders(claims: BoardClaim[]): Map<string, number> {
  const holders = new Map<string, number>();
  for (const claim of claims) {
    const seen = new Set<string>();
    for (const raw of claim.files) {
      const path = normalizeFilePath(raw);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      holders.set(path, (holders.get(path) ?? 0) + 1);
    }
  }
  return holders;
}

/**
 * 1.0 when the shared path belongs to just these two claims; it falls away as
 * more claims hold it. `pnpm-lock.yaml` in eleven claims scores 0.1 and is not
 * a collision anyone can act on.
 */
export function edgeRarity(edge: CollisionEdge, holders: Map<string, number>): number {
  if (edge.files.length === 0) return 1;
  let min = Infinity;
  for (const file of edge.files) {
    min = Math.min(min, holders.get(normalizeFilePath(file)) ?? 1);
  }
  if (!Number.isFinite(min)) return 1;
  return 1 / Math.max(1, min - 1);
}

/**
 * Newest moment that could have made this finding appear. Deliberately uses a
 * stale claim's `expiresAt` — the TTL-miss moment — and never the `stale`
 * event's timestamp, which only records when somebody happened to load a page.
 */
function newestSignal(claims: BoardClaim[]): number {
  let newest = 0;
  for (const claim of claims) {
    newest = Math.max(newest, Date.parse(claim.startedAt) || 0);
    if (claim.status === "stale") newest = Math.max(newest, Date.parse(claim.expiresAt) || 0);
    for (const event of claim.recentEvents ?? []) {
      if (event.kind === "files_synced") {
        newest = Math.max(newest, Date.parse(event.createdAt) || 0);
      }
    }
  }
  return newest;
}

export interface RankOptions {
  board: OrgBoard;
  /** Local user id, so "your agent stopped" can exist at all. */
  meUserId: string | null;
  /** Epoch ms of the previous visit; 0 when there is none. Orders, never hides. */
  seenAt: number;
  now: number;
}

export function rankFold(opts: RankOptions): FoldResult {
  const { board, meUserId, seenAt, now } = opts;
  const byId = new Map(board.claims.map((c) => [c.id, c]));
  const holders = pathHolders(board.claims.filter(isLive));

  // Adjacency, so "who is waiting on this hold" is a lookup rather than a scan.
  const neighbours = new Map<string, CollisionEdge[]>();
  for (const edge of board.collisions) {
    for (const id of [edge.a, edge.b]) {
      const bucket = neighbours.get(id);
      if (bucket) bucket.push(edge);
      else neighbours.set(id, [edge]);
    }
  }
  const other = (edge: CollisionEdge, id: string) => (edge.a === id ? edge.b : edge.a);

  /**
   * Components over one *kind* of edge only.
   *
   * `board.clusters` is the transitive closure over every reason at once, so a
   * roadmap match and a file match land in one component. Presenting that
   * component's members as "doing the same work" is a lie — they are connected,
   * not equivalent. Each finding kind gets its own graph.
   */
  function componentsOver(edges: CollisionEdge[]): Array<{ members: string[]; edges: CollisionEdge[] }> {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur) && parent.get(cur) !== cur) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    for (const edge of edges) {
      if (!parent.has(edge.a)) parent.set(edge.a, edge.a);
      if (!parent.has(edge.b)) parent.set(edge.b, edge.b);
      const rootA = find(edge.a);
      const rootB = find(edge.b);
      if (rootA !== rootB) parent.set(rootA, rootB);
    }
    const groups = new Map<string, { members: string[]; edges: CollisionEdge[] }>();
    for (const id of parent.keys()) {
      const root = find(id);
      const bucket = groups.get(root) ?? { members: [], edges: [] };
      bucket.members.push(id);
      groups.set(root, bucket);
    }
    for (const edge of edges) groups.get(find(edge.a))?.edges.push(edge);
    return [...groups.values()];
  }

  const rarityOf = new Map<CollisionEdge, number>();
  for (const edge of board.collisions) rarityOf.set(edge, edgeRarity(edge, holders));

  // --- Hot paths: the demoted edges, aggregated into one fact each. ----------
  const hotPathMap = new Map<string, HotPath>();
  for (const edge of board.collisions) {
    if ((rarityOf.get(edge) ?? 1) >= 0.5) continue;
    for (const file of edge.files) {
      const path = normalizeFilePath(file);
      const count = holders.get(path) ?? 0;
      if (count < HOT_PATH_HOLDERS) continue;
      if (!hotPathMap.has(path)) {
        const claims = board.claims.filter(
          (c) => isLive(c) && c.files.some((f) => normalizeFilePath(f) === path),
        );
        hotPathMap.set(path, {
          path,
          holders: count,
          repos: [...new Set(claims.map((c) => c.repo))].sort(),
          claims,
        });
      }
    }
  }
  const hotPaths = [...hotPathMap.values()].sort((a, b) => b.holders - a.holders);

  const findings: Finding[] = [];
  const accountedFor = new Set<string>();

  function note(claims: BoardClaim[]) {
    for (const claim of claims) accountedFor.add(claim.id);
  }

  // --- Tier 0/2: collisions, collapsed to one finding per cluster. -----------
  // A cluster is one contended piece of work; showing its 15 edges as 15
  // findings is how a fold becomes the wall it exists to replace.
  // Title-only matches across two different repos, with nothing else in common.
  // "Harden rate-limit" in four repos is four teams naming a chore the same
  // way, not four agents doing one job twice — and at 200 claims there are
  // enough of them to crowd every real decision off the fold. Aggregated to one
  // line rather than ranked, and still listable in full on the table.
  const titleEchoes: CollisionEdge[] = [];
  const sameWorkEdges: CollisionEdge[] = [];
  const contestedEdges: CollisionEdge[] = [];

  for (const edge of board.collisions) {
    const left = byId.get(edge.a);
    const right = byId.get(edge.b);
    if (!left || !right) continue;

    const titleOnly =
      edge.reasons.includes("title") &&
      !edge.reasons.includes("roadmap_ref") &&
      !edge.reasons.includes("files");
    if (titleOnly && left.repo !== right.repo) {
      if (isLive(left) && isLive(right)) titleEchoes.push(edge);
      continue;
    }

    // A roadmap ref is somebody explicitly saying "this is that piece of work",
    // so it stands on its own. A shared title only carries that weight inside
    // one repo, where two agents really are about to write the same commit.
    const sameWork =
      edge.reasons.includes("roadmap_ref") ||
      (edge.reasons.includes("title") && left.repo === right.repo);

    if (sameWork && isLive(left) && isLive(right)) {
      sameWorkEdges.push(edge);
    } else if (
      edge.reasons.includes("files") &&
      left.status === "active" &&
      right.status === "active" &&
      (rarityOf.get(edge) ?? 1) >= 0.5
    ) {
      contestedEdges.push(edge);
    }
  }

  for (const [edges, kind] of [
    [sameWorkEdges, "same_work"] as const,
    [contestedEdges, "contested"] as const,
  ]) {
    for (const group of componentsOver(edges)) {
      const members = group.members
        .map((id) => byId.get(id))
        .filter((c): c is BoardClaim => Boolean(c));
      if (members.length < 2) continue;

      // The sharpest edge in the component leads: it is the pair a reader
      // should look at first, and its files are the ones worth printing.
      const lead = [...group.edges].sort(
        (a, b) => (rarityOf.get(b) ?? 0) - (rarityOf.get(a) ?? 0),
      )[0]!;
      const leadClaims = [byId.get(lead.a), byId.get(lead.b)].filter(
        (c): c is BoardClaim => Boolean(c),
      );
      const shown = members.length <= CLUSTER_ENUMERATE_MAX ? members : leadClaims;

      const rarity = rarityOf.get(lead) ?? 1;
      const soonest = Math.min(
        ...members.map((c) => c.expiresInMs ?? Number.MAX_SAFE_INTEGER),
      );
      const isNew = newestSignal(members) > seenAt;
      note(members);

      findings.push({
        kind,
        tier: TIER[kind],
        isNew,
        claims: shown,
        sharedFiles: lead.files,
        blockers: [],
        rarity,
        hotPath: null,
        extraMembers: Math.max(0, members.length - shown.length),
        sortKey: [TIER[kind], isNew ? 0 : 1, -rarity, soonest],
      });
    }
  }

  // --- Tier 1/3: soft holds. -------------------------------------------------
  for (const claim of board.claims) {
    if (claim.status !== "stale") continue;

    const blockers = (neighbours.get(claim.id) ?? [])
      .map((edge) => byId.get(other(edge, claim.id)))
      .filter(
        (c): c is BoardClaim =>
          Boolean(c) &&
          (c!.status === "active" || c!.status === "planned") &&
          c!.userId !== claim.userId,
      );
    const sharedFiles = [
      ...new Set(
        (neighbours.get(claim.id) ?? [])
          .filter((edge) => blockers.some((b) => b.id === other(edge, claim.id)))
          .flatMap((edge) => edge.files),
      ),
    ];

    const mine = meUserId !== null && claim.userId === meUserId;
    // A hold blocking nobody frees itself in 24h. It is a number in the repo
    // standings and a row in the table — never a decision. This one demotion
    // removes most stale noise at 200 agents.
    if (blockers.length === 0 && !mine) continue;

    const kind: FindingKind = blockers.length > 0 ? "soft_hold" : "your_agent_stopped";
    const isNew = newestSignal([claim]) > seenAt;
    note([claim]);

    findings.push({
      kind,
      tier: TIER[kind],
      isNew,
      claims: [claim],
      sharedFiles,
      blockers,
      rarity: 1,
      hotPath: null,
      extraMembers: 0,
      sortKey: [
        TIER[kind],
        isNew ? 0 : 1,
        claim.softHoldLeftMs ?? Number.MAX_SAFE_INTEGER,
        -blockers.length,
      ],
    });
  }

  // --- Tier 4: the oldest genuinely startable queue item, at most one. -------
  const starving = board.claims
    .filter((claim) => {
      if (claim.status !== "planned") return false;
      if (now - (Date.parse(claim.startedAt) || now) < STARVING_MS) return false;
      // Blocked is not starving — it is waiting, and the thing it waits on is
      // already a finding of its own.
      return (neighbours.get(claim.id) ?? []).every((edge) => {
        const partner = byId.get(other(edge, claim.id));
        return !partner || !isLive(partner);
      });
    })
    .sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0))[0];

  if (starving) {
    const isNew = newestSignal([starving]) > seenAt;
    findings.push({
      kind: "starving",
      tier: TIER.starving,
      isNew,
      claims: [starving],
      sharedFiles: [],
      blockers: [],
      rarity: 1,
      hotPath: null,
      extraMembers: 0,
      sortKey: [TIER.starving, isNew ? 0 : 1, Date.parse(starving.startedAt) || 0, 0],
    });
  }

  // --- Tier 6: every cross-repo title echo, as one line. --------------------
  if (titleEchoes.length > 0) {
    const involved = [
      ...new Set(titleEchoes.flatMap((edge) => [edge.a, edge.b])),
    ]
      .map((id) => byId.get(id))
      .filter((c): c is BoardClaim => Boolean(c));
    findings.push({
      kind: "title_echo",
      tier: TIER.title_echo,
      isNew: false,
      claims: involved.slice(0, 2),
      sharedFiles: [],
      blockers: [],
      rarity: 0,
      hotPath: null,
      extraMembers: Math.max(0, involved.length - 2),
      sortKey: [TIER.title_echo, 1, -titleEchoes.length, 0],
    });
  }

  // --- Tier 5: one hot path, the worst. -------------------------------------
  if (hotPaths[0]) {
    findings.push({
      kind: "hot_path",
      tier: TIER.hot_path,
      isNew: false,
      claims: hotPaths[0].claims.slice(0, 3),
      sharedFiles: [hotPaths[0].path],
      blockers: [],
      rarity: 0,
      hotPath: hotPaths[0],
      extraMembers: Math.max(0, hotPaths[0].claims.length - 3),
      sortKey: [TIER.hot_path, 1, -hotPaths[0].holders, 0],
    });
  }

  findings.sort((a, b) => {
    for (let i = 0; i < Math.max(a.sortKey.length, b.sortKey.length); i += 1) {
      const diff = (a.sortKey[i] ?? 0) - (b.sortKey[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return (a.claims[0]?.id ?? "").localeCompare(b.claims[0]?.id ?? "");
  });

  const shown = findings.slice(0, FOLD_CAP);
  const droppedCounts = new Map<FindingKind, number>();
  for (const finding of findings.slice(FOLD_CAP)) {
    droppedCounts.set(finding.kind, (droppedCounts.get(finding.kind) ?? 0) + 1);
  }

  const live = board.claims.filter(isLive);
  return {
    findings: shown,
    dropped: [...droppedCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => TIER[a.kind] - TIER[b.kind]),
    total: findings.length,
    shown: shown.length,
    newCount: findings.filter((f) => f.isNew).length,
    hotPaths,
    healthy: live.filter((c) => !accountedFor.has(c.id)).length,
  };
}

/**
 * Pressure: how close a claim is to needing somebody, for the table's default
 * sort. Highest first. Not shown as a number anywhere — a score users cannot
 * verify has no business being printed.
 */
export function pressure(claim: BoardClaim, contended: boolean): number {
  let score = 0;
  if (claim.status === "stale") {
    const left = claim.softHoldLeftMs ?? SOFT_HOLD_SECONDS * 1000;
    score += 2000 - Math.max(0, Math.min(1000, left / (SOFT_HOLD_SECONDS * 10)));
  } else if (claim.status === "active") {
    const left = claim.expiresInMs ?? 0;
    score += 1000 - Math.max(0, Math.min(1000, left / 7200));
  }
  if (contended) score += 500;
  return score;
}
