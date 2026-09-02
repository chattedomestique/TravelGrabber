# TravelGrabber

Search for music — or paste a link — on your phone, and it downloads on the Mac mini.
TravelGrabber is a small installable PWA (static HTML/JS, no build step, hosted on GitHub
Pages) that talks to a token-gated webhook on the Mac over a Cloudflare Tunnel.

## How it works

```
 iPhone: TravelGrabber PWA (this repo, served by GitHub Pages)
    │
    │  GET  /search?q=…            ← find tracks across YouTube / SoundCloud / Bandcamp
    │  POST /probe {urls:[…]}      ← fill in bitrate + upload date for chosen rows
    │  POST /add   {urls:[…]}      ← download the ones you ticked
    │  … each with  Authorization: Bearer <token>
    ▼
 https://downie.sunhouse.media          (Cloudflare Tunnel → the Mac mini)
    ▼
 downie-webhook  (127.0.0.1:8896 on the mini, yt-dlp backend)
    ▼
 the media is downloaded locally on the mini.
```

No inbound ports are opened — the Mac dials out to Cloudflare, the same pattern as the other
`*.sunhouse.media` services. The webhook binds to loopback only, so the tunnel is the sole way
in. Auth is a bearer **token** plus a CORS allow-list.

## Two ways to grab something

**Search** — type an artist, album or song. Results come from YouTube, SoundCloud and Bandcamp,
each source degrading independently so one failure never blanks the page. Every row shows
duration, upload date and an audio-quality badge (`LOSSLESS` / `HIGH` / `GOOD` / `OK` / `LOW`)
with the bitrate. Tick any number of rows and hit Download.

An **Audio-first** filter is on by default: it hides official music videos, reactions, karaoke
and covers in favour of official audio, lyric videos and visualisers. Because that can
occasionally hide the only copy of a track, anything it removes is reported as
*"N results hidden — show them"*.

**Paste** — the original flow, unchanged. Paste a link, or **Share** one into the app from
anywhere (it registers a share target and auto-sends).

> **Note:** the search UI needs the on-device webhook to implement `/search` and `/probe`. Until
> it does, searching reports that the endpoint is missing; the paste flow works regardless.

## Install on your phone

1. Open `https://chattedomestique.github.io/TravelGrabber/` in Safari →
   **Share → Add to Home Screen**.
2. Open the installed app → tap **⚙** and enter:
   - **Webhook URL** — `https://downie.sunhouse.media` (must be **https**, or the browser blocks
     it as mixed content)
   - **Token** — the value from the Mac (`/opt/homebrew/lib/downie-webhook/token`)

Both are stored only in that phone's `localStorage`. **No secrets live in this repo.**

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell + styles (search view, paste view, settings) |
| `app.js` | Search, probing, selection, downloads, settings, share target |
| `manifest.webmanifest` | PWA metadata + `share_target` |
| `sw.js` | Service worker — network-first, with the shell cached for offline. Bump `CACHE` on any shell change or installed apps keep the old UI |
| `icon.svg` | App icon |
| `.github/workflows/pages.yml` | Deploys the five runtime files to Pages on every push to `main` |
| `test/` | Mock webhook, contract validator and browser tests — see `test/README.md` |

## Development

```sh
python3 test/mock-webhook.py     # serves the PWA + a fake webhook on :8899
python3 test/test_ui.py          # browser tests (needs: pip install playwright)
```

`test/validate_contract.py` points at the **real** webhook and checks its `/search` response
against what the client expects — worth running whenever the on-device half changes.

## Hosting

Pages is deployed by **GitHub Actions** (`.github/workflows/pages.yml`), not from a branch:
Settings → Pages → Source → **GitHub Actions**. Every push to `main` redeploys.
