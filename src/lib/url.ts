/**
 * Pure URL / cookie / header helpers.
 *
 * Nothing here touches Cloudflare-only globals, so it can be unit tested in a
 * plain runtime as well as inside workerd.
 */

/** Everything needed to rewrite a reference back through the proxy. */
export interface ProxyContext {
  /** Original target URL, used to resolve relative references. */
  base: string;
  /** Path prefix scoping the site, e.g. "/p/nasa.gov/" or (legacy) "/". */
  prefix: string;
  /** Origin of the proxy itself, e.g. "https://goodproxy.example.workers.dev". */
  origin: string;
  /** Referer to propagate to child requests. */
  ref?: string;
}

/** Request headers that describe our edge rather than the origin request. */
export const STRIPPED_REQUEST_HEADERS = [
  "host",
  "content-length",
  "accept-encoding",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-worker",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
];

/** Response headers copied straight through from the origin. */
export const PASSTHROUGH_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-language",
  "content-range",
  "etag",
  "expires",
  "last-modified",
  "vary",
];

/** Response headers browser JS is allowed to read through CORS. */
export const EXPOSED_RESPONSE_HEADERS =
  "Content-Length, Content-Range, Accept-Ranges, Content-Disposition";

/** Path prefix that scopes a site's cookies/storage, e.g. "/p/nasa.gov/". */
export function sitePrefix(host: string): string {
  return "/p/" + encodeURIComponent(host) + "/";
}

/** Build the path (through the proxy) for an absolute URL. */
export function proxyHref(target: string, ctx: ProxyContext): string {
  const suffix = ctx.ref ? "&ref=" + encodeURIComponent(ctx.ref) : "";
  return `${ctx.prefix}fetch?url=${encodeURIComponent(target)}${suffix}`;
}

/**
 * Resolve a possibly-relative reference against the site and rewrite it so it
 * goes through the proxy.
 *
 * - relative references ("img/logo.png", "../a.css") complete against the site
 * - root-relative references ("/assets/x.js") complete with the site origin
 * - absolute urls ("https://cdn/x.js") are kept as-is
 *
 * Returns null for values that must be left untouched: empty values, in-page
 * anchors ("#top") and non-http(s) schemes such as data:, blob:, mailto:,
 * javascript: or tel:.
 */
export function proxyValue(value: string, ctx: ProxyContext): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  let resolved: URL;
  try {
    resolved = new URL(trimmed, ctx.base);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }
  return proxyHref(resolved.toString(), ctx);
}

/** Rewrite a srcset-style attribute ("url descriptor, url descriptor"). */
export function proxySrcset(value: string, ctx: ProxyContext): string {
  return value
    .split(",")
    .map((candidate) => {
      const piece = candidate.trim();
      if (!piece) return piece;
      const [url, ...descriptors] = piece.split(/\s+/);
      const proxied = proxyValue(url, ctx);
      return [proxied ?? url, ...descriptors].join(" ");
    })
    .join(", ");
}

/** Rewrite every url(...) reference inside a chunk of CSS. */
export function proxyCss(css: string, ctx: ProxyContext): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, _quote, url) => {
      const proxied = proxyValue(url, ctx);
      return proxied ? `url("${proxied}")` : match;
    }
  );
}

/** True when a body is an M3U8 playlist (allowing a BOM / leading whitespace). */
export function looksLikePlaylist(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  ) {
    i++;
  }
  const tag = "#EXTM3U";
  if (i + tag.length > bytes.length) return false;
  for (let j = 0; j < tag.length; j++) {
    if (bytes[i + j] !== tag.charCodeAt(j)) return false;
  }
  return true;
}

/** Rewrite every reference in an HLS playlist, tags included. */
export function rewritePlaylist(body: string, ctx: ProxyContext): string {
  return body
    .split("\n")
    .map((line) => {
      if (line.startsWith("#")) {
        // Keep tags intact but rewrite the URI="..." they carry (keys, init
        // segments, alternate renditions, ...).
        return line.replace(/URI="([^"]+)"/gi, (match, uri) => {
          const proxied = proxyValue(uri, ctx);
          return proxied ? `URI="${proxied}"` : match;
        });
      }
      if (!line.trim()) return line;
      return proxyValue(line, ctx) ?? line;
    })
    .join("\n");
}

/** Rewrite image references in a WebVTT file (subtitle thumbnails). */
export function rewriteVtt(body: string, ctx: ProxyContext): string {
  const regex = /[^\s"'()<>,]+\.(?:jpe?g|png|webp)/gi;
  const names = [...new Set([...body.matchAll(regex)].map((match) => match[0]))];
  let out = body;
  for (const name of names) {
    const proxied = proxyValue(name, ctx);
    if (proxied) out = out.replaceAll(name, proxied);
  }
  return out;
}

/** Every Set-Cookie the upstream sent, on runtimes that expose the accessor. */
export function readSetCookies(headers: Headers): string[] {
  const maybe = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof maybe.getSetCookie === "function") {
    return maybe.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * Make an upstream cookie usable on the proxy origin: drop Domain (bind it to
 * the proxy host) and force Path to the site prefix so it is sent on that
 * site's /fetch requests and nothing else.
 */
export function sanitizeSetCookie(cookie: string, path = "/"): string {
  const [pair, ...attributes] = cookie.split(";");
  const kept = [pair.trim()];
  let hasPath = false;
  let hasSecure = false;

  for (const attribute of attributes) {
    const name = attribute.split("=")[0].trim().toLowerCase();
    if (name === "domain") continue;
    if (name === "path") {
      kept.push(`Path=${path}`);
      hasPath = true;
      continue;
    }
    if (name === "secure") hasSecure = true;
    kept.push(attribute.trim());
  }

  if (!hasPath) kept.push(`Path=${path}`);
  if (!hasSecure && kept.some((part) => /^samesite=none$/i.test(part))) {
    kept.push("Secure");
  }

  return kept.join("; ");
}

/** Lowercased charset from a Content-Type header (defaults to utf-8). */
export function charsetOf(contentType: string | null): string {
  if (!contentType) return "utf-8";
  const match = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType);
  return match ? match[1].toLowerCase() : "utf-8";
}

/** Decode bytes using the given charset, falling back to utf-8. */
export function decodeText(bytes: ArrayBuffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Content types worth caching at the edge (never HTML or playlists). */
export function isCacheableType(type: string): boolean {
  return /^\s*(?:text\/css|text\/javascript|application\/javascript|image\/|font\/|application\/(?:font|x-font))/i.test(
    type
  );
}

/** Cache lifetime in seconds derived from Cache-Control, capped at one hour. */
export function cacheTtlSeconds(headers: Headers): number | null {
  const cacheControl = headers.get("cache-control") || "";
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl);
  if (!match) return null;
  return Math.min(parseInt(match[1], 10), 3600);
}
