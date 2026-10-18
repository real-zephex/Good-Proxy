const DEFAULT_PROXY_BASE = "https://goodproxy.zephex0-f6c.workers.dev/fetch?url=";

const enabledEl = document.getElementById("enabled");
const targetEl = document.getElementById("target");

async function refresh() {
  const { proxyBase = DEFAULT_PROXY_BASE, enabled = true } =
    await chrome.storage.sync.get(["proxyBase", "enabled"]);
  enabledEl.checked = enabled;
  targetEl.textContent = proxyBase;
}

enabledEl.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

document
  .getElementById("settings")
  .addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
