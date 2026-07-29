import { escapeHtml } from "../html";
import type { BoardClaim } from "@bagsy/shared";

/**
 * Time is rendered so both the scripted and unscripted paths are correct: the
 * relative text is right at render, and the absolute value is one hover away.
 * The island retickers rewrite only the text content, never the datetime.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Compact duration: `41m`, `2h 14m`, `6d 3h`. Never "a few moments ago". */
export function duration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < MIN) return `${Math.max(0, Math.round(abs / 1000))}s`;
  if (abs < HOUR) return `${Math.floor(abs / MIN)}m`;
  if (abs < DAY) {
    const hours = Math.floor(abs / HOUR);
    const mins = Math.floor((abs % HOUR) / MIN);
    return mins ? `${hours}h ${String(mins).padStart(2, "0")}m` : `${hours}h`;
  }
  const days = Math.floor(abs / DAY);
  const hours = Math.floor((abs % DAY) / HOUR);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

export function ago(ms: number): string {
  return `${duration(ms)} ago`;
}

function absolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/**
 * `<time>` carrying both readings. `data-rel` tells the retick island which
 * direction to render, so it never has to guess from the text it is replacing.
 */
export function timeTag(iso: string, now: number, opts?: { suffix?: boolean }): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return `<span class="muted">unknown</span>`;
  const delta = now - parsed;
  const text = opts?.suffix === false ? duration(delta) : ago(delta);
  return `<time datetime="${escapeHtml(iso)}" title="${escapeHtml(absolute(iso))}" data-rel="${opts?.suffix === false ? "plain" : "ago"}">${escapeHtml(text)}</time>`;
}

/** A future deadline: `in 1h 57m`, or `lapsed 12m ago` once it has passed. */
export function untilTag(iso: string, now: number): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return `<span class="muted">unknown</span>`;
  const left = parsed - now;
  const text = left >= 0 ? `in ${duration(left)}` : `lapsed ${duration(-left)} ago`;
  return `<time datetime="${escapeHtml(iso)}" title="${escapeHtml(absolute(iso))}" data-rel="until">${escapeHtml(text)}</time>`;
}

export function claimActor(claim: BoardClaim): string {
  return claim.agentLabel?.trim() || claim.userName?.trim() || claim.userEmail?.trim() || claim.userId;
}

/** The human behind the claim, regardless of which agent ran it. */
export function claimOwner(claim: BoardClaim): string {
  return claim.userName?.trim() || claim.userEmail?.trim() || claim.userId;
}

export function statusBadge(claim: BoardClaim, opts?: { emphasis?: boolean }): string {
  if (claim.status === "stale") {
    const cls = opts?.emphasis ? "badge ok" : "badge mark";
    return `<span class="${cls}">Soft hold</span>`;
  }
  if (claim.status === "planned") return `<span class="badge quiet">Planned</span>`;
  return `<span class="badge">Active</span>`;
}

/**
 * Soft-hold meter. Width is a server-computed integer, never user text, and
 * the label spells the value out for anyone who cannot see the bar.
 */
export function pressureMeter(claim: BoardClaim, softHoldMs: number): string {
  const left = Math.max(0, claim.softHoldLeftMs ?? 0);
  const pct = Math.max(0, Math.min(100, Math.round((left / softHoldMs) * 100)));
  return `<span class="pressure" role="img" aria-label="${escapeHtml(duration(left))} of soft hold left"><i style="width:${pct}%"></i></span>`;
}

/** `11 +3` — declared files, and how many the heartbeat grew into since. */
export function fileCount(claim: BoardClaim): string {
  const total = claim.files.length;
  const synced = (claim.recentEvents ?? []).filter((e) => e.kind === "files_synced").length;
  return synced > 0
    ? `${total} <span class="f-delta">+${synced}</span>`
    : String(total);
}

export function plural(n: number, one: string, many?: string): string {
  return n === 1 ? one : (many ?? `${one}s`);
}

/** Oxford-free list that ends in "and": `rae, mira and jun`. */
export function nameList(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) {
    return `${shown.join(", ")} and ${rest} more`;
  }
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** Build a URL keeping the current query, changing only what is passed. */
export function withParams(
  base: string,
  current: URLSearchParams,
  changes: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

/** A shell-safe `bagsy` argument. Double quotes only — escapeHtml leaves ' alone. */
export function shellArg(value: string): string {
  return /^[A-Za-z0-9._/@:-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
