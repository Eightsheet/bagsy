import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
const outfile = join(outDir, "workboard.js");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile,
  packages: "bundle",
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __WORKBOARD_DEFAULT_API_URL__: JSON.stringify(
      process.env.WORKBOARD_DEFAULT_API_URL ??
        "https://repo-org-production.up.railway.app",
    ),
  },
  logLevel: "info",
});

chmodSync(outfile, 0o755);
writeFileSync(join(outDir, ".bundle-ok"), "ok\n");
