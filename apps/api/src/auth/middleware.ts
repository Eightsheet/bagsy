import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/client.js";
import { apiTokens, memberships, organizations, sessions, users } from "../db/schema.js";
import { hashToken, newId } from "../lib/crypto.js";

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
  via: "api_token" | "session";
};

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    sessionUser: AuthUser | null;
    sessionOrg: AuthOrg | null;
  }
}

export async function requireApiAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing Bearer token" }, 401);
  }
  const token = header.slice("Bearer ".length).trim();
  const tokenHash = hashToken(token);

  const row = await db
    .select({
      tokenId: apiTokens.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      githubLogin: users.githubLogin,
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .innerJoin(organizations, eq(apiTokens.orgId, organizations.id))
    .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
    .limit(1);

  const match = row[0];
  if (!match) {
    return c.json({ error: "Invalid token" }, 401);
  }

  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, match.tokenId));

  const user = {
    id: match.userId,
    email: match.email,
    name: match.name,
    githubLogin: match.githubLogin,
  };

  let org: AuthOrg = {
    id: match.orgId,
    slug: match.orgSlug,
    name: match.orgName,
  };

  // CLI may switch team per request (git remote → linked team).
  const orgOverride = (c.req.header("x-workboard-org") ?? "").trim();
  if (orgOverride) {
    const overrideRows = await db
      .select({
        orgId: organizations.id,
        orgSlug: organizations.slug,
        orgName: organizations.name,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.orgId, organizations.id))
      .where(and(eq(memberships.userId, match.userId), eq(organizations.slug, orgOverride)))
      .limit(1);
    const override = overrideRows[0];
    if (!override) {
      return c.json({ error: "Not a member of that organization", org: orgOverride }, 403);
    }
    org = {
      id: override.orgId,
      slug: override.orgSlug,
      name: override.orgName,
    };
  }

  c.set("auth", {
    user,
    org,
    via: "api_token",
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
