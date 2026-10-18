# GoodProxy browser extension

A minimal Chrome/Edge (Manifest V3) extension that browses through a GoodProxy
instance. Every top-level page you open is routed to
`<origin>/p/<host>/fetch?url=<encodeURIComponent(url)>`. Because GoodProxy
rewrites all links and assets in the returned HTML (and injects a runtime shim),
the rest of the site stays on the proxy automatically.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.

## Use

- Just browse normally. Typing `nasa.gov` in the address bar opens it through
  the proxy.
- Click the toolbar button to toggle the extension on/off and open **Settings**.
- **Settings** holds the **proxy origin** (e.g.
  `https://goodproxy.zephex0-f6c.workers.dev`), not the full `/fetch` URL.

## How it works

`background.js` listens for `webNavigation.onBeforeNavigate` on the main frame
and redirects the tab to the proxy using a per-site prefix (`/p/<host>/`), which
is what isolates each site's cookies and `localStorage`. It skips non-http(s)
pages, respects the on/off toggle, and refuses to re-proxy the proxy origin
(redirect-loop guard). No `declarativeNetRequest` is used because its
`regexSubstitution` cannot percent-encode the captured URL, which an unencoded
`?`/`&` in a target URL would break.

## Known limitations

- **Address bar shows the proxy URL** (`…/p/<host>/fetch?url=…`), with a brief
  flash of the original URL first.
- **Runtime URLs are covered on a best-effort basis.** The injected shim patches
  `fetch`, `XMLHttpRequest`, `Worker`, `EventSource`, `WebSocket`, element `src`
  and `history`, but dynamic `import()`, blob-URL workers and non-rewritten
  iframes can still escape.
- Sites that pin certificates, detect proxying, or enforce anti-bot checks may
  still misbehave.
