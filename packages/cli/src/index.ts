#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseGitRemoteUrl } from "@repo-org/shared";

type Config = {
  apiUrl: string;
  token?: string;
  orgSlug?: string;
  currentClaimId?: string;
};

const CONFIG_DIR = join(homedir(), ".config", "repo-org");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return { apiUrl: process.env.WORKBOARD_API_URL ?? "http://localhost:3000" };
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  return {
    apiUrl: process.env.WORKBOARD_API_URL ?? raw.apiUrl ?? "http://localhost:3000",
    token: process.env.WORKBOARD_TOKEN ?? raw.token,
    orgSlug: raw.orgSlug,
    currentClaimId: raw.currentClaimId,
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

Usage:
  workboard login [--token TOKEN]
  workboard status [--repo owner/name]
  workboard claim -t TITLE [-f FILE ...] [--roadmap REF] [--branch B] [--strict] [--note NOTE]
  workboard heartbeat [--note NOTE] [--claim ID]
  workboard release [claim-id|current]
  workboard link-repo [owner/name]
  workboard whoami

Env:
  WORKBOARD_API_URL   API base (default from config or http://localhost:3000)
  WORKBOARD_TOKEN     API token override
`);
  process.exit(0);
}

async function api(
  cfg: Config,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: any }> {
  if (!cfg.token) die("Not logged in. Run: workboard login");
  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
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
    console.log(`Logged in as ${me.json.user.email ?? me.json.user.id} · org ${me.json.org.slug}`);
    return;
  }

  // Device flow
  const start = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/auth/device/code`, {
    method: "POST",
  });
  const device = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    interval: number;
  };
  console.log(`Open: ${device.verification_uri_complete}`);
  console.log(`Or enter code ${device.user_code} at ${cfg.apiUrl}/device`);

  // try open browser
  spawnSync("bash", ["-lc", `open '${device.verification_uri_complete}' 2>/dev/null || true`]);

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
      console.log(`Logged in as ${me.json.user.email ?? me.json.user.id} · org ${me.json.org.slug}`);
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
  const [owner, name] = repo.split("/");
  const res = await api(cfg, `/v1/repos/${owner}/${name}/claims`);
  if (res.status === 404) {
    console.log(`Repo ${repo} is not linked to your org.`);
    console.log(`Link it: workboard link-repo ${repo}`);
    process.exit(2);
  }
  if (res.status !== 200) die(`status failed (${res.status}): ${JSON.stringify(res.json)}`);

  const claims = res.json.claims as any[];
  console.log(`Org: ${res.json.org.slug}`);
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
  const res = await api(cfg, `/v1/repos/${owner}/${name}/claims`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    console.error("Strict overlap blocked:");
    console.error(JSON.stringify(res.json.overlaps, null, 2));
    process.exit(3);
  }
  if (res.status !== 201) die(`claim failed (${res.status}): ${JSON.stringify(res.json)}`);
  cfg.currentClaimId = res.json.claim.id;
  saveConfig(cfg);
  console.log(`Claimed ${res.json.claim.id}: ${res.json.claim.title}`);
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
  const target = args.find((a) => !a.startsWith("-")) ?? "current";
  if (target === "current") {
    if (cfg.currentClaimId) {
      const res = await api(cfg, `/v1/claims/${cfg.currentClaimId}/release`, { method: "POST" });
      if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
      console.log(`Released ${cfg.currentClaimId}`);
      cfg.currentClaimId = undefined;
      saveConfig(cfg);
      return;
    }
    const repo = detectRepo(argValue(args, "--repo"));
    const res = await api(cfg, `/v1/claims/current/release`, {
      method: "POST",
      body: JSON.stringify({ repo }),
    });
    if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
    console.log(`Released ${res.json.claim.id}`);
    return;
  }
  const res = await api(cfg, `/v1/claims/${target}/release`, { method: "POST" });
  if (res.status !== 200) die(`release failed (${res.status}): ${JSON.stringify(res.json)}`);
  if (cfg.currentClaimId === target) {
    cfg.currentClaimId = undefined;
    saveConfig(cfg);
  }
  console.log(`Released ${target}`);
}

async function linkRepo(args: string[]) {
  const cfg = loadConfig();
  const repo = detectRepo(args.find((a) => !a.startsWith("-")));
  const res = await api(cfg, `/v1/repos`, {
    method: "POST",
    body: JSON.stringify({ repo }),
  });
  if (res.status !== 200 && res.status !== 201) {
    die(`link-repo failed (${res.status}): ${JSON.stringify(res.json)}`);
  }
  console.log(`Linked ${res.json.repo.repo}${res.json.verified ? " (verified)" : " (unverified)"}`);
}

async function whoami() {
  const cfg = loadConfig();
  const res = await api(cfg, "/v1/me");
  if (res.status !== 200) die(`whoami failed (${res.status}): ${JSON.stringify(res.json)}`);
  console.log(JSON.stringify(res.json, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "-h" || cmd === "--help") usage();

try {
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
    case "whoami":
      await whoami();
      break;
    default:
      die(`Unknown command: ${cmd}\nRun workboard --help`);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
