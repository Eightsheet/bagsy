export type ClaimStatus = "active" | "stale" | "released" | "expired" | "planned";

export interface ClaimInput {
  repo: string;
  branch?: string | null;
  title: string;
  description?: string | null;
  files: string[];
  roadmapRef?: string | null;
  /** Link to a published plan document (e.g. a Shareframe artifact). */
  planUrl?: string | null;
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
  /** Link to a published plan document (e.g. a Shareframe artifact). */
  planUrl: string | null;
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
  /** Newest-last tail of the claim timeline; full log via GET /v1/claims/:id/events. */
  recentEvents?: ClaimEvent[];
  /** Total timeline entries, so callers know a tail was truncated. */
  eventCount?: number;
}

/**
 * Timeline entry on a claim. `note` is agent-written progress; everything else
 * is recorded by the API on state changes, so a claim has a usable history even
 * when nobody writes notes.
 */
export type ClaimEventKind =
  | "claimed"
  | "planned"
  | "started"
  | "note"
  | "files_synced"
  | "stale"
  | "stolen"
  | "released";

export interface ClaimEvent {
  id: string;
  claimId: string;
  kind: ClaimEventKind;
  message: string | null;
  /** Denormalized so the history survives the actor being deleted. */
  actorName: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** Timeline entries kept per claim; older ones are pruned on write. */
export const MAX_CLAIM_EVENTS = 50;
/** Timeline entries embedded in board/status responses. */
export const RECENT_CLAIM_EVENTS = 3;
/**
 * Upper bound for a heartbeat file sync. A working tree dirtier than this is
 * not a claim scope — syncing it would smear the claim over the whole repo.
 */
export const MAX_SYNC_FILES = 100;

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

/** Inclusive 1-based line range within a claimed file. */
export interface LineRange {
  start: number;
  end: number;
}

/** Parsed claim file entry: `src/big.ts:120-240,300` → path + ranges. `ranges: null` = whole file. */
export interface FileClaim {
  path: string;
  ranges: LineRange[] | null;
}

function normalizePathPart(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

const RANGE_SUFFIX = /^(.+?):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;

/** Parse a claim file entry. A `:120-240[,…]` suffix scopes the claim to line ranges. */
export function parseFileClaim(entry: string): FileClaim {
  const m = RANGE_SUFFIX.exec(entry.trim());
  if (!m) return { path: normalizePathPart(entry), ranges: null };
  const ranges = m[2]!.split(",").map((part) => {
    const [a, b] = part.split("-");
    const start = Math.max(1, parseInt(a!, 10));
    const end = b === undefined ? start : Math.max(1, parseInt(b, 10));
    return start <= end ? { start, end } : { start: end, end: start };
  });
  return { path: normalizePathPart(m[1]!), ranges: mergeRanges(ranges) };
}

export function formatFileClaim(fc: FileClaim): string {
  if (!fc.ranges || fc.ranges.length === 0) return fc.path;
  const parts = fc.ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`));
  return `${fc.path}:${parts.join(",")}`;
}

/** Sort and merge overlapping or adjacent ranges. */
export function mergeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: LineRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function rangesIntersect(a: LineRange[], b: LineRange[]): boolean {
  return a.some((x) => b.some((y) => x.start <= y.end && y.start <= x.end));
}

/** Parts of `a` not covered by `b`. */
export function subtractRanges(a: LineRange[], b: LineRange[]): LineRange[] {
  const out: LineRange[] = [];
  for (const r of mergeRanges(a)) {
    let segments: LineRange[] = [{ ...r }];
    for (const cut of b) {
      const next: LineRange[] = [];
      for (const seg of segments) {
        if (cut.end < seg.start || cut.start > seg.end) {
          next.push(seg);
          continue;
        }
        if (cut.start > seg.start) next.push({ start: seg.start, end: cut.start - 1 });
        if (cut.end < seg.end) next.push({ start: cut.end + 1, end: seg.end });
      }
      segments = next;
    }
    out.push(...segments);
  }
  return out;
}

/** Normalize file paths for overlap comparison. Preserves a line-range suffix. */
export function normalizeFilePath(entry: string): string {
  return formatFileClaim(parseFileClaim(entry));
}

/** Canonicalize a claim's file list: one entry per path; whole-file wins over ranges. */
export function mergeFileClaims(entries: string[]): string[] {
  const byPath = new Map<string, LineRange[] | null>();
  for (const entry of entries) {
    const fc = parseFileClaim(entry);
    if (!fc.path) continue;
    const prev = byPath.get(fc.path);
    if (prev === null || !fc.ranges) byPath.set(fc.path, null);
    else byPath.set(fc.path, mergeRanges([...(prev ?? []), ...fc.ranges]));
  }
  return [...byPath.entries()].map(([path, ranges]) => formatFileClaim({ path, ranges }));
}

export interface FileSyncResult {
  files: string[];
  /** Newly covered scope (`path` or `path:ranges`), empty when nothing widened. */
  added: string[];
}

/**
 * Widen a claim's file scope to what the working tree actually touched.
 * New paths join whole-file (ranges are only kept where they were claimed);
 * a range entry grows by the incoming ranges, or to whole-file when the
 * incoming entry carries none.
 */
export function unionFileClaims(existing: string[], incoming: string[]): FileSyncResult {
  const byPath = new Map<string, FileClaim>();
  for (const entry of mergeFileClaims(existing)) {
    const fc = parseFileClaim(entry);
    byPath.set(fc.path, fc);
  }
  const added: string[] = [];
  for (const entry of mergeFileClaims(incoming)) {
    const inc = parseFileClaim(entry);
    if (!inc.path) continue;
    const cur = byPath.get(inc.path);
    if (!cur) {
      byPath.set(inc.path, { path: inc.path, ranges: null });
      added.push(inc.path);
      continue;
    }
    if (!cur.ranges) continue;
    if (!inc.ranges) {
      byPath.set(inc.path, { path: inc.path, ranges: null });
      added.push(inc.path);
      continue;
    }
    const fresh = subtractRanges(inc.ranges, cur.ranges);
    if (fresh.length === 0) continue;
    byPath.set(inc.path, { path: inc.path, ranges: mergeRanges([...cur.ranges, ...inc.ranges]) });
    added.push(formatFileClaim({ path: inc.path, ranges: fresh }));
  }
  return { files: [...byPath.values()].map(formatFileClaim), added };
}

/**
 * New-side line ranges per file from unified diff output (`git diff -U0`).
 * A pure deletion (count 0) still marks the line it happened at.
 */
export function parseUnifiedDiffRanges(raw: string): Map<string, LineRange[]> {
  const out = new Map<string, LineRange[]>();
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      current = p.startsWith("b/") ? p.slice(2) : p === "/dev/null" ? null : p;
      continue;
    }
    if (current === null || !line.startsWith("@@")) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Math.max(1, parseInt(m[1]!, 10));
    const count = m[2] === undefined ? 1 : parseInt(m[2]!, 10);
    const end = Math.max(start, start + count - 1);
    out.set(current, [...(out.get(current) ?? []), { start, end }]);
  }
  return out;
}

export function pathsOverlap(a: string, b: string): boolean {
  const left = parseFileClaim(a);
  const right = parseFileClaim(b);
  if (left.path === right.path) {
    // Same file: whole-file blocks everything; two range claims only clash where they intersect.
    if (!left.ranges || !right.ranges) return true;
    return rangesIntersect(left.ranges, right.ranges);
  }
  // glob-ish: trailing /** or * treated as prefix (ranges are moot across different paths)
  const leftPrefix = left.path.replace(/\*\*?$/, "").replace(/\/$/, "");
  const rightPrefix = right.path.replace(/\*\*?$/, "").replace(/\/$/, "");
  if (left.path.includes("*") && right.path.startsWith(leftPrefix)) return true;
  if (right.path.includes("*") && left.path.startsWith(rightPrefix)) return true;
  if (left.path.startsWith(right.path + "/") || right.path.startsWith(left.path + "/")) return true;
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
