import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_SYNC_FILES,
  formatFileClaim,
  mergeRanges,
  parseGitRemoteUrl,
  parseUnifiedDiffRanges,
  type LineRange,
} from "@bagsy/shared";
import {
  CLI_VERSION,
  fetchCliUpdate,
  installCliTarball,
  shouldAutoUpdate,
} from "./update.js";
import {
  type AuthConfig,
  env,
  ensureFreshAccessToken,
  fetchAuthConfig,
  loadAuthConfig,
  refreshAccessToken,
  saveAuthConfig,
  storeLoginTokens,
  workosDeviceLogin,
} from "./auth.js";

type Team = { id: string; slug: string; name: string };
type Config = AuthConfig;

/** Injected at bundle time; overridable via BAGSY_API_URL. */
declare const __BAGSY_DEFAULT_API_URL__: string;
declare const __BAGSY_SKILL_MD__: string;
declare const __BAGSY_INSTRUCTIONS_SNIPPET__: string;

const DEFAULT_API_URL =
  typeof __BAGSY_DEFAULT_API_URL__ !== "undefined"
    ? __BAGSY_DEFAULT_API_URL__
    : "https://repo-org-production.up.railway.app";

const SKILL_MD =
  typeof __BAGSY_SKILL_MD__ !== "undefined" ? __BAGSY_SKILL_MD__ : "";
const INSTRUCTIONS_SNIPPET =
  typeof __BAGSY_INSTRUCTIONS_SNIPPET__ !== "undefined"
    ? __BAGSY_INSTRUCTIONS_SNIPPET__
    : "";

function loadConfig(): Config {
  return loadAuthConfig(DEFAULT_API_URL);
}

function saveConfig(cfg: Config) {
  saveAuthConfig(cfg);
}

function die(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function usage(): never {
  console.log(`bagsy — agent coordination CLI

Teams own linked repos. The CLI picks your team from git remote
(when the repo is linked). If it is linked in more than one of your
teams, you will be asked once (or pass --org slug).

Usage:
  bagsy login              # opens browser → WorkOS AuthKit
  bagsy login --token TOKEN
  bagsy status [--repo owner/name] [--org slug]
  bagsy claim -t TITLE [-f FILE ...] [--roadmap REF] [--plan-url URL] [--branch B] [--strict] [--steal] [--note NOTE] [--org slug]
  bagsy plan -t TITLE [-f FILE ...] [--roadmap REF] [--plan-url URL] [--note NOTE]   # queue intent — no TTL, never blocks
      -f accepts line ranges: -f src/big.ts:120-240 (also :120 or :120-240,300-360).
      Disjoint ranges of the same file don't conflict; a plain path claims the whole file.
      In a project, -f owner/other-repo:path claims a file in a sibling repo.
  bagsy start CLAIM_ID [--steal]   # activate a planned claim (yours or a teammate's)
  bagsy heartbeat [--note NOTE] [--claim ID] [--no-sync-files]
  bagsy log [claim-id|current] [--org slug]   # full timeline of a claim
  bagsy release [claim-id|current] [--result PR_URL_OR_SHA] [--org slug]
  bagsy link-repo [owner/name] [--org slug]
  bagsy project create NAME [--repo owner/name ...] [--org slug]   # group repos into one project
  bagsy project add-repo NAME [owner/name] [--org slug]
  bagsy project remove-repo NAME owner/name [--org slug]
  bagsy project list [--org slug]
  bagsy project show NAME [--org slug]
      Repos in a project share one board: status shows all repos' claims and
      claims conflict across the whole project, not just your checkout.
  bagsy init               # interactive: Claude Code / Codex / Cursor (skills only)
  bagsy init --all
  bagsy init --claude-code --codex --cursor
  bagsy init --docs        # also create/append CLAUDE.md / AGENTS.md (opt-in)
  bagsy upgrade            # install latest CLI from GitHub Release (alias: update)
  bagsy whoami
  bagsy version

Env:
  BAGSY_API_URL            API base (default: https://repo-org-production.up.railway.app)
  BAGSY_TOKEN              API token override
  BAGSY_NO_AUTO_UPDATE=1   Skip background auto-update checks
  (legacy WORKBOARD_* variables still work)
`);
  process.exit(0);
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

async function maybeAutoUpdate(cfg: Config): Promise<void> {
  if (env("NO_AUTO_UPDATE") === "1") return;
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
    console.error(`Updating bagsy ${CLI_VERSION} → ${info.version} (${info.channel})…`);
    const result = installCliTarball(info.tarballUrl);
    if (result.ok) {
      console.error(`Updated bagsy → ${info.version}. Re-run your command if needed.`);
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
  console.log(`Installing bagsy ${info.version} (current ${CLI_VERSION})…`);
  const result = installCliTarball(info.tarballUrl);
  if (!result.ok) die(`Upgrade failed:\n${result.detail}`);
  console.log(`Updated bagsy → ${info.version}`);
  cfg.lastUpdateCheck = new Date().toISOString();
  saveConfig(cfg);
}

async function api(
  cfg: Config,
  path: string,
  init: RequestInit = {},
  orgSlug?: string,
): Promise<{ status: number; json: any }> {
  let current = await ensureFreshAccessToken(cfg);
  if (!current.token) die("Not logged in. Run: bagsy login");

  const run = async (token: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    const team = orgSlug ?? current.orgSlug;
    if (team) {
      // Legacy header kept until every deployed API reads X-Bagsy-Org.
      headers["X-Bagsy-Org"] = team;
      headers["X-Workboard-Org"] = team;
    }

    const res = await fetch(`${current.apiUrl.replace(/\/$/, "")}${path}`, {
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
  };

  let result = await run(current.token!);
  if (result.status === 401 && current.refreshToken && !env("TOKEN")) {
    try {
      current = await refreshAccessToken(current);
      Object.assign(cfg, current);
      result = await run(current.token!);
    } catch (err) {
      die(err instanceof Error ? err.message : String(err));
    }
  }
  Object.assign(cfg, current);
  return result;
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

/**
 * What this working tree has actually touched: uncommitted changes, untracked
 * files, and anything already committed on this branch since it forked off the
 * default branch. A file list declared before the work started is always a
 * guess — this is the real scope.
 */
function branchBase(): string | null {
  const base =
    git("git merge-base HEAD origin/HEAD 2>/dev/null") ??
    git("git merge-base HEAD origin/main 2>/dev/null") ??
    git("git merge-base HEAD origin/master 2>/dev/null");
  // Only ever interpolate a resolved object id into the shell.
  return base && /^[0-9a-f]{7,40}$/.test(base) ? base : null;
}

function changedFiles(): string[] {
  const out = new Set<string>();
  const collect = (raw: string | null) => {
    if (!raw) return;
    for (const line of raw.split("\n")) {
      const path = line.trim();
      if (path) out.add(path);
    }
  };

  collect(git("git diff --name-only HEAD 2>/dev/null"));
  collect(git("git ls-files --others --exclude-standard 2>/dev/null"));

  const base = branchBase();
  if (base) {
    collect(git(`git diff --name-only ${base} HEAD 2>/dev/null`));
  }

  return [...out];
}

/** More hunks than this and the file is effectively rewritten — claim it whole. */
const MAX_RANGES_PER_FILE = 20;

/** Accumulate new-side hunk ranges from `git diff -U0` output into `into` (per path). */
function collectDiffRanges(raw: string | null, into: Map<string, LineRange[]>) {
  if (!raw) return;
  for (const [path, ranges] of parseUnifiedDiffRanges(raw)) {
    into.set(path, [...(into.get(path) ?? []), ...ranges]);
  }
}

/**
 * changedFiles(), narrowed to the touched line ranges where git can tell us
 * (`src/big.ts:120-240`). Untracked, deleted, or heavily rewritten files stay
 * whole-path. The server only uses ranges to widen claims that were made with
 * ranges — everything else falls back to whole-file scope as before.
 */
function changedFileClaims(): string[] {
  const paths = changedFiles();
  const ranges = new Map<string, LineRange[]>();
  collectDiffRanges(git("git diff -U0 --no-color HEAD 2>/dev/null"), ranges);
  const base = branchBase();
  if (base) {
    collectDiffRanges(git(`git diff -U0 --no-color ${base} HEAD 2>/dev/null`), ranges);
  }
  return paths.map((path) => {
    const r = ranges.get(path);
    if (!r || r.length === 0) return path;
    const merged = mergeRanges(r);
    if (merged.length > MAX_RANGES_PER_FILE) return path;
    return formatFileClaim({ path, ranges: merged });
  });
}

function formatEventLine(event: {
  kind: string;
  message: string | null;
  actorName: string | null;
  createdAt: string;
}): string {
  const when = new Date(event.createdAt);
  const stamp = Number.isNaN(when.getTime())
    ? event.createdAt
    : when.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  const who = event.actorName ? ` (${event.actorName})` : "";
  return `${stamp}  ${event.kind}${who}: ${event.message ?? ""}`.trimEnd();
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
          `Link it: bagsy link-repo ${repo} --org ${explicitOrg}`,
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
    die("You have no team yet. Open Bagsy in the browser, create a team, then retry.");
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
  let cfg = loadConfig();
  const tokenFlag = argValue(args, "--token");
  if (tokenFlag) {
    cfg.token = tokenFlag;
    cfg.refreshToken = undefined;
    cfg.tokenExpiresAt = undefined;
    saveConfig(cfg);
    const me = await api(cfg, "/v1/me");
    if (me.status !== 200) die(`Login failed: ${JSON.stringify(me.json)}`);
    cfg.orgSlug = me.json.org.slug;
    saveConfig(cfg);
    console.log(`Logged in as ${me.json.user.email ?? me.json.user.id} · team ${me.json.org.slug}`);
    console.log(`API: ${cfg.apiUrl}`);
    return;
  }

  let authCfg;
  try {
    authCfg = await fetchAuthConfig(cfg.apiUrl);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }

  const tokens = await workosDeviceLogin({
    workosApiBaseUrl: authCfg.workosApiBaseUrl,
    clientId: authCfg.workosClientId,
    openBrowser: (url) => {
      spawnSync("bash", [
        "-lc",
        `open '${url.replace(/'/g, `'\\''`)}' 2>/dev/null || xdg-open '${url.replace(/'/g, `'\\''`)}' 2>/dev/null || true`,
      ]);
    },
  });

  cfg = storeLoginTokens(cfg, tokens);
  const me = await api(cfg, "/v1/me");
  if (me.status === 403 && me.json?.error === "no_organization") {
    console.log(`Logged in as ${me.json.user?.email ?? "user"} — create/join a team in the web UI first:`);
    console.log(`  ${cfg.apiUrl}`);
    return;
  }
  if (me.status !== 200) die(`Login failed: ${JSON.stringify(me.json)}`);
  cfg.orgSlug = me.json.org?.slug;
  saveConfig(cfg);
  console.log(`Logged in as ${me.json.user.email ?? me.json.user.id} · team ${me.json.org.slug}`);
  console.log(`API: ${cfg.apiUrl}`);
  console.log("Tip: day-to-day, the CLI picks your team from git remote.");
}

/** Tail of the claim timeline — bounded, so a busy board stays scannable. */
function printTimeline(claim: any) {
  const events = (claim.recentEvents ?? []) as any[];
  if (!events.length) return;
  const total = claim.eventCount ?? events.length;
  console.log("progress:");
  for (const event of events) {
    console.log(`  · ${formatEventLine(event)}`);
  }
  if (total > events.length) {
    console.log(`  … ${total - events.length} earlier · bagsy log ${claim.id}`);
  }
}

async function status(args: string[]) {
  const cfg = loadConfig();
  const repo = detectRepo(argValue(args, "--repo"));
  const team = await resolveLinkedTeam(cfg, repo, argValue(args, "--org"));
  if (!team) {
    console.log(`Repo ${repo} is not linked to any of your teams.`);
    console.log(`Link it: bagsy link-repo ${repo}`);
    process.exit(2);
  }

  const [owner, name] = repo.split("/");
  const res = await api(cfg, `/v1/repos/${owner}/${name}/claims`, {}, team.slug);
  if (res.status === 404) {
    console.log(`Repo ${repo} is not linked to team ${team.slug}.`);
    console.log(`Link it: bagsy link-repo ${repo} --org ${team.slug}`);
    process.exit(2);
  }
  if (res.status !== 200) die(`status failed (${res.status}): ${JSON.stringify(res.json)}`);

  const claims = res.json.claims as any[];
  const project = res.json.project as { name: string; slug: string; repos: string[] } | null;
  console.log(`Team: ${res.json.org.name} (${res.json.org.slug})`);
  if (project) {
    console.log(`Project: ${project.name} (${project.slug}) — repos: ${project.repos.join(", ")}`);
  }
  console.log(`Repo: ${repo}`);
  console.log(`Branch: ${detectBranch() ?? "unknown"}`);
  const wip = claims.filter((c) => c.status !== "planned");
  const planned = claims.filter((c) => c.status === "planned");
  if (!wip.length) {
    console.log("No active claims.");
  }
  for (const claim of wip) {
    console.log("---");
    const stale = claim.status === "stale" ? " [STALE — soft hold, may have local WIP]" : "";
    console.log(`# ${claim.id}${stale}`);
    console.log(`${claim.title} — ${claim.userName ?? claim.userEmail ?? claim.userId}`);
    if (project && claim.repo) console.log(`repo: ${claim.repo}`);
    if (claim.branch) console.log(`branch: ${claim.branch}`);
    if (claim.roadmapRef) console.log(`roadmap: ${claim.roadmapRef}`);
    if (claim.planUrl) console.log(`plan: ${claim.planUrl}`);
    if (claim.files?.length) console.log(`files: ${claim.files.join(", ")}`);
    if (claim.note) console.log(`note: ${claim.note}`);
    printTimeline(claim);
    console.log(
      `expires: ${claim.expiresAt}${claim.status === "stale" ? " (soft hold ~24h after)" : ""}`,
    );
  }
  if (planned.length) {
    console.log("");
    console.log(`Planned (queued intent — pick up with: bagsy start <id>):`);
    for (const claim of planned) {
      console.log("---");
      console.log(`# ${claim.id} [PLANNED]`);
      console.log(`${claim.title} — ${claim.userName ?? claim.userEmail ?? claim.userId}`);
      if (project && claim.repo) console.log(`repo: ${claim.repo}`);
      if (claim.roadmapRef) console.log(`roadmap: ${claim.roadmapRef}`);
      if (claim.planUrl) console.log(`plan: ${claim.planUrl}`);
      if (claim.files?.length) console.log(`files: ${claim.files.join(", ")}`);
      if (claim.description) console.log(`context: ${claim.description}`);
      if (claim.note) console.log(`note: ${claim.note}`);
    }
  }
}

async function claim(args: string[], opts?: { planned?: boolean }) {
  const cfg = loadConfig();
  const planned = opts?.planned || hasFlag(args, "--planned");
  const cmdName = planned ? "plan" : "claim";
  const title = argValue(args, "-t") ?? argValue(args, "--title");
  if (!title) die(`${cmdName} requires -t TITLE`);
  const files = [...argList(args, "-f"), ...argList(args, "--file")];
  const planUrl = argValue(args, "--plan-url") ?? null;
  if (planUrl) {
    let protocol = "";
    try {
      protocol = new URL(planUrl).protocol;
    } catch {
      // leave empty — fails the check below
    }
    if (protocol !== "http:" && protocol !== "https:") {
      die(`--plan-url must be an http:// or https:// URL, got: ${planUrl}`);
    }
  }
  const repo = detectRepo(argValue(args, "--repo"));
  const team = await resolveLinkedTeam(cfg, repo, argValue(args, "--org"));
  if (!team) {
    die(`Repo ${repo} is not linked. Run: bagsy link-repo ${repo}`);
  }

  const [owner, name] = repo.split("/");
  const body = {
    title,
    files,
    description: argValue(args, "--desc") ?? argValue(args, "--description") ?? null,
    branch: planned ? argValue(args, "--branch") ?? null : argValue(args, "--branch") ?? detectBranch(),
    roadmapRef: argValue(args, "--roadmap") ?? null,
    planUrl,
    agentLabel: argValue(args, "--agent") ?? env("AGENT_LABEL") ?? null,
    note: argValue(args, "--note") ?? null,
    strict: hasFlag(args, "--strict"),
    steal: hasFlag(args, "--steal"),
    planned,
  };
  const res = await api(
    cfg,
    `/v1/repos/${owner}/${name}/claims`,
    { method: "POST", body: JSON.stringify(body) },
    team.slug,
  );
  if (res.status === 409) {
    const err = String(res.json?.error ?? "");
    if (err.startsWith("soft_hold")) {
      console.error("Soft hold — overlapping claim went stale (agent may still have local WIP):");
      console.error(JSON.stringify(res.json.overlaps, null, 2));
      console.error("Take over with: bagsy claim ... --steal");
      process.exit(3);
    }
    console.error("Strict overlap blocked:");
    console.error(JSON.stringify(res.json.overlaps, null, 2));
    process.exit(3);
  }
  if (res.status !== 201) die(`${cmdName} failed (${res.status}): ${JSON.stringify(res.json)}`);
  if (planned) {
    console.log(`Planned ${res.json.claim.id}: ${res.json.claim.title}`);
    console.log(`Team: ${team.name} (${team.slug})`);
    if (res.json.claim.planUrl) console.log(`plan: ${res.json.claim.planUrl}`);
    console.log(`Pick it up later with: bagsy start ${res.json.claim.id}`);
  } else {
    cfg.currentClaimId = res.json.claim.id;
    saveConfig(cfg);
    console.log(`Claimed ${res.json.claim.id}: ${res.json.claim.title}`);
    console.log(`Team: ${team.name} (${team.slug})`);
    if (res.json.claim.planUrl) console.log(`plan: ${res.json.claim.planUrl}`);
  }
  if (res.json.stole?.length) {
    console.log(`Stole soft-held claims: ${res.json.stole.join(", ")}`);
  }
  if (res.json.overlaps?.length) {
    console.log("Warning: overlaps with existing claims:");
    console.log(JSON.stringify(res.json.overlaps, null, 2));
  }
}

async function start(args: string[]) {
  const cfg = loadConfig();
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) die("start requires a claim id: bagsy start CLAIM_ID (see bagsy status)");
  const body = {
    steal: hasFlag(args, "--steal"),
    branch: argValue(args, "--branch") ?? detectBranch(),
    agentLabel: argValue(args, "--agent") ?? env("AGENT_LABEL") ?? null,
  };
  const res = await api(
    cfg,
    `/v1/claims/${id}/start`,
    { method: "POST", body: JSON.stringify(body) },
    argValue(args, "--org"),
  );
  if (res.status === 409) {
    console.error("Soft hold — overlapping claim went stale (agent may still have local WIP):");
    console.error(JSON.stringify(res.json.overlaps, null, 2));
    console.error(`Take over with: bagsy start ${id} --steal`);
    process.exit(3);
  }
  if (res.status !== 200) die(`start failed (${res.status}): ${JSON.stringify(res.json)}`);
  cfg.currentClaimId = res.json.claim.id;
  saveConfig(cfg);
  console.log(`Started ${res.json.claim.id}: ${res.json.claim.title}`);
  console.log(`expires: ${res.json.claim.expiresAt}`);
  if (res.json.stole?.length) {
    console.log(`Stole soft-held claims: ${res.json.stole.join(", ")}`);
  }
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
  const files = hasFlag(args, "--no-sync-files") ? [] : changedFileClaims();
  // Which checkout this runs in — in a project, a sibling repo's files sync
  // into that repo's slice of the claim. Never fatal: heartbeats must work
  // outside a git checkout too.
  const remote = git("git remote get-url origin 2>/dev/null");
  const checkoutRepo = remote ? parseGitRemoteUrl(remote) : null;

  const res = await api(cfg, `/v1/claims/${id}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({
      note: note ?? undefined,
      files: files.length ? files : undefined,
      repo: checkoutRepo ?? undefined,
    }),
  });
  if (res.status !== 200) die(`heartbeat failed (${res.status}): ${JSON.stringify(res.json)}`);
  console.log(`Heartbeat ok · expires ${res.json.claim.expiresAt}`);

  if (res.json.syncSkipped === "too_many_files") {
    console.log(
      `Skipped file sync — working tree touches more than ${MAX_SYNC_FILES} files. Claim scope left as declared.`,
    );
  } else if (res.json.syncSkipped === "repo_mismatch") {
    console.log(
      "Skipped file sync — this checkout is a different repo than the claim (and not in the same project).",
    );
  } else if (res.json.addedFiles?.length) {
    console.log(`Claim now also covers: ${res.json.addedFiles.join(", ")}`);
  }
  if (res.json.overlaps?.length) {
    console.error("Warning: files you grew into overlap existing claims:");
    console.error(JSON.stringify(res.json.overlaps, null, 2));
  }
}

async function log(args: string[]) {
  const cfg = loadConfig();
  const positional = args.filter((a, i) => {
    if (a.startsWith("-")) return false;
    const prev = args[i - 1];
    return prev !== "--org" && prev !== "--claim";
  });
  const target = positional[0] && positional[0] !== "current" ? positional[0] : cfg.currentClaimId;
  if (!target) {
    die("No claim id. Pass one (see bagsy status) or claim first: bagsy log CLAIM_ID");
  }

  const res = await api(cfg, `/v1/claims/${target}/events`, {}, argValue(args, "--org"));
  if (res.status !== 200) die(`log failed (${res.status}): ${JSON.stringify(res.json)}`);

  const { claim, events } = res.json;
  console.log(`# ${claim.id} [${String(claim.status).toUpperCase()}]`);
  console.log(claim.title);
  if (claim.files?.length) console.log(`files: ${claim.files.join(", ")}`);
  if (claim.resolvedRef) console.log(`result: ${claim.resolvedRef}`);
  console.log("");
  if (!events.length) {
    console.log("No timeline entries yet.");
    return;
  }
  for (const event of events) {
    console.log(formatEventLine(event));
  }
}

async function release(args: string[]) {
  const cfg = loadConfig();
  const orgFlag = argValue(args, "--org");
  const resolvedRef = argValue(args, "--result") ?? argValue(args, "--pr") ?? null;
  const positional = args.filter((a, i) => {
    if (a.startsWith("-")) return false;
    const prev = args[i - 1];
    if (
      prev === "--org" ||
      prev === "--repo" ||
      prev === "--claim" ||
      prev === "--note" ||
      prev === "--result" ||
      prev === "--pr"
    )
      return false;
    return true;
  });
  const target = positional[0] ?? "current";
  const outcome = resolvedRef ? ` → ${resolvedRef}` : "";

  if (target === "current") {
    if (cfg.currentClaimId) {
      const res = await api(
        cfg,
        `/v1/claims/${cfg.currentClaimId}/release`,
        { method: "POST", body: JSON.stringify({ resolvedRef }) },
        orgFlag,
      );
      if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
      console.log(`Released ${cfg.currentClaimId}${outcome}`);
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
      { method: "POST", body: JSON.stringify({ repo, resolvedRef }) },
      team.slug,
    );
    if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
    console.log(`Released ${res.json.claim.id}${outcome}`);
    return;
  }
  const res = await api(
    cfg,
    `/v1/claims/${target}/release`,
    { method: "POST", body: JSON.stringify({ resolvedRef }) },
    orgFlag,
  );
  if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
  if (cfg.currentClaimId === target) {
    cfg.currentClaimId = undefined;
    saveConfig(cfg);
  }
  console.log(`Released ${target}${outcome}`);
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
    console.log(`To link into another team: bagsy link-repo ${repo} --org <slug>`);
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
  console.log(`${verb} ${res.json.repo.repo} → ${team.name} (${team.slug})`);
}

/** detectRepo without die() — for commands where a checkout is optional. */
function detectRepoSoft(): string | null {
  const remote = git("git remote get-url origin 2>/dev/null");
  return remote ? parseGitRemoteUrl(remote) : null;
}

function printProject(project: { name: string; slug: string; repos: string[] }) {
  console.log(`Project: ${project.name} (${project.slug})`);
  if (project.repos.length) {
    for (const repo of project.repos) console.log(`  - ${repo}`);
  } else {
    console.log("  (no repos yet — bagsy project add-repo)");
  }
}

/** Team for org-scoped project commands: --org, else the current repo's team, else the login default. */
async function resolveProjectOrg(cfg: Config, explicitOrg?: string): Promise<string | undefined> {
  if (explicitOrg) return explicitOrg;
  const repo = detectRepoSoft();
  if (repo) {
    const team = await resolveLinkedTeam(cfg, repo).catch(() => null);
    if (team) return team.slug;
  }
  return undefined;
}

async function projectCmd(args: string[]) {
  const cfg = loadConfig();
  const sub = args[0];
  const rest = args.slice(1);
  const positional = rest.filter((a, i) => {
    if (a.startsWith("-")) return false;
    const prev = rest[i - 1];
    return prev !== "--org" && prev !== "--repo";
  });
  const usageHint =
    "Usage: bagsy project create NAME [--repo owner/name ...] | add-repo NAME [owner/name] | remove-repo NAME owner/name | list | show NAME";

  switch (sub) {
    case "create": {
      const name = positional[0];
      if (!name) die(`project create requires a name.\n${usageHint}`);
      const org = await resolveProjectOrg(cfg, argValue(rest, "--org"));
      let repos = argList(rest, "--repo");
      if (repos.length === 0) {
        const current = detectRepoSoft();
        if (current) repos = [current];
      }
      const res = await api(
        cfg,
        "/v1/projects",
        { method: "POST", body: JSON.stringify({ name, repos }) },
        org,
      );
      if (res.status !== 201) die(`project create failed (${res.status}): ${JSON.stringify(res.json)}`);
      console.log("Created.");
      printProject(res.json.project);
      console.log("Repos in a project share one board: cross-repo claims and project-wide status.");
      return;
    }
    case "add-repo": {
      const name = positional[0];
      if (!name) die(`project add-repo requires a project name.\n${usageHint}`);
      const repo = positional[1] ?? detectRepoSoft();
      if (!repo) die("No repo given and no git remote found. Pass owner/name.");
      const org = await resolveProjectOrg(cfg, argValue(rest, "--org"));
      const res = await api(
        cfg,
        `/v1/projects/${encodeURIComponent(name)}/repos`,
        { method: "POST", body: JSON.stringify({ repo }) },
        org,
      );
      if (res.status !== 200) die(`project add-repo failed (${res.status}): ${JSON.stringify(res.json)}`);
      console.log(`Added ${repo}.`);
      printProject(res.json.project);
      return;
    }
    case "remove-repo": {
      const name = positional[0];
      const repo = positional[1];
      if (!name || !repo) die(`project remove-repo requires a project name and owner/name.\n${usageHint}`);
      const org = await resolveProjectOrg(cfg, argValue(rest, "--org"));
      const res = await api(
        cfg,
        `/v1/projects/${encodeURIComponent(name)}/repos/${repo}`,
        { method: "DELETE" },
        org,
      );
      if (res.status !== 200) die(`project remove-repo failed (${res.status}): ${JSON.stringify(res.json)}`);
      console.log(`Removed ${repo} — back to standalone claim semantics.`);
      printProject(res.json.project);
      return;
    }
    case "list": {
      const res = await api(cfg, "/v1/projects", {}, argValue(rest, "--org"));
      if (res.status !== 200) die(`project list failed (${res.status}): ${JSON.stringify(res.json)}`);
      const projects = res.json.projects as Array<{ name: string; slug: string; repos: string[] }>;
      if (!projects.length) {
        console.log("No projects yet. Group repos with: bagsy project create NAME --repo owner/name");
        return;
      }
      for (const project of projects) printProject(project);
      return;
    }
    case "show": {
      const name = positional[0];
      if (!name) die(`project show requires a project name.\n${usageHint}`);
      const res = await api(cfg, `/v1/projects/${encodeURIComponent(name)}`, {}, argValue(rest, "--org"));
      if (res.status !== 200) die(`project show failed (${res.status}): ${JSON.stringify(res.json)}`);
      printProject(res.json.project);
      return;
    }
    default:
      die(usageHint);
  }
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
    die("This build is missing embedded skill assets. Reinstall bagsy.");
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
    console.error("Install Bagsy skills for:");
    console.error("  1. All (Claude Code + Codex + Cursor)  [default]");
    console.error("  2. Claude Code  → .claude/skills/bagsy");
    console.error("  3. Codex        → .agents/skills/bagsy");
    console.error("  4. Cursor       → .cursor/skills/bagsy");
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
  const marker = "## Bagsy (required before coding)";
  const legacyMarker = "## Workboard (required before coding)";
  const instructions = INSTRUCTIONS_SNIPPET.trim() + "\n";

  function writeSkill(relDir: string) {
    const skillDir = join(cwd, ...relDir.split("/"));
    const skillPath = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, skillBody);
    console.log(`Wrote ${skillPath}`);
    const legacyDir = join(skillDir, "..", "workboard");
    if (existsSync(legacyDir)) {
      rmSync(legacyDir, { recursive: true, force: true });
      console.log(`Removed legacy ${relDir.replace(/bagsy$/, "workboard")}`);
    }
  }

  function upsertDoc(filename: string) {
    const path = join(cwd, filename);
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (existing.includes(marker) || existing.includes(legacyMarker)) {
        console.log(`${filename} already has a Bagsy section — left unchanged.`);
        return;
      }
      const sep = existing.endsWith("\n") || existing.length === 0 ? "\n" : "\n\n";
      writeFileSync(path, `${existing}${sep}${instructions}`);
      console.log(`Appended Bagsy section to ${filename}`);
    } else {
      writeFileSync(path, `${instructions}\n`);
      console.log(`Created ${filename}`);
    }
  }

  if (selected.includes("claude-code")) {
    writeSkill(".claude/skills/bagsy");
    if (writeDocs) upsertDoc("CLAUDE.md");
  }
  if (selected.includes("codex")) {
    writeSkill(".agents/skills/bagsy");
    if (writeDocs) upsertDoc("AGENTS.md");
  }
  if (selected.includes("cursor")) {
    writeSkill(".cursor/skills/bagsy");
  }

  if (!writeDocs && (selected.includes("claude-code") || selected.includes("codex"))) {
    console.log("Tip: pass --docs to also create/append CLAUDE.md / AGENTS.md (opt-in).");
  }

  console.log(`Done: ${selected.join(", ")}${writeDocs ? " (+ docs)" : ""}`);
}

/**
 * Keep repo-installed skills in sync with the running CLI: wherever a bagsy
 * (or legacy workboard) skill is already installed, rewrite it with the
 * embedded version and drop the legacy directory. Never installs anew —
 * that stays opt-in via `bagsy init`.
 */
function refreshSkills(): void {
  if (!SKILL_MD) return;
  const root = git("git rev-parse --show-toplevel 2>/dev/null");
  if (!root) return;
  const body = SKILL_MD.endsWith("\n") ? SKILL_MD : `${SKILL_MD}\n`;
  for (const base of [".claude/skills", ".agents/skills", ".cursor/skills"]) {
    try {
      const dir = join(root, ...base.split("/"), "bagsy");
      const path = join(dir, "SKILL.md");
      const legacyDir = join(root, ...base.split("/"), "workboard");
      const wired = existsSync(path) || existsSync(join(legacyDir, "SKILL.md"));
      if (!wired) continue;
      if (!existsSync(path) || readFileSync(path, "utf8") !== body) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, body);
        console.error(`Updated ${base}/bagsy/SKILL.md to CLI ${CLI_VERSION}`);
      }
      if (existsSync(legacyDir)) {
        rmSync(legacyDir, { recursive: true, force: true });
        console.error(`Removed legacy ${base}/workboard`);
      }
    } catch {
      // skill refresh must never break the actual command
    }
  }
}

if ((process.argv[1] ?? "").split("/").pop() === "workboard") {
  console.error("Note: workboard is now bagsy — the workboard alias will go away in a future release.");
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "-h" || cmd === "--help") usage();

try {
  if (cmd !== "upgrade" && cmd !== "update" && cmd !== "version" && cmd !== "-v" && cmd !== "--version") {
    await maybeAutoUpdate(loadConfig());
    if (cmd !== "init") refreshSkills();
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
    case "plan":
      await claim(rest, { planned: true });
      break;
    case "start":
      await start(rest);
      break;
    case "heartbeat":
      await heartbeat(rest);
      break;
    case "log":
      await log(rest);
      break;
    case "release":
      await release(rest);
      break;
    case "link-repo":
      await linkRepo(rest);
      break;
    case "project":
      await projectCmd(rest);
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
      die(`Unknown command: ${cmd}\nRun bagsy --help`);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
