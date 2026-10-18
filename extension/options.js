const DEFAULT_PROXY_BASE = "https://goodproxy.zephex0-f6c.workers.dev/fetch?url=";

const baseEl = document.getElementById("base");
const statusEl = document.getElementById("status");

function flash(message) {
  statusEl.textContent = message;
  setTimeout(() => (statusEl.textContent = ""), 1500);
}

async function load() {
  const { proxyBase } = await chrome.storage.sync.get("proxyBase");
  baseEl.value = proxyBase || DEFAULT_PROXY_BASE;
}

document.getElementById("save").addEventListener("click", async () => {
  const value = baseEl.value.trim();
  if (!value.includes("url=")) {
    flash("Must contain \"url=\"");
    return;
  }
  await chrome.storage.sync.set({ proxyBase: value });
  flash("Saved");
});

document.getElementById("reset").addEventListener("click", async () => {
  await chrome.storage.sync.set({ proxyBase: DEFAULT_PROXY_BASE });
  baseEl.value = DEFAULT_PROXY_BASE;
  flash("Reset");
});

load();
