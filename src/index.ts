import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { corsHeaders, RequestHandler } from "./handler/request";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.options("/fetch", (c) => {
  return new Response("", { headers: corsHeaders, status: 204 });
});

app.get("/fetch", async (c) => {
  const data = await RequestHandler({ response: c.req });
  return data;
});

export default app;
