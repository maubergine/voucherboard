# Guide screenshots

Regenerates every screenshot in `guide/img/`, by driving a real headless Chrome against a small local
server (`server.mjs`) that serves Voucherboard's real `src/*.js` and the anonymised pages in
`test/fixtures/` to a harness page (`index.html` / `buy.html`, with `harness-boot.js` stubbing
`chrome.*` and intercepting council-shaped `fetch()` calls). It never contacts the real council site.

`harness-boot.js` mirrors the fetch routes `test/ui.test.js`'s `setup()` stubs, but for a real browser
tab instead of jsdom, and adds one synthetic second permit (zone B1) so the permit selector and a
purchase-advice example have something real to show. `capture.mjs` drives it with Puppeteer, clicking
through the UI (terms, planner, composer, popovers, bulk manage, review, settings, mobile) with the
clock pinned to `2026-09-28T10:30:00` — the same moment `test/ui.test.js` pins — then copies the
screenshots `guide/README.md` uses into `../../guide/img/`, named as it references them.

## Running it

Puppeteer isn't a project dependency (only used here, ad hoc), so install it locally first — this
folder's `node_modules` is gitignored:

```sh
cd voucherboard/scripts/guide-screenshots
npm install --no-save puppeteer-core
```

You need a local Chrome or Chromium. On macOS it's found automatically; elsewhere set `CHROME_PATH`:

```sh
CHROME_PATH=/usr/bin/chromium-browser node capture.mjs
```

Then, in one terminal:

```sh
node server.mjs
```

And in another:

```sh
node capture.mjs
```

Raw screenshots land in `./shots` (gitignored) before being copied into `guide/img/`. `01-launcher` and `13-buy-handoff` are real screenshots from the live site, with permit references covered, so they're never overwritten; replace them by hand and redact anything personal. After running it,
regenerate `guide/index.html` from the updated images:

```sh
cd ../..
node scripts/render-guide.mjs
```

## If the UI changes

`capture.mjs` interacts through real ids and classes from `src/app.js` (`#settingsBtn`, `[data-vpop]`,
`[data-ids]`, and so on), the same ones exercised in `test/ui.test.js`. If a selector no longer matches
after a UI change, the step throws, the scene retries once on a fresh page, and — if it still fails —
the run logs `[FAILED] <scene>` and carries on to the rest. Check the log, fix the selector, and rerun.

Note for `app.js` maintainers: its `onResize` handler starts with `wasNarrow = null`, so the very first
`resize` event on a page always calls `closePop()`, even when nothing about the width actually changed
— and `page.screenshot()` triggers one. `open()` in `capture.mjs` fires and settles a harmless resize
right after load (nothing is open yet) so a later screenshot can't unexpectedly close a popover the next
step still needs.
