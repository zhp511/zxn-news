// ZXN LIVE NOW: shows a pulsing LIVE bar + X's official post embed when data/live.json says live.
// Polls every 60 s so it appears/disappears without reloading. Hidden when not live.
(function () {
  const el = document.getElementById("live-now");
  if (!el) return;
  const POLL_MS = 60 * 1000;
  const CT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let shown = null; // post id currently rendered

  function loadWidgets() {
    if (window.twttr && window.twttr.widgets) return Promise.resolve(window.twttr);
    if (loadWidgets.p) return loadWidgets.p;
    loadWidgets.p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://platform.twitter.com/widgets.js"; s.async = true; s.charset = "utf-8";
      s.onload = () => (window.twttr && window.twttr.ready ? window.twttr.ready(resolve) : reject(new Error("no twttr")));
      s.onerror = () => { loadWidgets.p = null; reject(new Error("widgets.js blocked")); };
      document.head.appendChild(s);
    });
    return loadWidgets.p;
  }

  function hide() {
    if (!el.hidden) { el.hidden = true; el.innerHTML = ""; }
    shown = null;
    document.body.classList.remove("is-live");
  }

  function show(d) {
    if (shown === d.post_id) return;
    shown = d.post_id;
    document.body.classList.add("is-live");
    el.hidden = false;
    el.innerHTML = `<div class="live-bar"><span class="live-dot" aria-hidden="true"></span><span class="live-word">LIVE NOW</span>
        <span class="live-title">${esc(d.title)}</span>
        <span class="live-since">Started ${esc(CT.format(new Date(d.started_at)))} CT</span>
        <a class="live-btn" href="${esc(d.broadcast_url || d.post_url)}" target="_blank" rel="noopener">▶ Watch live on 𝕏</a></div>
      <div class="live-body">
        <div class="live-embed" id="live-embed"><div class="live-loading">Loading the live post from 𝕏…</div></div>
        <div class="live-side">
          <h2>@zxnbluehandus is live on 𝕏</h2>
          ${d.post_text ? `<p class="live-text">${esc(d.post_text)}</p>` : ""}
          <a class="live-btn big" href="${esc(d.broadcast_url || d.post_url)}" target="_blank" rel="noopener">▶ Watch the live stream on 𝕏</a>
          <a class="live-link" href="${esc(d.post_url)}" target="_blank" rel="noopener">Open the post →</a>
          <p class="live-note">The stream plays on 𝕏. If the player doesn't appear here, use the button above.</p>
        </div></div>`;
    const box = document.getElementById("live-embed");
    const fallback = () => {
      if (shown !== d.post_id || box.querySelector("iframe")) return;
      box.innerHTML = `<a class="live-fallback" href="${esc(d.broadcast_url || d.post_url)}" target="_blank" rel="noopener">
        <span class="live-dot" aria-hidden="true"></span><b>LIVE</b><span>${esc(d.title)}</span><em>Tap to watch on 𝕏</em></a>`;
    };
    loadWidgets()
      .then((tw) => tw.widgets.createTweet(String(d.post_id), box, { theme: "dark", dnt: true, align: "center", conversation: "none" }))
      .then((node) => { if (node) { const l = box.querySelector(".live-loading"); if (l) l.remove(); } else fallback(); })
      .catch((e) => { console.warn("ZXN live embed:", e.message); fallback(); });
    setTimeout(fallback, 12000);
  }

  async function poll() {
    try {
      const r = await fetch("data/live.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("live.json " + r.status);
      const d = await r.json();
      if (d.live && d.post_id && (!d.assumed_live_until || new Date(d.assumed_live_until) > new Date())) show(d);
      else hide();
    } catch (e) {
      hide(); // missing/unreadable live.json = not live
    }
  }
  poll();
  setInterval(poll, POLL_MS);
})();
