#!/usr/bin/env python3
"""
ZXN site updater: turns raw X API v2 data into data/posts.json and downloads images.

HOW TO REFRESH
--------------
1. Fetch fresh posts for @zxnbluehandus (user id 2011476148178599939) with the X API v2
   endpoint GET /2/users/2011476148178599939/tweets  (or the `x` MCP tool `get_users_posts`)
   using these parameters:
       max_results=25
       exclude=retweets,replies
       post.fields=created_at,public_metrics,attachments,entities,note_tweet,referenced_tweets
       expansions=attachments.media_keys
       media.fields=url,preview_image_url,type,width,height,alt_text
   Repeat with pagination_token=<meta.next_token> for more pages (2-4 pages is plenty).
   Optionally GET /2/users/2011476148178599939 with
       user.fields=description,profile_image_url,profile_banner_url,public_metrics,name,username,location
2. Save them into data/raw_pages.json in this shape:
       {"fetched_at": "...", "user": <user object>, "pages": [<response page 1>, <response page 2>, ...]}
   (Each page is the API response as-is: {"data": [...], "includes": {"media": [...]}, "meta": {...}}.)
   If you have a bearer token you can let this script do step 1+2:   X_BEARER_TOKEN=... python3 update.py --fetch 3
3. Run:   python3 update.py
   -> writes data/posts.json and downloads post/link-card images into images/.
   The Top Story pin lives in data/site_config.json ("pinned_top": "<post id>" or null).
   This script only READS that file and copies the pin into posts.json; it never changes it.
   Only the site owner (in chat) changes the pin. Posts on X never change it, including
   "make this top story" quote-posts, which are hidden as editorial notes.
   LIVE NOW: every run also writes data/live.json (see detect_live below). When one of the
   newest posts links to an X live broadcast (x.com/i/broadcasts/<id>) posted within the last
   3 hours, live.json says {"live": true, ...} and the page shows the LIVE NOW player.
   X's API doesn't say when a broadcast has ended, so "live" means "posted in the last
   3 hours" (change with "live_window_hours" in site_config.json). To end it early, add the
   post id to "live_ended_post_ids" in site_config.json. data/live.json must be published
   along with data/posts.json.
4. Reload index.html (served over http, e.g.  python3 -m http.server 8080).

Nothing is invented: headlines come from the first line of each post (or, for link-only
posts, the title X attached to the link card). Test posts, reply-style posts and exact
duplicates are kept in posts.json but marked "hidden" so the page skips them.
"""
import html, json, os, re, sys, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "raw_pages.json")
ARCHIVE = os.path.join(ROOT, "data", "raw_archive.json")  # older backfilled posts (backfill.py); never rewritten by refresh
# Image policy (keeps the repo small): the newest RECENT_FULL posts get "medium" images,
# older posts get "small" ones, and posts older than IMAGE_MAX_AGE_DAYS get no local image
# (the page draws a branded tile / link preview instead).
RECENT_FULL = 60
IMAGE_MAX_AGE_DAYS = 60
OUT = os.path.join(ROOT, "data", "posts.json")
IMG = os.path.join(ROOT, "images")
USER_ID = "2011476148178599939"
UA = {"User-Agent": "Mozilla/5.0 (zxn-site updater)"}


def fetch_from_api(pages):
    token = os.environ.get("X_BEARER_TOKEN")
    if not token:
        sys.exit("Set X_BEARER_TOKEN to use --fetch (or save raw_pages.json yourself).")
    hdr = {"Authorization": f"Bearer {token}", **UA}
    def get(url):
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=30))
    user = get(f"https://api.x.com/2/users/{USER_ID}?user.fields=description,profile_image_url,"
               "profile_banner_url,public_metrics,name,username,location,created_at")["data"]
    params = {"max_results": 25, "exclude": "retweets,replies",
              "post.fields": "created_at,public_metrics,attachments,entities,note_tweet,referenced_tweets",
              "expansions": "attachments.media_keys",
              "media.fields": "url,preview_image_url,type,width,height,alt_text"}
    out, token_ = [], None
    for _ in range(pages):
        q = dict(params, **({"pagination_token": token_} if token_ else {}))
        page = get(f"https://api.x.com/2/users/{USER_ID}/tweets?" + urllib.parse.urlencode(q))
        out.append(page)
        token_ = page.get("meta", {}).get("next_token")
        if not token_:
            break
    import datetime
    raw = {"fetched_at": datetime.datetime.utcnow().isoformat() + "Z", "user": user, "pages": out}
    json.dump(raw, open(RAW, "w"), ensure_ascii=False, indent=1)
    print(f"saved {sum(len(p.get('data', [])) for p in out)} posts to {RAW}")


def shrink(data, max_w=720):
    """Re-encode a downloaded image as a <=720px-wide JPEG (keeps the repo small). No-op without Pillow."""
    try:
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=78, optimize=True, progressive=True)
        return buf.getvalue() if buf.tell() < len(data) else data
    except Exception:
        return data


def download(url, name):
    """Download url into images/<name> once; return the site-relative path (or None)."""
    if not url:
        return None
    path = os.path.join(IMG, name)
    if not os.path.exists(path):
        try:
            req = urllib.request.Request(url, headers=UA)
            data = urllib.request.urlopen(req, timeout=30).read()
            open(path, "wb").write(shrink(data))
        except Exception as e:  # keep going; fall back to hotlink (or no image if it's gone)
            print(f"  ! image failed {url}: {e}")
            return None if getattr(e, "code", None) in (403, 404, 410) else url
    return f"images/{name}"


def kicker(url):
    u = (url or "").lower()
    if "/i/spaces/" in u: return "X Space"
    if "/i/broadcasts/" in u: return "Live"
    if "youtu" in u: return "Video"
    if "flowmusic" in u or "music.apple" in u: return "Music"
    if "drive.google" in u: return "Download"
    return "Link"


CONFIG = os.path.join(ROOT, "data", "site_config.json")
# Short notes like "Make this top story" / "pin this" / "put this on the front page".
EDITORIAL_RE = re.compile(r"\b(top story|lead story|main story|front ?page|pin (this|it)|feature (this|it)|headline (this|it))\b", re.I)
TEST_RE = re.compile(r"^(test|testing)(\s+(in|\d+))?(\s+youtube live)?$", re.I)


LIVE_OUT = os.environ.get("ZXN_LIVE_OUT") or os.path.join(ROOT, "data", "live.json")
BROADCAST_RE = re.compile(r"https?://(?:www\.)?(?:x|twitter)\.com/i/broadcasts/([A-Za-z0-9]+)")


def detect_live(posts, config):
    """Write data/live.json from the newest broadcast-link post. Only real post data is used."""
    import datetime
    now = os.environ.get("ZXN_NOW")  # testing only: pretend the current time is this ISO time
    now = datetime.datetime.fromisoformat(now.replace("Z", "+00:00")) if now else datetime.datetime.now(datetime.timezone.utc)
    window = float(config.get("live_window_hours", 3))
    ended = set(config.get("live_ended_post_ids") or [])
    newest = None
    for p in sorted(posts, key=lambda p: p["created_at"], reverse=True):
        if p["hidden"] and (p["hidden_reason"] == "test post" or str(p["hidden_reason"]).startswith("editorial")):
            continue
        hay = " ".join([p["original_text"], (p.get("link") or {}).get("url") or ""] + p.get("_expanded_urls", []))
        m = BROADCAST_RE.search(hay)
        if m:
            newest = (p, m.group(0), m.group(1)); break
    out = {"live": False, "checked_at": now.isoformat().replace("+00:00", "Z"),
           "detection": f"A post linking to an X broadcast counts as live for {window:g} h after posting "
                        "(X's API doesn't report when a broadcast ends)."}
    if newest:
        p, url, bid = newest
        started = datetime.datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
        age_h = (now - started).total_seconds() / 3600
        info = {"post_id": p["id"], "post_url": p["url"], "broadcast_id": bid,
                "broadcast_url": f"https://x.com/i/broadcasts/{bid}",
                "title": ((p.get("link") or {}).get("title") or p["headline"]),
                "post_text": p["text"], "started_at": p["created_at"],
                "assumed_live_until": (started + datetime.timedelta(hours=window)).isoformat().replace("+00:00", "Z")}
        if 0 <= age_h <= window and p["id"] not in ended:
            out.update(live=True, **info)
        elif age_h <= 24 * 7:
            out["recent"] = info
    os.makedirs(os.path.dirname(LIVE_OUT), exist_ok=True)
    json.dump(out, open(LIVE_OUT, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {LIVE_OUT}: live={out['live']}" + (f" post {out['post_id']} ({out['title']})" if out["live"] else
          (f" (most recent broadcast post {out['recent']['post_id']}, {out['recent']['started_at']})" if out.get("recent") else "")))
    return out


def build():
    import datetime
    raw = json.load(open(RAW))
    arch = json.load(open(ARCHIVE)) if os.path.exists(ARCHIVE) else {"pages": []}
    pages = raw["pages"] + arch.get("pages", [])
    os.makedirs(IMG, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    media = {}
    for p in pages:
        for m in p.get("includes", {}).get("media", []):
            media[m["media_key"]] = m
    posts, seen = [], set()
    allp = [t for p in pages for t in p.get("data", [])]
    allp.sort(key=lambda t: t["created_at"], reverse=True)
    # de-duplicate by id (refresh pages can overlap)
    _seen_ids, _uniq = set(), []
    for t in allp:
        if t["id"] not in _seen_ids:
            _seen_ids.add(t["id"]); _uniq.append(t)
    allp = _uniq
    own_ids = set(_seen_ids)
    for rank, t in enumerate(allp):
        age_days = (now - datetime.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))).days
        img_ok = age_days <= IMAGE_MAX_AGE_DAYS
        size = "medium" if rank < RECENT_FULL else "small"
        no_ent = bool(t.get("_no_entities"))
        has_media = bool((t.get("attachments") or {}).get("media_keys"))
        note = t.get("note_tweet") or {}
        text = html.unescape(note.get("text") or t["text"])
        urls = (t.get("entities") or {}).get("urls", []) + (note.get("entities") or {}).get("urls", [])
        by_tco = {u["url"]: u for u in urls}
        card = next((u for u in urls if u.get("title")), None)
        links = []
        def repl(m):
            u = by_tco.get(m.group(0))
            if not u:
                if no_ent and not (has_media and m.end() >= len(text.rstrip())):
                    return m.group(0)  # page came back without entities: keep the real t.co link
                return ""  # unknown t.co (usually the trailing media link of a truncated post)
            if u.get("media_key") or "pic.x.com" in u.get("display_url", ""):
                return ""
            if u is card:
                return ""  # shown as the link card instead
            return u["expanded_url"]
        clean = re.sub(r"https://t\.co/\w+", repl, text)
        clean = re.sub(r"[ \t]+\n", "\n", clean).strip()
        bare = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", clean)  # markdown [label](url) -> label
        bare = re.sub(r"https?://\S+", "", bare).strip()
        pseudo = None
        if no_ent and not card:
            tcos = re.findall(r"https://t\.co/\w+", clean)
            if tcos:
                k = ("Video" if re.search(r"via @YouTube\b", text) else "Music" if "@YouTubeMusic" in text
                     else "X Space" if re.search(r"upcoming Space", text) else "Link")
                pseudo = {"url": tcos[0], "display": "t.co link", "kicker": k,
                          "title": {"Video": "Watch on YouTube", "Music": "Listen on YouTube Music",
                                    "X Space": "Open the X Space"}.get(k, "Open link")}
                if len(tcos) == 1 and k != "Link":
                    clean = re.sub(r"\s*https://t\.co/\w+", "", clean, count=1).strip()
        first = next((l.strip() for l in bare.split("\n") if l.strip()), "")
        first = re.sub(r"\s+via @YouTube(Music)?\b\s*", " ", first).strip()
        first = re.sub(r"\[([^\]]+)\]\(\s*\)", r"\1", first)  # markdown link whose URL was stripped
        first = re.sub(r"[*`]", "", first)
        headline_src = "post"
        card_title = None
        if card:
            card_title = re.sub(r"\s*/ X$", "", card["title"]).strip()
        if len(first) < 15 and card_title:
            headline = re.sub(r"^Happening now:\s*", "", card_title)
            headline_src = "link_title"
        else:
            headline = first
        headline = re.sub(r"\s{2,}", " ", headline)
        if len(headline) > 110:
            cut = headline[:110].rsplit(" ", 1)[0]
            headline = cut.rstrip(",.;:") + "…"
        # images: post media first, then link-card image
        images, img_src = [], None
        for mk in (t.get("attachments") or {}).get("media_keys", []):
            m = media.get(mk)
            if not m: continue
            src = m.get("url") or m.get("preview_image_url")
            if src:
                ext = ".jpg"
                if not img_ok:
                    continue
                local = download(src + f"?name={size}", f"{t['id']}_{len(images)}{ext}")
                if not local:
                    continue
                images.append({"src": local, "type": m["type"], "width": m.get("width"), "height": m.get("height")})
        if images:
            img_src = "post"
        elif card and card.get("images") and "/i/spaces/" not in card["expanded_url"]:
            # (X Spaces cards only carry X's generic microphone graphic, so the page draws a branded tile instead)
            if img_ok:
                cu = card["images"][0]["url"]
                local = download(cu, f"{t['id']}_card.jpg")
                if local:
                    images.append({"src": local, "type": "link_card"})
                    img_src = "link_card"
        hidden, reason = False, None
        quoted_ids = [r["id"] for r in (t.get("referenced_tweets") or []) if r.get("type") == "quoted"]
        quotes_own = any(q in own_ids for q in quoted_ids) or any(
            "/zxnbluehandus/status/" in (u.get("expanded_url") or "") for u in urls)
        if len(bare) <= 80 and EDITORIAL_RE.search(bare) and (quotes_own or quoted_ids or not urls or len(bare) <= 40):
            # editorial note to the site owner, not a story. Never changes the pin.
            hidden, reason = True, "editorial note (quote-post)" if quoted_ids else "editorial note"
        elif TEST_RE.match(bare) or (card_title or "").lower().startswith("happening now: test"):
            hidden, reason = True, "test post"
        elif bare.startswith("@") or (len(bare) < 10 and not card):
            hidden, reason = True, "reply-style / too short"
        key = (headline.lower(), (card or {}).get("expanded_url") or (pseudo or {}).get("url") or bare[:80].lower())
        if not hidden and key in seen:
            hidden, reason = True, "duplicate"
        if not hidden:
            seen.add(key)
        posts.append({
            "id": t["id"],
            "url": f"https://x.com/zxnbluehandus/status/{t['id']}",
            "created_at": t["created_at"],
            "headline": headline,
            "headline_source": headline_src,
            "text": clean,
            "original_text": text,
            "metrics": t.get("public_metrics", {}),
            "images": images,
            "image_source": img_src,
            "link": ({"url": card.get("unwound_url") or card["expanded_url"], "display": card.get("display_url"),
                      "title": card_title, "kicker": kicker(card["expanded_url"])} if card else pseudo),
            "has_video": any(i["type"] == "video" for i in images) or any(
                (media.get(k) or {}).get("type") == "video" for k in (t.get("attachments") or {}).get("media_keys", [])),
            "hidden": hidden,
            "hidden_reason": reason,
            "_expanded_urls": [u.get("unwound_url") or u.get("expanded_url") or "" for u in urls],
        })
    user = raw.get("user", {})
    if user.get("profile_image_url"):
        user["avatar_local"] = download(user["profile_image_url"].replace("_normal", "_400x400"), "avatar.jpg")
    if user.get("profile_banner_url"):
        user["banner_local"] = download(user["profile_banner_url"] + "/1500x500", "banner.jpg")
    config = json.load(open(CONFIG)) if os.path.exists(CONFIG) else {}
    pinned = config.get("pinned_top")
    if pinned and not any(p["id"] == pinned and not p["hidden"] for p in posts):
        print(f"  ! pinned_top {pinned} is not among the visible posts; the page will fall back to the automatic Top Story")
    detect_live(posts, config)
    for p in posts:
        p.pop("_expanded_urls", None)
    out = {"generated_from": "data/raw_pages.json + data/raw_archive.json", "fetched_at": raw.get("fetched_at"),
           "pinned_top": pinned, "user": user, "posts": posts}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    vis = [p for p in posts if not p["hidden"]]
    print(f"wrote {OUT}: {len(posts)} posts, {len(vis)} visible, {len(posts)-len(vis)} hidden, pinned_top={pinned}")
    for p in posts:
        if p["hidden"]:
            print(f"  hidden ({p['hidden_reason']}): {p['original_text'][:60]!r}")


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        i = sys.argv.index("--fetch")
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 2
        fetch_from_api(n)
    build()
