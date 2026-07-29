import type { BoardClaim, OrgBoard } from "@bagsy/shared";
import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html";
import { claimOwner, plural, timeTag } from "../board/format";

/**
 * Follow-ups — the planned queue.
 *
 * Grouped by the only property that matters when you are looking at it: can I
 * start this right now. A queue sorted by age tells you what is oldest; this
 * one tells you what you can actually pick up, and for everything else, what it
 * is waiting on.
 */

interface Bucket {
  claims: BoardClaim[];
  blockedBy: Map<string, BoardClaim[]>;
}

function bucketQueue(board: OrgBoard): {
  startable: BoardClaim[];
  waiting: Bucket;
  held: Bucket;
} {
  const byId = new Map(board.claims.map((c) => [c.id, c]));
  const planned = board.claims.filter((c) => c.status === "planned");

  const blockersOf = new Map<string, BoardClaim[]>();
  for (const edge of board.collisions) {
    for (const [self, other] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const) {
      const claim = byId.get(self);
      const partner = byId.get(other);
      if (!claim || !partner || claim.status !== "planned") continue;
      if (partner.status !== "active" && partner.status !== "stale") continue;
      const bucket = blockersOf.get(self) ?? [];
      bucket.push(partner);
      blockersOf.set(self, bucket);
    }
  }

  const startable: BoardClaim[] = [];
  const waiting: Bucket = { claims: [], blockedBy: new Map() };
  const held: Bucket = { claims: [], blockedBy: new Map() };

  for (const claim of planned) {
    const blockers = blockersOf.get(claim.id) ?? [];
    if (blockers.length === 0) {
      startable.push(claim);
    } else if (blockers.some((b) => b.status === "stale")) {
      // A queue item stuck behind a dead agent is not waiting on work — it is
      // waiting on a decision that already has its own place on the board.
      held.claims.push(claim);
      held.blockedBy.set(claim.id, blockers);
    } else {
      waiting.claims.push(claim);
      waiting.blockedBy.set(claim.id, blockers);
    }
  }

  const byAge = (a: BoardClaim, b: BoardClaim) =>
    (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0);
  startable.sort(byAge);
  waiting.claims.sort(byAge);
  held.claims.sort(byAge);
  return { startable, waiting, held };
}

function row(claim: BoardClaim, now: number, trailing: string): string {
  return `
    <li>
      <span>
        <a href="/claims/${escapeHtml(claim.id)}">${escapeHtml(claim.title)}</a>
        <span class="muted" style="display:block;font-size:0.85rem">${escapeHtml(claim.repo)} · queued ${timeTag(claim.startedAt, now)} by ${escapeHtml(claimOwner(claim))}${
          claim.files.length ? ` · ${claim.files.length} ${plural(claim.files.length, "file")}` : ""
        }</span>
      </span>
      <span>${trailing}</span>
    </li>`;
}

export function queuePage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  board: OrgBoard;
  now: number;
  flash?: string | null;
  error?: string | null;
  preview?: boolean;
}): string {
  const { user, org, orgs, board, now } = opts;
  const { startable, waiting, held } = bucketQueue(board);
  const total = startable.length + waiting.claims.length + held.claims.length;

  const empty = `
    <section class="panel">
      <h2>Follow-ups</h2>
      <p class="empty">No follow-ups. Queue one from a clone with <code class="cmd">bagsy plan -t "Title" -f path/file.ts</code></p>
      <p class="tail">Queued intent never blocks anyone and has no deadline — it is the list an idle agent picks from.</p>
    </section>`;

  const body = `
    ${topbar({ user, org, orgs, section: "queue" })}
    ${opts.preview ? `<p class="warn">Preview — synthetic data. Nothing here is real.</p>` : ""}
    <p class="lede"><strong>${total === 0 ? "No follow-ups." : `${total} ${plural(total, "follow-up")}.`}</strong> ${
      total === 0
        ? "Queued intent never blocks anyone and has no deadline."
        : `${startable.length} startable right now. Any teammate can pick one up — starting a queued claim reassigns it.`
    }</p>
    ${opts.flash ? `<p class="ok">${escapeHtml(opts.flash)}</p>` : ""}
    ${opts.error ? `<p class="warn">${escapeHtml(opts.error)}</p>` : ""}
    ${
      total === 0
        ? empty
        : `
      <section class="panel" id="startable">
        <h2>Startable now (${startable.length})</h2>
        ${
          startable.length === 0
            ? `<p class="empty">Every follow-up overlaps something live. They unblock themselves as those claims finish.</p>`
            : `<ul class="list">${startable
                .map((c) => row(c, now, `<code class="cmd quiet">bagsy start ${escapeHtml(c.id)}</code>`))
                .join("")}</ul>`
        }
      </section>

      ${
        waiting.claims.length > 0
          ? `<section class="panel">
               <h2>Waiting on live work (${waiting.claims.length})</h2>
               <p class="panel-desc">Someone is actively in these files. Starting now would collide.</p>
               <ul class="list">${waiting.claims
                 .map((c) => {
                   const blockers = waiting.blockedBy.get(c.id) ?? [];
                   const names = [...new Set(blockers.map(claimOwner))].join(", ");
                   return row(
                     c,
                     now,
                     `<span class="muted">${escapeHtml(names)}</span>`,
                   );
                 })
                 .join("")}</ul>
             </section>`
          : ""
      }

      ${
        held.claims.length > 0
          ? `<section class="panel">
               <h2>Blocked by a soft hold (${held.claims.length})</h2>
               <p class="panel-desc">A stopped agent is holding these files. That decision is on the <a href="/">board</a>.</p>
               <ul class="list">${held.claims
                 .map((c) => {
                   const hold = (held.blockedBy.get(c.id) ?? []).find((b) => b.status === "stale");
                   return row(
                     c,
                     now,
                     hold
                       ? `<a href="/claims/${escapeHtml(hold.id)}">the hold →</a>`
                       : `<span class="muted">held</span>`,
                   );
                 })
                 .join("")}</ul>
             </section>`
          : ""
      }
    `
    }
  `;

  return layout("Follow-ups", body, {
    skipTo: { id: "startable", label: "Skip to startable follow-ups" },
  });
}
