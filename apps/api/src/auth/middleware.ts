import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/client.js";
import { memberships, organizations, sessions, users } from "../db/schema.js";
import { newId } from "../lib/crypto.js";
import { verifyWorkOsAccessToken } from "../lib/workos-jwt.js";
import { ensureLocalUserFromWorkOsSub, resolveOrgForApiUser } from "./users.js";

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  githubLogin: string | null;
};

export type AuthOrg = {
  id: string;
  slug: string;
  name: string;
};

export type AuthContext = {
  user: AuthUser;
  org: AuthOrg;
  via: "workos_jwt" | "session";
  workosUserId?: string;
  workosOrgId?: string | null;
};

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    sessionUser: AuthUser | null;
    sessionOrg: AuthOrg | null;
  }
}

/** API auth: WorkOS AuthKit access JWT (JWKS). */
export async function requireApiAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing Bearer token" }, 401);
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return c.json({ error: "Missing Bearer token" }, 401);
  }

  let claims;
  try {
    claims = await verifyWorkOsAccessToken(token);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
        ? ((err as { status: number }).status as 401 | 503)
        : 401;
    const message = err instanceof Error ? err.message : "Invalid token";
    return c.json({ error: message }, status);
  }

  const user = await ensureLocalUserFromWorkOsSub(claims.sub);
  const orgOverride = (c.req.header("x-workboard-org") ?? "").trim();
  const org = await resolveOrgForApiUser({
    localUserId: user.id,
    workosUserId: claims.sub,
    jwtOrgId: typeof claims.org_id === "string" ? claims.org_id : null,
    orgOverrideSlug: orgOverride || null,
  });

  if (orgOverride && !org) {
    return c.json({ error: "Not a member of that organization", org: orgOverride }, 403);
  }
  if (!org) {
    return c.json(
      {
        error: "no_organization",
        message: "No team selected. Open the web UI to create/join a team, or pass X-Workboard-Org.",
        user,
      },
      403,
    );
  }

  c.set("auth", {
    user,
    org,
    via: "workos_jwt",
    workosUserId: claims.sub,
    workosOrgId: typeof claims.org_id === "string" ? claims.org_id : null,
  });

  await next();
}

export async function loadSession(c: Context, next: Next) {
  const sessionId = getCookie(c, "wb_session");
  if (!sessionId) {
    c.set("sessionUser", null);
    c.set("sessionOrg", null);
    await next();
    return;
  }

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      githubLogin: users.githubLogin,
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(organizations, eq(sessions.orgId, organizations.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) {
    deleteCookie(c, "wb_session");
    c.set("sessionUser", null);
    c.set("sessionOrg", null);
    await next();
    return;
  }

  c.set("sessionUser", {
    id: row.userId,
    email: row.email,
    name: row.name,
    githubLogin: row.githubLogin,
  });
  c.set(
    "sessionOrg",
    row.orgId
      ? { id: row.orgId, slug: row.orgSlug!, name: row.orgName! }
      : null,
  );
  await next();
}

export async function requireSession(c: Context, next: Next) {
  const user = c.get("sessionUser");
  if (!user) {
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  }
  await next();
}

export async function createSession(userId: string, orgId: string | null): Promise<string> {
  const id = newId("sess");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id, userId, orgId, expiresAt });
  return id;
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, "wb_session", sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function ensureMembership(userId: string, orgId: string, role = "member") {
  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(memberships)
    .values({ id: newId("mem"), userId, orgId, role })
    .returning();
  return row!;
}

export async function getOrgBySlug(slug: string) {
  const rows = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function assertOrgMember(userId: string, orgId: string) {
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  return Boolean(rows[0]);
}
