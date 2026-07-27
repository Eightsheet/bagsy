import { and, eq, lt } from "drizzle-orm";
import {
  DEFAULT_TTL_SECONDS,
  findOverlaps,
  normalizeFilePath,
  normalizeRepo,
  type ClaimRecord,
  type OverlapInfo,
} from "@repo-org/shared";
import { db } from "../db/client.js";
import { claims, linkedRepos, organizations, users } from "../db/schema.js";
import { newId } from "../lib/crypto.js";

export async function expireStaleClaims(orgId: string, repo: string) {
  const now = new Date();
  await db
    .update(claims)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(claims.orgId, orgId),
        eq(claims.repo, repo),
        eq(claims.status, "active"),
        lt(claims.expiresAt, now),
      ),
    );
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
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listActiveClaims(orgId: string, repo: string): Promise<ClaimRecord[]> {
  const normalized = normalizeRepo(repo);
  await expireStaleClaims(orgId, normalized);

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
      and(eq(claims.orgId, orgId), eq(claims.repo, normalized), eq(claims.status, "active")),
    );

  return rows.map((r) => toClaimRecord(r.claim, orgSlug, { email: r.email, name: r.name }));
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
  ttlSeconds?: number;
}): Promise<{ claim: ClaimRecord; overlaps: OverlapInfo[] } | { error: string; overlaps: OverlapInfo[]; status: 409 | 400 }> {
  const linked = await requireLinkedRepo(input.orgId, input.repo);
  if (!linked.ok) {
    return { error: linked.error, overlaps: [], status: 400 };
  }

  const active = await listActiveClaims(input.orgId, linked.repo);
  const files = input.files.map(normalizeFilePath).filter(Boolean);
  const overlaps = findOverlaps(
    {
      title: input.title,
      files,
      roadmapRef: input.roadmapRef,
    },
    active,
  );

  if (input.strict && overlaps.length > 0) {
    return { error: "overlap detected (strict mode)", overlaps, status: 409 };
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
    overlaps,
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
  if (claim.status !== "active") return { error: "claim is not active", status: 400 as const };

  const ttl = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = new Date();
  const [updated] = await db
    .update(claims)
    .set({
      note: opts?.note !== undefined ? opts.note : claim.note,
      expiresAt: new Date(now.getTime() + ttl * 1000),
      updatedAt: now,
    })
    .where(eq(claims.id, claimId))
    .returning();

  return { claim: updated! };
}

export async function releaseClaim(claimId: string, userId: string) {
  const rows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  const claim = rows[0];
  if (!claim) return { error: "not found", status: 404 as const };
  if (claim.userId !== userId) return { error: "forbidden", status: 403 as const };

  const now = new Date();
  const [updated] = await db
    .update(claims)
    .set({
      status: "released",
      releasedAt: now,
      updatedAt: now,
    })
    .where(eq(claims.id, claimId))
    .returning();

  return { claim: updated! };
}

export async function findActiveClaimForUser(orgId: string, repo: string, userId: string) {
  const normalized = normalizeRepo(repo);
  await expireStaleClaims(orgId, normalized);
  const rows = await db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.orgId, orgId),
        eq(claims.repo, normalized),
        eq(claims.userId, userId),
        eq(claims.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
