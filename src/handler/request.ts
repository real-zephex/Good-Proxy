import { HonoRequest } from "hono";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "3600",
};

// Request headers that describe our edge or the browser's local environment
// rather than the origin request. Forwarding them upstream ranges from useless
// to harmful, so they are stripped before proxying.
const STRIPPED_REQUEST_HEADERS = [
  "host",
  "content-length",
  "accept-encoding",
  "connection",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-worker",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
];

/**
 * Build a path through the proxy for an absolute URL.
 *
 * The optional `ref` is carried along so that follow-up requests (nested
 * playlists, segments, pages, assets) keep the original referer.
 */
function toProxyUrl(target: string, ref?: string): string {
  return (
    "/fetch?url=" +
    encodeURIComponent(target) +
    (ref ? "&ref=" + encodeURIComponent(ref) : "")
  );
}

/**
 * Resolve a possibly-relative reference against `base` and rewrite it so it goes
 * through the proxy.
 *
 * - relative references ("img/logo.png", "../a.css") are completed with the base
 * - root-relative references ("/assets/x.js") are completed with the site origin
 * - absolute urls ("https://cdn/x.js") are kept as-is
 *
 * Returns null when the value must be left untouched: empty values, in-page
 * anchors ("#top") and non-http(s) schemes such as data:, blob:, mailto:,
 * javascript: or tel:.
 */
function proxyValue(value: string, base: string, ref?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  let resolved: URL;
  try {
    resolved = new URL(trimmed, base);
  } catch {
    return null;
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }

  return toProxyUrl(resolved.toString(), ref);
}

/**
 * Rewrite a srcset-style attribute: a comma separated list of
 * "url descriptor" candidates.
 */
function proxySrcset(value: string, base: string, ref?: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const piece = candidate.trim();
      if (!piece) return piece;
      const [url, ...descriptors] = piece.split(/\s+/);
      const proxied = proxyValue(url, base, ref);
      return [proxied ?? url, ...descriptors].join(" ");
    })
    .join(", ");
}

/** Rewrite every url(...) reference inside a chunk of CSS. */
function proxyCss(css: string, base: string, ref?: string): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, _quote, url) => {
      const proxied = proxyValue(url, base, ref);
      return proxied ? `url("${proxied}")` : match;
    }
  );
}

/** Handler rewriting a single URL-bearing attribute. */
function attributeRewriter(attribute: string, base: string, ref?: string) {
  return {
    element(element: Element) {
      const value = element.getAttribute(attribute);
      if (!value) return;
      const proxied = proxyValue(value, base, ref);
      if (proxied) element.setAttribute(attribute, proxied);
    },
  };
}

/** Handler rewriting a `srcset` attribute. */
function srcsetRewriter(attribute: string, base: string, ref?: string) {
  return {
    element(element: Element) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, proxySrcset(value, base, ref));
    },
  };
}

/** Handler rewriting url() references inside an inline `style` attribute. */
function styleAttributeRewriter(base: string, ref?: string) {
  return {
    element(element: Element) {
      const value = element.getAttribute("style");
      if (value) element.setAttribute("style", proxyCss(value, base, ref));
    },
  };
}

/** Handler rewriting url() references inside a <style> block. */
function styleElementRewriter(base: string, ref?: string) {
  let buffer = "";
  return {
    element() {
      buffer = "";
    },
    text(chunk: Text) {
      buffer += chunk.text;
      if (chunk.lastInTextNode) {
        chunk.replace(proxyCss(buffer, base, ref));
        buffer = "";
      } else {
        // Hold the fragment back until the whole text node is available.
        chunk.remove();
      }
    },
  };
}

// (selector, attribute) pairs whose value is a single URL.
const URL_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  ["a", "href"],
  ["area", "href"],
  ["link", "href"],
  ["script", "src"],
  ["img", "src"],
  ["iframe", "src"],
  ["frame", "src"],
  ["source", "src"],
  ["track", "src"],
  ["video", "src"],
  ["video", "poster"],
  ["audio", "src"],
  ["embed", "src"],
  ["object", "data"],
  ["form", "action"],
  ["input", "src"],
  ["button", "formaction"],
  ["blockquote", "cite"],
  ["q", "cite"],
];

/** Rewrite every URL reference in an HTML document so it points at the proxy. */
function rewriteHtml(response: Response, base: string, ref?: string): Response {
  const rewriter = new HTMLRewriter();

  for (const [selector, attribute] of URL_ATTRIBUTES) {
    rewriter.on(selector, attributeRewriter(attribute, base, ref));
  }

  for (const selector of ["img", "source"]) {
    rewriter.on(selector, srcsetRewriter("srcset", base, ref));
  }

  rewriter.on("[style]", styleAttributeRewriter(base, ref));
  rewriter.on("style", styleElementRewriter(base, ref));

  // Proxied assets no longer match their original SRI hashes, so drop it to
  // avoid the browser refusing to run/apply them.
  rewriter.on("[integrity]", {
    element(element: Element) {
      element.removeAttribute("integrity");
    },
  });

  return rewriter.transform(response);
}

/** Every Set-Cookie the upstream sent, on runtimes that expose the accessor. */
function readSetCookies(headers: Headers): string[] {
  const maybe = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof maybe.getSetCookie === "function") {
    return maybe.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * Make an upstream cookie usable on the proxy origin: drop the Domain (so it is
 * bound to the proxy host) and force Path=/ (so it is sent on /fetch?url=...
 * requests, regardless of the path it originally had).
 */
function sanitizeSetCookie(cookie: string): string {
  const [pair, ...attributes] = cookie.split(";");
  const kept = [pair.trim()];
  let hasPath = false;
  let hasSecure = false;

  for (const attribute of attributes) {
    const name = attribute.split("=")[0].trim().toLowerCase();
    if (name === "domain") continue;
    if (name === "path") {
      kept.push("Path=/");
      hasPath = true;
      continue;
    }
    if (name === "secure") hasSecure = true;
    kept.push(attribute.trim());
  }

  if (!hasPath) kept.push("Path=/");
  if (!hasSecure && kept.some((part) => /^samesite=none$/i.test(part))) {
    kept.push("Secure");
  }

  return kept.join("; ");
}

/**
 * Response headers for proxied content: the CORS set, the upstream content type
 * and any cookies the origin wanted to set (rewritten for the proxy origin).
 */
function buildResponseHeaders(type: string, upstream: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  headers.set("Content-Type", type);

  for (const cookie of readSetCookies(upstream)) {
    const sanitized = sanitizeSetCookie(cookie);
    if (sanitized) headers.append("Set-Cookie", sanitized);
  }

  return headers;
}

/** Small JSON error helper. */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function RequestHandler({ response }: { response: HonoRequest }) {
  try {
    const { url, ref } = response.query();
    const method = response.method;

    if (!url) {
      return jsonError("Missing 'url' query parameter", 400);
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return jsonError("Invalid 'url' query parameter", 400);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return jsonError("Only http(s) urls can be proxied", 400);
    }

    console.log(method, url);

    const hasBody = method !== "GET" && method !== "HEAD";

    // Forward the client's request headers, minus the ones that are about our
    // edge rather than the origin request.
    const upstreamHeaders = new Headers(response.header());
    for (const header of STRIPPED_REQUEST_HEADERS) {
      upstreamHeaders.delete(header);
    }
    // An explicit referer override wins; otherwise send no referer.
    upstreamHeaders.set("Referer", ref ? ref : "");
    // Let the origin see its own host in Origin so CSRF checks pass.
    if (upstreamHeaders.has("origin")) {
      upstreamHeaders.set("Origin", target.origin);
    }

    // `redirect: "manual"` keeps the origin's 3xx response (and its Set-Cookie)
    // instead of silently following it, so we can rewrite Location ourselves.
    const fetchedResponse = await fetch(url, {
      method,
      headers: upstreamHeaders,
      body: hasBody ? await response.raw.arrayBuffer() : undefined,
      redirect: "manual",
    });

    let type = fetchedResponse.headers.get("Content-Type") || "text/plain";
    console.log(type);

    // Redirects: route the Location through the proxy.
    if (
      fetchedResponse.status >= 300 &&
      fetchedResponse.status < 400 &&
      fetchedResponse.headers.has("location")
    ) {
      const headers = buildResponseHeaders(type, fetchedResponse.headers);
      const location = fetchedResponse.headers.get("location");
      if (location) {
        const proxied = proxyValue(location, url, ref);
        if (proxied) headers.set("Location", proxied);
      }
      return new Response(null, {
        status: fetchedResponse.status,
        statusText: fetchedResponse.statusText,
        headers,
      });
    }

    // Some servers serve playlists/segments with an HTML content-type. Keep
    // treating those as HLS rather than as documents.
    const playlistServedAsHtml =
      type.includes("text/html") &&
      (url.endsWith(".m3u8") || url.endsWith(".ts"));

    let responseBody: ArrayBuffer | string | null = null;

    // HTML documents: rewrite links and asset urls so the whole site is proxied.
    if (
      (type.includes("text/html") || type.includes("application/xhtml+xml")) &&
      !playlistServedAsHtml
    ) {
      console.log("HTML document found");
      const rewritten = rewriteHtml(fetchedResponse, url, ref);
      return new Response(rewritten.body, {
        status: rewritten.status,
        statusText: rewritten.statusText,
        headers: buildResponseHeaders(type, fetchedResponse.headers),
      });
    } else if (type.includes("text/css")) {
      console.log("CSS file found");
      const css = await fetchedResponse.text();
      responseBody = proxyCss(css, url, ref);
    } else if (type.includes("text/vtt")) {
      console.log("VTT file found");
      responseBody = (await fetchedResponse.text()) as string;

      // Rewrite image references, resolving them against the vtt url.
      const regex = /[^\s"'()<>,]+\.(?:jpe?g|png|webp)/gi;
      const matches = [...responseBody.matchAll(regex)];
      const fileNames = [...new Set(matches.map((match) => match[0]))];

      for (const filename of fileNames) {
        const proxied = proxyValue(filename, url, ref);
        if (proxied) {
          responseBody = (responseBody as string).replaceAll(filename, proxied);
        }
      }
    } else if (
      type.includes("application/vnd.apple.mpegurl") ||
      type.includes("application/x-mpegurl") ||
      type.includes("video/MP2T") ||
      type.includes("audio/mpegurl") ||
      type.includes("application/x-mpegURL") ||
      type.includes("audio/x-mpegurl") ||
      playlistServedAsHtml
      // including mp2t shouldn't be necessary but then there are some loose cases which report mp2t for m3u8 streams as well
    ) {
      responseBody = (await fetchedResponse.text()) as string;
      if (!responseBody.startsWith("#EXTM3U")) {
        return new Response(responseBody, {
          headers: buildResponseHeaders(type, fetchedResponse.headers),
          status: fetchedResponse.status,
          statusText: fetchedResponse.statusText,
        });
      }
      console.log("HLS stream found");

      // Resolve every reference (relative, root-relative or absolute) against
      // the playlist url and route it through the proxy.
      const m3u8AdjustedChunks = responseBody.split("\n").map((line) => {
        if (line.startsWith("#")) {
          // Keep tags intact but rewrite any URI="..." they carry (encryption
          // keys, init segments, alternative renditions, ...).
          return line.replace(/URI="([^"]+)"/gi, (match, uri) => {
            const proxied = proxyValue(uri, url, ref);
            return proxied ? `URI="${proxied}"` : match;
          });
        }

        if (!line.trim()) return line;

        return proxyValue(line, url, ref) ?? line;
      });

      responseBody = m3u8AdjustedChunks.join("\n");
    } else {
      responseBody = await fetchedResponse.arrayBuffer();
    }

    if (responseBody instanceof ArrayBuffer) {
      // Perform checks to determine if it's actually video data
      const body = new Uint8Array(responseBody);
      if (body.length > 0 && body[0] === 0x47) {
        // Simple TS packet start check
        console.log("disguised files found");
        type = "video/mp2t";
      }
    }

    return new Response(responseBody, {
      headers: buildResponseHeaders(type, fetchedResponse.headers),
      status: fetchedResponse.status,
      statusText: fetchedResponse.statusText,
    });
  } catch (error: any) {
    console.error(error);

    return new Response(
      JSON.stringify({ message: "Request failed", error: error.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json", // Set content type to JSON
        },
      }
    );
  }
}
