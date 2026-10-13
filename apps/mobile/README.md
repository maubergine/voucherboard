# Voucherboard mobile

The iOS app. It's a native shell around the same planner code as the extension, using the split model in [BRIDGE.md](BRIDGE.md). The Android shell lives on its own branch.

- **Engine view.** It runs `www/engine.html` invisibly, and has no network access of its own. SwiftUI draws the screens.
- **Council view.** It's a hidden WebView on the council site. Every council request runs there, as a same-origin `fetch` in the user's own session.

There's one cookie jar, the requests are real browser requests, and nothing leaves the device.

| Path | What it is |
| --- | --- |
| `BRIDGE.md` | The contract between the UI and the native shells: commands, events, the council view's rules. |
| `www/engine.js`, `views.js` | The shared engine (state and actions) and its JSON view models. |
| `www/engine.html`, `engine-host.js` | iOS: the invisible engine page SwiftUI talks to (BRIDGE.md, "Engine API"). |
| `www/native.js` | The UI side of the bridge (`VBNative`). It also sets `VB.portal.transport`, so `portal.js` requests go through the council view. |
| `www/core/` | Not in git. At build time it gets copies of `src/zones.js`, `planner.js`, `portal.js`, `terms.js`, `model.js`, `reminders.js` and `plates.js`. |
| `council/council.js` | Injected into the council view, on the council host only. It carries the fetches and fills in Buy Again, using `src/buyfill.js`. It does nothing on payment, account, card or password pages. |
| Number plate scanning | **Scan** next to the plate field reads a plate from the camera or a photo, and an image shared to the app from Photos opens Book a visitor with the plates found. The phone reads the text with Vision and `src/plates.js` picks out the plates. Nothing is uploaded or kept. See BRIDGE.md, "Number plate scanning". |
| `ios/` | The Swift shell: UIKit and WKWebView, generated with XcodeGen. See [ios/README.md](ios/README.md). |

## Status

The iOS app is built and run in the Simulator against the test fixtures, and `test/engine.test.js` covers the engine in CI. It hasn't run on a phone yet: [ios/README.md](ios/README.md) lists what to check first.
