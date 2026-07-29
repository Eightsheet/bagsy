import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import { normalizeRepo } from "@bagsy/shared";
import {
  createSession,
  loadSession,
  requireSession,
  revokeSession,
  setSessionCookie,
} from "../auth/middleware.js";
import {
  createWorkOSOrganizationAsAdmin,
  defaultOrgName,
  listLocalOrgsForUser,
  listMembersForOrg,
  listPendingInvitations,
  pickDefaultOrg,
  sendWorkOSOrgInvitation,
  syncWorkOSOrganizations,
} from "../auth/orgs.js";
import {
  authenticateWithCode,
  authenticateWithOrganizationSelection,
  authenticateWithRefreshToken,
  getAuthKitUrl,
  getLogoutUrl,
  workosClientId,
} from "../auth/workos.js";
import { upsertLocalUserFromWorkOs } from "../auth/users.js";
import { db } from "../db/client.js";
import {
  linkedRepos,
  memberships,
  organizations,
  users,
} from "../db/schema.js";
import { getCliUpdateInfo } from "../lib/cli-update.js";
import { newId } from "../lib/crypto.js";
import {
  deleteAccountEverywhere,
  deleteOrgEverywhere,
  membershipRole,
} from "../lib/deletion.js";
import { appUrl, workosConfigured } from "../lib/env.js";
import { rateLimit } from "../lib/rate-limit.js";
import { workosSessionIdFromAccessToken } from "../lib/workos-jwt.js";

export const webRoutes = new Hono();

webRoutes.use("*", loadSession);

async function upsertLocalUser(woUser: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}) {
  return upsertLocalUserFromWorkOs(woUser);
}

function isOrgSelectionError(err: unknown): err is {
  rawData?: {
    code?: string;
    pending_authentication_token?: string;
    organizations?: Array<{ id: string; name: string }>;
  };
  error?: string;
} {
  if (!err || typeof err !== "object") return false;
  const e = err as { error?: string; rawData?: { code?: string } };
  return (
    e.error === "organization_selection_required" ||
    e.rawData?.code === "organization_selection_required"
  );
}

/**
 * The team you last used, as a WorkOS org id. Teams are switched inside the
 * dashboard, so login resolves the org silently instead of asking for it.
 */
const LAST_ORG_COOKIE = "wb_last_org";

function rememberLastOrg(c: Context, workosOrgId: string | null | undefined) {
  if (!workosOrgId) return;
  setCookie(c, LAST_ORG_COOKIE, workosOrgId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60,
  });
}

webRoutes.get("/health", (c) => c.json({ ok: true }));

// The HTML UI lives in the @bagsy/web Worker, which proxies everything that
// needs a session or the DB back here. Direct visits to the API root are sent
// to the web app when APP_URL points at it — unless APP_URL still points at
// this API itself (pre-cutover), which would redirect-loop.
webRoutes.get("/", (c) => {
  const web = process.env.APP_URL ? appUrl() : null;
  const selfHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (web && selfHost && new URL(web).host !== selfHost) {
    return c.redirect(web);
  }
  return c.json({ ok: true, service: "bagsy-api" });
});

/** Session-scoped data behind the web UI's setup page (rendered by @bagsy/web). */
webRoutes.get("/v1/web/state", async (c) => {
  const user = c.get("sessionUser");
  const org = c.get("sessionOrg");
  if (!user) {
    return c.json({
      user: null,
      org: null,
      orgs: [],
      repos: [],
      members: [],
      pendingInvites: [],
      defaultOrgName: "",
    });
  }

  const memberOrgs = await listLocalOrgsForUser(user.id);
  const repos = org
    ? await db
        .select({ repo: linkedRepos.repo, verifiedAt: linkedRepos.verifiedAt })
        .from(linkedRepos)
        .where(eq(linkedRepos.orgId, org.id))
    : [];

  let members: Array<{
    userId: string;
    email: string | null;
    name: string | null;
    role: string;
  }> = [];
  let pendingInvites: Array<{ email: string; state: string; id: string }> = [];
  if (org) {
    members = await listMembersForOrg(org.id);
    const orgRow = (
      await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1)
    )[0];
    pendingInvites = await listPendingInvitations(orgRow?.workosOrgId);
  }

  return c.json({
    user,
    org,
    orgs: memberOrgs,
    repos,
    members,
    pendingInvites,
    defaultOrgName: defaultOrgName(user.name, user.email),
  });
});

webRoutes.get("/login", (c) => {
  const next = c.req.query("next");
  const state = next ? `next:${next}` : undefined;
  const workosUrl = getAuthKitUrl(`${appUrl()}/auth/callback`, { state });
  if (!workosUrl) {
    // The web Worker renders its "sign in unavailable" page on this 503.
    return c.json({ error: "workos_not_configured" }, 503);
  }

  // Straight to AuthKit. The old interstitial "Continue with WorkOS" page was a
  // redundant second click before the same redirect device/CLI flows already did.
  return c.redirect(workosUrl);
});

webRoutes.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code || !workosConfigured()) {
    return c.text("Missing code or WorkOS config", 400);
  }

  try {
    const authResult = await authenticateResolvingOrg(c, code);
    return finishAuth(c, authResult, state);
  } catch (err) {
    console.error(err);
    return c.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

/**
 * AuthKit asks which organization to sign into when the user belongs to
 * several. Teams are switched inside the dashboard, so answer it here — last
 * used, else the first — instead of interrupting the login with a picker.
 */
async function authenticateResolvingOrg(c: Context, code: string) {
  try {
    return await authenticateWithCode(code);
  } catch (err) {
    if (!isOrgSelectionError(err)) throw err;
    const pendingToken = err.rawData?.pending_authentication_token;
    const orgs = err.rawData?.organizations ?? [];
    const lastOrg = getCookie(c, LAST_ORG_COOKIE);
    const pick = orgs.find((o) => o.id === lastOrg) ?? orgs[0];
    if (!pendingToken || !pick) throw err;
    return authenticateWithOrganizationSelection({
      organizationId: pick.id,
      pendingAuthenticationToken: pendingToken,
    });
  }
}

async function finishAuth(
  c: Context,
  authResult: Awaited<ReturnType<typeof authenticateWithCode>>,
  state: string,
) {
  const woUser = authResult.user;
  const userRow = await upsertLocalUser(woUser);
  const synced = await syncWorkOSOrganizations(userRow.id, woUser.id);
  const preferred =
    (authResult as { organizationId?: string }).organizationId ?? null;
  const selected = pickDefaultOrg(synced, preferred);

  const sessionId = await createSession(
    userRow.id,
    selected?.id ?? null,
    workosSessionIdFromAccessToken(authResult.accessToken),
  );
  setSessionCookie(c, sessionId);
  rememberLastOrg(c, selected?.workosOrgId ?? preferred);

  if (state.startsWith("next:")) {
    const next = state.slice("next:".length);
    if (next.startsWith("/")) return c.redirect(next);
  }
  if (!selected && synced.length > 1) {
    return c.redirect("/?pick=1");
  }
  if (!selected && synced.length === 0) {
    // The web Worker renders the "create your team" page for this flag.
    return c.redirect("/?noorg=1");
  }
  return c.redirect("/");
}

/**
 * Clear our session *and* the AuthKit one. Dropping only the cookie leaves the
 * WorkOS session alive, so the next sign-in silently returns the same account
 * and signing in as someone else becomes impossible.
 */
webRoutes.post("/logout", async (c) => {
  const sessionId = getCookie(c, "wb_session");
  const workosSessionId = c.get("sessionWorkosId");
  if (sessionId) await revokeSession(sessionId);
  deleteCookie(c, "wb_session");
  deleteCookie(c, LAST_ORG_COOKIE);

  const logoutUrl = workosSessionId ? getLogoutUrl(workosSessionId, appUrl()) : null;
  return c.redirect(logoutUrl ?? "/");
});

/**
 * Re-issue the web session against another team. Carries the AuthKit session id
 * over so logout can still end it, and drops the row it replaces.
 */
async function rotateSession(c: Context, userId: string, orgId: string | null) {
  const previous = getCookie(c, "wb_session");
  const sessionId = await createSession(userId, orgId, c.get("sessionWorkosId"));
  if (previous) await revokeSession(previous);
  setSessionCookie(c, sessionId);
}

webRoutes.post("/orgs/sync", requireSession, async (c) => {
  const user = c.get("sessionUser")!;
  const local = (
    await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  )[0];
  if (!local?.workosUserId) return c.text("No WorkOS user linked", 400);

  const synced = await syncWorkOSOrganizations(user.id, local.workosUserId);
  const current = c.get("sessionOrg");
  const stillValid = current && synced.some((o) => o.id === current.id);
  const selected = stillValid
    ? synced.find((o) => o.id === current.id)!
    : pickDefaultOrg(synced);

  await rotateSession(c, user.id, selected?.id ?? null);
  return c.redirect("/");
});

webRoutes.post(
  "/orgs/create",
  requireSession,
  rateLimit({
    name: "org-create",
    windowMs: 60 * 60 * 1000,
    max: 10,
    key: (c) => c.get("sessionUser")?.id ?? "anon",
  }),
  async (c) => {
  const user = c.get("sessionUser")!;
  const local = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
  if (!local?.workosUserId) {
    return c.redirect(`/?err=${encodeURIComponent("No WorkOS user linked")}`);
  }

  const body = await c.req.parseBody();
  const name =
    String(body.name ?? "").trim() || defaultOrgName(user.name, user.email);
  const inviteEmail = String(body.invite_email ?? "").trim();

  try {
    const created = await createWorkOSOrganizationAsAdmin({
      name,
      localUserId: user.id,
      workosUserId: local.workosUserId,
    });

    if (inviteEmail) {
      await sendWorkOSOrgInvitation({
        email: inviteEmail,
        workosOrgId: created.workosOrgId,
        inviterWorkosUserId: local.workosUserId,
      });
    }

    await rotateSession(c, user.id, created.id);
    const msg = inviteEmail
      ? `Created “${created.name}” and invited ${inviteEmail}`
      : `Created “${created.name}”`;
    return c.redirect(`/?ok=${encodeURIComponent(msg)}`);
  } catch (err) {
    console.error(err);
    return c.redirect(
      `/?err=${encodeURIComponent(err instanceof Error ? err.message : "Create failed")}`,
    );
  }
});

webRoutes.post(
  "/orgs/invite",
  requireSession,
  rateLimit({
    name: "org-invite",
    windowMs: 60 * 60 * 1000,
    max: 30,
    key: (c) => c.get("sessionUser")?.id ?? "anon",
  }),
  async (c) => {
  const user = c.get("sessionUser")!;
  const local = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
  if (!local?.workosUserId) {
    return c.redirect(`/?err=${encodeURIComponent("No WorkOS user linked")}`);
  }

  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim();
  if (!email || !email.includes("@")) {
    return c.redirect(`/?err=${encodeURIComponent("Valid invite email required")}`);
  }

  const active = c.get("sessionOrg");
  const createNew = String(body.create_new ?? "") === "1";
  if (!createNew && !active) {
    return c.redirect(
      `/?err=${encodeURIComponent("Pick a team in the header, then invite")}`,
    );
  }

  const name =
    String(body.name ?? "").trim() || defaultOrgName(user.name, user.email);

  try {
    let workosOrgId: string;
    let orgName: string;

    if (createNew || !active) {
      const created = await createWorkOSOrganizationAsAdmin({
        name,
        localUserId: user.id,
        workosUserId: local.workosUserId,
      });
      workosOrgId = created.workosOrgId;
      orgName = created.name;
      await rotateSession(c, user.id, created.id);
    } else {
      const orgRow = (
        await db.select().from(organizations).where(eq(organizations.id, active.id)).limit(1)
      )[0];
      if (!orgRow?.workosOrgId) {
        return c.redirect(
          `/?err=${encodeURIComponent("Active org is not linked to WorkOS")}`,
        );
      }
      workosOrgId = orgRow.workosOrgId;
      orgName = orgRow.name;
    }

    await sendWorkOSOrgInvitation({
      email,
      workosOrgId,
      inviterWorkosUserId: local.workosUserId,
    });

    const msg = createNew
      ? `Created “${orgName}” and invited ${email}`
      : `Invited ${email} to “${orgName}”`;
    return c.redirect(`/?ok=${encodeURIComponent(msg)}`);
  } catch (err) {
    console.error(err);
    return c.redirect(
      `/?err=${encodeURIComponent(err instanceof Error ? err.message : "Invite failed")}`,
    );
  }
});

webRoutes.post(
  "/orgs/delete",
  requireSession,
  rateLimit({
    name: "org-delete",
    windowMs: 60 * 60 * 1000,
    max: 10,
    key: (c) => c.get("sessionUser")?.id ?? "anon",
  }),
  async (c) => {
    const user = c.get("sessionUser")!;
    const org = c.get("sessionOrg");
    if (!org) {
      return c.redirect(`/?err=${encodeURIComponent("Pick the team to delete in the header first")}`);
    }

    const body = await c.req.parseBody();
    const confirm = String(body.confirm ?? "").trim();
    if (confirm !== org.slug) {
      return c.redirect(
        `/?err=${encodeURIComponent(`Type the team slug (${org.slug}) to confirm deletion`)}`,
      );
    }

    const role = await membershipRole(org.id, user.id);
    if (role !== "admin") {
      return c.redirect(`/?err=${encodeURIComponent("Only team admins can delete a team")}`);
    }

    const result = await deleteOrgEverywhere(org.id);
    if (!result.ok) {
      return c.redirect(`/?err=${encodeURIComponent(result.error)}`);
    }

    const remaining = await listLocalOrgsForUser(user.id);
    const next = remaining[0] ?? null;
    await rotateSession(c, user.id, next?.id ?? null);
    return c.redirect(
      `/?ok=${encodeURIComponent(`Deleted team “${org.name}” — board, claims, and linked repos are gone`)}`,
    );
  },
);

webRoutes.post(
  "/account/delete",
  requireSession,
  rateLimit({
    name: "account-delete",
    windowMs: 60 * 60 * 1000,
    max: 5,
    key: (c) => c.get("sessionUser")?.id ?? "anon",
  }),
  async (c) => {
    const user = c.get("sessionUser")!;
    const body = await c.req.parseBody();
    const confirm = String(body.confirm ?? "").trim().toLowerCase();
    const expected = (user.email ?? "delete my account").toLowerCase();
    if (confirm !== expected) {
      return c.redirect(
        `/?err=${encodeURIComponent(`Type ${user.email ?? "“delete my account”"} to confirm account deletion`)}`,
      );
    }

    const result = await deleteAccountEverywhere(user.id);
    if (!result.ok) {
      return c.redirect(`/?err=${encodeURIComponent(result.error)}`);
    }

    // The WorkOS user is gone, so its AuthKit session is too — just clear ours.
    deleteCookie(c, "wb_session");
    deleteCookie(c, LAST_ORG_COOKIE);
    return c.redirect("/");
  },
);

async function switchOrg(c: Context, slug: string) {
  const user = c.get("sessionUser")!;
  const org = (await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1))[0];
  if (!org) return c.text("Org not found", 404);
  const memberRows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, org.id)))
    .limit(1);
  if (!memberRows[0]) return c.text("Forbidden", 403);
  await rotateSession(c, user.id, org.id);
  rememberLastOrg(c, org.workosOrgId);
  return c.redirect("/");
}

webRoutes.post("/orgs/use", requireSession, async (c) => {
  const body = await c.req.parseBody();
  const slug = String(body.slug ?? "");
  if (!slug) return c.text("Missing slug", 400);
  return switchOrg(c, slug);
});

webRoutes.post("/orgs/:slug/use", requireSession, async (c) => {
  const slug = c.req.param("slug") as string;
  return switchOrg(c, slug);
});

webRoutes.post("/repos", requireSession, async (c) => {
  const user = c.get("sessionUser")!;
  const org = c.get("sessionOrg");
  if (!org) return c.text("Select an org first", 400);
  const body = await c.req.parseBody();
  const repo = normalizeRepo(String(body.repo ?? ""));
  const existing = await db
    .select()
    .from(linkedRepos)
    .where(and(eq(linkedRepos.orgId, org.id), eq(linkedRepos.repo, repo)))
    .limit(1);
  if (!existing[0]) {
    await db.insert(linkedRepos).values({
      id: newId("repo"),
      orgId: org.id,
      repo,
      linkedByUserId: user.id,
      verifiedAt: null,
    });
  }
  return c.redirect("/");
});

/** Public: CLI discovers WorkOS client id for native device login. */
webRoutes.get(
  "/v1/auth/config",
  rateLimit({ name: "auth-config", windowMs: 60_000, max: 60 }),
  (c) => {
    const clientId = workosClientId();
    if (!clientId || !workosConfigured()) {
      return c.json({ error: "workos_not_configured" }, 503);
    }
    return c.json({
      workosClientId: clientId,
      workosApiBaseUrl: "https://api.workos.com",
      authMode: "workos_jwt",
    });
  },
);

/** Public: exchange refresh token for a new WorkOS access token. */
webRoutes.post(
  "/v1/auth/refresh",
  rateLimit({ name: "auth-refresh", windowMs: 60_000, max: 30 }),
  async (c) => {
    if (!workosConfigured()) {
      return c.json({ error: "workos_not_configured" }, 503);
    }
    const body = await c.req.json<{ refresh_token?: string; organization_id?: string }>();
    const refreshToken = body.refresh_token?.trim();
    if (!refreshToken) return c.json({ error: "refresh_token required" }, 400);
    try {
      const result = await authenticateWithRefreshToken(refreshToken, body.organization_id);
      let expiresIn = 300;
      try {
        const { decodeJwt } = await import("jose");
        const claims = decodeJwt(result.accessToken);
        if (typeof claims.exp === "number") {
          expiresIn = Math.max(30, claims.exp - Math.floor(Date.now() / 1000));
        }
      } catch {
        /* keep default */
      }
      return c.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: "bearer",
        expires_in: expiresIn,
        organization_id: result.organizationId ?? null,
      });
    } catch (err) {
      console.warn("refresh failed", err);
      return c.json({ error: "invalid_grant", message: "Refresh failed. Run bagsy login again." }, 401);
    }
  },
);

/** Public: CLI version / update channel (no auth). */
webRoutes.get(
  "/v1/cli/update",
  rateLimit({ name: "cli-update", windowMs: 60_000, max: 60 }),
  async (c) => {
    const info = await getCliUpdateInfo();
    if (!info) {
      return c.json({ error: "release_unavailable", message: "Could not resolve latest CLI release." }, 503);
    }
    return c.json(info);
  },
);

// Legacy custom device endpoints — CLI now uses WorkOS native device auth.
webRoutes.post(
  "/v1/auth/device/code",
  rateLimit({ name: "device-code", windowMs: 60_000, max: 10 }),
  async (c) => {
    return c.json(
      {
        error: "deprecated",
        message:
          "Custom device login removed. Upgrade the CLI (bagsy upgrade) — login uses WorkOS device auth + JWT.",
      },
      410,
    );
  },
);

// GET /device is a static page served by the web Worker.
webRoutes.post("/device", requireSession, async (c) => {
  return c.redirect("/device");
});

webRoutes.post(
  "/v1/auth/device/token",
  rateLimit({ name: "device-token", windowMs: 60_000, max: 60 }),
  async (c) => {
    return c.json(
      {
        error: "deprecated",
        message:
          "Custom device login removed. Upgrade the CLI — login uses WorkOS device auth + JWT.",
      },
      410,
    );
  },
);