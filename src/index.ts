import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import type { Env } from "./types";
import { RequestHandler } from "./handler/request";
import { renderHome } from "./handler/home";
import { sitePrefix } from "./lib/url";

const app = new Hono<{ Bindings: Env }>();

// Request logging only when DEBUG is enabled.
const requestLogger = logger();
app.use("/*", async (c, next) => {
  if (c.env?.DEBUG) return requestLogger(c, next);
  return next();
});

app.use("/*", cors());

app.get("/", (c) => c.html(renderHome(c.env?.PROXY_URL || new URL(c.req.url).origin)));

// Tiny redirector used by the gateway form: /go?url=<target>
app.get("/go", (c) => {
  const url = c.req.query("url");
  if (!url) return c.redirect("/");

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return c.text("Invalid url", 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return c.text("Only http(s) urls can be proxied", 400);
  }

  return c.redirect(
    `${sitePrefix(target.host)}fetch?url=${encodeURIComponent(target.toString())}`
  );
});

// Accept every method so form submissions and API calls (POST/PUT/...)
// can be forwarded upstream, not just GET navigations.
const handle = async (c: any) => {
  const waitUntil = (promise: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(promise);
    } catch {
      // No execution context (e.g. unit tests); let the promise settle alone.
    }
  };
  return RequestHandler({ response: c.req, env: c.env, waitUntil });
};

app.all("/fetch", handle);
app.all("/p/:site/fetch", handle);

export default app;
