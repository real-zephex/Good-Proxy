/** The gateway page served at "/": paste a URL and browse it through the proxy. */
export function renderHome(proxyOrigin: string): string {
  const example = "https://example.com";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GoodProxy</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 10vh auto; padding: 0 1.5rem; }
  h1 { margin: 0 0 .25rem; }
  p.sub { margin: 0 0 1.5rem; color: #777; }
  form { display: flex; gap: .5rem; }
  input[type=url] { flex: 1; font: inherit; padding: .6rem .7rem; border: 1px solid #888; border-radius: 8px; }
  button { font: inherit; padding: .6rem 1rem; border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }
  code { background: rgba(127,127,127,.15); padding: .1rem .3rem; border-radius: 4px; }
</style>
</head>
<body>
  <h1>GoodProxy</h1>
  <p class="sub">Enter a URL to browse it through the proxy at <code>${escapeHtml(proxyOrigin)}</code>.</p>
  <form action="/go" method="get">
    <input type="url" name="url" placeholder="${example}" autofocus required>
    <button type="submit">Go</button>
  </form>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
