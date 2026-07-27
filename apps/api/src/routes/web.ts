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
  listLocalOrgsForUser,
  pickDefaultOrg,
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
  claims,
  deviceCodes,
  linkedRepos,
  memberships,
  organizations,
  users,
} from "../db/schema.js";
import { generateApiToken, generateDeviceCodes, newId } from "../lib/crypto.js";
import { appUrl, workosConfigured } from "../lib/env.js";
import { layout, escapeHtml } from "../web/html.js";

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
    return c.html(
      layout(
        "Workboard",
        `
        <section class="hero">
          <p class="brand">repo-org</p>
          <h1>Workboard</h1>
          <p class="lede">Claim what your agent is working on so teammates don't double up.</p>
          <p><a class="btn" href="/login">Sign in with WorkOS</a></p>
        </section>
      `,
      ),
    );
  }

  const memberOrgs = await listLocalOrgsForUser(user.id);

  const repos = org
    ? await db.select().from(linkedRepos).where(eq(linkedRepos.orgId, org.id))
    : [];

  const activeClaims = org
    ? await db
        .select({
          claim: claims,
          email: users.email,
          name: users.name,
        })
        .from(claims)
        .innerJoin(users, eq(claims.userId, users.id))
        .where(and(eq(claims.orgId, org.id), eq(claims.status, "active")))
    : [];

  return c.html(
    layout(
      "Dashboard",
      `
      <header class="top">
        <div>
          <p class="brand">repo-org / workboard</p>
          <p class="muted">${escapeHtml(user.email ?? user.name ?? user.id)}</p>
        </div>
        <form method="post" action="/logout"><button type="submit">Log out</button></form>
      </header>

      <section>
        <h2>Organization</h2>
        <p class="muted">Synced from WorkOS. CLI: <code>workboard login</code></p>
        ${
          org
            ? `<p>Active: <strong>${escapeHtml(org.name)}</strong> <code>${escapeHtml(org.slug)}</code></p>`
            : `<p class="warn">Pick a WorkOS organization${memberOrgs.length ? "" : " — none found on your WorkOS user yet"}.</p>`
        }
        <ul>
          ${memberOrgs
            .map(
              (o) => `
            <li>
              ${escapeHtml(o.name)} (<code>${escapeHtml(o.slug)}</code>)
              ${o.workosOrgId ? `<span class="muted">· WorkOS</span>` : ""}
              <form class="inline" method="post" action="/orgs/${escapeHtml(o.slug)}/use">
                <button type="submit">Use</button>
              </form>
            </li>`,
            )
            .join("")}
        </ul>
        <form method="post" action="/orgs/sync" class="inline">
          <button type="submit">Refresh from WorkOS</button>
        </form>
      </section>

      ${
        org
          ? `
      <section>
        <h2>Linked repos</h2>
        <ul>
          ${
            repos.length
              ? repos
                  .map(
                    (r) =>
                      `<li><code>${escapeHtml(r.repo)}</code>${r.verifiedAt ? " · verified" : " · unverified"}</li>`,
                  )
                  .join("")
              : "<li class='muted'>None yet — link one, or run <code>workboard link-repo</code></li>"
          }
        </ul>
        <form method="post" action="/repos" class="stack">
          <label>owner/name <input name="repo" required placeholder="acme/app" /></label>
          <button type="submit">Link repo</button>
        </form>
      </section>

      <section>
        <h2>Active claims</h2>
        <ul>
          ${
            activeClaims.length
              ? activeClaims
                  .map(
                    (r) => `
            <li>
              <strong>${escapeHtml(r.claim.title)}</strong>
              on <code>${escapeHtml(r.claim.repo)}</code>
              by ${escapeHtml(r.name ?? r.email ?? "user")}
              <div class="muted">${escapeHtml((r.claim.files ?? []).join(", ") || "no files")}</div>
            </li>`,
                  )
                  .join("")
              : "<li class='muted'>No active claims</li>"
          }
        </ul>
      </section>
      `
          : ""
      }
    `,
    ),
  );
});

webRoutes.get("/login", (c) => {
  const next = c.req.query("next");
  const state = next ? `next:${next}` : undefined;
  const workosUrl = getAuthKitUrl(`${appUrl()}/auth/callback`, { state });
  if (!workosUrl) {
    return c.html(
      layout(
        "Sign in",
        `
        <section class="hero">
          <p class="brand">repo-org</p>
          <h1>Sign in unavailable</h1>
          <p class="lede">WorkOS AuthKit is not configured. Set <code>WORKOS_API_KEY</code> and <code>WORKOS_CLIENT_ID</code>.</p>
        </section>
      `,
      ),
      503,
    );
  }

  // Prefer immediate redirect for CLI/device flows
  if (next?.startsWith("/device")) {
    return c.redirect(workosUrl);
  }

  return c.html(
    layout(
      "Sign in",
      `
      <section class="hero">
        <p class="brand">repo-org</p>
        <h1>Sign in</h1>
        <p class="lede">Continue with WorkOS AuthKit. Your WorkOS organizations sync automatically.</p>
        <p><a class="btn" href="${escapeHtml(workosUrl)}">Continue with WorkOS</a></p>
      </section>
    `,
    ),
  );
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
        layout(
          "Choose organization",
          `
          <section>
            <h1>Choose organization</h1>
            <p class="muted">You belong to more than one WorkOS organization.</p>
            <ul>
              ${orgs
                .map(
                  (o) => `
                <li>
                  <form method="post" action="/auth/select-org">
                    <input type="hidden" name="organization_id" value="${escapeHtml(o.id)}" />
                    <input type="hidden" name="pending_token" value="${escapeHtml(token)}" />
                    <input type="hidden" name="state" value="${escapeHtml(state)}" />
                    <button type="submit">${escapeHtml(o.name)}</button>
                  </form>
                </li>`,
                )
                .join("")}
            </ul>
          </section>
        `,
        ),
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
    return c.html(
      layout(
        "No organization",
        `
        <section>
          <h1>No WorkOS organization</h1>
          <p class="lede">Create or join an organization in the WorkOS Dashboard, then click refresh.</p>
          <form method="post" action="/orgs/sync"><button type="submit">Refresh from WorkOS</button></form>
          <p><a href="/">Dashboard</a></p>
        </section>
      `,
      ),
    );
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

webRoutes.post("/orgs/:slug/use", requireSession, async (c) => {
  const user = c.get("sessionUser")!;
  const slug = c.req.param("slug") as string;
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

// Device flow for CLI — WorkOS login, then auto-approve
webRoutes.post("/v1/auth/device/code", async (c) => {
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
        return c.html(
          layout(
            "Authorize CLI",
            `
            <section>
              <h1>Authorize CLI</h1>
              <p>Pick the WorkOS organization for this CLI session:</p>
              <ul>
                ${synced
                  .map(
                    (o) => `
                  <li>
                    <form method="post" action="/device">
                      <input type="hidden" name="user_code" value="${escapeHtml(userCode)}" />
                      <input type="hidden" name="org_id" value="${escapeHtml(o.id)}" />
                      <button type="submit">${escapeHtml(o.name)}</button>
                    </form>
                  </li>`,
                  )
                  .join("")}
              </ul>
            </section>
          `,
          ),
        );
      } else {
        return c.html(
          layout(
            "Authorize CLI",
            `<section><h1>No WorkOS organization</h1><p class="warn">Join/create an org in WorkOS, then retry <code>workboard login</code>.</p></section>`,
          ),
        );
      }
    }
  }

  if (org && userCode) {
    const approved = await approveDeviceLogin({
      userId: user.id,
      orgId: org.id,
      userCode,
    });
    if (approved.ok) {
      return c.html(
        layout(
          "Approved",
          `<section><h1>CLI approved</h1><p>Signed in as ${escapeHtml(user.email ?? user.id)} · <strong>${escapeHtml(org.name)}</strong></p><p>You can close this tab and return to the terminal.</p></section>`,
        ),
      );
    }
  }

  return c.html(
    layout(
      "Authorize CLI",
      `
      <section>
        <h1>Authorize CLI</h1>
        <p>Signed in as ${escapeHtml(user.email ?? user.id)}${org ? ` · <strong>${escapeHtml(org.name)}</strong>` : ""}</p>
        <form method="post" action="/device" class="stack">
          <input type="hidden" name="user_code" value="${escapeHtml(userCode)}" />
          <button type="submit">Approve terminal login</button>
        </form>
      </section>
    `,
    ),
  );
});

webRoutes.post("/device", requireSession, async (c) => {
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
    return c.html(
      layout(
        "Authorize CLI",
        `<p class="warn">No organization selected.</p><p><a href="/device?user_code=${encodeURIComponent(userCode)}">Retry</a></p>`,
      ),
    );
  }

  const approved = await approveDeviceLogin({
    userId: user.id,
    orgId: org.id,
    userCode,
  });
  if (!approved.ok) return c.text(approved.error, approved.status);

  return c.html(
    layout(
      "Approved",
      `<section><h1>CLI approved</h1><p>You can close this tab and return to the terminal.</p></section>`,
    ),
  );
});

webRoutes.post("/v1/auth/device/token", async (c) => {
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
