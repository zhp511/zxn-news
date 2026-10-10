#!/usr/bin/env python3
"""
Build data/following.json ("Accounts We Follow" section) from SAVED x-tool output.

Handles come from data/site_config.json -> "featured_accounts": ["handle", ...] (site owner sets these in chat).
For each handle the refresh saves data/following_raw/<handle lowercased>.json:
  {"fetched_at": ISO,
   "user":  <x.get_users_by_username data, user.fields=name,username,profile_image_url,description,verified>,
   "posts": <x.get_users_posts response for user["id"], max_results=5, exclude=retweets,replies,
             post.fields=created_at,public_metrics,entities,attachments, expansions=attachments.media_keys,
             media.fields=url,preview_image_url,type>}
The user lookup only needs doing once per handle (reuse "user" from the existing file afterwards).

Run:  python3 following.py   -> data/following.json  ({"accounts": []} when nothing is configured -> section hidden)
Images are NOT downloaded (hotlinked from pbs.twimg.com) to keep the repo small.
"""
import datetime, html, json, os, re
ROOT = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(ROOT, "data", "site_config.json")
RAW = os.path.join(ROOT, "data", "following_raw")
OUT = os.path.join(ROOT, "data", "following.json")
PER_ACCOUNT = 3


def clean_text(t):
    text = html.unescape(t.get("text", ""))
    by = {u["url"]: u for u in (t.get("entities") or {}).get("urls", [])}
    def repl(m):
        u = by.get(m.group(0))
        if u is None: return m.group(0)
        if u.get("media_key") or "pic.x.com" in (u.get("display_url") or ""): return ""
        return u.get("unwound_url") or u.get("expanded_url") or m.group(0)
    return re.sub(r"https://t\.co/\w+", repl, text).strip()


def main():
    cfg = json.load(open(CFG)) if os.path.exists(CFG) else {}
    handles = [h.lstrip("@").strip() for h in cfg.get("featured_accounts") or [] if h and h.strip()]
    accounts = []
    for h in handles:
        p = os.path.join(RAW, h.lower() + ".json")
        if not os.path.exists(p):
            accounts.append({"username": h, "name": h, "url": f"https://x.com/{h}", "posts": [], "pending": True})
            continue
        d = json.load(open(p, encoding="utf-8"))
        u = d.get("user") or {}
        page = d.get("posts") or {}
        media = {m["media_key"]: m for m in (page.get("includes") or {}).get("media", [])}
        posts = []
        for t in sorted(page.get("data") or [], key=lambda t: t["created_at"], reverse=True):
            if (t.get("text") or "").startswith("RT @") or t.get("in_reply_to_user_id"):
                continue
            img = None
            for k in (t.get("attachments") or {}).get("media_keys", []):
                m = media.get(k) or {}
                img = m.get("url") or m.get("preview_image_url")
                if img: break
            txt = clean_text(t)
            if not txt and not img: continue
            posts.append({"id": t["id"], "url": f"https://x.com/{u.get('username', h)}/status/{t['id']}",
                          "created_at": t["created_at"], "text": txt, "image": img,
                          "metrics": t.get("public_metrics") or {}})
            if len(posts) >= PER_ACCOUNT: break
        accounts.append({"username": u.get("username", h), "name": u.get("name", h),
                         "avatar": (u.get("profile_image_url") or "").replace("_normal", "_200x200") or None,
                         "description": u.get("description"), "url": f"https://x.com/{u.get('username', h)}",
                         "fetched_at": d.get("fetched_at"), "posts": posts})
    out = {"built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
           "accounts": accounts}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {len(accounts)} accounts")


if __name__ == "__main__":
    main()
