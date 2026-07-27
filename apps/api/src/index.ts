import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { apiRoutes } from "./routes/api.js";
import { webRoutes } from "./routes/web.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

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
  return c.json({ error: "internal_error", message: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`workboard api listening on :${port}`);
});

export default app;
