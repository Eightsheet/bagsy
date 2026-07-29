const GITHUB_REPO = "Eightsheet/bagsy";
const CACHE_MS = 10 * 60 * 1000;
const DELAY_HOURS = 48;

export type CliUpdateInfo = {
  version: string;
  publishedAt: string;
  tarballUrl: string;
  channel: "stable" | "dev";
  delayHours: number;
};

type Cache = {
  at: number;
  info: CliUpdateInfo | null;
  error?: string;
};

let cache: Cache | null = null;

export function cliUpdateChannel(): "stable" | "dev" {
  const raw = (
    process.env.BAGSY_CLI_UPDATE_CHANNEL ??
    process.env.WORKBOARD_CLI_UPDATE_CHANNEL ??
    "stable"
  )
    .trim()
    .toLowerCase();
  return raw === "dev" ? "dev" : "stable";
}

function tarballUrlFor(version: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/bagsy-cli-${version}.tgz`;
}

async function fetchLatestRelease(): Promise<CliUpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "bagsy-api",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    tag_name?: string;
    published_at?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const tag = json.tag_name?.trim() ?? "";
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  if (!version || !json.published_at) return null;

  // Releases carry the tarball under both names; old CLIs need the legacy one
  // only via the fallback URL they construct themselves.
  const asset =
    json.assets?.find(
      (a) => a.name === `bagsy-cli-${version}.tgz` && a.browser_download_url,
    ) ??
    json.assets?.find(
      (a) => a.name === `workboard-cli-${version}.tgz` && a.browser_download_url,
    );

  return {
    version,
    publishedAt: json.published_at,
    tarballUrl: asset?.browser_download_url ?? tarballUrlFor(version),
    channel: cliUpdateChannel(),
    delayHours: DELAY_HOURS,
  };
}

/** Latest CLI release + update channel (cached). */
export async function getCliUpdateInfo(): Promise<CliUpdateInfo | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return cache.info
      ? { ...cache.info, channel: cliUpdateChannel(), delayHours: DELAY_HOURS }
      : null;
  }
  try {
    const info = await fetchLatestRelease();
    cache = { at: now, info };
    return info
      ? { ...info, channel: cliUpdateChannel(), delayHours: DELAY_HOURS }
      : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cli update fetch failed:", message);
    if (cache?.info) {
      return { ...cache.info, channel: cliUpdateChannel(), delayHours: DELAY_HOURS };
    }
    cache = { at: now, info: null, error: message };
    return null;
  }
}
