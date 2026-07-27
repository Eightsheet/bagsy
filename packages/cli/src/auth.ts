import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuthConfig = {
  apiUrl: string;
  /** WorkOS access JWT (or WORKBOARD_TOKEN override). */
  token?: string;
  refreshToken?: string;
  /** Epoch ms when access token should be refreshed. */
  tokenExpiresAt?: number;
  orgSlug?: string;
  repoTeams?: Record<string, string>;
  currentClaimId?: string;
  lastUpdateCheck?: string;
};

const CONFIG_DIR = join(homedir(), ".config", "repo-org");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const LOCK_PATH = join(CONFIG_DIR, "token.refresh.lock");

export function configDir(): string {
  return CONFIG_DIR;
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function loadAuthConfig(defaultApiUrl: string): AuthConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { apiUrl: process.env.WORKBOARD_API_URL ?? defaultApiUrl };
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AuthConfig & {
    tokenExpiresAt?: number | string;
  };
  return {
    apiUrl: process.env.WORKBOARD_API_URL ?? raw.apiUrl ?? defaultApiUrl,
    token: process.env.WORKBOARD_TOKEN ?? raw.token,
    refreshToken: process.env.WORKBOARD_TOKEN ? undefined : raw.refreshToken,
    tokenExpiresAt:
      typeof raw.tokenExpiresAt === "number"
        ? raw.tokenExpiresAt
        : raw.tokenExpiresAt
          ? Date.parse(String(raw.tokenExpiresAt))
          : undefined,
    orgSlug: raw.orgSlug,
    repoTeams: raw.repoTeams ?? {},
    currentClaimId: raw.currentClaimId,
    lastUpdateCheck: raw.lastUpdateCheck,
  };
}

/** Atomic write + mode 0600. */
export function saveAuthConfig(cfg: AuthConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, CONFIG_PATH);
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(LOCK_PATH, "wx");
      closeSync(fd);
      break;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
      if (code !== "EEXIST") throw err;
      if (Date.now() - started > 15_000) {
        // Stale lock — take over.
        try {
          unlinkSync(LOCK_PATH);
        } catch {
          /* ignore */
        }
        continue;
      }
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(LOCK_PATH);
    } catch {
      /* ignore */
    }
  }
}

export type AuthConfigResponse = {
  workosClientId: string;
  workosApiBaseUrl: string;
  authMode: string;
};

export async function fetchAuthConfig(apiUrl: string): Promise<AuthConfigResponse> {
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/auth/config`);
  const json = (await res.json()) as AuthConfigResponse & { error?: string; message?: string };
  if (!res.ok || !json.workosClientId) {
    throw new Error(json.message || json.error || `auth config failed (${res.status})`);
  }
  return {
    workosClientId: json.workosClientId,
    workosApiBaseUrl: (json.workosApiBaseUrl || "https://api.workos.com").replace(/\/$/, ""),
    authMode: json.authMode || "workos_jwt",
  };
}

type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  organization_id?: string | null;
};

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function workosDeviceLogin(opts: {
  workosApiBaseUrl: string;
  clientId: string;
  openBrowser: (url: string) => void;
}): Promise<TokenResponse> {
  const start = await fetch(`${opts.workosApiBaseUrl}/user_management/authorize/device`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ client_id: opts.clientId }),
  });
  const startBody = await readJson(start);
  if (!start.ok) {
    throw new Error(
      typeof startBody.error_description === "string"
        ? startBody.error_description
        : `Could not start WorkOS device login (${start.status})`,
    );
  }

  const auth = startBody as unknown as DeviceAuthorization;
  if (!auth.device_code || !auth.user_code || !auth.verification_uri || !auth.expires_in) {
    throw new Error("WorkOS returned an invalid device authorization response.");
  }

  const openUrl = auth.verification_uri_complete || auth.verification_uri;
  console.log("Opening browser for WorkOS login…");
  console.log(`Confirm code in browser: ${auth.user_code}`);
  console.log(`If it does not open: ${openUrl}`);
  opts.openBrowser(openUrl);

  let intervalSec = auth.interval ?? 5;
  const expiresAt = Date.now() + auth.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
    const poll = await fetch(`${opts.workosApiBaseUrl}/user_management/authenticate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: auth.device_code,
        client_id: opts.clientId,
      }),
    });
    const body = await readJson(poll);
    if (poll.ok && typeof body.access_token === "string") {
      return {
        access_token: body.access_token,
        refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
        expires_in: typeof body.expires_in === "number" ? body.expires_in : undefined,
        organization_id:
          typeof body.organization_id === "string" || body.organization_id === null
            ? (body.organization_id as string | null)
            : undefined,
      };
    }
    const err = typeof body.error === "string" ? body.error : "";
    if (err === "authorization_pending") continue;
    if (err === "slow_down") {
      intervalSec += 1;
      continue;
    }
    if (err === "access_denied") throw new Error("Login was denied in the browser.");
    if (err === "expired_token") throw new Error("Login code expired. Run workboard login again.");
    throw new Error(
      typeof body.error_description === "string"
        ? body.error_description
        : `Authorization failed${err ? ` (${err})` : ""}`,
    );
  }

  throw new Error("Login timed out. Run workboard login again.");
}

function applyTokens(cfg: AuthConfig, tokens: TokenResponse): AuthConfig {
  const expiresIn = tokens.expires_in ?? 300;
  return {
    ...cfg,
    token: tokens.access_token,
    refreshToken: tokens.refresh_token ?? cfg.refreshToken,
    // Refresh 60s early.
    tokenExpiresAt: Date.now() + Math.max(30, expiresIn - 60) * 1000,
  };
}

export async function refreshAccessToken(cfg: AuthConfig): Promise<AuthConfig> {
  if (process.env.WORKBOARD_TOKEN) return cfg;
  if (!cfg.refreshToken) {
    throw new Error("Session expired. Run: workboard login");
  }

  return withRefreshLock(async () => {
    // Another process may have refreshed while we waited.
    const latest = loadAuthConfig(cfg.apiUrl);
    if (
      latest.token &&
      latest.tokenExpiresAt &&
      latest.tokenExpiresAt > Date.now() + 15_000 &&
      latest.refreshToken
    ) {
      return { ...cfg, ...latest, apiUrl: cfg.apiUrl };
    }

    const refreshToken = latest.refreshToken || cfg.refreshToken;
    if (!refreshToken) throw new Error("Session expired. Run: workboard login");

    const res = await fetch(`${cfg.apiUrl.replace(/\/$/, "")}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const body = (await res.json()) as TokenResponse & { error?: string; message?: string };

    if (!res.ok || !body.access_token) {
      // Race: peer may have rotated; reload once.
      const again = loadAuthConfig(cfg.apiUrl);
      if (again.token && again.refreshToken && again.refreshToken !== refreshToken) {
        return { ...cfg, ...again, apiUrl: cfg.apiUrl };
      }
      throw new Error(body.message || body.error || "Refresh failed. Run: workboard login");
    }

    const next = applyTokens({ ...cfg, ...latest, apiUrl: cfg.apiUrl }, body);
    saveAuthConfig(next);
    return next;
  });
}

export async function ensureFreshAccessToken(cfg: AuthConfig): Promise<AuthConfig> {
  if (process.env.WORKBOARD_TOKEN) return cfg;
  if (!cfg.token) return cfg;
  if (cfg.tokenExpiresAt && cfg.tokenExpiresAt > Date.now()) return cfg;
  if (!cfg.refreshToken) return cfg;
  try {
    return await refreshAccessToken(cfg);
  } catch {
    return cfg;
  }
}

export function storeLoginTokens(cfg: AuthConfig, tokens: TokenResponse): AuthConfig {
  const next = applyTokens(cfg, tokens);
  saveAuthConfig(next);
  return next;
}
