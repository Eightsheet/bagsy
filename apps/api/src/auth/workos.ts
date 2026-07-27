import { WorkOS } from "@workos-inc/node";
import { optionalEnv, workosConfigured } from "../lib/env.js";

let client: WorkOS | null = null;

export function getWorkOS(): WorkOS | null {
  if (!workosConfigured()) return null;
  if (!client) {
    client = new WorkOS(optionalEnv("WORKOS_API_KEY")!, {
      clientId: optionalEnv("WORKOS_CLIENT_ID"),
    });
  }
  return client;
}

export function getAuthKitUrl(
  redirectUri: string,
  opts?: { state?: string; organizationId?: string },
): string | null {
  const workos = getWorkOS();
  const clientId = optionalEnv("WORKOS_CLIENT_ID");
  if (!workos || !clientId) return null;

  return workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId,
    state: opts?.state,
    organizationId: opts?.organizationId,
  });
}

export async function authenticateWithCode(code: string) {
  const workos = getWorkOS();
  const clientId = optionalEnv("WORKOS_CLIENT_ID");
  if (!workos || !clientId) {
    throw new Error("WorkOS is not configured");
  }
  return workos.userManagement.authenticateWithCode({
    code,
    clientId,
  });
}

export async function authenticateWithOrganizationSelection(input: {
  organizationId: string;
  pendingAuthenticationToken: string;
}) {
  const workos = getWorkOS();
  const clientId = optionalEnv("WORKOS_CLIENT_ID");
  if (!workos || !clientId) {
    throw new Error("WorkOS is not configured");
  }
  return workos.userManagement.authenticateWithOrganizationSelection({
    clientId,
    organizationId: input.organizationId,
    pendingAuthenticationToken: input.pendingAuthenticationToken,
  });
}

export async function authenticateWithRefreshToken(refreshToken: string, organizationId?: string) {
  const workos = getWorkOS();
  const clientId = optionalEnv("WORKOS_CLIENT_ID");
  if (!workos || !clientId) {
    throw new Error("WorkOS is not configured");
  }
  return workos.userManagement.authenticateWithRefreshToken({
    clientId,
    refreshToken,
    organizationId,
  });
}

export function workosClientId(): string | undefined {
  return optionalEnv("WORKOS_CLIENT_ID");
}

