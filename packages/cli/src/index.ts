import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseGitRemoteUrl } from "@repo-org/shared";
import {
  CLI_VERSION,
  fetchCliUpdate,
  installCliTarball,
  shouldAutoUpdate,
} from "./update.js";

type Team = { id: string; slug: string; name: string };

type Config = {
  apiUrl: string;
  token?: string;
  /** Default / last-used team slug (token default may differ). */
  orgSlug?: string;
  /** Remembered team slug when a repo is linked in multiple teams. */
  repoTeams?: Record<string, string>;
  currentClaimId?: string;
  /** ISO timestamp of last auto-update check. */
  lastUpdateCheck?: string;
};

const CONFIG_DIR = join(homedir(), ".config", "repo-org");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/** Injected at bundle time; overridable via WORKBOARD_API_URL. */
declare const __WORKBOARD_DEFAULT_API_URL__: string;
declare const __WORKBOARD_SKILL_MD__: string;
declare const __WORKBOARD_INSTRUCTIONS_SNIPPET__: string;

const DEFAULT_API_URL =
  typeof __WORKBOARD_DEFAULT_API_URL__ !== "undefined"
    ? __WORKBOARD_DEFAULT_API_URL__
    : "https://repo-org-production.up.railway.app";

const SKILL_MD =
  typeof __WORKBOARD_SKILL_MD__ !== "undefined" ? __WORKBOARD_SKILL_MD__ : "";
const INSTRUCTIONS_SNIPPET =
  typeof __WORKBOARD_INSTRUCTIONS_SNIPPET__ !== "undefined"
    ? __WORKBOARD_INSTRUCTIONS_SNIPPET__
    : "";

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return { apiUrl: process.env.WORKBOARD_API_URL ?? DEFAULT_API_URL };
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  return {
    apiUrl: process.env.WORKBOARD_API_URL ?? raw.apiUrl ?? DEFAULT_API_URL,
    token: process.env.WORKBOARD_TOKEN ?? raw.token,
    orgSlug: raw.orgSlug,
    repoTeams: raw.repoTeams ?? {},
    currentClaimId: raw.currentClaimId,
    lastUpdateCheck: raw.lastUpdateCheck,
  };
}

function saveConfig(cfg: Config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

function die(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function usage(): never {
  console.log(`workboard — agent coordination CLI

Teams own linked repos. The CLI picks your team from git remote
(when the repo is linked). If it is linked in more than one of your
teams, you will be asked once (or pass --org slug).

Usage:
  workboard login              # opens browser → WorkOS AuthKit
  workboard login --token TOKEN
  workboard status [--repo owner/name] [--org slug]
  workboard claim -t TITLE [-f FILE ...] [--roadmap REF] [--branch B] [--strict] [--note NOTE] [--org slug]
  workboard heartbeat [--note NOTE] [--claim ID]
  workboard release [claim-id|current] [--org slug]
  workboard link-repo [owner/name] [--org slug]
  workboard init               # interactive: Claude Code / Codex / Cursor (skills only)
  workboard init --all
  workboard init --claude-code --codex --cursor
  workboard init --docs        # also create/append CLAUDE.md / AGENTS.md (opt-in)
  workboard upgrade            # install latest CLI from GitHub Release (alias: update)
  workboard whoami
  workboard version

Env:
  WORKBOARD_API_URL        API base (default: https://repo-org-production.up.railway.app)
  WORKBOARD_TOKEN          API token override
  WORKBOARD_NO_AUTO_UPDATE=1  Skip background auto-update checks
`);
  process.exit(0);
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

async function maybeAutoUpdate(cfg: Config): Promise<void> {
  if (process.env.WORKBOARD_NO_AUTO_UPDATE === "1") return;
  const last = cfg.lastUpdateCheck ? Date.parse(cfg.lastUpdateCheck) : 0;
  if (!Number.isNaN(last) && Date.now() - last < UPDATE_CHECK_MS) return;

  cfg.lastUpdateCheck = new Date().toISOString();
  try {
    saveConfig(cfg);
  } catch {
    // ignore persistence failures
  }

  try {
    const info = await fetchCliUpdate(cfg.apiUrl);
    if (!info || !shouldAutoUpdate(info)) return;
    console.error(`Updating workboard ${CLI_VERSION} → ${info.version} (${info.channel})…`);
    const result = installCliTarball(info.tarballUrl);
    if (result.ok) {
      console.error(`Updated workboard → ${info.version}. Re-run your command if needed.`);
    } else {
      console.error(`Auto-update failed: ${result.detail}`);
    }
  } catch {
    // silent — update must not break normal commands
  }
}

async function upgrade(_args: string[]): Promise<void> {
  const cfg = loadConfig();
  const info = await fetchCliUpdate(cfg.apiUrl);
  if (!info) die("Could not fetch CLI update info from API.");
  if (info.version === CLI_VERSION) {
    console.log(`Already on latest: ${CLI_VERSION} (channel ${info.channel})`);
    return;
  }
  console.log(`Installing workboard ${info.version} (current ${CLI_VERSION})…`);
  const result = installCliTarball(info.tarballUrl);
  if (!result.ok) die(`Upgrade failed:\n${result.detail}`);
  console.log(`Updated workboard → ${info.version}`);
  cfg.lastUpdateCheck = new Date().toISOString();
  saveConfig(cfg);
}

async function api(
  cfg: Config,
  path: string,
  init: RequestInit = {},
  orgSlug?: string,
): Promise<{ status: number; json: any }> {
  if (!cfg.token) die("Not logged in. Run: workboard login");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const team = orgSlug ?? cfg.orgSlug;
  if (team) headers["X-Workboard-Org"] = team;

  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function git(cmd: string): string | null {
  const result = spawnSync("bash", ["-lc", cmd], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function detectRepo(explicit?: string): string {
  if (explicit) return explicit;
  const remote = git("git remote get-url origin 2>/dev/null");
  if (!remote) die("Could not detect git remote. Pass --repo owner/name");
  const parsed = parseGitRemoteUrl(remote);
  if (!parsed) die(`Could not parse remote URL: ${remote}`);
  return parsed;
}

function detectBranch(): string | null {
  return git("git rev-parse --abbrev-ref HEAD 2>/dev/null");
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

function argList(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) {
      out.push(args[++i]!);
    }
  }
  return out;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function rememberTeam(cfg: Config, repo: string, slug: string) {
  cfg.orgSlug = slug;
  cfg.repoTeams = { ...(cfg.repoTeams ?? {}), [repo]: slug };
  saveConfig(cfg);
}

async function promptPickTeam(teams: Team[], prompt: string): Promise<Team> {
  if (!input.isTTY) {
    die(
      `${prompt}\n` +
        teams.map((t, i) => `  ${i + 1}. ${t.name} (${t.slug})`).join("\n") +
        `\nPass --org <slug> (non-interactive).`,
    );
  }
  console.error(prompt);
  teams.forEach((t, i) => {
    console.error(`  ${i + 1}. ${t.name}  ·  ${t.slug}`);
  });
  const rl = createInterface({ input, output: output });
  try {
    for (;;) {
      const answer = (await rl.question(`Choose 1–${teams.length}: `)).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= teams.length) {
        return teams[n - 1]!;
      }
      const bySlug = teams.find((t) => t.slug === answer);
      if (bySlug) return bySlug;
      console.error("Invalid choice.");
    }
  } finally {
    rl.close();
  }
}

type RepoContext = {
  repo: string;
  linked: Team[];
  memberships: Team[];
  activeOrg: Team;
};

async function fetchRepoContext(cfg: Config, repo: string): Promise<RepoContext> {
  const [owner, name] = repo.split("/");
  const res = await api(cfg, `/v1/repos/${owner}/${name}/context`);
  if (res.status !== 200) die(`Could not resolve team (${res.status}): ${JSON.stringify(res.json)}`);
  return res.json as RepoContext;
}

/**
 * Pick the team for a repo that is already linked somewhere.
 * Returns null if not linked in any of the user's teams.
 */
async function resolveLinkedTeam(
  cfg: Config,
  repo: string,
  explicitOrg?: string,
): Promise<Team | null> {
  const ctx = await fetchRepoContext(cfg, repo);

  if (explicitOrg) {
    const match =
      ctx.linked.find((t) => t.slug === explicitOrg) ??
      ctx.memberships.find((t) => t.slug === explicitOrg);
    if (!match) die(`You are not a member of team "${explicitOrg}".`);
    if (!ctx.linked.some((t) => t.slug === explicitOrg)) {
      die(
        `Repo ${repo} is not linked to team "${explicitOrg}".\n` +
          `Link it: workboard link-repo ${repo} --org ${explicitOrg}`,
      );
    }
    rememberTeam(cfg, repo, match.slug);
    return match;
  }

  if (ctx.linked.length === 0) return null;

  if (ctx.linked.length === 1) {
    const team = ctx.linked[0]!;
    rememberTeam(cfg, repo, team.slug);
    return team;
  }

  const remembered = cfg.repoTeams?.[repo];
  if (remembered) {
    const hit = ctx.linked.find((t) => t.slug === remembered);
    if (hit) {
      rememberTeam(cfg, repo, hit.slug);
      return hit;
    }
  }

  const picked = await promptPickTeam(
    ctx.linked,
    `Repo ${repo} is linked in more than one of your teams. Which board?`,
  );
  rememberTeam(cfg, repo, picked.slug);
  return picked;
}

/** Team to link a not-yet-linked repo into. */
async function resolveTeamForLink(
  cfg: Config,
  repo: string,
  explicitOrg?: string,
): Promise<Team> {
  const ctx = await fetchRepoContext(cfg, repo);

  if (ctx.linked.length > 0 && !explicitOrg) {
    // Already linked somewhere — treat as resolve for status-like flows.
    // For link, still allow linking into another team if --org is set.
  }

  if (explicitOrg) {
    const match = ctx.memberships.find((t) => t.slug === explicitOrg);
    if (!match) die(`You are not a member of team "${explicitOrg}".`);
    rememberTeam(cfg, repo, match.slug);
    return match;
  }

  if (ctx.memberships.length === 0) {
    die("You have no team yet. Open Workboard in the browser, create a team, then retry.");
  }

  if (ctx.memberships.length === 1) {
    const team = ctx.memberships[0]!;
    rememberTeam(cfg, repo, team.slug);
    return team;
  }

  const remembered = cfg.repoTeams?.[repo] ?? cfg.orgSlug;
  if (remembered) {
    const hit = ctx.memberships.find((t) => t.slug === remembered);
    if (hit) {
      rememberTeam(cfg, repo, hit.slug);
      return hit;
    }
  }

  const picked = await promptPickTeam(
    ctx.memberships,
    `Link ${repo} to which team?`,
  );
  rememberTeam(cfg, repo, picked.slug);
  return picked;
}

async function login(args: string[]) {
  const cfg = loadConfig();
  const tokenFlag = argValue(args, "--token");
  if (tokenFlag) {
    cfg.token = tokenFlag;
    saveConfig(cfg);
    const me = await api(cfg, "/v1/me");
    if (me.status !== 200) die(`Login failed: ${JSON.stringify(me.json)}`);
    cfg.orgSlug = me.json.org.slug;
    saveConfig(cfg);
    console.log(`Logged in as ${me.json.user.email ?? me.json.user.id} · team ${me.json.org.slug}`);
    console.log(`API: ${cfg.apiUrl}`);
    return;
  }

  const start = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/auth/device/code`, {
    method: "POST",
  });
  if (!start.ok) die(`Could not start login: ${start.status}`);
  const device = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    interval: number;
  };
  console.log("Opening browser for WorkOS login…");
  console.log(`Confirm code in browser: ${device.user_code}`);
  console.log(`If it does not open: ${device.verification_uri_complete}`);

  spawnSync("bash", [
    "-lc",
    `open '${device.verification_uri_complete}' 2>/dev/null || xdg-open '${device.verification_uri_complete}' 2>/dev/null || true`,
  ]);

  for (;;) {
    await new Promise((r) => setTimeout(r, (device.interval || 2) * 1000));
    const poll = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: device.device_code }),
    });
    const body = (await poll.json()) as { access_token?: string; error?: string };
    if (poll.ok && body.access_token) {
      cfg.token = body.access_token;
      saveConfig(cfg);
      const me = await api(cfg, "/v1/me");
      cfg.orgSlug = me.json.org?.slug;
      saveConfig(cfg);
      console.log(`Logged in as ${me.json.user.email ?? me.json.user.id} · team ${me.json.org.slug}`);
      console.log(`API: ${cfg.apiUrl}`);
      console.log("Tip: day-to-day, the CLI picks your team from git remote.");
      return;
    }
    if (body.error && body.error !== "authorization_pending") {
      die(`Login failed: ${body.error}`);
    }
  }
}

async function status(args: string[]) {
  const cfg = loadConfig();
  const repo = detectRepo(argValue(args, "--repo"));
  const team = await resolveLinkedTeam(cfg, repo, argValue(args, "--org"));
  if (!team) {
    console.log(`Repo ${repo} is not linked to any of your teams.`);
    console.log(`Link it: workboard link-repo ${repo}`);
    process.exit(2);
  }

  const [owner, name] = repo.split("/");
  const res = await api(cfg, `/v1/repos/${owner}/${name}/claims`, {}, team.slug);
  if (res.status === 404) {
    console.log(`Repo ${repo} is not linked to team ${team.slug}.`);
    console.log(`Link it: workboard link-repo ${repo} --org ${team.slug}`);
    process.exit(2);
  }
  if (res.status !== 200) die(`status failed (${res.status}): ${JSON.stringify(res.json)}`);

  const claims = res.json.claims as any[];
  console.log(`Team: ${res.json.org.name} (${res.json.org.slug})`);
  console.log(`Repo: ${repo}`);
  console.log(`Branch: ${detectBranch() ?? "unknown"}`);
  if (!claims.length) {
    console.log("No active claims.");
    return;
  }
  for (const claim of claims) {
    console.log("---");
    console.log(`# ${claim.id}`);
    console.log(`${claim.title} — ${claim.userName ?? claim.userEmail ?? claim.userId}`);
    if (claim.branch) console.log(`branch: ${claim.branch}`);
    if (claim.roadmapRef) console.log(`roadmap: ${claim.roadmapRef}`);
    if (claim.files?.length) console.log(`files: ${claim.files.join(", ")}`);
    if (claim.note) console.log(`note: ${claim.note}`);
    console.log(`expires: ${claim.expiresAt}`);
  }
}

async function claim(args: string[]) {
  const cfg = loadConfig();
  const title = argValue(args, "-t") ?? argValue(args, "--title");
  if (!title) die("claim requires -t TITLE");
  const files = [...argList(args, "-f"), ...argList(args, "--file")];
  const repo = detectRepo(argValue(args, "--repo"));
  const team = await resolveLinkedTeam(cfg, repo, argValue(args, "--org"));
  if (!team) {
    die(`Repo ${repo} is not linked. Run: workboard link-repo ${repo}`);
  }

  const [owner, name] = repo.split("/");
  const body = {
    title,
    files,
    branch: argValue(args, "--branch") ?? detectBranch(),
    roadmapRef: argValue(args, "--roadmap") ?? null,
    agentLabel: argValue(args, "--agent") ?? process.env.WORKBOARD_AGENT_LABEL ?? null,
    note: argValue(args, "--note") ?? null,
    strict: hasFlag(args, "--strict"),
  };
  const res = await api(
    cfg,
    `/v1/repos/${owner}/${name}/claims`,
    { method: "POST", body: JSON.stringify(body) },
    team.slug,
  );
  if (res.status === 409) {
    console.error("Strict overlap blocked:");
    console.error(JSON.stringify(res.json.overlaps, null, 2));
    process.exit(3);
  }
  if (res.status !== 201) die(`claim failed (${res.status}): ${JSON.stringify(res.json)}`);
  cfg.currentClaimId = res.json.claim.id;
  saveConfig(cfg);
  console.log(`Claimed ${res.json.claim.id}: ${res.json.claim.title}`);
  console.log(`Team: ${team.name} (${team.slug})`);
  if (res.json.overlaps?.length) {
    console.log("Warning: overlaps with existing claims:");
    console.log(JSON.stringify(res.json.overlaps, null, 2));
  }
}

async function heartbeat(args: string[]) {
  const cfg = loadConfig();
  const id = argValue(args, "--claim") ?? cfg.currentClaimId;
  if (!id) die("No claim id. Pass --claim ID or claim first.");
  const note = argValue(args, "--note");
  const res = await api(cfg, `/v1/claims/${id}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ note: note ?? undefined }),
  });
  if (res.status !== 200) die(`heartbeat failed (${res.status}): ${JSON.stringify(res.json)}`);
  console.log(`Heartbeat ok · expires ${res.json.claim.expiresAt}`);
}

async function release(args: string[]) {
  const cfg = loadConfig();
  const orgFlag = argValue(args, "--org");
  const positional = args.filter((a, i) => {
    if (a.startsWith("-")) return false;
    const prev = args[i - 1];
    if (prev === "--org" || prev === "--repo" || prev === "--claim" || prev === "--note") return false;
    return true;
  });
  const target = positional[0] ?? "current";

  if (target === "current") {
    if (cfg.currentClaimId) {
      const res = await api(
        cfg,
        `/v1/claims/${cfg.currentClaimId}/release`,
        { method: "POST" },
        orgFlag,
      );
      if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
      console.log(`Released ${cfg.currentClaimId}`);
      cfg.currentClaimId = undefined;
      saveConfig(cfg);
      return;
    }
    const repo = detectRepo(argValue(args, "--repo"));
    const team = await resolveLinkedTeam(cfg, repo, orgFlag);
    if (!team) die(`Repo ${repo} is not linked. Nothing to release.`);
    const res = await api(
      cfg,
      `/v1/claims/current/release`,
      { method: "POST", body: JSON.stringify({ repo }) },
      team.slug,
    );
    if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
    console.log(`Released ${res.json.claim.id}`);
    return;
  }
  const res = await api(cfg, `/v1/claims/${target}/release`, { method: "POST" }, orgFlag);
  if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
  if (cfg.currentClaimId === target) {
    cfg.currentClaimId = undefined;
    saveConfig(cfg);
  }
  console.log(`Released ${target}`);
}

async function linkRepo(args: string[]) {
  const cfg = loadConfig();
  const repo = detectRepo(args.find((a) => !a.startsWith("-") && a !== argValue(args, "--org")));
  const explicitOrg = argValue(args, "--org");
  const ctx = await fetchRepoContext(cfg, repo);

  if (ctx.linked.length > 0 && !explicitOrg) {
    if (ctx.linked.length === 1) {
      const team = ctx.linked[0]!;
      rememberTeam(cfg, repo, team.slug);
      console.log(`Already linked to ${team.name} (${team.slug}).`);
      return;
    }
    const team = await resolveLinkedTeam(cfg, repo);
    console.log(`Already linked in multiple teams. Using ${team!.name} (${team!.slug}).`);
    console.log(`To link into another team: workboard link-repo ${repo} --org <slug>`);
    return;
  }

  const team = await resolveTeamForLink(cfg, repo, explicitOrg);
  const res = await api(
    cfg,
    `/v1/repos`,
    { method: "POST", body: JSON.stringify({ repo }) },
    team.slug,
  );
  if (res.status !== 200 && res.status !== 201) {
    die(`link-repo failed (${res.status}): ${JSON.stringify(res.json)}`);
  }
  const verb = res.status === 201 ? "Linked" : "Updated";
  console.log(
    `${verb} ${res.json.repo.repo} → ${team.name} (${team.slug})${res.json.verified ? " (verified)" : " (unverified)"}`,
  );
}

async function whoami() {
  const cfg = loadConfig();
  const res = await api(cfg, "/v1/me");
  if (res.status !== 200) die(`whoami failed (${res.status}): ${JSON.stringify(res.json)}`);
  const { user, org, orgs } = res.json;
  console.log(`User: ${user.email ?? user.id}`);
  console.log(`API: ${cfg.apiUrl}`);
  console.log(`Active team: ${org.name} (${org.slug})`);
  if (Array.isArray(orgs) && orgs.length) {
    console.log("Your teams:");
    for (const t of orgs) {
      const mark = t.slug === org.slug ? " *" : "";
      console.log(`  - ${t.name} (${t.slug})${mark}`);
    }
  }
  console.log("Team for a repo is chosen from git remote when linked.");
}

async function init(args: string[]) {
  if (!SKILL_MD || !INSTRUCTIONS_SNIPPET) {
    die("This build is missing embedded skill assets. Reinstall workboard-cli.");
  }

  type Target = "claude-code" | "codex" | "cursor";
  const allTargets: Target[] = ["claude-code", "codex", "cursor"];

  const flagTargets = new Set<Target>();
  if (hasFlag(args, "--all")) allTargets.forEach((t) => flagTargets.add(t));
  if (hasFlag(args, "--claude-code") || hasFlag(args, "--claude")) flagTargets.add("claude-code");
  if (hasFlag(args, "--codex")) flagTargets.add("codex");
  if (hasFlag(args, "--cursor")) flagTargets.add("cursor");

  let writeDocs = hasFlag(args, "--docs") || hasFlag(args, "--claude-md") || hasFlag(args, "--agents-md");

  let selected: Target[];
  if (flagTargets.size > 0) {
    selected = allTargets.filter((t) => flagTargets.has(t));
  } else if (input.isTTY) {
    console.error("Install Workboard skills for:");
    console.error("  1. All (Claude Code + Codex + Cursor)  [default]");
    console.error("  2. Claude Code  → .claude/skills/workboard");
    console.error("  3. Codex        → .agents/skills/workboard");
    console.error("  4. Cursor       → .cursor/skills/workboard");
    console.error("  5. Custom — e.g. 2,3");
    const rl = createInterface({ input, output });
    try {
      const answer = (await rl.question("Choice [1]: ")).trim() || "1";
      if (answer === "1" || /^all$/i.test(answer)) {
        selected = [...allTargets];
      } else if (answer === "2") {
        selected = ["claude-code"];
      } else if (answer === "3") {
        selected = ["codex"];
      } else if (answer === "4") {
        selected = ["cursor"];
      } else {
        const picked = new Set<Target>();
        for (const part of answer.split(/[\s,]+/).filter(Boolean)) {
          if (part === "1") allTargets.forEach((t) => picked.add(t));
          if (part === "2" || part === "claude" || part === "claude-code") picked.add("claude-code");
          if (part === "3" || part === "codex") picked.add("codex");
          if (part === "4" || part === "cursor") picked.add("cursor");
        }
        selected = allTargets.filter((t) => picked.has(t));
        if (!selected.length) {
          die("No valid selection. Use 1–5, or flags: --claude-code --codex --cursor --all");
        }
      }
      if (!writeDocs) {
        const docsAnswer = (
          await rl.question("Also create/append CLAUDE.md / AGENTS.md? [y/N]: ")
        )
          .trim()
          .toLowerCase();
        writeDocs = docsAnswer === "y" || docsAnswer === "yes";
      }
    } finally {
      rl.close();
    }
  } else {
    selected = [...allTargets];
    console.error("No TTY / no flags — installing skills for all (Claude Code, Codex, Cursor).");
    if (!writeDocs) {
      console.error("Skipping CLAUDE.md / AGENTS.md (pass --docs to append).");
    }
  }

  const cwd = process.cwd();
  const skillBody = SKILL_MD.endsWith("\n") ? SKILL_MD : `${SKILL_MD}\n`;
  const marker = "## Workboard (required before coding)";
  const instructions = INSTRUCTIONS_SNIPPET.trim() + "\n";

  function writeSkill(relDir: string) {
    const skillDir = join(cwd, ...relDir.split("/"));
    const skillPath = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, skillBody);
    console.log(`Wrote ${skillPath}`);
  }

  function upsertDoc(filename: string) {
    const path = join(cwd, filename);
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (existing.includes(marker)) {
        console.log(`${filename} already has a Workboard section — left unchanged.`);
        return;
      }
      const sep = existing.endsWith("\n") || existing.length === 0 ? "\n" : "\n\n";
      writeFileSync(path, `${existing}${sep}${instructions}`);
      console.log(`Appended Workboard section to ${filename}`);
    } else {
      writeFileSync(path, `${instructions}\n`);
      console.log(`Created ${filename}`);
    }
  }

  if (selected.includes("claude-code")) {
    writeSkill(".claude/skills/workboard");
    if (writeDocs) upsertDoc("CLAUDE.md");
  }
  if (selected.includes("codex")) {
    writeSkill(".agents/skills/workboard");
    if (writeDocs) upsertDoc("AGENTS.md");
  }
  if (selected.includes("cursor")) {
    writeSkill(".cursor/skills/workboard");
  }

  if (!writeDocs && (selected.includes("claude-code") || selected.includes("codex"))) {
    console.log("Tip: pass --docs to also create/append CLAUDE.md / AGENTS.md (opt-in).");
  }

  console.log(`Done: ${selected.join(", ")}${writeDocs ? " (+ docs)" : ""}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "-h" || cmd === "--help") usage();

try {
  if (cmd !== "upgrade" && cmd !== "update" && cmd !== "version" && cmd !== "-v" && cmd !== "--version") {
    await maybeAutoUpdate(loadConfig());
  }

  switch (cmd) {
    case "login":
      await login(rest);
      break;
    case "status":
      await status(rest);
      break;
    case "claim":
      await claim(rest);
      break;
    case "heartbeat":
      await heartbeat(rest);
      break;
    case "release":
      await release(rest);
      break;
    case "link-repo":
      await linkRepo(rest);
      break;
    case "init":
      await init(rest);
      break;
    case "whoami":
      await whoami();
      break;
    case "upgrade":
    case "update":
      await upgrade(rest);
      break;
    case "version":
    case "-v":
    case "--version":
      console.log(CLI_VERSION);
      break;
    default:
      die(`Unknown command: ${cmd}\nRun workboard --help`);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
