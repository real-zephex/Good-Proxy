const DEFAULT_PROXY_ORIGIN = "https://goodproxy.zephex0-f6c.workers.dev";

const enabledEl = document.getElementById("enabled");
const targetEl = document.getElementById("target");

async function refresh() {
  const { proxyOrigin = DEFAULT_PROXY_ORIGIN, enabled = true } =
    await chrome.storage.sync.get(["proxyOrigin", "enabled"]);
  enabledEl.checked = enabled;
  targetEl.textContent = proxyOrigin;
}

enabledEl.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

document
  .getElementById("settings")
  .addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
