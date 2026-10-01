# Voucherboard

Manifest V3 browser extension (beta) that overlays a planner on Lewisham's visitor parking permit site, `parkingpermits.lewisham.gov.uk`. It runs in the user's logged-in tab and makes the same same-origin requests as the council's own pages. There's no server and no build step: plain JS, loaded in the order the manifest lists.

Owner: Marius Rubin. The product is proprietary, all rights are reserved, and it may be sold later (see Terms).

## Commands

Run from `voucherboard/`:

```sh
npm test          # node --test test/ (jsdom); about 3 s, 55 tests
npm run package   # dist/voucherboard-<version>.zip (manifest.json, src, icons only)
```

Run `npm test` after every change. Load the extension unpacked from `voucherboard/` via `chrome://extensions`.

## Layout (`voucherboard/src`)

| File | Role |
| --- | --- |
| `content.js` | Entry point: launcher button, host element, reopens if `vb:open` is set, Buy hand-off (`VB.buyHandoff`). Exits on payment, account and card/password pages. |
| `app.js` | The whole UI in a shadow root. `create(host)` returns `{ open, close, busy }`. State lives in `S`; `refresh()` re-renders; one delegated click, change, input and keydown handler each. |
| `planner.js` | Pure logic, no DOM or network: `allocate`, `candidates`, `advanceEntries`, `purchaseAdvice`, `activations`, `shrinkOptions`, `replacedIds`, `effectiveBalance`. |
| `portal.js` | Parsers (take a Document) and requests: `bookOne`, `cancelBooking`, `createFavourite`, `deleteFavourite`, `checkNickname`, `buyUrl` (validates only), and the `trace` ring buffer for error reports. |
| `zones.js` | Controlled zones, their hours and bank holidays. Zone P is Hither Green East, Mon–Fri 10:00–12:00. |
| `terms.js` | Terms HTML and `VERSION`. Bump `VERSION` whenever the terms change, so users must accept again. |

The shared namespace is `globalThis.VB` (`zones`, `planner`, `portal`, `terms`, `app`). Any new `src` file must be added to `manifest.json` `content_scripts.js` in load order, and to the `w.eval` list in `test/ui.test.js`.

## Domain facts learned from the live site

- Each booking is one voucher. A permit's bookings and unused vouchers come from `/Permit/Details`. A plan "entry" is `{ id, vrn, dk, from, to, replaces?, email? }` in minutes, saved as `vb:plan:<permitId>`.
- **Booking sequence** (`bookOne`): `GET /Permit/VisitorPermit`, `POST GetNonEnforceableCoverage`, `GET VerifyDateTimeOfVisitorVoucher` (skipped for activate-now), `POST GetVisitorVoucherConfirmation` (plate and date must match), then `POST /Permit/VisitorPermit`. In test mode, only the last step is skipped. Requests are paced by `GAP_MS` (500 ms).
- **Voucher period:** the booking form has either a `<select id="VisitorVoucherPeriodId">` or, for fixed-length vouchers, a hidden `<input>` with the period id (`ShouldSelectPeriod=False`). Both are handled.
- **Confirmation email:** `SendEmail` is the site's field for it.
- **Cancel:** `GET /Permit/CancelVoucherConfirmationPopup?permitVehicleId=`, then `POST /Permit/CancelVisitorVoucher` with the token. Only bookings flagged cancellable, and not started, can be cancelled.
- **Favourites:**
  - The list comes from `/Home/ApplicantVehicles` (`.hometile` cards).
  - Create: `GET /FavouriteVehicle/Create`, whose form has the token, `Id`, `Name` and `Vrn`; these field names were seen live. It's submitted as-is.
  - Delete: `GET /FavouriteVehicle/Delete?id=` opens a dialog, and its form is submitted. The dialog's form was never seen: the fixture is a guess.
  - After either, the app always reloads favourites to confirm.
- **Buy:** `ValidateBuyAgainLimits` checks the amount. The app then saves `vb:buy` and goes to `/Home/ApplicantPermits`, where `content.js` clicks `.buyAgainBtn[data-permitid]` and fills `#PeriodPriceIdSelected` and `#NumberSelected`. The user presses Buy and Pay themselves. Never navigate straight to `/PermitPayment/...`: that page is an iframe, and its Pay button lives in the parent modal.

Not yet tried live: favourite create and delete, cancel-then-rebook changes, ending early (beta), `SendEmail`, the Buy hand-off, and 5-hour and day vouchers.

## Rules

- **Payment pages:** Voucherboard never runs on, or scripts, payment, buy, account or card pages.
- **Network:** no requests to anything other than the council site. `terms.js` section 12 promises this, so any kill switch or telemetry needs the terms changed first.
- **Terms gate:** `load()` reads nothing from the council until `vb:terms.version === T.VERSION`.
- **Tokens:** redact anti-forgery tokens in anything copyable (`portal.js` `redact`).
- **Chrome Web Store:** CI only uploads drafts. Never call `:publish` or submit for review automatically; the owner submits in the dashboard.
- **Destructive actions** (cancel, delete a favourite, end early) always need an explicit confirm step in the UI.
- **Git:**
  - Never commit `*.pem` or `*.crx`; `.gitignore` covers them. The CRX signing key for Verified CRX uploads lives only in the owner's password manager and the `chrome-web-store` environment's `CWS_CRX_KEY` secret (see `docs/RELEASING.md`).
  - `manifest.json` `key` is the Chrome Web Store item's public key (dashboard, Package → View public key), not the CRX signing key's. It gives unpacked installs the store's extension id (`cldhejnblckejbeebjidikhebdfnncak`), so saved data survives moving the folder, and a later move to the store keeps it. Google holds the private key. `npm run package` strips `key` from the store zip.
  - There's no remote. If one is added, the repo must be private.
  - Work on branches: `planner-bulk-terms` holds the latest work and hasn't been merged into `main`.

## Tests

- **Fixtures:** `test/fixtures/` holds anonymised pages saved from the site. Never commit HAR files, because they contain cookies.
- **Fake site:** `test/ui.test.js` `setup({ now, plan, nonEnforced, noTerms })` routes requests to a fake council site. It records `calls`, `cancelled`, `deleted` and `created`, and pre-accepts the terms unless `noTerms` is set.
- **Pinned clock:** pass `now: "2026-09-28T10:30:00"` for time-dependent tests. At that time TU44VWX's 10:00–12:00 booking is in progress (the 11:00 voucher can be cancelled), and VW55XYZ's booking at 10:00 on 30 Sep is upcoming (`xd771d26b887ce0ee`).
- **Arrays:** arrays from jsdom are from another realm. Spread them (`[...x]`) before `deepStrictEqual`.
- **Timers:** close jsdom windows after each test (see `opened` in both UI test files), or long timers stall the run.
- **Buy hand-off:** tested in `test/content.test.js`.

## Visual checks

- Tests don't check layout.
- For a visual check, copy `src` and `test` into the scratchpad and serve them with a page that stubs `chrome.*` and `fetch` using the fixtures, with the clock pinned. Run `python3 -m http.server 8765 --bind 127.0.0.1 --directory <dir>` as a background command, then use Chrome MCP.
- Don't put temporary files in the repo.
- The auto-mode classifier blocked even a GET of the council's delete-favourite dialog, so don't probe destructive endpoints on the live site.

## Style

- **Code:** match the existing dense style: short helpers, template-string HTML with `esc()` for every interpolated value, and few comments that say why.
- **UI copy:** plain UK English, short sentences, sentence case, and it states outcomes ("2 booked, 1 cancelled").
- **User preferences:** the user wants brief, factual output, no filler, and agents referenced by model alias only.
