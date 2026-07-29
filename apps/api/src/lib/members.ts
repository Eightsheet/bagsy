import { and, eq } from "drizzle-orm";
import { getWorkOS } from "../auth/workos.js";
import { db } from "../db/client.js";
import { memberships, organizations, users } from "../db/schema.js";
import { listPendingInvitations } from "../auth/orgs.js";

type Result = { ok: true } | { ok: false; error: string };

/** Local roles mirror WorkOS role slugs one-to-one. */
export type OrgRole = "admin" | "member";

async function loadOrg(orgId: string) {
  return (
    await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1)
  )[0];
}

async function loadMembership(orgId: string, userId: string) {
  return (
    await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1)
  )[0];
}

/** Owners count as leadership too — a team with an owner is never stranded. */
async function leadershipCount(orgId: string): Promise<number> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.orgId, orgId));
  return rows.filter((r) => r.role === "admin" || r.role === "owner").length;
}

/** Removing/demoting the sole admin would strand the team with nobody in charge. */
async function wouldStrandAdmins(orgId: string, targetRole: string): Promise<boolean> {
  return (
    (targetRole === "admin" || targetRole === "owner") &&
    (await leadershipCount(orgId)) <= 1
  );
}

/** WorkOS membership id for a (org, user) pair — needed to mutate it remotely. */
async function workosMembershipId(
  workosOrgId: string,
  workosUserId: string,
): Promise<string | null> {
  const workos = getWorkOS();
  if (!workos) return null;
  const res = await workos.userManagement.listOrganizationMemberships({
    organizationId: workosOrgId,
    userId: workosUserId,
    limit: 1,
  });
  return res.data[0]?.id ?? null;
}

/**
 * Drop a member from a team: WorkOS membership + local row. Their past claims
 * stay (claims reference the user, not the membership), but board access is
 * gone the moment the local row is deleted. Used both for admin-removes-member
 * and self-leave — the route decides who is allowed to call it.
 */
export async function removeOrgMember(input: {
  orgId: string;
  targetUserId: string;
}): Promise<Result> {
  const org = await loadOrg(input.orgId);
  if (!org) return { ok: false, error: "team not found" };

  const target = await loadMembership(input.orgId, input.targetUserId);
  if (!target) return { ok: false, error: "not a member of this team" };

  if (target.role === "owner") {
    return {
      ok: false,
      error: "The team owner can’t be removed. Owners delete the team instead.",
    };
  }

  if (await wouldStrandAdmins(input.orgId, target.role)) {
    return {
      ok: false,
      error: "Can’t remove the last admin — promote another member to admin first.",
    };
  }

  const targetUser = (
    await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1)
  )[0];

  if (org.workosOrgId && targetUser?.workosUserId) {
    const workos = getWorkOS();
    if (!workos) return { ok: false, error: "WorkOS not configured" };
    try {
      const membershipId = await workosMembershipId(org.workosOrgId, targetUser.workosUserId);
      if (membershipId) await workos.userManagement.deleteOrganizationMembership(membershipId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Already gone remotely is fine; anything else aborts so we never diverge.
      if (!/not.?found|404/i.test(msg)) {
        return { ok: false, error: `WorkOS removal failed: ${msg}` };
      }
    }
  }

  await db
    .delete(memberships)
    .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.targetUserId)));
  return { ok: true };
}

/** Promote or demote a member. WorkOS is the source of truth; local mirrors it. */
export async function changeOrgMemberRole(input: {
  orgId: string;
  targetUserId: string;
  role: OrgRole;
}): Promise<Result> {
  const org = await loadOrg(input.orgId);
  if (!org) return { ok: false, error: "team not found" };

  const target = await loadMembership(input.orgId, input.targetUserId);
  if (!target) return { ok: false, error: "not a member of this team" };
  if (target.role === "owner") {
    return { ok: false, error: "The team owner’s role can’t be changed." };
  }
  if (target.role === input.role) return { ok: true };

  // Demoting the last admin is the same stranding risk as removing them.
  if (input.role !== "admin" && (await wouldStrandAdmins(input.orgId, target.role))) {
    return {
      ok: false,
      error: "Can’t demote the last admin — promote another member first.",
    };
  }

  const targetUser = (
    await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1)
  )[0];

  if (org.workosOrgId && targetUser?.workosUserId) {
    const workos = getWorkOS();
    if (!workos) return { ok: false, error: "WorkOS not configured" };
    try {
      const membershipId = await workosMembershipId(org.workosOrgId, targetUser.workosUserId);
      if (!membershipId) return { ok: false, error: "membership not found in WorkOS" };
      await workos.userManagement.updateOrganizationMembership(membershipId, {
        roleSlug: input.role,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `WorkOS role update failed: ${msg}` };
    }
  }

  await db
    .update(memberships)
    .set({ role: input.role })
    .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.targetUserId)));
  return { ok: true };
}

/**
 * Revoke a pending invitation. The id is checked against this org's own pending
 * list first, so an admin of one team can't revoke another team's invite by id.
 */
export async function revokeOrgInvitation(input: {
  orgId: string;
  invitationId: string;
}): Promise<Result> {
  const org = await loadOrg(input.orgId);
  if (!org) return { ok: false, error: "team not found" };

  const pending = await listPendingInvitations(org.workosOrgId);
  if (!pending.some((inv) => inv.id === input.invitationId)) {
    return { ok: false, error: "invitation not found for this team" };
  }

  const workos = getWorkOS();
  if (!workos) return { ok: false, error: "WorkOS not configured" };
  try {
    await workos.userManagement.revokeInvitation(input.invitationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not.?found|404/i.test(msg)) {
      return { ok: false, error: `Revoke failed: ${msg}` };
    }
  }
  return { ok: true };
}
