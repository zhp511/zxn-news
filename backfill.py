#!/usr/bin/env python3
"""
Turn saved backfill pages (data/backfill/pNN.jsonl) into data/raw_archive.json.

Why a separate file: the 5-minute refresh routine rewrites data/raw_pages.json with the
newest pages. Older (backfilled) posts live in data/raw_archive.json so a refresh can never
drop them. update.py reads BOTH files (de-duplicating by post id).

Each pNN.jsonl is a compact, verbatim transcription of one X API
GET /2/users/:id/tweets page (exclude=retweets,replies, max_results=25):
  {"meta": {...}}                                   page meta (until_id used, newest/oldest id)
  {"media": [[media_key, type, url], ...]}          includes.media
  {"id","t"(created_at),"pm"[impressions,likes,reposts,replies,quotes,bookmarks],
   "x"(text), "mk"[media keys], "q"(quoted id), "r"(replied-to id),
   "u"[[t.co, expanded_url, card title|null, card image|null, media_key?], ...]}   one post
  {"links": {post_id: [[...same as "u"...]]}}        optional extra entity data for a page
Some pages came back from the API without entities; those posts keep their t.co links.

Usage:  python3 backfill.py      (then python3 update.py)
"""
import glob, json, os
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data", "raw_archive.json")


def to_api(rec):
    imp, like, rt, rep, quo, bm = rec["pm"]
    t = {"id": rec["id"], "created_at": rec["t"], "text": rec["x"],
         "public_metrics": {"impression_count": imp, "like_count": like, "retweet_count": rt,
                            "reply_count": rep, "quote_count": quo, "bookmark_count": bm}}
    if rec.get("mk"):
        t["attachments"] = {"media_keys": rec["mk"]}
    refs = ([{"type": "quoted", "id": rec["q"]}] if rec.get("q") else []) + \
           ([{"type": "replied_to", "id": rec["r"]}] if rec.get("r") else [])
    if refs:
        t["referenced_tweets"] = refs
    if rec.get("u"):
        urls = []
        for u in rec["u"]:
            e = {"url": u[0], "expanded_url": u[1]}
            if u[2]: e["title"] = u[2]
            if len(u) > 3 and u[3]: e["images"] = [{"url": u[3]}]
            if len(u) > 4 and u[4]:
                e["media_key"] = u[4]; e["display_url"] = "pic.x.com/" + u[0].rsplit("/", 1)[1]
            urls.append(e)
        t["entities"] = {"urls": urls}
    else:
        t["_no_entities"] = True
    return t


def main():
    pages = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "backfill", "p*.jsonl"))):
        meta, media, data, links = {}, [], [], {}
        for line in open(f, encoding="utf-8"):
            if not line.strip(): continue
            r = json.loads(line)
            if "meta" in r: meta = r["meta"]
            elif "media" in r: media = [{"media_key": k, "type": ty, ("url" if ty == "photo" else "preview_image_url"): u} for k, ty, u in r["media"]]
            elif "links" in r: links.update(r["links"])
            else: data.append(r)
        for r in data:
            if r["id"] in links and not r.get("u"): r["u"] = links[r["id"]]
        pages.append({"data": [to_api(r) for r in data], "includes": {"media": media},
                      "meta": dict(meta, source=os.path.basename(f))})
    json.dump({"note": "Older @zxnbluehandus posts backfilled 2026-10-10 (see backfill.py). Never rewritten by the refresh routine.",
               "pages": pages}, open(OUT, "w"), ensure_ascii=False, indent=0)
    print(f"wrote {OUT}: {len(pages)} pages, {sum(len(p['data']) for p in pages)} posts")


if __name__ == "__main__":
    main()
