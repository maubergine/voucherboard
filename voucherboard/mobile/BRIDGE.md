# Mobile bridge

The iOS and Android apps use the split model. Two WebViews, one cookie jar:

- **UI view.** Shows `www/index.html` from the app bundle (Android). On iOS it loads `www/engine.html` instead and isn't seen: SwiftUI draws the screens (see "Engine API"). It's the planner UI (`www/mobile.js`) plus the shared core (`src/zones.js`, `planner.js`, `portal.js`, `terms.js`, `model.js`, `reminders.js`), copied into `www/core/` at build time. It has no network access of its own: its CSP sets `connect-src 'none'`, and the native side refuses every navigation away from the bundle.
- **Council view.** Loads `https://parkingpermits.lewisham.gov.uk`. It stays hidden except while the user signs in, buys vouchers or browses the council site. Every council request the UI makes runs here, as a same-origin `fetch` in the council's page, so it carries the session and anti-forgery cookies like the extension's requests do.

Nothing goes anywhere other than the council site. The bridge has no network commands of its own.

## Messages: UI to native

The UI calls `VBNative.call(cmd, args)`, which returns a Promise (`www/native.js`).

| Platform | Transport |
| --- | --- |
| iOS | `window.webkit.messageHandlers.vb.postMessage({ cmd, args })`, registered with `addScriptMessageHandler(_:contentWorld:.page,name:"vb")` (`WKScriptMessageHandlerWithReply`). The reply is the result, or an error string that rejects the Promise. |
| Android | `vbNative.postMessage(JSON.stringify({ id, cmd, args }))`, from `WebViewCompat.addWebMessageListener(ui, "vbNative", setOf("https://appassets.androidplatform.net"), …)`. Native answers on the reply proxy with `JSON.stringify({ id, ok: true, value })` or `{ id, ok: false, error }`. |

Commands:

| cmd | args | result |
| --- | --- | --- |
| `hello` | none | `{ platform: "ios" \| "android", version, build }`. On Android it also hands native the reply proxy. |
| `council.fetch` | `{ method, path, headers, body }`. `path` is site-relative (`/Permit/Details?…`), `body` is a string or null. | `{ status, url, body }`. `url` is the final URL after redirects; `body` is the response text. Rejects with `"network"` if the fetch itself fails. |
| `council.show` | `{ reason: "signin" \| "buy" \| "browse", path, buy? }`. `buy` is `{ permitId, periodPriceId, count, label }`. | Resolves once the council view is on screen. |
| `council.signOut` | none | Clears the council view's cookies and website data. |
| `store.get` | `{ key }` | The stored JSON value, or `null`. |
| `store.set` | `{ key, value }` | `null`. The value is any JSON value. |
| `store.remove` | `{ key }` | `null` |
| `notify.permission` | none | `{ granted }`. Asks the first time. |
| `notify.schedule` | `{ items: [{ id, at, title, body, actions, data }] }`. `at` is an ISO time, `actions` is `[{ id: "extend", title: "Extend 1 hour" }]` or `[]`, and `data` is a small JSON object. | `null`. Replaces every pending Voucherboard notification. Items in the past are skipped. |
| `orientation.set` | `{ mode: "landscape" \| "portrait" \| "auto" }` | `null`. "auto" follows the device again. |
| `run.begin` / `run.end` | none | `null`. While a run is going: keep the screen on, and on iOS hold a background task. |
| `share` | `{ title, text }` | `null`. Opens the system share sheet. |
| `haptic` | `{ kind: "success" \| "warning" \| "error" \| "light" }` | `null` |
| `openExternal` | `{ url }` | `null`. Opens an https URL in the system browser. |
| `engine.event` | `{ type, data }` | `null`. iOS only: the engine page tells native that something changed (see "Engine API"). |
| `plate.scan` | `{ source: "photos" \| "camera" }` | `{ lines: [{ text, confidence }], tapped }` or `{ cancelled: true }`. See "Number plate scanning". Rejects with `"camera-denied"` if camera permission is refused, `"unavailable"` if there is no camera or the picture can't be read, or `"busy"` if a scan is already open. |

## Events: native to UI

Native calls `VBNative.emit(name, data)` with `evaluateJavaScript` on the UI view.

| Event | data | When |
| --- | --- | --- |
| `app.state` | `{ state: "active" \| "background" }` | The app moves to or from the background. |
| `council.closed` | `{ reason, signedIn }` | The council view is closed (by the user, or after a sign-in). `signedIn` is true when the view last showed a council page outside `/Account/`. |
| `notification` | `{ action: "open" \| "extend", data }` | The user tapped a Voucherboard notification or its action. If this launches the app, queue it until the UI has sent `hello`. |
| `orientation` | `{ landscape }` | The UI view's orientation changed. |
| `plate.shared` | `{ lines: [{ text, confidence }] }` | The user shared an image to Voucherboard from Photos or another app, and native has read its text. Queue it until `hello`, like `notification`. |

## The council view

- **Host:** `parkingpermits.lewisham.gov.uk` only, over https.
- **Persistent cookies:** iOS uses `WKWebsiteDataStore.default()`. Android uses the WebView's `CookieManager`, with third-party cookies off.
- **Blocked pages:** a path matching `/\/(PermitPayment|VoucherBuyAgain|Payment|Account)(\/|$)/i`, or a page with a card or password field. Nothing from Voucherboard runs on them: `council.js` checks this itself and does nothing.
- **Injected scripts:** `council/council.js`, plus `src/buyfill.js` before it. They're injected at document end, top frame only, on the council host only:
  - iOS: `WKUserScript` in a `WKContentWorld` named `voucherboard`.
  - Android: `WebViewCompat.addDocumentStartJavaScript` with the council origin rule. The script waits for `DOMContentLoaded` itself.
- **`council.fetch`:**
  - Wait until the view has finished loading a council page that isn't blocked. If it's on a blocked page or another host, load `/Home/ApplicantPermits` first.
  - **iOS:** run `return await __vbCouncil.fetch(req)` with `callAsyncJavaScript(_:arguments:in:in:)` in the `voucherboard` content world. It returns `{status, url, body}`. Isolated worlds share the page's origin and cookies.
  - **Android:** `evaluateJavascript("__vbCouncil.fetchAndPost(" + JSON.stringify(id) + "," + JSON.stringify(req) + ")")`. The script posts `JSON.stringify({ id, status, url, body })`, or `{ id, error }`, to the `vbCouncil` web message listener, which is registered with the council origin rule only. Match replies by id, with a 60-second timeout.
  - Requests are already paced by `portal.js` (`GAP_MS`), so native queues them in order and runs one at a time.
- **Hidden:** navigation is limited to the council host; any other host is cancelled.
- **Shown** (`council.show`):
  - It covers the UI full screen under a native header bar with a title, one line of text and a **Back to Voucherboard** button, which closes it and emits `council.closed`. Header text by reason:

    | reason | Title | Text |
    | --- | --- | --- |
    | `signin` | Council sign-in | This is Lewisham's own sign-in page. Voucherboard never sees or uses any of your login details. |
    | `buy` | Council site | You buy and pay on the council's own pages. Voucherboard is off on the payment page. |
    | `browse` | Council site | This is the council's own site. |

  - Redirects and form posts may leave the council host (card payment and 3-D Secure pages), but `council.js` never runs there.
  - Links the user taps in the main frame to anywhere but the council host, and the council's account registration (`/Account/Register…`), open in the system browser instead. The app shows one site, not the open web (App Store age rating 4+), and doesn't create accounts.
  - **`signin`:** load `path` (usually `/Account/Login`). When a main-frame navigation finishes on the council host outside `/Account/`, close the view automatically and emit `council.closed { reason: "signin", signedIn: true }`.
  - **`buy`:** load `path` (`/Home/ApplicantPermits`). After that page finishes loading, call `__vbCouncil.buy(intent)` (in the content world on iOS, with `evaluateJavascript` on Android). It opens and fills the council's Buy Again dialog and shows its own notice. The user presses Buy and pays. When they tap Back to Voucherboard, emit `council.closed { reason: "buy" }` and the UI reloads.
  - Native file pickers, pop-up windows and downloads aren't needed. Links with `target=_blank` open in the same view.

## UI view rules

- **iOS:** `loadFileURL(www/engine.html, allowingReadAccessTo: www/)`.
- **Android:** `WebViewAssetLoader`, serving `assets/www` at `https://appassets.androidplatform.net/www/`.
- Allow only those URLs. A tap on any other https link calls `openExternal` itself (`www/native.js`); native must also cancel any other navigation.
- Rotation follows the device unless `orientation.set` locks it.
- **Safe areas:** iOS sets `contentInsetAdjustmentBehavior = .never`, and the UI pads with `env(safe-area-inset-*)`. Android draws edge to edge and passes the system bar insets as CSS variables: `document.documentElement.style.setProperty("--sat", "<px>px")` and the same for `--sab`, `--sal` and `--sar`. The UI uses whichever of the two is set.
- Back button (Android): when the council view is shown, it goes back in the council view, or closes it if it can't. Otherwise it calls `VBNative.emit("back", {})`. The UI closes the top sheet and returns `true`, or returns `false` and native finishes the activity. On Android, `emit` returns that value through `evaluateJavascript`'s callback.

## Storage

The UI keeps all its state through `store.*`: plans (`vb:plan:<permitId>`), settings, terms acceptance and the chosen permit and subzone. These are the same keys the extension uses, and the values stay in app-private storage on the device:

- iOS: one JSON file in Application Support, excluded from backup.
- Android: `SharedPreferences`, in MODE_PRIVATE.

They're never synced.

## Number plate scanning

The phone reads the text, and the UI's shared code (`src/plates.js`) picks out UK plates from it. That keeps the plate rules in one place for both apps. Everything happens on the device:

- No image is uploaded, saved to disk or kept after the text is read.
- Only the text lines cross the bridge.
- A scan only fills in a plate. The user still checks it and books.

**Text recognition:**

- **iOS:** Vision `VNRecognizeTextRequest`: `recognitionLevel = .accurate`, `usesLanguageCorrection = false`, `recognitionLanguages = ["en-GB"]`. Each observation's top candidate becomes `{ text, confidence }`.
- **Android:** ML Kit Text Recognition v2 with the **bundled** Latin model (`com.google.mlkit:text-recognition`), so no model download. Each `Text.Line` becomes `{ text, confidence }`.
- **Android telemetry:** ML Kit's own telemetry goes through Google's `datatransport` library. The app's manifest removes its three entry points with `tools:node="remove"`, so it never starts:
  - `com.google.android.datatransport.runtime.backends.TransportBackendDiscovery` (service)
  - `com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService` (service)
  - `com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver` (receiver)

  This is the community's way of switching it off, not an official setting. Check it on a device by watching the network traffic while scanning.
- **Image size:** downscale large images so the long edge is at most 2000 px before reading them.

**`plate.scan`, source `photos`:** the system photo picker, one image, no photo-library permission:

- iOS: `PHPickerViewController` with an images filter and `selectionLimit = 1`.
- Android: `ActivityResultContracts.PickVisualMedia(ImageOnly)`.

If the user cancels, return `{ cancelled: true }`.

**`plate.scan`, source `camera`:** a full-screen live scanner. Ask for camera permission only when the user first chooses it.

- **iOS:** VisionKit `DataScannerViewController` with:
  - `recognizedDataTypes: [.text()]`
  - `qualityLevel: .accurate`
  - `recognizesMultipleItems: true`
  - `isHighlightingEnabled: true`

  Tapping a highlighted item returns all current items' text, plus that item's text as `tapped`. A **Use these** button returns them without `tapped`, and **Cancel** returns `{ cancelled: true }`. If `DataScannerViewController.isSupported` or `isAvailable` is false, fall back to `UIImagePickerController` (camera, still photo) and read the photo. `Info.plist` needs `NSCameraUsageDescription`: "Voucherboard reads number plates with the camera. The picture stays on your phone."
- **Android:** CameraX with `PreviewView` and `ImageAnalysis`, using `MlKitAnalyzer` (`androidx.camera:camera-mlkit-vision`) in view-referenced coordinates. Draw a box over each recognised line. Tapping a box, **Use these** and **Cancel** behave as on iOS. Ask for the `CAMERA` permission at the time; if it's refused, reject with `"camera-denied"`.

**Sharing an image in (`plate.shared`):**

- **iOS:** a Share Extension target, `VoucherboardShare`, activated for one image (`NSExtensionActivationSupportsImageWithMaxCount = 1`).
  - It reads the text with Vision itself; it has no WebView.
  - It writes `{ lines, at }` to `shared-scan.json` in the App Group container `group.com.mariusrubin.voucherboard` (text only, never the image).
  - It says "Plate text read. Open Voucherboard within 10 minutes to choose the plate." Extensions can't open their app through public API, so it doesn't try.
  - The app registers the `voucherboard` URL scheme and handles only `voucherboard://scan`. Whenever it opens that URL or becomes active, it reads and deletes `shared-scan.json` if it's less than 10 minutes old, and emits `plate.shared`.
- **Android:** an `ACTION_SEND` intent filter for `image/*` on the activity. Read `EXTRA_STREAM` as a content URI, read its text with ML Kit, emit `plate.shared`, and don't keep the image.

## Engine API (iOS)

On iOS, SwiftUI draws the screens. The web view stays, but loads `www/engine.html` instead of `index.html`. That page has no UI: it runs the shared engine (`engine.js`) and its view models (`views.js`) and exposes them through `engine-host.js`. Every command above still works the same way: the engine page talks to the council view and the phone exactly as the web UI does. Android keeps the web UI (`index.html`, `mobile.js` over the same engine).

**Native to engine.** Run `return await VBEngine.call(name, args)` with `callAsyncJavaScript` in the page world of the engine view. It returns JSON, or throws for an unknown name.

- **Views (read only):**
  - `home`, `today`, `calendar { dk }`, `agenda { dk }`, `day { dk }`, `board { zoom: "cal" | "week" | "day", dk }`
  - `vehicles { q }`, `vehicle { vrn }`, `suggest { text, exclude }`
  - `plan`, `entry { id }`, `visit { key }`, `bulk { keys }`, `run`, `more`, `terms`
  - `list { vrns, sort: "date" | "name", past }`: every booking and planned item. Each row has `sel` (a bulk key), and `pick` with `why` when it can't be picked.
  - `bulkTimes { keys, mode: "set" | "shift", from, to, shift }`: what a bulk time change would do. Without `from`, set mode starts from the first item's times.
- **Quick-book.** The form is a plain object, `q`, that native keeps and passes back each time. Each of these returns the `quick` view, which includes the updated `q`:
  - `quickInit { opts }`, `quickExtend { vrn, dk, end }`, `quickView { q }`
  - `quickWhen { q, when }`, `quickPreset { q, preset }`, `quickTime { q, which, min }`
  - `quickPickDays { q, id }`, `quickToggleDay { q, dk }`

  Then `confirm { q, email }`, `addVehicle { vrn, save, nick }`, `addToPlan { q }` and `bookNow { q, email }`.
- **Actions.** Each returns `{ toast?, undo?, err? }`. Show `toast` as a message, and offer Undo by calling `undo { id: undo }`:
  - Plan: `removeEntry { id }`, `clearPlan`, `setEntryTime { id, from, to }`, `addDraft { vrn, dk, from, to }`, `planChange { key, from, to }`, `bulkMove { keys, mode, from, to, shift }`
  - Council: `cancelVisit { key }`, `endEarly { key, index }`, `bulkApply { keys }`, `deleteFavourite { vrn }`, `saveFavourite { vrn, nick, isNew }`, `buy { kind, n }`
  - Runs: `review`, `runGo`, `stopRun`, `closeRun`
  - Settings and account: `acceptTerms`, `load { keepPermits }`, `setSetting { key, value }`, `setPermit { id }`, `setSubzone { code }`, `signIn`, `signOut`, `openCouncil`, `shareReport`
  - Demo: `startDemo` (a made-up council site in memory, `www/demo.js`, and an in-memory store, so nothing is sent or saved; `home.demo` and `more.demo` are true), `leaveDemo` (back to the user's own account; `signOut` in the demo does the same)
  - Scanning: `scan { source }`
- **Live Activity (iOS).** `today` gives each visit on now `startIn` and `endIn` (milliseconds from now, added to the phone's clock), plus `liveActivity` (the setting) and `zone`. Native starts one Live Activity per visit and ends it when the visit is no longer on now. It's local: no push token. Its links, `voucherboard://visit?key=` and `voucherboard://extend?vrn=&dk=&end=`, are checked by native before use.
- **Rows** of bookings have `canCancel` and `cancelText`, for swipe to cancel (which must still ask first).
- **Times** are minutes after midnight. Days are `YYYY-MM-DD` keys. Booking keys look like `VW55XYZ|2026-09-30|600`. Board selection keys are `b:<booking key>` or `e:<entry id>`.

**Engine to native.** `engine.event { type, data }`:

| type | data | Native does |
| --- | --- | --- |
| `change` | `{}` | Fetch the views on screen again. |
| `run` | `{ i?, all?, done? }` | Fetch `run` again. |
| `tick` | `{}` | The minute changed: refresh times on screen. |
| `toast` | `{ text }` | Show the message. |
| `progress` | `{ done, total }` | Vouchers cancelled so far, while a cancel runs: fill the busy message's progress. |
| `home` | `{}` | Go to Today (a notification was tapped). |
| `quick` | `{ view }` | Open Book a visitor with this `quick` view (Extend from a notification). |
| `scan` | `{ cands }` or `{ err }` | Open Book a visitor with these scanned plates (an image shared to the app). |
