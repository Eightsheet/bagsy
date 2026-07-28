import { and, eq, inArray, lt, or } from "drizzle-orm";
import {
  DEFAULT_TTL_SECONDS,
  SOFT_HOLD_SECONDS,
  findOverlaps,
  normalizeFilePath,
  normalizeRepo,
  type ClaimRecord,
  type OverlapInfo,
} from "@repo-org/shared";
import { db } from "../db/client.js";
import { claims, linkedRepos, organizations, users } from "../db/schema.js";
import { newId } from "../lib/crypto.js";

/**
 * active past expiresAt → stale (soft hold, still blocks unless --steal)
 * stale past expiresAt + SOFT_HOLD → expired (fully free)
 */
export async function refreshClaimLifecycle(orgId: string, repo: string) {
  const now = new Date();
  const softHoldCutoff = new Date(now.getTime() - SOFT_HOLD_SECONDS * 1000);

  await db
    .update(claims)
    .set({ status: "stale", updatedAt: now })
    .where(
      and(
        eq(claims.orgId, orgId),
        eq(claims.repo, repo),
        eq(claims.status, "active"),
        lt(claims.expiresAt, now),
      ),
    );

  await db
    .update(claims)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(claims.orgId, orgId),
        eq(claims.repo, repo),
        eq(claims.status, "stale"),
        lt(claims.expiresAt, softHoldCutoff),
      ),
    );
}

/** @deprecated use refreshClaimLifecycle */
export async function expireStaleClaims(orgId: string, repo: string) {
  return refreshClaimLifecycle(orgId, repo);
}

function toClaimRecord(
  row: typeof claims.$inferSelect,
  orgSlug: string,
  user: { email: string | null; name: string | null },
): ClaimRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    orgSlug,
    repo: row.repo,
    branch: row.branch,
    title: row.title,
    description: row.description,
    files: row.files ?? [],
    roadmapRef: row.roadmapRef,
    agentLabel: row.agentLabel,
    note: row.note,
    userId: row.userId,
    userEmail: user.email,
    userName: user.name,
    status: row.status as ClaimRecord["status"],
    resolvedRef: row.resolvedRef,
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Planned claims carry no real deadline; expiresAt is set far out and the lifecycle ignores them. */
const PLANNED_HORIZON_SECONDS = 365 * 24 * 60 * 60;

/** Active + soft-held stale + planned claims visible on the board. */
export async function listBoardClaims(orgId: string, repo: string): Promise<ClaimRecord[]> {
  const normalized = normalizeRepo(repo);
  await refreshClaimLifecycle(orgId, normalized);

  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const orgSlug = org[0]?.slug ?? "";

  const rows = await db
    .select({
      claim: claims,
      email: users.email,
      name: users.name,
    })
    .from(claims)
    .innerJoin(users, eq(claims.userId, users.id))
    .where(
      and(
        eq(claims.orgId, orgId),
        eq(claims.repo, normalized),
        or(
          eq(claims.status, "active"),
          eq(claims.status, "stale"),
          eq(claims.status, "planned"),
        ),
      ),
    );

  return rows.map((r) => toClaimRecord(r.claim, orgSlug, { email: r.email, name: r.name }));
}

export async function listActiveClaims(orgId: string, repo: string): Promise<ClaimRecord[]> {
  return listBoardClaims(orgId, repo);
}

export async function requireLinkedRepo(orgId: string, repo: string) {
  const normalized = normalizeRepo(repo);
  const rows = await db
    .select()
    .from(linkedRepos)
    .where(and(eq(linkedRepos.orgId, orgId), eq(linkedRepos.repo, normalized)))
    .limit(1);
  if (!rows[0]) {
    return { ok: false as const, repo: normalized, error: "repo not linked to organization" };
  }
  return { ok: true as const, repo: normalized, link: rows[0] };
}

async function forceExpireClaims(ids: string[]) {
  if (ids.length === 0) return;
  const now = new Date();
  await db
    .update(claims)
    .set({ status: "expired", updatedAt: now, releasedAt: now })
    .where(inArray(claims.id, ids));
}

export async function createClaim(input: {
  orgId: string;
  orgSlug: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  repo: string;
  branch?: string | null;
  title: string;
  description?: string | null;
  files: string[];
  roadmapRef?: string | null;
  agentLabel?: string | null;
  note?: string | null;
  strict?: boolean;
  steal?: boolean;
  planned?: boolean;
  ttlSeconds?: number;
}): Promise<
  | { claim: ClaimRecord; overlaps: OverlapInfo[]; stole?: string[] }
  | { error: string; overlaps: OverlapInfo[]; status: 409 | 400 }
> {
  const linked = await requireLinkedRepo(input.orgId, input.repo);
  if (!linked.ok) {
    return { error: linked.error, overlaps: [], status: 400 };
  }

  const board = await listBoardClaims(input.orgId, linked.repo);
  const files = input.files.map(normalizeFilePath).filter(Boolean);
  const overlaps = findOverlaps(
    {
      title: input.title,
      files,
      roadmapRef: input.roadmapRef,
    },
    board,
  );

  const activeOverlaps = overlaps.filter((o) => o.status === "active");
  const staleOverlaps = overlaps.filter((o) => o.status === "stale");
  const plannedOverlaps = overlaps.filter((o) => o.status === "planned");

  // Planned = intent, not WIP: never blocks, never steals, no TTL pressure.
  if (input.planned) {
    const now = new Date();
    const [row] = await db
      .insert(claims)
      .values({
        id: newId("clm"),
        orgId: input.orgId,
        repo: linked.repo,
        branch: input.branch ?? null,
        title: input.title.trim(),
        description: input.description ?? null,
        files,
        roadmapRef: input.roadmapRef ?? null,
        agentLabel: input.agentLabel ?? null,
        note: input.note ?? null,
        userId: input.userId,
        status: "planned",
        startedAt: now,
        expiresAt: new Date(now.getTime() + PLANNED_HORIZON_SECONDS * 1000),
        updatedAt: now,
      })
      .returning();
    return {
      claim: toClaimRecord(row!, input.orgSlug, {
        email: input.userEmail,
        name: input.userName,
      }),
      overlaps,
    };
  }

  if (input.strict && activeOverlaps.length > 0) {
    return { error: "overlap detected (strict mode)", overlaps: activeOverlaps, status: 409 };
  }

  // Soft-held (stale) claims still block unless --steal (or owner reclaiming own stale via steal/auto).
  const blockingStale = staleOverlaps.filter((o) => {
    const row = board.find((c) => c.id === o.claimId);
    // Owner can reclaim their own stale without --steal by stealing implicitly below.
    return row?.userId !== input.userId;
  });

  if (blockingStale.length > 0 && !input.steal) {
    return {
      error:
        "soft_hold: overlapping claim went stale (agent may still have local WIP). Pass --steal to take over, or wait for soft hold to end.",
      overlaps: blockingStale,
      status: 409,
    };
  }

  const stealIds = [
    ...blockingStale.map((o) => o.claimId),
    // Own stale always cleared so owner can re-claim cleanly.
    ...staleOverlaps
      .filter((o) => board.find((c) => c.id === o.claimId)?.userId === input.userId)
      .map((o) => o.claimId),
  ];
  if (input.steal) {
    stealIds.push(...staleOverlaps.map((o) => o.claimId));
  }
  const uniqueSteal = [...new Set(stealIds)];
  if (uniqueSteal.length > 0) {
    await forceExpireClaims(uniqueSteal);
  }

  // Claiming work you had queued consumes your own overlapping planned claims.
  const ownPlannedIds = plannedOverlaps
    .filter((o) => board.find((c) => c.id === o.claimId)?.userId === input.userId)
    .map((o) => o.claimId);
  if (ownPlannedIds.length > 0) {
    const now = new Date();
    await db
      .update(claims)
      .set({ status: "released", releasedAt: now, updatedAt: now })
      .where(inArray(claims.id, ownPlannedIds));
  }

  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = new Date();
  const id = newId("clm");
  const [row] = await db
    .insert(claims)
    .values({
      id,
      orgId: input.orgId,
      repo: linked.repo,
      branch: input.branch ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      files,
      roadmapRef: input.roadmapRef ?? null,
      agentLabel: input.agentLabel ?? null,
      note: input.note ?? null,
      userId: input.userId,
      status: "active",
      startedAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1000),
      updatedAt: now,
    })
    .returning();

  return {
    claim: toClaimRecord(row!, input.orgSlug, {
      email: input.userEmail,
      name: input.userName,
    }),
    overlaps: [
      ...activeOverlaps,
      ...plannedOverlaps.filter((o) => !ownPlannedIds.includes(o.claimId)),
    ],
    stole: uniqueSteal.length ? uniqueSteal : undefined,
  };
}

/**
 * Activate a planned claim: it becomes active WIP with a real TTL.
 * Any team member may start it — the claim is reassigned to the starter,
 * so planned claims work as a shared queue.
 */
export async function startClaim(
  claimId: string,
  starter: { userId: string; orgId: string; userEmail: string | null; userName: string | null },
  opts?: { ttlSeconds?: number; steal?: boolean; branch?: string | null; agentLabel?: string | null },
) {
  const rows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  const claim = rows[0];
  if (!claim) return { error: "not found", status: 404 as const };
  if (claim.orgId !== starter.orgId) return { error: "forbidden", status: 403 as const };
  if (claim.status !== "planned") {
    return { error: `claim is ${claim.status}, not planned`, status: 400 as const };
  }

  const board = await listBoardClaims(claim.orgId, claim.repo);
  const overlaps = findOverlaps(
    { title: claim.title, files: claim.files ?? [], roadmapRef: claim.roadmapRef },
    board.filter((c) => c.id !== claim.id),
  );
  const staleOverlaps = overlaps.filter((o) => o.status === "stale");
  const blockingStale = staleOverlaps.filter((o) => {
    const row = board.find((c) => c.id === o.claimId);
    return row?.userId !== starter.userId;
  });
  if (blockingStale.length > 0 && !opts?.steal) {
    return {
      error:
        "soft_hold: overlapping claim went stale (agent may still have local WIP). Pass --steal to take over, or wait for soft hold to end.",
      overlaps: blockingStale,
      status: 409 as const,
    };
  }
  const stealIds = staleOverlaps
    .filter((o) => {
      const row = board.find((c) => c.id === o.claimId);
      return opts?.steal || row?.userId === starter.userId;
    })
    .map((o) => o.claimId);
  if (stealIds.length > 0) {
    await forceExpireClaims(stealIds);
  }

  const ttl = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = new Date();
  const [updated] = await db
    .update(claims)
    .set({
      status: "active",
      userId: starter.userId,
      branch: opts?.branch !== undefined && opts?.branch !== null ? opts.branch : claim.branch,
      agentLabel: opts?.agentLabel ?? claim.agentLabel,
      startedAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1000),
      updatedAt: now,
    })
    .where(eq(claims.id, claimId))
    .returning();

  const org = await db.select().from(organizations).where(eq(organizations.id, claim.orgId)).limit(1);
  return {
    claim: toClaimRecord(updated!, org[0]?.slug ?? "", {
      email: starter.userEmail,
      name: starter.userName,
    }),
    overlaps: overlaps.filter((o) => o.status === "active"),
    stole: stealIds.length ? stealIds : undefined,
  };
}

export async function heartbeatClaim(
  claimId: string,
  userId: string,
  opts?: { note?: string | null; ttlSeconds?: number },
) {
  const rows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  const claim = rows[0];
  if (!claim) return { error: "not found", status: 404 as const };
  if (claim.userId !== userId) return { error: "forbidden", status: 403 as const };
  if (claim.status !== "active" && claim.status !== "stale") {
    return { error: "claim is not active or stale", status: 400 as const };
  }

  const ttl = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = new Date();
  const [updated] = await db
    .update(claims)
    .set({
      status: "active",
      note: opts?.note !== undefined ? opts.note : claim.note,
      expiresAt: new Date(now.getTime() + ttl * 1000),
      updatedAt: now,
    })
    .where(eq(claims.id, claimId))
    .returning();

  return { claim: updated! };
}

export async function releaseClaim(
  claimId: string,
  userId: string,
  opts?: { resolvedRef?: string | null },
) {
  const rows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  const claim = rows[0];
  if (!claim) return { error: "not found", status: 404 as const };
  if (claim.userId !== userId) return { error: "forbidden", status: 403 as const };

  const now = new Date();
  const [updated] = await db
    .update(claims)
    .set({
      status: "released",
      resolvedRef: opts?.resolvedRef ?? claim.resolvedRef,
      releasedAt: now,
      updatedAt: now,
    })
    .where(eq(claims.id, claimId))
    .returning();

  return { claim: updated! };
}

export async function findActiveClaimForUser(orgId: string, repo: string, userId: string) {
  const normalized = normalizeRepo(repo);
  await refreshClaimLifecycle(orgId, normalized);
  const rows = await db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.orgId, orgId),
        eq(claims.repo, normalized),
        eq(claims.userId, userId),
        or(eq(claims.status, "active"), eq(claims.status, "stale")),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
