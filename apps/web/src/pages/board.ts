import {
  normalizeFilePath,
  type BoardClaim,
  type ClaimStatus,
  type OrgBoard,
} from "@bagsy/shared";
import { escapeHtml, layout, topbar, type ShellOrg, type ShellUser } from "../html";
import {
  claimActor,
  claimOwner,
  duration,
  fileCount,
  plural,
  statusBadge,
  timeTag,
  untilTag,
  withParams,
} from "../board/format";
import { pressure } from "../board/rank";

/**
 * The agate: every live claim, dense, sortable, filterable.
 *
 * The audit surface, not the home screen — you come here already knowing what
 * you are looking for. URL params are the entire state, so any view of it is a
 * link you can paste into a chat, which is this product's only real
 * collaboration primitive.
 */

/** Rows rendered at once. Past this the footer says what was left out. */
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 400;
/** Above this many live claims a filter is required rather than shipping a 2MB document. */
export const FILTER_REQUIRED_ABOVE = 800;

export type SortKey = "pressure" | "repo" | "title" | "who" | "clock" | "files";

export interface BoardQuery {
  repo: string | null;
  status: ClaimStatus[];
  who: string | null;
  agent: string | null;
  path: string | null;
  q: string | null;
  find: string | null;
  sort: SortKey;
  dir: "asc" | "desc";
  group: "repo" | "none";
  page: number;
  limit: number;
}

const SORTS: SortKey[] = ["pressure", "repo", "title", "who", "clock", "files"];

export function parseBoardQuery(params: URLSearchParams): BoardQuery {
  const statusRaw = (params.get("status") ?? "active,stale")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ClaimStatus[];
  const sort = params.get("sort") as SortKey | null;
  const limit = Number.parseInt(params.get("limit") ?? "", 10);
  const page = Number.parseInt(params.get("page") ?? "", 10);
  return {
    repo: params.get("repo") || null,
    // Planned is excluded by default: 55 queued intents diluting 167 live rows
    // is exactly what makes `bagsy status` unreadable at scale.
    status: statusRaw.length ? statusRaw : ["active", "stale"],
    who: params.get("who") || null,
    agent: params.get("agent") || null,
    path: params.get("path") || null,
    q: params.get("q") || null,
    find: params.get("find") || null,
    sort: sort && SORTS.includes(sort) ? sort : "pressure",
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    group: params.get("group") === "none" ? "none" : "repo",
    page: Number.isFinite(page) && page > 1 ? page : 1,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 10), MAX_LIMIT) : DEFAULT_LIMIT,
  };
}

export function applyQuery(
  board: OrgBoard,
  query: BoardQuery,
  meUserId: string | null,
): BoardClaim[] {
  const contended = new Set(board.collisions.flatMap((e) => [e.a, e.b]));
  const staleIds = new Set(board.claims.filter((c) => c.status === "stale").map((c) => c.id));
  const blockingHold = new Set(
    board.collisions
      .filter((e) => staleIds.has(e.a) || staleIds.has(e.b))
      .flatMap((e) => [e.a, e.b])
      .filter((id) => staleIds.has(id)),
  );

  const needle = query.q?.toLowerCase() ?? null;
  const path = query.path ? normalizeFilePath(query.path) : null;

  return board.claims.filter((claim) => {
    if (!query.status.includes(claim.status)) return false;
    if (query.repo && claim.repo !== query.repo) return false;
    if (query.who) {
      const target = query.who === "me" ? meUserId : query.who;
      if (!target || claim.userId !== target) return false;
    }
    if (query.agent && (claim.agentLabel ?? "") !== query.agent) return false;
    if (path) {
      // Both sides of a prefix match count: filtering by a directory must find
      // the claim that declared a file inside it, and vice versa.
      const hit = claim.files.some((f) => {
        const norm = normalizeFilePath(f);
        return norm === path || norm.startsWith(`${path}/`) || path.startsWith(`${norm}/`);
      });
      if (!hit) return false;
    }
    if (needle) {
      // Searches paths the row never displays — the whole board is in memory,
      // so there is no reason to only match what is on screen.
      const hay = `${claim.title} ${claim.repo} ${claim.branch ?? ""} ${claim.agentLabel ?? ""} ${claimOwner(claim)} ${claim.files.join(" ")}`;
      if (!hay.toLowerCase().includes(needle)) return false;
    }
    if (query.find === "collision" && !contended.has(claim.id)) return false;
    if (query.find === "softhold" && !blockingHold.has(claim.id)) return false;
    if (query.find === "mine" && claim.userId !== meUserId) return false;
    if (query.find === "decisions" && !contended.has(claim.id) && claim.status !== "stale") {
      return false;
    }
    return true;
  });
}

export function sortClaims(
  claims: BoardClaim[],
  query: BoardQuery,
  contended: Set<string>,
): BoardClaim[] {
  const dir = query.dir === "asc" ? 1 : -1;
  const value = (claim: BoardClaim): number | string => {
    switch (query.sort) {
      case "repo":
        return claim.repo;
      case "title":
        return claim.title.toLowerCase();
      case "who":
        return claimOwner(claim).toLowerCase();
      case "files":
        return claim.files.length;
      case "clock":
        return claim.status === "planned"
          ? Number.MAX_SAFE_INTEGER
          : (claim.expiresInMs ?? 0);
      default:
        return pressure(claim, contended.has(claim.id));
    }
  };
  return [...claims].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const cmp =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right);
    return cmp !== 0 ? cmp * dir : a.id.localeCompare(b.id);
  });
}

/** Columns whose value is constant across the WHOLE team board are dropped and
 *  named once instead. Keyed to the board and never to the current filter, so
 *  columns do not flap while somebody types into the search box. */
function constantColumns(board: OrgBoard): { repo: boolean; agent: boolean } {
  const repos = new Set(board.claims.map((c) => c.repo));
  const agents = new Set(board.claims.map((c) => c.agentLabel ?? ""));
  return { repo: repos.size <= 1, agent: agents.size <= 1 };
}

function clockCell(claim: BoardClaim, now: number): string {
  if (claim.status === "planned") {
    return `<span class="muted">queued</span>`;
  }
  if (claim.status === "stale") {
    return `${escapeHtml(duration(Math.max(0, claim.softHoldLeftMs ?? 0)))}`;
  }
  return untilTag(claim.expiresAt, now);
}

export function agateTable(opts: {
  claims: BoardClaim[];
  board: OrgBoard;
  now: number;
  group: "repo" | "none";
  query?: BoardQuery;
  baseUrl?: string;
  params?: URLSearchParams;
}): string {
  const { claims, board, now, group } = opts;
  const hide = constantColumns(board);
  const contended = new Set(board.collisions.flatMap((e) => [e.a, e.b]));

  if (claims.length === 0) {
    return `<p class="empty">No claims match these filters. <a href="/board">Clear filters</a></p>`;
  }

  const sortLink = (key: SortKey, label: string) => {
    if (!opts.query || !opts.params || !opts.baseUrl) return escapeHtml(label);
    const active = opts.query.sort === key;
    const nextDir = active && opts.query.dir === "desc" ? "asc" : "desc";
    const mark = active ? (opts.query.dir === "desc" ? " ▾" : " ▴") : "";
    const href = withParams(opts.baseUrl, opts.params, {
      sort: key,
      dir: nextDir,
      page: null,
    });
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}${mark}</a>`;
  };
  const ariaSort = (key: SortKey) =>
    opts.query?.sort === key
      ? ` aria-sort="${opts.query.dir === "asc" ? "ascending" : "descending"}"`
      : "";

  const row = (claim: BoardClaim) => `
      <tr class="arow">
        <td class="c-status">${statusBadge(claim)}${contended.has(claim.id) ? ` <span class="badge quiet" title="Overlaps another claim">‡</span>` : ""}</td>
        <th scope="row" class="c-title"><a href="/claims/${escapeHtml(claim.id)}" title="${escapeHtml(claim.title)}">${escapeHtml(claim.title)}</a></th>
        <td class="c-who">${escapeHtml(claimOwner(claim))}</td>
        ${hide.agent ? "" : `<td class="c-agent mono">${claim.agentLabel ? escapeHtml(claim.agentLabel) : `<span class="muted">—</span>`}</td>`}
        ${hide.repo ? "" : `<td class="c-repo">${escapeHtml(claim.repo)}</td>`}
        <td class="c-files">${fileCount(claim)}</td>
        <td class="c-clock">${clockCell(claim, now)}</td>
      </tr>`;

  const head = `
      <thead>
        <tr>
          <th scope="col" class="c-status"${ariaSort("pressure")}>${sortLink("pressure", "State")}</th>
          <th scope="col" class="c-title"${ariaSort("title")}>${sortLink("title", "Claim")}</th>
          <th scope="col" class="c-who"${ariaSort("who")}>${sortLink("who", "Who")}</th>
          ${hide.agent ? "" : `<th scope="col" class="c-agent">Agent</th>`}
          ${hide.repo ? "" : `<th scope="col" class="c-repo"${ariaSort("repo")}>${sortLink("repo", "Repo")}</th>`}
          <th scope="col" class="c-files"${ariaSort("files")}>${sortLink("files", "Files")}</th>
          <th scope="col" class="c-clock"${ariaSort("clock")}>${sortLink("clock", "Clock")}</th>
        </tr>
      </thead>`;

  const colCount = 5 + (hide.agent ? 0 : 1) + (hide.repo ? 0 : 1);

  let body: string;
  if (group === "repo" && !hide.repo) {
    const byRepo = new Map<string, BoardClaim[]>();
    for (const claim of claims) {
      const bucket = byRepo.get(claim.repo);
      if (bucket) bucket.push(claim);
      else byRepo.set(claim.repo, [claim]);
    }
    body = [...byRepo.entries()]
      .map(
        ([repo, rows]) => `
      <tbody>
        <tr class="agate-group"><th scope="colgroup" colspan="${colCount}">${escapeHtml(repo)} <span class="muted">${rows.length}</span></th></tr>
        ${rows.map(row).join("")}
      </tbody>`,
      )
      .join("");
  } else {
    body = `<tbody>${claims.map(row).join("")}</tbody>`;
  }

  return `<table class="agate">${head}${body}</table>`;
}

function filterForm(board: OrgBoard, query: BoardQuery, meUserId: string): string {
  const repos = [...new Set(board.claims.map((c) => c.repo))].sort();
  const agents = [...new Set(board.claims.map((c) => c.agentLabel).filter(Boolean))].sort();
  const people = [
    ...new Map(board.claims.map((c) => [c.userId, claimOwner(c)])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const option = (value: string, label: string, selected: boolean) =>
    `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;

  return `
    <form class="filters" method="get" action="/board">
      <label>Search
        <input type="search" name="q" value="${escapeHtml(query.q ?? "")}" placeholder="title or path" autocomplete="off" />
      </label>
      <label>Repo
        <select name="repo">
          ${option("", "All repos", !query.repo)}
          ${repos.map((r) => option(r, r, query.repo === r)).join("")}
        </select>
      </label>
      <label>State
        <select name="status">
          ${option("active,stale", "Live", query.status.join(",") === "active,stale")}
          ${option("active", "Active only", query.status.join(",") === "active")}
          ${option("stale", "Soft holds", query.status.join(",") === "stale")}
          ${option("planned", "Queued", query.status.join(",") === "planned")}
          ${option("active,stale,planned", "Everything", query.status.length === 3)}
        </select>
      </label>
      <label>Who
        <select name="who">
          ${option("", "Anyone", !query.who)}
          ${option("me", "Me", query.who === "me")}
          ${people
            .filter(([id]) => id !== meUserId)
            .map(([id, name]) => option(id, name, query.who === id))
            .join("")}
        </select>
      </label>
      ${
        agents.length > 1
          ? `<label>Agent
               <select name="agent">
                 ${option("", "Any agent", !query.agent)}
                 ${agents.map((a) => option(a!, a!, query.agent === a)).join("")}
               </select>
             </label>`
          : ""
      }
      ${query.path ? `<input type="hidden" name="path" value="${escapeHtml(query.path)}" />` : ""}
      ${query.find ? `<input type="hidden" name="find" value="${escapeHtml(query.find)}" />` : ""}
      <div class="row"><button type="submit">Filter</button></div>
    </form>`;
}

function chips(query: BoardQuery, params: URLSearchParams): string {
  const active: Array<[string, string]> = [];
  if (query.repo) active.push(["repo", `repo: ${query.repo}`]);
  if (query.who) active.push(["who", `who: ${query.who === "me" ? "me" : query.who}`]);
  if (query.agent) active.push(["agent", `agent: ${query.agent}`]);
  if (query.path) active.push(["path", `path: ${query.path}`]);
  if (query.q) active.push(["q", `search: ${query.q}`]);
  if (query.find) active.push(["find", `view: ${query.find}`]);
  if (active.length === 0) return "";
  return `
    <ul class="chips">
      ${active
        .map(
          ([key, label]) =>
            `<li><a class="chip" href="${escapeHtml(withParams("/board", params, { [key]: null, page: null }))}">${escapeHtml(label)} ×</a></li>`,
        )
        .join("")}
      <li><a class="chip" href="/board">clear all</a></li>
    </ul>`;
}

export function boardPage(opts: {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  board: OrgBoard;
  params: URLSearchParams;
  now: number;
  flash?: string | null;
  error?: string | null;
  preview?: boolean;
}): string {
  const { user, org, orgs, board, params, now } = opts;
  const query = parseBoardQuery(params);
  const contended = new Set(board.collisions.flatMap((e) => [e.a, e.b]));

  const live = board.counts.active + board.counts.stale;
  const unfiltered = !query.repo && !query.who && !query.agent && !query.path && !query.q;
  const mustFilter = live > FILTER_REQUIRED_ABOVE && unfiltered;

  const matched = mustFilter ? [] : sortClaims(applyQuery(board, query, user.id), query, contended);
  const start = (query.page - 1) * query.limit;
  const windowed = matched.slice(start, start + query.limit);

  const footer = mustFilter
    ? `<p class="tail">${live} live claims is more than one page should carry. Pick a repo or a person above.</p>`
    : matched.length > windowed.length
      ? `<p class="tail">Showing ${windowed.length} of ${matched.length} matching ${plural(matched.length, "claim")} by ${escapeHtml(query.sort)}. Narrow with a filter, or <a href="${escapeHtml(withParams("/board", params, { limit: String(MAX_LIMIT) }))}">show ${MAX_LIMIT}</a>.${
          start + query.limit < matched.length
            ? ` <a href="${escapeHtml(withParams("/board", params, { page: String(query.page + 1) }))}">Next page →</a>`
            : ""
        }</p>`
      : `<p class="tail">${matched.length} ${plural(matched.length, "claim")}. Board read ${timeTag(board.generatedAt, now)}.</p>`;

  const body = `
    ${topbar({ user, org, orgs, section: "board" })}
    ${
      opts.preview
        ? `<p class="warn">Preview — synthetic data, generated in the worker. Nothing here is real.</p>`
        : ""
    }
    <p class="lede"><strong>All claims.</strong> Every live claim on this team, densest first. The <a href="/">board</a> is where decisions are; this is where you look something up.</p>
    ${opts.flash ? `<p class="ok">${escapeHtml(opts.flash)}</p>` : ""}
    ${opts.error ? `<p class="warn">${escapeHtml(opts.error)}</p>` : ""}
    ${filterForm(board, query, user.id)}
    ${chips(query, params)}
    <div id="agate">
      ${
        mustFilter
          ? `<p class="empty">${live} live claims — pick a repo or a person first.</p>`
          : agateTable({
              claims: windowed,
              board,
              now,
              group: query.group,
              query,
              params,
              baseUrl: "/board",
            })
      }
    </div>
    ${footer}
    <details class="quiet-details">
      <summary>Keyboard</summary>
      <p class="muted"><code>/</code> search · <code>j</code> / <code>k</code> move between claims · <code>Enter</code> open · <code>Esc</code> leave search · <code>?</code> this list</p>
    </details>
  `;

  return layout("All claims", body, {
    wide: true,
    skipTo: { id: "agate", label: "Skip to the board" },
  });
}
