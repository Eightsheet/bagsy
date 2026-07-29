import { Hono } from "hono";
import type { Context } from "hono";
import type {
  BoardClaim,
  ClaimEvent,
  CollisionEdge,
  OrgBoard,
} from "@bagsy/shared";
import type { ShellOrg, ShellUser } from "./html";
import { appleTouchIcon, favicon32Png, faviconIco, faviconSvg } from "./icons";
import { demoBoard } from "./board/demo";
import { landingPage, loginPage, noOrgPage } from "./pages/auth";
import { boardPage } from "./pages/board";
import { claimMissingPage, claimPage } from "./pages/claim";
import { devicePage } from "./pages/device";
import { foldPage } from "./pages/fold";
import { privacyPage } from "./pages/legal";
import { queuePage } from "./pages/queue";
import { setupPage } from "./pages/setup";
import type { SetupMember, SetupPendingInvite } from "./pages/setup";

type Bindings = {
  /** Origin of the Bagsy API (Railway), e.g. https://repo-org-production.up.railway.app */
  API_ORIGIN: string;
};

type Ctx = Context<{ Bindings: Bindings }>;

/** Shape of GET /v1/web/state on the API. */
type WebState = {
  user: ShellUser | null;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  repos: Array<{ repo: string; verifiedAt: string | null }>;
  members: SetupMember[];
  pendingInvites: SetupPendingInvite[];
  canManage: boolean;
  selfRole: string | null;
  defaultOrgName: string;
};

/** Shape of GET /v1/web/claims/:id on the API. */
type ClaimDetailState = {
  user: ShellUser;
  org: ShellOrg | null;
  orgs: ShellOrg[];
  claim: BoardClaim;
  events: ClaimEvent[];
  eventCount: number;
  own: boolean;
  collisions: CollisionEdge[];
  claims: BoardClaim[];
  generatedAt: string;
};

const app = new Hono<{ Bindings: Bindings }>();

function apiOrigin(c: Ctx): string {
  return c.env.API_ORIGIN.replace(/\/$/, "");
}

/**
 * Everything that needs a session or the DB is answered by the API. Proxying it
 * through this Worker keeps the browser on one origin, so the session cookie
 * stays first-party (SameSite=Lax) and no CORS is involved.
 */
async function proxyToApi(c: Ctx): Promise<Response> {
  const url = new URL(c.req.url);
  const target = `${apiOrigin(c)}${url.pathname}${url.search}`;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  const ip = c.req.header("cf-connecting-ip");
  if (ip) headers.set("x-forwarded-for", ip);
  const init: RequestInit = {
    method: c.req.method,
    headers,
    // Relative Location headers ("/", "/?ok=…") must reach the browser, which
    // resolves them against this Worker's origin.
    redirect: "manual",
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = c.req.raw.body;
  }
  const res = await fetch(target, init);
  return new Response(res.body, res);
}

/** Copy Set-Cookie from an API response (e.g. expired-session cleanup) onto ours. */
function carryCookies(from: Response, to: Response): Response {
  const cookies = from.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) to.headers.append("set-cookie", cookie);
  return to;
}

const ICON_CACHE = "public, max-age=604800";

function icon(body: Uint8Array, type: string): Response {
  return new Response(body, {
    headers: { "Content-Type": type, "Cache-Control": ICON_CACHE },
  });
}

app.get("/favicon.svg", (c) =>
  c.body(faviconSvg, 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": ICON_CACHE,
  }),
);
app.get("/favicon.ico", () => icon(faviconIco, "image/x-icon"));
app.get("/favicon-32.png", () => icon(favicon32Png, "image/png"));
app.get("/apple-touch-icon.png", () => icon(appleTouchIcon, "image/png"));

app.get("/privacy", (c) => c.html(privacyPage()));
app.get("/device", (c) => c.html(devicePage()));

/**
 * Renders the board surfaces against a synthetic team, so the design can be
 * reviewed at sizes no test team reaches. Reads nothing — no session, no API,
 * no database — and every page it produces says so at the top.
 *
 * `/preview?claims=200&repos=12&seed=7` is deterministic: the same URL is the
 * same board, which is what makes a screenshot in a review mean anything.
 *
 * NOTE: unauthenticated by design, since it touches nothing — but it is a
 * review aid, not a product surface. Delete this block (and board/demo.ts)
 * before this ships anywhere real, or put it behind a session first.
 */
function previewShell(c: Ctx) {
  const q = c.req.query();
  // Capped well below the collision-cap so a query string cannot spend
  // unbounded Worker CPU on a route that needs no session.
  const claims = Math.max(0, Math.min(Number(q.claims ?? 200) || 0, 2000));
  const repos = Math.max(1, Math.min(Number(q.repos ?? 12) || 12, 12));
  const seed = Number(q.seed ?? 7) || 7;
  return {
    board: demoBoard({ claims, repos, seed }),
    user: { id: "usr_0", email: "philipp@eightsheet.dev", name: "Philipp Schorn" },
    org: { id: "org_demo", slug: "demo-team", name: "Demo team" },
    orgs: [{ id: "org_demo", slug: "demo-team", name: "Demo team" }],
    now: Date.now(),
    preview: true as const,
  };
}

app.get("/preview", (c) => {
  const shell = previewShell(c);
  return c.html(foldPage({ ...shell, seenAt: shell.now - 45 * 60 * 1000 }));
});

app.get("/preview/board", (c) => {
  const shell = previewShell(c);
  return c.html(
    boardPage({ ...shell, params: new URL(c.req.url).searchParams }),
  );
});

app.get("/preview/queue", (c) => {
  const shell = previewShell(c);
  return c.html(queuePage(shell));
});

app.get("/preview/claims/:id", (c) => {
  const shell = previewShell(c);
  const claim = shell.board.claims.find((x) => x.id === c.req.param("id"));
  if (!claim) return c.html(claimMissingPage({ ...shell, claimId: c.req.param("id") }), 404);
  return c.html(
    claimPage({
      ...shell,
      claim,
      events: claim.recentEvents ?? [],
      eventCount: claim.eventCount ?? 0,
      own: claim.userId === shell.user.id,
      board: shell.board,
    }),
  );
});

function flashes(c: Ctx) {
  return {
    flash: c.req.query("ok") ? decodeURIComponent(c.req.query("ok")!) : null,
    error: c.req.query("err") ? decodeURIComponent(c.req.query("err")!) : null,
  };
}

/** Everything the board renders from, or a Response to return instead. */
type BoardState = OrgBoard & { user: ShellUser; org: ShellOrg | null; orgs: ShellOrg[] };

async function fetchBoard(c: Ctx): Promise<{ state: BoardState; res: Response } | Response> {
  let apiRes: Response;
  try {
    apiRes = await fetch(`${apiOrigin(c)}/v1/web/board`, {
      headers: { cookie: c.req.header("cookie") ?? "" },
    });
  } catch {
    return c.html(landingPage());
  }
  if (apiRes.status === 401) return carryCookies(apiRes, await c.html(landingPage()));
  if (apiRes.status === 403) {
    // Signed in with no team. The setup page is the only thing that helps.
    return c.redirect("/setup?noorg=1");
  }
  if (!apiRes.ok) return carryCookies(apiRes, await c.html(landingPage()));
  return { state: (await apiRes.json()) as BoardState, res: apiRes };
}

/**
 * The seen boundary: read the previous value, render against it, and only then
 * stamp the current time. So the first view shows the delta and the marks and
 * the next one does not — and the boundary does not slide out from under you
 * while you are reading. It orders and marks findings; it never hides one.
 */
const SEEN_COOKIE = "bagsy_seen";

function readSeen(c: Ctx): number {
  const raw = c.req.header("cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SEEN_COOKIE}=(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function stampSeen(res: Response, now: number): Response {
  res.headers.append(
    "set-cookie",
    `${SEEN_COOKIE}=${now}; Path=/; Max-Age=${90 * 24 * 60 * 60}; HttpOnly; SameSite=Lax`,
  );
  return res;
}

app.get("/", async (c) => {
  const loaded = await fetchBoard(c);
  if (loaded instanceof Response) return loaded;
  const { state, res } = loaded;
  const now = Date.now();
  const seenAt = readSeen(c);

  const page = await c.html(
    foldPage({
      user: state.user,
      org: state.org,
      orgs: state.orgs,
      board: state,
      seenAt,
      now,
      ...flashes(c),
    }),
  );
  return stampSeen(carryCookies(res, page), now);
});

app.get("/board", async (c) => {
  const loaded = await fetchBoard(c);
  if (loaded instanceof Response) return loaded;
  const { state, res } = loaded;
  return carryCookies(
    res,
    await c.html(
      boardPage({
        user: state.user,
        org: state.org,
        orgs: state.orgs,
        board: state,
        params: new URL(c.req.url).searchParams,
        now: Date.now(),
        ...flashes(c),
      }),
    ),
  );
});

app.get("/queue", async (c) => {
  const loaded = await fetchBoard(c);
  if (loaded instanceof Response) return loaded;
  const { state, res } = loaded;
  return carryCookies(
    res,
    await c.html(
      queuePage({
        user: state.user,
        org: state.org,
        orgs: state.orgs,
        board: state,
        now: Date.now(),
        ...flashes(c),
      }),
    ),
  );
});

app.get("/claims/:id", async (c) => {
  let apiRes: Response;
  try {
    apiRes = await fetch(
      `${apiOrigin(c)}/v1/web/claims/${encodeURIComponent(c.req.param("id"))}`,
      { headers: { cookie: c.req.header("cookie") ?? "" } },
    );
  } catch {
    return c.html(landingPage());
  }
  if (apiRes.status === 401) return carryCookies(apiRes, await c.html(landingPage()));
  if (apiRes.status === 403) return c.redirect("/setup?noorg=1");

  if (apiRes.status === 404) {
    const shell = await fetch(`${apiOrigin(c)}/v1/web/state`, {
      headers: { cookie: c.req.header("cookie") ?? "" },
    });
    const state = shell.ok ? ((await shell.json()) as WebState) : null;
    if (!state?.user) return c.html(landingPage());
    return c.html(
      claimMissingPage({
        user: state.user,
        org: state.org,
        orgs: state.orgs,
        claimId: c.req.param("id"),
      }),
      404,
    );
  }
  if (!apiRes.ok) return carryCookies(apiRes, await c.html(landingPage()));

  const detail = (await apiRes.json()) as ClaimDetailState;
  return carryCookies(
    apiRes,
    await c.html(
      claimPage({
        user: detail.user,
        org: detail.org,
        orgs: detail.orgs,
        claim: detail.claim,
        events: detail.events,
        eventCount: detail.eventCount,
        own: detail.own,
        board: {
          claims: detail.claims,
          collisions: detail.collisions,
          clusters: [],
          collisionsTruncated: false,
          repos: [],
          agents: [],
          counts: { active: 0, stale: 0, planned: 0, total: detail.claims.length },
          generatedAt: detail.generatedAt,
        },
        now: Date.now(),
        ...flashes(c),
      }),
    ),
  );
});

/** Setup moved off `/` when the board took it. */
app.get("/setup", async (c) => {
  let apiRes: Response;
  try {
    apiRes = await fetch(`${apiOrigin(c)}/v1/web/state`, {
      headers: { cookie: c.req.header("cookie") ?? "" },
    });
  } catch {
    return c.html(landingPage());
  }
  if (!apiRes.ok) return carryCookies(apiRes, await c.html(landingPage()));

  const state = (await apiRes.json()) as WebState;
  if (!state.user) return carryCookies(apiRes, await c.html(landingPage()));

  if (c.req.query("noorg") === "1" && !state.org && state.orgs.length === 0) {
    return carryCookies(
      apiRes,
      await c.html(noOrgPage({ defaultOrgName: state.defaultOrgName })),
    );
  }

  const page = setupPage({
    user: state.user,
    org: state.org,
    orgs: state.orgs,
    repos: state.repos,
    members: state.members,
    pendingInvites: state.pendingInvites,
    canManage: state.canManage,
    selfRole: state.selfRole,
    ...flashes(c),
    defaultOrgName: state.defaultOrgName,
  });
  return carryCookies(apiRes, await c.html(page));
});

// AuthKit redirect lives on the API; a 503 means WorkOS is not configured.
app.get("/login", async (c) => {
  const res = await proxyToApi(c);
  if (res.status === 503) return c.html(loginPage(), 503);
  return res;
});

// Auth callback, logout, form POSTs, /v1/* — all pass through to the API.
app.all("*", (c) => proxyToApi(c));

export default app;
