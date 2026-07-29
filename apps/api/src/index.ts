import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { apiRoutes } from "./routes/api.js";
import { iconRoutes } from "./routes/icons.js";
import { webRoutes } from "./routes/web.js";

const app = new Hono();

app.use(
  "*",
  cors({
    // CLI uses Bearer tokens (no cookies). Browser UI is same-origin.
    origin: process.env.APP_URL?.replace(/\/$/, "") || "*",
    allowHeaders: ["Authorization", "Content-Type", "X-Workboard-Org", "X-Bagsy-Org"],
  }),
);

app.route("/", iconRoutes);
app.route("/", webRoutes);
app.route("/", apiRoutes);

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: "validation_error", details: err.flatten() }, 400);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  const expose = process.env.NODE_ENV !== "production";
  return c.json(
    {
      error: "internal_error",
      ...(expose ? { message: err instanceof Error ? err.message : String(err) } : {}),
    },
    500,
  );
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`bagsy api listening on :${port}`);
});

export default app;
