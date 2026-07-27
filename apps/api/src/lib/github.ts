/**
 * Hybrid C GitHub verification.
 * When GITHUB_TOKEN (user PAT or installation token) is available on the request
 * context via env GITHUB_VERIFY_TOKEN for server-side checks, or when the user
 * has githubLogin set and we can hit the GitHub API with a provided token.
 *
 * Phase 1: if SKIP_GITHUB_VERIFY=1 or no token, mark linked repos as unverified
 * but still allow org-gated access. If token present, check repo visibility.
 */

import { optionalEnv } from "../lib/env.js";

export type GithubVerifyResult =
  | { ok: true; verified: boolean; reason?: string }
  | { ok: false; verified: false; reason: string };

export async function verifyGithubRepoAccess(
  repo: string,
  opts?: { userToken?: string | null; githubLogin?: string | null },
): Promise<GithubVerifyResult> {
  if (optionalEnv("SKIP_GITHUB_VERIFY") === "1") {
    return { ok: true, verified: false, reason: "verification skipped" };
  }

  const token = opts?.userToken || optionalEnv("GITHUB_VERIFY_TOKEN");
  if (!token) {
    // Org membership is still required by the API; GitHub verify is soft.
    return { ok: true, verified: false, reason: "no github token configured" };
  }

  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "repo-org-workboard",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.status === 404) {
    return { ok: false, verified: false, reason: "repo not found or no access" };
  }
  if (!res.ok) {
    return {
      ok: false,
      verified: false,
      reason: `github api error ${res.status}`,
    };
  }

  return { ok: true, verified: true };
}
