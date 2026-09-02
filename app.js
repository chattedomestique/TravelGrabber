// TravelGrabber — search across YouTube/SoundCloud/Bandcamp, audit quality, send picks to the mini.
// Config (webhook URL + token) lives only in this device's localStorage — never in the repo.
const $ = (id) => document.getElementById(id);
// Keys kept as "downie.*" so existing installs don't lose their saved settings.
const LS = { api: "downie.api", token: "downie.token", src: "tg.sources", strict: "tg.strict" };

const S = {
  results: [],
  sel: new Set(),                                  // selected urls
  sources: { youtube: true, soundcloud: true, bandcamp: true },
  strict: true,
  ctrl: null,                                      // AbortController for the in-flight search
  searched: false,
};

/* ── helpers ───────────────────────────────────────────────────────────── */

// Result text comes from YouTube/SoundCloud/Bandcamp — untrusted. Always escape before interpolating.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const apiBase = () => (localStorage.getItem(LS.api) || "").trim().replace(/\/$/, "");
const token = () => localStorage.getItem(LS.token) || "";
const settingsOk = () => apiBase().startsWith("http") && token();

function api(path, opts = {}) {
  return fetch(apiBase() + path, {
    ...opts,
    headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}),
               Authorization: "Bearer " + token(), ...(opts.headers || {}) },
  });
}

function fmtDur(sec) {
  if (!sec && sec !== 0) return "";
  const s = Math.round(sec), m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

// Server sends YYYYMMDD (yt-dlp's format); may be null until probed.
function fmtDate(d) {
  if (!d) return "—";
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(d));
  if (!m) return String(d);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function setStatus(msg, cls) { const s = $("status"); if (s) { s.textContent = msg; s.className = cls || ""; } }

// Share sheets often dump "title + url" together — pull the first real link out.
function firstUrl(s) {
  const m = (s || "").match(/https?:\/\/[^\s]+/);
  return m ? m[0] : (s || "").trim();
}

/* ── paste flow (original behaviour, preserved) ────────────────────────── */

async function sendPasted() {
  const url = firstUrl($("url").value);
  if (!/^https?:\/\//i.test(url)) { setStatus("That doesn't look like a link.", "err"); return; }
  if (!settingsOk()) { setStatus("Set the webhook URL + token first (⚙).", "err"); showSettings(true); return; }
  $("go").disabled = true; setStatus("Sending…", "busy");
  try {
    const r = await api("/add", { method: "POST", body: JSON.stringify({ url }) });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) { setStatus("✓ Queued on sunhouse-mini", "ok"); $("url").value = ""; }
    else if (r.status === 401) setStatus("Unauthorized — check the token (⚙).", "err");
    else setStatus("Error: " + (data.error || r.status), "err");
  } catch (e) {
    setStatus(reachErr(), "err");
  } finally { $("go").disabled = false; }
}

const reachErr = () =>
  navigator.onLine === false
    ? "You're offline — search and downloads both need the mini."
    : "Couldn't reach the Mac. Check the tunnel, and that the webhook URL starts with https://";

/* ── search ────────────────────────────────────────────────────────────── */

async function doSearch(ev) {
  if (ev) ev.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  if (!settingsOk()) { showSettings(true); setSrcStatus("Set the webhook URL + token first (⚙).", true); return; }

  const sources = Object.keys(S.sources).filter((k) => S.sources[k]);
  if (!sources.length) { setSrcStatus("Pick at least one source.", true); return; }

  if (S.ctrl) S.ctrl.abort();                      // a new search supersedes the old one
  S.ctrl = new AbortController();
  const timer = setTimeout(() => S.ctrl.abort(), 30000);   // server deadline is 25s

  S.searched = true;
  $("searchBtn").disabled = true;
  $("banner").hidden = true;
  setSrcStatus("Searching " + sources.join(", ") + "…");
  renderSkeletons();

  const qs = new URLSearchParams({ q, sources: sources.join(","), strict: S.strict ? "1" : "0", limit: "20" });
  try {
    const r = await api("/search?" + qs.toString(), { signal: S.ctrl.signal });
    if (r.status === 401) { setSrcStatus("Unauthorized — check the token (⚙).", true); $("results").innerHTML = ""; return; }
    if (r.status === 404) { setSrcStatus("This webhook has no /search yet — the on-device half isn't built.", true); $("results").innerHTML = ""; return; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setSrcStatus("Search failed: " + (data.error || r.status), true); $("results").innerHTML = ""; return; }

    S.results = Array.isArray(data.results) ? data.results : [];
    S.sel.clear();
    renderSourceStatus(data.sources || {}, data.took_ms);
    renderBanner(data.sources || {});
    render();
    autoProbe();
  } catch (e) {
    if (e.name === "AbortError") return;            // superseded or timed out — don't clobber the UI
    $("results").innerHTML = "";
    setSrcStatus(reachErr(), true);
  } finally {
    clearTimeout(timer);
    $("searchBtn").disabled = false;
  }
}

function setSrcStatus(msg, bad) {
  $("srcStatus").innerHTML = msg ? `<span class="${bad ? "bad" : ""}">${esc(msg)}</span>` : "";
}

function renderSourceStatus(sources, took) {
  const parts = Object.entries(sources).map(([name, s]) => {
    if (s.status === "ok") return `${esc(name)} ${s.count}`;
    return `<span class="bad">${esc(name)} ${esc(s.status)}${s.error ? " (" + esc(s.error) + ")" : ""}</span>`;
  });
  const t = took ? ` · ${(took / 1000).toFixed(1)}s` : "";
  $("srcStatus").innerHTML = parts.join(" · ") + t;
}

// Over-filtering can hide the only copy of a track — always offer the escape hatch.
function renderBanner(sources) {
  const hidden = Object.values(sources).reduce((n, s) => n + (s.hidden_by_filter || 0), 0);
  const b = $("banner");
  if (!hidden || !S.strict) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `${hidden} result${hidden === 1 ? "" : "s"} hidden by the audio-first filter — ` +
    `<button id="showHidden">show them</button>`;
  $("showHidden").onclick = () => { S.strict = false; syncChips(); doSearch(); };
}

/* ── rendering ─────────────────────────────────────────────────────────── */

function renderSkeletons() {
  $("results").innerHTML = Array.from({ length: 5 }, () => `<div class="skel"></div>`).join("");
}

function qualityCell(r) {
  const q = r.quality || {};
  if (r.available === false || q.state === "unavailable")
    return `<span class="badge UNAVAILABLE" title="Not downloadable">UNAVAILABLE</span>`;
  if (q.state === "resolved") {
    const lab = esc(q.label || "GOOD");
    const detail = [q.abr ? Math.round(q.abr) + " kbps" : null, q.acodec].filter(Boolean).join(" · ");
    return `<span class="badge ${lab}" title="${esc(detail)}">${lab}${q.abr ? " " + Math.round(q.abr) : ""}</span>`;
  }
  // Unprobed quality is a button — tap to fetch bitrate + upload date for this one row.
  return `<button class="badge UNPROBED" data-probe="${esc(r.url)}" title="Fetch bitrate & date">PROBE</button>`;
}

function render() {
  const box = $("results");
  if (!S.results.length) {
    box.innerHTML = S.searched
      ? `<div class="empty">No results.${S.strict ? ` <button id="loosen">Try without the audio-first filter</button>` : ""}</div>`
      : "";
    const l = $("loosen");
    if (l) l.onclick = () => { S.strict = false; syncChips(); doSearch(); };
    updateSelBar();
    return;
  }

  box.innerHTML = S.results.map((r) => {
    const dis = r.available === false;
    const sub = [r.artist || r.uploader, fmtDur(r.duration), fmtDate(r.upload_date)].filter(Boolean).join(" · ");
    return `
    <div class="row${dis ? " disabled" : ""}">
      <input type="checkbox" id="c_${esc(r.id)}" data-url="${esc(r.url)}"
             ${S.sel.has(r.url) ? "checked" : ""} ${dis ? "disabled" : ""}
             aria-label="Select ${esc(r.title)}">
      ${r.thumbnail ? `<img class="thumb" src="${esc(r.thumbnail)}" alt="" loading="lazy" width="56" height="42">`
                    : `<span class="thumb"></span>`}
      <div class="meta">
        <div class="ttl"><label for="c_${esc(r.id)}">${esc(r.title)}</label></div>
        <div class="sub">${esc(sub)}</div>
      </div>
      <div class="tags">
        <span class="pill ${esc(r.source)}">${esc(r.source)}</span>
        ${qualityCell(r)}
      </div>
      ${(r.reasons && r.reasons.length) ? `<div class="why">${esc(r.reasons.join(" · "))} —
         <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">open</a></div>` : ""}
    </div>`;
  }).join("");

  box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.onchange = () => { cb.checked ? S.sel.add(cb.dataset.url) : S.sel.delete(cb.dataset.url); updateSelBar(); };
  });
  box.querySelectorAll("[data-probe]").forEach((b) => {
    b.onclick = () => probe([b.dataset.probe]);
  });
  updateSelBar();
}

function updateSelBar() {
  const n = S.sel.size;
  $("selbar").hidden = n === 0;
  if (!n) return;
  const total = S.results.filter((r) => S.sel.has(r.url)).reduce((t, r) => t + (r.duration || 0), 0);
  $("selInfo").textContent = `${n} selected${total ? " · " + fmtDur(total) : ""}`;
  $("dlBtn").textContent = "Download " + n;
}

/* ── probing (bitrate + upload date for YouTube/Bandcamp rows) ──────────── */

// Only the first screenful is probed automatically — each probe is a full yt-dlp run on the mini.
function autoProbe() {
  const urls = S.results.filter((r) => (r.quality || {}).state === "unprobed").slice(0, 10).map((r) => r.url);
  if (urls.length) probe(urls);
}

async function probe(urls) {
  urls.forEach((u) => {
    const b = document.querySelector(`[data-probe="${CSS.escape(u)}"]`);
    if (b) { b.textContent = "…"; b.disabled = true; }
  });
  try {
    const r = await api("/probe", { method: "POST", body: JSON.stringify({ urls }) });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    const map = data.results || {};
    S.results = S.results.map((row) => {
      const p = map[row.url];
      if (!p) return row;
      return { ...row, quality: p, upload_date: p.upload_date || row.upload_date,
               available: p.available === false ? false : row.available };
    });
    render();
  } catch (e) {
    urls.forEach((u) => {
      const b = document.querySelector(`[data-probe="${CSS.escape(u)}"]`);
      if (b) { b.textContent = "RETRY"; b.disabled = false; }
    });
  }
}

/* ── download selected ─────────────────────────────────────────────────── */

async function downloadSelected() {
  const urls = [...S.sel];
  if (!urls.length) return;
  $("dlBtn").disabled = true; $("dlBtn").textContent = "Sending…";
  try {
    const r = await api("/add", { method: "POST", body: JSON.stringify({ urls }) });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok !== false) {
      const failed = (data.items || []).filter((i) => i.ok === false);
      setSrcStatus(failed.length
        ? `Queued ${urls.length - failed.length}, ${failed.length} failed.`
        : `✓ Queued ${data.queued ?? urls.length} on sunhouse-mini`, failed.length > 0);
      S.sel.clear(); render();
    } else if (r.status === 401) setSrcStatus("Unauthorized — check the token (⚙).", true);
    else setSrcStatus("Error: " + (data.error || r.status), true);
  } catch (e) {
    setSrcStatus(reachErr(), true);
  } finally {
    $("dlBtn").disabled = false; updateSelBar();
  }
}

/* ── chrome: tabs, chips, settings ─────────────────────────────────────── */

function showMode(mode) {
  const search = mode === "search";
  $("viewSearch").hidden = !search;
  $("viewPaste").hidden = search;
  $("tabSearch").setAttribute("aria-selected", String(search));
  $("tabPaste").setAttribute("aria-selected", String(!search));
}

function showSettings(on) { $("settings").hidden = on === undefined ? !$("settings").hidden : !on; }

function syncChips() {
  document.querySelectorAll(".chip[data-src]").forEach((c) => {
    c.setAttribute("aria-pressed", String(!!S.sources[c.dataset.src]));
  });
  $("strictChip").setAttribute("aria-pressed", String(S.strict));
  $("strictHint").textContent = S.strict
    ? "Audio-first hides music videos & reactions — official audio, lyric and visualiser uploads only."
    : "Showing everything, music videos included.";
  localStorage.setItem(LS.src, JSON.stringify(S.sources));
  localStorage.setItem(LS.strict, S.strict ? "1" : "0");
}

/* ── boot ──────────────────────────────────────────────────────────────── */

window.addEventListener("DOMContentLoaded", () => {
  $("api").value = localStorage.getItem(LS.api) || "https://downie.sunhouse.media";
  $("token").value = token();
  try {
    const saved = JSON.parse(localStorage.getItem(LS.src) || "null");
    if (saved) S.sources = { ...S.sources, ...saved };
  } catch (e) { /* ignore malformed prefs */ }
  if (localStorage.getItem(LS.strict) === "0") S.strict = false;
  syncChips();

  $("gear").onclick = () => showSettings();
  $("tabSearch").onclick = () => showMode("search");
  $("tabPaste").onclick = () => showMode("paste");
  $("searchForm").onsubmit = doSearch;
  $("go").onclick = sendPasted;
  $("dlBtn").onclick = downloadSelected;
  $("clearSel").onclick = () => { S.sel.clear(); render(); };

  document.querySelectorAll(".chip[data-src]").forEach((c) => {
    c.onclick = () => { S.sources[c.dataset.src] = !S.sources[c.dataset.src]; syncChips(); };
  });
  $("strictChip").onclick = () => { S.strict = !S.strict; syncChips(); if (S.searched) doSearch(); };

  $("save").onclick = () => {
    localStorage.setItem(LS.api, $("api").value.trim());
    localStorage.setItem(LS.token, $("token").value.trim());
    showSettings(false); setStatus("Settings saved.", "ok"); setSrcStatus("Settings saved.");
  };
  $("url").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendPasted(); });

  // Share-target / deep link: ?url=… (or ?text=… from share sheets) → paste tab, auto-send.
  const p = new URLSearchParams(location.search);
  const shared = firstUrl(p.get("url") || p.get("text") || p.get("title") || "");
  if (/^https?:\/\//i.test(shared)) {
    showMode("paste");
    $("url").value = shared;
    history.replaceState({}, "", location.pathname);
    if (settingsOk()) sendPasted(); else { showSettings(true); setStatus("Set token to finish (⚙).", "busy"); }
  } else {
    showMode("search");
    if (!settingsOk()) showSettings(true);
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
