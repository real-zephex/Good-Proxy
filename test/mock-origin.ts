/**
 * A tiny fake origin used by the integration tests. It is registered as
 * Miniflare's `outboundService`, so every `fetch()` the Worker makes while
 * testing is answered here instead of hitting the network.
 */

const HTML = `<!doctype html><html><head></head><body>
<a href="/x">x</a>
<img src="img/a.png" srcset="img/a.png 1x, img/b.png 2x">
<a href="#top">anchor</a>
<a href="mailto:a@b.c">mail</a>
</body></html>`;

export async function mockOrigin(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== "site.test") {
    return new Response("unknown host", { status: 502 });
  }

  switch (url.pathname) {
    case "/":
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });

    case "/login": {
      if (request.method === "POST") {
        const body = await request.text();
        return new Response(body === "u=me" ? "ok" : "bad body", {
          status: body === "u=me" ? 200 : 400,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("", {
        status: 302,
        headers: {
          location: "/dashboard",
          "set-cookie": "sid=1; Domain=site.test; Path=/app; HttpOnly",
        },
      });
    }

    case "/none":
      return new Response(null, { status: 204 });

    case "/video.mp4":
      return new Response("data", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-3/100",
          "accept-ranges": "bytes",
        },
      });

    case "/master.m3u8":
      return new Response("#EXTM3U\n720p/index.m3u8\n", {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });

    case "/style.css":
      return new Response("body{background:url(bg.png)}", {
        headers: { "content-type": "text/css" },
      });

    default:
      return new Response("not found", { status: 404 });
  }
}
