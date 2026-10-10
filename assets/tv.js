// ZXN TV: a small floating player for free, official live news streams (publisher YouTube embeds).
// Channel list + current live video ids come from data/tv.json (tv_channels.py). DIRECTV is a link-out only.
(function () {
  const KEY = "zxn_tv";
  const FALLBACK = [ // used only if data/tv.json can't be loaded
    { key: "foxweather", name: "FOX Weather", type: "youtube", video_id: "mBwgGwy0bnw", watch_url: "https://www.youtube.com/@FOXWeather/live", ok: true },
    { key: "livenow", name: "LiveNOW from FOX", type: "youtube", video_id: "YPkbu-ELE0M", watch_url: "https://www.youtube.com/@LiveNOWFOX/live", ok: true },
    { key: "directv", name: "DIRECTV", type: "link", url: "https://stream.directv.com/", note: "DIRECTV subscribers: sign in on DIRECTV to watch" },
  ];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const st = Object.assign({ open: false, big: false, closed: false, ch: null, x: null, y: null }, load());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const mobile = () => matchMedia("(max-width: 700px)").matches;

  let channels = [], player = null, apiPromise = null, apiTimer = null;
  const root = document.createElement("div");
  root.id = "zxn-tv";
  root.className = "ztv";
  root.innerHTML = `
    <button class="ztv-pill" type="button" aria-label="Open ZXN TV live news player"><span class="ztv-dot" aria-hidden="true"></span>▶ ZXN TV</button>
    <section class="ztv-panel" role="region" aria-label="ZXN TV live news player" hidden>
      <div class="ztv-bar" title="Drag to move">
        <span class="ztv-brand">ZXN <b>TV</b></span>
        <span class="ztv-live" aria-hidden="true">LIVE</span>
        <span class="ztv-ch" aria-live="polite"></span>
        <span class="ztv-btns">
          <button type="button" class="ztv-big" aria-label="Expand player" title="Expand">⤢</button>
          <button type="button" class="ztv-min" aria-label="Minimize player" title="Minimize">–</button>
          <button type="button" class="ztv-x" aria-label="Close ZXN TV" title="Close">×</button>
        </span>
      </div>
      <div class="ztv-screen"><div class="ztv-frame"><div id="ztv-player"></div></div><div class="ztv-over" hidden></div></div>
      <div class="ztv-chans" role="tablist" aria-label="Channels"></div>
      <div class="ztv-foot"><a class="ztv-yt" href="#" target="_blank" rel="noopener">Watch on YouTube ↗</a><span>Free official streams · starts muted</span></div>
    </section>`;

  const $ = (s) => root.querySelector(s);
  const panel = $(".ztv-panel"), pill = $(".ztv-pill"), over = $(".ztv-over");
  const cur = () => channels.find((c) => c.key === st.ch) || channels[0];

  function api() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!apiPromise) apiPromise = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api"; s.async = true; s.onerror = rej;
      document.head.appendChild(s);
      setTimeout(() => rej(new Error("timeout")), 10000);
    });
    return apiPromise;
  }

  function fallback(c, msg) {
    over.hidden = false;
    over.className = "ztv-over";
    over.innerHTML = `<div><b>${esc(c.name)}</b><p>${esc(msg || "This stream can't play here right now.")}</p>
      <a class="ztv-cta" href="${esc(c.watch_url)}" target="_blank" rel="noopener">Watch on YouTube ↗</a></div>`;
  }

  function stop() {
    clearTimeout(apiTimer);
    if (player && player.destroy) { try { player.destroy(); } catch (e) {} }
    player = null;
    const f = $(".ztv-frame");
    f.innerHTML = '<div id="ztv-player"></div>';
  }

  function tune() {
    const c = cur();
    if (!c) return;
    st.ch = c.key; save();
    $(".ztv-ch").textContent = c.name;
    root.querySelectorAll(".ztv-chans button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === c.key)));
    const yt = $(".ztv-yt");
    yt.hidden = c.type !== "youtube";
    $(".ztv-live").hidden = c.type !== "youtube";
    if (c.type === "youtube") yt.href = c.watch_url;
    if (c.type === "link") { // DIRECTV: branded text tile, never embedded
      stop();
      over.hidden = false;
      over.className = "ztv-over ztv-dtv";
      over.innerHTML = `<div><div class="ztv-dtv-name">DIRECTV</div>
        <a class="ztv-cta" href="${esc(c.url)}" target="_blank" rel="noopener">Watch on DIRECTV ↗</a>
        <p class="ztv-note">${esc(c.note)}</p></div>`;
      return;
    }
    over.hidden = true;
    if (player && player.loadVideoById) { player.loadVideoById(c.video_id); player.mute(); return; }
    stop();
    api().then(() => {
      if (panel.hidden || cur() !== c) return;
      player = new YT.Player("ztv-player", {
        videoId: c.video_id, width: "100%", height: "100%",
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => { e.target.mute(); e.target.playVideo(); },
          onError: () => fallback(cur()),
        },
      });
    }).catch(() => fallback(c, "The YouTube player didn't load."));
  }

  function place() {
    if (mobile() || st.x == null) { root.style.right = root.style.bottom = root.style.left = root.style.top = ""; return; }
    const w = root.offsetWidth, h = root.offsetHeight;
    st.x = Math.max(8, Math.min(st.x, innerWidth - w - 8));
    st.y = Math.max(8, Math.min(st.y, innerHeight - h - 8));
    root.style.right = st.x + "px"; root.style.bottom = st.y + "px";
  }

  function render() {
    root.hidden = st.closed;
    const open = st.open && !st.closed;
    panel.hidden = !open;
    pill.hidden = open;
    root.classList.toggle("big", !!st.big && !mobile());
    $(".ztv-big").textContent = st.big ? "⤡" : "⤢";
    $(".ztv-big").setAttribute("aria-label", st.big ? "Shrink player" : "Expand player");
    place();
  }

  function openTV() { st.open = true; st.closed = false; save(); render(); tune(); }
  function minimize() { st.open = false; save(); stop(); render(); }

  pill.onclick = openTV;
  $(".ztv-min").onclick = minimize;
  $(".ztv-x").onclick = () => { st.open = false; st.closed = true; save(); stop(); render(); };
  $(".ztv-big").onclick = () => { st.big = !st.big; save(); render(); };
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href="#zxn-tv"]');
    if (a) { e.preventDefault(); openTV(); }
  });

  // Drag by the title bar (desktop only); position remembered.
  const bar = $(".ztv-bar");
  bar.addEventListener("pointerdown", (e) => {
    if (mobile() || e.target.closest("button")) return;
    const r = root.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, right0 = innerWidth - r.right, bottom0 = innerHeight - r.bottom;
    bar.setPointerCapture(e.pointerId);
    root.classList.add("dragging");
    const move = (ev) => { st.x = right0 - (ev.clientX - sx); st.y = bottom0 - (ev.clientY - sy); place(); };
    const up = () => { root.classList.remove("dragging"); bar.removeEventListener("pointermove", move); save(); };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up, { once: true });
    bar.addEventListener("pointercancel", up, { once: true });
  });
  addEventListener("resize", place);

  function buildChannels(list) {
    channels = list.filter((c) => c.type === "link" || (c.ok !== false && c.video_id));
    $(".ztv-chans").innerHTML = channels.map((c) =>
      `<button type="button" role="tab" data-k="${esc(c.key)}" class="${c.type === "link" ? "dtv" : ""}">${esc(c.name)}</button>`).join("");
    root.querySelectorAll(".ztv-chans button").forEach((b) => (b.onclick = () => { st.ch = b.dataset.k; save(); tune(); }));
  }

  function start() {
    document.body.appendChild(root);
    render();
    fetch("data/tv.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
      buildChannels((d && d.channels && d.channels.length) ? d.channels : FALLBACK);
      if (!st.open || st.closed) return;
      // Never play under the welcome splash: wait until it closes.
      const html = document.documentElement;
      if (!html.classList.contains("zxn-splash-open")) return tune();
      panel.hidden = true; pill.hidden = false;
      const mo = new MutationObserver(() => {
        if (!html.classList.contains("zxn-splash-open")) { mo.disconnect(); render(); tune(); }
      });
      mo.observe(html, { attributes: true, attributeFilter: ["class"] });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
