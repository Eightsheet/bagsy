import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  workosUserId: text("workos_user_id").unique(),
  email: text("email"),
  name: text("name"),
  githubId: text("github_id"),
  githubLogin: text("github_login"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  workosOrgId: text("workos_org_id").unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

export const linkedRepos = pgTable(
  "linked_repos",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    linkedByUserId: text("linked_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("linked_repos_org_repo").on(t.orgId, t.repo)],
);

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("default"),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    branch: text("branch"),
    title: text("title").notNull(),
    description: text("description"),
    files: jsonb("files").$type<string[]>().notNull().default([]),
    roadmapRef: text("roadmap_ref"),
    agentLabel: text("agent_label"),
    note: text("note"),
    resolvedRef: text("resolved_ref"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("claims_org_repo_status").on(t.orgId, t.repo, t.status),
    index("claims_user_status").on(t.userId, t.status),
    /** The board digest asks "has anything on this team moved" on a timer. */
    index("claims_org_updated").on(t.orgId, t.updatedAt),
  ],
);

/**
 * Append-only timeline per claim: system events (claimed / started / stale /
 * stolen / released / files synced) plus agent notes from heartbeats. Lets a
 * teammate judge a STALE claim before stealing it instead of guessing.
 */
export const claimEvents = pgTable(
  "claim_events",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Nulled instead of cascaded so a deleted account does not rewrite history. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    kind: text("kind").notNull(),
    message: text("message"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("claim_events_claim_created").on(t.claimId, t.createdAt)],
);

export const deviceCodes = pgTable("device_codes", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  orgId: text("org_id").references(() => organizations.id),
  userId: text("user_id").references(() => users.id),
  apiTokenPlain: text("api_token_plain"),
  approved: boolean("approved").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id").references(() => organizations.id),
  /** WorkOS AuthKit session id (`sid` claim) — needed to end the AuthKit session on logout. */
  workosSessionId: text("workos_session_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
