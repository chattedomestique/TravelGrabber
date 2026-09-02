#!/usr/bin/env python3
"""Check a REAL webhook against the API contract the PWA expects.

Run this on the mini (or anywhere that can reach the tunnel) once /search exists.
It reports field-by-field conformance, so the two halves can't drift apart silently
— a missing `quality.state` or a renamed `hidden_by_filter` makes the UI render
nothing, with no error in the browser console.

Stdlib only. Never prints the token.

    python3 test/validate_contract.py https://downie.sunhouse.media "boards of canada"
    TG_TOKEN=... python3 test/validate_contract.py http://127.0.0.1:8896 roygbiv

Exit code 0 = conforms, 1 = problems found.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8896").rstrip("/")
QUERY = sys.argv[2] if len(sys.argv) > 2 else "boards of canada roygbiv"
TOKEN = os.environ.get("TG_TOKEN", "")

problems, notes = [], []


def bad(msg):
    problems.append(msg)


def ok(msg):
    notes.append(msg)


def call(path, payload=None, timeout=40):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data)
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.load(r)


def check_result(i, r):
    """One search result must carry everything a row needs to render."""
    where = f"results[{i}]"
    for f in ("id", "source", "url", "title", "quality"):
        if f not in r:
            bad(f"{where}: missing required field '{f}'")
    if r.get("source") not in ("youtube", "soundcloud", "bandcamp"):
        bad(f"{where}: source={r.get('source')!r} — must be youtube|soundcloud|bandcamp "
            "(the UI keys its colour pill off this)")
    if not str(r.get("url", "")).startswith("http"):
        bad(f"{where}: url is not http(s)")

    q = r.get("quality")
    if not isinstance(q, dict):
        bad(f"{where}.quality: must be an object, got {type(q).__name__}")
        return
    state = q.get("state")
    if state not in ("unprobed", "resolved", "unavailable"):
        bad(f"{where}.quality.state={state!r} — must be unprobed|resolved|unavailable")
    if state == "resolved":
        if q.get("abr") is None:
            bad(f"{where}.quality: state=resolved but abr is null — the badge needs a number")
        if not q.get("label"):
            bad(f"{where}.quality: state=resolved but no label "
                "(LOSSLESS|HIGH|GOOD|OK|LOW)")
    # A row that can't be downloaded must say so, or the user queues a dead link.
    if state == "unavailable" and r.get("available") is not False:
        bad(f"{where}: quality.state=unavailable but available is not false — "
            "the row won't be disabled in the UI")


def main():
    print(f"→ {BASE}   query={QUERY!r}   token={'set' if TOKEN else 'NOT SET'}\n")

    # 1. health
    try:
        st, h = call("/health")
        ok(f"/health {st} backend={h.get('backend')}")
    except Exception as e:
        bad(f"/health failed: {type(e).__name__}: {e}")

    # 2. search
    qs = urllib.parse.urlencode({"q": QUERY, "sources": "youtube,soundcloud,bandcamp",
                                 "strict": "1", "limit": "20"})
    try:
        st, s = call("/search?" + qs)
    except urllib.error.HTTPError as e:
        bad(f"/search HTTP {e.code} — {'no /search endpoint yet' if e.code == 404 else e.reason}")
        return report()
    except Exception as e:
        bad(f"/search failed: {type(e).__name__}: {e}")
        return report()

    ok(f"/search {st} in {s.get('took_ms', '?')}ms")

    if "results" not in s:
        bad("/search: no 'results' key — the PWA reads data.results")
    if "sources" not in s:
        bad("/search: no 'sources' key — per-source status drives the status strip "
            "and the hidden-by-filter banner")

    srcs = s.get("sources", {})
    if isinstance(srcs, dict):
        for name, meta in srcs.items():
            if not isinstance(meta, dict):
                bad(f"sources.{name}: must be an object")
                continue
            if meta.get("status") not in ("ok", "degraded", "error"):
                bad(f"sources.{name}.status={meta.get('status')!r} — must be ok|degraded|error")
            # Only meaningful for a source that actually ran; a degraded/errored
            # source has no filtered count to report, and the client tolerates that.
            if meta.get("status") == "ok" and "hidden_by_filter" not in meta:
                bad(f"sources.{name}: status=ok but no 'hidden_by_filter' — without it "
                    "the user can't escape over-filtering")
            else:
                ok(f"sources.{name}: {meta.get('status')} "
                   f"count={meta.get('count')} hidden={meta.get('hidden_by_filter')}")

    results = s.get("results") or []
    ok(f"{len(results)} results returned")
    if not results:
        bad("/search returned zero results — can't validate row shape "
            "(try a broader query, or strict=0)")
    for i, r in enumerate(results[:10]):
        check_result(i, r)

    # 3. probe — only meaningful if something came back unprobed
    unprobed = [r["url"] for r in results
                if isinstance(r.get("quality"), dict) and r["quality"].get("state") == "unprobed"]
    if unprobed:
        try:
            st, p = call("/probe", {"urls": unprobed[:3]}, timeout=90)
            got = p.get("results")
            if not isinstance(got, dict):
                bad("/probe: expected {'results': {url: {...}}}")
            else:
                ok(f"/probe {st} resolved {len(got)}/{len(unprobed[:3])}")
                for u, v in got.items():
                    if v.get("state") == "resolved" and v.get("abr") is None:
                        bad(f"/probe[{u}]: resolved but abr is null")
                    if v.get("state") == "resolved" and not v.get("upload_date"):
                        bad(f"/probe[{u}]: resolved but no upload_date — "
                            "YouTube flat search has none, so the probe must supply it")
        except urllib.error.HTTPError as e:
            bad(f"/probe HTTP {e.code}" + (" — endpoint not implemented" if e.code == 404 else ""))
        except Exception as e:
            bad(f"/probe failed: {type(e).__name__}: {e}")
    else:
        ok("no unprobed rows — nothing to probe (expected if only SoundCloud returned)")

    report()


def report():
    print("\n".join("  ok    " + n for n in notes))
    if problems:
        print()
        print("\n".join("  PROBLEM  " + p for p in problems))
        print(f"\n{len(problems)} problem(s) — the PWA may render incorrectly.")
        sys.exit(1)
    print("\nContract OK — the PWA should render this correctly.")
    sys.exit(0)


if __name__ == "__main__":
    main()
