# TravelGrabber

Paste a link on your phone → [Downie 4](https://software.charliemonroe.net/downie/) downloads
it on the Mac mini. TravelGrabber is a tiny installable PWA (static HTML/JS, hosted on GitHub
Pages) that POSTs a link to a webhook on the Mac, which hands it to Downie.

## How it works

```
 iPhone: TravelGrabber PWA (this repo, served by GitHub Pages)
    │   you paste or share a link
    │   POST { "url": "<link>" }  +  Authorization: Bearer <token>
    ▼
 https://downie.sunhouse.media/add        (Cloudflare Tunnel → the Mac mini)
    ▼
 downie-webhook  (127.0.0.1:8896 on the mini)
    │   validates the token + that it's an http(s) URL, then:
    │   open -g -a "Downie 4" "<link>"
    ▼
 Downie 4 downloads the media locally on the mini.
```

No inbound ports are opened — the Mac reaches out to Cloudflare via a tunnel, the same pattern
as the other `*.sunhouse.media` services. Auth is a bearer **token** plus a CORS allow-list.

## Install on your phone

1. Open the Pages URL (e.g. `https://<user>.github.io/TravelGrabber/`) in Safari →
   **Share → Add to Home Screen**.
2. Open the installed app → tap **⚙** and enter:
   - **Webhook URL** — `https://downie.sunhouse.media`
   - **Token** — the value from the Mac (`/opt/homebrew/lib/downie-webhook/token`)
3. Paste a link and tap **Send**, or **Share** a link from any app to TravelGrabber — it
   auto-sends.

The webhook URL and token are stored only in your phone's `localStorage`. **No secrets live in
this repo.**

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell + styles |
| `app.js` | Reads/saves settings, extracts the URL, POSTs to the webhook, handles the share target |
| `manifest.webmanifest` | PWA metadata + `share_target` so links can be shared into the app |
| `sw.js` | Service worker — precaches the shell so the app installs and opens offline (the API is never cached) |
| `icon.svg` | App icon |

## Hosting (GitHub Pages)

Settings → Pages → **Deploy from a branch** → `main` → `/ (root)` → Save. After ~1 min the app
is live at `https://<user>.github.io/TravelGrabber/`.

For "paste & forget" with nobody at the Mac, Downie must be set to download automatically (no
format prompt): **Downie → Preferences → General → start downloads automatically / auto-pick
quality.**
