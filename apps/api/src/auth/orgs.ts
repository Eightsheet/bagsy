import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memberships, organizations } from "../db/schema.js";
import { newId, slugify } from "../lib/crypto.js";
import { getWorkOS } from "./workos.js";
import { ensureMembership } from "./middleware.js";

export type SyncedOrg = {
  id: string;
  slug: string;
  name: string;
  workosOrgId: string;
};

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
    let orgRow = (
      await db
        .select()
        .from(organizations)
        .where(eq(organizations.workosOrgId, workosOrgId))
        .limit(1)
    )[0];

    if (!orgRow) {
      const remote = await workos.organizations.getOrganization(workosOrgId);
      let slug = slugify(remote.name || remote.id);
      const clash = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      if (clash[0] && clash[0].workosOrgId !== workosOrgId) {
        slug = `${slug}-${workosOrgId.slice(-6).toLowerCase()}`;
      }

      const id = newId("org");
      [orgRow] = await db
        .insert(organizations)
        .values({
          id,
          workosOrgId,
          name: remote.name || slug,
          slug,
        })
        .returning();
    } else {
      // refresh name if WorkOS renamed it
      try {
        const remote = await workos.organizations.getOrganization(workosOrgId);
        if (remote.name && remote.name !== orgRow.name) {
          await db
            .update(organizations)
            .set({ name: remote.name })
            .where(eq(organizations.id, orgRow.id));
          orgRow = { ...orgRow, name: remote.name };
        }
      } catch {
        // keep existing name
      }
    }

    await ensureMembership(localUserId, orgRow!.id, membership.role?.slug ?? "member");
    synced.push({
      id: orgRow!.id,
      slug: orgRow!.slug,
      name: orgRow!.name,
      workosOrgId,
    });
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
