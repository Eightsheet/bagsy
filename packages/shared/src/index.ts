export type ClaimStatus = "active" | "stale" | "released" | "expired" | "planned";

export interface ClaimInput {
  repo: string;
  branch?: string | null;
  title: string;
  description?: string | null;
  files: string[];
  roadmapRef?: string | null;
  agentLabel?: string | null;
  note?: string | null;
  strict?: boolean;
  /** Take over overlapping stale claims. */
  steal?: boolean;
  /** Queue as intent ("I'll take this next") instead of active WIP. No TTL, never blocks. */
  planned?: boolean;
  ttlSeconds?: number;
}

export interface ClaimRecord {
  id: string;
  orgId: string;
  orgSlug: string;
  repo: string;
  branch: string | null;
  title: string;
  description: string | null;
  files: string[];
  roadmapRef: string | null;
  agentLabel: string | null;
  note: string | null;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: ClaimStatus;
  /** PR URL or commit SHA recorded on release — where the work ended up. */
  resolvedRef: string | null;
  startedAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface OverlapInfo {
  claimId: string;
  title: string;
  userName: string | null;
  userEmail: string | null;
  status?: ClaimStatus;
  reasons: Array<"files" | "roadmap_ref" | "title">;
  overlappingFiles: string[];
}

/** Heartbeat window while the agent is actively working. */
export const DEFAULT_TTL_SECONDS = 2 * 60 * 60;
/** After TTL, claim stays held as `stale` this long (WIP soft hold) before fully expiring. */
export const SOFT_HOLD_SECONDS = 24 * 60 * 60;

/** Normalize repo to owner/name lowercase. */
export function normalizeRepo(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid repo id "${input}". Expected owner/name.`);
  }
  return `${parts[0]!.toLowerCase()}/${parts[1]!.toLowerCase()}`;
}

/** Normalize file paths for overlap comparison. */
export function normalizeFilePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizeFilePath(a);
  const right = normalizeFilePath(b);
  if (left === right) return true;
  // glob-ish: trailing /** or * treated as prefix
  const leftPrefix = left.replace(/\*\*?$/, "").replace(/\/$/, "");
  const rightPrefix = right.replace(/\*\*?$/, "").replace(/\/$/, "");
  if (left.includes("*") && right.startsWith(leftPrefix)) return true;
  if (right.includes("*") && left.startsWith(rightPrefix)) return true;
  if (left.startsWith(right + "/") || right.startsWith(left + "/")) return true;
  return false;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findOverlaps(
  candidate: Pick<ClaimInput, "title" | "files" | "roadmapRef">,
  existing: Array<
    Pick<ClaimRecord, "id" | "title" | "files" | "roadmapRef" | "userName" | "userEmail" | "status">
  >,
): OverlapInfo[] {
  const overlaps: OverlapInfo[] = [];
  const candFiles = candidate.files.map(normalizeFilePath);
  const candTitle = normalizeTitle(candidate.title);
  const candRoadmap = candidate.roadmapRef?.trim().toLowerCase() || null;

  for (const claim of existing) {
    const reasons: OverlapInfo["reasons"] = [];
    const overlappingFiles: string[] = [];

    for (const f of candFiles) {
      for (const existingFile of claim.files) {
        if (pathsOverlap(f, existingFile)) {
          overlappingFiles.push(existingFile);
          break;
        }
      }
    }
    if (overlappingFiles.length > 0) reasons.push("files");

    const existingRoadmap = claim.roadmapRef?.trim().toLowerCase() || null;
    if (candRoadmap && existingRoadmap && candRoadmap === existingRoadmap) {
      reasons.push("roadmap_ref");
    }

    if (candTitle && normalizeTitle(claim.title) === candTitle) {
      reasons.push("title");
    }

    if (reasons.length > 0) {
      overlaps.push({
        claimId: claim.id,
        title: claim.title,
        userName: claim.userName,
        userEmail: claim.userEmail,
        status: claim.status,
        reasons,
        overlappingFiles: [...new Set(overlappingFiles)],
      });
    }
  }

  return overlaps;
}

export function parseGitRemoteUrl(remoteUrl: string): string | null {
  try {
    return normalizeRepo(remoteUrl);
  } catch {
    return null;
  }
}
