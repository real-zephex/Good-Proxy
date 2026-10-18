import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import { RequestHandler } from "./handler/request";

const app = new Hono();

app.use(logger());
app.use("/*", cors());

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Accept every method so form submissions and API calls (POST/PUT/...)
// can be forwarded upstream, not just GET navigations.
app.all("/fetch", async (c) => {
  const data = await RequestHandler({ response: c.req });
  return data;
});

export default app;
