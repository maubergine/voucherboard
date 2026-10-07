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
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    lateinit var ui: WebView
        private set
    lateinit var council: CouncilView
        private set
    private lateinit var bridge: UiBridge
    private lateinit var root: FrameLayout
    private var insetsJs = ""
    private var landscape = false
    private val permissionWaiters = mutableListOf<(Boolean) -> Unit>()
    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val waiting = permissionWaiters.toList()
        permissionWaiters.clear()
        waiting.forEach { it(granted && NotificationManagerCompat.from(this).areNotificationsEnabled()) }
    }

    // plate.scan: one at a time. The launchers must be registered before the activity starts.
    private var scanDone: ((JSONObject?, String?) -> Unit)? = null
    private var scanner: PlateScanner? = null
    private var bars = Insets.NONE
    private val pickPhoto = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@registerForActivityResult scanFinished(JSONObject().put("cancelled", true), null)
        PlateText.read(this, uri) { lines, error -> scanFinished(lines?.let { JSONObject().put("lines", it) }, error) }
    }
    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) openScanner() else scanFinished(null, "camera-denied")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        root = FrameLayout(this)
        ui = WebView(this)
        council = CouncilView(this)
        root.addView(ui, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(council.container, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets -> applyInsets(insets); WindowInsetsCompat.CONSUMED }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
        landscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

        bridge = UiBridge(this)
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

    override fun onResume() {
        super.onResume()
        emit("app.state", JSONObject().put("state", "active"))
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
        emit("app.state", JSONObject().put("state", "background"))
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
        ui.destroy()
        super.onDestroy()
    }

    /** Sends an event to the UI. VBNative may not exist yet while the page loads; then the event is dropped. */
    fun emit(name: String, data: JSONObject) {
        ui.evaluateJavascript("window.VBNative&&VBNative.emit(${JSONObject.quote(name)},$data)", null)
    }

    /** Re-applies the CSS inset variables after each UI page load. */
    fun applyInsetsToPage() {
        if (insetsJs.isNotEmpty()) ui.evaluateJavascript(insetsJs, null)
    }

    fun councilShown(shown: Boolean) {
        // Dark status bar icons over the light UI, light ones over the navy council header.
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = !shown
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
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = !council.shown
            scanFinished(result, error)
        }
        scanner = s
        root.addView(s.view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        s.applyInsets(bars)
        // Light status bar icons over the dark camera view.
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
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
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
        // Edge to edge, adjustResize no longer shrinks the window, so the keyboard is handled here.
        val lp = ui.layoutParams as FrameLayout.LayoutParams
        if (lp.bottomMargin != ime.bottom) {
            lp.bottomMargin = ime.bottom
            ui.layoutParams = lp
        }
        val d = resources.displayMetrics.density
        fun css(px: Int) = JSONObject.quote("%.1fpx".format(java.util.Locale.ROOT, px / d))
        insetsJs = "(function(s){s.setProperty('--sat',${css(bars.top)});s.setProperty('--sab',${css(maxOf(0, bars.bottom - ime.bottom))});" +
            "s.setProperty('--sal',${css(bars.left)});s.setProperty('--sar',${css(bars.right)})})(document.documentElement.style)"
        applyInsetsToPage()
        council.applyInsets(bars, ime)
    }

    private fun onBack() {
        scanner?.let { return it.cancel() }
        if (council.shown) return council.back()
        ui.evaluateJavascript("window.VBNative?VBNative.emit('back',{}):false") { result ->
            if (result != "true") finish()
        }
    }

    private fun handleNotification(intent: Intent?) {
        val action = intent?.getStringExtra(Reminders.EXTRA_ACTION) ?: return
        intent.removeExtra(Reminders.EXTRA_ACTION)
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        // MainActivity is exported, so only intents carrying this install's secret count as notification taps.
        if (intent.getStringExtra(Reminders.EXTRA_TOKEN) != Reminders.token(this)) return
        if (action != "open" && action != "extend") return
        NotificationManagerCompat.from(this).cancel(intent.getIntExtra(Reminders.EXTRA_NOTIFICATION, 0))
        val data = intent.getStringExtra(Reminders.EXTRA_DATA)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
        bridge.notification(JSONObject().put("action", action).put("data", data))
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
}
