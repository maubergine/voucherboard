package com.mariusrubin.voucherboard

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.mariusrubin.voucherboard.app.AppHost
import com.mariusrubin.voucherboard.app.AppModel
import com.mariusrubin.voucherboard.app.RootView
import com.mariusrubin.voucherboard.app.TodayView
import com.mariusrubin.voucherboard.app.VoucherboardTheme
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Hosts the Compose screens full screen, with the engine view (www/engine.html, never seen) and the council view
 * behind them, or the council view on top when it's shown. As the iOS app's MainViewController.
 */
class MainActivity : ComponentActivity(), AppHost {
    /** The engine view: the shared engine and view models, with no UI. The bridge only answers this view. */
    lateinit var engineView: WebView
        private set
    lateinit var council: CouncilView
        private set
    val model = AppModel(this)
    private lateinit var bridge: Bridge
    private lateinit var root: FrameLayout
    private lateinit var screens: ComposeView
    private val store by lazy { Store(this) }
    private var landscape = false
    private var bars = Insets.NONE
    private val permissionWaiters = mutableListOf<(Boolean) -> Unit>()
    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val waiting = permissionWaiters.toList()
        permissionWaiters.clear()
        waiting.forEach { it(granted && NotificationManagerCompat.from(this).areNotificationsEnabled()) }
    }

    // plate.scan: one at a time. The launchers must be registered before the activity starts.
    private var scanDone: ((JSONObject?, String?) -> Unit)? = null
    private var scanner: PlateScanner? = null
    private val pickPhoto = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@registerForActivityResult scanFinished(JSONObject().put("cancelled", true), null)
        PlateText.read(this, uri) { lines, error -> scanFinished(lines?.let { JSONObject().put("lines", it) }, error) }
    }
    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) openScanner() else scanFinished(null, "camera-denied")
    }

    /** Back goes to the council view or the scanner first while either covers the screens. */
    private val overlayBack = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            scanner?.let { return it.cancel() }
            if (council.shown) council.back()
        }
    }

    // ---------- AppHost ----------

    private var appearanceState by mutableStateOf("auto")

    /** Light, dark or automatic, chosen in More. Kept natively, not in the engine's settings, so it applies before the engine loads and survives demo mode. */
    override var appearance: String
        get() = appearanceState
        set(v) {
            appearanceState = v
            store.set(APPEARANCE, v)
        }

    override fun syncLive(today: TodayView) = LiveVisits.sync(this, today)

    private var liveBlockedState by mutableStateOf(false)
    override val liveBlocked: Boolean get() = liveBlockedState
    override fun openLiveSettings() = LiveVisits.openSettings(this)
    private val a11y by lazy { getSystemService(AccessibilityManager::class.java) }
    override val screenReader: Boolean get() = a11y.isTouchExplorationEnabled
    override fun recommendedTimeout(ms: Long): Long =
        if (Build.VERSION.SDK_INT >= 29) maxOf(ms, a11y.getRecommendedTimeoutMillis(ms.toInt(), AccessibilityManager.FLAG_CONTENT_TEXT or AccessibilityManager.FLAG_CONTENT_CONTROLS).toLong()) else ms

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appearanceState = (store.get(APPEARANCE) as? String) ?: "auto"
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        root = FrameLayout(this)
        engineView = WebView(this).apply {
            // In the window, so its timers keep running, but never seen or reached by TalkBack.
            alpha = 0f
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            isFocusable = false
        }
        council = CouncilView(this)
        screens = ComposeView(this).apply {
            setContent {
                VoucherboardTheme(appearanceState) {
                    val dark = when (appearanceState) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
                    SideEffect { lightBars = !dark }
                    RootView(model)
                }
            }
        }
        root.addView(engineView, FrameLayout.LayoutParams(1, 1))
        root.addView(council.container, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(screens, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)
        councilShown(false)

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets -> applyInsets(insets); insets }
        onBackPressedDispatcher.addCallback(this, overlayBack)
        landscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

        model.engine.webView = engineView
        bridge = Bridge(this)
        // A restored or recents launch carries the old intent; only a fresh tap is a notification event.
        if (savedInstanceState == null) {
            handleNotification(intent)
            handleShare(intent)
        }
        bridge.load()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotification(intent)
        handleShare(intent)
    }

    // Started and stopped, not resumed and paused: a permission dialog or the photo picker pauses the activity, but
    // only leaving the app is going into the background (and pauses a run), as on iOS.
    override fun onStart() {
        super.onStart()
        // The user may have changed the Live Updates switch in Settings while away.
        liveBlockedState = LiveVisits.blocked(this)
        appState("active")
    }

    override fun onStop() {
        super.onStop()
        CookieManager.getInstance().flush()
        appState("background")
    }

    private var lastState = "active"

    private fun appState(state: String) {
        if (state == lastState) return
        lastState = state
        emit("app.state", JSONObject().put("state", state))
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val now = newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE
        if (now != landscape) {
            landscape = now
            emit("orientation", JSONObject().put("landscape", now))
        }
    }

    override fun onDestroy() {
        scanner?.cancel()
        council.destroy()
        engineView.destroy()
        super.onDestroy()
    }

    /** Sends an event to the engine page. VBNative may not exist yet while the page loads; then the event is dropped. */
    fun emit(name: String, data: JSONObject) {
        engineView.evaluateJavascript("window.VBNative&&VBNative.emit(${JSONObject.quote(name)},$data)", null)
    }

    /** The engine page has loaded: calls waiting for it go ahead, and the screens fetch their views. */
    fun engineLoaded() {
        model.engine.pageLoaded()
        lifecycleScope.launch { model.refresh() }
    }

    /**
     * The renderer went away (low memory). A WebView can't be used after that, and the council view shares the
     * renderer, so the activity starts again; plans and settings are in the store.
     */
    fun engineGone() {
        model.engine.pageGone()
        recreate()
    }

    private var lightBars = true
        set(v) {
            field = v
            if (!council.shown && scanner == null) WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = v
        }

    fun councilShown(shown: Boolean) {
        // The council view stays in the window behind the screens, so its page keeps running; it comes to the front to be seen.
        (if (shown) council.container else screens).bringToFront()
        council.container.importantForAccessibility = if (shown) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        screens.importantForAccessibility = if (shown) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        // Light status bar icons over the navy council header.
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = !shown && lightBars
        overlayChanged()
    }

    /** Puts the overlay back callback above the Compose screens' own back handlers while the council view or scanner is up. */
    private fun overlayChanged() {
        val on = council.shown || scanner != null
        overlayBack.remove()
        overlayBack.isEnabled = on
        onBackPressedDispatcher.addCallback(this, overlayBack)
    }

    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun requestNotifications(cb: (Boolean) -> Unit) {
        val enabled = NotificationManagerCompat.from(this).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) return cb(enabled)
        permissionWaiters += cb
        // After a permanent refusal, the system answers at once with false and shows nothing.
        if (permissionWaiters.size == 1) askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** plate.scan. [cb] gets `{ lines, tapped? }`, `{ cancelled: true }`, or an error string. */
    fun scanPlate(source: String, cb: (JSONObject?, String?) -> Unit) {
        if (scanDone != null) return cb(null, "busy")
        scanDone = cb
        if (source == "photos") {
            try {
                pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            } catch (e: ActivityNotFoundException) {
                scanFinished(null, "unavailable")
            }
            return
        }
        when {
            !packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) -> scanFinished(null, "unavailable")
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED -> openScanner()
            // After a permanent refusal, the system answers at once with false and shows nothing.
            else -> askCamera.launch(Manifest.permission.CAMERA)
        }
    }

    private fun openScanner() {
        val s = PlateScanner(this) { result, error ->
            scanner = null
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = !council.shown && lightBars
            overlayChanged()
            scanFinished(result, error)
        }
        scanner = s
        root.addView(s.view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        s.applyInsets(bars)
        // Light status bar icons over the dark camera view.
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        overlayChanged()
        s.start()
    }

    private fun scanFinished(result: JSONObject?, error: String?) {
        val cb = scanDone ?: return
        scanDone = null
        cb(result, error)
    }

    private fun applyInsets(insets: WindowInsetsCompat) {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        this.bars = bars
        scanner?.applyInsets(bars)
        council.applyInsets(bars, insets.getInsets(WindowInsetsCompat.Type.ime()))
    }

    private fun handleNotification(intent: Intent?) {
        val action = intent?.getStringExtra(Reminders.EXTRA_ACTION) ?: return
        intent.removeExtra(Reminders.EXTRA_ACTION)
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        // MainActivity is exported, so only intents carrying this install's secret count as notification taps.
        if (intent.getStringExtra(Reminders.EXTRA_TOKEN) != Reminders.token(this)) return
        when (action) {
            "open", "extend" -> {
                NotificationManagerCompat.from(this).cancel(intent.getIntExtra(Reminders.EXTRA_NOTIFICATION, 0))
                val data = intent.getStringExtra(Reminders.EXTRA_DATA)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
                bridge.notification(JSONObject().put("action", action).put("data", data))
            }
            // A Live Update's tap or Extend: voucherboard://visit or extend, checked by the model.
            "link" -> intent.getStringExtra(Reminders.EXTRA_DATA)?.let { model.open(Uri.parse(it)) }
        }
    }

    /** An image shared in from another app: read its text and send it as plate.shared. The image isn't kept. */
    private fun handleShare(intent: Intent?) {
        if (intent == null || intent.action != Intent.ACTION_SEND || intent.type?.startsWith("image/") != true) return
        val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: return
        intent.removeExtra(Intent.EXTRA_STREAM)
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        // Only content URIs from the sharing app; never file paths, which could point into this app's own storage.
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) return
        PlateText.read(this, uri) { lines, _ ->
            // An unreadable image still arrives, with no lines, so the UI can say it found no plate.
            bridge.event("plate.shared", JSONObject().put("lines", lines ?: JSONArray()))
        }
    }

    companion object {
        private const val APPEARANCE = "vb:appearance"
    }
}
