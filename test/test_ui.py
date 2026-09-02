#!/usr/bin/env python3
"""Browser tests for the TravelGrabber PWA, driven against the mock webhook.

Starts test/mock-webhook.py, drives the real UI in headless Chromium, and asserts
the behaviours that are easy to regress and invisible to a syntax check:

  - results render, and third-party titles are ESCAPED not executed
  - paywalled/preview rows are disabled and cannot be selected
  - unprobed rows get upgraded by the auto-probe, filling in bitrate + upload date
  - a degraded source still shows the results that did arrive
  - the hidden-by-filter escape hatch appears
  - selection → download works
  - the original paste flow still works (it must never regress)

    pip install playwright
    python3 test/test_ui.py

Set CHROME to override the browser binary.
"""
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8899"))
BASE = f"http://127.0.0.1:{PORT}"
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")

fails, notes = [], []


def check(name, cond, extra=""):
    (notes if cond else fails).append(f"{'PASS' if cond else 'FAIL'}  {name} {extra}".rstrip())


def wait_up(url, tries=40):
    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def run(pg):
    pg.goto(BASE + "/", wait_until="load")
    pg.evaluate("""(base) => { localStorage.setItem('downie.api', base);
                               localStorage.setItem('downie.token','testtoken'); }""", BASE)
    pg.goto(BASE + "/", wait_until="load")

    check("search tab is default", pg.is_visible("#viewSearch"))
    check("settings hidden when configured", not pg.is_visible("#settings"))

    pg.fill("#q", "boards of canada roygbiv")
    pg.click("#searchBtn")
    pg.wait_for_selector(".row", timeout=15000)
    check("renders all results", len(pg.query_selector_all(".row")) == 4)

    body = pg.evaluate("() => document.getElementById('results').textContent")
    check("xss payload rendered as literal text", "<script>alert(1)</script>" in body)
    check("no script node injected",
          pg.evaluate("() => document.querySelectorAll('#results script').length") == 0)

    check("preview row disabled", len(pg.query_selector_all(".row.disabled")) == 1)
    check("preview checkbox not selectable",
          pg.evaluate("() => [...document.querySelectorAll('.row.disabled input')].every(i => i.disabled)"))

    pg.wait_for_function("() => document.querySelectorAll('.badge.UNPROBED').length === 0", timeout=15000)
    labels = pg.evaluate("() => [...document.querySelectorAll('.badge')].map(b => b.className.split(' ')[1])")
    check("auto-probe resolved unprobed rows", "UNPROBED" not in labels, str(labels))
    check("upload date filled in by probe", "2002-01-22" in pg.inner_text("#results"))

    check("degraded source surfaced", "degraded" in pg.inner_text("#srcStatus").lower())
    check("hidden-by-filter banner", pg.is_visible("#banner") and "9" in pg.inner_text("#banner"))

    check("selection bar hidden initially", not pg.is_visible("#selbar"))
    pg.evaluate("() => document.querySelector('.row:not(.disabled) input[type=checkbox]').click()")
    pg.wait_for_selector("#selbar:not([hidden])", timeout=5000)
    check("selection bar shows count", "1 selected" in pg.inner_text("#selInfo"))
    pg.click("#dlBtn")
    pg.wait_for_function("() => /Queued/i.test(document.querySelector('#srcStatus').innerText)", timeout=10000)
    check("download queued", "queued" in pg.inner_text("#srcStatus").lower())

    pg.click("#tabPaste")
    check("paste view shows", pg.is_visible("#viewPaste"))
    pg.fill("#url", "https://www.youtube.com/watch?v=aqz-KE-bpKQ")
    pg.click("#go")
    pg.wait_for_function("() => /Queued/i.test(document.querySelector('#status').innerText)", timeout=10000)
    check("paste flow still queues", "queued" in pg.inner_text("#status").lower())

    pg.click("#tabSearch")
    pg.screenshot(path=os.path.join(HERE, "screenshot.png"), full_page=True)


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed:  pip install playwright")
        return 2

    mock = subprocess.Popen([sys.executable, os.path.join(HERE, "mock-webhook.py"), str(PORT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_up(BASE + "/health"):
            print("mock webhook did not start")
            return 2
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=CHROME) if os.path.exists(CHROME) \
                else p.chromium.launch()
            pg = browser.new_page(viewport={"width": 430, "height": 900})
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text)
                  if (m.type == "error" and "favicon" not in str(m.location)) else None)
            run(pg)
            check("no JS errors", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        mock.terminate()

    print("\n".join(notes))
    if fails:
        print("\n" + "\n".join(fails))
        print(f"\n{len(fails)} FAILED / {len(fails) + len(notes)} checks")
        return 1
    print(f"\nALL {len(notes)} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
