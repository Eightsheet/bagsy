import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import { getWorkOS, workosClientId } from "../auth/workos.js";

export type WorkOsAccessClaims = JWTPayload & {
  sub: string;
  client_id?: string;
  org_id?: string;
  sid?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
};

/**
 * Read the AuthKit session id (`sid`) out of an access token.
 * Unverified on purpose: the token comes straight from the WorkOS token
 * endpoint over TLS, and the value is only used to build a logout URL.
 */
export function workosSessionIdFromAccessToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const { sid } = decodeJwt(token) as WorkOsAccessClaims;
    return typeof sid === "string" && sid ? sid : null;
  } catch {
    return null;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksClientId: string | null = null;

function getJwks(clientId: string) {
  if (!jwks || jwksClientId !== clientId) {
    const workos = getWorkOS();
    // URL from WorkOS SDK; verify with our jose (SDK jose major may differ).
    const url = workos
      ? workos.userManagement.getJwksUrl(clientId)
      : `https://api.workos.com/sso/jwks/${clientId}`;
    jwks = createRemoteJWKSet(new URL(url));
    jwksClientId = clientId;
  }
  return jwks;
}

/** WorkOS may set iss to api.workos.com or …/user_management/<default-app>. */
export function isAllowedWorkOsIssuer(iss: unknown): boolean {
  if (typeof iss !== "string" || !iss) return false;
  const normalized = iss.replace(/\/$/, "");
  if (normalized === "https://api.workos.com") return true;
  return /^https:\/\/api\.workos\.com\/user_management\/client_[A-Za-z0-9]+$/.test(normalized);
}

function tokenAppId(claims: JWTPayload): string | undefined {
  if (typeof claims.client_id === "string" && claims.client_id) return claims.client_id;
  if (typeof claims.aud === "string" && claims.aud) return claims.aud;
  if (Array.isArray(claims.aud)) {
    const first = claims.aud.find((a) => typeof a === "string" && a.startsWith("client_"));
    if (typeof first === "string") return first;
  }
  return undefined;
}

/**
 * Verify a WorkOS AuthKit access token (JWKS via SDK URL + exp + client_id).
 * App binding is `client_id` / `aud`, not `iss === WORKOS_CLIENT_ID` (multi-app safe).
 */
export async function verifyWorkOsAccessToken(token: string): Promise<WorkOsAccessClaims> {
  const clientId = workosClientId();
  if (!clientId) {
    throw Object.assign(new Error("WorkOS is not configured"), { status: 503 });
  }

  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(token);
  } catch {
    throw Object.assign(new Error("Invalid token"), { status: 401 });
  }

  if (!isAllowedWorkOsIssuer(unverified.iss)) {
    throw Object.assign(new Error("Invalid token issuer"), { status: 401 });
  }

  const appId = tokenAppId(unverified);
  if (!appId || appId !== clientId) {
    throw Object.assign(new Error("Invalid token client_id"), { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(clientId), {
      algorithms: ["RS256"],
      issuer: unverified.iss as string,
      clockTolerance: 30,
    });

    if (typeof payload.sub !== "string" || !payload.sub) {
      throw Object.assign(new Error("Invalid token payload"), { status: 401 });
    }

    const verifiedApp = tokenAppId(payload);
    if (!verifiedApp || verifiedApp !== clientId) {
      throw Object.assign(new Error("Invalid token client_id"), { status: 401 });
    }

    return payload as WorkOsAccessClaims;
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    throw Object.assign(new Error("Invalid token"), { status: 401, cause: err });
  }
}
