// ZXN Alerts: site-wide severe-weather banner fed by NWS (api.weather.gov), refreshed every 5 minutes.
// Exposes window.ZXNAlerts so the Weather section can draw the same alerts on its map.
(function () {
  const API = "https://api.weather.gov/alerts/active?status=actual&severity=Severe,Extreme";
  const REFRESH_MS = 5 * 60 * 1000;
  const CT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Roughly the NWS hazard map colors, so polygons/badges read like weather.gov.
  const COLORS = {
    "Tornado Warning": "#FF0000", "Tornado Emergency": "#8B0000", "Flash Flood Emergency": "#8B0000",
    "Hurricane Warning": "#DC143C", "Extreme Wind Warning": "#FF8C00", "Storm Surge Warning": "#B524F7",
    "Flash Flood Warning": "#8B0000", "Severe Thunderstorm Warning": "#FFA500", "Tropical Storm Warning": "#B22222",
    "Hurricane Watch": "#FF00FF", "Storm Surge Watch": "#DB7FF7", "Tornado Watch": "#E6C700",
    "Tropical Storm Watch": "#F08080", "Flood Warning": "#00A000", "Flood Watch": "#2E8B57",
    "Coastal Flood Warning": "#228B22", "High Wind Warning": "#DAA520", "High Wind Watch": "#B8860B",
    "Red Flag Warning": "#FF1493", "Fire Weather Watch": "#E9967A", "Winter Storm Warning": "#FF69B4",
    "Winter Storm Watch": "#4682B4", "Blizzard Warning": "#FF4500", "Ice Storm Warning": "#8B008B",
    "Extreme Heat Warning": "#C71585", "Excessive Heat Warning": "#C71585", "Extreme Cold Warning": "#0000FF",
    "Freeze Warning": "#483D8B", "Special Marine Warning": "#FFA500", "Dust Storm Warning": "#C2B280",
  };
  // Most dangerous first.
  const RANK = ["Tornado Emergency", "Flash Flood Emergency", "Tornado Warning", "Extreme Wind Warning", "Hurricane Warning",
    "Storm Surge Warning", "Flash Flood Warning", "Severe Thunderstorm Warning", "Tropical Storm Warning", "Hurricane Watch",
    "Storm Surge Watch", "Tornado Watch", "Tropical Storm Watch", "Flood Warning", "Blizzard Warning", "Ice Storm Warning",
    "Winter Storm Warning", "High Wind Warning", "Extreme Heat Warning", "Extreme Cold Warning", "Red Flag Warning"];
  const rank = (ev) => { const i = RANK.indexOf(ev); return i < 0 ? 99 : i; };
  const color = (p) => COLORS[p.event] || (p.severity === "Extreme" ? "#7a0019" : "#B22234");
  const fmtCT = (iso) => (iso ? CT.format(new Date(iso)) + " CT" : "—");
  const until = (p) => p.ends || p.expires;

  const state = { features: [], updated: null, error: null };
  const subs = [];

  function groups(features) {
    const by = new Map();
    for (const f of features) {
      const ev = f.properties.event;
      if (!by.has(ev)) by.set(ev, []);
      by.get(ev).push(f);
    }
    return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
  }

  function alertItem(f) {
    const p = f.properties;
    const mapBtn = f.geometry ? `<button class="al-map" data-alert="${esc(p.id)}" type="button">Show on map</button>` : "";
    return `<li class="al-item" style="--al:${color(p)}">
      <div class="al-top"><span class="al-sev al-${esc((p.severity || "").toLowerCase())}">${esc(p.severity)}</span>
      <b>${esc(p.headline || p.event)}</b></div>
      <div class="al-area">${esc(p.areaDesc)}</div>
      <div class="al-exp">Until ${esc(fmtCT(until(p)))} · ${esc(p.senderName || "")} ${mapBtn}</div>
      <details><summary>Full alert</summary>
        <pre>${esc(p.description || "")}</pre>${p.instruction ? `<p class="al-instr"><b>What to do:</b> ${esc(p.instruction)}</p>` : ""}
      </details></li>`;
  }

  function renderBanner() {
    const el = document.getElementById("alert-banner");
    if (!el) return;
    const fs = state.features;
    if (!fs.length) { el.hidden = true; el.innerHTML = ""; return; }
    const g = groups(fs);
    const top = g.slice(0, 4).map(([ev, l]) => `<span class="ab-chip" style="--al:${COLORS[ev] || "#fff"}">${esc(ev)} <b>${l.length}</b></span>`).join("");
    const wasOpen = el.classList.contains("open");
    el.hidden = false;
    el.innerHTML = `<button class="ab-bar" type="button" aria-expanded="${wasOpen}">
        <span class="ab-icon">⚠</span><span class="ab-title">Severe weather: <b>${fs.length}</b> active NWS alert${fs.length === 1 ? "" : "s"}</span>
        <span class="ab-chips">${top}${g.length > 4 ? `<span class="ab-more">+${g.length - 4} more types</span>` : ""}</span>
        <span class="ab-toggle">${wasOpen ? "Hide ▴" : "Show alerts ▾"}</span></button>
      <div class="ab-panel"><div class="wrap">
        <p class="ab-note">Severe and extreme alerts from the National Weather Service, updated ${esc(fmtCT(state.updated))}. Click a type to see each alert.
          <a href="#weather">Open the weather map →</a></p>
        ${g.map(([ev, l]) => `<details class="ab-group" data-event="${esc(ev)}"><summary style="--al:${COLORS[ev] || "#B22234"}"><span class="ab-dot"></span>${esc(ev)} <b>${l.length}</b>
          <span class="ab-until">latest expiry ${esc(fmtCT(l.map((f) => until(f.properties)).filter(Boolean).sort().pop()))}</span></summary><ul class="al-list"></ul></details>`).join("")}
      </div></div>`;
    el.classList.toggle("open", wasOpen);
    el.querySelector(".ab-bar").onclick = () => {
      const open = !el.classList.contains("open");
      el.classList.toggle("open", open);
      el.querySelector(".ab-bar").setAttribute("aria-expanded", open);
      el.querySelector(".ab-toggle").textContent = open ? "Hide ▴" : "Show alerts ▾";
    };
    // Fill each group's list only when opened (there can be hundreds of alerts).
    el.querySelectorAll(".ab-group").forEach((d) => d.addEventListener("toggle", () => {
      const ul = d.querySelector("ul");
      if (d.open && !ul.childElementCount) ul.innerHTML = g.find(([ev]) => ev === d.dataset.event)[1].map(alertItem).join("");
    }));
  }

  // "Show on map" buttons anywhere on the page.
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".al-map");
    if (!b) return;
    const f = state.features.find((x) => x.properties.id === b.dataset.alert);
    if (f) window.dispatchEvent(new CustomEvent("zxn:show-alert", { detail: f }));
  });

  async function load() {
    try {
      const r = await fetch(API, { headers: { Accept: "application/geo+json" } });
      if (!r.ok) throw new Error("NWS " + r.status);
      const d = await r.json();
      state.features = (d.features || []).filter((f) => f.properties && f.properties.status === "Actual")
        .sort((a, b) => rank(a.properties.event) - rank(b.properties.event));
      state.updated = new Date().toISOString();
      state.error = null;
    } catch (e) {
      state.error = e.message;
      console.warn("ZXN alerts: could not load NWS alerts:", e.message);
    }
    renderBanner();
    subs.forEach((fn) => { try { fn(state); } catch (e) { console.warn(e); } });
  }

  window.ZXNAlerts = { state, COLORS, color, rank, groups, alertItem, fmtCT, esc, until,
    subscribe(fn) { subs.push(fn); if (state.updated || state.error) fn(state); }, reload: load };
  load();
  setInterval(load, REFRESH_MS);
})();
