import {
  MAX_CLAIM_EVENTS,
  MAX_SYNC_FILES,
  normalizeFilePath,
  type BoardClaim,
  type ClaimEvent,
  type OrgBoard,
} from "@bagsy/shared";
import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html";
import { releaseActions, softHoldActions, startActions } from "../board/actions";
import {
  claimActor,
  claimOwner,
  duration,
  plural,
  statusBadge,
  timeTag,
  untilTag,
} from "../board/format";

/**
 * One claim, in full. The only URL you can paste into a chat and have the other
 * person see exactly what you saw — which, with no ping primitive in the
 * product, is how a collision actually gets resolved.
 */

const EVENT_LABEL: Record<string, string> = {
  claimed: "Claimed",
  planned: "Queued",
  started: "Started",
  note: "Note",
  files_synced: "Files",
  stale: "Soft hold",
  stolen: "Freed",
  released: "Released",
};

/** The status alone is never the answer, so it is written as a sentence. */
function statusLine(claim: BoardClaim, blockers: BoardClaim[], now: number): string {
  switch (claim.status) {
    case "active":
      return `Active. Heartbeat ${timeTag(claim.updatedAt, now)}, TTL lapses ${untilTag(claim.expiresAt, now)}.`;
    case "stale":
      return blockers.length > 0
        ? `Soft hold. TTL missed ${untilTag(claim.expiresAt, now)}; frees itself in ${escapeHtml(duration(Math.max(0, claim.softHoldLeftMs ?? 0)))}, and ${blockers.length} live ${plural(blockers.length, "claim")} ${blockers.length === 1 ? "is" : "are"} waiting on it.`
        : `Soft hold. Nothing overlaps it, so it frees itself in ${escapeHtml(duration(Math.max(0, claim.softHoldLeftMs ?? 0)))} with no decision from anyone.`;
    case "planned":
      return `Queued ${timeTag(claim.startedAt, now)} by ${escapeHtml(claimOwner(claim))}. Nobody has started it.`;
    case "released":
      return `Released${claim.resolvedRef ? ` → ${escapeHtml(claim.resolvedRef)}` : ""}.`;
    default:
      return `Expired.`;
  }
}

function timeline(events: ClaimEvent[], eventCount: number, now: number): string {
  if (events.length === 0) {
    return `<p class="empty">Nothing recorded yet.</p>`;
  }
  const rows = events
    .map(
      (event) => `
      <li class="${escapeHtml(event.kind)}">
        ${timeTag(event.createdAt, now)}
        <span class="kind">${escapeHtml(EVENT_LABEL[event.kind] ?? event.kind)}</span>
        <span class="msg">${
          event.message ? escapeHtml(event.message) : `<span class="muted">—</span>`
        }${event.actorName ? ` <span class="muted">· ${escapeHtml(event.actorName)}</span>` : ""}</span>
      </li>`,
    )
    .join("");

  return `
    <ul class="timeline">${rows}</ul>
    <p class="tail">Timeline keeps the last ${MAX_CLAIM_EVENTS} entries. Earlier ones are deleted, not archived.${
      eventCount >= MAX_CLAIM_EVENTS
        ? ` This claim is at the cap — anything before ${escapeHtml(new Date(events[0]!.createdAt).toISOString().slice(11, 16))} UTC is gone.`
        : ""
    }</p>`;
}

export function claimPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  claim: BoardClaim;
  events: ClaimEvent[];
  eventCount: number;
  own: boolean;
  board: OrgBoard;
  now: number;
  flash?: string | null;
  error?: string | null;
  preview?: boolean;
}): string {
  const { user, org, orgs, claim, board, now } = opts;

  const edges = board.collisions.filter((e) => e.a === claim.id || e.b === claim.id);
  const partnerIds = edges.map((e) => (e.a === claim.id ? e.b : e.a));
  const partners = board.claims.filter((c) => partnerIds.includes(c.id));
  const blockers = partners.filter((c) => c.status === "active" || c.status === "planned");
  const sharedPaths = new Set(edges.flatMap((e) => e.files).map(normalizeFilePath));

  const actions = opts.own
    ? claim.status === "planned"
      ? `<p class="muted">This is yours and still queued. Start it from a clone so something is heartbeating it:</p><code class="cmd">bagsy start ${escapeHtml(claim.id)}</code>`
      : releaseActions(claim)
    : claim.status === "stale"
      ? softHoldActions(claim)
      : claim.status === "planned"
        ? startActions(claim)
        : `<p class="muted">Only ${escapeHtml(claimOwner(claim))} can release this. Admins included — there is no override.</p>`;

  const filesAtCap = claim.files.length >= MAX_SYNC_FILES;

  const body = `
    ${topbar({ user, org, orgs, section: "board" })}
    ${opts.preview ? `<p class="warn">Preview — synthetic data. Nothing here is real.</p>` : ""}
    <p class="crumb"><a href="/">Board</a> / <a href="/board?repo=${encodeURIComponent(claim.repo)}">${escapeHtml(claim.repo)}</a> / ${escapeHtml(claim.id)}</p>
    <div class="page-header">
      <h1>${escapeHtml(claim.title)}</h1>
      <p class="meta">${statusBadge(claim)} ${escapeHtml(claimOwner(claim))} · ${
        claim.agentLabel
          ? `agent <code>${escapeHtml(claim.agentLabel)}</code>`
          : `<span class="muted">no agent label</span>`
      }${claim.branch ? ` · branch <code>${escapeHtml(claim.branch)}</code>` : ""}${
        claim.roadmapRef ? ` · <code>${escapeHtml(claim.roadmapRef)}</code>` : ""
      }</p>
    </div>
    ${opts.flash ? `<p class="ok">${escapeHtml(opts.flash)}</p>` : ""}
    ${opts.error ? `<p class="warn">${escapeHtml(opts.error)}</p>` : ""}
    <p class="lede">${statusLine(claim, blockers, now)}</p>
    ${
      !claim.agentLabel
        ? `<p class="muted">No agent label. Whoever ran this did not pass <code>--agent</code>.</p>`
        : ""
    }

    ${
      partners.length > 0
        ? `<section class="panel">
             <h2>Overlaps</h2>
             <ul class="list">
               ${partners
                 .map((p) => {
                   const edge = edges.find((e) => e.a === p.id || e.b === p.id)!;
                   return `<li>
                     <span>
                       <a href="/claims/${escapeHtml(p.id)}">${escapeHtml(p.title)}</a>
                       <span class="muted" style="display:block;font-size:0.85rem">${escapeHtml(claimOwner(p))} · ${escapeHtml(p.repo)} · ${escapeHtml(edge.reasons.join(", ").replace("roadmap_ref", "roadmap ref"))}</span>
                     </span>
                     ${statusBadge(p)}
                   </li>`;
                 })
                 .join("")}
             </ul>
             ${
               edges.some((e) => e.files.length > 0)
                 ? `<p class="muted">Prefix matches print both sides — a directory claim and a file inside it are the same contention.</p>`
                 : ""
             }
           </section>`
        : ""
    }

    ${
      claim.description
        ? `<section class="panel"><h2>Context</h2><p>${escapeHtml(claim.description)}</p></section>`
        : ""
    }

    <section class="panel">
      <h2>Files</h2>
      ${
        claim.files.length === 0
          ? `<p class="empty">No files declared. Nothing about this claim can collide on paths — only its title and roadmap ref.</p>`
          : `<ul class="files">${claim.files
              .map(
                (f) =>
                  `<li${sharedPaths.has(normalizeFilePath(f)) ? ' class="shared"' : ""}>${escapeHtml(f)}</li>`,
              )
              .join("")}</ul>
             <p class="tail">${claim.files.length} ${plural(claim.files.length, "file")}${
               filesAtCap
                 ? ` · sync stopped at the ${MAX_SYNC_FILES}-file limit, so this list no longer tracks the working tree`
                 : ""
             }${sharedPaths.size > 0 ? ` · ‡ marks a path another claim also holds` : ""}</p>`
      }
    </section>

    <section class="panel">
      <h2>Timeline</h2>
      ${timeline(opts.events, opts.eventCount, now)}
      ${
        claim.status === "stale"
          ? `<p class="tail">Nothing recorded since — a soft hold that runs out leaves no entry.</p>`
          : ""
      }
    </section>

    <section class="panel">
      <h2>Actions</h2>
      ${actions}
    </section>
  `;

  return layout(claim.title, body);
}

/** A 404 that says what is actually true, rather than a bare status code. */
export function claimMissingPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  claimId: string;
  preview?: boolean;
}): string {
  const body = `
    ${topbar({ user: opts.user, org: opts.org, orgs: opts.orgs, section: "board" })}
    <div class="page-header"><h1>No such claim</h1></div>
    <p class="lede">No claim <code>${escapeHtml(opts.claimId)}</code> on this team’s board.</p>
    <p class="muted">Released and expired claims are not listed anywhere yet — if this one finished, its URL stops resolving.</p>
    <p><a href="/">Back to the board</a></p>
  `;
  return layout("No such claim", body);
}
