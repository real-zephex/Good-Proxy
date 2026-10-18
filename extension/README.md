# GoodProxy browser extension

A minimal Chrome/Edge (Manifest V3) extension that browses through a GoodProxy
instance. Every top-level page you open is routed to
`<proxyBase><encodeURIComponent(url)>`, and because GoodProxy rewrites all the
links and assets inside the returned HTML, the rest of the site stays on the
proxy automatically.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.

## Use

- Just browse normally. Typing `nasa.gov` in the address bar opens it through
  the proxy.
- Click the toolbar button to toggle the extension on/off and open **Settings**.
- **Settings** holds the proxy base URL. It defaults to
  `https://goodproxy.zephex0-f6c.workers.dev/fetch?url=` — change it to your
  own deployment.

## How it works

`background.js` listens for `webNavigation.onBeforeNavigate` on the main frame
and redirects the tab to the proxy. It skips non-http(s) pages, respects the
on/off toggle, and refuses to re-proxy the proxy origin (redirect-loop guard).
No `declarativeNetRequest` is used because its `regexSubstitution` cannot
percent-encode the captured URL, which an unencoded `?`/`&` in a target URL
would break.

## Known limitations

- **Address bar shows the proxy URL** (`…/fetch?url=…`), and you may see a brief
  flash of the original URL first.
- **URLs built in JavaScript are not rewritten.** Only static HTML attributes
  are. `fetch('/api')`, dynamic `import()`, `new Worker` and WebSockets resolve
  against the proxy origin and will generally fail.
- **Sessions are shared.** All sites live on the single proxy origin, so cookies
  and `localStorage` can collide between sites. The Worker now forwards
  `Set-Cookie` (rewritten for the proxy origin) and login POSTs, so logging in
  works for one site at a time, but switching between sites that reuse the same
  cookie names may drop the other session.
- Sites that pin certificates, detect proxying, or enforce CSP/anti-bot checks
  may still misbehave.
