# Voucherboard mobile

The iOS and Android apps. Each is a thin native shell around the same planner code as the extension, using the split model in [BRIDGE.md](BRIDGE.md):

- **UI view.** It shows `www/`, and has no network access of its own.
- **Council view.** It's a hidden WebView on the council site. Every council request runs there, as a same-origin `fetch` in the user's own session.

There's one cookie jar, the requests are real browser requests, and nothing leaves the device.

| Path | What it is |
| --- | --- |
| `BRIDGE.md` | The contract between the UI and the native shells: commands, events, the council view's rules. |
| `www/index.html`, `mobile.css`, `mobile.js` | The mobile UI. It has Today, Calendar (28 days, plus a day timeline), Vehicles and More, the quick-book sheet, the plan, review and run, and the landscape board. |
| `www/native.js` | The UI side of the bridge (`VBNative`). It also sets `VB.portal.transport`, so `portal.js` requests go through the council view. |
| `www/core/` | Not in git. At build time it gets copies of `src/zones.js`, `planner.js`, `portal.js`, `terms.js`, `model.js` and `reminders.js`. |
| `council/council.js` | Injected into the council view, on the council host only. It carries the fetches and fills in Buy Again, using `src/buyfill.js`. It does nothing on payment, account, card or password pages. |
| `ios/` | The Swift shell: UIKit and WKWebView, generated with XcodeGen. See [ios/README.md](ios/README.md). |
| `android/` | The Kotlin shell: Android WebView and androidx.webkit. See [android/README.md](android/README.md). |

## Status

The UI runs in Chromium against the test fixtures, and `test/mobile.test.js` covers it in CI. Neither native shell has been built yet: they were written on a machine without Xcode or the Android SDK. Each README lists what to check on the first build.

## Running the UI without a phone

`www/native.js` uses `window.VBDev = { call(cmd, args) }` when there's no app shell. To try the UI in a desktop browser:

1. Serve `www/`, with `core/` mapped to `src/`.
2. Load `scripts/guide-screenshots/harness-boot.js` before `native.js`. It pins the clock and answers council-shaped requests from `test/fixtures`.
3. Define `VBDev` so that `council.fetch` calls `fetch(path)` and `store.*` reads and writes an object.
4. Remove the CSP line from your copy of `index.html`, because the harness fetches its fixtures.

Don't commit that harness page (see CLAUDE.md, "Visual checks").
