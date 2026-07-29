import { and, eq } from "drizzle-orm";
import { getWorkOS } from "../auth/workos.js";
import { db } from "../db/client.js";
import {
  deviceCodes,
  linkedRepos,
  memberships,
  organizations,
  sessions,
  users,
} from "../db/schema.js";

/**
 * Delete a team everywhere: WorkOS organization + local row.
 * Local cascades cover memberships, linked repos, claims, and API tokens;
 * sessions and device codes only reference the org, so they are detached first.
 */
export async function deleteOrgEverywhere(orgId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const org = (
    await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1)
  )[0];
  if (!org) return { ok: false, error: "team not found" };

  if (org.workosOrgId) {
    const workos = getWorkOS();
    if (!workos) return { ok: false, error: "WorkOS not configured" };
    try {
      await workos.organizations.deleteOrganization(org.workosOrgId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Already gone remotely is fine; anything else aborts so we never diverge.
      if (!/not.?found|404/i.test(msg)) {
        return { ok: false, error: `WorkOS org deletion failed: ${msg}` };
      }
    }
  }

  await db.update(sessions).set({ orgId: null }).where(eq(sessions.orgId, orgId));
  await db.update(deviceCodes).set({ orgId: null }).where(eq(deviceCodes.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  return { ok: true };
}

/**
 * Delete an account everywhere: WorkOS user + local row (cascades memberships,
 * claims, API tokens, sessions). Teams where the user is the sole member are
 * deleted along with it; teams with other members but no other admin block.
 */
export async function deleteAccountEverywhere(
  userId: string,
): Promise<{ ok: true; deletedOrgs: string[] } | { ok: false; error: string }> {
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) return { ok: false, error: "user not found" };

  const myMemberships = await db
    .select({ orgId: memberships.orgId, role: memberships.role, orgName: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));

  const soleMemberOrgIds: string[] = [];
  const deletedOrgs: string[] = [];
  for (const m of myMemberships) {
    const rows = await db
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.orgId, m.orgId));
    if (rows.length === 1) {
      soleMemberOrgIds.push(m.orgId);
      continue;
    }
    const otherAdmin = rows.some(
      (r) => r.userId !== userId && (r.role === "admin" || r.role === "owner"),
    );
    if ((m.role === "admin" || m.role === "owner") && !otherAdmin) {
      return {
        ok: false,
        error: `You are the only admin of “${m.orgName}”, which still has other members. Promote another admin or remove the members first.`,
      };
    }
  }

  if (user.workosUserId) {
    const workos = getWorkOS();
    if (!workos) return { ok: false, error: "WorkOS not configured" };
    try {
      await workos.userManagement.deleteUser(user.workosUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not.?found|404/i.test(msg)) {
        return { ok: false, error: `WorkOS user deletion failed: ${msg}` };
      }
    }
  }

  for (const orgId of soleMemberOrgIds) {
    const result = await deleteOrgEverywhere(orgId);
    if (result.ok) {
      const name = myMemberships.find((m) => m.orgId === orgId)?.orgName;
      if (name) deletedOrgs.push(name);
    }
  }

  await db
    .update(linkedRepos)
    .set({ linkedByUserId: null })
    .where(eq(linkedRepos.linkedByUserId, userId));
  await db.update(deviceCodes).set({ userId: null }).where(eq(deviceCodes.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  return { ok: true, deletedOrgs };
}

export async function membershipRole(orgId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}
