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
4. Reload index.html (served over http, e.g.  python3 -m http.server 8080).

Nothing is invented: headlines come from the first line of each post (or, for link-only
posts, the title X attached to the link card). Test posts, reply-style posts and exact
duplicates are kept in posts.json but marked "hidden" so the page skips them.
"""
import html, json, os, re, sys, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "raw_pages.json")
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


def download(url, name):
    """Download url into images/<name> once; return the site-relative path (or None)."""
    if not url:
        return None
    path = os.path.join(IMG, name)
    if not os.path.exists(path):
        try:
            req = urllib.request.Request(url, headers=UA)
            data = urllib.request.urlopen(req, timeout=30).read()
            open(path, "wb").write(data)
        except Exception as e:  # keep going; fall back to hotlink
            print(f"  ! image failed {url}: {e}")
            return url
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


def build():
    raw = json.load(open(RAW))
    os.makedirs(IMG, exist_ok=True)
    media = {}
    for p in raw["pages"]:
        for m in p.get("includes", {}).get("media", []):
            media[m["media_key"]] = m
    posts, seen = [], set()
    allp = [t for p in raw["pages"] for t in p.get("data", [])]
    allp.sort(key=lambda t: t["created_at"], reverse=True)
    # de-duplicate by id (refresh pages can overlap)
    _seen_ids, _uniq = set(), []
    for t in allp:
        if t["id"] not in _seen_ids:
            _seen_ids.add(t["id"]); _uniq.append(t)
    allp = _uniq
    own_ids = set(_seen_ids)
    for t in allp:
        note = t.get("note_tweet") or {}
        text = html.unescape(note.get("text") or t["text"])
        urls = (t.get("entities") or {}).get("urls", []) + (note.get("entities") or {}).get("urls", [])
        by_tco = {u["url"]: u for u in urls}
        card = next((u for u in urls if u.get("title")), None)
        links = []
        def repl(m):
            u = by_tco.get(m.group(0))
            if not u:
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
        first = next((l.strip() for l in bare.split("\n") if l.strip()), "")
        first = re.sub(r"\s+via @YouTube\s*", " ", first).strip()
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
                local = download(src + ("?name=medium" if "/media/" in src else ""), f"{t['id']}_{len(images)}{ext}")
                images.append({"src": local, "type": m["type"], "width": m.get("width"), "height": m.get("height")})
        if images:
            img_src = "post"
        elif card and card.get("images") and "/i/spaces/" not in card["expanded_url"]:
            # (X Spaces cards only carry X's generic microphone graphic, so the page draws a branded tile instead)
            local = download(card["images"][0]["url"], f"{t['id']}_card.jpg")
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
        key = (headline.lower(), (card or {}).get("expanded_url") or bare[:80].lower())
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
                      "title": card_title, "kicker": kicker(card["expanded_url"])} if card else None),
            "has_video": any(i["type"] == "video" for i in images),
            "hidden": hidden,
            "hidden_reason": reason,
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
    out = {"generated_from": "data/raw_pages.json", "fetched_at": raw.get("fetched_at"),
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
