import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memberships, organizations, users } from "../db/schema.js";
import { newId, slugify } from "../lib/crypto.js";
import { getWorkOS } from "./workos.js";
import { ensureMembership } from "./middleware.js";

export type SyncedOrg = {
  id: string;
  slug: string;
  name: string;
  workosOrgId: string;
};

async function uniqueSlug(base: string, workosOrgId?: string): Promise<string> {
  let slug = slugify(base) || "org";
  const clash = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (clash[0] && (!workosOrgId || clash[0].workosOrgId !== workosOrgId)) {
    slug = `${slug}-${(workosOrgId ?? newId()).slice(-6).toLowerCase()}`;
  }
  return slug;
}

export async function upsertLocalOrgFromWorkOS(input: {
  workosOrgId: string;
  name: string;
  localUserId: string;
  role?: string;
}): Promise<SyncedOrg> {
  let orgRow = (
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.workosOrgId, input.workosOrgId))
      .limit(1)
  )[0];

  if (!orgRow) {
    const slug = await uniqueSlug(input.name, input.workosOrgId);
    const id = newId("org");
    [orgRow] = await db
      .insert(organizations)
      .values({
        id,
        workosOrgId: input.workosOrgId,
        name: input.name,
        slug,
      })
      .returning();
  } else if (input.name && input.name !== orgRow.name) {
    await db
      .update(organizations)
      .set({ name: input.name })
      .where(eq(organizations.id, orgRow.id));
    orgRow = { ...orgRow, name: input.name };
  }

  const membership = await ensureMembership(
    input.localUserId,
    orgRow!.id,
    input.role ?? "member",
  );
  // ensureMembership only inserts; WorkOS is the source of truth for roles, so
  // a role that changed remotely (promotion, healed data) must be mirrored onto
  // the existing row too — otherwise the first-ever role sticks forever.
  if (input.role && membership.role !== input.role) {
    await db
      .update(memberships)
      .set({ role: input.role })
      .where(eq(memberships.id, membership.id));
  }
  return {
    id: orgRow!.id,
    slug: orgRow!.slug,
    name: orgRow!.name,
    workosOrgId: input.workosOrgId,
  };
}

/** Pull the user's WorkOS organization memberships into local tables. */
export async function syncWorkOSOrganizations(
  localUserId: string,
  workosUserId: string,
): Promise<SyncedOrg[]> {
  const workos = getWorkOS();
  if (!workos) return [];

  const result = await workos.userManagement.listOrganizationMemberships({
    userId: workosUserId,
    statuses: ["active"],
    limit: 100,
  });

  const synced: SyncedOrg[] = [];

  for (const membership of result.data) {
    const workosOrgId = membership.organizationId;
    const remote = await workos.organizations.getOrganization(workosOrgId);
    const local = await upsertLocalOrgFromWorkOS({
      workosOrgId,
      name: remote.name || workosOrgId,
      localUserId,
      role: membership.role?.slug ?? "member",
    });
    synced.push(local);
  }

  return synced;
}

export async function findOrgByWorkOSId(workosOrgId: string) {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.workosOrgId, workosOrgId))
    .limit(1);
  return rows[0] ?? null;
}

/** Prefer AuthKit-selected org, else sole membership, else null (caller shows picker). */
export function pickDefaultOrg(
  synced: SyncedOrg[],
  preferredWorkosOrgId?: string | null,
): SyncedOrg | null {
  if (preferredWorkosOrgId) {
    const match = synced.find((o) => o.workosOrgId === preferredWorkosOrgId);
    if (match) return match;
  }
  if (synced.length === 1) return synced[0]!;
  return null;
}

export async function listLocalOrgsForUser(localUserId: string) {
  return db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      workosOrgId: organizations.workosOrgId,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, localUserId));
}

export async function listMembersForOrg(orgId: string) {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.createdAt));
}

/** Pending WorkOS invitations for an org (best-effort; empty if WorkOS unavailable). */
export async function listPendingInvitations(workosOrgId: string | null | undefined) {
  if (!workosOrgId) return [] as Array<{ email: string; state: string; id: string }>;
  const workos = getWorkOS();
  if (!workos) return [];
  try {
    const result = await workos.userManagement.listInvitations({
      organizationId: workosOrgId,
      limit: 50,
    });
    return result.data
      .filter((inv) => inv.state === "pending")
      .map((inv) => ({
        id: inv.id,
        email: inv.email,
        state: inv.state,
      }));
  } catch (err) {
    console.warn("listInvitations failed", err);
    return [];
  }
}

export function defaultOrgName(userName: string | null, userEmail: string | null): string {
  const base = (userName?.trim() || userEmail?.split("@")[0] || "My").replace(/\s+/g, " ");
  return `${base}'s team`;
}

/**
 * Create a WorkOS organization, make the inviter admin, mirror locally.
 * Falls back to membership without roleSlug if `admin` is not configured.
 */
export async function createWorkOSOrganizationAsAdmin(input: {
  name: string;
  localUserId: string;
  workosUserId: string;
}): Promise<SyncedOrg> {
  const workos = getWorkOS();
  if (!workos) throw new Error("WorkOS is not configured");

  const name = input.name.trim() || "Team";
  const remote = await workos.organizations.createOrganization({ name });

  try {
    await workos.userManagement.createOrganizationMembership({
      userId: input.workosUserId,
      organizationId: remote.id,
      roleSlug: "admin",
    });
  } catch (err) {
    console.warn("admin role membership failed, retrying without roleSlug", err);
    await workos.userManagement.createOrganizationMembership({
      userId: input.workosUserId,
      organizationId: remote.id,
    });
  }

  return upsertLocalOrgFromWorkOS({
    workosOrgId: remote.id,
    name: remote.name || name,
    localUserId: input.localUserId,
    role: "admin",
  });
}

export async function sendWorkOSOrgInvitation(input: {
  email: string;
  workosOrgId: string;
  inviterWorkosUserId: string;
  roleSlug?: string;
}) {
  const workos = getWorkOS();
  if (!workos) throw new Error("WorkOS is not configured");

  const email = input.email.trim().toLowerCase();
  try {
    return await workos.userManagement.sendInvitation({
      email,
      organizationId: input.workosOrgId,
      inviterUserId: input.inviterWorkosUserId,
      roleSlug: input.roleSlug ?? "member",
    });
  } catch (err) {
    console.warn("invite with roleSlug failed, retrying without role", err);
    return workos.userManagement.sendInvitation({
      email,
      organizationId: input.workosOrgId,
      inviterUserId: input.inviterWorkosUserId,
    });
  }
}
