const DEFAULT_PROXY_ORIGIN = "https://goodproxy.zephex0-f6c.workers.dev";

const originEl = document.getElementById("origin");
const statusEl = document.getElementById("status");

function flash(message) {
  statusEl.textContent = message;
  setTimeout(() => (statusEl.textContent = ""), 1500);
}

function normalize(value) {
  return value.trim().replace(/\/+$/, "");
}

async function load() {
  const { proxyOrigin } = await chrome.storage.sync.get("proxyOrigin");
  originEl.value = proxyOrigin || DEFAULT_PROXY_ORIGIN;
}

document.getElementById("save").addEventListener("click", async () => {
  const value = normalize(originEl.value);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw 0;
  } catch {
    flash("Enter a valid http(s) origin");
    return;
  }
  await chrome.storage.sync.set({ proxyOrigin: value });
  flash("Saved");
});

document.getElementById("reset").addEventListener("click", async () => {
  await chrome.storage.sync.set({ proxyOrigin: DEFAULT_PROXY_ORIGIN });
  originEl.value = DEFAULT_PROXY_ORIGIN;
  flash("Reset");
});

load();
