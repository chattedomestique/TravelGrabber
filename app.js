// TravelGrabber PWA — paste/share a link, POST it to the Mac's webhook, Downie grabs it.
// Config (webhook URL + token) lives only in this device's localStorage — never in the repo.
const $ = (id) => document.getElementById(id);
const LS = { api: "downie.api", token: "downie.token" };

function loadSettings() {
  $("api").value = localStorage.getItem(LS.api) || "https://downie.sunhouse.media";
  $("token").value = localStorage.getItem(LS.token) || "";
}
function settingsOk() {
  return (localStorage.getItem(LS.api) || "").startsWith("http") && localStorage.getItem(LS.token);
}
function setStatus(msg, cls) { const s = $("status"); s.textContent = msg; s.className = cls || ""; }

// Pull the first http(s) link out of a string (share sheets often dump title + url together).
function firstUrl(s) {
  const m = (s || "").match(/https?:\/\/[^\s]+/);
  return m ? m[0] : (s || "").trim();
}

async function send() {
  const url = firstUrl($("url").value);
  if (!/^https?:\/\//i.test(url)) { setStatus("That doesn't look like a link.", "err"); return; }
  if (!settingsOk()) { setStatus("Set the webhook URL + token first (⚙).", "err"); openSettings(true); return; }
  $("go").disabled = true; setStatus("Sending to Downie…", "busy");
  try {
    const r = await fetch(localStorage.getItem(LS.api).replace(/\/$/, "") + "/add", {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 "Authorization": "Bearer " + localStorage.getItem(LS.token) },
      body: JSON.stringify({ url }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) { setStatus("✓ Queued on sunhouse-mini", "ok"); $("url").value = ""; }
    else if (r.status === 401) setStatus("Unauthorized — check the token (⚙).", "err");
    else setStatus("Error: " + (data.error || r.status), "err");
  } catch (e) {
    setStatus("Couldn't reach the Mac. Is the tunnel up + you online?", "err");
  } finally { $("go").disabled = false; }
}

function openSettings(show) { $("settings").classList.toggle("show", show ?? !$("settings").classList.contains("show")); }

window.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  $("gear").onclick = () => openSettings();
  $("go").onclick = send;
  $("save").onclick = () => {
    localStorage.setItem(LS.api, $("api").value.trim());
    localStorage.setItem(LS.token, $("token").value.trim());
    openSettings(false); setStatus("Settings saved.", "ok");
  };
  $("url").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); });

  // Share-target / deep link: index.html?url=…  (or ?text=… from share sheets)
  const q = new URLSearchParams(location.search);
  const shared = firstUrl(q.get("url") || q.get("text") || q.get("title") || "");
  if (/^https?:\/\//i.test(shared)) {
    $("url").value = shared;
    history.replaceState({}, "", location.pathname);   // clean the URL bar
    if (settingsOk()) send(); else { openSettings(true); setStatus("Set token to finish (⚙).", "busy"); }
  } else if (!settingsOk()) {
    openSettings(true);
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
