import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for migrations");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.DRIZZLE_FOLDER,
  path.join(process.cwd(), "drizzle"),
  path.join(__dirname, "../../drizzle"),
].filter(Boolean) as string[];

const migrationsFolder = candidates.find((p) => existsSync(p));
if (!migrationsFolder) {
  console.error("Could not find drizzle migrations folder. Tried:", candidates);
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder });
await client.end();
console.log("Migrations complete from", migrationsFolder);
