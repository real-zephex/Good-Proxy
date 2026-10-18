// Default GoodProxy endpoint. Matches the value used in the project's
// .env.local; override it from the extension's options page.
const DEFAULT_PROXY_BASE = "https://goodproxy.zephex0-f6c.workers.dev/fetch?url=";

async function getConfig() {
  const stored = await chrome.storage.sync.get(["proxyBase", "enabled"]);
  return {
    proxyBase: stored.proxyBase || DEFAULT_PROXY_BASE,
    enabled: stored.enabled !== false,
  };
}

/**
 * Route top-level navigations through the proxy.
 *
 * Only the main frame needs handling: GoodProxy rewrites every link and asset
 * inside the returned HTML to `/fetch?url=...`, so clicks, images, stylesheets
 * and iframes already stay on the proxy once the document itself is proxied.
 */
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  handleNavigation(details.tabId, details.url);
});

async function handleNavigation(tabId, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  // Only real web pages.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

  const { proxyBase, enabled } = await getConfig();
  if (!enabled) return;

  if (!proxyBase.includes("url=")) return;

  let proxyOrigin;
  try {
    proxyOrigin = new URL(proxyBase).origin;
  } catch {
    return;
  }

  // Never proxy the proxy itself; this is the redirect-loop guard.
  if (parsed.origin === proxyOrigin) return;

  try {
    await chrome.tabs.update(tabId, {
      url: proxyBase + encodeURIComponent(url),
    });
  } catch {
    // The tab may have been closed or superseded; nothing to do.
  }
}
