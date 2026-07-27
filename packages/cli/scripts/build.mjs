import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
const outfile = join(outDir, "workboard.js");
const assetsDir = join(root, "assets");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const skillMd = readFileSync(join(assetsDir, "skill", "SKILL.md"), "utf8");
const claudeSnippet = readFileSync(join(assetsDir, "CLAUDE.snippet.md"), "utf8");

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
    __WORKBOARD_SKILL_MD__: JSON.stringify(skillMd),
    __WORKBOARD_CLAUDE_SNIPPET__: JSON.stringify(claudeSnippet),
  },
  logLevel: "info",
});

chmodSync(outfile, 0o755);
writeFileSync(join(outDir, ".bundle-ok"), "ok\n");

// Keep repo Cursor skill in sync with the packaged skill.
const repoSkill = join(root, "..", "..", ".cursor", "skills", "workboard", "SKILL.md");
try {
  mkdirSync(dirname(repoSkill), { recursive: true });
  copyFileSync(join(assetsDir, "skill", "SKILL.md"), repoSkill);
} catch {
  // Outside monorepo checkout — ignore.
}
