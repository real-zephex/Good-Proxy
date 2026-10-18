import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

const enc = encodeURIComponent;
const proxy = (site: string, target: string) =>
  `https://proxy.test/p/${site}/fetch?url=${enc(target)}`;

it("rewrites HTML links, srcset and injects the shim", async () => {
  const res = await SELF.fetch(proxy("site.test", "https://site.test/"));
  const body = await res.text();

  expect(res.headers.get("content-type")).toContain("text/html");
  expect(body).toContain(`/p/site.test/fetch?url=${enc("https://site.test/x")}`);
  expect(body).toContain(
    `/p/site.test/fetch?url=${enc("https://site.test/img/a.png")}`
  );
  expect(body).toContain(
    `/p/site.test/fetch?url=${enc("https://site.test/img/b.png")}`
  );
  expect(body).toContain('href="#top"');
  expect(body).toContain('href="mailto:a@b.c"');
  expect(body).toContain("__goodproxyShim");
});

it("rewrites redirects and sanitizes cookies for the site prefix", async () => {
  const res = await SELF.fetch(proxy("site.test", "https://site.test/login"), {
    redirect: "manual",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(
    `/p/site.test/fetch?url=${enc("https://site.test/dashboard")}`
  );
  expect(res.headers.getSetCookie()).toEqual([
    "sid=1; Path=/p/site.test/; HttpOnly",
  ]);
});

it("forwards POST bodies upstream", async () => {
  const res = await SELF.fetch(proxy("site.test", "https://site.test/login"), {
    method: "POST",
    body: "u=me",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
});

it("returns an empty body for 204", async () => {
  const res = await SELF.fetch(proxy("site.test", "https://site.test/none"));
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
});

it("passes through range-related response headers", async () => {
  const res = await SELF.fetch(
    proxy("site.test", "https://site.test/video.mp4")
  );
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toBe("bytes 0-3/100");
  expect(res.headers.get("accept-ranges")).toBe("bytes");
});

it("rewrites CSS url() references", async () => {
  const res = await SELF.fetch(proxy("site.test", "https://site.test/style.css"));
  expect(res.headers.get("content-type")).toContain("text/css");
  expect(await res.text()).toBe(
    `body{background:url("/p/site.test/fetch?url=${enc(
      "https://site.test/bg.png"
    )}")}`
  );
});

it("rewrites HLS playlists", async () => {
  const res = await SELF.fetch(
    proxy("site.test", "https://site.test/master.m3u8")
  );
  const body = new TextDecoder().decode(await res.arrayBuffer());
  expect(body).toBe(
    `#EXTM3U\n/p/site.test/fetch?url=${enc("https://site.test/720p/index.m3u8")}\n`
  );
});

it("rejects missing and non-http urls", async () => {
  const missing = await SELF.fetch("https://proxy.test/fetch");
  expect(missing.status).toBe(400);

  const bad = await SELF.fetch(
    `https://proxy.test/fetch?url=${enc("file:///etc/passwd")}`
  );
  expect(bad.status).toBe(400);
});

it("serves the gateway page and redirects /go to the prefixed fetch", async () => {
  const home = await SELF.fetch("https://proxy.test/");
  expect(await home.text()).toContain("GoodProxy");

  const go = await SELF.fetch(
    `https://proxy.test/go?url=${enc("https://site.test/x")}`,
    { redirect: "manual" }
  );
  expect(go.status).toBe(302);
  expect(go.headers.get("location")).toBe(
    `/p/site.test/fetch?url=${enc("https://site.test/x")}`
  );
});
