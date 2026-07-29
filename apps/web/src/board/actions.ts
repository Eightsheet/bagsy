import { SOFT_HOLD_SECONDS, type BoardClaim } from "@bagsy/shared";
import { escapeHtml } from "../html";
import { claimOwner, duration, plural, shellArg } from "./format";

/**
 * The three things a browser can do to a claim, and the copy that gates them.
 *
 * Rendered identically wherever they occur — the fold, the table's detail link,
 * the claim page — because one decision must not be worded three ways. Every
 * action carries its CLI equivalent underneath: the board is where you decide,
 * the terminal is where you act.
 *
 * All attributes use double quotes. `escapeHtml` deliberately does not escape
 * `'`, so a single-quoted attribute holding a claim title would be injectable.
 */

/** Above this much soft hold left, the agent plausibly still lives — type to confirm. */
export const TYPED_CONFIRM_ABOVE_MS = (SOFT_HOLD_SECONDS * 1000) / 2;

export function needsTypedConfirm(claim: BoardClaim): boolean {
  return (claim.softHoldLeftMs ?? 0) > TYPED_CONFIRM_ABOVE_MS;
}

export function confirmPhrase(claim: BoardClaim): string {
  return `free ${claim.id}`;
}

function endsAt(claim: BoardClaim): string {
  const left = claim.softHoldLeftMs ?? 0;
  return duration(Math.max(0, left));
}

/** The pre-filled command that takes the work, not just the files. */
export function stealCommand(claim: BoardClaim): string {
  const files = claim.files.slice(0, 6).map((f) => `-f ${shellArg(f)}`).join(" ");
  return `bagsy claim -t ${shellArg(claim.title)}${files ? ` ${files}` : ""} --steal`;
}

/**
 * Free-these-files. Disclosure is the are-you-sure step, matching how the repo
 * gates member removal; the typed confirmation is layered on top only while the
 * hold is young enough that the agent is plausibly alive.
 */
export function softHoldActions(claim: BoardClaim, opts?: { compact?: boolean }): string {
  const owner = claimOwner(claim);
  const fileCount = claim.files.length;
  const firstFile = claim.files[0];
  const typed = needsTypedConfirm(claim);
  const phrase = confirmPhrase(claim);

  const doingNothing = `<p class="muted">Doing nothing is an option — the hold ends in ${escapeHtml(endsAt(claim))} and the files free themselves.</p>`;

  const consequence = `
        <p>Ends ${escapeHtml(owner)}’s soft hold now instead of in ${escapeHtml(endsAt(claim))}. ${
          fileCount === 1
            ? "Its one file stops blocking"
            : `Its ${fileCount} files stop blocking`
        } and nothing is assigned to anyone.</p>
        <p class="muted">Their agent may still have uncommitted work${
          firstFile
            ? ` in <code>${escapeHtml(firstFile)}</code>${fileCount > 1 ? ` and ${fileCount - 1} more` : ""}`
            : ""
        }; it is not notified, and its next heartbeat fails. The only trace is a line on that claim’s timeline.</p>`;

  const confirmField = typed
    ? `<label>Type <code>${escapeHtml(phrase)}</code> to confirm
             <input name="confirm" required autocomplete="off" placeholder="${escapeHtml(phrase)}" />
           </label>`
    : "";

  return `
    ${opts?.compact ? "" : doingNothing}
    <details class="quiet-details">
      <summary>Free these files</summary>
      ${consequence}
      <form method="post" action="/claims/${escapeHtml(claim.id)}/soft-hold/drop" class="stack" style="margin-top:10px">
        ${confirmField}
        <div class="row">
          <button type="submit" class="link-btn danger">Free the files held by “${escapeHtml(claim.title)}”</button>
        </div>
      </form>
      <p class="muted" style="margin-top:12px">To take the work as well as the files, run this in your clone instead:</p>
      <code class="cmd quiet">${escapeHtml(stealCommand(claim))}</code>
    </details>`;
}

/** Release — owner only. The one screen that can set `resolvedRef`. */
export function releaseActions(claim: BoardClaim): string {
  const fileCount = claim.files.length;
  return `
    <details class="quiet-details">
      <summary>Release this claim</summary>
      <p>Marks the claim done and frees ${fileCount === 1 ? "its one file" : `its ${fileCount} files`}. If your agent is still running it fails its next heartbeat.</p>
      <form method="post" action="/claims/${escapeHtml(claim.id)}/release" class="stack" style="margin-top:10px">
        <label>Resolved ref <span class="muted">(optional)</span> — PR URL or commit SHA
          <input name="resolved_ref" autocomplete="off" placeholder="https://github.com/…/pull/412" />
        </label>
        <div class="row">
          <button type="submit" class="link-btn danger">Release “${escapeHtml(claim.title)}”</button>
        </div>
      </form>
      <code class="cmd quiet">bagsy release ${escapeHtml(claim.id)}</code>
    </details>`;
}

/**
 * Take a queued claim. The CLI line is primary and the button is secondary on
 * purpose — a browser-started claim has nothing heartbeating it, so it goes to
 * soft hold in two hours unless an agent actually picks it up.
 */
export function startActions(claim: BoardClaim): string {
  const owner = claimOwner(claim);
  return `
    <code class="cmd quiet">bagsy start ${escapeHtml(claim.id)}</code>
    <details class="quiet-details">
      <summary>Take it now</summary>
      <p>Assigns “${escapeHtml(claim.title)}” to you and marks it active. It moves off ${escapeHtml(owner)} — starting a queued claim reassigns it.</p>
      <p class="muted">Nothing is heartbeating it from here, so it goes to soft hold in two hours unless an agent picks it up with <code>bagsy start ${escapeHtml(claim.id)}</code>.</p>
      <form method="post" action="/claims/${escapeHtml(claim.id)}/start" class="stack" style="margin-top:10px">
        <label>Branch <span class="muted">(optional)</span>
          <input name="branch" autocomplete="off" />
        </label>
        <div class="row">
          <button type="submit" class="link-btn">Take “${escapeHtml(claim.title)}” from the queue</button>
        </div>
      </form>
    </details>`;
}

/**
 * What a bystander can actually do about a collision: tell an agent. There is
 * no ping primitive, so the honest action is a paste-ready list of paths.
 */
export function pathsToPaste(files: string[]): string {
  if (files.length === 0) return "";
  const shown = files.slice(0, 12);
  return `
    <details class="quiet-details">
      <summary>${shown.length === 1 ? "The path" : `The ${shown.length} paths`}, to paste at an agent</summary>
      <code class="cmd quiet">${escapeHtml(shown.join(" "))}</code>
    </details>`;
}
