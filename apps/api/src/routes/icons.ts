import { Hono } from "hono";
import {
  appleTouchIcon,
  favicon32Png,
  faviconIco,
  faviconSvg,
} from "../web/icons.js";

// Mounted ahead of webRoutes so icon requests skip session loading entirely.
export const iconRoutes = new Hono();

const CACHE = "public, max-age=604800";

function binary(body: Buffer, type: string): Response {
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": type, "Cache-Control": CACHE },
  });
}

iconRoutes.get("/favicon.svg", (c) =>
  c.body(faviconSvg, 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": CACHE,
  }),
);

iconRoutes.get("/favicon.ico", () => binary(faviconIco, "image/x-icon"));

iconRoutes.get("/favicon-32.png", () => binary(favicon32Png, "image/png"));

iconRoutes.get("/apple-touch-icon.png", () =>
  binary(appleTouchIcon, "image/png"),
);
