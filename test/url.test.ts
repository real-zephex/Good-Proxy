import { describe, expect, it } from "vitest";

import {
  cacheTtlSeconds,
  charsetOf,
  isCacheableType,
  looksLikePlaylist,
  proxyCss,
  proxySrcset,
  proxyValue,
  rewritePlaylist,
  rewriteVtt,
  sanitizeSetCookie,
  sitePrefix,
  type ProxyContext,
} from "../src/lib/url";

const ctx: ProxyContext = {
  base: "https://site.test/dir/page.html",
  prefix: "/p/site.test/",
  origin: "https://proxy.test",
};

const href = (target: string, extra = "") =>
  `/p/site.test/fetch?url=${encodeURIComponent(target)}${extra}`;

describe("proxyValue", () => {
  it("completes relative references", () => {
    expect(proxyValue("img/a.png", ctx)).toBe(
      href("https://site.test/dir/img/a.png")
    );
  });

  it("completes root-relative references with the origin", () => {
    expect(proxyValue("/x.js", ctx)).toBe(href("https://site.test/x.js"));
  });

  it("resolves parent segments", () => {
    expect(proxyValue("../up.html", ctx)).toBe(href("https://site.test/up.html"));
  });

  it("resolves protocol-relative references", () => {
    expect(proxyValue("//cdn.test/a.js", ctx)).toBe(
      href("https://cdn.test/a.js")
    );
  });

  it("keeps absolute urls", () => {
    expect(proxyValue("https://cdn.test/a.js", ctx)).toBe(
      href("https://cdn.test/a.js")
    );
  });

  it("leaves anchors and non-http schemes untouched", () => {
    expect(proxyValue("#top", ctx)).toBeNull();
    expect(proxyValue("", ctx)).toBeNull();
    expect(proxyValue("mailto:a@b.c", ctx)).toBeNull();
    expect(proxyValue("tel:+123", ctx)).toBeNull();
    expect(proxyValue("data:image/png;base64,AAAA", ctx)).toBeNull();
    expect(proxyValue("javascript:void(0)", ctx)).toBeNull();
  });

  it("propagates the referer", () => {
    expect(proxyValue("/x", { ...ctx, ref: "https://r.test/" })).toBe(
      href("https://site.test/x", "&ref=" + encodeURIComponent("https://r.test/"))
    );
  });
});

describe("proxySrcset", () => {
  it("rewrites every candidate and keeps descriptors", () => {
    expect(proxySrcset("a.png 1x, b.png 2x", ctx)).toBe(
      `${href("https://site.test/dir/a.png")} 1x, ${href(
        "https://site.test/dir/b.png"
      )} 2x`
    );
  });
});

describe("proxyCss", () => {
  it("rewrites url() forms", () => {
    const css = `a{background:url(x.png)}b{background:url('y.png')}c{background:url("z.png")}`;
    const out = proxyCss(css, ctx);
    expect(out).toContain(`url("${href("https://site.test/dir/x.png")}")`);
    expect(out).toContain(`url("${href("https://site.test/dir/y.png")}")`);
    expect(out).toContain(`url("${href("https://site.test/dir/z.png")}")`);
  });

  it("leaves data uris and fragments alone", () => {
    const css = `a{background:url(data:image/png;base64,AA)}b{fill:url(#g)}`;
    expect(proxyCss(css, ctx)).toBe(css);
  });
});

describe("looksLikePlaylist", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("detects playlists, BOM and whitespace", () => {
    expect(looksLikePlaylist(bytes("#EXTM3U\n"))).toBe(true);
    expect(looksLikePlaylist(bytes("\uFEFF#EXTM3U\n"))).toBe(true);
    expect(looksLikePlaylist(bytes("\n  #EXTM3U\n"))).toBe(true);
  });
  it("rejects segments", () => {
    expect(looksLikePlaylist(bytes("\x47\x40\x11"))).toBe(false);
    expect(looksLikePlaylist(bytes(""))).toBe(false);
  });
});

describe("rewritePlaylist", () => {
  it("rewrites segments, absolute urls and tag URIs", () => {
    const body = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      "720p/index.m3u8",
      "/abs/1080p/index.m3u8",
      "https://cdn.test/seg.ts",
      "../up.ts",
      "",
    ].join("\n");

    expect(rewritePlaylist(body, ctx)).toBe(
      [
        "#EXTM3U",
        `#EXT-X-KEY:METHOD=AES-128,URI="${href("https://site.test/dir/key.bin")}"`,
        href("https://site.test/dir/720p/index.m3u8"),
        href("https://site.test/abs/1080p/index.m3u8"),
        href("https://cdn.test/seg.ts"),
        href("https://site.test/up.ts"),
        "",
      ].join("\n")
    );
  });
});

describe("rewriteVtt", () => {
  it("rewrites thumbnails and keeps fragments", () => {
    const body = "thumbs/t.jpg#xywh=0,0,160,90\n";
    expect(rewriteVtt(body, ctx)).toBe(
      href("https://site.test/dir/thumbs/t.jpg") + "#xywh=0,0,160,90\n"
    );
  });
});

describe("sanitizeSetCookie", () => {
  it("drops Domain and forces the site path", () => {
    expect(
      sanitizeSetCookie("sid=1; Domain=site.test; Path=/app; HttpOnly", "/p/site.test/")
    ).toBe("sid=1; Path=/p/site.test/; HttpOnly");
  });

  it("adds Path when missing and Secure for SameSite=None", () => {
    expect(sanitizeSetCookie("a=1; SameSite=None", "/p/s/")).toBe(
      "a=1; SameSite=None; Path=/p/s/; Secure"
    );
  });

  it("keeps Secure when already present", () => {
    expect(sanitizeSetCookie("a=1; Secure; SameSite=None", "/")).toBe(
      "a=1; Secure; SameSite=None; Path=/"
    );
  });
});

describe("header/content helpers", () => {
  it("detects cacheable types", () => {
    expect(isCacheableType("text/css; charset=utf-8")).toBe(true);
    expect(isCacheableType("image/png")).toBe(true);
    expect(isCacheableType("application/javascript")).toBe(true);
    expect(isCacheableType("font/woff2")).toBe(true);
    expect(isCacheableType("text/html")).toBe(false);
    expect(isCacheableType("application/vnd.apple.mpegurl")).toBe(false);
  });

  it("reads max-age", () => {
    expect(cacheTtlSeconds(new Headers({ "cache-control": "public, max-age=60" }))).toBe(60);
    expect(cacheTtlSeconds(new Headers({ "cache-control": "max-age=99999" }))).toBe(3600);
    expect(cacheTtlSeconds(new Headers({}))).toBeNull();
  });

  it("parses charset", () => {
    expect(charsetOf("text/html; charset=ISO-8859-1")).toBe("iso-8859-1");
    expect(charsetOf("text/html")).toBe("utf-8");
    expect(charsetOf(null)).toBe("utf-8");
  });

  it("builds the site prefix", () => {
    expect(sitePrefix("nasa.gov")).toBe("/p/nasa.gov/");
    expect(sitePrefix("localhost:8899")).toBe("/p/localhost%3A8899/");
  });
});
