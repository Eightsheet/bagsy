import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import { normalizeRepo } from "@bagsy/shared";
import {
  createSession,
  loadSession,
  requireSession,
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
import {
  chooseOrgPage,
  landingPage,
  loginPage,
  noOrgPage,
} from "../web/pages/auth.js";
import { privacyPage } from "../web/pages/legal.js";
import { setupPage } from "../web/pages/setup.js";

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

webRoutes.get("/health", (c) => c.json({ ok: true }));

webRoutes.get("/privacy", (c) => c.html(privacyPage()));

webRoutes.get("/", async (c) => {
  const user = c.get("sessionUser");
  const org = c.get("sessionOrg");
  if (!user) {
    return c.html(landingPage());
  }

  const memberOrgs = await listLocalOrgsForUser(user.id);
  const repos = org
    ? await db.select().from(linkedRepos).where(eq(linkedRepos.orgId, org.id))
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

  return c.html(
    setupPage({
      user,
      org,
      orgs: memberOrgs,
      repos,
      members,
      pendingInvites,
      flash: c.req.query("ok") ? decodeURIComponent(c.req.query("ok")!) : null,
      error: c.req.query("err") ? decodeURIComponent(c.req.query("err")!) : null,
      defaultOrgName: defaultOrgName(user.name, user.email),
    }),
  );
});

webRoutes.get("/login", (c) => {
  const next = c.req.query("next");
  const state = next ? `next:${next}` : undefined;
  const workosUrl = getAuthKitUrl(`${appUrl()}/auth/callback`, { state });
  if (!workosUrl) {
    return c.html(loginPage({ workosUrl: null }), 503);
  }

  // Prefer immediate redirect for CLI/device flows
  if (next?.startsWith("/device")) {
    return c.redirect(workosUrl);
  }

  return c.html(loginPage({ workosUrl }));
});

webRoutes.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code || !workosConfigured()) {
    return c.text("Missing code or WorkOS config", 400);
  }

  let authResult: Awaited<ReturnType<typeof authenticateWithCode>>;
  try {
    authResult = await authenticateWithCode(code);
  } catch (err) {
    if (isOrgSelectionError(err)) {
      const token =
        (err as { rawData?: { pending_authentication_token?: string } }).rawData
          ?.pending_authentication_token ?? "";
      const orgs =
        (err as { rawData?: { organizations?: Array<{ id: string; name: string }> } }).rawData
          ?.organizations ?? [];
      return c.html(
        chooseOrgPage({
          orgs,
          pendingToken: token,
          state,
        }),
      );
    }
    console.error(err);
    return c.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  return finishAuth(c, authResult, state);
});

webRoutes.post("/auth/select-org", async (c) => {
  const body = await c.req.parseBody();
  const organizationId = String(body.organization_id ?? "");
  const pendingToken = String(body.pending_token ?? "");
  const state = String(body.state ?? "");
  if (!organizationId || !pendingToken) return c.text("Missing fields", 400);

  try {
    const authResult = await authenticateWithOrganizationSelection({
      organizationId,
      pendingAuthenticationToken: pendingToken,
    });
    return finishAuth(c, authResult, state);
  } catch (err) {
    console.error(err);
    return c.text(err instanceof Error ? err.message : "Org selection failed", 400);
  }
});

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

  const sessionId = await createSession(userRow.id, selected?.id ?? null);
  setSessionCookie(c, sessionId);

  if (state.startsWith("next:")) {
    const next = state.slice("next:".length);
    if (next.startsWith("/")) return c.redirect(next);
  }
  if (!selected && synced.length > 1) {
    return c.redirect("/?pick=1");
  }
  if (!selected && synced.length === 0) {
    return c.html(noOrgPage({ defaultOrgName: defaultOrgName(userRow.name, userRow.email) }));
  }
  return c.redirect("/");
}

webRoutes.post("/logout", async (c) => {
  deleteCookie(c, "wb_session");
  return c.redirect("/");
});

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

  const sessionId = await createSession(user.id, selected?.id ?? null);
  setSessionCookie(c, sessionId);
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

    const sessionId = await createSession(user.id, created.id);
    setSessionCookie(c, sessionId);
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
      const sessionId = await createSession(user.id, created.id);
      setSessionCookie(c, sessionId);
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
    const sessionId = await createSession(user.id, next?.id ?? null);
    setSessionCookie(c, sessionId);
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

    deleteCookie(c, "wb_session");
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
  const sessionId = await createSession(user.id, org.id);
  setSessionCookie(c, sessionId);
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

webRoutes.get("/device", async (c) => {
  return c.html(
    `<!doctype html><html><head><meta charset="utf-8"/><title>Bagsy CLI login</title>
    <style>:root{color-scheme:light dark;--bg:#ffffff;--ink:#111111;--code-bg:#f4f4f5}
    @media (prefers-color-scheme: dark){:root{--bg:#0f0f10;--ink:#ededea;--code-bg:#1c1c1f}}
    body{font-family:system-ui;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5;background:var(--bg);color:var(--ink)}
    a{color:var(--ink)}
    code{background:var(--code-bg);padding:.1rem .35rem;border-radius:4px}</style></head><body>
    <h1>CLI login</h1>
    <p>The CLI uses <strong>WorkOS device authorization</strong> directly (AuthKit access JWT).</p>
    <p>Run <code>bagsy login</code> in your terminal and complete the WorkOS browser prompt shown there.</p>
    <p>This custom <code>/device</code> approval page is no longer used.</p>
    <p><a href="/">Back to Bagsy</a></p>
    </body></html>`,
  );
});

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