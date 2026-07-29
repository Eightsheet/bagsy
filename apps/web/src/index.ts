import { Hono } from "hono";
import type { Context } from "hono";
import type { ShellOrg, ShellUser } from "./html";
import { appleTouchIcon, favicon32Png, faviconIco, faviconSvg } from "./icons";
import { landingPage, loginPage, noOrgPage } from "./pages/auth";
import { devicePage } from "./pages/device";
import { privacyPage } from "./pages/legal";
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
  defaultOrgName: string;
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

app.get("/", async (c) => {
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
    flash: c.req.query("ok") ? decodeURIComponent(c.req.query("ok")!) : null,
    error: c.req.query("err") ? decodeURIComponent(c.req.query("err")!) : null,
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
