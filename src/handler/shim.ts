/**
 * Builds the script injected into proxied HTML documents.
 *
 * It is prepended into `<head>` (and into `<html>` as a fallback for documents
 * with no head) so it runs before any page script. It wraps the browser APIs
 * that accept a URL — fetch, XHR, workers, event sources, websockets, element
 * `src`/`setAttribute` and history — so runtime URLs are routed through the
 * proxy too.
 *
 * Relative references resolve against the original site (the `SITE` constant),
 * because `location` is the proxy URL, not the site URL.
 *
 * Every patch group is guarded on its own, so one unsupported API cannot stop
 * the others from being installed. The script is idempotent: it returns early
 * if it has already run.
 */
export function buildShimScript(
  siteOrigin: string,
  prefix: string,
  proxyOrigin: string
): string {
  const proxyBase = `${proxyOrigin}${prefix}fetch?url=`;

  const body = `
(function () {
  if (window.__goodproxyShim) return;
  window.__goodproxyShim = true;

  var SITE = ${JSON.stringify(siteOrigin)};
  var PROXY = ${JSON.stringify(proxyBase)};
  var ORIGIN = ${JSON.stringify(proxyOrigin)};
  var SINGLE = { src: 1, href: 1, action: 1, poster: 1, data: 1, cite: 1, formaction: 1 };

  function safe(fn) {
    try { fn(); } catch (e) {}
  }

  // Resolve a runtime URL against the site and route it through the proxy.
  // Returns the input unchanged when it does not apply.
  function prox(u, allowWs) {
    if (u == null) return u;
    var s = String(u);
    if (!s || s.charAt(0) === '#') return u;
    var url;
    try { url = new URL(s, SITE); } catch (e) { return u; }
    if (url.origin === ORIGIN) return u;
    var p = url.protocol;
    if (p !== 'http:' && p !== 'https:' && !(allowWs && (p === 'ws:' || p === 'wss:'))) return u;
    return PROXY + encodeURIComponent(url.href);
  }

  function proxSrcset(v) {
    return String(v).split(',').map(function (candidate) {
      var parts = candidate.trim().split(/\\s+/);
      if (parts[0]) parts[0] = prox(parts[0], false);
      return parts.join(' ');
    }).join(', ');
  }

  safe(function () {
    var real = window.fetch;
    if (!real) return;
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') input = prox(input, false);
        else if (input && typeof input === 'object' && input.url) input = new Request(prox(input.url, false), input);
      } catch (e) {}
      return real.call(this, input, init);
    };
  });

  safe(function () {
    var XHR = window.XMLHttpRequest;
    if (!XHR || !XHR.prototype) return;
    var open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try { arguments[1] = prox(url, false); } catch (e) {}
      return open.apply(this, arguments);
    };
  });

  safe(function () {
    ['Worker', 'SharedWorker'].forEach(function (name) {
      var Ctor = window[name];
      if (!Ctor) return;
      var Wrapped = function (url, options) { return new Ctor(prox(url, false), options); };
      Wrapped.prototype = Ctor.prototype;
      window[name] = Wrapped;
    });
  });

  safe(function () {
    var ES = window.EventSource;
    if (!ES) return;
    var Wrapped = function (url, options) { return new ES(prox(url, false), options); };
    Wrapped.prototype = ES.prototype;
    window.EventSource = Wrapped;
  });

  safe(function () {
    var WS = window.WebSocket;
    if (!WS) return;
    var Wrapped = function (url, protocols) { return new WS(prox(url, true), protocols); };
    for (var key in WS) { Wrapped[key] = WS[key]; }
    Wrapped.prototype = WS.prototype;
    window.WebSocket = Wrapped;
  });

  safe(function () {
    var sw = window.navigator && window.navigator.serviceWorker;
    if (!sw || !sw.register) return;
    var register = sw.register.bind(sw);
    sw.register = function (url, options) { return register(prox(url, false), options); };
  });

  safe(function () {
    if (!window.importScripts) return;
    var original = window.importScripts.bind(window);
    window.importScripts = function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) { return prox(a, false); });
      return original.apply(null, args);
    };
  });

  // el.src = '...' for elements created from script.
  safe(function () {
    ['HTMLScriptElement', 'HTMLImageElement', 'HTMLIFrameElement', 'HTMLMediaElement',
     'HTMLSourceElement', 'HTMLEmbedElement', 'HTMLTrackElement'].forEach(function (name) {
      var Ctor = window[name];
      if (!Ctor || !Ctor.prototype) return;
      var descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, 'src');
      if (!descriptor || !descriptor.set) return;
      Object.defineProperty(Ctor.prototype, 'src', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: function (value) { descriptor.set.call(this, prox(value, false)); },
      });
    });
  });

  // el.setAttribute('src'|'href'|...) for frameworks that bypass properties.
  safe(function () {
    if (!window.Element || !window.Element.prototype) return;
    var setAttribute = window.Element.prototype.setAttribute;
    window.Element.prototype.setAttribute = function (name, value) {
      try {
        var key = String(name).toLowerCase();
        if (value != null && SINGLE[key]) arguments[1] = prox(value, false);
        else if (key === 'srcset' && value != null) arguments[1] = proxSrcset(value);
      } catch (e) {}
      return setAttribute.apply(this, arguments);
    };
  });

  safe(function () {
    if (!window.history) return;
    ['pushState', 'replaceState'].forEach(function (name) {
      var original = window.history[name];
      if (typeof original !== 'function') return;
      window.history[name] = function (state, title, url) {
        try { if (url != null) url = prox(url, false); } catch (e) {}
        return original.call(this, state, title, url);
      };
    });
  });
})();
`;

  return `<script>${body}</script>`;
}
