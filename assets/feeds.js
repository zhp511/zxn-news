// ZXN: "Trending on X" (data/trending.json) and "Accounts We Follow" (data/following.json).
// Both are built by the refresh routine from saved x-tool output (trending.py / following.py).
(function () {
  const TZ = "America/Chicago";
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const ct = (iso) => (iso ? fmt.format(new Date(iso)) + " CT" : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const get = (u) => fetch(u + "?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  function renderTrending(d) {
    const sec = $("trending");
    if (!sec) return;
    if (!d || (!(d.stories || []).length && !(d.trends || []).length)) { sec.hidden = true; return; }
    sec.hidden = false;
    $("tr-updated").textContent = d.news_fetched_at ? "From X News · updated " + ct(d.news_fetched_at) : "";
    $("tr-stories").innerHTML = (d.stories || []).map((s) => `<article class="tr-card">
      <span class="tr-k">${esc((s.topics || []).includes("Politics") ? "Politics" : (s.topics || [])[0] || "News")}</span>
      <h3><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.headline)}</a></h3>
      ${s.hook ? `<p class="tr-hook">${esc(s.hook)}</p>` : ""}
      ${s.summary ? `<p class="tr-sum">${esc(s.summary)}</p><button class="tr-more" type="button">Read more</button>` : ""}
      <div class="tr-foot"><a href="${esc(s.url)}" target="_blank" rel="noopener">Full story on 𝕏 →</a>
        ${(s.post_urls || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">Post ${i + 1}</a>`).join("")}
        <span>${esc(ct(s.updated_at))}</span></div></article>`).join("");
    $("tr-stories").querySelectorAll(".tr-card").forEach((c) => {
      const b = c.querySelector(".tr-more"), sum = c.querySelector(".tr-sum");
      if (!b) return;
      requestAnimationFrame(() => { if (sum.scrollHeight <= sum.clientHeight + 2) b.remove(); });
      b.onclick = () => { c.classList.toggle("open"); b.textContent = c.classList.contains("open") ? "Show less" : "Read more"; };
    });
    const tw = $("tr-trends");
    tw.parentElement.hidden = !(d.trends || []).length;
    tw.innerHTML = (d.trends || []).map((t, i) => `<a href="${esc(t.url)}" target="_blank" rel="noopener"><span class="n">${i + 1}</span>${esc(t.name)}</a>`).join("");
  }

  function linkify(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`);
  }

  function renderFollowing(d) {
    const sec = $("following"), nav = $("nav-following");
    const accts = ((d && d.accounts) || []).filter((a) => a.posts && a.posts.length);
    if (!sec) return;
    sec.hidden = !accts.length;
    if (nav) nav.hidden = !accts.length;
    if (!accts.length) return;
    $("fol-list").innerHTML = accts.map((a) => `<div class="fol-acct"><div class="fol-top">
        ${a.avatar ? `<img src="${esc(a.avatar)}" alt="" loading="lazy">` : ""}
        <div><a href="${esc(a.url)}" target="_blank" rel="noopener"><b>${esc(a.name)}</b><span class="h">@${esc(a.username)}</span></a></div></div>
        ${a.posts.map((p) => `<div class="fol-post">${linkify(p.text)}${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ""}
          <time><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(ct(p.created_at))} · View on 𝕏</a></time></div>`).join("")}
      </div>`).join("");
  }

  const load = () => { get("data/trending.json").then(renderTrending); get("data/following.json").then(renderFollowing); };
  load();
  setInterval(load, 15 * 60 * 1000);
})();
