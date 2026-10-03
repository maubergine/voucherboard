package uk.co.voucherboard.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    lateinit var ui: WebView
        private set
    lateinit var council: CouncilView
        private set
    private lateinit var bridge: UiBridge
    private var insetsJs = ""
    private var landscape = false
    private val permissionWaiters = mutableListOf<(Boolean) -> Unit>()
    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val waiting = permissionWaiters.toList()
        permissionWaiters.clear()
        waiting.forEach { it(granted && NotificationManagerCompat.from(this).areNotificationsEnabled()) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val root = FrameLayout(this)
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
        if (savedInstanceState == null) handleNotification(intent)
        bridge.load()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotification(intent)
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

    private fun applyInsets(insets: WindowInsetsCompat) {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
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
}
