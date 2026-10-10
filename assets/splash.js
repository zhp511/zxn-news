// ZXN welcome splash: shown once per browser session; dismiss with Enter Site, click outside, Esc,
// or automatically after a few seconds (paused while the visitor hovers/tabs inside the card).
(function () {
  const KEY = "zxn_splash_seen";
  const AUTO_MS = 4500;
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) { /* storage blocked: still show once per page load */ }
  if (/[?&]nosplash\b/.test(location.search)) return;

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const prevFocus = document.activeElement;
  const root = document.createElement("div");
  root.className = "zxn-splash";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "sp-welcome");
  root.style.setProperty("--sp-ms", AUTO_MS + "ms");
  root.innerHTML = `
    <div class="sp-stars" aria-hidden="true"></div>
    <div class="sp-stripes sp-top" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="sp-card">
      <div class="sp-starrow" aria-hidden="true">★ ★ ★ ★ ★</div>
      <p class="sp-logo" aria-label="ZXN">Z<span class="x">X</span>N</p>
      <div class="sp-sub">“we are bluehand” ★ Patriot One Network</div>
      <h1 class="sp-welcome" id="sp-welcome">Welcome to ZXN News</h1>
      <div class="sp-maga">Make America Great</div>
      <div class="sp-live-slot"></div>
      <div class="sp-actions">
        <a class="sp-follow" href="https://x.com/zxnbluehandus" target="_blank" rel="noopener"><span class="xl">𝕏</span> Follow me on 𝕏 <b>@zxnbluehandus</b></a>
        <button class="sp-enter" type="button">Enter Site →</button>
      </div>
      <div class="sp-hint">Click anywhere or press Esc to continue</div>
      <div class="sp-timer" aria-hidden="true"></div>
    </div>
    <div class="sp-stripes sp-bottom" aria-hidden="true"><i></i><i></i><i></i></div>`;

  let timer = null, left = AUTO_MS, started = 0, closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    document.removeEventListener("keydown", onKey, true);
    root.classList.add("closing");
    const done = () => {
      root.remove();
      document.documentElement.classList.remove("zxn-splash-open");
      if (prevFocus && prevFocus.focus && prevFocus !== document.body) prevFocus.focus();
    };
    reduce ? done() : setTimeout(done, 460);
  }
  function startTimer() { started = Date.now(); clearTimeout(timer); timer = setTimeout(close, left); root.classList.remove("paused"); }
  function pauseTimer() { if (!timer) return; clearTimeout(timer); timer = null; left = Math.max(1200, left - (Date.now() - started)); root.classList.add("paused"); }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { // keep focus inside the dialog
      const f = [...root.querySelectorAll("a,button")];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }

  function mount() {
    document.body.appendChild(root);
    document.documentElement.classList.add("zxn-splash-open");
    const card = root.querySelector(".sp-card");
    root.addEventListener("click", (e) => { if (!card.contains(e.target)) close(); });
    root.querySelector(".sp-enter").addEventListener("click", close);
    // following / watching opens X in a new tab and lets them into the site behind it
    root.addEventListener("click", (e) => { if (e.target.closest(".sp-follow,.sp-live")) setTimeout(close, 150); });
    card.addEventListener("mouseenter", pauseTimer);
    card.addEventListener("mouseleave", () => { if (!card.contains(document.activeElement) || document.activeElement === document.body) startTimer(); });
    document.addEventListener("keydown", onKey, true);
    root.querySelector(".sp-enter").focus({ preventScroll: true });
    // keyboard users get more time once they start tabbing
    root.addEventListener("keyup", (e) => { if (e.key === "Tab") pauseTimer(); });
    startTimer();
    // small "Live now" line when the LIVE NOW section would be showing
    fetch("data/live.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || !d.live || !d.post_id || closed) return;
      if (d.assumed_live_until && new Date(d.assumed_live_until) <= new Date()) return;
      const a = document.createElement("a");
      a.className = "sp-live"; a.target = "_blank"; a.rel = "noopener";
      a.href = d.broadcast_url || d.post_url;
      a.textContent = "🔴 Live now on 𝕏 — watch the stream";
      root.querySelector(".sp-live-slot").appendChild(a);
    }).catch(() => {});
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
