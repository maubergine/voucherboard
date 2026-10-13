# Voucherboard

Manifest V3 browser extension (beta) that overlays a planner on Lewisham's visitor parking permit site, `parkingpermits.lewisham.gov.uk`. It runs in the user's logged-in tab and makes the same same-origin requests as the council's own pages. There's no server and no build step: plain JS, loaded in the order the manifest lists.

The same core also runs in the iOS app (`voucherboard/mobile`; it runs in the Simulator and hasn't run on a phone). A shared engine (`mobile/www/engine.js`) holds the app's state and actions. iOS draws it with SwiftUI, with the engine in an invisible WebView. Every council request runs in a hidden WebView on the council site. See `mobile/BRIDGE.md`, which also describes the Android shell, kept on its own branch.

Owner: Marius Rubin. The product is proprietary, all rights are reserved, and it may be sold later (see Terms).

## Commands

Run from `voucherboard/`:

```sh
npm test          # node --test test/ (jsdom); about 9 s, 168 tests
npm run package   # dist/voucherboard-<version>.zip (manifest.json, src, icons only)
npm run package:firefox   # dist/voucherboard-firefox-<version>.zip
npm run lint:firefox      # stages dist/firefox and runs web-ext lint on it
scripts/dev.sh safari     # dist/safari/.../Voucherboard for Safari.app, ad hoc signed (--open to launch)
scripts/dev.sh ios        # build, then boot a Simulator, install and launch (--build-only to skip)
scripts/dev.sh android    # build, then start the vb36 emulator, install and launch (feat/android-compose only)
scripts/dev.sh all        # test, chrome, firefox, safari, ios and android, building only
../ci/local.sh            # the workflows via act: commitlint and ci; `all` adds the release dry run and Xcode builds (ci/README.md)
```

Run `npm test` after every change. Load the extension unpacked from `voucherboard/` via `chrome://extensions`. For Firefox, load `dist/firefox/manifest.json` in `about:debugging` (see `docs/FIREFOX.md`).

Use `scripts/dev.sh` for every Xcode and Gradle build rather than calling `xcodebuild` or `gradlew` directly: it sets `DEVELOPER_DIR` to `/Applications/Xcode.app` (override with `VB_XCODE`), whatever `xcode-select` points at, and `JAVA_HOME` to JDK 21. Logs go to `dist/*-build.log`; `-v` shows them. Steps and requirements: `docs/DEVELOPING.md`.

## Layout (`voucherboard/src`)

| File | Role |
| --- | --- |
| `content.js` | Entry point: launcher button, host element, reopens if `vb:open` is set, Buy hand-off (`VB.buyHandoff`, using `VB.buyFill`). Exits on payment, account and card/password pages. |
| `app.js` | The extension's UI in a shadow root. `create(host)` returns `{ open, close, busy }`. State lives in `S`; `refresh()` re-renders; one delegated click, change, input and keydown handler each. |
| `model.js` | What both UIs do with the council site, no DOM: `loadPermitData`, `mergeVehicles`, `checkTimes`, `buildOps`, `runOps`, `runNote`, `cancelIds`, `errorReport`. |
| `reminders.js` | Pure: `schedule()` turns bookings into local notifications ("VW55 XYZ: voucher ends at 11:00"). Used by the mobile app. |
| `plates.js` | Pure: `find(lines)` picks number plates out of text the phone read from a photo: UK formats first, with OCR mix-ups fixed by position, then any other plate-like read as is (visitors' foreign plates). `format(vrn)` spaces UK plates for display and leaves others as stored. Used by both UIs. |
| `buyfill.js` | `VB.buyFill(doc, intent)`: opens and fills the council's Buy Again dialog. Used by `content.js` and the app's council view. |
| `planner.js` | Pure logic, no DOM or network: `allocate`, `candidates`, `advanceEntries`, `purchaseAdvice`, `activations`, `shrinkOptions`, `replacedIds`, `effectiveBalance`. |
| `portal.js` | Parsers (take a Document) and requests (through `fetch`, or `portal.transport` in the app): `bookOne`, `cancelBooking`, `createFavourite`, `deleteFavourite`, `checkNickname`, `buyUrl` (validates only), and the `trace` ring buffer for error reports. |
| `zones.js` | Controlled zones, their hours and bank holidays. Zone P is Hither Green East, Mon–Fri 10:00–12:00. |
| `terms.js` | Terms HTML and `VERSION`. Bump `VERSION` whenever the terms change, so users must accept again. |

The shared namespace is `globalThis.VB` (`zones`, `planner`, `portal`, `terms`, `model`, `reminders`, `plates`, `buyFill`, `app`, `engine`, `views`). Any new `src` file the extension uses must be added to `manifest.json` `content_scripts.js` in load order, and to the `w.eval` list in `test/ui.test.js`. If the app uses it, add it to `mobile/www/engine.html`, `test/engine.test.js` and the copy list in `mobile/ios/project.yml`.

## Layout (`voucherboard/mobile`)

| Path | Role |
| --- | --- |
| `BRIDGE.md` | The contract between the UI and the native shells. Change it first, then both shells and `www/native.js`. |
| `www/engine.js` | The app's state and everything it does, no DOM: loading, quick-book form logic, plan, runs, cancel, favourites, scanning, reminders. Actions return `{ toast, undo, err }`; `on(fn)` announces `change`, `run`, `tick`, `toast`, `home`, `quick` and `scan`. |
| `www/views.js` | JSON view models of the engine for native screens, with the same wording as the extension. |
| `www/engine-host.js`, `www/engine.html` | iOS: the invisible engine page. `VBEngine.call(name, args)` for SwiftUI, and engine events sent to native as `engine.event`. |
| `www/demo.js` | Demo mode: a made-up council site in memory, answering the same requests with the same markup the parsers read, with bookings placed around today. The engine's `startDemo` swaps it in for the council view, with an in-memory store; `leaveDemo` swaps back. |
| `www/native.js` | `VBNative.call(cmd, args)` and events. `window.VBDev` stands in for the shell in tests and desktop browsers. |
| `council/council.js` | Runs in the council view (council host only): `__vbCouncil.fetch`, `fetchAndPost` (for Android), `buy`. |
| `ios/` | The iOS app (XcodeGen): SwiftUI in `ios/Voucherboard/App` over the engine, built and run in the Simulator. |
| `ios/AppStore/` | The App Store listing, review notes, `REVIEW_BRIEF.md` for App Review, privacy and age-rating answers. `test/appstore.test.js` checks the listing. Steps: `docs/APP_STORE.md`. |

## Layout (`voucherboard/safari`)

The Safari web extension for macOS, in a small app distributed outside the Mac App Store (Developer ID, notarised, zip on the GitHub release). Steps for the owner: `docs/SAFARI.md`.

| Path | Role |
| --- | --- |
| `project.yml` | XcodeGen spec: the app and the extension, bundle ids `com.mariusrubin.voucherboard.mac` and `.mac.extension`, ad hoc signing by default. |
| `extension.sh` | Build phases: `copy` puts `manifest.json` (without `key`), `src`, `guide` and `icons` into the extension; `version` writes the header both Info.plists take `manifest.json`'s version from. Nothing from `voucherboard/` is duplicated in git. |
| `App/VoucherboardApp.swift` | The one window: whether the extension is on, how to enable it and allow it on the council site, and a button that opens Safari's extension settings. |
| `Extension/SafariWebExtensionHandler.swift` | Safari's required principal class; answers nothing (no native messaging). |

`test/safari.test.js` checks the copy matches the manifest and the Chrome package's folders, the version comes from `manifest.json`, and the app never says beta.

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

Not yet tried live: the mobile apps (any of it), favourite create and delete, cancel-then-rebook changes, ending early (beta), `SendEmail`, the Buy hand-off, and 5-hour and day vouchers.

## Rules

- **Payment pages:** Voucherboard never runs on, or scripts, payment, buy, account or card pages. That includes the app's council view (`council.js` checks it itself).
- **Network:** no requests to anything other than the council site. In the app, the UI view has `connect-src 'none'`, and only the council view talks to the network. Number plate scanning reads images on the phone (Vision on iOS, ML Kit's bundled model on Android with its telemetry removed from the manifest); images are never stored or sent. `terms.js` section 12 promises this, so any kill switch or telemetry needs the terms changed first.
- **Terms gate:** `load()` reads nothing from the council until `vb:terms.version === T.VERSION`.
- **Tokens:** redact anti-forgery tokens in anything copyable (`portal.js` `redact`).
- **Store uploads:** `release.yml` runs on every push to `main`, and `scripts/store-changes.mjs` offers an upload only to stores whose artefact changed since their last successful deployment (see `docs/RELEASING.md`). Each upload waits for the owner's approval of its environment.
- **Chrome Web Store:** CI only uploads drafts. Never call `:publish` or submit for review automatically; the owner submits in the dashboard.
- **Firefox (AMO):** `manifest.json` stays Chrome's; `scripts/lib/firefox-manifest.mjs` makes Firefox's at package time (gecko id `voucherboard@mariusrubin.com`, never change it; `data_collection_permissions` `none`, so any data collection needs that and the terms changed first). `firefox-amo.yml`, called by `release.yml`, builds, lints and validates the zip only after the owner approves the `firefox-amo` environment. Never create an AMO version from CI (no `web-ext sign`, no `/versions/` call): a listed version is submitted for review as soon as it's created, and an unlisted one uses up the version number. The owner uploads in the Developer Hub. AMO API keys live only in that environment and the owner's password manager. Steps: `docs/FIREFOX.md`.
- **App Store:** `.github/workflows/ios.yml` builds on every iOS change. `ios-testflight.yml`, called by `release.yml`, uploads to TestFlight only after the owner approves the `app-store` environment. Never submit for review automatically. Signing material lives only in that environment and the owner's password manager; never commit `*.p12`, `*.p8` or `*.mobileprovision`. The app must never call itself beta (guideline 2.2).
- **Website** (`docs/`, GitHub Pages at https://voucherboard.mariusrubin.com, shared shell in `scripts/lib/site.mjs`):
  - `INSTALL.md`, `PRIVACY.md`, `SUPPORT.md` and `ACCESSIBILITY.md` are the sources; `node scripts/render-pages.mjs` writes `docs/*.html`. The App Store listing links to them.
  - The guide's single source stays `voucherboard/guide/README.md` with `guide/img` (`scripts/guide-screenshots` regenerates them). `node scripts/render-guide.mjs` writes the bundled `guide/index.html` (the extension's Guide button opens it, so an installed version matches its own guide) and publishes the same guide to `docs/guide/` (site shell, plus a copy of `img/`). Never edit `docs/guide` by hand. The Firefox and Safari builds copy `voucherboard/guide`, so keep it there.
  - CI, `test/guide.test.js` and `test/site.test.js` fail if any page or `docs/guide/img` is stale, or a link between pages is broken.
  - Each browser's install steps live once, in the guide's Install section; `INSTALL.md` links to them and covers the phone apps. When Firefox, Safari or a phone app ships, update its status in `INSTALL.md`'s table and replace its "Coming soon" line (in the guide for a browser).
- **Destructive actions** (cancel, delete a favourite, end early) always need an explicit confirm step in the UI.
- **Safari:** `.github/workflows/safari.yml` builds unsigned on every change to `safari/`, `manifest.json`, `src`, `guide` or `icons`. `safari-release.yml`, called by `release.yml`, signs with Developer ID, notarises, staples and attaches `Voucherboard-Safari-<version>.zip` to the release, only after the owner approves the `safari` environment. Never submit to the Mac App Store. Signing material lives only in that environment and the owner's password manager; never commit `*.p12`, `*.p8`, `*.mobileprovision` or `*.cer`. The containing app never calls itself beta.
- **Git:**
  - Never commit `*.pem` or `*.crx`; `.gitignore` covers them. The CRX signing key for Verified CRX uploads lives only in the owner's password manager and the `chrome-web-store` environment's `CWS_CRX_KEY` secret (see `docs/RELEASING.md`).
  - `manifest.json` `key` is the Chrome Web Store item's public key (dashboard, Package → View public key), not the CRX signing key's. It gives unpacked installs the store's extension id (`cldhejnblckejbeebjidikhebdfnncak`), so saved data survives moving the folder, and a later move to the store keeps it. Google holds the private key. `npm run package` strips `key` from the store zip.
  - The remote is `maubergine/voucherboard` on GitHub.
  - Work on branches: `planner-bulk-terms` holds the latest work and hasn't been merged into `main`.

## Tests

- **Fixtures:** `test/fixtures/` holds anonymised pages saved from the site. Never commit HAR files, because they contain cookies.
- **Fake site:** `test/fakesite.js` routes requests to a fake council site; `test/ui.test.js` `setup({ now, plan, nonEnforced, noTerms, live })` and `test/engine.test.js` `setup({ plan, noTerms, live })` use it. It records `calls`, `cancelled`, `deleted` and `created`, and pre-accepts the terms unless `noTerms` is set.
- **Pinned clock:** pass `now: "2026-09-28T10:30:00"` for time-dependent tests. At that time TU44VWX's 10:00–12:00 booking is in progress (the 11:00 voucher can be cancelled), and VW55XYZ's booking at 10:00 on 30 Sep is upcoming (`xd771d26b887ce0ee`).
- **Arrays:** arrays from jsdom are from another realm. Spread them (`[...x]`) before `deepStrictEqual`.
- **Timers:** close jsdom windows after each test (see `opened` in both UI test files), or long timers stall the run.
- **Buy hand-off:** tested in `test/content.test.js`.
- **Firefox:** `test/firefox.test.js` checks the generated manifest, the staged files, that `src` uses only `chrome.*` APIs Firefox supports, and that the AMO workflow never creates a version.
- **Mobile engine:** `test/engine.test.js` drives the engine through `VBEngine.call`, as SwiftUI does, with a `VBDev` bridge stand-in and the clock pinned to 28 Sep 10:30.

## Visual checks

- Tests don't check layout.
- For a visual check, copy `src` and `test` into the scratchpad and serve them with a page that stubs `chrome.*` and `fetch` using the fixtures, with the clock pinned. Run `python3 -m http.server 8765 --bind 127.0.0.1 --directory <dir>` as a background command, then use Chrome MCP.
- For the iOS app: build and launch it with `scripts/dev.sh ios`, and drive it with an XCUITest. To see real screens without the council site, build a scratchpad copy whose engine page loads a script after `native.js` that sends `council.fetch` (and `council.show`) to `test/fakesite.js` with the fixtures inlined, and shifts the clock to 28 Sep 2026 10:30. Keep that harness out of the repo.
- For the mobile UI, see `mobile/README.md` ("Running the UI without a phone"). Playwright with the preinstalled Chromium works for phone-sized and landscape screenshots.
- Don't put temporary files in the repo.
- The auto-mode classifier blocked even a GET of the council's delete-favourite dialog, so don't probe destructive endpoints on the live site.

## Style

- **Code:** match the existing dense style: short helpers, template-string HTML with `esc()` for every interpolated value, and few comments that say why.
- **UI copy:** plain UK English, short sentences, sentence case, and it states outcomes ("2 booked, 1 cancelled").
- **User preferences:** the user wants brief, factual output, no filler, and agents referenced by model alias only.
