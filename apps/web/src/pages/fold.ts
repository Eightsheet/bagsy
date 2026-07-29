import {
  SOFT_HOLD_SECONDS,
  type BoardClaim,
  type OrgBoard,
} from "@bagsy/shared";
import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html";
import { pathsToPaste, softHoldActions } from "../board/actions";
import {
  ago,
  claimActor,
  claimOwner,
  duration,
  nameList,
  plural,
  pressureMeter,
  statusBadge,
  timeTag,
  untilTag,
} from "../board/format";
import { foldIslands } from "../board/islands";
import { FINDING_LABEL, rankFold, type Finding, type FoldResult } from "../board/rank";
import { agateTable, parseBoardQuery, sortClaims } from "./board";

/**
 * The fold: what needs a person, ranked, capped at five.
 *
 * Its length is a function of how many decisions exist, never of how many
 * claims exist — at 214 healthy claims it renders six elements and zero rows,
 * and that property is the entire point. It will lose every screenshot
 * comparison against a dense dashboard with a sparkline. That is the design
 * working.
 */

/** Below this many live claims, triage-first is over-built and the table is inlined. */
const SMALL_BOARD = 12;

const SOFT_HOLD_MS = SOFT_HOLD_SECONDS * 1000;

function claimLine(claim: BoardClaim): string {
  const parts = [
    `<a href="/claims/${escapeHtml(claim.id)}"><code>${escapeHtml(claim.id)}</code></a>`,
    escapeHtml(claimOwner(claim)),
    claim.agentLabel
      ? `agent <code>${escapeHtml(claim.agentLabel)}</code>`
      : `<span class="muted">unlabeled agent</span>`,
    `<code>${escapeHtml(claim.repo)}</code>`,
  ];
  if (claim.branch) parts.push(`branch <code>${escapeHtml(claim.branch)}</code>`);
  return parts.join(" · ");
}

function sharedFilesLine(files: string[]): string {
  if (files.length === 0) return "";
  const shown = files.slice(0, 3).map((f) => `<code>${escapeHtml(f)}</code>`);
  const rest = files.length - shown.length;
  return `<p class="finding-facts">${shown.join(" · ")}${rest > 0 ? ` <span class="muted">and ${rest} more</span>` : ""}</p>`;
}

/** The last thing the agent said, verbatim and with its age — the tell for local WIP. */
function lastNote(claim: BoardClaim, now: number): string {
  const note = [...(claim.recentEvents ?? [])].reverse().find((e) => e.kind === "note");
  if (!note?.message) return "";
  return `<p class="dict">${timeTag(note.createdAt, now)} — ${escapeHtml(claimActor(claim))}: “${escapeHtml(note.message)}”</p>`;
}

/**
 * Who started first, and by how much — the one sentence that decides a
 * contested pair. When the evidence has been pruned out of `recentEvents` it is
 * worded as an inference, because being confidently wrong about who should back
 * off is worse than saying less.
 */
function whoWasFirst(a: BoardClaim, b: BoardClaim): string {
  const startA = Date.parse(a.startedAt) || 0;
  const startB = Date.parse(b.startedAt) || 0;
  const [first, second] = startA <= startB ? [a, b] : [b, a];
  const gap = Math.abs(startA - startB);

  if (gap < 60_000) return `Both started within a minute of each other.`;

  const grew = [...(second.recentEvents ?? [])]
    .reverse()
    .find((e) => e.kind === "files_synced");
  if (grew) {
    return `${escapeHtml(claimOwner(first))} claimed these files ${escapeHtml(duration(gap))} first. ${escapeHtml(claimOwner(second))}’s agent grew into them ${escapeHtml(ago(Date.now() - (Date.parse(grew.createdAt) || Date.now())))}.`;
  }
  return `${escapeHtml(claimOwner(first))}’s claim is older by ${escapeHtml(duration(gap))}. No file-sync record survives for either side, so this is inferred from start times.`;
}

function versus(a: BoardClaim, b: BoardClaim, now: number): string {
  const side = (claim: BoardClaim) => `
      <div>
        <h4>${escapeHtml(claim.title)}</h4>
        <p>${claimLine(claim)}</p>
        <p>${statusBadge(claim)} ${claim.status === "planned" ? "queued" : `started ${timeTag(claim.startedAt, now)}`}</p>
      </div>`;
  return `<div class="versus">${side(a)}${side(b)}</div>`;
}

function findingBody(finding: Finding, now: number): string {
  const [a, b] = finding.claims;

  switch (finding.kind) {
    case "soft_hold": {
      const claim = a!;
      const blockerNames = finding.blockers.map(claimOwner);
      const queued = finding.blockers.filter((c) => c.status === "planned").length;
      const live = finding.blockers.length - queued;
      const consequence =
        live > 0 && queued > 0
          ? `Blocks ${live} live ${plural(live, "claim")} (${escapeHtml(nameList(blockerNames))}) and ${queued} queued ${plural(queued, "item")}`
          : live > 0
            ? `Blocks ${live} live ${plural(live, "claim")} (${escapeHtml(nameList(blockerNames))})`
            : `Blocks ${queued} queued ${plural(queued, "item")}`;
      // No shared paths means the block runs through a shared title or roadmap
      // ref. Printing "0 shared paths" would read as a bug in the detector.
      const via =
        finding.sharedFiles.length > 0
          ? ` — ${finding.sharedFiles.length} shared ${plural(finding.sharedFiles.length, "path")}.`
          : ` — no shared files; they match on title or roadmap ref.`;
      return `
        <h3>${escapeHtml(claim.title)}</h3>
        <p class="finding-facts">${claimLine(claim)}</p>
        <p class="finding-facts">TTL missed ${timeTag(claim.expiresAt, now)} · last heartbeat ${timeTag(claim.updatedAt, now)} · ${claim.files.length} ${plural(claim.files.length, "file")}</p>
        <p class="finding-consequence">${consequence}${via}</p>
        ${sharedFilesLine(finding.sharedFiles)}
        ${lastNote(claim, now)}
        ${softHoldActions(claim)}`;
    }

    case "your_agent_stopped": {
      const claim = a!;
      return `
        <h3>${escapeHtml(claim.title)}</h3>
        <p class="finding-facts">${claimLine(claim)}</p>
        <p class="finding-consequence">Nothing overlaps it, so it frees itself ${untilTag(new Date(now + (claim.softHoldLeftMs ?? 0)).toISOString(), now)} with no decision from anyone.</p>
        ${lastNote(claim, now)}
        ${softHoldActions(claim, { compact: true })}`;
    }

    case "same_work": {
      const sameRepo = a && b && a.repo === b.repo;
      const viaRoadmap = a?.roadmapRef && b?.roadmapRef && a.roadmapRef === b.roadmapRef;
      const explain = viaRoadmap
        ? sameRepo
          ? `Same roadmap ref <code>${escapeHtml(a!.roadmapRef!)}</code>, same repo.`
          : `Different repos, no shared files — only the roadmap ref <code>${escapeHtml(a!.roadmapRef!)}</code> matches. One of these is probably the wrong repo.`
        : `Identical titles in the same repo. Two agents are about to write the same commit.`;
      return `
        <h3>${escapeHtml(a?.title ?? "")}</h3>
        <p class="finding-consequence">${explain}</p>
        ${a && b ? versus(a, b, now) : ""}
        ${finding.extraMembers > 0 ? `<p class="muted">${finding.extraMembers} more ${plural(finding.extraMembers, "claim")} in the same group.</p>` : ""}
        ${sharedFilesLine(finding.sharedFiles)}`;
    }

    case "contested": {
      if (!a || !b) return "";
      return `
        <h3>${escapeHtml(a.title)}</h3>
        <p class="finding-consequence">${whoWasFirst(a, b)}</p>
        ${versus(a, b, now)}
        ${finding.extraMembers > 0 ? `<p class="muted">${finding.extraMembers} more ${plural(finding.extraMembers, "claim")} overlap the same files.</p>` : ""}
        ${sharedFilesLine(finding.sharedFiles)}
        ${pathsToPaste(finding.sharedFiles)}`;
    }

    case "starving": {
      const claim = a!;
      return `
        <h3>${escapeHtml(claim.title)}</h3>
        <p class="finding-facts">${claimLine(claim)}</p>
        <p class="finding-consequence">Queued ${timeTag(claim.startedAt, now)} by ${escapeHtml(claimOwner(claim))}. Nobody has started it. Startable now — nothing live overlaps these files.</p>
        <code class="cmd quiet">bagsy start ${escapeHtml(claim.id)}</code>`;
    }

    case "hot_path": {
      const hot = finding.hotPath!;
      return `
        <h3><code>${escapeHtml(hot.path)}</code></h3>
        <p class="finding-consequence"><code>${escapeHtml(hot.path)}</code> is in ${hot.holders} claims across ${hot.repos.length} ${plural(hot.repos.length, "repo")}. Every pair of them counts as an overlap, so they are ranked out of this list rather than shown ${Math.round((hot.holders * (hot.holders - 1)) / 2)} times.</p>
        <p class="finding-actions"><a href="/board?path=${encodeURIComponent(hot.path)}">See who has it →</a></p>`;
    }

    case "title_echo": {
      return `
        <h3>Repeated titles across repos</h3>
        <p class="finding-consequence">${finding.extraMembers + finding.claims.length} live claims share a title with a claim in another repo, with no shared files and no shared roadmap ref. Usually that is a chore named the same way twice, not duplicated work.</p>
        <p class="finding-actions"><a href="/board?find=collision">List them →</a></p>`;
    }

    default:
      return "";
  }
}

function renderFinding(finding: Finding, index: number, now: number): string {
  const claim = finding.claims[0];
  const meter =
    finding.kind === "soft_hold" || finding.kind === "your_agent_stopped"
      ? `${pressureMeter(claim!, SOFT_HOLD_MS)} <span class="muted">${escapeHtml(duration(Math.max(0, claim!.softHoldLeftMs ?? 0)))} of soft hold left</span>`
      : "";
  const emphasis = finding.kind === "soft_hold";
  return `
    <li class="finding${index === 0 ? " lead" : ""}">
      <div class="finding-kind">
        <span class="badge${emphasis ? " ok" : " mark"}">${escapeHtml(FINDING_LABEL[finding.kind])}</span>
        ${finding.isNew ? `<span class="new-mark">New</span>` : ""}
        ${meter}
      </div>
      ${findingBody(finding, now)}
    </li>`;
}

/** One sentence for the whole board, opening with a bolded label. */
function lede(board: OrgBoard, fold: FoldResult, repoCount: number, newSince: string | null): string {
  const { active, stale, planned } = board.counts;
  const live = active + stale;

  if (repoCount === 0) {
    return `<p class="lede"><strong>Board.</strong> No repos on this team yet.</p>`;
  }
  if (live === 0 && planned === 0) {
    return `<p class="lede"><strong>Board.</strong> Nothing claimed on ${repoCount} ${plural(repoCount, "repo")}.</p>`;
  }

  // A team that habitually runs a wall of soft holds would turn the fold into a
  // wall too, and the alarm would die. Name the real problem instead.
  if (stale >= 6 && stale > active / 3) {
    return `<p class="lede"><strong>${stale} soft holds of ${live} live claims.</strong> That ratio usually means agents are not heartbeating, not that ${stale} of them died. Check that <code>bagsy heartbeat</code> is running.</p>`;
  }

  if (fold.total === 0) {
    return `<p class="lede"><strong>Clear.</strong> ${live} ${plural(live, "claim")} across ${repoCount} ${plural(repoCount, "repo")}, nothing needs you.</p>`;
  }

  const label =
    fold.total > fold.shown
      ? `${fold.shown} decisions of ${fold.total}.`
      : `${fold.total} ${plural(fold.total, "decision")}.`;
  const delta =
    fold.newCount > 0 && newSince
      ? ` ${fold.newCount} new since ${escapeHtml(newSince)}.`
      : "";
  const kinds = [...new Set(fold.findings.map((f) => FINDING_LABEL[f.kind].toLowerCase()))];
  const named = nameList(kinds);
  const sentence = named ? `${named.charAt(0).toUpperCase()}${named.slice(1)}, ranked` : "Ranked";
  return `<p class="lede"><strong>${label}</strong>${delta} ${escapeHtml(sentence)} by how soon each becomes irreversible.</p>`;
}

function decisionsPanel(fold: FoldResult, board: OrgBoard, now: number): string {
  if (fold.findings.length === 0) {
    const anything = board.counts.active + board.counts.stale + board.counts.planned > 0;
    return `
      <section class="panel" id="decisions">
        <h2>Decisions</h2>
        ${
          anything
            ? `<p class="empty">No collisions, no soft holds anyone is waiting on, no starving follow-ups.</p>`
            : `<p class="empty">Nothing needs a decision. Nothing is claimed yet — start one from a clone:<br /><code class="cmd">bagsy claim -t "Title" -f path/file.ts</code></p>`
        }
        <p class="tail">A collision stays here until it resolves — there is no way to mark one as “agreed” yet.</p>
      </section>`;
  }

  const tail =
    fold.dropped.length > 0
      ? `<p class="tail">${fold.total - fold.shown} more ${plural(fold.total - fold.shown, "decision")}: ${escapeHtml(
          fold.dropped
            .map((d) => `${d.count} ${FINDING_LABEL[d.kind].toLowerCase()}${d.count === 1 ? "" : "s"}`)
            .join(", "),
        )}. <a href="/board?find=decisions">All decisions →</a></p>`
      : `<p class="tail">Nothing else needs a decision. ${fold.healthy} other ${plural(fold.healthy, "claim")} ${fold.healthy === 1 ? "is" : "are"} healthy.</p>`;

  return `
    <section class="panel" id="decisions">
      <h2>Decisions</h2>
      ${
        board.collisionsTruncated
          ? `<p class="warn">The board is too tangled to enumerate — showing the worst clusters of at least 4,000 overlapping pairs. That usually means a directory is claimed by dozens of agents.</p>`
          : ""
      }
      <ol class="fold">${fold.findings.map((f, i) => renderFinding(f, i, now)).join("")}</ol>
      ${tail}
      <p class="tail">A collision stays here until it resolves — there is no way to mark one as “agreed” yet.</p>
    </section>`;
}

function youPanel(board: OrgBoard, meUserId: string, now: number): string {
  const mine = board.claims.filter((c) => c.userId === meUserId);
  if (mine.length === 0) {
    return `
      <section class="panel">
        <h2>You</h2>
        <p class="empty">Nothing claimed by you. Claim from a clone: <code class="cmd">bagsy claim -t "Title" -f path/file.ts</code></p>
      </section>`;
  }
  const active = mine.filter((c) => c.status === "active");
  const stale = mine.filter((c) => c.status === "stale");
  const planned = mine.filter((c) => c.status === "planned");
  const next = [...active].sort(
    (a, b) => (a.expiresInMs ?? Infinity) - (b.expiresInMs ?? Infinity),
  )[0];

  const bits = [
    `${active.length} active`,
    stale.length ? `${stale.length} soft ${plural(stale.length, "hold")}` : null,
    planned.length ? `${planned.length} queued` : null,
  ].filter(Boolean);

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>You</h2>
        <a href="/board?who=me">Yours →</a>
      </div>
      <p>${bits.join(" · ")}.${
        next
          ? ` Next TTL lapses ${untilTag(next.expiresAt, now)} (<a href="/claims/${escapeHtml(next.id)}"><code>${escapeHtml(next.id)}</code></a>).`
          : ""
      }</p>
    </section>`;
}

function reposPanel(board: OrgBoard): string {
  const zero = `<span class="muted">·</span>`;
  const cell = (n: number) => (n === 0 ? zero : String(n));
  const busy = board.repos.filter((r) => r.active + r.stale + r.planned > 0);
  const quiet = board.repos.filter((r) => r.active + r.stale + r.planned === 0);

  const rows = (list: typeof board.repos) =>
    list
      .map(
        (r) => `
        <tr>
          <td><a href="/board?repo=${encodeURIComponent(r.repo)}"><code>${escapeHtml(r.repo)}</code></a></td>
          <td>${cell(r.active)}</td>
          <td>${cell(r.stale)}</td>
          <td>${cell(r.planned)}</td>
          <td>${cell(r.contended)}</td>
        </tr>`,
      )
      .join("");

  const totals = board.repos.reduce(
    (acc, r) => ({
      active: acc.active + r.active,
      stale: acc.stale + r.stale,
      planned: acc.planned + r.planned,
      contended: acc.contended + r.contended,
    }),
    { active: 0, stale: 0, planned: 0, contended: 0 },
  );

  return `
    <section class="panel">
      <h2>Repos</h2>
      <table class="standings">
        <thead>
          <tr><th scope="col">Repo</th><th scope="col">Active</th><th scope="col">Hold</th><th scope="col">Queued</th><th scope="col">Contended</th></tr>
        </thead>
        <tbody>${rows(busy)}</tbody>
        <tfoot>
          <tr><td>${board.repos.length} ${plural(board.repos.length, "repo")}</td><td>${cell(totals.active)}</td><td>${cell(totals.stale)}</td><td>${cell(totals.planned)}</td><td>${cell(totals.contended)}</td></tr>
        </tfoot>
      </table>
      ${
        quiet.length > 0
          ? `<details class="quiet-details">
               <summary>${quiet.length} quiet ${plural(quiet.length, "repo")}</summary>
               <p class="muted">Linked and watched — nothing claimed on ${quiet.length === 1 ? "it" : "them"}.</p>
               <table class="standings"><tbody>${rows(quiet)}</tbody></table>
             </details>`
          : ""
      }
    </section>`;
}

function queuePanel(board: OrgBoard, now: number): string {
  const planned = board.claims.filter((c) => c.status === "planned");
  if (planned.length === 0) {
    return `
      <section class="panel">
        <h2>Follow-ups</h2>
        <p class="empty">No follow-ups. Queue one from a clone with <code class="cmd">bagsy plan -t "Title" -f path/file.ts</code></p>
      </section>`;
  }

  const liveIds = new Set(
    board.claims.filter((c) => c.status === "active" || c.status === "stale").map((c) => c.id),
  );
  const blocked = new Set(
    board.collisions
      .filter((e) => liveIds.has(e.a) || liveIds.has(e.b))
      .flatMap((e) => [e.a, e.b])
      .filter((id) => !liveIds.has(id)),
  );
  const startable = planned.filter((c) => !blocked.has(c.id));
  const oldest = [...startable].sort(
    (a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0),
  )[0];

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Follow-ups</h2>
        <a href="/queue">All follow-ups →</a>
      </div>
      <p>${planned.length} ${plural(planned.length, "follow-up")} · ${startable.length} startable now${
        oldest
          ? ` · oldest queued ${timeTag(oldest.startedAt, now)}`
          : ""
      }.</p>
      ${
        oldest
          ? `<p><a href="/claims/${escapeHtml(oldest.id)}">${escapeHtml(oldest.title)}</a> <span class="muted">${escapeHtml(oldest.repo)}</span></p>
             <code class="cmd quiet">bagsy start ${escapeHtml(oldest.id)}</code>`
          : `<p class="muted">Every follow-up overlaps something live. They unblock themselves as those claims finish.</p>`
      }
    </section>`;
}

export function foldPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  board: OrgBoard;
  seenAt: number;
  now: number;
  flash?: string | null;
  error?: string | null;
  preview?: boolean;
}): string {
  const { user, org, orgs, board, seenAt, now, flash, error } = opts;

  const fold = rankFold({ board, meUserId: user.id, seenAt, now });
  const live = board.counts.active + board.counts.stale;
  const small = live > 0 && live <= SMALL_BOARD;
  const newSince =
    seenAt > 0 ? new Date(seenAt).toISOString().slice(11, 16) + " UTC" : null;

  const notices = `
    ${flash ? `<p class="ok">${escapeHtml(flash)}</p>` : ""}
    ${error ? `<p class="warn">${escapeHtml(error)}</p>` : ""}
  `;

  const noRepos = board.repos.length === 0;

  const body = `
    ${topbar({ user, org, orgs, section: "board" })}
    ${
      opts.preview
        ? `<p class="warn">Preview — synthetic data, generated in the browser worker. Nothing here is real.</p>`
        : ""
    }
    <p class="stale-bar" id="stale-bar" role="status" aria-live="polite" hidden>
      <span data-stale-text></span>
      <a href="" data-stale-reload>Reload</a>
    </p>
    ${lede(board, fold, board.repos.length, newSince)}
    ${notices}
    ${
      noRepos
        ? `<section class="panel"><h2>Decisions</h2>
             <p class="empty">No repos on this team yet. Link one in <a href="/setup">Setup</a>, or run <code>bagsy link-repo</code> from a clone.</p>
           </section>`
        : `
      ${decisionsPanel(fold, board, now)}
      ${youPanel(board, user.id, now)}
      ${
        small
          ? `<section class="panel"><h2>All claims</h2>${agateTable({
              claims: sortClaims(
                board.claims,
                parseBoardQuery(new URLSearchParams()),
                new Set(board.collisions.flatMap((e) => [e.a, e.b])),
              ),
              board,
              now,
              group: "repo",
            })}</section>`
          : `${reposPanel(board)}${queuePanel(board, now)}`
      }
      <p class="tail">Statuses refresh when someone reads the board — nothing runs on a timer. Board read ${timeTag(board.generatedAt, now)}.</p>
    `
    }
  `;

  return layout("Board", body, {
    skipTo: { id: "decisions", label: "Skip to decisions" },
    islands: foldIslands(),
  });
}
