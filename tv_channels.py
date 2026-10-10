#!/usr/bin/env python3
"""
Refresh data/tv.json for the ZXN TV mini player (no X reads; uses public YouTube pages).

Only official, publisher-run YouTube channels are listed. For each one we open
https://www.youtube.com/@<handle>/live, read the current live video id, and keep the
channel only if YouTube says it is live now AND playableInEmbed is true (embedding allowed
by the publisher) AND oEmbed answers 200. Channels that fail keep their last good video id
but are marked "ok": false so the player hides them. (The youtube.com/embed/live_stream?channel=
form showed "This video is unavailable" for most of these channels in Oct 2026 testing, so
we embed the specific live video id instead and refresh it here.)

DIRECTV is a link-out tile only (subscriber/DRM service): never embedded or restreamed.

Run: python3 tv_channels.py   (suggested: once every few hours from the refresh routine)
"""
import datetime, json, os, re, urllib.request
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data", "tv.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-US", "Cookie": "CONSENT=YES+1"}
CHANNELS = [  # (key, display name, @handle, channel id) - order = switcher order
    ("foxweather", "FOX Weather", "FOXWeather", "UC1FbPiXx59_ltnFVx7IxWow"),
    ("livenow", "LiveNOW from FOX", "LiveNOWFOX", "UCJg9wBPyKMNA5sRDnvzmkdg"),
    ("cbs", "CBS News 24/7", "CBSNews", "UC8p1vwvWtl6T73JiExfWs1g"),
    ("abc", "ABC News Live", "ABCNews", "UCBi2mrWuNuyYy4gbM6fU18Q"),
    ("nbc", "NBC News NOW", "NBCNews", "UCeY0bbntWzzVIaj2z3QigXg"),
    ("bloomberg", "Bloomberg TV", "markets", "UCIALMKvObZNtJ6AmdCLP7Lg"),
    ("sky", "Sky News", "SkyNews", "UCoMdktPbSTixAyNGwb-UYkQ"),
    # Checked and not included (no 24/7 embeddable YouTube live stream on their official channel when tested):
    # Newsmax (UCaDCI0bxPZ_ZHdtx9LXOxRw), NewsNation (UCCjG8NtOig0USdrT5D1FpxQ), Scripps News (UCTln5ss6h6L_xNfMeujfPbg),
    # C-SPAN (no live stream), Reuters (event streams only), Fox News (no 24/7 stream on YouTube).
]
DIRECTV = {"key": "directv", "name": "DIRECTV", "type": "link", "url": "https://stream.directv.com/",
           "note": "DIRECTV subscribers: sign in on DIRECTV to watch"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "replace")


def main():
    old = {}
    if os.path.exists(OUT):
        old = {c["key"]: c for c in json.load(open(OUT)).get("channels", [])}
    out = []
    for key, name, handle, cid in CHANNELS:
        c = {"key": key, "name": name, "type": "youtube", "channel_id": cid, "handle": handle,
             "watch_url": f"https://www.youtube.com/@{handle}/live", "video_id": (old.get(key) or {}).get("video_id"), "ok": False}
        try:
            page = get(f"https://www.youtube.com/@{handle}/live")
            m = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"', page)
            if m and '"isLiveNow":true' in page:
                vid = m.group(1)
                w = get(f"https://www.youtube.com/watch?v={vid}")
                emb = '"playableInEmbed":true' in w
                own = f'"channelId":"{cid}"' in w
                get(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json")
                c.update(video_id=vid, ok=emb and own, title=(re.search(r"<title>([^<]*)", page) or [None, None])[1])
                if c.get("title"): c["title"] = c["title"].replace(" - YouTube", "")
            else:
                c["why"] = "not live right now"
        except Exception as e:
            c["why"] = f"check failed: {e}"
        out.append(c)
        print(f"{name:18} ok={c['ok']} {c.get('video_id')} {c.get('why','')}")
    out.append(DIRECTV)
    json.dump({"checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
               "channels": out}, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
