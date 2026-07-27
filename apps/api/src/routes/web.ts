import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { normalizeRepo } from "@repo-org/shared";
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
  getAuthKitUrl,
} from "../auth/workos.js";
import { db } from "../db/client.js";
import {
  apiTokens,
  deviceCodes,
  linkedRepos,
  memberships,
  organizations,
  users,
} from "../db/schema.js";
import { getCliUpdateInfo } from "../lib/cli-update.js";
import { generateApiToken, generateDeviceCodes, newId } from "../lib/crypto.js";
import { appUrl, workosConfigured } from "../lib/env.js";
import { rateLimit } from "../lib/rate-limit.js";
import {
  chooseOrgPage,
  landingPage,
  loginPage,
  noOrgPage,
} from "../web/pages/auth.js";
import {
  deviceApprovePage,
  deviceApprovedPage,
  deviceMissingOrgPage,
  deviceNoOrgPage,
  devicePickOrgPage,
} from "../web/pages/device.js";
import { setupPage } from "../web/pages/setup.js";

export const webRoutes = new Hono();

webRoutes.use("*", loadSession);

async function upsertLocalUser(woUser: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}) {
  let userRow = (
    await db.select().from(users).where(eq(users.workosUserId, woUser.id)).limit(1)
  )[0];

  if (!userRow) {
    const id = newId("usr");
    [userRow] = await db
      .insert(users)
      .values({
        id,
        workosUserId: woUser.id,
        email: woUser.email,
        name: [woUser.firstName, woUser.lastName].filter(Boolean).join(" ") || woUser.email,
      })
      .returning();
  } else {
    await db
      .update(users)
      .set({
        email: woUser.email,
        name: [woUser.firstName, woUser.lastName].filter(Boolean).join(" ") || woUser.email,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userRow.id));
  }
  return userRow!;
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

// Device flow for CLI — WorkOS login, then explicit approve
webRoutes.post(
  "/v1/auth/device/code",
  rateLimit({ name: "device-code", windowMs: 60_000, max: 10 }),
  async (c) => {
  const { deviceCode, userCode } = generateDeviceCodes();
  const id = newId("dev");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(deviceCodes).values({
    id,
    deviceCode,
    userCode,
    expiresAt,
  });
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${appUrl()}/device`,
    verification_uri_complete: `${appUrl()}/device?user_code=${encodeURIComponent(userCode)}`,
    expires_in: 900,
    interval: 2,
  });
});

async function approveDeviceLogin(opts: {
  userId: string;
  orgId: string;
  userCode: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: 400 }> {
  const rows = await db
    .select()
    .from(deviceCodes)
    .where(and(eq(deviceCodes.userCode, opts.userCode), gt(deviceCodes.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Invalid or expired code", status: 400 };

  const generated = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    userId: opts.userId,
    orgId: opts.orgId,
    label: "cli-login",
    tokenHash: generated.hash,
    tokenPrefix: generated.prefix,
  });

  await db
    .update(deviceCodes)
    .set({
      approved: true,
      userId: opts.userId,
      orgId: opts.orgId,
      apiTokenPlain: generated.token,
    })
    .where(eq(deviceCodes.id, row.id));

  return { ok: true };
}

webRoutes.get("/device", async (c) => {
  const user = c.get("sessionUser");
  const userCode = (c.req.query("user_code") ?? "").toUpperCase();
  const next = `/device?user_code=${encodeURIComponent(userCode)}`;

  if (!user) {
    return c.redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  let org = c.get("sessionOrg");
  if (!org) {
    const local = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
    if (local?.workosUserId) {
      const synced = await syncWorkOSOrganizations(user.id, local.workosUserId);
      const selected = pickDefaultOrg(synced);
      if (selected) {
        const sessionId = await createSession(user.id, selected.id);
        setSessionCookie(c, sessionId);
        org = { id: selected.id, slug: selected.slug, name: selected.name };
      } else if (synced.length > 1) {
        return c.html(devicePickOrgPage({ userCode, orgs: synced }));
      } else {
        return c.html(deviceNoOrgPage());
      }
    }
  }

  // Never approve on GET: an attacker could start `workboard login` themselves
  // and phish a logged-in user into visiting the link. Approval requires the
  // explicit POST below.
  return c.html(
    deviceApprovePage({
      email: user.email,
      orgName: org?.name,
      userCode,
    }),
  );
});

webRoutes.post(
  "/device",
  requireSession,
  rateLimit({
    name: "device-approve",
    windowMs: 60_000,
    max: 20,
    key: (c) => c.get("sessionUser")?.id ?? "anon",
  }),
  async (c) => {
  const user = c.get("sessionUser")!;
  const body = await c.req.parseBody();
  const userCode = String(body.user_code ?? "").toUpperCase();
  let org = c.get("sessionOrg");

  const orgIdOverride = String(body.org_id ?? "");
  if (orgIdOverride) {
    const memberRows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, orgIdOverride)))
      .limit(1);
    if (!memberRows[0]) return c.text("Forbidden", 403);
    const orgRow = (
      await db.select().from(organizations).where(eq(organizations.id, orgIdOverride)).limit(1)
    )[0];
    if (!orgRow) return c.text("Org not found", 404);
    const sessionId = await createSession(user.id, orgRow.id);
    setSessionCookie(c, sessionId);
    org = { id: orgRow.id, slug: orgRow.slug, name: orgRow.name };
  }

  if (!org) {
    return c.html(deviceMissingOrgPage({ userCode }));
  }

  const approved = await approveDeviceLogin({
    userId: user.id,
    orgId: org.id,
    userCode,
  });
  if (!approved.ok) return c.text(approved.error, approved.status);

  return c.html(
    deviceApprovedPage({
      email: user.email,
      orgName: org.name,
    }),
  );
});

webRoutes.post(
  "/v1/auth/device/token",
  rateLimit({ name: "device-token", windowMs: 60_000, max: 60 }),
  async (c) => {
  const body = await c.req.json<{ device_code?: string }>();
  const deviceCode = body.device_code;
  if (!deviceCode) return c.json({ error: "device_code required" }, 400);

  const rows = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCode, deviceCode))
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "invalid device_code" }, 400);
  if (row.expiresAt.getTime() < Date.now()) return c.json({ error: "expired" }, 400);
  if (!row.approved || !row.apiTokenPlain) {
    return c.json({ error: "authorization_pending" }, 403);
  }

  const token = row.apiTokenPlain;
  await db
    .update(deviceCodes)
    .set({ apiTokenPlain: null })
    .where(eq(deviceCodes.id, row.id));

  return c.json({ access_token: token, token_type: "bearer" });
});
