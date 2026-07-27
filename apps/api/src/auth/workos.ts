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

export function getAuthKitUrl(redirectUri: string, state?: string): string | null {
  const workos = getWorkOS();
  const clientId = optionalEnv("WORKOS_CLIENT_ID");
  if (!workos || !clientId) return null;

  return workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId,
    state,
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
