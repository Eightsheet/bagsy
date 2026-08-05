// Idle spin-down supervisor (roadmap R6). Holds $PORT with near-zero RAM,
// spawns dist/index.js on demand, proxies to it, and SIGTERMs it after
// SLEEP_IDLE_MS without traffic. No app imports, no dependencies — this
// process must stay tiny.
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);
const INTERNAL_PORT = Number(process.env.SLEEP_INTERNAL_PORT ?? PORT + 1);
const IDLE_MS = Number(process.env.SLEEP_IDLE_MS ?? 10 * 60 * 1000);
const SWEEP_MS = Math.min(30 * 1000, Math.max(1000, Math.floor(IDLE_MS / 3)));
const BOOT_TIMEOUT_MS = 15 * 1000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DISABLED = process.env.SLEEP_DISABLED === "1";

const SERVER_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");

type State = "stopped" | "starting" | "running" | "stopping";
let state: State = "stopped";
let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;
let exited: Promise<void> = Promise.resolve();
let lastActivity = Date.now();
let inflight = 0;
let shuttingDown = false;
let everBooted = false;

const log = (msg: string) => console.log(`[sleeper] ${msg}`);

function pingChild(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: INTERNAL_PORT, path: "/health", timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startChild(): Promise<void> {
  if (starting) return starting;
  state = "starting";
  const begun = Date.now();
  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(INTERNAL_PORT) },
    stdio: "inherit",
  });
  child = proc;
  exited = new Promise((resolve) => {
    proc.once("exit", (code, signal) => {
      if (child === proc) {
        child = null;
        starting = null;
        if (state !== "stopping" && !shuttingDown) {
          log(`server exited unexpectedly (${signal ?? code})`);
          // In always-on mode the container must die with the app, exactly
          // like running dist/index.js directly (Railway restarts it).
          if (DISABLED) process.exit(typeof code === "number" ? code : 1);
        }
        state = "stopped";
      }
      resolve();
    });
  });
  starting = (async () => {
    while (Date.now() - begun < BOOT_TIMEOUT_MS) {
      if (child !== proc) throw new Error("server died during boot");
      if (await pingChild()) {
        state = "running";
        everBooted = true;
        log(`awake on :${INTERNAL_PORT} after ${Date.now() - begun}ms`);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    proc.kill("SIGKILL");
    throw new Error("server failed to boot within 15s");
  })();
  starting.catch(() => {
    starting = null;
    if (child === proc) state = "stopped";
  });
  return starting;
}

async function ensureRunning(): Promise<void> {
  if (state === "running") return;
  if (state === "stopping") await exited;
  if (state === "starting" && starting) return starting;
  return startChild();
}

function stopChild() {
  if (!child || state !== "running") return;
  state = "stopping";
  log(`idle for ${Math.round((Date.now() - lastActivity) / 1000)}s — going to sleep`);
  child.kill("SIGTERM");
}

if (!DISABLED) {
  setInterval(() => {
    if (state === "running" && inflight === 0 && Date.now() - lastActivity >= IDLE_MS) {
      stopChild();
    }
  }, SWEEP_MS).unref();
}

// Hop-by-hop headers must not be forwarded (RFC 9110 §7.6.1); content-length
// is recomputed from the buffered body.
const SKIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

class BodyTooLargeError extends Error {}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Don't destroy the socket — the 413 still has to reach the client.
        // Drain and discard the rest; the response carries connection: close.
        req.removeAllListeners("data");
        req.resume();
        reject(new BodyTooLargeError("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forward(req: http.IncomingMessage, body: Buffer): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = { "content-length": body.length };
    for (const [k, v] of Object.entries(req.headers)) {
      if (!SKIP_HEADERS.has(k)) headers[k] = v;
    }
    const upstream = http.request(
      { host: "127.0.0.1", port: INTERNAL_PORT, method: req.method, path: req.url, headers },
      resolve,
    );
    upstream.on("error", reject);
    upstream.end(body);
  });
}

const listener = http.createServer(async (req, res) => {
  // Answer /health directly while asleep so healthchecks and uptime probes
  // don't keep the app awake. While the child is starting (including the
  // eager boot the deploy healthcheck sees) the request falls through and
  // waits for the real app, so a probe never reports ok for an app that
  // can't boot.
  // everBooted: until the app has proven it can boot once, probes must go
  // through to it — a failed eager boot may not look healthy from the outside.
  if (req.url === "/health" && everBooted && (state === "stopped" || state === "stopping")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, asleep: true }));
    return;
  }
  inflight++;
  let counted = true;
  const done = () => {
    if (!counted) return;
    counted = false;
    inflight--;
    lastActivity = Date.now();
  };
  lastActivity = Date.now();
  // On Node >= 15 "close" fires per response (keep-alive included); "finish"
  // is belt and braces so a missed close can never pin inflight above zero.
  res.on("close", done);
  res.on("finish", done);
  try {
    const body = await readBody(req);
    // Two attempts: the child can die between the state check and the
    // request (idle kill racing an incoming call). Body is buffered, so a
    // retry resends it intact.
    for (let attempt = 0; ; attempt++) {
      await ensureRunning();
      try {
        const upRes = await forward(req, body);
        const headers: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (!SKIP_HEADERS.has(k)) headers[k] = v;
        }
        res.writeHead(upRes.statusCode ?? 502, headers);
        upRes.on("error", () => res.destroy());
        upRes.pipe(res);
        return;
      } catch (err) {
        if (attempt >= 1) throw err;
      }
    }
  } catch (err) {
    log(`request failed: ${err instanceof Error ? err.message : err}`);
    if (!res.headersSent) {
      if (err instanceof BodyTooLargeError) {
        res.writeHead(413, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
      } else {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "upstream_unavailable" }));
      }
    } else {
      res.destroy();
    }
  }
});

listener.listen(PORT, () => {
  log(`listening on :${PORT} (idle timeout ${DISABLED ? "disabled" : `${IDLE_MS / 1000}s`})`);
  // Eager first boot: the deploy healthcheck should verify the real app once.
  ensureRunning().catch((err) => log(`initial boot failed: ${err.message}`));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal} — shutting down`);
    shuttingDown = true;
    child?.kill("SIGTERM");
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
