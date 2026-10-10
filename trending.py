#!/usr/bin/env python3
"""
Build data/trending.json ("Trending on X" section) from SAVED x-tool output. Nothing is invented:
headlines/summaries are copied as X returned them; links go to the X story page and its posts.

Inputs (written by whoever calls the x tools, e.g. the refresh routine):
  data/trending_raw/search_news.json  {"fetched_at": ISO, "tool": "x.search_news", "args": {...},
                                       "data": [ {id, name, hook?, summary, category, updated_at, url,
                                                  topics[], posts[post ids]} ... ]}
      from x.search_news  query="US politics", max_results=10, max_age_hours=24,
           news.fields=name,summary,hook,category,updated_at,contexts,cluster_posts_results
      (topics = contexts.topics; posts = the first 3 distinct cluster_posts_results[].post_id)
      Extra files named search_news*.json (other queries) are merged too.
  data/trending_raw/trends_us.json    {"fetched_at": ISO, "tool": "x.get_trends_by_woeid", "args": {"woeid": 23424977},
                                       "data": [ {trend_name, url} ... ]}

Run:  python3 trending.py      -> data/trending.json
Refresh at most hourly: only call the x tools when data/trending.json "built_at" is older than 60 min.
"""
import datetime, glob, json, os, re
ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "trending_raw")
OUT = os.path.join(ROOT, "data", "trending.json")
MAX_STORIES, MAX_TRENDS = 8, 15
STOP = set("the a an of in on for to and or over with by from at as is are if yet its it his her their us u.s. s".split())


def words(s):
    return {w for w in re.findall(r"[a-z0-9\-]+", s.lower()) if w not in STOP and len(w) > 2}


def main():
    stories, fetched = [], []
    for f in sorted(glob.glob(os.path.join(RAW, "search_news*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        fetched.append(d.get("fetched_at"))
        stories += d.get("data", [])
    # keep politics/news; newest first; drop near-duplicate stories (same event, two X story pages)
    stories = [s for s in stories if s.get("name") and ("Politics" in (s.get("topics") or []) or s.get("category") == "News")]
    stories.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    kept, seen_ids = [], set()
    for s in stories:
        if s["id"] in seen_ids:
            continue
        w = words(s["name"])
        if any(len(w & k["_w"]) / max(1, len(w | k["_w"])) >= 0.3 for k in kept):
            continue
        seen_ids.add(s["id"])
        posts = []
        for pid in s.get("posts") or []:
            if pid not in posts: posts.append(pid)
        kept.append({"_w": w, "id": s["id"], "headline": s["name"], "hook": s.get("hook"), "summary": s.get("summary"),
                     "updated_at": s.get("updated_at"), "url": s.get("url") or f"https://x.com/i/trending/{s['id']}",
                     "topics": s.get("topics") or [], "post_urls": [f"https://x.com/i/status/{p}" for p in posts[:3]]})
    for k in kept: k.pop("_w")
    trends, tf = [], None
    tp = os.path.join(RAW, "trends_us.json")
    if os.path.exists(tp):
        d = json.load(open(tp, encoding="utf-8")); tf = d.get("fetched_at")
        trends = [{"name": t["trend_name"], "url": t.get("url") or "https://x.com/search?q=" + t["trend_name"]}
                  for t in d.get("data", [])][:MAX_TRENDS]
    out = {"built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
           "news_fetched_at": max([x for x in fetched if x] or [None]) if fetched else None,
           "trends_fetched_at": tf,
           "source": "X News (x.search_news) and US trends (x.get_trends_by_woeid 23424977). Story summaries are written by X/Grok from posts on X and may evolve.",
           "stories": kept[:MAX_STORIES], "trends": trends}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {len(out['stories'])} stories, {len(trends)} trends")


if __name__ == "__main__":
    main()
