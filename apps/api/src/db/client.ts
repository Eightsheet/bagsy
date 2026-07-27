import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("DATABASE_URL is not set — database features will fail until configured.");
}

const client = postgres(databaseUrl ?? "postgres://localhost:5432/repo_org", {
  max: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });
export type Db = typeof db;
