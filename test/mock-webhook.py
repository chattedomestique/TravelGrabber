#!/usr/bin/env python3
"""Mock of the on-device webhook — an executable version of the API contract.

Serves the PWA from the repo root AND implements /search, /probe and /add with
representative fixtures, so the front end can be developed and tested without the
Mac mini. The fixtures deliberately include the awkward cases:

  - a YouTube row that arrives "unprobed" (no bitrate, no upload_date)
  - a SoundCloud row that arrives fully "resolved" (SoundCloud is cheap to extract)
  - a paywalled 30s preview that must render disabled and be unselectable
  - a title containing an XSS payload, which must render as literal text
  - a "degraded" source, which must not blank out the results that did arrive
  - hidden_by_filter > 0, which drives the "show them" escape hatch

Usage:  python3 test/mock-webhook.py [port]      (default 8899)
Then open http://127.0.0.1:8899/ and set the webhook URL to the same origin.
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899

RESULTS = [
    {"id": "yt:a1", "source": "youtube", "url": "https://www.youtube.com/watch?v=a1",
     "title": "Boards of Canada - Roygbiv (Official Audio)", "artist": "Boards of Canada",
     "uploader": "Warp Records", "channel_verified": True, "duration": 154, "thumbnail": "",
     "upload_date": None, "view_count": 812344,
     "quality": {"state": "unprobed", "abr": None, "acodec": None, "label": None},
     "score": 78, "reasons": ["title:+official audio", "channel:verified"], "available": True},

    {"id": "sc:b2", "source": "soundcloud", "url": "https://soundcloud.com/x/roygbiv",
     "title": "Roygbiv (slowed)", "artist": "A", "uploader": "A", "duration": 245,
     "thumbnail": "", "upload_date": "20180527", "view_count": 1201,
     "quality": {"state": "resolved", "abr": 160, "acodec": "mp4a.40.2", "label": "HIGH"},
     "score": 40, "reasons": [], "available": True},

    # Paywalled preview: yt-dlp exposes it as *_preview formats with a 30s duration.
    {"id": "sc:c3", "source": "soundcloud", "url": "https://soundcloud.com/x/preview",
     "title": "Roygbiv (paywalled preview)", "artist": "Warp", "uploader": "Warp", "duration": 30,
     "thumbnail": "", "upload_date": "20160520", "view_count": 99,
     "quality": {"state": "unavailable", "abr": 128, "acodec": "mp3", "label": None},
     "score": 10, "reasons": ["format:_preview"], "available": False},

    # Titles come from third-party APIs — the client must escape, never execute.
    {"id": "bc:d4", "source": "bandcamp", "url": "https://artist.bandcamp.com/track/roygbiv",
     "title": "Roygbiv <script>alert(1)</script>", "artist": "Indie Act", "uploader": "Indie Act",
     "duration": 200, "thumbnail": "", "upload_date": None, "view_count": None,
     "quality": {"state": "unprobed", "abr": None, "acodec": None, "label": None},
     "score": 55, "reasons": [], "available": True},
]

SOURCES = {
    "youtube":    {"status": "ok", "count": 1, "hidden_by_filter": 9},
    "soundcloud": {"status": "ok", "count": 2, "hidden_by_filter": 0},
    "bandcamp":   {"status": "degraded", "count": 1, "error": "timeout"},
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # /probe and /add send JSON, which triggers a CORS preflight. Unhandled, it fails
    # silently in the browser — answer OPTIONS on every route.
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json({"ok": True, "service": "downie-webhook", "backend": "ytdlp"})
        if self.path.startswith("/search"):
            return self._json({"query": "roygbiv", "took_ms": 4120,
                               "sources": SOURCES, "results": RESULTS})
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json({"ok": False, "error": "bad json"}, 400)

        if self.path.startswith("/probe"):
            return self._json({"results": {
                u: {"state": "resolved", "abr": 129.5, "acodec": "opus", "asr": 48000,
                    "ext": "webm", "upload_date": "20020122", "label": "GOOD", "available": True}
                for u in data.get("urls", [])}})

        if self.path.startswith("/add"):
            # Accept both the legacy single-url form and the new batch form.
            urls = data.get("urls") or ([data["url"]] if data.get("url") else [])
            return self._json({"ok": True, "queued": len(urls),
                               "items": [{"url": u, "ok": True, "id": f"job_{i}"}
                                         for i, u in enumerate(urls)]})
        return self._json({"ok": False, "error": "not found"}, 404)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"mock webhook + PWA on http://127.0.0.1:{PORT}/  (serving {ROOT})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
