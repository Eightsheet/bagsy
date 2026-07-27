import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { and, eq, gt, isNull } from "drizzle-orm";
import { normalizeRepo } from "@repo-org/shared";
import {
  createSession,
  ensureMembership,
  loadSession,
  requireSession,
  setSessionCookie,
} from "../auth/middleware.js";
import { authenticateWithCode, getAuthKitUrl } from "../auth/workos.js";
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
import { generateApiToken, generateDeviceCodes, newId, slugify } from "../lib/crypto.js";
import { appUrl, workosConfigured } from "../lib/env.js";
import { layout, escapeHtml } from "../web/html.js";

export const webRoutes = new Hono();

webRoutes.use("*", loadSession);

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
          <p><a class="btn" href="/login">Sign in</a></p>
        </section>
      `,
      ),
    );
  }

  const memberOrgs = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, user.id));

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

  const tokens = org
    ? await db
        .select({
          id: apiTokens.id,
          label: apiTokens.label,
          prefix: apiTokens.tokenPrefix,
          createdAt: apiTokens.createdAt,
          lastUsedAt: apiTokens.lastUsedAt,
        })
        .from(apiTokens)
        .where(
          and(
            eq(apiTokens.orgId, org.id),
            eq(apiTokens.userId, user.id),
            isNull(apiTokens.revokedAt),
          ),
        )
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
        ${
          org
            ? `<p>Active: <strong>${escapeHtml(org.name)}</strong> <code>${escapeHtml(org.slug)}</code></p>`
            : `<p class="warn">No active org — create or select one.</p>`
        }
        <ul>
          ${memberOrgs
            .map(
              (o) => `
            <li>
              ${escapeHtml(o.name)} (<code>${escapeHtml(o.slug)}</code>)
              <form class="inline" method="post" action="/orgs/${escapeHtml(o.slug)}/use">
                <button type="submit">Use</button>
              </form>
            </li>`,
            )
            .join("")}
        </ul>
        <form method="post" action="/orgs" class="stack">
          <label>Create org name <input name="name" required placeholder="Acme" /></label>
          <button type="submit">Create organization</button>
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
              : "<li class='muted'>None yet</li>"
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

      <section>
        <h2>API tokens</h2>
        <p class="muted">Use these with the <code>workboard</code> CLI.</p>
        <ul>
          ${
            tokens.length
              ? tokens
                  .map(
                    (t) =>
                      `<li><code>${escapeHtml(t.prefix)}…</code> ${escapeHtml(t.label)}</li>`,
                  )
                  .join("")
              : "<li class='muted'>No tokens</li>"
          }
        </ul>
        <form method="post" action="/tokens" class="stack">
          <label>Label <input name="label" value="cli" /></label>
          <button type="submit">Create token</button>
        </form>
      </section>
      `
          : ""
      }
    `,
    ),
  );
});

webRoutes.get("/login", (c) => {
  const workosUrl = getAuthKitUrl(`${appUrl()}/auth/callback`);
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

  return c.html(
    layout(
      "Sign in",
      `
      <section class="hero">
        <p class="brand">repo-org</p>
        <h1>Sign in</h1>
        <p class="lede">Continue with WorkOS AuthKit.</p>
        <p><a class="btn" href="${escapeHtml(workosUrl)}">Continue with WorkOS</a></p>
      </section>
    `,
    ),
  );
});

webRoutes.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  if (!code || !workosConfigured()) {
    return c.text("Missing code or WorkOS config", 400);
  }
  const result = await authenticateWithCode(code);
  const woUser = result.user;

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
  }

  const sessionId = await createSession(userRow!.id, null);
  setSessionCookie(c, sessionId);
  return c.redirect("/");
});

webRoutes.post("/logout", async (c) => {
  deleteCookie(c, "wb_session");
  return c.redirect("/");
});

webRoutes.post("/orgs", requireSession, async (c) => {
  const user = c.get("sessionUser")!;
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  if (!name) return c.text("Name required", 400);
  let slug = slugify(name);
  const clash = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (clash[0]) slug = `${slug}-${newId().slice(0, 4)}`;

  const id = newId("org");
  await db.insert(organizations).values({ id, name, slug });
  await ensureMembership(user.id, id, "owner");
  const sessionId = await createSession(user.id, id);
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

webRoutes.post("/tokens", requireSession, async (c) => {
  const user = c.get("sessionUser")!;
  const org = c.get("sessionOrg");
  if (!org) return c.text("Select an org first", 400);
  const body = await c.req.parseBody();
  const label = String(body.label ?? "cli");
  const generated = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    userId: user.id,
    orgId: org.id,
    label,
    tokenHash: generated.hash,
    tokenPrefix: generated.prefix,
  });

  return c.html(
    layout(
      "Token created",
      `
      <section>
        <h1>API token created</h1>
        <p>Copy it now — it won't be shown again.</p>
        <pre class="token">${escapeHtml(generated.token)}</pre>
        <p><code>workboard login --token ${escapeHtml(generated.token)}</code></p>
        <p><a href="/">Back</a></p>
      </section>
    `,
    ),
  );
});

// Device flow for CLI
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

webRoutes.get("/device", requireSession, async (c) => {
  const userCode = c.req.query("user_code") ?? "";
  return c.html(
    layout(
      "Authorize CLI",
      `
      <section>
        <h1>Authorize CLI</h1>
        <form method="post" action="/device" class="stack">
          <label>User code <input name="user_code" value="${escapeHtml(userCode)}" required /></label>
          <button type="submit">Approve</button>
        </form>
      </section>
    `,
    ),
  );
});

webRoutes.post("/device", requireSession, async (c) => {
  const user = c.get("sessionUser")!;
  const org = c.get("sessionOrg");
  if (!org) {
    return c.html(layout("Authorize CLI", `<p class="warn">Select an organization first, then retry.</p><p><a href="/">Go to dashboard</a></p>`));
  }
  const body = await c.req.parseBody();
  const userCode = String(body.user_code ?? "").toUpperCase();
  const rows = await db
    .select()
    .from(deviceCodes)
    .where(and(eq(deviceCodes.userCode, userCode), gt(deviceCodes.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return c.text("Invalid or expired code", 400);

  const generated = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    userId: user.id,
    orgId: org.id,
    label: "device-login",
    tokenHash: generated.hash,
    tokenPrefix: generated.prefix,
  });

  await db
    .update(deviceCodes)
    .set({
      approved: true,
      userId: user.id,
      orgId: org.id,
      apiTokenPlain: generated.token,
    })
    .where(eq(deviceCodes.id, row.id));

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
