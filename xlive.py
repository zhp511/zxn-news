#!/usr/bin/env python3
"""
Build data/xlive.json (the "X Live" group in the ZXN TV player) from SAVED x-tool output.
Nothing is invented: names, handles and post text are copied as X returned them.

Input: data/xlive_raw/search.json, written by the refresh routine from ONE call of
  x.search_posts_all  query = QUERY below, start_time = now-3h (UTC ISO), max_results=25,
     sort_order=relevancy, post.fields=created_at,public_metrics,entities,author_id,
     expansions=author_id, user.fields=name,username,verified,verified_type,public_metrics
  saved as {"fetched_at": ISO, "tool": "x.search_posts_all", "args": {...},
            "data": [{id, author_id, created_at, text, url, pm:[impressions,likes,reposts,replies]}],
            "users": [{id, name, username, verified_type, followers}]}
  (raw API objects with "public_metrics" instead of "pm", or a full {"data":..,"includes":{"users":..}}
   response, are accepted too.)

Rules: original posts only (query excludes reposts/replies/quotes); English; news/politics
keywords required; sports/adult/crypto/gaming terms excluded; Hindi/Devanagari text excluded;
one post per account (newest); duplicate texts dropped; US-politics/weather posts ranked first; X has no "is live" flag, so a broadcast
post counts as live for xlive_window_hours (default 3) after posting; max 8, ranked by reach.
Optional site_config.json: "xlive_block_handles": [...], "xlive_window_hours": 3.

Run: python3 xlive.py   -> data/xlive.json
"""
import datetime, html, json, os, re
ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "xlive_raw", "search.json")
OUT = os.path.join(ROOT, "data", "xlive.json")
CFG = os.path.join(ROOT, "data", "site_config.json")
QUERY = ('url:"x.com/i/broadcasts" -is:retweet -is:reply -is:quote lang:en '
         '(news OR breaking OR politics OR Trump OR president OR election OR debate OR congress OR senate '
         'OR hurricane OR "press conference" OR "White House" OR America) '
         '-nfl -mlb -nba -game -postgame -onlyfans -crypto')
MAX = 8
NEWS = re.compile(r"\b(news|breaking news|politic\w*|election\w*|ballot|vote|trump|president\w*|congress|senate|debate\w*|"
                  r"white house|hurricane|storm watch|israel|iran|ukraine|america\w*|maga|charlie kirk|headlines?|"
                  r"geomagnetic|supreme court|governor|campaign)\b", re.I)
BLOCK = re.compile(r"\b(nfl|mlb|nba|nhl|postgame|pregame|bye week|dodgers|seahawks|49ers|football|baseball|"
                   r"prematch|watchalong|lineups|soccer|mls|ncaa|college football|inter miami|notre dame|ufc|post-fight|"
                   r"onlyfans|of live|nsfw|18\+|porn|sex|wordle|theme park|crypto|\$[A-Z]{2,6}|exhibition results|"
                   r"giveaway|casino|betting)\b", re.I)
# Vulgar/obscene posts are never shown on the site (added 2026-10-17 by the refresh routine).
PROFANE = re.compile(r"(f+u+c+k|sh[i1]t\b|bitch|cunt|whore|slut|motherf|\bdick\b|\bcock\b|\bpussy\b|\bfag)", re.I)
US = re.compile(r"\b(trump|election\w*|ballot|vote|congress|senate|white house|america\w*|maga|charlie kirk|"
                r"hurricane|isaias|supreme court|governor|politics)\b", re.I)
OWN = "zxnbluehandus"


def main():
    cfg = json.load(open(CFG)) if os.path.exists(CFG) else {}
    window = float(cfg.get("xlive_window_hours", 3))
    blocked = {h.lower().lstrip("@") for h in cfg.get("xlive_block_handles") or []}
    d = json.load(open(RAW, encoding="utf-8")) if os.path.exists(RAW) else {"data": []}
    users = {u["id"]: u for u in (d.get("users") or (d.get("includes") or {}).get("users") or [])}
    now = datetime.datetime.now(datetime.timezone.utc)
    picked, seen_auth, seen_text = [], set(), set()
    posts = sorted(d.get("data") or [], key=lambda t: t["created_at"], reverse=True)
    for t in posts:
        u = users.get(t.get("author_id")) or {}
        handle = u.get("username") or (re.search(r"x\.com/([^/]+)/status", t.get("url", "")) or [None, ""])[1]
        if not handle or handle.lower() == OWN or handle.lower() in blocked or handle.lower() in seen_auth:
            continue
        text = html.unescape(t.get("text") or "").strip()
        bare = re.sub(r"https?://\S+", "", text)
        if re.search(r"[\u0900-\u097F]", bare) or BLOCK.search(bare) or PROFANE.search(bare) or not NEWS.search(bare):
            continue
        key = re.sub(r"\W+", " ", bare.lower()).strip()[:80]
        if key in seen_text:
            continue
        started = datetime.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
        until = started + datetime.timedelta(hours=window)
        if until <= now:
            continue
        pm = t.get("pm")
        imp = pm[0] if pm else (t.get("public_metrics") or {}).get("impression_count", 0)
        seen_auth.add(handle.lower()); seen_text.add(key)
        picked.append({"post_id": t["id"], "post_url": t.get("url") or f"https://x.com/{handle}/status/{t['id']}",
                       "name": u.get("name") or handle, "username": handle, "verified_type": u.get("verified_type"),
                       "text": text, "started_at": t["created_at"],
                       "assumed_live_until": until.isoformat().replace("+00:00", "Z"),
                       "_rank": (1 if US.search(bare) else 0, (imp or 0) + 20 * (u.get("followers") or 0) ** 0.5)})
    picked.sort(key=lambda p: p["_rank"], reverse=True)
    picked = picked[:MAX]
    for p in picked: p.pop("_rank")
    out = {"built_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "searched_at": d.get("fetched_at"),
           "window_hours": window,
           "detection": f"Posts linking to an X broadcast, counted as live for {window:g} h after posting (X's API doesn't report when a broadcast ends).",
           "broadcasts": picked}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {len(picked)} broadcasts")
    for p in picked: print(f"  @{p['username']}: {p['text'][:70]!r}")


if __name__ == "__main__":
    main()
