// ZXN Weather Center: Leaflet map + RainViewer radar loop, NHC hurricane track, NWS alert polygons,
// Open-Meteo current/hourly/7-day forecast, and NWS alerts for the selected point. No API keys needed.
(function () {
  if (!window.L || !document.getElementById("wx-map")) return;
  const A = window.ZXNAlerts;
  const esc = A ? A.esc : (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const $ = (id) => document.getElementById(id);
  const CT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  const DEFAULT = { lat: 30.4, lon: -88.0, zoom: 6 }; // Gulf Coast, where Isaias is
  const NHC = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";

  // ---------- map ----------
  const map = L.map("wx-map", { zoomControl: true, worldCopyJump: true, minZoom: 3, maxZoom: 12 }).setView([DEFAULT.lat, DEFAULT.lon], DEFAULT.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.createPane("alerts"); map.getPane("alerts").style.zIndex = 380;
  map.createPane("radar"); map.getPane("radar").style.zIndex = 390;
  map.createPane("storm"); map.getPane("storm").style.zIndex = 420;
  const alertLayer = L.layerGroup().addTo(map);
  const stormLayer = L.layerGroup().addTo(map);
  let pin = null;

  // ---------- radar (RainViewer) ----------
  const rv = { frames: [], layers: {}, idx: 0, timer: null, host: "", opacity: 0.7, on: true };
  function rvLayer(f) {
    if (!rv.layers[f.path]) {
      rv.layers[f.path] = L.tileLayer(`${rv.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        pane: "radar", opacity: 0, maxNativeZoom: 7, maxZoom: 12, tileSize: 256,
        attribution: '<a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a>',
      });
    }
    return rv.layers[f.path];
  }
  function showFrame(i) {
    if (!rv.frames.length) return;
    rv.idx = (i + rv.frames.length) % rv.frames.length;
    const f = rv.frames[rv.idx];
    const lyr = rvLayer(f);
    if (rv.on && !map.hasLayer(lyr)) lyr.addTo(map);
    Object.entries(rv.layers).forEach(([p, l]) => l.setOpacity(rv.on && p === f.path ? rv.opacity : 0));
    // preload the next frame so the loop is smooth
    const nxt = rvLayer(rv.frames[(rv.idx + 1) % rv.frames.length]);
    if (rv.on && !map.hasLayer(nxt)) nxt.addTo(map);
    $("rv-slider").value = rv.idx;
    $("rv-time").textContent = CT.format(new Date(f.time * 1000)) + " CT" + (rv.idx === rv.frames.length - 1 ? " (latest)" : "");
  }
  function play(on) {
    clearInterval(rv.timer); rv.timer = null;
    if (on) rv.timer = setInterval(() => showFrame(rv.idx + 1), 600);
    $("rv-play").textContent = on ? "❚❚ Pause" : "▶ Play";
    $("rv-play").setAttribute("aria-pressed", on);
  }
  async function loadRadar() {
    try {
      const d = await (await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" })).json();
      rv.host = d.host;
      const old = new Set(rv.frames.map((f) => f.path));
      rv.frames = (d.radar && d.radar.past) || [];
      // drop layers for frames that aged out
      Object.keys(rv.layers).forEach((p) => { if (!rv.frames.find((f) => f.path === p)) { map.removeLayer(rv.layers[p]); delete rv.layers[p]; } });
      $("rv-slider").max = Math.max(0, rv.frames.length - 1);
      showFrame(old.size ? rv.idx : rv.frames.length - 1);
    } catch (e) {
      $("rv-time").textContent = "Radar unavailable right now";
      console.warn("ZXN radar:", e.message);
    }
  }
  $("rv-play").onclick = () => play(!rv.timer);
  $("rv-prev").onclick = () => { play(false); showFrame(rv.idx - 1); };
  $("rv-next").onclick = () => { play(false); showFrame(rv.idx + 1); };
  $("rv-slider").oninput = (e) => { play(false); showFrame(+e.target.value); };
  $("rv-opacity").oninput = (e) => { rv.opacity = +e.target.value / 100; showFrame(rv.idx); };
  $("lyr-radar").onchange = (e) => { rv.on = e.target.checked; if (!rv.on) play(false); showFrame(rv.idx); };
  $("lyr-alerts").onchange = (e) => (e.target.checked ? alertLayer.addTo(map) : map.removeLayer(alertLayer));
  $("lyr-storms").onchange = (e) => (e.target.checked ? stormLayer.addTo(map) : map.removeLayer(stormLayer));

  // ---------- NWS alert polygons ----------
  const alertShapes = new Map();
  function drawAlerts(st) {
    alertLayer.clearLayers(); alertShapes.clear();
    const fs = st.features || [];
    const drawn = fs.filter((f) => f.geometry);
    // draw least severe first so the most dangerous end up on top
    drawn.slice().reverse().forEach((f) => {
      const p = f.properties, c = A.color(p);
      const shape = L.geoJSON(f, { pane: "alerts", style: { color: c, weight: 2, fillColor: c, fillOpacity: 0.18 } })
        .bindPopup(`<div class="al-pop" style="--al:${c}"><b>${esc(p.event)}</b><div>${esc(p.areaDesc)}</div>
          <div class="al-exp">Until ${esc(A.fmtCT(A.until(p)))}</div><p>${esc((p.headline || ""))}</p>
          <details><summary>Details</summary><pre>${esc(p.description || "")}</pre></details></div>`, { maxWidth: 340, maxHeight: 320 });
      shape.addTo(alertLayer); alertShapes.set(p.id, shape);
    });
    const types = A.groups(drawn).map(([ev, l]) => `<span><i style="background:${A.COLORS[ev] || "#B22234"}"></i>${esc(ev)} (${l.length})</span>`);
    const zoneOnly = fs.length - drawn.length;
    $("wx-legend").innerHTML = st.error && !fs.length ? "NWS alerts couldn't be loaded right now."
      : fs.length ? `<b>NWS alert areas on map:</b> ${types.join("")}${zoneOnly ? `<em>${zoneOnly} more county/zone-based alerts are listed in the red banner but not drawn.</em>` : ""}`
      : "No severe NWS alerts are active right now.";
  }
  if (A) A.subscribe(drawAlerts);
  window.addEventListener("zxn:show-alert", (e) => {
    const s = alertShapes.get(e.detail.properties.id);
    document.getElementById("weather").scrollIntoView({ behavior: "smooth" });
    if (s) { $("lyr-alerts").checked = true; alertLayer.addTo(map); map.fitBounds(s.getBounds(), { maxZoom: 9, padding: [20, 20] }); setTimeout(() => s.openPopup(s.getBounds().getCenter()), 700); }
  });

  // ---------- hurricane track (NOAA NHC map service) ----------
  const kt2mph = (k) => Math.round(k * 1.15078);
  async function q(id) {
    const r = await fetch(`${NHC}/${id}/query?where=1%3D1&outFields=*&f=geojson`);
    if (!r.ok) throw new Error("NHC " + r.status);
    return r.json();
  }
  async function loadStorms() {
    try {
      const svc = await (await fetch(`${NHC}?f=json`)).json();
      const byName = Object.fromEntries((svc.layers || []).map((l) => [l.name, l.id]));
      const bins = [1, 2, 3, 4, 5].map((n) => "AT" + n).filter((b) => byName[b + " Forecast Points"] != null);
      const pts = await Promise.all(bins.map((b) => q(byName[b + " Forecast Points"]).catch(() => ({ features: [] }))));
      const active = bins.map((b, i) => ({ bin: b, pts: pts[i].features || [] })).filter((s) => s.pts.length);
      stormLayer.clearLayers();
      const info = [];
      for (const s of active) {
        const [cone, track, past] = await Promise.all(["Forecast Cone", "Forecast Track", "Past Track"].map((n) =>
          byName[`${s.bin} ${n}`] != null ? q(byName[`${s.bin} ${n}`]).catch(() => null) : null));
        if (cone) L.geoJSON(cone, { pane: "storm", style: { color: "#fff", weight: 2, fillColor: "#ffffff", fillOpacity: 0.28, dashArray: "4 4" }, interactive: false }).addTo(stormLayer);
        if (past) L.geoJSON(past, { pane: "storm", style: { color: "#071d3b", weight: 3 }, interactive: false }).addTo(stormLayer);
        if (track) L.geoJSON(track, { pane: "storm", style: { color: "#071d3b", weight: 2, dashArray: "6 6" }, interactive: false }).addTo(stormLayer);
        const ps = s.pts.slice().sort((a, b) => a.properties.tau - b.properties.tau);
        ps.forEach((f) => {
          const p = f.properties, [lon, lat] = f.geometry.coordinates;
          const major = p.ssnum >= 3, hur = p.ssnum >= 1;
          L.circleMarker([lat, lon], { pane: "storm", radius: p.tau === 0 ? 11 : 7, weight: 2, color: "#fff",
            fillColor: major ? "#7a0019" : hur ? "#B22234" : p.stormtype === "TS" || p.stormtype === "STS" ? "#e8743b" : "#0A3161", fillOpacity: 1 })
            .bindPopup(`<b>${esc(p.stormname)}</b><br>${p.tau === 0 ? "Current position" : "Forecast"}: ${esc(p.fldatelbl || p.datelbl)}<br>
              ${esc(p.tcdvlp)}${p.ssnum ? " · Category " + p.ssnum : ""}<br>Max wind ${kt2mph(p.maxwind)} mph, gusts ${kt2mph(p.gust)} mph
              ${p.mslp && p.mslp < 2000 ? `<br>Pressure ${p.mslp} mb` : ""}<br><small>NHC advisory ${esc(p.advisnum)}, ${esc(p.advdate)}</small>`)
            .bindTooltip(p.tau === 0 ? `${p.stormname}` : esc(p.datelbl), { direction: "right", permanent: p.tau === 0, className: "storm-tip" })
            .addTo(stormLayer);
        });
        const now = ps[0].properties;
        info.push(`<div class="storm-card"><span class="kicker red">Active storm</span> <b>${esc(now.stormname)}</b>
          · ${esc(now.tcdvlp)}${now.ssnum ? " (Cat " + now.ssnum + ")" : ""} · ${kt2mph(now.maxwind)} mph winds${now.mslp < 2000 ? " · " + now.mslp + " mb" : ""}
          · NHC advisory ${esc(now.advisnum)} (${esc(now.advdate)})
          <button type="button" class="wx-btn small" data-storm="${ps[0].geometry.coordinates.join(",")}">Zoom to storm</button>
          <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NHC →</a></div>`);
      }
      $("wx-storms").innerHTML = info.join("") || '<div class="storm-card muted">No active Atlantic tropical cyclones right now.</div>';
      $("wx-storms").querySelectorAll("[data-storm]").forEach((b) => (b.onclick = () => {
        const [lon, lat] = b.dataset.storm.split(",").map(Number); map.setView([lat, lon], 6);
      }));
    } catch (e) {
      $("wx-storms").innerHTML = '<div class="storm-card muted">Hurricane track unavailable right now.</div>';
      console.warn("ZXN storms:", e.message);
    }
  }

  // ---------- forecast (Open-Meteo) ----------
  const WMO = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Freezing fog"],
    51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"], 56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"],
    61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Heavy showers"], 82: ["⛈️", "Violent showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Heavy snow showers"],
    95: ["⛈️", "Thunderstorms"], 96: ["⛈️", "Thunderstorms, hail"], 99: ["⛈️", "Severe thunderstorms, hail"],
  };
  const wmo = (c) => WMO[c] || ["🌡️", "—"];
  const compass = (d) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];
  const sel = { lat: DEFAULT.lat, lon: DEFAULT.lon, name: "Map center" };

  async function loadForecast() {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${sel.lat}&longitude=${sel.lon}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl" +
      "&hourly=temperature_2m,precipitation_probability,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7";
    try {
      const d = await (await fetch(u)).json();
      if (d.error) throw new Error(d.reason);
      renderNow(d); renderHourly(d); renderDaily(d);
    } catch (e) {
      $("wx-now").innerHTML = `<p class="muted">Forecast unavailable right now (${esc(e.message)}).</p>`;
      console.warn("ZXN forecast:", e.message);
    }
  }
  function renderNow(d) {
    const c = d.current, [ico, label] = wmo(c.weather_code);
    $("wx-now").innerHTML = `<div class="now-place">${esc(sel.name)}</div>
      <div class="now-main"><span class="now-ico">${ico}</span><span class="now-temp">${Math.round(c.temperature_2m)}°F</span></div>
      <div class="now-label">${esc(label)} · Feels like ${Math.round(c.apparent_temperature)}°</div>
      <dl class="now-grid">
        <div><dt>Wind</dt><dd>${compass(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)} mph</dd></div>
        <div><dt>Gusts</dt><dd>${Math.round(c.wind_gusts_10m)} mph</dd></div>
        <div><dt>Humidity</dt><dd>${c.relative_humidity_2m}%</dd></div>
        <div><dt>Pressure</dt><dd>${Math.round(c.pressure_msl)} mb</dd></div>
        <div><dt>Precip (now)</dt><dd>${c.precipitation} in</dd></div>
        <div><dt>Today</dt><dd>${Math.round(d.daily.temperature_2m_max[0])}° / ${Math.round(d.daily.temperature_2m_min[0])}°</dd></div>
      </dl><div class="now-upd">Updated ${CT.format(new Date())} CT · local time zone ${esc(d.timezone_abbreviation)}</div>`;
  }
  function renderHourly(d) {
    const h = d.hourly, nowIdx = Math.max(0, h.time.findIndex((t) => t >= d.current.time.slice(0, 13)));
    const n = 24, T = h.temperature_2m.slice(nowIdx, nowIdx + n), P = h.precipitation_probability.slice(nowIdx, nowIdx + n);
    const times = h.time.slice(nowIdx, nowIdx + n), codes = h.weather_code.slice(nowIdx, nowIdx + n);
    const W = 960, H = 220, pl = 36, pr = 12, pt = 34, pb = 46;
    const lo = Math.floor(Math.min(...T) - 2), hi = Math.ceil(Math.max(...T) + 2);
    const x = (i) => pl + (i * (W - pl - pr)) / (n - 1), y = (t) => pt + ((hi - t) * (H - pt - pb)) / (hi - lo || 1);
    const hr = (s) => { const k = +s.slice(11, 13); return (k % 12 || 12) + (k < 12 ? "a" : "p"); };
    const line = T.map((t, i) => `${x(i)},${y(t)}`).join(" ");
    const area = `${x(0)},${H - pb} ${line} ${x(n - 1)},${H - pb}`;
    const bars = P.map((p, i) => `<rect x="${x(i) - 9}" y="${H - pb - (p / 100) * 40}" width="18" height="${(p / 100) * 40}" class="pbar"><title>${hr(times[i])}: ${p}% chance of precipitation</title></rect>`).join("");
    const dots = T.map((t, i) => `<g class="hpt"><circle cx="${x(i)}" cy="${y(t)}" r="4"/><rect class="hit" x="${x(i) - 18}" y="0" width="36" height="${H}"><title>${hr(times[i])}: ${Math.round(t)}°F, ${wmo(codes[i])[1]}, ${P[i]}% precip</title></rect>
      ${i % 2 === 0 ? `<text x="${x(i)}" y="${y(t) - 10}" class="tlab">${Math.round(t)}°</text>` : ""}
      ${i % 3 === 0 ? `<text x="${x(i)}" y="${H - pb + 18}" class="xlab">${i === 0 ? "Now" : hr(times[i])}</text><text x="${x(i)}" y="${H - pb + 36}" class="ilab">${wmo(codes[i])[0]}</text>` : ""}</g>`).join("");
    $("wx-hourly").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="hchart" role="img" aria-label="Hourly temperature for the next 24 hours">
      <defs><linearGradient id="tg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#B22234" stop-opacity=".35"/><stop offset="1" stop-color="#0A3161" stop-opacity=".05"/></linearGradient></defs>
      ${bars}<polygon points="${area}" fill="url(#tg)"/><polyline points="${line}" class="tline"/>${dots}
      <text x="4" y="14" class="axl">°F</text><text x="${W - 4}" y="14" class="axl" text-anchor="end">bars = chance of rain (${esc(d.timezone_abbreviation)})</text></svg>`;
  }
  function renderDaily(d) {
    const dd = d.daily;
    const wk = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
    const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const lo = Math.min(...dd.temperature_2m_min), hi = Math.max(...dd.temperature_2m_max);
    $("wx-daily").innerHTML = dd.time.map((t, i) => {
      const dt = new Date(t + "T12:00:00Z"), [ico, label] = wmo(dd.weather_code[i]);
      const a = ((dd.temperature_2m_min[i] - lo) / (hi - lo || 1)) * 100, b = ((dd.temperature_2m_max[i] - lo) / (hi - lo || 1)) * 100;
      return `<div class="day${i === 0 ? " today" : ""}"><div class="d-name">${i === 0 ? "Today" : wk.format(dt)}<small>${md.format(dt)}</small></div>
        <div class="d-ico" title="${esc(label)}">${ico}</div><div class="d-label">${esc(label)}</div>
        <div class="d-temps"><b>${Math.round(dd.temperature_2m_max[i])}°</b> <span>${Math.round(dd.temperature_2m_min[i])}°</span></div>
        <div class="d-range"><i style="left:${a}%;right:${100 - b}%"></i></div>
        <div class="d-meta">💧 ${dd.precipitation_probability_max[i] ?? 0}% · 💨 ${Math.round(dd.wind_speed_10m_max[i])} mph</div></div>`;
    }).join("");
  }

  // ---------- NWS alerts for the selected point ----------
  async function loadPointAlerts() {
    const box = $("wx-alerts");
    $("wx-alerts-place").textContent = sel.name;
    if (!sel.us) { box.innerHTML = '<p class="muted">NWS alerts are only available for U.S. locations.</p>'; return; }
    try {
      const r = await fetch(`https://api.weather.gov/alerts/active?status=actual&point=${sel.lat.toFixed(4)},${sel.lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } });
      if (!r.ok) throw new Error("NWS " + r.status);
      const fs = ((await r.json()).features || []).sort((a, b) => {
        const s = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
        return (s[a.properties.severity] ?? 5) - (s[b.properties.severity] ?? 5) || A.rank(a.properties.event) - A.rank(b.properties.event);
      });
      box.innerHTML = fs.length ? `<ul class="al-list">${fs.map(A.alertItem).join("")}</ul>` : '<p class="ok">✓ No active NWS alerts for this location.</p>';
    } catch (e) {
      box.innerHTML = '<p class="muted">Alerts for this location could not be loaded right now.</p>';
      console.warn("ZXN point alerts:", e.message);
    }
  }

  // ---------- choosing a place ----------
  // Rough boxes for U.S. states/territories, so we don't ask NWS about places it doesn't cover.
  const US_BOXES = [[24, 50, -125, -66], [51, 72, -180, -129], [18, 23, -161, -154], [17.5, 18.7, -68, -64.3], [13, 15.5, 144, 146.2], [-14.6, -14, -171, -169]];
  const maybeUS = (lat, lon) => US_BOXES.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d);
  async function nwsPlace(lat, lon) {
    if (!maybeUS(lat, lon)) return null;
    try {
      const r = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } });
      if (!r.ok) return null;
      const p = (await r.json()).properties.relativeLocation.properties;
      const city = p.city.replace(/\s*\(balance\)/i, "").replace(/-?\s*Davidson Metropolitan Government|\s+(Metropolitan|Unified|Consolidated) Government/i, "").trim();
      return `${city}, ${p.state}`;
    } catch (e) { return null; }
  }
  async function select(lat, lon, name, opts = {}) {
    sel.lat = +lat; sel.lon = +lon;
    const nws = opts.us === false ? null : await nwsPlace(sel.lat, sel.lon);
    sel.us = opts.us ?? !!nws;
    sel.name = name || (nws ? `Near ${nws}` : `${sel.lat.toFixed(2)}°, ${sel.lon.toFixed(2)}°`);
    if (pin) map.removeLayer(pin);
    pin = L.circleMarker([sel.lat, sel.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#B22234", fillOpacity: 1, pane: "storm" })
      .bindTooltip(esc(sel.name), { direction: "top", offset: [0, -8] }).addTo(map);
    if (opts.fly) map.setView([sel.lat, sel.lon], Math.max(map.getZoom(), 7));
    $("wx-q").value = opts.keepQuery ? $("wx-q").value : "";
    loadForecast(); loadPointAlerts();
  }
  map.on("click", (e) => select(e.latlng.lat, e.latlng.lng, null));

  async function search(qs) {
    const ul = $("wx-results");
    if (!qs.trim()) { ul.hidden = true; return; }
    try {
      const d = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(qs.trim())}&count=8&language=en&format=json`)).json();
      const rs = d.results || [];
      ul.innerHTML = rs.length ? rs.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}<small>${esc([r.admin1, r.country].filter(Boolean).join(", "))}</small></button></li>`).join("")
        : '<li class="none">No places found. Try a city name, e.g. “Pensacola”.</li>';
      ul.hidden = false;
      ul.querySelectorAll("button").forEach((b) => (b.onclick = () => {
        const r = rs[+b.dataset.i]; ul.hidden = true;
        select(r.latitude, r.longitude, [r.name, r.admin1 || r.country].filter(Boolean).join(", "), { fly: true, us: r.country_code === "US" ? undefined : false });
      }));
    } catch (e) {
      ul.innerHTML = '<li class="none">Search is unavailable right now.</li>'; ul.hidden = false;
      console.warn("ZXN geocode:", e.message);
    }
  }
  $("wx-search").onsubmit = (e) => { e.preventDefault(); search($("wx-q").value); };
  let deb; $("wx-q").oninput = () => { clearTimeout(deb); deb = setTimeout(() => $("wx-q").value.trim().length >= 3 && search($("wx-q").value), 350); };
  document.addEventListener("click", (e) => { if (!e.target.closest(".wx-search")) $("wx-results").hidden = true; });
  $("wx-locate").onclick = () => {
    if (!navigator.geolocation) { $("wx-locate").textContent = "Location not supported"; return; }
    $("wx-locate").textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(
      (p) => { $("wx-locate").textContent = "📍 Use my location"; select(p.coords.latitude, p.coords.longitude, null, { fly: true }); },
      () => { $("wx-locate").textContent = "📍 Location blocked"; setTimeout(() => ($("wx-locate").textContent = "📍 Use my location"), 3000); },
      { timeout: 10000, maximumAge: 600000 });
  };

  // ---------- start + refresh ----------
  loadRadar(); loadStorms(); select(DEFAULT.lat, DEFAULT.lon, null);
  setTimeout(() => play(true), 1500);
  setInterval(loadRadar, 10 * 60 * 1000);
  setInterval(loadStorms, 30 * 60 * 1000);
  setInterval(loadForecast, 15 * 60 * 1000);
  setInterval(loadPointAlerts, 5 * 60 * 1000);
  window.ZXNWeather = { map, select, search, rv };
})();
