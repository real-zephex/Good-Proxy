import { HonoRequest } from "hono";

import type { Env } from "../types";
import { makeDebug } from "../lib/log";
import {
  charsetOf,
  decodeText,
  EXPOSED_RESPONSE_HEADERS,
  isCacheableType,
  cacheTtlSeconds,
  looksLikePlaylist,
  PASSTHROUGH_RESPONSE_HEADERS,
  proxyCss,
  proxySrcset,
  proxyValue,
  ProxyContext,
  readSetCookies,
  rewritePlaylist,
  rewriteVtt,
  sanitizeSetCookie,
  STRIPPED_REQUEST_HEADERS,
} from "../lib/url";
import { buildShimScript } from "./shim";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "3600",
};

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

/* ----------------------------- HTML rewriters ----------------------------- */

function attributeRewriter(attribute: string, ctx: ProxyContext) {
  return {
    element(element: Element) {
      const value = element.getAttribute(attribute);
      if (!value) return;
      const proxied = proxyValue(value, ctx);
      if (proxied) element.setAttribute(attribute, proxied);
    },
  };
}

function srcsetRewriter(attribute: string, ctx: ProxyContext) {
  return {
    element(element: Element) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, proxySrcset(value, ctx));
    },
  };
}

function styleAttributeRewriter(ctx: ProxyContext) {
  return {
    element(element: Element) {
      const value = element.getAttribute("style");
      if (value) element.setAttribute("style", proxyCss(value, ctx));
    },
  };
}

function styleElementRewriter(ctx: ProxyContext) {
  let buffer = "";
  return {
    element() {
      buffer = "";
    },
    text(chunk: Text) {
      buffer += chunk.text;
      if (chunk.lastInTextNode) {
        chunk.replace(proxyCss(buffer, ctx));
        buffer = "";
      } else {
        // Hold the fragment back until the whole text node is available.
        chunk.remove();
      }
    },
  };
}

/** Rewrite every URL reference in an HTML document, injecting the JS shim. */
function rewriteHtml(
  response: Response,
  ctx: ProxyContext,
  shimScript: string
): Response {
  const rewriter = new HTMLRewriter();

  for (const [selector, attribute] of URL_ATTRIBUTES) {
    rewriter.on(selector, attributeRewriter(attribute, ctx));
  }
  for (const selector of ["img", "source"]) {
    rewriter.on(selector, srcsetRewriter("srcset", ctx));
  }
  rewriter.on("[style]", styleAttributeRewriter(ctx));
  rewriter.on("style", styleElementRewriter(ctx));

  // Proxied assets no longer match their original SRI hashes.
  rewriter.on("[integrity]", {
    element(element: Element) {
      element.removeAttribute("integrity");
    },
  });

  // The shim must run before any page script. Inject it once, preferring the
  // earliest insertion point available: <html>, then <head>, then <body>.
  let shimInjected = false;
  const injectShim = {
    element(element: Element) {
      if (shimInjected) return;
      shimInjected = true;
      element.prepend(shimScript, { html: true });
    },
  };
  rewriter.on("html", injectShim);
  rewriter.on("head", injectShim);
  rewriter.on("body", injectShim);

  return rewriter.transform(response);
}

/* ------------------------------- responses -------------------------------- */

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Response headers for proxied content: CORS, content type, then a set of
 * origin headers (only when the body is untouched) and the origin's cookies
 * rewritten for this site's prefix.
 */
function buildHeaders(
  type: string,
  origin: Headers,
  ctx: ProxyContext,
  passthrough: boolean
): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  headers.set("Content-Type", type);
  headers.set("Access-Control-Expose-Headers", EXPOSED_RESPONSE_HEADERS);

  if (passthrough) {
    for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
      const value = origin.get(name);
      if (value) headers.set(name, value);
    }
    const length = origin.get("content-length");
    if (length) headers.set("Content-Length", length);
  }

  for (const cookie of readSetCookies(origin)) {
    const sanitized = sanitizeSetCookie(cookie, ctx.prefix);
    if (sanitized) headers.append("Set-Cookie", sanitized);
  }

  return headers;
}

/* --------------------------------- bodies --------------------------------- */

interface Peeked {
  first: Uint8Array | null;
  reader: ReadableStreamDefaultReader<Uint8Array>;
}

async function peekFirstChunk(
  body: ReadableStream<Uint8Array>
): Promise<Peeked> {
  const reader = body.getReader();
  const { value, done } = await reader.read();
  return { first: done || !value ? null : value, reader };
}

function continueStream(
  first: Uint8Array | null,
  reader: ReadableStreamDefaultReader<Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (first) controller.enqueue(first);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else if (value) controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function readAll(
  first: Uint8Array | null,
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = first ? [first] : [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Relabel a segment as mp2t when it carries the MPEG-TS sync byte. */
function sniffTsType(first: Uint8Array | null, type: string): string {
  if (first && first.length > 0 && first[0] === 0x47 && !/mp2t/i.test(type)) {
    return "video/mp2t";
  }
  return type;
}

interface BodyResult {
  body: BodyInit | null;
  type: string;
  rewritten: boolean;
}

/** Playlists and TS segments: peek, rewrite if it's a playlist, else stream. */
async function handlePlaylistish(
  response: Response,
  ctx: ProxyContext,
  type: string
): Promise<BodyResult> {
  if (!response.body) return { body: null, type, rewritten: false };
  const { first, reader } = await peekFirstChunk(response.body);

  if (first && looksLikePlaylist(first)) {
    const bytes = await readAll(first, reader);
    const text = decodeText(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      "utf-8"
    );
    return { body: rewritePlaylist(text, ctx), type, rewritten: true };
  }

  return {
    body: continueStream(first, reader),
    type: sniffTsType(first, type),
    rewritten: false,
  };
}

/** Opaque/binary content: stream it through, sniffing disguised TS. */
async function handleBinary(
  response: Response,
  type: string
): Promise<BodyResult> {
  if (!response.body) return { body: null, type, rewritten: false };
  const { first, reader } = await peekFirstChunk(response.body);
  return {
    body: continueStream(first, reader),
    type: sniffTsType(first, type),
    rewritten: false,
  };
}

/* -------------------------------- handler --------------------------------- */

export interface RequestHandlerArgs {
  response: HonoRequest;
  env?: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function RequestHandler({
  response,
  env,
  waitUntil,
}: RequestHandlerArgs) {
  const debug = makeDebug(env);

  try {
    const { url, ref } = response.query();
    const method = response.method;

    if (!url) return jsonError("Missing 'url' query parameter", 400);

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return jsonError("Invalid 'url' query parameter", 400);
    }

    const isWebSocket =
      (response.header("upgrade") || "").toLowerCase() === "websocket";
    const allowedProtocols = isWebSocket
      ? ["http:", "https:", "ws:", "wss:"]
      : ["http:", "https:"];
    if (!allowedProtocols.includes(target.protocol)) {
      return jsonError("Only http(s) urls can be proxied", 400);
    }

    const requestUrl = new URL(response.raw.url);
    const proxyOrigin = requestUrl.origin;
    const prefix = requestUrl.pathname.slice(
      0,
      requestUrl.pathname.lastIndexOf("fetch")
    );
    const ctx: ProxyContext = { base: url, prefix, origin: proxyOrigin, ref };

    debug(method, url);

    // --- WebSocket passthrough -------------------------------------------
    if (isWebSocket) {
      const wssTarget = new URL(target.toString());
      wssTarget.protocol = target.protocol === "wss:" ? "https:" : "http:";
      const wsHeaders = new Headers(response.header());
      for (const header of STRIPPED_REQUEST_HEADERS) wsHeaders.delete(header);
      wsHeaders.set("Upgrade", "websocket");
      if (wsHeaders.has("origin")) wsHeaders.set("Origin", target.origin);
      return await fetch(wssTarget.toString(), { headers: wsHeaders });
    }

    // --- request headers --------------------------------------------------
    const hasBody = method !== "GET" && method !== "HEAD";
    const upstreamHeaders = new Headers(response.header());
    for (const header of STRIPPED_REQUEST_HEADERS) {
      upstreamHeaders.delete(header);
    }
    upstreamHeaders.set("Referer", ref ? ref : "");
    if (upstreamHeaders.has("origin")) {
      upstreamHeaders.set("Origin", target.origin);
    }

    // --- cache lookup -----------------------------------------------------
    const cache: Cache | null =
      (globalThis as any).caches?.default ?? null;
    const cacheEligible = method === "GET" && !response.header("cookie");
    const cacheKey = cacheEligible ? new Request(requestUrl.toString()) : null;
    if (cache && cacheKey) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        debug("cache hit", url);
        return hit;
      }
    }

    // `redirect: "manual"` keeps the origin's 3xx (and its Set-Cookie) so we
    // can rewrite Location ourselves.
    const fetchedResponse = await fetch(url, {
      method,
      headers: upstreamHeaders,
      body: hasBody ? await response.raw.arrayBuffer() : undefined,
      redirect: "manual",
    });

    const originHeaders = fetchedResponse.headers;
    let type = originHeaders.get("Content-Type") || "text/plain";
    const status = fetchedResponse.status;

    debug(status, type);

    // --- redirects --------------------------------------------------------
    if (status >= 300 && status < 400 && originHeaders.has("location")) {
      const headers = buildHeaders(type, originHeaders, ctx, false);
      const location = originHeaders.get("location");
      if (location) {
        const proxied = proxyValue(location, ctx);
        if (proxied) headers.set("Location", proxied);
      }
      return new Response(null, {
        status,
        statusText: fetchedResponse.statusText,
        headers,
      });
    }

    // --- empty bodies -----------------------------------------------------
    // HEAD still describes the entity (Content-Length etc.), while 204/205/304
    // carry no entity at all, so do not copy entity headers for those.
    const entityless = status === 204 || status === 205 || status === 304;
    if (method === "HEAD" || entityless) {
      return new Response(null, {
        status,
        statusText: fetchedResponse.statusText,
        headers: buildHeaders(type, originHeaders, ctx, !entityless),
      });
    }

    // --- content dispatch -------------------------------------------------
    const playgroundByUrl =
      type.includes("text/html") && (url.endsWith(".m3u8") || url.endsWith(".ts"));
    const isHtml = type.includes("text/html") || type.includes("application/xhtml+xml");
    const isCss = type.includes("text/css");
    const isVtt = type.includes("text/vtt");
    const isHls = /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:mpegurl|x-mpegurl)/i.test(type);
    const isTs = /video\/mp2t/i.test(type);

    const cacheable = async (res: Response): Promise<Response> => {
      if (!cache || !cacheKey) return res;
      if (res.status !== 200 || !isCacheableType(type)) return res;
      if (readSetCookies(originHeaders).length > 0) return res;
      const ttl = cacheTtlSeconds(originHeaders) ?? 300;
      const stored = res.clone();
      stored.headers.set("Cache-Control", `max-age=${ttl}`);
      const put = cache.put(cacheKey, stored);
      if (waitUntil) waitUntil(put);
      else await put;
      return res;
    };

    // HTML
    if (isHtml && !playgroundByUrl) {
      const charset = charsetOf(originHeaders.get("content-type"));
      let source = fetchedResponse;
      if (charset !== "utf-8" && charset !== "utf8") {
        const bytes = await fetchedResponse.arrayBuffer();
        source = new Response(decodeText(bytes, charset), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const siteOrigin = new URL(ctx.base).origin;
      const shim = buildShimScript(siteOrigin, prefix, proxyOrigin);
      const rewritten = rewriteHtml(source, ctx, shim);
      return cacheable(
        new Response(rewritten.body, {
          status,
          statusText: fetchedResponse.statusText,
          headers: buildHeaders(
            isHtml && type.includes("xhtml") ? "application/xhtml+xml; charset=utf-8" : "text/html; charset=utf-8",
            originHeaders,
            ctx,
            false
          ),
        })
      );
    }

    // CSS
    if (isCss) {
      const charset = charsetOf(originHeaders.get("content-type"));
      const bytes = await fetchedResponse.arrayBuffer();
      const rewritten = proxyCss(decodeText(bytes, charset), ctx);
      return cacheable(
        new Response(rewritten, {
          status,
          statusText: fetchedResponse.statusText,
          headers: buildHeaders("text/css; charset=utf-8", originHeaders, ctx, false),
        })
      );
    }

    // WebVTT
    if (isVtt) {
      const charset = charsetOf(originHeaders.get("content-type"));
      const bytes = await fetchedResponse.arrayBuffer();
      const rewritten = rewriteVtt(decodeText(bytes, charset), ctx);
      return new Response(rewritten, {
        status,
        statusText: fetchedResponse.statusText,
        headers: buildHeaders("text/vtt; charset=utf-8", originHeaders, ctx, false),
      });
    }

    // Playlists / segments
    const result: BodyResult =
      isHls || isTs || playgroundByUrl
        ? await handlePlaylistish(fetchedResponse, ctx, type)
        : await handleBinary(fetchedResponse, type);

    return cacheable(
      new Response(result.body, {
        status,
        statusText: fetchedResponse.statusText,
        headers: buildHeaders(
          result.type,
          originHeaders,
          ctx,
          !result.rewritten
        ),
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[goodproxy] request failed", message);

    return new Response(
      JSON.stringify({ message: "Request failed", error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
