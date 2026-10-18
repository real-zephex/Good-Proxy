// Default GoodProxy deployment. Override it from the extension's options page.
const DEFAULT_PROXY_ORIGIN = "https://goodproxy.zephex0-f6c.workers.dev";

async function getConfig() {
  const stored = await chrome.storage.sync.get(["proxyOrigin", "enabled"]);
  let proxyOrigin = stored.proxyOrigin || DEFAULT_PROXY_ORIGIN;
  // Back-compat: older configs stored the full "/fetch?url=" base.
  const legacy = proxyOrigin.indexOf("/fetch?url=");
  if (legacy !== -1) proxyOrigin = proxyOrigin.slice(0, legacy);
  return {
    proxyOrigin: proxyOrigin.replace(/\/+$/, ""),
    enabled: stored.enabled !== false,
  };
}

/**
 * Route top-level navigations through the proxy.
 *
 * Only the main frame needs handling: GoodProxy rewrites every link and asset
 * inside the returned HTML (and injects a runtime shim), so the rest of the
 * site stays on the proxy once the document is proxied.
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

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

  const { proxyOrigin, enabled } = await getConfig();
  if (!enabled) return;

  let origin;
  try {
    origin = new URL(proxyOrigin).origin;
  } catch {
    return;
  }

  // Never proxy the proxy itself; this is the redirect-loop guard.
  if (parsed.origin === origin) return;

  const target =
    `${origin}/p/${encodeURIComponent(parsed.host)}` +
    `/fetch?url=${encodeURIComponent(url)}`;

  try {
    await chrome.tabs.update(tabId, { url: target });
  } catch {
    // The tab may have been closed or superseded; nothing to do.
  }
}
