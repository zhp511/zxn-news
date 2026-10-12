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
  const st = Object.assign({ open: false, big: false, closed: false, ch: null, x: null, y: null, ownSeen: null }, load());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const mobile = () => matchMedia("(max-width: 700px)").matches;

  let channels = [], player = null, apiPromise = null, apiTimer = null, tvList = null, xToken = 0;
  const alive = (b) => !b.assumed_live_until || new Date(b.assumed_live_until) > new Date();
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

  function widgets() {
    if (window.twttr && window.twttr.widgets) return Promise.resolve(window.twttr);
    if (widgets.p) return widgets.p;
    widgets.p = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://platform.twitter.com/widgets.js"; s.async = true; s.charset = "utf-8";
      s.onload = () => (window.twttr && window.twttr.ready ? window.twttr.ready(res) : rej(new Error("no twttr")));
      s.onerror = () => { widgets.p = null; rej(new Error("widgets.js blocked")); };
      document.head.appendChild(s);
    });
    return widgets.p;
  }

  // X broadcasts can't be iframed directly: show X's official post embed + a "Watch live on X" button.
  function showX(c) {
    const tok = ++xToken;
    over.hidden = false;
    over.className = "ztv-over ztv-x";
    over.innerHTML = `<div class="ztv-xwrap">
      <div class="ztv-xhead"><span class="ztv-xlive">● LIVE</span><b>${esc(c.name)}</b> <span>@${esc(c.username)}</span></div>
      <a class="ztv-cta" href="${esc(c.watch_url)}" target="_blank" rel="noopener">▶ Watch live on 𝕏</a>
      <div class="ztv-xembed"><p class="ztv-xload">Loading the post from 𝕏…</p></div></div>`;
    const box = over.querySelector(".ztv-xembed");
    const fb = () => {
      if (tok !== xToken || box.querySelector("iframe")) return;
      box.innerHTML = `<p class="ztv-xtext">${esc(c.text)}</p><a class="ztv-xopen" href="${esc(c.post_url)}" target="_blank" rel="noopener">Open the post on 𝕏 →</a>`;
    };
    widgets().then((tw) => tw.widgets.createTweet(String(c.post_id), box, { theme: "dark", dnt: true, conversation: "none", align: "center", width: 550 }))
      .then((n) => { if (tok !== xToken) return; if (n) { const l = box.querySelector(".ztv-xload"); if (l) l.remove(); } else fb(); })
      .catch(fb);
    setTimeout(fb, 10000);
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
    $(".ztv-live").hidden = c.type === "link";
    if (c.type === "youtube") yt.href = c.watch_url;
    root.classList.toggle("xmode", c.type === "xpost");
    $(".ztv-foot span").textContent = c.type === "xpost" ? "Live on 𝕏 · post shown as published" : c.type === "link" ? "Opens DIRECTV in a new tab" : "Free official streams · starts muted";
    if (c.type === "xpost") { stop(); showX(c); return; }
    xToken++;
    if (over.classList.contains("ztv-x")) { over.className = "ztv-over"; over.innerHTML = ""; over.hidden = true; }
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

  function buildChannels(list, own, xl) {
    const xs = [];
    if (own && own.live && own.post_id && alive(own)) xs.push({ key: "x-own", type: "xpost", own: true, name: "ZXN", username: "zxnbluehandus",
      post_id: own.post_id, post_url: own.post_url, watch_url: own.broadcast_url || own.post_url, text: own.post_text || own.title || "" });
    for (const b of (xl && xl.broadcasts) || []) if (alive(b)) xs.push({ key: "x-" + b.post_id, type: "xpost", name: b.name, username: b.username,
      post_id: b.post_id, post_url: b.post_url, watch_url: b.post_url, text: b.text });
    const tv = list.filter((c) => c.type === "link" || (c.ok !== false && c.video_id));
    channels = xs.concat(tv);
    const chip = (c) => `<button type="button" role="tab" data-k="${esc(c.key)}" class="${c.type === "link" ? "dtv" : c.type === "xpost" ? "xp" + (c.own ? " own" : "") : ""}"
      title="${esc(c.type === "xpost" ? c.name + " @" + c.username + " — " + c.text : c.name)}">${c.own ? '<span class="ztv-badge">LIVE</span>' : c.type === "xpost" ? "𝕏 " : ""}${esc(c.type === "xpost" && !c.own ? c.name : c.own ? "ZXN @zxnbluehandus" : c.name)}</button>`;
    $(".ztv-chans").innerHTML = (xs.length ? `<span class="ztv-grp">𝕏 Live</span>${xs.map(chip).join("")}<span class="ztv-grp">TV</span>` : "") + tv.map(chip).join("");
    root.querySelectorAll(".ztv-chans button").forEach((b) => (b.onclick = () => { st.ch = b.dataset.k; save(); tune(); }));
    const ownLive = xs.length && xs[0].own;
    root.classList.toggle("own-live", !!ownLive);
    pill.innerHTML = ownLive ? '<span class="ztv-dot" aria-hidden="true"></span>🔴 ZXN is LIVE · Watch' : '<span class="ztv-dot" aria-hidden="true"></span>▶ ZXN TV';
    if (ownLive && st.ownSeen !== own.post_id) { st.ownSeen = own.post_id; st.ch = "x-own"; save(); }
    const sel = root.querySelector(`.ztv-chans button[data-k="${CSS.escape((cur() || {}).key || "")}"]`);
    if (sel) sel.setAttribute("aria-selected", "true");
    strip(xs, ownLive);
  }

  // When ZXN isn't live, show a slim "Live on X now" strip in the LIVE NOW area (opens the player).
  function strip(xs, ownLive) {
    let el = document.getElementById("xlive-strip");
    const anchor = document.getElementById("live-now");
    const items = xs.filter((c) => !c.own).slice(0, 6);
    if (!anchor) return;
    if (!el) {
      el = document.createElement("div"); el.id = "xlive-strip"; el.className = "xlive-strip";
      anchor.insertAdjacentElement("afterend", el);
    }
    el.hidden = ownLive || !items.length || !anchor.hidden;
    el.innerHTML = `<span class="xls-label"><span class="ztv-dot" aria-hidden="true"></span>Live on 𝕏 now</span>
      <div class="xls-list">${items.map((c) => `<button type="button" data-k="${esc(c.key)}" title="${esc(c.text)}"><b>${esc(c.name)}</b><span>${esc(c.text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 70))}</span></button>`).join("")}</div>
      <a class="xls-tv" href="#zxn-tv">Open ZXN TV</a>`;
    el.querySelectorAll("button").forEach((b) => (b.onclick = () => { st.ch = b.dataset.k; save(); openTV(); }));
  }

  function refresh(first) {
    const j = (u) => fetch(u + "?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return Promise.all([tvList ? Promise.resolve(tvList) : j("data/tv.json"), j("data/live.json"), j("data/xlive.json")]).then(([d, own, xl]) => {
      tvList = (d && d.channels && d.channels.length) ? d : { channels: FALLBACK };
      const before = (cur() || {}).key;
      buildChannels(tvList.channels, own, xl);
      if (!first && !panel.hidden && (cur() || {}).key !== before) tune();
    });
  }

  function start() {
    document.body.appendChild(root);
    render();
    setInterval(() => refresh(false), 2 * 60 * 1000);
    refresh(true).then(() => {
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
