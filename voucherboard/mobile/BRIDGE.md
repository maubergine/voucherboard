# Mobile bridge

The iOS and Android apps use the split model. Two WebViews, one cookie jar:

- **UI view.** Shows `www/index.html` from the app bundle. It's the planner UI (`www/mobile.js`) plus the shared core (`src/zones.js`, `planner.js`, `portal.js`, `terms.js`, `model.js`, `reminders.js`), copied into `www/core/` at build time. It has no network access of its own: its CSP sets `connect-src 'none'`, and the native side refuses every navigation away from the bundle.
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

## Events: native to UI

Native calls `VBNative.emit(name, data)` with `evaluateJavaScript` on the UI view.

| Event | data | When |
| --- | --- | --- |
| `app.state` | `{ state: "active" \| "background" }` | The app moves to or from the background. |
| `council.closed` | `{ reason, signedIn }` | The council view is closed (by the user, or after a sign-in). `signedIn` is true when the view last showed a council page outside `/Account/`. |
| `notification` | `{ action: "open" \| "extend", data }` | The user tapped a Voucherboard notification or its action. If this launches the app, queue it until the UI has sent `hello`. |
| `orientation` | `{ landscape }` | The UI view's orientation changed. |

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
    | `signin` | Council sign-in | This is Lewisham's own sign-in page. Voucherboard never sees or stores your password. |
    | `buy` | Council site | You buy and pay on the council's own pages. Voucherboard is off on the payment page. |
    | `browse` | Council site | This is the council's own site. |

  - Navigation may leave the council host (card payment and 3-D Secure pages), but `council.js` never runs there.
  - **`signin`:** load `path` (usually `/Account/Login`). When a main-frame navigation finishes on the council host outside `/Account/`, close the view automatically and emit `council.closed { reason: "signin", signedIn: true }`.
  - **`buy`:** load `path` (`/Home/ApplicantPermits`). After that page finishes loading, call `__vbCouncil.buy(intent)` (in the content world on iOS, with `evaluateJavascript` on Android). It opens and fills the council's Buy Again dialog and shows its own notice. The user presses Buy and pays. When they tap Back to Voucherboard, emit `council.closed { reason: "buy" }` and the UI reloads.
  - Native file pickers, pop-up windows and downloads aren't needed. Links with `target=_blank` open in the same view.

## UI view rules

- **iOS:** `loadFileURL(www/index.html, allowingReadAccessTo: www/)`.
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
