// ZXN site: renders everything from data/posts.json (built by update.py).
(function () {
  const TZ = "America/Chicago";
  const fmtDate = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const fmtShort = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fmtToday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ct = (iso, short) => (short ? fmtShort : fmtDate).format(new Date(iso)) + " CT";
  const num = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n || 0));

  // Turn post text into safe HTML: links, @mentions, #hashtags, light markdown.
  function richText(text) {
    let h = esc(text);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
    h = h.replace(/\[([^\]]+)\]\(\s*\)/g, "$1");
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, pre, url) => {
      const label = url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40) + (url.length > 48 ? "…" : "");
      return `${pre}<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
    });
    h = h.replace(/(^|[^\w&])@(\w{1,15})/g, '$1<a href="https://x.com/$2" target="_blank" rel="noopener">@$2</a>');
    h = h.replace(/(^|[^\w&])#(\w+)/g, '$1<a href="https://x.com/hashtag/$2" target="_blank" rel="noopener">#$2</a>');
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
    return h.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  }

  // Body text shown under the headline (avoid repeating the headline when it IS the first line).
  function bodyText(p) {
    const t = p.text || "";
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    if (norm(t) === norm(p.headline)) return "";
    if (p.headline_source !== "post" || p.headline.endsWith("…")) return t;
    const lines = t.split("\n");
    const rest = lines.slice(1).join("\n").trim();
    const firstLeft = lines[0].replace(/https?:\/\/\S+/g, "").replace(/\s+via @YouTube\s*/, " ").trim();
    return firstLeft.length > p.headline.length + 3 ? t : rest;
  }

  function media(p, big) {
    const img = p.images && p.images[0];
    if (img) {
      const vid = p.has_video ? '<span class="badge-video">▶ Video on X</span>' : "";
      return `<a class="media" href="${p.url}" target="_blank" rel="noopener"><img src="${esc(img.src)}" alt="${esc(p.headline)}" loading="${big ? "eager" : "lazy"}">${vid}</a>`;
    }
    const k = p.link ? p.link.kicker : "ZXN";
    const t = p.link && p.link.title && p.link.title !== p.headline ? p.link.title : "ZXN · Patriot One Network";
    return `<a class="media" href="${p.url}" target="_blank" rel="noopener"><div class="tile"><span class="t-kicker">${esc(k)}</span><span class="t-title">${esc(t)}</span></div></a>`;
  }

  function linkChip(p) {
    if (!p.link) return "";
    return `<a class="linkchip" href="${esc(p.link.url)}" target="_blank" rel="noopener"><b>${esc(p.link.kicker)}</b><span>${esc(p.link.title || p.link.display || p.link.url)}</span></a>`;
  }

  function metaRow(p, short) {
    const m = p.metrics || {};
    return `<div class="meta"><time datetime="${p.created_at}">${ct(p.created_at, short)}</time>
      <span class="stats"><span title="Likes">♥ ${num(m.like_count)}</span><span title="Reposts">⟲ ${num(m.retweet_count)}</span><span title="Views">👁 ${num(m.impression_count)}</span></span>
      <a class="readon" href="${p.url}" target="_blank" rel="noopener">Read on 𝕏 →</a></div>`;
  }

  function kickerLabel(p) {
    if (p.has_video) return '<span class="kicker red">Video</span>';
    if (p.image_source === "post") return '<span class="kicker red">ZXN</span>';
    return `<span class="kicker">${esc(p.link ? p.link.kicker : "ZXN")}</span>`;
  }

  function card(p) {
    const body = bodyText(p);
    return `<article class="card">${media(p)}<div class="body">${kickerLabel(p)}
      <h3><a href="${p.url}" target="_blank" rel="noopener">${esc(p.headline)}</a></h3>
      ${body ? `<div class="text clamp">${richText(body)}</div>` : '<div class="text"></div>'}
      ${linkChip(p)}${metaRow(p, true)}</div></article>`;
  }

  // Archive: every visible story, grouped by month, then by day (America/Chicago).
  const fmtMonth = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" });
  const fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
  const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  function renderArchive(posts) {
    const box = $("archive-list");
    if (!box) return;
    const months = new Map();
    for (const p of posts) {
      const d = new Date(p.created_at), m = fmtMonth.format(d), day = fmtDay.format(d);
      if (!months.has(m)) months.set(m, new Map());
      const days = months.get(m);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(p);
    }
    let i = 0;
    box.innerHTML = [...months].map(([m, days]) => {
      const n = [...days.values()].reduce((a, l) => a + l.length, 0);
      return `<details class="arc-month"${i++ === 0 ? " open" : ""}><summary><span>${esc(m)}</span><span class="arc-n">${n} stories</span></summary>
        ${[...days].map(([day, list]) => `<div class="arc-day"><h4>${esc(day)}</h4><ul>${list.map((p) => `<li>
          <time datetime="${p.created_at}">${fmtTime.format(new Date(p.created_at))}</time>
          <span class="arc-k">${esc(p.has_video ? "Video" : p.link ? p.link.kicker : "ZXN")}</span>
          <a href="${p.url}" target="_blank" rel="noopener">${esc(p.headline)}</a></li>`).join("")}</ul></div>`).join("")}
      </details>`;
    }).join("");
    const c = $("archive-count");
    if (c) c.textContent = `${posts.length} stories since ${fmtDay.format(new Date(posts[posts.length - 1].created_at))}`;
  }

  function render(data) {
    const posts = data.posts.filter((p) => !p.hidden).sort((a, b) => b.created_at.localeCompare(a.created_at));
    // Top story = most-viewed post that has its own photo/video.
    const withMedia = posts.filter((p) => p.image_source === "post");
    // A pin set by the site owner (data.pinned_top) wins; otherwise pick automatically.
    const pinned = data.pinned_top && posts.find((p) => p.id === data.pinned_top);
    const featured = pinned || (withMedia.length ? withMedia : posts).slice().sort((a, b) => (b.metrics.impression_count || 0) - (a.metrics.impression_count || 0))[0];
    const rest = posts.filter((p) => p !== featured);

    $("featured").innerHTML = `${media(featured, true)}<div class="body">${kickerLabel(featured)} <span class="kicker">Top Story</span>
      <h1><a href="${featured.url}" target="_blank" rel="noopener">${esc(featured.headline)}</a></h1>
      <div class="text">${richText(bodyText(featured))}</div>${linkChip(featured)}${metaRow(featured)}</div>`;

    $("justin").innerHTML = rest.slice(0, 6).map((p) => `<li><div><a href="${p.url}" target="_blank" rel="noopener">${esc(p.headline)}</a><time>${ct(p.created_at, true)}</time></div></li>`).join("");
    // Latest grid: newest PAGE stories, then "Load more" adds PAGE at a time.
    const PAGE = 24;
    let shown = 0;
    const grid = $("grid"), more = $("load-more");
    function showMore() {
      grid.insertAdjacentHTML("beforeend", rest.slice(shown, shown + PAGE).map(card).join(""));
      shown = Math.min(rest.length, shown + PAGE);
      if (more) {
        more.hidden = shown >= rest.length;
        more.textContent = `Load more stories (${rest.length - shown} more)`;
      }
      const c = $("latest-count");
      if (c) c.textContent = `Showing ${shown} of ${rest.length}`;
    }
    grid.innerHTML = "";
    showMore();
    if (more) more.onclick = showMore;
    renderArchive(posts);

    const u = data.user || {};
    const pm = u.public_metrics || {};
    $("about").innerHTML = `${u.banner_local ? `<div class="banner" style="background-image:url('${esc(u.banner_local)}')"></div>` : ""}
      ${u.avatar_local ? `<img class="avatar" src="${esc(u.avatar_local)}" alt="${esc(u.name)}">` : "<div></div>"}
      <div><h2>About ZXN</h2><div class="handle">${esc(u.name || "")} · @${esc(u.username || "zxnbluehandus")}${u.location ? " · " + esc(u.location) : ""}</div>
      <blockquote>${esc(u.description || "")}</blockquote>
      <div class="stats"><div><b>${num(pm.followers_count)}</b>Followers</div><div><b>${num(pm.tweet_count)}</b>Posts</div><div><b>${num(pm.media_count)}</b>Media</div></div>
      <a class="follow-btn" href="https://x.com/${esc(u.username || "zxnbluehandus")}" target="_blank" rel="noopener">Follow @${esc(u.username || "zxnbluehandus")} on 𝕏</a></div>`;

    if (data.fetched_at) $("updated").textContent = "Stories updated " + ct(data.fetched_at) + ".";
  }

  $("today").textContent = fmtToday.format(new Date());
  fetch("data/posts.json", { cache: "no-store" })
    .then((r) => r.json())
    .then(render)
    .catch((e) => {
      $("grid").innerHTML = `<p>Couldn't load stories (${esc(e.message)}). Open this site through a web server, e.g. <code>python3 -m http.server</code>.</p>`;
    });
})();
