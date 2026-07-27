import { spawnSync } from "node:child_process";

export type CliUpdateInfo = {
  version: string;
  publishedAt: string;
  tarballUrl: string;
  channel: "stable" | "dev";
  delayHours: number;
};

declare const __WORKBOARD_VERSION__: string;

export const CLI_VERSION =
  typeof __WORKBOARD_VERSION__ !== "undefined" ? __WORKBOARD_VERSION__ : "0.0.0";

/** Compare dotted versions; returns -1 / 0 / 1. Non-numeric parts treated as 0. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export function shouldAutoUpdate(info: CliUpdateInfo, now = Date.now()): boolean {
  if (cmpVersion(CLI_VERSION, info.version) >= 0) return false;
  if (info.channel === "dev") return true;
  const published = Date.parse(info.publishedAt);
  if (Number.isNaN(published)) return false;
  const delayMs = (info.delayHours ?? 48) * 60 * 60 * 1000;
  return now >= published + delayMs;
}

export async function fetchCliUpdate(apiUrl: string): Promise<CliUpdateInfo | null> {
  const base = apiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/cli/update`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Partial<CliUpdateInfo>;
  if (!json.version || !json.tarballUrl || !json.publishedAt) return null;
  return {
    version: json.version,
    publishedAt: json.publishedAt,
    tarballUrl: json.tarballUrl,
    channel: json.channel === "dev" ? "dev" : "stable",
    delayHours: typeof json.delayHours === "number" ? json.delayHours : 48,
  };
}

export function installCliTarball(tarballUrl: string): { ok: boolean; detail: string } {
  const result = spawnSync("npm", ["install", "-g", tarballUrl], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    return { ok: true, detail: (result.stdout || "").trim() };
  }
  const err = (result.stderr || result.stdout || `npm exited ${result.status}`).trim();
  return { ok: false, detail: err };
}
