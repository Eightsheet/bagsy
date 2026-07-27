import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { newId } from "../lib/crypto.js";
import { getWorkOS } from "./workos.js";
import {
  findOrgByWorkOSId,
  listLocalOrgsForUser,
  syncWorkOSOrganizations,
  type SyncedOrg,
} from "./orgs.js";
import type { AuthOrg, AuthUser } from "./middleware.js";

export async function upsertLocalUserFromWorkOs(woUser: {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  let userRow = (
    await db.select().from(users).where(eq(users.workosUserId, woUser.id)).limit(1)
  )[0];

  const email = woUser.email ?? null;
  const name =
    [woUser.firstName, woUser.lastName].filter(Boolean).join(" ") || email || woUser.id;

  if (!userRow) {
    const id = newId("usr");
    [userRow] = await db
      .insert(users)
      .values({
        id,
        workosUserId: woUser.id,
        email,
        name,
      })
      .returning();
  } else {
    await db
      .update(users)
      .set({
        email: email ?? userRow.email,
        name: name || userRow.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userRow.id));
    userRow = (
      await db.select().from(users).where(eq(users.id, userRow.id)).limit(1)
    )[0]!;
  }
  return userRow;
}

/** Resolve local user (+ optional profile fetch) from WorkOS access-token `sub`. */
export async function ensureLocalUserFromWorkOsSub(workosUserId: string): Promise<AuthUser> {
  let userRow = (
    await db.select().from(users).where(eq(users.workosUserId, workosUserId)).limit(1)
  )[0];

  if (!userRow || !userRow.email) {
    const workos = getWorkOS();
    if (workos) {
      try {
        const remote = await workos.userManagement.getUser(workosUserId);
        userRow = await upsertLocalUserFromWorkOs({
          id: remote.id,
          email: remote.email,
          firstName: remote.firstName,
          lastName: remote.lastName,
        });
      } catch (err) {
        console.warn("getUser failed", err);
      }
    }
  }

  if (!userRow) {
    userRow = await upsertLocalUserFromWorkOs({ id: workosUserId });
  }

  return {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    githubLogin: userRow.githubLogin,
  };
}

export async function resolveOrgForApiUser(opts: {
  localUserId: string;
  workosUserId: string;
  jwtOrgId?: string | null;
  orgOverrideSlug?: string | null;
}): Promise<AuthOrg | null> {
  let orgs = await listLocalOrgsForUser(opts.localUserId);

  // Keep memberships fresh when empty or JWT org not mirrored yet.
  const needsSync =
    orgs.length === 0 ||
    (opts.jwtOrgId && !orgs.some((o) => o.workosOrgId === opts.jwtOrgId));
  if (needsSync) {
    orgs = await syncWorkOSOrganizations(opts.localUserId, opts.workosUserId);
  }

  if (opts.orgOverrideSlug) {
    const hit = orgs.find((o) => o.slug === opts.orgOverrideSlug);
    return hit ? { id: hit.id, slug: hit.slug, name: hit.name } : null;
  }

  if (opts.jwtOrgId) {
    const byWorkos = orgs.find((o) => o.workosOrgId === opts.jwtOrgId);
    if (byWorkos) return { id: byWorkos.id, slug: byWorkos.slug, name: byWorkos.name };
    const mirrored = await findOrgByWorkOSId(opts.jwtOrgId);
    if (mirrored) {
      // Ensure membership after sync race.
      const again = orgs.find((o) => o.id === mirrored.id);
      if (again) return { id: again.id, slug: again.slug, name: again.name };
    }
  }

  if (orgs.length === 1) {
    const only = orgs[0]!;
    return { id: only.id, slug: only.slug, name: only.name };
  }

  return null;
}

export function syncedToAuthOrg(o: SyncedOrg): AuthOrg {
  return { id: o.id, slug: o.slug, name: o.name };
}
