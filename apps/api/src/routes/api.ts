import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { normalizeRepo } from "@repo-org/shared";
import { requireApiAuth } from "../auth/middleware.js";
import { listLocalOrgsForUser } from "../auth/orgs.js";
import { db } from "../db/client.js";
import { linkedRepos, memberships, organizations } from "../db/schema.js";
import {
  createClaim,
  findActiveClaimForUser,
  heartbeatClaim,
  listActiveClaims,
  releaseClaim,
  requireLinkedRepo,
  startClaim,
} from "../lib/claims.js";
import { newId } from "../lib/crypto.js";
import { verifyGithubRepoAccess } from "../lib/github.js";
import { rateLimit } from "../lib/rate-limit.js";

export const apiRoutes = new Hono();

apiRoutes.use(
  "/v1/*",
  rateLimit({ name: "api-ip", windowMs: 60_000, max: 180 }),
);
apiRoutes.use("/v1/*", requireApiAuth);
apiRoutes.use(
  "/v1/*",
  rateLimit({
    name: "api-user",
    windowMs: 60_000,
    max: 120,
    key: (c) => c.get("auth")?.user.id ?? "anon",
  }),
);

apiRoutes.get("/v1/me", async (c) => {
  const auth = c.get("auth");
  const orgs = await listLocalOrgsForUser(auth.user.id);
  return c.json({
    user: auth.user,
    org: auth.org,
    orgs: orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
  });
});

/** Which of the caller's teams have this repo linked — for CLI auto-pick. */
apiRoutes.get("/v1/repos/:owner/:repo/context", async (c) => {
  const auth = c.get("auth");
  const repo = normalizeRepo(`${c.req.param("owner")}/${c.req.param("repo")}`);
  const membershipsList = await listLocalOrgsForUser(auth.user.id);

  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
    })
    .from(linkedRepos)
    .innerJoin(organizations, eq(linkedRepos.orgId, organizations.id))
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, organizations.id), eq(memberships.userId, auth.user.id)),
    )
    .where(eq(linkedRepos.repo, repo));

  return c.json({
    repo,
    activeOrg: auth.org,
    linked: rows,
    memberships: membershipsList.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
  });
});

apiRoutes.get("/v1/repos/:owner/:repo/claims", async (c) => {
  const auth = c.get("auth");
  const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
  const linked = await requireLinkedRepo(auth.org.id, repo);
  if (!linked.ok) return c.json({ error: linked.error }, 404);

  const claims = await listActiveClaims(auth.org.id, linked.repo);
  return c.json({ repo: linked.repo, org: auth.org, claims });
});

const claimBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  files: z.array(z.string()).default([]),
  branch: z.string().max(200).optional().nullable(),
  roadmapRef: z.string().max(200).optional().nullable(),
  agentLabel: z.string().max(200).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  strict: z.boolean().optional(),
  steal: z.boolean().optional(),
  planned: z.boolean().optional(),
  ttlSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
});

apiRoutes.post("/v1/repos/:owner/:repo/claims", async (c) => {
  const auth = c.get("auth");
  const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
  const body = claimBody.parse(await c.req.json());

  const result = await createClaim({
    orgId: auth.org.id,
    orgSlug: auth.org.slug,
    userId: auth.user.id,
    userEmail: auth.user.email,
    userName: auth.user.name,
    repo,
    ...body,
  });

  if ("error" in result) {
    return c.json(result, result.status);
  }
  return c.json(result, 201);
});

apiRoutes.post("/v1/claims/current/release", async (c) => {
  const auth = c.get("auth");
  const body = z
    .object({
      repo: z.string(),
      resolvedRef: z.string().max(500).optional().nullable(),
    })
    .parse(await c.req.json());
  const current = await findActiveClaimForUser(auth.org.id, body.repo, auth.user.id);
  if (!current) return c.json({ error: "no active claim" }, 404);
  const result = await releaseClaim(current.id, auth.user.id, {
    resolvedRef: body.resolvedRef ?? null,
  });
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json({ claim: result.claim });
});

apiRoutes.post("/v1/claims/:id/start", async (c) => {
  const auth = c.get("auth");
  const body = z
    .object({
      ttlSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
      steal: z.boolean().optional(),
      branch: z.string().max(200).optional().nullable(),
      agentLabel: z.string().max(200).optional().nullable(),
    })
    .parse((await c.req.json().catch(() => ({}))) ?? {});

  const result = await startClaim(
    c.req.param("id"),
    {
      userId: auth.user.id,
      orgId: auth.org.id,
      userEmail: auth.user.email,
      userName: auth.user.name,
    },
    body,
  );
  if ("error" in result) {
    return c.json(
      { error: result.error, overlaps: "overlaps" in result ? result.overlaps : [] },
      result.status,
    );
  }
  return c.json(result);
});

apiRoutes.post("/v1/claims/:id/heartbeat", async (c) => {
  const auth = c.get("auth");
  const body = z
    .object({
      note: z.string().max(1000).optional().nullable(),
      ttlSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
    })
    .parse((await c.req.json().catch(() => ({}))) ?? {});

  const result = await heartbeatClaim(c.req.param("id"), auth.user.id, body);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json({ claim: result.claim });
});

apiRoutes.post("/v1/claims/:id/release", async (c) => {
  const auth = c.get("auth");
  const body = z
    .object({
      resolvedRef: z.string().max(500).optional().nullable(),
    })
    .parse((await c.req.json().catch(() => ({}))) ?? {});
  const result = await releaseClaim(c.req.param("id"), auth.user.id, {
    resolvedRef: body.resolvedRef ?? null,
  });
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json({ claim: result.claim });
});

apiRoutes.post("/v1/repos", async (c) => {
  const auth = c.get("auth");
  const body = z
    .object({
      repo: z.string().min(3),
      githubToken: z.string().optional(),
    })
    .parse(await c.req.json());

  const repo = normalizeRepo(body.repo);
  const verify = await verifyGithubRepoAccess(repo, {
    userToken: body.githubToken,
    githubLogin: auth.user.githubLogin,
  });
  if (!verify.ok) {
    return c.json({ error: verify.reason }, 403);
  }

  const existing = await db
    .select()
    .from(linkedRepos)
    .where(and(eq(linkedRepos.orgId, auth.org.id), eq(linkedRepos.repo, repo)))
    .limit(1);

  if (existing[0]) {
    if (verify.verified) {
      await db
        .update(linkedRepos)
        .set({ verifiedAt: new Date() })
        .where(eq(linkedRepos.id, existing[0].id));
    }
    return c.json({ repo: existing[0], verified: verify.verified });
  }

  const [row] = await db
    .insert(linkedRepos)
    .values({
      id: newId("repo"),
      orgId: auth.org.id,
      repo,
      verifiedAt: verify.verified ? new Date() : null,
      linkedByUserId: auth.user.id,
    })
    .returning();

  return c.json({ repo: row, verified: verify.verified, reason: verify.reason }, 201);
});

apiRoutes.get("/v1/repos", async (c) => {
  const auth = c.get("auth");
  const rows = await db
    .select()
    .from(linkedRepos)
    .where(eq(linkedRepos.orgId, auth.org.id));
  return c.json({ repos: rows });
});
