# TravelGrabber tests

The PWA (this repo) and the on-device webhook (on the Mac mini) are built separately.
If the webhook's `/search` response drifts from what the PWA expects, **the UI renders
nothing and the browser reports no error** — so these tools exist to make the contract
executable rather than prose.

Nothing here is deployed: the Pages workflow copies only the five runtime files
(`index.html`, `app.js`, `manifest.webmanifest`, `sw.js`, `icon.svg`) into `_site`.

---

## `mock-webhook.py` — develop the front end without the mini

Serves the PWA *and* a fake `/search`, `/probe`, `/add`.

```sh
python3 test/mock-webhook.py          # http://127.0.0.1:8899
```

Open it, set the webhook URL in ⚙ to `http://127.0.0.1:8899` and any token.

Its fixtures are deliberately awkward — they cover an unprobed YouTube row, a
fully-resolved SoundCloud row, a paywalled 30-second preview that must be
unselectable, a title containing an XSS payload, a degraded source, and
`hidden_by_filter > 0`. It doubles as a reference for the exact response shape.

## `validate_contract.py` — point it at the REAL webhook

Run this on the mini once `/search` exists. It checks the live response field by
field and names anything that would break rendering.

```sh
TG_TOKEN=$(cat /opt/homebrew/lib/downie-webhook/token) \
  python3 test/validate_contract.py https://downie.sunhouse.media "boards of canada"
```

Exit code 0 = conforms. It never prints the token.

Things it catches that are otherwise silent:
- `quality.state` missing or not one of `unprobed` / `resolved` / `unavailable`
- `state: "resolved"` with a null `abr` or no `label` — the badge renders blank
- a row with `quality.state: "unavailable"` but `available` not `false` — the row
  stays enabled and the user queues a download that can't succeed
- no `hidden_by_filter` — the "show them" escape hatch never appears, so
  over-filtering silently hides the only copy of a track
- `/probe` returning `resolved` without `upload_date` — YouTube flat search has no
  date at all, so the probe is the only place it can come from

## `test_ui.py` — browser tests

```sh
pip install playwright
python3 test/test_ui.py
```

Starts the mock, drives the real UI in headless Chromium, writes `screenshot.png`.
Covers escaping, the disabled preview row, probe upgrade, degraded sources, the
hidden-by-filter banner, selection → download, and the original paste flow (which
must never regress).

Set `CHROME=/path/to/chrome` to use a specific binary.
